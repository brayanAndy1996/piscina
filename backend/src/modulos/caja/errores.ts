import { MENSAJE_EXPLICA_LA_DIFERENCIA } from '@aquagestion/contratos';
import { ErrorNegocio } from '../../comun/errores';
import { MENSAJE_SOLICITUD_INVALIDA } from '../../comun/validacion';

/**
 * Los errores de negocio de la caja (spec 006, "Códigos de error nuevos"). Los 409 llevan en `detalles` solo lo que la web necesita para
 * mostrar el mensaje (la caja en conflicto, el último movimiento o el efectivo disponible): nunca datos de otra academia.
 */

/** El 404 de la caja: el mismo para un id que no existe, que es de otra academia o que no es un UUID (criterio 8). */
export function noEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.');
}

/** Los detalles de un 409 de la caja: `{ cajaId, fecha }`, o ninguno si no se pudo releer la caja del choque. */
const detallesDeCaja = (cajaId: string | undefined, fecha: string | undefined) =>
  cajaId === undefined || fecha === undefined ? undefined : { cajaId, fecha };

export function cajaYaAbierta(cajaId?: string, fecha?: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'CAJA_YA_ABIERTA',
    'Ya hay una caja abierta. Úsala o ciérrala antes de abrir otra.',
    detallesDeCaja(cajaId, fecha),
  );
}

export function cajaPendienteDeCierre(cajaId: string, fecha: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'CAJA_PENDIENTE_DE_CIERRE',
    `La caja del ${fecha} sigue abierta. Ciérrala antes de abrir la de hoy.`,
    { cajaId, fecha },
  );
}

export function cajaDelDiaCerrada(cajaId?: string, fecha?: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'CAJA_DEL_DIA_CERRADA',
    'La caja de hoy ya se cerró. Pide al administrador que la reabra para seguir cobrando.',
    detallesDeCaja(cajaId, fecha),
  );
}

export function cajaCerrada(): ErrorNegocio {
  return new ErrorNegocio(409, 'CAJA_CERRADA', 'La caja está cerrada. Pide al administrador que la reabra.');
}

export function cajaDeOtroDia(cajaId: string, fecha: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'CAJA_DE_OTRO_DIA',
    `La caja del ${fecha} sigue abierta y ya no admite movimientos. Ciérrala y abre la de hoy.`,
    { cajaId, fecha },
  );
}

/** Solo de la interfaz de la 007 (`registrarIngresoEnCaja`): ningún cobro sin la caja abierta (RN-17). */
export function sinCajaAbierta(): ErrorNegocio {
  return new ErrorNegocio(409, 'SIN_CAJA_ABIERTA', 'Abre la caja antes de cobrar');
}

export function efectivoInsuficiente(disponible: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'EFECTIVO_INSUFICIENTE',
    `No hay tanto efectivo en la caja: disponible S/ ${disponible}.`,
    {
      disponible,
    },
  );
}

export function cajaCambio(ultimoMovimiento: number): ErrorNegocio {
  return new ErrorNegocio(409, 'CAJA_CAMBIO', 'Entró un movimiento nuevo: revisa el conteo.', { ultimoMovimiento });
}

export function claveYaUsada(): ErrorNegocio {
  return new ErrorNegocio(409, 'CLAVE_YA_USADA', 'Esta operación ya se registró con otros datos.');
}

export function hayOtraCajaAbierta(cajaId?: string, fecha?: string): ErrorNegocio {
  return new ErrorNegocio(
    409,
    'HAY_OTRA_CAJA_ABIERTA',
    fecha === undefined
      ? 'Hay otra caja abierta. Ciérrala antes de reabrir esta.'
      : `Hay otra caja abierta (la del ${fecha}). Ciérrala antes de reabrir esta.`,
    detallesDeCaja(cajaId, fecha),
  );
}

/** El 400 de un cierre con diferencia y sin observación (criterio 30): sigue al `CAJA_CAMBIO`, así que no sale del esquema. */
export function observacionObligatoria(): ErrorNegocio {
  return new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, {
    errores: [{ campo: 'observacion', mensaje: MENSAJE_EXPLICA_LA_DIFERENCIA }],
  });
}
