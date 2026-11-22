// spec: 006-caja (pruebas protegidas)
import { PDF_FALSO } from './caja-historial';
import { LIMITE_DE_SEGURIDAD_MS } from './carreras';

/**
 * Utilidades de las pruebas protegidas del criterio 49 b y c de la 006b (ronda adversarial 1): el generador del PDF reemplazable que cuenta cuántas
 * llamadas tiene en curso y puede retener varias a la vez. Se suma a `caja-historial.ts` sin tocarlo: el `GeneradorDePrueba` de allí retiene una
 * sola llamada (la última pisa a la anterior), y el criterio 49 necesita retener diez y medir el máximo de llamadas simultáneas.
 *
 * Solo usa el contrato público (PQ8): la interfaz `GeneradorPdfCierre { generar(datos): Promise<Buffer> }` que se instala con
 * `overrideProvider(GENERADOR_PDF_CIERRE).useValue(generador.proveedor)`. Una llamada está "en curso" desde que `generar` se invoca hasta que su
 * promesa termina (o hasta que lanza, si falla sin devolver ninguna promesa).
 */

/**
 * Qué hace el generador al llamarlo, con los mismos nombres que `ModoDelGenerador` de `caja-historial.ts`:
 * - `falso`: devuelve `PDF_FALSO` enseguida;
 * - `retiene`: devuelve una promesa que la prueba resuelve después con `soltarTodo()` (con `PDF_FALSO`: estas pruebas no miran el contenido);
 * - `rechaza`: devuelve una promesa rechazada;
 * - `lanza`: lanza una excepción al llamarlo, sin devolver ninguna promesa.
 */
export type ModoDelGeneradorMultiple = 'falso' | 'retiene' | 'rechaza' | 'lanza';

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export class GeneradorMultiple {
  modo: ModoDelGeneradorMultiple = 'retiene';
  /** Los datos (`DatosPdfCierre`) de cada llamada, en orden. */
  readonly llamadas: unknown[] = [];
  /** Cuántas llamadas hay en curso ahora. */
  enCurso = 0;
  /** El mayor número de llamadas en curso a la vez desde el último `restablecer()`. */
  maximoEnCurso = 0;
  private readonly retenidas: (() => void)[] = [];

  /** Lo que se instala con `overrideProvider(GENERADOR_PDF_CIERRE).useValue(...)`: la interfaz `GeneradorPdfCierre`. */
  readonly proveedor = { generar: (datos: unknown): Promise<Buffer> => this.generar(datos) };

  private generar(datos: unknown): Promise<Buffer> {
    this.llamadas.push(datos);
    this.enCurso += 1;
    this.maximoEnCurso = Math.max(this.maximoEnCurso, this.enCurso);
    const terminar = () => {
      this.enCurso -= 1;
    };
    switch (this.modo) {
      case 'falso':
        return Promise.resolve(PDF_FALSO).finally(terminar);
      case 'rechaza':
        return Promise.reject(new Error('Falla simulada del generador del PDF (promesa rechazada)')).finally(terminar);
      case 'lanza':
        terminar();
        throw new Error('Falla simulada del generador del PDF (excepción al llamarlo)');
      case 'retiene':
        return new Promise<Buffer>((resolver) => {
          this.retenidas.push(() => resolver(PDF_FALSO));
        }).finally(terminar);
    }
  }

  /** Cuántas llamadas hay retenidas ahora (sin soltar). */
  get retenidasAhora(): number {
    return this.retenidas.length;
  }

  /** Resuelve todas las llamadas retenidas ahora. Devuelve cuántas soltó; las que lleguen después quedan retenidas. */
  soltarTodo(): number {
    const lista = this.retenidas.splice(0, this.retenidas.length);
    for (const soltar of lista) soltar();
    return lista.length;
  }

  /** Vuelve al estado inicial: modo `retiene`, sin llamadas ni máximo registrados, y suelta lo que haya retenido. */
  restablecer(): void {
    this.modo = 'retiene';
    this.llamadas.length = 0;
    this.maximoEnCurso = 0;
    this.soltarTodo();
  }

  /** Para el final de una prueba, también si falló: lo que llegue después se resuelve enseguida y lo retenido se suelta. */
  liberar(): void {
    this.modo = 'falso';
    this.soltarTodo();
  }

  /** Espera, con el límite de seguridad, a que haya al menos `n` llamadas en curso a la vez. */
  async esperarEnCurso(n: number): Promise<void> {
    const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
    while (this.enCurso < n) {
      if (Date.now() > limite) {
        throw new Error(
          `Límite de seguridad: el generador del PDF no llegó a ${n} llamada(s) en curso (tiene ${this.enCurso}, recibió ${this.llamadas.length}).`,
        );
      }
      await pausa(5);
    }
  }

  /**
   * Suelta por oleadas lo que el generador retenga (las descargas que esperaban turno van llegando) hasta que todas las promesas terminen o se
   * cumpla el límite de seguridad. Devuelve `true` si todas terminaron.
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

/** Espera `promesa` hasta `ms` milisegundos: devuelve su valor, o `undefined` si todavía no terminó (sin cancelarla). */
export async function esperarHasta<T>(promesa: Promise<T>, ms: number): Promise<T | undefined> {
  let temporizador: NodeJS.Timeout | undefined;
  const vencido = new Promise<undefined>((resolver) => {
    temporizador = setTimeout(() => resolver(undefined), ms);
  });
  try {
    return await Promise.race([promesa, vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

export { pausa };
