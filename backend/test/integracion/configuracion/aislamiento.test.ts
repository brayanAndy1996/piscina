// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCION_AUDITORIA,
  esperarConfiguracion,
  exigirRutasDeConfiguracion,
  fijarConfiguracion,
  instantaneaDeConfiguracion,
  leerFilaConfiguracion,
  quitarFilaConfiguracion,
  type ValoresDeConfiguracion,
} from '../../utilidades/configuracion';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_PRUEBAS,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 4 (crítico, D-23): el aislamiento de la configuración entre academias. Un ADMIN de A solo lee y escribe filas de A: la
// respuesta nunca trae valores de B; tras el PATCH, las filas de B (valor y `actualizado_en`) y la auditoría de B siguen iguales; un
// cuerpo con `academiaId` (o cualquier campo que no sea del contrato) responde 400 sin escribir nada, y un parámetro de consulta
// (`?academiaId=<id de B>`) no cambia la academia. Lo mismo con GET /api/mi-academia (criterio 20).
// Los valores esperados están escritos aquí a mano, de forma independiente de la implementación.

const VALORES_A: ValoresDeConfiguracion = {
  toleranciaTardanzaMinutos: 20,
  diasPorVencer: 7,
  diasPrioridadRenovacion: 9,
  intentosInicioSesion: 4,
  minutosBloqueo: 30,
  telefono: '+51 999 111 222',
};
const VALORES_B: ValoresDeConfiguracion = {
  toleranciaTardanzaMinutos: 3,
  diasPorVencer: 12,
  diasPrioridadRenovacion: 2,
  intentosInicioSesion: 8,
  minutosBloqueo: 45,
  telefono: '(01) 555-0199',
};

