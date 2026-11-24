// spec: 006-caja (pruebas protegidas)
import * as indiceDeCaja from '../../src/modulos/caja/index';
import { type AppHistorial, type GeneradorDePrueba, PDF_FALSO, type RespuestaHistorial } from './caja-historial';
import { LIMITE_DE_SEGURIDAD_MS } from './carreras';
import { observar } from './planes-clases';

/**
 * Utilidades de las pruebas protegidas de los criterios 51 a 53 de la 006b (ronda adversarial 2): una descarga que se puede cortar, un generador del
 * PDF retenido que anota la `AbortSignal` de cada llamada (en un modo que la respeta y en otro que la ignora) y un espía que delega en el
 * `generarPdfCierre` verdadero con la misma señal. Se suman a `caja-historial.ts` y a `caja-pdf-concurrencia.ts` sin tocarlos.
 *
 * Solo usan el contrato público de la spec (criterio 51 c): `GeneradorPdfCierre.generar(datos, senal?)` y `generarPdfCierre(datos, senal?)`. Lo que
 * todavía no existe se busca sin romper la importación: la prueba falla con un mensaje claro.
 */

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

// ---------------------------------------------------------------------------------------------------------------------
// Errores de aborto
// ---------------------------------------------------------------------------------------------------------------------

/** Un error cuyo `name` es `'AbortError'`, como el que debe producir un generador que respeta la señal. */
export function errorDeAborto(mensaje = 'Generación abortada por la prueba'): Error {
  return new DOMException(mensaje, 'AbortError');
}

