// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';
import { APP, esSuperusuario, puedeCrearEsquemas } from '../../utilidades/ronda5';

// Criterio 123 (ataque ronda 5, F2 (b); complementa los criterios 80, 81 y 103): la comprobacion del rol rechaza el rol si es dueno
// de CUALQUIER esquema de la base (no solo de public), si tiene CREATE sobre cualquier esquema (concedido al rol o a PUBLIC,
// incluidos los del sistema) o si existe en la base un esquema con su nombre (`aquagestion_app`), sea de quien sea: el
// `search_path` por defecto (`"$user", public`) lo buscaria antes que `public`. La API rechaza con `ErrorRolBaseDatosInseguro`
// como en el criterio 4 (el log nombra la condicion y el esquema, nunca la URL ni la contrasena). USAGE sobre otros esquemas no se
// rechaza (lo neutraliza el criterio 121). Con las migraciones de esta historia y nada mas, la comprobacion pasa.
// Una API nueva por caso, restaurando al final: el dueno crea `trampa` y concede `GRANT CREATE ON SCHEMA trampa TO aquagestion_app`
// (un caso) o `... TO PUBLIC` (otro); el dueno crea un esquema `aquagestion_app` sin conceder nada; y, solo con superusuario
// (Docker y CI; en la nube se omiten con aviso), `CREATE SCHEMA aquagestion_app AUTHORIZATION aquagestion_app` y
// `CREATE SCHEMA otro AUTHORIZATION aquagestion_app`. En cada caso `conAcademia`, `comoPlataforma` y `resolverAcademia` rechazan.
// Los casos de `db:crear` estan en scripts/test/integracion/rol-app-ronda5.test.mjs.
//
// nestjs-pino crea un unico registrador por proceso: el registro se inspecciona en la primera aplicacion que crea este archivo (la
// del primer caso con rechazo); las demas solo comprueban los rechazos.

const ESQUEMAS_DE_LA_PRUEBA = ['trampa', 'otro', APP];

