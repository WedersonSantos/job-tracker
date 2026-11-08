import { defaultJobPreferences, jobSearchResultSchema } from '@recruit/shared';
import { fetchPublicJson, fetchPublicPage } from '../../safe-fetch';
import { matches } from '../filters';
import {
  JobbolSource,
  jobbolCardsUrl,
  jobbolSearchUrl,
  parseJobbolJobs,
} from './jobbol';
jest.mock('../../safe-fetch', () => ({
  fetchPublicPage: jest.fn(),
  fetchPublicJson: jest.fn(),
}));
const card = (
  id = '29387162593',
  location = 'Uberlândia / MG - Distrito Industrial',
  title = 'ANALISTA FISCAL PLENO',
) =>
  `<div class="card-vaga"><p class="card-data">27/10/2026</p><img class="card-logo" alt="Empresa de Soluções para Fertilizantes"><a href="/vaga/${id}"><h3><u>${title}</u></h3></a><span class="card-cidade"><svg></svg>${location}</span><span class="card-resumo">Oportunidade na área de Administrativo</span><a href="/vaga/${id}" class="btn-ver">Ver vaga</a></div>`;
const advertisement =
  '<div class="card-vaga"><h3>SIGA O JOBBOL NO INSTAGRAM</h3><img class="card-logo" alt="instagram"><a href="https://www.instagram.com/jobbol.empregos">Seguir</a></div>';
const loader = `<div id="lista-vagas"></div><script>const params = new URLSearchParams({t: '277156fb18d970ba18baf52bebea4689',pagina: '1',categoria: '',cidade: 'Uberlândia',estado: 'MG'}).toString();fetch('/elementos/cards.php?' + params).then(r=>r.json()).then(cards=>document.getElementById('lista-vagas'));</script>`;
const page = (html: string) => ({
  html,
  finalUrl: 'https://www.jobbol.com.br/busca',
});
beforeEach(() => jest.resetAllMocks());

