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
});
