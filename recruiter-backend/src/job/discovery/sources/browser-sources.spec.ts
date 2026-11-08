import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import { BrowserPortalSource, BrowserBoardSource } from './browser-sources';
import type { BrowserSearchService } from '../browser-search.service';
import { fetchPublicJson } from '../../safe-fetch';
jest.mock('../../safe-fetch', () => ({ fetchPublicJson: jest.fn() }));
jest.mock('../ashby-department', () => ({
  loadDepartmentNames: jest
    .fn()
    .mockResolvedValue(new Set(['Technical Support'])),
}));

// Real browser interactions, with controlled local responses. No live jobs or applications are changed.
let browser: Browser;
let context: BrowserContext;
let lastUrl = '';
const runner = {
  run: async <T>(fn: (p: Page) => Promise<T>) => {
    const page = await context.newPage();
    page.setDefaultTimeout(3_000);
    try {
      return await fn(page);
    } finally {
      lastUrl = page.url();
      await page.close();
    }
  },
} as BrowserSearchService;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
beforeEach(async () => {
  context = await browser.newContext();
  jest.clearAllMocks();
});
afterEach(async () => {
  await context.close();
});
afterAll(async () => {
  await browser.close();
});
jest.setTimeout(30_000);

const jobbolCard = (id: string) =>
  `<div class="card-vaga"><p class="card-data">29/10/2026</p><img class="card-logo" alt="Empresa de TI"><a href="/vaga/${id}"><h3>Suporte Pleno</h3></a><span class="card-cidade">Uberlândia / MG</span><span class="card-resumo">Suporte de TI</span></div>`;
async function jobbolFixture() {
  await context.route('https://www.jobbol.com.br/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/buscar-vagas')
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<form action="/busca"><input id="cargo" name="cargo" required><input id="local" required><input type="hidden" id="cidade" name="cidade" value="São Paulo"><input type="hidden" id="estado" name="estado" value="SP"><ul id="lista-cidades"></ul><button>BUSCAR</button></form><script>local.oninput=()=>{cidade.value='';estado.value='';document.querySelector('#lista-cidades').innerHTML='<li>Uberlândia / MG</li>';document.querySelector('li').onclick=()=>{cidade.value='Uberlândia';estado.value='MG';local.value='Uberlândia / MG';document.querySelector('li').remove()}}</script>`,
      });
    const p = Number(u.searchParams.get('pagina') ?? '1');
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<form action="/busca"><input name="cargo" value="${u.searchParams.get('cargo')}"><input name="cidade" value="${u.searchParams.get('cidade')}"><input name="estado" value="${u.searchParams.get('estado')}"><select id="regime" name="regime"><option value="">Todos</option><option value="Home Office">Home-Office</option><option value="Hibrid">Híbrida</option></select><button>FILTRAR</button></form><div id="lista-vagas">${jobbolCard(String(p))}</div>${p === 1 ? '<a href="/busca?pagina=2">2</a>' : ''}`,
    });
  });
}
it('clicks the Jobbol city suggestion, submits cargo and visits the next page', async () => {
  await jobbolFixture();
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  const source = new BrowserPortalSource('jobbol', runner);
  const jobs = await source.fetch({
    q: 'suporte',
    profileLocation: 'Uberlândia, Minas Gerais',
    workModels: ['presencial'],
  });
  expect(jobs).toHaveLength(2);
  const search = requests.find((u) => u.includes('cargo=suporte'))!;
  expect(new URL(search).searchParams.get('cidade')).toBe('Uberlândia');
  // A city filter alone does not prove an onsite work model.
  expect(jobs[0].workModel).toBeNull();
});
it('selects Home Office through the UI and clears the default city for remote search', async () => {
  await jobbolFixture();
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  const jobs = await new BrowserPortalSource('jobbol', runner).fetch({
    q: 'suporte',
    workModels: ['remoto'],
    profileLocation: 'Uberlândia, MG',
  });
  const filtered = requests.find(
    (u) => new URL(u).searchParams.get('regime') === 'Home Office',
  )!;
  expect(filtered).toBeDefined();
  expect(new URL(filtered).searchParams.get('cidade')).toBe('');
  expect(jobs[0].workModel).toBe('remoto');
});
it('does not click a CAPTCHA or import a challenge page', async () => {
  await context.route('**/*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'text/html; charset=utf-8',
      body: '<title>Just a moment...</title>',
    }),
  );
  await expect(
    new BrowserPortalSource('jobbol', runner).fetch({ q: 'suporte' }),
  ).rejects.toThrow('verificação');
});

