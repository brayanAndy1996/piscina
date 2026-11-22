import { MENSAJE_SOLICITUD_INVALIDA } from '../../comun/validacion';
import { ErrorNegocio } from '../../comun/errores';
import type { Cotizacion, TextosConsentimiento } from '@aquagestion/contratos';
import type { ErrorDeSeleccion } from './dominio/seleccion';

export { imagenNoValida } from '../../comun/http/cuerpo-imagen';

/**
 * Los errores de negocio de la inscripción pública (spec 005, "Códigos de error nuevos"). Cada uno lleva siempre el mismo mensaje: nada
 * en la respuesta distingue casos que deben ser indistinguibles (un plan que no existe, uno de otra academia y uno inactivo; un DNI de un
 * alumno, de un cliente en curso o del personal).
 */

/** 400 con los campos que no cumplen (el mismo formato que la validación de los esquemas). */
export function solicitudInvalida(errores: readonly { campo: string; mensaje: string }[]): ErrorNegocio {
  return new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, { errores });
}

export function planNoDisponible(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'PLAN_NO_DISPONIBLE',
    'El plan elegido no está disponible para ese nivel. Elige otro plan.',
  );
}

export function seleccionNoValida(errores: readonly ErrorDeSeleccion[]): ErrorNegocio {
  return new ErrorNegocio(409, 'SELECCION_NO_VALIDA', 'Las clases elegidas no son válidas para el plan y el nivel.', {
    errores,
  });
}

export function sinClasesEnElMes(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'SIN_CLASES_EN_EL_MES',
    'Ya no quedan clases este mes con las clases elegidas. Vuelve el primer día del mes siguiente.',
  );
}

export function sinCupo(clasesSinCupo: readonly string[]): ErrorNegocio {
  return new ErrorNegocio(409, 'SIN_CUPO', 'Alguna de las clases elegidas se llenó. Elige otra opción.', {
    clasesSinCupo,
  });
}

export function mesCambio(mes: string): ErrorNegocio {
  return new ErrorNegocio(409, 'MES_CAMBIO', 'Cambió el mes desde que viste el monto. Vuelve a cotizar.', { mes });
}

export function montoCambio(cotizacion: Cotizacion): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'MONTO_CAMBIO',
    'El monto cambió desde que lo viste. Revisa el nuevo monto y confirma.',
    {
      cotizacion,
    },
  );
}

export function textosActualizados(version: string, textos: TextosConsentimiento): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'TEXTOS_ACTUALIZADOS',
    'Los textos de consentimiento se actualizaron. Léelos de nuevo y acéptalos.',
    { version, textos },
  );
}

export function dniYaRegistrado(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'DNI_YA_REGISTRADO',
    'Este DNI ya tiene una inscripción o solicitud en esta academia; usa tu enlace o acércate a recepción.',
  );
}

export function solicitudYaRegistrada(codigo: string | null): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'SOLICITUD_YA_REGISTRADA',
    'Esta solicitud ya se registró. Usa tu código y tu DNI para seguirla.',
    codigo === null ? undefined : { codigo },
  );
}

export function limiteDeReservasPendientes(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'LIMITE_DE_RESERVAS_PENDIENTES',
    'Ya tienes varias reservas sin pagar desde esta conexión. Paga una o acércate a recepción.',
  );
}

/** El único 404 del seguimiento: el mismo para un token o un código que no existen, de otra academia o con formato inválido (criterio 31). */
export function solicitudNoEncontrada(): ErrorNegocio {
  return new ErrorNegocio(404, 'SOLICITUD_NO_ENCONTRADA', 'No se encontró la solicitud.');
}

/** 409 de la foto (criterio 34 f): la solicitud está vencida o cancelada, o ya no espera el pago. Sin `detalles`. */
export function solicitudNoEditable(): ErrorNegocio {
  return new ErrorNegocio(409, 'SOLICITUD_NO_EDITABLE', 'La solicitud ya no admite cambios. Acércate a recepción.');
}

/** 409 de la cancelación (criterio 39): la solicitud no está esperando el pago ni cancelada. Sin `detalles`. */
export function solicitudNoCancelable(): ErrorNegocio {
  return new ErrorNegocio(409, 'SOLICITUD_NO_CANCELABLE', 'La solicitud no se puede cancelar en su estado actual.');
}

/** El 404 del panel: el mismo para un id que no existe, que es de otra academia o que no es un UUID (criterio 39). */
export function noEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.');
}
