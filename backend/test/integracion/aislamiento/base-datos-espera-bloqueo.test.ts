import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { obtenerBaseDatos, type ClientePrueba } from '../../utilidades/modulos';

// `esperaMaximaDeBloqueoMs` de `BaseDatos.conAcademia` (005b; fija `lock_timeout` local a la transaccion). Integracion con
// `DATABASE_POOL_MAX=1`, para que dos transacciones seguidas usen la misma conexion:
//   - un valor que no es un entero de 1 a 60000 (0, -1, 1.5, 60001, NaN, Infinity o un texto) rechaza con `RangeError` sin ejecutar `trabajo`;
//   - dentro de la transaccion `lock_timeout` vale `<n>ms`, y en la siguiente transaccion de la misma conexion vuelve a `0`, tambien despues
//     de un `trabajo` que lanza;
//   - el valor ya esta aplicado en la primera sentencia de `trabajo`: una espera de bloqueo como primera sentencia falla con `55P03`
//     pasados los milisegundos pedidos, no despues de esperar sin limite.

interface OpcionesConEspera {
  readonly esperaMaximaDeBloqueoMs?: unknown;
}
interface BaseConEspera {
  conAcademia<T>(
    academiaId: string,
    trabajo: (tx: { readonly cliente: ClientePrueba }) => Promise<T>,
    opciones?: OpcionesConEspera,
  ): Promise<T>;
}

let app: NestExpressApplication;
let base: BaseConEspera;
let datos: DatosDeAislamiento;

beforeAll(async () => {
  app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '1' } });
  base = (await obtenerBaseDatos(app)) as unknown as BaseConEspera;
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

/** `lock_timeout` y el pid de la conexion, vistos desde dentro de una transaccion. */
async function leer(cliente: ClientePrueba): Promise<{ espera: string; pid: number }> {
  const filas = await cliente.$queryRaw<{ espera: string; pid: number }[]>`
    SELECT current_setting('lock_timeout') AS espera, pg_backend_pid()::int AS pid`;
  const fila = filas[0];
  if (!fila) throw new Error('la consulta no devolvio fila');
  return fila;
}

describe('esperaMaximaDeBloqueoMs: valores invalidos', () => {
  const invalidos: [string, unknown][] = [
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['60001', 60_001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['un texto', '500'],
  ];

  it.each(invalidos)('rechaza %s con RangeError sin ejecutar trabajo', async (_nombre, valor) => {
    let ejecutado = false;
    await expect(
      base.conAcademia(
        datos.A.id,
        () => {
          ejecutado = true;
          return Promise.resolve('no');
        },
        { esperaMaximaDeBloqueoMs: valor },
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(ejecutado, 'trabajo no se ejecuta').toBe(false);
  });

  it('despues de un rechazo, la conexion sigue sana y sin lock_timeout', async () => {
    await expect(
      base.conAcademia(datos.A.id, () => Promise.resolve(1), { esperaMaximaDeBloqueoMs: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
    const visto = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente));
    expect(visto.espera).toBe('0');
  });
});

describe('esperaMaximaDeBloqueoMs: alcance de la transaccion', () => {
  it('lock_timeout vale <n>ms dentro de la transaccion y vuelve a 0 en la siguiente de la misma conexion', async () => {
    const dentro = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente), { esperaMaximaDeBloqueoMs: 750 });
    expect(dentro.espera).toBe('750ms');

    const despues = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente));
    expect(despues.pid, 'misma conexion').toBe(dentro.pid);
    expect(despues.espera).toBe('0');
  });

  it('los limites 1 y 60000 son validos', async () => {
    const minimo = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente), { esperaMaximaDeBloqueoMs: 1 });
    const maximo = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente), { esperaMaximaDeBloqueoMs: 60_000 });
    expect(minimo.espera).toBe('1ms');
    // PostgreSQL muestra 60000 ms como `1min`.
    expect(maximo.espera).toBe('1min');
  });

  it('despues de un trabajo que lanza, la siguiente transaccion de la misma conexion vuelve a 0', async () => {
    let pidDentro = 0;
    const motivo = new Error('fallo de trabajo');
    await expect(
      base.conAcademia(
        datos.A.id,
        async (tx) => {
          const visto = await leer(tx.cliente);
          pidDentro = visto.pid;
          expect(visto.espera).toBe('300ms');
          throw motivo;
        },
        { esperaMaximaDeBloqueoMs: 300 },
      ),
    ).rejects.toBe(motivo);

    const despues = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente));
    expect(despues.pid, 'misma conexion').toBe(pidDentro);
    expect(despues.espera).toBe('0');
  });
});

describe('esperaMaximaDeBloqueoMs: desde la primera sentencia de trabajo', () => {
  it('la primera sentencia ve el valor aplicado', async () => {
    const primera = await base.conAcademia(
      datos.A.id,
      async (tx) =>
        (await tx.cliente.$queryRaw<{ espera: string }[]>`SELECT current_setting('lock_timeout') AS espera`)[0]?.espera,
      { esperaMaximaDeBloqueoMs: 400 },
    );
    expect(primera).toBe('400ms');
  });

  it('un bloqueo ocupado como primera sentencia falla con 55P03 pasado el limite, no espera sin limite', async () => {
    const clave = 2_005_002;
    await conClienteComo('propietario', async (otro) => {
      await otro.query('BEGIN');
      try {
        await otro.query('SELECT pg_advisory_xact_lock($1::bigint)', [clave]);
        const inicio = Date.now();
        const error = await base
          .conAcademia(
            datos.A.id,
            (tx) => tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`,
            { esperaMaximaDeBloqueoMs: 200 },
          )
          .then(
            () => undefined,
            (falla: unknown) => falla,
          );
        const duracion = Date.now() - inicio;
        expect(error, 'la espera por el bloqueo falla').toBeDefined();
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error as object))).toContain('55P03');
        expect(duracion, 'falla en pocos segundos, no espera sin limite').toBeLessThan(8_000);
      } finally {
        await otro.query('ROLLBACK').catch(() => undefined);
      }
    });
    // La conexion queda sana y sin limite.
    const despues = await base.conAcademia(datos.A.id, (tx) => leer(tx.cliente));
    expect(despues.espera).toBe('0');
  });
});