const solutisId = 'b86285ac-b49b-4463-bca4-c06eefca4771';
it('fills Solutis search and clicks its remote option before collecting visible postings', async () => {
  const actions: string[] = [];
  await context.exposeFunction('recordAction', (a: string) => actions.push(a));
  await context.route('https://api.inhire.app/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        tenantName: 'Solutis',
        jobsPage: [
          {
            jobId: solutisId,
            displayName: 'Suporte',
            status: 'published',
            workplaceType: 'Remote',
            location: 'BR',
          },
          {
            jobId: 'c86285ac-b49b-4463-bca4-c06eefca4771',
            displayName: 'Outro',
            status: 'published',
            workplaceType: 'On-site',
            location: 'São Paulo, SP, BR',
          },
        ],
      }),
    }),
  );
  await context.route('https://solutis.inhire.app/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<input id="name"><div aria-label="Dropdown select" tabindex="0">Modelo</div><div aria-label="Dropdown select">Local</div><button role="option" aria-label="Remoto">Remoto</button><div id="jobs"></div><script>fetch('https://api.inhire.app/job-posts/public/pages');nameField=document.querySelector('#name');nameField.oninput=()=>recordAction('query:'+nameField.value);document.querySelector('[role=option]').onclick=()=>{recordAction('remote');document.querySelector('#jobs').innerHTML='<a data-component-name="job-position-link" href="/vagas/${solutisId}/suporte">Suporte</a>'}</script>`,
    }),
  );
  const jobs = await new BrowserPortalSource('solutis-inhire', runner).fetch({
    q: 'Suporte',
    workModels: ['remoto'],
  });
  expect(actions).toEqual(['query:Suporte', 'remote']);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].workModel).toBe('remoto');
});
it('clicks Vaga and Pleno and types the search in Uberlândia Inovadora', async () => {
  const actions: string[] = [];
  await context.exposeFunction('recordAction', (a: string) => actions.push(a));
  await context.route('https://uberlandiainovadora.com.br/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<button onclick="this.className='bg-primary ';recordAction('vaga')">🦜 Vaga</button><button onclick="recordAction('pleno')">Pleno · 1 anúncio</button><input placeholder="Buscar por cargo, empresa ou stack" oninput="recordAction('query:'+this.value)"><a class="bg-card" href="https://example.com/job"><h3 class="line-clamp-2">Suporte Pleno</h3><span class="truncate">Empresa</span><span class="rounded-full">Vaga</span><span class="rounded-full">Pleno</span><p>TI</p><p>Presencial em Uberlândia, MG</p></a>`,
    }),
  );
  const jobs = await new BrowserPortalSource(
    'uberlandia-inovadora',
    runner,
  ).fetch({ q: 'suporte', seniorities: ['pleno'] });
  expect(actions).toEqual(['vaga', 'query:suporte', 'pleno']);
  expect(jobs).toHaveLength(1);
});
it('selects Ashby department and remote filters; excludes nonvisible API postings', async () => {
  const actions: string[] = [];
  await context.exposeFunction('recordAction', (a: string) => actions.push(a));
  await context.route('https://jobs.ashbyhq.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<select aria-label="Department" onchange="recordAction(this.value)"><option>All</option><option value="${solutisId}">Technical Support</option></select><select aria-label="Location Type" onchange="recordAction(this.value)"><option>All</option><option value="remote">Remote (1)</option></select><a href="https://jobs.ashbyhq.com/example/1">Suporte</a>`,
    }),
  );
  jest.mocked(fetchPublicJson).mockResolvedValue({
    jobs: [
      {
        title: 'Suporte',
        jobUrl: 'https://jobs.ashbyhq.com/example/1',
        department: 'Technical Support',
      },
      { title: 'Other', jobUrl: 'https://jobs.ashbyhq.com/example/2' },
    ],
  });
  const source = new BrowserBoardSource(
    'ashby',
    [`https://jobs.ashbyhq.com/example?ashby_department_id=${solutisId}`],
    runner,
  );
  expect(await source.fetch({ workModels: ['remoto'] })).toHaveLength(1);
  expect(actions).toEqual([solutisId, 'remote']);
  expect(lastUrl).toContain('jobs.ashbyhq.com');
});
it('clicks Lever team and remote filters and keeps only visible jobs', async () => {
  const actions: string[] = [];
  await context.exposeFunction('recordAction', (a: string) => actions.push(a));
  await context.route('https://jobs.lever.co/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<div role="button" aria-label="Filter by Team: All">Team</div><a href="#" onclick="recordAction('team')">Technology</a><div role="button" aria-label="Filter by Location type: All">Model</div><a href="#" onclick="recordAction('remote')">Remote</a><a href="https://jobs.lever.co/example/1">Suporte</a>`,
    }),
  );
  jest.mocked(fetchPublicJson).mockResolvedValue([
    {
      text: 'Suporte',
      hostedUrl: 'https://jobs.lever.co/example/1',
      categories: { team: 'Technology' },
    },
    {
      text: 'Other',
      hostedUrl: 'https://jobs.lever.co/example/2',
      categories: { team: 'Technology' },
    },
  ]);
  const jobs = await new BrowserBoardSource(
    'lever',
    ['https://jobs.lever.co/example?team=Technology'],
    runner,
  ).fetch({ workModels: ['remoto'] });
  expect(actions).toEqual(['team', 'remote']);
  expect(jobs).toHaveLength(1);
});
