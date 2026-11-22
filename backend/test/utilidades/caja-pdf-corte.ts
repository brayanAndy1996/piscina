// spec: 006-caja (pruebas protegidas)
import http from 'node:http';
import net from 'node:net';
import pg from 'pg';
import { vi } from 'vitest';
import { ColaPdfCierre } from '../../src/modulos/caja/index';
import type { AppHistorial } from './caja-historial';
import { LIMITE_DE_SEGURIDAD_MS } from './carreras';
import { urlAppPruebas, urlPropietarioPruebas } from './base-datos';

/**
 * Utilidades de las pruebas protegidas del criterio 55 de la 006b (ronda adversarial 3; DT-15): una descarga cortada antes de llegar al controlador
 * no ocupa nada. Son las de 55 f y se suman a `caja-pdf-senal.ts` y a `caja-pdf-concurrencia.ts` sin tocarlos:
 *   - un cliente `node:http` que corta con `destroy()`;
 *   - un cliente `node:net` que escribe varias peticiones HTTP/1.1 completas en una sola escritura (pipelining) y corta con `destroy()`;
 *   - un espía de `http.ServerResponse.prototype` (`writeHead`, `write` y `end`) filtrado por la cabecera `x-prueba-corte`;
 *   - el bloqueo `LOCK TABLE usuarios IN ACCESS EXCLUSIVE MODE` con la espera en `pg_stat_activity`, que siempre se suelta;
 *   - el estado de la cola (`app.get(ColaPdfCierre).estado`, contrato del criterio 51 c) y un vigía de las conexiones del servidor.
 *
 * Solo usan HTTP, SQL y el contrato público de la spec: no leen nada de la implementación interna.
 */

/** El nombre de la cabecera con la que la prueba marca la descarga que va a cortar (55 f). */
export const CABECERA_DE_CORTE = 'x-prueba-corte';

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** Espera, hasta `ms`, a que `condicion` sea verdadera (la revisa cada 5 ms). Devuelve si se cumplió. */
export async function esperarQue(condicion: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const limite = Date.now() + ms;
  for (;;) {
    if (await condicion()) return true;
    if (Date.now() >= limite) return false;
    await pausa(5);
  }
}

/** El puerto en el que escucha la aplicación de la prueba. */
export function puertoDe(app: AppHistorial['app']): number {
  return (app.getHttpServer().address() as net.AddressInfo).port;
}

// ---------------------------------------------------------------------------------------------------------------------
// El estado de la cola
// ---------------------------------------------------------------------------------------------------------------------

export interface EstadoDeLaCola {
  enCurso: number;
  enEspera: number;
}

/** `app.get(ColaPdfCierre).estado` (criterio 51 c): una copia simple, comparable con `toEqual`. */
export function estadoDeLaCola(app: AppHistorial['app']): EstadoDeLaCola {
  const { enCurso, enEspera } = app.get(ColaPdfCierre).estado;
  return { enCurso, enEspera };
}

/** Espera, hasta `ms`, a que el estado de la cola sea el dado. Devuelve el último estado visto (para el mensaje de la prueba). */
export async function esperarEstadoDeLaCola(
  app: AppHistorial['app'],
  esperado: EstadoDeLaCola,
  ms: number,
): Promise<{ cumplido: boolean; estado: EstadoDeLaCola }> {
  const cumplido = await esperarQue(() => {
    const estado = estadoDeLaCola(app);
    return estado.enCurso === esperado.enCurso && estado.enEspera === esperado.enEspera;
  }, ms);
  return { cumplido, estado: estadoDeLaCola(app) };
}

/**
 * Observa durante `ms` (cada 10 ms) un valor y devuelve todos los distintos que vio, en orden. Sirve para decir "durante los 1 000 ms siguientes,
 * `estado` sigue en `{ enCurso: 0, enEspera: 0 }`" sin quedarse solo con la foto del final.
 */
export async function valoresDurante<T>(ms: number, leer: () => T): Promise<T[]> {
  const vistos: T[] = [];
  const claves = new Set<string>();
  const registrar = () => {
    const valor = leer();
    const clave = JSON.stringify(valor);
    if (!claves.has(clave)) {
      claves.add(clave);
      vistos.push(valor);
    }
  };
  const limite = Date.now() + ms;
  registrar();
  while (Date.now() < limite) {
    await pausa(10);
    registrar();
  }
  registrar();
  return vistos;
}

// ---------------------------------------------------------------------------------------------------------------------
// El vigía de las conexiones del servidor
// ---------------------------------------------------------------------------------------------------------------------

