import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

test('configuración válida, loopback por defecto', () => {
  const config = readConfig({ API_DATABASE_URL: 'postgres://local:pass@localhost/piscina' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4000);
  assert.equal(config.databaseSsl, false);
});

test('rechaza puerto, base u origen inválidos sin exponer su valor', () => {
  const valid = { API_DATABASE_URL: 'postgres://local:pass@localhost/piscina' };
  for (const port of ['NaN', '0', '65536', '4.2', '']) {
    assert.throws(() => readConfig({ ...valid, API_PORT: port }), /API_PORT/);
  }
  assert.throws(() => readConfig({}), /API_DATABASE_URL/);
  assert.throws(() => readConfig({ API_DATABASE_URL: 'sqlite://SECRET' }), /^Error: API_DATABASE_URL debe configurar PostgreSQL\.$/);
  assert.throws(() => readConfig({ ...valid, API_CORS_ORIGINS: '*' }), /API_CORS_ORIGINS/);
  assert.throws(() => readConfig({ ...valid, API_DATABASE_SSL: 'false' }), /API_DATABASE_SSL/);
});

test('producción requiere TLS en base y orígenes HTTPS', () => {
  const valid = { API_DATABASE_URL: 'postgres://local:pass@localhost/piscina', NODE_ENV: 'production' };
  assert.throws(() => readConfig({ ...valid, API_DATABASE_SSL: 'disable' }), /TLS/);
  assert.throws(() => readConfig(valid), /HTTPS/);
  assert.equal(readConfig({ ...valid, API_CORS_ORIGINS: 'https://academia.example' }).databaseSsl, true);
});
