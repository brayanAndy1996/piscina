// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoAjuste,
  cuerpoCobro,
  detallesDeRespuesta,
  type EscenarioPagos,
  exigirRutasDePagos,
  rutaAjuste,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  conRetencion,
  crearAppInscripciones,
  leerMatriculas,
  type RespuestaApi,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { leerMovimientos } from '../../utilidades/caja';
import { leerPagos } from '../../utilidades/pagos';
import type { Retenedor } from '../../utilidades/planes-clases';

// Criterio 12 (crítico, D-03; idempotencia y carreras de `CLAUDE.md`): el cobro en efectivo compara el total que vio quien cobra (`montoMostrado`) con el total al
// momento de cobrar (criterio 16). Con un ajuste y un cobro simultáneos sobre la misma solicitud, termina uno de dos modos: el cobro primero (201 con el total de
// antes) y el ajuste responde 409 `SOLICITUD_NO_AJUSTABLE`; o el ajuste primero y el cobro responde 409 `MONTO_CAMBIO`. Nunca queda un pago con un monto distinto del
// total de su matrícula al confirmar. Sin `40P01` ni 500. Pruebas deterministas: la prueba retiene la fila de la matrícula con su propia transacción, envía las dos
// peticiones una detrás de otra (cada una cuando la anterior ya quedó esperando), comprueba con `pg_blocking_pids` que esperan y recién entonces libera.

