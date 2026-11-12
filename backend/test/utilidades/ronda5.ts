// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { crearAppDePruebas } from './aplicacion';
import { conClienteComo, ejecutarComo, urlAppPruebas } from './base-datos';
import { leerSuperadmin } from './datos';
import {
  citar,
  esperarCondicion,
  nombreDeLaBase,
  obtenerBaseDatosRonda3,
  urlConOpciones,
  type BaseDatosRonda3,
} from './ronda3';
import { crearSuperadminDePrueba } from './superadmins';

/**
 * Ayudas de las pruebas protegidas de la ronda 5 del ataque (criterios 121 y 122): el esquema `trampa` con tablas y funciones
 * falsas, y las vias de contaminacion de parametros de la sesion (`search_path`, `standard_conforming_strings`) de la conexion
 * de la API: (a) un `trabajo` anterior con `set_config(..., false)`, (b) `options` en `DATABASE_URL_APP`, (c) `ALTER DATABASE`,
 * (d) `ALTER ROLE ALL [IN DATABASE]` y (e) el archivo de configuracion del servidor (`ALTER SYSTEM`).
 *
 * Cuidado con el codigo que corre con la conexion del dueno MIENTRAS una via de base, de roles o del servidor esta activa: esas
 * vias tambien contaminan las conexiones del dueno, asi que ahi solo se usan sentencias con nombres calificados y sin `set_config`
 * sin calificar (`ejecutarComo` con contexto fija el contexto con un `set_config` sin calificar y no sirve en ese momento).
 */

export const APP = 'aquagestion_app';
export const ESQUEMA_TRAMPA = 'trampa';

/** `search_path` contaminado: la trampa va primero (sin y con `"$user"` delante). */
export const RUTA_1 = 'trampa, pg_catalog, public';
export const RUTA_2 = '"$user", trampa, pg_catalog, public';
/** El `search_path` que fijan las transacciones (criterio 121), sin espacios. */
export const RUTA_FIJA = 'pg_catalog,public,pg_temp';

export const sinEspacios = (texto: string): string => texto.replace(/\s+/g, '');

export async function esSuperusuario(): Promise<boolean> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  return (rows[0] as { rolsuper: boolean }).rolsuper;
}

