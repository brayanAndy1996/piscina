import { readConfig } from './config.js';
import { createDatabase } from './database.js';

async function check() {
  const db = createDatabase(readConfig());
  try {
    await db.authenticate();
    console.log('PostgreSQL disponible. No se modificaron tablas ni datos.');
  } finally {
    await db.close();
  }
}
check().catch(() => {
  console.error('PostgreSQL no disponible. Revise la configuración del servidor.');
  process.exitCode = 1;
});
