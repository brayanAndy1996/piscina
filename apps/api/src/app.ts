import {PrivateFiles,filesRoutes} from './operations/files.js';
import {OperationsService} from './operations/service.js';
import {operationsRoutes} from './operations/routes.js';
import {AcademyService} from './academy/service.js';
import {academyRoutes} from './academy/routes.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { DatabaseConnection } from './database.js';
import rateLimit from '@fastify/rate-limit';
import type { AccessService } from './access/service.js';
import { accessRoutes } from './access/routes.js';
import { AccessError } from './access/policy.js';

export function buildApp(options: { database: DatabaseConnection; corsOrigins: string[]; logger?: boolean; access?: AccessService }) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 10000,
  });
  app.register(cors, { origin: options.corsOrigins, methods: ['GET', 'POST', 'PATCH'] });
  if (options.access) {
    app.register(async (instance) => {
      await instance.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
      accessRoutes(instance, options.access!);
      const academy=new AcademyService(options.access!);
      academyRoutes(instance,academy);
      operationsRoutes(instance,new OperationsService(academy));
      filesRoutes(instance,new PrivateFiles(academy));
    });
  }
  app.get('/health/live', async () => ({ service: 'piscina-api', status: 'ok', version: '0.3.0' }));
  app.get('/health/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await options.database.authenticate();
      return { service: 'piscina-api', status: 'ready', version: '0.3.0' };
    } catch {
      return reply.code(503).send({ service: 'piscina-api', status: 'unavailable', version: '0.3.0' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AccessError) return reply.code(error.status).send({ code: error.code, error: error.message });
    if (error && typeof error === 'object' && 'validation' in error) return reply.code(400).send({ code: 'INVALID_INPUT', error: 'Revisa los datos enviados.' });
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 429) return reply.code(429).send({ code: 'RATE_LIMIT', error: 'Demasiados intentos; espera antes de continuar.' });
    request.log.error({ event: 'request_failed', requestId: request.id });
    reply.code(500).send({ error: 'No se pudo procesar la solicitud.' });
  });
  app.addHook('onClose', async () => options.database.close());
  return app;
}
