import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Busca uma página a partir de URL fornecida pelo usuário.
 *
 * Isto é SSRF por construção: quem manda a URL decide o que o SERVIDOR alcança,
 * e o servidor alcança coisas que o cliente não alcança. Neste projeto isso é
 * especialmente sério — Postgres (5432), Redis (6379) e o próprio Nest (3333)
 * escutam em localhost, e numa VPS o endpoint de metadados da nuvem
 * (169.254.169.254) entrega credenciais de instância.
 *
 * Defesa em três camadas, porque cada uma sozinha tem furo conhecido:
 *
 *  1. Esquema http/https apenas.
 *  2. Porta 80/443 apenas — barra localhost:6379 mesmo se o IP escapasse.
 *  3. Resolução de DNS e validação do IP, não da string. "localhost" bloqueado
 *     por texto não cobre 2130706433, [::ffff:127.0.0.1] ou um domínio que
 *     aponta para 10.0.0.1.
 *
 * E tudo isso é refeito a CADA redirecionamento: validar só a primeira URL é
 * inútil, porque um encurtador limpo pode apontar para 169.254.169.254.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

/**
 * Board de vaga é bem maior que página de vaga — a descrição de cada vaga vem
 * embutida. Medido em boards reais: de 1,75 MB a 12,9 MB.
 *
 * O teto fica em 4 MB, e board maior que isso fica de fora da watchlist.
 * Subir o limite para caber no maior board é o caminho errado: são 12 MB de
 * JSON parseados de uma vez no event loop, para uma empresa só.
 */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const ALLOWED_CONTENT = ['text/html', 'application/xhtml+xml', 'text/plain'];

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface Ipv4Range {
  base: number;
  bits: number;
}

/** Faixas que nunca devem ser alcançadas a partir de URL de terceiro. */
const BLOCKED_V4: Ipv4Range[] = [
  { base: ip4('0.0.0.0'), bits: 8 },
  { base: ip4('10.0.0.0'), bits: 8 },
  { base: ip4('100.64.0.0'), bits: 10 },
  { base: ip4('127.0.0.0'), bits: 8 },
  { base: ip4('169.254.0.0'), bits: 16 },
  { base: ip4('172.16.0.0'), bits: 12 },
  { base: ip4('192.0.0.0'), bits: 24 },
  { base: ip4('192.168.0.0'), bits: 16 },
  { base: ip4('198.18.0.0'), bits: 15 },
  { base: ip4('224.0.0.0'), bits: 4 },
  { base: ip4('240.0.0.0'), bits: 4 },
];

function ip4(address: string): number {
  return (
    address.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
  );
}

/**
 * Converte IPv6 para 16 bytes, aceitando compressão `::`, zona (`%eth0`) e
 * IPv4 embutido em qualquer notação.
 *
 * Comparar prefixo por texto não serve: a classe URL normaliza
 * `[::ffff:127.0.0.1]` para `::ffff:7f00:1`, e uma checagem por string
 * procurando "127." deixaria loopback passar. Verificado — era exatamente esse
 * o furo na primeira versão.
 */
function parseIpv6(address: string): number[] | null {
  const clean = address.replace(/^\[|\]$/g, '').split('%')[0];

  // IPv4 embutido vira dois hextets antes do parse.
  const asHex = clean.replace(
    /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    (_match, a: string, b: string, c: string, d: string) => {
      const parts = [a, b, c, d].map(Number);

      if (parts.some((n) => n > 255)) {
        return 'zz';
      }

      const hi = (parts[0] << 8) | parts[1];
      const lo = (parts[2] << 8) | parts[3];

      return `${hi.toString(16)}:${lo.toString(16)}`;
    },
  );

  const halves = asHex.split('::');

  if (halves.length > 2) {
    return null;
  }

  const parse = (part: string): number[] | null => {
    if (part === '') {
      return [];
    }

    const groups: number[] = [];

    for (const hextet of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(hextet)) {
        return null;
      }

      groups.push(parseInt(hextet, 16));
    }

    return groups;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];

  if (head === null || tail === null) {
    return null;
  }

  const missing = 8 - head.length - tail.length;

  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return null;
  }

  const hextets = [...head, ...new Array<number>(missing).fill(0), ...tail];
  const bytes: number[] = [];

  for (const hextet of hextets) {
    bytes.push((hextet >> 8) & 0xff, hextet & 0xff);
  }

  return bytes;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address.replace(/^\[|\]$/g, '').split('%')[0]);

  if (version === 4) {
    const value = ip4(address);

    return BLOCKED_V4.some(
      ({ base, bits }) => value >>> (32 - bits) === base >>> (32 - bits),
    );
  }

  if (version !== 6) {
    return true;
  }

  const bytes = parseIpv6(address);

  if (!bytes) {
    return true;
  }

  const zeros = (upTo: number) => bytes.slice(0, upTo).every((b) => b === 0);
  const embedded = () => isBlockedAddress(bytes.slice(12).join('.'));

  // ::  e  ::1
  if (zeros(15) && bytes[15] <= 1) {
    return true;
  }

  // ::ffff:0:0/96 — IPv4 mapeado. Desembrulha e checa como IPv4.
  if (zeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return embedded();
  }

  // 64:ff9b::/96 — NAT64, mesma ideia.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  ) {
    return embedded();
  }

  // 2002::/16 — 6to4, o IPv4 vive nos bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isBlockedAddress(bytes.slice(2, 6).join('.'));
  }

  // fc00::/7 (ULA) · fe80::/10 (link-local) · ff00::/8 (multicast)
  return (
    (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff
  );
}

