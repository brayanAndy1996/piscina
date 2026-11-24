// spec: 006-caja (pruebas protegidas)
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_EGRESO,
  cerrarCajaDePrueba,
  cookiesDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  cuerpoEgreso,
  enLima,
  type EscenarioCaja,
  leerMovimientos,
  movimientoDe,
  rutaCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  crearAppHistorial,
  exigirRutasDeHistorial,
  type RespuestaHistorial,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { pausa } from '../../utilidades/caja-pdf-concurrencia';
import { extraerTextoPdf, tieneFormaDePdf } from '../../utilidades/pdf';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 49 a (crítico, ronda adversarial 1 de la 006b; amplía el criterio 43; D-23): el PDF de una caja con muchos movimientos no detiene la API
// de las demás academias. No hay tope de movimientos por caja (DT-7); se acota cuánto bloquea cada PDF.
//   Dado un cierre de una caja de A con 5 000 movimientos (`movimientosHasta: 5000`, creados como dueño de las tablas) y el generador real:
//   - preparación: una descarga del PDF de un cierre pequeño, para que la primera carga de `pdfkit` y de la fuente no cuente;
//   - medición: `monitorEventLoopDelay` (resolución de 10 ms) y tres descargas a la vez de ese cierre: dos del ADMIN de A y una de la SECRETARIA de A
//     que abrió la caja;
//   - 300 ms después, un egreso válido a la caja abierta de hoy de B con la sesión de una SECRETARIA de B.
//   Entonces: el egreso de B responde 201 en menos de 1 000 ms desde que se envió, con su fila y su auditoría; al menos una de las tres descargas
//   responde después que el egreso (si no se cruzan, la prueba falla en lugar de pasar sin medir); las tres responden 200 con el mismo cuerpo, un PDF
//   válido cuyo texto contiene los movimientos 1 y 5000; y el retraso máximo del bucle de eventos, desde que se lanzan las descargas hasta la última
//   respuesta, es como mucho 200 ms.

/** Una respuesta y el instante (`performance.now()`) en que llegó. */
interface Medida {
  respuesta: RespuestaHistorial;
  fin: number;
}

const MOVIMIENTOS = 5000;
const LIMITE_DEL_EGRESO_MS = 1000;
const LIMITE_DEL_BUCLE_MS = 200;
const ESPERA_ANTES_DEL_EGRESO_MS = 300;
const FECHA_DE_LA_CAJA_GRANDE = '2026-11-02';
const FECHA_DE_LA_CAJA_CHICA = '2026-11-03';

/** El texto con que cada movimiento `n` se identifica en el PDF: `Gasto 00001` … `Gasto 05000` (corto, para que no se parta en dos líneas). */
const descripcionDelMovimiento = (n: number) => `Gasto ${String(n).padStart(5, '0')}`;

/** Crea los 5 000 egresos de una caja abierta como dueño de las tablas, en una sola sentencia (sin un `INSERT` por fila). */
async function crearMovimientosEnUnaSentencia(
  academiaId: string,
  cajaId: string,
  registradoPor: string,
): Promise<void> {
  await ejecutarComo(
    'propietario',
    `INSERT INTO movimientos_caja (academia_id, caja_id, numero, tipo, concepto, metodo, monto, descripcion, comprobante,
                                   registrado_por, registrado_en, clave_idempotencia)
     SELECT $1::uuid, $2::uuid, n, 'EGRESO'::tipo_movimiento_caja, 'EGRESO_MENOR'::concepto_movimiento_caja, 'EFECTIVO'::metodo_pago,
            1.00, 'Gasto ' || lpad(n::text, 5, '0'), 'B001-' || lpad(n::text, 5, '0'), $3::uuid,
            $4::timestamptz + n * interval '1 second', gen_random_uuid()
       FROM generate_series(1, $5::int) AS n`,
    [academiaId, cajaId, registradoPor, enLima(FECHA_DE_LA_CAJA_GRANDE, '09:30'), MOVIMIENTOS],
    { academiaId },
  );
}

