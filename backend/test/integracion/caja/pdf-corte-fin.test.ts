// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookiesDeCaja, crearEscenarioDeCaja, type EscenarioCaja, type CajaDePrueba } from '../../utilidades/caja';
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
  abrirClienteDePipelining,
  type EspiaDeEscritura,
  espiarEscrituras,
  esperarEstadoDeLaCola,
  estadoDeLaCola,
  vigilarConexiones,
} from '../../utilidades/caja-pdf-corte';
import { GeneradorAlFin } from '../../utilidades/caja-pdf-corte-fin';
import {
  descargarParaCortar,
  type EspiaDelFiltro,
  espiarFiltroGlobal,
  type TerminaAlVerElSocket,
  vigilarSocketsMarcados,
  type VigiaDeSockets,
} from '../../utilidades/caja-pdf-corte-escritura';
import { comoGeneradorDePrueba } from '../../utilidades/caja-pdf-senal';
import { conLimite } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 55 h (crítico, ronda adversarial 5 de la 006b, falla F1; incumplía 55 d, 55 g y 51 d; DT-20; D-23): un FIN cuenta como conexión cerrada.
// Cuando Node lee el FIN del cliente (un corte con `destroy()`), el servidor HTTP llama a `socket.end()`. Desde ese momento y en el resto de esa fase de
// lectura del bucle de eventos, el socket ya tiene `readableEnded === true` y `writable === false`, pero todavía no está destruido, y la respuesta
// tampoco está `destroyed` ni `closed`. Si en esa fase termina la generación, la descarga, que ya fue cortada, escribía un 200, o dejaba subir el
// error al filtro global (404, 500).
//   1. La definición de conexión cerrada suma: `socket.readableEnded` o `!socket.writable` del socket de la petición.
//   2. Se aplica al entrar al manejador y antes de escribir (el 200 y el camino del error). Si está cerrada, no se escribe nada y el error no llega
//      al filtro global.
//   3. No cambia cuándo se activa la señal.
//   4. Caso límite: un cliente que envía la petición y cierra su lado de escritura cuenta como corte (no se prueba aquí: no hay respuesta posible).
//   5. Pruebas de integración con la API escuchando en un puerto y sin proxy de base: un generador determinista que ignora la señal, se suscribe al
//      `'end'` del socket del servidor de la petición marcada y, dentro de ese mismo callback, anota `readableEnded`, `writable` y `destroyed` y
//      resuelve o rechaza. La prueba exige que el socket esté en la ventana (`readableEnded` true, `writable` false, `destroyed` false) y, si no,
//      falla con "no se reprodujo la ventana del FIN" en lugar de dar un falso verde.
// En todos los casos las filas de `cajas`, `movimientos_caja`, `cierres_caja` y `auditoria` no cambian y ninguna conexión del rol de la app queda
// `idle in transaction`.

/** "Enseguida" es, como en el 51 e, a más tardar 1 000 ms. */
const ENSEGUIDA_MS = 1000;
/** Lo que la prueba espera, como mucho, a que ocurra algo que sí debe ocurrir. */
const ESPERA_MAXIMA_MS = 10_000;
const COLA_VACIA = { enCurso: 0, enEspera: 0 };

