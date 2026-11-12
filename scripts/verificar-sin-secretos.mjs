// Verifica que el índice de git no contenga archivos de secretos (spec 000, criterio 5): ningún `.env` ni
// `.env.<algo>` distinto de `.env.example`, ni certificados o claves (`*.pem`, `*.key`, `*.p12`, `*.pfx`), en
// ninguna carpeta. El repositorio es público. No revisa el contenido de los archivos: eso lo cubre "Secret scanning"
// de GitHub.
//
// Uso: node scripts/verificar-sin-secretos.mjs
// Códigos de salida: 0 sin secretos, 1 con archivos prohibidos, 2 si git no pudo ejecutarse.
import process from 'node:process';
import { ejecutarGit, listaNul } from './lib/git.mjs';
import { esPuntoDeEntrada } from './lib/punto-de-entrada.mjs';

const PATRON_ENV = /^\.env(\..+)?$/i;
const PATRON_CLAVES = /\.(pem|key|p12|pfx)$/i;
const PERMITIDO = '.env.example';

/** Devuelve las rutas (separadas por "/") cuyo nombre de archivo está prohibido en el repositorio. */
export function buscarArchivosSecretos(rutas) {
  return rutas.filter((ruta) => {
    const nombre = ruta.split(/[/\\]/).pop() ?? '';
    if (nombre === PERMITIDO) return false;
    return PATRON_ENV.test(nombre) || PATRON_CLAVES.test(nombre);
  });
}

/** Revisa los archivos del índice de git en `cwd`. Devuelve `{ codigo, salida, error }`. */
export function verificarSinSecretos({ cwd = process.cwd() } = {}) {
  const resultado = ejecutarGit(['ls-files', '-z'], { cwd });
  if (resultado.estado !== 0) {
    return { codigo: 2, salida: '', error: `No se pudo leer el índice de git: ${resultado.errorTexto}` };
  }
  const prohibidos = buscarArchivosSecretos(listaNul(resultado.salida));
  if (prohibidos.length > 0) {
    const lineas = [
      'El repositorio es público: estos archivos no deben estar en git (solo se permite .env.example):',
      ...prohibidos.map((ruta) => `  - ${ruta}`),
      '',
      'Sácalos del índice con "git rm --cached <archivo>" y agrégalos a .gitignore. Si contenían credenciales reales,',
      'cámbialas: ya no se pueden considerar secretas.',
    ];
    return { codigo: 1, salida: '', error: lineas.join('\n') };
  }
  return { codigo: 0, salida: 'Sin archivos de secretos en git.', error: '' };
}

if (esPuntoDeEntrada(import.meta.url)) {
  const resultado = verificarSinSecretos();
  if (resultado.salida) console.log(resultado.salida);
  if (resultado.error) console.error(resultado.error);
  process.exit(resultado.codigo);
}
