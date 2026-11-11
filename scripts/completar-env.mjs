// Agrega al .env las variables de .env.example que falten, con su comentario, sin tocar las que ya existen.
// Cada historia puede agregar variables nuevas; este comando evita copiarlas a mano (en Windows es propenso a errores).
// Uso: npm run env:completar   (si no hay .env, lo crea copiando .env.example)
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { raizProyecto } from './lib/entorno.mjs';

const LINEA_DE_VARIABLE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Bloques de `.env.example`, en orden: cada variable activa (no comentada) con los comentarios que la preceden sin
 * líneas en blanco de por medio.
 * @param {string} texto contenido de .env.example
 * @returns {{ nombre: string, lineas: string[] }[]}
 */
export function leerBloques(texto) {
  const definidas = new Set(Object.keys(parseEnv(texto)));
  const bloques = [];
  let comentarios = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (linea.trim() === '') {
      comentarios = [];
    } else if (linea.trimStart().startsWith('#')) {
      comentarios.push(linea);
    } else {
      const coincidencia = LINEA_DE_VARIABLE.exec(linea);
      if (coincidencia && definidas.has(coincidencia[1])) {
        bloques.push({ nombre: coincidencia[1], lineas: [...comentarios, linea] });
      }
      comentarios = [];
    }
  }
  return bloques;
}

/**
 * Completa el `.env` de `raiz` con lo que falte de `.env.example`.
 * - Sin `.env`: lo crea copiando `.env.example` (`accion: 'creado'`).
 * - Con `.env`: agrega al final, con `\n`, el bloque de cada variable que falte; no modifica ni reordena lo que ya
 *   hay (`accion: 'completado'`). Si no falta nada, no escribe (`accion: 'sin-cambios'`).
 * @returns {{ accion: 'creado' | 'completado' | 'sin-cambios', agregadas: string[] }}
 */
export function completarEnv(raiz = raizProyecto) {
  const rutaEjemplo = path.join(raiz, '.env.example');
  const rutaEnv = path.join(raiz, '.env');
  if (!fs.existsSync(rutaEjemplo)) throw new Error('No se encontró .env.example en la raíz del proyecto.');
  const ejemplo = fs.readFileSync(rutaEjemplo, 'utf8');

  if (!fs.existsSync(rutaEnv)) {
    fs.writeFileSync(rutaEnv, ejemplo.replace(/\r\n/g, '\n'));
    return { accion: 'creado', agregadas: leerBloques(ejemplo).map((bloque) => bloque.nombre) };
  }

  const actual = fs.readFileSync(rutaEnv, 'utf8');
  const existentes = new Set(Object.keys(parseEnv(actual)));
  const faltantes = leerBloques(ejemplo).filter((bloque) => !existentes.has(bloque.nombre));
  if (faltantes.length === 0) return { accion: 'sin-cambios', agregadas: [] };

  let agregado = '';
  if (actual !== '' && !actual.endsWith('\n')) agregado += '\n';
  faltantes.forEach((bloque, posicion) => {
    // Una variable sin comentario propio (grupos como SUPERADMIN_*) sigue pegada a la anterior.
    const separada = posicion === 0 || bloque.lineas.length > 1;
    agregado += `${separada ? '\n' : ''}${bloque.lineas.join('\n')}\n`;
  });
  fs.appendFileSync(rutaEnv, agregado);
  return { accion: 'completado', agregadas: faltantes.map((bloque) => bloque.nombre) };
}

const esEjecucionDirecta =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esEjecucionDirecta) {
  // Argumento opcional: otra raíz del proyecto (lo usan las pruebas).
  const raiz = process.argv[2] ? path.resolve(process.argv[2]) : raizProyecto;
  try {
    const { accion, agregadas } = completarEnv(raiz);
    if (accion === 'creado') {
      console.log('No había .env: se creó copiando .env.example. Revisa los valores si hace falta.');
    } else if (accion === 'sin-cambios') {
      console.log('Tu .env ya tiene todas las variables de .env.example. No hizo falta agregar nada.');
    } else {
      console.log(`Se agregaron ${agregadas.length} variable(s) al .env: ${agregadas.join(', ')}.`);
      console.log('Tus variables existentes no se modificaron. Revisa los valores agregados si hace falta.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
