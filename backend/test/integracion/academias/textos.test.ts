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
import {
  BIDI,
  CONTROLES,
  NOMBRES_VALIDOS,
  POCO_VISIBLES,
  SEPARADORES,
  SUSTITUTO_SUELTO,
} from '../../utilidades/textos';

// Criterios 76 y 77 (ataque ronda 1, O1 y O2) en la API de academias: `nombre` y `nombreCorto` (crear) y `motivo`
// (suspender y reactivar). El inicio de sesion (`correo` y `clave`) esta en sesion-textos.test.ts.
//  - 76: un caracter de control (\p{Cc}) despues del recorte, o un sustituto suelto: 400 SOLICITUD_INVALIDA con
//    detalles.errores que nombra el campo; nunca 500; sin escribir, cambiar ni auditar nada.
//  - 77: `nombre` y `motivo`, ademas: sin control bidireccional, sin U+2028 ni U+2029 y con al menos 3 caracteres
//    visibles (\p{L}, \p{N}, \p{P}, \p{S}).

const AHORA = new Date('2026-11-11T15:00:00.000Z');

interface ErrorCuerpo {
  codigo?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

describe('criterios 76 y 77: textos de la API de academias', () => {
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

  async function esperarSinAcademiaNiAuditoria(): Promise<void> {
    expect(await leerAcademias()).toEqual([]);
    expect(await leerAuditoriaPlataforma()).toEqual([]);
  }

  /** Cuerpo valido de creacion, con el campo de prueba reemplazado. */
  const nueva = (cambio: { nombre?: string; nombreCorto?: string }) => ({
    nombre: 'Academia de Natacion Los Delfines',
    nombreCorto: 'delfines',
    ...cambio,
  });

  describe('criterio 76: caracteres de control en crear una academia', () => {
    it.each(CONTROLES)('criterio 76: nombre con %s en medio responde 400 y no crea nada', async (_nombre, control) => {
      const respuesta = await crear(nueva({ nombre: `Academia${control}Delfines` }));

      esperarRechazo(respuesta, 'nombre');
      await esperarSinAcademiaNiAuditoria();
    });

    it.each([
      ['nulo al comienzo', '\u0000Academia Delfines'],
      ['nulo al final', 'Academia Delfines\u0000'],
      ['U+007F al final', 'Academia Delfines\u007f'],
      ['U+0085 al final (no es un espacio para el recorte)', 'Academia Delfines\u0085'],
    ])('criterio 76: nombre con %s responde 400 y no crea nada', async (_caso, nombre) => {
      const respuesta = await crear(nueva({ nombre }));

      esperarRechazo(respuesta, 'nombre');
      await esperarSinAcademiaNiAuditoria();
    });

    it('criterio 76: los saltos de linea y tabuladores de los extremos se recortan: el nombre se acepta y se guarda recortado', async () => {
      const respuesta = await crear(nueva({ nombre: '\n  Academia Ñandú \t' }));

      expect(respuesta.status).toBe(201);
      expect((await leerAcademias())[0]?.nombre).toBe('Academia Ñandú');
    });

    it.each(CONTROLES)(
      'criterio 76: nombreCorto con %s en medio responde 400 y no crea nada',
      async (_nombre, control) => {
        const respuesta = await crear(nueva({ nombreCorto: `del${control}fines` }));

        esperarRechazo(respuesta, 'nombreCorto');
        await esperarSinAcademiaNiAuditoria();
      },
    );

    it.each([
      ['nulo al comienzo', '\u0000delfines'],
      ['nulo al final', 'delfines\u0000'],
    ])('criterio 76: nombreCorto con %s responde 400 y no crea nada', async (_caso, nombreCorto) => {
      const respuesta = await crear(nueva({ nombreCorto }));

      esperarRechazo(respuesta, 'nombreCorto');
      await esperarSinAcademiaNiAuditoria();
    });

    it('criterio 76: nombre con un sustituto UTF-16 suelto responde 400 y no crea nada', async () => {
      const respuesta = await crear(nueva({ nombre: `Del${SUSTITUTO_SUELTO}fines` }));

      esperarRechazo(respuesta, 'nombre');
      await esperarSinAcademiaNiAuditoria();
    });

    it('criterio 76: nombreCorto con un sustituto UTF-16 suelto responde 400 y no crea nada', async () => {
      const respuesta = await crear(nueva({ nombreCorto: `del${SUSTITUTO_SUELTO}fines` }));

      esperarRechazo(respuesta, 'nombreCorto');
      await esperarSinAcademiaNiAuditoria();
    });
  });

  describe('criterio 77: el nombre de la academia', () => {
    it.each(BIDI)('criterio 77: nombre con el control bidireccional %s responde 400 y no crea nada', async (_n, c) => {
      const respuesta = await crear(nueva({ nombre: `Delfines${c}Club` }));

      esperarRechazo(respuesta, 'nombre');
      await esperarSinAcademiaNiAuditoria();
    });

    it.each([
      ['al final', 'Delfines\u202e'],
      ['envolviendo el texto', '\u2066Delfines\u2069'],
    ])('criterio 77: nombre con control bidireccional %s (ejemplos de la spec) responde 400', async (_caso, nombre) => {
      const respuesta = await crear(nueva({ nombre }));

      esperarRechazo(respuesta, 'nombre');
      await esperarSinAcademiaNiAuditoria();
    });

    it.each(SEPARADORES)('criterio 77: nombre con %s responde 400 y no crea nada', async (_nombre, separador) => {
      const respuesta = await crear(nueva({ nombre: `Delfines${separador}Club` }));

      esperarRechazo(respuesta, 'nombre');
      await esperarSinAcademiaNiAuditoria();
    });

    it.each(POCO_VISIBLES)(
      'criterio 77: nombre con menos de 3 caracteres visibles (%s) responde 400 y no crea nada',
      async (_caso, nombre) => {
        const respuesta = await crear(nueva({ nombre }));

        esperarRechazo(respuesta, 'nombre');
        await esperarSinAcademiaNiAuditoria();
      },
    );

    it.each(NOMBRES_VALIDOS.map((nombre, i) => [nombre, `valido-${i}`] as const))(
      'criterio 77: el nombre %j se acepta y se guarda tal como llega',
      async (nombre, nombreCorto) => {
        const respuesta = await crear({ nombre, nombreCorto });

        expect(respuesta.status).toBe(201);
        expect((respuesta.body as { academia: { nombre: string } }).academia.nombre).toBe(nombre);
        expect((await leerAcademias())[0]?.nombre).toBe(nombre);
      },
    );
  });

  describe.each([
    ['suspender', (id: string, cuerpo: object) => suspender(id, cuerpo), 'ACTIVA'],
    ['reactivar', (id: string, cuerpo: object) => reactivar(id, cuerpo), 'SUSPENDIDA'],
  ] as const)('criterios 76 y 77: el motivo al %s', (nombreOperacion, operar, estadoInicial) => {
    async function academiaInicial() {
      const academia = await crearAcademiaDePrueba({ estado: estadoInicial });
      const antes = await leerAcademias();
      return { academia, antes };
    }

    async function esperarSinCambios(antes: Awaited<ReturnType<typeof leerAcademias>>): Promise<void> {
      expect(await leerAcademias()).toEqual(antes);
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    }

    it.each(CONTROLES)(
      `criterio 76: motivo con %s en medio responde 400 y no cambia la academia (${nombreOperacion})`,
      async (_nombre, control) => {
        const { academia, antes } = await academiaInicial();

        const respuesta = await operar(academia.id, { motivo: `Falta${control}de pago` });

        esperarRechazo(respuesta, 'motivo');
        await esperarSinCambios(antes);
      },
    );

    it(`criterio 76: motivo con nulo al final responde 400 y no cambia la academia (${nombreOperacion})`, async () => {
      const { academia, antes } = await academiaInicial();

      const respuesta = await operar(academia.id, { motivo: 'Falta de pago\u0000' });

      esperarRechazo(respuesta, 'motivo');
      await esperarSinCambios(antes);
    });

    it(`criterio 76: motivo con un sustituto UTF-16 suelto responde 400 y no cambia la academia (${nombreOperacion})`, async () => {
      const { academia, antes } = await academiaInicial();

      const respuesta = await operar(academia.id, { motivo: `Falta${SUSTITUTO_SUELTO}de pago` });

      esperarRechazo(respuesta, 'motivo');
      await esperarSinCambios(antes);
    });

    it.each(BIDI)(
      `criterio 77: motivo con el control bidireccional %s responde 400 y no cambia la academia (${nombreOperacion})`,
      async (_nombre, control) => {
        const { academia, antes } = await academiaInicial();

        const respuesta = await operar(academia.id, { motivo: `Falta${control}de pago` });

        esperarRechazo(respuesta, 'motivo');
        await esperarSinCambios(antes);
      },
    );

    it.each(SEPARADORES)(
      `criterio 77: motivo con %s responde 400 y no cambia la academia (${nombreOperacion})`,
      async (_nombre, separador) => {
        const { academia, antes } = await academiaInicial();

        const respuesta = await operar(academia.id, { motivo: `Falta${separador}de pago` });

        esperarRechazo(respuesta, 'motivo');
        await esperarSinCambios(antes);
      },
    );

    it.each(POCO_VISIBLES)(
      `criterio 77: motivo con menos de 3 caracteres visibles (%s) responde 400 y no cambia la academia (${nombreOperacion})`,
      async (_caso, motivo) => {
        const { academia, antes } = await academiaInicial();

        const respuesta = await operar(academia.id, { motivo });

        esperarRechazo(respuesta, 'motivo');
        await esperarSinCambios(antes);
      },
    );

    it(`criterio 77: un motivo con letras, numeros y puntuacion se acepta y se guarda recortado (${nombreOperacion})`, async () => {
      const { academia } = await academiaInicial();

      const respuesta = await operar(academia.id, { motivo: '  Cuota atrasada: 2 meses \n' });

      expect(respuesta.status).toBe(200);
      const filas = await leerAcademias();
      expect(filas[0]?.estado).toBe(estadoInicial === 'ACTIVA' ? 'SUSPENDIDA' : 'ACTIVA');
      const auditoria = await leerAuditoriaPlataforma();
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.motivo).toBe('Cuota atrasada: 2 meses');
    });
  });
});
