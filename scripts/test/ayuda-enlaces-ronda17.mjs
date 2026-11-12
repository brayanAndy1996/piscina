// spec: 001-academias-aislamiento (pruebas protegidas)
// Ayuda de las pruebas del ataque ronda 17 (criterio 171, P-44): creacion y borrado de enlaces o uniones en carpetas temporales,
// y los casos (p1) a (p5) de `esPuntoDeEntrada`, que comparten `scripts/lib/punto-de-entrada.mjs` y la copia del hook de sesion.
// No es una prueba (no termina en `.test.mjs`): la importan `punto-de-entrada-ronda17.test.mjs` y `preparar-sesion-ronda17.test.mjs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

export const esWindows = process.platform === 'win32';

/** Tipo de enlace a una carpeta: `junction` en Windows (no pide permisos) y `dir` en los demas (criterio 171). */
export const TIPO_ENLACE_CARPETA = esWindows ? 'junction' : 'dir';

const CODIGOS_OMITIBLES_EN_WINDOWS = new Set(['EPERM', 'EACCES', 'ENOTSUP']);

/**
 * Crea un enlace. Devuelve `{ motivo }`: `null` si se creo; en Windows, con `EPERM`, `EACCES` o `ENOTSUP`, un motivo explicito que
 * nombra el error (el caso que lo usa se omite solo ahi). En Linux y Mac, o con otro error, lanza (la prueba falla).
 */
export function crearEnlace(destino, enlace, tipo) {
  try {
    fs.symlinkSync(destino, enlace, tipo);
    return { motivo: null };
  } catch (error) {
    const codigo = error && typeof error === 'object' ? error.code : undefined;
    if (esWindows && CODIGOS_OMITIBLES_EN_WINDOWS.has(codigo)) {
      return { motivo: `en Windows no se pudo crear el enlace de tipo ${tipo} (${codigo}): ${error.message}` };
    }
    throw error;
  }
}

/** Borra un enlace a una carpeta sin tocar su destino (en Windows, `rmdirSync` sobre la union; en los demas, `unlinkSync`). */
export function borrarEnlaceDeCarpeta(enlace) {
  if (esWindows) fs.rmdirSync(enlace);
  else fs.unlinkSync(enlace);
}

/** Carpeta temporal del sistema para los enlaces de las pruebas; la ruta devuelta ya es la real. */
export function carpetaTemporal(prefijo = 'aqua-r17-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefijo)));
}

/** Omite el caso actual con un motivo explicito si `motivo` no es `null` (`contexto` es el de la prueba de vitest). */
export function omitirSiHayMotivo(contexto, motivo) {
  if (motivo) contexto.skip(motivo);
}

/**
 * Registra los casos (p1) a (p5) del criterio 171 para una funcion `esPuntoDeEntrada`. `obtener` devuelve la funcion
 * (o lanza un error claro si todavia no existe).
 */
export function casosDeEsPuntoDeEntrada(etiqueta, obtener) {
  describe(`criterio 171: esPuntoDeEntrada de ${etiqueta}`, () => {
    let base;
    let carpeta;
    let rutaModulo;
    let rutaOtro;
    let enlaceCarpeta;
    let motivoEnlaceCarpeta = null;
    let enlaceArchivo;
    let motivoEnlaceArchivo = null;
    let urlDelModulo;

    beforeAll(() => {
      base = carpetaTemporal();
      carpeta = path.join(base, 'real');
      fs.mkdirSync(carpeta);
      rutaModulo = path.join(carpeta, 'm.mjs');
      rutaOtro = path.join(carpeta, 'otro.mjs');
      fs.writeFileSync(rutaModulo, 'export const a = 1;\n');
      fs.writeFileSync(rutaOtro, 'export const b = 2;\n');
      urlDelModulo = pathToFileURL(rutaModulo).href;
      enlaceCarpeta = path.join(base, 'enlace-carpeta');
      motivoEnlaceCarpeta = crearEnlace(carpeta, enlaceCarpeta, TIPO_ENLACE_CARPETA).motivo;
      enlaceArchivo = path.join(base, 'enlace-archivo.mjs');
      motivoEnlaceArchivo = crearEnlace(rutaModulo, enlaceArchivo, 'file').motivo;
    });

    afterAll(() => {
      if (!base) return;
      // Primero se quitan los enlaces (sin seguirlos); solo despues se borra la carpeta temporal.
      if (motivoEnlaceCarpeta === null && fs.existsSync(enlaceCarpeta)) borrarEnlaceDeCarpeta(enlaceCarpeta);
      if (motivoEnlaceArchivo === null && fs.existsSync(enlaceArchivo)) fs.unlinkSync(enlaceArchivo);
      fs.rmSync(base, { recursive: true, force: true });
    });

    it('(p1) argv1 igual a la ruta real del archivo y el modulo con su URL: verdadero', () => {
      expect(obtener()(urlDelModulo, rutaModulo)).toBe(true);
    });

    it('(p2) argv1 por un enlace a la carpeta (<enlace>/m.mjs): verdadero', (contexto) => {
      omitirSiHayMotivo(contexto, motivoEnlaceCarpeta);
      expect(obtener()(urlDelModulo, path.join(enlaceCarpeta, 'm.mjs'))).toBe(true);
    });

    it('(p3) argv1 por un enlace al archivo: verdadero', (contexto) => {
      omitirSiHayMotivo(contexto, motivoEnlaceArchivo);
      expect(obtener()(urlDelModulo, enlaceArchivo)).toBe(true);
    });

    it('(p4) otro archivo de la carpeta: falso', () => {
      expect(obtener()(urlDelModulo, rutaOtro)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['la cadena vacia', ''],
      ['una ruta que no existe', () => path.join(carpeta, 'no-existe-r17.mjs')],
    ])('(p4) argv1 %s: falso, sin lanzar', (_nombre, argv1) => {
      const valor = typeof argv1 === 'function' ? argv1() : argv1;
      const esPuntoDeEntrada = obtener();
      expect(() => esPuntoDeEntrada(urlDelModulo, valor)).not.toThrow();
      expect(esPuntoDeEntrada(urlDelModulo, valor)).toBe(false);
    });

    it.each([
      ['una URL que no es file:', 'https://ejemplo.test/m.mjs'],
      ['una cadena que no es URL', 'no es url'],
    ])('(p4) urlDelModulo %s: falso, sin lanzar', (_nombre, url) => {
      const esPuntoDeEntrada = obtener();
      expect(() => esPuntoDeEntrada(url, rutaModulo)).not.toThrow();
      expect(esPuntoDeEntrada(url, rutaModulo)).toBe(false);
    });

    it('(p5) con realpath falso que da C:\\Repo\\scripts\\x.mjs y c:\\repo\\SCRIPTS\\x.mjs: verdadero en win32 y falso en linux', () => {
      const rutaArgumento = path.join(carpeta, 'argumento-p5.mjs');
      const urlModulo = pathToFileURL(path.join(carpeta, 'modulo-p5.mjs')).href;
      const realpath = (ruta) =>
        String(ruta).includes('argumento-p5') ? 'C:\\Repo\\scripts\\x.mjs' : 'c:\\repo\\SCRIPTS\\x.mjs';
      const esPuntoDeEntrada = obtener();
      expect(esPuntoDeEntrada(urlModulo, rutaArgumento, { plataforma: 'win32', realpath })).toBe(true);
      expect(esPuntoDeEntrada(urlModulo, rutaArgumento, { plataforma: 'linux', realpath })).toBe(false);
    });
  });
}
