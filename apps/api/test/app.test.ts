import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('vida no depende de BD; readiness devuelve 503 sin filtrar secretos', async () => {
  let closed = false;
  const app = buildApp({ corsOrigins: ['http://localhost:3000'], database: {
    authenticate: async () => { throw new Error('postgres://user:SECRET@host/db'); },
    close: async () => { closed = true; },
  } });
  try {
    const live = await app.inject('/health/live');
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().status, 'ok');
    const ready = await app.inject('/health/ready');
    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json(), { service: 'piscina-api', status: 'unavailable', version: '0.1.0' });
    assert.equal(ready.headers['cache-control'], 'no-store');
    assert.doesNotMatch(ready.body, /SECRET|postgres:\/\//);
  } finally { await app.close(); }
  assert.equal(closed, true);
});

test('readiness disponible y CORS limitado a la web configurada', async () => {
  const app = buildApp({ corsOrigins: ['http://localhost:3000'], database: {
    authenticate: async () => {}, close: async () => {},
  } });
  try {
    const allowed = await app.inject({ url: '/health/ready', headers: { origin: 'http://localhost:3000' } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().status, 'ready');
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:3000');
    const other = await app.inject({ url: '/health/live', headers: { origin: 'https://other.example' } });
    assert.notEqual(other.headers['access-control-allow-origin'], 'https://other.example');
    assert.equal((await app.inject('/alumnos')).statusCode, 404);
  } finally { await app.close(); }
});
