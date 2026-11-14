Promise.all([
  fetch('http://127.0.0.1:3333/profiles', { signal: AbortSignal.timeout(3500) }).then(async r => r.ok && Array.isArray(await r.json())),
  fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(3500) }).then(async r => r.ok && (await r.json()).app === 'job-tracker'),
]).then(values => { process.exitCode = values.every(Boolean) ? 0 : 1; }).catch(() => { process.exitCode = 1; });
