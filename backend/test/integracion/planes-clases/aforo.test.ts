// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CLASE_ACTUALIZADA,
  ACCION_CLASE_CREADA,
  camposConError,
  type ClaseApi,
  type ClaseDePrueba,
  crearClaseDePrueba,
  cuerpoClase,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  leerClase,
  leerClases,
  sinCampo,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 18 (crítico, RN-11, HU-17): `aforo` es un entero de 20 a 50, con los dos extremos incluidos, al crear y al editar: 19, 51, 0,
// -20, 20.5, "30" y null responden 400 sin escribir ni auditar, y la base lo vuelve a exigir (criterio 4, en checks.test.ts).

const AFOROS_INVALIDOS: [string, unknown][] = [
  ['19', 19],
  ['51', 51],
  ['0', 0],
  ['-20', -20],
  ['20.5', 20.5],
  ['30.1', 30.1],
  ['100', 100],
  ['1000000', 1_000_000],
  ['"30" (un texto)', '30'],
  ['"" (vacío)', ''],
  ['null', null],
  ['true', true],
  ['una lista ([30])', [30]],
  ['un objeto', { aforo: 30 }],
];

describe('criterio 18: el aforo es un entero de 20 a 50', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string;
  let clase: ClaseDePrueba;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { aforo: 30 });
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await app?.close();
  });

  async function estadoDeA() {
    return {
      filas: await instantaneaDePlanesYClases(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }
  const crear = (cuerpo: Record<string, unknown>) => pedir(app, 'post', '/api/clases', { cookie: admin, cuerpo });
  const editar = (cuerpo: unknown, id = clase.id) =>
    pedir(app, 'patch', `/api/clases/${id}`, { cookie: admin, cuerpo });

  describe('al crear (POST /api/clases)', () => {
    it.each([20, 50, 21, 49, 35])('criterio 18: el aforo %i se acepta, se guarda y se audita', async (aforo) => {
      const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { diaSemana: 2, aforo }));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      const creada = (respuesta.body as { clase: ClaseApi }).clase;
      expect(creada.aforo).toBe(aforo);
      expect((await leerClase(e.A.id, creada.id))?.aforo).toBe(aforo);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_CREADA);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.datos_despues).toMatchObject({ aforo });
    });

    it.each(AFOROS_INVALIDOS)(
      'criterio 18: el aforo %s responde 400 SOLICITUD_INVALIDA con el error en aforo y no escribe ni audita nada',
      async (_nombre, aforo) => {
        const antes = await estadoDeA();

        const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { diaSemana: 2, aforo }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('aforo');
        expect(await estadoDeA()).toEqual(antes);
        expect(await leerClases(e.A.id)).toHaveLength(1);
      },
    );

    it('criterio 18: sin aforo responde 400 con el error en aforo y no escribe ni audita nada', async () => {
      const antes = await estadoDeA();

      const respuesta = await crear(sinCampo(cuerpoClase(e.entrenadorA.id, { diaSemana: 2 }), 'aforo'));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(camposConError(respuesta)).toContain('aforo');
      expect(await estadoDeA()).toEqual(antes);
    });
  });

  describe('al editar (PATCH /api/clases/{id})', () => {
    it.each([20, 50, 21, 49])(
      'criterio 18: cambiar el aforo a %i se acepta, se guarda y se audita con el antes y el después',
      async (aforo) => {
        const respuesta = await editar({ aforo });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
        expect((respuesta.body as { clase: ClaseApi }).clase.aforo).toBe(aforo);
        expect((await leerClase(e.A.id, clase.id))?.aforo).toBe(aforo);
        const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
        expect(auditoria).toHaveLength(1);
        expect(auditoria[0]?.datos_antes).toMatchObject({ aforo: 30 });
        expect(auditoria[0]?.datos_despues).toMatchObject({ aforo });
      },
    );

    it.each(AFOROS_INVALIDOS)(
      'criterio 18: cambiar el aforo a %s responde 400 SOLICITUD_INVALIDA con el error en aforo, no escribe ni audita nada y la clase conserva su aforo',
      async (_nombre, aforo) => {
        const antes = await estadoDeA();

        const respuesta = await editar({ aforo });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('aforo');
        expect(await estadoDeA()).toEqual(antes);
        expect((await leerClase(e.A.id, clase.id))?.aforo).toBe(30);
      },
    );

    it('criterio 18: un aforo inválido junto a un cambio válido (activo) tampoco escribe nada: el cuerpo se rechaza entero', async () => {
      const antes = await estadoDeA();

      const respuesta = await editar({ aforo: 19, activo: false });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(camposConError(respuesta)).toContain('aforo');
      expect(await estadoDeA()).toEqual(antes);
      expect((await leerClase(e.A.id, clase.id))?.activo).toBe(true);
    });

    it('criterio 18: el aforo inválido sobre una clase que no existe responde 400 (el cuerpo se comprueba antes que la operación)', async () => {
      const respuesta = await editar({ aforo: 51 }, '00000000-0000-4000-8000-000000000000');

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(camposConError(respuesta)).toContain('aforo');
    });
  });
});
