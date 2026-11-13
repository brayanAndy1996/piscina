import { ErrorNegocio } from '../../comun/errores';
import { causaLimpia } from './registro-de-errores';

export const MENSAJE_ROL_INSEGURO =
  'El rol de DATABASE_URL_APP no es seguro: tiene atributos o privilegios que le permiten saltarse la seguridad por ' +
  'academia (superusuario, BYPASSRLS, REPLICATION, CREATEROLE, CREATEDB, membresías, CREATE o TEMPORARY, o ser dueño ' +
  'de objetos). La API no atenderá datos hasta corregirlo.';

/** La academia no existe o el identificador no es un UUID. Se responde 404 `ACADEMIA_NO_ENCONTRADA`. */
export class ErrorAcademiaNoEncontrada extends ErrorNegocio {
  constructor() {
    super(404, 'ACADEMIA_NO_ENCONTRADA', 'La academia no existe.');
  }
}

/** La academia está suspendida. Se responde 403 `ACADEMIA_SUSPENDIDA`. */
export class ErrorAcademiaSuspendida extends ErrorNegocio {
  constructor() {
    super(403, 'ACADEMIA_SUSPENDIDA', 'Academia no disponible por el momento.');
  }
}

/**
 * El rol de `DATABASE_URL_APP` no es seguro (tiene atributos o privilegios que permiten saltarse RLS: ver
 * `problemasDelRol`): la seguridad por academia no protegería nada, así que la API no atiende datos. Es un error del
 * servidor (500 `ERROR_INTERNO`): el mensaje es solo para el registro técnico y nunca incluye la URL ni la contraseña.
 */
export class ErrorRolBaseDatosInseguro extends ErrorNegocio {
  constructor() {
    super(500, 'ERROR_INTERNO', MENSAJE_ROL_INSEGURO);
  }
}

/** Por qué la transacción no se confirmó: `abortada` (error de la base atrapado, `ROLLBACK`/`COMMIT` escrito dentro) o `incompleta` (una consulta volvió sin resultado). */
export type MotivoTransaccionAbortada = 'abortada' | 'incompleta';

const MENSAJE_ABORTADA =
  'La transacción quedó abortada por un error de la base que el trabajo atrapó y no propagó; no se confirmó nada.';
const MENSAJE_INCOMPLETA = 'Una consulta de la transacción no llegó a ejecutarse; no se confirmó nada.';

/**
 * La transacción quedó abortada, o ya no es la que abrió `BaseDatos`, cuando `trabajo` terminó bien (spec 001, criterios 149
 * a 151, P-36): `trabajo` atrapó un error de la base y siguió, escribió un `ROLLBACK` o un `COMMIT`, o una consulta enviada
 * sin `await` falló después. Prisma revierte la transacción y la operación rechaza con este error: nunca se devuelve el valor
 * de `trabajo` como si se hubiera guardado. Es un error del servidor (500 `ERROR_INTERNO`); el mensaje es solo para el
 * registro técnico. `cause` es siempre una `CausaLimpia` (criterio 161, precisión de P-36): el constructor reemplaza el error que
 * recibe, que puede llevar los valores de la consulta en su mensaje, por el tipo y los códigos (SQLSTATE en `code`, código de
 * Prisma, operación). Nunca conserva el mensaje, `meta`, la pila ni la `cause` del original.
 *
 * `motivo` (criterio 154, ampliación de P-36): `abortada` por defecto; `incompleta` cuando una operación recibió `undefined`
 * de Prisma (una consulta que el cliente no llegó a ejecutar), llegó tarde (156) o rechazó después de que `trabajo` terminó (160),
 * con el mensaje correspondiente. `cause` lleva entonces el nombre de la operación y la circunstancia.
 */
export class ErrorTransaccionAbortada extends ErrorNegocio {
  readonly motivo: MotivoTransaccionAbortada;

  constructor(opciones?: { readonly motivo?: MotivoTransaccionAbortada; readonly cause?: unknown }) {
    const motivo = opciones?.motivo ?? 'abortada';
    super(500, 'ERROR_INTERNO', motivo === 'incompleta' ? MENSAJE_INCOMPLETA : MENSAJE_ABORTADA);
    this.motivo = motivo;
    // Una `CausaLimpia` se conserva; cualquier otra cosa se reemplaza por una (criterio 161).
    if (opciones?.cause !== undefined) this.cause = causaLimpia(opciones.cause);
  }
}
