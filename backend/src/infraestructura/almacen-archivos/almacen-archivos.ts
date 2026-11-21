/** Token para inyectar el almacén de archivos: `@Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos` (PB7 de 005). */
export const ALMACEN_ARCHIVOS = Symbol('ALMACEN_ARCHIVOS');

/** Los tipos de medio de las imágenes que se guardan. */
export type TipoDeArchivo = 'image/jpeg' | 'image/png';

/**
 * Almacén de archivos detrás de una interfaz (D-21): la implementación de disco local sirve hoy; con el hosting se cambia por la
 * real sin tocar los servicios. Recibe siempre la academia y una clave que genera el servidor (`academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`),
 * nunca un nombre que venga del cliente (spec 005, criterio 36).
 *
 * Los efectos sobre archivos ocurren fuera de la transacción de la base: el servicio guarda antes de confirmar y borra después (criterio 37).
 * Toda operación con una clave que no cumple el formato, de otra academia o que sale de la carpeta de la academia devuelve una promesa
 * rechazada, sin tocar ningún archivo.
 */
export interface AlmacenArchivos {
  guardar(academiaId: string, clave: string, contenido: Buffer, tipo: TipoDeArchivo): Promise<void>;
  /** Una clave válida que no existe: rechaza. */
  leer(academiaId: string, clave: string): Promise<Buffer>;
  /** Una clave válida que no existe: resuelve (borrar es idempotente). */
  borrar(academiaId: string, clave: string): Promise<void>;
}
