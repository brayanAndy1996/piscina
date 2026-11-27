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
  instantaneaDeAcademiaDelCierre,
  instantaneaDelCierre,
  NOVIEMBRE,
  OCTUBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
  vigilarCierre,
} from '../../utilidades/escenario-cierre';
import { abrirRetenedor, conLimite } from '../../utilidades/planes-clases';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterios 27 y 29 (críticos, D-23, D-10, nota O1 de 001): `CierreDeMesService.cerrar(ahora)` lee las academias `ACTIVA` con `comoPlataforma`, cierra esa transacción y procesa cada academia en su propio `conAcademia`, una tras otra; la primera sentencia de cada
// una es `pg_try_advisory_xact_lock(hashtextextended('cierre-de-mes:' || academia, 0))`, y si otra instancia lo tiene, se salta esa academia en esta vuelta (no espera). Una academia suspendida no se procesa. Con A y B: el cierre de A solo escribe filas de A con el
// contexto de A (y el de B, las de B); con B suspendida, solo A.
// Lecturas estrictas elegidas: (1) la clave del bloqueo consultivo es `'cierre-de-mes:'` más el id de la academia en su forma de texto habitual (minúsculas con guiones); la prueba toma ese bloqueo con otra conexión (la de «otra instancia») y la tarea debe terminar sin
// esperarlo (límite de seguridad de 15 s) y dejar sin tocar solo esa academia; (2) el bloqueo es de transacción: después de cada vuelta ya no está tomado; (3) el bloqueo de la tarea de faltas (`'faltas:'`) es otro: quien lo tiene no impide el cierre; (4) «con el contexto
// de A» se prueba con un disparador temporal que hace fallar (`P0001`) todo `UPDATE` de `matriculas` o `alumnos` cuya `academia_id` no sea la del contexto de la transacción (`app.academia_id`): si el cierre escribiera con el contexto de la plataforma o de otra academia, no
// terminaría el trabajo; (5) una academia suspendida y luego reactivada se procesa en la vuelta siguiente; (6) una academia sin nada que cerrar queda intacta, con sus fechas de actualización.

const PRIMERO_DE_DICIEMBRE = enLima('2026-12-01', '00:00:00.000');
const MAS_TARDE = enLima('2026-12-01', '00:15:00.000');

