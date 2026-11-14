const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function validateHosted(env, config) {
  const origin = new URL(env.WEB_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.WEB_ORIGIN || origin.username || origin.password) throw Error('Configure uma origem HTTPS exata.');
  if (!config || config.version !== 1 || config.origin !== env.WEB_ORIGIN || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(config.passwordHash || '') || !/^[a-f0-9]{64}$/.test(config.sessionSecret || '')) throw Error('Configure a senha de acesso antes de iniciar o servidor.');
  const database = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !/^[a-f0-9]{64}$/.test(database.password)) throw Error('Use uma senha aleatória de 64 caracteres hexadecimais para o banco.');
  if (env.API_HOST !== '127.0.0.1' || env.API_URL !== 'http://127.0.0.1:3333' || env.PORT !== '3333') throw Error('Mantenha a API privada em 127.0.0.1:3333.');
}
function run(command, args, options = {}) {
  return spawn(command, args, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', ...options });
}
async function start() {
  try {
    const file = process.env.JOBTRACKER_WEB_CONFIG;
    if (!file) throw Error();
    validateHosted(process.env, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    console.error('Configuração hospedada incompleta ou inválida. Configure endereço, senha de acesso e banco conforme deploy/README.md. Nenhum serviço foi iniciado.');
    process.exitCode = 1; return;
  }
  let stopping = false;
  const children = new Set();
  function stop(code) {
    if (stopping) return;
    stopping = true; process.exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 20000);
    timer.unref();
  }
  function track(child) {
    children.add(child);
    child.once('error', () => { console.error('Um serviço não pôde ser iniciado.'); stop(1); });
    child.once('exit', code => { children.delete(child); if (!stopping) stop(code || 1); });
    return child;
  }
  process.once('SIGTERM', () => stop(0)); process.once('SIGINT', () => stop(0));
  const migration = run(process.execPath, [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: path.resolve(__dirname, '../recruiter-backend') });
  children.add(migration);
  const migrated = await new Promise(resolve => { migration.once('error', () => resolve(false)); migration.once('exit', code => resolve(code === 0)); });
  children.delete(migration);
  if (stopping) return;
  if (!migrated) { console.error('Migrations falharam. A interface não foi iniciada.'); stop(1); return; }
  track(run(process.execPath, ['dist/main.js'], { cwd: path.resolve(__dirname, '../recruiter-backend') }));
  try {
    for (let i = 0; i < 60; i++) {
      if (stopping) return;
      const ready = await fetch('http://127.0.0.1:3333/profiles', { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false);
      if (ready) {
        track(run(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', '3000'], { cwd: path.resolve(__dirname, '../recruiter-frontend') }));
        console.log('Serviços iniciados. Acompanhe o healthcheck antes de conectar o HTTPS.'); return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.error('A API não ficou pronta dentro do prazo.'); stop(1);
  } catch { stop(1); }
}
module.exports = { validateHosted };
if (require.main === module) void start();
