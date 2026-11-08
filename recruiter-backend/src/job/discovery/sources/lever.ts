import { z } from 'zod';
import { leverBoardReference, type JobSearchResult } from '@recruit/shared';
import { fetchPublicJson } from '../../safe-fetch';
import { canonicalJobUrl } from '../canonical-url';
import {
  contractTypeFromLabel,
  seniorityFromTitle,
  stackFromText,
  toIsoDate,
  fold,
} from '../normalize';
import type { DiscoverySource } from '../provider';
import { parseEach, settledJobs } from '../provider';

/**
 * Lever — board por empresa.
 *
 * A lista é curta de propósito: das dez empresas testadas, só cinco ainda
 * respondem. O Lever vem perdendo espaço para Ashby e Greenhouse, e slug morto
 * devolve 404 em silêncio.
 *
 * Não há campo de empresa na resposta — o slug é a empresa.
 */

const MAX_DESCRIPTION = 4_000;

const leverJobSchema = z.object({
  text: z.string().min(1),
  hostedUrl: z.string().min(1),
  createdAt: z.number().nullish(),
  descriptionPlain: z.string().nullish(),
  workplaceType: z.string().nullish(),
  country: z.string().nullish(),
  categories: z
    .object({
      commitment: z.string().nullish(),
      location: z.string().nullish(),
    })
    .nullish(),
});

export class LeverSource implements DiscoverySource {
  readonly name = 'lever';
  readonly issues: string[] = [];

  /** Os slugs vêm do `.env` — ver `watchlist.ts`. */
  constructor(private readonly boards: readonly string[]) {}

  async fetch(): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const boards = await Promise.allSettled(
      this.boards.map(async (slug) => {
        const reference = leverBoardReference(slug);
        const payload = await fetchPublicJson(
          `https://api.lever.co/v0/postings/${reference.slug}?mode=json`,
        );

        if (!Array.isArray(payload)) {
          throw new Error('Formato da resposta mudou: lista de vagas ausente.');
        }

        const jobs = reference.team
          ? payload.filter((raw: unknown) => {
              if (!raw || typeof raw !== 'object') return false;
              const team = (raw as { categories?: { team?: unknown } })
                .categories?.team;
              return (
                typeof team === 'string' && fold(team) === fold(reference.team!)
              );
            })
          : payload;
        return parseEach(jobs, (raw) => toResult(raw, reference.slug)).ok;
      }),
    );

    // allSettled e nao all: um board acima do teto de tamanho, fora do ar ou
    // com slug morto some da rodada — sem levar os outros junto.
    return settledJobs(boards, this.boards, this.issues);
  }
}

function toResult(raw: unknown, slug: string): JobSearchResult | null {
  const parsed = leverJobSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;
  const url = canonicalJobUrl(job.hostedUrl);

  if (!url) {
    return null;
  }

  const description = job.descriptionPlain?.trim()
    ? job.descriptionPlain.slice(0, MAX_DESCRIPTION)
    : null;

  const location =
    [job.categories?.location?.trim(), job.country?.trim()]
      .filter(Boolean)
      .join(', ') || null;

  return {
    company: titleCase(slug),
    title: job.text,
    url,
    source: 'lever',
    description,
    stack: stackFromText(job.text, description),
    requirements: [],
    benefits: [],
    seniority: seniorityFromTitle(job.text),
    workModel: workModelFromLever(job.workplaceType),
    contractType: contractTypeFromLabel(job.categories?.commitment ?? null),
    location,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    // Epoch em milissegundos.
    postedAt: toIsoDate(job.createdAt ?? null),
  };
}

function workModelFromLever(
  workplaceType: string | null | undefined,
): JobSearchResult['workModel'] {
  switch (workplaceType) {
    case 'remote':
      return 'remoto';
    case 'hybrid':
      return 'hibrido';
    case 'on-site':
      return 'presencial';
    default:
      return null;
  }
}

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
