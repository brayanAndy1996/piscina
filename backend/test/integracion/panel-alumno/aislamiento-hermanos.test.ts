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
import {
  type AppCarnet,
  crearAppCarnet,
  RUTA_BUSCAR,
  rutaCarnet,
  rutaCarnetPdf,
} from '../../utilidades/escenario-carnet';
import {
  consultaDe,
  filaInasistenciaValida,
  insertarInasistencia,
  rutaAsistenciasDelMes,
} from '../../utilidades/escenario-faltas';
import { rutaLecturaHorario } from '../../utilidades/escenario-horario';
import { rutaOferta } from '../../utilidades/escenario-renovacion';
import { rutaListado } from '../../utilidades/escenario-cierre';
import {
  codigoDe,
  instantaneaDeTodasLasTablas,
  type MiPanelApi,
  panelDe,
  pedirCrudo,
  prepararEscenarioDelPanel,
  RUTA_MI_ASISTENCIA,
  RUTA_MI_PANEL,
  RUTAS_DEL_PANEL,
  unirApoderado,
} from '../../utilidades/escenario-panel';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 4 (crítico, RN-29, Ley 29733, D-14): en la academia A, los hermanos H1 y H2 (menores, con el mismo apoderado: mismo DNI, nombre y teléfono) tienen cada uno su cuenta (supuesto 6 de 11.1), su matrícula en clases distintas, asistencias y faltas. Con la sesión de H1: el resumen y la
// asistencia de cada mes traen solo datos de H1 (ningún nombre, DNI, plan, clase, fecha, hora ni conteo de H2 aparece en el cuerpo); los agregados del criterio 2 con el id del alumno o del usuario de H2 no cambian nada; y las rutas del personal con el id de H2 siguen respondiendo 403 `SIN_PERMISO`:
// `GET /api/alumnos/{H2}/asistencias`, `/carnet`, `/carnet/pdf`, `/horario`, `/renovacion` y `GET /api/mensualidades?alumnoId={H2}`.
// Lecturas estrictas elegidas: lo mismo vale al revés (con la sesión de H2 no sale nada de H1); `POST /api/alumnos/buscar` también es 403 (criterio 16 de 008); H1 es de nivel BASICO (clase de los lunes de 18:00 a 19:00, plan «Plan 3 por semana», 3 de 12 clases usadas) y H2 de INTERMEDIO (clase de los martes de 08:00 a 09:00, otro plan,
// 9 de 10 clases usadas); el reloj está en el 17/11/2026 a las 10:00 de Lima.

const AHORA = enLima('2026-11-17', '10:00:00.000');
const PLAN_DE_H2 = 'Plan Exclusivo De La Hermana Dos';
const APODERADO = {
  nombres: 'Apoderado Compartido',
  apellidos: 'Quispe Mamani',
  dni: '30000007',
  telefono: '955001122',
};

