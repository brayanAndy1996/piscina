import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cambiarAlumno, type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cambiarMatricula,
  desactivarClase,
  type AlumnoDeAsistencia,
  en,
  enLima,
  type EscenarioDeAsistencia,
} from '../../utilidades/escenario-asistencia';
import { exigirRutasDe010b, listadoDe, rutaListado } from '../../utilidades/escenario-cierre';
import { type MiPanelApi, panelDe, prepararEscenarioDelPanel } from '../../utilidades/escenario-panel';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  INSTANTES,
  registrarRenovacion,
  sembrarMatriculaDelMes,
} from '../../utilidades/escenario-renovacion';
import { fijarNacimiento, resumenEn } from '../../utilidades/panel-alumno-lima';
import { sembrarAlumno } from '../../utilidades/escenario-cierre';
import { crearUsuarioDePrueba } from '../../utilidades/usuarios';

// Criterios 7, 8, 9, 10 y 11 de la 011 (pruebas obligatorias, no críticas): los datos del alumno con la edad en Lima, la mensualidad con el reloj fijo y el proceso en
// `TZ=Asia/Tokyo` (y en UTC), el mismo estado que ve recepción en el listado de mensualidades (010b) y los meses de asistencia. Todo con la API real y la base real.

const ZONA_ORIGINAL = process.env['TZ'];
const NOVIEMBRE = { anio: 2026, mes: 11 };
const DICIEMBRE = { anio: 2026, mes: 12 };

/** Lo que las pruebas necesitan de un alumno con cuenta. */
type AlumnoDePrueba = Pick<AlumnoDeAsistencia, 'academiaId' | 'alumnoId' | 'dni' | 'usuarioId'>;

