// spec: 001-academias-aislamiento (pruebas protegidas)
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/crear-app';
import { type Entorno, validarEntorno } from '../../src/infraestructura/entorno';
import { urlAppPruebas } from './base-datos';

/** Secreto para firmar las sesiones en las pruebas (32 o más caracteres). Distinto del de `.env.example`. */
export const JWT_SECRETO_PRUEBAS = 'secreto-solo-para-pruebas-de-aquagestion-0123456789';

const URL_SIN_USO = 'postgresql://usuario:clave@127.0.0.1:1/base_sin_uso';

function esUrlPostgres(valor: string | undefined): valor is string {
  if (!valor) return false;
  try {
    const { protocol } = new URL(valor);
    return protocol === 'postgresql:' || protocol === 'postgres:';
  } catch {
    return false;
  }
}

/**
 * Entorno de pruebas: por defecto, la API se conecta como `aquagestion_app` a la base de pruebas, con
 * `JWT_SECRETO_PRUEBAS`, `PUERTO_API=3000` y `NODE_ENV=test`. `variables` reemplaza o quita variables (un valor
 * `undefined` la deja ausente), por ejemplo `DATABASE_URL_APP`, `NODE_ENV` o `DATABASE_POOL_MAX`.
 */
export function crearEntornoDePruebas(variables: Record<string, string | undefined> = {}): Entorno {
  const urlApp = 'DATABASE_URL_APP' in variables ? variables['DATABASE_URL_APP'] : urlAppPruebas();
  return validarEntorno({
    DATABASE_URL_APP: urlApp,
    JWT_SECRETO: JWT_SECRETO_PRUEBAS,
    PUERTO_API: '3000',
    NODE_ENV: 'test',
    // Compatibilidad con la historia 000: su `validarEntorno` anterior exige `DATABASE_URL`. La 001 lo ignora (la API
    // ya no lo lee, criterio 5). Es siempre una URL válida, para que ninguna prueba falle por esta variable.
    DATABASE_URL: esUrlPostgres(urlApp) ? urlApp : (process.env['DATABASE_URL_PRUEBAS'] ?? URL_SIN_USO),
    ...variables,
  });
}

export interface OpcionesAppDePruebas {
  /** Reemplaza variables de entorno de la API (`DATABASE_URL_APP`, `NODE_ENV`, `DATABASE_POOL_MAX`, …). */
  readonly variables?: Record<string, string | undefined>;
  /** Permite reemplazar proveedores (por ejemplo, `RELOJ` con `RelojFijo`). */
  readonly ajustar?: (constructor: TestingModuleBuilder) => TestingModuleBuilder;
  /** Controladores extra, por ejemplo uno de prueba que llama a `BaseDatos`. */
  readonly controladores?: Type<unknown>[];
  readonly nivelRegistro?: string;
  readonly destinoRegistro?: DestinationStream;
}

/**
 * Crea la aplicación completa, configurada igual que en producción (`configurarApp`), lista para `supertest`:
 * `request(app.getHttpServer())`. Quien la crea debe cerrarla con `await app.close()`.
 */
export async function crearAppDePruebas(opciones: OpcionesAppDePruebas = {}): Promise<NestExpressApplication> {
  const { variables, ajustar, controladores, nivelRegistro, destinoRegistro } = opciones;
  const entorno = crearEntornoDePruebas(variables);
  let constructor = Test.createTestingModule({
    imports: [AppModule.registrar(entorno, { nivelRegistro, destinoRegistro })],
    controllers: controladores ?? [],
  });
  if (ajustar) constructor = ajustar(constructor);
  const modulo = await constructor.compile();
  const app = modulo.createNestApplication<NestExpressApplication>();
  // Igual que en `crearApp`: lo que se registra con el `Logger` de Nest también va al registrador de pino.
  app.useLogger(app.get(Logger));
  await configurarApp(app);
  return app;
}
