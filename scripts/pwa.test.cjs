const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

function worker({ offline = false, missing = false } = {}) {
  const events = {}, saved = [], deleted = []; let skipped = 0;
  const context = {
    URL, Response,
    self: { location: { origin: 'https://tracker.test' }, clients: { claim: async () => {} }, skipWaiting: () => skipped++, addEventListener: (name, callback) => events[name] = callback },
    caches: { open: async () => ({ addAll: async values => saved.push(...values), match: async () => missing ? undefined : new Response('offline-static') }), keys: async () => ['unrelated-cache', 'jobtracker-pwa-static-old'], delete: async name => deleted.push(name) },
    fetch: async () => { if (offline) throw Error('offline'); return new Response('private-network-only'); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'recruiter-frontend/public/sw.js'), 'utf8'), context);
  return { events, saved, deleted, skipped: () => skipped };
}
test('worker precaches only public assets and deletes only its own old cache', async () => {
  const w = worker(); let pending;
  w.events.install({ waitUntil: value => pending = value }); await pending;
  assert.equal(w.saved.length, 5);
  assert(w.saved.every(p => p === '/offline.html' || p.startsWith('/icons/')));
  assert.equal(w.skipped(), 0);
  w.events.activate({ waitUntil: value => pending = value }); await pending;
  assert.deepEqual(w.deleted, ['jobtracker-pwa-static-old']);
  w.events.message({ data: { type: 'SKIP_WAITING' } }); assert.equal(w.skipped(), 1);
});
test('no private API, mutations, scripts or cross-origin requests are cached', () => {
  const w = worker();
  for (const request of [
    { url: 'https://tracker.test/api/private', method: 'GET', mode: 'cors' },
    { url: 'https://tracker.test/curriculo', method: 'POST', mode: 'navigate' },
    { url: 'https://external.test/file', method: 'GET', mode: 'navigate' },
    { url: 'https://tracker.test/_next/static/bundle.js', method: 'GET', mode: 'cors' },
  ]) w.events.fetch({ request, respondWith: () => assert.fail(request.url) });
});
test('private navigations use network; offline fallback never contains profile data', async () => {
  for (const options of [{}, { offline: true }, { offline: true, missing: true }]) {
    const w = worker(options); let response;
    w.events.fetch({ request: { url: 'https://tracker.test/curriculo', method: 'GET', mode: 'navigate' }, respondWith: value => response = value });
    const result = await response;
    assert.equal(result.status, options.missing ? 503 : 200);
    assert.match(await result.text(), options.offline ? /offline|sem conexão/ : /private-network-only/);
    assert.equal(w.saved.length, 0);
  }
});
test('install icons have correct sizes and opaque safe background', async () => {
  for (const [name, size] of [['pwa-192', 192], ['pwa-512', 512], ['pwa-maskable-512', 512], ['apple-touch-icon', 180]]) {
    const image = sharp(path.join(root, `recruiter-frontend/public/icons/${name}.png`));
    const meta = await image.metadata(); assert.equal(meta.width, size); assert.equal(meta.height, size);
    const stats = await image.stats(); assert(stats.isOpaque);
  }
});
