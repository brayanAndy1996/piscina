// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { conClienteComo, ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento } from '../../utilidades/datos';
// (criterio 100) El cliente de `trabajo` ya no tiene `$queryRawUnsafe` ni `$executeRawUnsafe`: el SQL con parametros `$1`
// se ejecuta con `consultar` y `ejecutar` (`$queryRaw`/`$executeRaw` con `Prisma.sql`), sin cambiar lo que se comprueba.
import { type BaseDatosPrueba, consultar, ejecutar, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 72 (ataque ronda 1, F1): cada transaccion fija los dos valores de contexto, aunque la conexion del pool
// venga contaminada con valores de SESION de `app.plataforma` y `app.academia_id`. La API corre con
// DATABASE_POOL_MAX=1: todas las transacciones usan la misma conexion, la contaminada.
//
// La contaminacion se prueba de tres formas: (a) un `trabajo` anterior ejecuta set_config(..., false) y confirma; (b)
// DATABASE_URL_APP lleva `?options=-c app.plataforma=si -c app.academia_id=<id de A>`; (c) la base trae esos valores
// por defecto (`ALTER DATABASE ... SET`), variante que se omite con aviso si el dueno no puede ejecutarla.

const LEER_CONTEXTO = `SELECT current_setting('app.academia_id', true) AS academia,
                              current_setting('app.plataforma', true) AS plataforma`;

interface Contexto {
  academia: string | null;
  plataforma: string | null;
}

const CANAL_SONDA = 'sonda_contexto_prueba';
const MARCA_INICIO_SONDA = '/*sonda-contexto-prueba*/';
const MARCA_FIN_SONDA = '/*fin-sonda-contexto-prueba*/';

/** Texto del error y de sus partes (Prisma deja el codigo de PostgreSQL en el mensaje y en `meta`). */
function textoDelError(error: unknown): string {
  if (error === undefined || error === null) return '';
  if (!(error instanceof Error)) return typeof error === 'string' ? error : JSON.stringify(error);
  const extra = error as { code?: unknown; meta?: unknown };
  const codigo = typeof extra.code === 'string' ? extra.code : '';
  return [error.name, error.message, codigo, JSON.stringify(extra.meta ?? null), textoDelError(error.cause)].join(' ');
}

async function intentar(trabajo: () => Promise<unknown>): Promise<unknown> {
  try {
    await trabajo();
    return undefined;
  } catch (error) {
    return error;
  }
}

async function nombreDeLaBase(): Promise<string> {
  const { rows } = await ejecutarComo('propietario', 'SELECT current_database() AS base');
  return (rows[0] as { base: string }).base;
}

function citar(identificador: string): string {
  return `"${identificador.replaceAll('"', '""')}"`;
}

async function restaurarValoresPorDefectoDeLaBase(): Promise<void> {
  const base = citar(await nombreDeLaBase());
  for (const variable of ['app.plataforma', 'app.academia_id']) {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} RESET ${variable}`).catch(() => undefined);
  }
}

/** Si el dueno de la base de pruebas puede ejecutar `ALTER DATABASE ... SET`, sin dejar rastro. */
async function elDuenoPuedeAlterarLaBase(): Promise<boolean> {
  const base = citar(await nombreDeLaBase());
  try {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} SET app.plataforma = 'si'`);
    await ejecutarComo('propietario', `ALTER DATABASE ${base} SET app.academia_id = '${UUID_DE_SONDEO}'`);
    return true;
  } catch {
    return false;
  } finally {
    await restaurarValoresPorDefectoDeLaBase();
  }
}

interface EntornoDePrueba {
  readonly baseDatos: BaseDatosPrueba;
  readonly cerrar: () => Promise<void>;
}

interface Variante {
  readonly titulo: string;
  /** Crea la API con la conexion unica contaminada con `app.plataforma = si` y `app.academia_id = <id de A>`. */
  readonly preparar: (A: AcademiaDePrueba) => Promise<EntornoDePrueba>;
  readonly requierePrivilegios?: boolean;
}

async function crearApiConUnaConexion(urlApp?: string): Promise<NestExpressApplication> {
  return crearAppDePruebas({
    nivelRegistro: 'silent',
    variables: { DATABASE_POOL_MAX: '1', ...(urlApp ? { DATABASE_URL_APP: urlApp } : {}) },
  });
}

