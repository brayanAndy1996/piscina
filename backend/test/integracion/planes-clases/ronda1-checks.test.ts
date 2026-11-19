// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from '../../utilidades/academias';
import { limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFila,
  type ClientePC,
  crearPlanDePrueba,
  escucharParaPlanesClases,
  exigirTablasDePlanesYClases,
  insertarPlan,
  leerPlan,
  leerPlanes,
} from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS, cookieDeUsuario, crearAppConReloj, crearEscenario } from '../../utilidades/usuarios';

// Criterio 33 (crítico, ronda 1 del ataque adversarial; amplía el 4): la base rechaza con 23514, tanto en INSERT como en UPDATE y tanto
// como app como dueño, los valores que los CHECK del criterio 4 dejaban pasar porque la comparación da NULL o desconocida: precio
// 'NaN'; dias_permitidos, franjas_permitidas y niveles_aplicables con dos dimensiones o con un elemento NULL; vigencia_inicio y
// vigencia_fin 'infinity' o '-infinity'. Además, GET /api/planes no responde 500 aunque alguien intente escribir esas filas.

const ROLES = ['app', 'propietario'] as const;

/** Columnas inválidas para el INSERT (el resto del plan es el válido de ejemplo: 3 veces por semana, días [1, 3, 5]). */
const ANOMALOS: [string, Record<string, unknown>][] = [
  ['precio NaN', { precio: 'NaN' }],
  [
    'dias_permitidos de dos dimensiones',
    {
      dias_permitidos: [
        [1, 3, 5],
        [2, 4, 6],
      ],
    },
  ],
  ['dias_permitidos con un elemento NULL', { dias_permitidos: [1, null, 3] }],
  ['dias_permitidos con todos los elementos NULL', { dias_permitidos: [null, null, null] }],
  [
    'franjas_permitidas de dos dimensiones',
    {
      franjas_permitidas: [
        ['08:00', '09:00'],
        ['10:00', '11:00'],
      ],
    },
  ],
  ['franjas_permitidas con un elemento NULL', { franjas_permitidas: ['08:00', null] }],
  ['franjas_permitidas solo con NULL', { franjas_permitidas: [null] }],
  ['niveles_aplicables de dos dimensiones', { niveles_aplicables: [['BASICO', 'INTERMEDIO']] }],
  ['niveles_aplicables con un elemento NULL', { niveles_aplicables: ['BASICO', null] }],
  ['niveles_aplicables solo con NULL', { niveles_aplicables: [null] }],
  ['vigencia_inicio infinity', { vigencia_inicio: 'infinity' }],
  ['vigencia_inicio -infinity', { vigencia_inicio: '-infinity' }],
  ['vigencia_fin infinity', { vigencia_fin: 'infinity' }],
  ['vigencia_fin -infinity', { vigencia_fin: '-infinity' }],
  ['las dos vigencias infinitas', { vigencia_inicio: '-infinity', vigencia_fin: 'infinity' }],
];

describe('criterio 33: CHECK de planes con NaN, arreglos anómalos y fechas infinitas (INSERT)', () => {
  let A: AcademiaDePrueba;

  beforeAll(exigirTablasDePlanesYClases);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
  });

  describe.each(ROLES)('como %s', (rol) => {
    it.each(ANOMALOS)('criterio 33: %s falla con 23514 y no se escribe nada', async (_nombre, columnas) => {
      await expect(insertarPlan(rol, A.id, columnas)).rejects.toMatchObject({ code: '23514' });

      expect(await leerPlanes(A.id)).toEqual([]);
    });
  });
});

describe('criterio 33: CHECK de planes con NaN, arreglos anómalos y fechas infinitas (UPDATE)', () => {
  let A: AcademiaDePrueba;
  let planId: string;

  beforeAll(exigirTablasDePlanesYClases);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    // Sin vigencias: así ninguna combinación con la otra fecha puede rechazarla el CHECK de orden del criterio 4.
    planId = (await crearPlanDePrueba(A.id)).id;
  });

  describe.each(ROLES)('como %s', (rol) => {
    it.each(ANOMALOS)('criterio 33: %s falla con 23514 y el plan no cambia', async (_nombre, cambios) => {
      const antes = await leerPlan(A.id, planId);

      await expect(actualizarFila(rol, 'planes', A.id, planId, cambios)).rejects.toMatchObject({ code: '23514' });

      expect(await leerPlan(A.id, planId)).toEqual(antes);
    });
  });
});

describe('criterio 33: GET /api/planes no responde 500 aunque se intenten escribir filas anómalas', () => {
  let app: NestExpressApplication;
  let http: ClientePC;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  it.each(ANOMALOS)(
    'criterio 33: tras intentar insertar un plan con %s, la lista responde 200',
    async (_nombre, columnas) => {
      const e = await crearEscenario();
      await crearPlanDePrueba(e.A.id);
      // Si la base lo rechaza (lo esperado), no hay fila; si lo acepta, la lista debe poder responder igual.
      await insertarPlan('app', e.A.id, columnas).catch(() => undefined);

      const respuesta = await http.get('/api/planes', cookieDeUsuario(e.adminA, AHORA_PRUEBAS));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    },
  );
});
