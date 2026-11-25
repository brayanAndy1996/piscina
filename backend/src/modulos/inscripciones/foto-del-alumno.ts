import { randomUUID } from 'node:crypto';
import { FOTO_LADO_GUARDADO, type FotoTipo } from '@aquagestion/contratos';
import type { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { recodificarImagen } from '../../comun/http/recodificar-imagen';
import type { AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { tipoDeError } from '../../infraestructura/correo';
import {
  type BaseDatos,
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import type { Reloj } from '../../infraestructura/reloj';

/** Lo máximo que espera la relectura de `resolverConfirmacionIncierta` a que termine la transacción de confirmación (criterio 64 de 005). */
const FOTO_ESPERA_RELECTURA_MS = 5000;

/**
 * Los rechazos que decide la propia transacción de la foto (409, 404, 401, o la academia): con ellos es seguro que no se confirmó nada y el archivo
 * nuevo no lo referencia nadie. El 401 es el de `bloquearActorVigente` (008b, criterio 25).
 */
function esRechazoDeLaTransaccion(error: unknown): boolean {
  if (error instanceof ErrorAcademiaNoEncontrada || error instanceof ErrorAcademiaSuspendida) return true;
  return (
    error instanceof ErrorNegocio &&
    (error.codigo === 'SOLICITUD_NO_EDITABLE' ||
      error.codigo === 'SOLICITUD_NO_ENCONTRADA' ||
      error.codigo === 'NO_ENCONTRADO' ||
      error.codigo === 'NO_AUTENTICADO')
  );
}

/** Lo que necesita `reemplazarFotoDelAlumno` de quien la llama (los servicios de Nest se lo pasan; esta función no es de Nest). */
export interface DependenciasDeLaFoto {
  readonly baseDatos: BaseDatos;
  readonly reloj: Reloj;
  readonly almacen: AlmacenArchivos;
  readonly registro: PinoLogger;
}

export interface PedidoDeFoto {
  readonly academiaId: string;
  readonly alumnoId: string;
  /** La imagen aceptada por el lector binario, sin recodificar. */
  readonly cuerpo: Buffer;
  readonly tipo: FotoTipo;
  /**
   * La comprobación de cada ruta dentro de la transacción de escritura: los bloqueos que le tocan (siempre `alumnos` `FOR UPDATE`), la repetición
   * de sus comprobaciones (puede lanzar 401, 404 o 409) y devuelve la clave anterior de `foto_clave`. `ahora` es el instante de la transacción
   * (el mismo que se guarda en `actualizado_en`). Esta función guarda después `foto_clave` y `actualizado_en`.
   */
  readonly confirmar: (tx: TransaccionAcademia, ahora: Date) => Promise<string | null>;
  /** Opcional: lo que se escribe en la misma transacción después de guardar la clave (la auditoría de la foto del panel). Recibe la clave anterior. */
  readonly despuesDeGuardar?: (tx: TransaccionAcademia, ahora: Date, anterior: string | null) => Promise<void>;
  /** El mensaje del `info` de la subida correcta (con la academia): lo único que cambia entre la foto pública y las del panel. */
  readonly mensajeGuardada: string;
}

/**
 * Recodifica, guarda y reemplaza la foto de un alumno (spec 005b, criterios 34 a 37 y 61 a 64; 008b, criterio 25, DT-10). La usan la foto pública y
 * las dos del panel; cada una pone su comprobación previa (que va antes, sin tocar archivos) y su `confirmar` (que va dentro de la transacción).
 *
 * 1. La imagen se valida y se vuelve a codificar con `sharp` como JPEG de como mucho 800 píxeles de lado mayor, con la orientación aplicada y sin
 *    metadatos (EXIF, GPS, XMP, ICC, comentarios): lo guardado nunca es el archivo subido. Todo fuera de la transacción.
 * 2. Se guarda con una clave nueva del servidor, `academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`, **antes** de la transacción
 *    (un archivo sin referencia no lo ve nadie; una referencia a un archivo que no existe, sí).
 * 3. Una transacción corta: `confirmar` (bloqueos y repetición de la comprobación), `foto_clave` y `actualizado_en`, y `despuesDeGuardar`.
 * 4. Después de confirmar se borra el archivo anterior; si la transacción la rechazó ella misma (401, 404, 409), se borra el nuevo. Con cualquier
 *    otro error no se sabe si el `COMMIT` llegó: se relee `foto_clave` y se decide con lo que se ve (criterio 61). Un borrado que falla solo
 *    deja un aviso con el tipo del error (nunca su mensaje, que lleva la ruta) y no cambia la respuesta.
 */
export async function reemplazarFotoDelAlumno(deps: DependenciasDeLaFoto, pedido: PedidoDeFoto): Promise<void> {
  const { baseDatos, reloj, almacen, registro } = deps;
  const { academiaId, alumnoId } = pedido;

  // Imagen (g de 005b, j de 008b), fuera de toda transacción.
  const jpeg = await recodificarImagen(pedido.cuerpo, pedido.tipo, FOTO_LADO_GUARDADO);

  const clave = `academias/${academiaId}/alumnos/${alumnoId}/foto-${randomUUID()}.jpg`;
  const guardado = await Promise.resolve()
    .then(() => almacen.guardar(academiaId, clave, jpeg, 'image/jpeg'))
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  if (!guardado.ok) {
    registro.error({ academiaId, error: { tipo: tipoDeError(guardado.error) } }, 'No se pudo guardar la foto');
    // Un error nuevo y sin causa: el del almacén lleva la ruta. La respuesta es 500 `ERROR_INTERNO` y la base no cambió.
    throw new Error('No se pudo guardar la foto del alumno.');
  }

  // La clave anterior se guarda fuera de `trabajo` en cuanto se lee: si `conAcademia` rechaza después (por ejemplo, el `COMMIT` se
  // aplicó y la conexión se cortó), la confirmación incierta todavía necesita saber qué archivo reemplazó (criterio 61 b1).
  const leida: { anterior: string | null } = { anterior: null };
  try {
    await baseDatos.conAcademia(academiaId, async (tx) => {
      const ahora = reloj.ahora();
      const anterior = await pedido.confirmar(tx, ahora);
      leida.anterior = anterior;
      await tx.cliente.$executeRaw`
        UPDATE alumnos SET foto_clave = ${clave}, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid`;
      if (pedido.despuesDeGuardar) await pedido.despuesDeGuardar(tx, ahora, anterior);
    });
  } catch (error) {
    if (esRechazoDeLaTransaccion(error)) {
      // Lo decidió la propia transacción (409, 404, 401, academia): es seguro que no se confirmó nada. El archivo nuevo no lo referencia nadie.
      await borrarSinFallar(deps, academiaId, clave);
      throw error;
    }
    await resolverConfirmacionIncierta(deps, pedido, clave, leida.anterior, error);
    return;
  }
  if (leida.anterior !== null && leida.anterior !== clave) await borrarSinFallar(deps, academiaId, leida.anterior);
  registro.info({ academiaId }, pedido.mensajeGuardada);
}

/**
 * La transacción de confirmación terminó con un error que no decidió ella (de la base, de la conexión, del `COMMIT`): no se sabe si el
 * `COMMIT` llegó (criterio 61 b de 005). No se borra ningún archivo todavía: se relee `foto_clave` en una transacción nueva de la academia que
 * no escribe nada, con `FOR SHARE` (espera a que la transacción de confirmación termine) y `lock_timeout` de `FOTO_ESPERA_RELECTURA_MS`
 * (criterio 64); no es `READ ONLY` porque PostgreSQL no admite `FOR SHARE` ahí. Si es la clave nueva, la foto quedó (204 y se borra la
 * anterior); si es otra cosa, no quedó (se borra la nueva y se relanza el error original, 500); si la relectura falla o la espera se agota
 * (`55P03`), no se borra nada y se relanza el error original (criterio 61 b3). La clave nueva lleva un UUID nuevo: si no
 * está ahora, no lo estará nunca, y borrarla es seguro.
 */
async function resolverConfirmacionIncierta(
  deps: DependenciasDeLaFoto,
  pedido: PedidoDeFoto,
  clave: string,
  anterior: string | null,
  errorOriginal: unknown,
): Promise<void> {
  const { baseDatos, registro } = deps;
  const { academiaId, alumnoId } = pedido;
  try {
    registro.warn({ academiaId, error: { tipo: tipoDeError(errorOriginal) } }, 'Confirmación de la foto incierta');
  } catch {
    // Un registro que falla no cambia la respuesta.
  }
  let guardada: boolean;
  try {
    guardada = await baseDatos.conAcademia(
      academiaId,
      async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ foto_clave: string | null }[]>`
          SELECT foto_clave FROM alumnos
           WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid
             FOR SHARE`;
        return filas[0]?.foto_clave === clave;
      },
      // `lock_timeout` local a esta transacción (como `SET LOCAL`, que los módulos no pueden ejecutar): la espera agotada es `55P03` y va a b3.
      { esperaMaximaDeBloqueoMs: FOTO_ESPERA_RELECTURA_MS },
    );
  } catch {
    // Ni la base ni la academia responden: no se sabe nada, no se borra nada (queda, como mucho, un archivo sin referencia).
    throw errorOriginal;
  }
  if (!guardada) {
    await borrarSinFallar(deps, academiaId, clave);
    throw errorOriginal;
  }
  if (anterior !== null && anterior !== clave) await borrarSinFallar(deps, academiaId, anterior);
  registro.info({ academiaId }, pedido.mensajeGuardada);
}

/** Borra un archivo después de confirmar (o tras un fallo): un borrado que falla deja un aviso con el tipo del error y nada más. */
async function borrarSinFallar(deps: DependenciasDeLaFoto, academiaId: string, clave: string): Promise<void> {
  try {
    await deps.almacen.borrar(academiaId, clave);
  } catch (error) {
    try {
      deps.registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, 'No se pudo borrar un archivo');
    } catch {
      // Un registro que falla no cambia la respuesta.
    }
  }
}