function urlAppConOpciones(academiaId: string): string {
  const opciones = `-c app.plataforma=si -c app.academia_id=${academiaId}`;
  const url = urlAppPruebas();
  return `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(opciones)}`;
}

const VARIANTES: Variante[] = [
  {
    titulo: '(a) un trabajo anterior deja valores de sesion y confirma',
    async preparar(A) {
      const app = await crearApiConUnaConexion();
      const baseDatos = await obtenerBaseDatos(app);
      await baseDatos.comoPlataforma(async (tx) => {
        await consultar(
          tx.cliente,
          `SELECT set_config('app.plataforma', 'si', false), set_config('app.academia_id', $1, false)`,
          A.id,
        );
      });
      return { baseDatos, cerrar: () => app.close() };
    },
  },
  {
    titulo: '(b) DATABASE_URL_APP lleva ?options=-c app.plataforma=si -c app.academia_id=<A>',
    async preparar(A) {
      const app = await crearApiConUnaConexion(urlAppConOpciones(A.id));
      return { baseDatos: await obtenerBaseDatos(app), cerrar: () => app.close() };
    },
  },
  {
    titulo: '(c) la base trae app.plataforma y app.academia_id por defecto (ALTER DATABASE ... SET)',
    requierePrivilegios: true,
    async preparar(A) {
      const base = citar(await nombreDeLaBase());
      await ejecutarComo('propietario', `ALTER DATABASE ${base} SET app.plataforma = 'si'`);
      await ejecutarComo('propietario', `ALTER DATABASE ${base} SET app.academia_id = '${A.id}'`);
      try {
        const app = await crearApiConUnaConexion();
        return {
          baseDatos: await obtenerBaseDatos(app),
          cerrar: async () => {
            try {
              await app.close();
            } finally {
              await restaurarValoresPorDefectoDeLaBase();
            }
          },
        };
      } catch (error) {
        await restaurarValoresPorDefectoDeLaBase();
        throw error;
      }
    },
  },
];

const UUID_DE_SONDEO = '11111111-1111-4111-8111-111111111111';
let puedeAlterarLaBase = false;

beforeAll(async () => {
  // Si una ejecucion anterior murio a medias, la base podria conservar valores por defecto: se limpian primero.
  await restaurarValoresPorDefectoDeLaBase();
  puedeAlterarLaBase = await elDuenoPuedeAlterarLaBase();
  if (!puedeAlterarLaBase) {
    console.warn(
      '[criterio 72] AVISO: el dueno de la base de pruebas no puede ejecutar ALTER DATABASE ... SET; la variante (c) se omite.',
    );
  }
});
afterAll(restaurarValoresPorDefectoDeLaBase);

// Premisas: la contaminacion que usan las pruebas existe de verdad en PostgreSQL (no dependen de la API).
describe('criterio 72: premisas de la contaminacion (solo PostgreSQL)', () => {
  it('criterio 72: set_config(..., false) en una transaccion que confirma sigue visible en la siguiente de la misma conexion', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query(
        `SELECT set_config('app.plataforma', 'si', false), set_config('app.academia_id', 'x', false)`,
      );
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(LEER_CONTEXTO);
      await cliente.query('ROLLBACK');
      return rows[0] as Contexto;
    });

    expect(visto).toEqual({ academia: 'x', plataforma: 'si' });
  });

  it('criterio 72: ?options=-c app.plataforma=si -c app.academia_id=<id> deja esos valores en la sesion', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const cliente = new pg.Client({ connectionString: urlAppConOpciones(id) });
    await cliente.connect();
    try {
      const { rows } = await cliente.query(LEER_CONTEXTO);

      expect(rows[0]).toEqual({ academia: id, plataforma: 'si' });
    } finally {
      await cliente.end();
    }
  });
});

