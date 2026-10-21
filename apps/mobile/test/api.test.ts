import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkApi } from '../src/api.ts';

test('móvil reconoce readiness y rechaza una respuesta contradictoria', async (context) => {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true });
  const mock = context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ service: 'piscina-api', status: 'ready' }), { status: 200 }));
  assert.equal((await checkApi('http://127.0.0.1:4000')).status, 'ready');
  mock.mock.mockImplementation(async () => new Response(JSON.stringify({ service: 'piscina-api', status: 'ready' }), { status: 503 }));
  await assert.rejects(checkApi('http://127.0.0.1:4000'), /no reconocida/);
  mock.mock.mockImplementation(async () => { throw new Error('Network failed'); });
  await assert.rejects(checkApi('http://127.0.0.1:4000'));
});

test('móvil distribuido exige HTTPS y nunca admite credenciales en URL', async () => {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  await assert.rejects(checkApi('http://api.example'), /HTTPS/);
  await assert.rejects(checkApi('https://user:secret@api.example'), /sin credenciales/);
  await assert.rejects(checkApi(undefined), /Configura/);
});
