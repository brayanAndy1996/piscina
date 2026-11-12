// spec: 001-academias-aislamiento (pruebas protegidas)
import { ejecutarComo } from './base-datos';

/**
 * Ayuda de las pruebas del criterio 141 (ataque ronda 8, F1): esquemas que pertenecen a una extension (`ALTER EXTENSION pgcrypto ADD
 * SCHEMA reportes2`) y contienen objetos propios, hechos por el DUENIO de la base de pruebas (sirve igual si es superusuario). La
 * extension (`pgcrypto`, de confianza: el duenio puede crearla) se instala en `public` solo si no estaba; se le pone un comentario
 * marca para reconocerla si una ejecucion anterior murio a medias, y `restaurar()` deja la base como estaba: quita lo agregado a la
 * extension, borra los esquemas y borra la extension solo si la creo la prueba.
 */

export const EXTENSION = 'pgcrypto';
/** Esquema del ataque (criterio 141, caso 1): pertenece a la extension y tiene una tabla propia sin RLS. */
export const ESQUEMA_ATAQUE = 'reportes2';
/** Esquema del control (caso 4): pertenece a la extension y solo tiene objetos de la extension (una funcion y un tipo compuesto). */
export const ESQUEMA_CONTROL = 'ext_r8';

const MARCA = 'instalada por una prueba protegida de la 001 (criterios 141 y 142): se puede borrar';
/** Codigos de PostgreSQL por los que una extension no se puede instalar aqui: sin permiso, no disponible, sin archivo. */
const SIN_INSTALAR = ['42501', '0A000', '58P01'];
/** Codigos de lo que ya no existe o no es miembro de la extension: al restaurar se ignoran. */
const NO_EXISTE = ['3F000', '42883', '42704', '55000', '42P01'];

const codigoDe = (error: unknown): string | undefined => (error as { code?: string }).code;

async function ignorandoSiNoExiste(sentencia: string): Promise<void> {
  try {
    await ejecutarComo('propietario', sentencia);
  } catch (error) {
    if (!NO_EXISTE.includes(codigoDe(error) ?? '')) throw error;
  }
}

export async function extensionInstalada(): Promise<boolean> {
  const { rows } = await ejecutarComo('propietario', 'SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1', [
    EXTENSION,
  ]);
  return rows.length > 0;
}

/** Quita de la extension lo que las pruebas le agregaron y borra los dos esquemas (si existen). Ignora lo que ya no esta. */
export async function quitarEsquemasDeExtension(): Promise<void> {
  const pasos = [
    `ALTER EXTENSION ${EXTENSION} DROP FUNCTION ${ESQUEMA_CONTROL}.f()`,
    `ALTER EXTENSION ${EXTENSION} DROP TYPE ${ESQUEMA_CONTROL}.par`,
    `ALTER EXTENSION ${EXTENSION} DROP TABLE ${ESQUEMA_ATAQUE}.t_ext`,
    `ALTER EXTENSION ${EXTENSION} DROP SCHEMA ${ESQUEMA_CONTROL}`,
    `ALTER EXTENSION ${EXTENSION} DROP SCHEMA ${ESQUEMA_ATAQUE}`,
  ];
  for (const paso of pasos) await ignorandoSiNoExiste(paso);
  await ejecutarComo('propietario', `DROP SCHEMA IF EXISTS ${ESQUEMA_CONTROL} CASCADE`);
  await ejecutarComo('propietario', `DROP SCHEMA IF EXISTS ${ESQUEMA_ATAQUE} CASCADE`);
}

/** Borra la extension si lleva la marca de las pruebas (resto de una ejecucion anterior que murio a medias). */
async function borrarExtensionMarcada(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT pg_catalog.obj_description(e.oid, 'pg_extension') AS comentario
       FROM pg_catalog.pg_extension e WHERE e.extname = $1`,
    [EXTENSION],
  );
  const comentario = (rows[0] as { comentario: string | null } | undefined)?.comentario;
  if (comentario === MARCA) await ejecutarComo('propietario', `DROP EXTENSION IF EXISTS ${EXTENSION}`);
}

/** Limpia los restos de una ejecucion anterior que murio a medias: los dos esquemas y la extension marcada. */
export async function limpiarRestosDeEsquemasDeExtension(): Promise<void> {
  await quitarEsquemasDeExtension();
  await borrarExtensionMarcada();
}

export interface ExtensionParaEsquemas {
  /** Deja la base como estaba: quita lo agregado a la extension, borra los esquemas y la extension (la creo la prueba). */
  readonly restaurar: () => Promise<void>;
}

/**
 * Instala `pgcrypto` en `public` con el duenio de la base. Devuelve `undefined` si ya estaba instalada por otro (no se toca) o si el
 * duenio no puede instalarla; entonces el caso se omite con aviso.
 */
export async function instalarExtensionParaEsquemas(): Promise<ExtensionParaEsquemas | undefined> {
  if (await extensionInstalada()) return undefined;
  try {
    await ejecutarComo('propietario', `CREATE EXTENSION ${EXTENSION} SCHEMA public`);
  } catch (error) {
    if (SIN_INSTALAR.includes(codigoDe(error) ?? '')) return undefined;
    throw error;
  }
  const restaurar = async (): Promise<void> => {
    try {
      await quitarEsquemasDeExtension();
    } finally {
      await ejecutarComo('propietario', `DROP EXTENSION IF EXISTS ${EXTENSION}`);
    }
  };
  try {
    await ejecutarComo('propietario', `COMMENT ON EXTENSION ${EXTENSION} IS '${MARCA}'`);
  } catch (error) {
    await restaurar().catch(() => undefined);
    throw error;
  }
  return { restaurar };
}

/** Sentencias (como duenio) del ataque del criterio 141: `reportes2` pertenece a la extension y tiene la tabla `t` sin RLS. */
export const sentenciasDelAtaque = (destinatario: string): readonly string[] => [
  `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
  `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
  `CREATE TABLE ${ESQUEMA_ATAQUE}.t (academia_id uuid, dato text)`,
  `GRANT USAGE ON SCHEMA ${ESQUEMA_ATAQUE} TO ${destinatario}`,
  `GRANT SELECT ON ${ESQUEMA_ATAQUE}.t TO ${destinatario}`,
];

/** Sentencias (como duenio) del control del caso 4: `ext_r8` con una funcion y un tipo compuesto, todo de la extension. */
export const sentenciasDelControl: readonly string[] = [
  `CREATE SCHEMA ${ESQUEMA_CONTROL}`,
  `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_CONTROL}`,
  `CREATE FUNCTION ${ESQUEMA_CONTROL}.f() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
  `CREATE TYPE ${ESQUEMA_CONTROL}.par AS (a int)`,
  `ALTER EXTENSION ${EXTENSION} ADD FUNCTION ${ESQUEMA_CONTROL}.f()`,
  `ALTER EXTENSION ${EXTENSION} ADD TYPE ${ESQUEMA_CONTROL}.par`,
];
