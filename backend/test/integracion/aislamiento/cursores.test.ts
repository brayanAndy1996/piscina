// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { intentar, obtenerBaseDatosRonda3, Prisma, textoDelError, type BaseDatosRonda3 } from '../../utilidades/ronda3';

// Criterio 101 (ataque ronda 3, F6; complementa los criterios 23 y 72): ningun cursor sobrevive entre transacciones. Dada la API
// de pruebas con DATABASE_POOL_MAX=1 y datos en A y B, cuando un `trabajo` de `conAcademia(A, ...)` declara cursores que
// sobreviven a la transaccion (`DECLARE c CURSOR WITH HOLD FOR SELECT * FROM auditoria` y otro sobre `configuraciones`) y
// confirma, entonces en el siguiente `conAcademia(B, ...)` y en un `comoPlataforma` posterior, al empezar `trabajo`, no queda
// ningun cursor: `SELECT count(*) FROM pg_cursors` es 0 y `FETCH ALL FROM c` falla con SQLSTATE 34000, sin devolver filas de A.
// Cada transaccion de `BaseDatos` ejecuta `CLOSE ALL` despues de fijar el contexto y antes de `trabajo`. El caso de `enPlataforma`
// (comandos) esta en `cli/contexto-comandos-ronda3.test.ts`. El lint prohibe declarar cursores en el codigo (criterio 94).

interface FilaDeAcademia {
  academia_id: string;
}

describe('criterio 101: premisa del ataque (solo PostgreSQL)', () => {
  it('criterio 101 (premisa): un cursor WITH HOLD declarado en el contexto de A sigue en la conexion y entrega filas de A a la transaccion siguiente', async () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    await limpiarBase();
    const datos = await crearDatosDeAislamiento();

    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('app.academia_id', $1, true)", [datos.A.id]);
      await cliente.query('DECLARE c CURSOR WITH HOLD FOR SELECT academia_id FROM auditoria');
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('app.academia_id', $1, true)", [datos.B.id]);
      const cursores = await cliente.query('SELECT count(*)::int AS n FROM pg_cursors');
      const filas = await cliente.query('FETCH ALL FROM c');
      await cliente.query('ROLLBACK');
      return { cursores: (cursores.rows[0] as { n: number }).n, filas: filas.rows as FilaDeAcademia[] };
    });

    expect(A).not.toBe(B);
    expect(visto.cursores).toBe(1);
    expect(visto.filas.map((fila) => fila.academia_id)).toEqual([datos.A.id, datos.A.id]);
  });
});

describe('criterio 101: BaseDatos cierra los cursores en cada transaccion', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosRonda3;
  let datos: DatosDeAislamiento;

  beforeAll(async () => {
    // Una sola conexion: todas las transacciones usan la misma, la que conserva los cursores.
    app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '1' } });
    baseDatos = await obtenerBaseDatosRonda3(app);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
    // Preparacion: la conexion unica puede traer cursores de la prueba anterior si la API no los cierra; se limpian antes de
    // declarar los de esta prueba, para que el fallo sea siempre el del criterio y no un "el cursor ya existe".
    await baseDatos.conAcademia(datos.A.id, async (tx) => {
      await tx.cliente.$executeRaw`CLOSE ALL`;
    });
    await baseDatos.conAcademia(datos.A.id, async (tx) => {
      await tx.cliente.$executeRaw`DECLARE c CURSOR WITH HOLD FOR SELECT * FROM auditoria`;
      await tx.cliente.$executeRaw`DECLARE d CURSOR WITH HOLD FOR SELECT * FROM configuraciones`;
    });
  });

  it('criterio 101: en el siguiente conAcademia(B), al empezar trabajo, pg_cursors esta vacio', async () => {
    const cursores = await baseDatos.conAcademia(datos.B.id, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_cursors`;
      return filas[0]?.n;
    });

    expect(cursores).toBe(0);
  });

  it('criterio 101: en un comoPlataforma posterior, al empezar trabajo, pg_cursors esta vacio', async () => {
    const cursores = await baseDatos.comoPlataforma(async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_cursors`;
      return filas[0]?.n;
    });

    expect(cursores).toBe(0);
  });

  it('criterio 101: tampoco queda un cursor para la misma academia que lo declaro (conAcademia(A))', async () => {
    const cursores = await baseDatos.conAcademia(datos.A.id, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_cursors`;
      return filas[0]?.n;
    });

    expect(cursores).toBe(0);
  });

  it.each(['c', 'd'])(
    'criterio 101: en conAcademia(B), FETCH ALL FROM %s falla con 34000 y no devuelve filas de A',
    async (cursor) => {
      let filas: unknown;
      const error = await intentar(async () => {
        await baseDatos.conAcademia(datos.B.id, async (tx) => {
          filas = await tx.cliente.$queryRaw`FETCH ALL FROM ${Prisma.raw(cursor)}`;
        });
      });

      expect(error, `FETCH ALL FROM ${cursor} debia fallar`).toBeDefined();
      expect(textoDelError(error)).toContain('34000');
      expect(filas).toBeUndefined();
    },
  );

  it.each(['c', 'd'])('criterio 101: en comoPlataforma, FETCH ALL FROM %s falla con 34000', async (cursor) => {
    const error = await intentar(() =>
      baseDatos.comoPlataforma(async (tx) => {
        await tx.cliente.$queryRaw`FETCH ALL FROM ${Prisma.raw(cursor)}`;
      }),
    );

    expect(error, `FETCH ALL FROM ${cursor} debia fallar`).toBeDefined();
    expect(textoDelError(error)).toContain('34000');
  });

  it('criterio 101: un cursor declarado y usado dentro de un mismo trabajo sigue funcionando (CLOSE ALL va antes de trabajo)', async () => {
    const filas = await baseDatos.conAcademia(datos.B.id, async (tx) => {
      await tx.cliente.$executeRaw`DECLARE propio CURSOR FOR SELECT academia_id::text AS academia_id FROM auditoria`;
      return tx.cliente.$queryRaw<{ academia_id: string }[]>`FETCH ALL FROM propio`;
    });

    expect(filas.map((fila) => fila.academia_id)).toEqual(Array(datos.filas.auditoriaB).fill(datos.B.id));
  });

  it('criterio 101: tras varias transacciones seguidas, ningun cursor se acumula', async () => {
    for (let i = 0; i < 3; i++) {
      await baseDatos.conAcademia(datos.A.id, async (tx) => {
        await tx.cliente
          .$executeRaw`DECLARE ${Prisma.raw(`otro_${i}`)} CURSOR WITH HOLD FOR SELECT * FROM configuraciones`;
      });
    }

    const cursores = await baseDatos.comoPlataforma(async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_cursors`;
      return filas[0]?.n;
    });

    expect(cursores).toBe(0);
  });

  it('criterio 101: resolverAcademia no deja pasar un cursor a la transaccion siguiente', async () => {
    await baseDatos.resolverAcademia(datos.A.nombreCorto);

    const cursores = await baseDatos.conAcademia(datos.B.id, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_cursors`;
      return filas[0]?.n;
    });

    expect(cursores).toBe(0);
  });
});
