// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AYER,
  type CajaApi,
  cajaDe,
  cerrarCajaDePrueba,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  HOY,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  clavesDe,
  contratoDe,
  crearAppHistorial,
  type EsquemaPrueba,
  exigirRutasDeHistorial,
  reabrirCajaDePrueba,
} from '../../utilidades/caja-historial';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 41 y PQ5 (crítico, HU-27: "el administrador puede ver … un cierre"; D-23): GET /api/cajas/{id} responde 200 con { caja } armado con la misma
// función de lectura que GET /api/cajas/actual: para la caja que devuelve /actual, las dos respuestas son iguales (se comparan enteras con el reloj fijo).
// Trae todos los movimientos de la caja por `numero` (también los posteriores al último cierre, si se reabrió) y todos los cierres por `numero`
// ascendente, cada uno con `reapertura` o null; el vigente es el último y solo si la caja está CERRADA. El 404 de una caja de otra academia, de un id que no
// existe o que no es UUID, y de una caja fuera del alcance de la secretaria lo prueba historial-alcance.test.ts.

const CLAVES_DE_CAJA = [
  'abiertaEn',
  'abiertaPor',
  'cierres',
  'deOtroDia',
  'estado',
  'fecha',
  'id',
  'montoInicial',
  'movimientos',
  'resumen',
];
const CLAVES_DE_MOVIMIENTO = [
  'alumno',
  'comprobante',
  'concepto',
  'descripcion',
  'id',
  'metodo',
  'monto',
  'numero',
  'registradoEn',
  'registradoPor',
  'tipo',
];
const CLAVES_DE_CIERRE = [
  'cerradoEn',
  'cerradoPor',
  'diferencia',
  'egresos',
  'esperado',
  'ingresos',
  'montoDeclarado',
  'montoInicial',
  'movimientosHasta',
  'numero',
  'observacion',
  'reapertura',
  'resultado',
  'tardio',
];

