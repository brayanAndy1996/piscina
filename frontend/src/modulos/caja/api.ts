import {
  type AbrirCaja,
  type CerrarCaja,
  type ReabrirCaja,
  type RegistrarEgresoEntrada,
  respuestaCajaActualSchema,
  respuestaCajaSchema,
  respuestaEgresoSchema,
} from '@aquagestion/contratos';
import { enviarJson, pedirJson } from '../../api/cliente';

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
