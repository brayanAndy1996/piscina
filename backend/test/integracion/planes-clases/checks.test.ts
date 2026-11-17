// spec: 004-planes-clases-aforo (pruebas protegidas)
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from '../../utilidades/academias';
import { limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFila,
  BLOQUES,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  exigirTablasDePlanesYClases,
  insertarClase,
  insertarPlan,
  leerClase,
  leerClases,
  leerPlan,
  leerPlanes,
} from '../../utilidades/planes-clases';

// Criterio 4 (crítico, RN-09, RN-11, RN-25): las invariantes se exigen también con CHECK, para un INSERT o UPDATE directo, como app y
// como dueño de las tablas; todas fallan con 23514: clases.aforo fuera de 20 a 50; planes.precio menor o igual que 0;
// planes.clases_por_mes menor que 1; planes.veces_por_semana fuera de 1 a 7; dias_permitidos vacío, con un valor fuera de 1 a 7 o con
// menos días que veces_por_semana; franjas_permitidas vacía o con una hora que no sea un bloque; niveles_aplicables vacío;
// vigencia_fin anterior a vigencia_inicio; clases.dia_semana fuera de 1 a 7; clases.hora_inicio que no sea un bloque (minutos o
// segundos distintos de cero, antes de las 08:00 o después de las 19:00); y clases.hora_fin distinta de hora_inicio más una hora.
// Los límites de la API (clases por mes hasta 31, duración de 15 a 60, precio hasta 99 999.99, nombre de 3 a 80) no van a la base (D3).

const ROLES = ['app', 'propietario'] as const;

describe('criterio 4: CHECK de planes (INSERT)', () => {
  let A: AcademiaDePrueba;

  beforeAll(exigirTablasDePlanesYClases);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
  });

  const INVALIDOS: [string, Record<string, unknown>][] = [
    ['precio 0', { precio: '0' }],
    ['precio 0.00', { precio: '0.00' }],
    ['precio negativo (-0.01)', { precio: '-0.01' }],
    ['precio negativo (-120)', { precio: '-120' }],
    ['precio que redondea a 0 (0.001)', { precio: '0.001' }],
    ['clases_por_mes 0', { clases_por_mes: 0 }],
    ['clases_por_mes negativas', { clases_por_mes: -1 }],
    ['veces_por_semana 0', { veces_por_semana: 0 }],
    ['veces_por_semana negativas', { veces_por_semana: -1 }],
    [
      'veces_por_semana 8 (aunque haya 8 días, uno repetido)',
      { veces_por_semana: 8, dias_permitidos: [1, 2, 3, 4, 5, 6, 7, 7] },
    ],
    ['dias_permitidos vacío', { dias_permitidos: [] }],
    ['dias_permitidos con el 0', { dias_permitidos: [0, 1, 2] }],
    ['dias_permitidos con el 8', { dias_permitidos: [1, 2, 8] }],
    ['dias_permitidos con un negativo', { dias_permitidos: [-1, 1, 2] }],
    ['dias_permitidos con menos días que veces_por_semana (2 de 3)', { dias_permitidos: [1, 2] }],
    ['dias_permitidos con menos días que veces_por_semana (1 de 2)', { veces_por_semana: 2, dias_permitidos: [1] }],
    ['franjas_permitidas vacía', { franjas_permitidas: [] }],
    ['franjas_permitidas con las 07:00', { franjas_permitidas: ['07:00'] }],
    ['franjas_permitidas con las 20:00', { franjas_permitidas: ['20:00'] }],
    ['franjas_permitidas con las 08:30', { franjas_permitidas: ['08:30'] }],
    ['franjas_permitidas con segundos (08:00:30)', { franjas_permitidas: ['08:00:30'] }],
    ['franjas_permitidas con las 00:00', { franjas_permitidas: ['00:00'] }],
    ['franjas_permitidas con un bloque válido y otra hora que no (19:30)', { franjas_permitidas: ['08:00', '19:30'] }],
    ['niveles_aplicables vacío', { niveles_aplicables: [] }],
    ['vigencia_fin un día antes de vigencia_inicio', { vigencia_inicio: '2026-03-01', vigencia_fin: '2026-02-28' }],
    ['vigencia_fin un año antes de vigencia_inicio', { vigencia_inicio: '2027-01-01', vigencia_fin: '2026-01-01' }],
  ];

  describe.each(ROLES)('como %s', (rol) => {
    it.each(INVALIDOS)('criterio 4: %s falla con 23514 y no se escribe nada', async (_nombre, columnas) => {
      await expect(insertarPlan(rol, A.id, columnas)).rejects.toMatchObject({ code: '23514' });

      expect(await leerPlanes(A.id)).toEqual([]);
    });

    it('criterio 4 (control): los valores límite válidos sí se aceptan', async () => {
      const validos: Record<string, unknown>[] = [
        { precio: '0.01' },
        { precio: '99999.99' },
        { clases_por_mes: 1 },
        { veces_por_semana: 1, dias_permitidos: [1] },
        { veces_por_semana: 7, dias_permitidos: [1, 2, 3, 4, 5, 6, 7] },
        { veces_por_semana: 2, dias_permitidos: [1, 2, 3, 4, 5, 6, 7] },
        { franjas_permitidas: [...BLOQUES] },
        { franjas_permitidas: ['19:00'] },
        { niveles_aplicables: ['AVANZADO'] },
        { vigencia_inicio: '2026-03-01', vigencia_fin: '2026-03-01' },
        { vigencia_inicio: '2026-03-01', vigencia_fin: null },
        { vigencia_inicio: null, vigencia_fin: '2026-03-01' },
        { vigencia_inicio: null, vigencia_fin: null },
      ];

      for (const columnas of validos) {
        await expect(insertarPlan(rol, A.id, columnas), JSON.stringify(columnas)).resolves.toEqual(expect.any(String));
      }
      expect(await leerPlanes(A.id)).toHaveLength(validos.length);
    });
  });
});