describe('el detalle de una caja (criterio 41, PQ5)', () => {
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let alumno: { id: string; nombres: string; apellidos: string; dni: string };

  beforeAll(async () => {
    ctx = await crearAppHistorial();
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    alumno = await crearAlumnoDeCaja(e.A.id, 'Ana María', 'Quispe Rojas');
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const detalle = (id: string, cookie = cookies.admin) => ctx.http.get(`/api/cajas/${id}`, cookie);
  const actual = (cookie = cookies.admin) => ctx.http.get('/api/cajas/actual', cookie);

  async function conMovimientos(cajaId: string, fecha = HOY): Promise<void> {
    const registrado_en = enLima(fecha, '09:30');
    await crearIngresoDePrueba(e.A.id, cajaId, e.adminA.id, alumno.id, { monto: '42.00', registrado_en });
    await crearIngresoDePrueba(e.A.id, cajaId, e.secretariaA.id, alumno.id, {
      monto: '88.00',
      metodo: 'YAPE',
      concepto: 'MENSUALIDAD',
      registrado_en,
    });
    await crearEgresoDePrueba(e.A.id, cajaId, e.secretariaA.id, {
      monto: '15.50',
      descripcion: 'Compra de jabón',
      comprobante: 'Boleta 7',
      registrado_en,
    });
  }

  it('PQ5: para la caja abierta de hoy, el detalle y /actual son la misma respuesta, entera (con el administrador y con la secretaria)', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await conMovimientos(caja.id);

    for (const cookie of [cookies.admin, cookies.secretaria]) {
      const delDetalle = await detalle(caja.id, cookie);
      const delDia = await actual(cookie);

      expect(delDetalle.status, delDetalle.texto).toBe(200);
      expect(delDetalle.cacheControl).toBe('no-store');
      expect(Object.keys(delDetalle.body ?? {})).toEqual(['caja']);
      expect(delDetalle.body).toEqual(delDia.body);
      expect(cajaDe(delDetalle).id).toBe(caja.id);
    }
  });

  it('PQ5: para la caja de hoy ya cerrada, que es la que devuelve /actual, las dos respuestas son iguales', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await conMovimientos(caja.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      montoDeclarado: '110.00',
      observacion: 'Faltaron cinco soles',
      cerradoEn: enLima(HOY, '09:50'),
    });

    const delDetalle = await detalle(caja.id);
    const delDia = await actual();

    expect(delDetalle.status, delDetalle.texto).toBe(200);
    expect(delDetalle.body).toEqual(delDia.body);
    expect(cajaDe(delDetalle)).toMatchObject({ estado: 'CERRADA', cierres: [{ numero: 1, resultado: 'FALTANTE' }] });
  });

  it('PQ5: la caja abierta de otro día es la misma que devuelve /actual (deOtroDia true)', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
    await conMovimientos(caja.id, AYER);

    const delDetalle = await detalle(caja.id);

    expect(delDetalle.status, delDetalle.texto).toBe(200);
    expect(delDetalle.body).toEqual((await actual()).body);
    expect(cajaDe(delDetalle)).toMatchObject({ estado: 'ABIERTA', deOtroDia: true, fecha: AYER });
  });

  it('PQ5: una caja cerrada de un día anterior (que /actual ya no trae) se ve igual, con deOtroDia true y todos sus movimientos y su cierre', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER, monto_inicial: '100.00' });
    await conMovimientos(caja.id, AYER);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '18:00') });

    const respuesta = await detalle(caja.id);

    expect((await actual()).body).toEqual({ caja: null });
    expect(respuesta.status, respuesta.texto).toBe(200);
    const delDia = cajaDe(respuesta);
    expect(delDia).toMatchObject({ id: caja.id, fecha: AYER, estado: 'CERRADA', deOtroDia: true });
    expect(delDia.movimientos.map((m) => m.numero)).toEqual([1, 2, 3]);
    expect(delDia.cierres.map((c) => c.numero)).toEqual([1]);
    expect(delDia.cierres[0]).toMatchObject({
      movimientosHasta: 3,
      montoInicial: '100.00',
      ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '0.00' },
      egresos: { efectivo: '15.50' },
      esperado: { efectivo: '126.50', yape: '88.00', transferencia: '0.00' },
      reapertura: null,
    });
  });

  it('PQ5: una caja reabierta trae todos sus movimientos (también los posteriores al último cierre), su cierre con la reapertura (quién, cuándo y el motivo) y el estado ABIERTA', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await conMovimientos(caja.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(HOY, '09:40') });
    await reabrirCajaDePrueba(e.A.id, caja.id, 1, e.adminA.id, enLima(HOY, '09:45'), 'Falto contar un sobre');
    await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, {
      monto: '10.00',
      registrado_en: enLima(HOY, '09:46'),
    });

    const respuesta = await detalle(caja.id);

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.body).toEqual((await actual()).body);
    const delDia = cajaDe(respuesta);
    expect(delDia.estado).toBe('ABIERTA');
    expect(delDia.movimientos.map((m) => m.numero)).toEqual([1, 2, 3, 4]);
    expect(delDia.movimientos[3]?.monto).toBe('10.00');
    expect(delDia.cierres).toHaveLength(1);
    expect(delDia.cierres[0]).toMatchObject({ numero: 1, movimientosHasta: 3 });
    expect(delDia.cierres[0]?.reapertura).toMatchObject({
      reabiertaPor: { id: e.adminA.id, nombres: 'Rosa', apellidos: 'Alvarez' },
      motivo: 'Falto contar un sobre',
    });
    expect(clavesDe(delDia.cierres[0]?.reapertura)).toEqual(['motivo', 'reabiertaEn', 'reabiertaPor']);
    expect(Date.parse(delDia.cierres[0]?.reapertura?.reabiertaEn ?? '')).toBe(enLima(HOY, '09:45').getTime());
    expect(delDia.resumen.ultimoMovimiento).toBe(4);
    expect(delDia.resumen.esperado.efectivo).toBe('136.50');
  });

  it('PQ5: una caja reabierta dos veces trae los cierres 1, 2 y 3 en orden ascendente; los dos primeros con su reapertura y el vigente (el último, solo si la caja está CERRADA) con reapertura null', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER, monto_inicial: '100.00' });
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      montoDeclarado: '90.00',
      cerradoEn: enLima(AYER, '18:00'),
    });
    await reabrirCajaDePrueba(e.A.id, caja.id, 1, e.adminA.id, enLima(AYER, '19:00'), 'Primera reapertura');
    await cerrarCajaDePrueba(e.A.id, caja.id, e.adminA.id, {
      montoDeclarado: '95.00',
      cerradoEn: enLima(AYER, '20:00'),
    });
    await reabrirCajaDePrueba(e.A.id, caja.id, 2, e.adminA2.id, enLima(AYER, '21:00'), 'Segunda reapertura');

    const abierta = cajaDe(await detalle(caja.id));
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '22:00') });
    const cerrada = cajaDe(await detalle(caja.id));

    expect(abierta.estado).toBe('ABIERTA');
    expect(abierta.cierres.map((c) => c.numero)).toEqual([1, 2]);
    expect(
      abierta.cierres.every((c) => c.reapertura !== null),
      'con la caja abierta no queda ningún cierre vigente',
    ).toBe(true);
    expect(cerrada.estado).toBe('CERRADA');
    expect(cerrada.cierres.map((c) => c.numero)).toEqual([1, 2, 3]);
    expect(cerrada.cierres.map((c) => c.reapertura?.motivo ?? null)).toEqual([
      'Primera reapertura',
      'Segunda reapertura',
      null,
    ]);
    expect(cerrada.cierres[1]?.reapertura?.reabiertaPor).toEqual({
      id: e.adminA2.id,
      nombres: 'Pedro',
      apellidos: 'Ibarra',
    });
    expect(cerrada.cierres.map((c) => c.resultado)).toEqual(['FALTANTE', 'FALTANTE', 'CUADRA']);
  });

  it('PQ5: la forma es exactamente la de cajaSchema (claves de la caja, de cada movimiento y de cada cierre) y pasa respuestaCajaSchema', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await conMovimientos(caja.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(HOY, '09:50') });
    const esquema = contratoDe<EsquemaPrueba>('respuestaCajaSchema');

    const respuesta = await detalle(caja.id);

    expect(respuesta.status, respuesta.texto).toBe(200);
    const delDia: CajaApi = cajaDe(respuesta);
    expect(clavesDe(delDia)).toEqual(CLAVES_DE_CAJA);
    for (const movimiento of delDia.movimientos) expect(clavesDe(movimiento)).toEqual(CLAVES_DE_MOVIMIENTO);
    for (const cierre of delDia.cierres) expect(clavesDe(cierre)).toEqual(CLAVES_DE_CIERRE);
    const analisis = esquema.safeParse(respuesta.body);
    expect(analisis.success, JSON.stringify(analisis.error?.issues)).toBe(true);
  });

  it('PQ5: los alumnos salen como { id, nombres, apellidos } y nunca con DNI; tampoco el DNI de quien registró, abrió o cerró', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    await conMovimientos(caja.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.adminA2.id, { cerradoEn: enLima(HOY, '09:50') });

    const respuesta = await detalle(caja.id);

    const delDia = cajaDe(respuesta);
    expect(delDia.movimientos[0]?.alumno).toEqual({ id: alumno.id, nombres: 'Ana María', apellidos: 'Quispe Rojas' });
    expect(delDia.movimientos[2]?.alumno).toBeNull();
    for (const dni of [alumno.dni, e.secretariaA.dni, e.adminA.dni, e.adminA2.dni]) {
      expect(respuesta.texto).not.toContain(dni);
    }
  });

  it('PQ1: un UUID en mayúsculas es la misma caja: la misma respuesta que en minúsculas', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    await conMovimientos(caja.id);

    const enMinusculas = await detalle(caja.id);
    const enMayusculas = await detalle(caja.id.toUpperCase());

    expect(enMayusculas.status, enMayusculas.texto).toBe(200);
    expect(enMayusculas.body).toEqual(enMinusculas.body);
  });

  it('PQ1: GET /api/cajas/actual sigue siendo la caja del día y no se lee como el detalle de una caja con id "actual"', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);

    const respuesta = await actual(cookies.secretaria);

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(cajaDe(respuesta).id).toBe(caja.id);
  });
});
