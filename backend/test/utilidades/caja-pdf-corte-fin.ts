// spec: 006-caja (pruebas protegidas)
import type net from 'node:net';
import { PDF_FALSO } from './caja-historial';
import type { TerminaAlVerElSocket } from './caja-pdf-corte-escritura';
import type { VigiaDeSockets } from './caja-pdf-corte-escritura';
import { esperarQue } from './caja-pdf-corte';

/**
 * Utilidades de las pruebas protegidas del criterio 55 h de la 006b (ronda adversarial 5; DT-20): un FIN cuenta como conexión cerrada.
 * Se suman a `caja-pdf-corte.ts` y a `caja-pdf-corte-escritura.ts` sin tocarlos (el cliente `node:http` que corta con `destroy()`, el vigía de los
 * sockets marcados y el espía del filtro global son los del 55 g):
 *   - el generador inyectado que se suscribe al evento `'end'` del socket del servidor de la petición marcada con `x-prueba-corte` y, dentro de ese
 *     mismo callback, anota `readableEnded`, `writable` y `destroyed` del socket y resuelve con un PDF pequeño o rechaza con un `Error` común.
 *
 * Solo usan HTTP, SQL y el contrato público de la spec (criterio 55 h, caso 5): no leen nada de la implementación interna.
 */

/** Cuánto espera el generador a que llegue el `'end'` del socket antes de fallar con un mensaje claro (55 h 5). */
export const ESPERA_DEL_FIN_MS = 2000;

/** Lo que el generador anotó del socket del servidor dentro del callback del `'end'`. */
export interface EstadoDelSocket {
  readableEnded: boolean;
  writable: boolean;
  destroyed: boolean;
}

export interface LlamadaAlFin {
  /** El `x-prueba-corte` de la petición a la que sirve esta llamada, o `undefined` si el generador no estaba armado (modo normal). */
  corte: string | undefined;
  estado: 'esperando-el-fin' | 'resuelta' | 'rechazada';
  /** El estado del socket dentro del callback del `'end'`, o `undefined` si el `'end'` no llegó. */
  socketAlFin: EstadoDelSocket | undefined;
  /** `true` si pasaron `ESPERA_DEL_FIN_MS` sin que llegara el `'end'` (la prueba debe fallar con un mensaje claro). */
  vencio: boolean;
  /** `true` si el socket del servidor de la petición marcada nunca apareció (el evento `request` no la vio). */
  sinSocket: boolean;
}

/**
 * El generador inyectado con `GENERADOR_PDF_CIERRE` del criterio 55 h 5. Ignora la señal. Armado para una descarga marcada (`armar`), se suscribe a
 * `socket.on('end', …)` del socket del servidor de esa petición. El oyente de la prueba se registra después del `socketOnEnd` del servidor HTTP, así
 * que cuando corre, `socket.end()` ya se llamó y el socket todavía no está destruido. Dentro de ese mismo callback anota el estado del socket y
 * resuelve con un PDF pequeño válido o rechaza con un `Error` común: la continuación del manejador corre en las microtareas de ese mismo paso, con el
 * socket medio cerrado.
 *
 * Sin armar, resuelve enseguida (modo normal).
 */
export class GeneradorAlFin {
  readonly llamadas: LlamadaAlFin[] = [];
  private armado: { corte: string; termina: TerminaAlVerElSocket } | undefined;

  constructor(private readonly sockets: () => VigiaDeSockets) {}

  /** Lo que se instala con `overrideProvider(GENERADOR_PDF_CIERRE).useValue(...)`. */
  readonly proveedor = {
    generar: (): Promise<Buffer> => this.generar(),
  };

  /** La próxima llamada es la de la descarga marcada `corte` y termina como diga `termina` dentro del `'end'` de su socket. Vale para una sola llamada. */
  armar(corte: string, termina: TerminaAlVerElSocket): void {
    this.armado = { corte, termina };
  }

  restablecer(): void {
    this.llamadas.length = 0;
    this.armado = undefined;
  }

