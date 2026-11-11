// spec: 001-academias-aislamiento (pruebas protegidas)
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JWT_SECRETO_PRUEBAS } from './aplicacion';
import { ejecutarComo } from './base-datos';

/** Clave de los superadmins de prueba: su hash argon2id está calculado de antemano (no hay librería en las pruebas). */
export const CLAVE_SUPERADMIN_PRUEBAS = 'ClaveSegura-2026!';
const HASH_CLAVE_SUPERADMIN_PRUEBAS =
  '$argon2id$v=19$m=19456,t=2,p=1$bpDRX2Mw2LOOeSUbq2u1Lg$nYIjfSzZuif5ukSmgRr+oy4KsuYn96KJiqi4QYVJ5AU';

/** Otra clave válida (12 caracteres o más), con su hash también calculado de antemano. */
export const OTRA_CLAVE_SUPERADMIN_PRUEBAS = 'Otra-Clave-9876';
const HASH_OTRA_CLAVE_SUPERADMIN_PRUEBAS =
  '$argon2id$v=19$m=19456,t=2,p=1$Nlu0loa7rmlkOP6r52NvbA$A28bzg4/bCItgJ9ty0Sa3oQvIwLyB6QRxw1fx27bcJI';

async function hashDe(clave: string): Promise<string> {
  if (clave === CLAVE_SUPERADMIN_PRUEBAS) return HASH_CLAVE_SUPERADMIN_PRUEBAS;
  if (clave === OTRA_CLAVE_SUPERADMIN_PRUEBAS) return HASH_OTRA_CLAVE_SUPERADMIN_PRUEBAS;
  // Cualquier otra clave se calcula con la librería de la API, que agrega la historia 001.
  const nombre = '@node-rs/argon2';
  const argon2 = (await import(/* @vite-ignore */ nombre)) as { hash(clave: string): Promise<string> };
  return argon2.hash(clave);
}

export interface SuperadminDePrueba {
  id: string;
  correo: string;
  nombre: string;
  clave: string;
}

/**
 * Crea un superadmin con una conexión del dueño y el contexto de plataforma. El correo se guarda en minúsculas.
 * Por defecto: correo único, nombre "Superadmin de prueba" y `CLAVE_SUPERADMIN_PRUEBAS`.
 */
export async function crearSuperadminDePrueba(
  datos: { correo?: string; nombre?: string; clave?: string } = {},
): Promise<SuperadminDePrueba> {
  const id = randomUUID();
  const correo = (datos.correo ?? `superadmin-${randomBytes(4).toString('hex')}@aquagestion.test`).toLowerCase();
  const nombre = datos.nombre ?? 'Superadmin de prueba';
  const clave = datos.clave ?? CLAVE_SUPERADMIN_PRUEBAS;
  const ahora = new Date();
  await ejecutarComo(
    'propietario',
    `INSERT INTO superadmins (id, correo, nombre, clave_hash, version_token, intentos_fallidos, creado_en, actualizado_en)
     VALUES ($1::uuid, $2, $3, $4, 0, 0, $5, $5)`,
    [id, correo, nombre, await hashDe(clave), ahora],
    { plataforma: true },
  );
  return { id, correo, nombre, clave };
}

export const NOMBRE_COOKIE_PLATAFORMA = 'aq_plataforma';

/** Valor del `Set-Cookie` de la cookie de plataforma en una respuesta de supertest, o `undefined`. */
export function cookieDePlataforma(cabeceras: Record<string, unknown>): string | undefined {
  const crudo = cabeceras['set-cookie'];
  const lista = Array.isArray(crudo) ? (crudo as string[]) : typeof crudo === 'string' ? [crudo] : [];
  return lista.find((cookie) => cookie.startsWith(`${NOMBRE_COOKIE_PLATAFORMA}=`));
}

/**
 * Inicia sesión con `POST /api/plataforma/sesion` y devuelve el valor para la cabecera `Cookie`
 * (`aq_plataforma=<token>`). Lanza un error si la respuesta no es 200.
 */
export async function iniciarSesionPlataforma(
  app: INestApplication,
  credenciales: { correo: string; clave: string },
): Promise<string> {
  const respuesta = await request(app.getHttpServer() as import('node:http').Server)
    .post('/api/plataforma/sesion')
    .send(credenciales);
  if (respuesta.status !== 200) {
    throw new Error(`No se pudo iniciar sesión en la plataforma: HTTP ${respuesta.status}.`);
  }
  const cookie = cookieDePlataforma(respuesta.headers);
  if (!cookie) throw new Error('El inicio de sesión de la plataforma no devolvió la cookie aq_plataforma.');
  return cookie.split(';')[0] ?? '';
}

function base64url(entrada: Buffer | string): string {
  return Buffer.from(entrada).toString('base64url');
}

/**
 * Firma un JWT con los `claims` tal cual (sin agregar ninguno). Por defecto HS256 con `JWT_SECRETO_PRUEBAS`;
 * `algoritmo: 'none'` produce un token sin firma (`alg: none`).
 */
export function firmarTokenPlataforma(
  claims: Record<string, unknown>,
  opciones: { secreto?: string; algoritmo?: 'HS256' | 'none' } = {},
): string {
  const algoritmo = opciones.algoritmo ?? 'HS256';
  const cabecera = base64url(JSON.stringify({ alg: algoritmo, typ: 'JWT' }));
  const cuerpo = base64url(JSON.stringify(claims));
  if (algoritmo === 'none') return `${cabecera}.${cuerpo}.`;
  const firma = createHmac('sha256', opciones.secreto ?? JWT_SECRETO_PRUEBAS)
    .update(`${cabecera}.${cuerpo}`)
    .digest();
  return `${cabecera}.${cuerpo}.${base64url(firma)}`;
}

export const DURACION_SESION_SEGUNDOS = 28_800;

/** Claims de una sesión válida (criterio 37) en el instante `ahora`. */
export function claimsDeSesion(
  superadmin: { id: string },
  ahora: Date,
  sobrescribir: Record<string, unknown> = {},
): Record<string, unknown> {
  const iat = Math.floor(ahora.getTime() / 1000);
  return { sub: superadmin.id, tipo: 'plataforma', ver: 0, iat, exp: iat + DURACION_SESION_SEGUNDOS, ...sobrescribir };
}

/** Valor para la cabecera `Cookie` de una sesión válida, firmada sin pasar por el inicio de sesión. */
export function cookieDeSesion(
  superadmin: { id: string },
  ahora: Date,
  sobrescribir: Record<string, unknown> = {},
): string {
  return `${NOMBRE_COOKIE_PLATAFORMA}=${firmarTokenPlataforma(claimsDeSesion(superadmin, ahora, sobrescribir))}`;
}

/** Decodifica un JWT sin verificarlo: cabecera, claims y si la firma HS256 es correcta con `JWT_SECRETO_PRUEBAS`. */
export function decodificarToken(token: string): {
  cabecera: Record<string, unknown>;
  claims: Record<string, unknown>;
  firmaValida: boolean;
} {
  const [cabecera = '', cuerpo = '', firma = ''] = token.split('.');
  const esperada = createHmac('sha256', JWT_SECRETO_PRUEBAS).update(`${cabecera}.${cuerpo}`).digest('base64url');
  return {
    cabecera: JSON.parse(Buffer.from(cabecera, 'base64url').toString('utf8')) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as Record<string, unknown>,
    firmaValida: firma === esperada,
  };
}
