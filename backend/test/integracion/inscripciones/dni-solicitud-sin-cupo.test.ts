import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dniInventado } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  actualizarFilas,
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerMatriculas,
  leerSolicitudes,
  rutaPublica,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';

// Criterio 21 de 005 (HU-01, RN-03): una solicitud activa es una PENDIENTE_PAGO cuya matrícula todavía ocupa cupo (la misma definición del
// conteo de reservas por conexión). Una PENDIENTE_PAGO cuya matrícula ya no ocupa cupo (cancelada) no deja el DNI bloqueado para siempre:
// el cliente puede volver a inscribirse y la solicitud vieja pasa a VENCIDA. Prueba no protegida (la pidió la revisión de 005a).

describe('envío: una solicitud en espera de pago sin matrícula con cupo no es activa (criterio 21)', () => {
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

  const enviarConDni = async (dni: string) =>
    ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcion(e, { sobre: { alumno: { dni } } }),
    );

  it('criterio 21: una PENDIENTE_PAGO cuya matrícula fue cancelada se acepta (201), pasa a VENCIDA y se crea la solicitud nueva', async () => {
    const previo = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estado: 'PENDIENTE_PAGO',
    });
    await actualizarFilas(
      'propietario',
      'matriculas',
      e.A.id,
      { id: previo.matriculaId },
      { estado: 'CANCELADA', reserva_vence_en: null },
    );

    const respuesta = await enviarConDni(previo.dni);

    expect(respuesta.status, respuesta.texto).toBe(201);
    const solicitudes = await leerSolicitudes(e.A.id);
    expect(solicitudes).toHaveLength(2);
    expect(solicitudes.find((s) => s.id === previo.solicitudId)?.estado).toBe('VENCIDA');
    expect(solicitudes.filter((s) => s.estado === 'PENDIENTE_PAGO')).toHaveLength(1);
    expect((await leerMatriculas(e.A.id)).filter((m) => m.estado === 'RESERVADA')).toHaveLength(1);
  });

  it('criterio 21 (control): con la matrícula RESERVADA todavía con cupo, la misma solicitud sigue activa y el DNI responde 409 DNI_YA_REGISTRADO', async () => {
    const vigente = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estado: 'PENDIENTE_PAGO',
    });

    const respuesta = await enviarConDni(vigente.dni);

    expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'DNI_YA_REGISTRADO']);
    expect((await leerSolicitudes(e.A.id)).map((s) => s.estado)).toEqual(['PENDIENTE_PAGO']);
  });

  it('criterio 21 (control): otro DNI no se ve afectado por la solicitud sin cupo de un cliente', async () => {
    const respuesta = await enviarConDni(dniInventado());

    expect(respuesta.status, respuesta.texto).toBe(201);
  });
});
