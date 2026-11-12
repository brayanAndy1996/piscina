// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import {
  ESQUEMA_ATAQUE,
  ESQUEMA_CONTROL,
  EXTENSION,
  instalarExtensionParaEsquemas,
  limpiarRestosDeEsquemasDeExtension,
  sentenciasDelAtaque,
  sentenciasDelControl,
  type ExtensionParaEsquemas,
} from '../../utilidades/esquemas-extension';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 141 (ataque ronda 8, F1; AJUSTA la definicion de "esquemas revisados" y los criterios 130 y 137), parte de la API: la
// comprobacion del rol (`#comprobarRol`) ya no descarta ENTERO un esquema que pertenece a una extension. Esquemas revisados son todos
// los de `pg_namespace` salvo `pg_catalog`, `information_schema`, `pg_toast` y los temporales; lo unico que se excluye es el objeto de
// extension (relacion con sus columnas, secuencia o funcion con su propia fila `deptype = 'e'`; un tipo compuesto cuenta si su tipo lo
// es). En un esquema de extension valen las reglas del criterio 130: un privilegio de tabla, de columna o de secuencia sobre una relacion
// propia es de mas, `EXECUTE` sobre una funcion propia de un esquema con `USAGE` tambien, y `USAGE` sobre el esquema se rechaza si
// contiene alguna relacion o funcion propia (aunque la app no tenga privilegios sobre ella) y se permite si esta vacio o solo tiene
// objetos de extension. La API rechaza con `ErrorRolBaseDatosInseguro` como en el criterio 4 (el log nombra el esquema, el objeto y el
// privilegio, nunca la URL ni la contrasena). Con las migraciones de esta historia y nada mas, la comprobacion pasa.
//
// Preparacion, como duenio de la base (sirve con o sin superusuario): `CREATE EXTENSION pgcrypto SCHEMA public` si no estaba instalada
// (si ya la instalo otro rol, o no se puede instalar, los casos se omiten con aviso: corren en Docker y en la CI; la prueba solo quita lo
// que creo). Una API nueva por caso, restaurando al final, tambien si la prueba falla:
//   1. el ataque: `reportes2` agregado a la extension con la tabla `t` sin RLS (una fila de A y una de B), `USAGE` sobre el esquema y
//      `SELECT` sobre la tabla para la app;
//   2. lo mismo con `USAGE` y `SELECT` concedidos a `PUBLIC`;
//   3. `USAGE` sobre `reportes2` con la tabla y sin ningun privilegio sobre ella;
//   4. control que pasa: `ext_r8` con una funcion y un tipo compuesto agregados a la extension y `USAGE` para la app.
// La parte de `db:crear` esta en `scripts/test/integracion/rol-app-ronda8.test.mjs`.
//
// nestjs-pino crea un unico registrador por proceso y lo ata al destino de la PRIMERA aplicacion: aqui una aplicacion inicial, creada y
// cerrada en `beforeAll` con un destino en memoria, deja que todas las demas escriban su registro en el.

const APP = 'aquagestion_app';
const T = `${ESQUEMA_ATAQUE}.t`;

