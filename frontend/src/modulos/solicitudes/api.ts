import {
  type AjustarMonto,
  type CancelarSolicitud,
  type CobrarEnEfectivo,
  type FiltroEstadoSolicitudes,
  pagoSchema,
  respuestaListaSolicitudesSchema,
  respuestaSolicitudPanelSchema,
  solicitudPanelSchema,
} from '@aquagestion/contratos';
import { z } from 'zod';
import { enviarJson, pedirJson } from '../../api/cliente';

/** Llamadas del panel de solicitudes. La academia sale de la sesión: ninguna ruta la lleva (criterios 38 y 39 de 005). */

/** `POST …/pago-efectivo` responde `{ pago, solicitud }` (spec 007a, criterio 13): el pago y el elemento del panel ya actualizado. */
const respuestaCobroSchema = z.strictObject({ pago: pagoSchema, solicitud: solicitudPanelSchema });

export async function listarSolicitudes(estado: FiltroEstadoSolicitudes) {
  const ruta = `/api/solicitudes?estado=${encodeURIComponent(estado)}`;
  return (await pedirJson(ruta, respuestaListaSolicitudesSchema)).datos.solicitudes;
}

export async function cancelarSolicitud({ id, datos }: { id: string; datos: CancelarSolicitud }) {
  const ruta = `/api/solicitudes/${encodeURIComponent(id)}/cancelar`;
  return (await enviarJson('POST', ruta, datos, respuestaSolicitudPanelSchema, [200])).datos.solicitud;
}

/** 201 con el pago nuevo; 200 con el mismo resultado si es el reintento de la misma clave (criterio 17). */
export async function cobrarEnEfectivo({ id, datos }: { id: string; datos: CobrarEnEfectivo }) {
  const ruta = `/api/solicitudes/${encodeURIComponent(id)}/pago-efectivo`;
  return (await enviarJson('POST', ruta, datos, respuestaCobroSchema, [200, 201])).datos;
}

/** Solo el administrador (RN-25). Repetir el mismo monto y motivo responde 200 sin cambiar nada (criterio 11). */
export async function ajustarMonto({ id, datos }: { id: string; datos: AjustarMonto }) {
  const ruta = `/api/solicitudes/${encodeURIComponent(id)}/ajuste-monto`;
  return (await enviarJson('POST', ruta, datos, respuestaSolicitudPanelSchema, [200])).datos.solicitud;
}
