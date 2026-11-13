// spec: 001-academias-aislamiento (pruebas protegidas)
import { beforeAll, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { conClienteComo, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';

// Criterio 20: resolver_academia es la única forma de encontrar una academia sin contexto.
describe('criterio 20: resolver_academia(p_nombre_corto)', () => {
  let activa: AcademiaDePrueba;
  let suspendida: AcademiaDePrueba;

  beforeAll(async () => {
    await limpiarBase();
    activa = await crearAcademiaDePrueba({ nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' });
    suspendida = await crearAcademiaDePrueba({
      nombreCorto: 'tiburones',
      nombre: 'Club de Natación Tiburones',
      estado: 'SUSPENDIDA',
    });
    await crearAcademiaDePrueba({ nombreCorto: 'academia-3' });
  });

  it('criterio 20: devuelve (id, nombre, nombre_corto, estado) de una academia activa, sin contexto', async () => {
    const { rows } = await ejecutarComo('app', 'SELECT * FROM resolver_academia($1)', ['delfines']);

    expect(rows).toEqual([{ id: activa.id, nombre: activa.nombre, nombre_corto: 'delfines', estado: 'ACTIVA' }]);
  });

  it('criterio 20: devuelve también una academia suspendida', async () => {
    const { rows } = await ejecutarComo('app', 'SELECT * FROM resolver_academia($1)', ['tiburones']);

    expect(rows).toEqual([
      { id: suspendida.id, nombre: suspendida.nombre, nombre_corto: 'tiburones', estado: 'SUSPENDIDA' },
    ]);
  });

  it.each([
    ['inexistente', 'inexistente'],
    ['el comodín %', '%'],
    ['el comodín _', '_'],
    ['un prefijo con %', 'delf%'],
    ['un prefijo con _', 'delfine_'],
    ['la cadena vacía', ''],
    ['NULL', null],
    ['mayúsculas', 'Delfines'],
    ['todo en mayúsculas', 'DELFINES'],
    ['espacios al inicio', ' delfines'],
    ['espacios al final', 'delfines '],
    ['un salto de línea', 'delfines\n'],
    ['un intento de inyección', "delfines' OR '1'='1"],
  ])('criterio 20: devuelve 0 filas con %s', async (_nombre, valor) => {
    const { rows } = await ejecutarComo('app', 'SELECT * FROM resolver_academia($1)', [valor]);

    expect(rows).toEqual([]);
  });

  it('criterio 20: la columna estado es texto y la función devuelve exactamente cuatro columnas', async () => {
    const { rows, fields } = await ejecutarComo('app', 'SELECT * FROM resolver_academia($1)', ['delfines']);

    expect(fields.map((campo) => campo.name)).toEqual(['id', 'nombre', 'nombre_corto', 'estado']);
    expect(typeof (rows[0] as { estado: unknown }).estado).toBe('string');
  });

  it('criterio 20: después de llamarla, en la misma transacción, app.plataforma no es "si" y academias sigue vacía', async () => {
    await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      try {
        const antes = await cliente.query('SELECT count(*)::int AS n FROM academias');
        expect((antes.rows[0] as { n: number }).n).toBe(0);

        const resuelta = await cliente.query('SELECT * FROM resolver_academia($1)', ['delfines']);
        expect(resuelta.rows).toHaveLength(1);

        const marca = await cliente.query(`SELECT current_setting('app.plataforma', true) AS marca`);
        expect((marca.rows[0] as { marca: string | null }).marca).not.toBe('si');
        const despues = await cliente.query('SELECT count(*)::int AS n FROM academias');
        expect((despues.rows[0] as { n: number }).n).toBe(0);
        const superadmins = await cliente.query('SELECT count(*)::int AS n FROM superadmins');
        expect((superadmins.rows[0] as { n: number }).n).toBe(0);
      } finally {
        await cliente.query('ROLLBACK');
      }
    });
  });

  it('criterio 20: llamarla dentro del contexto de A no amplía lo que se ve en academias', async () => {
    await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      try {
        await cliente.query("SELECT set_config('app.academia_id', $1, true)", [activa.id]);
        await cliente.query('SELECT * FROM resolver_academia($1)', ['tiburones']);
        const { rows } = await cliente.query('SELECT id FROM academias');
        expect(rows).toEqual([{ id: activa.id }]);
      } finally {
        await cliente.query('ROLLBACK');
      }
    });
  });
});
