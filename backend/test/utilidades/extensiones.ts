// spec: 001-academias-aislamiento (pruebas protegidas)
import { ejecutarComo } from './base-datos';

/**
 * Ayuda de las pruebas del criterio 137 (ataque ronda 7, F1): instala una extension en `public` de la base de pruebas, como lo hacen los
 * hostings, y la quita al final (solo lo que creo). Primero `pg_stat_statements` (que concede `SELECT` a `PUBLIC` sobre sus vistas; exige
 * superusuario: Docker y CI); si no se puede, una extension de confianza que el duenio de la base si puede instalar (`pgcrypto`), mas una
 * vista propia `public.vista_de_extension` con `SELECT` para `PUBLIC` agregada a la extension con `ALTER EXTENSION ... ADD VIEW`. Si la
 * extension ya estaba instalada por otro, o no se puede instalar ninguna, no se instala nada (`undefined`) y el caso se omite con aviso.
 *
 * En los dos casos la vista propia existe y es un objeto de la extension: sirve para conceder privilegios a la app sobre un objeto de
 * extension (tabla y columna) con el mismo nombre en cualquiera de las dos vias.
 */

export const VISTA_DE_EXTENSION = 'vista_de_extension';
export const VISTA_EXTRA = 'vista_extra';

/** Codigos de PostgreSQL por los que una extension no se puede instalar aqui: sin permiso, no disponible, sin archivo. */
const SIN_INSTALAR = ['42501', '0A000', '58P01'];
const CANDIDATAS = ['pg_stat_statements', 'pgcrypto'] as const;

const codigoDe = (error: unknown): string | undefined => (error as { code?: string }).code;

export interface ExtensionInstalada {
  /** Extension instalada en `public` por la prueba. */
  readonly nombre: string;
  /** Quita lo que la prueba creo: la vista propia, `vista_extra` y la extension. */
  readonly restaurar: () => Promise<void>;
}

export async function extensionInstalada(nombre: string): Promise<boolean> {
  const { rows } = await ejecutarComo('propietario', 'SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1', [
    nombre,
  ]);
  return rows.length > 0;
}

/** La extension de la que `public.vista_de_extension` es miembro, si la hay (un resto de una ejecucion anterior que murio a medias). */
async function extensionDeLaVista(): Promise<string | undefined> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT e.extname::text AS nombre
       FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
      WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
        AND d.deptype = 'e' AND d.objid = pg_catalog.to_regclass('public.${VISTA_DE_EXTENSION}')`,
  );
  return (rows[0] as { nombre: string } | undefined)?.nombre;
}

/** Quita `vista_extra` y lo que haya quedado de una ejecucion anterior (la vista propia y la extension a la que se agrego). */
export async function limpiarRestosDeExtension(): Promise<void> {
  await ejecutarComo('propietario', `DROP VIEW IF EXISTS public.${VISTA_EXTRA}`);
  const nombre = await extensionDeLaVista();
  if (nombre !== undefined && (CANDIDATAS as readonly string[]).includes(nombre)) {
    await ejecutarComo('propietario', `ALTER EXTENSION ${nombre} DROP VIEW public.${VISTA_DE_EXTENSION}`);
    await ejecutarComo('propietario', `DROP VIEW IF EXISTS public.${VISTA_DE_EXTENSION}`);
    await ejecutarComo('propietario', `DROP EXTENSION IF EXISTS ${nombre}`);
  } else {
    await ejecutarComo('propietario', `DROP VIEW IF EXISTS public.${VISTA_DE_EXTENSION}`);
  }
}

/**
 * Instala una extension en `public` con la vista propia (`SELECT` para `PUBLIC`) agregada a ella, o devuelve `undefined` si no se puede.
 * Llamar a `restaurar()` del resultado deja la base como estaba.
 */
export async function instalarExtensionEnPublic(): Promise<ExtensionInstalada | undefined> {
  for (const nombre of CANDIDATAS) {
    if (await extensionInstalada(nombre)) continue; // la instalo otro: no se toca
    try {
      await ejecutarComo('propietario', `CREATE EXTENSION ${nombre} SCHEMA public`);
    } catch (error) {
      if (SIN_INSTALAR.includes(codigoDe(error) ?? '')) continue;
      throw error;
    }
    const restaurar = async (): Promise<void> => {
      await ejecutarComo('propietario', `DROP VIEW IF EXISTS public.${VISTA_EXTRA}`);
      if ((await extensionDeLaVista()) === nombre) {
        await ejecutarComo('propietario', `ALTER EXTENSION ${nombre} DROP VIEW public.${VISTA_DE_EXTENSION}`);
      }
      await ejecutarComo('propietario', `DROP VIEW IF EXISTS public.${VISTA_DE_EXTENSION}`);
      await ejecutarComo('propietario', `DROP EXTENSION IF EXISTS ${nombre}`);
    };
    try {
      await ejecutarComo('propietario', `CREATE VIEW public.${VISTA_DE_EXTENSION} AS SELECT 1 AS x`);
      await ejecutarComo('propietario', `GRANT SELECT ON public.${VISTA_DE_EXTENSION} TO PUBLIC`);
      await ejecutarComo('propietario', `ALTER EXTENSION ${nombre} ADD VIEW public.${VISTA_DE_EXTENSION}`);
    } catch (error) {
      await restaurar().catch(() => undefined);
      if (SIN_INSTALAR.includes(codigoDe(error) ?? '')) continue;
      throw error;
    }
    return { nombre, restaurar };
  }
  return undefined;
}
