import { ErrorNegocio } from '../../comun/errores';
import type { EstadoSolicitud } from '@aquagestion/contratos';

export { claveYaUsada } from '../caja/errores';
export { noEncontrado, sinCupo } from '../inscripciones/errores';

/**
 * Los errores de negocio de los pagos (spec 007, «Códigos de error nuevos»). Cada uno lleva siempre el mismo mensaje y, si lo tiene, los
 * mismos `detalles`: nada en la respuesta distingue casos que deben ser indistinguibles. Ninguno lleva el DNI, el token ni la clave.
 */

/** 409: la solicitud ya está pagada (`CONFIRMADA`): no se cobra dos veces la misma matrícula (criterio 15). */
export function solicitudYaPagada(): ErrorNegocio {
  return new ErrorNegocio(409, 'SOLICITUD_YA_PAGADA', 'Esta solicitud ya está pagada.');
}

/** 409: hay un comprobante en revisión (007b): se aprueba o se rechaza primero (criterio 15). */
export function pagoEnVerificacion(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'PAGO_EN_VERIFICACION',
    'Hay un comprobante en revisión: apruébalo o recházalo antes de cobrar.',
  );
}

/** 409: la solicitud venció o se canceló; la persona se vuelve a inscribir (DR-10, criterio 15). */
export function solicitudNoCobrable(estado: EstadoSolicitud): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'SOLICITUD_NO_COBRABLE',
    'Esta solicitud ya no se puede cobrar. La persona debe volver a inscribirse.',
    { estado },
  );
}

/** 409: el ajuste solo es posible antes del pago (criterio 11). */
export function solicitudNoAjustable(estado: EstadoSolicitud): ErrorNegocio {
  return new ErrorNegocio(409, 'SOLICITUD_NO_AJUSTABLE', 'El monto de esta solicitud ya no se puede ajustar.', {
    estado,
  });
}

/** 409: el monto que vio quien cobra ya no es el total (criterio 16). `total` es el total actual, con dos decimales. */
export function montoCambioDelCobro(total: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'MONTO_CAMBIO',
    'El monto cambió desde que lo viste. Revisa el nuevo total y vuelve a cobrar.',
    {
      total,
    },
  );
}

/** 409: ya hay un usuario de la academia (personal) con el DNI de la persona (DR-1, criterio 22 a). */
export function dniDelPersonal(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'DNI_DEL_PERSONAL',
    'Ya existe un usuario de la academia con el DNI de esta persona. Consulta con el administrador.',
  );
}

export { solicitudNoEditable, solicitudNoEncontrada } from '../inscripciones/errores';

/** 409 de la subida del comprobante (007b, criterio 38): el monto declarado no es el total a cobrar. `total` es el total actual, con dos decimales. */
export function montoDistinto(total: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'MONTO_DISTINTO',
    'El monto del comprobante no es el total a pagar. Revisa el monto y vuelve a enviarlo.',
    { total },
  );
}

/** 409 (007b, criterio 39): ya hay un pago abierto con ese número de operación y ese método. Sin `detalles`: no dice de quién es. */
export function numeroOperacionYaUsado(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'NUMERO_OPERACION_YA_USADO',
    'Ese número de operación ya se registró. Revisa el número o acércate a recepción.',
  );
}

/** 409 (007b, criterios 48 y 49): el pago ya se confirmó (aprobado o cobrado en efectivo): ya no se rechaza. */
export function pagoYaConfirmado(): ErrorNegocio {
  return new ErrorNegocio(409, 'PAGO_YA_CONFIRMADO', 'Este pago ya está confirmado: no se puede rechazar.');
}

/** 409 (007b, criterio 48): el pago ya se rechazó: no se aprueba. La persona sube otro comprobante. */
export function pagoYaRechazado(): ErrorNegocio {
  return new ErrorNegocio(409, 'PAGO_YA_RECHAZADO', 'Este pago ya fue rechazado: no se puede aprobar.');
}
