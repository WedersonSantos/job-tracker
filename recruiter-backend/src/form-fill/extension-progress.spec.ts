import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { chromium, type Browser, type Page } from 'playwright-core';
import { APPLICATION_ACTION_LABEL } from './application-navigation';
import { serializePlan } from './native-chrome.service';
import { buildFieldPlan } from './field-plan';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
jest.setTimeout(20000);
const root = join(process.cwd(), '..', 'chrome-extension');
type Listener = (
  message: Record<string, unknown>,
  sender: unknown,
  reply: (value: unknown) => void,
) => void;
type State = {
  active: boolean;
  running: boolean;
  message: string;
  formSteps: number;
};
async function harness(
  page: Page,
  presentation = false,
  presentationBehavior: 'ready' | 'pending' | 'error' = 'ready',
) {
  const sources = await Promise.all(
    ['navigation.js', 'fill.js', 'presentation.js', 'background.js'].map((f) =>
      readFile(join(root, f), 'utf8'),
    ),
  );
  const documentCode = sources
    .slice(0, 3)
    .map((s) => s.replace('export ', ''))
    .join('\n');
  const code = documentCode + '\n' + sources[3].replace(/^import .*$/gm, '');
  let presentationCalls = 0;
  const presentationResponse = () => {
    presentationCalls++;
    if (presentationBehavior === 'error')
      return { status: 'error', message: 'Configure a API de IA.' };
    if (presentationBehavior === 'pending' || presentationCalls === 1)
      return { status: 'pending' };
    return {
      status: 'ready',
      text: 'Atuo com suporte técnico e posso contribuir com o atendimento da Empresa A.',
    };
  };
  const stored: Record<string, unknown> = {};
  const injected: number[] = [];
  let worker: {
    listener: Listener;
    updated: (tab: number, change: unknown) => void;
  };
  const payload = {
    presentation: { enabled: presentation },
    navigation: { apply: APPLICATION_ACTION_LABEL.source, maxSteps: 4 },
    fields: serializePlan([
      {
        what: 'nome completo',
        value: 'Pessoa Teste',
        labels: /^Nome completo$/i,
        names: /^name$/i,
      },
      { what: 'email', value: 'test@example.com', labels: /^Email$/i },
      {
        what: 'nível de inglês',
        value: 'Intermediário',
        labels: /^Qual o seu nível de inglês\?$/i,
      },
      { what: 'telefone', value: '34999990000', labels: /^Telefone$/i },
      ...buildFieldPlan({
        name: 'Pessoa',
        email: null,
        phone: null,
        location: null,
        links: null,
        resume: null,
        defaults: {
          fullName: null,
          experienceSummary: null,
          lastSalary: '3500',
          salaryExpectation: '5000',
        },
      }).filter((field) =>
        ['último salário', 'pretensão salarial'].includes(field.what),
      ),
    ]),
    blocked: 'carta|cover letter',
    facts: { skills: [] },
    attachment: null,
  };
  await page.exposeFunction(
    'notifyJobTracker',
    (message: Record<string, unknown>) =>
      worker?.listener(
        message,
        { id: 'progress-test', tab: { id: 1 } },
        () => {},
      ),
  );
  await page.context().addInitScript(() => {
    const w = window as unknown as {
      chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };
      notifyJobTracker: (m: unknown) => Promise<unknown>;
    };
    w.chrome = w.chrome ?? {
      runtime: { sendMessage: () => Promise.resolve(null) },
    };
    w.chrome.runtime = { sendMessage: (m) => w.notifyJobTracker(m) };
  });
  function boot() {
    const current = {
      listener: undefined as unknown as Listener,
      updated: () => {},
    } as {
      listener: Listener;
      updated: (tab: number, change: unknown) => void;
    };
    const chrome = {
      storage: {
        session: {
          get: (k: string) =>
            Promise.resolve(
              k in stored
                ? { [k]: JSON.parse(JSON.stringify(stored[k])) as unknown }
                : {},
            ),
          set: (values: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(values))
              stored[k] = JSON.parse(JSON.stringify(v)) as unknown;
            return Promise.resolve();
          },
          remove: (k: string) => {
            delete stored[k];
            return Promise.resolve();
          },
        },
      },
      runtime: {
        id: 'progress-test',
        onMessage: {
          addListener: (fn: Listener) => {
            current.listener = fn;
          },
        },
      },
      tabs: {
        get: () =>
          Promise.resolve({ id: 1, url: page.url(), status: 'complete' }),
        update: async (_id: number, options: { url?: string }) => {
          if (options.url) await page.goto(options.url);
        },
        onUpdated: {
          addListener: (fn: typeof current.updated) => {
            current.updated = fn;
          },
        },
        onCreated: { addListener: () => {}, removeListener: () => {} },
        onRemoved: { addListener: () => {} },
      },
      action: { setBadgeText: async () => {} },
      scripting: {
        executeScript: async (options: {
          target: { tabId: number };
          func: (...a: unknown[]) => unknown;
          args: unknown[];
        }) => {
          injected.push(options.target.tabId);
          await page.addScriptTag({ content: documentCode });
          const result: unknown = await page.evaluate(
            ({ name, args }) =>
              (
                window as unknown as Record<
                  string,
                  (...a: unknown[]) => unknown
                >
              )[name](...args),
            { name: options.func.name, args: options.args },
          );
          return [{ result }];
        },
      },
    };
    runInNewContext(code, {
      chrome,
      fetch: (url: string) =>
        url.endsWith('/presentation')
          ? Promise.resolve({
              ok: true,
              json: () => Promise.resolve(presentationResponse()),
            })
          : Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }),
      URL,
      AbortSignal,
      setTimeout,
      Map,
      Set,
      Date,
      console,
    });
    worker = current;
    return current;
  }
  boot();
  const status = () =>
    new Promise<State>((resolve) =>
      worker.listener(
        { type: 'status', tabId: 1 },
        { id: 'progress-test' },
        (v) => resolve(v as State),
      ),
    );
  const until = async (predicate: (s: State) => boolean) => {
    for (let i = 0; i < 70; i++) {
      const s = await status();
      if (s && predicate(s)) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      'Unexpected workflow status: ' + JSON.stringify(await status()),
    );
  };
  return {
    presentationCalls: () => presentationCalls,
    start: () =>
      worker.listener(
        { type: 'start', tabId: 1, requestId: 'pending-test' },
        { id: 'progress-test' },
        () => {},
      ),
    status,
    until,
    stored,
    injected,
    boot,
    updated: (id: number) => worker.updated(id, { status: 'complete' }),
    stop: () =>
      new Promise((resolve) =>
        worker.listener(
          { type: 'stop', tabId: 1 },
          { id: 'progress-test' },
          resolve,
        ),
      ),
  };
}

