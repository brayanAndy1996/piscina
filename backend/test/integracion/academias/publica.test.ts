// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { limpiarBase } from '../../utilidades/base-datos';
import { insertarAuditoria } from '../../utilidades/datos';

interface ErrorCuerpo {
  codigo: string;
  mensaje: string;
}

describe('GET /api/a/{nombreCorto}: la academia por su nombre corto', () => {
  let app: NestExpressApplication;
  let delfines: AcademiaDePrueba;

  const pedir = (nombreCorto: string) => request(app.getHttpServer()).get(`/api/a/${nombreCorto}`);

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
  });
  beforeEach(async () => {
    await limpiarBase();
    delfines = await crearAcademiaDePrueba({ nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' });
    await crearAcademiaDePrueba({
      nombreCorto: 'tiburones',
      nombre: 'Club de Natación Tiburones',
      estado: 'SUSPENDIDA',
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('criterio 58: academia activa', () => {
    it('criterio 58: sin sesión responde 200 con { nombreCorto, nombre } y Cache-Control: no-store', async () => {
      const respuesta = await pedir('delfines');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' });
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 58: el esquema es estricto: sin id, estado ni motivo', async () => {
      await insertarAuditoria(delfines.id);

      const respuesta = await pedir('delfines');

      expect(Object.keys(respuesta.body as object).sort()).toEqual(['nombre', 'nombreCorto']);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/estado|motivo|"id"|ACTIVA|SUSPENDIDA/i);
    });

    it.each(['Delfines', 'DELFINES', '%20delfines%20', '%20DeLfInEs'])(
      'criterio 58: el nombre corto %s se recorta y se pasa a minúsculas antes de buscarlo',
      async (nombreCorto) => {
        const respuesta = await pedir(nombreCorto);

        expect(respuesta.status).toBe(200);
        expect(respuesta.body).toEqual({ nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' });
      },
    );

    it('criterio 58: no pide sesión aunque se envíe una cookie inválida', async () => {
      const respuesta = await pedir('delfines').set('Cookie', 'aq_plataforma=invalida');

      expect(respuesta.status).toBe(200);
    });
  });

  describe('criterio 59: nombre corto inexistente o con formato inválido', () => {
    const CASOS: [string, string][] = [
      ['un nombre que no existe', 'noexiste'],
      ['una palabra reservada', 'admin'],
      ['dos puntos', '..'],
      ['un punto', '.'],
      ['%25 (el carácter %)', '%25'],
      ['un guion bajo', '_'],
      ['un solo carácter', 'a'],
      ['dos caracteres', 'ab'],
      ['31 caracteres', 'a'.repeat(31)],
      ['una "е" cirílica parecida a la "e"', encodeURIComponent('dеlfines')],
      ['un byte nulo al final', 'delfines%00'],
      ['un salto de línea en medio', 'del%0Afines'],
      ['un prefijo con comodín', 'delf%25'],
      ['guion al inicio', '-delfines'],
      ['guion al final', 'delfines-'],
      ['guiones dobles', 'del--fines'],
      ['una barra codificada', 'delfines%2F..'],
      ['un intento de inyección', encodeURIComponent("delfines' OR '1'='1")],
      ['letras turcas (İ)', encodeURIComponent('DELFİNES')],
      ['la ñ', encodeURIComponent('peñalolen')],
    ];

    it.each(CASOS)('criterio 59: %s responde 404 ACADEMIA_NO_ENCONTRADA', async (_caso, nombreCorto) => {
      const respuesta = await pedir(nombreCorto);

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_NO_ENCONTRADA');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 59: el cuerpo es el mismo en todos los casos', async () => {
      const cuerpos: unknown[] = [];
      for (const [, nombreCorto] of CASOS) cuerpos.push((await pedir(nombreCorto)).body);

      for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
    });
  });

  describe('criterio 60: academia suspendida', () => {
    it('criterio 60: responde 403 ACADEMIA_SUSPENDIDA', async () => {
      const respuesta = await pedir('tiburones');

      expect(respuesta.status).toBe(403);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 60: también con mayúsculas y espacios en la dirección, y sin filtrar el motivo', async () => {
      const respuesta = await pedir('%20Tiburones');

      expect(respuesta.status).toBe(403);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
      expect(JSON.stringify(respuesta.body)).not.toContain('Suspendida para la prueba');
    });
  });
});
