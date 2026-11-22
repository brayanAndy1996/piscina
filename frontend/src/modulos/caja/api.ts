import {
  type AbrirCaja,
  type CerrarCaja,
  type FiltroHistorialCajas,
  type ReabrirCaja,
  type RegistrarEgresoEntrada,
  respuestaCajaActualSchema,
  respuestaCajaSchema,
  respuestaEgresoSchema,
  respuestaHistorialCajasSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirArchivo, pedirJson } from '../../api/cliente';

/** Llamadas de la caja del día. La academia sale de la sesión: ninguna ruta la lleva (criterio 8 de 006). */

export async function obtenerCajaActual() {
  return (await pedirJson('/api/cajas/actual', respuestaCajaActualSchema)).datos.caja;
}

/** 201 al abrir; 200 si es el reintento de la misma clave (criterio 16). */
export async function abrirCaja(datos: AbrirCaja) {
  return (await enviarJson('POST', '/api/cajas', datos, respuestaCajaSchema, [200, 201])).datos.caja;
}

/** 201 al registrar; 200 si es el reintento de la misma clave (criterio 22). */
export async function registrarEgreso({ cajaId, datos }: { cajaId: string; datos: RegistrarEgresoEntrada }) {
  const ruta = `/api/cajas/${encodeURIComponent(cajaId)}/egresos`;
  return (await enviarJson('POST', ruta, datos, respuestaEgresoSchema, [200, 201])).datos;
}

export async function cerrarCaja({ cajaId, datos }: { cajaId: string; datos: CerrarCaja }) {
  const ruta = `/api/cajas/${encodeURIComponent(cajaId)}/cierre`;
  return (await enviarJson('POST', ruta, datos, respuestaCajaSchema, [200])).datos.caja;
}

export async function reabrirCaja({ cajaId, datos }: { cajaId: string; datos: ReabrirCaja }) {
  const ruta = `/api/cajas/${encodeURIComponent(cajaId)}/reapertura`;
  return (await enviarJson('POST', ruta, datos, respuestaCajaSchema, [200])).datos.caja;
}

/**
 * El historial de cajas (criterio 40). Solo viajan `desde` y `hasta` y solo si la persona los escribió: la API aplica sus valores por
 * defecto y devuelve el rango que usó (PQ3).
 */
export async function obtenerHistorial(filtro: FiltroHistorialCajas) {
  const consulta = new URLSearchParams();
  if (filtro.desde) consulta.set('desde', filtro.desde);
  if (filtro.hasta) consulta.set('hasta', filtro.hasta);
  const texto = consulta.toString();
  return (await pedirJson(`/api/cajas${texto ? `?${texto}` : ''}`, respuestaHistorialCajasSchema)).datos;
}

/** Una caja por su id, con todos sus movimientos y cierres (criterio 41). */
export async function obtenerCaja(cajaId: string) {
  return (await pedirJson(`/api/cajas/${encodeURIComponent(cajaId)}`, respuestaCajaSchema)).datos.caja;
}

/** El PDF de un cierre (criterio 42): el contenido del archivo, tal como lo armó la API. */
export async function obtenerPdfDelCierre({ cajaId, numero }: { cajaId: string; numero: number }) {
  return pedirArchivo(`/api/cajas/${encodeURIComponent(cajaId)}/cierres/${numero}/pdf`, 'application/pdf');
}
