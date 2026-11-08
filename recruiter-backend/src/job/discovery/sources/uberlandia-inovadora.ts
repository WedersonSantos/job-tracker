import { parseDocument, DomUtils } from 'htmlparser2';
import type { JobSearchResult } from '@recruit/shared';
import { fetchPublicPage } from '../../safe-fetch';
import { canonicalJobUrl } from '../canonical-url';
import {
  contractTypeFromLabel,
  fold,
  seniorityFromTitle,
  stackFromText,
  workModelFromText,
} from '../normalize';
import type { DiscoverySource } from '../provider';

const LISTING = 'https://uberlandiainovadora.com.br/vagas';
type Element = ReturnType<typeof DomUtils.getElementsByTagName>[number];
const text = (node: Parameters<typeof DomUtils.textContent>[0]) =>
  DomUtils.textContent(node).replace(/\s+/g, ' ').trim();
const hasClass = (node: Element, name: string) =>
  (node.attribs.class ?? '').split(/\s+/).includes(name);
const UF =
  'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';

function locationFrom(parts: string[]): string | null {
  for (const part of parts) {
    const clean = part
      .split(/\s+[—–-]\s+|\s+·\s+/)
      .at(-1)!
      .replace(/^.*\b(?:em|in)\s+/i, '')
      .trim();
    const found = new RegExp(
      `^([\\p{L}][\\p{L} '.-]{1,65}?)\\s*[,/—–-]\\s*(${UF})\\b`,
      'iu',
    ).exec(clean);
    if (found) return `${found[1].trim()}, ${found[2].toUpperCase()}`;
    if (/^uberlandia(?:,? minas gerais)?$/i.test(fold(clean)))
      return 'Uberlândia, MG';
  }
  return null;
}

/** Parses the listing grid, excluding the duplicate decorative featured cards. */
export function parseUberlandiaJobs(html: string) {
  const doc = parseDocument(html);
  const cards = DomUtils.findAll(
    (n) =>
      n.name === 'a' &&
      hasClass(n, 'bg-card') &&
      DomUtils.getElementsByTagName('h3', n).some((h) =>
        hasClass(h, 'line-clamp-2'),
      ),
    doc.children,
  );
  if (!cards.length)
    throw new Error(
      'Uberlândia Inovadora: não encontrei os cartões de vagas; o formato da página pode ter mudado.',
    );
  const items: JobSearchResult[] = [];
  let nonJobs = 0,
    withoutWebLink = 0,
    invalid = 0;
  const seen = new Set<string>();
  for (const card of cards) {
    const badges = DomUtils.getElementsByTagName('span', card)
      .filter((n) => hasClass(n, 'rounded-full'))
      .map(text);
    const title = text(DomUtils.getElementsByTagName('h3', card)[0]);
    // "Bolsa" in an internship description is pay, not a scholarship category.
    if (badges.some((b) => ['curso', 'bolsa'].includes(fold(b)))) {
      nonJobs++;
      continue;
    }
    const company = DomUtils.getElementsByTagName('span', card).find((n) =>
      hasClass(n, 'truncate'),
    );
    if (!company || !title) {
      invalid++;
      continue;
    }
    const href = card.attribs.href?.trim();
    if (!href || href.startsWith('#')) {
      withoutWebLink++;
      continue;
    }
    let url: string | null = null;
    try {
      url = canonicalJobUrl(new URL(href, LISTING).toString());
    } catch {
      /* third-party link */
    }
    if (!url) {
      withoutWebLink++;
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const paragraphs = DomUtils.getElementsByTagName('p', card).map(text);
    const notes = paragraphs.slice(1).join('\n') || null;
    const content = [title, notes].filter(Boolean).join('\n');
    const level = badges.find((b) =>
      /^(?:trainee|est[aá]gio|j[uú]nior|pleno|s[eê]nior|especialista|lideran[çc]a|n[aã]o informado)$/i.test(
        b,
      ),
    );
    const seniority =
      level && fold(level) === 'lideranca'
        ? 'lead'
        : seniorityFromTitle(level ?? title);
    items.push({
      company: text(company),
      title,
      url,
      source: 'uberlandia-inovadora',
      description: notes,
      stack: stackFromText(title, notes),
      requirements: [],
      benefits: [],
      seniority,
      workModel:
        workModelFromText(content) ??
        (/\bhome\s*office\b/i.test(content) ? 'remoto' : null),
      contractType: contractTypeFromLabel(content),
      location: locationFrom([...paragraphs.slice(1), title]),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      weeklyHours: null,
      postedAt: null,
    });
  }
  return { items, nonJobs, withoutWebLink, invalid };
}

export class UberlandiaInovadoraSource implements DiscoverySource {
  readonly name = 'uberlandia-inovadora';
  readonly issues: string[] = [];
  async fetch(): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const page = await fetchPublicPage(LISTING);
    const parsed = parseUberlandiaJobs(page.html);
    if (parsed.withoutWebLink)
      this.issues.push(
        `${parsed.withoutWebLink} anúncios sem link web (por exemplo, candidatura por email) não foram importados.`,
      );
    if (parsed.invalid)
      this.issues.push(
        `${parsed.invalid} cartões sem título ou empresa reconhecível não foram importados.`,
      );
    return parsed.items;
  }
}
