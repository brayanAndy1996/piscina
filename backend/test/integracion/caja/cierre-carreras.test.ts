// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codigoDeErrorDeBase } from '../../../src/infraestructura/prisma';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_CERRADA,
  ACCION_CAJA_EGRESO,
  type AppCaja,
  type CajaDePrueba,
  centimos,
  cobroImitado,
  codigoDe,
  codigoDeError,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoCierre,
  cuerpoEgreso,
  detallesDe,
  type EscenarioCaja,
  estadoDeError,
  exigirRutasDeCaja,
  ingresoDeEjemplo,
  leerCajas,
  leerCierres,
  leerMovimientos,
  montoTexto,
  retenerCaja,
  rutaCaja,
  totalesDeCaja,
} from '../../utilidades/caja';
import { conRetencion } from '../../utilidades/inscripciones';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 33 y criterio 34 (simultáneos) (crítico, RN-17: "una caja cerrada no admite movimientos"; "ningún cobro con la caja cerrada" de CLAUDE.md; regla de
// idempotencia). Pruebas deterministas, sin depender de tiempos (la espera se comprueba con `pg_blocking_pids`, que sale de `pg_locks`): la prueba retiene
// la fila de la caja (SELECT … FOR UPDATE) sin confirmar, envía las operaciones una tras otra (cada una cuando la anterior ya quedó esperando) y suelta.
//  a) el cierre primero: el cierre responde 200 y el egreso 409 CAJA_CERRADA, sin fila ni auditoría;
//  b) el egreso primero (con el `ultimoMovimientoVisto` de antes del egreso): el egreso responde 201 y el cierre 409 CAJA_CAMBIO, sin cierre ni auditoría;
//  c) lo mismo con `registrarIngresoEnCaja` (en una transacción que imita la 007) en lugar del egreso: si el cierre va primero, la interfaz lanza 409
//     SIN_CAJA_ABIERTA y la transacción completa del cobro se revierte; si el cobro va primero, el cierre responde CAJA_CAMBIO;
//  d) en ningún caso hay 500 ni 40P01; nunca queda un movimiento en una caja CERRADA ni con `numero` mayor que el `movimientosHasta` del cierre vigente; y el
//     esperado guardado en el cierre es igual a la suma de los movimientos con `numero` hasta `movimientosHasta`.
//  34. Dos cierres simultáneos de C con claves distintas: uno responde 200 y el otro 409 CAJA_CERRADA; queda un cierre vigente y un CAJA_CERRADA.

interface Resultado {
  nombre: string;
  status: number;
  codigo: string | undefined;
  sqlstate: string | null;
  detalles?: unknown;
}

describe('el cierre contra un movimiento y contra otro cierre (criterios 33 y 34)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let caja: CajaDePrueba;
  let alumnoId: string;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    alumnoId = (await crearAlumnoDeCaja(e.A.id)).id;
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const deHttp = (nombre: string, r: { status: number; body: Record<string, unknown> | null }): Resultado => ({
    nombre,
    status: r.status,
    codigo: codigoDe(r),
    sqlstate: null,
    detalles: detallesDe(r),
  });
  const cierre =
    (visto = 0, opciones: { clave?: string; cookie?: string; monto?: string } = {}) =>
    async () =>
      deHttp(
        'cierre',
        await ctx.http.post(
          rutaCaja(caja.id, '/cierre'),
          opciones.cookie ?? cookies.admin,
          cuerpoCierre({
            claveIdempotencia: opciones.clave ?? randomUUID(),
            montoDeclarado: opciones.monto ?? '100.00',
            ultimoMovimientoVisto: visto,
            observacion: 'Conteo de la prueba',
          }),
        ),
      );
  const egreso = () => async () =>
    deHttp(
      'egreso',
      await ctx.http.post(rutaCaja(caja.id, '/egresos'), cookies.secretaria, cuerpoEgreso({ monto: '10.00' })),
    );
  const MARCA = 'COBRO_IMITADO_DE_LA_CARRERA';
  const cobro = () => async (): Promise<Resultado> => {
    const resultado = await cobroImitado(await ctx.baseDatos(), {
      academiaId: e.A.id,
      actor: { id: e.secretariaA.id },
      ingreso: ingresoDeEjemplo(alumnoId, e.secretariaA.id),
      ahora: AHORA_PRUEBAS,
      marca: MARCA,
    });
    if (resultado.ok) return { nombre: 'cobro', status: 201, codigo: undefined, sqlstate: null };
    return {
      nombre: 'cobro',
      status: estadoDeError(resultado.error) ?? 500,
      codigo: codigoDeError(resultado.error),
      sqlstate: codigoDeErrorDeBase(resultado.error),
    };
  };

  /** (d) Lo que debe cumplirse al terminar, en cualquier orden en que hayan entrado. */
  async function comprobarCoherencia(resultados: Resultado[]): Promise<void> {
    const texto = JSON.stringify(resultados);
    for (const resultado of resultados) {
      expect(resultado.sqlstate, `interbloqueo en ${resultado.nombre}: ${texto}`).not.toBe('40P01');
      expect(resultado.status, `${resultado.nombre} respondió 500: ${texto}`).toBeLessThan(500);
    }
    const filas = await leerCajas(e.A.id);
    const movimientos = await leerMovimientos(e.A.id);
    const cierres = await leerCierres(e.A.id);
    const vigentes = cierres.filter((c) => c.reabierto_en === null);
    expect(vigentes.length, `cierres vigentes: ${texto}`).toBeLessThanOrEqual(1);
    if (filas[0]?.estado === 'CERRADA') {
      expect(vigentes, 'una caja CERRADA tiene un cierre vigente').toHaveLength(1);
      const vigente = vigentes[0];
      if (!vigente) return;
      const sobrantes = movimientos.filter((m) => m.numero > vigente.movimientos_hasta);
      expect(sobrantes, 'ningún movimiento con numero mayor que movimientosHasta').toEqual([]);
      const totales = await totalesDeCaja(e.A.id, caja.id, vigente.movimientos_hasta);
      expect(vigente.ingresos_efectivo).toBe(totales.ingresosEfectivo);
      expect(vigente.ingresos_yape).toBe(totales.ingresosYape);
      expect(vigente.ingresos_transferencia).toBe(totales.ingresosTransferencia);
      expect(vigente.egresos_efectivo).toBe(totales.egresosEfectivo);
      expect(
        vigente.esperado_efectivo,
        'el esperado guardado es la suma de los movimientos hasta movimientosHasta',
      ).toBe(
        montoTexto(
          centimos(vigente.monto_inicial) + centimos(totales.ingresosEfectivo) - centimos(totales.egresosEfectivo),
        ),
      );
    } else {
      expect(vigentes, 'una caja ABIERTA no tiene cierre vigente').toHaveLength(0);
    }
  }

  describe('a) el cierre primero, después un egreso', () => {
    it('criterio 33 a: la prueba retiene la caja; el cierre y después el egreso quedan esperando; al soltar, el cierre responde 200 y el egreso 409 CAJA_CERRADA, sin fila ni auditoría del egreso', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [cierre(0), egreso()],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'el cierre y el egreso no quedaron esperando la fila de la caja').toBe(true);
      expect(resultados.map((r) => [r.nombre, r.status, r.codigo])).toEqual([
        ['cierre', 200, undefined],
        ['egreso', 409, 'CAJA_CERRADA'],
      ]);
      expect(await leerMovimientos(e.A.id), 'ninguna fila del egreso').toHaveLength(0);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO), 'ninguna auditoría del egreso').toHaveLength(0);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_CERRADA)).toHaveLength(1);
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('CERRADA');
      await comprobarCoherencia(resultados);
    });
  });

  describe('b) el egreso primero, después el cierre', () => {
    it('criterio 33 b: el egreso responde 201 y el cierre (con el ultimoMovimientoVisto de antes) 409 CAJA_CAMBIO con { ultimoMovimiento: 1 }, sin cierre ni auditoría', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [egreso(), cierre(0)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'el egreso y el cierre no quedaron esperando la fila de la caja').toBe(true);
      expect(resultados.map((r) => [r.nombre, r.status, r.codigo])).toEqual([
        ['egreso', 201, undefined],
        ['cierre', 409, 'CAJA_CAMBIO'],
      ]);
      expect(resultados[1]?.detalles).toEqual({ ultimoMovimiento: 1 });
      expect(await leerCierres(e.A.id), 'ningún cierre').toHaveLength(0);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_CERRADA), 'ninguna auditoría del cierre').toHaveLength(
        0,
      );
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('ABIERTA');
      await comprobarCoherencia(resultados);
    });
  });

  describe('c) con registrarIngresoEnCaja en lugar del egreso', () => {
    it('criterio 33 c: el cierre primero: el cierre responde 200 y el cobro (la interfaz) lanza 409 SIN_CAJA_ABIERTA; la transacción completa del cobro se revierte', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [cierre(0), cobro()],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'el cierre y el cobro no quedaron esperando la fila de la caja').toBe(true);
      expect(resultados.map((r) => [r.nombre, r.status, r.codigo])).toEqual([
        ['cierre', 200, undefined],
        ['cobro', 409, 'SIN_CAJA_ABIERTA'],
      ]);
      expect(await leerMovimientos(e.A.id), 'ningún movimiento').toHaveLength(0);
      expect(
        await leerAuditoriaDeAcademia(e.A.id, MARCA),
        'la transacción completa del cobro se revirtió',
      ).toHaveLength(0);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_INGRESO_REGISTRADO')).toHaveLength(0);
      await comprobarCoherencia(resultados);
    });

    it('criterio 33 c: el cobro primero: el cobro se registra y el cierre (con el ultimoMovimientoVisto de antes) responde 409 CAJA_CAMBIO', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [cobro(), cierre(0)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'el cobro y el cierre no quedaron esperando la fila de la caja').toBe(true);
      expect(resultados.map((r) => [r.nombre, r.status, r.codigo])).toEqual([
        ['cobro', 201, undefined],
        ['cierre', 409, 'CAJA_CAMBIO'],
      ]);
      expect(resultados[1]?.detalles).toEqual({ ultimoMovimiento: 1 });
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, MARCA)).toHaveLength(1);
      expect(await leerCierres(e.A.id)).toHaveLength(0);
      await comprobarCoherencia(resultados);
    });
  });

  describe('d) muchas operaciones a la vez sobre la misma caja', () => {
    it('criterio 33 d: tres egresos, dos cobros y dos cierres a la vez: ninguna respuesta 500 ni 40P01, un solo cierre vigente como máximo y el esperado guardado es la suma de los movimientos que cubre', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [egreso(), cobro(), cierre(0), egreso(), cobro(), cierre(3, { cookie: cookies.secretaria }), egreso()],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'las siete operaciones no quedaron esperando la fila de la caja').toBe(true);
      const texto = JSON.stringify(resultados);
      for (const r of resultados.filter((x) => x.nombre === 'egreso')) {
        expect([201, 409], texto).toContain(r.status);
        if (r.status === 409) expect(r.codigo).toBe('CAJA_CERRADA');
      }
      for (const r of resultados.filter((x) => x.nombre === 'cobro')) {
        expect([201, 409], texto).toContain(r.status);
        if (r.status === 409) expect(r.codigo).toBe('SIN_CAJA_ABIERTA');
      }
      const cierres = resultados.filter((x) => x.nombre === 'cierre');
      expect(cierres.filter((r) => r.status === 200).length, texto).toBeLessThanOrEqual(1);
      for (const r of cierres.filter((x) => x.status !== 200)) {
        expect(r.status, texto).toBe(409);
        expect(['CAJA_CAMBIO', 'CAJA_CERRADA'], texto).toContain(r.codigo);
      }
      await comprobarCoherencia(resultados);
    });
  });

  describe('criterio 34: cierres simultáneos', () => {
    it('criterio 34: dos cierres simultáneos de la misma caja con claves distintas: uno responde 200 y el otro 409 CAJA_CERRADA; queda un cierre vigente y un CAJA_CERRADA', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [cierre(0, { cookie: cookies.secretaria }), cierre(0, { cookie: cookies.admin })],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados.map((r) => r.status).sort(), JSON.stringify(resultados)).toEqual([200, 409]);
      expect(resultados.find((r) => r.status === 409)?.codigo).toBe('CAJA_CERRADA');
      expect((await leerCierres(e.A.id)).filter((c) => c.reabierto_en === null)).toHaveLength(1);
      expect(await leerCierres(e.A.id)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_CERRADA)).toHaveLength(1);
      await comprobarCoherencia(resultados);
    });

    it('criterio 34: dos envíos simultáneos con la misma clave (doble clic) responden 200 los dos y dejan un solo cierre y una sola auditoría', async () => {
      const clave = randomUUID();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerCaja(e.A.id, caja.id),
        enviar: [cierre(0, { clave }), cierre(0, { clave })],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron).toBe(true);
      expect(
        resultados.map((r) => r.status),
        JSON.stringify(resultados),
      ).toEqual([200, 200]);
      expect(await leerCierres(e.A.id)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_CERRADA)).toHaveLength(1);
    });
  });
});
