// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AYER,
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
  type CajaHistorialApi,
  clavesDe,
  contratoDe,
  crearAppHistorial,
  type EsquemaPrueba,
  exigirRutasDeHistorial,
  idsDeLista,
  listaDe,
  reabrirCajaDePrueba,
} from '../../utilidades/caja-historial';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 40 y PQ4 (crítico, HU-27, sección 4.3): cada caja de la lista (`cajaHistorialSchema`, estricto) tiene exactamente: `id`, `fecha`, `estado`,
// `deOtroDia`, `montoInicial`, `abiertaPor` (`personaCajaSchema`, sin DNI), `totalIngresos` ({ efectivo, yape, transferencia }), `totalEgresos` ({ efectivo })
// y `ultimoCierre`. Las cajas salen por `fecha` descendente (una caja por día: no hay empates), sin paginación. Los totales son las sumas de todos los
// movimientos de la caja en este momento (como `resumen` del criterio 28), no la foto del último cierre. `ultimoCierre` es el cierre de mayor `numero`
// (vigente o reabierto) con exactamente { numero, montoDeclarado, diferencia, resultado, tardio, cerradoPor, cerradoEn }, o null si la caja nunca se cerró;
// una caja ABIERTA con `ultimoCierre` es una caja reabierta. `deOtroDia` es `esDeOtroDia(fecha, ahora)` sin mirar el estado: toda caja de un día anterior lo
// tiene en true, también las cerradas. Los montos sin signo, con dos decimales; la diferencia, con signo; `cerradoEn` en ISO. La respuesta pasa
// `respuestaHistorialCajasSchema`. (La lectura en una sola consulta SQL de PQ4 no se puede probar desde fuera sin enganches en la base: la revisan el revisor
// y el adversarial.)

const CLAVES_DE_CAJA = [
  'abiertaPor',
  'deOtroDia',
  'estado',
  'fecha',
  'id',
  'montoInicial',
  'totalEgresos',
  'totalIngresos',
  'ultimoCierre',
];
const CLAVES_DE_ULTIMO_CIERRE = [
  'cerradoEn',
  'cerradoPor',
  'diferencia',
  'montoDeclarado',
  'numero',
  'resultado',
  'tardio',
];

