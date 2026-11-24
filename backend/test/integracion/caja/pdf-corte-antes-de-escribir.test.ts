// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  codigoDe,
  cookiesDeCaja,
  crearEscenarioDeCaja,
  type EscenarioCaja,
  type CajaDePrueba,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  conexionesInactivasEnTransaccion,
  crearAppHistorial,
  dispositionDelPdf,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  PDF_FALSO,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { crearCajaDeHoyCerrada, fotoDeEscrituras } from '../../utilidades/caja-pdf-academias';
import { pausa } from '../../utilidades/caja-pdf-concurrencia';
import {
  type EspiaDeEscritura,
  espiarEscrituras,
  esperarEstadoDeLaCola,
  estadoDeLaCola,
  vigilarConexiones,
} from '../../utilidades/caja-pdf-corte';
import {
  descargarParaCortar,
  type EspiaDelFiltro,
  espiarFiltroGlobal,
  FORMAS_DE_CORTE,
  type FormaDeCorte,
  GeneradorDeterminista,
  type TerminaAlVerElSocket,
  vigilarSocketsMarcados,
  type VigiaDeSockets,
} from '../../utilidades/caja-pdf-corte-escritura';
import { comoGeneradorDePrueba } from '../../utilidades/caja-pdf-senal';
import { conLimite } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 55 g (crítico, ronda adversarial 4 de la 006b, falla F1; incumplía 55 d y 51 d; DT-18; D-23): la conexión se vuelve a mirar antes de escribir.
// La señal de la descarga se activa con el evento `close`, pero Node destruye el socket en la fase de lectura del bucle de eventos (al recibir el fin
// de la conexión o un RST) y emite `close` más tarde, en otra fase. Si la generación termina en medio, la señal todavía no está activa, y la descarga,
// que ya fue cortada, escribía el PDF sobre un socket destruido o dejaba subir el error al filtro global, que escribía un 500.
//   1. Se mira antes de escribir: justo antes del 200 y en el camino del error, con la definición de la conexión cerrada del 55 a.
//   2. Si está cerrada, la descarga cuenta como abandonada: no llama a `writeHead`, `write` ni `end`, y el error no llega al filtro global.
//   3. Si no está cerrada, todo sigue igual: el 200 con el PDF (PQ7) o el 500 `ERROR_INTERNO` de PQ9 b.
//   4. Pruebas de integración con la API escuchando en un puerto: un generador determinista que ignora la señal y, con `setImmediate` (fase "check",
//      antes de la fase de cierre en que llega `close`), termina en la misma vuelta en que ve el socket del servidor destruido. El cliente corta
//      con `destroy()` y con `resetAndDestroy()` (RST) cuando el generador ya recibió la llamada. La prueba con el generador real y muchos cortes
//      queda fuera de las protegidas (la repite el adversarial en la ronda 5).
// En todos los casos las filas de `cajas`, `movimientos_caja`, `cierres_caja` y `auditoria` no cambian y ninguna conexión del rol de la app queda
// `idle in transaction`.
//
// Si con alguna de las dos formas de corte un caso ya pasa con el código de `ea02809` (porque en esa forma `close` llega antes de que el generador vea
// el socket destruido), el tester lo anota: no es un error de la prueba.

/** "Enseguida" es, como en el 51 e, a más tardar 1 000 ms. */
const ENSEGUIDA_MS = 1000;
/** Lo que la prueba espera, como mucho, a que ocurra algo que sí debe ocurrir. */
const ESPERA_MAXIMA_MS = 10_000;
const COLA_VACIA = { enCurso: 0, enEspera: 0 };

