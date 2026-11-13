// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 99 (ataque ronda 3, F2), parte unitaria; precision P-21: `retirarVariablesSensibles(env)`, exportada por el `index` de
// `backend/src/infraestructura/entorno/`, borra del objeto recibido toda clave que empiece por `DATABASE_URL` salvo
// `DATABASE_URL_APP`, toda clave que empiece por `PG` (las que `pg` toma como valores por defecto de conexion) y
// `SUPERADMIN_CLAVE`, y no toca las demas. La llama `main.ts` con `process.env` despues de `validarEntorno` y antes de crear la
// aplicacion (lo prueba `integracion/arranque/entorno-proceso.test.ts`).

type Env = Record<string, string | undefined>;

async function cargar(): Promise<(env: Env) => void> {
  const modulo = await cargarFuncionalidad<{ retirarVariablesSensibles: (env: Env) => void }>(
    'infraestructura/entorno/index.ts',
    ['retirarVariablesSensibles'],
  );
  return modulo.retirarVariablesSensibles;
}

const SENSIBLES = [
  'DATABASE_URL',
  'DATABASE_URL_PRUEBAS',
  'DATABASE_URL_OTRA',
  'DATABASE_URLX',
  'PGUSER',
  'PGPASSWORD',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGSSLMODE',
  'PGPASSFILE',
  'PGOPTIONS',
  'PGP_CLAVE',
  'PG',
  'SUPERADMIN_CLAVE',
];

const QUE_SIGUEN = [
  'DATABASE_URL_APP',
  'JWT_SECRETO',
  'DATABASE_POOL_MAX',
  'PUERTO_API',
  'NODE_ENV',
  'SUPERADMIN_CORREO',
  'SUPERADMIN_NOMBRE',
  'PATH',
  'HOME',
  'TZ',
  'DATABASE',
  'MI_PGUSER',
  'APP_PGHOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'SUPERADMIN_CLAVEX',
];

describe('criterio 99 (P-21): retirarVariablesSensibles', () => {
  it('criterio 99: quita exactamente las variables DATABASE_URL*, PG* y SUPERADMIN_CLAVE de un objeto y deja las demas', async () => {
    const retirar = await cargar();
    const env: Env = {};
    for (const nombre of [...SENSIBLES, ...QUE_SIGUEN]) env[nombre] = `valor-de-${nombre}`;

    retirar(env);

    for (const nombre of SENSIBLES) expect(nombre in env, `${nombre} debia quitarse`).toBe(false);
    for (const nombre of QUE_SIGUEN) {
      expect(env[nombre], `${nombre} debia quedarse`).toBe(`valor-de-${nombre}`);
    }
  });

  it('criterio 99: DATABASE_URL_APP, JWT_SECRETO y las demas siguen con su valor', async () => {
    const retirar = await cargar();
    const env: Env = {
      DATABASE_URL: 'postgresql://dueno:clave@127.0.0.1:5432/aquagestion',
      DATABASE_URL_PRUEBAS: 'postgresql://dueno:clave@127.0.0.1:5432/aquagestion_pruebas',
      DATABASE_URL_APP: 'postgresql://aquagestion_app:otra@127.0.0.1:5432/aquagestion',
      PGUSER: 'dueno',
      PGPASSWORD: 'clave',
      SUPERADMIN_CLAVE: 'Clave-Del-Superadmin-1',
      JWT_SECRETO: 'un-secreto-de-mas-de-32-caracteres-0123456789',
      PUERTO_API: '3000',
    };

    retirar(env);

    expect(env).toEqual({
      DATABASE_URL_APP: 'postgresql://aquagestion_app:otra@127.0.0.1:5432/aquagestion',
      JWT_SECRETO: 'un-secreto-de-mas-de-32-caracteres-0123456789',
      PUERTO_API: '3000',
    });
  });

  it('criterio 99: quita tambien las claves cuyo valor es undefined o vacio', async () => {
    const retirar = await cargar();
    const env: Env = {
      PGUSER: undefined,
      PGPASSWORD: '',
      DATABASE_URL: '',
      SUPERADMIN_CLAVE: undefined,
      NODE_ENV: 'test',
    };

    retirar(env);

    expect(Object.keys(env)).toEqual(['NODE_ENV']);
  });

  it('criterio 99: modifica el objeto recibido (no devuelve uno nuevo) y es idempotente', async () => {
    const retirar = await cargar();
    const env: Env = { DATABASE_URL: 'x', PGHOST: 'y', JWT_SECRETO: 'z' };

    const resultado: unknown = retirar(env);
    retirar(env);

    expect(resultado).toBeUndefined();
    expect(env).toEqual({ JWT_SECRETO: 'z' });
  });

  it('criterio 99: un objeto vacio o sin variables sensibles queda igual', async () => {
    const retirar = await cargar();
    const vacio: Env = {};
    const limpio: Env = { NODE_ENV: 'test', PUERTO_API: '3000' };

    retirar(vacio);
    retirar(limpio);

    expect(vacio).toEqual({});
    expect(limpio).toEqual({ NODE_ENV: 'test', PUERTO_API: '3000' });
  });

  it('criterio 99: no toca process.env cuando recibe otro objeto', async () => {
    const retirar = await cargar();
    process.env['PGUSER_PRUEBA_RONDA3'] = 'se-queda-en-process-env';
    try {
      retirar({ PGUSER_PRUEBA_RONDA3: 'x' });

      expect(process.env['PGUSER_PRUEBA_RONDA3']).toBe('se-queda-en-process-env');
    } finally {
      delete process.env['PGUSER_PRUEBA_RONDA3'];
    }
  });
});
