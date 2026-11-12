// Verifica que nadie modifique pruebas protegidas fuera de sus commits (spec 000, criterios 33 a 41).
//
// Un archivo está protegido si alguna de sus 5 primeras líneas lleva un comentario `spec: NNN-nombre (pruebas
// protegidas)`. Solo un commit cuyo título empieza por `Pruebas protegidas (NNN)` puede agregar, modificar, borrar o
// cambiar los permisos de un archivo protegido, ni agregar o quitar la marca.
//
// Uso:
//   node scripts/verificar-pruebas-protegidas.mjs [--desde <ref>] [--hasta <ref>]
//       Modo rango. Por defecto: desde el merge-base con origin/main hasta HEAD. Si --desde es el hash de ceros que
//       GitHub envía al crear una rama, se usa el merge-base con origin/main.
//   node scripts/verificar-pruebas-protegidas.mjs --preparados --mensaje <archivo>
//       Modo preparados, para el hook commit-msg: revisa los cambios preparados con el título del mensaje.
//
// Códigos de salida: 0 sin violaciones, 1 con violaciones, 2 error de uso (referencia inexistente, etc.).
// Solo módulos de Node. Git se ejecuta sin shell y con salidas separadas por NUL (rutas con espacios, tildes o "ñ").
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ejecutarGit, git, listaNul } from './lib/git.mjs';
import { esPuntoDeEntrada } from './lib/punto-de-entrada.mjs';

const LINEAS_DE_MARCA = 5;
const PATRON_MARCA = /^\s*(?:\/\/|#|\/\*|--|<!--)\s*spec:\s*(\d{3}-[a-z0-9-]+)\s*\(pruebas protegidas\)/;
const PATRON_TITULO = /^pruebas protegidas \(\d{3}\)/i;
const PATRON_HASH_CEROS = /^0{40,64}$/;

// ---------------------------------------------------------------------------------------------------------------
// Funciones puras (criterios 33 y 34)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Devuelve la especificación de la marca (por ejemplo `005-cobro`) si el contenido está protegido, o null.
 * Mira solo las 5 primeras líneas. Un contenido nulo, vacío o binario (con bytes NUL) no está protegido.
 */
export function buscarMarca(contenido) {
  if (contenido === null || contenido === undefined) return null;
  if (Buffer.isBuffer(contenido) && contenido.subarray(0, 8000).includes(0)) return null;
  const texto = Buffer.isBuffer(contenido) ? contenido.toString('utf8') : String(contenido);
  const lineas = texto.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/, LINEAS_DE_MARCA);
  for (const linea of lineas) {
    const coincidencia = PATRON_MARCA.exec(linea);
    if (coincidencia) return coincidencia[1] ?? null;
  }
  return null;
}

/** Criterio 33: ¿el archivo, en esa versión, está protegido? */
export function tieneMarcaProtegida(contenido) {
  return buscarMarca(contenido) !== null;
}

/** Criterio 34: ¿el título (primera línea del mensaje) es el de un commit de pruebas protegidas? */
export function esCommitDePruebasProtegidas(titulo) {
  return PATRON_TITULO.test(titulo ?? '');
}

/** Título de un mensaje de commit: primera línea con contenido que no sea un comentario `#`. */
export function tituloDeMensaje(texto) {
  for (const linea of String(texto).split(/\r\n|\r|\n/)) {
    if (linea.startsWith('#')) continue;
    if (linea.trim() === '') continue;
    return linea.trim();
  }
  return '';
}