describe('criterio 141: la API ante esquemas que pertenecen a una extension', () => {
  let a: AcademiaDePrueba;
  let b: AcademiaDePrueba;
  let extension: ExtensionParaEsquemas | undefined;
  let hayExtension = false;
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(async () => {
    await limpiarRestosDeEsquemasDeExtension();
    // La primera aplicacion del proceso fija el destino del registro para todas las demas.
    const inicial = await crearAppDePruebas({ nivelRegistro: 'info', destinoRegistro: destino });
    await inicial.close();
    // Sonda: ¿puede el duenio instalar la extension? (se quita enseguida; cada caso instala la suya)
    const sonda = await instalarExtensionParaEsquemas();
    hayExtension = sonda !== undefined;
    await sonda?.restaurar();
    if (!hayExtension) {
      console.warn(
        `[criterio 141] AVISO: el duenio de la base de pruebas no puede instalar ${EXTENSION} (o ya la instalo otro rol); los casos se omiten. Corren en Docker y en la CI.`,
      );
    }
  });
  afterAll(async () => {
    await extension?.restaurar().catch(() => undefined);
    await limpiarRestosDeEsquemasDeExtension();
  });
  beforeEach(async () => {
    await limpiarBase();
    a = await crearAcademiaDePrueba();
    b = await crearAcademiaDePrueba();
  });
  afterEach(async () => {
    // Siempre, tambien si la prueba fallo: lo agregado a la extension, los esquemas y la extension.
    try {
      await extension?.restaurar();
    } finally {
      extension = undefined;
      await limpiarRestosDeEsquemasDeExtension();
    }
  });

  async function conExtension(contexto: TestContext): Promise<void> {
    if (!hayExtension) contexto.skip(`el duenio no puede instalar ${EXTENSION}: corre en Docker y en la CI`);
    extension = await instalarExtensionParaEsquemas();
    if (extension === undefined) contexto.skip(`${EXTENSION} ya estaba instalada o no se puede instalar`);
  }

  async function ejecutar(sentencias: readonly string[]): Promise<void> {
    for (const sentencia of sentencias) await ejecutarComo('propietario', sentencia);
  }

  /** El ataque, con una fila de cada academia en la tabla sin RLS. */
  async function prepararElAtaque(destinatario: string): Promise<void> {
    await ejecutar(sentenciasDelAtaque(destinatario));
    await ejecutarComo(
      'propietario',
      `INSERT INTO ${T} (academia_id, dato) VALUES ($1::uuid, 'de A'), ($2::uuid, 'de B')`,
      [a.id, b.id],
    );
  }

  async function conApi<R>(trabajo: (app: NestExpressApplication) => Promise<R>): Promise<R> {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      return await trabajo(app);
    } finally {
      await app.close();
    }
  }

  /** Una API nueva: las tres entradas de `BaseDatos` deben atender sin rechazar. */
  async function debeAtender(): Promise<void> {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.conAcademia(a.id, () => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.resolverAcademia(a.nombreCorto)).resolves.not.toBeInstanceOf(ErrorRolBaseDatosInseguro);
    });
  }

  /** Una API nueva: las tres entradas rechazan con `ErrorRolBaseDatosInseguro` y el log del rechazo nombra las palabras. */
  async function debeRechazar(palabras: readonly string[]): Promise<void> {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const desde = lineas.length;

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);
      const trabajo = vi.fn(() => Promise.resolve('no'));

      await expect(baseDatos.conAcademia(a.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.resolverAcademia(a.nombreCorto)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      expect(trabajo).not.toHaveBeenCalled();

      await esperarHasta(() => lineas.slice(desde).some((linea) => linea.includes('DATABASE_URL_APP')));
      const nuevas = lineas.slice(desde);
      const errores = nuevas
        .map((linea) => JSON.parse(linea) as { level: number; msg?: string })
        .filter((registro) => registro.level >= 50 && registro.msg?.includes('DATABASE_URL_APP'));
      expect(errores.length, 'falta un registro de nivel error que nombre DATABASE_URL_APP').toBeGreaterThan(0);
      const texto = errores.map((registro) => registro.msg).join('\n');
      for (const palabra of palabras) expect(texto, `el registro no nombra ${palabra}`).toContain(palabra);
      const clave = new URL(urlAppPruebas()).password;
      for (const linea of nuevas) {
        expect(linea).not.toContain(urlAppPruebas());
        if (clave) expect(linea).not.toContain(clave);
      }
    });
  }

  it('criterio 141 (premisa): el esquema pertenece a la extension y la app lee las filas de A y de B de una tabla sin RLS', async (contexto) => {
    await conExtension(contexto);
    await prepararElAtaque(APP);

    const { rows: pertenencia } = await ejecutarComo(
      'propietario',
      `SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass AND d.objid = $1::pg_catalog.regnamespace::pg_catalog.oid
          AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e'`,
      [ESQUEMA_ATAQUE],
    );
    const { rows } = await ejecutarComo('app', `SELECT dato FROM ${T} ORDER BY dato`);

    expect(pertenencia).toHaveLength(1);
    expect(rows).toEqual([{ dato: 'de A' }, { dato: 'de B' }]);
  });

  it('criterio 141 (control): con la extension instalada y nada mas, una API nueva atiende', async (contexto) => {
    await conExtension(contexto);

    await debeAtender();
  });

  it('criterio 141 (caso 1): el ataque (reportes2 en la extension, tabla t sin RLS, USAGE y SELECT para la app): conAcademia, comoPlataforma y resolverAcademia rechazan y el log nombra reportes2, t y SELECT', async (contexto) => {
    await conExtension(contexto);
    await prepararElAtaque(APP);

    await debeRechazar([ESQUEMA_ATAQUE, 't', 'SELECT']);
  });

  it('criterio 141 (caso 1): lo mismo por HTTP: GET /api/a/{nombreCorto} no atiende con la tabla de reportes2 legible', async (contexto) => {
    await conExtension(contexto);
    await prepararElAtaque(APP);
    const { default: request } = await import('supertest');

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer()).get(`/api/a/${a.nombreCorto}`);

      expect(respuesta.status).toBe(500);
    });
  });

  it('criterio 141 (caso 2): lo mismo con USAGE y SELECT concedidos a PUBLIC: las tres entradas rechazan', async (contexto) => {
    await conExtension(contexto);
    await prepararElAtaque('PUBLIC');

    await debeRechazar([ESQUEMA_ATAQUE, 't', 'SELECT']);
  });

  it('criterio 141 (caso 3): USAGE sobre reportes2 con la tabla y sin ningun privilegio sobre ella: las tres entradas rechazan (objetos propios)', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `CREATE TABLE ${T} (academia_id uuid, dato text)`,
      `GRANT USAGE ON SCHEMA ${ESQUEMA_ATAQUE} TO ${APP}`,
    ]);

    await debeRechazar([ESQUEMA_ATAQUE, 'USAGE']);
  });

  it('criterio 141 (caso 4, control): ext_r8 con una funcion y un tipo compuesto de la extension y USAGE para la app: la API atiende', async (contexto) => {
    await conExtension(contexto);
    await ejecutar(sentenciasDelControl);
    await ejecutarComo('propietario', `GRANT USAGE ON SCHEMA ${ESQUEMA_CONTROL} TO ${APP}`);

    await debeAtender();
  });

  it('criterio 141 (caso 4, control): lo mismo con USAGE concedido a PUBLIC: la API atiende', async (contexto) => {
    await conExtension(contexto);
    await ejecutar(sentenciasDelControl);
    await ejecutarComo('propietario', `GRANT USAGE ON SCHEMA ${ESQUEMA_CONTROL} TO PUBLIC`);

    await debeAtender();
  });

  it('criterio 141: reportes2 vacio, agregado a la extension y con USAGE para la app: la API atiende (nada propio que ocultar)', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `GRANT USAGE ON SCHEMA ${ESQUEMA_ATAQUE} TO ${APP}`,
    ]);

    await debeAtender();
  });

  it('criterio 141: una tabla agregada a la extension dentro de reportes2, con SELECT para la app, es objeto de extension y no se rechaza', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `CREATE TABLE ${ESQUEMA_ATAQUE}.t_ext (academia_id uuid, dato text)`,
      `ALTER EXTENSION ${EXTENSION} ADD TABLE ${ESQUEMA_ATAQUE}.t_ext`,
      `GRANT USAGE ON SCHEMA ${ESQUEMA_ATAQUE} TO ${APP}`,
      `GRANT SELECT ON ${ESQUEMA_ATAQUE}.t_ext TO ${APP}`,
    ]);

    await debeAtender();
  });

  it('criterio 141: un SELECT de columna sobre la tabla propia de reportes2 se rechaza y el log nombra el esquema, la columna y el privilegio', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `CREATE TABLE ${T} (academia_id uuid, dato text)`,
      `GRANT SELECT (dato) ON ${T} TO ${APP}`,
    ]);

    await debeRechazar([ESQUEMA_ATAQUE, 'dato', 'SELECT']);
  });

  it('criterio 141: USAGE sobre una secuencia propia de reportes2 se rechaza', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `CREATE SEQUENCE ${ESQUEMA_ATAQUE}.secuencia_r8`,
      `GRANT USAGE ON SEQUENCE ${ESQUEMA_ATAQUE}.secuencia_r8 TO ${APP}`,
    ]);

    await debeRechazar([ESQUEMA_ATAQUE, 'secuencia_r8', 'USAGE']);
  });

  it('criterio 141: una funcion propia de reportes2 (con el EXECUTE por defecto) y USAGE para la app se rechaza', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `CREATE FUNCTION ${ESQUEMA_ATAQUE}.funcion_propia_r8() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      `GRANT USAGE ON SCHEMA ${ESQUEMA_ATAQUE} TO ${APP}`,
    ]);

    await debeRechazar([ESQUEMA_ATAQUE, 'funcion_propia_r8', 'EXECUTE']);
  });

  it('criterio 141 (control): un esquema con una tabla propia sin USAGE ni privilegios para la app ni para PUBLIC no se rechaza', async (contexto) => {
    await conExtension(contexto);
    await ejecutar([
      `CREATE SCHEMA ${ESQUEMA_ATAQUE}`,
      `ALTER EXTENSION ${EXTENSION} ADD SCHEMA ${ESQUEMA_ATAQUE}`,
      `CREATE TABLE ${T} (academia_id uuid, dato text)`,
    ]);

    await debeAtender();
  });

  it('criterio 141 (control): despues de quitar el esquema del ataque, una API nueva vuelve a atender', async (contexto) => {
    await conExtension(contexto);
    await prepararElAtaque(APP);
    await ejecutarComo('propietario', `ALTER EXTENSION ${EXTENSION} DROP SCHEMA ${ESQUEMA_ATAQUE}`);
    await ejecutarComo('propietario', `DROP SCHEMA ${ESQUEMA_ATAQUE} CASCADE`);

    await debeAtender();
  });
});
