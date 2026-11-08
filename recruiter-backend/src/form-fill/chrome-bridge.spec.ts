import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';

type Result = { ok: boolean };
type Event = { source: unknown; origin: string; data: unknown };
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function harness() {
  const source = await readFile(
    join(
      process.cwd(),
      '..',
      'recruiter-frontend/features/jobs/chrome-bridge.ts',
    ),
    'utf8',
  );
  const code = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  let receive: (event: Event) => void = () => {};
  const window = {
    setTimeout,
    clearTimeout,
    addEventListener: (_name: string, fn: typeof receive) => {
      receive = fn;
    },
    removeEventListener: jest.fn(),
    postMessage: jest.fn(),
  };
  const exported = {} as { chromeBridge: (type: string) => Promise<Result> };
  runInNewContext(code, {
    exports: exported,
    window,
    location: { origin: 'http://127.0.0.1:3000' },
    crypto: { randomUUID: () => 'request-id' },
  });
  const respond = (result: unknown) =>
    receive({
      source: window,
      origin: 'http://127.0.0.1:3000',
      data: {
        channel: 'jobtracker-extension-response',
        id: 'request-id',
        result,
      },
    });
  return { bridge: exported.chromeBridge, respond, window };
}

it('waits for the initiating profile extension to wake instead of falling back after 500ms', async () => {
  const h = await harness();
  let settled = false;
  const result = h.bridge('ping').then((value) => {
    settled = true;
    return value;
  });
  await jest.advanceTimersByTimeAsync(1000);
  expect(settled).toBe(false);
  h.respond({ ok: true });
  expect(await result).toEqual({ ok: true });
  expect(h.window.removeEventListener).toHaveBeenCalledTimes(1);
});

it('uses the native opening path only after the full detection timeout', async () => {
  const h = await harness();
  const result = h.bridge('ping');
  await jest.advanceTimersByTimeAsync(3000);
  expect(await result).toEqual({ ok: false });
});

it('ignores malformed responses until the current profile extension responds', async () => {
  const h = await harness();
  const result = h.bridge('ping');
  h.respond(undefined);
  h.respond({ ok: 'yes' });
  h.respond({ ok: true });
  expect(await result).toEqual({ ok: true });
});
