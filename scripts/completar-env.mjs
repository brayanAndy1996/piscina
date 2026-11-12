// Agrega al .env las variables de .env.example que falten, con su comentario, sin tocar las que ya existen.
// Cada historia puede agregar variables nuevas; este comando evita copiarlas a mano (en Windows es propenso a errores).
// Uso: npm run env:completar   (si no hay .env, lo crea copiando .env.example)
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { analizarEnv, clavesPosiblesEnv, quitarBom, raizProyecto } from './lib/entorno.mjs';
import { esPuntoDeEntrada } from './lib/punto-de-entrada.mjs';

const MENSAJE_NO_UTF8 =
  'Tu .env no está guardado como UTF-8 (parece UTF-16, como lo guarda PowerShell con `>` u `Out-File`). ' +
  'Guárdalo como UTF-8 y vuelve a ejecutar npm run env:completar.';

/** ¿Estos bytes parecen UTF-16 (BOM FF FE o FE FF) o tienen un byte 00? Un .env UTF-8 válido no tiene bytes 00. */
function pareceUtf16(bytes) {
  const [primero, segundo] = bytes;
  return (primero === 0xff && segundo === 0xfe) || (primero === 0xfe && segundo === 0xff) || bytes.includes(0);
}

const LINEA_DE_VARIABLE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Bloques de `.env.example`, en orden: cada variable activa (no comentada) con los comentarios que la preceden sin
 * líneas en blanco de por medio.
 * @param {string} texto contenido de .env.example
 * @returns {{ nombre: string, lineas: string[] }[]}
 */
export function leerBloques(texto) {
  const definidas = new Set(Object.keys(analizarEnv(texto)));
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
 *   hay, BOM y finales de línea incluidos (`accion: 'completado'`). Si no falta nada, no escribe (`accion: 'sin-cambios'`).
 * - Una variable cuenta como existente si la lee `analizarEnv` o si la encuentra `clavesPosiblesEnv` (la regla amplia:
 *   `dotenv` podría leerla). En el segundo caso no se agrega y su nombre va en `ilegibles` (solo si hay alguna).
 * - Si el `.env` parece UTF-16 o tiene un byte 00, lanza sin escribir nada.
 * @returns {{ accion: 'creado' | 'completado' | 'sin-cambios', agregadas: string[], ilegibles?: string[] }}
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

  const bytes = fs.readFileSync(rutaEnv);
  if (pareceUtf16(bytes)) throw new Error(MENSAJE_NO_UTF8);
  const actual = bytes.toString('utf8');
  const leidas = new Set(Object.keys(analizarEnv(actual)));
  const posibles = clavesPosiblesEnv(actual);
  const bloques = leerBloques(ejemplo);
  const ilegibles = bloques
    .filter((bloque) => !leidas.has(bloque.nombre) && posibles.has(bloque.nombre))
    .map((bloque) => bloque.nombre);
  const faltantes = bloques.filter((bloque) => !leidas.has(bloque.nombre) && !posibles.has(bloque.nombre));
  const conAviso = ilegibles.length > 0 ? { ilegibles } : {};
  if (faltantes.length === 0) return { accion: 'sin-cambios', agregadas: [], ...conAviso };

  // El BOM no cuenta para decidir si hace falta un salto de línea: un .env que solo lo tiene se trata como vacío.
  const sinBom = quitarBom(actual);
  let agregado = '';
  if (sinBom !== '' && !sinBom.endsWith('\n')) agregado += '\n';
  faltantes.forEach((bloque, posicion) => {
    // Una variable sin comentario propio (grupos como SUPERADMIN_*) sigue pegada a la anterior.
    const separada = posicion === 0 || bloque.lineas.length > 1;
    agregado += `${separada ? '\n' : ''}${bloque.lineas.join('\n')}\n`;
  });
  // Solo se agrega al final: los bytes que había (BOM y \r\n incluidos) no se tocan y no se escribe un segundo BOM.
  fs.appendFileSync(rutaEnv, agregado);
  return { accion: 'completado', agregadas: faltantes.map((bloque) => bloque.nombre), ...conAviso };
}

if (esPuntoDeEntrada(import.meta.url)) {
  // Argumento opcional: otra raíz del proyecto (lo usan las pruebas).
  const raiz = process.argv[2] ? path.resolve(process.argv[2]) : raizProyecto;
  try {
    const { accion, agregadas, ilegibles = [] } = completarEnv(raiz);
    if (accion === 'creado') {
      console.log('No había .env: se creó copiando .env.example. Revisa los valores si hace falta.');
    } else if (accion === 'sin-cambios') {
      console.log('Tu .env ya tiene todas las variables de .env.example. No hizo falta agregar nada.');
    } else {
      console.log(`Se agregaron ${agregadas.length} variable(s) al .env: ${agregadas.join(', ')}.`);
      console.log('Tus variables existentes no se modificaron. Revisa los valores agregados si hace falta.');
    }
    for (const nombre of ilegibles) {
      console.log(
        `La variable ${nombre} está en tu .env pero los scripts no la pueden leer: revisa esa línea ` +
          '(espacios o caracteres invisibles al principio, o `:` en lugar de `=`).',
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
