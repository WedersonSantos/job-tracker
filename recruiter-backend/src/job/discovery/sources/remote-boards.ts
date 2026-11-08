import { z } from 'zod';
import type { JobSearchResult } from '@recruit/shared';
import { htmlToText } from '../../html-to-text';
import { fetchPublicJson } from '../../safe-fetch';
import { canonicalJobUrl } from '../canonical-url';
import { seniorityFromTitle, stackFromText, toIsoDate } from '../normalize';
import type { DiscoverySource } from '../provider';
import { parseEach } from '../provider';

/**
 * RemoteOK e Remotive — agregadores de vaga remota, sem watchlist.
 *
 * Ficam juntos porque compartilham a forma (busca sobre acervo próprio, tudo
 * remoto) e as limitações. Nenhum dos dois é grande contribuinte, e vale saber
 * por quê antes de esperar volume deles:
 *
 *   RemoteOK   100 vagas por resposta, das quais só ~5 são técnicas. O
 *              `item[0]` é aviso legal, não vaga. Único com faixa salarial —
 *              4 em 100 declaram.
 *   Remotive   devolve 17 vagas no total e IGNORA `search=` e `limit=`. Entra
 *              porque é barato, não porque rende.
 */

const MAX_DESCRIPTION = 4_000;

/* ------------------------------ RemoteOK ------------------------------ */

const remoteOkJobSchema = z.object({
  position: z.string().min(1),
  company: z.string().min(1),
  url: z.string().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  date: z.string().nullish(),
});

export class RemoteOkSource implements DiscoverySource {
  readonly name = 'remoteok';

  async fetch(): Promise<JobSearchResult[]> {
    const payload = await fetchPublicJson('https://remoteok.com/api');

    if (!Array.isArray(payload)) {
      throw new Error('RemoteOK: formato da resposta mudou.');
    }

    // O primeiro item é `{ legal, last_updated }`. Sem cargo, o schema já o
    // rejeitaria — mas descartar explicitamente evita contá-lo como falha.
    return parseEach(payload.slice(1), toRemoteOkResult).ok;
  }
}

function toRemoteOkResult(raw: unknown): JobSearchResult | null {
  const parsed = remoteOkJobSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;
  const url = canonicalJobUrl(job.url);

  if (!url) {
    return null;
  }

  const description = job.description
    ? htmlToText(job.description, MAX_DESCRIPTION)
    : null;

  return {
    company: job.company,
    title: job.position,
    url,
    source: 'remoteok',
    description,
    // As tags do portal NÃO entram: o RemoteOK marca "golang" numa vaga de
    // técnico de tráfego aéreo. Título e descrição são escritos por quem
    // contrata; a tag é do agregador, e erra.
    stack: stackFromText(job.position, description),
    requirements: [],
    benefits: [],
    seniority: seniorityFromTitle(job.position),
    workModel: 'remoto',
    contractType: null,
    // O campo `location` traz a cidade de quem publicou, não onde se trabalha.
    location: null,
    salaryMin: toInt(job.salary_min),
    salaryMax: toInt(job.salary_max),
    salaryCurrency: job.salary_min ? 'USD' : null,
    weeklyHours: null,
    postedAt: toIsoDate(job.date ?? null),
  };
}

/* ------------------------------ Remotive ------------------------------ */

const remotiveJobSchema = z.object({
  title: z.string().min(1),
  company_name: z.string().min(1),
  url: z.string().min(1),
  description: z.string().nullish(),
  job_type: z.string().nullish(),
  publication_date: z.string().nullish(),
  candidate_required_location: z.string().nullish(),
});

const remotivePageSchema = z.object({ jobs: z.array(z.unknown()) });

export class RemotiveSource implements DiscoverySource {
  readonly name = 'remotive';

  async fetch(): Promise<JobSearchResult[]> {
    const payload = remotivePageSchema.safeParse(
      await fetchPublicJson('https://remotive.com/api/remote-jobs'),
    );

    if (!payload.success) {
      throw new Error('Remotive: formato da resposta mudou.');
    }

    return parseEach(payload.data.jobs, toRemotiveResult).ok;
  }
}

function toRemotiveResult(raw: unknown): JobSearchResult | null {
  const parsed = remotiveJobSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;
  const url = canonicalJobUrl(job.url);

  if (!url) {
    return null;
  }

  const description = job.description
    ? htmlToText(job.description, MAX_DESCRIPTION)
    : null;

  return {
    company: job.company_name,
    title: job.title,
    url,
    source: 'remotive',
    description,
    stack: stackFromText(job.title, description),
    requirements: [],
    benefits: [],
    seniority: seniorityFromTitle(job.title),
    workModel: 'remoto',
    contractType: null,
    // "LATAM, Europe, USA" — é onde o candidato pode estar, e é o que interessa
    // para o filtro de escopo.
    location: job.candidate_required_location?.trim() || null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    postedAt: toIsoDate(job.publication_date ?? null),
  };
}

function toInt(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null;
}
