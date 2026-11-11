import { ErrorNegocio } from '../../comun/errores';

export const MENSAJE_ROL_INSEGURO =
  'El rol de DATABASE_URL_APP no es seguro: es superusuario, tiene BYPASSRLS, es dueño de tablas o es miembro de ' +
  'otro rol. La API no atenderá datos hasta corregirlo.';

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
 * El rol de `DATABASE_URL_APP` no es seguro (es superusuario, tiene BYPASSRLS, es dueño de tablas o es miembro de otro
 * rol): la seguridad por academia no protegería nada, así que la API no atiende datos. Es un error del servidor (500
 * `ERROR_INTERNO`): el mensaje es solo para el registro técnico y nunca incluye la URL ni la contraseña.
 */
export class ErrorRolBaseDatosInseguro extends ErrorNegocio {
  constructor() {
    super(500, 'ERROR_INTERNO', MENSAJE_ROL_INSEGURO);
  }
}
