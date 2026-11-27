// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asistenciasDe,
  clasesUsadasDe,
  en,
  enLima,
  marcarManual,
  marcarPorQr,
  rechazoDe,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { ejecutarFaltas, inasistenciasDe, registrarPosterior } from '../../utilidades/escenario-faltas';
import {
  cambiarHorario,
  cambioDe,
  crearAlumnoDeHorario,
  crearAlumnoPagadoDeHorario,
  type EscenarioDeHorario,
  filasDeClases,
  HORARIOS,
  prepararEscenarioDeHorario,
} from '../../utilidades/escenario-horario';

// Criterio 38 (crítico, RN-14, RN-16, D-16, D-08): una ocurrencia de una clase agregada está incluida en la mensualidad solo si empieza después de `matriculas.creado_en` y de `agregada_en` (amplía DT-14 de 009). Con `RELOJ` fijo, un cambio a las 15:00 de un martes a la clase de ese martes a las 10:00: el marcado de ese día responde `CLASE_NO_INCLUIDA`, la tarea de faltas
// no registra falta por ella y el registro posterior de ese día responde `CLASE_NO_INCLUIDA`; la del martes siguiente se marca y descuenta. Una clase quitada ya no se marca (`FUERA_DE_HORARIO`) ni genera faltas desde el cambio. Si ya marcó hoy en la clase anterior, la nueva de hoy responde `ASISTENCIA_YA_REGISTRADA`.
// Lecturas estrictas elegidas: (1) el ejemplo de la spec se prueba con un plan de una clase por semana: el alumno tiene la clase del miércoles a las 10:00 y el martes 17/11/2026 a las 15:00 la cambia por la del martes a las 10:00; (2) con un cambio a las 15:00 el marcado de las 10:00 ya no es posible (la ventana de la clase pasó: `FUERA_DE_HORARIO`, que va antes que `CLASE_NO_INCLUIDA` en el orden del
// criterio 7 de 009), así que «el marcado de ese día responde `CLASE_NO_INCLUIDA`» se prueba con el cambio hecho durante la misma clase (a las 10:30, marcado a las 10:45): ahí la ventana está abierta y lo único que falla es la inclusión; (3) «después de» es estricto: un cambio a las 10:00:00.000 deja fuera la ocurrencia de las 10:00 y uno a las 09:59:59.999 la deja dentro;
// (4) la tarea de faltas solo registra faltas a quien tiene un pago confirmado (criterio 24 de 009): los alumnos de estas pruebas pagan en efectivo por la API el 11/11, y un alumno que no cambió de horario sirve de control de que la tarea sí registra en ese instante; (5) el registro posterior del martes 17/11 se hace a las 15:05, con la clase ya terminada;
// (6) «ya no se puede registrar el día anterior al cambio en la clase quitada» (riesgos aceptados de la spec) se prueba con las dos respuestas de 009 que corresponden a la clase que ahora tiene el alumno ese día: `HORA_FUERA_DE_LA_CLASE` si la hora es la de la clase quitada y `CLASE_NO_INCLUIDA` si es la de la clase nueva.

const MARTES_17 = '2026-11-17';
const MARTES_24 = '2026-11-24';

