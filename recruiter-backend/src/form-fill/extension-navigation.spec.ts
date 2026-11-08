import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { chromium, type Browser } from 'playwright-core';
import { APPLICATION_ACTION_LABEL } from './application-navigation';
import { serializePlan } from './native-chrome.service';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
const root = join(process.cwd(), '..', 'chrome-extension');
const navigation = { apply: APPLICATION_ACTION_LABEL.source, maxSteps: 4 };
jest.setTimeout(15000);

it('the extension follows an Indeed redirect and a second company apply link, then fills without submitting', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await context.route('https://br.indeed.com/**', (route) =>
      new URL(route.request().url()).pathname === '/applystart'
        ? route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: "<script>location.replace('https://company.example.com/careers')</script>",
          })
        : route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<div data-testid="primary-apply-action"><a href="https://br.indeed.com/applystart?jk=test" target="_blank"><div>Candidatar-se no site da empresa</div></a></div>',
          }),
    );
    await context.route('https://company.example.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body:
          new URL(route.request().url()).pathname === '/careers'
            ? '<a href="/application">Candidatar-se ao cargo</a>'
            : '<form onsubmit="window.sent=true;return false"><label>Nome completo<input name="name"></label><label>E-mail<input type="email"></label><button>Candidatar-se</button></form>',
      }),
    );
    await page.goto('https://br.indeed.com/viewjob?jk=test');
    const plan = {
      navigation,
      fields: serializePlan([
        {
          what: 'nome completo',
          value: 'Carlos Silva',
          labels: /^nome completo$/i,
        },
      ]),
      blocked: 'carta|cover letter',
      attachment: null,
    };
    const inspectCode = await readFile(join(root, 'navigation.js'), 'utf8');
    const fillCode = await readFile(join(root, 'fill.js'), 'utf8');
    const background = await readFile(join(root, 'background.js'), 'utf8');
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          reply: (v: unknown) => void,
        ) => void)
      | undefined;
    let finished = false;
    const urls: string[] = [];
    const chrome = {
      runtime: {
        id: 'test-extension',
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn;
          },
        },
      },
      tabs: {
        get: () =>
          Promise.resolve({ id: 1, url: page.url(), status: 'complete' }),
        update: async (_id: number, options: { url: string }) => {
          urls.push(options.url);
          await page.goto(options.url);
        },
        onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
      },
      scripting: {
        executeScript: async (options: {
          func: (...args: unknown[]) => unknown;
          args: unknown[];
        }) => {
          await page.addScriptTag({
            content:
              inspectCode.replace('export ', '') +
              '\n' +
              fillCode.replace('export ', ''),
          });
          const result: unknown = await page.evaluate(
            ({ name, args }) => {
              const functions = window as unknown as Record<
                string,
                (...a: unknown[]) => unknown
              >;
              return functions[name](...args);
            },
            { name: options.func.name, args: options.args },
          );
          return [{ result }];
        },
      },
      action: {
        setBadgeText: () => {
          finished = true;
          return Promise.resolve();
        },
      },
    };
    runInNewContext(
      inspectCode.replace('export ', '') +
        '\n' +
        fillCode.replace('export ', '') +
        '\n' +
        background.replace(/^import .*$/gm, ''),
      {
        chrome,
        fetch: () =>
          Promise.resolve({ ok: true, json: () => Promise.resolve(plan) }),
        URL,
        AbortSignal,
        setTimeout,
        Map,
        Set,
        Date,
        console,
      },
    );
    listener!(
      { type: 'start', tabId: 1, requestId: 'test' },
      { id: 'test-extension' },
      () => {},
    );
    for (let i = 0; i < 60 && !finished; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    let state: unknown;
    listener!(
      { type: 'status', tabId: 1 },
      { id: 'test-extension' },
      (value) => {
        state = value;
      },
    );
    expect(state).toMatchObject({
      running: false,
    });
    expect((state as { message: string }).message).toContain('Preenchido');
    expect(finished).toBe(true);
    expect(urls).toEqual([
      'https://br.indeed.com/applystart?jk=test',
      'https://company.example.com/application',
    ]);
    expect(await page.locator('[name=name]').inputValue()).toBe(
      'Carlos Silva',
    );
    expect(await page.evaluate(() => Object.hasOwn(window, 'sent'))).toBe(
      false,
    );
  } finally {
    await context.close();
  }
});
it('the extension ignores final submit buttons and treats a candidate form as the destination', async () => {
  const page = await browser.newPage();
  try {
    const code = await readFile(join(root, 'navigation.js'), 'utf8');
    await page.setContent(
      '<form><label>Nome completo<input name="name"></label><label>E-mail<input type="email"></label><button>Candidatar-se no site da empresa</button></form>',
    );
    await page.addScriptTag({
      content: code.replace('export ', ''),
    });
    const result: unknown = await page.evaluate(
      (n) =>
        (
          window as unknown as {
            inspectApplicationDocument: (n: unknown) => unknown;
          }
        ).inspectApplicationDocument(n),
      navigation,
    );
    expect(result).toEqual({ kind: 'form' });
    await page.setContent(
      '<form><button>Candidatar-se no site da empresa</button></form><button type="submit">Candidatar-se</button>',
    );
    await page.addScriptTag({
      content: code.replace('export ', ''),
    });
    const withoutForm: unknown = await page.evaluate(
      (n) =>
        (
          window as unknown as {
            inspectApplicationDocument: (n: unknown) => unknown;
          }
        ).inspectApplicationDocument(n),
      navigation,
    );
    expect(withoutForm).toEqual({ kind: 'waiting' });
  } finally {
    await page.close();
  }
});
