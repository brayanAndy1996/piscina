// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 148 (ataque ronda 9, O1; AMPLIA los criterios 6 y 8 y complementa el 81 y el 143), precision P-35, parte unitaria:
// `scripts/lib/entorno.mjs` exporta `diferenciasConDesarrollo(app, desarrollo)`, que recibe los objetos que devuelve `analizarUrlPostgres`
// (`{ host, puerto, usuario, clave, base }`) y devuelve las partes que difieren, en el orden 'servidor', 'puerto', 'base', sin repetir, o `[]`
// si coinciden. Compara el servidor (`host`) en minusculas y sin resolver nombres (`localhost` y `127.0.0.1` son distintos), el puerto como
// numero (sin puerto es 5432, asi que `h/b` y `h:5432/b` coinciden) y la base exacta ya decodificada (`aqua%5Fdev` y `aqua_dev` coinciden).
// No compara el usuario, la contrasena ni la cadena de consulta (`options` y `sslmode` pueden diferir). El archivo sigue importando solo
// modulos `node:*` (lo carga el hook antes de `npm ci`; lo comprueba `entorno-ronda8.test.mjs`).
import { describe, expect, it } from 'vitest';
import * as entorno from '../lib/entorno.mjs';

const { analizarUrlPostgres } = entorno;

/** `diferenciasConDesarrollo` con una falla clara si todavia no existe (falta la funcionalidad, no un error de importacion). */
function diferencias(app, desarrollo) {
  if (typeof entorno.diferenciasConDesarrollo !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 001: scripts/lib/entorno.mjs no exporta diferenciasConDesarrollo (P-35).',
    );
  }
  return entorno.diferenciasConDesarrollo(app, desarrollo);
}

/** Compara dos URL tal como lo hacen `db:crear` y el hook: ambas pasan por `analizarUrlPostgres`. */
function entre(urlApp, urlDesarrollo) {
  return diferencias(
    analizarUrlPostgres(urlApp, 'DATABASE_URL_APP'),
    analizarUrlPostgres(urlDesarrollo, 'DATABASE_URL'),
  );
}

const DESARROLLO = 'postgresql://aquagestion:clave-dueno@127.0.0.1:5432/aquagestion';
const APP = 'postgresql://aquagestion_app:clave-app@127.0.0.1:5432/aquagestion';

