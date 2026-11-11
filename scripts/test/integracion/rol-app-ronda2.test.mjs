// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterios 81 y 82 (ataque ronda 2, F1 y F4), parte de integracion de los scripts:
//  - 81: si `aquagestion_app` ya existe y cumple alguna condicion del criterio 80, `npm run db:crear` termina con codigo 1,
//    con un mensaje que nombra la condicion y como corregirla (por ejemplo `ALTER ROLE aquagestion_app NOREPLICATION;`),
//    sin imprimir contrasenas ni modificar el rol. Las condiciones que dependen de cada base (CREATE o TEMPORARY sobre la
//    base, CREATE sobre el esquema public, ser dueno de la base o de objetos de public) se evaluan sobre la base de
//    desarrollo y sobre la de pruebas, despues de la revocacion del criterio 82.
//  - 82: `db:crear` revoca TEMPORARY a PUBLIC y a aquagestion_app sobre las bases que crea o encuentra (sin quitar CONNECT),
//    de forma idempotente; si no puede revocar (su usuario no es dueno de la base ni superusuario) termina con codigo 1 y lo
//    explica.
//
// Para no tocar el rol real aquagestion_app (lo comparten las demas pruebas, que corren en paralelo), los atributos del rol
// (REPLICATION, CREATEROLE, CREATEDB, membresias) se prueban con `asegurarRolApp` y roles de nombre temporal; el comando
// completo se prueba con el rol real y condiciones de cada base: se otorgan solo sobre bases temporales que la prueba crea y
// borra. Los casos que crean roles o cambian duenos solo corren con superusuario o CREATEROLE (Docker y la integracion
// continua); en la nube se omiten con aviso.
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asegurarRolApp } from '../../crear-bases.mjs';
import { USUARIO_APP } from '../../lib/entorno.mjs';
import {
  borrarBases,
  ejecutarScript,
  ejecutarSql,
  existeBase,
  filtracionesDeLaClaveDelServidor,
  nombresTemporales,
  servidorDePruebas,
  urlDe,
} from './ayuda.mjs';

const servidor = servidorDePruebas();
const CLAVE_ROL = 'clave-temporal-de-prueba-ronda2';
const CLAVE_APP_QUE_NO_DEBE_SALIR = 'clave-app-que-no-debe-salir-xyz';
const rolesCreados = [];
const basesCreadas = [];

async function conectar(usuario = servidor.usuario, clave = servidor.clave, base = 'postgres') {
  const cliente = new pg.Client({
    host: servidor.host,
    port: servidor.puerto,
    user: usuario,
    password: clave,
    database: base,
  });
  await cliente.connect();
  return cliente;
}

