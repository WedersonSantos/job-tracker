import { z } from 'zod';
import type { JobSearchResult } from '@recruit/shared';
import { fetchPublicJson } from '../../safe-fetch';
import {
  contractTypeFromLabel,
  fold,
  seniorityFromTitle,
  stackFromText,
} from '../normalize';
import type { DiscoverySource } from '../provider';

const ENDPOINT = 'https://api.inhire.app/job-posts/public/pages';
const HEADERS = { 'x-tenant': 'solutis', 'x-inhire-client': 'web-inhire' };
const listingSchema = z.object({
  tenantName: z.string().trim().min(1),
  jobsPage: z.array(z.unknown()),
});
const jobSchema = z.object({
  jobId: z.uuid(),
  displayName: z.string().trim().min(1),
  status: z.string(),
  workplaceType: z.string().nullish(),
  location: z.string().nullish(),
});

export function inhireJobUrl(id: string, title: string) {
  const slug =
    fold(title)
      .replace(/[()]/g, '')
      .replace(/\|/g, 'or')
      .replace(/&/g, 'and')
      .replace(/[+/#]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'vaga';
  return `https://solutis.inhire.app/vagas/${id}/${slug}`;
}
export function parseSolutisJobs(payload: unknown) {
  const parsed = listingSchema.safeParse(payload);
  if (!parsed.success)
    throw new Error('Solutis/InHire: formato da listagem mudou.');
  const items: JobSearchResult[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const raw of parsed.data.jobsPage) {
    const result = jobSchema.safeParse(raw);
    if (!result.success) {
      invalid++;
      continue;
    }
    const job = result.data;
    if (job.status !== 'published' || seen.has(job.jobId)) continue;
    seen.add(job.jobId);
    const model = fold(job.workplaceType ?? '');
    const workModel =
      model === 'remote'
        ? 'remoto'
        : model === 'hybrid'
          ? 'hibrido'
          : ['on-site', 'onsite', 'on_site'].includes(model)
            ? 'presencial'
            : null;
    const location =
      job.location
        ?.trim()
        .replace(
          /(^|,\s*)BR$/i,
          (_match, prefix: string) => `${prefix}Brasil`,
        ) || null;
    items.push({
      company: parsed.data.tenantName,
      title: job.displayName,
      url: inhireJobUrl(job.jobId, job.displayName),
      source: 'solutis-inhire',
      description: null,
      stack: stackFromText(job.displayName),
      requirements: [],
      benefits: [],
      seniority: seniorityFromTitle(job.displayName),
      workModel,
      contractType: contractTypeFromLabel(job.displayName),
      location,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      weeklyHours: null,
      postedAt: null,
    });
  }
  return { items, invalid };
}
export class SolutisInhireSource implements DiscoverySource {
  readonly name = 'solutis-inhire';
  readonly issues: string[] = [];
  async fetch(): Promise<JobSearchResult[]> {
    this.issues.length = 0;
    const result = parseSolutisJobs(await fetchPublicJson(ENDPOINT, HEADERS));
    if (result.invalid)
      this.issues.push(
        `${result.invalid} registros com dados inválidos não foram importados.`,
      );
    return result.items;
  }
}
