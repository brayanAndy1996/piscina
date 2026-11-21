// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contarAuditoria, dniInventado } from '../../utilidades/usuarios';
import {
  actualizarFilas,
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  IP_RE,
  leerAlumnos,
  leerSolicitudes,
  rutaPublica,
  sembrarSolicitud,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterio 25 (crítico, riesgo de 11.4: cupos bloqueados): dada una IP con 5 solicitudes activas creadas desde ella en la academia, cuando
// envía otra, responde 409 LIMITE_DE_RESERVAS_PENDIENTES sin escribir. Las vencidas, canceladas y las de otra academia no cuentan. La IP
// de origen se guarda en la solicitud. (Las 5 se crean por la API desde la misma IP de las pruebas: no se supone cómo se escribe la IP.)

describe('envío: límite de reservas sin pagar por conexión (criterio 25)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

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

  const enviar = async (nombreCorto = 'academia-a', sobre = {}) => {
    const esB = nombreCorto === 'academia-b';
    const cuerpo = esB
      ? await cuerpoInscripcion(e, { plan: e.planB, clases: [e.lunesB, e.miercolesB, e.viernesB], sobre })
      : await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre });
    return ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), cuerpo);
  };

  async function crearReservas(cantidad: number, nombreCorto = 'academia-a') {
    for (let i = 0; i < cantidad; i++) {
      const respuesta = await enviar(nombreCorto);
      expect(respuesta.status, `reserva ${i + 1}: ${respuesta.texto}`).toBe(201);
    }
  }

  it('criterio 25: la IP de origen se guarda en la solicitud', async () => {
    await crearReservas(1);

    expect((await leerSolicitudes(e.A.id))[0]?.ip_origen).toMatch(IP_RE);
  });

  it('criterio 25: con 5 solicitudes activas desde la misma IP, la sexta responde 409 LIMITE_DE_RESERVAS_PENDIENTES y no escribe ni audita', async () => {
    await crearReservas(5);
    const antes = { filas: await instantaneaDeInscripciones(e.A.id), auditoria: await contarAuditoria(e.A.id) };

    const sexta = await enviar();

    expect([sexta.status, codigoDe(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    expect({ filas: await instantaneaDeInscripciones(e.A.id), auditoria: await contarAuditoria(e.A.id) }).toEqual(
      antes,
    );
    expect(await leerAlumnos(e.A.id)).toHaveLength(5);
  });

  it('criterio 25: con 4 solicitudes activas la quinta todavía entra (el límite es 5 a la vez)', async () => {
    await crearReservas(4);

    const quinta = await enviar();

    expect(quinta.status, quinta.texto).toBe(201);
  });

  it('criterio 25: las solicitudes de otra IP no cuentan (5 creadas desde 203.0.113.50 no frenan a esta IP)', async () => {
    for (let i = 0; i < 5; i++) {
      await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        ipOrigen: '203.0.113.50',
        dni: dniInventado(),
      });
    }

    const respuesta = await enviar();

    expect(respuesta.status, respuesta.texto).toBe(201);
  });

  it('criterio 25: las canceladas no cuentan: al cancelar una de las 5, la sexta entra', async () => {
    await crearReservas(5);
    const [primera] = await leerSolicitudes(e.A.id);
    await actualizarFilas(
      'propietario',
      'solicitudes_inscripcion',
      e.A.id,
      { id: primera?.id },
      { estado: 'CANCELADA' },
    );
    await actualizarFilas(
      'propietario',
      'matriculas',
      e.A.id,
      { solicitud_id: primera?.id },
      { estado: 'CANCELADA', reserva_vence_en: null },
    );

    const sexta = await enviar();

    expect(sexta.status, sexta.texto).toBe(201);
  });

  it('criterio 25: las vencidas no cuentan: pasadas las 24 horas las 5 reservas vencen y se puede volver a reservar', async () => {
    await crearReservas(5);
    expect(codigoDe(await enviar())).toBe('LIMITE_DE_RESERVAS_PENDIENTES');

    ctx.reloj.avanzar(VEINTICUATRO_HORAS);
    const despues = await enviar();

    expect(despues.status, despues.texto).toBe(201);
  });

  it('criterio 25: la reserva que vence justo en este instante ya no cuenta, y la que vence un segundo después todavía sí', async () => {
    await crearReservas(5);

    ctx.reloj.avanzar(VEINTICUATRO_HORAS - 1000);
    expect(codigoDe(await enviar())).toBe('LIMITE_DE_RESERVAS_PENDIENTES');
    ctx.reloj.avanzar(1000);
    expect((await enviar()).status).toBe(201);
  });

  it('criterio 25: las solicitudes de otra academia no cuentan: 5 reservas en B desde la misma IP no frenan la inscripción en A (y al revés)', async () => {
    await crearReservas(5, 'academia-b');

    const enA = await enviar('academia-a');

    expect(enA.status, enA.texto).toBe(201);
    await crearReservas(4, 'academia-a');
    expect(codigoDe(await enviar('academia-a'))).toBe('LIMITE_DE_RESERVAS_PENDIENTES');
    expect((await enviar('academia-b')).status, 'B sigue con sus 5: su sexta sí se frena').toBe(409);
  });

  it('criterio 25: el límite se aplica antes de elegir clases: con 5 activas, un envío con una selección inválida responde el límite, no SELECCION_NO_VALIDA (orden de los 409)', async () => {
    await crearReservas(5);

    const respuesta = await enviar('academia-a', { inscripcion: { claseIds: [e.lunes.id] } });

    expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
  });

  it('criterio 25: el DNI ya registrado se decide antes que el límite (orden de los 409)', async () => {
    await crearReservas(5);
    const [alumno] = await leerAlumnos(e.A.id);

    const respuesta = await enviar('academia-a', { alumno: { dni: alumno?.dni } });

    expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
  });
});
