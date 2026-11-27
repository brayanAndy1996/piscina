// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia, prepararEscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  DICIEMBRE,
  exigirRutasDe010b,
  listadoDe,
  NOVIEMBRE,
  OCTUBRE,
  rutaListado,
  sembrarAlumno,
  sumaDeNumeros,
} from '../../utilidades/escenario-cierre';
import { INSTANTES } from '../../utilidades/escenario-renovacion';
import type { RespuestaApi } from '../../utilidades/inscripciones';

// Criterio 26 (crítico, D-23, Ley 29733), la parte del aislamiento: con A y B, el listado de A no trae alumnos, matrículas, planes ni clases de B, y un `planId` o `claseId` de B no devuelve nada; el de B, lo mismo con A. Con A y B con el mismo DNI y clases a la misma hora.
// Lecturas estrictas elegidas: (1) «no devuelve nada» es 200 con `alumnos` vacío y totales en cero (los filtros son uuid válidos que no existen en la academia de la sesión); (2) el listado de una academia no contiene, en ninguna parte del texto de la respuesta, el id, el nombre, el
// apellido ni el DNI de un alumno de la otra, ni el id o el nombre de su plan, ni los ids de sus clases, ni su id de academia; (3) `?academiaId=` (un parámetro que la API no define) no cambia nada: responde 400 `SOLICITUD_INVALIDA` o el mismo listado de la academia de la sesión, nunca el de otra;
// (4) los totales cuentan solo a los alumnos de la academia de la sesión (con los demás filtros aplicados); (5) sin DNI, datos médicos ni apoderado en las filas (DT-14): la respuesta no contiene el DNI de ningún alumno ni claves con esos nombres.

const DNI_COMUN = '45612378';
const APELLIDO_DE_B = 'Zegarra Bocanegra';
const APELLIDO_DE_A = 'Apaza Condori';

