// spec: 011-panel-alumno (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { consultaDe, filaInasistenciaValida, insertarInasistencia } from '../../utilidades/escenario-faltas';
import {
  codigoDe,
  panelDe,
  pedirCrudo,
  prepararEscenarioDelPanel,
  renombrarPlan,
  RUTA_MI_ASISTENCIA,
  RUTA_MI_PANEL,
  RUTAS_DEL_PANEL,
} from '../../utilidades/escenario-panel';
import { cookieDeUsuario, crearUsuarioDePrueba, fijarEstadoDeAcademia } from '../../utilidades/usuarios';
import { AHORA_007 } from '../../utilidades/escenario-pagos';

// Criterio 5 (crítico, D-23, D-28): la persona P (mismo DNI) es alumna de A y de B, con cuentas, planes, clases, asistencias y faltas distintas, y nombres de academia distintos. Con la sesión de P en A, ninguna de las dos rutas trae nada de B; con la de B, nada de A. Con la transacción de A, la
// consulta del alumno de la sesión con el `usuario_id` de la cuenta de B no devuelve filas (RLS) y la ruta responde 404. Suspender B no cambia las respuestas de A.
// Lecturas estrictas elegidas: P tiene el mismo nombre en las dos (es la misma persona) y se distingue por el nivel, el plan, la clase y las asistencias; «la ruta responde 404» se prueba con una cuenta de A sin ficha en A cuya persona sí es alumna de B, y con una sesión firmada con el usuario de B pero la academia de A
// (que no puede entrar: 401 o 404, nunca los datos de B); la consulta del RLS se corre con el rol de la aplicación y el contexto de A, con y sin el filtro de academia; el reloj está en el 24/11/2026 a las 10:00 de Lima.

const AHORA = enLima('2026-11-24', '10:00:00.000');
const DNI_DE_P = '32000001';
const PLAN_DE_B = 'Plan Exclusivo De Academia B';

