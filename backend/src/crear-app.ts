import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule, type OpcionesApp } from './app.module';
import { ERROR_NO_ENCONTRADO } from './comun/filtros/filtro-errores';
import type { Entorno } from './infraestructura/entorno';

/** Prefijo de toda la API: la web ocupa `/` y la API `/api` en el mismo dominio (D-25). */
export const PREFIJO_API = 'api';

/**
 * Configuración común de la aplicación HTTP: prefijo `/api`, cabeceras de `helmet`, sin CORS (la web y la API
 * comparten dominio), sin `X-Powered-By` ni ETag, y cierre ordenado. Las pruebas de integración la aplican a su
 * propia aplicación. Devuelve la aplicación ya inicializada.
 */
export async function configurarApp<T extends INestApplication>(app: T): Promise<T> {
  const express = app as unknown as NestExpressApplication;
  express.setGlobalPrefix(PREFIJO_API);
  express.use(helmet());
  express.disable('x-powered-by');
  express.disable('etag');
  express.enableShutdownHooks();
  await express.init();
  // Nest solo atiende lo que está bajo el prefijo `/api`: lo demás (por ejemplo `GET /salud`) lo contesta aquí,
  // después de las rutas de Nest, con el mismo formato de error.
  express.use((_solicitud: Request, respuesta: Response) => {
    respuesta.status(404).json(ERROR_NO_ENCONTRADO);
  });
  return app;
}

/** Crea la aplicación de producción y desarrollo. No escucha: eso lo hace `main.ts`. */
export async function crearApp(entorno: Entorno, opciones: OpcionesApp = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.registrar(entorno, opciones), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  return configurarApp(app);
}
