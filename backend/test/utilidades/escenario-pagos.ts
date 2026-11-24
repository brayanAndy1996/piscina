// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { crearCajaDePrueba, instantaneaDeCaja, type CajaDePrueba } from './caja';
import { type FilaAuditoria, leerAuditoriaDeAcademia } from './datos';
import {
  type EscenarioInscripcion,
  crearEscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  type Objeto,
  type OpcionesSembrado,
  type RespuestaApi,
  sembrarSolicitud,
  type SolicitudSembrada,
} from './inscripciones';
import { exigirTablaDePagos, type FilaPago, leerPagos } from './pagos';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  instantaneaDeUsuarios,
  rutasRegistradas,
  type UsuarioDePrueba,
} from './usuarios';

/**
 * Escenario y ayudantes HTTP de las pruebas protegidas de la 007a (cobro en recepción y cuenta del alumno): las academias A y B de la 005
 * (plan de S/ 120.00 de 12 clases y sus clases), una segunda secretaria y un segundo administrador de A, la caja de hoy, las solicitudes
 * sembradas con el total que cada prueba necesita y los cuerpos de las rutas nuevas. Solo SQL, HTTP y los contratos públicos.
 */

export const AHORA_007 = AHORA_PRUEBAS;
/** Hoy en Lima (`AHORA_007` es el miércoles 11 de noviembre de 2026, 10:00 en Lima). */
export const HOY_007 = '2026-11-11';

export interface EscenarioPagos extends EscenarioInscripcion {
  secretariaA2: UsuarioDePrueba;
  adminA2: UsuarioDePrueba;
}

/** Vacía la base y crea el escenario de la 005 más otra secretaria y otro administrador de A. Falla con un mensaje claro si falta la tabla `pagos`. */
export async function crearEscenarioDePagos(): Promise<EscenarioPagos> {
  await exigirTablasDeInscripcion();
  await exigirTablaDePagos();
  const e = await crearEscenarioInscripcion();
  return {
    ...e,
    secretariaA2: await crearUsuarioDePrueba({
      academiaId: e.A.id,
      rol: 'SECRETARIA',
      clave: 'Clave-Comun-2026',
      nombres: 'Marta',
      apellidos: 'Huaman',
    }),
    adminA2: await crearUsuarioDePrueba({
      academiaId: e.A.id,
      rol: 'ADMIN',
      clave: 'Clave-Comun-2026',
      nombres: 'Pedro',
      apellidos: 'Ibarra',
    }),
  };
}

/** Las cookies de sesión de cada usuario del escenario, firmadas para el instante `ahora`. */
export function cookiesDePagos(e: EscenarioPagos, ahora: Date = AHORA_007) {
  return {
    admin: cookieDeUsuario(e.adminA, ahora),
    admin2: cookieDeUsuario(e.adminA2, ahora),
    secretaria: cookieDeUsuario(e.secretariaA, ahora),
    secretaria2: cookieDeUsuario(e.secretariaA2, ahora),
    entrenador: cookieDeUsuario(e.entrenadorA, ahora),
    alumno: cookieDeUsuario(e.alumnoA, ahora),
    adminB: cookieDeUsuario(e.adminB, ahora),
    secretariaB: cookieDeUsuario(e.secretariaB, ahora),
  };
}

/** La caja de A abierta hoy (por defecto S/ 100.00 iniciales, abierta por la secretaria). */
export function abrirCajaDeHoy(e: EscenarioPagos, sobre: Record<string, unknown> = {}): Promise<CajaDePrueba> {
  return crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00', ...sobre });
}

// ---------------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------------

export const rutaCobro = (solicitudId: string): string => `/api/solicitudes/${solicitudId}/pago-efectivo`;
export const rutaAjuste = (solicitudId: string): string => `/api/solicitudes/${solicitudId}/ajuste-monto`;
export const rutaTicket = (pagoId: string): string => `/api/pagos/${pagoId}/ticket`;
export const rutaCancelar = (solicitudId: string): string => `/api/solicitudes/${solicitudId}/cancelar`;

const RUTAS_DE_LA_007A: readonly RegExp[] = [
  /^POST \/api\/solicitudes\/:\w+\/pago-efectivo$/,
  /^POST \/api\/solicitudes\/:\w+\/ajuste-monto$/,
  /^GET \/api\/pagos\/:\w+\/ticket$/,
];

/**
 * Falla con un mensaje claro si las tres rutas nuevas de la 007a no están registradas (la funcionalidad no existe todavía). Evita que una
 * prueba pase "por casualidad" con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDePagos(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_007A) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 007a: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cuerpos
// ---------------------------------------------------------------------------------------------------------------------

/** Un cuerpo válido de `cobrarEnEfectivoSchema` con una clave nueva. */
export const cuerpoCobro = (montoMostrado: string, sobre: Objeto = {}): Objeto => ({
  claveIdempotencia: randomUUID(),
  montoMostrado,
  ...sobre,
});

/** Un cuerpo válido de `ajustarMontoSchema`. */
export const cuerpoAjuste = (
  montoAjustado: string,
  motivo = 'Descuento autorizado por la dirección',
  sobre: Objeto = {},
): Objeto => ({
  montoAjustado,
  motivo,
  ...sobre,
});

