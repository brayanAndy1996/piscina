// Utilidades de las pruebas de los scripts que usan git: repositorios temporales en el directorio temporal del
// sistema, aislados de la configuración global del usuario. Nunca se toca el repositorio del proyecto.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const carpetaScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Entorno para git y para los scripts hijos: sin configuración global, y sin variables de un hook en curso. */
function entornoAislado() {
  const entorno = { ...process.env };
  for (const clave of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_EDITOR']) delete entorno[clave];
  entorno.GIT_CONFIG_NOSYSTEM = '1';
  entorno.GIT_CONFIG_GLOBAL = os.devNull;
  return entorno;
}

const CONFIGURACION = [
  '-c',
  'user.name=Prueba',
  '-c',
  'user.email=prueba@example.com',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

/** Repositorio git temporal con utilidades para armar historias de commits. */
export class RepoTemporal {
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-git-'));
    this.git('init', '-q', '-b', 'main');
  }

  /** Ejecuta git y devuelve la salida estándar como texto. Lanza un error si falla. */
  git(...argumentos) {
    const resultado = spawnSync('git', [...CONFIGURACION, ...argumentos], {
      cwd: this.dir,
      encoding: 'utf8',
      env: entornoAislado(),
    });
    if (resultado.status !== 0) {
      throw new Error(`git ${argumentos.join(' ')} falló: ${resultado.stderr}${resultado.error ?? ''}`);
    }
    return resultado.stdout.trim();
  }

  ruta(relativa) {
    return path.join(this.dir, ...relativa.split('/'));
  }

  escribir(relativa, contenido) {
    fs.mkdirSync(path.dirname(this.ruta(relativa)), { recursive: true });
    fs.writeFileSync(this.ruta(relativa), contenido);
  }

  borrar(relativa) {
    fs.rmSync(this.ruta(relativa));
  }

  leer(relativa) {
    return fs.readFileSync(this.ruta(relativa), 'utf8');
  }

  /** Agrega todo al índice y crea un commit con el mensaje dado. Devuelve el hash completo. */
  commit(mensaje) {
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', mensaje);
    return this.git('rev-parse', 'HEAD');
  }

  /** Escribe un archivo y lo confirma en un solo paso. */
  confirmar(mensaje, archivos) {
    for (const [relativa, contenido] of Object.entries(archivos)) this.escribir(relativa, contenido);
    return this.commit(mensaje);
  }

  /** Ejecuta un script de Node en el repositorio. Devuelve `{ codigo, salida, error, texto }`. */
  ejecutarScript(script, argumentos = []) {
    const resultado = spawnSync(process.execPath, [path.join(carpetaScripts, script), ...argumentos], {
      cwd: this.dir,
      encoding: 'utf8',
      env: entornoAislado(),
    });
    return {
      codigo: resultado.status,
      salida: resultado.stdout,
      error: resultado.stderr,
      texto: resultado.stdout + resultado.stderr,
    };
  }

  /** Borra la carpeta .git: deja un directorio que ya no es un repositorio. */
  limpiarGit() {
    fs.rmSync(path.join(this.dir, '.git'), { recursive: true, force: true });
  }

  limpiar() {
    fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
