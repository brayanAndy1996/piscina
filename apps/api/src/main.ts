import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { createDatabase } from './database.js';

async function main() {
  const config = readConfig();
  const app = buildApp({ database: createDatabase(config), corsOrigins: config.corsOrigins, logger: true });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  }
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch {
    await app.close();
    throw new Error('No se pudo iniciar la API; revise host, puerto y configuración.');
  }
}
main().catch((error: unknown) => {
  // Los errores de configuración son mensajes controlados, sin valores de entorno.
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar la API.');
  process.exitCode = 1;
});
