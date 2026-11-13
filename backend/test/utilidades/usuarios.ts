// spec: 002-autenticacion-roles (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect } from 'vitest';
import { RELOJ, RelojFijo } from '../../src/infraestructura/reloj';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from './academias';
import { crearAppDePruebas } from './aplicacion';
import { ejecutarComo, limpiarBase } from './base-datos';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearSuperadminDePrueba, firmarTokenPlataforma, type SuperadminDePrueba } from './superadmins';

/**
 * Utilidades de las pruebas protegidas de la historia 002 (spec.md, "Utilidades de prueba"): usuarios de academia, inicio de
 * sesión y tokens de sesión de academia. Solo usan SQL, HTTP y los contratos públicos; no importan la implementación.
 */

export type RolUsuario = 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO';
export const ROLES: readonly RolUsuario[] = ['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO'];

export const NOMBRE_COOKIE_ACADEMIA = 'aq_sesion';
/** Duración de la sesión del personal (12 horas) y del alumno (30 días), pregunta N8. */
export const DURACION_SESION_PERSONAL_SEGUNDOS = 43_200;
export const DURACION_SESION_ALUMNO_SEGUNDOS = 2_592_000;

/** Instante fijo de las pruebas: 10:00 en America/Lima. */
export const AHORA_PRUEBAS = new Date('2026-11-11T15:00:00.000Z');
export const QUINCE_MINUTOS = 15 * 60 * 1000;