describe('la misma persona en dos academias no mezcla datos (criterio 5)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let enA: AlumnoDeAsistencia;
  let enB: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    enA = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: DNI_DE_P,
      nombres: 'Paula',
      apellidos: 'Persona Doble',
      nivel: 'BASICO',
      claseIds: [esc.e.lunes.id],
      clasesUsadas: 3,
    });
    await renombrarPlan(esc.e.B.id, esc.e.planB.id, PLAN_DE_B);
    enB = await crearAlumnoDeAsistencia(ctx, esc, {
      academia: 'B',
      dni: DNI_DE_P,
      nombres: 'Paula',
      apellidos: 'Persona Doble',
      nivel: 'AVANZADO',
      claseIds: [esc.lunes19B.id],
      clasesTotales: 10,
      clasesUsadas: 8,
    });
    const asistencia = async (
      a: AlumnoDeAsistencia,
      claseId: string,
      usuarioId: string,
      fecha: string,
      hora: string,
    ) => {
      const llegada = enLima(fecha, hora);
      await insertarAsistencia(
        'propietario',
        a.academiaId,
        filaAsistenciaValida(
          { alumnoId: a.alumnoId, matriculaId: a.matriculaId, claseId, usuarioId },
          { fecha, llegada_en: llegada, registrado_en: llegada },
        ),
      );
    };
    const falta = (a: AlumnoDeAsistencia, claseId: string, fecha: string) =>
      insertarInasistencia(
        'propietario',
        a.academiaId,
        filaInasistenciaValida(
          { alumnoId: a.alumnoId, matriculaId: a.matriculaId, claseId },
          { fecha, registrada_en: enLima(fecha, '20:05') },
        ),
      );
    await asistencia(enA, esc.e.lunes.id, esc.e.secretariaA.id, '2026-11-02', '18:03');
    await falta(enA, esc.e.lunes.id, '2026-11-09');
    await asistencia(enB, esc.lunes19B.id, esc.e.secretariaB.id, '2026-11-16', '19:04');
    await falta(enB, esc.lunes19B.id, '2026-11-23');
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const pedir = (ruta: string, cookie: string) => pedirCrudo(ctx.app, 'GET', ruta, { cookie });
  const DE_B = () => [
    PLAN_DE_B,
    'AVANZADO',
    '19:04',
    '2026-11-16',
    '2026-11-23',
    enB.alumnoId,
    enB.usuarioId,
    enB.matriculaId,
    enB.token,
    esc.e.B.id,
    'Academia B',
    'academia-b',
  ];
  const DE_A = () => [
    'Plan 3 por semana',
    'BASICO',
    '18:03',
    '2026-11-02',
    '2026-11-09',
    enA.alumnoId,
    enA.usuarioId,
    enA.matriculaId,
    enA.token,
    esc.e.A.id,
    'Academia A',
    'academia-a',
  ];
  const sinNada = (texto: string, ajenos: readonly string[], contexto: string) => {
    for (const ajeno of ajenos) expect(texto, `${contexto}: no debe aparecer «${ajeno}»`).not.toContain(ajeno);
  };

  it('las dos cuentas de P son distintas y cada una tiene su ficha en su academia', () => {
    expect(enA.usuarioId).not.toBe(enB.usuarioId);
    expect(enA.alumnoId).not.toBe(enB.alumnoId);
    expect(enA.dni).toBe(enB.dni);
  });

  it('con la sesión de P en A, el resumen y la asistencia son los de A y no traen nada de B', async () => {
    const resumen = await pedir(RUTA_MI_PANEL, enA.cookie);
    const asistencia = await pedir(`${RUTA_MI_ASISTENCIA}?mes=2026-11`, enA.cookie);

    const panel = panelDe(resumen);
    expect(panel.alumno).toMatchObject({ nombres: 'Paula', dni: DNI_DE_P, nivel: 'BASICO' });
    expect(panel.mensualidad.actual).toMatchObject({
      plan: { nombre: 'Plan 3 por semana' },
      clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
      clasesUsadas: 3,
      clasesTotales: 12,
      clasesRestantes: 9,
    });
    const consulta = consultaDe(asistencia);
    expect(consulta.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 3, clasesRestantes: 9 });
    expect(consulta.registros.map((registro) => [registro.tipo, registro.fecha])).toEqual([
      ['ASISTENCIA', '2026-11-02'],
      ['FALTA', '2026-11-09'],
    ]);
    sinNada(resumen.texto, DE_B(), 'resumen de A');
    sinNada(asistencia.texto, DE_B(), 'asistencia de A');
  });

  it('con la sesión de P en B, el resumen y la asistencia son los de B y no traen nada de A', async () => {
    const resumen = await pedir(RUTA_MI_PANEL, enB.cookie);
    const asistencia = await pedir(`${RUTA_MI_ASISTENCIA}?mes=2026-11`, enB.cookie);

    const panel = panelDe(resumen);
    expect(panel.alumno).toMatchObject({ nombres: 'Paula', dni: DNI_DE_P, nivel: 'AVANZADO' });
    expect(panel.mensualidad.actual).toMatchObject({
      plan: { nombre: PLAN_DE_B },
      clases: [{ diaSemana: 1, horaInicio: '19:00', horaFin: '20:00' }],
      clasesUsadas: 8,
      clasesTotales: 10,
      clasesRestantes: 2,
    });
    const consulta = consultaDe(asistencia);
    expect(consulta.matricula).toEqual({ clasesTotales: 10, clasesUsadas: 8, clasesRestantes: 2 });
    expect(consulta.registros.map((registro) => [registro.tipo, registro.fecha])).toEqual([
      ['ASISTENCIA', '2026-11-16'],
      ['FALTA', '2026-11-23'],
    ]);
    sinNada(resumen.texto, DE_A(), 'resumen de B');
    sinNada(asistencia.texto, DE_A(), 'asistencia de B');
  });

  it('con ?academiaId, ?nombreCorto, el id de la ficha de B y las cabeceras de B, la sesión de A sigue viendo solo A, y la de B solo B', async () => {
    for (const { ruta } of RUTAS_DEL_PANEL) {
      const rutaConMes = ruta === RUTA_MI_ASISTENCIA ? `${ruta}?mes=2026-11` : ruta;
      const unir = (extra: string) => `${rutaConMes}${rutaConMes.includes('?') ? '&' : '?'}${extra}`;
      const baseA = await pedir(rutaConMes, enA.cookie);
      const baseB = await pedir(rutaConMes, enB.cookie);

      const deA = [
        await pedir(
          unir(`academiaId=${esc.e.B.id}&nombreCorto=academia-b&alumnoId=${enB.alumnoId}&usuarioId=${enB.usuarioId}`),
          enA.cookie,
        ),
        await pedirCrudo(ctx.app, 'GET', rutaConMes, {
          cookie: enA.cookie,
          headers: {
            'x-academia-id': esc.e.B.id,
            'x-alumno-id': enB.alumnoId,
            'x-usuario-id': enB.usuarioId,
            'x-forwarded-host': 'academia-b.ejemplo.pe',
          },
          cuerpo: { academiaId: esc.e.B.id, alumnoId: enB.alumnoId },
        }),
      ];
      const deB = [
        await pedir(
          unir(`academiaId=${esc.e.A.id}&nombreCorto=academia-a&alumnoId=${enA.alumnoId}&usuarioId=${enA.usuarioId}`),
          enB.cookie,
        ),
      ];

      expect(baseA.status, baseA.texto.slice(0, 200)).toBe(200);
      expect(baseB.status, baseB.texto.slice(0, 200)).toBe(200);
      for (const respuesta of deA) expect([respuesta.status, respuesta.texto], ruta).toEqual([200, baseA.texto]);
      for (const respuesta of deB) expect([respuesta.status, respuesta.texto], ruta).toEqual([200, baseB.texto]);
      expect(baseA.texto, 'son respuestas distintas').not.toBe(baseB.texto);
    }
  });

  describe('la seguridad a nivel de fila: con la transacción de A no se ve la cuenta de B', () => {
    const SQL_DEL_ALUMNO_DE_LA_SESION = `SELECT id::text AS id FROM alumnos
        WHERE academia_id = $1::uuid AND usuario_id = $2::uuid AND estado <> 'CLIENTE'::estado_alumno`;

    it('la consulta del alumno de la sesión de la app, con la academia A y el usuario_id de la cuenta de B, no devuelve filas (con y sin el filtro de academia); con la academia B sí devuelve la ficha de B', async () => {
      const conFiltroEnA = await ejecutarComo('app', SQL_DEL_ALUMNO_DE_LA_SESION, [esc.e.A.id, enB.usuarioId], {
        academiaId: esc.e.A.id,
      });
      const conFiltroDeBEnA = await ejecutarComo('app', SQL_DEL_ALUMNO_DE_LA_SESION, [esc.e.B.id, enB.usuarioId], {
        academiaId: esc.e.A.id,
      });
      const sinFiltroEnA = await ejecutarComo(
        'app',
        'SELECT id::text AS id FROM alumnos WHERE usuario_id = $1::uuid',
        [enB.usuarioId],
        {
          academiaId: esc.e.A.id,
        },
      );
      const control = await ejecutarComo('app', SQL_DEL_ALUMNO_DE_LA_SESION, [esc.e.B.id, enB.usuarioId], {
        academiaId: esc.e.B.id,
      });
      const deLaPropia = await ejecutarComo('app', SQL_DEL_ALUMNO_DE_LA_SESION, [esc.e.A.id, enA.usuarioId], {
        academiaId: esc.e.A.id,
      });

      expect(conFiltroEnA.rows).toEqual([]);
      expect(conFiltroDeBEnA.rows).toEqual([]);
      expect(sinFiltroEnA.rows).toEqual([]);
      expect(control.rows).toEqual([{ id: enB.alumnoId }]);
      expect(deLaPropia.rows).toEqual([{ id: enA.alumnoId }]);
    });

    it('una cuenta de A sin ficha en A, cuya persona sí es alumna de B (mismo DNI), recibe 404 en las dos rutas y nada de B', async () => {
      const dni = '32000002';
      const cuentaDeA = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'ALUMNO', dni });
      const soloEnB = await crearAlumnoDeAsistencia(ctx, esc, {
        academia: 'B',
        dni,
        nombres: 'Quirina',
        apellidos: 'Solo En B',
        claseIds: [esc.lunes19B.id],
      });
      const cookie = cookieDeUsuario({ id: cuentaDeA.id, academiaId: esc.e.A.id, rol: 'ALUMNO' }, AHORA_007);

      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        const respuesta = await pedir(ruta, cookie);

        expect([respuesta.status, codigoDe(respuesta)], `${nombre}: ${respuesta.texto.slice(0, 200)}`).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
        sinNada(respuesta.texto, ['Quirina', 'Solo En B', soloEnB.alumnoId, soloEnB.token, PLAN_DE_B], nombre);
      }
    });

    it('una sesión firmada con el usuario de B y la academia de A no entra: ni 200 ni datos de B', async () => {
      const mezclada = cookieDeUsuario({ id: enB.usuarioId, academiaId: esc.e.A.id, rol: 'ALUMNO' }, AHORA_007);
      const alReves = cookieDeUsuario({ id: enA.usuarioId, academiaId: esc.e.B.id, rol: 'ALUMNO' }, AHORA_007);

      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        for (const [etiqueta, cookie, ajenos] of [
          ['usuario de B con la academia de A', mezclada, DE_B()],
          ['usuario de A con la academia de B', alReves, DE_A()],
        ] as const) {
          const respuesta = await pedir(ruta, cookie);

          expect(
            [401, 404],
            `${nombre} (${etiqueta}): HTTP ${respuesta.status} ${respuesta.texto.slice(0, 200)}`,
          ).toContain(respuesta.status);
          sinNada(respuesta.texto, ajenos, `${nombre} (${etiqueta})`);
        }
      }
    });
  });

  describe('suspender B no cambia las respuestas de A', () => {
    it('las respuestas de A son idénticas con B suspendida; la sesión de B recibe ACADEMIA_SUSPENDIDA', async () => {
      const antes = [
        await pedir(RUTA_MI_PANEL, enA.cookie),
        await pedir(`${RUTA_MI_ASISTENCIA}?mes=2026-11`, enA.cookie),
        await pedir(RUTA_MI_ASISTENCIA, enA.cookie),
      ];

      await fijarEstadoDeAcademia(esc.e.B.id, 'SUSPENDIDA');
      const despues = [
        await pedir(RUTA_MI_PANEL, enA.cookie),
        await pedir(`${RUTA_MI_ASISTENCIA}?mes=2026-11`, enA.cookie),
        await pedir(RUTA_MI_ASISTENCIA, enA.cookie),
      ];
      const deB = await Promise.all(RUTAS_DEL_PANEL.map(({ ruta }) => pedir(ruta, enB.cookie)));

      antes.forEach((respuesta, indice) => {
        expect(respuesta.status).toBe(200);
        expect([despues[indice]?.status, despues[indice]?.texto]).toEqual([200, respuesta.texto]);
      });
      for (const respuesta of deB) {
        expect([respuesta.status, codigoDe(respuesta)]).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
      }
    });
  });
});