describe('criterio 4: CHECK de planes (UPDATE)', () => {
  let A: AcademiaDePrueba;
  let planId: string;

  beforeAll(exigirTablasDePlanesYClases);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    planId = (await crearPlanDePrueba(A.id, { vigencia_inicio: '2026-03-01', vigencia_fin: '2026-06-30' })).id;
  });

  const INVALIDOS: [string, Record<string, unknown>][] = [
    ['precio 0', { precio: '0' }],
    ['precio negativo', { precio: '-1' }],
    ['clases_por_mes 0', { clases_por_mes: 0 }],
    ['veces_por_semana 0', { veces_por_semana: 0 }],
    ['veces_por_semana 8', { veces_por_semana: 8 }],
    ['veces_por_semana mayor que los días permitidos (4 de 3)', { veces_por_semana: 4 }],
    ['dias_permitidos vacío', { dias_permitidos: [] }],
    ['dias_permitidos con menos días que veces_por_semana', { dias_permitidos: [1, 2] }],
    ['dias_permitidos con el 8', { dias_permitidos: [1, 3, 8] }],
    ['dias_permitidos con el 0', { dias_permitidos: [0, 3, 5] }],
    ['franjas_permitidas vacía', { franjas_permitidas: [] }],
    ['franjas_permitidas con las 08:30', { franjas_permitidas: ['08:30'] }],
    ['franjas_permitidas con las 20:00', { franjas_permitidas: ['20:00'] }],
    ['niveles_aplicables vacío', { niveles_aplicables: [] }],
    ['vigencia_fin anterior a la vigencia_inicio guardada', { vigencia_fin: '2026-02-28' }],
    ['vigencia_inicio posterior a la vigencia_fin guardada', { vigencia_inicio: '2026-07-01' }],
    ['las dos vigencias invertidas', { vigencia_inicio: '2026-09-01', vigencia_fin: '2026-08-01' }],
  ];

  describe.each(ROLES)('como %s', (rol) => {
    it.each(INVALIDOS)('criterio 4: %s falla con 23514 y el plan no cambia', async (_nombre, cambios) => {
      const antes = await leerPlan(A.id, planId);

      await expect(actualizarFila(rol, 'planes', A.id, planId, cambios)).rejects.toMatchObject({ code: '23514' });

      expect(await leerPlan(A.id, planId)).toEqual(antes);
    });

    it('criterio 4 (control): un cambio válido de los mismos campos sí se aplica', async () => {
      const filas = await actualizarFila(rol, 'planes', A.id, planId, {
        precio: '99999.99',
        clases_por_mes: 31,
        veces_por_semana: 2,
        dias_permitidos: [2, 4, 6],
        franjas_permitidas: ['19:00'],
        vigencia_fin: '2026-03-01',
      });

      expect(filas).toBe(1);
      expect(await leerPlan(A.id, planId)).toMatchObject({
        precio: '99999.99',
        clases_por_mes: 31,
        veces_por_semana: 2,
        dias_permitidos: [2, 4, 6],
        franjas_permitidas: ['19:00'],
        vigencia_fin: '2026-03-01',
      });
    });
  });
});