describe.each(['UTC', 'Asia/Tokyo'])('el resumen del panel con el proceso en TZ=%s', (zona) => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    process.env['TZ'] = zona;
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    process.env['TZ'] = zona;
    esc = await prepararEscenarioDelPanel(ctx);
    exigirRutasDe010b(ctx.app);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const lunesMiercolesViernes = () => [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id];

  /** Un alumno de noviembre con 5 de 12 clases usadas y, si se pide, diciembre pagado (`VIGENTE`). */
  async function alumnoDeNoviembre(opciones: { diciembrePagado?: boolean } = {}): Promise<AlumnoDeAsistencia> {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc, { clasesUsadas: 5 });
    if (opciones.diciembrePagado) {
      await sembrarMatriculaDelMes(
        alumno.academiaId,
        esc.e.plan.id,
        [alumno.alumnoId],
        lunesMiercolesViernes(),
        DICIEMBRE,
      );
    }
    return alumno;
  }

  /** Diciembre registrado de verdad con un Yape (queda en verificación), cuando la ventana ya está abierta. */
  async function renovarDiciembreConYape(alumno: AlumnoDeAsistencia): Promise<void> {
    const cookies = en(ctx, esc, INSTANTES.jueves26);
    await abrirCajaPara(esc, INSTANTES.jueves26);
    const registro = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
    expect(registro.respuesta.status, registro.respuesta.texto.slice(0, 300)).toBe(201);
  }

  /** Lo que ve recepción de ese alumno en ese instante: su fila del listado de mensualidades, o `null` si no la trae. */
  async function filaDeRecepcion(alumno: AlumnoDePrueba, instante: Date) {
    const cookie = en(ctx, esc, instante).secretaria;
    const respuesta = await ctx.http.get(rutaListado({ alumnoId: alumno.alumnoId }), { cookie });
    return listadoDe(respuesta).alumnos.find((fila) => fila.alumnoId === alumno.alumnoId) ?? null;
  }

  /** El criterio 10: el estado, la mensualidad y la siguiente del panel son los de la fila de recepción (o sin estado si recepción no la trae). */
  async function comprobarContraRecepcion(alumno: AlumnoDePrueba, instante: Date, panel: MiPanelApi): Promise<void> {
    const fila = await filaDeRecepcion(alumno, instante);
    if (fila === null) {
      expect(panel.mensualidad.estado, 'recepción no trae la fila: el panel no tiene estado').toBeNull();
      return;
    }
    expect(panel.mensualidad.estado).toBe(fila.estado);
    expect(panel.mensualidad.actual?.mes).toBe(fila.mensualidad?.mes);
    expect(panel.mensualidad.actual?.plan.nombre).toBe(fila.mensualidad?.plan.nombre);
    expect(panel.mensualidad.actual?.clasesUsadas).toBe(fila.mensualidad?.clasesUsadas);
    expect(panel.mensualidad.actual?.clasesTotales).toBe(fila.mensualidad?.clasesTotales);
    const clasesDeRecepcion = (fila.mensualidad?.clases ?? []) as {
      diaSemana: number;
      horaInicio: string;
      horaFin: string;
    }[];
    expect(panel.mensualidad.actual?.clases).toEqual(
      clasesDeRecepcion.map(({ diaSemana, horaInicio, horaFin }) => ({ diaSemana, horaInicio, horaFin })),
    );
    expect(
      panel.mensualidad.siguiente === null
        ? null
        : { mes: panel.mensualidad.siguiente.mes, estado: panel.mensualidad.siguiente.estado },
    ).toEqual(fila.siguiente);
  }

  describe('criterio 7: los datos del alumno y la edad en Lima', () => {
    it('nombres, apellidos, DNI, nivel y estado son los del alumno', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc, { nombres: 'Alma', apellidos: 'Del Panel' });
      await cambiarAlumno(alumno.academiaId, alumno.alumnoId, { nivel: 'INTERMEDIO' });

      const panel = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-17', '10:00')));

      expect(panel.alumno).toMatchObject({
        nombres: 'Alma',
        apellidos: 'Del Panel',
        dni: alumno.dni,
        nivel: 'INTERMEDIO',
        estado: 'ALUMNO_ACTIVO',
      });
    });

    it('quien cumple 12 años el 1/12/2026 tiene 11 el 30/11 a las 23:59:59.999 de Lima (ya es 1/12 en UTC) y 12 el 1/12 a las 00:00:00.000', async () => {
      const alumno = await alumnoDeNoviembre();
      await fijarNacimiento(alumno.academiaId, alumno.alumnoId, '2014-12-01');
      const ultimo = enLima('2026-11-30', '23:59:59.999');
      expect(ultimo.toISOString(), 'es el 1/12 en UTC').toBe('2026-12-01T04:59:59.999Z');

      const antes = panelDe(await resumenEn(ctx, alumno, ultimo));
      const despues = panelDe(await resumenEn(ctx, alumno, enLima('2026-12-01', '00:00:00.000')));

      expect([antes.hoy, antes.alumno.edad]).toEqual(['2026-11-30', 11]);
      expect([despues.hoy, despues.alumno.edad]).toEqual(['2026-12-01', 12]);
    });

    it('un adulto cumple años el día de su cumpleaños y el 29 de febrero cumple el 1 de marzo en los años no bisiestos', async () => {
      const alumno = await alumnoDeNoviembre();
      await fijarNacimiento(alumno.academiaId, alumno.alumnoId, '1990-11-17');

      const vispera = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-16', '23:59:59.999')));
      const dia = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-17', '00:00:00.000')));

      expect([vispera.alumno.edad, dia.alumno.edad]).toEqual([35, 36]);
      await fijarNacimiento(alumno.academiaId, alumno.alumnoId, '2000-02-29');
      const antesDelUno = panelDe(await resumenEn(ctx, alumno, enLima('2027-02-28', '12:00')));
      expect(antesDelUno.alumno.edad).toBe(26);
    });
  });

  describe('criterio 8: la mensualidad', () => {
    it('lleva el mes, el nombre del plan, las clases por día y hora, las usadas, las totales, las restantes y las fechas de la matrícula', async () => {
      const alumno = await alumnoDeNoviembre();

      const panel = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-17', '10:00')));

      expect(panel.mensualidad.actual).toEqual({
        mes: '2026-11',
        plan: { nombre: esc.e.plan.nombre },
        clases: [
          { diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
          { diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
          { diaSemana: 5, horaInicio: '18:00', horaFin: '19:00' },
        ],
        clasesUsadas: 5,
        clasesTotales: 12,
        clasesRestantes: 7,
        desde: '2026-11-01',
        hasta: '2026-11-30',
      });
    });

    it('una clase desactivada sigue en el horario de su matrícula', async () => {
      const alumno = await alumnoDeNoviembre();
      await desactivarClase(alumno.academiaId, esc.e.viernes.id);

      const panel = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-17', '10:00')));

      expect(panel.mensualidad.actual?.clases.map((clase) => clase.diaSemana)).toEqual([1, 3, 5]);
    });

    it('un alumno INACTIVO recibe estado, actual y siguiente en null (DR-4) y conserva su historial de meses', async () => {
      const alumno = await alumnoDeNoviembre({ diciembrePagado: true });
      await cambiarAlumno(alumno.academiaId, alumno.alumnoId, { estado: 'INACTIVO' });

      const panel = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-17', '10:00')));

      expect(panel.alumno.estado).toBe('INACTIVO');
      expect(panel.mensualidad).toEqual({ estado: null, actual: null, siguiente: null });
      expect(panel.mesesDeAsistencia).toEqual(['2026-11']);
    });
  });

  describe('criterio 9: los ejemplos de la mensualidad en Lima (diasPorVencer = 5)', () => {
    it('el 25/11 a las 23:59:59.999 de Lima: AL_DIA, actual noviembre, 7 restantes y vence el 30/11', async () => {
      const alumno = await alumnoDeNoviembre();
      const instante = enLima('2026-11-25', '23:59:59.999');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBe('AL_DIA');
      expect(panel.mensualidad.actual).toMatchObject({ mes: '2026-11', clasesRestantes: 7, hasta: '2026-11-30' });
      expect(panel.mensualidad.siguiente).toBeNull();
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el 26/11 a las 00:00:00.000: POR_VENCER', async () => {
      const alumno = await alumnoDeNoviembre();
      const instante = enLima('2026-11-26', '00:00:00.000');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBe('POR_VENCER');
      expect(panel.mensualidad.actual?.mes).toBe('2026-11');
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el 26/11 con diciembre pagado: AL_DIA y siguiente diciembre PAGADA', async () => {
      const alumno = await alumnoDeNoviembre({ diciembrePagado: true });
      const instante = enLima('2026-11-26', '00:00:00.000');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBe('AL_DIA');
      expect(panel.mensualidad.actual?.mes).toBe('2026-11');
      expect(panel.mensualidad.siguiente).toMatchObject({
        mes: '2026-12',
        estado: 'PAGADA',
        desde: '2026-12-01',
        hasta: '2026-12-31',
      });
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el 26/11 con diciembre en verificación (un Yape registrado por la API): PENDIENTE_VERIFICACION y siguiente diciembre EN_VERIFICACION', async () => {
      const alumno = await alumnoDeNoviembre();
      await renovarDiciembreConYape(alumno);
      const instante = enLima('2026-11-26', '00:00:00.000');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBe('PENDIENTE_VERIFICACION');
      expect(panel.mensualidad.actual?.mes).toBe('2026-11');
      expect(panel.mensualidad.siguiente).toMatchObject({ mes: '2026-12', estado: 'EN_VERIFICACION' });
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el 30/11 a las 19:00 de Lima (ya es 1/12 en UTC) sigue siendo noviembre', async () => {
      const alumno = await alumnoDeNoviembre();
      const instante = enLima('2026-11-30', '19:00');
      expect(instante.toISOString().slice(0, 10), 'en UTC ya es el 1/12').toBe('2026-12-01');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect([panel.hoy, panel.mesEnCurso]).toEqual(['2026-11-30', '2026-11']);
      expect(panel.mensualidad.estado).toBe('POR_VENCER');
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el 1/12 a las 00:00:00.000 sin diciembre: VENCIDO con actual noviembre, aunque el alumno siga ALUMNO_ACTIVO en la base (la tarea del cierre no corrió)', async () => {
      const alumno = await alumnoDeNoviembre();
      const instante = enLima('2026-12-01', '00:00:00.000');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBe('VENCIDO');
      expect(panel.mensualidad.actual).toMatchObject({ mes: '2026-11', hasta: '2026-11-30' });
      expect(panel.alumno.estado, 'el estado de la persona es el de la base').toBe('ALUMNO_ACTIVO');
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el 1/12 con diciembre pagado: AL_DIA con actual diciembre', async () => {
      const alumno = await alumnoDeNoviembre({ diciembrePagado: true });
      const instante = enLima('2026-12-01', '00:00:00.000');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBe('AL_DIA');
      expect(panel.mensualidad.actual).toMatchObject({ mes: '2026-12', clasesUsadas: 0, clasesTotales: 12 });
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('un alumno nuevo que se inscribió para diciembre, el 28/11: estado null, actual null y siguiente diciembre PAGADA', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await cambiarMatricula(alumno.academiaId, alumno.matriculaId, {
        anio: 2026,
        mes: 12,
        fecha_inicio: '2026-12-01',
        fecha_fin: '2026-12-31',
      });
      const instante = INSTANTES.sabado28;

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad.estado).toBeNull();
      expect(panel.mensualidad.actual).toBeNull();
      expect(panel.mensualidad.siguiente).toMatchObject({ mes: '2026-12', estado: 'PAGADA' });
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('un alumno con su última mensualidad pagada en septiembre, el 15/11: estado, actual y siguiente en null', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await cambiarMatricula(alumno.academiaId, alumno.matriculaId, {
        anio: 2026,
        mes: 9,
        fecha_inicio: '2026-09-01',
        fecha_fin: '2026-09-30',
        estado: 'FINALIZADA',
      });
      await cambiarAlumno(alumno.academiaId, alumno.alumnoId, { estado: 'ALUMNO_VENCIDO' });
      const instante = enLima('2026-11-15', '10:00');

      const panel = panelDe(await resumenEn(ctx, alumno, instante));

      expect(panel.mensualidad).toEqual({ estado: null, actual: null, siguiente: null });
      expect(panel.alumno.estado).toBe('ALUMNO_VENCIDO');
      await comprobarContraRecepcion(alumno, instante, panel);
    });

    it('el reloj de la aplicación es el que cuenta: dos instantes distintos del mismo día de Lima dan el mismo hoy y el mismo mes', async () => {
      const alumno = await alumnoDeNoviembre();

      const temprano = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-20', '00:00:00.000')));
      const tarde = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-20', '23:59:59.999')));

      expect([temprano.hoy, temprano.mesEnCurso]).toEqual(['2026-11-20', '2026-11']);
      expect(tarde).toEqual(temprano);
    });
  });

  describe('criterio 10: el mismo estado que ve recepción, con cada estado del listado a mitad de mes', () => {
    it('al día a mitad de mes, y vencido con octubre pagado, coinciden con la fila del listado', async () => {
      const alDia = await alumnoDeNoviembre();
      const vencido = await sembrarConCuenta({ mes: { anio: 2026, mes: 10 }, estado: 'FINALIZADA' }, 'ALUMNO_VENCIDO');
      const instante = enLima('2026-11-15', '10:00');

      const delAlDia = panelDe(await resumenEn(ctx, alDia, instante));
      const delVencido = panelDe(await resumenEn(ctx, vencido, instante));

      expect(delAlDia.mensualidad.estado).toBe('AL_DIA');
      expect(delVencido.mensualidad.estado).toBe('VENCIDO');
      expect(delVencido.mensualidad.actual?.mes).toBe('2026-10');
      await comprobarContraRecepcion(alDia, instante, delAlDia);
      await comprobarContraRecepcion(vencido, instante, delVencido);
    });
  });

  describe('criterio 11: los meses de asistencia', () => {
    it('M siempre y cada mes anterior con una mensualidad pagada (VIGENTE o FINALIZADA), del más nuevo al más viejo; nunca M+1 aunque esté pagado', async () => {
      const alumno = await sembrarConCuenta(
        [
          { mes: { anio: 2026, mes: 7 }, estado: 'CANCELADA' },
          { mes: { anio: 2026, mes: 8 }, estado: 'RESERVADA' },
          { mes: { anio: 2026, mes: 9 }, estado: 'FINALIZADA' },
          { mes: { anio: 2026, mes: 10 }, estado: 'FINALIZADA' },
          { mes: NOVIEMBRE, estado: 'VIGENTE' },
          { mes: DICIEMBRE, estado: 'VIGENTE' },
        ],
        'ALUMNO_ACTIVO',
      );

      const panel = panelDe(await resumenEn(ctx, alumno, enLima('2026-11-24', '10:00')));

      expect(panel.mesesDeAsistencia).toEqual(['2026-11', '2026-10', '2026-09']);
    });

    it('con un hueco (sin agosto) y sin la de M, trae M y los meses pagados anteriores; sin ninguna mensualidad, solo M', async () => {
      const conHueco = await sembrarConCuenta(
        [
          { mes: { anio: 2026, mes: 6 }, estado: 'FINALIZADA' },
          { mes: { anio: 2026, mes: 9 }, estado: 'FINALIZADA' },
        ],
        'ALUMNO_VENCIDO',
      );
      const sinNada = await sembrarConCuenta([], 'ALUMNO_VENCIDO');
      const instante = enLima('2026-11-24', '10:00');

      const delHueco = panelDe(await resumenEn(ctx, conHueco, instante));
      const delVacio = panelDe(await resumenEn(ctx, sinNada, instante));

      expect(delHueco.mesesDeAsistencia).toEqual(['2026-11', '2026-09', '2026-06']);
      expect(delVacio.mesesDeAsistencia).toEqual(['2026-11']);
    });

    it('cruza el año y el cambio de mes de Lima: el 31/12 a las 23:59:59.999 M es diciembre y el 1/1 es enero', async () => {
      const alumno = await sembrarConCuenta([{ mes: { anio: 2026, mes: 12 }, estado: 'VIGENTE' }], 'ALUMNO_ACTIVO');

      const diciembre = panelDe(await resumenEn(ctx, alumno, enLima('2026-12-31', '23:59:59.999')));
      const enero = panelDe(await resumenEn(ctx, alumno, enLima('2027-01-01', '00:00:00.000')));

      expect([diciembre.mesEnCurso, diciembre.mesesDeAsistencia]).toEqual(['2026-12', ['2026-12']]);
      expect([enero.mesEnCurso, enero.mesesDeAsistencia]).toEqual(['2027-01', ['2027-01', '2026-12']]);
    });
  });

  /** Un alumno de A con las matrículas dadas (sin clases usadas) y una cuenta de `ALUMNO`, como lo deja un pago confirmado. */
  async function sembrarConCuenta(
    matriculas:
      | { mes: { anio: number; mes: number }; estado: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA' }
      | readonly { mes: { anio: number; mes: number }; estado: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA' }[],
    estado: 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO',
  ): Promise<AlumnoDePrueba> {
    const lista = Array.isArray(matriculas) ? matriculas : [matriculas];
    const sembrado = await sembrarAlumno(esc, { estado, matriculas: lista });
    const usuario = await crearUsuarioDePrueba({ academiaId: sembrado.academiaId, rol: 'ALUMNO', dni: sembrado.dni });
    await cambiarAlumno(sembrado.academiaId, sembrado.alumnoId, { usuario_id: usuario.id });
    return {
      academiaId: sembrado.academiaId,
      alumnoId: sembrado.alumnoId,
      dni: sembrado.dni,
      usuarioId: usuario.id,
    };
  }
});
