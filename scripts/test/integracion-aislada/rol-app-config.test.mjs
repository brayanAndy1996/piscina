// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 103 (ataque ronda 3, O2), parte de `npm run db:crear`: `db:crear` rechaza el rol `aquagestion_app` si tiene valores por
// defecto propios (`pg_roles.rolconfig` o alguna fila de `pg_db_role_setting` con `setrole` del rol, en cualquier base),
// nombrando la condicion y la correccion (`ALTER ROLE aquagestion_app IN DATABASE <base> RESET ALL;`) y sin cambiar nada. Se
// prueba la variante `IN DATABASE <base temporal>`, que se fija conectado como la app (el propio rol puede fijarse valores) y
// desaparece con la base; la variante global (`ALTER ROLE ... SET`) la cubren las pruebas unitarias.
//
// AISLADA: `db:crear` comprueba el rol de nombre fijo, asi que esta prueba no puede usar un rol temporal y modifica durante unos
// segundos el rol compartido: cualquier API de pruebas que arrancara entonces seria rechazada (criterio 103). Por eso vive en su
// propio proyecto de Vitest (`scripts-aislado`, ver vitest.config.mts), que corre en serie y despues de todos los demas.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analizarUrlPostgres, USUARIO_APP } from '../../lib/entorno.mjs';
import {
  borrarBases,
  ejecutarScript,
  nombresTemporales,
  servidorDePruebas,
  urlAppDePruebas,
  urlDe,
} from '../integracion/ayuda.mjs';

const servidor = servidorDePruebas();
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-ronda3';
const basesCreadas = [];

async function conectar(opciones = {}) {
  const cliente = new pg.Client({
    host: servidor.host,
    port: servidor.puerto,
    user: servidor.usuario,
    password: servidor.clave,
    database: 'postgres',
    ...opciones,
  });
  await cliente.connect();
  return cliente;
}

async function consultar(sql, parametros = []) {
  const cliente = await conectar();
  try {
    return (await cliente.query(sql, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

let existeElRolApp = false;

beforeAll(async () => {
  existeElRolApp =
    (await consultar('SELECT 1 AS ok FROM pg_catalog.pg_roles WHERE rolname = $1', [USUARIO_APP])).length > 0;
});

afterAll(async () => {
  await borrarBases(servidor, basesCreadas).catch(() => undefined);
});

describe('criterio 103: db:crear rechaza un rol con valores por defecto propios', () => {
  it('criterio 103: ALTER ROLE aquagestion_app IN DATABASE <base> SET ... termina con codigo 1 y propone ALTER ROLE ... IN DATABASE <base> RESET ALL;', async (contexto) => {
    if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
    const nombres = nombresTemporales();
    basesCreadas.push(nombres.desarrollo, nombres.pruebas);
    await consultar(`CREATE DATABASE "${nombres.desarrollo}"`);
    await consultar(`CREATE DATABASE "${nombres.pruebas}"`);
    const app = analizarUrlPostgres(urlAppDePruebas(), 'DATABASE_URL_APP');
    let comoLaApp;
    try {
      comoLaApp = await conectar({ user: app.usuario, password: app.clave });
      await comoLaApp.query(
        `ALTER ROLE "${USUARIO_APP}" IN DATABASE "${nombres.pruebas}" SET TimeZone = 'America/Lima'`,
      );
    } catch (error) {
      await comoLaApp?.end().catch(() => undefined);
      console.warn(
        `[criterio 103] AVISO: no se pudo fijar un valor por defecto del rol (${error.message}); se omite el caso.`,
      );
      contexto.skip('no se puede conectar como la app o fijar ALTER ROLE ... IN DATABASE ... SET');
      return;
    }
    try {
      const resultado = ejecutarScript(['crear-bases.mjs'], {
        DATABASE_URL: urlDe(servidor, nombres.desarrollo),
        DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
        DATABASE_URL_APP: `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP_QUE_NO_DEBE_SALIR)}@${servidor.host}:${servidor.puerto}/aquagestion`,
      });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toContain(`ALTER ROLE ${USUARIO_APP} IN DATABASE ${nombres.pruebas} RESET ALL;`);
      expect(resultado.salida).not.toContain(CLAVE_APP_QUE_NO_DEBE_SALIR);
      expect(resultado.salida).not.toContain(servidor.clave);
    } finally {
      await comoLaApp
        .query(`ALTER ROLE "${USUARIO_APP}" IN DATABASE "${nombres.pruebas}" RESET ALL`)
        .catch(() => undefined);
      await comoLaApp.end().catch(() => undefined);
    }
  });
});