describe('criterio 4: aislamiento de la configuración entre academias', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let adminA: string;
  let adminB: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    exigirRutasDeConfiguracion(app);
    e = await crearEscenario();
    adminA = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    adminB = cookieDeUsuario(e.adminB, AHORA_PRUEBAS);
    await fijarConfiguracion(e.A.id, VALORES_A);
    await fijarConfiguracion(e.B.id, VALORES_B);
    // Una fila de auditoría previa en B: "la auditoría de B no cambia" tiene que poder verse.
    await insertarAuditoria(e.B.id, 'ACCION_PREVIA_B');
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await app?.close();
  });

  const sinValoresDeB = (respuesta: { body: unknown }) =>
    expect(JSON.stringify(respuesta.body)).not.toContain(VALORES_B.telefono as string);

  /** Todo lo que un PATCH rechazado o ajeno no debe tocar. */
  async function estadoDeB() {
    return {
      filas: await instantaneaDeConfiguracion(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }
  async function estadoDeA() {
    return {
      filas: await instantaneaDeConfiguracion(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('GET /api/configuracion', () => {
    it('criterio 4: el ADMIN de A recibe los valores de A (los seis campos) y ninguno de B', async () => {
      const respuesta = await pedir(app, 'get', '/api/configuracion', { cookie: adminA });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, VALORES_A);
      sinValoresDeB(respuesta);
    });

    it('criterio 4: el ADMIN de B recibe los valores de B y ninguno de A', async () => {
      const respuesta = await pedir(app, 'get', '/api/configuracion', { cookie: adminB });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, VALORES_B);
      expect(JSON.stringify(respuesta.body)).not.toContain(VALORES_A.telefono as string);
    });

    it('criterio 4: una academia sin filas recibe los valores por defecto aunque la otra tenga filas (nada se hereda ni se mezcla)', async () => {
      const nuevo = await crearEscenario();
      // `crearEscenario` vació la base: A y B nuevas, sin filas de configuración; solo B recibe filas.
      await fijarConfiguracion(nuevo.B.id, VALORES_B);

      const respuesta = await pedir(app, 'get', '/api/configuracion', {
        cookie: cookieDeUsuario(nuevo.adminA, AHORA_PRUEBAS),
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, {
        toleranciaTardanzaMinutos: 10,
        diasPorVencer: 5,
        diasPrioridadRenovacion: 5,
        intentosInicioSesion: 5,
        minutosBloqueo: 15,
        telefono: null,
      });
    });

    it.each([
      ['?academiaId=<id de B>', (id: string) => `?academiaId=${id}`],
      ['?academia_id=<id de B>&academiaId=<id de B>', (id: string) => `?academia_id=${id}&academiaId=${id}`],
      ['?nombreCorto=academia-b', () => '?nombreCorto=academia-b'],
    ])(
      'criterio 4: un parámetro de consulta (%s) no cambia la academia: responde con los valores de A o 400, nunca con los de B',
      async (_nombre, consulta) => {
        const respuesta = await pedir(app, 'get', `/api/configuracion${consulta(e.B.id)}`, { cookie: adminA });

        expect([200, 400], `respondió ${respuesta.status}: ${JSON.stringify(respuesta.body)}`).toContain(
          respuesta.status,
        );
        if (respuesta.status === 200) esperarConfiguracion(respuesta.body, VALORES_A);
        sinValoresDeB(respuesta);
      },
    );

    it('criterio 4: leer no escribe nada en ninguna academia', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();

      await pedir(app, 'get', '/api/configuracion', { cookie: adminA });
      await pedir(app, 'get', '/api/configuracion', { cookie: adminB });

      expect(await estadoDeA()).toEqual(antesA);
      expect(await estadoDeB()).toEqual(antesB);
    });
  });

  describe('PATCH /api/configuracion', () => {
    it('criterio 4: el ADMIN de A cambia un campo: se escribe la fila de A, las filas de B (valor y actualizado_en) y la auditoría de B no cambian', async () => {
      const antesB = await estadoDeB();

      const respuesta = await pedir(app, 'patch', '/api/configuracion', {
        cookie: adminA,
        cuerpo: { toleranciaTardanzaMinutos: 25 },
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, { ...VALORES_A, toleranciaTardanzaMinutos: 25 });
      sinValoresDeB(respuesta);
      expect((await leerFilaConfiguracion(e.A.id, 'tolerancia_tardanza_minutos'))?.valor).toBe(25);
      expect(await estadoDeB()).toEqual(antesB);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA)).toHaveLength(1);
      expect(await contarAuditoria(e.B.id, ACCION_AUDITORIA)).toBe(0);
    });

    it('criterio 4: un cambio de los seis campos a la vez (también quitar el teléfono) en A deja a B exactamente igual', async () => {
      const antesB = await estadoDeB();

      const respuesta = await pedir(app, 'patch', '/api/configuracion', {
        cookie: adminA,
        cuerpo: {
          toleranciaTardanzaMinutos: 0,
          diasPorVencer: 15,
          diasPrioridadRenovacion: 1,
          intentosInicioSesion: 10,
          minutosBloqueo: 5,
          telefono: null,
        },
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, {
        toleranciaTardanzaMinutos: 0,
        diasPorVencer: 15,
        diasPrioridadRenovacion: 1,
        intentosInicioSesion: 10,
        minutosBloqueo: 5,
        telefono: null,
      });
      expect(await estadoDeB()).toEqual(antesB);
      // B sigue viendo lo suyo.
      const deB = await pedir(app, 'get', '/api/configuracion', { cookie: adminB });
      esperarConfiguracion(deB.body, VALORES_B);
    });

    it('criterio 4: el ADMIN de B cambia un campo: solo cambia B y A queda igual', async () => {
      const antesA = await estadoDeA();

      const respuesta = await pedir(app, 'patch', '/api/configuracion', {
        cookie: adminB,
        cuerpo: { minutosBloqueo: 60 },
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, { ...VALORES_B, minutosBloqueo: 60 });
      expect(await estadoDeA()).toEqual(antesA);
      expect(await leerAuditoriaDeAcademia(e.B.id, ACCION_AUDITORIA)).toHaveLength(1);
    });

    it('criterio 4: con ?academiaId=<id de B> en la dirección, el cambio no llega a B (se escribe en A, o se rechaza con 400 sin escribir)', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();

      const respuesta = await pedir(app, 'patch', `/api/configuracion?academiaId=${e.B.id}`, {
        cookie: adminA,
        cuerpo: { diasPorVencer: 11 },
      });

      expect([200, 400], `respondió ${respuesta.status}: ${JSON.stringify(respuesta.body)}`).toContain(
        respuesta.status,
      );
      expect(await estadoDeB()).toEqual(antesB);
      sinValoresDeB(respuesta);
      if (respuesta.status === 200) {
        expect((await leerFilaConfiguracion(e.A.id, 'dias_por_vencer'))?.valor).toBe(11);
      } else {
        expect(await estadoDeA()).toEqual(antesA);
      }
    });

    it.each([
      ['solo academiaId de B', (b: string) => ({ academiaId: b })],
      ['solo academiaId de la propia academia', (_b: string, a: string) => ({ academiaId: a })],
      ['un campo válido y academiaId de B', (b: string) => ({ toleranciaTardanzaMinutos: 25, academiaId: b })],
      ['academia_id de B', (b: string) => ({ minutosBloqueo: 20, academia_id: b })],
      ['un campo que no es del contrato (nombre)', () => ({ nombre: 'Otro nombre' })],
      ['un campo válido y otro que no es del contrato (clave)', () => ({ intentosInicioSesion: 4, clave: 'x' })],
      ['una clave de la base con su nombre interno', () => ({ tolerancia_tardanza_minutos: 25 })],
    ])(
      'criterio 4: un cuerpo con %s responde 400 SOLICITUD_INVALIDA y no escribe ni audita nada, en A ni en B',
      async (_nombre, cuerpo) => {
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await pedir(app, 'patch', '/api/configuracion', {
          cookie: adminA,
          cuerpo: cuerpo(e.B.id, e.A.id),
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );
  });

  describe('GET /api/mi-academia', () => {
    it('criterio 4 y 20: cada rol de A ve la identidad de A, con el teléfono de A', async () => {
      for (const usuario of [e.adminA, e.secretariaA, e.entrenadorA, e.alumnoA]) {
        const respuesta = await pedir(app, 'get', '/api/mi-academia', {
          cookie: cookieDeUsuario(usuario, AHORA_PRUEBAS),
        });

        expect(respuesta.status, `${usuario.rol}: ${JSON.stringify(respuesta.body)}`).toBe(200);
        expect(respuesta.body, usuario.rol).toEqual({
          academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: VALORES_A.telefono },
        });
        sinValoresDeB(respuesta);
      }
    });

    it('criterio 4 y 20: los usuarios de B ven la identidad de B', async () => {
      for (const usuario of [e.adminB, e.secretariaB, e.alumnoB]) {
        const respuesta = await pedir(app, 'get', '/api/mi-academia', {
          cookie: cookieDeUsuario(usuario, AHORA_PRUEBAS),
        });

        expect(respuesta.status, `${usuario.rol}: ${JSON.stringify(respuesta.body)}`).toBe(200);
        expect(respuesta.body, usuario.rol).toEqual({
          academia: { nombre: 'Academia B', nombreCorto: 'academia-b', telefono: VALORES_B.telefono },
        });
      }
    });

    it('criterio 4 y 20: la academia sin teléfono responde telefono null aunque la otra tenga uno', async () => {
      await quitarFilaConfiguracion(e.A.id, 'telefono');

      const respuesta = await pedir(app, 'get', '/api/mi-academia', { cookie: adminA });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(respuesta.body).toEqual({ academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: null } });
      sinValoresDeB(respuesta);
    });

    it.each([
      ['?academiaId=<id de B>', (id: string) => `?academiaId=${id}`],
      ['?nombreCorto=academia-b', () => '?nombreCorto=academia-b'],
    ])(
      'criterio 4 y 20: un parámetro de consulta (%s) no cambia la academia: responde la de la sesión o 400, nunca la de B',
      async (_nombre, consulta) => {
        const respuesta = await pedir(app, 'get', `/api/mi-academia${consulta(e.B.id)}`, { cookie: adminA });

        expect([200, 400], `respondió ${respuesta.status}: ${JSON.stringify(respuesta.body)}`).toContain(
          respuesta.status,
        );
        if (respuesta.status === 200) {
          expect(respuesta.body).toEqual({
            academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: VALORES_A.telefono },
          });
        }
        sinValoresDeB(respuesta);
        expect(JSON.stringify(respuesta.body)).not.toContain('Academia B');
      },
    );
  });
});
