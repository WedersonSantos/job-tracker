import { z } from 'zod';
import type { JobSearchResult } from '@recruit/shared';
import { htmlToText } from '../../html-to-text';
import { fetchPublicJson } from '../../safe-fetch';
import { canonicalJobUrl } from '../canonical-url';
import {
  contractTypeFromLabel,
  seniorityFromTitle,
  stackFromText,
  toIsoDate,
} from '../normalize';
import type { DiscoveryQuery, DiscoverySource } from '../provider';
import { parseEach } from '../provider';

/**
 * Gupy — a fonte que cobre o mercado brasileiro.
 *
 * É busca por palavra-chave sobre o acervo inteiro, sem watchlist, e é a única
 * fonte aqui que declara modalidade E tipo de contrato em campos próprios: o
 * `type` mapeia direto para o enum do projeto (efetivo = CLT, pessoa jurídica =
 * PJ, estágio, temporário), o que nenhum ATS internacional consegue dar.
 */

const ENDPOINT = 'https://portal.gupy.io/api/job-search/jobs';

const PAGE_SIZE = 100;
const MAX_PAGES = 2;

/** Sem termo, a Gupy devolve o acervo inteiro — e a maioria não é vaga técnica. */
const DEFAULT_TERMS = ['desenvolvedor', 'engenheiro de software', 'backend'];

/** Descrição truncada: o acervo inteiro fica em memória durante a rodada. */
const MAX_DESCRIPTION = 4_000;

const gupyJobSchema = z.object({
  name: z.string().min(1),
  jobUrl: z.string().min(1),
  careerPageName: z.string().min(1),
  description: z.string().nullish(),
  type: z.string().nullish(),
  publishedDate: z.string().nullish(),
  workplaceType: z.string().nullish(),
  isRemoteWork: z.boolean().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
});

const gupyPageSchema = z.object({ data: z.array(z.unknown()) });

export class GupySource implements DiscoverySource {
  readonly name = 'gupy';

  async fetch(query: DiscoveryQuery): Promise<JobSearchResult[]> {
    const terms = query.q?.trim() ? [query.q.trim()] : DEFAULT_TERMS;
    const byUrl = new Map<string, JobSearchResult>();

    for (const term of terms) {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url =
          `${ENDPOINT}?jobName=${encodeURIComponent(term)}` +
          `&offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`;

        const payload = gupyPageSchema.safeParse(await fetchPublicJson(url));

        if (!payload.success)
          throw new Error('Gupy: formato da resposta mudou.');
        if (payload.data.data.length === 0) {
          break;
        }

        const { ok } = parseEach(payload.data.data, toResult);

        for (const item of ok) {
          byUrl.set(item.url, item);
        }

        if (payload.data.data.length < PAGE_SIZE) {
          break;
        }
      }
    }

    return [...byUrl.values()];
  }
}

function toResult(raw: unknown): JobSearchResult | null {
  const parsed = gupyJobSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;
  const url = canonicalJobUrl(job.jobUrl);

  if (!url) {
    return null;
  }

  // Banco de talentos não é vaga: não tem cargo definido nem processo aberto.
  // Entra na fila como se fosse e faz o usuário triar lixo.
  if (job.type?.includes('talent_pool')) {
    return null;
  }

  const description = job.description
    ? htmlToText(job.description, MAX_DESCRIPTION)
    : null;

  const location =
    [job.city, job.state, job.country].filter(Boolean).join(', ') || null;

  return {
    company: job.careerPageName,
    title: job.name,
    url,
    source: 'gupy',
    description,
    stack: stackFromText(job.name, description),
    requirements: [],
    benefits: [],
    seniority: seniorityFromTitle(job.name),
    workModel: workModelFromGupy(job.workplaceType, job.isRemoteWork),
    contractType: contractTypeFromLabel(job.type ?? null),
    location,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    postedAt: toIsoDate(job.publishedDate),
  };
}

function workModelFromGupy(
  workplaceType: string | null | undefined,
  isRemote: boolean | null | undefined,
): JobSearchResult['workModel'] {
  switch (workplaceType) {
    case 'remote':
      return 'remoto';
    case 'hybrid':
      return 'hibrido';
    case 'on-site':
      return 'presencial';
    default:
      // O campo vem vazio em parte das vagas; o booleano é a segunda pista.
      return isRemote ? 'remoto' : null;
  }
}
