import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AccessService } from './service.js';
import { AccessError, type Role } from './policy.js';

const string = { type: 'string', minLength: 1, maxLength: 200 };
const password = { type: 'string', minLength: 1, maxLength: 128 };
function body(properties: object, required: string[]) {
  return { body: { type: 'object', additionalProperties: false, required, properties } };
}
function bearer(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) throw new AccessError(401, 'UNAUTHENTICATED', 'Inicia sesión.');
  return value.slice(7);
}
export function accessRoutes(app: FastifyInstance, access: AccessService) {
  app.post<{ Body: { academy: string; username: string; password: string } }>('/auth/login', {
    schema: body({ academy: string, username: string, password }, ['academy', 'username', 'password']),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => access.login(request.body));
  app.get('/auth/me', async (request) => access.actor(bearer(request), undefined, true));
  app.post('/auth/logout', async (request) => { await access.logout(bearer(request)); return { closed: true }; });
  app.post<{ Body: { currentPassword: string; newPassword: string } }>('/auth/password', {
    schema: body({ currentPassword: password, newPassword: password }, ['currentPassword', 'newPassword']),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => access.changePassword(bearer(request), request.body.currentPassword, request.body.newPassword));
  app.get('/users', async (request) => access.users(bearer(request)));
  app.get('/roles', async (request) => access.roles(bearer(request)));
  app.post<{ Body: { username: string; displayName: string; role: Role; password: string } }>('/users', {
    schema: body({ username: string, displayName: string, role: string, password }, ['username', 'displayName', 'role', 'password']),
  }, async (request, reply) => reply.code(201).send(await access.createUser(bearer(request), request.body)));
  app.patch<{ Params: { id: string }; Body: { displayName: string; role: Role; active: boolean; version: number } }>('/users/:id', {
    schema: body({ displayName: string, role: string, active: { type: 'boolean' }, version: { type: 'integer', minimum: 1 } }, ['displayName', 'role', 'active', 'version']),
  }, async (request) => access.changeUser(bearer(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: { password: string } }>('/users/:id/reset-password', {
    schema: body({ password }, ['password']),
  }, async (request) => access.resetPassword(bearer(request), request.params.id, request.body.password));
  app.post<{ Body: { publicKey: string; purpose: string } }>('/devices/challenge', {
    schema: body({ publicKey: string, purpose: string }, ['publicKey', 'purpose']),
  }, async (request) => access.challenge(bearer(request), request.body.publicKey, request.body.purpose));
  app.post<{ Body: { challengeId: string; signature: string; name: string } }>('/devices/register', {
    schema: body({ challengeId: string, signature: string, name: string }, ['challengeId', 'signature', 'name']),
  }, async (request) => access.registerDevice(bearer(request), request.body));
  app.get('/devices', async (request) => access.devices(bearer(request)));
  app.post<{ Params: { id: string }; Body: { expectedDeviceId: string | null } }>('/devices/:id/designate', { schema: body({ expectedDeviceId: { anyOf: [string, { type: 'null' }] } }, ['expectedDeviceId']) }, async (request) => access.designate(bearer(request), request.params.id, request.body.expectedDeviceId));
  app.post<{ Params: { id: string }; Body: { challengeId: string; signature: string } }>('/devices/:id/access-sync', {
    schema: body({ challengeId: string, signature: string }, ['challengeId', 'signature']),
  }, async (request) => access.offlineAccess(bearer(request), request.params.id, request.body));
  app.get('/audit', async (request) => access.auditList(bearer(request)));
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
}
