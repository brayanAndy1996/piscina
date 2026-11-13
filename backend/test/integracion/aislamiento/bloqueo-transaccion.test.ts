// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { claveDe, leerValorDeConfiguracion, siguienteNumero, type DelegadosRonda11 } from '../../utilidades/ronda11';
import { esperarCondicion, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';

// Criterio 155 (ataque ronda 11, O1; precisa el criterio 94): `$queryRaw` con `SELECT pg_advisory_xact_lock(${clave})` falla en Prisma al
// leer la columna de tipo `void` que devuelve la funcion (y, en un lote, cortaba las consultas siguientes). La forma que usan el aforo y la
// caja es `tx.cliente.$executeRaw` con `SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)` (o, con `$queryRaw`, convirtiendo el
// resultado con `::text AS tomado`); `pg_try_advisory_xact_lock`, que devuelve un `boolean`, sirve con `$queryRaw`.
// Integracion con `DATABASE_POOL_MAX=2`, en `conAcademia(A, ...)`:
//   - el `$executeRaw` resuelve con un numero y `trabajo` sigue (escribe una fila de `configuraciones` que queda);
//   - mientras esa transaccion sigue abierta (una barrera), otra `conAcademia(A, ...)` lee `pg_try_advisory_xact_lock` de la misma clave
//     con `$queryRaw` y obtiene `false`; despues de que la primera confirma obtiene `true`;
//   - la forma con `::text` y `$queryRaw` resuelve con una fila.
// El lint no marca estas formas: lo prueba `eslint/regla-bloqueo-transaccion-ronda11.test.mjs`.

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let datos: DatosDeAislamiento;

/** Una clave de bloqueo distinta por prueba (la base de pruebas es compartida entre los archivos). */
const claveDeBloqueo = (n: number): number => 1_100_000 + n;

const delegadosDe = (cliente: object): DelegadosRonda11 => cliente as unknown as DelegadosRonda11;

/** Una promesa que se resuelve desde fuera: la barrera que mantiene abierta la primera transaccion. */
function barrera(): { esperar: Promise<void>; liberar: () => void } {
  let liberar: () => void = () => undefined;
  const esperar = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  return { esperar, liberar };
}

beforeAll(async () => {
  app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '2' } });
  base = await obtenerBaseDatosRonda3(app);
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

describe('criterio 155: el bloqueo de transaccion se toma con $executeRaw', () => {
  it('criterio 155: $executeRaw con pg_catalog.pg_advisory_xact_lock(${clave}::bigint) resuelve con un numero y trabajo sigue', async () => {
    const n = siguienteNumero();
    const clave = claveDeBloqueo(n);

    const devuelto = await base.conAcademia(datos.A.id, async (tx) => {
      const tomado = await tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`;
      await delegadosDe(tx.cliente).configuracion.create({
        data: { academiaId: tx.academiaId, clave: claveDe(n), valor: { despues_del_bloqueo: true } },
      });
      return tomado;
    });

    expect(typeof devuelto, 'el $executeRaw resuelve con un numero').toBe('number');
    expect(await leerValorDeConfiguracion(datos.A.id, claveDe(n)), 'la escritura posterior al bloqueo queda').toEqual({
      despues_del_bloqueo: true,
    });
  });

  it('criterio 155: lanzado a la vez con otras consultas, el bloqueo no corta las siguientes (cada una recibe lo suyo)', async () => {
    const n = siguienteNumero();
    const clave = claveDeBloqueo(n);

    const valores = await base.conAcademia(datos.A.id, async (tx) => {
      const c = tx.cliente;
      const salida = await Promise.all([
        c.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`,
        delegadosDe(c).configuracion.create({
          data: { academiaId: tx.academiaId, clave: claveDe(n), valor: { a_la_vez: true } },
        }),
        c.$queryRaw<{ uno: number }[]>`SELECT 1 AS uno`,
      ]);
      return salida;
    });

    expect(typeof valores[0]).toBe('number');
    expect(valores[1], 'el create devuelve la fila').not.toBeUndefined();
    expect(valores[2]).toEqual([{ uno: 1 }]);
    expect(await leerValorDeConfiguracion(datos.A.id, claveDe(n))).toEqual({ a_la_vez: true });
  });

  it('criterio 155: mientras la primera transaccion sigue abierta, pg_try_advisory_xact_lock de la misma clave da false en otra; despues de confirmar da true', async () => {
    const n = siguienteNumero();
    const clave = claveDeBloqueo(n);
    const retener = barrera();
    let tomada = false;

    const primera = base.conAcademia(datos.A.id, async (tx) => {
      await tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`;
      await delegadosDe(tx.cliente).configuracion.create({
        data: { academiaId: tx.academiaId, clave: claveDe(n), valor: {} },
      });
      tomada = true;
      await retener.esperar;
      return 'primera';
    });
    // Si la primera falla antes de la barrera, que la prueba no quede esperando.
    primera.catch(() => {
      tomada = true;
    });
    await esperarCondicion(() => tomada, 5000);
    expect(tomada, 'la primera transaccion debia tomar el bloqueo').toBe(true);

    let mientrasAbierta: { tomado: boolean }[] | undefined;
    try {
      mientrasAbierta = await base.conAcademia(
        datos.A.id,
        (tx) =>
          tx.cliente.$queryRaw<{ tomado: boolean }[]>`
          SELECT pg_catalog.pg_try_advisory_xact_lock(${clave}::bigint) AS tomado`,
      );
    } finally {
      retener.liberar();
    }
    expect(await primera, 'la primera confirma').toBe('primera');
    expect(mientrasAbierta, 'otra transaccion de A no puede tomar la misma clave').toEqual([{ tomado: false }]);

    const despues = await base.conAcademia(
      datos.A.id,
      (tx) =>
        tx.cliente.$queryRaw<{ tomado: boolean }[]>`
        SELECT pg_catalog.pg_try_advisory_xact_lock(${clave}::bigint) AS tomado`,
    );
    expect(despues, 'despues de confirmar la primera, el bloqueo esta libre').toEqual([{ tomado: true }]);
  });

  it('criterio 155: la forma con $queryRaw y ::text AS tomado resuelve con una fila', async () => {
    const n = siguienteNumero();
    const clave = claveDeBloqueo(n);

    const filas = await base.conAcademia(
      datos.A.id,
      (tx) =>
        tx.cliente.$queryRaw<{ tomado: string }[]>`
        SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)::text AS tomado`,
    );

    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveProperty('tomado');
  });

  it('criterio 155: el bloqueo se libera solo al terminar la transaccion, tambien si trabajo lanza', async () => {
    const n = siguienteNumero();
    const clave = claveDeBloqueo(n);
    const errorPropio = new Error('error propio de la ronda 11 (bloqueo)');

    await expect(
      base.conAcademia(datos.A.id, async (tx) => {
        await tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`;
        throw errorPropio;
      }),
    ).rejects.toBe(errorPropio);

    const despues = await base.conAcademia(
      datos.A.id,
      (tx) =>
        tx.cliente.$queryRaw<{ tomado: boolean }[]>`
        SELECT pg_catalog.pg_try_advisory_xact_lock(${clave}::bigint) AS tomado`,
    );
    expect(despues).toEqual([{ tomado: true }]);
  });
});