/** `true` si `error` es un error de aborto (`name === 'AbortError'`). */
export function esErrorDeAborto(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

// ---------------------------------------------------------------------------------------------------------------------
// Esperas
// ---------------------------------------------------------------------------------------------------------------------

/** Espera, hasta `ms`, a que `condicion` sea verdadera (la revisa cada 5 ms). Devuelve si se cumplió. */
export async function esperarCondicion(condicion: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const limite = Date.now() + ms;
  for (;;) {
    if (await condicion()) return true;
    if (Date.now() >= limite) return false;
    await pausa(5);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// El generador retenido que anota la señal
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Qué hace el generador con la `AbortSignal` que recibe como segundo parámetro:
 * - `respeta`: rechaza su promesa con un `AbortError` en cuanto la señal se activa (o enseguida, si ya llega activa);
 * - `ignora`: no la mira; la llamada sigue retenida hasta que la prueba la suelta.
 */
export type ModoDeSenal = 'respeta' | 'ignora';

export interface LlamadaConSenal {
  /** Posición de la llamada (0, 1, 2…) en el orden en que llegó. */
  indice: number;
  /** Los `DatosPdfCierre` de la llamada. */
  datos: unknown;
  /** La señal recibida como segundo parámetro, o `undefined` si el servicio no la pasó. */
  senal: AbortSignal | undefined;
  estado: 'en-curso' | 'resuelta' | 'rechazada';
  error?: unknown;
}

/** Los `datos` de una llamada como el objeto mínimo que las pruebas miran: el id de la caja y el nombre de la academia. */
export function datosDeLlamada(llamada: { datos: unknown }): { academia: string; caja: { id: string; fecha: string } } {
  return llamada.datos as { academia: string; caja: { id: string; fecha: string } };
}

export class GeneradorConSenal {
  modo: ModoDeSenal;
  readonly llamadas: LlamadaConSenal[] = [];
  /** Cuántas llamadas hay en curso ahora (desde que `generar` se invoca hasta que su promesa termina). */
  enCurso = 0;
  /** El mayor número de llamadas en curso a la vez desde el último `restablecer()`. */
  maximoEnCurso = 0;
  private readonly retenidas = new Map<number, () => void>();
  private libre = false;

  constructor(modo: ModoDeSenal = 'respeta') {
    this.modo = modo;
  }

  /** Lo que se instala con `overrideProvider(GENERADOR_PDF_CIERRE).useValue(...)`: la interfaz `GeneradorPdfCierre` con la señal opcional. */
  readonly proveedor = {
    generar: (datos: unknown, senal?: AbortSignal): Promise<Buffer> => this.generar(datos, senal),
  };

  private generar(datos: unknown, senal?: AbortSignal): Promise<Buffer> {
    const llamada: LlamadaConSenal = { indice: this.llamadas.length, datos, senal, estado: 'en-curso' };
    this.llamadas.push(llamada);
    this.enCurso += 1;
    this.maximoEnCurso = Math.max(this.maximoEnCurso, this.enCurso);
    const respeta = this.modo === 'respeta';
    return new Promise<Buffer>((resolver, rechazar) => {
      if (this.libre) {
        resolver(PDF_FALSO);
        return;
      }
      this.retenidas.set(llamada.indice, () => resolver(PDF_FALSO));
      if (respeta && senal) {
        if (senal.aborted) rechazar(errorDeAborto());
        else senal.addEventListener('abort', () => rechazar(errorDeAborto()), { once: true });
      }
    })
      .then(
        (pdf) => {
          llamada.estado = 'resuelta';
          return pdf;
        },
        (error: unknown) => {
          llamada.estado = 'rechazada';
          llamada.error = error;
          throw error;
        },
      )
      .finally(() => {
        this.retenidas.delete(llamada.indice);
        this.enCurso -= 1;
      });
  }

  /** Cuántas llamadas hay retenidas ahora (sin soltar y sin abortar). */
  get retenidasAhora(): number {
    return this.retenidas.size;
  }

  /** Resuelve la llamada `indice`, si sigue retenida. Devuelve si la soltó. */
  soltar(indice: number): boolean {
    const soltar = this.retenidas.get(indice);
    if (!soltar) return false;
    this.retenidas.delete(indice);
    soltar();
    return true;
  }

  /** Resuelve la llamada retenida más antigua. Devuelve su índice, o `-1` si no hay ninguna. */
  soltarUno(): number {
    const [indice] = [...this.retenidas.keys()].sort((a, b) => a - b);
    if (indice === undefined) return -1;
    this.soltar(indice);
    return indice;
  }

  /** Resuelve todas las llamadas retenidas ahora. Devuelve cuántas soltó; las que lleguen después quedan retenidas. */
  soltarTodo(): number {
    const todas = [...this.retenidas.keys()];
    for (const indice of todas) this.soltar(indice);
    return todas.length;
  }

  /** Vuelve al estado inicial: modo `respeta`, sin llamadas ni máximo registrados, y suelta lo que haya retenido. */
  restablecer(): void {
    this.libre = false;
    this.modo = 'respeta';
    this.llamadas.length = 0;
    this.maximoEnCurso = 0;
    this.soltarTodo();
  }

  /** Para el final de una prueba, también si falló: lo retenido se suelta y lo que llegue después se resuelve enseguida. */
  liberar(): void {
    this.libre = true;
    this.soltarTodo();
  }

  /** Espera, con el límite de seguridad, a que el generador haya recibido al menos `n` llamadas. */
  async esperarLlamadas(n: number): Promise<void> {
    const llegaron = await esperarCondicion(() => this.llamadas.length >= n, LIMITE_DE_SEGURIDAD_MS);
    if (!llegaron) {
      throw new Error(
        `Límite de seguridad: el generador del PDF no llegó a ${n} llamada(s) (recibió ${this.llamadas.length}, ${this.enCurso} en curso).`,
      );
    }
  }

  /** Espera, con el límite de seguridad, a que haya al menos `n` llamadas en curso a la vez. */
  async esperarEnCurso(n: number): Promise<void> {
    const llegaron = await esperarCondicion(() => this.enCurso >= n, LIMITE_DE_SEGURIDAD_MS);
    if (!llegaron) {
      throw new Error(
        `Límite de seguridad: el generador del PDF no llegó a ${n} llamada(s) en curso (tiene ${this.enCurso}, recibió ${this.llamadas.length}).`,
      );
    }
  }

  /**
   * Suelta por oleadas lo que el generador retenga hasta que todas las promesas terminen o se cumpla el límite de seguridad. Devuelve `true` si
   * todas terminaron.
   */
  async soltarHastaQueTerminen(promesas: readonly Promise<unknown>[]): Promise<boolean> {
    let pendientes = promesas.length;
    for (const promesa of promesas) {
      void promesa.then(
        () => (pendientes -= 1),
        () => (pendientes -= 1),
      );
    }
    const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
    while (pendientes > 0 && Date.now() <= limite) {
      this.soltarTodo();
      await pausa(5);
    }
    return pendientes === 0;
  }
}

/** El generador de pruebas con el tipo que `crearAppHistorial` espera (instala solo `generador.proveedor`). */
export function comoGeneradorDePrueba(generador: { proveedor: unknown }): GeneradorDePrueba {
  return generador as unknown as GeneradorDePrueba;
}

// ---------------------------------------------------------------------------------------------------------------------
// El espía que delega en el generador real
// ---------------------------------------------------------------------------------------------------------------------

/** `generarPdfCierre(datos, senal?)` (criterio 51 c), reexportada en `caja/index.ts`. */
function generadorRealConSenal(): (datos: unknown, senal?: AbortSignal) => Promise<Buffer> {
  const real = (indiceDeCaja as unknown as Record<string, unknown>)['generarPdfCierre'];
  if (typeof real !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 006b: "backend/src/modulos/caja/index.ts" no exporta generarPdfCierre.',
    );
  }
  return real as (datos: unknown, senal?: AbortSignal) => Promise<Buffer>;
}

export interface LlamadaEspiada {
  indice: number;
  datos: unknown;
  senal: AbortSignal | undefined;
  estado: 'en-curso' | 'resuelta' | 'rechazada';
  error?: unknown;
  /** `performance.now()`-like en milisegundos (`Date.now()`) al llamar y al terminar. */
  inicio: number;
  fin?: number;
}

/**
 * Un generador que delega en `generarPdfCierre` con la misma señal que recibe y anota cómo terminó cada llamada. Sirve para ver si el generador real
 * aborta de verdad (criterio 51 b): una llamada abortada queda `rechazada` con un `AbortError`; una que ignora la señal queda `resuelta`.
 */
export class EspiaDelGeneradorReal {
  readonly llamadas: LlamadaEspiada[] = [];

  readonly proveedor = {
    generar: (datos: unknown, senal?: AbortSignal): Promise<Buffer> => this.generar(datos, senal),
  };

  private generar(datos: unknown, senal?: AbortSignal): Promise<Buffer> {
    const llamada: LlamadaEspiada = {
      indice: this.llamadas.length,
      datos,
      senal,
      estado: 'en-curso',
      inicio: Date.now(),
    };
    this.llamadas.push(llamada);
    return generadorRealConSenal()(datos, senal).then(
      (pdf) => {
        llamada.estado = 'resuelta';
        llamada.fin = Date.now();
        return pdf;
      },
      (error: unknown) => {
        llamada.estado = 'rechazada';
        llamada.error = error;
        llamada.fin = Date.now();
        throw error;
      },
    );
  }

  get enCurso(): number {
    return this.llamadas.filter((l) => l.estado === 'en-curso').length;
  }

  restablecer(): void {
    this.llamadas.length = 0;
  }

  /** Espera, con el límite de seguridad, a que haya al menos `n` llamadas en curso a la vez. */
  async esperarEnCurso(n: number): Promise<void> {
    const llegaron = await esperarCondicion(() => this.enCurso >= n, LIMITE_DE_SEGURIDAD_MS);
    if (!llegaron) {
      throw new Error(
        `Límite de seguridad: el generador real no llegó a ${n} llamada(s) en curso (tiene ${this.enCurso}, recibió ${this.llamadas.length}).`,
      );
    }
  }

  /** Espera hasta `ms` a que ninguna llamada siga en curso. Devuelve si terminaron todas. */
  esperarQueTerminen(ms: number): Promise<boolean> {
    return esperarCondicion(() => this.enCurso === 0, ms);
  }

  /** Un resumen legible de cómo va cada llamada, para los mensajes de las pruebas. */
  resumen(): string {
    return this.llamadas
      .map((l) => `#${l.indice}: ${l.estado}${l.error ? ` (${(l.error as Error).name})` : ''}`)
      .join(', ');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// La descarga que se puede cortar
// ---------------------------------------------------------------------------------------------------------------------

export interface DescargaCortable {
  /** La respuesta, o un rechazo si la descarga se cortó antes de que terminara. */
  resultado: Promise<RespuestaHistorial>;
  /** `true` cuando ya terminó (con respuesta o cortada). */
  terminada(): boolean;
  /** Corta la conexión como lo haría el cliente: el servidor ve el `close` de la respuesta sin que termine de enviarse. */
  cortar(): void;
  /** `true` si la prueba cortó esta descarga. */
  cortada(): boolean;
}

function leerJsonSeguro(texto: string): Record<string, unknown> | null {
  if (!texto) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * `GET` de `ruta` con la cookie dada, que la prueba puede cortar (`cortar()`): usa `fetch` con un `AbortController`, y undici cierra la conexión al
 * abortar (criterio 51 e). Si se corta, `resultado` se rechaza con un error de aborto.
 */
export function descargaCortable(app: AppHistorial['app'], ruta: string, cookie: string): DescargaCortable {
  const controlador = new AbortController();
  const puerto = (app.getHttpServer().address() as { port: number }).port;
  const peticion = (async (): Promise<RespuestaHistorial> => {
    const respuesta = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
      method: 'GET',
      headers: { cookie },
      signal: controlador.signal,
    });
    const crudo = Buffer.from(await respuesta.arrayBuffer());
    const texto = crudo.toString('utf8');
    return {
      status: respuesta.status,
      body: leerJsonSeguro(texto),
      texto,
      cacheControl: respuesta.headers.get('cache-control'),
      headers: respuesta.headers,
      cuerpo: crudo,
    };
  })();
  const observada = observar(peticion);
  let cortada = false;
  return {
    resultado: observada.resultado,
    terminada: observada.terminada,
    cortar: () => {
      cortada = true;
      controlador.abort();
    },
    cortada: () => cortada,
  };
}
