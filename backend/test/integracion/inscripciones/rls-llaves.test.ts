// spec: 005-inscripcion-publica (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFilas,
  crearAlumnoSolo,
  exigirTablasDeInscripcion,
  filaValida,
  insertarFila,
  leerAlumnos,
  leerMatriculaClases,
  leerMatriculas,
  type PadresDeFila,
  sembrarSolicitud,
  type SolicitudSembrada,
  TABLAS_005,
  type Tabla005,
} from '../../utilidades/inscripciones';
import { crearClaseDePrueba, crearEntrenadorDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';
import { crearUsuarioDePrueba } from '../../utilidades/usuarios';

// Criterio 3 (crítico, D-23, D-29): dadas filas de las siete tablas en A y en B, como app: en contexto de A, SELECT devuelve solo las de
// A; un INSERT con la `academia_id` de B y un UPDATE que mueve una fila de A a B fallan con 42501; en contexto de plataforma o sin
// contexto devuelven 0 filas y el INSERT falla. Una matrícula de A con un `plan_id` o un `clase_id` de B, o una solicitud de A con un
// `alumno_id` de B, fallan con 23503, aunque quien inserte sea el dueño de las tablas. Las filas se leen como dueño filtrando por
// `academia_id` (sirve con un dueño superusuario o no).

interface Datos {
  academia: AcademiaDePrueba;
  planId: string;
  claseId: string;
  entrenadorId: string;
  cliente: SolicitudSembrada;
  /** Un alumno de la misma academia, sin solicitud (para filas nuevas). */
  alumnoLibreId: string;
}

describe('criterio 3: RLS y llaves compuestas de las tablas de la inscripción', () => {
  let A: Datos;
  let B: Datos;

  async function sembrar(academia: AcademiaDePrueba): Promise<Datos> {
    const entrenador = await crearEntrenadorDePrueba(academia.id);
    const plan = await crearPlanDePrueba(academia.id);
    const clase = await crearClaseDePrueba(academia.id, entrenador.id);
    const cliente = await sembrarSolicitud(academia.id, {
      planId: plan.id,
      claseIds: [clase.id],
      conApoderado: true,
    });
    return {
      academia,
      planId: plan.id,
      claseId: clase.id,
      entrenadorId: entrenador.id,
      cliente,
      alumnoLibreId: await crearAlumnoSolo(academia.id),
    };
  }

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    await limpiarBase();
    A = await sembrar(await crearAcademiaDePrueba());
    B = await sembrar(await crearAcademiaDePrueba());
  });

  /** Una fila válida de la tabla para la academia de `d` (usa las filas padre de esa academia). */
  async function filaNuevaDe(tabla: Tabla005, d: Datos): Promise<Record<string, unknown>> {
    const padres: Partial<PadresDeFila> = {
      alumnoId: d.alumnoLibreId,
      solicitudId: d.cliente.solicitudId,
      planId: d.planId,
      matriculaId: d.cliente.matriculaId,
      claseId: d.claseId,
    };
    const fila = await filaValida(tabla, padres);
    // `matricula_clases`: otra clase para no repetir la clave primaria de la matrícula sembrada.
    if (tabla === 'matricula_clases') {
      const otra = await crearClaseDePrueba(d.academia.id, d.entrenadorId, { dia_semana: 4, activo: false });
      return { ...fila, clase_id: otra.id };
    }
    return fila;
  }

  const idsDe = async (tabla: Tabla005, contexto: { academiaId?: string; plataforma?: boolean | string }) => {
    const llave =
      tabla === 'apoderados' || tabla === 'fichas_medicas'
        ? 'alumno_id'
        : tabla === 'matricula_clases'
          ? 'matricula_id'
          : 'id';
    const { rows } = await ejecutarComo('app', `SELECT ${llave}::text AS id FROM ${tabla} ORDER BY 1`, [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id);
  };

  describe.each(TABLAS_005)('SELECT en %s', (tabla) => {
    it('criterio 3: en contexto de A devuelve solo las filas de A; en el de B, solo las de B (cada una tiene al menos una)', async () => {
      const deA = await idsDe(tabla, { academiaId: A.academia.id });
      const deB = await idsDe(tabla, { academiaId: B.academia.id });

      expect(deA.length).toBeGreaterThan(0);
      expect(deB.length).toBeGreaterThan(0);
      expect(deA.filter((id) => deB.includes(id))).toEqual([]);
    });

    it('criterio 3: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas (el Superadmin no ve nada, D-29)', async () => {
      expect(await idsDe(tabla, { plataforma: true })).toEqual([]);
      expect(await idsDe(tabla, {})).toEqual([]);
      expect(await idsDe(tabla, { academiaId: '' })).toEqual([]);
    });

    it('criterio 3: en contexto de plataforma y de A a la vez solo se ven las de A (la marca de plataforma no abre nada)', async () => {
      expect(await idsDe(tabla, { plataforma: true, academiaId: A.academia.id })).toEqual(
        await idsDe(tabla, { academiaId: A.academia.id }),
      );
    });
  });

  describe.each(TABLAS_005)('INSERT en %s', (tabla) => {
    it('criterio 3: un INSERT con la academia_id de B en contexto de A falla con 42501 y B no recibe nada', async () => {
      const antes = await idsDe(tabla, { academiaId: B.academia.id });
      const fila = await filaNuevaDe(tabla, B);

      await expect(
        insertarFila('app', tabla, B.academia.id, fila, { contexto: { academiaId: A.academia.id } }),
      ).rejects.toMatchObject({ code: '42501' });

      expect(await idsDe(tabla, { academiaId: B.academia.id })).toEqual(antes);
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un INSERT falla con 42501 (con la academia de A o de B)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const d of [A, B]) {
          const fila = await filaNuevaDe(tabla, d);
          await expect(
            insertarFila('app', tabla, d.academia.id, fila, { contexto }),
            `${JSON.stringify(contexto)} en ${d.academia.id}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('criterio 3: un INSERT de la propia academia en su contexto sí se acepta (control)', async () => {
      const fila = await filaNuevaDe(tabla, A);

      await expect(insertarFila('app', tabla, A.academia.id, fila)).resolves.toBeUndefined();
    });
  });

  describe('UPDATE', () => {
    const COLUMNA_CAMBIABLE: Partial<
      Record<Tabla005, { donde: (d: Datos) => Record<string, unknown>; cambio: Record<string, unknown> }>
    > = {
      alumnos: { donde: (d) => ({ id: d.cliente.alumnoId }), cambio: { nombres: 'Cambiado' } },
      apoderados: { donde: (d) => ({ alumno_id: d.cliente.alumnoId }), cambio: { nombres: 'Cambiado' } },
      fichas_medicas: { donde: (d) => ({ alumno_id: d.cliente.alumnoId }), cambio: { seguro: 'Cambiado' } },
      solicitudes_inscripcion: { donde: (d) => ({ id: d.cliente.solicitudId }), cambio: { estado: 'VENCIDA' } },
      matriculas: {
        donde: (d) => ({ id: d.cliente.matriculaId }),
        cambio: { estado: 'CANCELADA', reserva_vence_en: null },
      },
    };

    it.each(TABLAS_005)(
      'criterio 3: un UPDATE que mueve una fila de %s de A a B falla con 42501 y la fila sigue en A',
      async (tabla) => {
        const donde =
          tabla === 'consentimientos'
            ? { alumno_id: A.cliente.alumnoId }
            : tabla === 'matricula_clases'
              ? { matricula_id: A.cliente.matriculaId }
              : (COLUMNA_CAMBIABLE[tabla]?.donde(A) ?? {});
        const antes = await idsDe(tabla, { academiaId: A.academia.id });

        await expect(
          actualizarFilas('app', tabla, A.academia.id, donde, { academia_id: B.academia.id }),
        ).rejects.toMatchObject({ code: '42501' });

        expect(await idsDe(tabla, { academiaId: A.academia.id })).toEqual(antes);
      },
    );

    it.each(Object.keys(COLUMNA_CAMBIABLE) as Tabla005[])(
      'criterio 3: un UPDATE permitido sobre filas de B desde el contexto de A no cambia ninguna fila (0 filas), %s',
      async (tabla) => {
        const regla = COLUMNA_CAMBIABLE[tabla];
        if (!regla) throw new Error('caso sin regla');

        const filas = await actualizarFilas('app', tabla, A.academia.id, regla.donde(B), regla.cambio);

        expect(filas).toBe(0);
      },
    );

    it.each(Object.keys(COLUMNA_CAMBIABLE) as Tabla005[])(
      'criterio 3: en contexto de plataforma o sin contexto, un UPDATE permitido no cambia ninguna fila (0 filas), %s',
      async (tabla) => {
        const regla = COLUMNA_CAMBIABLE[tabla];
        if (!regla) throw new Error('caso sin regla');

        for (const contexto of [{ plataforma: true }, {}] as const) {
          expect(await actualizarFilas('app', tabla, A.academia.id, regla.donde(A), regla.cambio, { contexto })).toBe(
            0,
          );
        }
      },
    );

    it.each(Object.keys(COLUMNA_CAMBIABLE) as Tabla005[])(
      'criterio 3: en contexto de A, un UPDATE de una fila de A sí cambia la fila (control), %s',
      async (tabla) => {
        const regla = COLUMNA_CAMBIABLE[tabla];
        if (!regla) throw new Error('caso sin regla');

        expect(await actualizarFilas('app', tabla, A.academia.id, regla.donde(A), regla.cambio)).toBe(1);
      },
    );

    it('criterio 3: DELETE de apoderados: en contexto de B no borra al apoderado de A; en el de A sí', async () => {
      const deOtra = await ejecutarComo(
        'app',
        'DELETE FROM apoderados WHERE alumno_id = $1::uuid',
        [A.cliente.alumnoId],
        {
          academiaId: B.academia.id,
        },
      );
      const sinContexto = await ejecutarComo(
        'app',
        'DELETE FROM apoderados WHERE alumno_id = $1::uuid',
        [A.cliente.alumnoId],
        {
          plataforma: true,
        },
      );
      expect(deOtra.rowCount).toBe(0);
      expect(sinContexto.rowCount).toBe(0);

      const propia = await ejecutarComo(
        'app',
        'DELETE FROM apoderados WHERE alumno_id = $1::uuid',
        [A.cliente.alumnoId],
        {
          academiaId: A.academia.id,
        },
      );
      expect(propia.rowCount).toBe(1);
    });
  });

  describe('llaves foráneas compuestas (también con el dueño de las tablas)', () => {
    it.each(['propietario', 'app'] as const)(
      'criterio 3: una matrícula de A con el plan_id de un plan de B falla con 23503 (%s)',
      async (rol) => {
        const fila = { ...(await filaNuevaDe('matriculas', A)), plan_id: B.planId, alumno_id: A.alumnoLibreId };

        await expect(insertarFila(rol, 'matriculas', A.academia.id, fila)).rejects.toMatchObject({ code: '23503' });

        expect((await leerMatriculas(A.academia.id)).length).toBe(1);
      },
    );

    it.each(['propietario', 'app'] as const)(
      'criterio 3: una fila de matricula_clases de A con el clase_id de una clase de B falla con 23503 (%s)',
      async (rol) => {
        await expect(
          insertarFila(rol, 'matricula_clases', A.academia.id, {
            matricula_id: A.cliente.matriculaId,
            clase_id: B.claseId,
          }),
        ).rejects.toMatchObject({ code: '23503' });

        expect((await leerMatriculaClases(A.academia.id)).length).toBe(1);
      },
    );

    it.each(['propietario', 'app'] as const)(
      'criterio 3: una solicitud de A con el alumno_id de un alumno de B falla con 23503 (%s)',
      async (rol) => {
        const fila = { ...(await filaNuevaDe('solicitudes_inscripcion', A)), alumno_id: B.alumnoLibreId };

        await expect(insertarFila(rol, 'solicitudes_inscripcion', A.academia.id, fila)).rejects.toMatchObject({
          code: '23503',
        });
      },
    );

    it('criterio 3: ninguna referencia entre academias se acepta: alumno, solicitud, matrícula y usuario de B en filas de A (23503)', async () => {
      const usuarioB = await crearUsuarioDePrueba({ academiaId: B.academia.id, rol: 'ALUMNO' });
      const casos: [string, Tabla005, Record<string, unknown>][] = [
        [
          'matrícula con alumno de B',
          'matriculas',
          { ...(await filaNuevaDe('matriculas', A)), alumno_id: B.alumnoLibreId },
        ],
        [
          'matrícula con solicitud de B',
          'matriculas',
          { ...(await filaNuevaDe('matriculas', A)), solicitud_id: B.cliente.solicitudId },
        ],
        [
          'matricula_clases con matrícula de B',
          'matricula_clases',
          { matricula_id: B.cliente.matriculaId, clase_id: A.claseId },
        ],
        [
          'ficha con alumno de B',
          'fichas_medicas',
          { ...(await filaNuevaDe('fichas_medicas', A)), alumno_id: B.alumnoLibreId },
        ],
        [
          'apoderado con alumno de B',
          'apoderados',
          { ...(await filaNuevaDe('apoderados', A)), alumno_id: B.alumnoLibreId },
        ],
        [
          'consentimiento con alumno de B',
          'consentimientos',
          { ...(await filaNuevaDe('consentimientos', A)), alumno_id: B.alumnoLibreId },
        ],
        [
          'consentimiento con solicitud de B',
          'consentimientos',
          { ...(await filaNuevaDe('consentimientos', A)), solicitud_id: B.cliente.solicitudId },
        ],
        ['alumno con usuario de B', 'alumnos', { ...(await filaValida('alumnos', {})), usuario_id: usuarioB.id }],
      ];

      for (const [nombre, tabla, fila] of casos) {
        await expect(insertarFila('propietario', tabla, A.academia.id, fila), nombre).rejects.toMatchObject({
          code: '23503',
        });
      }
    });

    it('criterio 3: las mismas filas con padres de la misma academia se aceptan (control)', async () => {
      const usuarioA = await crearUsuarioDePrueba({ academiaId: A.academia.id, rol: 'ALUMNO' });

      await expect(
        insertarFila('propietario', 'alumnos', A.academia.id, {
          ...(await filaValida('alumnos', {})),
          usuario_id: usuarioA.id,
        }),
      ).resolves.toBeUndefined();
      await expect(
        insertarFila(
          'propietario',
          'solicitudes_inscripcion',
          A.academia.id,
          await filaNuevaDe('solicitudes_inscripcion', A),
        ),
      ).resolves.toBeUndefined();
      expect((await leerAlumnos(A.academia.id)).length).toBeGreaterThanOrEqual(3);
    });

    it('criterio 3: un alumno, una solicitud o un plan que no existen fallan con 23503', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';

      await expect(
        insertarFila('propietario', 'solicitudes_inscripcion', A.academia.id, {
          ...(await filaNuevaDe('solicitudes_inscripcion', A)),
          alumno_id: inexistente,
        }),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        insertarFila('propietario', 'matriculas', A.academia.id, {
          ...(await filaNuevaDe('matriculas', A)),
          plan_id: inexistente,
        }),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });
});
