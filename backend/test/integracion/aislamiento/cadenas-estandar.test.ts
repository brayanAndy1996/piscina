// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { conClienteComo, urlAppPruebas } from '../../utilidades/base-datos';
import { VIAS_LOCALES, registrarPruebasDeCadenas } from '../../utilidades/cadenas-estandar';
import { urlConOpciones } from '../../utilidades/ronda3';

// Criterio 122 (ataque ronda 5, O3; complementa los criterios 107 y 121): `standard_conforming_strings` en `on` en cada
// transaccion. Este archivo prueba las vias que solo afectan a la conexion de la API: (a) un `trabajo` anterior con
// set_config(..., false) y (b) `options` en DATABASE_URL_APP. Las vias (c) ALTER DATABASE, (d) ALTER ROLE ALL y (e) ALTER SYSTEM
// estan en backend/test/integracion-aislada/cadenas-estandar-servidor.test.ts. La descripcion completa del criterio esta en
// backend/test/utilidades/cadenas-estandar.ts.

// Premisas: la contaminacion que usan las pruebas existe de verdad en PostgreSQL (no dependen de la API).
describe('criterio 122: premisas de la contaminacion de standard_conforming_strings (solo PostgreSQL)', () => {
  it("criterio 122: con standard_conforming_strings = off, length('a\\b') es 2; con on, 3", async () => {
    const [apagado, encendido] = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query(`SELECT set_config('standard_conforming_strings', 'off', true)`);
      const off = await cliente.query(`SELECT length('a\\b') AS n`);
      await cliente.query(`SELECT set_config('standard_conforming_strings', 'on', true)`);
      const on = await cliente.query(`SELECT length('a\\b') AS n`);
      await cliente.query('ROLLBACK');
      return [Number((off.rows[0] as { n: number }).n), Number((on.rows[0] as { n: number }).n)];
    });

    expect(apagado).toBe(2);
    expect(encendido).toBe(3);
  });

  it('criterio 122: ?options=-c standard_conforming_strings=off deja ese valor en la sesion', async () => {
    const cliente = new pg.Client({
      connectionString: urlConOpciones(urlAppPruebas(), '-c standard_conforming_strings=off'),
    });
    await cliente.connect();
    try {
      const { rows } = await cliente.query(`SELECT current_setting('standard_conforming_strings') AS valor`);

      expect((rows[0] as { valor: string }).valor).toBe('off');
    } finally {
      await cliente.end();
    }
  });
});

registrarPruebasDeCadenas(VIAS_LOCALES);
