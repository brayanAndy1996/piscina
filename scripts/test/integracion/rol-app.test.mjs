// Spec 001, criterio 6: db:crear crea y verifica el rol aquagestion_app. Las pruebas que crean roles corren solo donde
// el usuario de la base puede hacerlo (Docker y la integración continua: superusuario o CREATEROLE); en la nube
// (donde `aquagestion` no puede crear roles) se omiten con aviso. Los roles de estas pruebas tienen nombres
// temporales: nunca se toca el rol real aquagestion_app.
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asegurarRolApp } from '../../crear-bases.mjs';
import { USUARIO_APP } from '../../lib/entorno.mjs';
import { borrarBases, ejecutarScript, nombresTemporales, servidorDePruebas, urlDe } from './ayuda.mjs';
import { urlAppAlineada } from './ayuda-ronda9.mjs';

const servidor = servidorDePruebas();
const CLAVE = 'clave-temporal-de-prueba';
const roles = [];

function nombreDeRol() {
  const nombre = `aqua_rol_${crypto.randomBytes(4).toString('hex')}`;
  roles.push(nombre);
  return nombre;
}

async function conectar(usuario = servidor.usuario, clave = servidor.clave) {
  const cliente = new pg.Client({
    host: servidor.host,
    port: servidor.puerto,
    user: usuario,
    password: clave,
    database: 'postgres',
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

let puedeCrearRoles = false;
let esSuperusuario = false;

beforeAll(async () => {
  const [fila] = await consultar(
    'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  esSuperusuario = fila.rolsuper;
  puedeCrearRoles = fila.rolsuper || fila.rolcreaterole;
  if (!puedeCrearRoles) {
    console.warn(
      'Aviso: el usuario de la base no puede crear roles; se omiten las pruebas que crean roles (criterio 6).',
    );
  }
});

afterAll(async () => {
  if (!puedeCrearRoles) return;
  for (const rol of roles) await consultar(`DROP ROLE IF EXISTS "${rol}"`);
});

describe('asegurarRolApp (criterio 6)', () => {
  it('si el usuario no puede crear roles y el rol falta, dice qué hacer y no muestra la contraseña', async (contexto) => {
    if (puedeCrearRoles) contexto.skip();
    const cliente = await conectar();
    try {
      const error = await asegurarRolApp(cliente, { usuario: nombreDeRol(), clave: CLAVE }).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/no puede crear roles/);
      expect(error.message).toMatch(/preparar-sesion/);
      expect(error.message).not.toContain(CLAVE);
    } finally {
      await cliente.end();
    }
  });

  it('crea el rol con LOGIN y sin ningún privilegio, y un segundo intento no cambia su contraseña', async (contexto) => {
    if (!puedeCrearRoles) contexto.skip();
    const usuario = nombreDeRol();
    const cliente = await conectar();
    try {
      expect(await asegurarRolApp(cliente, { usuario, clave: CLAVE })).toEqual({ creado: true });
      const [rol] = await consultar(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolinherit
           FROM pg_catalog.pg_roles WHERE rolname = $1`,
        [usuario],
      );
      expect(rol).toEqual({
        rolcanlogin: true,
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolinherit: false,
      });

      expect(await asegurarRolApp(cliente, { usuario, clave: 'otra-clave-distinta' })).toEqual({ creado: false });
      const entrada = await conectar(usuario, CLAVE);
      await entrada.end();
      await expect(conectar(usuario, 'otra-clave-distinta')).rejects.toThrow(/password authentication failed/);
    } finally {
      await cliente.end();
    }
  });

  it('una contraseña con comillas y barras se guarda tal cual', async (contexto) => {
    if (!puedeCrearRoles) contexto.skip();
    const usuario = nombreDeRol();
    const clave = 'a\'b\\c$$d"e;--';
    const cliente = await conectar();
    try {
      await asegurarRolApp(cliente, { usuario, clave });
      const entrada = await conectar(usuario, clave);
      await entrada.end();
    } finally {
      await cliente.end();
    }
  });

  it('si el rol existe con SUPERUSER, falla con un mensaje que dice qué hacer', async (contexto) => {
    if (!esSuperusuario) contexto.skip();
    const usuario = nombreDeRol();
    await consultar(`CREATE ROLE "${usuario}" LOGIN SUPERUSER PASSWORD '${CLAVE}'`);
    const cliente = await conectar();
    try {
      const error = await asegurarRolApp(cliente, { usuario, clave: CLAVE }).catch((e) => e);
      expect(error.message).toMatch(/NOSUPERUSER NOBYPASSRLS/);
      expect(error.message).not.toContain(CLAVE);
    } finally {
      await cliente.end();
    }
  });

  it('si el rol existe con BYPASSRLS, falla', async (contexto) => {
    if (!esSuperusuario) contexto.skip();
    const usuario = nombreDeRol();
    await consultar(`CREATE ROLE "${usuario}" LOGIN BYPASSRLS PASSWORD '${CLAVE}'`);
    const cliente = await conectar();
    try {
      await expect(asegurarRolApp(cliente, { usuario, clave: CLAVE })).rejects.toThrow(/BYPASSRLS/);
    } finally {
      await cliente.end();
    }
  });

  it.each([['Mayusculas'], ['con-guion'], ['']])('rechaza el nombre de usuario %j', async (usuario) => {
    const cliente = await conectar();
    try {
      await expect(asegurarRolApp(cliente, { usuario, clave: CLAVE })).rejects.toThrow(/minúsculas/);
    } finally {
      await cliente.end();
    }
  });
});

describe('db:crear y el rol de la app (criterio 6)', () => {
  const creadas = [];

  function variables({ app }) {
    const nombres = nombresTemporales();
    creadas.push(nombres.desarrollo, nombres.pruebas);
    const desarrollo = urlDe(servidor, nombres.desarrollo);
    return {
      DATABASE_URL: desarrollo,
      DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
      // Criterio 148 (ataque ronda 9): la URL de la app lleva el mismo servidor, puerto y base que DATABASE_URL del caso; lo que
      // comprueba cada caso (usuario, contrasena, variable ausente) no cambia.
      DATABASE_URL_APP: urlAppAlineada(app, desarrollo),
    };
  }

  afterAll(async () => {
    await borrarBases(servidor, creadas);
  });

  const urlApp = (usuario, clave = CLAVE) =>
    `postgresql://${usuario}:${encodeURIComponent(clave)}@${servidor.host}:${servidor.puerto}/aquagestion`;

  it('termina con código 1 si el usuario de DATABASE_URL_APP no es aquagestion_app', () => {
    const resultado = ejecutarScript(['crear-bases.mjs'], variables({ app: urlApp('otro_usuario') }));
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toContain(`debe ser ${USUARIO_APP}`);
    expect(resultado.salida).not.toContain(CLAVE);
  });

  it('termina con código 1 si DATABASE_URL_APP usa el mismo usuario que DATABASE_URL', () => {
    const resultado = ejecutarScript(['crear-bases.mjs'], variables({ app: urlApp(servidor.usuario, servidor.clave) }));
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toContain('DATABASE_URL_APP');
  });

  it('termina con código 1 y nombra la variable si falta DATABASE_URL_APP, sin crear las bases', () => {
    const resultado = ejecutarScript(['crear-bases.mjs'], variables({ app: '' }));
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toContain('DATABASE_URL_APP');
  });

  it('con el rol aquagestion_app ya creado, informa que ya existía y no cambia nada', async (contexto) => {
    const [existe] = await consultar('SELECT 1 AS ok FROM pg_catalog.pg_roles WHERE rolname = $1', [USUARIO_APP]);
    if (!existe) contexto.skip();
    const [antes] = await consultar(
      'SELECT rolpassword IS NOT NULL AS tiene FROM pg_catalog.pg_authid WHERE rolname = $1',
      [USUARIO_APP],
    ).catch(() => [undefined]);
    const resultado = ejecutarScript(
      ['crear-bases.mjs'],
      variables({ app: urlApp(USUARIO_APP, 'otra-clave-sin-efecto') }),
    );
    expect(resultado.estado).toBe(0);
    expect(resultado.salida).toContain(`El rol ya existía: ${USUARIO_APP}`);
    expect(resultado.salida).not.toContain('otra-clave-sin-efecto');
    if (antes) {
      const [despues] = await consultar(
        'SELECT rolpassword IS NOT NULL AS tiene FROM pg_catalog.pg_authid WHERE rolname = $1',
        [USUARIO_APP],
      );
      expect(despues).toEqual(antes);
    }
  });
});
