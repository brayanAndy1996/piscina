import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AlmacenArchivos, TipoDeArchivo } from './almacen-archivos';

/**
 * Un rechazo del almacén. Su mensaje es fijo y nunca lleva la ruta ni la clave: el registro técnico solo guarda el tipo del error
 * (criterios 36 y 37).
 */
export class ErrorDeAlmacenArchivos extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeAlmacenArchivos';
  }
}

const LARGO_MAXIMO_DE_CLAVE = 255;
/** Un UUID en minúsculas: el `academiaId` que recibe el almacén y el que lleva la clave. */
const PATRON_UUID_MINUSCULAS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Cada segmento de la clave: sin `.` ni `..`, sin mayúsculas, espacios, `%`, `\`, `:` ni bytes nulos; con una sola extensión. */
const PATRON_SEGMENTO = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9]+)?$/;
const TIPOS: ReadonlySet<string> = new Set<TipoDeArchivo>(['image/jpeg', 'image/png']);

/** Los pasos de una clave ya validada: la carpeta de la academia, los segmentos que siguen y la ruta del archivo. */
interface RutaDeClave {
  readonly carpetaDeLaAcademia: string;
  readonly segmentos: readonly string[];
  readonly ruta: string;
}

/**
 * `AlmacenArchivos` sobre el disco local (spec 005, criterios 36 y 37; PB7). Escribe bajo `raiz`, en `academias/{academiaId}/…`.
 *
 * Una clave es válida si tiene como mucho 255 caracteres ASCII, empieza con `academias/{academiaId}/` (el mismo UUID en minúsculas que
 * recibe) y sigue con uno o más segmentos separados por `/` que cumplen `^[a-z0-9][a-z0-9_-]*(\.[a-z0-9]+)?$`. Todo lo demás (`..`,
 * rutas absolutas, separadores de Windows, bytes nulos, claves de otra academia) se rechaza antes de tocar el disco. Además se rechaza
 * si la ruta resuelta queda fuera de la carpeta de la academia o si esa carpeta, alguna carpeta debajo de ella o el propio archivo es un
 * enlace simbólico (en Windows, también una unión): así un enlace no lleva a la carpeta de otra academia. Ninguna operación lanza de
 * forma síncrona: todas devuelven una promesa rechazada.
 */
export class AlmacenArchivosDisco implements AlmacenArchivos {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = path.resolve(raiz);
  }

  async guardar(academiaId: string, clave: string, contenido: Buffer, tipo: TipoDeArchivo): Promise<void> {
    const destino = this.resolver(academiaId, clave);
    if (!TIPOS.has(tipo) || !Buffer.isBuffer(contenido)) throw new ErrorDeAlmacenArchivos('El archivo no es válido.');
    await this.exigirSinEnlaces(destino);
    // Las carpetas se crean y se vuelve a comprobar: un enlace que apareciera entre medio no deja escribir.
    await this.intentar('No se pudo guardar el archivo.', () =>
      fs.mkdir(path.dirname(destino.ruta), { recursive: true, mode: 0o700 }),
    );
    await this.exigirSinEnlaces(destino);
    // Primero un archivo temporal en la misma carpeta y después el cambio de nombre: nunca queda un archivo a medias con la clave final.
    const temporal = `${destino.ruta}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporal, contenido, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporal, destino.ruta);
    } catch {
      await fs.rm(temporal, { force: true }).catch(() => undefined);
      throw new ErrorDeAlmacenArchivos('No se pudo guardar el archivo.');
    }
  }

  async leer(academiaId: string, clave: string): Promise<Buffer> {
    const destino = this.resolver(academiaId, clave);
    await this.exigirSinEnlaces(destino);
    return this.intentar('No se pudo leer el archivo.', () => fs.readFile(destino.ruta));
  }

  async borrar(academiaId: string, clave: string): Promise<void> {
    const destino = this.resolver(academiaId, clave);
    await this.exigirSinEnlaces(destino);
    try {
      await fs.unlink(destino.ruta);
    } catch (error) {
      // Borrar es idempotente: una clave válida que no existe resuelve.
      if (!esAusente(error)) throw new ErrorDeAlmacenArchivos('No se pudo borrar el archivo.');
    }
  }

  /** Valida la clave y la academia y resuelve la ruta; lanza (dentro de la promesa de quien llama) si algo no cumple. */
  private resolver(academiaId: string, clave: string): RutaDeClave {
    if (typeof academiaId !== 'string' || !PATRON_UUID_MINUSCULAS.test(academiaId)) {
      throw new ErrorDeAlmacenArchivos('La academia no es válida.');
    }
    const prefijo = `academias/${academiaId}/`;
    if (typeof clave !== 'string' || clave.length > LARGO_MAXIMO_DE_CLAVE || !clave.startsWith(prefijo)) {
      throw new ErrorDeAlmacenArchivos('La clave del archivo no es válida.');
    }
    const segmentos = clave.slice(prefijo.length).split('/');
    if (!segmentos.every((segmento) => PATRON_SEGMENTO.test(segmento))) {
      throw new ErrorDeAlmacenArchivos('La clave del archivo no es válida.');
    }
    const carpetaDeLaAcademia = path.resolve(this.raiz, 'academias', academiaId);
    const ruta = path.resolve(carpetaDeLaAcademia, ...segmentos);
    if (!ruta.startsWith(carpetaDeLaAcademia + path.sep)) {
      throw new ErrorDeAlmacenArchivos('La clave del archivo no es válida.');
    }
    return { carpetaDeLaAcademia, segmentos, ruta };
  }

  /**
   * Rechaza si la carpeta de la academia, alguna carpeta debajo de ella o el propio archivo es un enlace simbólico (`lstat` no los
   * sigue). Lo que todavía no existe no puede ser un enlace: se deja de mirar en el primer paso que falta.
   */
  private async exigirSinEnlaces(destino: RutaDeClave): Promise<void> {
    const pasos = [destino.carpetaDeLaAcademia];
    for (const segmento of destino.segmentos) pasos.push(path.join(pasos[pasos.length - 1] ?? '', segmento));
    for (const paso of pasos) {
      try {
        const datos = await fs.lstat(paso);
        if (datos.isSymbolicLink()) throw new ErrorDeAlmacenArchivos('La ruta del archivo no es válida.');
      } catch (error) {
        if (error instanceof ErrorDeAlmacenArchivos) throw error;
        if (esAusente(error)) return;
        throw new ErrorDeAlmacenArchivos('No se pudo comprobar la ruta del archivo.');
      }
    }
  }

  /** Ejecuta una operación del sistema de archivos y, si falla, la convierte en un rechazo con un mensaje fijo (sin la ruta). */
  private async intentar<T>(mensaje: string, operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch {
      throw new ErrorDeAlmacenArchivos(mensaje);
    }
  }
}

/** `ENOENT` (no existe) y `ENOTDIR` (un tramo de la ruta es un archivo): para el almacén, el archivo no existe. */
function esAusente(error: unknown): boolean {
  const codigo = (error as { code?: unknown } | null)?.code;
  return codigo === 'ENOENT' || codigo === 'ENOTDIR';
}
