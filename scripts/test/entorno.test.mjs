import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analizarUrlPostgres, cargarEnv, esNombreValido, leerUrlsBases } from '../lib/entorno.mjs';

describe('esNombreValido', () => {
  it.each(['aquagestion', 'aquagestion_pruebas', '_x', 'base1'])('acepta %s', (nombre) => {
    expect(esNombreValido(nombre)).toBe(true);
  });
  it.each(['', 'Aqua', '1base', 'con-guion', 'con espacio', 'base";drop', 'ñandú'])('rechaza %j', (nombre) => {
    expect(esNombreValido(nombre)).toBe(false);
  });
});

describe('analizarUrlPostgres', () => {
  it('descompone la URL, con valores codificados', () => {
    expect(analizarUrlPostgres('postgresql://us%40er:p%2Fw@127.0.0.1:5433/mi_base', 'X')).toEqual({
      host: '127.0.0.1',
      puerto: 5433,
      usuario: 'us@er',
      clave: 'p/w',
      base: 'mi_base',
    });
  });

  it('usa el puerto 5432 por defecto', () => {
    expect(analizarUrlPostgres('postgres://u:p@localhost/b', 'X').puerto).toBe(5432);
  });

  it.each([
    [undefined, /Falta la variable X/],
    ['', /Falta la variable X/],
    ['no es url', /no es una URL válida/],
    ['mysql://u:p@h/b', /URL de PostgreSQL/],
    ['postgresql://u:p@h', /nombre de la base/],
  ])('rechaza %j nombrando la variable y sin el valor', (valor, patron) => {
    expect(() => analizarUrlPostgres(valor, 'X')).toThrow(patron);
  });
});

describe('leerUrlsBases', () => {
  const desarrollo = 'postgresql://u:p@127.0.0.1:5432/aquagestion';
  const pruebas = 'postgresql://u:p@127.0.0.1:5432/aquagestion_pruebas';

  it('devuelve las dos bases', () => {
    const urls = leerUrlsBases({ DATABASE_URL: desarrollo, DATABASE_URL_PRUEBAS: pruebas });
    expect(urls.desarrollo.base).toBe('aquagestion');
    expect(urls.pruebas.base).toBe('aquagestion_pruebas');
  });

  it('rechaza una base de pruebas igual a la de desarrollo', () => {
    expect(() => leerUrlsBases({ DATABASE_URL: pruebas, DATABASE_URL_PRUEBAS: pruebas })).toThrow(/no puede ser igual/);
  });

  it('rechaza una base de pruebas que no termina en _pruebas', () => {
    expect(() => leerUrlsBases({ DATABASE_URL: desarrollo, DATABASE_URL_PRUEBAS: desarrollo + '_otra' })).toThrow(
      /terminar en _pruebas/,
    );
  });

  it('rechaza si falta alguna', () => {
    expect(() => leerUrlsBases({ DATABASE_URL_PRUEBAS: pruebas })).toThrow(/DATABASE_URL/);
    expect(() => leerUrlsBases({ DATABASE_URL: desarrollo })).toThrow(/DATABASE_URL_PRUEBAS/);
  });
});

describe('cargarEnv', () => {
  it('carga el .env sin sobrescribir las variables ya definidas', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-scripts-'));
    try {
      fs.writeFileSync(path.join(carpeta, '.env'), 'UNA=del-archivo\nOTRA="con comillas"\n# comentario\n');
      const env = { UNA: 'del-proceso' };
      cargarEnv(env, carpeta);
      expect(env).toEqual({ UNA: 'del-proceso', OTRA: 'con comillas' });
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });

  it('no hace nada si no hay .env', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-scripts-'));
    try {
      const env = {};
      cargarEnv(env, carpeta);
      expect(env).toEqual({});
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