describe('un FIN cuenta como conexión cerrada (criterio 55 h)', () => {
  let sockets: VigiaDeSockets;
  const generador = new GeneradorAlFin(() => sockets);
  let espiaDelFiltro: EspiaDelFiltro;
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** La caja de hoy de A, cerrada, abierta por la SECRETARIA S1. */
  let kA: CajaDePrueba;
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

  /** Sin efectos (55 h 5): no se escribe ni se audita, y ninguna conexión del rol de la app queda `idle in transaction`. */
  async function exigirSinEfectos(antes: Record<string, string>) {
    expect.soft(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
    expect.soft(await conexionesInactivasEnTransaccion(), 'ninguna conexión idle in transaction').toEqual([]);
  }

  /**
   * S1 pide el PDF de un cierre de A con `node:http` y la cabecera `x-prueba-corte`; cuando el generador ya recibió la llamada, el cliente corta con
   * `destroy()` (un FIN, porque el servidor todavía no envió nada) y el generador (que ignora la señal) termina dentro del `'end'` del socket del
   * servidor, como `termina`. Falla con un mensaje claro si no se reprodujo la ventana del FIN.
   */
  async function cortarConFin(corte: string, termina: TerminaAlVerElSocket) {
    generador.armar(corte, termina);
    const descarga = descargarParaCortar(ctx.app, rutaPdf(kA.id, 1), cookies.secretaria, corte);
    lanzadas.push(descarga.resultado);
    const llego = await generador.esperarLlamadas(1, ESPERA_MAXIMA_MS);
    expect(llego, 'el generador debía recibir la llamada de la descarga antes del corte').toBe(true);

    descarga.cortar('destroy');

    const termino = await generador.esperarQueTerminen(ESPERA_MAXIMA_MS);
    expect(termino, 'la llamada al generador debía terminar').toBe(true);
    // Si no llegó el 'end' o el socket no estaba medio cerrado y sin destruir, la prueba no reprodujo la ventana: falla con un mensaje claro.
    generador.exigirLaVentanaDelFin();
    await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);
    return descarga;
  }

  /** Lo que vale tras cada corte (55 h 5, casos 1 y 2): nada escrito por la cortada, la cola vacía y el filtro global sin recibir el error. */
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
        'la descarga cortada con un FIN no llama a writeHead, write ni end (ni el PDF ni un JSON de error)',
      )
      .toEqual([]);
    expect
      .soft(
        espiaDelFiltro.llamadasDe(corte),
        'el error de la descarga cortada con un FIN no llega al filtro global (que escribiría un 500 ERROR_INTERNO)',
      )
      .toBe(0);
  }

  describe('caso 1: el generador resuelve dentro del end del socket', () => {
    it('criterio 55 h.1: la descarga cortada con un FIN no escribe, el generador recibió exactamente esa llamada y la cola vuelve a { enCurso: 0, enEspera: 0 }', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'corte-h1';

      await cortarConFin(corte, 'resuelve');

      expect
        .soft(generador.llamadas, 'el generador recibió exactamente la llamada de la descarga cortada')
        .toHaveLength(1);
      await exigirAbandonada(corte);
      await exigirSinEfectos(antes);
    }, 60_000);
  });

  describe('caso 2: el generador rechaza con un Error común dentro del end del socket', () => {
    it('criterio 55 h.2: la descarga cortada con un FIN no escribe, el error no llega al filtro global y la cola vuelve a { enCurso: 0, enEspera: 0 }', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'corte-h2';

      await cortarConFin(corte, 'rechaza');

      expect
        .soft(generador.llamadas, 'el generador recibió exactamente la llamada de la descarga cortada')
        .toHaveLength(1);
      await exigirAbandonada(corte);
      await exigirSinEfectos(antes);
    }, 60_000);
  });

  describe('caso 3: después de cada corte, una descarga nueva de la misma persona responde 200', () => {
    it.each([['resuelve'], ['rechaza']] as const)(
      'criterio 55 h.3 (generador que %s dentro del end): una descarga nueva de S1, sin cortar y con el generador en modo normal, responde 200 con el PDF',
      async (termina) => {
        const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
        await cortarConFin(`corte-h3-${termina}`, termina);
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

  describe('caso 4: controles, sin cortar y con el generador en modo normal', () => {
    it('criterio 55 h.4: una descarga normal con node:http responde 200 con el PDF, escribe su respuesta y no pasa por el filtro global', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'control-h-http';
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
      await exigirSinEfectos(antes);
    });

    it('criterio 55 h.4: un cliente node:net que escribe la petición completa y espera, sin cerrar su lado de escritura, recibe 200 con el PDF', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'control-h-net';
      const cliente = await abrirClienteDePipelining(ctx.app);
      try {
        await cliente.escribir([rutaPdf(kA.id, 1)], cookies.secretaria, corte);
        const respuestas = await cliente.esperarRespuestas(1, ESPERA_MAXIMA_MS);
        expect(respuestas, 'el cliente debía recibir la respuesta sin haber cerrado su lado de escritura').toHaveLength(
          1,
        );
        expect(respuestas[0]?.status).toBe(200);
        expect(respuestas[0]?.headers['content-type']).toBe('application/pdf');
        expect(respuestas[0]?.cuerpo.equals(PDF_FALSO)).toBe(true);
        expect(espia.llamadasDe(corte).length, 'el 200 sí escribe la respuesta').toBeGreaterThan(0);
        expect(espiaDelFiltro.llamadasDe(corte)).toBe(0);
      } finally {
        cliente.cortar();
      }
      await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);
      await esperarEstadoDeLaCola(ctx.app, COLA_VACIA, ENSEGUIDA_MS);
      expect(estadoDeLaCola(ctx.app)).toEqual(COLA_VACIA);
      await exigirSinEfectos(antes);
    });
  });
});
