// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 116 (ataque ronda 4, observacion; ajusta el alcance del criterio 99 y de la precision P-21): en Windows `process.env`
// no distingue mayusculas (`PgPassword` y `PGPASSWORD` son la misma variable), asi que `retirarVariablesSensibles(env)` compara
// los nombres pasados a mayusculas: borra toda clave cuyo nombre en mayusculas empieza por `DATABASE_URL` salvo la que en
// mayusculas es exactamente `DATABASE_URL_APP`, toda la que en mayusculas empieza por `PG` y la que en mayusculas es
// `SUPERADMIN_CLAVE`. Prueba unitaria: quita `PgPassword`, `pguser`, `Database_Url`, `database_url_pruebas` y
// `Superadmin_Clave`; deja `Database_Url_App`, `jwt_secreto` y las de la lista del criterio 99.

type Env = Record<string, string | undefined>;

async function cargar(): Promise<(env: Env) => void> {
  const modulo = await cargarFuncionalidad<{ retirarVariablesSensibles: (env: Env) => void }>(
    'infraestructura/entorno/index.ts',
    ['retirarVariablesSensibles'],
  );
  return modulo.retirarVariablesSensibles;
}

const SE_QUITAN = ['PgPassword', 'pguser', 'Database_Url', 'database_url_pruebas', 'Superadmin_Clave'];
const OTRAS_QUE_SE_QUITAN = [
  'pgpassword',
  'PgUser',
  'pgHost',
  'PGHOST',
  'Pg',
  'pg',
  'PgSslMode',
  'database_url',
  'DATABASE_url',
  'Database_Url_Otra',
  'database_urlx',
  'Database_Url_App_Otra',
  'database_url_app_x',
  'superadmin_clave',
  'SUPERADMIN_clave',
];
const QUE_SIGUEN = [
  'Database_Url_App',
  'database_url_app',
  'DATABASE_URL_APP',
  'jwt_secreto',
  'JWT_SECRETO',
  'DATABASE_POOL_MAX',
  'database_pool_max',
  'PUERTO_API',
  'NODE_ENV',
  'SUPERADMIN_CORREO',
  'Superadmin_Correo',
  'SUPERADMIN_NOMBRE',
  'PATH',
  'Path',
  'HOME',
  'TZ',
  'DATABASE',
  'Database',
  'MI_PGUSER',
  'APP_PGHOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'SUPERADMIN_CLAVEX',
  'Superadmin_Clave_X',
];

describe('criterio 116 (P-21): retirarVariablesSensibles sin distinguir mayusculas', () => {
  it('criterio 116: quita PgPassword, pguser, Database_Url, database_url_pruebas y Superadmin_Clave', async () => {
    const retirar = await cargar();
    const env: Env = {};
    for (const nombre of [...SE_QUITAN, 'JWT_SECRETO']) env[nombre] = `valor-de-${nombre}`;

    retirar(env);

    for (const nombre of SE_QUITAN) expect(nombre in env, `${nombre} debia quitarse`).toBe(false);
    expect(env['JWT_SECRETO']).toBe('valor-de-JWT_SECRETO');
  });

  it('criterio 116: quita toda clave cuyo nombre en mayusculas empieza por DATABASE_URL (salvo DATABASE_URL_APP) o por PG, o es SUPERADMIN_CLAVE', async () => {
    const retirar = await cargar();
    const env: Env = {};
    for (const nombre of [...OTRAS_QUE_SE_QUITAN, ...QUE_SIGUEN]) env[nombre] = `valor-de-${nombre}`;

    retirar(env);

    for (const nombre of OTRAS_QUE_SE_QUITAN) expect(nombre in env, `${nombre} debia quitarse`).toBe(false);
    for (const nombre of QUE_SIGUEN) expect(env[nombre], `${nombre} debia quedarse`).toBe(`valor-de-${nombre}`);
  });

  it('criterio 116: deja Database_Url_App, jwt_secreto y las de la lista del criterio 99 con su valor', async () => {
    const retirar = await cargar();
    const env: Env = {
      Database_Url: 'postgresql://dueno:clave@127.0.0.1:5432/aquagestion',
      database_url_pruebas: 'postgresql://dueno:clave@127.0.0.1:5432/aquagestion_pruebas',
      Database_Url_App: 'postgresql://aquagestion_app:otra@127.0.0.1:5432/aquagestion',
      PgPassword: 'clave',
      pguser: 'dueno',
      Superadmin_Clave: 'Clave-Del-Superadmin-1',
      jwt_secreto: 'un-secreto-largo-de-mas-de-treinta-y-dos-caracteres',
      JWT_SECRETO: 'otro-secreto-largo-de-mas-de-treinta-y-dos-caracteres',
      DATABASE_POOL_MAX: '5',
      PUERTO_API: '3000',
      NODE_ENV: 'test',
      SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
      SUPERADMIN_NOMBRE: 'Superadmin de prueba',
    };

    retirar(env);

    expect(Object.keys(env).sort()).toEqual(
      [
        'Database_Url_App',
        'jwt_secreto',
        'JWT_SECRETO',
        'DATABASE_POOL_MAX',
        'PUERTO_API',
        'NODE_ENV',
        'SUPERADMIN_CORREO',
        'SUPERADMIN_NOMBRE',
      ].sort(),
    );
    expect(env['Database_Url_App']).toBe('postgresql://aquagestion_app:otra@127.0.0.1:5432/aquagestion');
  });

  it('criterio 116: tambien quita las claves cuyo valor es undefined o vacio', async () => {
    const retirar = await cargar();
    const env: Env = { PgPassword: undefined, Pguser: '', Database_Url: undefined, Otra: 'queda' };

    retirar(env);

    expect(Object.keys(env)).toEqual(['Otra']);
  });

  it('criterio 116: process.env real (en minusculas y mayusculas mezcladas) queda sin variables sensibles y con las demas', async () => {
    const retirar = await cargar();
    const copia: Env = {
      ...process.env,
      PgPassword: 'x',
      pguser: 'y',
      Database_Url: 'z',
      Superadmin_Clave: 'w',
      Otra_Mia: 'queda',
    };

    retirar(copia);

    for (const nombre of Object.keys(copia)) {
      const mayusculas = nombre.toUpperCase();
      expect(mayusculas.startsWith('PG'), nombre).toBe(false);
      expect(mayusculas === 'SUPERADMIN_CLAVE', nombre).toBe(false);
      expect(mayusculas.startsWith('DATABASE_URL') && mayusculas !== 'DATABASE_URL_APP', nombre).toBe(false);
    }
    expect(copia['Otra_Mia']).toBe('queda');
  });
});
