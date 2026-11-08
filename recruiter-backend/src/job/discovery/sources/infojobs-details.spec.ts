import { defaultJobPreferences } from '@recruit/shared';
import { infoJobsWorkModel } from './infojobs-details';
import { readJobPosting, jobPostingToResult } from '../json-ld';
import { matches } from '../filters';
import { BrazilPortalsSource } from './br-portals';
import { fetchPublicPage } from '../../safe-fetch';
jest.mock('../../safe-fetch', () => ({ fetchPublicPage: jest.fn() }));
const url =
  'https://www.infojobs.com.br/vaga-de-desenvolvedor-full-stack-senior-em-sao-paulo__12171048.aspx';
const html = `<div id="VacancyHeader"><div class="text-medium mb-4">S&#xe3;o Paulo - SP</div><div class="text-medium small font-weight-bold mb-4"><svg><use xlink:href="#house-and-building"/></svg>H&#xed;brido</div></div><div id="divSimilarVacancies"><div>Home office</div><div>Presencial</div></div><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Desenvolvedor Full Stack Sênior', hiringOrganization: { name: 'Empresa' }, jobLocation: { address: { addressLocality: 'São Paulo', addressRegion: 'SP', addressCountry: 'BR' } } })}</script>`;
it('reads the model from the vacancy header, excluding nearby recommended jobs', () => {
  expect(infoJobsWorkModel(html)).toBe('hibrido');
  const posting = readJobPosting(html)!;
  const job = jobPostingToResult(posting, url, 'infojobs');
  expect(job.workModel).toBeNull();
  job.workModel = infoJobsWorkModel(html);
  expect(
    matches(
      job,
      { ...defaultJobPreferences, workModels: ['remoto'] },
      new Date(),
      'Uberlândia, Minas Gerais',
    ),
  ).toBe(false);
  expect(
    matches(
      job,
      { ...defaultJobPreferences, workModels: ['hibrido'] },
      new Date(),
      'Uberlândia, Minas Gerais',
    ),
  ).toBe(false);
  expect(
    matches(
      job,
      { ...defaultJobPreferences, workModels: ['hibrido'] },
      new Date(),
      'São Paulo, SP',
    ),
  ).toBe(true);
});
it.each([
  ['Presencial', 'presencial'],
  ['Híbrido', 'hibrido'],
  ['Home office', 'remoto'],
])('recognizes the %s label', (label, model) => {
  expect(
    infoJobsWorkModel(
      `<div id="VacancyHeader"><div>${label}</div></div><aside>Remoto</aside>`,
    ),
  ).toBe(model);
});
it('does not infer modality from recommended jobs or conflicting header labels', () => {
  expect(
    infoJobsWorkModel('<div id="divSimilarVacancies">Presencial</div>'),
  ).toBeNull();
  expect(
    infoJobsWorkModel(
      '<div id="VacancyHeader"><div>Remoto</div><div>Presencial</div></div>',
    ),
  ).toBeNull();
});
it('enriches the collected InfoJobs job with its visible work model', async () => {
  jest.mocked(fetchPublicPage).mockImplementation((target: string) => {
    if (target.includes('infojobs.com.br/empregos.aspx'))
      return Promise.resolve({
        html: `<a href="${new URL(url).pathname}">Desenvolvedor</a>`,
        finalUrl: target,
      });
    if (target === url) return Promise.resolve({ html, finalUrl: target });
    return Promise.reject(new Error('unavailable test portal'));
  });
  const jobs = await new BrazilPortalsSource().fetch({
    q: 'desenvolvedor',
    expanded: true,
  });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    url,
    workModel: 'hibrido',
    location: 'São Paulo, SP, Brasil',
  });
});
