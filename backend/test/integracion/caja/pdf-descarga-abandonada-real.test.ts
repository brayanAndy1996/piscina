// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cerrarCajaDePrueba,
  cookiesDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  enLima,
  type EscenarioCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  conexionesInactivasEnTransaccion,
  crearAppHistorial,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { crearMovimientosMasivos, fotoDeEscrituras } from '../../utilidades/caja-pdf-academias';
import { pausa } from '../../utilidades/caja-pdf-concurrencia';
import {
  comoGeneradorDePrueba,
  descargaCortable,
  EspiaDelGeneradorReal,
  esErrorDeAborto,
  esperarCondicion,
} from '../../utilidades/caja-pdf-senal';
import { conLimite, observar } from '../../utilidades/planes-clases';
import { extraerTextoPdf, tieneFormaDePdf } from '../../utilidades/pdf';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 51 b y e (crítico, ronda adversarial 2 de la 006b; DT-10): "Generando, con el generador real" y un cierre de una caja de A con 20 000
// movimientos (creados como dueño, en una sola sentencia).
//   - El generador es un espía que delega en `generarPdfCierre` con la misma señal y anota cómo terminó cada llamada.
//   - El ADMIN de A lanza dos descargas. Cuando las dos están en el generador y pasaron 300 ms, la prueba corta las dos.
//   - Enseguida (a más tardar 1 000 ms después), las dos llamadas terminaron rechazadas con `AbortError`, no resueltas.
//   - Después, una descarga del mismo ADMIN de un cierre pequeño responde 200.
// El generador real comprueba la señal al empezar y entre tramos: si está activa, deja de dibujar, no termina el documento y rechaza con un error
// cuyo `name` es `'AbortError'` (criterio 51 b y c).

const MOVIMIENTOS = 20_000;
const ENSEGUIDA_MS = 1000;
const FECHA_DE_LA_CAJA_GRANDE = '2026-11-02';
const FECHA_DE_LA_CAJA_CHICA = '2026-11-03';

describe('cortar una descarga mientras el generador real la arma aborta la generación (criterio 51 b)', () => {
  const espia = new EspiaDelGeneradorReal();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let lanzadas: Promise<unknown>[];

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, comoGeneradorDePrueba(espia));
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    espia.restablecer();
    lanzadas = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
  });
  afterEach(async () => {
    // Si la generación no se abortó (la prueba falló), se espera a que termine para que no siga armando un PDF durante la prueba siguiente.
    await Promise.race([Promise.allSettled(lanzadas), pausa(120_000)]);
    await espia.esperarQueTerminen(120_000);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 51 b: con 20 000 movimientos, cortar las dos descargas del ADMIN de A aborta las dos llamadas al generador real con AbortError (no terminan resueltas) y después una descarga de un cierre pequeño responde 200', async () => {
    // Un cierre pequeño, para la descarga final (y para la primera carga de pdfkit y de la fuente, que no debe contar en la medición).
    const chica = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: FECHA_DE_LA_CAJA_CHICA });
    await crearEgresoDePrueba(e.A.id, chica.id, e.secretariaA.id, {
      monto: '10.00',
      registrado_en: enLima(FECHA_DE_LA_CAJA_CHICA, '10:00'),
    });
    await cerrarCajaDePrueba(e.A.id, chica.id, e.secretariaA.id, {
      montoDeclarado: '90.00',
      cerradoEn: enLima(FECHA_DE_LA_CAJA_CHICA, '18:00:00'),
    });
    // La caja grande: la abrió la SECRETARIA de A, tiene 20 000 movimientos (en una sola sentencia) y el ADMIN de A la cerró.
    const grande = await crearCajaDePrueba(e.A.id, e.secretariaA.id, {
      fecha: FECHA_DE_LA_CAJA_GRANDE,
      monto_inicial: '100000.00',
    });
    await crearMovimientosMasivos(e.A.id, grande.id, e.secretariaA.id, MOVIMIENTOS, FECHA_DE_LA_CAJA_GRANDE);
    const cierre = await cerrarCajaDePrueba(e.A.id, grande.id, e.adminA.id, {
      cerradoEn: enLima(FECHA_DE_LA_CAJA_GRANDE, '18:00:00'),
    });
    expect(cierre.numero).toBe(1);

    // Preparación: la primera carga de pdfkit y de la fuente no cuenta.
    const calentamiento = await ctx.http.get(rutaPdf(chica.id, 1), cookies.admin);
    expect(calentamiento.status, calentamiento.texto.slice(0, 300)).toBe(200);
    espia.restablecer();
    const antes = await fotoDeEscrituras([e.A.id, e.B.id]);

    // El ADMIN de A lanza dos descargas del cierre grande. Cuando las dos están en el generador y pasaron 300 ms, la prueba corta las dos.
    const descargas = [
      descargaCortable(ctx.app, rutaPdf(grande.id, 1), cookies.admin),
      descargaCortable(ctx.app, rutaPdf(grande.id, 1), cookies.admin),
    ];
    for (const descarga of descargas) lanzadas.push(descarga.resultado);
    await conLimite(espia.esperarEnCurso(2), 'las dos descargas no llegaron al generador real');
    await pausa(300);
    expect(
      espia.llamadas.map((l) => l.estado),
      'a los 300 ms el generador real todavía arma los dos PDF (20 000 movimientos tardan mucho más que eso)',
    ).toEqual(['en-curso', 'en-curso']);
    const corte = Date.now();
    for (const descarga of descargas) descarga.cortar();

    // Enseguida, las dos llamadas terminaron rechazadas con AbortError, no resueltas.
    const terminaron = await esperarCondicion(() => espia.enCurso === 0, ENSEGUIDA_MS);
    const demora = Date.now() - corte;
    expect(
      terminaron,
      `${ENSEGUIDA_MS} ms después de cortar, el generador real sigue armando el PDF para nadie (${espia.resumen()})`,
    ).toBe(true);
    expect(
      espia.llamadas.map((l) => l.estado),
      `las dos llamadas deben terminar rechazadas, no resueltas (terminaron a los ${demora} ms de cortar)`,
    ).toEqual(['rechazada', 'rechazada']);
    for (const llamada of espia.llamadas) {
      expect(esErrorDeAborto(llamada.error), `la llamada ${llamada.indice} debe rechazarse con un AbortError`).toBe(
        true,
      );
      expect(llamada.senal, 'el servicio le pasó al generador la señal').toBeDefined();
      expect(llamada.senal?.aborted).toBe(true);
    }

    // Después, una descarga del mismo ADMIN de un cierre pequeño responde 200 (los lugares y los cupos quedaron libres).
    const pequena = observar(ctx.http.get(rutaPdf(chica.id, 1), cookies.admin));
    lanzadas.push(pequena.resultado);
    const respuesta = await conLimite(pequena.resultado, 'la descarga del cierre pequeño no respondió');
    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    expect(respuesta.headers.get('content-type')).toBe('application/pdf');
    expect(tieneFormaDePdf(respuesta.cuerpo)).toBe(true);
    expect(extraerTextoPdf(respuesta.cuerpo).texto).toContain('Cierre 1');

    // Sin efectos: no se escribe ni se audita y nadie queda idle in transaction.
    expect(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
    expect(await conexionesInactivasEnTransaccion()).toEqual([]);
  }, 180_000);
});