describe('la conexión se vuelve a mirar antes de escribir (criterio 55 g)', () => {
  let sockets: VigiaDeSockets;
  const generador = new GeneradorDeterminista(() => sockets);
  let espiaDelFiltro: EspiaDelFiltro;
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** La caja de hoy de A, cerrada, abierta por la SECRETARIA S1. */
  let kA: CajaDePrueba;
  /** La caja de hoy de B, cerrada. */
  let kB: CajaDePrueba;
  let espia: EspiaDeEscritura;
  let vigiaDeConexiones: ReturnType<typeof vigilarConexiones>;
  /** Todas las descargas lanzadas por la prueba (también las cortadas), para esperarlas al final aunque la prueba falle. */
  let lanzadas: Promise<unknown>[];

  beforeAll(async () => {
    // El espía del filtro global se instala antes de crear la aplicación: Nest enlaza `catch` al registrar el filtro.
    espiaDelFiltro = espiarFiltroGlobal();
    ctx = await crearAppHistorial(AHORA_PRUEBAS, comoGeneradorDePrueba(generador));
    sockets = vigilarSocketsMarcados(ctx.app);
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    lanzadas = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    kA = await crearCajaDeHoyCerrada(e.A.id, e.secretariaA.id, e.adminA.id, '100.00');
    kB = await crearCajaDeHoyCerrada(e.B.id, e.secretariaB.id, e.adminB.id, '50.00');
    espia = espiarEscrituras();
    vigiaDeConexiones = vigilarConexiones(ctx.app);
  });
  afterEach(async () => {
    // Pase lo que pase en la prueba, ninguna descarga queda colgada.
    await Promise.race([Promise.allSettled(lanzadas), pausa(15_000)]);
    vigiaDeConexiones.detener();
    espia.restaurar();
  });
  afterAll(async () => {
    sockets?.detener();
    espiaDelFiltro?.restaurar();
    await ctx?.http.cerrar();
  });

  /** Sin efectos (55 g 4): no se escribe ni se audita, y ninguna conexión del rol de la app queda `idle in transaction`. */
  async function exigirSinEfectos(antes: Record<string, string>) {
    expect.soft(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
    expect.soft(await conexionesInactivasEnTransaccion(), 'ninguna conexión idle in transaction').toEqual([]);
  }

  /**
   * S1 pide el PDF de un cierre de A con `node:http` y la cabecera `x-prueba-corte`; cuando el generador ya recibió la llamada, la prueba corta de la
   * forma dada, y el generador (que ignora la señal) termina en la vuelta en que ve el socket destruido, como `termina`.
   */
  async function cortarAlGenerar(corte: string, forma: FormaDeCorte, termina: TerminaAlVerElSocket) {
    generador.armar(corte, termina);
    const descarga = descargarParaCortar(ctx.app, rutaPdf(kA.id, 1), cookies.secretaria, corte);
    lanzadas.push(descarga.resultado);
    const llego = await generador.esperarLlamadas(1, ESPERA_MAXIMA_MS);
    expect(llego, 'el generador debía recibir la llamada de la descarga antes del corte').toBe(true);

    descarga.cortar(forma);

    const termino = await generador.esperarQueTerminen(ESPERA_MAXIMA_MS);
    expect(termino, 'la llamada al generador debía terminar').toBe(true);
    generador.exigirQueVioElSocket();
    await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);
    return descarga;
  }

  /** Lo que vale tras cada corte (55 g 4, casos 1 y 2): nada escrito por la cortada, la cola vacía y el filtro global sin recibir el error. */
  async function exigirAbandonada(corte: string) {
    const salida = await esperarEstadoDeLaCola(ctx.app, COLA_VACIA, ENSEGUIDA_MS);
    expect
      .soft(
        salida.cumplido,
        `${ENSEGUIDA_MS} ms después del corte la cola debía estar en { enCurso: 0, enEspera: 0 } y está en ${JSON.stringify(salida.estado)}`,
      )
      .toBe(true);
    // Si la descarga escribiera algo, lo haría en este mismo paso: se deja pasar un instante para que cualquier escritura tardía quede anotada.
    await pausa(200);
    expect
      .soft(
        espia.llamadasDe(corte),
        'la descarga cortada no llama a writeHead, write ni end (ni el PDF ni un JSON de error)',
      )
      .toEqual([]);
    expect
      .soft(
        espiaDelFiltro.llamadasDe(corte),
        'el error de la descarga cortada no llega al filtro global (que escribiría un 500 ERROR_INTERNO)',
      )
      .toBe(0);
  }

  const casos = FORMAS_DE_CORTE.map((forma) => [forma] as const);

  describe('caso 1: el generador resuelve al ver el socket destruido', () => {
    it.each(casos)(
      'criterio 55 g.1 (corte con %s): la descarga cortada no escribe, el generador recibió exactamente esa llamada y la cola vuelve a { enCurso: 0, enEspera: 0 }',
      async (forma) => {
        const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
        const corte = `corte-g1-${forma}`;

        await cortarAlGenerar(corte, forma, 'resuelve');

        expect
          .soft(generador.llamadas, 'el generador recibió exactamente la llamada de la descarga cortada')
          .toHaveLength(1);
        await exigirAbandonada(corte);
        await exigirSinEfectos(antes);
      },
      60_000,
    );
  });

  describe('caso 2: el generador rechaza con un Error común al ver el socket destruido', () => {
    it.each(casos)(
      'criterio 55 g.2 (corte con %s): la descarga cortada no escribe, el error no llega al filtro global y la cola vuelve a { enCurso: 0, enEspera: 0 }',
      async (forma) => {
        const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
        const corte = `corte-g2-${forma}`;

        await cortarAlGenerar(corte, forma, 'rechaza');

        expect
          .soft(generador.llamadas, 'el generador recibió exactamente la llamada de la descarga cortada')
          .toHaveLength(1);
        await exigirAbandonada(corte);
        await exigirSinEfectos(antes);
      },
      60_000,
    );
  });

  describe('caso 3: después de cada corte, una descarga nueva de la misma persona responde 200', () => {
    const combinaciones = (['resuelve', 'rechaza'] as const).flatMap((termina) =>
      FORMAS_DE_CORTE.map((forma) => [termina, forma] as const),
    );
    it.each(combinaciones)(
      'criterio 55 g.3 (generador que %s, corte con %s): una descarga nueva de S1, sin cortar y con el generador en modo normal, responde 200 con el PDF',
      async (termina, forma) => {
        const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
        await cortarAlGenerar(`corte-g3-${termina}-${forma}`, forma, termina);
        await esperarEstadoDeLaCola(ctx.app, COLA_VACIA, ENSEGUIDA_MS);

        // El generador ya no está armado: vuelve al modo normal y resuelve enseguida.
        const nueva = await conLimite(
          ctx.http.get(rutaPdf(kA.id, 1), cookies.secretaria),
          'la descarga nueva no respondió',
        );
        expect.soft(nueva.status, nueva.texto.slice(0, 200)).toBe(200);
        expect.soft(nueva.headers.get('content-type')).toBe('application/pdf');
        expect.soft(nueva.headers.get('content-disposition')).toBe(dispositionDelPdf(kA.fecha, 1));
        expect.soft(nueva.cuerpo.equals(PDF_FALSO), 'el cuerpo es el PDF del generador').toBe(true);
        expect
          .soft(estadoDeLaCola(ctx.app), 'al terminar, la cola vuelve a { enCurso: 0, enEspera: 0 }')
          .toEqual(COLA_VACIA);
        await exigirSinEfectos(antes);
      },
      60_000,
    );
  });

  describe('caso 4: controles, sin cortar', () => {
    it('criterio 55 g.4: con el generador en modo normal, la descarga marcada responde 200 con el PDF, escribe su respuesta y no pasa por el filtro global', async () => {
      const corte = 'control-g-normal';
      const descarga = descargarParaCortar(ctx.app, rutaPdf(kA.id, 1), cookies.secretaria, corte);
      lanzadas.push(descarga.resultado);
      const respuesta = await conLimite(descarga.resultado, 'la descarga no respondió');
      expect(respuesta?.status).toBe(200);
      expect(respuesta?.headers['content-type']).toBe('application/pdf');
      expect(respuesta?.headers['content-disposition']).toBe(dispositionDelPdf(kA.fecha, 1));
      expect(respuesta?.cuerpo.equals(PDF_FALSO)).toBe(true);
      expect(espia.llamadasDe(corte).length, 'el 200 sí escribe la respuesta').toBeGreaterThan(0);
      expect(espiaDelFiltro.llamadasDe(corte)).toBe(0);
      await esperarEstadoDeLaCola(ctx.app, COLA_VACIA, ENSEGUIDA_MS);
      expect(estadoDeLaCola(ctx.app)).toEqual(COLA_VACIA);
    });

    it('criterio 55 g.4 y PQ9 b: con un generador que rechaza enseguida con un Error común, la descarga sin cortar responde el 500 ERROR_INTERNO del filtro global (JSON, sin Content-Disposition)', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'control-g-500';
      generador.modoRechazaEnseguida = true;
      const descarga = descargarParaCortar(ctx.app, rutaPdf(kB.id, 1), cookies.adminB, corte);
      lanzadas.push(descarga.resultado);
      const respuesta = await conLimite(descarga.resultado, 'la descarga no respondió');
      expect(respuesta?.status, respuesta?.cuerpo.toString('utf8').slice(0, 200)).toBe(500);
      expect(respuesta?.headers['content-type'] ?? '').toContain('application/json');
      expect(respuesta?.headers['content-disposition']).toBeUndefined();
      const cuerpo = JSON.parse(respuesta?.cuerpo.toString('utf8') ?? '{}') as Record<string, unknown>;
      expect(codigoDe({ body: cuerpo })).toBe('ERROR_INTERNO');
      expect(espiaDelFiltro.llamadasDe(corte), 'el error llegó al filtro global, que es quien responde el 500').toBe(1);
      await esperarEstadoDeLaCola(ctx.app, COLA_VACIA, ENSEGUIDA_MS);
      expect(estadoDeLaCola(ctx.app)).toEqual(COLA_VACIA);
      await exigirSinEfectos(antes);
    });
  });
});
