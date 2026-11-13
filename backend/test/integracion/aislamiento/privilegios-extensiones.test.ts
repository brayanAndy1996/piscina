// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import {
  instalarExtensionEnPublic,
  limpiarRestosDeExtension,
  VISTA_DE_EXTENSION,
  VISTA_EXTRA,
  type ExtensionInstalada,
} from '../../utilidades/extensiones';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 137 (ataque ronda 7, F1; AJUSTA el alcance del criterio 102 y precisa el 130): ninguna comprobacion de privilegios de la app
// (criterios 102, 125 y 130), ni en la API ni en `db:crear`, cuenta un objeto de extension (fila de `pg_depend` con `deptype = 'e'` hacia
// `pg_extension`) en ningun esquema, INCLUIDO `public`: ni la relacion ni sus columnas. Un privilegio de mas sobre un objeto que no es de
// extension se sigue rechazando, en `public` y en los demas esquemas, aunque haya extensiones instaladas. Para un mismo estado de la base,
// la API rechaza por privilegios (con `ErrorRolBaseDatosInseguro`, criterio 4) si y solo si `db:crear` informa al menos un privilegio de
// mas. Esta parte es la de la API; la de `db:crear` esta en `scripts/test/integracion/rol-app-ronda7.test.mjs` y la prueba de catalogo
// (ninguna tabla propia es objeto de extension), en `catalogo-extensiones.test.ts`.
//
// Preparacion: como superusuario, `CREATE EXTENSION pg_stat_statements SCHEMA public` (Docker y CI; concede `SELECT` a `PUBLIC` sobre sus
// vistas); si no se puede, como duenio, una extension de confianza (`pgcrypto`) en `public`. En los dos casos se crea
// `public.vista_de_extension` con `GRANT SELECT ... TO PUBLIC` y se agrega a la extension con `ALTER EXTENSION ... ADD VIEW`. Si la
// extension ya estaba instalada por otro, o no se puede instalar ninguna, los casos se omiten con aviso (la prueba solo quita lo que creo).
//   1. con la extension instalada, `conAcademia`, `comoPlataforma` y `resolverAcademia` responden sin rechazar;
//   2. control, con la extension todavia instalada: `CREATE VIEW public.vista_extra` y `GRANT SELECT ON public.vista_extra TO PUBLIC`: la
//      API rechaza con `ErrorRolBaseDatosInseguro` y el log nombra `vista_extra` y `SELECT`;
//   3. control: `GRANT TRUNCATE ON auditoria TO aquagestion_app` con la extension instalada: rechaza (el log nombra `auditoria` y
//      `TRUNCATE`).
// Ademas: un privilegio concedido a la app (o a `PUBLIC`) sobre un objeto de la extension, de tabla o de columna, no se rechaza.
// Una API nueva por caso, restaurando al final.
//
// nestjs-pino crea un unico registrador por proceso y lo ata al destino de la PRIMERA aplicacion: aqui una aplicacion inicial, creada y
// cerrada en `beforeAll` con un destino en memoria, deja que todas las demas escriban su registro en el.

const APP = 'aquagestion_app';

async function restaurarPrivilegios(): Promise<void> {
  await ejecutarComo('propietario', `REVOKE TRUNCATE ON public.auditoria FROM ${APP}`);
}

