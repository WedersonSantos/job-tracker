import { parseDocument, DomUtils } from 'htmlparser2';
import { fetchPublicPage } from '../safe-fetch';
import { readJobPosting } from './json-ld';
import { fold } from './normalize';
import { canonicalJobUrl } from './canonical-url';

export interface Availability {
  state: 'active' | 'inactive' | 'unknown';
  checkedAt: string;
  reason: string;
}
export function pageAvailability(
  html: string,
  url: string,
  now = new Date(),
): Availability {
  const result = (
    state: Availability['state'],
    reason: string,
  ): Availability => ({ state, reason, checkedAt: now.toISOString() });
  const doc = parseDocument(html);
  const nodes = DomUtils.findAll(
    (n) => ['p', 'div', 'span', 'h1', 'h2', 'strong', 'b'].includes(n.name),
    doc.children,
  );
  for (const node of nodes) {
    let ignored = false;
    for (
      let ancestor: typeof node | null = node;
      ancestor;
      ancestor =
        ancestor.parent && 'name' in ancestor.parent ? ancestor.parent : null
    ) {
      if (
        ['aside', 'script', 'style', 'template', 'noscript'].includes(
          ancestor.name,
        ) ||
        ancestor.attribs['aria-hidden'] === 'true' ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
          ancestor.attribs.style ?? '',
        ) ||
        /related|recommend|similar/i.test(
          [ancestor.attribs.id, ancestor.attribs['data-testid']].join(' '),
        )
      )
        ignored = true;
    }
    if (ignored) continue;
    const text = fold(DomUtils.textContent(node));
    if (text.length > 300) continue;
    if (
      /^(?:vaga (?:expirada|encerrada|indisponivel)|(?:esta |essa )?vaga nao (?:esta mais disponivel|disponivel)|(?:this )?job (?:has expired|is no longer available|is closed)|(?:this )?(?:position|job) is no longer accepting applications|no longer accepting applications|as inscricoes (?:estao|foram) encerradas)\b/.test(
        text,
      ) ||
      /^esta vaga.{0,100}nao esta mais disponivel para candidaturas/.test(text)
    )
      return result('inactive', 'O portal informa que a vaga foi encerrada.');
  }
  if (
    /just a moment|access denied|verify you are human|verifique que voce e humano/i.test(
      DomUtils.textContent(
        DomUtils.findOne((n) => n.name === 'title', doc.children) ?? doc,
      ),
    )
  )
    return result('unknown', 'O portal bloqueou a verificação automática.');
  const raw = readJobPosting(html);
  if (
    raw &&
    typeof raw === 'object' &&
    'validThrough' in raw &&
    typeof raw.validThrough === 'string'
  ) {
    const postingUrl =
      'url' in raw && typeof raw.url === 'string' ? raw.url : null;
    let sameJob = !postingUrl;
    if (postingUrl) {
      try {
        const canonical = canonicalJobUrl(new URL(postingUrl, url).href);
        sameJob = canonical !== null && canonical === canonicalJobUrl(url);
      } catch {
        /* malformed metadata is not evidence of closure */
      }
    }
    if (sameJob) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.validThrough)
        ? raw.validThrough + 'T23:59:59.999Z'
        : raw.validThrough;
      const expiry = Date.parse(date);
      if (Number.isFinite(expiry))
        return expiry < now.getTime()
          ? result(
              'inactive',
              'O prazo de candidatura publicado pelo portal terminou.',
            )
          : result(
              'active',
              'O prazo de candidatura publicado pelo portal está vigente.',
            );
    }
  }
  return result(
    'unknown',
    'O portal não forneceu uma confirmação de disponibilidade.',
  );
}

type PageReader = (
  url: string,
  timeoutMs: number,
) => Promise<{ html: string; finalUrl: string }>;
export class JobAvailabilityChecker {
  private readonly cache = new Map<
    string,
    { at: number; value: Availability }
  >();
  constructor(private readonly fallback?: PageReader) {}
  clear() {
    this.cache.clear();
  }
  isInactive(url: string) {
    const cached = this.cache.get(url);
    return (
      !!cached &&
      Date.now() - cached.at < 60_000 &&
      cached.value.state === 'inactive'
    );
  }
  async check(
    url: string,
    deadline = Date.now() + 20_000,
  ): Promise<Availability> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    let value: Availability = {
      state: 'unknown',
      checkedAt: new Date().toISOString(),
      reason: 'A verificação atingiu o limite de tempo desta busca.',
    };
    if (Date.now() >= deadline) return value;
    try {
      const page = await fetchPublicPage(url, {
        timeoutMs: Math.max(1, Math.min(4000, deadline - Date.now())),
      });
      value = pageAvailability(page.html, page.finalUrl);
    } catch (error: unknown) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? error.status
          : null;
      if (status === 404 || status === 410)
        value = {
          ...value,
          state: 'inactive',
          reason: `O anúncio não está disponível no portal (HTTP ${status}).`,
        };
      else {
        value.reason =
          'Não foi possível verificar: o portal bloqueou o acesso ou não respondeu.';
      }
    }
    if (
      value.state === 'unknown' &&
      this.fallback &&
      /(^|\.)glassdoor\.com(?:\.br)?$/i.test(new URL(url).hostname) &&
      deadline - Date.now() > 1000
    ) {
      try {
        const page = await this.fallback(
          url,
          Math.min(5000, deadline - Date.now()),
        );
        value = pageAvailability(page.html, page.finalUrl);
      } catch {
        /* an access failure is never proof of expiration */
      }
    }
    this.cache.set(url, { at: Date.now(), value });
    if (this.cache.size > 2000) {
      const oldest = [...this.cache.keys()][0];
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return value;
  }
}