describe('criterio 4: CHECK de clases (INSERT)', () => {
  let A: AcademiaDePrueba;
  let entrenadorId: string;

  beforeAll(exigirTablasDePlanesYClases);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    entrenadorId = (await crearEntrenadorDePrueba(A.id)).id;
  });

  const INVALIDOS: [string, Record<string, unknown>][] = [
    ['aforo 19', { aforo: 19 }],
    ['aforo 51', { aforo: 51 }],
    ['aforo 0', { aforo: 0 }],
    ['aforo negativo', { aforo: -20 }],
    ['aforo 100', { aforo: 100 }],
    ['dia_semana 0', { dia_semana: 0 }],
    ['dia_semana 8', { dia_semana: 8 }],
    ['dia_semana negativo', { dia_semana: -1 }],
    ['hora_inicio 07:00 (antes de las 08:00)', { hora_inicio: '07:00' }],
    ['hora_inicio 20:00 (después de las 19:00)', { hora_inicio: '20:00' }],
    ['hora_inicio 22:00', { hora_inicio: '22:00' }],
    ['hora_inicio 00:00', { hora_inicio: '00:00' }],
    ['hora_inicio con minutos (08:30)', { hora_inicio: '08:30' }],
    ['hora_inicio con minutos (19:30)', { hora_inicio: '19:30' }],
    ['hora_inicio con segundos (08:00:30)', { hora_inicio: '08:00:30' }],
    ['hora_fin igual a hora_inicio', { hora_inicio: '08:00', hora_fin: '08:00' }],
    ['hora_fin dos horas después', { hora_inicio: '08:00', hora_fin: '10:00' }],
    ['hora_fin antes de hora_inicio', { hora_inicio: '09:00', hora_fin: '08:00' }],
    ['hora_fin media hora de más', { hora_inicio: '08:00', hora_fin: '09:30' }],
    ['hora_fin de las 19:00 igual a la de inicio', { hora_inicio: '19:00', hora_fin: '19:00' }],
    ['hora_fin de las 19:00 dos horas después', { hora_inicio: '19:00', hora_fin: '21:00' }],
  ];

  describe.each(ROLES)('como %s', (rol) => {
    it.each(INVALIDOS)('criterio 4: %s falla con 23514 y no se escribe nada', async (_nombre, columnas) => {
      await expect(insertarClase(rol, A.id, entrenadorId, columnas)).rejects.toMatchObject({ code: '23514' });

      expect(await leerClases(A.id)).toEqual([]);
    });

    it('criterio 4 (control): el aforo de 20 y de 50 se aceptan', async () => {
      await insertarClase(rol, A.id, entrenadorId, { aforo: 20, dia_semana: 1 });
      await insertarClase(rol, A.id, entrenadorId, { aforo: 50, dia_semana: 2 });

      expect((await leerClases(A.id)).map((fila) => fila.aforo).sort()).toEqual([20, 50]);
    });

    it('criterio 4 (control): los siete días y los doce bloques (la clase de las 19:00 termina a las 20:00) se aceptan', async () => {
      for (let dia = 1; dia <= 7; dia++) {
        await insertarClase(rol, A.id, entrenadorId, { dia_semana: dia, hora_inicio: '08:00' });
      }
      for (const bloque of BLOQUES.slice(1)) {
        await insertarClase(rol, A.id, entrenadorId, { dia_semana: 1, hora_inicio: bloque });
      }

      const clases = await leerClases(A.id);
      expect(clases).toHaveLength(7 + BLOQUES.length - 1);
      const ultima = clases.find((fila) => fila.dia_semana === 1 && fila.hora_inicio === '19:00');
      expect(ultima?.hora_fin).toBe('20:00');
    });
  });
});

