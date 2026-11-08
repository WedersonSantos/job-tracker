import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { sourceSettingsSchema } from '@recruit/shared';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { SourceSettingsService } from './source-settings.service';
import { fetchPublicJson } from '../safe-fetch';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
  mkdir: jest.fn(),
  rm: jest.fn(),
}));
jest.mock('../safe-fetch', () => ({ fetchPublicJson: jest.fn() }));
const empty = { greenhouse: [], ashby: [], lever: [] };
const env = {
  DISCOVERY_GREENHOUSE_BOARDS: ['from-env'],
  DISCOVERY_ASHBY_BOARDS: [],
  DISCOVERY_LEVER_BOARDS: [],
  IMAP_HOST: 'imap.example.com',
  IMAP_USER: 'private@example.com',
  IMAP_PASSWORD: 'never-return-this',
  IMAP_MAILBOX: 'job-tracker',
};
const config = {
  get: jest.fn((key: string) => env[key as keyof typeof env]),
} as unknown as ConfigService<Env, true>;
const service = () => new SourceSettingsService(config);

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(readFile)
    .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  for (const fn of [writeFile, rename, mkdir, rm])
    jest.mocked(fn).mockResolvedValue(undefined);
});

it('normalizes public board URLs, deduplicates and rejects mismatched or invalid hosts', () => {
  expect(
    sourceSettingsSchema.parse({
      greenhouse: ['https://job-boards.greenhouse.io/acme', 'acme'],
      ashby: ['https://jobs.ashbyhq.com/example'],
      lever: ['https://jobs.lever.co/company/job-id'],
    }),
  ).toEqual({ greenhouse: ['acme'], ashby: ['example'], lever: ['company'] });
  for (const url of [
    'https://',
    'http://127.0.0.1/internal',
    'https://jobs.lever.co/company',
    'https://job-boards.greenhouse.io.evil.test/acme',
    'https://user:password@job-boards.greenhouse.io/acme',
  ])
    expect(
      sourceSettingsSchema.safeParse({ ...empty, greenhouse: [url] }).success,
    ).toBe(false);
});
it('loads env defaults only when there is no saved configuration', async () => {
  expect(await service().read()).toEqual({
    ...empty,
    greenhouse: ['from-env'],
  });
  jest.mocked(readFile).mockResolvedValue(JSON.stringify(empty));
  expect(await service().read()).toEqual(empty);
});
it('validates boards before atomically saving settings', async () => {
  jest.mocked(fetchPublicJson).mockResolvedValue({ jobs: [] });
  const result = await service().save({ ...empty, ashby: ['company'] });
  expect(result.ashby).toEqual(['company']);
  expect(fetchPublicJson).toHaveBeenCalledWith(
    'https://api.ashbyhq.com/posting-api/job-board/company',
  );
  expect(writeFile).toHaveBeenCalledWith(
    expect.any(String),
    JSON.stringify(result),
    { mode: 0o600 },
  );
  expect(rename).toHaveBeenCalledTimes(1);
});
it('preserves the old settings when a board is invalid or returns an unexpected format', async () => {
  jest.mocked(fetchPublicJson).mockResolvedValue({ error: 'not found' });
  await expect(
    service().save({ ...empty, greenhouse: ['invalid'] }),
  ).rejects.toThrow('Confira estes murais');
  expect(writeFile).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
});
it('does not expose IMAP credentials in setup information', () => {
  const info = service().emailSetup();
  expect(info.configured).toBe(true);
  expect(JSON.stringify(info)).not.toContain(env.IMAP_PASSWORD);
  expect(JSON.stringify(info)).not.toContain(env.IMAP_USER);
});
