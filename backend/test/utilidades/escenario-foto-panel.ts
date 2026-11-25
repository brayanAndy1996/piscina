// spec: 008-carnet-qr (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  instantaneaDelCarnet,
  prepararEscenarioDelCarnet,
  type AppCarnet,
  type EscenarioDelCarnet,
} from './escenario-carnet';
import { sembrarCobrable } from './escenario-pagos';
import type { OpcionesSembrado, RespuestaApi, SolicitudSembrada } from './inscripciones';
import { archivosBajo, png, subirFoto, type OpcionesSubida } from './inscripciones-005b';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 008b (foto desde el panel). Solo usan SQL, HTTP y los contratos públicos: no importan nada de la
 * implementación interna. Reutilizan el escenario del carnet (`escenario-carnet.ts`), el de la 007 y las utilidades de la foto de la 005b
 * (`inscripciones-005b.ts`): `subirFoto` ya sabe mandar un `PUT` crudo con cualquier cabecera, con o sin `Content-Length`.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------------

/** La acción de auditoría de la foto del panel (criterio 27). */
export const ACCION_FOTO_PANEL = 'ALUMNO_FOTO_ACTUALIZADA';

export const rutaFotoAlumno = (alumnoId: string): string => `/api/alumnos/${alumnoId}/foto`;
export const rutaFotoSolicitud = (solicitudId: string): string => `/api/solicitudes/${solicitudId}/foto`;

/** La clave que genera el servidor (criterio 25): `academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid v4}.jpg`. */
export function patronDeClave(academiaId: string, alumnoId: string): RegExp {
  return new RegExp(
    `^academias/${academiaId}/alumnos/${alumnoId}/foto-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.jpg$`,
  );
}

const RUTAS_DE_LA_008B: readonly RegExp[] = [
  /^PUT \/api\/alumnos\/:\w+\/foto$/,
  /^PUT \/api\/solicitudes\/:\w+\/foto$/,
];

/**
 * Falla con un mensaje claro si las dos rutas de la 008b no están registradas (la funcionalidad no existe todavía). Evita que una prueba pase
 * por casualidad con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDe008b(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_008B) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 008b: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// La petición
// ---------------------------------------------------------------------------------------------------------------------

export interface OpcionesFotoPanel extends Omit<OpcionesSubida, 'token' | 'ruta'> {
  /** La cookie de la sesión (sin ella, la petición va sin sesión). */
  cookie?: string;
}

/**
 * `PUT` crudo a una de las dos rutas del panel (cuerpo binario, cualquier cabecera, con o sin `Content-Length`). Sin `cuerpo`, un PNG válido
 * de 100 × 100. Devuelve la respuesta en cuanto llega, aunque la API no lea el cuerpo (401, 403 y 413 no lo leen).
 */
export function subirFotoPanel(
  ctx: { app: NestExpressApplication },
  ruta: string,
  opciones: OpcionesFotoPanel = {},
): Promise<RespuestaApi> {
  const { cookie, headers, cuerpo, ...resto } = opciones;
  return subirFoto(ctx, 'sin-uso', {
    ...resto,
    cuerpo: cuerpo ?? png(100, 100),
    ruta,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------------------------------------------------

/** El escenario del carnet (A y B, caja abierta, rutas de la 008a) y la comprobación de que las dos rutas de la 008b existen. */
export async function prepararEscenarioFotoPanel(ctx: AppCarnet): Promise<EscenarioDelCarnet> {
  const esc = await prepararEscenarioDelCarnet(ctx);
  exigirRutasDe008b(ctx.app);
  return esc;
}

/** Un cliente de A (alumno `CLIENTE` con su solicitud `PENDIENTE_PAGO` y su matrícula reservada), como lo siembra la 007. */
export function sembrarCliente(
  esc: EscenarioDelCarnet,
  opciones: Partial<OpcionesSembrado> = {},
): Promise<SolicitudSembrada> {
  return sembrarCobrable(esc.e, opciones);
}

/**
 * Todo lo que un rechazo no puede cambiar: las dos academias (007), las columnas del QR, la auditoría y los archivos del almacén. Un texto
 * para compararlo antes y después.
 */
export async function instantaneaDeLaFoto(ctx: Pick<AppCarnet, 'raiz'>, esc: EscenarioDelCarnet): Promise<string> {
  return JSON.stringify({ carnet: await instantaneaDelCarnet(esc.e), archivos: archivosBajo(ctx.raiz) });
}
