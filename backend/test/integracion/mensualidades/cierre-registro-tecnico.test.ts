// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enLima, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  DICIEMBRE,
  ejecutarCierre,
  estadoDeLaMatricula,
  estadoDelAlumno,
  forzarFallaDeCierreEn,
  instantaneaDeAcademiaDelCierre,
  NOVIEMBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterios 27 y 29 (críticos, D-23, D-10, nota O1 de 001, RNF-06), parte del registro técnico y del error aislado: cada academia procesada deja un `info` `'Cierre de mes'` con la academia y las cantidades, sin alumnos ni DNI; una academia suspendida o saltada no deja
// ese registro; un error en una academia (forzado con un disparador que hace fallar los `UPDATE` de `matriculas` que la finalizan) se registra a nivel de error (`errorParaRegistro`, sin datos de los alumnos) y la tarea sigue con las demás: la vuelta no falla, la otra
// academia se cierra y la que falló no deja ningún cambio (su transacción se deshace, también los estados de sus alumnos); la vuelta siguiente, sin la falla, la recupera.
// Va en su propio archivo, con una sola aplicación y la primera del proceso: el registro técnico de pino (nivel y redacción) es global del proceso y lo fija la primera aplicación que se crea (como en `faltas-registro-tecnico.test.ts`).
// Lecturas estrictas elegidas: (1) «con la academia» es que el id de la academia aparece en la línea (no se fija el nombre del campo); (2) el error de una academia es una línea de nivel 50 o más; (3) no se exige que una academia sin nada que cerrar deje un `info`, pero
// ninguna línea del registro técnico lleva el DNI, el nombre, el apellido ni el id de un alumno ni de una matrícula; (4) la academia que falla no deja el `info` `'Cierre de mes'`, porque su cierre no se completó.

