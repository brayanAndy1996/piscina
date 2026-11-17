import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  crearPlanDePrueba,
  cuerpoPlan,
  type ClientePC,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  type PlanApi,
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

// Criterio 34 (ronda 1 del ataque adversarial, DT-6): dos nombres de plan que se ven iguales son el mismo. El nombre se normaliza
// (NFC, espacios Unicode a un espacio, sin caracteres de formato invisibles, espacios colapsados y recortados) antes de validar,
// guardar y comparar. La unicidad sigue sin distinguir mayúsculas.

const NOMBRES_QUE_CHOCAN_CON_PLAN_MENSUAL = [
  ['espacio de ancho cero dentro de una palabra', 'Plan Men​sual'],
  ['espacio de ancho cero antes de una palabra', 'Plan ​Mensual'],
  ['espacio no separable (U+00A0)', 'Plan Mensual'],
  ['espacio ideográfico (U+3000)', 'Plan　Mensual'],
  ['dos espacios', 'Plan  Mensual'],
  ['guion suave (U+00AD)', 'Plan Men­sual'],
  ['marca de orden de bytes (U+FEFF) al inicio', '﻿Plan Mensual'],
  ['otra capitalización con espacio no separable', 'PLAN mensual'],
] as const;

// Ronda 2 (F2-1 y F2-2): NFC al final, tras quitar los invisibles, y todos los Default_Ignorable_Code_Point salvo los bidireccionales.
const NOMBRES_RONDA_2_QUE_CHOCAN_CON_PLAN_NATACION = [
  ['U+200B entre la letra y la tilde suelta', 'Plan Natacio\u200B\u0301n'],
  ['U+00AD entre la letra y la tilde suelta', 'Plan Natacio\u00AD\u0301n'],
  ['U+FEFF entre la letra y la tilde suelta', 'Plan Natacio\uFEFF\u0301n'],
  ['U+2060 entre la letra y la tilde suelta', 'Plan Natacio\u2060\u0301n'],
  ['NFD sin invisibles', 'Plan Natacio\u0301n'],
  ['unión de grafemas U+034F', 'Plan Nat\u034Fación'],
  ['selector de variación U+FE0F', 'Plan Natación\uFE0F'],
  ['selector de variación suplementario U+E0100', 'Plan Nat\u{E0100}ación'],
  ['selector mongol U+180B', 'Plan Nat\u180Bación'],
  ['U+17B4', 'Plan Nat\u17B4ación'],
  ['relleno de hangul U+3164', 'Plan Nat\u3164ación'],
  ['relleno de hangul U+FFA0', 'Plan Nat\uFFA0ación'],
  ['braille en blanco U+2800 como espacio', 'Plan\u2800Natación'],
] as const;

const NOMBRES_RONDA_2_QUE_CHOCAN_CON_PLAN_ORO = [
  ['selector de variación U+FE0F al final', 'Plan Oro\uFE0F'],
  ['selector de variación U+FE0E dentro', 'Plan O\uFE0Ero'],
  ['unión de grafemas U+034F', 'Plan O\u034Fro'],
  ['braille en blanco U+2800 al final', 'Plan Oro\u2800'],
] as const;