async function borrarEsquemas(): Promise<void> {
  for (const esquema of ESQUEMAS_DE_LA_PRUEBA) {
    await ejecutarComo('propietario', `DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
  }
}

interface Caso {
  readonly nombre: string;
  readonly requiere?: 'superusuario';
  readonly preparar: readonly string[];
  /** Esquema que el log debe nombrar y condicion (expresion regular) que debe describir. */
  readonly esquema: string;
  readonly condicion: RegExp;
}

const CASOS: Caso[] = [
  {
    nombre: 'CREATE concedido a aquagestion_app sobre un esquema nuevo (trampa)',
    preparar: ['CREATE SCHEMA trampa', `GRANT CREATE ON SCHEMA trampa TO ${APP}`],
    esquema: 'trampa',
    condicion: /CREATE/i,
  },
  {
    nombre: 'CREATE concedido a PUBLIC sobre un esquema nuevo (trampa)',
    preparar: ['CREATE SCHEMA trampa', 'GRANT CREATE ON SCHEMA trampa TO PUBLIC'],
    esquema: 'trampa',
    condicion: /CREATE/i,
  },
  {
    nombre: 'un esquema con el nombre del rol (aquagestion_app) creado por el dueno, sin conceder nada',
    preparar: [`CREATE SCHEMA ${APP}`],
    esquema: APP,
    condicion: /aquagestion_app/,
  },
  {
    nombre:
      'un esquema con el nombre del rol, propiedad del rol (CREATE SCHEMA aquagestion_app AUTHORIZATION aquagestion_app)',
    requiere: 'superusuario',
    preparar: [`CREATE SCHEMA ${APP} AUTHORIZATION ${APP}`],
    esquema: APP,
    condicion: /aquagestion_app/,
  },
  {
    nombre: 'un esquema propiedad del rol con otro nombre (CREATE SCHEMA otro AUTHORIZATION aquagestion_app)',
    requiere: 'superusuario',
    preparar: [`CREATE SCHEMA otro AUTHORIZATION ${APP}`],
    esquema: 'otro',
    condicion: /due[ñn]o|propiet|owner|OWNER/i,
  },
];

describe('criterio 123: la API rechaza un rol con esquemas propios, con CREATE o con su nombre', () => {
  let academia: AcademiaDePrueba;
  let puedeCrear = false;
  let superusuario = false;
  let registroPendiente = true;
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(async () => {
    puedeCrear = await puedeCrearEsquemas();
    superusuario = await esSuperusuario();
    if (!puedeCrear) {
      console.warn(
        '[criterio 123] AVISO: el dueno de la base de pruebas no puede crear esquemas (CREATE sobre la base); estas pruebas se omiten. Corren en Docker y en la CI.',
      );
    } else {
      // Restos de una ejecucion anterior que murio a medias: un esquema asi haria rechazar a todas las demas pruebas.
      await borrarEsquemas();
    }
    if (!superusuario) {
      console.warn(
        '[criterio 123] AVISO: el dueno de la base de pruebas no es superusuario (nube); los casos con CREATE SCHEMA ... AUTHORIZATION aquagestion_app se omiten. Corren en Docker y en la CI.',
      );
    }
  });
  afterAll(async () => {
    if (puedeCrear) await borrarEsquemas();
  });
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(async () => {
    if (puedeCrear) await borrarEsquemas();
  });

  async function conApi<T>(trabajo: (app: NestExpressApplication) => Promise<T>, capturar = false): Promise<T> {
    const app = await crearAppDePruebas(
      capturar ? { nivelRegistro: 'info', destinoRegistro: destino } : { nivelRegistro: 'silent' },
    );
    try {
      return await trabajo(app);
    } finally {
      await app.close();
    }
  }

  function omitirSiNoSePuede(contexto: TestContext, requiere?: 'superusuario'): void {
    if (!puedeCrear) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    if (requiere === 'superusuario' && !superusuario) contexto.skip('exige superusuario: corre en Docker y en la CI');
  }

  it.for(CASOS)(
    'criterio 123: $nombre hace que conAcademia, comoPlataforma y resolverAcademia rechacen con ErrorRolBaseDatosInseguro',
    async (caso, contexto) => {
      omitirSiNoSePuede(contexto, caso.requiere);
      const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
      for (const sentencia of caso.preparar) await ejecutarComo('propietario', sentencia);
      const capturarRegistro = registroPendiente;
      registroPendiente = false;

      await conApi(async (app) => {
        const baseDatos = await obtenerBaseDatos(app);
        const trabajo = vi.fn(() => Promise.resolve('no'));

        await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(
          ErrorRolBaseDatosInseguro,
        );
        expect(trabajo).not.toHaveBeenCalled();

        if (capturarRegistro) {
          await esperarHasta(() => lineas.some((linea) => linea.includes('DATABASE_URL_APP')));
          const errores = lineas
            .map((linea) => JSON.parse(linea) as { level: number; msg?: string })
            .filter((registro) => registro.level >= 50 && registro.msg?.includes('DATABASE_URL_APP'));
          expect(errores.length, 'falta un registro de nivel error que nombre DATABASE_URL_APP').toBeGreaterThan(0);
          const texto = errores.map((registro) => registro.msg).join('\n');
          expect(texto, 'el registro no nombra el esquema').toContain(caso.esquema);
          expect(texto, 'el registro no nombra la condicion').toMatch(caso.condicion);
          const clave = new URL(urlAppPruebas()).password;
          for (const linea of lineas) {
            expect(linea).not.toContain(urlAppPruebas());
            if (clave) expect(linea).not.toContain(clave);
          }
        }
      }, capturarRegistro);
    },
  );

  it('criterio 123: POST /api/plataforma/sesion responde 500 ERROR_INTERNO con CREATE concedido sobre un esquema', async (contexto) => {
    omitirSiNoSePuede(contexto);
    for (const sentencia of ['CREATE SCHEMA trampa', `GRANT CREATE ON SCHEMA trampa TO ${APP}`]) {
      await ejecutarComo('propietario', sentencia);
    }
    const { default: request } = await import('supertest');

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/plataforma/sesion')
        .send({ correo: 'alguien@aquagestion.test', clave: 'ClaveCualquiera-1' });

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
    });
  });

  it('criterio 123 (control): USAGE sobre otro esquema, sin CREATE y sin ser su dueno, no se rechaza', async (contexto) => {
    omitirSiNoSePuede(contexto);
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    for (const sentencia of ['CREATE SCHEMA trampa', `GRANT USAGE ON SCHEMA trampa TO ${APP}`]) {
      await ejecutarComo('propietario', sentencia);
    }

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).resolves.not.toBeInstanceOf(
        ErrorRolBaseDatosInseguro,
      );
    });
  });

  it('criterio 123 (control): con las migraciones de esta historia y nada mas, la comprobacion pasa', async () => {
    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
    });
  });
});