describe('la asistencia y las faltas después de un cambio de horario (criterio 38)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeHorario(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const secretariaEn = (instante: Date) => en(ctx, esc, instante).secretaria;

  /** Dos alumnos pagados del plan de una clase por semana: el que cambia (el miércoles a las 10:00) y el que no cambia (el martes a las 10:00, control). */
  async function alumnos() {
    const quien = await crearAlumnoPagadoDeHorario(ctx, esc, {
      plan: esc.planUnDia,
      claseIds: [esc.miercoles10.id],
      clasesTotales: 4,
    });
    const control = await crearAlumnoPagadoDeHorario(ctx, esc, {
      plan: esc.planUnDia,
      claseIds: [esc.martes10.id],
      clasesTotales: 4,
    });
    return { quien, control };
  }

  /** El cambio del miércoles a las 10:00 por el martes a las 10:00, hecho en el instante dado. */
  async function cambiarAlMartes(matriculaId: string, instante: Date) {
    const respuesta = await cambiarHorario(ctx, secretariaEn(instante), matriculaId, [esc.martes10.id]);
    expect(respuesta.status, respuesta.texto).toBe(200);
  }

  describe('el cambio de las 15:00 del martes a la clase de ese martes a las 10:00', () => {
    it('criterio 38: la clase agregada guarda agregada_en = «ahora» (las 15:00 de Lima)', async () => {
      const { quien } = await alumnos();

      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);

      const filas = await filasDeClases(A(), quien.matriculaId);
      expect(filas.map((fila) => fila.clase_id)).toEqual([esc.martes10.id]);
      expect(filas[0]?.agregada_en?.toISOString()).toBe(HORARIOS.martes17a15.toISOString());
    });

    it('criterio 38: la tarea de faltas no registra falta por la clase del martes de las 10:00 al alumno que la agregó a las 15:00, y sí al que ya la tenía (control)', async () => {
      const { quien, control } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);

      await ejecutarFaltas(ctx, HORARIOS.martes17a15_05);

      expect(await inasistenciasDe(A(), quien.alumnoId), 'ni por la clase nueva ni por la que quitó').toEqual([]);
      expect(
        (await inasistenciasDe(A(), control.alumnoId)).map((falta) => [falta.fecha, falta.clase_id]),
        'el control sí tiene su falta del 17/11',
      ).toEqual([[MARTES_17, esc.martes10.id]]);
    });

    it('criterio 38: el registro posterior de ese martes en la clase agregada responde 409 CLASE_NO_INCLUIDA, no descuenta ni escribe; el del control sí se registra', async () => {
      const { quien, control } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);
      const cookie = secretariaEn(HORARIOS.martes17a15_05);

      const rechazada = await registrarPosterior(ctx, cookie, quien.alumnoId, MARTES_17, '10:30');
      const delControl = await registrarPosterior(ctx, cookie, control.alumnoId, MARTES_17, '10:30');

      rechazoDe(rechazada, 'CLASE_NO_INCLUIDA', 'AMARILLA');
      expect(await asistenciasDe(A(), quien.alumnoId)).toEqual([]);
      expect(await clasesUsadasDe(A(), quien.matriculaId)).toBe(0);
      expect(await inasistenciasDe(A(), quien.alumnoId)).toEqual([]);
      expect(delControl.status, delControl.texto).toBe(201);
    });

    it('criterio 38: el martes siguiente la clase agregada se marca (201) y descuenta una clase de la mensualidad', async () => {
      const { quien } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);

      const respuesta = await marcarManual(ctx, secretariaEn(HORARIOS.martes24a10_30), quien.alumnoId);

      const resultado = resultadoDe(respuesta, 201);
      expect(resultado.clases).toEqual({ usadas: 1, totales: 4, restantes: 3 });
      expect(resultado.clase.id).toBe(esc.martes10.id);
      const [fila] = await asistenciasDe(A(), quien.alumnoId);
      expect(fila).toMatchObject({ fecha: MARTES_24, clase_id: esc.martes10.id, matricula_id: quien.matriculaId });
      expect(await clasesUsadasDe(A(), quien.matriculaId)).toBe(1);
    });

    it('criterio 38: el martes siguiente, si el alumno no va, la tarea de faltas le registra la falta de la clase agregada', async () => {
      const { quien } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);

      await ejecutarFaltas(ctx, HORARIOS.martes24a11_05);

      expect((await inasistenciasDe(A(), quien.alumnoId)).map((falta) => [falta.fecha, falta.clase_id])).toEqual([
        [MARTES_24, esc.martes10.id],
      ]);
    });

    it('criterio 38: el miércoles siguiente la clase quitada ya no se marca: 409 FUERA_DE_HORARIO sin clase de hoy', async () => {
      const { quien } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);

      const respuesta = await marcarManual(ctx, secretariaEn(HORARIOS.miercoles18a10_30), quien.alumnoId);

      const rechazo = rechazoDe(respuesta, 'FUERA_DE_HORARIO', 'AMARILLA');
      expect(rechazo.claseDeHoy, 'el miércoles ya no tiene clase').toBeNull();
      expect(await asistenciasDe(A(), quien.alumnoId)).toEqual([]);
      expect(await clasesUsadasDe(A(), quien.matriculaId)).toBe(0);
    });

    it('criterio 38: la clase quitada no genera falta desde el cambio (ni la del miércoles ni la del martes que no era suya)', async () => {
      const { quien } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a15);

      await ejecutarFaltas(ctx, HORARIOS.miercoles18a11_05);

      expect(await inasistenciasDe(A(), quien.alumnoId)).toEqual([]);
    });
  });

  describe('el cambio durante la clase y en el borde de su inicio', () => {
    it('criterio 38: cambiada a las 10:30 la clase de las 10:00 de ese martes, el marcado de las 10:45 responde 409 CLASE_NO_INCLUIDA (amarilla) y no descuenta; el control marca (201)', async () => {
      const { quien, control } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a10_30);
      const cookie = secretariaEn(HORARIOS.martes17a10_45);

      const rechazada = await marcarManual(ctx, cookie, quien.alumnoId);
      const delControl = await marcarManual(ctx, cookie, control.alumnoId);

      rechazoDe(rechazada, 'CLASE_NO_INCLUIDA', 'AMARILLA');
      expect(await asistenciasDe(A(), quien.alumnoId)).toEqual([]);
      expect(await clasesUsadasDe(A(), quien.matriculaId)).toBe(0);
      expect(delControl.status, delControl.texto).toBe(201);
    });

    it('criterio 38: lo mismo por QR: el QR de quien cambió a las 10:30 responde 409 CLASE_NO_INCLUIDA a las 10:45', async () => {
      const { quien } = await alumnos();
      await cambiarAlMartes(quien.matriculaId, HORARIOS.martes17a10_30);

      const respuesta = await marcarPorQr(ctx, secretariaEn(HORARIOS.martes17a10_45), quien.contenido);

      rechazoDe(respuesta, 'CLASE_NO_INCLUIDA', 'AMARILLA');
      expect(await asistenciasDe(A(), quien.alumnoId)).toEqual([]);
    });

    it('criterio 38: «después de» es estricto: cambiada a las 10:00:00.000, la ocurrencia de las 10:00 no está incluida; cambiada a las 09:59:59.999, sí', async () => {
      const { quien } = await alumnos();
      const alBorde = await crearAlumnoPagadoDeHorario(ctx, esc, {
        plan: esc.planUnDia,
        claseIds: [esc.miercoles10.id],
        clasesTotales: 4,
      });
      await cambiarAlMartes(quien.matriculaId, enLima(MARTES_17, '10:00:00.000'));
      await cambiarAlMartes(alBorde.matriculaId, enLima(MARTES_17, '09:59:59.999'));
      const cookie = secretariaEn(enLima(MARTES_17, '10:05'));

      const tarde = await marcarManual(ctx, cookie, quien.alumnoId);
      const aTiempo = await marcarManual(ctx, cookie, alBorde.alumnoId);

      rechazoDe(tarde, 'CLASE_NO_INCLUIDA', 'AMARILLA');
      expect(resultadoDe(aTiempo, 201).clases).toEqual({ usadas: 1, totales: 4, restantes: 3 });
    });
  });

  describe('la clase de hoy y la que ya marcó', () => {
    it('criterio 38: si ya marcó hoy en la clase anterior (la del lunes de las 17:00), la nueva de hoy (la de las 19:00) responde 409 ASISTENCIA_YA_REGISTRADA, sin descontar otra clase ni registrar falta', async () => {
      const alumno = await crearAlumnoPagadoDeHorario(ctx, esc, {
        plan: esc.planUnDia,
        claseIds: [esc.e.lunes17.id],
        clasesTotales: 4,
      });
      const primera = await marcarManual(ctx, secretariaEn(HORARIOS.lunes23a17_05), alumno.alumnoId);
      expect(primera.status, primera.texto).toBe(201);
      const cambio = await cambiarHorario(ctx, secretariaEn(HORARIOS.lunes23a17_30), alumno.matriculaId, [
        esc.lunes19.id,
      ]);
      expect(cambio.status, cambio.texto).toBe(200);

      const segunda = await marcarManual(ctx, secretariaEn(HORARIOS.lunes23a19_05), alumno.alumnoId);

      const rechazo = rechazoDe(segunda, 'ASISTENCIA_YA_REGISTRADA', 'AMARILLA');
      expect(rechazo.asistenciaDeHoy, 'la primera asistencia del día').toBeTruthy();
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      await ejecutarFaltas(ctx, HORARIOS.lunes23a20_05);
      expect(await inasistenciasDe(A(), alumno.alumnoId)).toEqual([]);
    });
  });

  describe('lo que no cambió sigue como antes', () => {
    it('criterio 38: la clase que se queda (el viernes) se marca el viernes con su agregada_en nula, y la que entró (el lunes de las 17:00) se marca el lunes siguiente al cambio', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const jueves = en(ctx, esc, enLima('2026-11-26', '10:00'));
      const cambio = cambioDe(
        await cambiarHorario(ctx, jueves.secretaria, alumno.matriculaId, [
          esc.e.lunes17.id,
          esc.e.miercoles.id,
          esc.e.viernes.id,
        ]),
      );
      expect(cambio.matricula.id).toBe(alumno.matriculaId);

      const viernes = await marcarManual(ctx, secretariaEn(enLima('2026-11-27', '18:05')), alumno.alumnoId);
      const lunes = await marcarManual(ctx, secretariaEn(enLima('2026-11-30', '17:05')), alumno.alumnoId);

      expect(resultadoDe(viernes, 201).clase.id).toBe(esc.e.viernes.id);
      const delLunes = resultadoDe(lunes, 201);
      expect(delLunes.clase.id).toBe(esc.e.lunes17.id);
      expect(delLunes.clases).toEqual({ usadas: 2, totales: 12, restantes: 10 });
    });

    it('criterio 38: el registro posterior de un día anterior al cambio en la clase quitada ya no se puede: con la hora de la clase quitada, 409 HORA_FUERA_DE_LA_CLASE; con la de la clase nueva, 409 CLASE_NO_INCLUIDA', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const cambio = await cambiarHorario(ctx, secretariaEn(HORARIOS.martes17a15), alumno.matriculaId, [
        esc.e.lunes17.id,
        esc.e.miercoles.id,
        esc.e.viernes.id,
      ]);
      expect(cambio.status, cambio.texto).toBe(200);
      const cookie = secretariaEn(HORARIOS.miercoles18a11_05);

      const enLaQuitada = await registrarPosterior(ctx, cookie, alumno.alumnoId, '2026-11-16', '18:30');
      const enLaNueva = await registrarPosterior(ctx, cookie, alumno.alumnoId, '2026-11-16', '17:30');

      rechazoDe(enLaQuitada, 'HORA_FUERA_DE_LA_CLASE', 'AMARILLA');
      rechazoDe(enLaNueva, 'CLASE_NO_INCLUIDA', 'AMARILLA');
      expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
    });
  });
});
