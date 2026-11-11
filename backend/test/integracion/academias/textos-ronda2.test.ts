// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerAcademias, leerAuditoriaPlataforma } from '../../utilidades/datos';
import { cookieDeSesion, crearSuperadminDePrueba } from '../../utilidades/superadmins';
import { EN_BLANCO_DE_LA_SPEC, EN_BLANCO_EXTRA, NOMBRES_QUE_SE_ACEPTAN, emojis } from '../../utilidades/textos-ronda2';

// Criterios 87 y 88 (ataque ronda 2, F5 y F6) en la API de academias: `nombre` (crear) y `motivo` (suspender y reactivar).
//  - 87: no cuentan como visibles los caracteres \p{Default_Ignorable_Code_Point} ni U+2800: 400 SOLICITUD_INVALIDA que
//    nombra el campo, sin crear, cambiar ni auditar nada; "Academia Ñandú", "Club 3" y un nombre en hangul se aceptan.
//  - 88: las longitudes se cuentan por puntos de codigo: 51 emojis (102 unidades UTF-16) son un nombre valido, 101 no.
// El inicio de sesion (`clave`) esta en plataforma/sesion-textos-ronda2.test.ts.

const AHORA = new Date('2026-11-11T15:00:00.000Z');

interface ErrorCuerpo {
  codigo?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

describe('criterios 87 y 88: textos de la API de academias', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let cookie: string;

  const servidor = () => app.getHttpServer();
  const crear = (cuerpo: object) =>
    request(servidor()).post('/api/plataforma/academias').set('Cookie', cookie).send(cuerpo);
  const suspender = (id: string, cuerpo: object) =>
    request(servidor()).post(`/api/plataforma/academias/${id}/suspender`).set('Cookie', cookie).send(cuerpo);
  const reactivar = (id: string, cuerpo: object) =>
    request(servidor()).post(`/api/plataforma/academias/${id}/reactivar`).set('Cookie', cookie).send(cuerpo);

  beforeAll(async () => {
    reloj = new RelojFijo(AHORA);
    app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj),
    });
  });
  beforeEach(async () => {
    await limpiarBase();
    reloj.fijar(AHORA);
    const superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
    cookie = cookieDeSesion(superadmin, AHORA);
  });
  afterAll(async () => {
    await app?.close();
  });

  /** 400 SOLICITUD_INVALIDA con un error que nombra el campo (nunca 500). */
  function esperarRechazo(respuesta: request.Response, campo: string): void {
    expect(respuesta.status).toBe(400);
    const cuerpo = respuesta.body as ErrorCuerpo;
    expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
    expect(cuerpo.detalles?.errores?.map((error) => error.campo)).toContain(campo);
  }

  const nueva = (nombre: string) => ({ nombre, nombreCorto: 'delfines' });

  describe('criterio 87: caracteres que se ven en blanco', () => {
    it.each([...EN_BLANCO_DE_LA_SPEC, ...EN_BLANCO_EXTRA])(
      'criterio 87: crear con un nombre de %s responde 400 y no crea ni audita nada',
      async (_caso, nombre) => {
        const respuesta = await crear(nueva(nombre));

        esperarRechazo(respuesta, 'nombre');
        expect(await leerAcademias()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it.each([...EN_BLANCO_DE_LA_SPEC, ...EN_BLANCO_EXTRA])(
      'criterio 87: suspender con un motivo de %s responde 400 y la academia sigue ACTIVA, sin auditoria',
      async (_caso, motivo) => {
        const academia = await crearAcademiaDePrueba();

        const respuesta = await suspender(academia.id, { motivo });

        esperarRechazo(respuesta, 'motivo');
        const filas = await leerAcademias();
        expect(filas.map((fila) => [fila.id, fila.estado, fila.motivo_suspension])).toEqual([
          [academia.id, 'ACTIVA', null],
        ]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it.each([...EN_BLANCO_DE_LA_SPEC, ...EN_BLANCO_EXTRA])(
      'criterio 87: reactivar con un motivo de %s responde 400 y la academia sigue SUSPENDIDA, sin auditoria',
      async (_caso, motivo) => {
        const academia = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });

        const respuesta = await reactivar(academia.id, { motivo });

        esperarRechazo(respuesta, 'motivo');
        const filas = await leerAcademias();
        expect(filas.map((fila) => [fila.id, fila.estado])).toEqual([[academia.id, 'SUSPENDIDA']]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it.each(NOMBRES_QUE_SE_ACEPTAN)(
      'criterio 87: el nombre %j se acepta y se guarda tal como llega',
      async (nombre) => {
        const respuesta = await crear({ nombre, nombreCorto: 'delfines' });

        expect(respuesta.status).toBe(201);
        expect((await leerAcademias())[0]?.nombre).toBe(nombre);
      },
    );

    it('criterio 87: un nombre con tres letras y caracteres en blanco en medio se acepta (3 visibles)', async () => {
      const nombre = 'aㅤbㅤc';

      const respuesta = await crear(nueva(nombre));

      expect(respuesta.status).toBe(201);
      expect((await leerAcademias())[0]?.nombre).toBe(nombre);
    });
  });

  describe('criterio 88: longitudes por puntos de codigo', () => {
    it('criterio 88: un nombre de 51 emojis (102 unidades UTF-16) se acepta', async () => {
      const respuesta = await crear(nueva(emojis(51)));

      expect(respuesta.status).toBe(201);
      expect((await leerAcademias())[0]?.nombre).toBe(emojis(51));
    });

    it('criterio 88: un nombre de 100 emojis se acepta', async () => {
      const respuesta = await crear(nueva(emojis(100)));

      expect(respuesta.status).toBe(201);
    });

    it('criterio 88: un nombre de 101 emojis (202 unidades UTF-16) responde 400 y no crea nada', async () => {
      const respuesta = await crear(nueva(emojis(101)));

      esperarRechazo(respuesta, 'nombre');
      expect(await leerAcademias()).toEqual([]);
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    });

    it('criterio 88: un motivo de 500 emojis se acepta al suspender y uno de 501 responde 400', async () => {
      const aceptada = await crearAcademiaDePrueba({ nombreCorto: 'delfines' });
      const rechazada = await crearAcademiaDePrueba({ nombreCorto: 'tiburones' });

      const bien = await suspender(aceptada.id, { motivo: emojis(500) });
      const mal = await suspender(rechazada.id, { motivo: emojis(501) });

      expect(bien.status).toBe(200);
      esperarRechazo(mal, 'motivo');
      const estados = Object.fromEntries((await leerAcademias()).map((fila) => [fila.id, fila.estado]));
      expect(estados[aceptada.id]).toBe('SUSPENDIDA');
      expect(estados[rechazada.id]).toBe('ACTIVA');
    });

    it('criterio 88: un motivo de 500 emojis se acepta al reactivar y uno de 501 responde 400', async () => {
      const aceptada = await crearAcademiaDePrueba({ nombreCorto: 'delfines', estado: 'SUSPENDIDA' });
      const rechazada = await crearAcademiaDePrueba({ nombreCorto: 'tiburones', estado: 'SUSPENDIDA' });

      const bien = await reactivar(aceptada.id, { motivo: emojis(500) });
      const mal = await reactivar(rechazada.id, { motivo: emojis(501) });

      expect(bien.status).toBe(200);
      esperarRechazo(mal, 'motivo');
      const estados = Object.fromEntries((await leerAcademias()).map((fila) => [fila.id, fila.estado]));
      expect(estados[aceptada.id]).toBe('ACTIVA');
      expect(estados[rechazada.id]).toBe('SUSPENDIDA');
    });
  });
});
