/**
 * Reduz as várias URLs da mesma vaga a uma só.
 *
 * Isto não é higiene, é correção: a URL é a única identidade que uma vaga
 * externa tem — é a chave do `Job.url @unique`, do casamento com "já salva" e,
 * a partir da fase 2, do descarte permanente. Se a mesma vaga chega com duas
 * URLs, o descarte não pega e ela volta na próxima rodada.
 *
 * As divergências são reais e foram observadas nas fontes:
 *
 *   Greenhouse  job-boards.greenhouse.io/x/jobs/1  vs  boards.greenhouse.io/...
 *               e um `?gh_src=` grudado no fim
 *   Lever       hostedUrl  vs  applyUrl (= hostedUrl + "/apply")
 *   Ashby       jobUrl     vs  applyUrl (= jobUrl + "/application")
 *   Gupy        `?jobBoardSource=gupy_portal` no fim de todas
 *   LinkedIn    /comm/jobs/view/123  vs  /jobs/view/123, `www.` vs `br.`,
 *               slug opcional antes do id, e oito parâmetros de rastreio
 */

/** Hosts que servem o mesmo board sob nomes diferentes. */
const HOST_ALIASES: Record<string, string> = {
  'job-boards.greenhouse.io': 'boards.greenhouse.io',
  'www.remoteok.com': 'remoteok.com',
  'remoteok.io': 'remoteok.com',
};

/** Sufixos que apontam para o formulário, não para a vaga. */
const APPLY_SUFFIXES = ['/apply', '/application'];

export function canonicalJobUrl(rawUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  // Preserve Glassdoor's listing identity; other query parameters are tracking.
  const glassdoor = /(^|\.)glassdoor\.com(?:\.br)?$/i.test(url.hostname);
  const listingId = glassdoor ? url.searchParams.get('jl') : null;
  if (
    glassdoor &&
    url.pathname === '/job-listing/j' &&
    !/^\d+$/.test(listingId ?? '')
  )
    return null;
  url.search = '';
  if (listingId && /^\d+$/.test(listingId))
    url.searchParams.set('jl', listingId);
  url.hash = '';
  url.protocol = 'https:';
  url.hostname =
    HOST_ALIASES[url.hostname.toLowerCase()] ?? url.hostname.toLowerCase();

  // LinkedIn é uma REGRA de host, não uma entrada em `HOST_ALIASES`: um mapa
  // estático não expressa `*.linkedin.com`, e `br.linkedin.com` é exatamente o
  // que se obtém copiando link de uma sessão deslogada.
  if (
    url.hostname === 'linkedin.com' ||
    url.hostname.endsWith('.linkedin.com')
  ) {
    const job = url.pathname.match(
      /^(?:\/comm)?\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/,
    );

    // `null` para qualquer outro caminho, e isto é o que importa: como a query
    // já foi descartada acima, `/jobs/search/?currentJobId=123` viraria
    // `/jobs/search` — e DUAS vagas diferentes colapsariam numa identidade só.
    // Uma dispensa esconderia as duas, e `Job.url @unique` colidiria. Devolver
    // `null` transforma colisão silenciosa no erro que `dismiss()` já trata.
    return job ? `https://www.linkedin.com/jobs/view/${job[1]}` : null;
  }

  let path = url.pathname.replace(/\/+$/, '');

  for (const suffix of APPLY_SUFFIXES) {
    if (path.toLowerCase().endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }

  url.pathname = path;

  return url.toString();
}
