import { GupySource } from './gupy';
import { fetchPublicJson } from '../../safe-fetch';

jest.mock('../../safe-fetch', () => ({ fetchPublicJson: jest.fn() }));
const fetchJson = jest.mocked(fetchPublicJson);

beforeEach(() => fetchJson.mockReset());

it('uses the current portal endpoint and normalizes its jobs', async () => {
  fetchJson.mockResolvedValue({
    data: [
      {
        name: 'Desenvolvedor Python',
        jobUrl: 'https://example.gupy.io/jobs/123',
        careerPageName: 'Empresa',
        description: 'Python e SQL',
        type: 'vacancy_type_effective',
        workplaceType: 'remote',
        city: 'Uberlândia',
        state: 'Minas Gerais',
        publishedDate: '2026-10-29T12:00:00Z',
      },
    ],
    pagination: { total: 1 },
  });
  const jobs = await new GupySource().fetch({ q: 'python' });
  expect(fetchJson).toHaveBeenCalledWith(
    'https://portal.gupy.io/api/job-search/jobs?jobName=python&offset=0&limit=100',
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    title: 'Desenvolvedor Python',
    company: 'Empresa',
    source: 'gupy',
    workModel: 'remoto',
    location: 'Uberlândia, Minas Gerais',
  });
});

it('does not turn a failed endpoint into an empty successful result', async () => {
  fetchJson.mockRejectedValue(new Error('A página respondeu 404.'));
  await expect(new GupySource().fetch({ q: 'python' })).rejects.toThrow('404');
});