describe('criterio 148 (P-35): diferenciasConDesarrollo(app, desarrollo) en scripts/lib/entorno.mjs', () => {
  it('criterio 148: la misma parte principal (solo cambian el usuario y la contrasena) no difiere en nada', () => {
    expect(entre(APP, DESARROLLO)).toEqual([]);
  });

  it('criterio 148: un servidor distinto difiere solo en servidor', () => {
    expect(entre('postgresql://aquagestion_app:x@db-otro.example:5432/aquagestion', DESARROLLO)).toEqual(['servidor']);
  });

  it('criterio 148: LOCALHOST frente a localhost coincide (el servidor se compara sin distinguir mayusculas)', () => {
    expect(
      entre(
        'postgresql://aquagestion_app:x@LOCALHOST:5432/aquagestion',
        'postgresql://aquagestion:y@localhost:5432/aquagestion',
      ),
    ).toEqual([]);
    expect(
      entre(
        'postgresql://aquagestion_app:x@localhost:5432/aquagestion',
        'postgresql://aquagestion:y@LocalHost:5432/aquagestion',
      ),
    ).toEqual([]);
  });

  it('criterio 148: localhost frente a 127.0.0.1 difiere en servidor (no se resuelven nombres)', () => {
    expect(entre('postgresql://aquagestion_app:x@localhost:5432/aquagestion', DESARROLLO)).toEqual(['servidor']);
    expect(entre(APP, 'postgresql://aquagestion:y@localhost:5432/aquagestion'), 'tambien al reves').toEqual([
      'servidor',
    ]);
  });

  it('criterio 148: sin puerto frente a :5432 coincide, en los dos sentidos', () => {
    expect(
      entre('postgresql://aquagestion_app:x@h/b', 'postgresql://aquagestion:y@h:5432/b'),
      'la app sin puerto',
    ).toEqual([]);
    expect(
      entre('postgresql://aquagestion_app:x@h:5432/b', 'postgresql://aquagestion:y@h/b'),
      'DATABASE_URL sin puerto',
    ).toEqual([]);
  });

  it('criterio 148: el puerto :5433 frente al por defecto difiere en puerto', () => {
    expect(entre('postgresql://aquagestion_app:x@h:5433/b', 'postgresql://aquagestion:y@h/b')).toEqual(['puerto']);
    expect(entre('postgresql://aquagestion_app:x@h/b', 'postgresql://aquagestion:y@h:5433/b')).toEqual(['puerto']);
    expect(entre('postgresql://aquagestion_app:x@h:5433/b', 'postgresql://aquagestion:y@h:5434/b')).toEqual(['puerto']);
  });

  it('criterio 148: una base distinta difiere solo en base', () => {
    expect(entre('postgresql://aquagestion_app:x@h:5432/otra_base_r9', 'postgresql://aquagestion:y@h:5432/b')).toEqual([
      'base',
    ]);
  });

  it('criterio 148: la base se compara exacta (sin distinguir nada mas que la decodificacion): distinta mayuscula difiere', () => {
    expect(entre('postgresql://aquagestion_app:x@h/Aqua_dev', 'postgresql://aquagestion:y@h/aqua_dev')).toEqual([
      'base',
    ]);
  });

  it('criterio 148: una base codificada que decodifica igual coincide (aqua%5Fdev y aqua_dev)', () => {
    expect(entre('postgresql://aquagestion_app:x@h/aqua%5Fdev', 'postgresql://aquagestion:y@h/aqua_dev')).toEqual([]);
    expect(entre('postgresql://aquagestion_app:x@h/aqua_dev', 'postgresql://aquagestion:y@h/aqua%5Fdev')).toEqual([]);
  });

  it('criterio 148: las tres diferencias a la vez salen en el orden servidor, puerto, base', () => {
    expect(entre('postgresql://aquagestion_app:x@otro:5433/otra', 'postgresql://aquagestion:y@h:5432/b')).toEqual([
      'servidor',
      'puerto',
      'base',
    ]);
  });

  it.each([
    ['servidor y puerto', 'postgresql://aquagestion_app:x@otro:5433/b', ['servidor', 'puerto']],
    ['servidor y base', 'postgresql://aquagestion_app:x@otro:5432/otra', ['servidor', 'base']],
    ['puerto y base', 'postgresql://aquagestion_app:x@h:5433/otra', ['puerto', 'base']],
  ])('criterio 148: %s juntos salen en el mismo orden y sin repetir', (_caso, urlApp, esperado) => {
    expect(entre(urlApp, 'postgresql://aquagestion:y@h:5432/b')).toEqual(esperado);
  });

  it('criterio 148: options o sslmode distintos en la cadena de consulta coinciden (la cadena de consulta no se compara)', () => {
    expect(
      entre(`${APP}?sslmode=disable&options=${encodeURIComponent('-c TimeZone=UTC')}`, `${DESARROLLO}?sslmode=require`),
    ).toEqual([]);
    expect(entre(`${APP}?sslmode=disable`, DESARROLLO)).toEqual([]);
    expect(entre(APP, `${DESARROLLO}?options=${encodeURIComponent('-c DateStyle=German')}`)).toEqual([]);
  });

  it('criterio 148: el usuario y la contrasena no se comparan (deben ser distintos, criterio 6)', () => {
    expect(
      entre(
        'postgresql://aquagestion_app:clave-app@127.0.0.1:5432/aquagestion',
        'postgresql://otro_dueno:clave-dueno@127.0.0.1:5432/aquagestion',
      ),
    ).toEqual([]);
    expect(entre(DESARROLLO, DESARROLLO), 'mismo usuario y contrasena: lo rechaza el criterio 6, no este').toEqual([]);
  });

  it('criterio 148: recibe los objetos de analizarUrlPostgres tal cual (sin leer las URL) y no los modifica', () => {
    const app = { host: 'LOCALHOST', puerto: 5432, usuario: 'aquagestion_app', clave: 'a', base: 'b' };
    const desarrollo = { host: 'localhost', puerto: 5432, usuario: 'aquagestion', clave: 'd', base: 'b' };
    const copias = [structuredClone(app), structuredClone(desarrollo)];

    expect(diferencias(app, desarrollo)).toEqual([]);
    expect([app, desarrollo]).toEqual(copias);
    expect(diferencias({ ...app, puerto: 5433, base: 'otra' }, desarrollo)).toEqual(['puerto', 'base']);
  });
});
