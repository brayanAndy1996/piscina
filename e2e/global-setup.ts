import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPERADMIN_E2E } from './datos-e2e';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Crea (o restablece, si ya existe) el superadmin de las pruebas con el comando `npm run plataforma:superadmin`, sobre
 * la base de pruebas y nunca sobre la de desarrollo. El comando valida la contraseña y no la imprime.
 */
export default function crearSuperadminDePruebas(): void {
  const baseDatosPruebas = process.env['DATABASE_URL_PRUEBAS'];
  if (!baseDatosPruebas) throw new Error('Falta DATABASE_URL_PRUEBAS: las pruebas E2E usan solo la base de pruebas.');

  // `shell: true` para que `npm` (npm.cmd en Windows) se encuentre igual en todos los sistemas.
  const resultado = spawnSync('npm run --silent plataforma:superadmin', {
    cwd: raiz,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: baseDatosPruebas,
      SUPERADMIN_CORREO: SUPERADMIN_E2E.correo,
      SUPERADMIN_NOMBRE: SUPERADMIN_E2E.nombre,
      SUPERADMIN_CLAVE: SUPERADMIN_E2E.clave,
    },
  });
  if (resultado.status !== 0) {
    throw new Error(
      `No se pudo crear el superadmin de las pruebas E2E (¿está migrada la base de pruebas? npm run db:preparar).\n${resultado.stdout}${resultado.stderr}`,
    );
  }
}