describe('aislamiento entre academias en el listado de mensualidades (criterio 26)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let galletas: ReturnType<typeof en>;
  let deA: {
    alDia: AlumnoConMatriculas;
    otro: AlumnoConMatriculas;
    vencido: AlumnoConMatriculas;
    conDiciembre: AlumnoConMatriculas;
  };
  let deB: typeof deA;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    exigirRutasDe010b(ctx.app);
    const sembrarDe = async (academia: 'A' | 'B', apellidos: string, primerDni: string) => ({
      alDia: await sembrarAlumno(esc, {
        academia,
        apellidos,
        nombres: 'Alumno uno',
        dni: primerDni,
        estado: 'ALUMNO_ACTIVO',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
      }),
      otro: await sembrarAlumno(esc, {
        academia,
        apellidos,
        nombres: 'Alumno dos',
        estado: 'ALUMNO_ACTIVO',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE', clasesUsadas: 6 }],
      }),
      vencido: await sembrarAlumno(esc, {
        academia,
        apellidos,
        nombres: 'Alumno tres',
        estado: 'ALUMNO_VENCIDO',
        matriculas: [{ mes: OCTUBRE, estado: 'FINALIZADA' }],
      }),
      conDiciembre: await sembrarAlumno(esc, {
        academia,
        apellidos,
        nombres: 'Alumno cuatro',
        estado: 'ALUMNO_ACTIVO',
        matriculas: [
          { mes: NOVIEMBRE, estado: 'VIGENTE' },
          { mes: DICIEMBRE, estado: 'RESERVADA' },
        ],
      }),
    });
    deA = await sembrarDe('A', APELLIDO_DE_A, DNI_COMUN);
    deB = await sembrarDe('B', APELLIDO_DE_B, DNI_COMUN);
    galletas = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const idsDe = (academia: typeof deA): string[] =>
    Object.values(academia)
      .map((alumno) => alumno.alumnoId)
      .sort();
  const pedir = (cookie: string, consulta: Record<string, string> = {}): Promise<RespuestaApi> =>
    ctx.http.get(rutaListado(consulta), { cookie });
  const filas = (respuesta: RespuestaApi) =>
    listadoDe(respuesta)
      .alumnos.map((fila) => fila.alumnoId)
      .sort();

  /** Todo lo que identifica a una academia dentro de la otra: ids de sus alumnos, matrículas, plan, clases y la academia; su apellido y su nombre del plan. */
  function huellasDe(academia: 'A' | 'B'): string[] {
    const { e } = esc;
    const alumnos = academia === 'A' ? deA : deB;
    return [
      ...Object.values(alumnos).flatMap((alumno) => [alumno.alumnoId, ...alumno.matriculaIds]),
      academia === 'A' ? e.A.id : e.B.id,
      academia === 'A' ? e.plan.id : e.planB.id,
      ...(academia === 'A'
        ? [e.lunes.id, e.miercoles.id, e.viernes.id]
        : [e.lunesB.id, e.miercolesB.id, e.viernesB.id]),
      academia === 'A' ? APELLIDO_DE_A : APELLIDO_DE_B,
    ];
  }

  it('criterio 26: el escenario tiene el mismo DNI en A y en B y clases a la misma hora', () => {
    expect([esc.e.lunes.hora_inicio, esc.e.lunes.dia_semana]).toEqual([
      esc.e.lunesB.hora_inicio,
      esc.e.lunesB.dia_semana,
    ]);
    expect([deA.alDia.dni, deB.alDia.dni]).toEqual([DNI_COMUN, DNI_COMUN]);
    expect(esc.e.plan.id).not.toBe(esc.e.planB.id);
  });

  it('criterio 26: el listado de noviembre de A trae solo a los cuatro alumnos de A, con matrículas y plan de A, y nada que identifique a B', async () => {
    const respuesta = await pedir(galletas.secretaria, { mes: '2026-11' });

    const listado = listadoDe(respuesta);
    expect(filas(respuesta)).toEqual(idsDe(deA));
    for (const fila of listado.alumnos) {
      expect(fila.mensualidad?.plan.id, 'el plan de cada fila es el de A').toBe(esc.e.plan.id);
    }
    for (const huella of huellasDe('B'))
      expect(respuesta.texto, `una huella de B (${huella}) en el listado de A`).not.toContain(huella);
    expect(sumaDeNumeros(listado.totales), 'los totales cuentan los cuatro alumnos de A').toBe(4);
  });

  it('criterio 26: el listado de B con la sesión de B trae solo a los alumnos de B y nada de A (aunque tengan el mismo DNI)', async () => {
    const respuesta = await pedir(galletas.secretariaB, { mes: '2026-11' });

    const listado = listadoDe(respuesta);
    expect(filas(respuesta)).toEqual(idsDe(deB));
    for (const fila of listado.alumnos) expect(fila.mensualidad?.plan.id).toBe(esc.e.planB.id);
    for (const huella of huellasDe('A'))
      expect(respuesta.texto, `una huella de A (${huella}) en el listado de B`).not.toContain(huella);
    expect(sumaDeNumeros(listado.totales)).toBe(4);
  });

  it('criterio 26: también con el administrador de A y con el mes de octubre (el mes anterior de los vencidos): nada de B', async () => {
    for (const mes of ['2026-10', '2026-11']) {
      const respuesta = await pedir(galletas.admin, { mes });

      listadoDe(respuesta);
      for (const huella of huellasDe('B')) expect(respuesta.texto, `${mes}: una huella de B`).not.toContain(huella);
    }
  });

  describe('un planId o un claseId de otra academia no devuelve nada', () => {
    it('criterio 26: el plan de B con la sesión de A: 200 con ningún alumno y totales en cero; el plan de A sí trae a los de A', async () => {
      const conElDeB = await pedir(galletas.secretaria, { mes: '2026-11', planId: esc.e.planB.id });
      const conElDeA = await pedir(galletas.secretaria, { mes: '2026-11', planId: esc.e.plan.id });

      expect(listadoDe(conElDeB).alumnos).toEqual([]);
      expect(sumaDeNumeros(listadoDe(conElDeB).totales)).toBe(0);
      expect(filas(conElDeA)).toEqual(idsDe(deA));
    });

    it.each([
      ['lunes', 'lunesB'],
      ['miércoles', 'miercolesB'],
      ['viernes', 'viernesB'],
    ] as const)(
      'criterio 26: la clase del %s de B con la sesión de A: 200 con ningún alumno',
      async (_dia, claseDeB) => {
        const respuesta = await pedir(galletas.secretaria, { mes: '2026-11', claseId: esc.e[claseDeB].id });

        expect(listadoDe(respuesta).alumnos).toEqual([]);
        expect(sumaDeNumeros(listadoDe(respuesta).totales)).toBe(0);
      },
    );

    it('criterio 26: la clase de A, a la misma hora que la de B, trae a los alumnos de A y no a los de B; y el plan de A con la clase de B no trae nada', async () => {
      const conLaDeA = await pedir(galletas.secretaria, { mes: '2026-11', claseId: esc.e.lunes.id });
      const mezclado = await pedir(galletas.secretaria, {
        mes: '2026-11',
        planId: esc.e.plan.id,
        claseId: esc.e.lunesB.id,
      });

      const ids = filas(conLaDeA);
      expect(ids.length, 'los alumnos de A con la clase de los lunes').toBeGreaterThan(0);
      for (const id of ids) expect(idsDe(deA)).toContain(id);
      expect(listadoDe(mezclado).alumnos).toEqual([]);
    });

    it('criterio 26: lo mismo desde B: el plan y la clase de A con la sesión de B no devuelven nada', async () => {
      const conElPlan = await pedir(galletas.secretariaB, { mes: '2026-11', planId: esc.e.plan.id });
      const conLaClase = await pedir(galletas.secretariaB, { mes: '2026-11', claseId: esc.e.lunes.id });

      expect(listadoDe(conElPlan).alumnos).toEqual([]);
      expect(listadoDe(conLaClase).alumnos).toEqual([]);
    });
  });

  describe('lo que la API no define no cambia la academia', () => {
    it.each([
      ['el de B', () => esc.e.B.id],
      ['uno que no existe', () => '00000000-0000-4000-8000-0000000000ff'],
    ])(
      'criterio 26: «?academiaId=» con %s responde 400 SOLICITUD_INVALIDA o el mismo listado de A, nunca el de otra academia',
      async (_nombre, academiaId) => {
        const base = await pedir(galletas.secretaria, { mes: '2026-11' });

        const respuesta = await pedir(galletas.secretaria, { mes: '2026-11', academiaId: academiaId() });

        if (respuesta.status === 400) {
          expect(respuesta.body?.['codigo']).toBe('SOLICITUD_INVALIDA');
        } else {
          expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(200);
          expect(respuesta.body).toEqual(base.body);
        }
        for (const huella of huellasDe('B')) expect(respuesta.texto).not.toContain(huella);
      },
    );
  });

  describe('sin datos sensibles (Ley 29733, DT-14)', () => {
    it('criterio 26: el listado no lleva el DNI de ningún alumno ni claves de DNI, ficha médica o apoderado', async () => {
      const respuesta = await pedir(galletas.secretaria, { mes: '2026-11' });

      listadoDe(respuesta);
      for (const alumno of Object.values(deA)) expect(respuesta.texto, 'el DNI').not.toContain(alumno.dni);
      expect(respuesta.texto).not.toMatch(
        /"(dni|apoderado|apoderados|ficha|fichaMedica|alergias|enfermedades|medicamentos|telefono|correo)"/i,
      );
    });
  });
});
