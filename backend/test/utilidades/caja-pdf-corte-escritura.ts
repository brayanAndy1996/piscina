// spec: 006-caja (pruebas protegidas)
import http from 'node:http';
import type net from 'node:net';
import { vi } from 'vitest';
import { FiltroErrores } from '../../src/comun/filtros/filtro-errores';
import type { AppHistorial } from './caja-historial';
import { PDF_FALSO } from './caja-historial';
import { CABECERA_DE_CORTE, esperarQue, puertoDe } from './caja-pdf-corte';

/**
 * Utilidades de las pruebas protegidas del criterio 55 g de la 006b (ronda adversarial 4; DT-18): la conexión se vuelve a mirar antes de escribir.
 * Se suman a `caja-pdf-corte.ts` y a `caja-pdf-senal.ts` sin tocarlos:
 *   - un cliente `node:http` que corta de dos formas: `destroy()` (FIN) y `resetAndDestroy()` (RST);
 *   - el socket del servidor de cada petición marcada con `x-prueba-corte` (evento `request` del servidor HTTP de la app);
 *   - el generador determinista: ignora la señal, revisa con `setImmediate` si ese socket ya está destruido y, en la misma vuelta en que lo ve,
 *     resuelve con un PDF pequeño o rechaza con un `Error` común;
 *   - un espía sobre el método `catch` del filtro global de errores, filtrado por la cabecera `x-prueba-corte`.
 *
 * Solo usan HTTP, SQL y el contrato público de la spec (criterio 55 g, caso 4).
 */

/** Las dos formas de corte del cliente (55 g 4): `destroy()` (FIN) y `resetAndDestroy()` (RST). */
export type FormaDeCorte = 'destroy' | 'rst';
export const FORMAS_DE_CORTE: readonly FormaDeCorte[] = ['destroy', 'rst'];

/** Cuánto espera el generador a ver el socket destruido antes de fallar con un mensaje claro (55 g 4). */
export const ESPERA_DEL_SOCKET_MS = 2000;

// ---------------------------------------------------------------------------------------------------------------------
// El cliente node:http que corta con destroy() o con RST
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaDeDescarga {
  status: number;
  headers: http.IncomingHttpHeaders;
  cuerpo: Buffer;
}

export interface DescargaParaCortar {
  /** El valor de `x-prueba-corte` de esta descarga. */
  readonly corte: string;
  /** La respuesta que llegó al cliente, o `null` si no llegó ninguna (cortada o cerrada por el servidor). Nunca se rechaza. */
  readonly resultado: Promise<RespuestaDeDescarga | null>;
  /** Corta como lo haría el cliente: FIN con `destroy()` o RST con `resetAndDestroy()`. */
  cortar(forma: FormaDeCorte): void;
}

