import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enviarInscripcionSchema } from '@aquagestion/contratos';
import { InscripcionesService } from '../../../src/modulos/inscripciones';
import {
  type AppInscripciones,
  AHORA_005,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerSolicitudes,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';

// Criterio 25 de 005 (límite de reservas sin pagar por conexión): una IP desconocida (el servicio la recibe nula) es una conexión más
// (clave ''), igual que en el bloqueo consultivo: cuenta las solicitudes activas con `ip_origen` nulo y tiene el mismo tope de 5. Lo que se
// guarda en `ip_origen` sigue siendo nulo. Prueba no protegida (la pidió la revisión de 005a); se llama al servicio porque por HTTP la
// petición siempre trae una IP.

describe('límite de reservas por conexión con una IP desconocida (criterio 25)', () => {
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

  const academia = () => ({ id: e.A.id, nombre: e.A.nombre, nombreCorto: 'academia-a', estado: 'ACTIVA' as const });
  const enviarSinIp = async () => {
    const datos = enviarInscripcionSchema.parse(await cuerpoInscripcion(e));
    return ctx.app.get(InscripcionesService).enviar(academia(), datos, null);
  };
  const sembrarSinIp = async (cantidad: number) => {
    for (let i = 0; i < cantidad; i++) {
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], ipOrigen: null });
    }
  };

  it('criterio 25: con 5 solicitudes activas sin IP, un envío sin IP responde 409 LIMITE_DE_RESERVAS_PENDIENTES y no escribe', async () => {
    await sembrarSinIp(5);

    await expect(enviarSinIp()).rejects.toMatchObject({ estado: 409, codigo: 'LIMITE_DE_RESERVAS_PENDIENTES' });

    expect(await leerSolicitudes(e.A.id)).toHaveLength(5);
  });

  it('criterio 25: con 4 solicitudes activas sin IP, un envío sin IP se acepta y su ip_origen queda nulo', async () => {
    await sembrarSinIp(4);

    const respuesta = await enviarSinIp();

    expect(respuesta.solicitud.estado).toBe('PENDIENTE_PAGO');
    const solicitudes = await leerSolicitudes(e.A.id);
    expect(solicitudes).toHaveLength(5);
    expect(solicitudes.every((s) => s.ip_origen === null)).toBe(true);
  });

  it('criterio 25: las solicitudes sin IP no cuentan para una IP conocida', async () => {
    await sembrarSinIp(5);

    const respuesta = await ctx.http.post('/api/a/academia-a/inscripcion', await cuerpoInscripcion(e));

    expect(respuesta.status, respuesta.texto).toBe(201);
  });
});
