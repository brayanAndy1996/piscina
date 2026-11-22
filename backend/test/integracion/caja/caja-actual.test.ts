// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AYER,
  type AppCaja,
  type CajaDePrueba,
  cajaDe,
  cerrarCajaDePrueba,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  filaCierreValida,
  HOY,
  insertarFilaCaja,
  instantaneaDeCaja,
  retenerCaja,
} from '../../utilidades/caja';
import { abrirRetenedor, conLimite } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 28 (crítico, HU-26, HU-27, DR-7): GET /api/cajas/actual responde 200 con { caja }: la caja ABIERTA de la academia (de hoy o de otro día, con
// `deOtroDia`); si no hay, la caja de hoy ya cerrada; si tampoco, null. La caja trae `resumen` (ingresos, egresos y esperado por método, como el
// criterio 25, y `ultimoMovimiento`: el mayor `numero`, o 0), `movimientos` ordenados por `numero` (cada uno con `alumno` como { id, nombres, apellidos } o
// null, nunca el DNI) y `cierres` ordenados por `numero`. No bloquea, no escribe y no audita. Con la caja abierta, el esperado en efectivo se muestra
// antes de declarar (DR-7, sin arqueo ciego). Los esquemas del contrato son estrictos: las pruebas comparan las claves exactas de cada objeto.

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

describe('criterio 28: la caja del día', () => {
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

  const actual = (cookie = cookies.secretaria) => ctx.http.get('/api/cajas/actual', cookie);

  it.each(['secretaria', 'admin'] as const)(
    'criterio 28: sin ninguna caja responde 200 con { caja: null } (%s)',
    async (rol) => {
      const respuesta = await actual(cookies[rol]);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(respuesta.body).toEqual({ caja: null });
    },
  );

  it('criterio 28: con la caja abierta de hoy la trae con su forma exacta, sus movimientos ordenados por numero, el alumno sin DNI y el resumen', async () => {
    const alumno = await crearAlumnoDeCaja(e.A.id, 'Ana María', 'Quispe Rojas');
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '42.00', metodo: 'EFECTIVO' });
    await crearIngresoDePrueba(e.A.id, caja.id, e.adminA.id, alumno.id, {
      monto: '88.00',
      metodo: 'YAPE',
      concepto: 'MENSUALIDAD',
    });
    await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, {
      monto: '120.00',
      metodo: 'TRANSFERENCIA',
      concepto: 'CLASE_PARTICULAR',
    });
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      monto: '15.50',
      descripcion: 'Compra de jabón',
      comprobante: 'Boleta 7',
    });

    const respuesta = await actual();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(Object.keys(respuesta.body ?? {})).toEqual(['caja']);
    const delDia = cajaDe(respuesta);
    expect(Object.keys(delDia).sort()).toEqual(CLAVES_DE_CAJA);
    expect(delDia).toMatchObject({
      id: caja.id,
      fecha: HOY,
      estado: 'ABIERTA',
      deOtroDia: false,
      montoInicial: '100.00',
      abiertaPor: { id: e.secretariaA.id, nombres: 'Lucia', apellidos: 'Benites' },
      cierres: [],
    });
    expect(Object.keys(delDia.abiertaPor).sort()).toEqual(['apellidos', 'id', 'nombres']);
    expect(delDia.resumen).toEqual({
      ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
      egresos: { efectivo: '15.50' },
      esperado: { efectivo: '126.50', yape: '88.00', transferencia: '120.00' },
      ultimoMovimiento: 4,
    });
    expect(delDia.movimientos.map((m) => m.numero)).toEqual([1, 2, 3, 4]);
    expect(delDia.movimientos.map((m) => [m.tipo, m.concepto, m.metodo, m.monto])).toEqual([
      ['INGRESO', 'INSCRIPCION', 'EFECTIVO', '42.00'],
      ['INGRESO', 'MENSUALIDAD', 'YAPE', '88.00'],
      ['INGRESO', 'CLASE_PARTICULAR', 'TRANSFERENCIA', '120.00'],
      ['EGRESO', 'EGRESO_MENOR', 'EFECTIVO', '15.50'],
    ]);
    for (const movimiento of delDia.movimientos) {
      expect(Object.keys(movimiento).sort()).toEqual(CLAVES_DE_MOVIMIENTO);
      expect(Object.keys(movimiento.registradoPor).sort()).toEqual(['apellidos', 'id', 'nombres']);
    }
    const [ingreso, , , egreso] = delDia.movimientos;
    expect(ingreso?.alumno).toEqual({ id: alumno.id, nombres: 'Ana María', apellidos: 'Quispe Rojas' });
    expect(ingreso?.descripcion).toBeNull();
    expect(ingreso?.registradoPor.id).toBe(e.secretariaA.id);
    expect(delDia.movimientos[1]?.registradoPor).toEqual({ id: e.adminA.id, nombres: 'Rosa', apellidos: 'Alvarez' });
    expect(egreso?.alumno).toBeNull();
    expect(egreso?.descripcion).toBe('Compra de jabón');
    expect(egreso?.comprobante).toBe('Boleta 7');
    expect(respuesta.texto, 'el DNI del alumno y el de quien registró nunca salen').not.toContain(alumno.dni);
    expect(respuesta.texto).not.toContain(e.secretariaA.dni);
    expect(respuesta.texto).not.toContain(e.adminA.dni);
  });

  it('criterio 28: con la caja abierta, el esperado en efectivo se muestra antes de declarar (DR-7) y sin movimientos es el monto inicial con ultimoMovimiento 0', async () => {
    await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '60.50' });

    const delDia = cajaDe(await actual());

    expect(delDia.resumen).toEqual({
      ingresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' },
      egresos: { efectivo: '0.00' },
      esperado: { efectivo: '60.50', yape: '0.00', transferencia: '0.00' },
      ultimoMovimiento: 0,
    });
    expect(delDia.movimientos).toEqual([]);
  });

  it('criterio 28: la caja abierta de otro día se trae con deOtroDia: true, también si hay una caja de hoy ya cerrada (gana la abierta)', async () => {
    const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
    await crearCajaDePrueba(e.A.id, e.secretariaA.id, { estado: 'CERRADA' });

    const delDia = cajaDe(await actual());

    expect(delDia).toMatchObject({ id: pendiente.id, fecha: AYER, estado: 'ABIERTA', deOtroDia: true });
  });

  it('criterio 28: sin caja abierta, trae la caja de hoy ya cerrada, con su cierre', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    const cierre = await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      montoDeclarado: '95.00',
      observacion: 'Faltaron cinco soles',
      cerradoEn: enLima(HOY, '09:30'),
    });

    const respuesta = await actual(cookies.admin);

    expect(respuesta.status, respuesta.texto).toBe(200);
    const delDia = cajaDe(respuesta);
    expect(delDia).toMatchObject({ id: caja.id, estado: 'CERRADA', deOtroDia: false, fecha: HOY });
    expect(delDia.cierres).toHaveLength(1);
    expect(Object.keys(delDia.cierres[0] ?? {}).sort()).toEqual(CLAVES_DE_CIERRE);
    expect(delDia.cierres[0]).toMatchObject({
      numero: 1,
      cerradoPor: { id: e.secretariaA.id, nombres: 'Lucia', apellidos: 'Benites' },
      montoInicial: '100.00',
      ingresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' },
      egresos: { efectivo: '0.00' },
      esperado: { efectivo: '100.00', yape: '0.00', transferencia: '0.00' },
      montoDeclarado: '95.00',
      diferencia: '-5.00',
      resultado: 'FALTANTE',
      observacion: 'Faltaron cinco soles',
      tardio: false,
      movimientosHasta: 0,
      reapertura: null,
    });
    expect(Date.parse(delDia.cierres[0]?.cerradoEn ?? '')).toBe(enLima(HOY, '09:30').getTime());
    expect(cierre.numero).toBe(1);
  });

  it('criterio 28: sin caja abierta ni caja de hoy (solo una cerrada de ayer) responde { caja: null }', async () => {
    const deAyer = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
    await cerrarCajaDePrueba(e.A.id, deAyer.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '18:00') });

    const respuesta = await actual();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.body).toEqual({ caja: null });
  });

  it('criterio 28: los cierres vienen ordenados por numero y los anteriores muestran su reapertura (quién, cuándo y el motivo)', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00', estado: 'CERRADA' });
    const sinMovimientos = {
      montoInicial: '100.00',
      ingresosEfectivo: '0.00',
      ingresosYape: '0.00',
      ingresosTransferencia: '0.00',
      egresosEfectivo: '0.00',
      montoDeclarado: '100.00',
    };
    // Se insertan fuera de orden: el orden de la respuesta es el del número, no el de la fila.
    await insertarFilaCaja(
      'propietario',
      'cierres_caja',
      e.A.id,
      filaCierreValida(caja.id, e.secretariaA.id, sinMovimientos, { numero: 2, cerrado_en: enLima(HOY, '14:00') }),
    );
    await insertarFilaCaja(
      'propietario',
      'cierres_caja',
      e.A.id,
      filaCierreValida(caja.id, e.secretariaA.id, sinMovimientos, {
        numero: 1,
        cerrado_en: enLima(HOY, '12:00'),
        reabierto_por: e.adminA.id,
        reabierto_en: enLima(HOY, '13:00'),
        motivo_reapertura: 'Reapertura de las 13:00',
      }),
    );

    const delDia = cajaDe(await actual());

    expect(delDia.estado).toBe('CERRADA');
    expect(delDia.cierres.map((c) => c.numero)).toEqual([1, 2]);
    expect(delDia.cierres[0]?.reapertura).toMatchObject({
      reabiertaPor: { id: e.adminA.id, nombres: 'Rosa', apellidos: 'Alvarez' },
      motivo: 'Reapertura de las 13:00',
    });
    expect(Date.parse(delDia.cierres[0]?.reapertura?.reabiertaEn ?? '')).toBe(enLima(HOY, '13:00').getTime());
    expect(delDia.cierres[1]?.reapertura).toBeNull();
  });

  it('criterio 28: una caja de B nunca se trae en A y la de A nunca en B, aunque las dos sean de hoy', async () => {
    const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '11.00' });
    const deB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { monto_inicial: '22.00' });

    const a = cajaDe(await actual(cookies.admin));
    const b = cajaDe(await actual(cookies.adminB));

    expect(a.id).toBe(deA.id);
    expect(b.id).toBe(deB.id);
    expect(a.montoInicial).toBe('11.00');
    expect(b.montoInicial).toBe('22.00');
  });

  it('criterio 28: no escribe ni audita: dos lecturas seguidas dejan las tres tablas y la auditoría como estaban', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id);
    const antes = {
      filas: await instantaneaDeCaja(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };

    await actual();
    await actual(cookies.admin);

    expect(await instantaneaDeCaja(e.A.id)).toBe(antes.filas);
    expect(JSON.stringify(await leerAuditoriaDeAcademia(e.A.id))).toBe(antes.auditoria);
  });

  it('criterio 28: no bloquea: mientras la prueba retiene la fila de la caja con FOR UPDATE, la lectura responde sin esperar', async () => {
    const caja: CajaDePrueba = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    const retenedor = await abrirRetenedor(e.A.id);
    try {
      await retenerCaja(e.A.id, caja.id)(retenedor);

      const respuesta = await conLimite(
        actual(),
        'GET /api/cajas/actual esperó el bloqueo de la caja (debe leer sin bloquear)',
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(cajaDe(respuesta).id).toBe(caja.id);
    } finally {
      await retenedor.liberar('ROLLBACK');
    }
  });
});