it('extracts the supplied card format, removes ads and duplicate job links', () => {
  const parsed = parseJobbolJobs(card() + advertisement + card());
  expect(parsed.items).toHaveLength(1);
  expect(parsed.items[0]).toMatchObject({
    title: 'ANALISTA FISCAL PLENO',
    company: 'Empresa de Soluções para Fertilizantes',
    location: 'Uberlândia, MG, Brasil',
    postedAt: '2026-10-27T00:00:00.000Z',
    url: 'https://www.jobbol.com.br/vaga/29387162593',
    seniority: 'pleno',
    workModel: null,
    salaryMin: null,
  });
  expect(jobSearchResultSchema.safeParse(parsed.items[0]).success).toBe(true);
});
it('does not invent a date, company, job URL or workplace model', () => {
  expect(
    parseJobbolJobs(card().replace('27/10/2026', '31/02/2026')).items[0]
      .postedAt,
  ).toBeNull();
  expect(
    parseJobbolJobs(card().replace('class="card-logo"', 'class="other"'))
      .invalid,
  ).toBe(1);
  expect(
    parseJobbolJobs(
      card().replaceAll('/vaga/29387162593', 'https://evil.example/vaga/1'),
    ).items,
  ).toEqual([]);
});
it('recognizes explicit remote and hybrid labels', () => {
  expect(
    parseJobbolJobs(card('1', 'Brasil', 'Suporte Home-Office')).items[0]
      .workModel,
  ).toBe('remoto');
  expect(
    parseJobbolJobs(card('2', 'São Paulo / SP', 'Suporte híbrido')).items[0]
      .workModel,
  ).toBe('hibrido');
});
it('distinguishes empty results from a challenge or changed layout', () => {
  expect(parseJobbolJobs('<p>Nenhuma vaga encontrada.</p>').recognized).toBe(
    true,
  );
  expect(parseJobbolJobs('<title>Just a moment...</title>').recognized).toBe(
    false,
  );
});
it('sends the profile city and resolves full state names without hardcoding Uberlândia', () => {
  const u = new URL(
    jobbolSearchUrl({
      q: 'suporte & redes',
      profileLocation: 'Uberlândia, Minas Gerais',
      workModels: ['presencial'],
    }),
  );
  expect(u.searchParams.get('cargo')).toBe('suporte & redes');
  expect(u.searchParams.get('cidade')).toBe('Uberlândia');
  expect(u.searchParams.get('estado')).toBe('MG');
  expect(
    new URL(
      jobbolSearchUrl({ profileLocation: 'Recife / PE' }),
    ).searchParams.get('cidade'),
  ).toBe('Recife');
  expect(
    new URL(jobbolSearchUrl({ profileLocation: 'Brasil' })).searchParams.has(
      'cidade',
    ),
  ).toBe(false);
});
it('searches remote opportunities without restricting them to the headquarters city', () => {
  const u = new URL(
    jobbolSearchUrl({
      q: 'suporte',
      profileLocation: 'Uberlândia, MG',
      workModels: ['remoto'],
    }),
  );
  expect(u.searchParams.get('regime')).toBe('Home Office');
  expect(u.searchParams.has('cidade')).toBe(false);
});
it('keeps strict local eligibility for explicitly onsite jobs', () => {
  const j = parseJobbolJobs(card('1', 'São Paulo / SP', 'Suporte presencial'))
    .items[0];
  expect(
    matches(
      j,
      { ...defaultJobPreferences, workModels: ['presencial'] },
      new Date(),
      'Uberlândia, MG',
    ),
  ).toBe(false);
});
it('reads only literal public loader parameters without executing scripts', () => {
  const u = new URL(jobbolCardsUrl(loader)!);
  expect(u.pathname).toBe('/elementos/cards.php');
  expect(u.searchParams.get('cidade')).toBe('Uberlândia');
  expect(
    jobbolCardsUrl(
      loader.replace(
        "t: '277156fb18d970ba18baf52bebea4689'",
        't: stealCookies()',
      ),
    ),
  ).toBeNull();
});
it('loads public JSON card fragments and validates their type', async () => {
  jest.mocked(fetchPublicPage).mockResolvedValue(page(loader));
  jest.mocked(fetchPublicJson).mockResolvedValue([card(), advertisement]);
  expect(await new JobbolSource().fetch({ q: 'fiscal' })).toHaveLength(1);
  jest.mocked(fetchPublicJson).mockResolvedValue({ error: 'changed' });
  await expect(new JobbolSource().fetch({})).rejects.toThrow('Formato');
});
it('preserves already loaded jobs when a subsequent page fails', async () => {
  jest
    .mocked(fetchPublicPage)
    .mockResolvedValueOnce(page(card() + '<a href="/busca?pagina=2">2</a>'))
    .mockRejectedValueOnce(new Error('403'));
  const source = new JobbolSource();
  expect(await source.fetch({})).toHaveLength(1);
  expect(source.issues.join()).toContain('bloqueou');
});
it('reports access blocks instead of silently returning zero vacancies', async () => {
  jest
    .mocked(fetchPublicPage)
    .mockRejectedValue(new Error('A página respondeu 403.'));
  await expect(new JobbolSource().fetch({})).rejects.toThrow(
    'bloqueou a consulta automática',
  );
});
it('bounds pagination and marks limited coverage', async () => {
  for (let i = 1; i <= 3; i++)
    jest
      .mocked(fetchPublicPage)
      .mockResolvedValueOnce(
        page(card(String(i)) + `<a href="/busca?pagina=${i + 1}">${i + 1}</a>`),
      );
  const source = new JobbolSource();
  expect(await source.fetch({})).toHaveLength(3);
  expect(fetchPublicPage).toHaveBeenCalledTimes(3);
  expect(source.issues.join()).toContain('primeiras 3 páginas');
});