describe('el registro técnico del cierre de mes (criterios 27 y 29)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let deA: AlumnoConMatriculas[];
  let deB: AlumnoConMatriculas[];

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeCierre(ctx);
    const nuevo = (
      academia: 'A' | 'B',
      dni: string,
      estado: 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO',
      conDiciembre: boolean,
    ) =>
      sembrarAlumno(esc, {
        academia,
        dni,
        nombres: 'Genoveva',
        apellidos: 'Quispe Huamani',
        estado,
        matriculas: [
          { mes: NOVIEMBRE, estado: 'VIGENTE' },
          ...(conDiciembre ? [{ mes: DICIEMBRE, estado: 'VIGENTE' as const }] : []),
        ],
      });
    deA = [await nuevo('A', '47811902', 'ALUMNO_ACTIVO', false), await nuevo('A', '45678912', 'ALUMNO_ACTIVO', true)];
    deB = [await nuevo('B', '40123456', 'ALUMNO_ACTIVO', false)];
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const B = () => esc.e.B.id;
  const PRIMERO_DE_DICIEMBRE = enLima('2026-12-01', '00:00:00.000');

  const registros = () => lineasJson(lineas);
  const cerrados = () => registros().filter((registro) => registro['msg'] === 'Cierre de mes');
  const deLaAcademia = (academiaId: string) =>
    cerrados().filter((registro) => JSON.stringify(registro).includes(academiaId));
  const errores = () =>
    registros().filter((registro) => typeof registro['level'] === 'number' && registro['level'] >= 50);

  /** Ninguna línea del registro técnico lleva datos de los alumnos: DNI, nombres, apellidos, ids de alumno ni de matrícula. */
  function sinDatosDeAlumnos(): void {
    const texto = lineas.join('\n');
    for (const alumno of [...deA, ...deB]) {
      expect(texto, 'el DNI').not.toContain(alumno.dni);
      expect(texto, 'el id del alumno').not.toContain(alumno.alumnoId);
      for (const matriculaId of alumno.matriculaIds) expect(texto, 'el id de la matrícula').not.toContain(matriculaId);
    }
    expect(texto, 'el nombre').not.toContain('Genoveva');
    expect(texto, 'el apellido').not.toContain('Quispe');
  }

  const alumnoFinalizado = async (academiaId: string, alumno: AlumnoConMatriculas) =>
    (await estadoDeLaMatricula(academiaId, alumno.alumnoId, NOVIEMBRE)) === 'FINALIZADA';

  it('criterio 27: cada academia con trabajo deja un info «Cierre de mes» (nivel info) con su id, y ninguna línea del registro lleva alumnos, matrículas ni DNI', async () => {
    await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

    expect(deLaAcademia(A())).toHaveLength(1);
    expect(deLaAcademia(B())).toHaveLength(1);
    expect(deLaAcademia(A())[0]).toMatchObject({ level: 30 });
    expect(deLaAcademia(B())[0]).toMatchObject({ level: 30 });
    expect(await alumnoFinalizado(A(), deA[0] as AlumnoConMatriculas)).toBe(true);
    expect(errores(), 'una vuelta normal no deja errores').toEqual([]);
    sinDatosDeAlumnos();
  });

  it('criterio 27: una academia suspendida no se procesa y no deja registro; la activa sí', async () => {
    await fijarEstadoDeAcademia(B(), 'SUSPENDIDA');

    await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

    expect(deLaAcademia(B())).toEqual([]);
    expect(deLaAcademia(A())).toHaveLength(1);
    expect(await alumnoFinalizado(B(), deB[0] as AlumnoConMatriculas)).toBe(false);
    sinDatosDeAlumnos();
  });

  describe.each(['A', 'B'] as const)('un error forzado en la academia %s (criterio 29)', (falla) => {
    const quien = () => ({
      conFalla: falla === 'A' ? A() : B(),
      otra: falla === 'A' ? B() : A(),
      alumnosConFalla: falla === 'A' ? deA : deB,
      alumnosDeLaOtra: falla === 'A' ? deB : deA,
    });

    it('criterio 29: la vuelta no falla, la otra academia se cierra, la que falló no deja ningún cambio (ni en matrículas ni en estados de alumnos) y el error se registra sin datos de los alumnos', async () => {
      const { conFalla, otra, alumnosConFalla, alumnosDeLaOtra } = quien();
      const antesDeLaQueFalla = await instantaneaDeAcademiaDelCierre(conFalla);
      const quitarFalla = await forzarFallaDeCierreEn(conFalla);
      try {
        await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

        expect(await instantaneaDeAcademiaDelCierre(conFalla), 'su transacción se deshace: ninguna fila cambia').toBe(
          antesDeLaQueFalla,
        );
        for (const alumno of alumnosDeLaOtra)
          expect(await alumnoFinalizado(otra, alumno), 'la otra academia sigue').toBe(true);
        expect(await estadoDelAlumno(otra, (alumnosDeLaOtra[0] as AlumnoConMatriculas).alumnoId)).toBe(
          'ALUMNO_VENCIDO',
        );
        for (const alumno of alumnosConFalla) expect(await alumnoFinalizado(conFalla, alumno)).toBe(false);
        expect(errores().length, 'el error de la academia se registra a nivel de error').toBeGreaterThanOrEqual(1);
        expect(deLaAcademia(conFalla), 'la academia que falló no registra «Cierre de mes»').toEqual([]);
        expect(deLaAcademia(otra)).toHaveLength(1);
        sinDatosDeAlumnos();
      } finally {
        await quitarFalla();
      }
    });

    it('criterio 29: sin la falla, la vuelta siguiente recupera la academia que había fallado, sin volver a escribir la otra', async () => {
      const { conFalla, otra, alumnosConFalla } = quien();
      const quitarFalla = await forzarFallaDeCierreEn(conFalla);
      try {
        await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);
      } finally {
        await quitarFalla();
      }
      const deLaOtraAntes = await instantaneaDeAcademiaDelCierre(otra);

      await ejecutarCierre(ctx, enLima('2026-12-01', '00:15:00.000'));

      for (const alumno of alumnosConFalla) expect(await alumnoFinalizado(conFalla, alumno)).toBe(true);
      expect(await estadoDelAlumno(conFalla, (alumnosConFalla[0] as AlumnoConMatriculas).alumnoId)).toBe(
        'ALUMNO_VENCIDO',
      );
      expect(await instantaneaDeAcademiaDelCierre(otra)).toBe(deLaOtraAntes);
      expect(deLaAcademia(conFalla), 'la academia recuperada deja su «Cierre de mes»').toHaveLength(1);
      sinDatosDeAlumnos();
    });
  });
});
