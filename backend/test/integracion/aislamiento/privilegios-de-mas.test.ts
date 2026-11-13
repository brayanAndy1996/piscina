// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 102 (ataque ronda 3, O3; complementa los criterios 2, 80 y 81): la comprobacion del rol calcula los privilegios
// efectivos de `aquagestion_app` (concedidos al rol o a `PUBLIC`) sobre cada tabla, tabla particionada, vista, vista
// materializada, tabla foranea y secuencia del esquema `public`, a nivel de tabla y de columna, y los compara con la lista
// permitida del criterio 2. Cualquier privilegio de mas hace que la API rechace con `ErrorRolBaseDatosInseguro` como en el
// criterio 4 (el log nombra la tabla y el privilegio). Un privilegio que falta no lo rechaza esta comprobacion. Con las
// migraciones de esta historia y nada mas, la comprobacion pasa. El dueno de las tablas puede conceder, tambien en la nube.
// Una API nueva por caso; los privilegios se restauran al final. Los casos de `db:crear` estan en
// `scripts/test/integracion/rol-app-ronda3.test.mjs`.
//
// nestjs-pino crea un unico registrador por proceso: el registro se inspecciona en la primera aplicacion que crea este archivo.
// Por eso el primer caso del archivo (el primero de `it.each`, TRUNCATE sobre auditoria) es el que crea la primera aplicacion y
// captura el log; el caso de control, que crea una aplicacion con nivel `silent`, va despues.

const APP = 'aquagestion_app';