describe('criterio 137: la API ante una extension instalada en public', () => {
  let academia: AcademiaDePrueba;
  let extension: ExtensionInstalada | undefined;
  let hayExtension = false;
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(async () => {
    await limpiarRestosDeExtension();
    // La primera aplicacion del proceso fija el destino del registro para todas las demas.
    const inicial = await crearAppDePruebas({ nivelRegistro: 'info', destinoRegistro: destino });
    await inicial.close();
    // Sonda: ¿se puede instalar alguna extension en public? (se quita enseguida; cada caso instala la suya)
    const sonda = await instalarExtensionEnPublic();
    hayExtension = sonda !== undefined;
    await sonda?.restaurar();
    if (!hayExtension) {
      console.warn(
        '[criterio 137] AVISO: no se puede instalar ninguna extension en public (pg_stat_statements exige superusuario; pgcrypto ya esta instalada o el dueno no puede instalarla); los casos se omiten. Corren en Docker y en la CI.',
      );
    }
  });
  afterAll(async () => {
    await limpiarRestosDeExtension();
    await restaurarPrivilegios();
  });
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(async () => {
    await restaurarPrivilegios();
    await ejecutarComo('propietario', `DROP VIEW IF EXISTS public.${VISTA_EXTRA}`);
    await extension?.restaurar();
    extension = undefined;
  });

  async function conExtension(contexto: TestContext): Promise<void> {
    if (!hayExtension) contexto.skip('no se puede instalar ninguna extension en public: corre en Docker y en la CI');
    extension = await instalarExtensionEnPublic();
    if (extension === undefined) contexto.skip('la extension ya estaba instalada o no se puede instalar');
  }

  async function conApi<T>(trabajo: (app: NestExpressApplication) => Promise<T>): Promise<T> {
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
      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).resolves.not.toBeInstanceOf(
        ErrorRolBaseDatosInseguro,
      );
    });
  }

  /** Una API nueva: las tres entradas rechazan con `ErrorRolBaseDatosInseguro` y el log del rechazo nombra las palabras. */
  async function debeRechazar(palabras: readonly string[]): Promise<void> {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const desde = lineas.length;

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);
      const trabajo = vi.fn(() => Promise.resolve('no'));

      await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
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

  it('criterio 137 (caso 1): con la extension instalada en public (y SELECT a PUBLIC sobre sus vistas), conAcademia, comoPlataforma y resolverAcademia responden sin rechazar', async (contexto) => {
    await conExtension(contexto);

    await debeAtender();
  });

  it('criterio 137 (caso 1): lo mismo por HTTP: GET /api/a/{nombreCorto} no responde 500 ERROR_INTERNO con la extension instalada', async (contexto) => {
    await conExtension(contexto);
    const { default: request } = await import('supertest');

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer()).get(`/api/a/${academia.nombreCorto}`);

      expect(respuesta.status).not.toBe(500);
    });
  });

  it('criterio 137 (control, caso 2): con la extension instalada, vista_extra con SELECT para PUBLIC se rechaza y el log nombra vista_extra y SELECT', async (contexto) => {
    await conExtension(contexto);
    await ejecutarComo('propietario', `CREATE VIEW public.${VISTA_EXTRA} AS SELECT 1 AS x`);
    await ejecutarComo('propietario', `GRANT SELECT ON public.${VISTA_EXTRA} TO PUBLIC`);

    await debeRechazar([VISTA_EXTRA, 'SELECT']);
  });

  it('criterio 137 (control, caso 3): con la extension instalada, GRANT TRUNCATE ON auditoria TO aquagestion_app se rechaza y el log nombra auditoria y TRUNCATE', async (contexto) => {
    await conExtension(contexto);
    await ejecutarComo('propietario', `GRANT TRUNCATE ON auditoria TO ${APP}`);

    await debeRechazar(['auditoria', 'TRUNCATE']);
  });

  it.for([
    [
      'SELECT sobre la vista de la extension, concedido a la app',
      `GRANT SELECT ON public.${VISTA_DE_EXTENSION} TO ${APP}`,
    ],
    [
      'SELECT (x) sobre la vista de la extension, concedido a la app (privilegio de columna)',
      `GRANT SELECT (x) ON public.${VISTA_DE_EXTENSION} TO ${APP}`,
    ],
    [
      'todos los privilegios sobre la vista de la extension, concedidos a la app',
      `GRANT ALL ON public.${VISTA_DE_EXTENSION} TO ${APP}`,
    ],
  ] as const)(
    'criterio 137: %s no se rechaza (un objeto de extension no cuenta, ni la relacion ni sus columnas)',
    async ([, concesion], contexto) => {
      await conExtension(contexto);
      await ejecutarComo('propietario', concesion);

      await debeAtender();
    },
  );

  it('criterio 137: un privilegio de mas sobre un objeto propio se sigue rechazando aunque haya extensiones (vista_extra con SELECT para la app)', async (contexto) => {
    await conExtension(contexto);
    await ejecutarComo('propietario', `CREATE VIEW public.${VISTA_EXTRA} AS SELECT 1 AS x`);
    await ejecutarComo('propietario', `GRANT SELECT ON public.${VISTA_EXTRA} TO ${APP}`);

    await debeRechazar([VISTA_EXTRA, 'SELECT']);
  });

  it('criterio 137 (control): despues de quitar la extension y vista_extra, una API nueva vuelve a atender', async (contexto) => {
    await conExtension(contexto);
    await ejecutarComo('propietario', `CREATE VIEW public.${VISTA_EXTRA} AS SELECT 1 AS x`);
    await ejecutarComo('propietario', `GRANT SELECT ON public.${VISTA_EXTRA} TO PUBLIC`);
    await ejecutarComo('propietario', `DROP VIEW public.${VISTA_EXTRA}`);

    await debeAtender();
  });
});
