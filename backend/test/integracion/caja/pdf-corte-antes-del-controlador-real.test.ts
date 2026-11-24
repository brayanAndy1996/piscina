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
import { esperarHasta, pausa } from '../../utilidades/caja-pdf-concurrencia';
import {
  conUsuariosBloqueada,
  descargarConHttp,
  type EspiaDeEscritura,
  espiarEscrituras,
  estadoDeLaCola,
  valoresDurante,
  vigilarConexiones,
} from '../../utilidades/caja-pdf-corte';
import { comoGeneradorDePrueba, EspiaDelGeneradorReal } from '../../utilidades/caja-pdf-senal';
import { observar } from '../../utilidades/planes-clases';
import { extraerTextoPdf, tieneFormaDePdf } from '../../utilidades/pdf';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 55 f, caso 4 (crítico, ronda adversarial 3 de la 006b; DT-15): con el generador real. Un cierre de una caja de A con 20 000 movimientos
// (creados como dueño, en una sola sentencia) y el espía del 51 e, que delega en `generarPdfCierre` con la misma señal:
//   - el ADMIN de A pide ese PDF y corta enseguida, 10 veces, como en el caso 2;
//   - además, una vez con la verificación retenida, como en el caso 1.
// Entonces el espía no recibe ninguna llamada, después `estado` es { enCurso: 0, enEspera: 0 } y una descarga del mismo ADMIN de un cierre pequeño
// responde 200. Los casos 1, 2, 3 y 5 están en `pdf-corte-antes-del-controlador.test.ts`.

const MOVIMIENTOS = 20_000;
const ENSEGUIDA_MS = 1000;
const ESPERA_MAXIMA_MS = 10_000;
const FECHA_DE_LA_CAJA_GRANDE = '2026-11-02';
const FECHA_DE_LA_CAJA_CHICA = '2026-11-03';
const COLA_VACIA = { enCurso: 0, enEspera: 0 };

describe('cortar antes del controlador con el generador real no arma ningún PDF (criterio 55 f, caso 4)', () => {
  const espiaDelGenerador = new EspiaDelGeneradorReal();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let espia: EspiaDeEscritura;
  let vigiaDeConexiones: ReturnType<typeof vigilarConexiones>;
  let lanzadas: Promise<unknown>[];

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, comoGeneradorDePrueba(espiaDelGenerador));
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    espiaDelGenerador.restablecer();
    lanzadas = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    espia = espiarEscrituras();
    vigiaDeConexiones = vigilarConexiones(ctx.app);
  });
  afterEach(async () => {
    // Si el generador real no se abortó (la prueba falló), se espera a que termine para que no siga armando un PDF durante la prueba siguiente.
    await Promise.race([Promise.allSettled(lanzadas), pausa(120_000)]);
    await espiaDelGenerador.esperarQueTerminen(120_000);
    vigiaDeConexiones.detener();
    espia.restaurar();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 55 f.4: con 20 000 movimientos, cortar 10 veces de inmediato y una vez con la verificación retenida no llama al generador real, la cola queda en {0,0} y una descarga de un cierre pequeño del mismo ADMIN responde 200', async () => {
    // Un cierre pequeño, para la descarga final (y para la primera carga de pdfkit y de la fuente, que no debe contar).
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
    espiaDelGenerador.restablecer();
    const antes = await fotoDeEscrituras([e.A.id, e.B.id]);

    // El ADMIN de A pide el PDF del cierre grande y corta enseguida, 10 veces, como en el caso 2.
    for (let i = 0; i < 10; i += 1) {
      const descarga = descargarConHttp(ctx.app, rutaPdf(grande.id, 1), cookies.admin, `corte-4-${i}`, {
        cortarAlEnviar: true,
      });
      lanzadas.push(descarga.resultado);
      await descarga.enviada;
    }
    await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);

    // Además, una vez con la verificación retenida, como en el caso 1.
    await conUsuariosBloqueada(async (bloqueo) => {
      const descarga = descargarConHttp(ctx.app, rutaPdf(grande.id, 1), cookies.admin, 'corte-4-verificacion');
      lanzadas.push(descarga.resultado);
      const esperando = await bloqueo.esperarVerificaciones(1, ESPERA_MAXIMA_MS);
      expect(
        esperando,
        'la verificación de la sesión del ADMIN de A debía quedar esperando el bloqueo',
      ).toBeGreaterThanOrEqual(1);
      descarga.cortar();
      const cerrado = await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);
      expect(cerrado, 'el servidor no registró el cierre de la conexión cortada').toBe(true);
      await bloqueo.soltar();
    });

    // El espía del generador real no recibe ninguna llamada; después, `estado` es {0,0}.
    const estados = await valoresDurante(ENSEGUIDA_MS, () => estadoDeLaCola(ctx.app));
    expect
      .soft(
        espiaDelGenerador.llamadas.length,
        `el generador real no recibe ninguna llamada (${espiaDelGenerador.resumen()})`,
      )
      .toBe(0);
    expect
      .soft(estados.at(-1), 'después de los cortes la cola está en { enCurso: 0, enEspera: 0 }')
      .toEqual(COLA_VACIA);
    expect.soft(espia.llamadasConPrefijo('corte-4-'), 'ninguna descarga cortada escribe en su respuesta').toEqual([]);

    // Una descarga del mismo ADMIN de un cierre pequeño responde 200.
    const pequena = observar(ctx.http.get(rutaPdf(chica.id, 1), cookies.admin));
    lanzadas.push(pequena.resultado);
    const respuesta = await esperarHasta(pequena.resultado, 60_000);
    expect(
      respuesta,
      'la descarga del cierre pequeño no respondió (la cola sigue ocupada por las cortadas)',
    ).toBeDefined();
    expect.soft(respuesta?.status, respuesta?.texto.slice(0, 300)).toBe(200);
    if (respuesta?.status === 200) {
      expect.soft(tieneFormaDePdf(respuesta.cuerpo)).toBe(true);
      expect.soft(extraerTextoPdf(respuesta.cuerpo).texto).toContain('Cierre 1');
    }

    // Sin efectos: no se escribe ni se audita y nadie queda idle in transaction.
    expect.soft(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
    expect.soft(await conexionesInactivasEnTransaccion()).toEqual([]);
  }, 300_000);
});
