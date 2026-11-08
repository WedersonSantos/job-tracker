import { z } from 'zod';
import { ashbyBoardReference, type JobSearchResult } from '@recruit/shared';
import { loadDepartmentNames } from '../ashby-department';
import { fetchPublicJson } from '../../safe-fetch';
import { canonicalJobUrl } from '../canonical-url';
import {
  contractTypeFromLabel,
  seniorityFromTitle,
  stackFromText,
  toIsoDate,
} from '../normalize';
import type { DiscoverySource } from '../provider';
import { parseEach, settledJobs } from '../provider';

/**
 * Ashby — o formato mais bem estruturado das três fontes por empresa.
 *
 * É a única que declara `isRemote` como booleano, país em campo próprio e
 * descrição já em texto puro, sem HTML. Várias empresas brasileiras publicam
 * por ele, com locais no Brasil declarados no campo certo.
 */

const MAX_DESCRIPTION = 4_000;

const ashbyJobSchema = z.object({
  title: z.string().min(1),
  jobUrl: z.string().min(1),
  employmentType: z.string().nullish(),
  location: z.string().nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  address: z
    .object({
      postalAddress: z
        .object({ addressCountry: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
});

const ashbyBoardSchema = z.object({ jobs: z.array(z.unknown()) });

export class AshbySource implements DiscoverySource {
  readonly name = 'ashby';
  readonly issues: string[] = [];

  /** Os slugs vêm do `.env` — ver `watchlist.ts`. */
  constructor(private readonly boards: readonly string[]) {}

  async fetch(): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const boards = await Promise.allSettled(
      this.boards.map(async (slug) => {
        const reference = ashbyBoardReference(slug);
        const payload = ashbyBoardSchema.safeParse(
          await fetchPublicJson(
            `https://api.ashbyhq.com/posting-api/job-board/${reference.slug}`,
          ),
        );

        if (!payload.success) {
          throw new Error('Formato da resposta mudou: lista de vagas ausente.');
        }

        const names = reference.departmentId
          ? await loadDepartmentNames(reference.slug, reference.departmentId)
          : null;
        const jobs = names
          ? payload.data.jobs.filter((raw) => {
              if (!raw || typeof raw !== 'object') return false;
              const job = raw as { department?: string; team?: string };
              return (
                names.has(job.team ?? '') || names.has(job.department ?? '')
              );
            })
          : payload.data.jobs;
        return parseEach(jobs, (raw) => toResult(raw, reference.slug)).ok;
      }),
    );

    // allSettled e nao all: um board acima do teto de tamanho, fora do ar ou
    // com slug morto some da rodada — sem levar os outros junto.
    return settledJobs(boards, this.boards, this.issues);
  }
}

function toResult(raw: unknown, slug: string): JobSearchResult | null {
  const parsed = ashbyJobSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;

  // `isListed: false` é vaga tirada do ar que continua na resposta.
  if (job.isListed === false) {
    return null;
  }

  const url = canonicalJobUrl(job.jobUrl);

  if (!url) {
    return null;
  }

  const description = job.descriptionPlain?.trim()
    ? job.descriptionPlain.slice(0, MAX_DESCRIPTION)
    : null;

  const country = job.address?.postalAddress?.addressCountry?.trim() || null;
  const location =
    [job.location?.trim(), country].filter(Boolean).join(', ') || null;

  return {
    company: titleCase(slug),
    title: job.title,
    url,
    source: 'ashby',
    description,
    stack: stackFromText(job.title, description),
    requirements: [],
    benefits: [],
    seniority: seniorityFromTitle(job.title),
    workModel: workModelFromAshby(job.workplaceType, job.isRemote),
    contractType: contractTypeFromLabel(job.employmentType ?? null),
    location,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    postedAt: toIsoDate(job.publishedAt ?? null),
  };
}

function workModelFromAshby(
  workplaceType: string | null | undefined,
  isRemote: boolean | null | undefined,
): JobSearchResult['workModel'] {
  switch (workplaceType) {
    case 'Remote':
      return 'remoto';
    case 'Hybrid':
      return 'hibrido';
    case 'OnSite':
      return 'presencial';
    default:
      return isRemote ? 'remoto' : null;
  }
}

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