/** Texto del informe de violaciones (el mismo en el modo rango y en el modo preparados). */
export function formatearInforme(violaciones) {
  const lineas = [
    `Se encontraron ${violaciones.length} cambio(s) a pruebas protegidas fuera de un commit "Pruebas protegidas (NNN)":`,
  ];
  for (const v of violaciones) {
    lineas.push(`  - ${v.commit} "${v.titulo}": ${v.ruta} (spec: ${v.especificacion})`);
  }
  lineas.push(
    '',
    'Las pruebas protegidas solo cambian en commits cuyo título empieza por "Pruebas protegidas (NNN)".',
    'Si el cambio fue un error, revierte el archivo en un commit nuevo (sin --force): la diferencia neta quedará vacía.',
  );
  return lineas.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Acceso a git
// ---------------------------------------------------------------------------------------------------------------

/** Contenido de un archivo en `<referencia>:<ruta>`, o null si no existe en esa versión. */
function leerVersion(referencia, ruta, cwd) {
  const resultado = ejecutarGit(['cat-file', '-p', `${referencia}:${ruta}`], { cwd });
  return resultado.estado === 0 ? resultado.salida : null;
}

/** Contenido de un archivo en el índice (los cambios preparados), o null si no existe. */
function leerVersionIndice(ruta, cwd) {
  const resultado = ejecutarGit(['cat-file', '-p', `:0:${ruta}`], { cwd });
  return resultado.estado === 0 ? resultado.salida : null;
}

/** Resuelve una referencia a un commit; devuelve su hash completo o null si no existe. */
function resolverCommit(referencia, cwd) {
  // Una referencia que empieza por "-" git la leería como una opción.
  if (referencia.startsWith('-')) return null;
  const resultado = ejecutarGit(['rev-parse', '--verify', '--quiet', `${referencia}^{commit}`], { cwd });
  return resultado.estado === 0 ? resultado.salida.toString('utf8').trim() : null;
}

function mergeBase(a, b, cwd) {
  const resultado = ejecutarGit(['merge-base', a, b], { cwd });
  return resultado.estado === 0 ? resultado.salida.toString('utf8').trim() : null;
}

function archivosCambiadosEntre(base, cabeza, cwd) {
  return listaNul(git(['diff', '--name-only', '-z', '--no-renames', base, cabeza, '--'], { cwd }));
}

/** Archivos que cambia un commit: respecto de su padre, o solo los que difieren de todos los padres en un merge. */
function archivosDeCommit(hash, esMerge, cwd) {
  const argumentos = ['diff-tree', '-r', '-z', '--no-renames', '--name-only', '--no-commit-id', '--root'];
  if (esMerge) argumentos.push('--cc');
  argumentos.push(hash);
  return listaNul(git(argumentos, { cwd }));
}

// ---------------------------------------------------------------------------------------------------------------
// Modo rango (criterios 35 a 40)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Revisa los commits `desde..hasta`. Devuelve `{ codigo, salida, error }`: el texto para la salida estándar y el
 * texto para la salida de errores.
 */
export function verificarRango({ desde, hasta = 'HEAD', cwd = process.cwd() }) {
  let referenciaDesde = desde;
  if (referenciaDesde === undefined || PATRON_HASH_CEROS.test(referenciaDesde)) {
    const base = ['origin/main', 'main'].find((candidata) => resolverCommit(candidata, cwd) !== null);
    if (!base) {
      return {
        codigo: 2,
        salida: '',
        error: 'No existe la referencia origin/main para calcular el rango. Indica --desde <referencia>.',
      };
    }
    const cabezaParaBase = resolverCommit(hasta, cwd);
    if (!cabezaParaBase) return { codigo: 2, salida: '', error: `No existe la referencia: ${hasta}` };
    referenciaDesde = mergeBase(base, cabezaParaBase, cwd);
    if (!referenciaDesde) {
      return { codigo: 2, salida: '', error: `No hay un ancestro común entre ${base} y ${hasta}.` };
    }
  }

  const hashDesde = resolverCommit(referenciaDesde, cwd);
  if (!hashDesde) return { codigo: 2, salida: '', error: `No existe la referencia: ${referenciaDesde}` };
  const hashHasta = resolverCommit(hasta, cwd);
  if (!hashHasta) return { codigo: 2, salida: '', error: `No existe la referencia: ${hasta}` };

  const commits = git(['rev-list', '--reverse', '--topo-order', '--parents', `${hashDesde}..${hashHasta}`], { cwd })
    .toString('utf8')
    .split('\n')
    .filter((linea) => linea.trim() !== '')
    .map((linea) => {
      const [hash = '', ...padres] = linea.trim().split(/\s+/);
      return { hash, padres };
    });
  if (commits.length === 0) return { codigo: 0, salida: 'Sin commits que revisar.', error: '' };

  const base = mergeBase(hashDesde, hashHasta, cwd);
  if (!base) {
    return { codigo: 2, salida: '', error: `No hay un ancestro común entre ${referenciaDesde} y ${hasta}.` };
  }
  const diferenciaNeta = new Set(archivosCambiadosEntre(base, hashHasta, cwd));

  const violaciones = [];
  const archivosProtegidos = new Set();

  for (const archivo of diferenciaNeta) {
    if (
      tieneMarcaProtegida(leerVersion(base, archivo, cwd)) ||
      tieneMarcaProtegida(leerVersion(hashHasta, archivo, cwd))
    ) {
      archivosProtegidos.add(archivo);
    }
  }

  for (const { hash, padres } of commits) {
    const titulo = git(['show', '-s', '--format=%s', hash], { cwd }).toString('utf8').trim();
    if (esCommitDePruebasProtegidas(titulo)) continue;
    const abreviado = git(['rev-parse', '--short', hash], { cwd }).toString('utf8').trim();
    const esMerge = padres.length > 1;
    const archivos = archivosDeCommit(hash, esMerge, cwd).filter((archivo) => diferenciaNeta.has(archivo));
    for (const archivo of archivos) {
      const antes = padres.length > 0 ? leerVersion(padres[0], archivo, cwd) : null;
      const despues = leerVersion(hash, archivo, cwd);
      const especificacion = buscarMarca(antes) ?? buscarMarca(despues);
      if (especificacion !== null) {
        violaciones.push({ commit: abreviado, titulo, ruta: archivo, especificacion });
      }
    }
  }

  if (violaciones.length > 0) return { codigo: 1, salida: '', error: formatearInforme(violaciones) };
  return {
    codigo: 0,
    salida: `Pruebas protegidas intactas: ${commits.length} commit(s) y ${archivosProtegidos.size} archivo(s) protegido(s) revisados.`,
    error: '',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Modo preparados (criterio 41)
// ---------------------------------------------------------------------------------------------------------------

/** Revisa los cambios preparados con el título del mensaje del commit en preparación (hook commit-msg). */
export function verificarPreparados({ archivoMensaje, cwd = process.cwd() }) {
  const rutaMerge = ejecutarGit(['rev-parse', '--git-path', 'MERGE_HEAD'], { cwd });
  if (rutaMerge.estado === 0) {
    const ruta = path.resolve(cwd, rutaMerge.salida.toString('utf8').trim());
    if (fs.existsSync(ruta)) {
      return { codigo: 0, salida: 'Merge en curso: la integración continua revisa las pruebas protegidas.', error: '' };
    }
  }

  if (!archivoMensaje) return { codigo: 2, salida: '', error: 'Falta --mensaje <archivo> en el modo --preparados.' };
  let mensaje;
  try {
    mensaje = fs.readFileSync(path.resolve(cwd, archivoMensaje), 'utf8');
  } catch {
    return { codigo: 2, salida: '', error: `No se pudo leer el archivo de mensaje: ${archivoMensaje}` };
  }
  const titulo = tituloDeMensaje(mensaje);
  if (esCommitDePruebasProtegidas(titulo)) return { codigo: 0, salida: '', error: '' };

  const preparados = ejecutarGit(['diff', '--cached', '-z', '--no-renames', '--name-only'], { cwd });
  if (preparados.estado !== 0) {
    return { codigo: 2, salida: '', error: `No se pudieron leer los cambios preparados: ${preparados.errorTexto}` };
  }
  const hayCabeza = resolverCommit('HEAD', cwd) !== null;

  const violaciones = [];
  for (const archivo of listaNul(preparados.salida)) {
    const antes = hayCabeza ? leerVersion('HEAD', archivo, cwd) : null;
    const despues = leerVersionIndice(archivo, cwd);
    const especificacion = buscarMarca(antes) ?? buscarMarca(despues);
    if (especificacion !== null) {
      violaciones.push({ commit: 'preparado', titulo, ruta: archivo, especificacion });
    }
  }
  if (violaciones.length > 0) return { codigo: 1, salida: '', error: formatearInforme(violaciones) };
  return { codigo: 0, salida: '', error: '' };
}

// ---------------------------------------------------------------------------------------------------------------
// Línea de comandos
// ---------------------------------------------------------------------------------------------------------------

/** Interpreta los argumentos. Devuelve `{ error }` si hay un argumento desconocido o sin valor. */
export function analizarArgumentos(argv) {
  const opciones = { preparados: false };
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === '--preparados') {
      opciones.preparados = true;
    } else if (argumento === '--desde' || argumento === '--hasta' || argumento === '--mensaje') {
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) return { error: `Falta el valor de ${argumento}.` };
      opciones[argumento.slice(2)] = valor;
      i += 1;
    } else {
      return { error: `Argumento desconocido: ${argumento}` };
    }
  }
  return { opciones };
}

function principal() {
  const { opciones, error } = analizarArgumentos(process.argv.slice(2));
  if (error || !opciones) {
    console.error(error);
    process.exit(2);
  }
  const resultado = opciones.preparados
    ? verificarPreparados({ archivoMensaje: opciones.mensaje })
    : verificarRango({ desde: opciones.desde, hasta: opciones.hasta });
  if (resultado.salida) console.log(resultado.salida);
  if (resultado.error) console.error(resultado.error);
  process.exit(resultado.codigo);
}

if (esPuntoDeEntrada(import.meta.url)) {
  try {
    principal();
  } catch (error) {
    console.error(`No se pudo verificar: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
