// Criterio 27 (spec 001): las opciones de aislamiento de conAcademia y comoPlataforma. No es una prueba protegida
// (es "prueba obligatoria" no crítica): la escribe quien implementa. Lo usarán el aforo y la caja.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
// (criterio 100) El cliente de `trabajo` ya no tiene `$queryRawUnsafe` ni `$executeRawUnsafe`: el SQL con parametros `$1`
// se ejecuta con `consultar` y `ejecutar` (`$queryRaw`/`$executeRaw` con `Prisma.sql`), sin cambiar lo que se comprueba.
import { type BaseDatosPrueba, consultar, obtenerBaseDatos } from '../../utilidades/modulos';

const NIVELES = [
  ['ReadCommitted', 'read committed'],
  ['RepeatableRead', 'repeatable read'],
  ['Serializable', 'serializable'],
] as const;

describe('criterio 27: nivel de aislamiento de la transacción', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosPrueba;
  let academia: AcademiaDePrueba;

  beforeAll(async () => {
    app = await crearAppDePruebas();
    baseDatos = await obtenerBaseDatos(app);
  });
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterAll(async () => {
    await app?.close();
  });

  const LEER = 'SHOW transaction_isolation';

  it.each(NIVELES)('conAcademia con { aislamiento: %s } corre con ese nivel', async (aislamiento, esperado) => {
    const filas = await baseDatos.conAcademia(
      academia.id,
      (tx) => consultar<{ transaction_isolation: string }[]>(tx.cliente, LEER),
      { aislamiento },
    );
    expect(filas[0]?.transaction_isolation).toBe(esperado);
  });

  it.each(NIVELES)('comoPlataforma con { aislamiento: %s } corre con ese nivel', async (aislamiento, esperado) => {
    const filas = await baseDatos.comoPlataforma(
      (tx) => consultar<{ transaction_isolation: string }[]>(tx.cliente, LEER),
      { aislamiento },
    );
    expect(filas[0]?.transaction_isolation).toBe(esperado);
  });

  it('sin opciones corre con el nivel por defecto de PostgreSQL (read committed)', async () => {
    const filas = await baseDatos.conAcademia(academia.id, (tx) =>
      consultar<{ transaction_isolation: string }[]>(tx.cliente, LEER),
    );
    expect(filas[0]?.transaction_isolation).toBe('read committed');
  });

  it('el nivel de una transacción no se queda en la conexión de la siguiente', async () => {
    await baseDatos.conAcademia(academia.id, () => Promise.resolve(), { aislamiento: 'Serializable' });
    const filas = await baseDatos.conAcademia(academia.id, (tx) =>
      consultar<{ transaction_isolation: string }[]>(tx.cliente, LEER),
    );
    expect(filas[0]?.transaction_isolation).toBe('read committed');
  });
});
