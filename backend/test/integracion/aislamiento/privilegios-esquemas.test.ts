// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';
import { APP, esSuperusuario, puedeCrearEsquemas } from '../../utilidades/ronda5';

// Criterio 130 (ataque ronda 6, F1 (a) y (c); amplia los criterios 102 y 123): la comprobacion del rol calcula los privilegios efectivos
// de `aquagestion_app` (concedidos al rol, heredados o a `PUBLIC`) en TODOS los esquemas revisados (sin los objetos de extensiones):
//   - de tabla y de columna sobre tablas, tablas particionadas, vistas, vistas materializadas y tablas foraneas, y de secuencia: solo lo de
//     `PRIVILEGIOS_APP` (criterio 2), que se refiere a objetos de `public`; cualquier privilegio sobre un objeto de otro esquema es de mas,
//     tenga o no la app `USAGE` sobre ese esquema;
//   - `EXECUTE` sobre funciones y procedimientos de `public` y de todo esquema revisado sobre el que la app tiene `USAGE`: solo las
//     funciones de `FUNCIONES_APP` (`app_academia_actual()`, `app_es_plataforma()` y `resolver_academia(p_nombre_corto text)`); cualquier
//     otra es de mas, tambien una funcion nueva de `public` con el `EXECUTE` que PostgreSQL concede a `PUBLIC` por defecto;
//   - `USAGE` sobre `public`; sobre otro esquema revisado, solo si no contiene ninguna relacion ni funcion que no sea de una extension, o si
//     esta en "Esquemas permitidos ademas de `public`" (hoy vacia). Un esquema vacio o con solo objetos de extensiones no se rechaza
//     (sigue valiendo el criterio 123); uno con una tabla, vista, secuencia o funcion propia si, aunque la app no tenga privilegios sobre ellas;
//   - ser duenio de un objeto de otro esquema da todos sus privilegios, asi que tambien se rechaza.
// Cualquier privilegio de mas hace que la API rechace con `ErrorRolBaseDatosInseguro` como en el criterio 4 (el log nombra el esquema, el
// objeto, la columna si la hay y el privilegio, nunca la URL ni la contrasena). Con las migraciones de esta historia y nada mas, la
// comprobacion pasa. Una API nueva por caso, restaurando al final; en cada caso `conAcademia`, `comoPlataforma` y `resolverAcademia`
// rechazan. Los casos con un esquema se omiten con aviso si el duenio de la base de pruebas no puede crear esquemas (corren en Docker y en
// la CI); los que exigen superusuario, tambien. Los casos de `db:crear` estan en `scripts/test/integracion/rol-app-ronda6.test.mjs`.
//
// nestjs-pino crea un unico registrador por proceso y lo ata al destino de la PRIMERA aplicacion: aqui una aplicacion inicial, creada y
// cerrada en `beforeAll` con un destino en memoria, deja que todas las demas escriban su registro en el.

const ESQUEMAS_DE_LA_PRUEBA = ['reportes', 'ext_prueba'];