describe('criterio 12: ajuste y cobro a la vez sobre la misma solicitud', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    await abrirCajaDeHoy(e);
    cliente = await sembrarCobrable(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, montoMostrado = '42.00') =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro(montoMostrado), { cookie: cookies.secretaria });
  const ajustar = (c: SolicitudSembrada, monto = '35') =>
    ctx.http.post(rutaAjuste(c.solicitudId), cuerpoAjuste(monto), { cookie: cookies.admin });

  /** Retiene la fila de la matrícula: las dos peticiones llegan hasta ahí (después del actor, del DNI, del alumno y de la solicitud) y esperan. */
  const retenerMatricula =
    (c: SolicitudSembrada) =>
    async (retenedor: Retenedor): Promise<void> => {
      await retenedor.consultar('SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
        e.A.id,
        c.matriculaId,
      ]);
    };

  const sinErroresDelServidor = (respuestas: RespuestaApi[]) => {
    for (const respuesta of respuestas) {
      expect(respuesta.status, respuesta.texto).toBeLessThan(500);
      expect(codigoDeRespuesta(respuesta)).not.toBe('ERROR_INTERNO');
    }
  };

  /** Lo que ninguna carrera puede dejar: un pago con un monto distinto del total de su matrícula al confirmar, o más de un pago, movimiento o ajuste a la vez. */
  async function invariantes() {
    const pagos = await leerPagos(e.A.id);
    const [matricula] = await leerMatriculas(e.A.id);
    expect(pagos.length).toBeLessThanOrEqual(1);
    expect(await leerMovimientos(e.A.id)).toHaveLength(pagos.length);
    return { pago: pagos[0], matricula };
  }

  it('criterio 12: el cobro entra primero: 201 con el total de antes (S/ 42) y el ajuste responde 409 SOLICITUD_NO_AJUSTABLE; el pago es de S/ 42 y la matrícula queda sin ajuste', async () => {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerMatricula(cliente),
      enviar: [() => cobrar(cliente), () => ajustar(cliente)],
      enOrden: true,
      liberar: 'COMMIT',
    });

    expect(todasEsperaron, 'las dos peticiones debían quedar esperando la matrícula').toBe(true);
    const [cobro, ajuste] = resultados as [RespuestaApi, RespuestaApi];
    sinErroresDelServidor(resultados);
    expect(cobro.status, cobro.texto).toBe(201);
    expect([ajuste.status, codigoDeRespuesta(ajuste)], ajuste.texto).toEqual([409, 'SOLICITUD_NO_AJUSTABLE']);
    expect(detallesDeRespuesta(ajuste)).toEqual({ estado: 'CONFIRMADA' });
    const { pago, matricula } = await invariantes();
    expect(pago).toMatchObject({ estado: 'CONFIRMADO', monto: '42.00' });
    expect(matricula).toMatchObject({ monto_ajustado: null, motivo_ajuste: null });
    expect(await leerAuditoriaDeAcademia(e.A.id, 'MATRICULA_MONTO_AJUSTADO')).toHaveLength(0);
  });

  it('criterio 12: el ajuste entra primero: 200 y el cobro (que vio S/ 42) responde 409 MONTO_CAMBIO con el total nuevo (S/ 35); no queda ningún pago', async () => {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerMatricula(cliente),
      enviar: [() => ajustar(cliente), () => cobrar(cliente)],
      enOrden: true,
      liberar: 'COMMIT',
    });

    expect(todasEsperaron, 'las dos peticiones debían quedar esperando la matrícula').toBe(true);
    const [ajuste, cobro] = resultados as [RespuestaApi, RespuestaApi];
    sinErroresDelServidor(resultados);
    expect(ajuste.status, ajuste.texto).toBe(200);
    expect([cobro.status, codigoDeRespuesta(cobro)], cobro.texto).toEqual([409, 'MONTO_CAMBIO']);
    expect(detallesDeRespuesta(cobro)['total']).toBe('35.00');
    const { pago, matricula } = await invariantes();
    expect(pago).toBeUndefined();
    expect(matricula).toMatchObject({ monto_ajustado: '35.00' });
    expect(await leerMovimientos(e.A.id)).toHaveLength(0);
    expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_REGISTRADO')).toHaveLength(0);
  });

  it('criterio 12: el ajuste entra primero y quien cobra ya vio el total nuevo (S/ 35): el cobro se acepta con 35, no con 42', async () => {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerMatricula(cliente),
      enviar: [() => ajustar(cliente), () => cobrar(cliente, '35.00')],
      enOrden: true,
      liberar: 'COMMIT',
    });

    expect(todasEsperaron).toBe(true);
    const [ajuste, cobro] = resultados as [RespuestaApi, RespuestaApi];
    expect(ajuste.status, ajuste.texto).toBe(200);
    expect(cobro.status, cobro.texto).toBe(201);
    const { pago } = await invariantes();
    expect(pago).toMatchObject({ estado: 'CONFIRMADO', monto: '35.00' });
  });

  it('criterio 12: peticiones simultáneas sin orden prefijado, varias veces: cada ronda termina en uno de los dos modos, sin 40P01 ni 500, y el pago nunca difiere del total', async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const c = await sembrarCobrable(e);

      const [cobro, ajuste] = await Promise.all([cobrar(c), ajustar(c)]);

      sinErroresDelServidor([cobro, ajuste]);
      const modo = [cobro.status, codigoDeRespuesta(cobro), ajuste.status, codigoDeRespuesta(ajuste)];
      const cobroPrimero = [201, undefined, 409, 'SOLICITUD_NO_AJUSTABLE'];
      const ajustePrimero = [409, 'MONTO_CAMBIO', 200, undefined];
      expect(
        [cobroPrimero, ajustePrimero],
        `ronda ${ronda}: ${JSON.stringify(modo)} ${cobro.texto} ${ajuste.texto}`,
      ).toContainEqual(modo);
      const delPago = (await leerPagos(e.A.id)).find((p) => p.matricula_id === c.matriculaId);
      const matricula = (await leerMatriculas(e.A.id)).find((m) => m.id === c.matriculaId);
      if (cobro.status === 201) {
        expect(delPago?.monto).toBe('42.00');
        expect(matricula?.monto_ajustado).toBeNull();
      } else {
        expect(delPago).toBeUndefined();
        expect(matricula?.monto_ajustado).toBe('35.00');
      }
    }
  });
});
