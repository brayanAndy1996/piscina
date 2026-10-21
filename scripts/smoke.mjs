import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error('Un servicio terminó antes del smoke.');
    try { return await fetch(url, { signal: AbortSignal.timeout(2000) }); }
    catch { await delay(250); }
  }
  throw new Error('El servicio no inició a tiempo.');
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  if (!process.env.API_DATABASE_URL) throw new Error('Smoke requiere API_DATABASE_URL de una BD de prueba.');
  const apiPort = await availablePort();
  const webPort = await availablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const env = { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', API_HOST: '127.0.0.1', API_PORT: String(apiPort), API_URL: apiUrl };
  const api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: 'ignore' });
  const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--port', String(webPort), '--hostname', '127.0.0.1'], { env, stdio: 'ignore' });
  try {
    const ready = await waitFor(`${apiUrl}/health/ready`, api);
    assert.equal(ready.status, 200, 'PostgreSQL debe estar disponible para el smoke positivo.');
    const page = await waitFor(webUrl, web);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /API y PostgreSQL disponibles/);
    await stop(api);
    const unavailable = await fetch(webUrl, { signal: AbortSignal.timeout(10000) });
    assert.match(await unavailable.text(), /Servicio no disponible/);
    console.log('Smoke correcto: API compilada + PostgreSQL + web de producción; caída de API visible.');
  } finally { await Promise.all([stop(api), stop(web)]); }
}

main().catch(() => { console.error('Smoke falló; revise build, puertos y PostgreSQL de prueba.'); process.exitCode = 1; });