describe('el PDF de una caja con muchos movimientos no detiene la API (criterio 49 a)', () => {
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;

  beforeAll(async () => {
    // Sin reemplazar el generador: el generador real (PQ8) es el que se mide.
    ctx = await crearAppHistorial(AHORA_PRUEBAS);
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 49 a: tres descargas a la vez del PDF de un cierre de 5 000 movimientos no detienen el egreso de otra academia (201 en menos de 1 000 ms), se cruzan con él, dan los mismos bytes y el bucle no se retrasa más de 200 ms', async () => {
    // Un cierre pequeño, para la descarga de calentamiento.
    const chica = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: FECHA_DE_LA_CAJA_CHICA });
    await crearEgresoDePrueba(e.A.id, chica.id, e.secretariaA.id, {
      monto: '10.00',
      registrado_en: enLima(FECHA_DE_LA_CAJA_CHICA, '10:00'),
    });
    await cerrarCajaDePrueba(e.A.id, chica.id, e.secretariaA.id, {
      montoDeclarado: '90.00',
      cerradoEn: enLima(FECHA_DE_LA_CAJA_CHICA, '18:00:00'),
    });
    // La caja grande: la abrió la SECRETARIA de A, tiene 5 000 movimientos y el ADMIN de A la cerró.
    const grande = await crearCajaDePrueba(e.A.id, e.secretariaA.id, {
      fecha: FECHA_DE_LA_CAJA_GRANDE,
      monto_inicial: '10000.00',
    });
    await crearMovimientosEnUnaSentencia(e.A.id, grande.id, e.secretariaA.id);
    const cierre = await cerrarCajaDePrueba(e.A.id, grande.id, e.adminA.id, {
      cerradoEn: enLima(FECHA_DE_LA_CAJA_GRANDE, '18:00:00'),
    });
    expect(cierre.numero).toBe(1);
    expect((await leerMovimientos(e.A.id)).filter((m) => m.caja_id === grande.id)).toHaveLength(MOVIMIENTOS);
    // La caja abierta de hoy de B, donde la SECRETARIA de B registrará el egreso.
    const cajaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { monto_inicial: '100.00' });

    // Preparación: la primera carga de pdfkit y de la fuente (y del egreso) no cuenta.
    const calentamiento = await ctx.http.get(rutaPdf(chica.id, 1), cookies.admin);
    expect(calentamiento.status, calentamiento.texto.slice(0, 300)).toBe(200);
    const egresoDeCalentamiento = await ctx.http.enviar(
      'POST',
      rutaCaja(cajaB.id, '/egresos'),
      cookies.secretariaB,
      cuerpoEgreso({ monto: '1.00', descripcion: 'Egreso de calentamiento' }),
    );
    expect(egresoDeCalentamiento.status, egresoDeCalentamiento.texto).toBe(201);

    // Medición.
    const histograma = monitorEventLoopDelay({ resolution: 10 });
    histograma.enable();
    const medir = async (promesa: Promise<RespuestaHistorial>): Promise<Medida> => {
      const respuesta = await promesa;
      return { respuesta, fin: performance.now() };
    };
    const medidas = await (async () => {
      const descargas = [cookies.admin, cookies.admin, cookies.secretaria].map((cookie) =>
        medir(ctx.http.get(rutaPdf(grande.id, 1), cookie)),
      );
      await pausa(ESPERA_ANTES_DEL_EGRESO_MS);
      const envioDelEgreso = performance.now();
      const egreso = medir(
        ctx.http.enviar(
          'POST',
          rutaCaja(cajaB.id, '/egresos'),
          cookies.secretariaB,
          cuerpoEgreso({ monto: '10.00', descripcion: 'Compra de sencillo' }),
        ),
      );
      return { descargas: await Promise.all(descargas), egreso: await egreso, envioDelEgreso };
    })().finally(() => histograma.disable());
    const { descargas: resultadosDeDescargas, egreso: resultadoDelEgreso, envioDelEgreso } = medidas;
    const retrasoMaximoDelBucleMs = histograma.max / 1e6;
    const duracionDelEgresoMs = resultadoDelEgreso.fin - envioDelEgreso;
    const ultimaDescarga = Math.max(...resultadosDeDescargas.map((d) => d.fin));

    // Lo que no depende de la medición: respuestas correctas.
    expect(resultadoDelEgreso.respuesta.status, resultadoDelEgreso.respuesta.texto).toBe(201);
    for (const [i, { respuesta }] of resultadosDeDescargas.entries()) {
      expect(respuesta.status, `descarga ${i + 1}: ${respuesta.texto.slice(0, 300)}`).toBe(200);
      expect(respuesta.headers.get('content-type')).toBe('application/pdf');
    }

    // El egreso de B, con su fila y su auditoría.
    const egresoRegistrado = movimientoDe(resultadoDelEgreso.respuesta);
    expect(egresoRegistrado).toMatchObject({ tipo: 'EGRESO', monto: '10.00', descripcion: 'Compra de sencillo' });
    const filas = (await leerMovimientos(e.B.id)).filter((m) => m.descripcion === 'Compra de sencillo');
    expect(filas, 'el egreso de B tiene su fila').toHaveLength(1);
    expect(filas[0]?.caja_id).toBe(cajaB.id);
    const auditoria = await leerAuditoriaDeAcademia(e.B.id, ACCION_CAJA_EGRESO);
    expect(auditoria, 'el egreso de B tiene su auditoría (con el de calentamiento hay dos)').toHaveLength(2);

    // La medición: lo que el criterio 49 a acota.
    expect
      .soft(
        duracionDelEgresoMs,
        `el egreso de B tardó ${duracionDelEgresoMs.toFixed(0)} ms (máximo ${LIMITE_DEL_EGRESO_MS} ms) mientras se generaban los PDF de A`,
      )
      .toBeLessThan(LIMITE_DEL_EGRESO_MS);
    expect
      .soft(
        retrasoMaximoDelBucleMs,
        `el bucle de eventos se retrasó hasta ${retrasoMaximoDelBucleMs.toFixed(0)} ms (máximo ${LIMITE_DEL_BUCLE_MS} ms) mientras se generaban los PDF`,
      )
      .toBeLessThanOrEqual(LIMITE_DEL_BUCLE_MS);
    expect
      .soft(
        ultimaDescarga > resultadoDelEgreso.fin,
        'al menos una de las tres descargas debe responder después que el egreso: si no, la prueba no midió nada (las descargas y el egreso no se cruzaron)',
      )
      .toBe(true);

    // Las tres descargas dan lo mismo y es un PDF válido con los movimientos 1 y 5000.
    const [primera, ...demas] = resultadosDeDescargas.map((d) => d.respuesta.cuerpo);
    demas.forEach((otra, i) =>
      expect(otra.equals(primera as Buffer), `la descarga ${i + 2} difiere de la primera`).toBe(true),
    );
    expect(tieneFormaDePdf(primera as Buffer)).toBe(true);
    const { texto } = extraerTextoPdf(primera as Buffer);
    expect(texto, 'el PDF trae el movimiento 1').toContain(descripcionDelMovimiento(1));
    expect(texto, 'el PDF trae el movimiento 5000').toContain(descripcionDelMovimiento(MOVIMIENTOS));
  }, 120_000);
});