export interface VigiaDeConexiones {
  /** Cuántas conexiones nuevas aceptó el servidor desde que empezó la vigilancia. */
  readonly aceptadas: number;
  /**
   * Espera, hasta `ms`, a que el servidor haya visto cerrarse todas las conexiones aceptadas durante la vigilancia. Devuelve `true` si las vio
   * cerrarse. Si no (la prueba no puede observarlo), el llamador sigue de todos modos: es la espera de 200 ms del criterio 55 f, caso 1, paso 4.
   */
  esperarCierres(ms: number): Promise<boolean>;
  detener(): void;
}

/**
 * Escucha `connection` del servidor HTTP de la aplicación y anota cuándo se cierra (`close`) cada socket del lado del servidor. Quien lo usa debe
 * llamar a `detener()`.
 */
export function vigilarConexiones(app: AppHistorial['app']): VigiaDeConexiones {
  const servidor = app.getHttpServer();
  const abiertas = new Set<net.Socket>();
  let aceptadas = 0;
  const alConectar = (socket: net.Socket) => {
    aceptadas += 1;
    abiertas.add(socket);
    socket.once('close', () => abiertas.delete(socket));
  };
  servidor.on('connection', alConectar);
  return {
    get aceptadas() {
      return aceptadas;
    },
    esperarCierres: (ms) => esperarQue(() => abiertas.size === 0, ms),
    detener: () => {
      servidor.off('connection', alConectar);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// El cliente node:http que corta con destroy()
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaCruda {
  status: number;
  headers: Record<string, string>;
  cuerpo: Buffer;
}

export interface DescargaConHttp {
  /** El valor de `x-prueba-corte` de esta descarga. */
  readonly corte: string;
  /** Se cumple cuando la petición terminó de enviarse (evento `finish` de la petición). */
  readonly enviada: Promise<void>;
  /** La respuesta, o `null` si la prueba cortó la descarga antes de que terminara. Nunca se rechaza. */
  readonly resultado: Promise<RespuestaCruda | null>;
  /** Corta como lo hace el cliente: `destroy()` de la petición, que cierra el socket. */
  cortar(): void;
  cortada(): boolean;
  terminada(): boolean;
}

/**
 * `GET` de `ruta` con `node:http`, en una conexión propia (`agent: false`), con la cookie dada y la cabecera `x-prueba-corte`. Con `cortarAlEnviar`,
 * corta con `destroy()` apenas la petición termina de enviarse (criterio 55 f, caso 2).
 */
export function descargarConHttp(
  app: AppHistorial['app'],
  ruta: string,
  cookie: string,
  corte: string,
  opciones: { cortarAlEnviar?: boolean } = {},
): DescargaConHttp {
  let cortada = false;
  let terminada = false;
  let alEnviar!: () => void;
  const enviada = new Promise<void>((resolver) => {
    alEnviar = resolver;
  });
  const peticion = http.request({
    host: '127.0.0.1',
    port: puertoDe(app),
    method: 'GET',
    path: ruta,
    agent: false,
    headers: { cookie, [CABECERA_DE_CORTE]: corte },
  });
  const resultado = new Promise<RespuestaCruda | null>((resolver) => {
    peticion.on('response', (respuesta) => {
      const trozos: Buffer[] = [];
      respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
      respuesta.on('end', () => {
        terminada = true;
        const headers: Record<string, string> = {};
        for (const [nombre, valor] of Object.entries(respuesta.headers)) {
          headers[nombre] = Array.isArray(valor) ? valor.join(', ') : (valor ?? '');
        }
        resolver({ status: respuesta.statusCode ?? 0, headers, cuerpo: Buffer.concat(trozos) });
      });
      respuesta.on('error', () => {
        terminada = true;
        resolver(null);
      });
    });
    // Cortada por la prueba (o cerrada por el servidor sin responder): no es un error de la prueba.
    peticion.on('error', () => {
      terminada = true;
      resolver(null);
    });
    peticion.on('close', () => {
      terminada = true;
      resolver(null);
    });
  });
  peticion.on('finish', () => {
    alEnviar();
    if (opciones.cortarAlEnviar) {
      cortada = true;
      peticion.destroy();
    }
  });
  peticion.end();
  return {
    corte,
    enviada,
    resultado,
    cortar: () => {
      cortada = true;
      peticion.destroy();
    },
    cortada: () => cortada,
    terminada: () => terminada,
  };
}

/**
 * Hace `cantidad` descargas seguidas por una misma conexión keep-alive (`http.Agent` con un solo socket) y devuelve sus respuestas en orden. Cada
 * una espera a que termine la anterior. Devuelve también cuántas conexiones distintas se usaron.
 */
export async function descargasPorUnaConexionKeepAlive(
  app: AppHistorial['app'],
  rutas: readonly string[],
  cookie: string,
): Promise<{ respuestas: RespuestaCruda[]; conexiones: number }> {
  const agente = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const sockets = new Set<net.Socket>();
  try {
    const respuestas: RespuestaCruda[] = [];
    for (const ruta of rutas) {
      respuestas.push(
        await new Promise<RespuestaCruda>((resolver, rechazar) => {
          const peticion = http.request(
            { host: '127.0.0.1', port: puertoDe(app), method: 'GET', path: ruta, agent: agente, headers: { cookie } },
            (respuesta) => {
              if (respuesta.socket) sockets.add(respuesta.socket);
              const trozos: Buffer[] = [];
              respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
              respuesta.on('error', rechazar);
              respuesta.on('end', () => {
                const headers: Record<string, string> = {};
                for (const [nombre, valor] of Object.entries(respuesta.headers)) {
                  headers[nombre] = Array.isArray(valor) ? valor.join(', ') : (valor ?? '');
                }
                resolver({ status: respuesta.statusCode ?? 0, headers, cuerpo: Buffer.concat(trozos) });
              });
            },
          );
          peticion.on('error', rechazar);
          peticion.setTimeout(LIMITE_DE_SEGURIDAD_MS, () =>
            peticion.destroy(new Error('Límite de seguridad de la descarga')),
          );
          peticion.end();
        }),
      );
    }
    return { respuestas, conexiones: sockets.size };
  } finally {
    agente.destroy();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// El cliente node:net con pipelining
// ---------------------------------------------------------------------------------------------------------------------

/** Lee de `crudo` una respuesta HTTP/1.1 completa (con `Content-Length` o `chunked`). `null` si todavía no llegó entera. */
function leerRespuesta(crudo: Buffer): { respuesta: RespuestaCruda; consumido: number } | null {
  const finDeCabeceras = crudo.indexOf('\r\n\r\n');
  if (finDeCabeceras < 0) return null;
  const lineas = crudo.subarray(0, finDeCabeceras).toString('latin1').split('\r\n');
  const status = Number((lineas[0] ?? '').split(' ')[1]);
  const headers: Record<string, string> = {};
  for (const linea of lineas.slice(1)) {
    const i = linea.indexOf(':');
    if (i > 0) headers[linea.slice(0, i).trim().toLowerCase()] = linea.slice(i + 1).trim();
  }
  const inicio = finDeCabeceras + 4;
  if ((headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
    const trozos: Buffer[] = [];
    let posicion = inicio;
    for (;;) {
      const finDeLinea = crudo.indexOf('\r\n', posicion);
      if (finDeLinea < 0) return null;
      const tamano = parseInt(crudo.subarray(posicion, finDeLinea).toString('latin1').split(';')[0] ?? '', 16);
      if (Number.isNaN(tamano)) return null;
      if (tamano === 0) {
        // Sin trailers: "0\r\n\r\n".
        if (crudo.length < finDeLinea + 4) return null;
        return { respuesta: { status, headers, cuerpo: Buffer.concat(trozos) }, consumido: finDeLinea + 4 };
      }
      if (crudo.length < finDeLinea + 2 + tamano + 2) return null;
      trozos.push(crudo.subarray(finDeLinea + 2, finDeLinea + 2 + tamano));
      posicion = finDeLinea + 2 + tamano + 2;
    }
  }
  const largo = Number(headers['content-length'] ?? '0');
  if (crudo.length < inicio + largo) return null;
  return { respuesta: { status, headers, cuerpo: crudo.subarray(inicio, inicio + largo) }, consumido: inicio + largo };
}

export interface ClienteDePipelining {
  /** `true` cuando el socket del cliente ya se destruyó o el servidor lo cerró. */
  cerrado(): boolean;
  /**
   * Escribe, en una sola escritura, una petición `GET` HTTP/1.1 completa por cada ruta (con la cookie, `Connection: keep-alive` y
   * `x-prueba-corte`). Se cumple cuando el sistema operativo aceptó la escritura.
   */
  escribir(rutas: readonly string[], cookie: string, corte: string): Promise<void>;
  /** Las respuestas completas que llegaron hasta ahora, en orden. */
  respuestas(): RespuestaCruda[];
  /** Espera, hasta `ms`, a que hayan llegado `n` respuestas completas. Devuelve las que llegaron. */
  esperarRespuestas(n: number, ms: number): Promise<RespuestaCruda[]>;
  /** Corta como lo hace un cliente que se cae: `destroy()` del socket. */
  cortar(): void;
}

/** Abre una conexión `node:net` a la aplicación de la prueba. */
export async function abrirClienteDePipelining(app: AppHistorial['app']): Promise<ClienteDePipelining> {
  const puerto = puertoDe(app);
  const socket = net.connect({ host: '127.0.0.1', port: puerto });
  await new Promise<void>((resolver, rechazar) => {
    socket.once('connect', () => resolver());
    socket.once('error', rechazar);
  });
  let cerrado = false;
  let pendiente: Buffer = Buffer.alloc(0);
  const completas: RespuestaCruda[] = [];
  socket.on('data', (trozo: Buffer) => {
    pendiente = Buffer.concat([pendiente, trozo]);
    for (;;) {
      const leida = leerRespuesta(pendiente);
      if (!leida) break;
      completas.push(leida.respuesta);
      pendiente = pendiente.subarray(leida.consumido);
    }
  });
  socket.on('error', () => undefined);
  socket.on('close', () => {
    cerrado = true;
  });
  return {
    cerrado: () => cerrado || socket.destroyed,
    escribir: (rutas, cookie, corte) =>
      new Promise<void>((resolver, rechazar) => {
        const texto = rutas
          .map(
            (ruta) =>
              `GET ${ruta} HTTP/1.1\r\nHost: 127.0.0.1:${puerto}\r\nCookie: ${cookie}\r\n${CABECERA_DE_CORTE}: ${corte}\r\nConnection: keep-alive\r\n\r\n`,
          )
          .join('');
        socket.write(texto, 'latin1', (error) => (error ? rechazar(error) : resolver()));
      }),
    respuestas: () => [...completas],
    esperarRespuestas: async (n, ms) => {
      await esperarQue(() => completas.length >= n, ms);
      return [...completas];
    },
    cortar: () => {
      socket.destroy();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// El espía de escritura sobre http.ServerResponse.prototype
// ---------------------------------------------------------------------------------------------------------------------

export interface LlamadaDeEscritura {
  metodo: 'writeHead' | 'write' | 'end';
  /** El valor de `x-prueba-corte` de la petición de la respuesta (`this.req`), o `undefined` si no lleva la cabecera. */
  corte: string | undefined;
}

export interface EspiaDeEscritura {
  /** Las llamadas a `writeHead`, `write` y `end` de las respuestas cuya petición lleva la cabecera `x-prueba-corte` con el valor `corte`. */
  llamadasDe(corte: string): LlamadaDeEscritura[];
  /** Las de todas las descargas marcadas con `x-prueba-corte` cuyo valor empieza por `prefijo`. */
  llamadasConPrefijo(prefijo: string): LlamadaDeEscritura[];
  restaurar(): void;
}

/**
 * `vi.spyOn` sobre `writeHead`, `write` y `end` de `http.ServerResponse.prototype` (criterio 55 f). Deja pasar las llamadas (el espía solo mira) y,
 * al leerlas, filtra por la cabecera `x-prueba-corte` de `this.req`. Hay que llamar a `restaurar()` al final de la prueba.
 */
export function espiarEscrituras(): EspiaDeEscritura {
  const prototipo = http.ServerResponse.prototype;
  const espias = {
    writeHead: vi.spyOn(prototipo, 'writeHead'),
    write: vi.spyOn(prototipo, 'write'),
    end: vi.spyOn(prototipo, 'end'),
  };
  const todas = (): LlamadaDeEscritura[] => {
    const lista: LlamadaDeEscritura[] = [];
    for (const [metodo, espia] of Object.entries(espias) as [LlamadaDeEscritura['metodo'], (typeof espias)['end']][]) {
      for (const contexto of espia.mock.contexts) {
        const cabecera = (contexto as http.ServerResponse | undefined)?.req?.headers?.[CABECERA_DE_CORTE];
        lista.push({ metodo, corte: Array.isArray(cabecera) ? cabecera.join(', ') : cabecera });
      }
    }
    return lista;
  };
  return {
    llamadasDe: (corte) => todas().filter((llamada) => llamada.corte === corte),
    llamadasConPrefijo: (prefijo) => todas().filter((llamada) => llamada.corte?.startsWith(prefijo)),
    restaurar: () => {
      for (const espia of Object.values(espias)) espia.mockRestore();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// El bloqueo de la verificación de la sesión
// ---------------------------------------------------------------------------------------------------------------------

export interface BloqueoDeUsuarios {
  /**
   * Espera, hasta `ms`, a que haya al menos `n` conexiones del rol de la app esperando el bloqueo de la prueba: la verificación de la sesión
   * retenida. Devuelve cuántas vio.
   *
   * La spec dice "`wait_event_type = 'Lock'` en `pg_stat_activity`", pero el dueño de las tablas no es miembro del rol de la app y PostgreSQL le
   * oculta `state`, `wait_event_type` y `query` de sus conexiones (salen `NULL`). Lo que sí ve es el `pid`, y `pg_blocking_pids(pid)` dice a quién
   * espera cada conexión: es la misma observación ("esa conexión espera un bloqueo", en concreto el nuestro) y no depende de los privilegios.
   */
  esperarVerificaciones(n: number, ms: number): Promise<number>;
  /** Termina la transacción del bloqueo (`ROLLBACK`) y suelta `usuarios`. Se puede llamar más de una vez. */
  soltar(): Promise<void>;
}

/**
 * Criterio 55 f, caso 1, paso 1: una transacción del dueño de las tablas toma `LOCK TABLE usuarios IN ACCESS EXCLUSIVE MODE` y no termina hasta que
 * la prueba la suelte. La verificación de la sesión del middleware lee `usuarios` sin bloqueo, y solo la retiene ese modo.
 *
 * El bloqueo NUNCA queda tomado si la prueba falla: se suelta en un `finally` (`ROLLBACK` y cierre de la conexión), y la sesión del bloqueo además
 * lleva `lock_timeout` e `idle_in_transaction_session_timeout`, así que PostgreSQL la termina sola si el proceso de la prueba muere.
 */
export async function conUsuariosBloqueada<T>(trabajo: (bloqueo: BloqueoDeUsuarios) => Promise<T>): Promise<T> {
  const rolDeLaApp = decodeURIComponent(new URL(urlAppPruebas()).username);
  const vigia = new pg.Client({ connectionString: urlPropietarioPruebas() });
  const duenio = new pg.Client({ connectionString: urlPropietarioPruebas() });
  duenio.on('error', () => undefined);
  vigia.on('error', () => undefined);
  let conectadoDuenio = false;
  let conectadoVigia = false;
  let soltada = false;
  const soltar = async () => {
    if (soltada) return;
    soltada = true;
    await duenio.query('ROLLBACK').catch(() => undefined);
  };
  try {
    await vigia.connect();
    conectadoVigia = true;
    await duenio.connect();
    conectadoDuenio = true;
    await duenio.query('BEGIN');
    await duenio.query("SET LOCAL lock_timeout = '10s'");
    await duenio.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
    await duenio.query('LOCK TABLE usuarios IN ACCESS EXCLUSIVE MODE');
    const pidDelBloqueo = Number(
      ((await duenio.query('SELECT pg_backend_pid() AS pid')).rows[0] as { pid: number }).pid,
    );
    return await trabajo({
      soltar,
      esperarVerificaciones: async (n, ms) => {
        let vistas = 0;
        await esperarQue(async () => {
          const { rows } = await vigia.query(
            `SELECT count(*)::int AS n
               FROM pg_stat_activity
              WHERE datname = current_database() AND usename = $1 AND $2::int = ANY(pg_blocking_pids(pid))`,
            [rolDeLaApp, pidDelBloqueo],
          );
          vistas = (rows[0] as { n: number }).n;
          return vistas >= n;
        }, ms);
        return vistas;
      },
    });
  } finally {
    if (conectadoDuenio) {
      await soltar();
      await duenio.end().catch(() => undefined);
    }
    if (conectadoVigia) await vigia.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Advertencias del proceso
// ---------------------------------------------------------------------------------------------------------------------

export interface VigiaDeAdvertencias {
  /** Las advertencias `MaxListenersExceededWarning` que emitió `process` desde que empezó la vigilancia. */
  maximoDeOyentes(): string[];
  detener(): void;
}

/** Escucha `process.on('warning')` para ver si algún `EventEmitter` (por ejemplo, el socket de una conexión keep-alive) acumuló oyentes. */
export function vigilarAdvertencias(): VigiaDeAdvertencias {
  const vistas: string[] = [];
  const alAdvertir = (advertencia: Error) => {
    if (advertencia.name === 'MaxListenersExceededWarning') vistas.push(advertencia.message);
  };
  process.on('warning', alAdvertir);
  return {
    maximoDeOyentes: () => [...vistas],
    detener: () => {
      process.off('warning', alAdvertir);
    },
  };
}
