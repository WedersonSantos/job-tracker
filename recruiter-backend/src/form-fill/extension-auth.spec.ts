import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
it('returns to the originating application when the Google login tab closes, including after a worker restart', async () => {
  const source = (
    await readFile(
      join(process.cwd(), '..', 'chrome-extension/background.js'),
      'utf8',
    )
  ).replace(/^import .*$/gm, '');
  const stored: Record<string, unknown> = {
    'jobtracker:2': {
      requestId: 'request',
      currentId: 2,
      loginParentId: 1,
      active: true,
      running: false,
      hadForm: false,
      formSteps: 0,
      advanced: [],
      expiresAt: Date.now() + 60000,
    },
  };
  let removed: (id: number) => void = () => {};
  const injected: number[] = [];
  const chrome = {
    runtime: { id: 'test', onMessage: { addListener: () => {} } },
    storage: {
      session: {
        get: (key: string) => Promise.resolve({ [key]: stored[key] }),
        set: (values: Record<string, unknown>) => {
          Object.assign(stored, JSON.parse(JSON.stringify(values)));
          return Promise.resolve();
        },
        remove: (key: string) => {
          delete stored[key];
          return Promise.resolve();
        },
      },
    },
    tabs: {
      get: (id: number) =>
        Promise.resolve({
          id,
          status: 'complete',
          url: 'https://company.example.com/application',
        }),
      update: jest.fn(() => Promise.resolve()),
      onUpdated: { addListener: () => {} },
      onRemoved: {
        addListener: (fn: typeof removed) => {
          removed = fn;
        },
      },
      onCreated: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: ({
        target,
        func,
        args,
      }: {
        target: { tabId: number };
        func: { name: string };
        args: unknown[];
      }) => {
        injected.push(target.tabId);
        return Promise.resolve([
          {
            result:
              func.name === 'fillCurrentDocument'
                ? { filled: ['email'], needsReview: [] }
                : args[2] === 'watch'
                  ? { kind: 'watching' }
                  : args[2] === 'progress'
                    ? { kind: 'final' }
                    : { kind: 'form' },
          },
        ]);
      },
    },
    action: { setBadgeText: () => Promise.resolve() },
  };
  runInNewContext(source, {
    chrome,
    inspectApplicationDocument: function inspectApplicationDocument() {},
    fillCurrentDocument: function fillCurrentDocument() {},
    fetch: () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            navigation: { apply: 'apply', maxSteps: 4 },
            fields: [],
          }),
      }),
    AbortSignal,
    setTimeout,
    clearTimeout,
    URL,
  });
  removed(2);
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    if ((stored['jobtracker:1'] as { active?: boolean })?.active === false)
      break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(stored['jobtracker:2']).toBeUndefined();
  expect(stored['jobtracker:1']).toMatchObject({
    currentId: 1,
    active: false,
  });
  expect((stored['jobtracker:1'] as { message: string }).message).toContain(
    'etapa final',
  );
  expect(chrome.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(injected.length).toBeGreaterThan(0);
  expect(injected.every((id) => id === 1)).toBe(true);
});
