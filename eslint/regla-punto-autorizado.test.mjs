// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 114 (ataque ronda 4; complementa los criterios 85, 92 y 112), parte de la regla de lint: las reglas reconocen las
// importaciones del punto autorizado `backend/src/infraestructura/prisma/index.ts` en los modulos: importar `Decimal`,
// `codigoDeErrorDeBase`, `esViolacionDeUnicidad`, `sql`, `join` y `vacio` del punto autorizado pasa el paso protegido.
// Pasan en un modulo, por ejemplo: `tx.cliente.$queryRaw\`SELECT ... WHERE id = ANY(${ids}::uuid[])\``, un filtro opcional con
// `sql` y `vacio`, `sql\`SELECT ... WHERE id IN (${join(ids)})\``, `new Decimal('10.50')` y
// `if (esViolacionDeUnicidad(error)) throw new ErrorNegocio(409, ...)`. No existe un `raw` ni un `Prisma.join` con separador
// libre: `Prisma.raw` y `Prisma.join` con separador siguen fallando (criterio 92).
import { describe, expect, it } from 'vitest';
import { CLI, CONFIGURACIONES, MODULO, PRISMA, PUNTO, PUNTO_DESDE_CLI, errores } from './ayuda-lint-ronda4.mjs';

describe.each(CONFIGURACIONES)('criterio 114 (regla) con %s', (_configuracion, obtener) => {
  describe('criterio 114: importar del punto autorizado pasa el lint en un modulo', () => {
    it.each([
      ['Decimal', `import { Decimal } from '${PUNTO}';\nexport const monto = new Decimal('10.50');`],
      ['Decimal como tipo', `import type { Decimal } from '${PUNTO}';\nexport type Monto = Decimal;`],
      ['Decimal con type en linea', `import { type Decimal } from '${PUNTO}';\nexport type Monto = Decimal;`],
      [
        'codigoDeErrorDeBase',
        `import { codigoDeErrorDeBase } from '${PUNTO}';\nexport const f = (error) => codigoDeErrorDeBase(error);`,
      ],
      [
        'esViolacionDeUnicidad con un ErrorNegocio (ejemplo de la especificacion)',
        `import { ErrorNegocio } from '../../comun/errores';\nimport { esViolacionDeUnicidad } from '${PUNTO}';\nexport const f = (error) => {\n  if (esViolacionDeUnicidad(error)) throw new ErrorNegocio(409, 'DUPLICADO', 'Ya existe.');\n  throw error;\n};`,
      ],
      ['sql', `import { sql } from '${PUNTO}';\nexport const f = (id) => sql\`SELECT \${id}\`;`],
      ['join', `import { join } from '${PUNTO}';\nexport const f = (ids) => join(ids);`],
      [
        'join con un separador de la lista cerrada',
        `import { join } from '${PUNTO}';\nexport const f = (ids) => join(ids, 'y');`,
      ],
      ['vacio', `import { vacio } from '${PUNTO}';\nexport const f = () => vacio;`],
      [
        'todos juntos',
        `import { Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, join, sql, vacio } from '${PUNTO}';\nexport const x = [Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, join, sql, vacio];`,
      ],
      [
        'todos juntos, desde .../index',
        `import { Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, join, sql, vacio } from '${PUNTO}/index';\nexport const x = [Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, join, sql, vacio];`,
      ],
      [
        'todos juntos con alias',
        `import { Decimal as D, sql as s, join as j, vacio as v } from '${PUNTO}';\nexport const x = [D, s, j, v];`,
      ],
      [
        'import * as',
        `import * as bd from '${PUNTO}';\nexport const x = [bd.Decimal, bd.join, bd.vacio, bd.esViolacionDeUnicidad];`,
      ],
      [
        'BaseDatos y los tipos junto con los nuevos',
        `import { BaseDatos, Decimal, sql } from '${PUNTO}';\nimport type { TransaccionAcademia } from '${PUNTO}';\nexport const x = [BaseDatos, Decimal, sql];\nexport type T = TransaccionAcademia;`,
      ],
    ])('criterio 114: importar %s pasa el lint', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, MODULO), codigo).toEqual([]);
    });

    it.each([
      [
        '= ANY(${ids}::uuid[]) (la forma recomendada para listas)',
        'export const f = (tx, ids) => tx.cliente.$queryRaw`SELECT id FROM t WHERE id = ANY(${ids}::uuid[])`;',
      ],
      [
        'un filtro opcional con sql y vacio (ejemplo de la especificacion)',
        `import { sql, vacio } from '${PUNTO}';\nexport const f = (tx, id, desde) => {\n  const filtro = desde ? sql\`AND fecha_hora >= \${desde}\` : vacio;\n  return tx.cliente.$queryRaw\`SELECT * FROM t WHERE academia_id = \${id}::uuid \${filtro}\`;\n};`,
      ],
      [
        'sql con IN (join) (ejemplo de la especificacion)',
        `import { join, sql } from '${PUNTO}';\nexport const f = (ids) => sql\`SELECT * FROM t WHERE id IN (\${join(ids)})\`;`,
      ],
      [
        'sql con join y el separador y',
        `import { join, sql } from '${PUNTO}';\nexport const f = (a, b) => sql\`SELECT * FROM t WHERE \${join([sql\`a = \${a}\`, sql\`b = \${b}\`], 'y')}\`;`,
      ],
      [
        'un monto con Decimal en una consulta',
        `import { Decimal } from '${PUNTO}';\nexport const f = (tx, id, monto) => tx.cliente.$queryRaw\`SELECT * FROM pagos WHERE monto >= \${new Decimal(monto)}\`;`,
      ],
      [
        'una consulta con un fragmento como unico argumento de $executeRaw',
        `import { sql } from '${PUNTO}';\nexport const f = (tx, id) => tx.cliente.$executeRaw(sql\`DELETE FROM t WHERE id = \${id}::uuid\`);`,
      ],
    ])('criterio 114: %s pasa el lint en un modulo', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, MODULO), codigo).toEqual([]);
    });

    it('criterio 114: las mismas importaciones pasan el lint en cli/ (con la ruta de cli/)', async () => {
      const codigo = `import { Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, join, sql, vacio } from '${PUNTO_DESDE_CLI}';\nexport const x = [Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, join, sql, vacio];`;

      expect(await errores(obtener(), codigo, CLI)).toEqual([]);
    });
  });

  describe('criterio 114: lo que sigue sin existir ni estar permitido', () => {
    it.each([
      ['Prisma.raw en un modulo', "export const f = (cliente) => cliente.$executeRaw(Prisma.raw('RESET ALL'));"],
      ['Prisma.join con separador libre en un modulo', "export const f = (ids) => Prisma.join(ids, '; RESET ALL; ');"],
      [
        'importar raw del punto autorizado como si existiera y llamarlo (raw como texto en una plantilla etiquetada)',
        `import { raw } from '${PUNTO}';\nexport const f = (cliente) => cliente.$executeRaw\`SET ROLE postgres\`;\nexport const g = raw;`,
      ],
      [
        'el interno sql-seguro.ts de infraestructura/prisma/ importado directamente',
        "import { sql } from '../../infraestructura/prisma/sql-seguro';\nexport const f = sql;",
      ],
      [
        'el interno errores-base.ts de infraestructura/prisma/ importado directamente',
        "import { codigoDeErrorDeBase } from '../../infraestructura/prisma/errores-base';\nexport const f = codigoDeErrorDeBase;",
      ],
    ])('criterio 114: %s falla el lint', async (_nombre, codigo) => {
      expect(await errores(obtener(), codigo, PRISMA), `en prisma/ no debia fallar: ${codigo}`).toEqual([]);
      expect((await errores(obtener(), codigo, MODULO)).length, codigo).toBeGreaterThan(0);
    });
  });
});
