import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { DatabaseConnection } from './database.js';

export function buildApp(options: { database: DatabaseConnection; corsOrigins: string[]; logger?: boolean }) {
  const app = Fastify({
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 10000,
  });
  app.register(cors, { origin: options.corsOrigins, methods: ['GET'] });
  app.get('/health/live', async () => ({ service: 'piscina-api', status: 'ok', version: '0.1.0' }));
  app.get('/health/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await options.database.authenticate();
      return { service: 'piscina-api', status: 'ready', version: '0.1.0' };
    } catch {
      return reply.code(503).send({ service: 'piscina-api', status: 'unavailable', version: '0.1.0' });
    }
  });
  app.setErrorHandler((_error, request, reply) => {
    request.log.error({ event: 'request_failed', requestId: request.id });
    reply.code(500).send({ error: 'No se pudo procesar la solicitud.' });
  });
  app.addHook('onClose', async () => options.database.close());
  return app;
}
