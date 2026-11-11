import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface FilaMigracion {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

// Criterio 19: la base de pruebas queda con las migraciones aplicadas antes de correr cualquier prueba.
describe('migraciones de la base de pruebas', () => {
  let cliente: pg.Client;

  beforeAll(async () => {
    cliente = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    await cliente.connect();
  });
  afterAll(async () => {
    await cliente.end();
  });

  it('la base de DATABASE_URL es la de pruebas', async () => {
    const { rows } = await cliente.query<{ base: string }>('SELECT current_database() AS base');
    expect(rows[0]?.base).toMatch(/_pruebas$/);
  });

  it('_prisma_migrations tiene la migración inicial aplicada', async () => {
    const { rows } = await cliente.query<FilaMigracion>(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
    );
    const inicial = rows.find((fila) => /^\d+_inicial$/.test(fila.migration_name));
    expect(inicial, 'falta la migración ..._inicial en _prisma_migrations').toBeDefined();
    expect(inicial?.finished_at).not.toBeNull();
    expect(inicial?.rolled_back_at).toBeNull();
  });

  it('no queda ninguna migración sin terminar', async () => {
    const { rows } = await cliente.query<FilaMigracion>(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE finished_at IS NULL',
    );
    expect(rows).toEqual([]);
  });
});
