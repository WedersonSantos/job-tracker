import { defaultJobPreferences } from '@recruit/shared';
import { DiscoveryService } from './discovery.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SourceSettingsService } from './source-settings.service';
import { fetchPublicJson, fetchPublicPage } from '../safe-fetch';
const runBrowser = jest.fn<Promise<never>, unknown[]>();
jest.mock('./browser-search.service', () => ({
  searchFailure: (error: unknown) =>
    error instanceof Error ? error.message : 'browser error',
  BrowserSearchService: jest.fn().mockImplementation(() => ({
    run: (...args: unknown[]) => runBrowser(...args),
  })),
}));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./source-settings.service', () => ({
  SourceSettingsService: class {},
}));
jest.mock('../safe-fetch', () => ({
  fetchPublicJson: jest.fn(),
  fetchPublicPage: jest.fn(),
}));
const read = jest.fn();
const settings = {
  read,
  emailSetup: () => ({
    configured: false,
    missingFields: ['IMAP_USER'],
    mailbox: 'job-tracker',
  }),
} as unknown as SourceSettingsService;
const prisma = {
  emailMessage: { findMany: jest.fn().mockResolvedValue([]) },
} as unknown as PrismaService;
beforeEach(() => {
  jest.clearAllMocks();
  runBrowser.mockRejectedValue(new Error('browser unavailable'));
  read.mockResolvedValue({ greenhouse: [], ashby: [], lever: [] });
  jest.mocked(fetchPublicJson).mockImplementation((url: string) => {
    if (url.includes('api.inhire.app'))
      return Promise.resolve({ tenantName: 'Solutis', jobsPage: [] });
    if (url.includes('/bad/'))
      return Promise.reject(new Error('404: board not found'));
    if (url.includes('greenhouse'))
      return Promise.resolve({
        jobs: [
          {
            title: 'Python developer',
            absolute_url: 'https://job-boards.greenhouse.io/good/jobs/1',
          },
        ],
      });
    if (url.includes('gupy')) return Promise.resolve({ data: [] });
    if (url.includes('remoteok')) return Promise.resolve([]);
    if (url.includes('remotive')) return Promise.resolve({ unexpected: [] });
    return Promise.resolve({ jobs: [] });
  });
  jest
    .mocked(fetchPublicPage)
    .mockRejectedValue(new Error('portal unavailable'));
});
it('distinguishes missing configuration, empty results and errors', async () => {
  const service = new DiscoveryService(prisma, settings);
  const initial = await service.overview();
  expect(initial.sources.find((s) => s.name === 'greenhouse')?.status).toBe(
    'not-configured',
  );
  expect(initial.sources.find((s) => s.name === 'gupy')?.status).toBe(
    'not-tested',
  );
  const result = await service.check();
  expect(result.sources.find((s) => s.name === 'gupy')?.status).toBe('empty');
  expect(result.sources.find((s) => s.name === 'remotive')?.status).toBe(
    'error',
  );
  expect(result.sources.find((s) => s.name === 'portais-br')?.status).toBe(
    'error',
  );
  expect(result.sources.find((s) => s.name === 'jobbol')?.status).toBe('error');
  expect(result.sources.find((s) => s.name === 'linkedin-alerts')?.status).toBe(
    'not-configured',
  );
});
it('partitions search cache by profile location and workplace preferences', async () => {
  const service = new DiscoveryService(prisma, settings);
  const params = {
    q: 'python',
    skills: [],
    preferences: defaultJobPreferences,
    excludedUrls: new Set<string>(),
    profileLocation: 'Uberlândia, Minas Gerais',
  };
  await service.discover(params);
  const first = runBrowser.mock.calls.length;
  await service.discover({ ...params, cursor: 'next-page' });
  expect(runBrowser).toHaveBeenCalledTimes(first);
  await service.discover(params);
  expect(runBrowser).toHaveBeenCalledTimes(first * 2);
  await service.discover({ ...params, profileLocation: 'Recife, PE' });
  await service.discover({
    ...params,
    preferences: { ...defaultJobPreferences, workModels: ['presencial'] },
  });
  expect(runBrowser).toHaveBeenCalledTimes(first * 4);
});
it('preserves successful boards and reports failed boards as a partial source', async () => {
  read.mockResolvedValue({ greenhouse: ['bad', 'good'], ashby: [], lever: [] });
  const service = new DiscoveryService(prisma, settings);
  const result = await service.check();
  expect(result.sources.find((s) => s.name === 'greenhouse')).toMatchObject({
    status: 'partial',
    count: 1,
  });
  expect(
    result.sources.find((s) => s.name === 'greenhouse')?.message,
  ).toContain('bad');
  const batch = await service.discover({
    q: 'python',
    expanded: true,
    skills: [],
    preferences: defaultJobPreferences,
    excludedUrls: new Set(),
  });
  expect(batch.items).toHaveLength(1);
  expect(batch.failedSources).toContain('greenhouse');
});
it('invalidates configuration-specific diagnostics and cache after saving', async () => {
  const service = new DiscoveryService(prisma, settings);
  await service.check();
  service.invalidate();
  expect((await service.overview()).checkedAt).toBeNull();
  await service.check();
  expect(fetchPublicJson).toHaveBeenCalledTimes(6);
});

it('returns only evidenced remote jobs, and only the home city for an onsite search', async () => {
  jest.mocked(fetchPublicJson).mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('gupy')
        ? {
            data: [
              {
                name: 'Desenvolvedor sem modalidade',
                jobUrl: 'https://example.com/unknown',
                careerPageName: 'Empresa',
                city: 'Curitiba',
                state: 'PR',
                country: 'Brasil',
              },
              {
                name: 'Desenvolvedor remoto',
                jobUrl: 'https://example.com/remote',
                careerPageName: 'Empresa',
                city: 'Curitiba',
                state: 'PR',
                country: 'Brasil',
                description: 'Trabalho remoto em todo o Brasil.',
              },
              {
                name: 'Desenvolvedor em São Paulo',
                jobUrl: 'https://example.com/elsewhere',
                careerPageName: 'Empresa',
                isRemoteWork: true,
                city: 'São Paulo',
                state: 'SP',
                country: 'Brasil',
                description: 'Esta vaga é presencial em São Paulo.',
              },
              {
                name: 'Desenvolvedor local',
                jobUrl: 'https://example.com/local',
                careerPageName: 'Empresa',
                workplaceType: 'on-site',
                city: 'Uberlândia',
                state: 'MG',
                country: 'Brasil',
              },
            ],
          }
        : url.includes('remoteok')
          ? []
          : { jobs: [] },
    ),
  );
  const service = new DiscoveryService(prisma, settings);
  const params = {
    q: 'desenvolvedor',
    profileLocation: 'Uberlândia, Minas Gerais',
    skills: [],
    excludedUrls: new Set<string>(),
    preferences: {
      ...defaultJobPreferences,
      workModels: ['remoto'] as ('remoto' | 'presencial')[],
    },
  };
  const remote = await service.discover(params);
  expect(remote.items.map((j) => [j.url, j.workModel])).toEqual([
    ['https://example.com/remote', 'remoto'],
  ]);
  const onsite = await service.discover({
    ...params,
    preferences: { ...params.preferences, workModels: ['presencial'] },
  });
  expect(onsite.items.map((j) => [j.url, j.workModel])).toEqual([
    ['https://example.com/local', 'presencial'],
  ]);
});
