// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_REABIERTA,
  AYER,
  type AppCaja,
  type CajaDePrueba,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoApertura,
  cuerpoReapertura,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  leerCajas,
  leerCierres,
  retenerUsuarios,
  rutaCaja,
} from '../../utilidades/caja';
import { conRetencion } from '../../utilidades/inscripciones';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 36 b (simultáneo) y criterio 35 (doble clic simultáneo) (crítico, RN-17, HU-27): una reapertura y una apertura simultáneas nunca dejan dos cajas
// abiertas: una responde 200 o 201 y la otra 409 (HAY_OTRA_CAJA_ABIERTA, CAJA_YA_ABIERTA, CAJA_PENDIENTE_DE_CIERRE o CAJA_DEL_DIA_CERRADA), nunca 500. Dos
// reaperturas de la misma caja a la vez dejan una sola auditoría. Deterministas: la prueba retiene las filas de los usuarios que piden (la primera sentencia de
// cada petición es `bloquearActorVigente`), comprueba con `pg_blocking_pids` que todas esperan y las suelta a la vez. Sin tiempos ni esperas fijas.

describe('reapertura: carreras (criterios 35 y 36)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cerradaDe = async (fecha: string): Promise<CajaDePrueba> => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, monto_inicial: '100.00' });
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(fecha, '18:00') });
    return caja;
  };
  const abiertas = async () => (await leerCajas(e.A.id)).filter((caja) => caja.estado === 'ABIERTA');

  it('criterio 36 b: una reapertura de la caja de ayer y una apertura de la de hoy a la vez: una responde 200 o 201 y la otra 409; nunca dos cajas abiertas ni 500', async () => {
    const deAyer = await cerradaDe(AYER);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerUsuarios(e.A.id, [e.adminA.id, e.secretariaA.id]),
      enviar: [
        async () => ({
          nombre: 'reapertura',
          r: await ctx.http.post(rutaCaja(deAyer.id, '/reapertura'), cookies.admin, cuerpoReapertura()),
        }),
        async () => ({
          nombre: 'apertura',
          r: await ctx.http.post('/api/cajas', cookies.secretaria, cuerpoApertura()),
        }),
      ],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron, 'la reapertura y la apertura no quedaron esperando la fila del actor').toBe(true);
    const texto = JSON.stringify(resultados.map(({ nombre, r }) => [nombre, r.status, codigoDe(r)]));
    const reapertura = resultados.find((x) => x.nombre === 'reapertura')?.r;
    const apertura = resultados.find((x) => x.nombre === 'apertura')?.r;
    const gano = [reapertura?.status === 200, apertura?.status === 201].filter(Boolean).length;
    expect(gano, `exactamente una gana: ${texto}`).toBe(1);
    if (reapertura?.status === 200) {
      expect(apertura?.status, texto).toBe(409);
      expect(['CAJA_PENDIENTE_DE_CIERRE', 'CAJA_YA_ABIERTA'], texto).toContain(codigoDe(apertura as never));
    } else {
      expect(reapertura?.status, texto).toBe(409);
      expect(codigoDe(reapertura as never), texto).toBe('HAY_OTRA_CAJA_ABIERTA');
    }
    expect(await abiertas(), `nunca dos cajas abiertas: ${texto}`).toHaveLength(1);
  });

  it('criterio 36 b: cuatro reaperturas y aperturas a la vez, con varias cajas cerradas: nunca más de una caja abierta ni 500', async () => {
    const c1 = await cerradaDe('2026-11-08');
    const c2 = await cerradaDe('2026-11-09');
    const c3 = await cerradaDe(AYER);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerUsuarios(e.A.id, [e.adminA.id, e.adminA2.id, e.secretariaA.id, e.secretariaA2.id]),
      enviar: [
        () => ctx.http.post(rutaCaja(c1.id, '/reapertura'), cookies.admin, cuerpoReapertura()),
        () => ctx.http.post(rutaCaja(c2.id, '/reapertura'), cookies.admin2, cuerpoReapertura()),
        () => ctx.http.post(rutaCaja(c3.id, '/reapertura'), cookies.admin, cuerpoReapertura()),
        () => ctx.http.post('/api/cajas', cookies.secretaria, cuerpoApertura()),
      ],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron).toBe(true);
    const texto = JSON.stringify(resultados.map((r) => [r.status, codigoDe(r)]));
    for (const respuesta of resultados) {
      expect([200, 201, 409], texto).toContain(respuesta.status);
      if (respuesta.status === 409) {
        expect(
          ['HAY_OTRA_CAJA_ABIERTA', 'CAJA_YA_ABIERTA', 'CAJA_PENDIENTE_DE_CIERRE', 'CAJA_DEL_DIA_CERRADA'],
          texto,
        ).toContain(codigoDe(respuesta));
      }
    }
    expect(
      resultados.filter((r) => r.status === 200 || r.status === 201),
      texto,
    ).toHaveLength(1);
    expect(await abiertas(), texto).toHaveLength(1);
  });

  it('criterio 36 b: dos reaperturas simultáneas de cajas distintas: una responde 200 y la otra 409 HAY_OTRA_CAJA_ABIERTA; una sola abierta', async () => {
    const c1 = await cerradaDe('2026-11-09');
    const c2 = await cerradaDe(AYER);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerUsuarios(e.A.id, [e.adminA.id, e.adminA2.id]),
      enviar: [
        () => ctx.http.post(rutaCaja(c1.id, '/reapertura'), cookies.admin, cuerpoReapertura()),
        () => ctx.http.post(rutaCaja(c2.id, '/reapertura'), cookies.admin2, cuerpoReapertura()),
      ],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron).toBe(true);
    expect(resultados.map((r) => r.status).sort(), JSON.stringify(resultados.map((r) => r.texto))).toEqual([200, 409]);
    expect(codigoDe(resultados.find((r) => r.status === 409) as never)).toBe('HAY_OTRA_CAJA_ABIERTA');
    expect(await abiertas()).toHaveLength(1);
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_REABIERTA)).toHaveLength(1);
    expect((await leerCierres(e.A.id)).filter((c) => c.reabierto_en !== null)).toHaveLength(1);
  });

  it('criterio 36 a: dos reaperturas simultáneas de la misma caja (doble clic) responden 200 las dos y dejan una sola auditoría y una sola reapertura', async () => {
    const cerrada = await cerradaDe(AYER);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerUsuarios(e.A.id, [e.adminA.id, e.adminA2.id]),
      enviar: [
        () => ctx.http.post(rutaCaja(cerrada.id, '/reapertura'), cookies.admin, cuerpoReapertura()),
        () => ctx.http.post(rutaCaja(cerrada.id, '/reapertura'), cookies.admin2, cuerpoReapertura()),
      ],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron).toBe(true);
    expect(
      resultados.map((r) => r.status),
      JSON.stringify(resultados.map((r) => r.texto)),
    ).toEqual([200, 200]);
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_REABIERTA)).toHaveLength(1);
    expect((await leerCierres(e.A.id)).filter((c) => c.reabierto_en !== null)).toHaveLength(1);
    expect(await abiertas()).toHaveLength(1);
  });
});