/**
 * Valida esquema, porta e TODOS os endereços para os quais o host resolve.
 *
 * Exportada porque o preenchimento de formulário também navega para URL que
 * não controlamos — e lá o risco é maior: o navegador tem sessão logada.
 */
export async function assertReachable(url: URL): Promise<void> {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new FetchError('Use um link http ou https.');
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new FetchError('Porta não permitida.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new FetchError('Endereço não permitido.');
    }

    return;
  }

  let addresses: { address: string }[];

  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchError('Não consegui resolver o endereço.');
  }

  // Um único registro privado invalida o host: um domínio pode devolver um IP
  // público e um interno, e a escolha ficaria com a sorte da ordenação.
  if (
    addresses.length === 0 ||
    addresses.some((a) => isBlockedAddress(a.address))
  ) {
    throw new FetchError('Endereço não permitido.');
  }
}

export interface FetchedPage {
  finalUrl: string;
  html: string;
}

export async function fetchPublicPage(
  rawUrl: string,
  options?: { timeoutMs?: number },
): Promise<FetchedPage> {
  const { finalUrl, body } = await fetchCapped(rawUrl, {
    accept: 'text/html,application/xhtml+xml',
    allowedContent: ALLOWED_CONTENT,
    maxBytes: MAX_BYTES,
    wrongTypeMessage: 'O link não aponta para uma página HTML.',
    timeoutMs: options?.timeoutMs,
  });

  return { finalUrl, html: body };
}

/**
 * Mesma busca, para endpoints que devolvem JSON.
 *
 * Aqui a URL não vem do usuário — os hosts dos portais são constantes do
 * código —, então a defesa de SSRF não é o ponto. O que se reaproveita é o
 * teto de tamanho, o timeout e a revalidação a cada redirecionamento: um board
 * grande sem limite enche a memória do processo.
 *
 * Devolve `unknown` de propósito. Quem chama valida com Zod: JSON de terceiro
 * é dado externo, mesmo vindo de host conhecido (seção 5 do CLAUDE.md).
 */
/** Public routing identifiers only; never cookies or authentication headers. */
type PublicJsonHeaders = { 'x-tenant'?: string; 'x-inhire-client'?: string };
export async function fetchPublicJson(
  rawUrl: string,
  headers?: PublicJsonHeaders,
): Promise<unknown> {
  const { body } = await fetchCapped(rawUrl, {
    accept: 'application/json',
    allowedContent: ['application/json'],
    maxBytes: MAX_JSON_BYTES,
    wrongTypeMessage: 'A resposta não é JSON.',
    headers,
  });

  try {
    return JSON.parse(body);
  } catch {
    throw new FetchError('A resposta não é um JSON válido.');
  }
}

interface FetchOptions {
  timeoutMs?: number;
  accept: string;
  allowedContent: string[];
  maxBytes: number;
  wrongTypeMessage: string;
  headers?: PublicJsonHeaders;
}

async function fetchCapped(
  rawUrl: string,
  options: FetchOptions,
): Promise<{ finalUrl: string; body: string }> {
  let current: URL;

  try {
    current = new URL(rawUrl);
  } catch {
    throw new FetchError('Link inválido.');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertReachable(current);

    let response: Response;

    try {
      response = await fetch(current, {
        // Manual: cada salto passa pela validação de novo. Seguir automático
        // deixaria o redirecionamento contornar tudo acima.
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
        headers: {
          // Sem cookies, sem credenciais, sem cabeçalho de origem.
          // ASCII puro: caractere acentuado aqui leva 403 de WAF — a Ashby
          // recusa a mesma requisição só por causa do cabeçalho. Medido.
          'User-Agent': 'job-tracker/1.0 (+personal job tracker)',
          Accept: options.accept,
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          ...options.headers,
        },
      });
    } catch (error) {
      throw new FetchError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'A página demorou demais para responder.'
          : 'Não consegui acessar a página.',
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');

      if (!location) {
        throw new FetchError('Redirecionamento sem destino.');
      }

      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new FetchError(
        `A página respondeu ${response.status}.`,
        response.status,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (!options.allowedContent.some((type) => contentType.includes(type))) {
      throw new FetchError(options.wrongTypeMessage);
    }

    return {
      finalUrl: current.toString(),
      body: await readCapped(response, options.maxBytes),
    };
  }

  throw new FetchError('Redirecionamentos demais.');
}

/**
 * Lê o corpo com teto aplicado DURANTE a leitura.
 *
 * Confiar no `Content-Length` não serve: o cabeçalho mente, e o `fetch`
 * descomprime gzip de forma transparente — poucos KB na rede podem virar
 * gigabytes em memória. O corte tem que acontecer a cada pedaço.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        throw new FetchError('A resposta é grande demais.');
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8').decode(merged);
}
