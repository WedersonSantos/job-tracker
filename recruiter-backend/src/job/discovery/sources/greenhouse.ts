import { z } from 'zod';
import type { JobSearchResult } from '@recruit/shared';
import { htmlToText } from '../../html-to-text';
import { fetchPublicJson } from '../../safe-fetch';
import { canonicalJobUrl } from '../canonical-url';
import {
  countryFromText,
  seniorityFromTitle,
  stackFromText,
  toIsoDate,
  workModelFromText,
} from '../normalize';
import type { DiscoverySource } from '../provider';
import { parseEach, settledJobs } from '../provider';

/**
 * Greenhouse — board por empresa.
 *
 * `content=true` é obrigatório e caro: sem ele não vem descrição, e sem
 * descrição a stack fica vazia e a vaga é sistematicamente rebaixada na
 * ordenação em relação a Ashby e Gupy, que trazem descrição de graça. Medido
 * num board real: de 61 KB para 886 KB. Board que estourar o teto de 4 MB é
 * pulado com aviso, e não derruba a rodada.
 *
 * O `metadata` NÃO serve para filtrar por área: medido em dois boards reais,
 * um preenchia em todas as 87 vagas e o outro em nenhuma das 156. Filtro fica
 * com o título.
 */

const MAX_DESCRIPTION = 4_000;

const greenhouseJobSchema = z.object({
  title: z.string().min(1),
  absolute_url: z.string().min(1),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
});

const greenhouseBoardSchema = z.object({ jobs: z.array(z.unknown()) });

export class GreenhouseSource implements DiscoverySource {
  readonly name = 'greenhouse';
  readonly issues: string[] = [];

  /** Os slugs vêm do `.env` — ver `watchlist.ts`. */
  constructor(private readonly boards: readonly string[]) {}

  async fetch(): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const boards = await Promise.allSettled(
      this.boards.map(async (slug) => {
        const payload = greenhouseBoardSchema.safeParse(
          await fetchPublicJson(
            `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
          ),
        );

        if (!payload.success) {
          throw new Error('Formato da resposta mudou: lista de vagas ausente.');
        }

        return parseEach(payload.data.jobs, (raw) => toResult(raw, slug)).ok;
      }),
    );

    // allSettled e nao all: um board acima do teto de tamanho, fora do ar ou
    // com slug morto some da rodada — sem levar os outros junto.
    return settledJobs(boards, this.boards, this.issues);
  }
}

function toResult(raw: unknown, slug: string): JobSearchResult | null {
  const parsed = greenhouseJobSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;
  const url = canonicalJobUrl(job.absolute_url);

  if (!url) {
    return null;
  }

  const location = job.location?.name?.trim() || null;
  const description = job.content
    ? htmlToText(job.content, MAX_DESCRIPTION)
    : null;

  return {
    company: job.company_name?.trim() || titleCase(slug),
    title: job.title,
    url,
    source: 'greenhouse',
    description,
    stack: stackFromText(job.title, description),
    requirements: [],
    benefits: [],
    seniority: seniorityFromTitle(job.title),
    // Greenhouse não tem campo de modalidade; a localização é a única pista.
    workModel: workModelFromText(location),
    contractType: null,
    location: location ?? countryFromText(location),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    // `first_published`, nunca `updated_at`: uma edição de texto faria a vaga
    // parecer nova, e o frescor entra na ordenação.
    postedAt: toIsoDate(job.first_published ?? null),
  };
}

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
