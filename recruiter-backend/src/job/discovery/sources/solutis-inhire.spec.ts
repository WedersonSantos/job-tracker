import { defaultJobPreferences, jobSearchResultSchema } from '@recruit/shared';
import {
  SolutisInhireSource,
  parseSolutisJobs,
  inhireJobUrl,
} from './solutis-inhire';
import { fetchPublicJson } from '../../safe-fetch';
import { matches, matchesTerm } from '../filters';
jest.mock('../../safe-fetch', () => ({ fetchPublicJson: jest.fn() }));
const id = 'b86285ac-b49b-4463-bca4-c06eefca4771';
const job = (over = {}) => ({
  jobId: id,
  displayName: 'Desenvolvedor .NET Pleno',
  status: 'published',
  workplaceType: 'Remote',
  location: 'BR',
  ...over,
});
const payload = (jobs: unknown[]) => ({
  tenantName: 'Solutis',
  about: 'Empresa oferece home office',
  jobsPage: jobs,
});

it('reads all public jobs rather than stopping at the ten visible cards', () => {
  const jobs = Array.from({ length: 26 }, (_, i) =>
    job({ jobId: `b86285ac-b49b-4463-bca4-${String(i).padStart(12, '0')}` }),
  );
  expect(parseSolutisJobs(payload(jobs)).items).toHaveLength(26);
});
it.each([
  ['Remote', 'remoto'],
  ['Hybrid', 'hibrido'],
  ['On-site', 'presencial'],
  ['unknown', null],
])('uses the declared workplace type %s', (workplaceType, model) => {
  const j = parseSolutisJobs(payload([job({ workplaceType })])).items[0];
  expect(j.workModel).toBe(model);
  expect(j.description).toBeNull();
});
it('normalizes Brazil without losing the city and state', () => {
  expect(parseSolutisJobs(payload([job()])).items[0].location).toBe('Brasil');
  expect(
    parseSolutisJobs(payload([job({ location: 'São Paulo, SP, BR' })])).items[0]
      .location,
  ).toBe('São Paulo, SP, Brasil');
  expect(
    parseSolutisJobs(payload([job({ location: '' })])).items[0].location,
  ).toBeNull();
});
it('preserves title and seniority, extracts stack and does not invent dates or salary', () => {
  const j = parseSolutisJobs(payload([job()])).items[0];
  expect(j).toMatchObject({
    title: 'Desenvolvedor .NET Pleno',
    company: 'Solutis',
    seniority: 'pleno',
    postedAt: null,
    salaryMin: null,
  });
  expect(j.stack).toContain('.NET');
  expect(jobSearchResultSchema.safeParse(j).success).toBe(true);
});
it('generates the same application link supplied in the listing', () => {
  expect(
    inhireJobUrl(id, ' Desenvolvimento .NET + Angular — Front End / FullStack'),
  ).toBe(
    `https://solutis.inhire.app/vagas/${id}/desenvolvimento-net-angular-front-end-fullstack`,
  );
});
it('excludes unpublished jobs, duplicates and malformed items', () => {
  const result = parseSolutisJobs(
    payload([
      job(),
      job(),
      job({ jobId: 'f31296f7-23fa-4464-b9aa-13f3296bc4a0', status: 'draft' }),
      { displayName: 'Invalid' },
    ]),
  );
  expect(result.items).toHaveLength(1);
  expect(result.invalid).toBe(1);
  expect(() => parseSolutisJobs({ jobs: [] })).toThrow('formato');
});
it('applies the existing job-name, modality and local residence filters', () => {
  const remote = parseSolutisJobs(payload([job()])).items[0];
  expect(matchesTerm(remote, '.NET')).toBe(true);
  const onsite = parseSolutisJobs(
    payload([job({ workplaceType: 'On-site', location: 'São Paulo, SP, BR' })]),
  ).items[0];
  expect(
    matches(onsite, defaultJobPreferences, new Date(), 'Uberlândia, MG'),
  ).toBe(false);
  expect(
    matches(onsite, { ...defaultJobPreferences, workModels: ['remoto'] }),
  ).toBe(false);
});
it('uses only public tenant-routing headers and a fixed API endpoint', async () => {
  jest.mocked(fetchPublicJson).mockResolvedValue(payload([job()]));
  const source = new SolutisInhireSource();
  expect(await source.fetch()).toHaveLength(1);
  expect(fetchPublicJson).toHaveBeenCalledWith(
    'https://api.inhire.app/job-posts/public/pages',
    { 'x-tenant': 'solutis', 'x-inhire-client': 'web-inhire' },
  );
  expect(source.issues).toEqual([]);
});