describe('criterio 4: CHECK de clases (UPDATE)', () => {
  let A: AcademiaDePrueba;
  let claseId: string;

  beforeAll(exigirTablasDePlanesYClases);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    claseId = (await crearClaseDePrueba(A.id, entrenador.id, { hora_inicio: '10:00', aforo: 30 })).id;
  });

  describe.each(ROLES)('como %s', (rol) => {
    it.each([
      ['aforo 19', { aforo: 19 }],
      ['aforo 51', { aforo: 51 }],
      ['aforo 0', { aforo: 0 }],
      ['aforo negativo', { aforo: -30 }],
    ])('criterio 4: %s falla con 23514 y la clase no cambia', async (_nombre, cambios) => {
      const antes = await leerClase(A.id, claseId);

      await expect(actualizarFila(rol, 'clases', A.id, claseId, cambios)).rejects.toMatchObject({ code: '23514' });

      expect(await leerClase(A.id, claseId)).toEqual(antes);
    });

    it('criterio 4 (control): el aforo de 20 y de 50 se acepta al editar', async () => {
      expect(await actualizarFila(rol, 'clases', A.id, claseId, { aforo: 20 })).toBe(1);
      expect((await leerClase(A.id, claseId))?.aforo).toBe(20);
      expect(await actualizarFila(rol, 'clases', A.id, claseId, { aforo: 50 })).toBe(1);
      expect((await leerClase(A.id, claseId))?.aforo).toBe(50);
    });
  });

  // El nivel, el día y la hora no se pueden cambiar con el rol de la app (criterio 2), pero el dueño sí podría escribirlos mal.
  it.each([
    ['dia_semana 0', { dia_semana: 0 }],
    ['dia_semana 8', { dia_semana: 8 }],
    ['hora_inicio 07:00 con su hora_fin', { hora_inicio: '07:00', hora_fin: '08:00' }],
    ['hora_inicio 20:00 con su hora_fin', { hora_inicio: '20:00', hora_fin: '21:00' }],
    ['hora_inicio 08:30 con su hora_fin', { hora_inicio: '08:30', hora_fin: '09:30' }],
    ['hora_inicio que cambia sin hora_fin', { hora_inicio: '11:00' }],
    ['hora_fin distinta de hora_inicio más una hora', { hora_fin: '12:00' }],
  ])('criterio 4 (dueño): %s falla con 23514 y la clase no cambia', async (_nombre, cambios) => {
    const antes = await leerClase(A.id, claseId);

    await expect(actualizarFila('propietario', 'clases', A.id, claseId, cambios)).rejects.toMatchObject({
      code: '23514',
    });

    expect(await leerClase(A.id, claseId)).toEqual(antes);
  });

  it('criterio 4 (dueño, control): mover una clase a otro bloque válido con su hora_fin sí se aplica', async () => {
    expect(
      await actualizarFila('propietario', 'clases', A.id, claseId, {
        dia_semana: 7,
        hora_inicio: '19:00',
        hora_fin: '20:00',
      }),
    ).toBe(1);

    expect(await leerClase(A.id, claseId)).toMatchObject({ dia_semana: 7, hora_inicio: '19:00', hora_fin: '20:00' });
  });
});
