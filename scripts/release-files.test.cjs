const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {allowed, inspect, collect} = require('./release-files.cjs');

test('dados locais e configurações privadas nunca são arquivos distribuíveis', () => {
  for (const file of [
    '.env', 'recruiter-backend/.env', 'recruiter-frontend/.env.local', 'profile.json',
    'recruiter-backend/src/generated/prisma/client.ts', 'recruiter-backend/src/person.spec.ts',
    'recruiter-frontend/public/curriculo.pdf', 'recruiter-frontend/public/linkedin.csv',
    'chrome-extension/storageState.json', 'dist/windows/runtime/anthropic.key',
    'data/resumes/person/resume.json', '.browser-profile/Default/Cookies',
    'backup.sql', 'tmp/profile.json', 'recruiter-frontend/app/private.env', 'data/job-tracker/web-access.json', 'web-access.json',
  ]) assert.equal(allowed(file), false, file);
});

test('segredos ou identificação pessoal em código público bloqueiam a distribuição', () => {
  for (const content of [
    'const key = "sk-ant-' + 'a'.repeat(40) + '";',
    'const document = "987.654.321-12";',
    'const person = "Weder' + 'son";',
    'const file = "C:\\Users\\PrivatePerson\\cv.pdf";',
    '-----BEGIN PRIVATE KEY-----',
  ]) assert.throws(() => inspect('recruiter-frontend/app/page.tsx', Buffer.from(content)), /Revisão necessária/);
  assert.doesNotThrow(() => inspect('field.ts', Buffer.from('placeholder="000.000.000-00"')));
});

test('lockfile com dependência fora do registro npm público bloqueia distribuição', () => {
  assert.throws(() => inspect('package-lock.json', Buffer.from(JSON.stringify({packages: {x: {resolved: 'https://private.invalid/package.tgz'}}}))), /fora do registro/);
});

test('árvore atual tem código verificável e nenhuma cópia de estado local', () => {
  const files = collect(path.resolve(__dirname, '..'));
  assert(files.length > 100);
  assert(files.some(f => f.path === 'windows/guide.html'));
  assert(files.every(f => allowed(f.path)));
  assert(files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
});
