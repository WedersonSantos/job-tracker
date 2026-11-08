import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

type Tab = { id: number; windowId: number; url: string; pendingUrl?: string };
type Manager = {
  open: (id: string) => Promise<{ reused: boolean; tabId: number }>;
  move: (from: number, to: number) => Promise<void>;
};
async function harness(initial: Tab[] = []) {
  const source = await readFile(
    join(process.cwd(), '..', 'chrome-extension/application-tabs.js'),
    'utf8',
  );
  const factory = runInNewContext(
    source.replace('export ', '') + '; applicationTabs',
    { URL },
  ) as (browser: unknown, pending: unknown) => Manager;
  const tabs = new Map(initial.map((tab) => [tab.id, tab]));
  const stored: Record<string, unknown> = {};
  const browser = {
    storage: {
      session: {
        get: (key: string) =>
          Promise.resolve({ [key]: structuredClone(stored[key]) }),
        set: (value: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(value));
          return Promise.resolve();
        },
      },
    },
    tabs: {
      get: (id: number) =>
        tabs.has(id)
          ? Promise.resolve(tabs.get(id))
          : Promise.reject(new Error('closed')),
      query: jest.fn(() => Promise.resolve([...tabs.values()])),
      update: jest.fn((id: number) => Promise.resolve(tabs.get(id))),
      create: jest.fn(({ url }: { url: string }) => {
        const tab = { id: tabs.size + 10, windowId: 3, url };
        tabs.set(tab.id, tab);
        return Promise.resolve(tab);
      }),
    },
    windows: { update: jest.fn(() => Promise.resolve()) },
  };
  const pending = () =>
    Promise.resolve([
      { id: 'first', url: 'https://portal.example/job?id=1' },
      { id: 'again', url: 'https://portal.example/job?id=1' },
      { id: 'different', url: 'https://portal.example/job?id=2' },
    ]);
  return {
    factory,
    pending,
    manager: factory(browser, pending),
    restart: () => factory(browser, pending),
    tabs,
    browser,
  };
}

it('focuses an already open job in another window without navigating or reloading it', async () => {
  const h = await harness([
    { id: 7, windowId: 2, url: 'https://portal.example/job?id=1' },
  ]);
  expect(await h.manager.open('first')).toMatchObject({
    reused: true,
    tabId: 7,
  });
  expect(h.browser.tabs.create).not.toHaveBeenCalled();
  expect(h.browser.tabs.update).toHaveBeenCalledWith(7, { active: true });
  expect(h.browser.windows.update).toHaveBeenCalledWith(2, { focused: true });
});

it('keeps the same job in Alexandre and Carlos isolated to the profile that received the click', async () => {
  const alexandre = await harness([
    { id: 7, windowId: 1, url: 'https://portal.example/job?id=1' },
  ]);
  const carlos = await harness([
    { id: 7, windowId: 2, url: 'https://portal.example/job?id=1' },
  ]);
  await carlos.manager.open('first');
  expect(carlos.browser.windows.update).toHaveBeenCalledWith(2, {
    focused: true,
  });
  expect(alexandre.browser.tabs.query).not.toHaveBeenCalled();
  expect(alexandre.browser.tabs.update).not.toHaveBeenCalled();
  await alexandre.manager.open('first');
  expect(alexandre.browser.windows.update).toHaveBeenCalledWith(1, {
    focused: true,
  });
  expect(carlos.browser.tabs.create).not.toHaveBeenCalled();
  expect(alexandre.browser.tabs.create).not.toHaveBeenCalled();
});
it('creates once for simultaneous clicks and keeps different jobs separate', async () => {
  const h = await harness();
  const results = await Promise.all([
    h.manager.open('first'),
    h.manager.open('again'),
  ]);
  expect(results.map((r) => r.reused)).toEqual([false, true]);
  expect(h.browser.tabs.create).toHaveBeenCalledTimes(1);
  await h.manager.open('different');
  expect(h.browser.tabs.create).toHaveBeenCalledTimes(2);
});
it('preserves the redirected company form and follows its child tab across worker restart', async () => {
  const h = await harness();
  const opened = await h.manager.open('first');
  h.tabs.set(99, {
    id: 99,
    windowId: 4,
    url: 'https://company.example/application/step2',
  });
  await h.manager.move(opened.tabId, 99);
  h.tabs.delete(opened.tabId);
  expect(await h.restart().open('again')).toMatchObject({
    reused: true,
    tabId: 99,
  });
  expect(h.browser.tabs.update).toHaveBeenLastCalledWith(99, { active: true });
  expect(h.browser.tabs.create).toHaveBeenCalledTimes(1);
});
it('opens a replacement only after the previous application tab has closed', async () => {
  const h = await harness();
  const opened = await h.manager.open('first');
  h.tabs.delete(opened.tabId);
  expect((await h.manager.open('again')).reused).toBe(false);
  expect(h.browser.tabs.create).toHaveBeenCalledTimes(2);
});
it('does not open tabs for an expired or fabricated backend request', async () => {
  const h = await harness();
  await expect(h.manager.open('unknown')).rejects.toThrow('expirou');
  expect(h.browser.tabs.create).not.toHaveBeenCalled();
});

it('accepts only the local app bridge and closes only its disposable handoff tab', async () => {
  const h = await harness([
    { id: 7, windowId: 2, url: 'https://portal.example/job?id=1' },
  ]);
  type Listener = (
    message: unknown,
    sender: unknown,
    reply: (value: unknown) => void,
  ) => unknown;
  let listener: Listener = () => {};
  const remove = jest.fn(() => Promise.resolve());
  const chrome = {
    ...h.browser,
    tabs: { ...h.browser.tabs, remove },
    runtime: {
      id: 'extension-test',
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
  };
  const source = await readFile(
    join(process.cwd(), '..', 'chrome-extension/background.js'),
    'utf8',
  );
  runInNewContext(source.replace(/^import .*$/gm, ''), {
    chrome,
    applicationTabs: h.factory,
    URL,
    AbortSignal,
    setTimeout,
    fetch: () => Promise.resolve({ ok: true, json: h.pending }),
  });
  const reply = jest.fn();
  listener(
    { type: 'openRequest', requestId: 'first', handoff: true },
    { id: 'extension-test', url: 'https://untrusted.example/', tab: { id: 8 } },
    reply,
  );
  expect(reply).not.toHaveBeenCalled();
  expect(h.browser.tabs.update).not.toHaveBeenCalled();
  await new Promise((resolve) =>
    listener(
      { type: 'openRequest', requestId: 'first', handoff: true },
      {
        id: 'extension-test',
        url: 'http://127.0.0.1:3333/form-fill/chrome/open?requestId=first',
        tab: { id: 8 },
      },
      resolve,
    ),
  );
  await Promise.resolve();
  expect(h.browser.tabs.create).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith(8);
  remove.mockClear();
  await new Promise((resolve) =>
    listener(
      { type: 'openRequest', requestId: 'again', handoff: true },
      {
        id: 'extension-test',
        url: 'http://127.0.0.1:3000/vagas/salvas',
        tab: { id: 9 },
      },
      resolve,
    ),
  );
  await Promise.resolve();
  expect(remove).not.toHaveBeenCalled();
});
