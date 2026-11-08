import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { chromium, type Browser } from 'playwright-core';
import { emptyResume } from '@recruit/shared';
import { serializePlan } from './native-chrome.service';
import { buildFieldPlan, NEVER_FILL } from './field-plan';
import { APPLICATION_ACTION_LABEL } from './application-navigation';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
jest.setTimeout(15000);

it('recognizes a later Google Forms section and fills ARIA-linked answers and CV skills without advancing or submitting', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await context.route('https://docs.google.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<form action="https://docs.google.com/forms/d/e/test/formResponse" onsubmit="window.sent=true;return false">
  <div role="listitem"><div id="tech" role="heading">Quais tecnologias você domina?</div>
    <div role="checkbox" aria-label="Windows" aria-checked="false" tabindex="0" onclick="this.setAttribute('aria-checked','true')">Windows</div>
    <div role="checkbox" aria-label="Wordpress" aria-checked="true">Wordpress</div>
    <div role="checkbox" aria-label="XML" aria-checked="false">XML</div>
  </div>
  <div role="listitem"><div id="other" role="heading">Quais outras tecnologias acha relevante mencionar?</div><input name="entry.100" aria-labelledby="other"></div>
  <div role="listitem"><div id="experience" role="heading">Conte sobre as experiências mencionadas nas duas últimas questões *</div><textarea name="entry.200" aria-labelledby="experience"></textarea></div>
  <div role="listitem"><div id="english" role="heading">Qual o seu nível de inglês? *</div><div id="help">Sua resposta</div><input name="entry.300" aria-labelledby="english help"></div>
  <button type="button" id="next" onclick="window.advanced=true">Avançar</button><button>Enviar</button></form>`,
      }),
    );
    await page.goto('https://docs.google.com/forms/d/e/test/viewform');
    const root = join(process.cwd(), '..', 'chrome-extension');
    for (const file of ['navigation.js', 'fill.js'])
      await page.addScriptTag({
        content: (await readFile(join(root, file), 'utf8')).replace(
          'export ',
          '',
        ),
      });
    const state: unknown = await page.evaluate(
      (n) =>
        (
          window as unknown as {
            inspectApplicationDocument: (n: unknown) => unknown;
          }
        ).inspectApplicationDocument(n),
      { apply: APPLICATION_ACTION_LABEL.source },
    );
    expect(state).toEqual({ kind: 'form', multiStep: true });
    const fields = serializePlan(
      buildFieldPlan({
        name: 'Carlos Silva',
        email: 'test@example.com',
        phone: null,
        location: null,
        links: null,
        resume: {
          ...emptyResume,
          skills: ['Windows'],
          languages: [{ name: 'Inglês', level: 'Intermediário' }],
        },
        defaults: {
          experienceSummary: 'Resumo geral do currículo',
          salaryExpectation: null,
          fullName: null,
        },
      }),
    );
    const report: unknown = await page.evaluate(
      (plan) =>
        (
          window as unknown as { fillCurrentDocument: (n: unknown) => unknown }
        ).fillCurrentDocument(plan),
      {
        fields,
        blocked: NEVER_FILL.source,
        facts: { skills: ['Windows'] },
        attachment: null,
      },
    );
    expect(await page.locator('[name="entry.300"]').inputValue()).toBe(
      'Intermediário',
    );
    expect(
      await page.locator('[aria-label="Windows"]').getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      await page
        .locator('[aria-label="Wordpress"]')
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      await page.locator('[aria-label="XML"]').getAttribute('aria-checked'),
    ).toBe('false');
    expect(await page.locator('textarea').inputValue()).toBe('');
    expect((report as { needsReview: string[] }).needsReview).toContain(
      'Conte sobre as experiências mencionadas nas duas últimas questões *',
    );
    expect(
      await page.evaluate(
        () =>
          Object.hasOwn(window, 'advanced') || Object.hasOwn(window, 'sent'),
      ),
    ).toBe(false);

    // Exercise the real background workflow too: this must finish on section 4,
    // rather than looping for 90 seconds looking for name/email from section 1.
    await page.locator('[name="entry.300"]').fill('');
    const inspectCode = (
      await readFile(join(root, 'navigation.js'), 'utf8')
    ).replace('export ', '');
    const fillCode = (await readFile(join(root, 'fill.js'), 'utf8')).replace(
      'export ',
      '',
    );
    const background = (
      await readFile(join(root, 'background.js'), 'utf8')
    ).replace(/^import .*$/gm, '');
    const payload = {
      fields,
      blocked: NEVER_FILL.source,
      facts: { skills: ['Windows'] },
      navigation: { apply: APPLICATION_ACTION_LABEL.source, maxSteps: 4 },
      attachment: null,
    };
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          reply: (value: unknown) => void,
        ) => void)
      | undefined;
    let done = false;
    const update = jest.fn();
    const chrome = {
      runtime: {
        id: 'google-test',
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn;
          },
        },
      },
      tabs: {
        get: () =>
          Promise.resolve({ id: 1, url: page.url(), status: 'complete' }),
        update,
      },
      action: {
        setBadgeText: () => {
          done = true;
          return Promise.resolve();
        },
      },
      scripting: {
        executeScript: async (options: {
          func: (...args: unknown[]) => unknown;
          args: unknown[];
        }) => {
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
    runInNewContext(inspectCode + '\n' + fillCode + '\n' + background, {
      chrome,
      fetch: () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }),
      URL,
      AbortSignal,
      setTimeout,
      Map,
      Set,
      Date,
      console,
    });
    listener!(
      { type: 'start', tabId: 1, requestId: 'test' },
      { id: 'google-test' },
      () => {},
    );
    for (let i = 0; i < 30 && !done; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(done).toBe(true);
    expect(update).not.toHaveBeenCalled();
    let status: unknown;
    listener!({ type: 'status', tabId: 1 }, { id: 'google-test' }, (value) => {
      status = value;
    });
    expect(status).toMatchObject({ running: false });
    expect((status as { message: string }).message).toContain(
      'respostas obrigatórias',
    );
    expect(await page.locator('[name="entry.300"]').inputValue()).toBe(
      'Intermediário',
    );
  } finally {
    await context.close();
  }
});

it('does not invent an English level and does not mark technologies in a negative question', async () => {
  const fields = buildFieldPlan({
    name: 'Carlos',
    email: null,
    phone: null,
    location: null,
    links: null,
    resume: emptyResume,
  });
  expect(fields.some((f) => f.what === 'nível de inglês')).toBe(false);
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<div role="listitem"><div role="heading">Quais tecnologias você NÃO conhece?</div><div role="checkbox" aria-label="XML" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')">XML</div></div>',
    );
    await page.addScriptTag({
      content: (
        await readFile(
          join(process.cwd(), '..', 'chrome-extension', 'fill.js'),
          'utf8',
        )
      ).replace('export ', ''),
    });
    await page.evaluate(
      (plan) =>
        (
          window as unknown as { fillCurrentDocument: (n: unknown) => unknown }
        ).fillCurrentDocument(plan),
      { fields: [], blocked: NEVER_FILL.source, facts: { skills: ['XML'] } },
    );
    expect(
      await page.locator('[role="checkbox"]').getAttribute('aria-checked'),
    ).toBe('false');
  } finally {
    await page.close();
  }
});