describe('planes: nombres normalizados (criterio 34, API)', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let admin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  async function estadoDeA() {
    return {
      filas: await instantaneaDePlanesYClases(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }
  const crear = (cuerpo: unknown) => pedir(app, 'post', '/api/planes', { cookie: admin, cuerpo });
  const editar = (id: string, cuerpo: unknown) => pedir(app, 'patch', `/api/planes/${id}`, { cookie: admin, cuerpo });
  const planDe = (respuesta: { body: unknown }) => (respuesta.body as { plan: PlanApi }).plan;

  it.each(NOMBRES_QUE_CHOCAN_CON_PLAN_MENSUAL)(
    'criterio 34: %s: crear y renombrar responden 409 NOMBRE_PLAN_EN_USO sin escribir ni auditar',
    async (_nombre, texto) => {
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan Mensual' });
      const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan' });
      const antes = await estadoDeA();

      const creado = await crear(cuerpoPlan({ nombre: texto }));
      const renombrado = await editar(otro.id, { nombre: texto });

      expect(creado.status, JSON.stringify(creado.body)).toBe(409);
      expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(renombrado.status, JSON.stringify(renombrado.body)).toBe(409);
      expect((renombrado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(await estadoDeA()).toEqual(antes);
    },
  );

  it.each(NOMBRES_RONDA_2_QUE_CHOCAN_CON_PLAN_NATACION)(
    'F2: %s: crear y renombrar responden 409 NOMBRE_PLAN_EN_USO sin escribir ni auditar',
    async (_nombre, texto) => {
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan Natación'.normalize('NFC') });
      const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan' });
      const antes = await estadoDeA();

      const creado = await crear(cuerpoPlan({ nombre: texto }));
      const renombrado = await editar(otro.id, { nombre: texto });

      expect(creado.status, JSON.stringify(creado.body)).toBe(409);
      expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(renombrado.status, JSON.stringify(renombrado.body)).toBe(409);
      expect((renombrado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(await estadoDeA()).toEqual(antes);
    },
  );

  it.each(NOMBRES_RONDA_2_QUE_CHOCAN_CON_PLAN_ORO)(
    'F2-2: %s choca con "Plan Oro" al crear y al renombrar',
    async (_nombre, texto) => {
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan Oro' });
      const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan' });
      const antes = await estadoDeA();

      const creado = await crear(cuerpoPlan({ nombre: texto }));
      const renombrado = await editar(otro.id, { nombre: texto });

      expect(creado.status, JSON.stringify(creado.body)).toBe(409);
      expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(renombrado.status, JSON.stringify(renombrado.body)).toBe(409);
      expect((renombrado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(await estadoDeA()).toEqual(antes);
    },
  );

  it('F2-1: el nombre guardado y devuelto está en NFC aunque el invisible esté entre la letra y la tilde', async () => {
    const respuesta = await crear(cuerpoPlan({ nombre: 'Plan Natacio\u200B\u0301n' }));

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
    expect(planDe(respuesta).nombre).toBe('Plan Natación'.normalize('NFC'));
    expect(planDe(respuesta).nombre).toBe(planDe(respuesta).nombre.normalize('NFC'));
  });

  it('F2-1: jamo de hangul separados por U+200B chocan con la sílaba compuesta', async () => {
    await crearPlanDePrueba(e.A.id, { nombre: 'Plan \uD55C' });
    const antes = await estadoDeA();

    const creado = await crear(cuerpoPlan({ nombre: 'Plan \u1112\u200B\u1161\u200B\u11AB' }));

    expect(creado.status, JSON.stringify(creado.body)).toBe(409);
    expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
    expect(await estadoDeA()).toEqual(antes);
  });

  it('F2-2: renombrar con el mismo nombre más invisibles nuevos es "sin cambios" (200 sin auditoría)', async () => {
    const plan = await crearPlanDePrueba(e.A.id, { nombre: 'Plan Oro' });
    const antes = await estadoDeA();

    const respuesta = await editar(plan.id, { nombre: 'Plan\u2800Oro\uFE0F' });

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    expect(planDe(respuesta).nombre).toBe('Plan Oro');
    expect(await estadoDeA()).toEqual(antes);
  });

  it('criterio 34: "Natación" en NFD (a + U+0301) choca con "Natación" en NFC al crear y al renombrar', async () => {
    await crearPlanDePrueba(e.A.id, { nombre: 'Natación'.normalize('NFC') });
    const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan' });
    const nfd = 'Natación'.normalize('NFD');
    expect(nfd).not.toBe('Natación'.normalize('NFC'));
    const antes = await estadoDeA();

    const creado = await crear(cuerpoPlan({ nombre: nfd }));
    const renombrado = await editar(otro.id, { nombre: nfd });

    expect(creado.status, JSON.stringify(creado.body)).toBe(409);
    expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
    expect(renombrado.status, JSON.stringify(renombrado.body)).toBe(409);
    expect((renombrado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
    expect(await estadoDeA()).toEqual(antes);
  });

  it('criterio 34: el nombre que se guarda y se devuelve es el normalizado (un solo espacio normal, NFC)', async () => {
    const respuesta = await crear(cuerpoPlan({ nombre: ' ​Plan　  Men​sual ' }));

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
    expect(planDe(respuesta).nombre).toBe('Plan Mensual');
    const nfd = await crear(cuerpoPlan({ nombre: 'Natación'.normalize('NFD') }));
    expect(nfd.status, JSON.stringify(nfd.body)).toBe(201);
    expect(planDe(nfd).nombre).toBe('Natación'.normalize('NFC'));
  });

  it('criterio 34: renombrar un plan con su mismo nombre y solo espacios invisibles distintos es "sin cambios" (200 sin auditoría)', async () => {
    const plan = await crearPlanDePrueba(e.A.id, { nombre: 'Plan Mensual' });
    const antes = await estadoDeA();

    const respuesta = await editar(plan.id, { nombre: 'Plan ​Mensual ' });

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    expect(planDe(respuesta).nombre).toBe('Plan Mensual');
    expect(await estadoDeA()).toEqual(antes);
  });

  it.each([
    ['solo caracteres invisibles', '​​​​'],
    ['menos de 3 visibles tras normalizar', 'a​  b'],
    ['control bidireccional (U+202E)', 'Plan‮Mensual'],
    ['marca de dirección (U+200F)', 'Plan‏Mensual'],
    ['solo invisibles nuevos y braille en blanco', '\u034F\uFE0F\u2800\u180B'],
    ['menos de 3 visibles con invisibles nuevos', 'a\u034F\u2800\uFE0Fb'],
    ['control bidireccional entre invisibles nuevos', 'Plan\u034F\u202E\uFE0FMensual'],
    ['isolate bidireccional (U+2067)', 'Plan\u2067Mensual'],
    ['marca de letra árabe (U+061C)', 'Plan\u061CMensual'],
  ])('criterio 34: %s responde 400 sin escribir', async (_nombre, texto) => {
    const antes = await estadoDeA();

    const respuesta = await crear(cuerpoPlan({ nombre: texto }));

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
    expect(await estadoDeA()).toEqual(antes);
  });

  it('criterio 34: los 80 caracteres se miden sobre el nombre normalizado', async () => {
    const justo = `${'a'.repeat(40)}\u200B\u00A0\u00A0${'b'.repeat(39)}`; // normalizado: 40 + 1 + 39 = 80
    const largo = `${'a'.repeat(40)} ${'b'.repeat(40)}`; // normalizado: 81

    const aceptado = await crear(cuerpoPlan({ nombre: justo }));
    const rechazado = await crear(cuerpoPlan({ nombre: largo }));

    expect(aceptado.status, JSON.stringify(aceptado.body)).toBe(201);
    expect(planDe(aceptado).nombre).toHaveLength(80);
    expect(rechazado.status).toBe(400);
  });

  it('F2-2: los 80 caracteres se miden tras quitar invisibles nuevos y tratar U+2800 como espacio', async () => {
    const justo = `${'a'.repeat(40)}\u2800\u034F\uFE0F\u2800${'b'.repeat(39)}`; // normalizado: 40 + 1 + 39 = 80
    const largo = `${'a'.repeat(40)}\u2800${'b'.repeat(40)}`; // normalizado: 81

    const aceptado = await crear(cuerpoPlan({ nombre: justo }));
    const rechazado = await crear(cuerpoPlan({ nombre: largo }));

    expect(aceptado.status, JSON.stringify(aceptado.body)).toBe(201);
    expect(planDe(aceptado).nombre).toHaveLength(80);
    expect(rechazado.status).toBe(400);
  });
});