export interface ErrorCuerpo {
  codigo: string;
  mensaje: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

// ---------------------------------------------------------------------------------------------------------------------
// DNI inventados
// ---------------------------------------------------------------------------------------------------------------------

let siguienteDni = 40_000_000 + Math.floor(Math.random() * 5_000_000);

/** Un DNI inventado de 8 dígitos que no se repite dentro del proceso de pruebas. */
export function dniInventado(): string {
  siguienteDni += 1;
  return String(siguienteDni).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------------------------------
// Hash de claves (la librería de la API: @node-rs/argon2, argon2id por defecto)
// ---------------------------------------------------------------------------------------------------------------------

const hashes = new Map<string, string>();

/** Hash argon2id de una clave, calculado con la misma librería de la API. Se recuerda por clave dentro del proceso. */
export async function hashDeClave(clave: string): Promise<string> {
  const conocido = hashes.get(clave);
  if (conocido) return conocido;
  const nombre = '@node-rs/argon2';
  const argon2 = (await import(/* @vite-ignore */ nombre)) as { hash(clave: string): Promise<string> };
  const hash = await argon2.hash(clave);
  hashes.set(clave, hash);
  return hash;
}

// ---------------------------------------------------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------------------------------------------------

export interface UsuarioDePrueba {
  id: string;
  dni: string;
  clave: string;
  academiaId: string;
  rol: RolUsuario;
  nombres: string;
  apellidos: string;
}

/**
 * Crea un usuario con una conexión del dueño y el contexto de su academia (sirve con un dueño superusuario y con uno que no lo es).
 * Por defecto: DNI inventado, `clave` igual al DNI, `debeCambiarClave = false` (una cuenta lista para usar; las pruebas del cambio
 * obligatorio lo piden con `true`) y `estado = 'ACTIVO'`.
 */
export async function crearUsuarioDePrueba(datos: {
  academiaId: string;
  rol: RolUsuario;
  dni?: string;
  clave?: string;
  nombres?: string;
  apellidos?: string;
  debeCambiarClave?: boolean;
  estado?: 'ACTIVO' | 'INACTIVO';
}): Promise<UsuarioDePrueba> {
  const id = randomUUID();
  const dni = datos.dni ?? dniInventado();
  const clave = datos.clave ?? dni;
  const nombres = datos.nombres ?? 'Nombre de prueba';
  const apellidos = datos.apellidos ?? 'Apellido de prueba';
  const ahora = new Date();
  try {
    await ejecutarComo(
      'propietario',
      `INSERT INTO usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, debe_cambiar_clave, estado,
                             version_token, intentos_fallidos, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::rol_usuario, $7, $8, $9::estado_usuario, 0, 0, $10, $10)`,
      [
        id,
        datos.academiaId,
        dni,
        nombres,
        apellidos,
        datos.rol,
        await hashDeClave(clave),
        datos.debeCambiarClave ?? false,
        datos.estado ?? 'ACTIVO',
        ahora,
      ],
      { academiaId: datos.academiaId },
    );
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    // 42P01: la tabla no existe; 42704: faltan los tipos rol_usuario o estado_usuario. Es la funcionalidad de la 002 sin implementar.
    if (codigo === '42P01' || codigo === '42704') {
      throw new Error('Falta la funcionalidad de la 002: la migración de la tabla usuarios no está aplicada.', {
        cause: error,
      });
    }
    throw error;
  }
  return { id, dni, clave, academiaId: datos.academiaId, rol: datos.rol, nombres, apellidos };
}

export interface FilaUsuario {
  id: string;
  academia_id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  rol: RolUsuario;
  clave_hash: string;
  debe_cambiar_clave: boolean;
  estado: 'ACTIVO' | 'INACTIVO';
  version_token: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
  creado_en: Date;
  actualizado_en: Date;
}

const COLUMNAS_USUARIO = `id, academia_id, dni, nombres, apellidos, rol::text AS rol, clave_hash, debe_cambiar_clave,
  estado::text AS estado, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso, creado_en, actualizado_en`;

/** Lee un usuario con una conexión del dueño y el contexto de la academia indicada (otra academia no lo ve). */
export async function leerUsuario(academiaId: string, id: string): Promise<FilaUsuario | undefined> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE id = $1::uuid`,
    [id],
    { academiaId },
  );
  return rows[0] as FilaUsuario | undefined;
}

/** Todos los usuarios de una academia, ordenados por DNI. */
export async function leerUsuarios(academiaId: string): Promise<FilaUsuario[]> {
  const { rows } = await ejecutarComo('propietario', `SELECT ${COLUMNAS_USUARIO} FROM usuarios ORDER BY dni, id`, [], {
    academiaId,
  });
  return rows as FilaUsuario[];
}

/** Usuarios de una academia con ese DNI (a lo sumo uno). */
export async function leerUsuarioPorDni(academiaId: string, dni: string): Promise<FilaUsuario | undefined> {
  const { rows } = await ejecutarComo('propietario', `SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE dni = $1`, [dni], {
    academiaId,
  });
  return rows[0] as FilaUsuario | undefined;
}

/** Cambia columnas de un usuario con una conexión del dueño (para preparar casos: versión, intentos, bloqueo…). */
export async function actualizarUsuario(
  academiaId: string,
  id: string,
  cambios: Partial<{
    rol: RolUsuario;
    estado: 'ACTIVO' | 'INACTIVO';
    debe_cambiar_clave: boolean;
    version_token: number;
    intentos_fallidos: number;
    bloqueado_hasta: Date | null;
    ultimo_acceso: Date | null;
  }>,
): Promise<void> {
  const columnas = Object.keys(cambios);
  if (columnas.length === 0) return;
  const asignaciones = columnas.map((columna, i) => {
    const tipo = columna === 'rol' ? '::rol_usuario' : columna === 'estado' ? '::estado_usuario' : '';
    return `${columna} = $${i + 2}${tipo}`;
  });
  await ejecutarComo(
    'propietario',
    `UPDATE usuarios SET ${asignaciones.join(', ')} WHERE id = $1::uuid`,
    [id, ...Object.values(cambios)],
    { academiaId },
  );
}

/** Cambia la academia a SUSPENDIDA o ACTIVA directamente en la base (como dueño, contexto de plataforma). */
export async function fijarEstadoDeAcademia(academiaId: string, estado: 'ACTIVA' | 'SUSPENDIDA'): Promise<void> {
  await ejecutarComo(
    'propietario',
    `UPDATE academias SET estado = $2::text::estado_academia,
            suspendida_en = CASE WHEN $2 = 'SUSPENDIDA' THEN now() ELSE NULL END,
            motivo_suspension = CASE WHEN $2 = 'SUSPENDIDA' THEN 'Suspendida para la prueba' ELSE NULL END
      WHERE id = $1::uuid`,
    [academiaId, estado],
    { plataforma: true },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Cookie y token de sesión de academia
// ---------------------------------------------------------------------------------------------------------------------

/** Valor del `Set-Cookie` de la cookie de sesión de academia en una respuesta de supertest, o `undefined`. */
export function cookieDeAcademia(cabeceras: Record<string, unknown>): string | undefined {
  const crudo = cabeceras['set-cookie'];
  const lista = Array.isArray(crudo) ? (crudo as string[]) : typeof crudo === 'string' ? [crudo] : [];
  return lista.find((cookie) => cookie.startsWith(`${NOMBRE_COOKIE_ACADEMIA}=`));
}

/** Los atributos de un `Set-Cookie` en minúsculas y sin espacios: `['aq_sesion=abc', 'httponly', 'max-age=1']`. */
export function atributosDeCookie(cookie: string): string[] {
  return cookie.split(';').map((parte) => parte.trim().toLowerCase());
}

/** El token de un `Set-Cookie` de `aq_sesion` (lo que va después del signo igual). */
export function tokenDeCookie(cookie: string): string {
  return cookie.split(';')[0]?.slice(NOMBRE_COOKIE_ACADEMIA.length + 1) ?? '';
}

/**
 * Inicia sesión con `POST /api/a/{nombreCorto}/sesion` y devuelve el valor para la cabecera `Cookie` (`aq_sesion=<token>`).
 * Lanza un error si la respuesta no es 200. Cuenta como una petición para el límite por IP (10 por minuto por aplicación).
 */
export async function iniciarSesionAcademia(
  app: INestApplication,
  nombreCorto: string,
  credenciales: { usuario: string; clave: string },
): Promise<string> {
  const respuesta = await request(app.getHttpServer() as import('node:http').Server)
    .post(`/api/a/${nombreCorto}/sesion`)
    .send(credenciales);
  if (respuesta.status !== 200) {
    throw new Error(`No se pudo iniciar sesión en la academia ${nombreCorto}: HTTP ${respuesta.status}.`);
  }
  const cookie = cookieDeAcademia(respuesta.headers);
  if (!cookie) throw new Error('El inicio de sesión de academia no devolvió la cookie aq_sesion.');
  return cookie.split(';')[0] ?? '';
}

/** Firma un JWT con los `claims` tal cual. Por defecto HS256 con `JWT_SECRETO_PRUEBAS`; `algoritmo: 'none'` no lleva firma. */
export function firmarTokenAcademia(
  claims: Record<string, unknown>,
  opciones: { secreto?: string; algoritmo?: 'HS256' | 'none' } = {},
): string {
  return firmarTokenPlataforma(claims, opciones);
}

/** Claims de una sesión válida (criterio 6) de un usuario en el instante `ahora`. La duración sale del rol. */
export function claimsDeUsuario(
  usuario: { id: string; academiaId: string; rol: RolUsuario },
  ahora: Date,
  sobrescribir: Record<string, unknown> = {},
  version = 0,
): Record<string, unknown> {
  const iat = Math.floor(ahora.getTime() / 1000);
  const duracion = usuario.rol === 'ALUMNO' ? DURACION_SESION_ALUMNO_SEGUNDOS : DURACION_SESION_PERSONAL_SEGUNDOS;
  return {
    sub: usuario.id,
    tipo: 'academia',
    aca: usuario.academiaId,
    ver: version,
    iat,
    exp: iat + duracion,
    ...sobrescribir,
  };
}

/** Valor para la cabecera `Cookie` de una sesión válida, firmada sin pasar por el inicio de sesión (no cuenta para el límite). */
export function cookieDeUsuario(
  usuario: { id: string; academiaId: string; rol: RolUsuario },
  ahora: Date,
  sobrescribir: Record<string, unknown> = {},
  version = 0,
): string {
  return `${NOMBRE_COOKIE_ACADEMIA}=${firmarTokenAcademia(claimsDeUsuario(usuario, ahora, sobrescribir, version))}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aplicación de pruebas con reloj fijo
// ---------------------------------------------------------------------------------------------------------------------

/** Aplicación con `RELOJ` reemplazado por un `RelojFijo` en `ahora`. Cada aplicación tiene su propio límite por IP. */
export async function crearAppConReloj(
  ahora: Date = AHORA_PRUEBAS,
  opciones: Parameters<typeof crearAppDePruebas>[0] = {},
): Promise<{ app: NestExpressApplication; reloj: RelojFijo }> {
  const reloj = new RelojFijo(ahora);
  const ajustarAdicional = opciones.ajustar;
  const app = await crearAppDePruebas({
    nivelRegistro: 'silent',
    ...opciones,
    ajustar: (constructor) => {
      const conReloj = constructor.overrideProvider(RELOJ).useValue(reloj);
      return ajustarAdicional ? ajustarAdicional(conReloj) : conReloj;
    },
  });
  return { app, reloj };
}

// ---------------------------------------------------------------------------------------------------------------------
// Módulos de producción de la 002 (se cargan con importación dinámica: antes de implementarlos fallan con un mensaje claro)
// ---------------------------------------------------------------------------------------------------------------------

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/** Carga un módulo de producción de la 002 y comprueba sus exportaciones: si falta, falla con un mensaje claro. */
export async function cargarFuncionalidad002<T>(rutaDesdeSrc: string, exportaciones: readonly string[]): Promise<T> {
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ_SRC, rutaDesdeSrc)).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 002: no se pudo cargar "backend/src/${rutaDesdeSrc}" (${motivo}).`, {
      cause: error,
    });
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 002: "backend/src/${rutaDesdeSrc}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

export interface ModuloAutenticacion {
  Permiso: (permiso: string) => MethodDecorator & ClassDecorator;
  SoloSesion: () => MethodDecorator & ClassDecorator;
  /** Fábrica de decorador de parámetro: `@UsuarioActual() usuario` (precisión del orquestador PO-1). */
  UsuarioActual: () => ParameterDecorator;
}

/** `backend/src/modulos/autenticacion/index.ts` (contrato: `Permiso`, `SoloSesion` y `UsuarioActual`). */
export async function cargarAutenticacion(): Promise<ModuloAutenticacion> {
  return cargarFuncionalidad002<ModuloAutenticacion>('modulos/autenticacion/index.ts', [
    'Permiso',
    'SoloSesion',
    'UsuarioActual',
  ]);
}

/** Ruta HTTP completa de una ruta de academia: `[método, ruta]`. */
export type RutaRegistrada = readonly [metodo: string, ruta: string];

/**
 * Las rutas registradas en el enrutador de Express de la aplicación (método y ruta, con los parámetros como `:id`). Lee la pila
 * del enrutador de Express: no depende de ningún nombre de la implementación.
 */
export function rutasRegistradas(app: INestApplication): RutaRegistrada[] {
  const instancia = app.getHttpAdapter().getInstance() as {
    router?: { stack?: unknown[] };
    _router?: { stack?: unknown[] };
  };
  const pila = (instancia.router?.stack ?? instancia._router?.stack ?? []) as {
    route?: { path: string | string[]; methods?: Record<string, boolean> };
  }[];
  const rutas: RutaRegistrada[] = [];
  for (const capa of pila) {
    if (!capa.route) continue;
    const caminos = Array.isArray(capa.route.path) ? capa.route.path : [capa.route.path];
    for (const camino of caminos) {
      for (const [metodo, activo] of Object.entries(capa.route.methods ?? {})) {
        if (activo && typeof camino === 'string') rutas.push([metodo.toUpperCase(), camino]);
      }
    }
  }
  return rutas;
}

/** El cuerpo de una respuesta de éxito (2xx); si la respuesta no es de éxito, la prueba falla con el estado y el cuerpo recibidos. */
export function cuerpoDe(respuesta: { status: number; body: unknown }): unknown {
  expect(
    respuesta.status >= 200 && respuesta.status < 300,
    `se esperaba una respuesta de éxito y fue HTTP ${respuesta.status}: ${JSON.stringify(respuesta.body)}`,
  ).toBe(true);
  return respuesta.body;
}

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones y escenario común
// ---------------------------------------------------------------------------------------------------------------------

export type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

/** Una petición de supertest lista para esperar (`await pedir(app, 'get', '/api/sesion', { cookie })`). */
export function pedir(
  app: INestApplication,
  metodo: Metodo,
  ruta: string,
  opciones: { cookie?: string; cuerpo?: unknown } = {},
): request.Test {
  let peticion = request(app.getHttpServer() as import('node:http').Server)[metodo](ruta);
  if (opciones.cookie) peticion = peticion.set('Cookie', opciones.cookie);
  if (opciones.cuerpo !== undefined) peticion = peticion.send(opciones.cuerpo as object);
  return peticion;
}

/** Clave que comparten los usuarios del escenario (así el hash argon2 se calcula una sola vez por proceso). */
export const CLAVE_COMUN = 'Clave-Comun-2026';

export interface Escenario {
  A: AcademiaDePrueba;
  B: AcademiaDePrueba;
  superadmin: SuperadminDePrueba;
  adminA: UsuarioDePrueba;
  secretariaA: UsuarioDePrueba;
  entrenadorA: UsuarioDePrueba;
  alumnoA: UsuarioDePrueba;
  adminB: UsuarioDePrueba;
  secretariaB: UsuarioDePrueba;
  alumnoB: UsuarioDePrueba;
}

/**
 * Vacía la base y crea dos academias activas (`academia-a`, `academia-b`), un superadmin y usuarios de cada rol: cuatro en A (ADMIN,
 * SECRETARIA, ENTRENADOR, ALUMNO) y tres en B (ADMIN, SECRETARIA, ALUMNO), todos activos, con `clave = CLAVE_COMUN` y sin cambio
 * obligatorio. Cada usuario tiene un DNI inventado distinto.
 */
export async function crearEscenario(): Promise<Escenario> {
  await limpiarBase();
  const A = await crearAcademiaDePrueba({ nombreCorto: 'academia-a', nombre: 'Academia A' });
  const B = await crearAcademiaDePrueba({ nombreCorto: 'academia-b', nombre: 'Academia B' });
  const superadmin = await crearSuperadminDePrueba();
  const nuevo = (academia: AcademiaDePrueba, rol: RolUsuario, nombres: string, apellidos: string) =>
    crearUsuarioDePrueba({ academiaId: academia.id, rol, clave: CLAVE_COMUN, nombres, apellidos });
  return {
    A,
    B,
    superadmin,
    adminA: await nuevo(A, 'ADMIN', 'Rosa', 'Alvarez'),
    secretariaA: await nuevo(A, 'SECRETARIA', 'Lucia', 'Benites'),
    entrenadorA: await nuevo(A, 'ENTRENADOR', 'Mario', 'Castro'),
    alumnoA: await nuevo(A, 'ALUMNO', 'Diego', 'Delgado'),
    adminB: await nuevo(B, 'ADMIN', 'Elena', 'Espinoza'),
    secretariaB: await nuevo(B, 'SECRETARIA', 'Fabiola', 'Flores'),
    alumnoB: await nuevo(B, 'ALUMNO', 'Gonzalo', 'Guzman'),
  };
}

/** Cuántas filas de `auditoria` tiene una academia (con una conexión del dueño y su contexto). */
export async function contarAuditoria(academiaId: string, accion?: string): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT count(*)::int AS n FROM auditoria WHERE ($1::text IS NULL OR accion = $1)',
    [accion ?? null],
    { academiaId },
  );
  return (rows[0] as { n: number }).n;
}

/** Instantánea de los usuarios de una academia, para comprobar que una operación rechazada no cambió nada. */
export async function instantaneaDeUsuarios(academiaId: string): Promise<string> {
  return JSON.stringify(await leerUsuarios(academiaId));
}
