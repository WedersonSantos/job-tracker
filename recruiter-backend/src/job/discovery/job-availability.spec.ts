import { defaultJobPreferences, type JobSearchResult } from '@recruit/shared';
import { pageAvailability, JobAvailabilityChecker } from './job-availability';
import { canonicalJobUrl } from './canonical-url';
import { DiscoveryService } from './discovery.service';
import { fetchPublicPage, FetchError } from '../safe-fetch';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SourceSettingsService } from './source-settings.service';
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./source-settings.service', () => ({
  SourceSettingsService: class {},
}));
jest.mock('../safe-fetch', () => ({
  ...jest.requireActual<typeof import('../safe-fetch')>('../safe-fetch'),
  fetchPublicPage: jest.fn(),
}));
const url = 'https://www.glassdoor.com.br/job-listing/j?jl=1010294353150';
const now = new Date('2026-10-30T12:00:00Z');
beforeEach(() => {
  jest.clearAllMocks();
});
it('recognizes the exact expired Glassdoor warning even with a job description and apply link', () => {
  expect(
    pageAvailability(
      '<main><div><strong>Vaga expirada</strong> Esta vaga de 13 de out. de 2026 não está mais disponível para candidaturas.</div><h1>Security Engineer</h1><a href="/apply">Candidatar-se</a></main>',
      url,
      now,
    ).state,
  ).toBe('inactive');
});
it.each([
  'Vaga encerrada',
  'Esta vaga não está mais disponível',
  'This job has expired',
  'This position is no longer accepting applications',
])('recognizes closure: %s', (text) => {
  expect(pageAvailability(`<main><p>${text}</p></main>`, url, now).state).toBe(
    'inactive',
  );
});
it('ignores expired related jobs, scripts, hidden dialogs and ordinary references to past vacancies', () => {
  const html =
    '<main><h1>Vaga atual</h1><p>O sistema envia um aviso quando uma vaga expirada é consultada.</p></main><aside><p>Vaga expirada</p></aside><div data-testid="related-jobs"><p>Vaga encerrada</p></div><div style="display:none"><p>Vaga expirada</p></div><script>"Vaga expirada"</script>';
  expect(pageAvailability(html, url, now).state).toBe('unknown');
});
it('checks JobPosting expiry, preserves the date-only deadline through the end of the day, and ignores other job URLs', () => {
  const html = (date: string, postingUrl = url) =>
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Suporte', url: postingUrl, validThrough: date })}</script>`;
  expect(pageAvailability(html('2026-10-29'), url, now).state).toBe('inactive');
  expect(pageAvailability(html('2026-10-30'), url, now).state).toBe('active');
  expect(pageAvailability(html('invalid'), url, now).state).toBe('unknown');
  expect(
    pageAvailability(html('2026-10-29', 'https://example.com/other'), url, now)
      .state,
  ).toBe('unknown');
});
it.each([403, 429, 500])(
  'does not confuse HTTP %s with an expired job',
  async (status) => {
    jest
      .mocked(fetchPublicPage)
      .mockRejectedValue(new FetchError('blocked', status));
    expect((await new JobAvailabilityChecker().check(url)).state).toBe(
      'unknown',
    );
  },
);
it.each([404, 410])('removes unavailable HTTP %s links', async (status) => {
  jest
    .mocked(fetchPublicPage)
    .mockRejectedValue(new FetchError('gone', status));
  expect((await new JobAvailabilityChecker().check(url)).state).toBe(
    'inactive',
  );
});
it('uses rendered Glassdoor evidence after HTTP blocking and caches results briefly', async () => {
  jest
    .mocked(fetchPublicPage)
    .mockRejectedValue(new FetchError('blocked', 403));
  const fallback = jest
    .fn()
    .mockResolvedValue({ html: '<p>Vaga expirada</p>', finalUrl: url });
  const checker = new JobAvailabilityChecker(fallback);
  expect((await checker.check(url)).state).toBe('inactive');
  await checker.check(url);
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(jest.mocked(fetchPublicPage)).toHaveBeenCalledTimes(1);
});
it('does not start a network request after the search deadline', async () => {
  expect(
    (await new JobAvailabilityChecker().check(url, Date.now() - 1)).state,
  ).toBe('unknown');
  expect(fetchPublicPage).not.toHaveBeenCalled();
});
it('keeps different Glassdoor listings distinct and drops tracking parameters', () => {
  expect(canonicalJobUrl(url + '&utm_source=test')).toBe(url);
  expect(
    canonicalJobUrl(url.replace('1010294353150', '1010294353151')),
  ).not.toBe(canonicalJobUrl(url));
  expect(
    canonicalJobUrl('https://www.glassdoor.com.br/job-listing/j'),
  ).toBeNull();
});
it('replenishes expired slots and keeps pagination, total and unknown results consistent', async () => {
  const settings = {
    read: () => Promise.resolve({ greenhouse: [], ashby: [], lever: [] }),
    emailSetup: () => ({ configured: false }),
  } as unknown as SourceSettingsService;
  const service = new DiscoveryService({} as PrismaService, settings);
  const jobs: JobSearchResult[] = Array.from({ length: 45 }, (_, i) => ({
    title: `Suporte ${i}`,
    company: 'Empresa',
    url: `https://example.com/job/${i}`,
    source: 'test',
    description: 'Suporte remoto Brasil',
    stack: [],
    requirements: [],
    benefits: [],
    seniority: null,
    workModel: 'remoto',
    contractType: null,
    location: 'Brasil',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    weeklyHours: null,
    postedAt: null,
  }));
  Object.defineProperty(service, 'sources', {
    value: () => [{ name: 'test', fetch: () => Promise.resolve(jobs) }],
  });
  jest.mocked(fetchPublicPage).mockImplementation((link: string) =>
    Promise.resolve({
      finalUrl: link,
      html: link.endsWith('/0')
        ? '<p>Vaga expirada</p>'
        : '<h1>Vaga aberta sem prazo publicado</h1>',
    }),
  );
  const params = {
    skills: [],
    preferences: {
      ...defaultJobPreferences,
      workModels: ['remoto' as const],
      titleIncludes: [],
      titleExcludes: [],
      scope: null,
    },
    excludedUrls: new Set<string>(),
  };
  const first = await service.discover(params);
  expect(first.items).toHaveLength(40);
  expect(first.items.some((j) => j.url.endsWith('/0'))).toBe(false);
  expect(first.items.every((j) => j.availability?.state === 'unknown')).toBe(
    true,
  );
  expect(first.total).toBe(44);
  expect(first.nextCursor).not.toBeNull();
  const second = await service.discover({
    ...params,
    cursor: first.nextCursor!,
  });
  expect(second.items).toHaveLength(4);
  expect(
    new Set([...first.items, ...second.items].map((j) => j.url)).size,
  ).toBe(44);
  expect(second.nextCursor).toBeNull();
});