describe('cada caja de la lista (criterio 40, PQ4)', () => {
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

  const lista = (consulta = '?desde=2026-11-01&hasta=2026-11-11', cookie = cookies.admin) =>
    ctx.http.get(`/api/cajas${consulta}`, cookie);

  /** Ingresos de S/ 42.00 en efectivo, S/ 88.00 por Yape y S/ 120.00 por transferencia, y un egreso de S/ 15.50, con la caja abierta. */
  async function conMovimientos(cajaId: string, fecha = HOY): Promise<void> {
    const registrado_en = enLima(fecha, '09:30');
    await crearIngresoDePrueba(e.A.id, cajaId, e.adminA.id, alumno.id, { monto: '42.00', registrado_en });
    await crearIngresoDePrueba(e.A.id, cajaId, e.secretariaA.id, alumno.id, {
      monto: '88.00',
      metodo: 'YAPE',
      concepto: 'MENSUALIDAD',
      registrado_en,
    });
    await crearIngresoDePrueba(e.A.id, cajaId, e.secretariaA.id, alumno.id, {
      monto: '120.00',
      metodo: 'TRANSFERENCIA',
      concepto: 'CLASE_PARTICULAR',
      registrado_en,
    });
    await crearEgresoDePrueba(e.A.id, cajaId, e.secretariaA.id, { monto: '15.50', registrado_en });
  }

  const porFecha = (respuesta: { status: number; body: Record<string, unknown> | null }, fecha: string) => {
    const caja = listaDe(respuesta).cajas.find((c) => c.fecha === fecha);
    expect(caja, `no hay una caja del ${fecha} en ${JSON.stringify(respuesta.body)}`).toBeTruthy();
    return caja as CajaHistorialApi;
  };

  it('PQ4: la caja abierta de hoy con movimientos trae exactamente las claves del contrato, los totales por método y ultimoCierre null', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await conMovimientos(caja.id);

    const respuesta = await lista();

    expect(respuesta.status, respuesta.texto).toBe(200);
    const hoy = porFecha(respuesta, HOY);
    expect(clavesDe(hoy)).toEqual(CLAVES_DE_CAJA);
    expect(hoy).toEqual({
      id: caja.id,
      fecha: HOY,
      estado: 'ABIERTA',
      deOtroDia: false,
      montoInicial: '100.00',
      abiertaPor: { id: e.secretariaA.id, nombres: 'Lucia', apellidos: 'Benites' },
      totalIngresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
      totalEgresos: { efectivo: '15.50' },
      ultimoCierre: null,
    });
    expect(clavesDe(hoy.abiertaPor)).toEqual(['apellidos', 'id', 'nombres']);
    expect(clavesDe(hoy.totalIngresos)).toEqual(['efectivo', 'transferencia', 'yape']);
    expect(clavesDe(hoy.totalEgresos)).toEqual(['efectivo']);
  });

  it('PQ4: la respuesta nunca trae el DNI de quien abrió, de quien cerró ni del alumno, ni movimientos ni cierres completos', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    await conMovimientos(caja.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.adminA.id, { cerradoEn: enLima(HOY, '09:50') });

    const respuesta = await lista();

    expect(respuesta.status, respuesta.texto).toBe(200);
    for (const dni of [alumno.dni, e.secretariaA.dni, e.adminA.dni]) expect(respuesta.texto).not.toContain(dni);
    expect(respuesta.texto).not.toMatch(/"movimientos"|"cierres"|"resumen"|"registradoPor"|"alumno"/);
  });

  it('PQ4: cajas cerradas con su último cierre: forma exacta y valores (faltante, sobrante, cuadra y una reabierta con dos cierres)', async () => {
    const dias: [string, string][] = [
      ['2026-11-10', '120.00'],
      ['2026-11-09', '126.80'],
      ['2026-11-08', '126.50'],
    ];
    for (const [fecha, declarado] of dias) {
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, monto_inicial: '100.00' });
      await conMovimientos(caja.id, fecha);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
        montoDeclarado: declarado,
        cerradoEn: enLima(fecha, '18:00:00'),
        tardio: fecha === '2026-11-10',
      });
    }
    // 2026-11-07: dos cierres. El primero se reabrió; el último (el de mayor numero) es el que muestra la lista.
    const reabierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id, {
      fecha: '2026-11-07',
      monto_inicial: '100.00',
    });
    await cerrarCajaDePrueba(e.A.id, reabierta.id, e.secretariaA.id, {
      montoDeclarado: '90.00',
      cerradoEn: enLima('2026-11-07', '18:00:00'),
    });
    await reabrirCajaDePrueba(e.A.id, reabierta.id, 1, e.adminA.id, enLima('2026-11-07', '19:00:00'));
    await cerrarCajaDePrueba(e.A.id, reabierta.id, e.adminA.id, { cerradoEn: enLima('2026-11-07', '20:00:00') });

    const respuesta = await lista();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(listaDe(respuesta).cajas.map((c) => c.fecha)).toEqual([
      '2026-11-10',
      '2026-11-09',
      '2026-11-08',
      '2026-11-07',
    ]);
    const faltante = porFecha(respuesta, '2026-11-10');
    const sobrante = porFecha(respuesta, '2026-11-09');
    const cuadra = porFecha(respuesta, '2026-11-08');
    const dosCierres = porFecha(respuesta, '2026-11-07');
    for (const caja of [faltante, sobrante, cuadra, dosCierres]) {
      expect(clavesDe(caja), caja.fecha).toEqual(CLAVES_DE_CAJA);
      expect(caja.estado).toBe('CERRADA');
      expect(clavesDe(caja.ultimoCierre), caja.fecha).toEqual(CLAVES_DE_ULTIMO_CIERRE);
      expect(clavesDe(caja.ultimoCierre?.cerradoPor), caja.fecha).toEqual(['apellidos', 'id', 'nombres']);
    }
    expect(faltante.ultimoCierre).toMatchObject({
      numero: 1,
      montoDeclarado: '120.00',
      diferencia: '-6.50',
      resultado: 'FALTANTE',
      tardio: true,
      cerradoPor: { id: e.secretariaA.id, nombres: 'Lucia', apellidos: 'Benites' },
    });
    expect(Date.parse(faltante.ultimoCierre?.cerradoEn ?? '')).toBe(enLima('2026-11-10', '18:00:00').getTime());
    expect(sobrante.ultimoCierre).toMatchObject({
      numero: 1,
      montoDeclarado: '126.80',
      diferencia: '0.30',
      resultado: 'SOBRANTE',
      tardio: false,
    });
    expect(cuadra.ultimoCierre).toMatchObject({
      numero: 1,
      montoDeclarado: '126.50',
      diferencia: '0.00',
      resultado: 'CUADRA',
      tardio: false,
    });
    expect(dosCierres.ultimoCierre).toMatchObject({
      numero: 2,
      montoDeclarado: '100.00',
      diferencia: '0.00',
      resultado: 'CUADRA',
      cerradoPor: { id: e.adminA.id, nombres: 'Rosa', apellidos: 'Alvarez' },
    });
    expect(Date.parse(dosCierres.ultimoCierre?.cerradoEn ?? '')).toBe(enLima('2026-11-07', '20:00:00').getTime());
  });

  it('PQ4: los totales son la suma de todos los movimientos de ahora, no la foto del último cierre: una caja reabierta (ABIERTA con ultimoCierre) con un ingreso nuevo', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await conMovimientos(caja.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      montoDeclarado: '120.00',
      cerradoEn: enLima(HOY, '09:40'),
    });
    await reabrirCajaDePrueba(e.A.id, caja.id, 1, e.adminA.id, enLima(HOY, '09:45'));
    await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, {
      monto: '10.00',
      registrado_en: enLima(HOY, '09:46'),
    });
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      monto: '0.50',
      registrado_en: enLima(HOY, '09:47'),
    });

    const respuesta = await lista();

    const hoy = porFecha(respuesta, HOY);
    expect(hoy.estado).toBe('ABIERTA');
    expect(hoy.totalIngresos).toEqual({ efectivo: '52.00', yape: '88.00', transferencia: '120.00' });
    expect(hoy.totalEgresos).toEqual({ efectivo: '16.00' });
    expect(hoy.ultimoCierre).toMatchObject({
      numero: 1,
      montoDeclarado: '120.00',
      diferencia: '-6.50',
      resultado: 'FALTANTE',
    });
  });

  it('PQ4: deOtroDia no mira el estado: es true en toda caja de un día anterior (cerrada o abierta) y false en la de hoy', async () => {
    const cerradaDeAyer = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
    await cerrarCajaDePrueba(e.A.id, cerradaDeAyer.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '18:00') });
    const cerradaDeHoy = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { estado: 'CERRADA' });

    const respuesta = await lista();

    expect(porFecha(respuesta, AYER)).toMatchObject({ estado: 'CERRADA', deOtroDia: true });
    expect(porFecha(respuesta, HOY)).toMatchObject({ id: cerradaDeHoy.id, estado: 'CERRADA', deOtroDia: false });
  });

  it('PQ4: una caja abierta de otro día sin cerrar tiene deOtroDia true, estado ABIERTA y ultimoCierre null', async () => {
    const pendiente = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });

    const respuesta = await lista();

    expect(porFecha(respuesta, AYER)).toMatchObject({
      id: pendiente.id,
      estado: 'ABIERTA',
      deOtroDia: true,
      ultimoCierre: null,
    });
  });

  it('PQ4: una caja sin movimientos tiene los totales en "0.00" y el monto inicial con dos decimales', async () => {
    await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '0' });

    const respuesta = await lista();

    expect(porFecha(respuesta, HOY)).toMatchObject({
      montoInicial: '0.00',
      totalIngresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' },
      totalEgresos: { efectivo: '0.00' },
      ultimoCierre: null,
    });
  });

  it('PQ4: los totales suman en decimales exactos: 0.10 + 0.20 es "0.30" (sin coma flotante)', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '1.00' });
    for (const monto of ['0.10', '0.20']) {
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto });
    }
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, { monto: '0.01' });
    await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, { monto: '0.02' });

    const respuesta = await lista();

    const hoy = porFecha(respuesta, HOY);
    expect(hoy.totalIngresos.efectivo).toBe('0.30');
    expect(hoy.totalEgresos.efectivo).toBe('0.03');
  });

  it('PQ4: sin paginación: todas las cajas del rango, de la fecha más reciente a la más antigua, sin empates (35 días seguidos)', async () => {
    const ids: string[] = [];
    for (let dia = 1; dia <= 35; dia += 1) {
      const fecha =
        dia <= 31 ? `2026-10-${String(dia).padStart(2, '0')}` : `2026-11-${String(dia - 31).padStart(2, '0')}`;
      ids.push((await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, estado: 'CERRADA' })).id);
    }

    const respuesta = await lista('?desde=2026-10-01&hasta=2026-11-11');

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(idsDeLista(respuesta)).toEqual([...ids].reverse());
  });

  it('PQ4: la secretaria recibe la misma forma que el administrador', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    await conMovimientos(caja.id);

    const comoSecretaria = porFecha(await lista(undefined, cookies.secretaria), HOY);
    const comoAdmin = porFecha(await lista(undefined, cookies.admin), HOY);

    expect(comoSecretaria).toEqual(comoAdmin);
    expect(clavesDe(comoSecretaria)).toEqual(CLAVES_DE_CAJA);
  });

  it('PQ4 y criterio 40: la respuesta pasa respuestaHistorialCajasSchema (el contrato público)', async () => {
    const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
    await conMovimientos(caja.id, AYER);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
      montoDeclarado: '120.00',
      cerradoEn: enLima(AYER, '18:00'),
    });
    await crearCajaDePrueba(e.A.id, e.adminA.id);
    const esquema = contratoDe<EsquemaPrueba>('respuestaHistorialCajasSchema');

    const respuesta = await lista();

    expect(respuesta.status, respuesta.texto).toBe(200);
    const analisis = esquema.safeParse(respuesta.body);
    expect(analisis.success, JSON.stringify(analisis.error?.issues)).toBe(true);
    expect(idsDeLista(respuesta)).toHaveLength(2);
  });
});
