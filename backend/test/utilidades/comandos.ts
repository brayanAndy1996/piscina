// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { urlPropietarioPruebas } from './base-datos';

const raiz = path.resolve(__dirname, '..', '..', '..');

/** Indica si `package.json` de la raíz define el script de npm. */
export function existeElScript(comando: string): boolean {
  const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return Object.hasOwn(paquete.scripts ?? {}, comando);
}

/**
 * Ejecuta un comando de la raíz del proyecto (`npm run <comando>`) contra la base de pruebas y espera a que termine.
 * Devuelve el código de salida y la salida estándar y de errores juntas.
 *
 * - `DATABASE_URL` es la del dueño de la base de pruebas, salvo que `variables` la reemplace.
 * - Una variable con valor `undefined` se pasa vacía (`''`): así el `.env` local no la completa y el comando debe
 *   tratarla como faltante. `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y `SUPERADMIN_CLAVE` salen vacías por defecto.
 * - `NODE_ENV` es `test` salvo que `variables` indique otro valor.
 * - Si el script no existe en `package.json`, lanza un error claro en lugar de ejecutar `npm` y devolver una salida
 *   vacía.
 */
export function ejecutarComando(
  comando: 'plataforma:superadmin' | 'db:semilla',
  variables: Record<string, string | undefined>,
): { estado: number | null; salida: string } {
  if (!existeElScript(comando)) {
    throw new Error(`Falta la funcionalidad de la 001: no existe el script ${comando} en package.json`);
  }
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: urlPropietarioPruebas(),
    NODE_ENV: 'test',
    SUPERADMIN_CORREO: '',
    SUPERADMIN_NOMBRE: '',
    SUPERADMIN_CLAVE: '',
  };
  for (const [nombre, valor] of Object.entries(variables)) env[nombre] = valor ?? '';
  const enWindows = process.platform === 'win32';
  const resultado = spawnSync('npm', ['run', '--silent', comando], {
    cwd: raiz,
    env,
    encoding: 'utf8',
    shell: enWindows,
    timeout: 120_000,
  });
  return {
    estado: resultado.status,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}${resultado.error ? String(resultado.error) : ''}`,
  };
}
