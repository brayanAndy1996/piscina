// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_EGRESO,
  type AppCaja,
  type CajaDePrueba,
  cajaDe,
  codigoDe,
  cookiesDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoEgreso,
  detallesDe,
  type EscenarioCaja,
  exigirRutasDeCaja,
  leerMovimientos,
  movimientoDe,
  type RespuestaCaja,
  retenerCaja,
  rutaCaja,
} from '../../utilidades/caja';
import { conRetencion } from '../../utilidades/inscripciones';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 21 y 22, parte simultánea (crítico, PP8; sección 4.3, DR-4, regla de idempotencia de CLAUDE.md). Deterministas, sin tiempos ni esperas fijas: la
// prueba retiene la fila de la caja (SELECT … FOR UPDATE) con su propia transacción, envía los dos egresos uno tras otro (cada uno cuando el anterior ya quedó
// esperando, comprobado con `pg_blocking_pids`, que sale de `pg_locks`) y suelta.
//  21. Con S/ 50.00 de efectivo, dos egresos simultáneos de "30.00" con claves distintas: uno responde 201 y el otro 409 EFECTIVO_INSUFICIENTE; nunca quedan
//      los dos. Queda un solo movimiento y el esperado en efectivo es "20.00".
//  22. Dos envíos simultáneos con la misma clave y el mismo cuerpo: uno responde 201 y el otro 200 con el mismo movimiento; queda una sola fila y una sola
//      auditoría.

describe('egresos simultáneos (criterios 21 y 22)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let caja: CajaDePrueba;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '50.00' });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const egreso =
    (cuerpo: Record<string, unknown>, cookie = cookies.secretaria) =>
    () =>
      ctx.http.post(rutaCaja(caja.id, '/egresos'), cookie, cuerpo);
  const estados = (respuestas: RespuestaCaja[]) => respuestas.map((r) => r.status).sort((a, b) => a - b);

  it('criterio 21: dos egresos simultáneos de "30.00" con S/ 50.00 y claves distintas: uno responde 201 y el otro 409 EFECTIVO_INSUFICIENTE; queda un solo movimiento y el esperado es "20.00"', async () => {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerCaja(e.A.id, caja.id),
      enviar: [
        egreso(cuerpoEgreso({ monto: '30.00' }), cookies.secretaria),
        egreso(cuerpoEgreso({ monto: '30.00' }), cookies.admin),
      ],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(todasEsperaron, 'los dos egresos no quedaron esperando la fila de la caja').toBe(true);
    const texto = resultados.map((r) => r.texto).join(' | ');
    expect(estados(resultados), texto).toEqual([201, 409]);
    const rechazado = resultados.find((r) => r.status === 409) as RespuestaCaja;
    expect(codigoDe(rechazado)).toBe('EFECTIVO_INSUFICIENTE');
    expect(detallesDe(rechazado)).toEqual({ disponible: '20.00' });
    const aceptado = resultados.find((r) => r.status === 201) as RespuestaCaja;
    expect(cajaDe(aceptado).resumen.esperado.efectivo).toBe('20.00');
    const filas = await leerMovimientos(e.A.id);
    expect(filas, 'nunca quedan los dos egresos').toHaveLength(1);
    expect(filas[0]?.monto).toBe('30.00');
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO)).toHaveLength(1);
  });

  it('criterio 21: cuatro egresos simultáneos de "20.00" con S/ 50.00: dos responden 201, dos 409 EFECTIVO_INSUFICIENTE y el esperado queda en "10.00"', async () => {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerCaja(e.A.id, caja.id),
      enviar: [cookies.secretaria, cookies.secretaria2, cookies.admin, cookies.admin2].map((cookie) =>
        egreso(cuerpoEgreso({ monto: '20.00' }), cookie),
      ),
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(todasEsperaron).toBe(true);
    expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([201, 201, 409, 409]);
    for (const rechazado of resultados.filter((r) => r.status === 409)) {
      expect(codigoDe(rechazado)).toBe('EFECTIVO_INSUFICIENTE');
    }
    expect(await leerMovimientos(e.A.id)).toHaveLength(2);
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO)).toHaveLength(2);
  });

  it('criterio 22: dos envíos simultáneos con la misma clave y el mismo cuerpo: uno responde 201 y el otro 200 con el mismo movimiento; queda una sola fila y una sola auditoría', async () => {
    const cuerpo = cuerpoEgreso({ claveIdempotencia: randomUUID(), monto: '20', comprobante: 'Boleta 1' });

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerCaja(e.A.id, caja.id),
      enviar: [egreso(cuerpo, cookies.secretaria), egreso(cuerpo, cookies.secretaria)],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(todasEsperaron, 'los dos envíos no quedaron esperando la fila de la caja').toBe(true);
    const texto = resultados.map((r) => r.texto).join(' | ');
    expect(estados(resultados), texto).toEqual([200, 201]);
    const [primero, segundo] = resultados as [RespuestaCaja, RespuestaCaja];
    expect(movimientoDe(primero).id, 'el mismo movimiento').toBe(movimientoDe(segundo).id);
    const filas = await leerMovimientos(e.A.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      id: movimientoDe(primero).id,
      numero: 1,
      monto: '20.00',
      comprobante: 'Boleta 1',
    });
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO)).toHaveLength(1);
    expect(cajaDe(primero).resumen.esperado.efectivo).toBe('30.00');
    expect(cajaDe(segundo).resumen.esperado.efectivo).toBe('30.00');
  });

  it('criterio 22: dos envíos simultáneos con la misma clave de dos personas distintas también dejan una sola fila y una sola auditoría', async () => {
    const cuerpo = cuerpoEgreso({ claveIdempotencia: randomUUID(), monto: '20.00' });

    const { resultados } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerCaja(e.A.id, caja.id),
      enviar: [egreso(cuerpo, cookies.secretaria), egreso(cuerpo, cookies.admin)],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([200, 201]);
    expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO)).toHaveLength(1);
  });

  it('criterio 22: dos envíos simultáneos con la misma clave y datos distintos: uno responde 201 y el otro 409 CLAVE_YA_USADA; queda una sola fila', async () => {
    const clave = randomUUID();

    const { resultados } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerCaja(e.A.id, caja.id),
      enviar: [
        egreso(cuerpoEgreso({ claveIdempotencia: clave, monto: '20.00' })),
        egreso(cuerpoEgreso({ claveIdempotencia: clave, monto: '21.00' })),
      ],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
    expect(codigoDe(resultados.find((r) => r.status === 409) as RespuestaCaja)).toBe('CLAVE_YA_USADA');
    expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO)).toHaveLength(1);
  });
});
