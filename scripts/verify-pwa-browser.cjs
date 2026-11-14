// Isolated fixture: never connects to the personal database or API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtracker-pwa-'));
const configFile = path.join(fixture, 'web-access.json');
const artifactDir = path.join(root, 'tmp', 'pwa-review');
fs.mkdirSync(artifactDir, { recursive: true });
let apiReads = 0;
const mock = http.createServer((request, response) => {
  apiReads++;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(request.url === '/profiles' ? [{ id: 'pwa-test', name: 'Perfil de demonstração', headline: 'Suporte técnico', isDefault: true, createdAt: '2026-01-01T00:00:00Z' }] : []));
});
let server, browser;
function hostRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, response => { response.resume(); resolve({ status: response.statusCode, headers: response.headers }); });
    request.on('error', reject);
  });
}
async function main() {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${mock.address().port}`;
  const logs = fs.openSync(path.join(artifactDir, 'server.log'), 'w');
  server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3187'], {
    cwd: path.join(root, 'recruiter-frontend'), env: { ...process.env, API_URL: api, JOBTRACKER_WEB_CONFIG: configFile }, windowsHide: true, stdio: ['ignore', logs, logs],
  });
  const base = 'http://127.0.0.1:3187';
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error('Test server failed. See tmp/pwa-review/server.log');
    if (await fetch(base + '/api/health').then(r => r.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launchPersistentContext(path.join(fixture, 'chrome'), { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = browser;
  await context.addCookies([{ name: 'selectedProfileId', value: 'pwa-test', url: base }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/instalar');
  await page.getByRole('heading', { name: 'Leve o Job Tracker com você.' }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cdp = await context.newCDPSession(page);
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, [], JSON.stringify(installability));
  const manifest = await context.request.get(base + '/manifest.webmanifest').then(r => r.json());
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.icons.length, 3);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(artifactDir, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(artifactDir, 'mobile.png'), fullPage: true });
  // Configure via the real form; no personal credentials or profiles involved.
  await page.getByRole('textbox', { name: 'Endereço HTTPS' }).fill('https://tracker.example.com');
  await page.getByLabel('Senha de acesso', { exact: true }).fill('synthetic-passphrase-123');
  await page.getByLabel('Confirmar senha', { exact: true }).fill('synthetic-passphrase-123');
  await page.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Senha e endereço configurados' }).waitFor();
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert(!fs.readFileSync(configFile, 'utf8').includes('synthetic-passphrase-123'));
  // Saving triggers a router refresh in the authenticated page. Let it finish
  // before counting calls from the separate anonymous navigation.
  await page.waitForLoadState('networkidle');
  const before = apiReads;
  const anonymous = await context.browser().newContext();
  await anonymous.addCookies([{ name: 'selectedProfileId', value: 'pwa-test', url: base }]);
  const login = await anonymous.newPage();
  await login.setViewportSize({ width: 390, height: 844 });
  await login.goto(base + '/instalar');
  assert(login.url().includes('/entrar?'));
  assert.equal(apiReads, before, 'Anonymous login must not load profile data');
  await login.screenshot({ path: path.join(artifactDir, 'login-mobile.png'), fullPage: true });
  const blockedAction = await anonymous.request.post(base + '/entrar', { headers: { 'Next-Action': 'synthetic-action' }, data: '[]' });
  assert.equal(blockedAction.status(), 401, 'Public login page must not expose arbitrary Server Actions');
  const invalidHost = await hostRequest(base + '/instalar', { Host: 'evil.example.com' });
  assert.equal(invalidHost.status, 403);
  const remote = await hostRequest(base + '/instalar', { Host: 'tracker.example.com', 'X-Forwarded-Proto': 'https' });
  assert.equal(remote.status, 307); assert.match(remote.headers.location, /^https:\/\/tracker\.example\.com\/entrar/);
  const csrf = await anonymous.request.post(base + '/api/session', { headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/x-www-form-urlencoded' }, data: 'password=synthetic-passphrase-123' });
  assert.equal(csrf.status(), 403);
  await login.getByLabel('Senha do Job Tracker').fill('incorrect');
  await login.getByRole('button', { name: 'Entrar', exact: true }).click();
  await login.getByRole('alert').filter({ hasText: 'Senha incorreta' }).waitFor();
  await login.getByLabel('Senha do Job Tracker').fill('synthetic-passphrase-123');
  await login.getByRole('button', { name: 'Entrar', exact: true }).click();
  await login.getByRole('heading', { name: 'Leve o Job Tracker com você.' }).waitFor();
  const cookie = (await anonymous.cookies()).find(c => c.name === 'jobtracker_session');
  assert(cookie.httpOnly); assert.equal(cookie.sameSite, 'Strict');
  await login.getByRole('button', { name: 'Sair deste dispositivo' }).click();
  await login.getByLabel('Senha do Job Tracker').waitFor();
  assert(!(await anonymous.cookies()).some(c => c.name === 'jobtracker_session'));
  // Cache holds no HTML/RSC with personal data, even after authenticated pages.
  const cached = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(new URL(request.url).pathname);
    return result;
  });
  assert(cached.every(p => p === '/offline.html' || p.startsWith('/icons/')), JSON.stringify(cached));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: 'Não foi possível conectar' }).waitFor();
  await page.screenshot({ path: path.join(artifactDir, 'offline-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: responsive install UI, manifest, worker, private cache, setup, login, cookie, CSRF, host and Server Action guards, offline fallback.');
  console.log('Screenshots: tmp/pwa-review');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.kill(); mock.close();
  // Fixture contains only synthetic access credentials; keep logs/screenshots only.
  fs.rmSync(configFile, { force: true });
});
