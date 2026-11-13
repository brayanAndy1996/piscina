// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { cargarPrisma, obtenerBaseDatos } from '../../utilidades/modulos';
import { citar, nombreDeLaBase } from '../../utilidades/ronda3';

// Criterio 103 (ataque ronda 3, O2; complementa los criterios 80 y 81): la comprobacion del rol rechaza el rol si tiene valores
// por defecto propios: `pg_roles.rolconfig` no vacio (`ALTER ROLE ... SET ...`) o alguna fila de `pg_db_role_setting` con
// `setrole` igual a su oid, en cualquier base (`ALTER ROLE ... IN DATABASE ... SET ...`). La API rechaza con
// `ErrorRolBaseDatosInseguro`. Los valores por defecto de la base para todos los roles (`ALTER DATABASE ... SET`, `setrole = 0`)
// no cuentan: los neutraliza cada transaccion (criterios 72 y 98). Se prueba conectado COMO EL ROL (el propio rol puede fijarse
// valores: ese es el ataque), con una API nueva por caso; se restaura con `RESET ALL` al final.
//
// Para no tocar el rol compartido `aquagestion_app` mientras corren otras pruebas en paralelo (una API que arrancara con el rol
// alterado seria rechazada), estas pruebas usan un ROL TEMPORAL PROPIO con los mismos privilegios que `aquagestion_app` (los del
// criterio 2) que crean y borran ellas mismas. Solo corren donde el usuario de las pruebas puede crear roles (Docker y la
// integracion continua); en la nube se omiten con aviso, como las pruebas del criterio 80. El caso de `db:crear`, que comprueba
// el rol de nombre fijo, esta en `scripts/test/integracion-aislada/` y corre solo, despues de las demas pruebas.

const PREFIJO = 'aq_r3_cfg_';
const ROL = `${PREFIJO}${randomBytes(3).toString('hex')}`;
const CLAVE_ROL = 'clave-temporal-de-prueba-ronda3-cfg';

/** Los privilegios del criterio 2 para el rol temporal (los mismos de `aquagestion_app`). */
const PRIVILEGIOS = [
  `GRANT USAGE ON SCHEMA public TO ${ROL}`,
  `GRANT SELECT, INSERT ON academias TO ${ROL}`,
  `GRANT UPDATE (estado, motivo_suspension, suspendida_en, actualizada_en) ON academias TO ${ROL}`,
  `GRANT SELECT ON superadmins TO ${ROL}`,
  `GRANT UPDATE (intentos_fallidos, bloqueado_hasta, ultimo_acceso, version_token, actualizado_en) ON superadmins TO ${ROL}`,
  `GRANT SELECT, INSERT ON auditoria, auditoria_plataforma TO ${ROL}`,
  `GRANT SELECT, INSERT, UPDATE ON configuraciones TO ${ROL}`,
];

function urlDelRol(): string {
  const url = new URL(urlPropietarioPruebas());
  url.username = ROL;
  url.password = CLAVE_ROL;
  return url.toString();
}

/** Ejecuta `trabajo` con una conexion del propio rol temporal. */
async function comoElRol<T>(trabajo: (cliente: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: urlDelRol() });
  await cliente.connect();
  try {
    return await trabajo(cliente);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

async function restaurarRol(): Promise<void> {
  const base = citar(await nombreDeLaBase());
  await comoElRol(async (cliente) => {
    await cliente.query(`ALTER ROLE ${ROL} RESET ALL`);
    await cliente.query(`ALTER ROLE ${ROL} IN DATABASE ${base} RESET ALL`).catch(() => undefined);
  });
}

async function borrarRol(): Promise<void> {
  const { rowCount } = await ejecutarComo('propietario', 'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [ROL]);
  if (!rowCount) return;
  await ejecutarComo('propietario', `DROP OWNED BY ${ROL}`).catch(() => undefined);
  await ejecutarComo('propietario', `DROP ROLE IF EXISTS ${ROL}`);
}

async function elRolPuedeFijarValoresPorBase(): Promise<boolean> {
  const base = citar(await nombreDeLaBase());
  try {
    await comoElRol((cliente) => cliente.query(`ALTER ROLE ${ROL} IN DATABASE ${base} SET TimeZone = 'America/Lima'`));
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
    nombre: "ALTER ROLE … SET statement_timeout = '1min'",
    fijar: () => `ALTER ROLE ${ROL} SET statement_timeout = '1min'`,
  },
  { nombre: 'ALTER ROLE … SET row_security = off', fijar: () => `ALTER ROLE ${ROL} SET row_security = off` },
  {
    nombre: 'ALTER ROLE … SET search_path = pg_temp, public',
    fijar: () => `ALTER ROLE ${ROL} SET search_path = pg_temp, public`,
  },
  {
    nombre: "ALTER ROLE … IN DATABASE <base de pruebas> SET TimeZone = 'America/Lima'",
    fijar: (base) => `ALTER ROLE ${ROL} IN DATABASE ${base} SET TimeZone = 'America/Lima'`,
    requierePermiso: true,
  },
];

describe('criterio 103: el rol de la API sin valores por defecto propios (rol temporal con los privilegios del criterio 2)', () => {
  let academia: AcademiaDePrueba;
  let puedeCrearRoles = false;
  let puedeFijarPorBase = false;

  beforeAll(async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    const fila = rows[0] as { rolsuper: boolean; rolcreaterole: boolean };
    puedeCrearRoles = fila.rolsuper || fila.rolcreaterole;
    if (!puedeCrearRoles) {
      console.warn(
        'Aviso: el usuario de las pruebas no puede crear roles; se omiten las pruebas de integracion del criterio 103.',
      );
      return;
    }
    await borrarRol();
    await ejecutarComo('propietario', `CREATE ROLE ${ROL} LOGIN NOINHERIT PASSWORD '${CLAVE_ROL}'`);
    for (const sentencia of PRIVILEGIOS) await ejecutarComo('propietario', sentencia);
    puedeFijarPorBase = await elRolPuedeFijarValoresPorBase();
    if (!puedeFijarPorBase) {
      console.warn(
        '[criterio 103] AVISO: el servidor no deja fijar ALTER ROLE ... IN DATABASE ... SET; ese caso se omite.',
      );
    }
  });
  afterAll(async () => {
    if (puedeCrearRoles) await borrarRol();
  });
  beforeEach(async (contexto) => {
    if (!puedeCrearRoles) contexto.skip('el usuario de las pruebas no puede crear roles');
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(async () => {
    if (puedeCrearRoles) await restaurarRol();
  });

  async function conApi<T>(trabajo: (app: NestExpressApplication) => Promise<T>): Promise<T> {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_URL_APP: urlDelRol() } });
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
      await comoElRol((cliente) => cliente.query(caso.fijar(base)));

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
    await comoElRol((cliente) => cliente.query(`ALTER ROLE ${ROL} SET statement_timeout = '1min'`));
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
