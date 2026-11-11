// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { leerUrlAppConfigurada, urlAppSobre } from './base-datos';
import { leerEntornoBases, validarBasePruebas } from './base-pruebas';

const raiz = path.resolve(__dirname, '..', '..', '..');

/**
 * Antes de cualquier prueba de integración: valida la base de pruebas (si no es válida, falla sin conectarse a
 * ninguna base), le aplica las migraciones y fija, para los procesos de prueba:
 * - `DATABASE_URL` y `DATABASE_URL_PRUEBAS`: la base de pruebas, con el usuario dueño de las tablas;
 * - `DATABASE_URL_APP`: el usuario y la contraseña de `DATABASE_URL_APP` (entorno, `.env` o el valor de
 *   `.env.example`) sobre el host, el puerto y la base de `DATABASE_URL_PRUEBAS` (spec 001, "Roles de PostgreSQL").
 */
export default function prepararBasePruebas(): void {
  const entorno = leerEntornoBases(raiz);
  const urlPruebas = validarBasePruebas(entorno);

  const resultado = spawnSync(
    process.execPath,
    [path.join(raiz, 'scripts', 'prisma.mjs'), '--pruebas', 'migrate', 'deploy'],
    {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: entorno['DATABASE_URL'], DATABASE_URL_PRUEBAS: urlPruebas },
    },
  );
  if (resultado.status !== 0) {
    throw new Error(
      `No se pudieron aplicar las migraciones a la base de pruebas.\n${resultado.stdout}\n${resultado.stderr}`,
    );
  }

  process.env['DATABASE_URL'] = urlPruebas;
  process.env['DATABASE_URL_PRUEBAS'] = urlPruebas;
  process.env['DATABASE_URL_APP'] = urlAppSobre(urlPruebas, leerUrlAppConfigurada(raiz, process.env));
}
