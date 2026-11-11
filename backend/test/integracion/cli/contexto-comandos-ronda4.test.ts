// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento } from '../../utilidades/datos';
import { urlConOpciones } from '../../utilidades/ronda3';

// Criterio 107 (ataque ronda 4, F2), parte de los comandos: `enPlataforma` (backend/src/cli/conexion.ts) tambien fija, local a
// la transaccion y en su primera sentencia, DateStyle = 'ISO, MDY', IntervalStyle = 'postgres', extra_float_digits = '1' y
// bytea_output = 'hex'. Prueba: con `crearClienteDelDueno(url)` y la URL del dueno con `?options=-c DateStyle=German
// -c IntervalStyle=iso_8601 -c extra_float_digits=-15 -c bytea_output=escape` (codificado), dentro de `enPlataforma`
// current_setting de cada uno da el valor fijado, y SELECT now(), 0.1::float8 y un bytea llegan como un Date valido, 0.1 y los
// bytes 01 02.

interface Parametros {
  DateStyle: string;
  IntervalStyle: string;
  extra_float_digits: string;
  bytea_output: string;
}

const ESPERADOS: Parametros = {
  DateStyle: 'ISO, MDY',
  IntervalStyle: 'postgres',
  extra_float_digits: '1',
  bytea_output: 'hex',
};
const OPCIONES = '-c DateStyle=German -c IntervalStyle=iso_8601 -c extra_float_digits=-15 -c bytea_output=escape';

describe('criterio 107: enPlataforma fija el formato de la sesion en los comandos y la semilla', () => {
  let cliente: ReturnType<typeof crearClienteDelDueno> | undefined;

  beforeEach(async () => {
    await limpiarBase();
    await crearDatosDeAislamiento();
  });
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
  });

  it('criterio 107 (premisa): la URL del dueno contaminada deja los valores en la sesion de la conexion', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES));

    const [fila] = await cliente.$queryRaw<Parametros[]>`SELECT current_setting('DateStyle') AS "DateStyle",
      current_setting('IntervalStyle') AS "IntervalStyle", current_setting('extra_float_digits') AS extra_float_digits,
      current_setting('bytea_output') AS bytea_output`;

    expect(fila).toEqual({
      DateStyle: 'German, DMY',
      IntervalStyle: 'iso_8601',
      extra_float_digits: '-15',
      bytea_output: 'escape',
    });
  });

  it('criterio 107: dentro de enPlataforma, current_setting de los cuatro parametros da los valores fijados aunque la sesion venga contaminada', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES));

    const fila = await enPlataforma(cliente, async (tx) => {
      const [leida] = await tx.$queryRaw<Parametros[]>`SELECT current_setting('DateStyle') AS "DateStyle",
        current_setting('IntervalStyle') AS "IntervalStyle", current_setting('extra_float_digits') AS extra_float_digits,
        current_setting('bytea_output') AS bytea_output`;
      return leida;
    });

    expect(fila).toEqual(ESPERADOS);
  });

  it('criterio 107: dentro de enPlataforma, SELECT now(), 0.1::float8 y un bytea llegan como un Date valido, 0.1 y los bytes 01 02', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES));

    const fila = await enPlataforma(cliente, async (tx) => {
      const filas = await tx.$queryRaw<
        { ahora: unknown; decimal: unknown; tercio: unknown; bytes: unknown }[]
      >`SELECT now() AS ahora, 0.1::float8 AS decimal, (1::float8 / 3) AS tercio, decode('0102', 'hex') AS bytes`;
      return filas[0];
    });

    expect(fila?.ahora).toBeInstanceOf(Date);
    expect(Math.abs((fila?.ahora as Date).getTime() - Date.now())).toBeLessThan(5000);
    expect(fila?.decimal).toBe(0.1);
    expect(fila?.tercio).toBe(1 / 3);
    expect(Array.from(fila?.bytes as Uint8Array)).toEqual([1, 2]);
  });
});
