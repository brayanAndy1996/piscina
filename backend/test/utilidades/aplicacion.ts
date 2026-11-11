import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule, type OpcionesApp } from '../../src/app.module';
import { configurarApp } from '../../src/crear-app';
import { type Entorno, validarEntorno } from '../../src/infraestructura/entorno';

/** Entorno de pruebas: por defecto apunta a la base de pruebas que dejó lista el `globalSetup`. */
export function crearEntornoDePruebas(databaseUrl: string | undefined = process.env['DATABASE_URL']): Entorno {
  return validarEntorno({ DATABASE_URL: databaseUrl, PUERTO_API: '3000', NODE_ENV: 'test' });
}

export interface OpcionesAppDePruebas extends OpcionesApp {
  readonly databaseUrl?: string;
  /** Permite reemplazar proveedores (por ejemplo, `RELOJ` con `RelojFijo`) o agregar controladores. */
  readonly ajustar?: (constructor: TestingModuleBuilder) => TestingModuleBuilder;
  readonly controladores?: Type<unknown>[];
}

/**
 * Crea la aplicación completa, configurada igual que en producción (`configurarApp`), lista para `supertest`:
 * `request(app.getHttpServer())`. Quien la crea debe cerrarla con `await app.close()`.
 */
export async function crearAppDePruebas(opciones: OpcionesAppDePruebas = {}): Promise<NestExpressApplication> {
  const { databaseUrl, ajustar, controladores, ...opcionesApp } = opciones;
  const entorno = crearEntornoDePruebas(databaseUrl);
  let constructor = Test.createTestingModule({
    imports: [AppModule.registrar(entorno, opcionesApp)],
    controllers: controladores ?? [],
  });
  if (ajustar) constructor = ajustar(constructor);
  const modulo = await constructor.compile();
  const app = modulo.createNestApplication<NestExpressApplication>();
  await configurarApp(app);
  return app;
}