  /** Espera, hasta `ms`, a que el generador haya recibido `n` llamadas. */
  esperarLlamadas(n: number, ms: number): Promise<boolean> {
    return esperarQue(() => this.llamadas.length >= n, ms);
  }

  /** Espera, hasta `ms`, a que ninguna llamada siga esperando el `'end'`. */
  esperarQueTerminen(ms: number): Promise<boolean> {
    return esperarQue(() => this.llamadas.every((llamada) => llamada.estado !== 'esperando-el-fin'), ms);
  }

  private generar(): Promise<Buffer> {
    const armado = this.armado;
    this.armado = undefined;
    const llamada: LlamadaAlFin = {
      corte: armado?.corte,
      estado: 'esperando-el-fin',
      socketAlFin: undefined,
      vencio: false,
      sinSocket: false,
    };
    this.llamadas.push(llamada);
    if (!armado) {
      llamada.estado = 'resuelta';
      return Promise.resolve(PDF_FALSO);
    }
    return new Promise<Buffer>((resolver, rechazar) => {
      const socket: net.Socket | undefined = this.sockets().socketDe(armado.corte);
      if (!socket) {
        // La prueba lo detecta con `exigirLaVentanaDelFin` y falla con un mensaje claro; aquí solo se libera la descarga.
        llamada.sinSocket = true;
        llamada.estado = 'resuelta';
        resolver(PDF_FALSO);
        return;
      }
      const temporizador = setTimeout(() => {
        socket.off('end', alFin);
        llamada.vencio = true;
        llamada.estado = 'resuelta';
        resolver(PDF_FALSO);
      }, ESPERA_DEL_FIN_MS);
      function alFin() {
        clearTimeout(temporizador);
        // Se anota ANTES de resolver o rechazar, dentro del mismo callback del `'end'`.
        llamada.socketAlFin = {
          readableEnded: socket!.readableEnded,
          writable: socket!.writable,
          destroyed: socket!.destroyed,
        };
        if (armado!.termina === 'resuelve') {
          llamada.estado = 'resuelta';
          resolver(PDF_FALSO);
        } else {
          llamada.estado = 'rechazada';
          rechazar(new Error('Falla simulada del generador del PDF (dentro del end del socket)'));
        }
      }
      socket.once('end', alFin);
    });
  }

  /**
   * Falla con un mensaje claro si alguna llamada armada no vio el `'end'` en `ESPERA_DEL_FIN_MS`, o si el socket no estaba en la ventana del FIN
   * (`readableEnded === true`, `writable === false` y `destroyed === false`): sin eso la prueba no reproduce la falla y daría un falso verde.
   */
  exigirLaVentanaDelFin(): void {
    const sinSocket = this.llamadas.find((llamada) => llamada.sinSocket);
    if (sinSocket) {
      throw new Error(
        `No se reprodujo la ventana del FIN: el servidor no emitió el evento request de la descarga "${sinSocket.corte}" antes de llamar al generador.`,
      );
    }
    const vencida = this.llamadas.find((llamada) => llamada.vencio);
    if (vencida) {
      throw new Error(
        `No se reprodujo la ventana del FIN: el socket del servidor de la descarga "${vencida.corte}" no emitió el evento 'end' en ${ESPERA_DEL_FIN_MS} ms (el cliente no cortó con un FIN, o el servidor no leyó el corte).`,
      );
    }
    for (const llamada of this.llamadas) {
      if (llamada.corte === undefined) continue;
      const estado = llamada.socketAlFin;
      if (!estado || estado.readableEnded !== true || estado.writable !== false || estado.destroyed !== false) {
        throw new Error(
          `No se reprodujo la ventana del FIN en la descarga "${llamada.corte}": dentro del 'end' del socket se esperaba readableEnded=true, writable=false y destroyed=false, y se vio ${JSON.stringify(estado)}.`,
        );
      }
    }
  }

  /** El estado del socket anotado por la primera llamada armada (para el informe de la prueba). */
  get socketObservado(): EstadoDelSocket | undefined {
    return this.llamadas.find((llamada) => llamada.corte !== undefined)?.socketAlFin;
  }
}