/** `GET` de `ruta` con `node:http`, en una conexión propia (`agent: false`), con la cookie dada y la cabecera `x-prueba-corte`. */
export function descargarParaCortar(
  app: AppHistorial['app'],
  ruta: string,
  cookie: string,
  corte: string,
): DescargaParaCortar {
  const peticion = http.request({
    host: '127.0.0.1',
    port: puertoDe(app),
    method: 'GET',
    path: ruta,
    agent: false,
    headers: { cookie, [CABECERA_DE_CORTE]: corte },
  });
  const resultado = new Promise<RespuestaDeDescarga | null>((resolver) => {
    peticion.on('response', (respuesta) => {
      const trozos: Buffer[] = [];
      respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
      respuesta.on('end', () =>
        resolver({ status: respuesta.statusCode ?? 0, headers: respuesta.headers, cuerpo: Buffer.concat(trozos) }),
      );
      respuesta.on('error', () => resolver(null));
    });
    // Cortada por la prueba (o cerrada por el servidor sin responder): no es un error de la prueba.
    peticion.on('error', () => resolver(null));
    peticion.on('close', () => resolver(null));
  });
  let socketDelCliente: net.Socket | undefined;
  peticion.on('socket', (socket) => {
    socketDelCliente = socket;
  });
  peticion.end();
  return {
    corte,
    resultado,
    cortar: (forma) => {
      // `resetAndDestroy()` es del socket (`net.Socket`), no de la petición: cierra con RST en lugar de FIN.
      if (forma === 'rst' && socketDelCliente) socketDelCliente.resetAndDestroy();
      else peticion.destroy();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// El socket del servidor de cada petición marcada
// ---------------------------------------------------------------------------------------------------------------------

export interface VigiaDeSockets {
  /** El socket del servidor de la petición marcada con `x-prueba-corte: corte`, o `undefined` si todavía no llegó. */
  socketDe(corte: string): net.Socket | undefined;
  detener(): void;
}

/** Escucha el evento `request` del servidor HTTP de la app y guarda, por cada petición marcada, su socket. Quien lo usa debe llamar a `detener()`. */
export function vigilarSocketsMarcados(app: AppHistorial['app']): VigiaDeSockets {
  const servidor = app.getHttpServer();
  const sockets = new Map<string, net.Socket>();
  const alPedir = (peticion: http.IncomingMessage) => {
    const cabecera = peticion.headers[CABECERA_DE_CORTE];
    const corte = Array.isArray(cabecera) ? cabecera.join(', ') : cabecera;
    if (corte !== undefined) sockets.set(corte, peticion.socket);
  };
  servidor.on('request', alPedir);
  return {
    socketDe: (corte) => sockets.get(corte),
    detener: () => {
      servidor.off('request', alPedir);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// El generador determinista
// ---------------------------------------------------------------------------------------------------------------------

/** Cómo termina la llamada que ve el socket destruido: con un PDF pequeño válido o con un `new Error(…)`. */
export type TerminaAlVerElSocket = 'resuelve' | 'rechaza';

export interface LlamadaDeterminista {
  /** El `x-prueba-corte` de la petición a la que sirve esta llamada, o `undefined` si el generador no estaba armado (modo normal). */
  corte: string | undefined;
  estado: 'esperando-el-socket' | 'resuelta' | 'rechazada';
  /** `true` si la llamada vio el socket destruido (con `setImmediate`) antes de terminar. */
  vioElSocketDestruido: boolean;
  /** `true` si pasaron `ESPERA_DEL_SOCKET_MS` sin ver el socket destruido (la prueba debe fallar con un mensaje claro). */
  vencio: boolean;
}

const PDF_PEQUENO = PDF_FALSO;

/**
 * El generador inyectado con `GENERADOR_PDF_CIERRE` del criterio 55 g 4. Ignora la señal. Armado para una descarga marcada (`armar`), revisa en cada
 * vuelta del bucle de eventos, con `setImmediate` y no con un temporizador, si el socket del servidor de esa petición ya está destruido. En la misma
 * vuelta en que lo ve, resuelve con un PDF pequeño o rechaza con un `Error` común. `setImmediate` corre en la fase "check", antes de la fase de
 * cierre en que Node emite `close`: así la generación termina en la ventana de la falla.
 *
 * Sin armar, o en el modo normal, resuelve enseguida. `modoRechazaEnseguida` rechaza enseguida con un `Error` común (control de PQ9 b).
 */
export class GeneradorDeterminista {
  readonly llamadas: LlamadaDeterminista[] = [];
  /** `true`: toda llamada rechaza enseguida con un `Error` común (control del 500 de PQ9 b). */
  modoRechazaEnseguida = false;
  private armado: { corte: string; termina: TerminaAlVerElSocket } | undefined;

  constructor(private readonly sockets: () => VigiaDeSockets) {}

  /** Lo que se instala con `overrideProvider(GENERADOR_PDF_CIERRE).useValue(...)`. */
  readonly proveedor = {
    generar: (): Promise<Buffer> => this.generar(),
  };

  /** La próxima llamada es la de la descarga marcada `corte` y termina como diga `termina` al ver su socket destruido. Vale para una sola llamada. */
  armar(corte: string, termina: TerminaAlVerElSocket): void {
    this.armado = { corte, termina };
  }

  restablecer(): void {
    this.llamadas.length = 0;
    this.armado = undefined;
    this.modoRechazaEnseguida = false;
  }

  /** Espera, hasta `ms`, a que el generador haya recibido `n` llamadas. */
  esperarLlamadas(n: number, ms: number): Promise<boolean> {
    return esperarQue(() => this.llamadas.length >= n, ms);
  }

  /** Espera, hasta `ms`, a que ninguna llamada siga esperando el socket. */
  esperarQueTerminen(ms: number): Promise<boolean> {
    return esperarQue(() => this.llamadas.every((llamada) => llamada.estado !== 'esperando-el-socket'), ms);
  }

  private generar(): Promise<Buffer> {
    const armado = this.armado;
    this.armado = undefined;
    const llamada: LlamadaDeterminista = {
      corte: armado?.corte,
      estado: 'esperando-el-socket',
      vioElSocketDestruido: false,
      vencio: false,
    };
    this.llamadas.push(llamada);
    if (this.modoRechazaEnseguida) {
      llamada.estado = 'rechazada';
      return Promise.reject(new Error('Falla simulada del generador del PDF (rechaza enseguida)'));
    }
    if (!armado) {
      llamada.estado = 'resuelta';
      return Promise.resolve(PDF_PEQUENO);
    }
    return new Promise<Buffer>((resolver, rechazar) => {
      const limite = Date.now() + ESPERA_DEL_SOCKET_MS;
      const revisar = () => {
        const socket = this.sockets().socketDe(armado.corte);
        if (socket?.destroyed) {
          llamada.vioElSocketDestruido = true;
          if (armado.termina === 'resuelve') {
            llamada.estado = 'resuelta';
            resolver(PDF_PEQUENO);
          } else {
            llamada.estado = 'rechazada';
            rechazar(new Error('Falla simulada del generador del PDF (al ver el socket destruido)'));
          }
          return;
        }
        if (Date.now() >= limite) {
          // La prueba lo detecta con `exigirQueVioElSocket` y falla con un mensaje claro; aquí solo se libera la descarga.
          llamada.vencio = true;
          llamada.estado = 'resuelta';
          resolver(PDF_PEQUENO);
          return;
        }
        setImmediate(revisar);
      };
      setImmediate(revisar);
    });
  }

  /** Falla con un mensaje claro si alguna llamada armada vencio sin ver su socket destruido. */
  exigirQueVioElSocket(): void {
    const vencida = this.llamadas.find((llamada) => llamada.vencio);
    if (vencida) {
      throw new Error(
        `El generador determinista no vio el socket destruido de la descarga "${vencida.corte}" en ${ESPERA_DEL_SOCKET_MS} ms: el cliente no cortó, o el servidor no destruyó el socket.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// El espía del filtro global de errores
// ---------------------------------------------------------------------------------------------------------------------

export interface EspiaDelFiltro {
  /** Cuántas veces recibió el filtro global un error de la petición marcada con `x-prueba-corte: corte`. */
  llamadasDe(corte: string): number;
  restaurar(): void;
}

/**
 * `vi.spyOn` sobre el método `catch` del filtro global de errores de la app. Debe instalarse ANTES de crear la aplicación: Nest enlaza el método al
 * registrar el filtro, y un espía posterior no lo vería. Deja pasar las llamadas (el espía solo mira).
 */
export function espiarFiltroGlobal(): EspiaDelFiltro {
  const espia = vi.spyOn(FiltroErrores.prototype, 'catch');
  return {
    llamadasDe: (corte) =>
      espia.mock.calls.filter(([, host]) => {
        const cabecera = host.switchToHttp().getRequest<http.IncomingMessage>().headers[CABECERA_DE_CORTE];
        return (Array.isArray(cabecera) ? cabecera.join(', ') : cabecera) === corte;
      }).length,
    restaurar: () => espia.mockRestore(),
  };
}
