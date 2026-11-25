import type { PinoLogger } from 'nestjs-pino';
import type { AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { tipoDeError } from '../../infraestructura/correo';

const MENSAJE_DE_FOTO = 'No se pudo leer la foto del alumno';

/**
 * `data:image/jpeg;base64,…` con los bytes de la foto guardada del alumno, o `null` sin foto o si no se puede leer (DT-13 de la 008: «Foto
 * pendiente»). Se lee del almacén con la academia de la sesión y **fuera de toda transacción** (DT-6 de la 008, DT-11 de la 009). Si falla, queda un
 * `warn` solo con la academia y el tipo del error: el mensaje del error lleva la ruta del archivo y la clave no se registra.
 *
 * La usan el carnet (008) y el marcado de asistencia (009): una sola lectura, un solo aviso, el mismo contrato.
 */
export async function leerFotoComoData(
  almacen: AlmacenArchivos,
  registro: PinoLogger,
  academiaId: string,
  clave: string | null,
): Promise<string | null> {
  if (clave === null) return null;
  try {
    const bytes = await almacen.leer(academiaId, clave);
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch (error) {
    // Solo el tipo del error: su mensaje lleva la ruta del archivo.
    registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, MENSAJE_DE_FOTO);
    return null;
  }
}
