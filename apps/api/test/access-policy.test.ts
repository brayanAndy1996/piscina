import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword, canReplaceDevice } from '../src/access/crypto.js';

test('password nunca queda en claro, cada hash usa sal y verificación rechaza incorrecta', async () => {
  const password = 'Clave personal larga 2026';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('otra contraseña', first), false);
  assert.equal(await verifyPassword(password, 'corrupto'), false);
});

test('no sustituir celular con permiso vigente; exacto vencimiento permite reemplazo', () => {
  assert.equal(canReplaceDevice(2000, 1999), false);
  assert.equal(canReplaceDevice(2000, 2000), true);
  assert.equal(canReplaceDevice(null, 0), true);
});
