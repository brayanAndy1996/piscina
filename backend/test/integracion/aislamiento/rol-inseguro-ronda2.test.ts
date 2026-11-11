// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 80 (ataque ronda 2, F1), parte (b): la API falla cerrada (ErrorRolBaseDatosInseguro, 500 ERROR_INTERNO y el
// mismo registro del criterio 4) con DATABASE_URL_APP apuntando a un rol que cumple CUALQUIERA de estas condiciones:
// REPLICATION, CREATEROLE, CREATEDB, miembro de otro rol (pg_read_all_data), dueno de la base sin ser dueno de ninguna
// tabla, con CREATE sobre la base, con TEMPORARY sobre la base (concedido al rol o a PUBLIC) o con CREATE sobre el
// esquema public.
//
// Cada caso crea sus roles temporales con una conexion del dueno y los borra al terminar. Solo corre donde el usuario de
// las pruebas puede crear roles (Docker y la integracion continua); en la nube (donde `aquagestion` no puede) se omite con
// aviso y sigue valiendo el caso del criterio 4. Los casos que ademas exigen superusuario (REPLICATION, dueno de la base)
// o una concesion que el usuario no puede hacer tambien se omiten con aviso.
//
// nestjs-pino crea un unico registrador por proceso: el registro se inspecciona en la primera aplicacion que crea este
// archivo; las demas solo comprueban los rechazos y el 500.

const CLAVE_ROL = 'clave-de-prueba-temporal-ronda2';
const PREFIJO = 'aq_r2_';
const ROLES = [
  'repl',
  'crearol',
  'creadb',
  'miembro',
  'dueno',
  'creabase',
  'tempdirecto',
  'temppublic',
  'creapublic',
  'control',
].map((sufijo) => `${PREFIJO}${sufijo}`);

function citar(identificador: string): string {
  return `"${identificador.replaceAll('"', '""')}"`;
}

function urlDeRol(rol: string): string {
  const url = new URL(urlPropietarioPruebas());
  url.username = rol;
  url.password = CLAVE_ROL;
  return url.toString();
}

/** Ejecuta sentencias con la conexion del dueno (cada una en su propia transaccion). */
async function sentencias(...lista: string[]): Promise<void> {
  for (const sentencia of lista) await ejecutarComo('propietario', sentencia);
}

async function nombreDeLaBase(): Promise<string> {
  const { rows } = await ejecutarComo('propietario', 'SELECT current_database() AS base');
  return (rows[0] as { base: string }).base;
}

async function duenoDeLaBase(): Promise<string> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT pg_catalog.pg_get_userbyid(datdba) AS dueno FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()',
  );
  return (rows[0] as { dueno: string }).dueno;
}

