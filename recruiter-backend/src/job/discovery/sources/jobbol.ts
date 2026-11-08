import { parseDocument, DomUtils } from 'htmlparser2';
import type { JobSearchResult } from '@recruit/shared';
import { fetchPublicJson, fetchPublicPage } from '../../safe-fetch';
import { portalSearchLocation } from '../location-eligibility';
import {
  contractTypeFromLabel,
  fold,
  seniorityFromTitle,
  stackFromText,
  workModelFromText,
} from '../normalize';
import type { DiscoveryQuery, DiscoverySource } from '../provider';

const ORIGIN = 'https://www.jobbol.com.br';
const MAX_PAGES = 3;
type Element = ReturnType<typeof DomUtils.getElementsByTagName>[number];
const hasClass = (n: Element, name: string) =>
  (n.attribs.class ?? '').split(/\s+/).includes(name);
const text = (n: Parameters<typeof DomUtils.textContent>[0]) =>
  DomUtils.textContent(n).replace(/\s+/g, ' ').trim();

function dateFromCard(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.toISOString() === iso
    ? iso
    : null;
}

/** Only job links count: the same card class is also used for advertisements. */
export function parseJobbolJobs(html: string) {
  const doc = parseDocument(html);
  const cards = DomUtils.findAll((n) => hasClass(n, 'card-vaga'), doc.children);
  const seen = new Set<string>();
  const items: JobSearchResult[] = [];
  let invalid = 0;
  for (const card of cards) {
    const link = DomUtils.getElementsByTagName('a', card).find((n) => {
      try {
        const url = new URL(n.attribs.href, ORIGIN);
        return (
          url.origin === ORIGIN &&
          /^\/vaga\/\d+\/?$/.test(url.pathname) &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    });
    if (!link) continue;
    const url = new URL(link.attribs.href, ORIGIN);
    url.search = '';
    url.hash = '';
    const titleNode = DomUtils.getElementsByTagName('h3', card)[0];
    const title = titleNode ? text(titleNode) : '';
    const company = DomUtils.getElementsByTagName('img', card)
      .find((n) => hasClass(n, 'card-logo'))
      ?.attribs.alt?.trim();
    if (!title || !company) {
      invalid++;
      continue;
    }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const field = (name: string) => {
      const node = DomUtils.findOne((n) => hasClass(n, name), card.children);
      return node ? text(node) : '';
    };
    const rawLocation = field('card-cidade');
    const location = /^(.+?)\s*\/\s*([A-Z]{2})(?:\s*-.*)?$/.exec(rawLocation);
    const description = field('card-resumo') || null;
    const content = [title, rawLocation, description]
      .filter(Boolean)
      .join('\n');
    items.push({
      company,
      title,
      url: url.href,
      source: 'jobbol',
      description,
      stack: stackFromText(title, description),
      requirements: [],
      benefits: [],
      seniority: seniorityFromTitle(title),
      workModel:
        workModelFromText(content) ??
        (/\bhome[ -]?office\b/.test(fold(content)) ? 'remoto' : null),
      contractType: contractTypeFromLabel(title),
      location: location
        ? `${location[1].trim()}, ${location[2]}, Brasil`
        : rawLocation || null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      weeklyHours: null,
      postedAt: dateFromCard(field('card-data')),
    });
  }
  const recognized =
    cards.length > 0 ||
    /nenhuma (?:vaga|oportunidade)|n[aã]o (?:foram )?encontrad[ao]s? (?:vagas|resultados)|0 OPORTUNIDADES/i.test(
      text(doc),
    );
  return { items, invalid, recognized };
}

export function jobbolSearchUrl(query: DiscoveryQuery, page = 1): string {
  const url = new URL('/busca', ORIGIN);
  url.searchParams.set('cargo', query.q?.trim() || 'desenvolvedor');
  url.searchParams.set('pagina', String(page));
  // Remote opportunities may be advertised with the company's headquarters.
  if (query.workModels?.length === 1 && query.workModels[0] === 'remoto') {
    url.searchParams.set('regime', 'Home Office');
  } else {
    const local = portalSearchLocation(query.profileLocation);
    if (local.city) url.searchParams.set('cidade', local.city);
    if (local.state) url.searchParams.set('estado', local.state);
  }
  return url.href;
}

/** Read the site's public card loader without evaluating third-party JavaScript. */
export function jobbolCardsUrl(html: string): string | null {
  const doc = parseDocument(html);
  const script = DomUtils.getElementsByTagName('script', doc)
    .map((n) => DomUtils.textContent(n))
    .find(
      (s) =>
        s.includes("fetch('/elementos/cards.php?'") &&
        s.includes('lista-vagas'),
    );
  const block =
    script && /new URLSearchParams\(\{([^}]+)\}\)/.exec(script)?.[1];
  if (!block) return null;
  const url = new URL('/elementos/cards.php', ORIGIN);
  for (const key of ['t', 'pagina', 'categoria', 'cidade', 'estado']) {
    const value = new RegExp(`\\b${key}:\\s*'([^'\\r\\n]*)'`).exec(block)?.[1];
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return /^[a-f\d]{32}$/i.test(url.searchParams.get('t') ?? '')
    ? url.href
    : null;
}

export class JobbolSource implements DiscoverySource {
  readonly name = 'jobbol';
  readonly deadlineMs = 45_000;
  readonly issues: string[] = [];
  async fetch(query: DiscoveryQuery): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const items: JobSearchResult[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const listing = await fetchPublicPage(jobbolSearchUrl(query, page));
        let parsed = parseJobbolJobs(listing.html);
        const loader = parsed.recognized ? null : jobbolCardsUrl(listing.html);
        if (loader) {
          const cards: unknown = await fetchPublicJson(loader);
          if (
            !Array.isArray(cards) ||
            !cards.every((c) => typeof c === 'string')
          )
            throw new Error('Formato da lista de cartões mudou.');
          parsed = cards.length
            ? parseJobbolJobs(cards.join('\n'))
            : { items: [], invalid: 0, recognized: true };
        }
        if (!parsed.recognized)
          throw new Error(
            'Lista de vagas não reconhecida; o site pode exigir verificação no navegador ou ter mudado de formato.',
          );
        if (parsed.invalid)
          this.issues.push(
            `${parsed.invalid} anúncios incompletos não foram importados.`,
          );
        const fresh = parsed.items.filter((j) => !seen.has(j.url));
        for (const job of fresh) {
          seen.add(job.url);
          items.push(job);
        }
        if (!fresh.length) break;
        const doc = parseDocument(listing.html);
        const next = DomUtils.getElementsByTagName('a', doc).some((n) => {
          try {
            const u = new URL(n.attribs.href, ORIGIN);
            return (
              u.origin === ORIGIN &&
              u.pathname === '/busca' &&
              u.searchParams.get('pagina') === String(page + 1)
            );
          } catch {
            return false;
          }
        });
        if (!next) break;
        if (page === MAX_PAGES)
          this.issues.push(
            `Consulta limitada às primeiras ${MAX_PAGES} páginas do Jobbol.`,
          );
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : 'Erro ao consultar o portal.';
        const message = /403|429|captcha|challenge/i.test(reason)
          ? 'Jobbol bloqueou a consulta automática (403/429 ou verificação de acesso). A pesquisa manual continua disponível no site.'
          : `Jobbol: ${reason}`;
        if (!items.length) throw new Error(message);
        this.issues.push(message);
        break;
      }
    }
    return items;
  }
}