describe('un hermano no ve al otro (criterio 4)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let h1: AlumnoDeAsistencia;
  let h2: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    const A = esc.e.A.id;
    h1 = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: '31000001',
      nombres: 'Hugo',
      apellidos: 'Hermano Uno Quispe',
      conApoderado: true,
      fechaNacimiento: '2014-03-10',
      claseIds: [esc.e.lunes.id],
      clasesUsadas: 3,
    });
    h2 = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: '31000002',
      nombres: 'Irene',
      apellidos: 'Hermana Dos Quispe',
      conApoderado: true,
      fechaNacimiento: '2016-08-25',
      nivel: 'INTERMEDIO',
      claseIds: [esc.martes08.id],
      clasesTotales: 10,
      clasesUsadas: 9,
    });
    await unirApoderado(A, [h1.alumnoId, h2.alumnoId], APODERADO);
    const planDeH2 = await crearPlanDePrueba(A, { nombre: PLAN_DE_H2 });
    await ejecutarComo(
      'propietario',
      'UPDATE matriculas SET plan_id = $3::uuid WHERE academia_id = $1::uuid AND id = $2::uuid',
      [A, h2.matriculaId, planDeH2.id],
      { academiaId: A },
    );

    const asistencia = async (a: AlumnoDeAsistencia, claseId: string, fecha: string, hora: string) => {
      const llegada = enLima(fecha, hora);
      await insertarAsistencia(
        'propietario',
        A,
        filaAsistenciaValida(
          { alumnoId: a.alumnoId, matriculaId: a.matriculaId, claseId, usuarioId: esc.e.secretariaA.id },
          { fecha, llegada_en: llegada, registrado_en: llegada },
        ),
      );
    };
    const falta = (a: AlumnoDeAsistencia, claseId: string, fecha: string) =>
      insertarInasistencia(
        'propietario',
        A,
        filaInasistenciaValida(
          { alumnoId: a.alumnoId, matriculaId: a.matriculaId, claseId },
          { fecha, registrada_en: enLima(fecha, '19:05') },
        ),
      );
    await asistencia(h1, esc.e.lunes.id, '2026-11-02', '18:03');
    await falta(h1, esc.e.lunes.id, '2026-11-09');
    await asistencia(h2, esc.martes08.id, '2026-11-03', '08:07');
    await falta(h2, esc.martes08.id, '2026-11-10');
    await asistencia(h2, esc.martes08.id, '2026-11-17', '08:04');
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Lo que solo es de H2 (o del apoderado compartido) y no puede estar en nada que reciba H1, y al revés. */
  const SOLO_DE_H2 = () => [
    'Irene',
    'Hermana Dos',
    h2.dni,
    PLAN_DE_H2,
    '08:07',
    '08:04',
    '2026-11-03',
    '2026-11-10',
    h2.alumnoId,
    h2.usuarioId,
    h2.matriculaId,
    h2.token,
  ];
  const SOLO_DE_H1 = () => [
    'Hugo',
    'Hermano Uno',
    h1.dni,
    '18:03',
    '2026-11-02',
    '2026-11-09',
    h1.alumnoId,
    h1.usuarioId,
    h1.matriculaId,
    h1.token,
  ];
  const DEL_APODERADO = [APODERADO.nombres, APODERADO.apellidos, APODERADO.dni, APODERADO.telefono];

  const pedir = (ruta: string, cookie: string) => pedirCrudo(ctx.app, 'GET', ruta, { cookie });
  const sinNada = (texto: string, ajenos: readonly string[], contexto: string) => {
    for (const ajeno of [...ajenos, ...DEL_APODERADO]) {
      expect(texto, `${contexto}: no debe aparecer «${ajeno}»`).not.toContain(ajeno);
    }
  };

  it('con la sesión de H1, el resumen es el de H1: sus datos, su plan, su clase y sus conteos, y nada de H2 ni del apoderado', async () => {
    const respuesta = await pedir(RUTA_MI_PANEL, h1.cookie);

    const panel: MiPanelApi = panelDe(respuesta);
    expect(panel.alumno).toEqual({
      nombres: 'Hugo',
      apellidos: 'Hermano Uno Quispe',
      dni: '31000001',
      nivel: 'BASICO',
      edad: 12,
      estado: 'ALUMNO_ACTIVO',
    });
    expect(panel.mensualidad.actual).toMatchObject({
      mes: '2026-11',
      plan: { nombre: 'Plan 3 por semana' },
      clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
      clasesUsadas: 3,
      clasesTotales: 12,
      clasesRestantes: 9,
    });
    sinNada(respuesta.texto, SOLO_DE_H2(), 'resumen de H1');
  });

  it('con la sesión de H2, el resumen es el de H2 (otro plan, otra clase, otros conteos), y nada de H1 ni del apoderado', async () => {
    const respuesta = await pedir(RUTA_MI_PANEL, h2.cookie);

    const panel: MiPanelApi = panelDe(respuesta);
    expect(panel.alumno).toEqual({
      nombres: 'Irene',
      apellidos: 'Hermana Dos Quispe',
      dni: '31000002',
      nivel: 'INTERMEDIO',
      edad: 10,
      estado: 'ALUMNO_ACTIVO',
    });
    expect(panel.mensualidad.actual).toMatchObject({
      mes: '2026-11',
      plan: { nombre: PLAN_DE_H2 },
      clases: [{ diaSemana: 2, horaInicio: '08:00', horaFin: '09:00' }],
      clasesUsadas: 9,
      clasesTotales: 10,
      clasesRestantes: 1,
    });
    sinNada(respuesta.texto, SOLO_DE_H1(), 'resumen de H2');
  });

  it('con la sesión de H1, la asistencia de cada mes es solo la de H1 (sus dos registros de noviembre y nada en octubre), sin nada de H2', async () => {
    for (const mes of [undefined, '2026-11', '2026-10']) {
      const respuesta = await pedir(
        mes === undefined ? RUTA_MI_ASISTENCIA : `${RUTA_MI_ASISTENCIA}?mes=${mes}`,
        h1.cookie,
      );

      const consulta = consultaDe(respuesta);
      if (mes === '2026-10') {
        expect(consulta).toEqual({ mes: '2026-10', matricula: null, registros: [] });
      } else {
        expect(consulta.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 3, clasesRestantes: 9 });
        expect(consulta.registros.map((registro) => [registro.tipo, registro.fecha])).toEqual([
          ['ASISTENCIA', '2026-11-02'],
          ['FALTA', '2026-11-09'],
        ]);
      }
      sinNada(respuesta.texto, SOLO_DE_H2(), `asistencia de H1, mes ${mes ?? 'por defecto'}`);
    }
  });

  it('con la sesión de H2, la asistencia es solo la de H2 (sus tres registros de noviembre), sin nada de H1', async () => {
    const respuesta = await pedir(`${RUTA_MI_ASISTENCIA}?mes=2026-11`, h2.cookie);

    const consulta = consultaDe(respuesta);
    expect(consulta.matricula).toEqual({ clasesTotales: 10, clasesUsadas: 9, clasesRestantes: 1 });
    expect(consulta.registros.map((registro) => [registro.tipo, registro.fecha])).toEqual([
      ['ASISTENCIA', '2026-11-03'],
      ['FALTA', '2026-11-10'],
      ['ASISTENCIA', '2026-11-17'],
    ]);
    sinNada(respuesta.texto, SOLO_DE_H1(), 'asistencia de H2');
  });

  describe.each(RUTAS_DEL_PANEL)('$nombre', ({ ruta }) => {
    it('el id del alumno o del usuario de H2 (en la dirección, el cuerpo o las cabeceras) no cambia nada con la sesión de H1', async () => {
      const cookie = h1.cookie;
      const base = await pedir(ruta === RUTA_MI_ASISTENCIA ? `${ruta}?mes=2026-11` : ruta, cookie);
      const rutaConMes = ruta === RUTA_MI_ASISTENCIA ? `${ruta}?mes=2026-11` : ruta;
      const unir = (extra: string) => `${rutaConMes}${rutaConMes.includes('?') ? '&' : '?'}${extra}`;
      const ajenos = { id: h2.alumnoId, alumnoId: h2.alumnoId, usuarioId: h2.usuarioId };

      const respuestas = [
        await pedir(unir(`id=${h2.alumnoId}`), cookie),
        await pedir(unir(`alumnoId=${h2.alumnoId}`), cookie),
        await pedir(unir(`usuarioId=${h2.usuarioId}`), cookie),
        await pedir(
          unir(`id=${h2.alumnoId}&alumnoId=${h2.alumnoId}&usuarioId=${h2.usuarioId}&academiaId=${esc.e.A.id}`),
          cookie,
        ),
        await pedirCrudo(ctx.app, 'GET', rutaConMes, { cookie, cuerpo: ajenos }),
        await pedirCrudo(ctx.app, 'GET', rutaConMes, {
          cookie,
          headers: { 'x-alumno-id': h2.alumnoId, 'x-usuario-id': h2.usuarioId },
        }),
      ];

      expect(base.status, base.texto.slice(0, 200)).toBe(200);
      for (const respuesta of respuestas) {
        expect([respuesta.status, respuesta.texto]).toEqual([base.status, base.texto]);
      }
    });
  });

  describe('las rutas del personal con el id de H2 siguen respondiendo 403 SIN_PERMISO con la sesión de H1', () => {
    const rutasDelPersonal = (): [string, string][] => [
      ['GET /api/alumnos/{H2}/asistencias', rutaAsistenciasDelMes(h2.alumnoId)],
      ['GET /api/alumnos/{H2}/asistencias?mes=2026-11', rutaAsistenciasDelMes(h2.alumnoId, '2026-11')],
      ['GET /api/alumnos/{H2}/carnet', rutaCarnet(h2.alumnoId)],
      ['GET /api/alumnos/{H2}/carnet/pdf', rutaCarnetPdf(h2.alumnoId)],
      ['GET /api/alumnos/{H2}/horario', rutaLecturaHorario(h2.alumnoId)],
      ['GET /api/alumnos/{H2}/renovacion', rutaOferta(h2.alumnoId)],
      ['GET /api/mensualidades?alumnoId={H2}', rutaListado({ alumnoId: h2.alumnoId })],
    ];

    it('el carnet, el PDF, el horario, la renovación, el listado de mensualidades y la asistencia del personal, también con el id propio', async () => {
      for (const [nombre, ruta] of rutasDelPersonal()) {
        const respuesta = await pedir(ruta, h1.cookie);

        expect([respuesta.status, codigoDe(respuesta)], `${nombre}: ${respuesta.texto.slice(0, 200)}`).toEqual([
          403,
          'SIN_PERMISO',
        ]);
        sinNada(respuesta.texto, SOLO_DE_H2(), nombre);
      }
      for (const ruta of [
        rutaAsistenciasDelMes(h1.alumnoId, '2026-11'),
        rutaCarnet(h1.alumnoId),
        rutaListado({ alumnoId: h1.alumnoId }),
      ]) {
        const respuesta = await pedir(ruta, h1.cookie);
        expect([respuesta.status, codigoDe(respuesta)], `con su propio id: ${ruta}`).toEqual([403, 'SIN_PERMISO']);
      }
    });

    it('la búsqueda de alumnos del personal también es 403 con la sesión de H1, y nada de lo anterior escribe', async () => {
      const antes = await instantaneaDeTodasLasTablas([esc.e.A, esc.e.B]);

      const busqueda = await ctx.http.post(RUTA_BUSCAR, { texto: 'Quispe' }, { cookie: h1.cookie });
      for (const [, ruta] of rutasDelPersonal()) await pedir(ruta, h1.cookie);

      expect([busqueda.status, codigoDe(busqueda)]).toEqual([403, 'SIN_PERMISO']);
      sinNada(busqueda.texto, SOLO_DE_H2(), 'búsqueda');
      expect(await instantaneaDeTodasLasTablas([esc.e.A, esc.e.B])).toEqual(antes);
    });
  });
});
