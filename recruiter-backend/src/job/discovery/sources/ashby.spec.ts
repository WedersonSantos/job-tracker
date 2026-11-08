import { sourceSettingsSchema } from '@recruit/shared';
import { AshbySource } from './ashby';
import { departmentNames } from '../ashby-department';
import { fetchPublicJson, fetchPublicPage } from '../../safe-fetch';
jest.mock('../../safe-fetch', () => ({
  fetchPublicJson: jest.fn(),
  fetchPublicPage: jest.fn(),
}));
const id = '8fde1d40-e400-42de-a5d1-731788c67e2b';
const input = `https://www.ashbyhq.com/careers?ashby_department_id=${id}`;
const html = `<script>window.__appData = ${JSON.stringify({
  note: 'braces }; within a JSON string',
  teams: [
    { __typename: 'Team', id, name: 'Technical Support', parentTeamId: null },
    { __typename: 'Team', id: 'child', name: 'Tier 2', parentTeamId: id },
    {
      __typename: 'Team',
      id: 'other',
      name: 'Engineering',
      parentTeamId: null,
    },
  ],
})}; window.notExecuted=true;</script>`;

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(fetchPublicPage)
    .mockResolvedValue({ html, finalUrl: 'https://jobs.ashbyhq.com/ashby' });
  jest.mocked(fetchPublicJson).mockResolvedValue({
    jobs: [
      {
        title: 'Support Specialist',
        team: 'Technical Support',
        jobUrl: 'https://jobs.ashbyhq.com/ashby/support',
      },
      {
        title: 'Software Engineer',
        team: 'Engineering',
        jobUrl: 'https://jobs.ashbyhq.com/ashby/engineer',
      },
      {
        title: 'Support Tier 2',
        team: 'Tier 2',
        jobUrl: 'https://jobs.ashbyhq.com/ashby/tier2',
      },
    ],
  });
});

it('preserves the department filter and maps the company careers URL to its board', () => {
  expect(
    sourceSettingsSchema.parse({ greenhouse: [], ashby: [input], lever: [] })
      .ashby,
  ).toEqual([`https://jobs.ashbyhq.com/ashby?ashby_department_id=${id}`]);
  expect(
    sourceSettingsSchema.safeParse({
      greenhouse: [],
      ashby: [input.replace(id, 'invalid')],
      lever: [],
    }).success,
  ).toBe(false);
  expect(
    sourceSettingsSchema.safeParse({
      greenhouse: [],
      ashby: ['https://jobs.ashbyhq.com/ashby?ashby_location_id=somewhere'],
      lever: [],
    }).success,
  ).toBe(false);
});
it('extracts team data as JSON and includes child teams', () => {
  expect([...departmentNames(html, id)]).toEqual([
    'Technical Support',
    'Tier 2',
  ]);
  expect(() => departmentNames(html, 'missing')).toThrow('não existe');
});
it('fetches only the selected department rather than all company jobs', async () => {
  const settings = sourceSettingsSchema.parse({
    greenhouse: [],
    ashby: [input],
    lever: [],
  });
  const source = new AshbySource(settings.ashby);
  expect((await source.fetch()).map((j) => j.title)).toEqual([
    'Support Specialist',
    'Support Tier 2',
  ]);
  expect(fetchPublicJson).toHaveBeenCalledWith(
    'https://api.ashbyhq.com/posting-api/job-board/ashby',
  );
  expect(source.issues).toEqual([]);
});
it('does not silently broaden the search if the department disappears', async () => {
  jest.mocked(fetchPublicPage).mockResolvedValue({
    html: '<script>window.__appData = {"teams":[]};</script>',
    finalUrl: 'https://jobs.ashbyhq.com/ashby',
  });
  const source = new AshbySource([
    `https://jobs.ashbyhq.com/ashby?ashby_department_id=${id}`,
  ]);
  expect(await source.fetch()).toEqual([]);
  expect(source.issues[0]).toContain('não existe');
});
