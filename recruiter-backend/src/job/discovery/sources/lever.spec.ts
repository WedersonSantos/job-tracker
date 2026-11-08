import { sourceSettingsSchema } from '@recruit/shared';
import { LeverSource } from './lever';
import { fetchPublicJson } from '../../safe-fetch';
jest.mock('../../safe-fetch', () => ({ fetchPublicJson: jest.fn() }));
const link = 'https://jobs.lever.co/applydigital?team=Technology';
const posts = [
  {
    text: 'Engineer',
    hostedUrl: 'https://jobs.lever.co/applydigital/1',
    categories: { team: 'Technology', location: 'Toronto' },
  },
  {
    text: 'Designer',
    hostedUrl: 'https://jobs.lever.co/applydigital/2',
    categories: { team: 'Experience Design' },
  },
  {
    text: 'Architect',
    hostedUrl: 'https://jobs.lever.co/applydigital/3',
    categories: { team: 'Technology' },
  },
];
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchPublicJson).mockResolvedValue(posts);
});

it('preserves the team filter in saved settings and rejects unsupported filters', () => {
  expect(
    sourceSettingsSchema.parse({ greenhouse: [], ashby: [], lever: [link] })
      .lever,
  ).toEqual([link]);
  for (const value of [
    link + '&team=Other',
    'https://jobs.lever.co/applydigital?team=',
    'https://jobs.lever.co/applydigital?location=Toronto',
  ])
    expect(
      sourceSettingsSchema.safeParse({
        greenhouse: [],
        ashby: [],
        lever: [value],
      }).success,
    ).toBe(false);
});
it('includes only matching teams while using the correct company endpoint', async () => {
  const source = new LeverSource([link]);
  expect((await source.fetch()).map((j) => j.title)).toEqual([
    'Engineer',
    'Architect',
  ]);
  expect(source.issues).toEqual([]);
  expect(fetchPublicJson).toHaveBeenCalledWith(
    'https://api.lever.co/v0/postings/applydigital?mode=json',
  );
});
it('keeps all teams for an unfiltered board and does not broaden a missing team filter', async () => {
  expect(await new LeverSource(['applydigital']).fetch()).toHaveLength(3);
  expect(
    await new LeverSource([
      'https://jobs.lever.co/applydigital?team=Missing',
    ]).fetch(),
  ).toEqual([]);
});
