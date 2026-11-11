import { Controller, Get, Res } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorApiSchema } from '@aquagestion/contratos';
import type { Response } from 'express';
import request from 'supertest';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../test/utilidades/aplicacion';

// Una URL que nunca se usa: estas pruebas no consultan la base (no hace falta PostgreSQL).
const URL_SIN_USO = 'postgresql://usuario:clave@127.0.0.1:1/base_sin_uso';

@Controller('prueba')
class ControladorDePrueba {
  @Get('falla')
  falla(): never {
    throw new Error('detalle-interno-secreto');
  }

  @Get('cookie')
  cookie(@Res({ passthrough: true }) respuesta: Response): { ok: boolean } {
    respuesta.setHeader('Set-Cookie', 'sesion=VALOR-SET-COOKIE; HttpOnly');
    return { ok: true };
  }
}

/** Destino de registros en memoria: una línea JSON por entrada. */
function crearDestino() {
  const lineas: string[] = [];
  const destino = new Writable({
    write(trozo: Buffer, _codificacion, listo) {
      lineas.push(...trozo.toString('utf8').split('\n').filter(Boolean));
      listo();
    },
  });
  return { destino, lineas };
}

async function esperar(condicion: () => boolean): Promise<void> {
  const limite = Date.now() + 2000;
  while (!condicion() && Date.now() < limite) await new Promise((resolver) => setTimeout(resolver, 10));
}

describe('aplicación completa (sin base de datos)', () => {
  // nestjs-pino crea un único registrador por proceso: la aplicación y su destino se comparten en todo el archivo.
  const { destino, lineas } = crearDestino();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas({
      databaseUrl: URL_SIN_USO,
      controladores: [ControladorDePrueba],
      nivelRegistro: 'info',
      destinoRegistro: destino,
    });
  });
  beforeEach(() => {
    lineas.length = 0;
  });
  afterAll(async () => {
    await app.close();
  });

  it('un error no controlado en un controlador responde 500 ERROR_INTERNO y se registra con su traza', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/prueba/falla');

    expect(respuesta.status).toBe(500);
    expect(errorApiSchema.parse(respuesta.body)).toEqual({
      codigo: 'ERROR_INTERNO',
      mensaje: 'Ocurrió un error inesperado. Intenta de nuevo más tarde.',
    });
    expect(respuesta.text).not.toContain('detalle-interno-secreto');

    await esperar(() => lineas.some((linea) => linea.includes('detalle-interno-secreto')));
    const entradas = lineas.map((linea) => JSON.parse(linea) as { level: number; err?: { stack?: string } });
    const error = entradas.find((entrada) => entrada.err?.stack?.includes('detalle-interno-secreto'));
    expect(error?.level).toBe(50); // 50 = error en pino
    expect(error?.err?.stack).toContain('detalle-interno-secreto');
  });

  it('el registro no contiene los valores de cookie, authorization ni set-cookie', async () => {
    await request(app.getHttpServer())
      .get('/api/prueba/cookie')
      .set('Cookie', 'sesion=VALOR-COOKIE')
      .set('Authorization', 'Bearer VALOR-TOKEN');

    await esperar(() => lineas.some((linea) => linea.includes('"res"')));
    const todo = lineas.join('\n');
    expect(todo).not.toContain('VALOR-COOKIE');
    expect(todo).not.toContain('VALOR-TOKEN');
    expect(todo).not.toContain('VALOR-SET-COOKIE');

    type Entrada = { req?: { headers: Record<string, string> }; res?: { headers: Record<string, string> } };
    const entradas: Entrada[] = lineas.map((linea) => JSON.parse(linea) as Entrada);
    const entrada = entradas.find((registro) => registro.req !== undefined && registro.res !== undefined);
    expect(entrada?.req?.headers['cookie']).toBe('[Redactado]');
    expect(entrada?.req?.headers['authorization']).toBe('[Redactado]');
    expect(entrada?.res?.headers['set-cookie']).toBe('[Redactado]');
  });

  it('los registros salen en JSON (una entrada por línea)', async () => {
    await request(app.getHttpServer()).get('/api/no-existe');

    await esperar(() => lineas.length > 0);
    expect(lineas.length).toBeGreaterThan(0);
    for (const linea of lineas) expect(() => void JSON.parse(linea)).not.toThrow();
  });
});
