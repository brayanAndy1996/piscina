import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  crearPlanDePrueba,
  cuerpoPlan,
  type ClientePC,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
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

// Unicidad del nombre del plan sin distinguir mayúsculas en letras acentuadas y la eñe. Si la base se creó con el locale C/POSIX,
// `lower()` de PostgreSQL no cambia las letras fuera de ASCII y estas parejas dejarían de chocar: esta prueba hace que la
// integración continua detecte esa base mal creada.

const PAREJAS = [
  ['Plan Natación', 'PLAN NATACIÓN'],
  ['plan ñandú', 'PLAN ÑANDÚ'],
  ['Única', 'ÚNICA'],
] as const;

describe('planes: nombre sin distinguir mayúsculas en letras acentuadas', () => {
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
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  it.each(PAREJAS)(
    '"%s" y "%s" son el mismo nombre: crear y renombrar responden 409 NOMBRE_PLAN_EN_USO',
    async (existente, repetido) => {
      await crearPlanDePrueba(e.A.id, { nombre: existente });
      const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan' });

      const creado = await pedir(app, 'post', '/api/planes', {
        cookie: admin,
        cuerpo: cuerpoPlan({ nombre: repetido }),
      });
      const renombrado = await pedir(app, 'patch', `/api/planes/${otro.id}`, {
        cookie: admin,
        cuerpo: { nombre: repetido },
      });

      expect(creado.status, JSON.stringify(creado.body)).toBe(409);
      expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      expect(renombrado.status, JSON.stringify(renombrado.body)).toBe(409);
      expect((renombrado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
    },
  );

  it.each(PAREJAS)('el orden inverso también choca: %s después de %s', async (primero, segundo) => {
    await crearPlanDePrueba(e.A.id, { nombre: segundo });

    const creado = await pedir(app, 'post', '/api/planes', { cookie: admin, cuerpo: cuerpoPlan({ nombre: primero }) });

    expect(creado.status, JSON.stringify(creado.body)).toBe(409);
    expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
  });
});
