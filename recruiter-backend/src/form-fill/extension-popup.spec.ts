import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser.close();
});
const API = 'http://127.0.0.1:3333';
const uuid = '00000000-0000-4000-8000-000000000001';
async function setup(
  options: {
    pending?: boolean;
    emptyProfiles?: boolean;
    allowed?: boolean;
  } = {},
) {
  const page = await browser.newPage();
  const prepared: {
    profileId: string | null;
    body: { prepareOnly: boolean; url: string };
  }[] = [];
  let profilesFetched = 0;
  const root = join(process.cwd(), '..', 'chrome-extension');
  const html = (await readFile(join(root, 'popup.html'), 'utf8'))
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*>/g, '');
  await page.route('https://popup.example/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.route(API + '/**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname === '/form-fill/chrome/pending')
      body = options.pending
        ? [
            {
              id: uuid,
              name: 'Currículo da vaga',
              url: 'https://portal.example/job',
            },
          ]
        : [];
    else if (url.pathname === '/profiles') {
      profilesFetched++;
      body = options.emptyProfiles
        ? []
        : [
            { id: 'cv-one', name: 'Currículo Um' },
            { id: 'cv-two', name: 'Currículo Dois' },
          ];
    } else if (url.pathname === '/form-fill/chrome') {
      prepared.push({
        profileId: url.searchParams.get('profileId'),
        body: route.request().postDataJSON() as {
          prepareOnly: boolean;
          url: string;
        },
      });
      body = { requestId: uuid, message: 'Pronto' };
    } else throw new Error('Unexpected local API call: ' + url.pathname);
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  });
  await page.addInitScript((allowed) => {
    const state = {
      starts: [] as { requestId: string; tabId: number }[],
      permissions: 0,
      active: { id: 7, url: 'https://gringoezapay.gupy.io/jobs/sample' },
    };
    (window as unknown as { test: typeof state }).test = state;
    (window as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getManifest: () => ({ version: '1.11.1' }),
        sendMessage: (message: {
          type: string;
          requestId: string;
          tabId: number;
        }) => {
          if (message.type === 'start') state.starts.push(message);
          return Promise.resolve(
            message.type === 'start'
              ? { started: true }
              : state.starts.length
                ? {
                    running: false,
                    active: false,
                    message:
                      'Abrindo o caminho até o formulário. Você pode fechar este painel.',
                  }
                : null,
          );
        },
      },
      tabs: { query: () => Promise.resolve([state.active]) },
      permissions: {
        request: () => {
          state.permissions++;
          return Promise.resolve(allowed);
        },
      },
    };
  }, options.allowed ?? true);
  await page.goto('https://popup.example/');
  await page.addScriptTag({
    type: 'module',
    content: await readFile(join(root, 'popup.js'), 'utf8'),
  });
  return { page, prepared, profilesFetched: () => profilesFetched };
}

it('recovers the empty selector shown in the screenshot and prepares the selected saved CV for the current tab', async () => {
  const h = await setup();
  try {
    await h.page
      .getByText('Escolha um currículo salvo para preencher esta aba.', {
        exact: true,
      })
      .waitFor();
    expect(await h.page.locator('#request option').count()).toBe(2);
    expect(await h.page.locator('#fill').isEnabled()).toBe(true);
    await h.page.locator('#request').selectOption('cv-two');
    await h.page.locator('#fill').click();
    await h.page
      .getByText(
        'Abrindo o caminho até o formulário. Você pode fechar este painel.',
        { exact: true },
      )
      .waitFor();
    expect(h.prepared).toEqual([
      {
        profileId: 'cv-two',
        body: {
          prepareOnly: true,
          url: 'https://gringoezapay.gupy.io/jobs/sample',
        },
      },
    ]);
    expect(
      await h.page.evaluate(
        () =>
          (window as unknown as { test: { starts: unknown[] } }).test.starts,
      ),
    ).toEqual([{ type: 'start', tabId: 7, requestId: uuid }]);
    // Other options still contain profile IDs: switching CVs must prepare those,
    // rather than incorrectly treating their identifiers as existing requests.
    await h.page.locator('#request').selectOption('cv-one');
    await h.page.locator('#fill').click();
    await h.page.waitForFunction(
      () =>
        (window as unknown as { test: { starts: unknown[] } }).test.starts
          .length === 2,
    );
    expect(h.prepared[1].profileId).toBe('cv-one');
  } finally {
    await h.page.close();
  }
});

it('preserves the original vacancy request when it is still available', async () => {
  const h = await setup({ pending: true });
  try {
    await h.page
      .getByText(
        'Confira o currículo e clique para abrir o formulário e preencher.',
        { exact: true },
      )
      .waitFor();
    await h.page.locator('#fill').click();
    await h.page.waitForFunction(
      () =>
        (window as unknown as { test: { starts: unknown[] } }).test.starts
          .length === 1,
    );
    expect(h.prepared).toHaveLength(0);
    expect(h.profilesFetched()).toBe(0);
  } finally {
    await h.page.close();
  }
});

it('explains an empty profile registry without enabling a fill action', async () => {
  const h = await setup({ emptyProfiles: true });
  try {
    await h.page
      .getByText(
        'Cadastre e salve um currículo no Job Tracker antes de preencher.',
        { exact: true },
      )
      .waitFor();
    expect(await h.page.locator('#fill').isDisabled()).toBe(true);
    expect(h.prepared).toHaveLength(0);
  } finally {
    await h.page.close();
  }
});

it('does not prepare or start without the requested browser access', async () => {
  const h = await setup({ allowed: false });
  try {
    await h.page
      .getByText('Escolha um currículo salvo para preencher esta aba.', {
        exact: true,
      })
      .waitFor();
    await h.page.locator('#fill').click();
    await h.page
      .getByText(
        'Para navegar entre portais e empresas, permita o acesso HTTPS solicitado pelo Chrome.',
        { exact: true },
      )
      .waitFor();
    expect(h.prepared).toHaveLength(0);
  } finally {
    await h.page.close();
  }
});
