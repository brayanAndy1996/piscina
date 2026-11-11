import { afterEach, describe, expect, it } from 'vitest';
import {
  borrarBases,
  ejecutarScript,
  ejecutarSql,
  existeBase,
  nombresTemporales,
  servidorDePruebas,
  urlAppDePruebas,
  urlDe,
} from './ayuda.mjs';

const servidor = servidorDePruebas();
const creadas = [];

function prepararNombres() {
  const nombres = nombresTemporales();
  creadas.push(nombres.desarrollo, nombres.pruebas);
  return nombres;
}

function variablesDe(nombres) {
  return {
    DATABASE_URL: urlDe(servidor, nombres.desarrollo),
    DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
    DATABASE_URL_APP: urlAppDePruebas(),
  };
}

afterEach(async () => {
  await borrarBases(servidor, creadas.splice(0));
});

describe('db:crear (scripts/crear-bases.mjs)', () => {
  it('crea la base de desarrollo y la de pruebas si no existen', async () => {
    const nombres = prepararNombres();
    expect(await existeBase(servidor, nombres.desarrollo)).toBe(false);

    const resultado = ejecutarScript(['crear-bases.mjs'], variablesDe(nombres));

    expect(resultado.estado).toBe(0);
    expect(resultado.salida).toContain(`Base creada: ${nombres.desarrollo}`);
    expect(resultado.salida).toContain(`Base creada: ${nombres.pruebas}`);
    expect(await existeBase(servidor, nombres.desarrollo)).toBe(true);
    expect(await existeBase(servidor, nombres.pruebas)).toBe(true);
  });

  it('ejecutarlo dos veces seguidas no falla y la segunda informa que ya existían', () => {
    const nombres = prepararNombres();
    const variables = variablesDe(nombres);

    expect(ejecutarScript(['crear-bases.mjs'], variables).estado).toBe(0);
    const segunda = ejecutarScript(['crear-bases.mjs'], variables);

    expect(segunda.estado).toBe(0);
    expect(segunda.salida).toContain(`La base ya existía: ${nombres.desarrollo}`);
    expect(segunda.salida).toContain(`La base ya existía: ${nombres.pruebas}`);
    expect(segunda.salida).not.toContain('Base creada');
  });

  it('no toca una base que ya existe y crea solo la que falta', async () => {
    const nombres = prepararNombres();
    const variables = variablesDe(nombres);
    expect(ejecutarScript(['crear-bases.mjs'], variables).estado).toBe(0);
    await ejecutarSql(servidor, nombres.desarrollo, 'CREATE TABLE marca (id int); INSERT INTO marca VALUES (7)');
    await borrarBases(servidor, [nombres.pruebas]);

    const resultado = ejecutarScript(['crear-bases.mjs'], variables);

    expect(resultado.estado).toBe(0);
    expect(resultado.salida).toContain(`La base ya existía: ${nombres.desarrollo}`);
    expect(resultado.salida).toContain(`Base creada: ${nombres.pruebas}`);
    const { rows } = await ejecutarSql(servidor, nombres.desarrollo, 'SELECT id FROM marca');
    expect(rows).toEqual([{ id: 7 }]);
  });

  it.each([
    ['falta DATABASE_URL_PRUEBAS', { DATABASE_URL_PRUEBAS: '' }, /DATABASE_URL_PRUEBAS/],
    ['falta DATABASE_URL', { DATABASE_URL: '' }, /DATABASE_URL/],
  ])('termina con error y un mensaje claro cuando %s', (_motivo, cambios, patron) => {
    const nombres = prepararNombres();
    const resultado = ejecutarScript(['crear-bases.mjs'], { ...variablesDe(nombres), ...cambios });
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toMatch(patron);
  });

  it('no incluye la contraseña en los mensajes de error', () => {
    const nombres = prepararNombres();
    const resultado = ejecutarScript(['crear-bases.mjs'], {
      DATABASE_URL: `postgresql://usuario:clave-muy-secreta@127.0.0.1:1/${nombres.desarrollo}`,
      DATABASE_URL_PRUEBAS: `postgresql://usuario:clave-muy-secreta@127.0.0.1:1/${nombres.pruebas}`,
      DATABASE_URL_APP: urlAppDePruebas(),
    });
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toContain('No se pudo conectar a PostgreSQL');
    expect(resultado.salida).not.toContain('clave-muy-secreta');
  });
});