/** ¿PUBLIC tiene TEMPORARY sobre la base actual? (grantee 0 en el ACL de la base). */
async function publicTieneTemporal(): Promise<boolean> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d,
         LATERAL pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
       WHERE d.datname = pg_catalog.current_database() AND a.grantee = 0 AND a.privilege_type = 'TEMPORARY'
     ) AS tiene`,
  );
  return (rows[0] as { tiene: boolean }).tiene;
}

async function borrarRol(rol: string): Promise<void> {
  // DROP OWNED revoca las concesiones del rol (base, esquema); despues se borra el rol.
  const { rowCount } = await ejecutarComo('propietario', 'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [rol]);
  if (!rowCount) return;
  await ejecutarComo('propietario', `DROP OWNED BY ${citar(rol)}`).catch(() => undefined);
  await ejecutarComo('propietario', `DROP ROLE IF EXISTS ${citar(rol)}`);
}

describe('criterio 80: otros roles inseguros (se omiten si el usuario de la base no puede crear roles)', () => {
  let puedeCrearRoles = false;
  let registroPendiente = true;
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    const fila = rows[0] as { rolsuper: boolean; rolcreaterole: boolean };
    puedeCrearRoles = fila.rolsuper || fila.rolcreaterole;
    if (!puedeCrearRoles) {
      console.warn(
        'Aviso: el usuario de las pruebas no puede crear roles; se omiten las pruebas de integracion del criterio 80.',
      );
      return;
    }
    for (const rol of ROLES) await borrarRol(rol);
  });
  afterAll(async () => {
    if (!puedeCrearRoles) return;
    for (const rol of ROLES) await borrarRol(rol).catch(() => undefined);
  });

  /**
   * Prepara el caso; si el usuario de las pruebas no tiene el privilegio para algo de la preparacion (SQLSTATE 42501),
   * omite el caso con aviso. Cualquier otro error es un fallo.
   */
  async function prepararOOmitir(contexto: TestContext, preparar: () => Promise<void>): Promise<boolean> {
    if (!puedeCrearRoles) {
      contexto.skip('el usuario de las pruebas no puede crear roles');
      return false;
    }
    try {
      await preparar();
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === '42501') {
        console.warn(
          `Aviso: caso omitido, el usuario de las pruebas no tiene el privilegio necesario: ${String(error)}`,
        );
        contexto.skip('el usuario de las pruebas no tiene el privilegio necesario para este caso');
        return false;
      }
      throw error;
    }
  }

  async function comprobarRechazo(rol: string): Promise<void> {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    await limpiarBase();
    const academia = await crearAcademiaDePrueba();
    const capturarRegistro = registroPendiente;
    registroPendiente = false;
    const app: NestExpressApplication = await crearAppDePruebas({
      variables: { DATABASE_URL_APP: urlDeRol(rol) },
      ...(capturarRegistro ? { nivelRegistro: 'info', destinoRegistro: destino } : { nivelRegistro: 'silent' }),
    });
    try {
      const baseDatos = await obtenerBaseDatos(app);
      const trabajo = vi.fn(() => Promise.resolve('no'));
      await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      expect(trabajo).not.toHaveBeenCalled();

      const respuesta = await request(app.getHttpServer())
        .post('/api/plataforma/sesion')
        .send({ correo: 'alguien@aquagestion.test', clave: 'ClaveCualquiera-1' });
      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');

      if (capturarRegistro) {
        await esperarHasta(() => lineas.some((linea) => linea.includes('DATABASE_URL_APP')));
        const registros = lineas.map((linea) => JSON.parse(linea) as { level: number; msg?: string });
        const errores = registros.filter(
          (registro) => registro.level >= 50 && registro.msg?.includes('DATABASE_URL_APP'),
        );
        expect(errores.length, 'falta un registro de nivel error que nombre DATABASE_URL_APP').toBeGreaterThan(0);
        for (const linea of lineas) {
          expect(linea).not.toContain(urlDeRol(rol));
          expect(linea).not.toContain(CLAVE_ROL);
        }
      }
    } finally {
      await app.close();
    }
  }

  it('criterio 80: un rol con REPLICATION es rechazado', async (contexto) => {
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(`CREATE ROLE ${PREFIJO}repl LOGIN REPLICATION PASSWORD '${CLAVE_ROL}'`),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}repl`);
  });

  it('criterio 80: un rol con CREATEROLE es rechazado', async (contexto) => {
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(`CREATE ROLE ${PREFIJO}crearol LOGIN CREATEROLE PASSWORD '${CLAVE_ROL}'`),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}crearol`);
  });

  it('criterio 80: un rol con CREATEDB es rechazado', async (contexto) => {
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(`CREATE ROLE ${PREFIJO}creadb LOGIN CREATEDB PASSWORD '${CLAVE_ROL}'`),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}creadb`);
  });

  it('criterio 80: un rol miembro de pg_read_all_data es rechazado', async (contexto) => {
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(
        `CREATE ROLE ${PREFIJO}miembro LOGIN PASSWORD '${CLAVE_ROL}'`,
        `GRANT pg_read_all_data TO ${PREFIJO}miembro`,
      ),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}miembro`);
  });

  it('criterio 80: el dueno de la base de pruebas, sin ser dueno de ninguna tabla, es rechazado', async (contexto) => {
    const base = citar(await nombreDeLaBase());
    const duenoOriginal = citar(await duenoDeLaBase());
    let cambiado = false;
    try {
      const listo = await prepararOOmitir(contexto, async () => {
        await sentencias(`CREATE ROLE ${PREFIJO}dueno LOGIN PASSWORD '${CLAVE_ROL}'`);
        await sentencias(`ALTER DATABASE ${base} OWNER TO ${PREFIJO}dueno`);
        cambiado = true;
      });
      if (!listo) return;

      await comprobarRechazo(`${PREFIJO}dueno`);
    } finally {
      // El dueno original recupera la base antes de borrar el rol de la prueba.
      if (cambiado) await ejecutarComo('propietario', `ALTER DATABASE ${base} OWNER TO ${duenoOriginal}`);
    }
  });

  it('criterio 80: un rol con GRANT CREATE ON DATABASE es rechazado', async (contexto) => {
    const base = citar(await nombreDeLaBase());
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(
        `CREATE ROLE ${PREFIJO}creabase LOGIN PASSWORD '${CLAVE_ROL}'`,
        `GRANT CREATE ON DATABASE ${base} TO ${PREFIJO}creabase`,
      ),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}creabase`);
  });

  it('criterio 80: un rol con GRANT TEMPORARY ON DATABASE es rechazado', async (contexto) => {
    const base = citar(await nombreDeLaBase());
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(
        `CREATE ROLE ${PREFIJO}tempdirecto LOGIN PASSWORD '${CLAVE_ROL}'`,
        `GRANT TEMPORARY ON DATABASE ${base} TO ${PREFIJO}tempdirecto`,
      ),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}tempdirecto`);
  });

  it('criterio 80: un rol sin concesiones propias es rechazado si PUBLIC tiene TEMPORARY sobre la base', async (contexto) => {
    const base = citar(await nombreDeLaBase());
    const publicTeniaTemporal = await publicTieneTemporal();
    let cambiado = false;
    try {
      const listo = await prepararOOmitir(contexto, async () => {
        await sentencias(`CREATE ROLE ${PREFIJO}temppublic LOGIN PASSWORD '${CLAVE_ROL}'`);
        await sentencias(`GRANT TEMPORARY ON DATABASE ${base} TO PUBLIC`);
        cambiado = true;
      });
      if (!listo) return;

      await comprobarRechazo(`${PREFIJO}temppublic`);
    } finally {
      // La base queda como estaba: con o sin TEMPORARY para PUBLIC.
      if (cambiado && !publicTeniaTemporal)
        await ejecutarComo('propietario', `REVOKE TEMPORARY ON DATABASE ${base} FROM PUBLIC`);
    }
  });

  it('criterio 80: un rol con GRANT CREATE ON SCHEMA public es rechazado', async (contexto) => {
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(
        `CREATE ROLE ${PREFIJO}creapublic LOGIN PASSWORD '${CLAVE_ROL}'`,
        `GRANT CREATE ON SCHEMA public TO ${PREFIJO}creapublic`,
      ),
    );
    if (!listo) return;

    await comprobarRechazo(`${PREFIJO}creapublic`);
  });

  // Control: sin ninguna de las condiciones el rol no se rechaza por inseguro, asi se sabe que los rechazos de arriba son
  // por la condicion de cada caso y no por otra cosa del rol de prueba. Como el rol no tiene permisos sobre las tablas, el
  // trabajo puede fallar por otra razon: lo que se comprueba es que el error no sea ErrorRolBaseDatosInseguro. Va al final:
  // no depende del registro del primer caso.
  it('criterio 80 (control): un rol creado por la prueba sin ninguna de las condiciones no es rechazado como inseguro', async (contexto) => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const listo = await prepararOOmitir(contexto, () =>
      sentencias(`CREATE ROLE ${PREFIJO}control LOGIN PASSWORD '${CLAVE_ROL}'`),
    );
    if (!listo) return;
    await limpiarBase();
    const app = await crearAppDePruebas({
      variables: { DATABASE_URL_APP: urlDeRol(`${PREFIJO}control`) },
      nivelRegistro: 'silent',
    });
    try {
      const baseDatos = await obtenerBaseDatos(app);

      const error: unknown = await baseDatos
        .comoPlataforma(() => Promise.resolve('si'))
        .then(
          () => undefined,
          (causa: unknown) => causa,
        );

      expect(error).not.toBeInstanceOf(ErrorRolBaseDatosInseguro);
    } finally {
      await app.close();
    }
  });
});