describe.each(VARIANTES)('criterio 72: conexion contaminada $titulo', (variante) => {
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;

  beforeEach(async () => {
    await limpiarBase();
    ({ A, B } = await crearDatosDeAislamiento());
  });

  /** Ejecuta `prueba` con la API de la variante; omite la prueba con aviso si la variante requiere privilegios. */
  async function conVariante(
    contexto: TestContext,
    prueba: (baseDatos: BaseDatosPrueba) => Promise<void>,
  ): Promise<void> {
    if (variante.requierePrivilegios && !puedeAlterarLaBase) {
      contexto.skip('el dueno de la base no puede ejecutar ALTER DATABASE ... SET');
    }
    const entorno = await variante.preparar(A);
    try {
      await prueba(entorno.baseDatos);
    } finally {
      await entorno.cerrar();
    }
  }

  it('criterio 72: dentro de conAcademia(B), app.academia_id es el id de B y app.plataforma es vacio', async (ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const visto = await baseDatos.conAcademia(B.id, async (tx) => {
        const filas = await consultar<Contexto[]>(tx.cliente, LEER_CONTEXTO);
        return filas[0];
      });

      expect(visto).toEqual({ academia: B.id, plataforma: '' });
    });
  });

  it('criterio 72: dentro de conAcademia(B), academias devuelve solo la fila de B', async (ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const ids = await baseDatos.conAcademia(B.id, async (tx) => {
        const filas = await consultar<{ id: string }[]>(tx.cliente, 'SELECT id::text AS id FROM academias');
        return filas.map((fila) => fila.id);
      });

      expect(ids).toEqual([B.id]);
    });
  });

  it('criterio 72: dentro de conAcademia(B), auditoria y configuraciones devuelven solo filas de B', async (ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const vistas = await baseDatos.conAcademia(B.id, async (tx) => {
        const auditoria = await consultar<{ academia_id: string }[]>(
          tx.cliente,
          'SELECT academia_id::text AS academia_id FROM auditoria',
        );
        const configuraciones = await consultar<{ academia_id: string }[]>(
          tx.cliente,
          'SELECT academia_id::text AS academia_id FROM configuraciones',
        );
        return { auditoria, configuraciones };
      });

      expect(vistas.auditoria).toHaveLength(3);
      expect(vistas.configuraciones).toHaveLength(4);
      expect(new Set(vistas.auditoria.map((fila) => fila.academia_id))).toEqual(new Set([B.id]));
      expect(new Set(vistas.configuraciones.map((fila) => fila.academia_id))).toEqual(new Set([B.id]));
    });
  });

  it('criterio 72: dentro de conAcademia(B), superadmins y auditoria_plataforma devuelven 0 filas', async (ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const conteos = await baseDatos.conAcademia(B.id, async (tx) => {
        const [superadmins] = await consultar<{ n: number }[]>(
          tx.cliente,
          'SELECT count(*)::int AS n FROM superadmins',
        );
        const [plataforma] = await consultar<{ n: number }[]>(
          tx.cliente,
          'SELECT count(*)::int AS n FROM auditoria_plataforma',
        );
        return { superadmins: superadmins?.n, plataforma: plataforma?.n };
      });

      expect(conteos).toEqual({ superadmins: 0, plataforma: 0 });
    });
  });

  it('criterio 72: dentro de comoPlataforma, app.academia_id es vacio y app.plataforma es si', async (ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const visto = await baseDatos.comoPlataforma(async (tx) => {
        const filas = await consultar<Contexto[]>(tx.cliente, LEER_CONTEXTO);
        return filas[0];
      });

      expect(visto).toEqual({ academia: '', plataforma: 'si' });
    });
  });

  it('criterio 72: dentro de comoPlataforma, auditoria y configuraciones devuelven 0 filas y las academias siguen visibles', async (ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const conteos = await baseDatos.comoPlataforma(async (tx) => {
        const contar = async (tabla: string) =>
          (await consultar<{ n: number }[]>(tx.cliente, `SELECT count(*)::int AS n FROM ${tabla}`))[0]?.n;
        return {
          auditoria: await contar('auditoria'),
          configuraciones: await contar('configuraciones'),
          academias: await contar('academias'),
          superadmins: await contar('superadmins'),
        };
      });

      expect(conteos).toEqual({ auditoria: 0, configuraciones: 0, academias: 2, superadmins: 1 });
    });
  });

  it.for<[string, string]>([
    [
      'auditoria',
      `INSERT INTO auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
       VALUES (gen_random_uuid(), $1::uuid, now(), 'SISTEMA', 'PRUEBA_CONTAMINADA', 'prueba')`,
    ],
    [
      'configuraciones',
      `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
       VALUES ($1::uuid, 'clave_contaminada', '{}'::jsonb, now())`,
    ],
  ])('criterio 72: dentro de comoPlataforma, INSERT en %s falla con 42501', async ([, insertar], ctx) => {
    await conVariante(ctx, async (baseDatos) => {
      const error = await intentar(() =>
        baseDatos.comoPlataforma(async (tx) => {
          await ejecutar(tx.cliente, insertar, A.id);
        }),
      );

      expect(error, 'el INSERT debio fallar con 42501').toBeDefined();
      expect(textoDelError(error)).toContain('42501');
    });
  });

  describe('criterio 72: resolverAcademia', () => {
    // La sonda reemplaza `resolver_academia` por la misma funcion con un `pg_notify` al comienzo: avisa de los valores
    // de contexto que la API dejo en la transaccion ANTES de que la funcion los cambie. Se restaura al terminar.
    const notificaciones: string[] = [];
    let oyente: pg.Client | undefined;
    let definicionOriginal: string | undefined;

    beforeAll(async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_get_functiondef('public.resolver_academia(text)'::regprocedure) AS definicion`,
      );
      const guardada = (rows[0] as { definicion: string }).definicion;
      // Si una ejecucion anterior dejo la sonda puesta, se quita de la copia que se guarda para restaurar.
      definicionOriginal = guardada.replace(
        new RegExp(`${escaparParaRegExp(MARCA_INICIO_SONDA)}[\\s\\S]*?${escaparParaRegExp(MARCA_FIN_SONDA)}`),
        '',
      );
      const conSonda = definicionOriginal.replace(
        /\bBEGIN\b/i,
        `BEGIN ${MARCA_INICIO_SONDA} PERFORM pg_notify('${CANAL_SONDA}', coalesce(current_setting('app.plataforma', true), '<nulo>') || '|' || coalesce(current_setting('app.academia_id', true), '<nulo>')); ${MARCA_FIN_SONDA}`,
      );
      if (conSonda === definicionOriginal) {
        throw new Error('No se pudo instalar la sonda: la definicion de resolver_academia no tiene BEGIN.');
      }
      await ejecutarComo('propietario', conSonda);

      oyente = new pg.Client({ connectionString: process.env['DATABASE_URL_PRUEBAS'] });
      await oyente.connect();
      oyente.on('notification', (mensaje) => {
        if (mensaje.channel === CANAL_SONDA) notificaciones.push(mensaje.payload ?? '');
      });
      await oyente.query(`LISTEN ${CANAL_SONDA}`);
    });
    afterAll(async () => {
      await oyente?.end().catch(() => undefined);
      if (definicionOriginal) await ejecutarComo('propietario', definicionOriginal);
    });
    beforeEach(() => {
      notificaciones.length = 0;
    });

    it('criterio 72: los dos valores son vacios antes de llamar a resolver_academia', async (ctx) => {
      await conVariante(ctx, async (baseDatos) => {
        await baseDatos.resolverAcademia(A.nombreCorto);
        await esperarHasta(() => notificaciones.length > 0);

        expect(notificaciones.length, 'resolver_academia no se llamo').toBeGreaterThan(0);
        // "<plataforma>|<academia_id>": ambos vacios.
        expect(notificaciones).toEqual(notificaciones.map(() => '|'));
      });
    });

    it('criterio 72: el resultado es el mismo que con una conexion limpia (criterio 20)', async (ctx) => {
      const suspendida = await crearSuspendida();
      await conVariante(ctx, async (baseDatos) => {
        expect(await baseDatos.resolverAcademia(A.nombreCorto)).toEqual({
          id: A.id,
          nombre: A.nombre,
          nombreCorto: A.nombreCorto,
          estado: 'ACTIVA',
        });
        expect(await baseDatos.resolverAcademia(suspendida.nombreCorto)).toEqual({
          id: suspendida.id,
          nombre: suspendida.nombre,
          nombreCorto: suspendida.nombreCorto,
          estado: 'SUSPENDIDA',
        });
        expect(await baseDatos.resolverAcademia('no-existe-ninguna')).toBeNull();
      });
    });
  });
});

function escaparParaRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

async function crearSuspendida(): Promise<AcademiaDePrueba> {
  return crearAcademiaDePrueba({
    nombreCorto: 'academia-suspendida',
    nombre: 'Academia suspendida',
    estado: 'SUSPENDIDA',
  });
}