describe('el cierre de mes por academia (criterios 27 y 29)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let deA: { sinRenovar: AlumnoConMatriculas; vencidoQuePago: AlumnoConMatriculas; renovo: AlumnoConMatriculas };
  let deB: { sinRenovar: AlumnoConMatriculas; vencidoQuePago: AlumnoConMatriculas; renovo: AlumnoConMatriculas };

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeCierre(ctx);
    const sembrarDe = async (academia: 'A' | 'B') => ({
      sinRenovar: await sembrarAlumno(esc, {
        academia,
        estado: 'ALUMNO_ACTIVO',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE', clasesUsadas: 4 }],
      }),
      vencidoQuePago: await sembrarAlumno(esc, {
        academia,
        estado: 'ALUMNO_VENCIDO',
        matriculas: [
          { mes: OCTUBRE, estado: 'FINALIZADA' },
          { mes: DICIEMBRE, estado: 'VIGENTE' },
        ],
      }),
      renovo: await sembrarAlumno(esc, {
        academia,
        estado: 'ALUMNO_ACTIVO',
        matriculas: [
          { mes: NOVIEMBRE, estado: 'VIGENTE' },
          { mes: DICIEMBRE, estado: 'VIGENTE' },
        ],
      }),
    });
    deA = await sembrarDe('A');
    deB = await sembrarDe('B');
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const B = () => esc.e.B.id;

  /** Lo que una academia debe tener después de procesarla el 1/12. */
  async function comprobarProcesada(academiaId: string, de: typeof deA): Promise<void> {
    expect(await estadoDeLaMatricula(academiaId, de.sinRenovar.alumnoId, NOVIEMBRE), 'noviembre sin renovar').toBe(
      'FINALIZADA',
    );
    expect(await estadoDelAlumno(academiaId, de.sinRenovar.alumnoId)).toBe('ALUMNO_VENCIDO');
    expect(await estadoDelAlumno(academiaId, de.vencidoQuePago.alumnoId)).toBe('ALUMNO_ACTIVO');
    expect(await estadoDeLaMatricula(academiaId, de.renovo.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
    expect(await estadoDeLaMatricula(academiaId, de.renovo.alumnoId, DICIEMBRE)).toBe('VIGENTE');
    expect(await estadoDelAlumno(academiaId, de.renovo.alumnoId)).toBe('ALUMNO_ACTIVO');
  }

  /** Lo que una academia debe tener sin procesar. */
  async function comprobarSinProcesar(academiaId: string, de: typeof deA): Promise<void> {
    expect(await estadoDeLaMatricula(academiaId, de.sinRenovar.alumnoId, NOVIEMBRE), 'noviembre sin procesar').toBe(
      'VIGENTE',
    );
    expect(await estadoDelAlumno(academiaId, de.sinRenovar.alumnoId)).toBe('ALUMNO_ACTIVO');
    expect(await estadoDelAlumno(academiaId, de.vencidoQuePago.alumnoId)).toBe('ALUMNO_VENCIDO');
    expect(await estadoDeLaMatricula(academiaId, de.renovo.alumnoId, NOVIEMBRE)).toBe('VIGENTE');
  }

  describe('varias academias a la misma hora (criterio 29)', () => {
    it('criterio 29: con A y B a la misma hora, cada academia queda como corresponde a sus propios alumnos y matrículas', async () => {
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      await comprobarProcesada(A(), deA);
      await comprobarProcesada(B(), deB);
    });

    it('criterio 29: el cierre de A solo escribe filas de A con el contexto de A, y el de B las de B (un disparador hace fallar cualquier UPDATE con el contexto de otra academia)', async () => {
      const vigilancia = await vigilarCierre();
      try {
        await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

        await comprobarProcesada(A(), deA);
        await comprobarProcesada(B(), deB);
        const academias = new Set((await vigilancia.sentencias()).map((sentencia) => sentencia.academia));
        expect([...academias].sort(), 'toda sentencia corrió con el contexto de A o de B, nunca sin contexto').toEqual(
          [A(), B()].sort(),
        );
      } finally {
        await vigilancia.quitar();
      }
    });

    it('criterio 29: si solo A tiene trabajo, las filas de B (también sus fechas de actualización) no cambian', async () => {
      // B ya está como debe: se procesa una vez y se vuelve a tomar la instantánea de B solamente.
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);
      const sembrada = await sembrarAlumno(esc, {
        academia: 'A',
        estado: 'ALUMNO_ACTIVO',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
      });
      const deBAntes = await instantaneaDeAcademiaDelCierre(B());

      await ejecutarCierre(ctx, MAS_TARDE);

      expect(await estadoDeLaMatricula(A(), sembrada.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
      expect(await instantaneaDeAcademiaDelCierre(B()), 'B no tenía nada que cerrar').toBe(deBAntes);
    });
  });

  describe('una academia suspendida no se procesa (criterio 27)', () => {
    it('criterio 27: con B suspendida se procesa A y B queda intacta; al reactivarla, la vuelta siguiente la procesa sin tocar lo de A', async () => {
      await fijarEstadoDeAcademia(B(), 'SUSPENDIDA');
      const deBAntes = await instantaneaDeAcademiaDelCierre(B());

      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      await comprobarProcesada(A(), deA);
      await comprobarSinProcesar(B(), deB);
      expect(await instantaneaDeAcademiaDelCierre(B()), 'B suspendida: ninguna fila cambia').toBe(deBAntes);

      await fijarEstadoDeAcademia(B(), 'ACTIVA');
      const deAAntes = await instantaneaDeAcademiaDelCierre(A());
      await ejecutarCierre(ctx, MAS_TARDE);

      await comprobarProcesada(B(), deB);
      expect(await instantaneaDeAcademiaDelCierre(A()), 'las de A no se vuelven a escribir').toBe(deAAntes);
    });

    it('criterio 27: con A suspendida se procesa B y A queda intacta', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');

      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      await comprobarSinProcesar(A(), deA);
      await comprobarProcesada(B(), deB);
    });

    it('criterio 27: con las dos suspendidas la vuelta termina sin cambiar nada y sin fallar', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');
      await fijarEstadoDeAcademia(B(), 'SUSPENDIDA');
      const antes = await instantaneaDelCierre(esc);

      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      expect(await instantaneaDelCierre(esc)).toBe(antes);
    });
  });

  describe('el bloqueo consultivo entre instancias (criterio 27)', () => {
    /** La clave que toma cada instancia por academia: `hashtextextended('cierre-de-mes:' || academia, 0)`. */
    const TOMAR_BLOQUEO = 'SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))';
    const INTENTAR_BLOQUEO =
      'SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0)) AS tomado';

    it.each(['A', 'B'] as const)(
      'criterio 27: si otra instancia tiene el bloqueo de %s, esta vuelta la salta sin esperar y procesa la otra academia; la vuelta siguiente, ya libre, la procesa',
      async (retenida) => {
        const academia = retenida === 'A' ? A() : B();
        const otra = retenida === 'A' ? B() : A();
        const retenedor = await abrirRetenedor(academia);
        try {
          await retenedor.consultar(TOMAR_BLOQUEO, [`cierre-de-mes:${academia}`]);

          await conLimite(
            ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE),
            'Límite de seguridad: el cierre esperó el bloqueo consultivo de otra instancia en lugar de saltar la academia.',
          );

          await comprobarSinProcesar(academia, retenida === 'A' ? deA : deB);
          await comprobarProcesada(otra, retenida === 'A' ? deB : deA);
        } finally {
          await retenedor.liberar('ROLLBACK');
        }

        await ejecutarCierre(ctx, MAS_TARDE);

        await comprobarProcesada(academia, retenida === 'A' ? deA : deB);
      },
    );

    it('criterio 27: el bloqueo de la tarea de faltas (`faltas:`) es otro: quien lo tiene no impide el cierre de esa academia', async () => {
      const retenedor = await abrirRetenedor(A());
      try {
        await retenedor.consultar(TOMAR_BLOQUEO, [`faltas:${A()}`]);

        await conLimite(
          ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE),
          'Límite de seguridad: el cierre esperó el bloqueo de las faltas.',
        );

        await comprobarProcesada(A(), deA);
        await comprobarProcesada(B(), deB);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });

    it('criterio 27: tras la vuelta el bloqueo de cada academia ya no está tomado (es un bloqueo de transacción: otra instancia lo toma de inmediato)', async () => {
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      const retenedor = await abrirRetenedor(A());
      try {
        for (const academia of [A(), B()]) {
          const [{ tomado }] = (await retenedor.consultar(INTENTAR_BLOQUEO, [`cierre-de-mes:${academia}`])) as [
            { tomado: boolean },
          ];
          expect(tomado, `el bloqueo de ${academia} debía estar libre`).toBe(true);
        }
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });
});
