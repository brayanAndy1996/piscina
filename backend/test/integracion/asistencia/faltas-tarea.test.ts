// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  enLima,
  LUNES,
} from '../../utilidades/escenario-asistencia';
import {
  ejecutarFaltas,
  inasistenciasDe,
  leerInasistencias,
  prepararEscenarioDe009b,
} from '../../utilidades/escenario-faltas';
import { abrirRetenedor, conLimite } from '../../utilidades/planes-clases';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterios 23 y 26 (críticos, D-08, D-10, D-23, D-25, nota O1 de 001): `FaltasService.registrarFaltas(ahora)` se llama directamente (con `TAREAS_PROGRAMADAS` apagada en las pruebas, DT-9). La lista de academias `ACTIVA` se lee con `comoPlataforma`, esa
// transacción se cierra, y después se abre un `conAcademia` por academia, una tras otra; una academia suspendida no se procesa. En cada academia, la primera sentencia es `pg_try_advisory_xact_lock(hashtextextended('faltas:' || academia, 0))`:
// si otra instancia la tiene, se salta esa academia en esta vuelta (no espera). Dos llamadas a la vez dejan las mismas faltas una sola vez. Con A y B a la misma hora, las faltas de A solo llevan alumnos, matrículas y clases de A, y las de B,
// las de B; con B suspendida, se registran las de A y ninguna de B; un error forzado en una academia no impide las de la otra (esa parte, con el registro técnico, está en `faltas-registro-tecnico.test.ts`).
// Lecturas estrictas elegidas: la clave del bloqueo consultivo es `'faltas:'` más el id de la academia en su forma de texto habitual (minúsculas con guiones); la prueba toma ese bloqueo con otra conexión (la de «otra instancia») y la tarea
// debe terminar sin esperarlo (límite de seguridad de 15 s) y dejar sin registrar solo esa academia; una academia suspendida y luego reactivada se procesa en la vuelta siguiente (lo que no se registró antes entra mientras siga en la ventana
// de ayer y hoy); después de cada vuelta el bloqueo ya no está tomado (es de transacción).

