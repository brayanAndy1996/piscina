// spec: 004-planes-clases-aforo (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFila,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  exigirTablasDePlanesYClases,
  insertarClase,
  insertarPlan,
  leerClases,
  leerPlanes,
} from '../../utilidades/planes-clases';

// Criterio 3 (crítico, D-23, D-29): dados planes y clases en A y en B, como app: en contexto de A, SELECT devuelve solo las filas de A;
// un INSERT con la academia_id de B y un UPDATE que mueve una fila de A a B fallan con 42501; en contexto de plataforma o sin contexto,
// devuelven 0 filas y el INSERT falla. Un INSERT en clases de A con el entrenador_id de un usuario de B falla con 23503, aunque quien
// inserte sea el dueño de las tablas. Las filas se leen como dueño filtrando por academia_id (sirve con un dueño superusuario o no).

describe('criterio 3: RLS y llave compuesta de planes y clases', () => {
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;
  let planesA: string[];
  let planesB: string[];
  let clasesA: string[];
  let clasesB: string[];
  let entrenadorA: string;
  let entrenadorB: string;

  beforeEach(async () => {
    await exigirTablasDePlanesYClases();
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    B = await crearAcademiaDePrueba();
    entrenadorA = (await crearEntrenadorDePrueba(A.id)).id;
    entrenadorB = (await crearEntrenadorDePrueba(B.id)).id;
    planesA = [(await crearPlanDePrueba(A.id)).id, (await crearPlanDePrueba(A.id)).id];
    planesB = [
      (await crearPlanDePrueba(B.id)).id,
      (await crearPlanDePrueba(B.id)).id,
      (await crearPlanDePrueba(B.id)).id,
    ];
    clasesA = [
      (await crearClaseDePrueba(A.id, entrenadorA, { dia_semana: 1 })).id,
      (await crearClaseDePrueba(A.id, entrenadorA, { dia_semana: 2 })).id,
    ];
    clasesB = [
      (await crearClaseDePrueba(B.id, entrenadorB, { dia_semana: 1 })).id,
      (await crearClaseDePrueba(B.id, entrenadorB, { dia_semana: 2 })).id,
      (await crearClaseDePrueba(B.id, entrenadorB, { dia_semana: 3 })).id,
    ];
  });

  const idsDe = async (
    tabla: 'planes' | 'clases',
    contexto: { academiaId?: string; plataforma?: boolean | string },
  ) => {
    const { rows } = await ejecutarComo('app', `SELECT id FROM ${tabla} ORDER BY id`, [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id).sort();
  };

  describe.each(['planes', 'clases'] as const)('SELECT en %s', (tabla) => {
    const propios = (cual: 'A' | 'B') => {
      const ids = tabla === 'planes' ? (cual === 'A' ? planesA : planesB) : cual === 'A' ? clasesA : clasesB;
      return [...ids].sort();
    };

    it('criterio 3: en contexto de A devuelve solo las filas de A; en el de B, solo las de B', async () => {
      expect(await idsDe(tabla, { academiaId: A.id })).toEqual(propios('A'));
      expect(await idsDe(tabla, { academiaId: B.id })).toEqual(propios('B'));
    });

    it('criterio 3: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas', async () => {
      expect(await idsDe(tabla, { plataforma: true })).toEqual([]);
      expect(await idsDe(tabla, {})).toEqual([]);
      expect(await idsDe(tabla, { academiaId: '' })).toEqual([]);
    });

    it('criterio 3: en contexto de plataforma y de A a la vez solo se ven las de A (la marca de plataforma no abre nada)', async () => {
      expect(await idsDe(tabla, { plataforma: true, academiaId: A.id })).toEqual(propios('A'));
    });
  });

  describe('INSERT', () => {
    it('criterio 3: un INSERT de un plan con la academia_id de B en contexto de A falla con 42501 y B no recibe nada', async () => {
      await expect(insertarPlan('app', B.id, {}, { contexto: { academiaId: A.id } })).rejects.toMatchObject({
        code: '42501',
      });

      expect(await leerPlanes(B.id)).toHaveLength(planesB.length);
      expect(await leerPlanes(A.id)).toHaveLength(planesA.length);
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un INSERT de un plan falla con 42501 (con la academia de A o de B)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const academia of [A, B]) {
          await expect(
            insertarPlan('app', academia.id, {}, { contexto }),
            `${JSON.stringify(contexto)} en ${academia.id}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('criterio 3: un INSERT de una clase con la academia_id de B (y un entrenador de B) en contexto de A falla con 42501', async () => {
      await expect(
        insertarClase('app', B.id, entrenadorB, { dia_semana: 6 }, { contexto: { academiaId: A.id } }),
      ).rejects.toMatchObject({ code: '42501' });

      expect(await leerClases(B.id)).toHaveLength(clasesB.length);
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un INSERT de una clase falla con 42501', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const [academia, entrenador] of [
          [A, entrenadorA],
          [B, entrenadorB],
        ] as const) {
          await expect(
            insertarClase('app', academia.id, entrenador, { dia_semana: 6 }, { contexto }),
            `${JSON.stringify(contexto)} en ${academia.id}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });
  });

  describe('UPDATE', () => {
    it('criterio 3: un UPDATE que mueve un plan o una clase de A a B falla con 42501 y la fila sigue en A', async () => {
      await expect(
        actualizarFila('app', 'planes', A.id, planesA[0] ?? '', { academia_id: B.id }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        actualizarFila('app', 'clases', A.id, clasesA[0] ?? '', { academia_id: B.id }),
      ).rejects.toMatchObject({ code: '42501' });

      expect((await leerPlanes(A.id)).map((fila) => fila.id).sort()).toEqual([...planesA].sort());
      expect((await leerClases(A.id)).map((fila) => fila.id).sort()).toEqual([...clasesA].sort());
    });

    it('criterio 3: un UPDATE permitido sobre filas de B desde el contexto de A no cambia ninguna (0 filas)', async () => {
      const planes = await actualizarFila('app', 'planes', A.id, planesB[0] ?? '', { activo: false });
      const clases = await actualizarFila('app', 'clases', A.id, clasesB[0] ?? '', { aforo: 21 });

      expect(planes).toBe(0);
      expect(clases).toBe(0);
      expect((await leerPlanes(B.id)).every((fila) => fila.activo)).toBe(true);
      expect((await leerClases(B.id)).every((fila) => fila.aforo === 30)).toBe(true);
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un UPDATE permitido no cambia ninguna fila (0 filas)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        expect(await actualizarFila('app', 'planes', A.id, planesA[0] ?? '', { activo: false }, { contexto })).toBe(0);
        expect(await actualizarFila('app', 'clases', A.id, clasesA[0] ?? '', { aforo: 21 }, { contexto })).toBe(0);
      }
      expect((await leerPlanes(A.id)).every((fila) => fila.activo)).toBe(true);
      expect((await leerClases(A.id)).every((fila) => fila.aforo === 30)).toBe(true);
    });

    it('criterio 3: en contexto de A, un UPDATE de una fila de A sí cambia la fila (control)', async () => {
      expect(await actualizarFila('app', 'planes', A.id, planesA[0] ?? '', { activo: false })).toBe(1);
      expect(await actualizarFila('app', 'clases', A.id, clasesA[0] ?? '', { aforo: 21 })).toBe(1);
    });
  });

  describe('llave foránea compuesta clases (academia_id, entrenador_id) -> usuarios (academia_id, id)', () => {
    it('criterio 3: una clase de A con el entrenador de un usuario de B falla con 23503 aunque quien inserte sea el dueño de las tablas', async () => {
      await expect(insertarClase('propietario', A.id, entrenadorB, { dia_semana: 6 })).rejects.toMatchObject({
        code: '23503',
      });

      expect(await leerClases(A.id)).toHaveLength(clasesA.length);
    });

    it('criterio 3: lo mismo como app, con el contexto de A', async () => {
      await expect(insertarClase('app', A.id, entrenadorB, { dia_semana: 6 })).rejects.toMatchObject({
        code: '23503',
      });
    });

    it('criterio 3: reasignar una clase de A al entrenador de B (UPDATE de entrenador_id) falla con 23503, como app y como dueño', async () => {
      for (const rol of ['app', 'propietario'] as const) {
        await expect(
          actualizarFila(rol, 'clases', A.id, clasesA[0] ?? '', { entrenador_id: entrenadorB }),
          rol,
        ).rejects.toMatchObject({ code: '23503' });
      }

      expect((await leerClases(A.id)).every((fila) => fila.entrenador_id === entrenadorA)).toBe(true);
    });

    it('criterio 3: un entrenador que no existe falla con 23503; uno de la misma academia se acepta (control)', async () => {
      await expect(
        insertarClase('propietario', A.id, '00000000-0000-4000-8000-000000000000', { dia_semana: 6 }),
      ).rejects.toMatchObject({ code: '23503' });
      const otro = await crearEntrenadorDePrueba(A.id);

      await expect(insertarClase('propietario', A.id, otro.id, { dia_semana: 6 })).resolves.toEqual(expect.any(String));
    });
  });
});
