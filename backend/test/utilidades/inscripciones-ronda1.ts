// spec: 005-inscripcion-publica (pruebas protegidas)
import http from 'node:http';
import {
  type AppInscripciones,
  crearAppInscripciones,
  EnviadorDePrueba,
  type MensajeDeCorreo,
  type Objeto,
  type OpcionesAppInscripciones,
  type RespuestaApi,
} from './inscripciones';

/**
 * Utilidades de las pruebas protegidas de la ronda 1 de la 005a (criterios 49 a 60). Solo usan HTTP, SQL y los contratos públicos:
 * no importan nada de la implementación.
 *
 * - `crearAppConIpPorCabecera`: la misma aplicación de `crearAppInscripciones` con `trust proxy` en `loopback` (plan, sección 15):
 *   `req.ip` sale de `X-Forwarded-For`, tal cual, sin normalizar. La aplicación real no cambia (DT-9).
 * - `pedir`: una petición HTTP cruda (también `HEAD` y cabeceras que `fetch` podría descartar, como `Referer`).
 * - `EnviadorProgramable`: un `EnviadorCorreo` de prueba que registra cada llamada en el instante en que ocurre y se comporta como
 *   la prueba indique (bien, colgado, que rechaza o que lanza un error de forma síncrona).
 */

/** La aplicación de pruebas con la IP de cada petición fijada por `X-Forwarded-For` (solo viene de `127.0.0.1`, que es de confianza). */
export async function crearAppConIpPorCabecera(opciones: OpcionesAppInscripciones = {}): Promise<AppInscripciones> {
  const ctx = await crearAppInscripciones(opciones);
  ctx.app.set('trust proxy', 'loopback');
  return ctx;
}

/** Cabecera que fija la IP de una petición en una aplicación creada con `crearAppConIpPorCabecera`. */
export const desde = (ip: string): Record<string, string> => ({ 'x-forwarded-for': ip });

export interface OpcionesPedir {
  headers?: Record<string, string>;
  /** Cuerpo JSON (se serializa) o texto crudo con `crudo`. */
  cuerpo?: unknown;
}

function leerJson(texto: string): Objeto | null {
  if (!texto) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
  } catch {
    return null;
  }
}

/** Una petición HTTP cruda al servidor de la aplicación (cualquier método, cualquier cabecera). */
export function pedir(
  ctx: AppInscripciones,
  metodo: string,
  ruta: string,
  opciones: OpcionesPedir = {},
): Promise<RespuestaApi> {
  const { port } = ctx.app.getHttpServer().address() as { port: number };
  const headers: Record<string, string> = { ...opciones.headers };
  let cuerpo: string | undefined;
  if (opciones.cuerpo !== undefined) {
    cuerpo = JSON.stringify(opciones.cuerpo);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(cuerpo));
  }
  return new Promise<RespuestaApi>((resolver, rechazar) => {
    const peticion = http.request(
      { host: '127.0.0.1', port, method: metodo, path: ruta, headers, agent: false },
      (respuesta) => {
        const trozos: Buffer[] = [];
        respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
        respuesta.on('error', rechazar);
        respuesta.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8');
          const cabeceras = new Headers();
          for (const [nombre, valor] of Object.entries(respuesta.headers)) {
            if (Array.isArray(valor)) for (const v of valor) cabeceras.append(nombre, v);
            else if (valor !== undefined) cabeceras.set(nombre, valor);
          }
          resolver({
            status: respuesta.statusCode ?? 0,
            body: leerJson(texto),
            texto,
            headers: cabeceras,
            cacheControl: cabeceras.get('cache-control'),
          });
        });
      },
    );
    peticion.on('error', rechazar);
    if (cuerpo !== undefined) peticion.write(cuerpo);
    peticion.end();
  });
}

/** Lo que hace el `EnviadorCorreo` de prueba con un mensaje. */
export type AccionDeCorreo = 'ok' | 'colgar' | { rechazar: unknown } | { lanzar: unknown };

/**
 * `EnviadorCorreo` de prueba: registra el mensaje en el instante de la llamada y después hace lo que diga `accion`:
 * `'ok'` (se resuelve), `'colgar'` (su promesa no se resuelve hasta `liberar()`), `{ rechazar }` (su promesa se rechaza con ese valor)
 * o `{ lanzar }` (lanza ese valor de forma síncrona). `alLlamar` se ejecuta en el mismo instante de la llamada, antes de `accion`.
 */
export class EnviadorProgramable extends EnviadorDePrueba {
  accion: (mensaje: MensajeDeCorreo) => AccionDeCorreo = () => 'ok';
  alLlamar?: (mensaje: MensajeDeCorreo) => void;
  private readonly colgados: (() => void)[] = [];

  override enviar(mensaje: MensajeDeCorreo): Promise<void> {
    this.mensajes.push(mensaje);
    this.alLlamar?.(mensaje);
    const accion = this.accion(mensaje);
    if (accion === 'ok') return Promise.resolve();
    if (accion === 'colgar') {
      return new Promise<void>((resolver) => {
        this.colgados.push(resolver);
      });
    }
    if ('lanzar' in accion) throw accion.lanzar;
    // La prueba rechaza a propósito con cualquier valor (un texto, un objeto, un error…).
    return (async () => {
      await Promise.resolve();
      throw accion.rechazar;
    })();
  }

  /** Resuelve las promesas colgadas (al terminar cada prueba, para no dejar peticiones abiertas si la implementación las espera). */
  liberar(): void {
    for (const resolver of this.colgados.splice(0)) resolver();
  }

  reiniciar(): void {
    this.liberar();
    this.mensajes.length = 0;
    this.accion = () => 'ok';
    this.alLlamar = undefined;
    this.alEnviar = undefined;
    this.fallar = false;
  }
}

/** Espera `promesa` como mucho `limiteMs`; si no llega, falla con `mensaje` (sin dejar un temporizador vivo). */
export async function conPlazo<T>(promesa: Promise<T>, limiteMs: number, mensaje: string): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), limiteMs);
  });
  try {
    return await Promise.race([promesa, vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Mide cuánto tarda una promesa en resolverse (con `conPlazo`). */
export async function medir<T>(
  promesa: Promise<T>,
  limiteMs: number,
  mensaje: string,
): Promise<{ valor: T; ms: number }> {
  const inicio = performance.now();
  const valor = await conPlazo(promesa, limiteMs, mensaje);
  return { valor, ms: performance.now() - inicio };
}

/** Deja pasar el ciclo de eventos varias veces (para que un `unhandledRejection` o un `uncaughtException` pendiente se emita). */
export async function dejarPasarEventos(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolver) => setImmediate(resolver));
  await new Promise<void>((resolver) => setTimeout(resolver, 100));
}

/** Los valores que llegaron a `process` como `unhandledRejection` o `uncaughtException` mientras corre `trabajo`. */
export async function observarErroresDeProceso(trabajo: () => Promise<void>): Promise<unknown[]> {
  const eventos: unknown[] = [];
  const alEvento = (valor: unknown): void => {
    eventos.push(valor);
  };
  process.on('unhandledRejection', alEvento);
  process.on('uncaughtException', alEvento);
  try {
    await trabajo();
    await dejarPasarEventos();
  } finally {
    process.off('unhandledRejection', alEvento);
    process.off('uncaughtException', alEvento);
  }
  return eventos;
}