describe('la tarea de faltas por academia (criterios 23 y 26)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let deA: AlumnoDeAsistencia[];
  let deB: AlumnoDeAsistencia[];

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx, { rutas: false });
    deA = [await crearAlumnoDeAsistencia(ctx, esc), await crearAlumnoDeAsistencia(ctx, esc)];
    deB = [await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' })];
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const B = () => esc.e.B.id;
  /** Una vuelta de la tarea cuando termina la clase de las 18:00 del lunes en las dos academias. */
  const AL_TERMINAR = enLima(LUNES, '19:00:00.000');
  const ids = (alumnos: readonly AlumnoDeAsistencia[]) => alumnos.map((alumno) => alumno.alumnoId).sort();

  describe('varias academias a la misma hora (criterio 26)', () => {
    it('criterio 26: con A y B a la misma hora, cada academia recibe las faltas de sus propios alumnos, matrículas y clases, y ninguna de la otra', async () => {
      await ejecutarFaltas(ctx, AL_TERMINAR);

      const faltasA = await leerInasistencias(A());
      const faltasB = await leerInasistencias(B());
      expect(faltasA.map((falta) => falta.alumno_id).sort()).toEqual(ids(deA));
      expect(faltasB.map((falta) => falta.alumno_id).sort()).toEqual(ids(deB));
      expect(faltasA.map((falta) => falta.matricula_id).sort()).toEqual(deA.map((alumno) => alumno.matriculaId).sort());
      expect(faltasB.map((falta) => falta.matricula_id)).toEqual([deB[0]?.matriculaId]);
      expect(new Set(faltasA.map((falta) => falta.clase_id))).toEqual(new Set([esc.e.lunes.id]));
      expect(new Set(faltasB.map((falta) => falta.clase_id))).toEqual(new Set([esc.e.lunesB.id]));
      expect(faltasA.every((falta) => falta.academia_id === A())).toBe(true);
      expect(faltasB.every((falta) => falta.academia_id === B())).toBe(true);
      for (const falta of [...faltasA, ...faltasB]) {
        expect(falta.registrada_en.toISOString()).toBe(AL_TERMINAR.toISOString());
        expect(falta.fecha).toBe(LUNES);
      }
    });

    it('criterio 26: volver a correr la tarea deja las mismas faltas de las dos academias (ni más ni menos)', async () => {
      await ejecutarFaltas(ctx, AL_TERMINAR);
      const antes = JSON.stringify([await leerInasistencias(A()), await leerInasistencias(B())]);

      await ejecutarFaltas(ctx, AL_TERMINAR);
      await ejecutarFaltas(ctx, enLima(LUNES, '19:20:00.000'));

      expect(JSON.stringify([await leerInasistencias(A()), await leerInasistencias(B())])).toBe(antes);
    });
  });

  describe('una academia suspendida no se procesa (criterio 23)', () => {
    it('criterio 23 y 26: con B suspendida se registran las faltas de A y ninguna de B; al reactivarla, la vuelta siguiente registra las de B', async () => {
      await fijarEstadoDeAcademia(B(), 'SUSPENDIDA');

      await ejecutarFaltas(ctx, AL_TERMINAR);
      expect((await leerInasistencias(A())).map((falta) => falta.alumno_id).sort()).toEqual(ids(deA));
      expect(await leerInasistencias(B()), 'B suspendida: ninguna falta').toEqual([]);

      await fijarEstadoDeAcademia(B(), 'ACTIVA');
      await ejecutarFaltas(ctx, enLima(LUNES, '19:05:00.000'));

      expect((await leerInasistencias(B())).map((falta) => falta.alumno_id)).toEqual(ids(deB));
      expect(await leerInasistencias(A()), 'las de A no se duplican').toHaveLength(2);
    });

    it('criterio 23: con A suspendida se registran las de B y ninguna de A', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await leerInasistencias(A())).toEqual([]);
      expect((await leerInasistencias(B())).map((falta) => falta.alumno_id)).toEqual(ids(deB));
    });

    it('criterio 23: con las dos academias suspendidas la vuelta termina sin registrar nada y sin fallar', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');
      await fijarEstadoDeAcademia(B(), 'SUSPENDIDA');

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await leerInasistencias(A())).toEqual([]);
      expect(await leerInasistencias(B())).toEqual([]);
    });
  });

  describe('el bloqueo consultivo entre instancias (criterio 23)', () => {
    /** La clave que toma cada instancia por academia: `hashtextextended('faltas:' || academia, 0)`. */
    const TOMAR_BLOQUEO = 'SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))';
    const INTENTAR_BLOQUEO =
      'SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0)) AS tomado';

    it.each(['A', 'B'] as const)(
      'criterio 23: si otra instancia tiene el bloqueo de %s, esta vuelta la salta sin esperar y procesa la otra academia; la vuelta siguiente, ya libre, la procesa',
      async (retenida) => {
        const academia = retenida === 'A' ? A() : B();
        const otra = retenida === 'A' ? B() : A();
        const retenedor = await abrirRetenedor(academia);
        try {
          await retenedor.consultar(TOMAR_BLOQUEO, [`faltas:${academia}`]);

          await conLimite(
            ejecutarFaltas(ctx, AL_TERMINAR),
            'Límite de seguridad: la tarea esperó el bloqueo consultivo de otra instancia en lugar de saltar la academia.',
          );

          expect(await leerInasistencias(academia), `${retenida} tenía el bloqueo de otra instancia: se salta`).toEqual(
            [],
          );
          expect((await leerInasistencias(otra)).length, 'la otra academia sí se procesa').toBeGreaterThan(0);
        } finally {
          await retenedor.liberar('ROLLBACK');
        }

        await ejecutarFaltas(ctx, enLima(LUNES, '19:05:00.000'));

        expect((await leerInasistencias(academia)).length, 'con el bloqueo libre, la vuelta siguiente la procesa').toBe(
          retenida === 'A' ? deA.length : deB.length,
        );
      },
    );

    it('criterio 23: tras la vuelta el bloqueo de cada academia ya no está tomado (es un bloqueo de transacción: otra instancia lo toma de inmediato)', async () => {
      await ejecutarFaltas(ctx, AL_TERMINAR);

      const retenedor = await abrirRetenedor(A());
      try {
        for (const academia of [A(), B()]) {
          const [{ tomado }] = (await retenedor.consultar(INTENTAR_BLOQUEO, [`faltas:${academia}`])) as [
            { tomado: boolean },
          ];
          expect(tomado, `el bloqueo de ${academia} debía estar libre`).toBe(true);
        }
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });

    it('criterio 23: dos llamadas a la vez (dos instancias) dejan las mismas faltas una sola vez, sin error', async () => {
      await Promise.all([ejecutarFaltas(ctx, AL_TERMINAR), ejecutarFaltas(ctx, AL_TERMINAR)]);
      // La que saltó una academia por el bloqueo de la otra la procesa en la vuelta siguiente.
      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect((await leerInasistencias(A())).map((falta) => falta.alumno_id).sort()).toEqual(ids(deA));
      expect((await leerInasistencias(B())).map((falta) => falta.alumno_id)).toEqual(ids(deB));
      expect(await inasistenciasDe(A(), deA[0]?.alumnoId as string)).toHaveLength(1);
    });

    it('criterio 23: cuatro llamadas a la vez dejan una sola falta por alumno, clase y fecha', async () => {
      await Promise.all([1, 2, 3, 4].map(() => ejecutarFaltas(ctx, AL_TERMINAR)));
      await ejecutarFaltas(ctx, AL_TERMINAR);

      const todas = [...(await leerInasistencias(A())), ...(await leerInasistencias(B()))];
      expect(todas).toHaveLength(deA.length + deB.length);
      expect(new Set(todas.map((falta) => `${falta.alumno_id}|${falta.clase_id}|${falta.fecha}`)).size).toBe(
        todas.length,
      );
    });
  });
});