async function consultar(sql, parametros = []) {
  const cliente = await conectar();
  try {
    return (await cliente.query(sql, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

let esSuperusuario = false;
let puedeCrearRoles = false;
let existeElRolApp = false;

beforeAll(async () => {
  const [fila] = await consultar(
    'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  esSuperusuario = fila.rolsuper;
  puedeCrearRoles = fila.rolsuper || fila.rolcreaterole;
  const rol = await consultar('SELECT 1 AS ok FROM pg_catalog.pg_roles WHERE rolname = $1', [USUARIO_APP]);
  existeElRolApp = rol.length > 0;
  if (!puedeCrearRoles) {
    console.warn(
      'Aviso: el usuario de la base no puede crear roles; se omiten las pruebas que crean roles (criterio 81).',
    );
  }
});

afterAll(async () => {
  await borrarBases(servidor, basesCreadas).catch(() => undefined);
  for (const rol of rolesCreados) {
    await consultar(`DROP OWNED BY "${rol}"`).catch(() => undefined);
    await consultar(`DROP ROLE IF EXISTS "${rol}"`).catch(() => undefined);
  }
});

function nombreDeRol() {
  const nombre = `aqua_r2_${crypto.randomBytes(4).toString('hex')}`;
  rolesCreados.push(nombre);
  return nombre;
}

/** Atributos de un rol, para comprobar que una ejecucion no lo modifico. */
async function atributosDe(usuario) {
  const [rol] = await consultar(
    `SELECT rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit,
            (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS membresias
       FROM pg_catalog.pg_roles r WHERE rolname = $1`,
    [usuario],
  );
  return rol;
}

/** Omite el caso con aviso si el usuario de la base no tiene el privilegio (SQLSTATE 42501) para prepararlo. */
async function prepararOOmitir(contexto, preparar) {
  try {
    await preparar();
  } catch (error) {
    if (error.code === '42501') {
      console.warn(`Aviso: caso omitido, el usuario de la base no tiene el privilegio necesario: ${error.message}`);
      contexto.skip('el usuario de la base no tiene el privilegio necesario para este caso');
    }
    throw error;
  }
}

describe('asegurarRolApp con un rol que ya existe y no es seguro (criterio 81)', () => {
  // (Un bucle y no it.each: it.each no entrega el contexto de la prueba, que hace falta para omitir el caso con aviso.)
  for (const [atributo, correccion] of [
    ['REPLICATION', 'NOREPLICATION'],
    ['CREATEROLE', 'NOCREATEROLE'],
    ['CREATEDB', 'NOCREATEDB'],
  ]) {
    it(`si el rol existe con ${atributo}, falla con un mensaje que nombra la condicion y la correccion, sin la contrasena y sin modificar el rol`, async (contexto) => {
      if (!puedeCrearRoles) contexto.skip('el usuario de la base no puede crear roles');
      const usuario = nombreDeRol();
      await prepararOOmitir(contexto, () =>
        consultar(`CREATE ROLE "${usuario}" LOGIN ${atributo} PASSWORD '${CLAVE_ROL}'`),
      );
      const antes = await atributosDe(usuario);
      const cliente = await conectar();
      try {
        const error = await asegurarRolApp(cliente, { usuario, clave: CLAVE_ROL }).catch((e) => e);

        expect(error, 'asegurarRolApp debia fallar').toBeInstanceOf(Error);
        expect(error.message).toContain(atributo);
        expect(error.message).toMatch(new RegExp(`ALTER ROLE "?${usuario}"? ${correccion};`));
        expect(error.message).not.toContain(CLAVE_ROL);
        expect(await atributosDe(usuario)).toEqual(antes);
      } finally {
        await cliente.end();
      }
    });
  }

  it('si el rol existe y es miembro de otro rol, falla con un mensaje que nombra la condicion y un REVOKE, y no lo modifica', async (contexto) => {
    if (!puedeCrearRoles) contexto.skip('el usuario de la base no puede crear roles');
    const usuario = nombreDeRol();
    await prepararOOmitir(contexto, async () => {
      await consultar(`CREATE ROLE "${usuario}" LOGIN PASSWORD '${CLAVE_ROL}'`);
      await consultar(`GRANT pg_read_all_data TO "${usuario}"`);
    });
    const antes = await atributosDe(usuario);
    const cliente = await conectar();
    try {
      const error = await asegurarRolApp(cliente, { usuario, clave: CLAVE_ROL }).catch((e) => e);

      expect(error, 'asegurarRolApp debia fallar').toBeInstanceOf(Error);
      expect(error.message).toMatch(/miembro|pg_read_all_data/);
      expect(error.message).toMatch(/REVOKE/);
      expect(error.message).toContain(usuario);
      expect(error.message).not.toContain(CLAVE_ROL);
      expect(await atributosDe(usuario)).toEqual(antes);
    } finally {
      await cliente.end();
    }
  });

  it('si el rol existe sin ninguna de las condiciones de atributos, no falla (control)', async (contexto) => {
    if (!puedeCrearRoles) contexto.skip('el usuario de la base no puede crear roles');
    const usuario = nombreDeRol();
    await prepararOOmitir(contexto, () =>
      consultar(`CREATE ROLE "${usuario}" LOGIN NOINHERIT PASSWORD '${CLAVE_ROL}'`),
    );
    const cliente = await conectar();
    try {
      expect(await asegurarRolApp(cliente, { usuario, clave: CLAVE_ROL })).toEqual({ creado: false });
    } finally {
      await cliente.end();
    }
  });
});

describe('db:crear con el rol aquagestion_app y las condiciones de cada base (criterios 81 y 82)', () => {
  const urlApp = `postgresql://${USUARIO_APP}:${encodeURIComponent(CLAVE_APP_QUE_NO_DEBE_SALIR)}@${servidor.host}:${servidor.puerto}/aquagestion`;

  /** Pareja de bases temporales: se crean aqui (con el usuario de las pruebas como dueno) o las crea db:crear. */
  function pareja({ crearAntes }) {
    const nombres = nombresTemporales();
    basesCreadas.push(nombres.desarrollo, nombres.pruebas);
    return { nombres, crearAntes };
  }

  async function prepararBases({ nombres, crearAntes }) {
    if (!crearAntes) return;
    await consultar(`CREATE DATABASE "${nombres.desarrollo}"`);
    await consultar(`CREATE DATABASE "${nombres.pruebas}"`);
  }

  function ejecutarDbCrear(nombres, { usuario = servidor.usuario, clave = servidor.clave } = {}) {
    const credenciales = { ...servidor, usuario, clave };
    return ejecutarScript(['crear-bases.mjs'], {
      DATABASE_URL: urlDe(credenciales, nombres.desarrollo),
      DATABASE_URL_PRUEBAS: urlDe(credenciales, nombres.pruebas),
      DATABASE_URL_APP: urlApp,
    });
  }

  async function publicTieneTemporal(base) {
    const [fila] = await consultar(
      `SELECT EXISTS (
         SELECT 1 FROM pg_catalog.pg_database d,
           LATERAL pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
         WHERE d.datname = $1 AND a.grantee = 0 AND a.privilege_type = 'TEMPORARY'
       ) AS tiene`,
      [base],
    );
    return fila.tiene;
  }

  async function privilegioDeLaApp(base, privilegio) {
    const [fila] = await consultar('SELECT pg_catalog.has_database_privilege($1, $2, $3) AS tiene', [
      USUARIO_APP,
      base,
      privilegio,
    ]);
    return fila.tiene;
  }

  describe('criterio 82: revocacion de TEMPORARY', () => {
    it('en bases que db:crear crea: PUBLIC y aquagestion_app quedan sin TEMPORARY y con CONNECT', async (contexto) => {
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const { nombres } = pareja({ crearAntes: false });

      const resultado = ejecutarDbCrear(nombres);

      expect(resultado.estado, resultado.salida).toBe(0);
      for (const base of [nombres.desarrollo, nombres.pruebas]) {
        expect(await publicTieneTemporal(base), `PUBLIC conserva TEMPORARY en ${base}`).toBe(false);
        expect(await privilegioDeLaApp(base, 'TEMPORARY'), `${USUARIO_APP} conserva TEMPORARY en ${base}`).toBe(false);
        expect(await privilegioDeLaApp(base, 'CONNECT'), `${USUARIO_APP} perdio CONNECT en ${base}`).toBe(true);
      }
    });

    it('en bases que ya existen con TEMPORARY para PUBLIC y para aquagestion_app: las revoca; repetirlo no cambia nada', async (contexto) => {
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const preparacion = pareja({ crearAntes: true });
      await prepararBases(preparacion);
      const { nombres } = preparacion;
      for (const base of [nombres.desarrollo, nombres.pruebas]) {
        await consultar(`GRANT TEMPORARY ON DATABASE "${base}" TO PUBLIC`);
        await consultar(`GRANT TEMPORARY ON DATABASE "${base}" TO ${USUARIO_APP}`);
        expect(await privilegioDeLaApp(base, 'TEMPORARY')).toBe(true);
      }

      const primera = ejecutarDbCrear(nombres);
      const segunda = ejecutarDbCrear(nombres);

      expect(primera.estado, primera.salida).toBe(0);
      expect(segunda.estado, segunda.salida).toBe(0);
      for (const base of [nombres.desarrollo, nombres.pruebas]) {
        expect(await publicTieneTemporal(base), `PUBLIC conserva TEMPORARY en ${base}`).toBe(false);
        expect(await privilegioDeLaApp(base, 'TEMPORARY'), `${USUARIO_APP} conserva TEMPORARY en ${base}`).toBe(false);
        expect(await privilegioDeLaApp(base, 'CONNECT'), `${USUARIO_APP} perdio CONNECT en ${base}`).toBe(true);
      }
    });

    it('si el usuario de DATABASE_URL no es dueno de la base ni superusuario, termina con codigo 1 y lo explica', async (contexto) => {
      if (!esSuperusuario)
        contexto.skip('hace falta un superusuario para crear un usuario que no sea dueno de las bases');
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const intruso = nombreDeRol();
      await consultar(`CREATE ROLE "${intruso}" LOGIN CREATEDB PASSWORD '${CLAVE_ROL}'`);
      const preparacion = pareja({ crearAntes: true });
      await prepararBases(preparacion);
      const { nombres } = preparacion;

      const resultado = ejecutarDbCrear(nombres, { usuario: intruso, clave: CLAVE_ROL });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toMatch(/propietari|dueñ|superusuario|owner/i);
      expect(resultado.salida).not.toContain(CLAVE_ROL);
      expect(resultado.salida).not.toContain(CLAVE_APP_QUE_NO_DEBE_SALIR);
    });
  });

  describe('criterio 81: condiciones de cada base sobre aquagestion_app', () => {
    /** db:crear debe terminar con 1, nombrar la condicion y no imprimir contrasenas ni cambiar el rol. */
    async function esperarRechazo(nombres, condicion) {
      const antes = await atributosDe(USUARIO_APP);

      const resultado = ejecutarDbCrear(nombres);

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toMatch(condicion);
      expect(resultado.salida).not.toContain(CLAVE_APP_QUE_NO_DEBE_SALIR);
      expect(
        filtracionesDeLaClaveDelServidor(resultado.salida, servidor),
        'la salida muestra la contrasena del servidor',
      ).toEqual([]);
      expect(await atributosDe(USUARIO_APP)).toEqual(antes);
    }

    for (const [nombre, cual] of [
      ['de desarrollo', 'desarrollo'],
      ['de pruebas', 'pruebas'],
    ]) {
      it(`con GRANT CREATE ON DATABASE sobre la base ${nombre} termina con codigo 1 y nombra la condicion`, async (contexto) => {
        if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
        const preparacion = pareja({ crearAntes: true });
        await prepararBases(preparacion);
        const { nombres } = preparacion;
        await consultar(`GRANT CREATE ON DATABASE "${nombres[cual]}" TO ${USUARIO_APP}`);

        await esperarRechazo(nombres, /CREATE/);
      });
    }

    it('con GRANT CREATE ON SCHEMA public termina con codigo 1 y nombra la condicion', async (contexto) => {
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const preparacion = pareja({ crearAntes: true });
      await prepararBases(preparacion);
      const { nombres } = preparacion;
      await ejecutarSql(servidor, nombres.pruebas, `GRANT CREATE ON SCHEMA public TO ${USUARIO_APP}`);

      await esperarRechazo(nombres, /public/);
    });

    it('si aquagestion_app es dueno de la base, termina con codigo 1 y nombra la condicion', async (contexto) => {
      if (!esSuperusuario) contexto.skip('hace falta un superusuario para cambiar el dueno de una base');
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const preparacion = pareja({ crearAntes: true });
      await prepararBases(preparacion);
      const { nombres } = preparacion;
      await consultar(`ALTER DATABASE "${nombres.desarrollo}" OWNER TO ${USUARIO_APP}`);

      await esperarRechazo(nombres, /due[ñn]o|propietari|owner/i);
    });

    it('si aquagestion_app es dueno de una tabla de public, termina con codigo 1 y nombra la condicion', async (contexto) => {
      if (!esSuperusuario) contexto.skip('hace falta un superusuario para entregar una tabla al rol de la app');
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const preparacion = pareja({ crearAntes: true });
      await prepararBases(preparacion);
      const { nombres } = preparacion;
      await ejecutarSql(servidor, nombres.pruebas, 'CREATE TABLE public.objeto_de_prueba (a int)');
      await ejecutarSql(servidor, nombres.pruebas, `ALTER TABLE public.objeto_de_prueba OWNER TO ${USUARIO_APP}`);

      await esperarRechazo(nombres, /objeto|public|due[ñn]o|propietari|owner/i);
    });

    it('sin ninguna condicion (bases limpias) db:crear termina con codigo 0 (control)', async (contexto) => {
      if (!existeElRolApp) contexto.skip(`el rol ${USUARIO_APP} no existe en este servidor`);
      const preparacion = pareja({ crearAntes: true });
      await prepararBases(preparacion);

      const resultado = ejecutarDbCrear(preparacion.nombres);

      expect(resultado.estado, resultado.salida).toBe(0);
      expect(await existeBase(servidor, preparacion.nombres.desarrollo)).toBe(true);
    });
  });
});
