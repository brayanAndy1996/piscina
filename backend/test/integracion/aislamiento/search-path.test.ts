// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { conClienteComo, urlAppPruebas } from '../../utilidades/base-datos';
import { RUTA_1, SEARCH_PATH_1, SEARCH_PATH_2, sinEspacios } from '../../utilidades/ronda5';
import { VIAS_LOCALES, registrarPruebasDeSearchPath } from '../../utilidades/search-path';
import { urlConOpciones } from '../../utilidades/ronda3';
import pg from 'pg';

// Criterio 121 (ataque ronda 5, F2 (a) y (c); complementa los criterios 72, 98 y 107): `search_path` fijo en cada transaccion.
// Este archivo prueba las vias que solo afectan a la conexion de la API: (a) un `trabajo` anterior con set_config(..., false) y
// (b) `options` en DATABASE_URL_APP. Las vias (c) ALTER DATABASE y (d) ALTER ROLE ALL cambian valores compartidos con otras
// conexiones y estan en backend/test/integracion-aislada/search-path-servidor.test.ts, que corre en serie al final.
// La descripcion completa del criterio esta en backend/test/utilidades/search-path.ts.

// Premisas: la contaminacion que usan las pruebas existe de verdad en PostgreSQL (no dependen de la API).
describe('criterio 121: premisas de la contaminacion de search_path (solo PostgreSQL)', () => {
  it('criterio 121: set_config(search_path, ..., false) en una transaccion que confirma sigue visible en la siguiente de la misma conexion', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query(`SELECT set_config('search_path', $1, false)`, [RUTA_1]);
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(`SELECT current_setting('search_path') AS ruta`);
      await cliente.query('ROLLBACK');
      return (rows[0] as { ruta: string }).ruta;
    });

    expect(visto).toBe(RUTA_1);
  });

  it.each([
    ['sin "$user"', SEARCH_PATH_1.opcion],
    ['con "$user"', SEARCH_PATH_2.opcion],
  ])('criterio 121: ?options=-c search_path=<ruta> %s deja esa ruta en la sesion', async (_nombre, opcion) => {
    const cliente = new pg.Client({ connectionString: urlConOpciones(urlAppPruebas(), `-c search_path=${opcion}`) });
    await cliente.connect();
    try {
      const { rows } = await cliente.query(`SELECT current_setting('search_path') AS ruta`);

      expect(sinEspacios((rows[0] as { ruta: string }).ruta)).toBe(sinEspacios(opcion));
    } finally {
      await cliente.end();
    }
  });
});

registrarPruebasDeSearchPath(VIAS_LOCALES);