// ---------------------------------------------------------------------------------------------------------------------
// Solicitudes sembradas
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Una solicitud `PENDIENTE_PAGO` de A con la reserva vigente. Por defecto, la matrícula de S/ 100 de 12 clases con 5 totales: su total es
 * S/ 42 (criterio 10). `opciones` reemplaza cualquier valor de `sembrarSolicitud`.
 */
export function sembrarCobrable(
  e: EscenarioPagos,
  opciones: Partial<OpcionesSembrado> = {},
): Promise<SolicitudSembrada> {
  return sembrarSolicitud(e.A.id, {
    planId: e.plan.id,
    claseIds: [e.lunes.id],
    nombres: 'Valeria',
    apellidos: 'Mendoza Salas',
    clasesTotales: 5,
    clasesPorMesPlan: 12,
    precioPlan: '100.00',
    monto: '42.00',
    ...opciones,
  });
}

/** El total a cobrar de una matrícula (criterio 10), calculado aquí en céntimos con enteros, sin coma flotante: `D-03`, hacia arriba y una sola vez. */
export function totalDeReferencia(
  precioPlan: string,
  clasesPorMes: number,
  clasesTotales: number,
  montoAjustado?: string,
): string {
  const aCentimos = (texto: string): bigint => {
    const [enteros = '0', decimales = ''] = texto.split('.');
    return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0').slice(0, 2));
  };
  const arribaAlSol = (centimos: bigint): bigint => (centimos + 99n) / 100n;
  const base =
    montoAjustado !== undefined
      ? aCentimos(montoAjustado)
      : // precio * totales / porMes, en céntimos, hacia arriba al céntimo (nunca se pierde una fracción) y luego al sol.
        (aCentimos(precioPlan) * BigInt(clasesTotales) + BigInt(clasesPorMes) - 1n) / BigInt(clasesPorMes);
  return `${arribaAlSol(base).toString()}.00`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------------------------------

export interface PagoApi {
  id: string;
  estado: string;
  metodo: string;
  concepto: string;
  monto: string;
  registradoEn: string;
  verificadoEn: string | null;
  numeroOperacion: string | null;
  fechaOperacion: string | null;
  motivoRechazo: string | null;
  numeroTicket: number | null;
}

export interface SolicitudPanelApi {
  id: string;
  codigo: string;
  estado: string;
  reservaVenceEn: string | null;
  monto: string;
  ajuste: { montoCalculado: string; motivo: string } | null;
  pago: {
    id: string;
    metodo: string;
    estado: string;
    monto: string;
    registradoEn: string;
    verificadoEn: string | null;
    numeroOperacion: string | null;
    fechaOperacion: string | null;
    motivoRechazo: string | null;
    numeroTicket: number | null;
  } | null;
  [clave: string]: unknown;
}

/** El `pago` de una respuesta `{ pago, solicitud }` (falla con el cuerpo recibido si no viene). */
export function pagoDe(respuesta: { status: number; body: Objeto | null }): PagoApi {
  const pago = respuesta.body?.['pago'];
  expect(
    pago,
    `la respuesta (HTTP ${respuesta.status}) no trae "pago": ${JSON.stringify(respuesta.body)}`,
  ).toBeTruthy();
  return pago as PagoApi;
}

/** La `solicitud` (elemento del panel) de una respuesta `{ solicitud }` o `{ pago, solicitud }`. */
export function solicitudPanelDe(respuesta: { status: number; body: Objeto | null }): SolicitudPanelApi {
  const solicitud = respuesta.body?.['solicitud'];
  expect(
    solicitud,
    `la respuesta (HTTP ${respuesta.status}) no trae "solicitud": ${JSON.stringify(respuesta.body)}`,
  ).toBeTruthy();
  return solicitud as SolicitudPanelApi;
}

export function codigoDeRespuesta(respuesta: Pick<RespuestaApi, 'body'>): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

export function detallesDeRespuesta(respuesta: Pick<RespuestaApi, 'body'>): Objeto {
  const detalles = respuesta.body?.['detalles'];
  return detalles !== null && typeof detalles === 'object' ? (detalles as Objeto) : {};
}

// ---------------------------------------------------------------------------------------------------------------------
// Instantáneas: lo que una operación rechazada no puede cambiar
// ---------------------------------------------------------------------------------------------------------------------

export interface PartesDeLaAcademia {
  pagos: FilaPago[];
  inscripciones: string;
  caja: string;
  usuarios: string;
  auditoria: FilaAuditoria[];
}

/** Todo lo que un cobro, un ajuste o un ticket podrían tocar en una academia: pagos, las siete tablas de la 005, la caja, los usuarios y la auditoría. */
export async function partesDeLaAcademia(academiaId: string): Promise<PartesDeLaAcademia> {
  return {
    pagos: await leerPagos(academiaId),
    inscripciones: await instantaneaDeInscripciones(academiaId),
    caja: await instantaneaDeCaja(academiaId),
    usuarios: await instantaneaDeUsuarios(academiaId),
    auditoria: await leerAuditoriaDeAcademia(academiaId),
  };
}

/** Lo mismo como un solo texto: lo que una operación rechazada no puede cambiar. */
export async function instantaneaDeLaAcademia(academiaId: string): Promise<string> {
  return JSON.stringify(await partesDeLaAcademia(academiaId));
}
