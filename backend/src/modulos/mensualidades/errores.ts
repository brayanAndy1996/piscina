import { ErrorNegocio } from '../../comun/errores';

export { alumnoNoEncontrado } from '../alumnos/errores';
export { planNoDisponible, seleccionNoValida, sinClasesEnElMes } from '../inscripciones/errores';
export { claveYaUsada, montoCambioDelCobro, montoDistinto, numeroOperacionYaUsado } from '../pagos/errores';

/**
 * Los errores de negocio de la renovación (spec 010a, «Errores nuevos» del contrato; criterios 3, 7 y 8). Cada uno lleva siempre el mismo
 * mensaje y, si lo tiene, los mismos `detalles`: nada en la respuesta distingue casos que deben ser indistinguibles. Ninguno lleva el DNI ni
 * datos del alumno.
 */

/** 409 (criterio 3): el mes pedido no es uno de los que se pueden renovar ahora. `mesesPermitidos`, en orden cronológico y sin los ya registrados. */
export function mesNoPermitido(mesesPermitidos: readonly string[]): ErrorNegocio {
  return new ErrorNegocio(409, 'MES_NO_PERMITIDO', 'Ese mes no se puede renovar ahora.', { mesesPermitidos });
}

/** 409 (criterio 3): el alumno ya tiene la mensualidad de ese mes pagada o en verificación. Sin `detalles`. */
export function mensualidadYaRegistrada(): ErrorNegocio {
  return new ErrorNegocio(409, 'MENSUALIDAD_YA_REGISTRADA', 'El alumno ya tiene la mensualidad de ese mes.');
}

/** 409 (criterio 8, DT-19): un alumno `INACTIVO` no renueva. El mismo código que usa la asistencia (009). */
export function alumnoInactivo(): ErrorNegocio {
  return new ErrorNegocio(409, 'ALUMNO_INACTIVO', 'El alumno está inactivo y no puede renovar.');
}

/** 409 (criterio 8): alguna clase elegida no tiene lugar para este alumno en el mes. `claseIds`: las que no tienen, ordenadas. */
export function sinCupoParaRenovar(claseIds: readonly string[]): ErrorNegocio {
  return new ErrorNegocio(409, 'SIN_CUPO', 'Alguna de las clases elegidas se llenó. Elige otra opción.', { claseIds });
}

/** 409 (criterio 7, DR-1): la fecha de la operación es futura o anterior al inicio de la ventana (o del mes en curso). Sin `detalles`. */
export function fechaOperacionNoValida(): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'FECHA_OPERACION_NO_VALIDA',
    'La fecha de la operación no puede ser futura ni anterior al inicio de la renovación.',
  );
}

/**
 * 409 (criterio 35): la matrícula no se puede cambiar de horario: está `FINALIZADA` o `CANCELADA`, es de un mes que ya no es el en curso ni el siguiente, o es
 * una reserva de 24 horas. Sin `detalles`: no distingue el motivo.
 */
export function matriculaNoModificable(): ErrorNegocio {
  return new ErrorNegocio(409, 'MATRICULA_NO_MODIFICABLE', 'El horario de esta mensualidad ya no se puede cambiar.');
}
