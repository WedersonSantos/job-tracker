const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collect, inspect } = require('./release-files.cjs');
const root = path.resolve(__dirname, '..');
const deployment = ['deploy/Dockerfile', 'deploy/start-hosted.cjs', 'deploy/configure-access.ts', 'deploy/healthcheck.cjs'];
function prepare(destination) {
  const target = path.resolve(destination);
  // Require a fresh context: stale private/unknown files can never join an image.
  if (fs.existsSync(target)) throw Error('Use uma pasta de contexto nova; uma pasta existente não será reutilizada.');
  const files = collect(root);
  for (const relative of deployment) {
    const bytes = fs.readFileSync(path.join(root, relative)); inspect(relative, bytes);
    files.push({ path: relative, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) {
    const destination = path.join(target, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file.path), destination);
  }
  fs.writeFileSync(path.join(target, 'public-files.json'), JSON.stringify(files, null, 2));
  const included = new Set(['public-files.json']);
  for (const file of files) {
    included.add(file.path);
    let directory = path.posix.dirname(file.path);
    while (directory !== '.') { included.add(directory + '/'); directory = path.posix.dirname(directory); }
  }
  // A later accidental .env or resume copy is also excluded from Docker's input.
  fs.writeFileSync(path.join(target, '.dockerignore'), '**\n' + [...included].sort().map(p => '!' + p).join('\n') + '\n');
  return files;
}
module.exports = { prepare };
if (require.main === module) {
  const destination = process.argv[2] || path.join(root, 'dist/hosted/context');
  try { console.log(`${prepare(destination).length} arquivos públicos preparados. Contexto: ${path.resolve(destination)}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