it('follows both behavioral Start buttons and three tips, stopping at Começar a responder without opening the questions', async () => {
  const page = await browser.newPage();
  const app = await harness(page);
  try {
    await page.route('https://company.gupy.io/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<section><h2>Mapeamento Comportamental</h2><a href="https://assessments.gupy.io/behavioral/sample">Iniciar teste</a></section><section><h2>Teste técnico</h2><button onclick="window.wrongTest=true">Iniciar teste</button></section>',
      }),
    );
    await page.route('https://assessments.gupy.io/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<h1>Vamos mapear o seu perfil?</h1><button id="start">Iniciar teste</button><script>
      window.preparationClicks=0;
      const titles=['Encontre seu lugar calmo','A internet está okay?','Reserve 15 minutinhos','E agora, como vai funcionar?'];
      function tip(index){document.body.innerHTML='<h1>'+titles[index]+'</h1><p>Dica de preparação</p><button id="next">'+(index===3?'Começar a responder':'Próximo')+'</button>';document.querySelector('#next').onclick=()=>{if(index===3){window.openedQuestions=true;return;}window.preparationClicks++;tip(index+1);};}
      document.querySelector('#start').onclick=()=>{window.preparationClicks++;tip(0);};
      </script>`,
      }),
    );
    await page.goto('https://company.gupy.io/candidates/applications/123');
    app.start();
    const state = await app.until((s) => !s.active && !s.running);
    expect(state.message).toContain('Começar a responder');
    expect(page.url()).toBe('https://assessments.gupy.io/behavioral/sample');
    expect(
      await page
        .getByRole('button', { name: 'Começar a responder', exact: true })
        .isVisible(),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { preparationClicks: number })
            .preparationClicks,
      ),
    ).toBe(4);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { openedQuestions?: boolean }).openedQuestions,
      ),
    ).toBeUndefined();
  } finally {
    await page.close();
  }
});

it('does not fill or advance behavioral questions when the extension starts on the assessment itself', async () => {
  const page = await browser.newPage();
  const app = await harness(page);
  try {
    await page.route('https://assessments.gupy.io/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>Escolha os itens que você mais valoriza</h1><label><input type="checkbox">Colaboração</label><label>Nome completo<input name="name"></label><button onclick="window.advanced=true">Próximo</button>',
      }),
    );
    await page.goto('https://assessments.gupy.io/behavioral/sample');
    app.start();
    await app.until((s) => !s.active && !s.running);
    expect(await page.locator('input[type=checkbox]').isChecked()).toBe(false);
    expect(await page.locator('input[name=name]').inputValue()).toBe('');
    expect(
      await page.evaluate(
        () => (window as unknown as { advanced?: boolean }).advanced,
      ),
    ).toBeUndefined();
  } finally {
    await page.close();
  }
});

it('generates once through polling, fills the optional Gupy presentation and stops before final submission', async () => {
  const page = await browser.newPage();
  const app = await harness(page, true);
  try {
    await page.route('https://company.gupy.io/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>Apresente-se!</h1><p>A empresa deseja saber mais sobre você.</p><textarea id="personalization-step-text-area" maxlength="1500"></textarea><button onclick="window.sent=true">Finalizar candidatura</button>',
      }),
    );
    await page.goto(
      'https://company.gupy.io/candidates/applications/123/curriculum',
    );
    app.start();
    const state = await app.until((s) => !s.active && !s.running);
    expect(state.message).toContain('apresentação personalizada');
    expect(
      await page.locator('#personalization-step-text-area').inputValue(),
    ).toContain('Empresa A');
    expect(app.presentationCalls()).toBe(2);
    expect(
      await page.evaluate(() => (window as unknown as { sent?: boolean }).sent),
    ).toBeUndefined();
    expect(JSON.stringify(app.stored)).not.toContain(
      'Atuo com suporte técnico',
    );
  } finally {
    await page.close();
  }
});

it.each(['manual edit', 'stop', 'error'])(
  'preserves user control while the presentation is generated: %s',
  async (action) => {
    const page = await browser.newPage();
    const app = await harness(
      page,
      true,
      action === 'error' ? 'error' : 'pending',
    );
    try {
      await page.route('https://company.gupy.io/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<h1>Apresente-se!</h1><textarea id="personalization-step-text-area" maxlength="1500"></textarea><button onclick="window.sent=true">Finalizar candidatura</button>',
        }),
      );
      await page.goto(
        'https://company.gupy.io/candidates/applications/123/curriculum',
      );
      app.start();
      await app.until(() => app.presentationCalls() > 0);
      if (action === 'manual edit')
        await page
          .locator('#personalization-step-text-area')
          .fill('Minha apresentação revisada');
      if (action === 'stop') await app.stop();
      const state = await app.until((s) => !s.active && !s.running);
      if (action === 'error')
        expect(state.message).toContain('Configure a API');
      expect(
        await page.locator('#personalization-step-text-area').inputValue(),
      ).toBe(action === 'manual edit' ? 'Minha apresentação revisada' : '');
      expect(
        await page.evaluate(
          () => (window as unknown as { sent?: boolean }).sent,
        ),
      ).toBeUndefined();
    } finally {
      await page.close();
    }
  },
);

it('continues from the Gupy welcome screen without inputs, fills the following form at the same URL and stops before submitting', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const app = await harness(page);
  try {
    await context.route('https://carreirasomie.gupy.io/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<form><h1>Olá Carlos, vamos continuar sua candidatura!</h1><p>Você está se candidatando para a vaga Desenvolvedor(a) Back End I.</p><button>Continuar</button></form>',
      }),
    );
    await page.goto(
      'https://carreirasomie.gupy.io/candidates/applications/900000001/steps/900000002/curriculum',
    );
    await page.evaluate(() => {
      document.querySelector('form')!.addEventListener('submit', (event) => {
        event.preventDefault();
        (window as unknown as { continued: number }).continued =
          ((window as unknown as { continued?: number }).continued ?? 0) + 1;
        document.body.innerHTML =
          '<form onsubmit="window.sent=true;return false"><h1>Dados do currículo</h1><label>Nome completo<input name="name" required></label><label>Email<input type="email" required></label><button>Enviar</button></form>';
      });
    });
    app.start();
    await app.until(
      (state) =>
        !state.active &&
        !state.running &&
        state.message.includes('etapa final'),
    );
    expect(await page.locator('[name=name]').inputValue()).toBe('Pessoa Teste');
    expect(await page.locator('[type=email]').inputValue()).toBe(
      'test@example.com',
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { continued: number }).continued,
      ),
    ).toBe(1);
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await app.stop();
    await context.close();
  }
});
it.each([
  [
    'https://example.com/candidates/applications/900000001/steps/900000002/curriculum',
    'Olá Carlos, vamos continuar sua candidatura!',
  ],
  [
    'https://carreirasomie.gupy.io/jobs/123',
    'Olá Carlos, vamos continuar sua candidatura!',
  ],
  [
    'https://carreirasomie.gupy.io/candidates/applications/900000001/steps/900000002/curriculum',
    'Revise antes de enviar sua candidatura',
  ],
])(
  'does not reinterpret an unrelated Continue screen as the Gupy welcome step: %s',
  async (url, title) => {
    const page = await browser.newPage();
    try {
      await page.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<h1>${title}</h1><button type="button" onclick="window.clicked=true">Continuar</button>`,
        }),
      );
      await page.goto(url);
      await page.addScriptTag({
        content: (await readFile(join(root, 'navigation.js'), 'utf8')).replace(
          'export ',
          '',
        ),
      });
      const kind = await page.evaluate(
        (apply) =>
          (
            window as unknown as {
              inspectApplicationDocument: (n: unknown) => { kind: string };
            }
          ).inspectApplicationDocument({ apply }).kind,
        APPLICATION_ACTION_LABEL.source,
      );
      expect(kind).toBe('waiting');
      expect(await page.evaluate(() => Object.hasOwn(window, 'clicked'))).toBe(
        false,
      );
    } finally {
      await page.close();
    }
  },
);
it('continues through same-URL Google Forms steps, pauses for an unknown required answer, and resumes after a manual advance without reactivation', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const app = await harness(page);
  try {
    await context.route('https://docs.google.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<form action="https://docs.google.com/forms/d/e/test/formResponse" onsubmit="window.sent=true;return false"><div id="stage"></div></form><script>
  window.showStep=n=>{window.stageNumber=n;const steps={
  1:'<h2>Dados pessoais</h2><p>Página 1 de 4</p><label>Nome completo<input name="name" required></label><label>Email<input type="email" required></label><button type="button" onclick="showStep(2)">Continuar</button>',
  2:'<h2>Idiomas</h2><p>Página 2 de 4</p><label>Qual o seu nível de inglês?<input name="english" required></label><button type="button" onclick="showStep(3)">Avançar</button>',
  3:'<h2>Resposta específica</h2><p>Página 3 de 4</p><label>Experiência exigida nesta vaga<textarea id="experience" required></textarea></label><button id="next" type="button" onclick="showStep(4)">Próxima</button>',
  4:'<h2>Revisão final</h2><p>Página 4 de 4</p><label>Telefone<input id="phone" required></label><button>Enviar</button>'};document.querySelector('#stage').innerHTML=steps[n]};showStep(1);</script>`,
      }),
    );
    await page.goto('https://docs.google.com/forms/d/e/test/viewform');
    app.start();
    const paused = await app.until(
      (s) => s.active && !s.running && s.message.includes('obrigatórias'),
    );
    expect(paused.formSteps).toBe(2);
    expect(await page.locator('#experience').inputValue()).toBe('');
    expect(JSON.stringify(app.stored)).not.toContain('test@example.com');
    expect(JSON.stringify(app.stored)).not.toContain('Pessoa Teste');
    await page
      .locator('#experience')
      .fill('Resposta específica escrita pela pessoa.');
    await page.locator('#next').click();
    const finished = await app.until(
      (s) => !s.active && !s.running && s.message.includes('etapa final'),
    );
    expect(finished.formSteps).toBe(2);
    expect(await page.locator('#phone').inputValue()).toBe('34999990000');
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await app.stop();
    await context.close();
  }
});

it('restores an authorized job after worker restart and a full page navigation, ignoring unrelated tabs', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const app = await harness(page);
  try {
    await context.route('https://company.example.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body:
          new URL(route.request().url()).pathname === '/start'
            ? '<form><label>Nome completo<input name="name" required></label><label>Email<input type="email" required></label><label>Resposta manual<textarea required></textarea></label><button type="button">Continuar</button></form>'
            : '<form onsubmit="window.sent=true;return false"><label>Telefone<input id="phone" required></label><button>Enviar candidatura</button></form>',
      }),
    );
    await page.goto('https://company.example.com/start');
    app.start();
    await app.until(
      (s) => s.active && !s.running && s.message.includes('obrigatórias'),
    );
    app.boot();
    await page.goto('https://company.example.com/final');
    app.updated(99);
    await new Promise((r) => setTimeout(r, 100));
    expect(await page.locator('#phone').inputValue()).toBe('');
    app.updated(1);
    await app.until(
      (s) => !s.active && !s.running && s.message.includes('etapa final'),
    );
    expect(await page.locator('#phone').inputValue()).toBe('34999990000');
    expect(app.injected.every((id) => id === 1)).toBe(true);
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await app.stop();
    await context.close();
  }
});

it('retries configured salary answers once when Gupy redraws and clears them before validation', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const app = await harness(page);
  try {
    await context.route('https://grupoboticario.gupy.io/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<textarea id="last" name="Qual a sua última / atual remuneração?" aria-required="true" oninput="if(!this.dataset.redrawn){this.dataset.redrawn=\'yes\';setTimeout(()=>this.value=\'\',30)}"></textarea><textarea id="expected" name="Qual a sua expectativa salarial?" aria-required="true" oninput="if(!this.dataset.redrawn){this.dataset.redrawn=\'yes\';setTimeout(()=>this.value=\'\',30)}"></textarea><button type="button" onclick="window.sent=true">Finalizar candidatura</button>',
      }),
    );
    await page.goto(
      'https://grupoboticario.gupy.io/candidates/applications/test/steps/test/curriculum',
    );
    app.start();
    await app.until(
      (state) =>
        !state.active &&
        !state.running &&
        state.message.includes('etapa final'),
    );
    expect(await page.locator('#last').inputValue()).toBe('3500');
    expect(await page.locator('#expected').inputValue()).toBe('5000');
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await app.stop();
    await context.close();
  }
});
it('stops the session and does not resume it when the user changes pages', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const app = await harness(page);
  try {
    await context.route('https://company.example.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<form><label>Nome completo<input name="name" required></label><label>Email<input type="email" required></label><label>Resposta manual<textarea required></textarea></label><button type="button">Continuar</button></form>',
      }),
    );
    await page.goto('https://company.example.com/start');
    app.start();
    await app.until(
      (s) => s.active && !s.running && s.message.includes('obrigatórias'),
    );
    await app.stop();
    app.boot();
    await page.reload();
    app.updated(1);
    await new Promise((r) => setTimeout(r, 300));
    expect((await app.status()).active).toBe(false);
    expect(await page.locator('[name=name]').inputValue()).toBe('');
  } finally {
    await app.stop();
    await context.close();
  }
});

it('does not continue with invalid fields, unchecked required consent, an ambiguous submit button, or on the last step', async () => {
  const page = await browser.newPage();
  try {
    const source = (
      await readFile(join(root, 'navigation.js'), 'utf8')
    ).replace('export ', '');
    const inspect = async () =>
      page.evaluate(
        (n) =>
          (
            window as unknown as {
              inspectApplicationDocument: (
                n: unknown,
                key: null,
                phase: string,
              ) => { kind: string };
            }
          ).inspectApplicationDocument(n, null, 'progress'),
        { apply: APPLICATION_ACTION_LABEL.source },
      );
    await page.setContent(
      '<form><label>Email<input type="email" value="inválido" required></label><label>Consentimento<input id="consent" type="checkbox" required></label><button type="button" onclick="window.advanced=true">Continuar</button></form>',
    );
    await page.addScriptTag({ content: source });
    expect((await inspect()).kind).toBe('review');
    await page.locator('input[type=email]').fill('test@example.com');
    expect((await inspect()).kind).toBe('review');
    await page.locator('#consent').check();
    expect((await inspect()).kind).toBe('next');
    await page.setContent(
      '<p>Etapa 2 de 2</p><form><button type="button" onclick="window.sent=true">Continuar</button></form>',
    );
    await page.addScriptTag({ content: source });
    expect((await inspect()).kind).toBe('final');
    await page.setContent(
      '<form><button onclick="window.sent=true">Continuar</button></form>',
    );
    await page.addScriptTag({ content: source });
    expect((await inspect()).kind).toBe('review');
    expect(
      await page.evaluate(
        () =>
          Object.hasOwn(window, 'sent') || Object.hasOwn(window, 'advanced'),
      ),
    ).toBe(false);
  } finally {
    await page.close();
  }
});
