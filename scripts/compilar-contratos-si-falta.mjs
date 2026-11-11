// Compila packages/contratos si todavía no tiene dist/. Lo usa el hook pre-commit: ESLint con información de tipos
// resuelve @aquagestion/contratos desde dist/, que no existe en un clon recién instalado.
// Uso: node scripts/compilar-contratos-si-falta.mjs [raíz del proyecto]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { raizProyecto } from './lib/entorno.mjs';

/** Archivo que indica que los contratos ya están compilados. */
const SALIDA_ESPERADA = path.join('packages', 'contratos', 'dist', 'index.d.ts');

/** ¿Faltan los contratos compilados? */
export function faltaCompilar(raiz = raizProyecto) {
  return !fs.existsSync(path.join(raiz, SALIDA_ESPERADA));
}

/** Compila los contratos con npm. Devuelve el código de salida. */
export function compilarContratos(raiz = raizProyecto) {
  console.log('Compilando @aquagestion/contratos (no existe packages/contratos/dist)...');
  const resultado = spawnSync('npm', ['run', 'build', '-w', '@aquagestion/contratos'], {
    cwd: raiz,
    stdio: 'inherit',
    // En Windows npm es npm.cmd y Node no lo ejecuta sin shell; los argumentos son fijos, no vienen de fuera.
    shell: process.platform === 'win32',
  });
  if (resultado.error) {
    console.error(`No se pudo compilar @aquagestion/contratos: ${resultado.error.message}`);
    return 1;
  }
  return resultado.status ?? 1;
}

const esEjecucionDirecta =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esEjecucionDirecta) {
  // Argumento opcional: otra raíz del proyecto (lo usan las pruebas).
  const raiz = process.argv[2] ? path.resolve(process.argv[2]) : raizProyecto;
  if (faltaCompilar(raiz)) process.exit(compilarContratos(raiz));
}
