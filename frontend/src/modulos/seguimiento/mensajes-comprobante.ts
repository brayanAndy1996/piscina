import { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { frasePorTelefono } from '../../componentes/Telefono';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { FOTO_MEGABYTES_MAXIMOS } from '../foto/validacion';

/** Lo que se le dice a la persona cuando la subida del comprobante falla (criterios 37 a 42 de 007b), con una salida humana. */

const detallesSchema = z.looseObject({ total: z.string().optional() });

/** El total a pagar que trae un 409 `MONTO_DISTINTO` (criterio 38), o `null` si el error es otro. */
export function totalDelMontoDistinto(falla: unknown): string | null {
  if (!esErrorDeApi(falla, 409, 'MONTO_DISTINTO')) return null;
  const detalles = detallesSchema.safeParse(falla.detalles);
  return detalles.success ? (detalles.data.total ?? null) : null;
}

/** Los 409 que dicen que la solicitud ya no está como la persona la veía: se avisa y se vuelve a consultar. */
export function esFalloQueCambiaLaSolicitud(falla: unknown): boolean {
  return (
    esErrorDeApi(falla, 404, 'SOLICITUD_NO_ENCONTRADA') ||
    ['SOLICITUD_NO_EDITABLE', 'PAGO_EN_VERIFICACION', 'SOLICITUD_YA_PAGADA', 'CLAVE_YA_USADA'].some((codigo) =>
      esErrorDeApi(falla, 409, codigo),
    )
  );
}

export function mensajeDeFalloDeComprobante(falla: unknown, telefono: string | null): string {
  const ayuda = frasePorTelefono(telefono);
  if (esErrorDeApi(falla, 400, 'IMAGEN_NO_VALIDA')) {
    return `No pudimos usar esa imagen. Elige una foto o captura JPG o PNG del comprobante, de entre 100 y 8000 píxeles por lado.${ayuda}`;
  }
  if (esErrorDeApi(falla, 413)) {
    return `La imagen pesa más de ${FOTO_MEGABYTES_MAXIMOS} MB. Elige una más liviana.${ayuda}`;
  }
  if (esErrorDeApi(falla, 429)) {
    return `Enviaste demasiados comprobantes desde esta conexión. Espera un rato e inténtalo de nuevo.${ayuda}`;
  }
  const total = totalDelMontoDistinto(falla);
  if (total) {
    return `El monto debe ser igual al total a pagar: ${formatearSoles(total)}. Lo corregimos; revísalo y vuelve a enviar.`;
  }
  if (esErrorDeApi(falla, 409, 'NUMERO_OPERACION_YA_USADO')) {
    return `Ese número de operación ya se registró. Revisa el número o acércate a recepción.`;
  }
  if (esErrorDeApi(falla, 409, 'SIN_CUPO')) {
    return `Ya no hay cupo en alguna de las clases de tu solicitud, así que no podemos volver a reservarlo. Acércate a recepción.${ayuda}`;
  }
  if (esErrorDeApi(falla, 409, 'SOLICITUD_NO_EDITABLE')) {
    return `Esta solicitud ya no admite comprobantes: venció o se canceló. Si todavía quieres inscribirte, llena el formulario de nuevo.${ayuda}`;
  }
  if (esErrorDeApi(falla, 409, 'PAGO_EN_VERIFICACION')) {
    return 'Ya enviaste un comprobante y la academia lo está revisando. Actualizamos tu solicitud.';
  }
  if (esErrorDeApi(falla, 409, 'SOLICITUD_YA_PAGADA')) {
    return 'Esta solicitud ya está pagada. Actualizamos tu solicitud.';
  }
  if (esErrorDeApi(falla, 409, 'CLAVE_YA_USADA')) {
    return 'Ese envío ya se había registrado con otros datos. Actualizamos tu solicitud: revisa cómo quedó.';
  }
  if (esErrorDeApi(falla, 404, 'SOLICITUD_NO_ENCONTRADA')) {
    return `No encontramos tu solicitud. Actualizamos la página.${ayuda}`;
  }
  return `${mensajeGeneral(falla)}${ayuda}`;
}
