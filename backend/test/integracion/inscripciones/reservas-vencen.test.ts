// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { obtenerBaseDatos, type TransaccionAcademiaPrueba } from '../../utilidades/modulos';
import {
  type AppInscripciones,
  AHORA_005,
  cargarFuncionalidad005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  rutaPublica,
  sembrarSolicitud,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterio 20 (crítico, RN-28, pregunta N1): dada una matrícula RESERVADA cuya `reserva_vence_en` es anterior o igual a "ahora", no ocupa
// cupo: los cupos restantes del criterio 6, el criterio 17 y los inscritos de DR-5 la ignoran, sin que ninguna tarea programada la cambie.
// Con RELOJ fijo: un segundo antes del vencimiento ocupa el cupo; en el instante del vencimiento ya no. Una RESERVADA sin vencimiento
// (pago en verificación, desde la 007) ocupa siempre. La ocupación es por mes: una reserva de un mes pasado no ocupa en el mes en curso.
// También se prueban las dos funciones del contrato `contarOcupacion` y `contarInscritos` (backend/src/modulos/matriculas/index.ts).

interface ModuloMatriculas {
  contarOcupacion(
    tx: TransaccionAcademiaPrueba,
    claseIds: readonly string[],
    mes: { anio: number; mes: number },
    ahora: Date,
  ): Promise<Map<string, number>>;
  contarInscritos(
    tx: TransaccionAcademiaPrueba,
    claseIds: readonly string[],
    ahora: Date,
  ): Promise<Map<string, number>>;
}

describe('las reservas vencen solas (criterio 20)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  let modulo: ModuloMatriculas;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = async (sobre = {}) =>
    ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre }),
    );
  const cupos = async (claseId: string): Promise<number | undefined> => {
    const lectura = await ctx.http.get(rutaPublica('academia-a', '/inscripcion'));
    const clase = (lectura.body?.['clases'] as { id: string; cuposRestantes: number }[]).find((c) => c.id === claseId);
    return clase?.cuposRestantes;
  };

  describe('por la API', () => {
    it('criterio 20: la última reserva ocupa el cupo hasta un segundo antes del vencimiento y en el instante del vencimiento ya no', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const vencimiento = new Date(AHORA_005.getTime() + 60_000);
      await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'PENDIENTE_PAGO',
        reservaVenceEn: vencimiento,
      });

      ctx.reloj.fijar(new Date(vencimiento.getTime() - 1000));
      expect(await cupos(e.lunes.id), 'un segundo antes del vencimiento sigue reservado').toBeUndefined();
      const lleno = await enviar();
      expect([lleno.status, codigoDe(lleno)], lleno.texto).toEqual([409, 'SIN_CUPO']);

      ctx.reloj.fijar(vencimiento);
      expect(await cupos(e.lunes.id), 'en el instante del vencimiento el cupo vuelve').toBe(1);
      const libre = await enviar();
      expect(libre.status, libre.texto).toBe(201);
    });

    it('criterio 20: una reserva ya vencida deja el cupo libre aunque su fila siga RESERVADA y su solicitud PENDIENTE_PAGO (nadie las cambia)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const vieja = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'PENDIENTE_PAGO_VENCIDA',
      });
      expect(await cupos(e.lunes.id)).toBe(1);
      const respuesta = await enviar();

      expect(respuesta.status, respuesta.texto).toBe(201);
      const solicitudes = await leerSolicitudes(e.A.id);
      expect(solicitudes.find((s) => s.id === vieja.solicitudId)?.estado, 'la fila vieja no la tocó nadie').toBe(
        'PENDIENTE_PAGO',
      );
      const matriculas = await leerMatriculas(e.A.id);
      expect(matriculas.find((m) => m.id === vieja.matriculaId)?.estado).toBe('RESERVADA');
    });

    it('criterio 20: una reserva sin vencimiento (pago en verificación) ocupa el cupo siempre, también años después', async () => {
      await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'PENDIENTE_PAGO',
        reservaVenceEn: null,
      });

      expect(await cupos(e.lunes.id)).toBe(19);
      ctx.reloj.avanzar(10 * VEINTICUATRO_HORAS);
      expect(await cupos(e.lunes.id), 'sin vencimiento no se libera sola').toBe(19);
    });

    it('criterio 20: las reservas vencidas y las canceladas no cuentan en lo que se ofrece ni en lo que se cuenta al enviar', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 10, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() - 1),
      });
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'CANCELADA' });
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });

      expect(await cupos(e.lunes.id)).toBe(20);
    });

    it('criterio 20: una reserva sin pagar de un mes pasado no ocupa cupo en el mes en curso', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20, {
        mes: { anio: 2026, mes: 10 },
        estado: 'RESERVADA',
        reservaVenceEn: null,
      });

      expect(await cupos(e.lunes.id)).toBe(20);
      const respuesta = await enviar();
      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 20: la reserva de un envío hecho por la API vence a las 24 horas exactas: a las 23:59:59 ocupa, a las 24:00:00 ya no', async () => {
      const primero = await enviar();
      expect(primero.status, primero.texto).toBe(201);
      expect(await cupos(e.lunes.id)).toBe(19);

      ctx.reloj.avanzar(VEINTICUATRO_HORAS - 1000);
      expect(await cupos(e.lunes.id)).toBe(19);
      ctx.reloj.avanzar(1000);
      expect(await cupos(e.lunes.id)).toBe(20);
    });
  });

  describe('contarOcupacion y contarInscritos', () => {
    beforeEach(async () => {
      modulo = await cargarFuncionalidad005<ModuloMatriculas>('modulos/matriculas/index.ts', [
        'contarOcupacion',
        'contarInscritos',
      ]);
    });

    const noviembre = { anio: 2026, mes: 11 };
    const ocupacion = async (claseIds: string[], mes = noviembre, ahora = AHORA_005) => {
      const base = await obtenerBaseDatos(ctx.app);
      return base.conAcademia(e.A.id, (tx) => modulo.contarOcupacion(tx, claseIds, mes, ahora));
    };
    const inscritos = async (claseIds: string[], ahora = AHORA_005) => {
      const base = await obtenerBaseDatos(ctx.app);
      return base.conAcademia(e.A.id, (tx) => modulo.contarInscritos(tx, claseIds, ahora));
    };

    async function sembrarTodosLosEstados() {
      const futuro = new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 2, { estado: 'VIGENTE' });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, { estado: 'RESERVADA', reservaVenceEn: null });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 4, { estado: 'RESERVADA', reservaVenceEn: futuro });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5, { estado: 'RESERVADA', reservaVenceEn: AHORA_005 });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 6, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() - 1000),
      });
    }

    it('criterio 20: contarOcupacion cuenta VIGENTES, RESERVADAS sin vencimiento y RESERVADAS con vencimiento posterior a "ahora"; no las que vencen en "ahora" o antes', async () => {
      await sembrarTodosLosEstados();

      const mapa = await ocupacion([e.lunes.id, e.miercoles.id]);

      expect(mapa.get(e.lunes.id)).toBe(2 + 3 + 4);
      expect(mapa.get(e.miercoles.id) ?? 0, 'una clase sin matrículas tiene 0').toBe(0);
    });

    it('criterio 20: contarOcupacion con el reloj un segundo antes del vencimiento cuenta la reserva y en el instante del vencimiento no', async () => {
      const vence = new Date('2026-11-12T12:00:00.000Z');
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 1, { estado: 'RESERVADA', reservaVenceEn: vence });

      expect((await ocupacion([e.lunes.id], noviembre, new Date(vence.getTime() - 1000))).get(e.lunes.id)).toBe(1);
      expect((await ocupacion([e.lunes.id], noviembre, vence)).get(e.lunes.id) ?? 0).toBe(0);
      expect((await ocupacion([e.lunes.id], noviembre, new Date(vence.getTime() + 1000))).get(e.lunes.id) ?? 0).toBe(0);
    });

    it('criterio 20: contarOcupacion es por mes: octubre y diciembre no cuentan en noviembre y cada mes cuenta lo suyo', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, { mes: { anio: 2026, mes: 10 } });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5, { mes: noviembre });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 7, { mes: { anio: 2026, mes: 12 } });

      expect((await ocupacion([e.lunes.id], noviembre)).get(e.lunes.id)).toBe(5);
      expect((await ocupacion([e.lunes.id], { anio: 2026, mes: 10 })).get(e.lunes.id)).toBe(3);
      expect((await ocupacion([e.lunes.id], { anio: 2026, mes: 12 })).get(e.lunes.id)).toBe(7);
      expect((await ocupacion([e.lunes.id], { anio: 2027, mes: 11 })).get(e.lunes.id) ?? 0).toBe(0);
    });

    it('criterio 20: contarOcupacion cuenta cada clase por separado y no mezcla las de otra academia', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 4);
      await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 6);
      await llenarClase(e.B.id, e.lunesB.id, e.planB.id, 9);

      const mapa = await ocupacion([e.lunes.id, e.miercoles.id, e.lunesB.id]);

      expect(mapa.get(e.lunes.id)).toBe(4);
      expect(mapa.get(e.miercoles.id)).toBe(6);
      expect(mapa.get(e.lunesB.id) ?? 0, 'la clase de B no se ve desde la transacción de A').toBe(0);
    });

    it('criterio 20: contarInscritos es la mayor ocupación entre el mes en curso y los siguientes; ignora los meses pasados y las reservas vencidas', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 15, { mes: { anio: 2026, mes: 10 } });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5, { mes: noviembre });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 8, { mes: { anio: 2026, mes: 12 } });
      await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 10, { mes: noviembre });
      await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 2, { mes: { anio: 2026, mes: 12 } });
      await llenarClase(e.A.id, e.viernes.id, e.plan.id, 9, {
        mes: { anio: 2026, mes: 12 },
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() - 1000),
      });

      const mapa = await inscritos([e.lunes.id, e.miercoles.id, e.viernes.id, e.lunes17.id]);

      expect(mapa.get(e.lunes.id), 'diciembre (8) pesa más que noviembre (5); octubre no cuenta').toBe(8);
      expect(mapa.get(e.miercoles.id), 'noviembre (10) pesa más que diciembre (2)').toBe(10);
      expect(mapa.get(e.viernes.id) ?? 0, 'la reserva vencida de diciembre no cuenta').toBe(0);
      expect(mapa.get(e.lunes17.id) ?? 0).toBe(0);
    });

    it('criterio 20: contarInscritos usa el "ahora" que se le pasa (la misma reserva cuenta un segundo antes y no cuenta en su vencimiento)', async () => {
      const vence = new Date('2026-11-20T12:00:00.000Z');
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 4, { estado: 'RESERVADA', reservaVenceEn: vence });

      expect((await inscritos([e.lunes.id], new Date(vence.getTime() - 1000))).get(e.lunes.id)).toBe(4);
      expect((await inscritos([e.lunes.id], vence)).get(e.lunes.id) ?? 0).toBe(0);
    });

    it('criterio 20: el mes lo decide la fecha de Lima de "ahora": a las 23:59 del 30 de noviembre en Lima sigue siendo noviembre', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 6, { mes: noviembre });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, { mes: { anio: 2026, mes: 12 } });

      const antes = await inscritos([e.lunes.id], new Date('2026-12-01T04:59:00.000Z'));
      const despues = await inscritos([e.lunes.id], new Date('2026-12-01T05:00:00.000Z'));

      expect(antes.get(e.lunes.id)).toBe(6);
      expect(despues.get(e.lunes.id), 'desde el 1 de diciembre en Lima noviembre ya no cuenta').toBe(3);
    });
  });
});
