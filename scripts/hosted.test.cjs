const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateHosted } = require('../deploy/start-hosted.cjs');
const { prepare } = require('./prepare-hosted.cjs');
const config = { version: 1, origin: 'https://tracker.example.com', passwordHash: 'a'.repeat(32) + ':' + 'b'.repeat(64), sessionSecret: 'c'.repeat(64) };
const env = { WEB_ORIGIN: config.origin, DATABASE_URL: 'postgresql://jobtracker:' + 'd'.repeat(64) + '@database:5432/jobtracker', API_HOST: '127.0.0.1', API_URL: 'http://127.0.0.1:3333', PORT: '3333' };
test('hosted startup refuses missing access, mismatched origin, weak DB passwords or public API', () => {
  assert.doesNotThrow(() => validateHosted(env, config));
  for (const overrides of [{ WEB_ORIGIN: 'http://tracker.example.com' }, { WEB_ORIGIN: 'https://other.example.com' }, { DATABASE_URL: 'postgresql://jobtracker:password@database/db' }, { API_HOST: '0.0.0.0' }, { API_URL: 'http://database:3333' }])
    assert.throws(() => validateHosted({ ...env, ...overrides }, config));
  assert.throws(() => validateHosted(env, null));
  assert.throws(() => validateHosted(env, { ...config, sessionSecret: '' }));
});
test('no config: entrypoint exits before any services are spawned and never prints secrets', () => {
  const result = spawnSync(process.execPath, ['deploy/start-hosted.cjs'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, ...env, JOBTRACKER_WEB_CONFIG: path.join(os.tmpdir(), 'jobtracker-nonexistent-' + Date.now()) }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /Nenhum serviço foi iniciado/);
  assert(!result.stderr.includes(env.DATABASE_URL));
});
test('audited hosted build context contains only public files and rejects stale contexts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtracker-hosted-test-'));
  const output = path.join(temp, 'context');
  const files = prepare(output);
  assert(files.some(f => f.path === 'deploy/configure-access.ts'));
  assert(files.some(f => f.path === 'recruiter-frontend/public/sw.js'));
  assert(files.every(f => !/(?:^|\/)\.env|web-access\.json|\.pdf$|\.csv$/.test(f.path)));
  const dockerignore = fs.readFileSync(path.join(output, '.dockerignore'), 'utf8');
  assert(dockerignore.startsWith('**\n'));
  assert(dockerignore.includes('!deploy/Dockerfile\n'));
  assert(!dockerignore.includes('!.env'));
  fs.writeFileSync(path.join(output, 'private.txt'), 'synthetic-private-file');
  assert.throws(() => prepare(output), /existente/);
});