async function restaurar(puedeCrear: boolean): Promise<void> {
  if (puedeCrear) {
    for (const esquema of ESQUEMAS_DE_LA_PRUEBA)
      await ejecutarComo('propietario', `DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
  }
  await ejecutarComo('propietario', 'DROP FUNCTION IF EXISTS public.funcion_extra()');
}

interface Caso {
  readonly nombre: string;
  readonly requiere?: 'esquemas' | 'superusuario';
  readonly preparar: readonly string[];
  /** Palabras que el registro (log) debe nombrar: el esquema, el objeto, la columna y el privilegio. */
  readonly palabras: readonly string[];
}

const CASOS: Caso[] = [
  {
    nombre: '1. el ataque: reportes.auditoria_todas (vista de public.auditoria) con USAGE y SELECT para la app',
    requiere: 'esquemas',
    preparar: [
      'CREATE SCHEMA reportes',
      `GRANT USAGE ON SCHEMA reportes TO ${APP}`,
      'CREATE VIEW reportes.auditoria_todas AS SELECT * FROM public.auditoria',
      `GRANT SELECT ON reportes.auditoria_todas TO ${APP}`,
    ],
    palabras: ['reportes', 'auditoria_todas', 'SELECT'],
  },
  {
    nombre: '2. lo mismo con USAGE y SELECT concedidos a PUBLIC',
    requiere: 'esquemas',
    preparar: [
      'CREATE SCHEMA reportes',
      'GRANT USAGE ON SCHEMA reportes TO PUBLIC',
      'CREATE VIEW reportes.auditoria_todas AS SELECT * FROM public.auditoria',
      'GRANT SELECT ON reportes.auditoria_todas TO PUBLIC',
    ],
    palabras: ['reportes', 'auditoria_todas', 'SELECT'],
  },
  {
    nombre: '3. una tabla reportes.t con GRANT SELECT (id) para la app, sin USAGE sobre reportes',
    requiere: 'esquemas',
    preparar: [
      'CREATE SCHEMA reportes',
      'CREATE TABLE reportes.t (id int)',
      `GRANT SELECT (id) ON reportes.t TO ${APP}`,
    ],
    palabras: ['reportes', 'id', 'SELECT'],
  },
  {
    nombre: '4. una secuencia reportes.s con GRANT USAGE ON SEQUENCE para la app',
    requiere: 'esquemas',
    preparar: ['CREATE SCHEMA reportes', 'CREATE SEQUENCE reportes.s', `GRANT USAGE ON SEQUENCE reportes.s TO ${APP}`],
    palabras: ['reportes', 'USAGE'],
  },
  {
    nombre: '5. una funcion reportes.f() (con el EXECUTE por defecto) y USAGE sobre reportes',
    requiere: 'esquemas',
    preparar: [
      'CREATE SCHEMA reportes',
      "CREATE FUNCTION reportes.f() RETURNS int LANGUAGE sql AS 'SELECT 1'",
      `GRANT USAGE ON SCHEMA reportes TO ${APP}`,
    ],
    palabras: ['reportes'],
  },
  {
    nombre: '6. una funcion nueva public.funcion_extra() con el EXECUTE por defecto',
    preparar: ["CREATE FUNCTION public.funcion_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'"],
    palabras: ['funcion_extra', 'EXECUTE'],
  },
  {
    nombre: '7. USAGE sobre reportes, que contiene una tabla sin ningun privilegio para la app',
    requiere: 'esquemas',
    preparar: [
      'CREATE SCHEMA reportes',
      'CREATE TABLE reportes.t (id int)',
      `GRANT USAGE ON SCHEMA reportes TO ${APP}`,
    ],
    palabras: ['reportes', 'USAGE'],
  },
  {
    nombre: '8. SELECT sobre una vista materializada de otro esquema',
    requiere: 'esquemas',
    preparar: [
      'CREATE SCHEMA reportes',
      `GRANT USAGE ON SCHEMA reportes TO ${APP}`,
      'CREATE MATERIALIZED VIEW reportes.mv AS SELECT id FROM public.academias',
      `GRANT SELECT ON reportes.mv TO ${APP}`,
    ],
    palabras: ['reportes', 'mv', 'SELECT'],
  },
  {
    nombre: '9. USAGE sobre un esquema que solo contiene una secuencia sin privilegios',
    requiere: 'esquemas',
    preparar: ['CREATE SCHEMA reportes', 'CREATE SEQUENCE reportes.s', `GRANT USAGE ON SCHEMA reportes TO ${APP}`],
    palabras: ['reportes', 'USAGE'],
  },
  {
    nombre: '10. la app es duenia de una tabla de otro esquema (da todos sus privilegios)',
    requiere: 'superusuario',
    preparar: ['CREATE SCHEMA reportes', 'CREATE TABLE reportes.t (id int)', `ALTER TABLE reportes.t OWNER TO ${APP}`],
    palabras: ['reportes'],
  },
];

describe('criterio 130: la API rechaza un rol con privilegios de mas fuera de public', () => {
  let academia: AcademiaDePrueba;
  let puedeCrear = false;
  let superusuario = false;
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(async () => {
    puedeCrear = await puedeCrearEsquemas();
    superusuario = await esSuperusuario();
    await restaurar(puedeCrear);
    // La primera aplicacion del proceso fija el destino del registro para todas las demas.
    const inicial = await crearAppDePruebas({ nivelRegistro: 'info', destinoRegistro: destino });
    await inicial.close();
    if (!puedeCrear) {
      console.warn(
        '[criterio 130] AVISO: el dueno de la base de pruebas no puede crear esquemas (CREATE sobre la base); los casos con esquema se omiten. Corren en Docker y en la CI.',
      );
    }
    if (puedeCrear && !superusuario) {
      console.warn(
        '[criterio 130] AVISO: el dueno de la base de pruebas no es superusuario (nube); el caso de la app duenia de una tabla de otro esquema se omite. Corre en Docker y en la CI.',
      );
    }
  });
  afterAll(async () => {
    await restaurar(puedeCrear);
  });
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(async () => {
    await restaurar(puedeCrear);
  });

  async function conApi<T>(trabajo: (app: NestExpressApplication) => Promise<T>): Promise<T> {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      return await trabajo(app);
    } finally {
      await app.close();
    }
  }

  function omitirSiNoSePuede(contexto: TestContext, requiere?: 'esquemas' | 'superusuario'): void {
    if (requiere !== undefined && !puedeCrear) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    if (requiere === 'superusuario' && !superusuario) contexto.skip('exige superusuario: corre en Docker y en la CI');
  }

  it.for(CASOS)(
    'criterio 130: $nombre hace que conAcademia, comoPlataforma y resolverAcademia rechacen con ErrorRolBaseDatosInseguro',
    async (caso, contexto) => {
      omitirSiNoSePuede(contexto, caso.requiere);
      const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
      for (const sentencia of caso.preparar) await ejecutarComo('propietario', sentencia);
      const desde = lineas.length;

      await conApi(async (app) => {
        const baseDatos = await obtenerBaseDatos(app);
        const trabajo = vi.fn(() => Promise.resolve('no'));

        await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(
          ErrorRolBaseDatosInseguro,
        );
        expect(trabajo).not.toHaveBeenCalled();

        await esperarHasta(() => lineas.slice(desde).some((linea) => linea.includes('DATABASE_URL_APP')));
        const nuevas = lineas.slice(desde);
        const errores = nuevas
          .map((linea) => JSON.parse(linea) as { level: number; msg?: string })
          .filter((registro) => registro.level >= 50 && registro.msg?.includes('DATABASE_URL_APP'));
        expect(errores.length, 'falta un registro de nivel error que nombre DATABASE_URL_APP').toBeGreaterThan(0);
        const texto = errores.map((registro) => registro.msg).join('\n');
        for (const palabra of caso.palabras) expect(texto, `el registro no nombra ${palabra}`).toContain(palabra);
        const clave = new URL(urlAppPruebas()).password;
        for (const linea of nuevas) {
          expect(linea).not.toContain(urlAppPruebas());
          if (clave) expect(linea).not.toContain(clave);
        }
      });
    },
  );

  it('criterio 130: POST /api/plataforma/sesion responde 500 ERROR_INTERNO con el ataque de reportes.auditoria_todas', async (contexto) => {
    omitirSiNoSePuede(contexto, 'esquemas');
    for (const sentencia of CASOS[0]?.preparar ?? []) await ejecutarComo('propietario', sentencia);
    const { default: request } = await import('supertest');

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/plataforma/sesion')
        .send({ correo: 'alguien@aquagestion.test', clave: 'ClaveCualquiera-1' });

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
    });
  });

  it('criterio 130: GET /api/a/{nombreCorto} responde 500 ERROR_INTERNO con una funcion nueva de public con el EXECUTE por defecto', async () => {
    await ejecutarComo('propietario', "CREATE FUNCTION public.funcion_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    const { default: request } = await import('supertest');

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer()).get(`/api/a/${academia.nombreCorto}`);

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
    });
  });
});

describe('criterio 130: controles que pasan', () => {
  let academia: AcademiaDePrueba;
  let puedeCrear = false;
  let instalaExtensiones = false;

  beforeAll(async () => {
    puedeCrear = await puedeCrearEsquemas();
    await restaurar(puedeCrear);
    if (puedeCrear) {
      try {
        await ejecutarComo('propietario', 'CREATE SCHEMA ext_prueba');
        await ejecutarComo('propietario', 'CREATE EXTENSION pgcrypto SCHEMA ext_prueba');
        instalaExtensiones = true;
      } catch (error) {
        if (!['42501', '0A000'].includes((error as { code?: string }).code ?? '')) throw error;
      } finally {
        await restaurar(puedeCrear);
      }
    }
    if (!puedeCrear) {
      console.warn(
        '[criterio 130] AVISO: el dueno de la base de pruebas no puede crear esquemas; los controles con esquema se omiten. Corren en Docker y en la CI.',
      );
    } else if (!instalaExtensiones) {
      console.warn(
        '[criterio 130] AVISO: el dueno de la base de pruebas no puede instalar pgcrypto; el control de la extension se omite.',
      );
    }
  });
  afterAll(async () => {
    await restaurar(puedeCrear);
  });
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(async () => {
    await restaurar(puedeCrear);
  });

  /** Una API nueva: las tres entradas de `BaseDatos` deben atender sin rechazar. */
  async function debeAtender(): Promise<void> {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).resolves.not.toBeInstanceOf(
        ErrorRolBaseDatosInseguro,
      );
    } finally {
      await app.close();
    }
  }

  it('criterio 130 (control): con las migraciones de esta historia y nada mas, la comprobacion pasa', async () => {
    await debeAtender();
  });

  it('criterio 130 (control): el caso 6 despues de REVOKE EXECUTE ON FUNCTION public.funcion_extra() FROM PUBLIC pasa', async () => {
    await ejecutarComo('propietario', "CREATE FUNCTION public.funcion_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    await ejecutarComo('propietario', 'REVOKE EXECUTE ON FUNCTION public.funcion_extra() FROM PUBLIC');

    await debeAtender();
  });

  it('criterio 130 (control): reportes con una funcion y sin USAGE para la app ni para PUBLIC pasa', async (contexto) => {
    if (!puedeCrear) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    for (const sentencia of [
      'CREATE SCHEMA reportes',
      "CREATE FUNCTION reportes.f() RETURNS int LANGUAGE sql AS 'SELECT 1'",
      'CREATE VIEW reportes.v AS SELECT id FROM public.academias',
    ]) {
      await ejecutarComo('propietario', sentencia);
    }

    await debeAtender();
  });

  it('criterio 130 (control): USAGE sobre un esquema vacio pasa (criterio 123)', async (contexto) => {
    if (!puedeCrear) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    for (const sentencia of ['CREATE SCHEMA reportes', `GRANT USAGE ON SCHEMA reportes TO ${APP}`]) {
      await ejecutarComo('propietario', sentencia);
    }

    await debeAtender();
  });

  it('criterio 130 (control): USAGE sobre un esquema de extension (pgcrypto en ext_prueba) pasa', async (contexto) => {
    if (!instalaExtensiones) contexto.skip('el dueno de la base de pruebas no puede instalar pgcrypto');
    for (const sentencia of [
      'CREATE SCHEMA ext_prueba',
      'CREATE EXTENSION pgcrypto SCHEMA ext_prueba',
      `GRANT USAGE ON SCHEMA ext_prueba TO ${APP}`,
    ]) {
      await ejecutarComo('propietario', sentencia);
    }

    await debeAtender();
  });

  it('criterio 130 (control): despues de restaurar, una API nueva vuelve a atender', async (contexto) => {
    if (!puedeCrear) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    for (const sentencia of CASOS[0]?.preparar ?? []) await ejecutarComo('propietario', sentencia);
    await restaurar(puedeCrear);

    await debeAtender();
  });
});
