// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 155 (ataque ronda 11, O1; precisa el criterio 94): las formas del bloqueo de transaccion que usan el aforo y la caja pasan el lint
// fuera de backend/src/infraestructura/prisma/ (en un modulo y en cli/), con las dos configuraciones (eslint.config.mjs y la del paso
// protegido):
//   - $executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`;
//   - $queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)::text AS tomado`;
//   - $queryRaw`SELECT pg_catalog.pg_try_advisory_xact_lock(${clave}::bigint) AS tomado` (devuelve boolean).
// Siguen fallando los bloqueos de sesion (criterio 94), tambien con el mismo `::bigint`.
import { describe, expect, it } from 'vitest';
import { CONFIGURACIONES, CLI, MODULO, errores } from './ayuda-lint-ronda3.mjs';

describe.each(CONFIGURACIONES)('criterio 155 con %s', (_configuracion, obtener) => {
  it.each([
    [
      '$executeRaw con pg_catalog.pg_advisory_xact_lock(${clave}::bigint)',
      'export const tomar = (tx, clave) => tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`;',
    ],
    [
      '$queryRaw con pg_advisory_xact_lock(...)::text AS tomado',
      'export const tomar = (tx, clave) => tx.cliente.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)::text AS tomado`;',
    ],
    [
      '$queryRaw con pg_try_advisory_xact_lock(${clave}::bigint) AS tomado',
      'export const intentar = (tx, clave) => tx.cliente.$queryRaw<{ tomado: boolean }[]>`SELECT pg_catalog.pg_try_advisory_xact_lock(${clave}::bigint) AS tomado`;',
    ],
    [
      'la misma forma en varias lineas',
      'export const tomar = (tx, clave) => tx.cliente.$executeRaw`\n  SELECT pg_catalog.pg_advisory_xact_lock(\n    ${clave}::bigint\n  )\n`;',
    ],
  ])('criterio 155: %s pasa el lint en un modulo y en cli/', async (_descripcion, codigo) => {
    const eslint = obtener();

    expect(await errores(eslint, codigo, MODULO), 'modulo').toEqual([]);
    expect(await errores(eslint, codigo, CLI), 'cli/').toEqual([]);
  });

  it.each([
    [
      'pg_advisory_lock (de sesion) con ::bigint',
      'export const tomar = (tx, clave) => tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_lock(${clave}::bigint)`;',
    ],
    [
      'pg_try_advisory_lock (de sesion) con ::bigint',
      'export const intentar = (tx, clave) => tx.cliente.$queryRaw`SELECT pg_catalog.pg_try_advisory_lock(${clave}::bigint) AS tomado`;',
    ],
  ])('criterio 155 (control): %s sigue fallando el lint (criterio 94)', async (_descripcion, codigo) => {
    const eslint = obtener();

    expect((await errores(eslint, codigo, MODULO)).length, 'modulo').toBeGreaterThan(0);
    expect((await errores(eslint, codigo, CLI)).length, 'cli/').toBeGreaterThan(0);
  });
});