/** Los privilegios del criterio 2, para devolver las tablas a su estado (el dueno es quien concede y revoca). */
const RESTAURAR = [
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${APP}`,
  'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC',
  `GRANT SELECT, INSERT ON academias TO ${APP}`,
  `GRANT UPDATE (estado, motivo_suspension, suspendida_en, actualizada_en) ON academias TO ${APP}`,
  `GRANT SELECT ON superadmins TO ${APP}`,
  `GRANT UPDATE (intentos_fallidos, bloqueado_hasta, ultimo_acceso, version_token, actualizado_en) ON superadmins TO ${APP}`,
  `GRANT SELECT, INSERT ON auditoria, auditoria_plataforma TO ${APP}`,
  `GRANT SELECT, INSERT, UPDATE ON configuraciones TO ${APP}`,
];

const LIMPIAR_OBJETOS = [
  'DROP VIEW IF EXISTS vista_ronda3',
  'DROP MATERIALIZED VIEW IF EXISTS vista_materializada_ronda3',
  'DROP SEQUENCE IF EXISTS secuencia_ronda3',
  'DROP TABLE IF EXISTS tabla_ronda3',
];

async function restaurar(): Promise<void> {
  for (const sentencia of [...LIMPIAR_OBJETOS, ...RESTAURAR]) await ejecutarComo('propietario', sentencia);
}

interface Caso {
  readonly nombre: string;
  readonly preparar: readonly string[];
  /** Palabras que el registro (log) debe nombrar: la tabla y el privilegio. */
  readonly palabras: readonly string[];
}

const CASOS: Caso[] = [
  {
    nombre: 'TRUNCATE sobre auditoria',
    preparar: [`GRANT TRUNCATE ON auditoria TO ${APP}`],
    palabras: ['auditoria', 'TRUNCATE'],
  },
  {
    nombre: 'DELETE sobre configuraciones',
    preparar: [`GRANT DELETE ON configuraciones TO ${APP}`],
    palabras: ['configuraciones', 'DELETE'],
  },
  {
    nombre: 'UPDATE sobre auditoria_plataforma',
    preparar: [`GRANT UPDATE ON auditoria_plataforma TO ${APP}`],
    palabras: ['auditoria_plataforma', 'UPDATE'],
  },
  {
    nombre: 'UPDATE sobre toda la tabla academias',
    preparar: [`GRANT UPDATE ON academias TO ${APP}`],
    palabras: ['academias', 'UPDATE'],
  },
  {
    nombre: 'UPDATE (nombre_corto) sobre academias',
    preparar: [`GRANT UPDATE (nombre_corto) ON academias TO ${APP}`],
    palabras: ['academias', 'nombre_corto', 'UPDATE'],
  },
  {
    nombre: 'UPDATE (clave_hash) sobre superadmins',
    preparar: [`GRANT UPDATE (clave_hash) ON superadmins TO ${APP}`],
    palabras: ['superadmins', 'clave_hash', 'UPDATE'],
  },
  {
    nombre: 'REFERENCES sobre superadmins',
    preparar: [`GRANT REFERENCES ON superadmins TO ${APP}`],
    palabras: ['superadmins', 'REFERENCES'],
  },
  {
    nombre: 'TRIGGER sobre auditoria',
    preparar: [`GRANT TRIGGER ON auditoria TO ${APP}`],
    palabras: ['auditoria', 'TRIGGER'],
  },
  {
    nombre: 'SELECT sobre _prisma_migrations',
    preparar: [`GRANT SELECT ON _prisma_migrations TO ${APP}`],
    palabras: ['_prisma_migrations', 'SELECT'],
  },
  {
    nombre: 'UPDATE sobre auditoria concedido a PUBLIC',
    preparar: ['GRANT UPDATE ON auditoria TO PUBLIC'],
    palabras: ['auditoria', 'UPDATE'],
  },
  {
    nombre: 'SELECT sobre una tabla nueva que no esta en la lista',
    preparar: ['CREATE TABLE tabla_ronda3 (id int)', `GRANT SELECT ON tabla_ronda3 TO ${APP}`],
    palabras: ['tabla_ronda3', 'SELECT'],
  },
  {
    nombre: 'SELECT sobre una vista',
    preparar: ['CREATE VIEW vista_ronda3 AS SELECT 1 AS n', `GRANT SELECT ON vista_ronda3 TO ${APP}`],
    palabras: ['vista_ronda3', 'SELECT'],
  },
  {
    nombre: 'SELECT sobre una vista materializada',
    preparar: [
      'CREATE MATERIALIZED VIEW vista_materializada_ronda3 AS SELECT 1 AS n',
      `GRANT SELECT ON vista_materializada_ronda3 TO ${APP}`,
    ],
    palabras: ['vista_materializada_ronda3', 'SELECT'],
  },
  {
    nombre: 'USAGE sobre una secuencia',
    preparar: ['CREATE SEQUENCE secuencia_ronda3', `GRANT USAGE ON SEQUENCE secuencia_ronda3 TO ${APP}`],
    palabras: ['secuencia_ronda3', 'USAGE'],
  },
];

describe('criterio 102: la API rechaza un rol con privilegios de tabla de mas', () => {
  let academia: AcademiaDePrueba;
  let registroPendiente = true;
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(restaurar);
  afterAll(restaurar);
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(restaurar);

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

  it.each(CASOS.map((caso) => [caso.nombre, caso] as const))(
    'criterio 102: %s hace que conAcademia, comoPlataforma y resolverAcademia rechacen con ErrorRolBaseDatosInseguro',
    async (_nombre, caso) => {
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
          for (const palabra of caso.palabras) expect(texto, `el registro no nombra ${palabra}`).toContain(palabra);
        }
      }, capturarRegistro);
    },
  );

  it('criterio 102 (control): con los privilegios del criterio 2 y nada mas, la comprobacion pasa', async () => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).resolves.not.toBeInstanceOf(
        ErrorRolBaseDatosInseguro,
      );
    });
  });

  it('criterio 102: POST /api/plataforma/sesion responde 500 ERROR_INTERNO con un privilegio de mas', async () => {
    const { default: request } = await import('supertest');
    await ejecutarComo('propietario', `GRANT TRUNCATE ON auditoria TO ${APP}`);

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/plataforma/sesion')
        .send({ correo: 'alguien@aquagestion.test', clave: 'ClaveCualquiera-1' });

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
    });
  });

  it('criterio 102: GET /api/a/{nombreCorto} responde 500 ERROR_INTERNO con un privilegio de mas', async () => {
    const { default: request } = await import('supertest');
    await ejecutarComo('propietario', `GRANT DELETE ON configuraciones TO ${APP}`);

    await conApi(async (app) => {
      const respuesta = await request(app.getHttpServer()).get(`/api/a/${academia.nombreCorto}`);

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
    });
  });

  it('criterio 102: un privilegio que falta no lo rechaza esta comprobacion (REVOKE SELECT sobre configuraciones)', async () => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    await ejecutarComo('propietario', `REVOKE SELECT ON configuraciones FROM ${APP}`);

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      const error: unknown = await baseDatos
        .comoPlataforma(() => Promise.resolve('si'))
        .then(
          () => undefined,
          (causa: unknown) => causa,
        );

      expect(error).not.toBeInstanceOf(ErrorRolBaseDatosInseguro);
    });
  });

  it('criterio 102: despues de restaurar los privilegios, una API nueva vuelve a atender', async () => {
    await ejecutarComo('propietario', `GRANT TRUNCATE ON auditoria TO ${APP}`);
    await restaurar();

    await conApi(async (app) => {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
    });
  });
});
