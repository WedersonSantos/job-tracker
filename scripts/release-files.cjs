const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Somente árvores de código e arquivos de configuração explicitamente públicos.
const exact = new Set([
  'package.json', 'package-lock.json',
  'packages/shared/package.json', 'packages/shared/tsconfig.json',
  'recruiter-backend/package.json', 'recruiter-backend/prisma.config.ts',
  'recruiter-backend/tsconfig.json', 'recruiter-backend/tsconfig.build.json', 'recruiter-backend/nest-cli.json',
  'recruiter-backend/prisma/schema.prisma', 'recruiter-backend/prisma/migrations/migration_lock.toml',
  'recruiter-frontend/package.json', 'recruiter-frontend/tsconfig.json', 'recruiter-frontend/next-env.d.ts',
  'recruiter-frontend/next.config.ts', 'recruiter-frontend/postcss.config.mjs', 'recruiter-frontend/proxy.ts',
  'recruiter-frontend/app/favicon.ico', 'recruiter-frontend/app/icon.svg',
  'windows/services.ps1', 'windows/initialize.ps1', 'windows/guide.html', 'windows/docker-compose.install.yml',
  'windows/prerequisites.ps1', 'windows/uninstall.ps1',
  'windows/native-postgres.ps1', 'windows/postgresql-runtime.json',
  'windows/shortcuts.ps1',
  'scripts/build-extension.ps1',
]);
const trees = [
  'packages/shared/src', 'recruiter-backend/src',
  'recruiter-frontend/app', 'recruiter-frontend/components', 'recruiter-frontend/features', 'recruiter-frontend/lib',
];
const extension = new Set(['manifest.json', 'app-bridge.js', 'application-tabs.js', 'background.js', 'fill.js',
  'navigation.js', 'popup.css', 'popup.html', 'popup.js', 'presentation.js']);

function allowed(relative) {
  if (relative.split('/').some(p => p.startsWith('.') || ['node_modules', 'generated', 'dist', 'tmp', 'data'].includes(p))) return false;
  if (/\.(spec|test)\./.test(relative)) return false;
  if (exact.has(relative)) return true;
  if (trees.some(root => relative.startsWith(root + '/')) && /\.(ts|tsx|js|mjs|css)$/.test(relative)) return true;
  if (/^recruiter-backend\/prisma\/migrations\/[a-zA-Z0-9_-]+\/migration\.sql$/.test(relative)) return true;
  if (/^recruiter-frontend\/public\/[a-z0-9_-]+\.svg$/.test(relative)) return true;
  return relative.startsWith('chrome-extension/') && extension.has(relative.slice('chrome-extension/'.length));
}

function inspect(relative, bytes) {
  const text = bytes.toString('utf8');
  const rules = [
    ['chave privada', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['token de provedor', /\b(?:sk-ant-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{30,}|AKIA[A-Z0-9]{16})\b/],
    ['caminho pessoal absoluto', /[A-Z]:[\\/]+Users[\\/]+[^\s"'`<>]+/i],
    ['identificador pessoal de desenvolvimento', /\b(?:wederson|moacir)\b/i],
    ['documento pessoal formatado', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ];
  // Máscaras de campos não são documentos preenchidos.
  const scrubbed = text.replaceAll('000.000.000-00', '').replaceAll('123.456.789-00', '');
  for (const [reason, pattern] of rules) if (pattern.test(scrubbed)) throw new Error(`Revisão necessária: ${relative} (${reason}). Nenhum valor sensível foi registrado.`);
  if (relative === 'package-lock.json') {
    const lock = JSON.parse(text);
    for (const entry of Object.values(lock.packages || {})) {
      if (entry.resolved && !entry.link && !entry.resolved.startsWith('https://registry.npmjs.org/'))
        throw new Error('O lockfile contém dependência fora do registro npm público.');
    }
  }
}

function collect(root) {
  const result = [];
  function walk(directory) {
    for (const item of fs.readdirSync(path.join(root, directory), {withFileTypes: true})) {
      const relative = directory ? directory + '/' + item.name : item.name;
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (['node_modules', '.git', '.next', 'dist', 'tmp', 'generated', 'data', '.browser-profile'].includes(item.name)) continue;
        if (trees.some(t => t === relative || t.startsWith(relative + '/') || relative.startsWith(t + '/')) ||
            [...exact].some(p => p.startsWith(relative + '/')) || relative.startsWith('recruiter-backend/prisma/migrations') ||
            relative === 'chrome-extension' || relative === 'recruiter-frontend/public') walk(relative);
      } else if (item.isFile() && allowed(relative)) {
        const bytes = fs.readFileSync(path.join(root, relative));
        inspect(relative, bytes);
        result.push({ path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
      }
    }
  }
  walk('');
  for (const file of exact) {
    if (file === 'recruiter-frontend/next-env.d.ts') continue; // Next também pode gerar esse arquivo.
    if (!result.some(entry => entry.path === file)) throw new Error(`Arquivo público obrigatório ausente: ${file}`);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

module.exports = {allowed, inspect, collect};
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(process.argv[2]);
  const files = collect(root);
  fs.mkdirSync(output, {recursive: true});
  for (const entry of files) {
    const target = path.join(output, entry.path);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(root, entry.path), target);
  }
  console.log(`${files.length} arquivos públicos verificados e copiados; sem consulta a perfis ou bancos.`);
}
