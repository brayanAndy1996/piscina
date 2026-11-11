// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento } from '../../utilidades/datos';
import { intentar, Prisma, textoDelError } from '../../utilidades/ronda3';

// Criterio 101 (ataque ronda 3, F6), parte de los comandos: lo mismo en `enPlataforma`. Un cursor `WITH HOLD` declarado en una
// transaccion no existe en la siguiente del mismo cliente (con `crearClienteDelDueno(url, { max: 1 })`, precision P-23): al
// empezar la siguiente transaccion `SELECT count(*) FROM pg_cursors` es 0 y `FETCH ALL FROM c` falla con SQLSTATE 34000.

type Opciones = { max?: number };
// La firma nueva (P-23) acepta `opciones`; se llama con `Reflect.apply` para que la prueba compile antes y despues de agregarla.
const crearConPool = (url: string, opciones: Opciones) =>
  Reflect.apply(crearClienteDelDueno, undefined, [url, opciones]) as ReturnType<typeof crearClienteDelDueno>;

describe('criterio 101: enPlataforma cierra los cursores en cada transaccion', () => {
  let cliente: ReturnType<typeof crearClienteDelDueno> | undefined;

  beforeEach(async () => {
    await limpiarBase();
    await crearDatosDeAislamiento();
    cliente = crearConPool(urlPropietarioPruebas(), { max: 1 });
    const abierto = cliente;
    // Preparacion: se limpian los cursores de la prueba anterior antes de declarar los de esta (ver cursores.test.ts).
    await enPlataforma(abierto, async (tx) => {
      await tx.$executeRaw`CLOSE ALL`;
    });
    await enPlataforma(abierto, async (tx) => {
      await tx.$executeRaw`DECLARE c CURSOR WITH HOLD FOR SELECT * FROM academias`;
      await tx.$executeRaw`DECLARE d CURSOR WITH HOLD FOR SELECT * FROM auditoria_plataforma`;
    });
  });
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
  });

  it('criterio 101: en la siguiente transaccion de enPlataforma no queda ningun cursor', async () => {
    const cursores = await enPlataforma(cliente as NonNullable<typeof cliente>, async (tx) => {
      const filas = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_cursors`;
      return filas[0]?.n;
    });

    expect(cursores).toBe(0);
  });

  it.each(['c', 'd'])('criterio 101: FETCH ALL FROM %s en la siguiente transaccion falla con 34000', async (nombre) => {
    const error = await intentar(() =>
      enPlataforma(cliente as NonNullable<typeof cliente>, async (tx) => {
        await tx.$queryRaw`FETCH ALL FROM ${Prisma.raw(nombre)}`;
      }),
    );

    expect(error, `FETCH ALL FROM ${nombre} debia fallar`).toBeDefined();
    expect(textoDelError(error)).toContain('34000');
  });

  it('criterio 101: un cursor declarado y usado dentro de la misma transaccion de enPlataforma sigue funcionando', async () => {
    const filas = await enPlataforma(cliente as NonNullable<typeof cliente>, async (tx) => {
      await tx.$executeRaw`DECLARE propio CURSOR FOR SELECT id::text AS id FROM academias`;
      return tx.$queryRaw<{ id: string }[]>`FETCH ALL FROM propio`;
    });

    expect(filas).toHaveLength(2);
  });
});
