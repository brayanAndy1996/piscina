// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { contarAuditoria } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  buscarTextoEnBase,
  cancelarTodasLasReservas,
  codigoDe,
  conRetencion,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  detallesDe,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerSolicitudes,
  llenarClase,
  retenerClases,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 23 (crítico, regla de idempotencia de CLAUDE.md): dado un envío que ya creó su solicitud, cuando llega otro con la misma
// `claveIdempotencia` y el mismo DNI en la misma academia (doble clic o reintento tras un corte de red), responde 409
// SOLICITUD_YA_REGISTRADA con `detalles.codigo` (el código de la solicitud, nunca el token), sin escribir, auditar ni enviar otro correo.
// La misma clave con otro DNI responde 409 SOLICITUD_YA_REGISTRADA sin `detalles`. Dos envíos simultáneos con la misma clave y el mismo
// DNI: uno 201 y el otro 409 con el código; queda una sola solicitud. La misma clave en otra academia no cuenta.

describe('envío: envíos repetidos (criterio 23)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const correo = new EnviadorDePrueba();

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.mensajes.length = 0;
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown, nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), cuerpo);
  const conCorreo = () => cuerpoInscripcion(e, { sobre: { alumno: { correo: 'familia@ejemplo.test' } } });
  const estado = async () => ({
    filas: await instantaneaDeInscripciones(e.A.id),
    auditoria: await contarAuditoria(e.A.id),
    correos: correo.mensajes.length,
  });

  it('criterio 23: el mismo envío dos veces (misma clave y mismo DNI) responde la segunda 409 SOLICITUD_YA_REGISTRADA con el código de la primera, y no escribe, audita ni envía otro correo', async () => {
    const cuerpo = await conCorreo();
    const primera = await enviar(cuerpo);
    expect(primera.status, primera.texto).toBe(201);
    const original = solicitudDe(primera);
    const antes = await estado();

    const segunda = await enviar(cuerpo);

    expect([segunda.status, codigoDe(segunda)], segunda.texto).toEqual([409, 'SOLICITUD_YA_REGISTRADA']);
    expect(detallesDe(segunda)).toEqual({ codigo: original.codigo });
    expect(segunda.texto, 'nunca el token').not.toContain(original.token);
    expect(await estado(), 'sin escribir, sin auditar y sin otro correo').toEqual(antes);
    expect(correo.mensajes).toHaveLength(1);
  });

  it('criterio 23: varios reintentos seguidos dejan una sola solicitud y siempre devuelven el mismo código', async () => {
    const cuerpo = await cuerpoInscripcion(e);
    const original = solicitudDe(await enviar(cuerpo));

    for (let i = 0; i < 4; i++) {
      const repetida = await enviar(cuerpo);
      expect(detallesDe(repetida)['codigo'], `reintento ${i + 1}`).toBe(original.codigo);
    }

    expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
  });

  it('criterio 23: SOLICITUD_YA_REGISTRADA se decide antes que DNI_YA_REGISTRADO (el DNI ya tiene la solicitud del primer envío)', async () => {
    const cuerpo = await cuerpoInscripcion(e);
    await enviar(cuerpo);

    const repetida = await enviar(cuerpo);
    const otraClave = await enviar({ ...cuerpo, claveIdempotencia: randomUUID() });

    expect(codigoDe(repetida)).toBe('SOLICITUD_YA_REGISTRADA');
    expect(codigoDe(otraClave), 'con otra clave sí es un DNI repetido').toBe('DNI_YA_REGISTRADO');
  });

  it('criterio 23: la misma clave con otro DNI responde 409 SOLICITUD_YA_REGISTRADA sin detalles (no revela el código de otra persona) y no escribe', async () => {
    const cuerpo = await cuerpoInscripcion(e);
    const original = solicitudDe(await enviar(cuerpo));
    const antes = await estado();

    const ajena = await enviar(
      await cuerpoInscripcion(e, { sobre: { claveIdempotencia: cuerpo['claveIdempotencia'] } }),
    );

    expect([ajena.status, codigoDe(ajena)], ajena.texto).toEqual([409, 'SOLICITUD_YA_REGISTRADA']);
    expect(ajena.body?.['detalles'], 'sin detalles').toBeUndefined();
    expect(ajena.texto).not.toContain(original.codigo);
    expect(ajena.texto).not.toContain(original.token);
    expect(await estado()).toEqual(antes);
  });

  it('criterio 23: la misma clave en otra academia no cuenta: el envío en B se acepta aunque A ya la usó (y con el mismo DNI)', async () => {
    const deA = await cuerpoInscripcion(e);
    expect((await enviar(deA)).status).toBe(201);
    const deB = await cuerpoInscripcion(e, {
      plan: e.planB,
      clases: [e.lunesB, e.miercolesB, e.viernesB],
      sobre: { claveIdempotencia: deA['claveIdempotencia'], alumno: { dni: (deA['alumno'] as { dni: string }).dni } },
    });

    const enB = await enviar(deB, 'academia-b');

    expect(enB.status, enB.texto).toBe(201);
  });

  it('criterio 23: un envío rechazado no gasta la clave: si el primero falló (SIN_CUPO) y se libera el cupo, el mismo envío con la misma clave se acepta', async () => {
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
    const cuerpo = await cuerpoInscripcion(e);
    const rechazado = await enviar(cuerpo);
    expect(codigoDe(rechazado)).toBe('SIN_CUPO');
    await liberarCupos();

    const segundo = await enviar(cuerpo);

    expect(segundo.status, segundo.texto).toBe(201);
  });

  async function liberarCupos(): Promise<void> {
    await ejecutarComo(
      'propietario',
      `UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL WHERE academia_id = $1::uuid`,
      [e.A.id],
      { academiaId: e.A.id },
    );
  }

  it('criterio 23: dos envíos simultáneos con la misma clave y el mismo DNI: uno 201 y el otro 409 SOLICITUD_YA_REGISTRADA con el código; queda una sola solicitud y un solo correo', async () => {
    const cuerpo = await conCorreo();

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerClases([e.lunes.id], e.A.id),
      enviar: [() => enviar(cuerpo), () => enviar(cuerpo)],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron).toBe(true);
    expect(resultados.map((r) => r.status).sort(), JSON.stringify(resultados.map((r) => r.body))).toEqual([201, 409]);
    const exitosa = resultados.find((r) => r.status === 201);
    expect(exitosa, 'uno de los dos entra').toBeDefined();
    const creada = solicitudDe(exitosa as (typeof resultados)[number]);
    const repetida = resultados.find((r) => r.status === 409);
    expect(repetida && codigoDe(repetida)).toBe('SOLICITUD_YA_REGISTRADA');
    expect(repetida && detallesDe(repetida)).toEqual({ codigo: creada.codigo });
    expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
    expect(correo.mensajes).toHaveLength(1);
  });

  it('criterio 23: varias rondas de dos envíos idénticos simultáneos, sin retención: siempre [201, 409], nunca 500, una sola solicitud por ronda', async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
      const cuerpo = await cuerpoInscripcion(e);

      const respuestas = await Promise.all([enviar(cuerpo), enviar(cuerpo)]);

      expect(
        respuestas.map((r) => r.status).sort(),
        `ronda ${ronda}: ${JSON.stringify(respuestas.map((r) => r.body))}`,
      ).toEqual([201, 409]);
      const rechazada = respuestas.find((r) => r.status === 409);
      expect(rechazada && codigoDe(rechazada)).toBe('SOLICITUD_YA_REGISTRADA');
      expect(await leerSolicitudes(e.A.id), `ronda ${ronda}: una sola solicitud nueva`).toHaveLength(ronda + 1);
      // Todas las rondas salen de la misma IP: se cancelan las reservas para no chocar con el límite del criterio 25 (5 activas por IP).
      await cancelarTodasLasReservas(e.A.id);
    }
    expect(await leerSolicitudes(e.A.id)).toHaveLength(6);
  });

  it('criterio 23: el token no está en la base, la auditoría ni en ninguna respuesta que no sea el 201 (criterio 24)', async () => {
    const cuerpo = await conCorreo();
    const creada = solicitudDe(await enviar(cuerpo));

    const repetida = await enviar(cuerpo);
    const lectura = await ctx.http.get(rutaPublica('academia-a', '/inscripcion'));
    const consulta = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: creada.token });

    for (const respuesta of [repetida, lectura, consulta]) expect(respuesta.texto).not.toContain(creada.token);
    expect(await buscarTextoEnBase(e.A.id, creada.token)).toBe(0);
  });
});
