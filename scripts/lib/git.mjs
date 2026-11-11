// Ejecución de git sin shell: los argumentos se pasan separados, así que rutas con espacios, tildes o "ñ" no se
// interpretan y funciona igual en Windows, Mac y Linux. Solo módulos de Node.
import { spawnSync } from 'node:child_process';

const MAXIMO_BUFFER = 1024 * 1024 * 1024;

/**
 * Ejecuta `git <argumentos>` en `cwd`. Devuelve `{ estado, salida, errorTexto }`:
 * `salida` es un Buffer con la salida estándar y `estado` es null si git no pudo ejecutarse (por ejemplo, si no está
 * instalado).
 */
export function ejecutarGit(argumentos, { cwd = process.cwd(), entrada } = {}) {
  const resultado = spawnSync('git', argumentos, {
    cwd,
    input: entrada,
    maxBuffer: MAXIMO_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (resultado.error) {
    return { estado: null, salida: Buffer.alloc(0), errorTexto: resultado.error.message };
  }
  return {
    estado: resultado.status,
    salida: resultado.stdout,
    errorTexto: resultado.stderr.toString('utf8').trim(),
  };
}

/** Como `ejecutarGit`, pero lanza un error si git termina con un código distinto de 0. */
export function git(argumentos, opciones) {
  const resultado = ejecutarGit(argumentos, opciones);
  if (resultado.estado !== 0) {
    const motivo = resultado.errorTexto || 'git no terminó bien';
    throw new Error(`git ${argumentos[0]}: ${motivo}`);
  }
  return resultado.salida;
}

/** Divide una salida separada por NUL (`-z`) en una lista de rutas, sin el elemento vacío final. */
export function listaNul(salida) {
  return salida
    .toString('utf8')
    .split('\0')
    .filter((elemento) => elemento !== '');
}