/** ¿Puede el dueno crear esquemas en la base de pruebas? (CREATE sobre la base). */
export async function puedeCrearEsquemas(): Promise<boolean> {
  try {
    await conClienteComo('propietario', async (cliente) => {
      await cliente.query('BEGIN');
      try {
        await cliente.query('CREATE SCHEMA trampa_sonda_ronda5');
      } finally {
        await cliente.query('ROLLBACK').catch(() => undefined);
      }
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === '42501') return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// El esquema `trampa`
// ---------------------------------------------------------------------------------------------------------------------

export async function borrarTrampa(): Promise<void> {
  await ejecutarComo('propietario', `DROP SCHEMA IF EXISTS ${ESQUEMA_TRAMPA} CASCADE`);
}

/** Hash argon2id de una clave que no es la del superadmin: la del atacante (el superadmin auxiliar se borra enseguida). */
export async function hashDeLaClaveDelAtacante(claveDelAtacante: string): Promise<string> {
  const auxiliar = await crearSuperadminDePrueba({ clave: claveDelAtacante });
  const fila = await leerSuperadmin(auxiliar.id);
  await ejecutarComo('propietario', 'DELETE FROM public.superadmins WHERE id = $1::uuid', [auxiliar.id], {
    plataforma: true,
  });
  if (!fila) throw new Error('No se pudo leer el hash del superadmin auxiliar.');
  return fila.clave_hash;
}

/**
 * Crea el esquema `trampa` (criterio 121): la app tiene USAGE (no es dueña ni tiene CREATE) y SELECT en las tablas falsas
 * `trampa.academias` y `trampa.superadmins`, con las mismas columnas que las de `public` y las filas de `public` cambiadas: la
 * academia suspendida aparece como ACTIVA y la clave del superadmin es el hash de la clave del atacante. Funciones falsas:
 * `trampa.set_config(text, text, boolean)` (devuelve su segundo argumento sin fijar nada), `trampa.has_table_privilege` (siempre
 * `false`, con las formas de argumentos con que se puede llamar) y `trampa.unnest(anyarray)` (no devuelve filas). Debe llamarse con los datos ya creados y la academia ya suspendida.
 */
export async function crearTrampa(hashDelAtacante: string): Promise<void> {
  await borrarTrampa();
  const sentencias = [
    `CREATE SCHEMA ${ESQUEMA_TRAMPA}`,
    `GRANT USAGE ON SCHEMA ${ESQUEMA_TRAMPA} TO ${APP}`,
    `CREATE TABLE ${ESQUEMA_TRAMPA}.academias (LIKE public.academias INCLUDING DEFAULTS)`,
    `CREATE TABLE ${ESQUEMA_TRAMPA}.superadmins (LIKE public.superadmins INCLUDING DEFAULTS)`,
  ];
  for (const sentencia of sentencias) await ejecutarComo('propietario', sentencia);
  await ejecutarComo('propietario', `INSERT INTO ${ESQUEMA_TRAMPA}.academias SELECT * FROM public.academias`, [], {
    plataforma: true,
  });
  await ejecutarComo(
    'propietario',
    `UPDATE ${ESQUEMA_TRAMPA}.academias SET estado = 'ACTIVA', motivo_suspension = NULL, suspendida_en = NULL`,
  );
  await ejecutarComo('propietario', `INSERT INTO ${ESQUEMA_TRAMPA}.superadmins SELECT * FROM public.superadmins`, [], {
    plataforma: true,
  });
  await ejecutarComo('propietario', `UPDATE ${ESQUEMA_TRAMPA}.superadmins SET clave_hash = $1`, [hashDelAtacante]);
  const final = [
    `GRANT SELECT, INSERT, UPDATE ON ${ESQUEMA_TRAMPA}.academias, ${ESQUEMA_TRAMPA}.superadmins TO ${APP}`,
    `CREATE FUNCTION ${ESQUEMA_TRAMPA}.set_config(text, text, boolean) RETURNS text LANGUAGE sql AS 'SELECT $2'`,
    `CREATE FUNCTION ${ESQUEMA_TRAMPA}.has_table_privilege(name, oid, text) RETURNS boolean LANGUAGE sql AS 'SELECT false'`,
    `CREATE FUNCTION ${ESQUEMA_TRAMPA}.has_table_privilege(oid, oid, text) RETURNS boolean LANGUAGE sql AS 'SELECT false'`,
    `CREATE FUNCTION ${ESQUEMA_TRAMPA}.has_table_privilege(name, text, text) RETURNS boolean LANGUAGE sql AS 'SELECT false'`,
    `CREATE FUNCTION ${ESQUEMA_TRAMPA}.has_table_privilege(oid, text, text) RETURNS boolean LANGUAGE sql AS 'SELECT false'`,
    // La comprobacion del rol recorre los privilegios con `unnest(ARRAY[...])`: una `unnest` falsa que no devuelve filas esconderia
    // cualquier privilegio de mas si la consulta la llama sin calificar con `pg_catalog.`.
    `CREATE FUNCTION ${ESQUEMA_TRAMPA}.unnest(anyarray) RETURNS SETOF anyelement LANGUAGE plpgsql AS 'BEGIN RETURN; END'`,
  ];
  for (const sentencia of final) await ejecutarComo('propietario', sentencia);
}

// ---------------------------------------------------------------------------------------------------------------------
// Vias de contaminacion
// ---------------------------------------------------------------------------------------------------------------------

export type Via = 'sesion' | 'url' | 'base' | 'roles' | 'roles-base' | 'servidor';

/** Un parametro de la sesion y el valor contaminado, escrito para cada via. */
export interface Contaminado {
  /** Nombre del parametro de PostgreSQL. */
  readonly nombre: string;
  /** Valor para `set_config(nombre, valor, false)` (un texto). */
  readonly sesion: string;
  /** Valor en `?options=-c nombre=valor` (sin espacios). */
  readonly opcion: string;
  /** Valor en `ALTER DATABASE/ROLE ... SET nombre <valor>` (SQL: `TO a, b` o `= off`). */
  readonly sql: string;
}

export const SEARCH_PATH_1: Contaminado = {
  nombre: 'search_path',
  sesion: RUTA_1,
  opcion: 'trampa,pg_catalog,public',
  sql: `TO ${RUTA_1}`,
};
export const SEARCH_PATH_2: Contaminado = {
  nombre: 'search_path',
  sesion: RUTA_2,
  opcion: '"$user",trampa,pg_catalog,public',
  sql: `TO ${RUTA_2}`,
};
export const CADENAS_EN_OFF: Contaminado = {
  nombre: 'standard_conforming_strings',
  sesion: 'off',
  opcion: 'off',
  sql: '= off',
};

export interface Capacidades {
  readonly superusuario: boolean;
  readonly alteraLaBase: boolean;
  readonly creaEsquemas: boolean;
}

export async function elDuenoPuedeAlterarLaBase(): Promise<boolean> {
  const base = citar(await nombreDeLaBase());
  try {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} SET application_name = 'sonda_ronda5'`);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === '42501') return false;
    throw error;
  } finally {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} RESET application_name`).catch(() => undefined);
  }
}

export async function detectarCapacidades(): Promise<Capacidades> {
  return {
    superusuario: await esSuperusuario(),
    alteraLaBase: await elDuenoPuedeAlterarLaBase(),
    creaEsquemas: await puedeCrearEsquemas(),
  };
}

/** Por que no se puede ejecutar la via aqui (para omitirla con aviso), o `undefined` si se puede. */
export function motivoParaOmitir(via: Via, capacidades: Capacidades, exigeEsquemas = true): string | undefined {
  if (exigeEsquemas && !capacidades.creaEsquemas)
    return 'el dueno de la base de pruebas no puede crear esquemas (CREATE sobre la base)';
  if (via === 'base' && !capacidades.alteraLaBase)
    return 'el dueno de la base no puede ejecutar ALTER DATABASE ... SET';
  if ((via === 'roles' || via === 'roles-base' || via === 'servidor') && !capacidades.superusuario) {
    return 'exige superusuario (ALTER ROLE ALL / ALTER SYSTEM): corre en Docker y en la CI';
  }
  return undefined;
}

async function sinTransaccion(sentencia: string): Promise<void> {
  await conClienteComo('propietario', async (cliente) => {
    await cliente.query(sentencia);
  });
}

async function alterarBase(parametros: readonly Contaminado[]): Promise<void> {
  const base = citar(await nombreDeLaBase());
  for (const p of parametros) await ejecutarComo('propietario', `ALTER DATABASE ${base} SET ${p.nombre} ${p.sql}`);
}
async function restaurarBase(nombres: readonly string[]): Promise<void> {
  const base = citar(await nombreDeLaBase());
  for (const nombre of nombres) {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} RESET ${nombre}`).catch(() => undefined);
  }
}
async function alterarRoles(parametros: readonly Contaminado[], enLaBase: boolean): Promise<void> {
  const donde = enLaBase ? `IN DATABASE ${citar(await nombreDeLaBase())}` : '';
  for (const p of parametros) {
    await ejecutarComo('propietario', `ALTER ROLE ALL ${donde} SET ${p.nombre} ${p.sql}`);
  }
}
async function restaurarRoles(nombres: readonly string[], enLaBase: boolean): Promise<void> {
  const donde = enLaBase ? `IN DATABASE ${citar(await nombreDeLaBase())}` : '';
  for (const nombre of nombres) {
    await ejecutarComo('propietario', `ALTER ROLE ALL ${donde} RESET ${nombre}`).catch(() => undefined);
  }
}
async function alterarServidor(parametros: readonly Contaminado[]): Promise<void> {
  for (const p of parametros) await sinTransaccion(`ALTER SYSTEM SET ${p.nombre} = '${p.sesion}'`);
  await sinTransaccion('SELECT pg_reload_conf()');
}
async function restaurarServidor(nombres: readonly string[]): Promise<void> {
  for (const nombre of nombres) await sinTransaccion(`ALTER SYSTEM RESET ${nombre}`).catch(() => undefined);
  await sinTransaccion('SELECT pg_reload_conf()').catch(() => undefined);
}

/** Valor que ve una conexion NUEVA de la app para un parametro (el efecto de la base, los roles o el servidor). */
async function valorParaUnaConexionNueva(nombre: string): Promise<string> {
  return conClienteComo('app', async (cliente) => {
    const { rows } = await cliente.query('SELECT pg_catalog.current_setting($1) AS valor', [nombre]);
    return (rows[0] as { valor: string }).valor;
  });
}

/** Quita los restos de una ejecucion anterior que murio a medias (de la base, de los roles y del servidor). */
export async function limpiarRestos(nombres: readonly string[], capacidades: Capacidades): Promise<void> {
  if (capacidades.alteraLaBase) await restaurarBase(nombres);
  if (capacidades.superusuario) {
    await restaurarRoles(nombres, true);
    await restaurarRoles(nombres, false);
    await restaurarServidor(nombres);
    await esperarCondicion(async () => {
      for (const nombre of nombres) {
        const visto = await valorParaUnaConexionNueva(nombre);
        if (nombre === 'search_path' && visto.includes('trampa')) return false;
        if (nombre === 'standard_conforming_strings' && visto !== 'on') return false;
      }
      return true;
    }, 5000);
  }
}

export interface ApiContaminada {
  readonly app: NestExpressApplication;
  readonly baseDatos: BaseDatosRonda3;
  /** Cierra la API y deshace la contaminacion de la base, los roles o el servidor. */
  readonly cerrar: () => Promise<void>;
}

async function crearApi(url?: string): Promise<{ app: NestExpressApplication; baseDatos: BaseDatosRonda3 }> {
  const app = await crearAppDePruebas({
    nivelRegistro: 'silent',
    variables: { DATABASE_POOL_MAX: '1', ...(url ? { DATABASE_URL_APP: url } : {}) },
  });
  return { app, baseDatos: await obtenerBaseDatosRonda3(app) };
}

/**
 * Crea la API de pruebas con UNA sola conexion (`DATABASE_POOL_MAX=1`) contaminada por la via indicada. Quien la crea debe llamar a
 * `cerrar()`, que tambien restaura. Las vias de base, de roles y del servidor se restauran tambien si la creacion falla.
 */
export async function crearApiContaminada(via: Via, parametros: readonly Contaminado[]): Promise<ApiContaminada> {
  const nombres = parametros.map((p) => p.nombre);
  switch (via) {
    case 'sesion': {
      const api = await crearApi();
      await api.baseDatos.comoPlataforma(async (tx) => {
        for (const p of parametros) await tx.cliente.$queryRaw`SELECT set_config(${p.nombre}, ${p.sesion}, false)`;
      });
      return { ...api, cerrar: () => api.app.close() };
    }
    case 'url': {
      const opciones = parametros.map((p) => `-c ${p.nombre}=${p.opcion}`).join(' ');
      const api = await crearApi(urlConOpciones(urlAppPruebas(), opciones));
      return { ...api, cerrar: () => api.app.close() };
    }
    case 'base':
    case 'roles':
    case 'roles-base':
    case 'servidor': {
      const restaurar = async (): Promise<void> => {
        if (via === 'base') await restaurarBase(nombres);
        else if (via === 'servidor') await restaurarServidor(nombres);
        else await restaurarRoles(nombres, via === 'roles-base');
      };
      try {
        if (via === 'base') await alterarBase(parametros);
        else if (via === 'servidor') await alterarServidor(parametros);
        else await alterarRoles(parametros, via === 'roles-base');
        await esperarCondicion(async () => {
          for (const p of parametros) {
            const visto = await valorParaUnaConexionNueva(p.nombre);
            if (sinEspacios(visto).toLowerCase() !== sinEspacios(p.sesion).toLowerCase()) return false;
          }
          return true;
        }, 5000);
        const api = await crearApi();
        return {
          ...api,
          cerrar: async () => {
            try {
              await api.app.close();
            } finally {
              await restaurar();
            }
          },
        };
      } catch (error) {
        await restaurar();
        throw error;
      }
    }
  }
}
