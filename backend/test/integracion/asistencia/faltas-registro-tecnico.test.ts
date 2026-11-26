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
  forzarFallaDeFaltasEn,
  leerInasistencias,
  prepararEscenarioDe009b,
} from '../../utilidades/escenario-faltas';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterios 23 y 26 (críticos, D-23, nota O1 de 001, RNF-06), parte del registro técnico: cada academia procesada deja un `info` `'Faltas registradas'` con la academia (`academiaId`) y la cantidad (`cantidad`), sin alumnos, matrículas ni DNI; una
// academia suspendida o saltada no deja ese registro; un error en una academia (forzado con un disparador que hace fallar los `INSERT` de `inasistencias` de esa academia) se registra a nivel de error (`errorParaRegistro`, sin datos de los
// alumnos) y la tarea sigue con las demás: la vuelta no falla, la otra academia registra sus faltas y la que falló no deja ninguna (su transacción se deshace); la vuelta siguiente, sin la falla, la recupera.
// Va en su propio archivo, con una sola aplicación y la primera del proceso: el registro técnico de pino (nivel y redacción) es global del proceso y lo fija la primera aplicación que se crea (como en `token-fuera-de-sitio.test.ts`).
// Lecturas estrictas elegidas: los nombres de los campos del `info` son `academiaId` y `cantidad`, los del plan (`plan.md`, «Faltas», paso 6); el error de una academia es una línea de nivel 50 o más; no se exige que una academia sin faltas nuevas
// deje un `info` con cantidad 0 (la spec no lo dice), pero ninguna línea del registro técnico lleva el DNI, el nombre, el apellido ni el id de un alumno ni de una matrícula.

describe('el registro técnico de la tarea de faltas (criterios 23 y 26)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let deA: AlumnoDeAsistencia[];
  let deB: AlumnoDeAsistencia[];

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx, { rutas: false });
    deA = [
      await crearAlumnoDeAsistencia(ctx, esc, { dni: '47811902' }),
      await crearAlumnoDeAsistencia(ctx, esc, { dni: '45678912' }),
    ];
    deB = [await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B', dni: '40123456' })];
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const B = () => esc.e.B.id;
  const AL_TERMINAR = enLima(LUNES, '19:00:00.000');

  const registros = () => lineasJson(lineas);
  const registradas = () => registros().filter((registro) => registro['msg'] === 'Faltas registradas');
  const deLaAcademia = (academiaId: string) =>
    registradas().filter((registro) => JSON.stringify(registro).includes(academiaId));
  const errores = () =>
    registros().filter((registro) => typeof registro['level'] === 'number' && registro['level'] >= 50);

  /** Ninguna línea del registro técnico lleva datos de los alumnos: DNI, nombres, apellidos, ids de alumno ni de matrícula. */
  function sinDatosDeAlumnos(): void {
    const texto = lineas.join('\n');
    for (const alumno of [...deA, ...deB]) {
      expect(texto, 'el DNI').not.toContain(alumno.dni);
      expect(texto, 'el id del alumno').not.toContain(alumno.alumnoId);
      expect(texto, 'el id de la matrícula').not.toContain(alumno.matriculaId);
    }
    expect(texto, 'el nombre').not.toContain('Valeria');
    expect(texto, 'el apellido').not.toContain('Mendoza');
  }

  it('criterio 23: cada academia con faltas deja un info «Faltas registradas» con su id y la cantidad, y ninguna línea del registro lleva alumnos ni DNI', async () => {
    await ejecutarFaltas(ctx, AL_TERMINAR);

    const deLaA = deLaAcademia(A());
    const deLaB = deLaAcademia(B());
    expect(deLaA).toHaveLength(1);
    expect(deLaB).toHaveLength(1);
    expect(deLaA[0]).toMatchObject({ level: 30, academiaId: A(), cantidad: 2 });
    expect(deLaB[0]).toMatchObject({ level: 30, academiaId: B(), cantidad: 1 });
    expect(await leerInasistencias(A())).toHaveLength(2);
    sinDatosDeAlumnos();
  });

  it('criterio 23: una academia suspendida no se procesa y no deja registro; la activa sí', async () => {
    await fijarEstadoDeAcademia(B(), 'SUSPENDIDA');

    await ejecutarFaltas(ctx, AL_TERMINAR);

    expect(deLaAcademia(B())).toEqual([]);
    expect(deLaAcademia(A())).toHaveLength(1);
    expect(await leerInasistencias(B())).toEqual([]);
    sinDatosDeAlumnos();
  });

  describe.each(['A', 'B'] as const)('un error forzado en la academia %s (criterio 26)', (falla) => {
    it('criterio 26: la vuelta no falla, la otra academia registra sus faltas, la que falló no deja ninguna y el error se registra sin datos de los alumnos', async () => {
      const academiaQueFalla = falla === 'A' ? A() : B();
      const otra = falla === 'A' ? B() : A();
      const quitarFalla = await forzarFallaDeFaltasEn(academiaQueFalla);
      try {
        await ejecutarFaltas(ctx, AL_TERMINAR);

        expect(await leerInasistencias(academiaQueFalla), 'su transacción se deshace: ninguna falta').toEqual([]);
        expect((await leerInasistencias(otra)).length, 'la otra academia sigue').toBe(
          falla === 'A' ? deB.length : deA.length,
        );
        expect(errores().length, 'el error de la academia se registra a nivel de error').toBeGreaterThanOrEqual(1);
        expect(deLaAcademia(academiaQueFalla), 'la academia que falló no registra «Faltas registradas»').toEqual([]);
        expect(deLaAcademia(otra)).toHaveLength(1);
        sinDatosDeAlumnos();
      } finally {
        await quitarFalla();
      }
    });

    it('criterio 26: sin la falla, la vuelta siguiente recupera las faltas de la academia que había fallado, sin duplicar las de la otra', async () => {
      const academiaQueFalla = falla === 'A' ? A() : B();
      const otra = falla === 'A' ? B() : A();
      const quitarFalla = await forzarFallaDeFaltasEn(academiaQueFalla);
      try {
        await ejecutarFaltas(ctx, AL_TERMINAR);
      } finally {
        await quitarFalla();
      }
      const deLaOtraAntes = (await leerInasistencias(otra)).map((falta) => falta.id).sort();

      await ejecutarFaltas(ctx, enLima(LUNES, '19:05:00.000'));

      expect((await leerInasistencias(academiaQueFalla)).length).toBe(falla === 'A' ? deA.length : deB.length);
      expect((await leerInasistencias(otra)).map((falta) => falta.id).sort()).toEqual(deLaOtraAntes);
      sinDatosDeAlumnos();
    });
  });
});
