import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';

test('Sequelize consulta PostgreSQL real; API queda lista sin crear tablas', async () => {
  const config = readConfig();
  const db = createDatabase(config);
  const app = buildApp({ database: db, corsOrigins: config.corsOrigins });
  try {
    const response = await app.inject('/health/ready');
    assert.equal(response.statusCode, 200);
    const [rows] = await db.query('SELECT current_database() AS database, version() AS version');
    assert.equal(rows.length, 1);
    assert.equal(response.json().status, 'ready');
  } finally { await app.close(); }
});

test('conexión PostgreSQL rechazada produce 503 sin detalles internos', async () => {
  const config = readConfig();
  const url = new URL(config.databaseUrl);
  url.hostname = '127.0.0.1';
  url.port = '1';
  const app = buildApp({ database: createDatabase({ ...config, databaseUrl: url.toString() }), corsOrigins: [] });
  try {
    const response = await app.inject('/health/ready');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().status, 'unavailable');
    assert.doesNotMatch(response.body, /postgres:|ECONNREFUSED|password|stack/);
  } finally { await app.close(); }
});
