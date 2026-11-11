// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { cargarPrisma, obtenerBaseDatos } from '../../utilidades/modulos';
import { citar, nombreDeLaBase } from '../../utilidades/ronda3';

// Criterio 103 (ataque ronda 3, O2; complementa los criterios 80 y 81): la comprobacion del rol rechaza el rol si tiene valores
// por defecto propios: `pg_roles.rolconfig` no vacio (`ALTER ROLE aquagestion_app SET ...`) o alguna fila de `pg_db_role_setting`
// con `setrole` igual a su oid, en cualquier base (`ALTER ROLE aquagestion_app IN DATABASE ... SET ...`). La API rechaza con
// `ErrorRolBaseDatosInseguro`. Los valores por defecto de la base para todos los roles (`ALTER DATABASE ... SET`, `setrole = 0`)
// no cuentan: los neutraliza cada transaccion (criterios 72 y 98). Se prueba conectado COMO LA APP (el propio rol puede fijarse
// valores: ese es el ataque), con una API nueva por caso; se restaura con `RESET ALL` al final. El caso de `IN DATABASE` se omite
// con aviso si el servidor no lo permite.
//
// AVISO: el rol `aquagestion_app` es del cluster. Mientras dura cada caso (menos de un segundo) cualquier otra API de pruebas que
// arranque contra el mismo servidor tambien seria rechazada: estas pruebas no deben correr a la vez que otras suites.

const APP = 'aquagestion_app';

async function restaurarRol(): Promise<void> {
  const base = citar(await nombreDeLaBase());
  await conClienteComo('app', async (cliente) => {
    await cliente.query(`ALTER ROLE ${APP} RESET ALL`);
    await cliente.query(`ALTER ROLE ${APP} IN DATABASE ${base} RESET ALL`).catch(() => undefined);
  });
}

async function elRolPuedeFijarValoresPorBase(): Promise<boolean> {
  const base = citar(await nombreDeLaBase());
  try {
    await conClienteComo('app', (cliente) =>
      cliente.query(`ALTER ROLE ${APP} IN DATABASE ${base} SET TimeZone = 'America/Lima'`),
    );
    return true;
  } catch {
    return false;
  } finally {
    await restaurarRol();
  }
}

interface Caso {
  readonly nombre: string;
  readonly fijar: (base: string) => string;
  readonly requierePermiso?: boolean;
}

const CASOS: Caso[] = [
  {
    nombre: "ALTER ROLE aquagestion_app SET statement_timeout = '1min'",
    fijar: () => `ALTER ROLE ${APP} SET statement_timeout = '1min'`,
  },
  {
    nombre: 'ALTER ROLE aquagestion_app SET row_security = off',
    fijar: () => `ALTER ROLE ${APP} SET row_security = off`,
  },
  {
    nombre: 'ALTER ROLE aquagestion_app SET search_path = pg_temp, public',
    fijar: () => `ALTER ROLE ${APP} SET search_path = pg_temp, public`,
  },
  {
    nombre: "ALTER ROLE aquagestion_app IN DATABASE <base de pruebas> SET TimeZone = 'America/Lima'",
    fijar: (base) => `ALTER ROLE ${APP} IN DATABASE ${base} SET TimeZone = 'America/Lima'`,
    requierePermiso: true,
  },
];

describe('criterio 103: el rol de la API sin valores por defecto propios', () => {
  let academia: AcademiaDePrueba;
  let puedeFijarPorBase = false;

  beforeAll(async () => {
    await restaurarRol();
    puedeFijarPorBase = await elRolPuedeFijarValoresPorBase();
    if (!puedeFijarPorBase) {
      console.warn(
        '[criterio 103] AVISO: el servidor no deja fijar ALTER ROLE ... IN DATABASE ... SET; ese caso se omite.',
      );
    }
  });
  afterAll(restaurarRol);
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(restaurarRol);

  async function conApi<T>(trabajo: (app: NestExpressApplication) => Promise<T>): Promise<T> {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      return await trabajo(app);
    } finally {
      await app.close();
    }
  }

  it('criterio 103 (control): sin valores por defecto propios del rol, la comprobacion pasa', async () => {
    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
    });
  });

  // (Un bucle y no it.each: it.each no entrega el contexto de la prueba, que hace falta para omitir el caso con aviso.)
  for (const caso of CASOS) {
    it(`criterio 103: ${caso.nombre} hace que conAcademia, comoPlataforma y resolverAcademia rechacen`, async (contexto: TestContext) => {
      if (caso.requierePermiso && !puedeFijarPorBase)
        contexto.skip('el servidor no deja fijar ALTER ROLE ... IN DATABASE ... SET');
      const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
      const base = citar(await nombreDeLaBase());
      await conClienteComo('app', (cliente) => cliente.query(caso.fijar(base)));

      await conApi(async (app) => {
        const baseDatos = await obtenerBaseDatos(app);
        const trabajo = vi.fn(() => Promise.resolve('no'));

        await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(
          ErrorRolBaseDatosInseguro,
        );
        expect(trabajo).not.toHaveBeenCalled();
      });
    });
  }

  it('criterio 103: despues de RESET ALL, una API nueva vuelve a atender', async () => {
    await conClienteComo('app', (cliente) => cliente.query(`ALTER ROLE ${APP} SET statement_timeout = '1min'`));
    await restaurarRol();

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
    });
  });

  it('criterio 103: los valores por defecto de la base para todos los roles (ALTER DATABASE ... SET) no cuentan', async (contexto) => {
    const base = citar(await nombreDeLaBase());
    try {
      await ejecutarComo('propietario', `ALTER DATABASE ${base} SET TimeZone = 'America/Lima'`);
    } catch {
      contexto.skip('el dueno de la base no puede ejecutar ALTER DATABASE ... SET');
    }
    try {
      await conApi(async (app) => {
        const baseDatos = await obtenerBaseDatos(app);

        await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
        await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
      });
    } finally {
      await ejecutarComo('propietario', `ALTER DATABASE ${base} RESET TimeZone`).catch(() => undefined);
    }
  });
});
