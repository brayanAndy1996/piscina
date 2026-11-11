// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, leerAcademias, type DatosDeAislamiento } from '../../utilidades/datos';
import { esperarHasta } from '../../utilidades/modulos';
import {
  citar,
  esperarCondicion,
  nombreDeLaBase,
  obtenerBaseDatosRonda3,
  urlConOpciones,
  type BaseDatosRonda3,
} from '../../utilidades/ronda3';
import { cookieDeSesion } from '../../utilidades/superadmins';

// Criterio 107 (ataque ronda 4, F2; complementa los criterios 72, 90 y 98): el adaptador de Prisma interpreta el texto que
// devuelve PostgreSQL y ese texto depende de la sesion, asi que toda transaccion de `BaseDatos` (`conAcademia`,
// `comoPlataforma` y `resolverAcademia`) fija, local a la transaccion y en la misma primera sentencia que el contexto y
// `TimeZone`, antes de `trabajo`: DateStyle = 'ISO, MDY', IntervalStyle = 'postgres', extra_float_digits = '1' y
// bytea_output = 'hex'. Con la API en DATABASE_POOL_MAX=1, un RelojFijo y cada vía de contaminacion de los cuatro parametros:
//   (a) un `trabajo` anterior en la misma conexion ejecuto set_config(..., false) y confirmo;
//   (b) `options` en DATABASE_URL_APP;
//   (c) ALTER DATABASE <base de pruebas> SET ... (si el dueno puede; si no, se omite con aviso);
//   (d) ALTER ROLE ALL SET ... y ALTER ROLE ALL IN DATABASE <base> SET ... (exigen superusuario: en la nube se omiten con
//       aviso; corren en Docker y en la CI);
//   (e) el archivo de configuracion del servidor, simulado con ALTER SYSTEM SET ... y pg_reload_conf() (solo superusuario);
// cada via se restaura al final (RESET, ALTER SYSTEM RESET y recarga), tambien si la prueba falla. Entonces:
//   - el 5.o intento fallido bloquea y, durante el bloqueo, la clave correcta responde 423 CUENTA_BLOQUEADA (no 200); a los
//     15 minutos de RELOJ, entra;
//   - GET /api/plataforma/academias responde 200 con creadaEn y suspendidaEn iguales a los instantes guardados;
//   - dentro de `trabajo`, SELECT now(), 0.1::float8 y un bytea llegan como un Date valido a menos de 5 segundos del
//     instante real, 0.1 y los bytes 01 02; y current_setting de cada parametro da exactamente los valores fijados.

const AHORA = new Date('2026-11-12T03:30:00.000Z'); // 22:30 del 11/11 en America/Lima
const UN_MINUTO = 60_000;
const QUINCE_MINUTOS = 15 * UN_MINUTO;
const CANAL_SONDA = 'sonda_formato_sesion_prueba';
const MARCA_INICIO_SONDA = '/*sonda-formato-sesion-prueba*/';
const MARCA_FIN_SONDA = '/*fin-sonda-formato-sesion-prueba*/';

const ESPERADOS = { DateStyle: 'ISO, MDY', IntervalStyle: 'postgres', extra_float_digits: '1', bytea_output: 'hex' };
type Parametros = typeof ESPERADOS;
const PARAMETROS = Object.keys(ESPERADOS) as (keyof Parametros)[];
const CONTAMINADOS: Parametros = {
  DateStyle: 'SQL, DMY',
  IntervalStyle: 'iso_8601',
  extra_float_digits: '-15',
  bytea_output: 'escape',
};
const CONTAMINADOS_ALEMAN: Parametros = { ...CONTAMINADOS, DateStyle: 'German' };

const LEER_PARAMETROS = `SELECT current_setting('DateStyle') AS "DateStyle", current_setting('IntervalStyle') AS "IntervalStyle",
  current_setting('extra_float_digits') AS extra_float_digits, current_setting('bytea_output') AS bytea_output`;

interface RespuestaListado {
  academias: { id: string; creadaEn: string; suspendidaEn: string | null }[];
}

interface Entorno {
  readonly app: NestExpressApplication;
  readonly baseDatos: BaseDatosRonda3;
  readonly reloj: RelojFijo;
  readonly cerrar: () => Promise<void>;
}

interface Variante {
  readonly titulo: string;
  readonly requiere?: 'dueno-de-la-base' | 'superusuario';
  /** Deja la contaminacion puesta y crea la API con una sola conexion. Quien la crea restaura en `cerrar`. */
  readonly preparar: () => Promise<Entorno>;
}

async function crearApi(url?: string): Promise<Omit<Entorno, 'cerrar'>> {
  const reloj = new RelojFijo(AHORA);
  const app = await crearAppDePruebas({
    nivelRegistro: 'silent',
    variables: { DATABASE_POOL_MAX: '1', ...(url ? { DATABASE_URL_APP: url } : {}) },
    ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj),
  });
  return { app, baseDatos: await obtenerBaseDatosRonda3(app), reloj };
}

const opcionesDeUrl = (valores: Parametros): string =>
  PARAMETROS.map((nombre) => `-c ${nombre}=${valores[nombre]}`).join(' ');

/** Lo que ve una conexion nueva del rol de la app (sin la URL contaminada): el efecto de la base, el rol o el servidor. */
async function parametrosDeUnaConexionNueva(): Promise<Parametros> {
  return conClienteComo('app', async (cliente) => {
    const { rows } = await cliente.query(LEER_PARAMETROS);
    return rows[0] as Parametros;
  });
}

async function esSuperusuario(): Promise<boolean> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  return (rows[0] as { rolsuper: boolean }).rolsuper;
}

/** Ejecuta una sentencia que no puede ir dentro de un bloque de transaccion (ALTER SYSTEM). */
async function sinTransaccion(sentencia: string): Promise<void> {
  await conClienteComo('propietario', async (cliente) => {
    await cliente.query(sentencia);
  });
}

async function alterarDeLaBase(valores: Parametros): Promise<void> {
  const base = citar(await nombreDeLaBase());
  for (const nombre of PARAMETROS) {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} SET ${nombre} = '${valores[nombre]}'`);
  }
}
async function restaurarDeLaBase(): Promise<void> {
  const base = citar(await nombreDeLaBase());
  for (const nombre of PARAMETROS) {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} RESET ${nombre}`).catch(() => undefined);
  }
}
async function alterarDeTodosLosRoles(valores: Parametros, enLaBase: boolean): Promise<void> {
  const donde = enLaBase ? `IN DATABASE ${citar(await nombreDeLaBase())}` : '';
  for (const nombre of PARAMETROS) {
    await ejecutarComo('propietario', `ALTER ROLE ALL ${donde} SET ${nombre} = '${valores[nombre]}'`);
  }
}
async function restaurarDeTodosLosRoles(enLaBase: boolean): Promise<void> {
  const donde = enLaBase ? `IN DATABASE ${citar(await nombreDeLaBase())}` : '';
  for (const nombre of PARAMETROS) {
    await ejecutarComo('propietario', `ALTER ROLE ALL ${donde} RESET ${nombre}`).catch(() => undefined);
  }
}
async function alterarDelServidor(valores: Parametros): Promise<void> {
  for (const nombre of PARAMETROS) await sinTransaccion(`ALTER SYSTEM SET ${nombre} = '${valores[nombre]}'`);
  await sinTransaccion('SELECT pg_reload_conf()');
}
async function restaurarDelServidor(): Promise<void> {
  for (const nombre of PARAMETROS) await sinTransaccion(`ALTER SYSTEM RESET ${nombre}`).catch(() => undefined);
  await sinTransaccion('SELECT pg_reload_conf()').catch(() => undefined);
}

/** Espera a que una conexion nueva vea `valores` (la recarga del servidor no es instantanea). */
async function esperarAQueSeVea(valores: Parametros): Promise<void> {
  await esperarCondicion(async () => {
    const vistos = await parametrosDeUnaConexionNueva();
    return PARAMETROS.every((nombre) => vistos[nombre].toLowerCase() === valores[nombre].toLowerCase());
  }, 5000);
}

let valoresIniciales: Parametros | undefined;
let puedeAlterarLaBase = false;
let esSuper = false;

/** Quita los restos de una ejecucion anterior que murio a medias (solo si siguen con los valores contaminados). */
async function limpiarRestos(): Promise<void> {
  await restaurarDeLaBase();
  if (esSuper) {
    await restaurarDeTodosLosRoles(true);
    await restaurarDeTodosLosRoles(false);
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT name, setting FROM pg_catalog.pg_settings WHERE lower(name) = ANY($1::text[]) AND source = 'configuration file'`,
      [PARAMETROS.map((nombre) => nombre.toLowerCase())],
    );
    const contaminados = (rows as { name: string; setting: string }[]).filter((fila) =>
      [CONTAMINADOS, CONTAMINADOS_ALEMAN].some((valores) =>
        PARAMETROS.some(
          (nombre) =>
            nombre.toLowerCase() === fila.name.toLowerCase() &&
            valores[nombre].toLowerCase() === fila.setting.toLowerCase(),
        ),
      ),
    );
    if (contaminados.length > 0) await restaurarDelServidor();
  }
}

const VARIANTES: Variante[] = [
  {
    titulo: "(a) un trabajo anterior ejecuta set_config(..., false) con 'SQL, DMY' y confirma",
    async preparar() {
      const api = await crearApi();
      await api.baseDatos.comoPlataforma(async (tx) => {
        await tx.cliente.$queryRaw`SELECT set_config('DateStyle', ${CONTAMINADOS.DateStyle}, false),
          set_config('IntervalStyle', ${CONTAMINADOS.IntervalStyle}, false),
          set_config('extra_float_digits', ${CONTAMINADOS.extra_float_digits}, false),
          set_config('bytea_output', ${CONTAMINADOS.bytea_output}, false)`;
      });
      return { ...api, cerrar: () => api.app.close() };
    },
  },
  {
    titulo: "(a) un trabajo anterior ejecuta set_config('DateStyle', 'German', false) y confirma",
    async preparar() {
      const api = await crearApi();
      await api.baseDatos.comoPlataforma(async (tx) => {
        await tx.cliente.$queryRaw`SELECT set_config('DateStyle', ${CONTAMINADOS_ALEMAN.DateStyle}, false),
          set_config('IntervalStyle', ${CONTAMINADOS_ALEMAN.IntervalStyle}, false),
          set_config('extra_float_digits', ${CONTAMINADOS_ALEMAN.extra_float_digits}, false),
          set_config('bytea_output', ${CONTAMINADOS_ALEMAN.bytea_output}, false)`;
      });
      return { ...api, cerrar: () => api.app.close() };
    },
  },
  {
    titulo: '(b) DATABASE_URL_APP lleva ?options=-c DateStyle=German -c IntervalStyle=iso_8601 …',
    async preparar() {
      const api = await crearApi(urlConOpciones(urlAppPruebas(), opcionesDeUrl(CONTAMINADOS_ALEMAN)));
      return { ...api, cerrar: () => api.app.close() };
    },
  },
  {
    titulo: '(c) la base tiene ALTER DATABASE ... SET DateStyle, IntervalStyle, extra_float_digits y bytea_output',
    requiere: 'dueno-de-la-base',
    async preparar() {
      await alterarDeLaBase(CONTAMINADOS);
      try {
        const api = await crearApi();
        return {
          ...api,
          cerrar: async () => {
            try {
              await api.app.close();
            } finally {
              await restaurarDeLaBase();
            }
          },
        };
      } catch (error) {
        await restaurarDeLaBase();
        throw error;
      }
    },
  },
  {
    titulo: '(d) ALTER ROLE ALL SET ...',
    requiere: 'superusuario',
    async preparar() {
      await alterarDeTodosLosRoles(CONTAMINADOS, false);
      try {
        const api = await crearApi();
        return {
          ...api,
          cerrar: async () => {
            try {
              await api.app.close();
            } finally {
              await restaurarDeTodosLosRoles(false);
            }
          },
        };
      } catch (error) {
        await restaurarDeTodosLosRoles(false);
        throw error;
      }
    },
  },
  {
    titulo: '(d) ALTER ROLE ALL IN DATABASE <base> SET ...',
    requiere: 'superusuario',
    async preparar() {
      await alterarDeTodosLosRoles(CONTAMINADOS, true);
      try {
        const api = await crearApi();
        return {
          ...api,
          cerrar: async () => {
            try {
              await api.app.close();
            } finally {
              await restaurarDeTodosLosRoles(true);
            }
          },
        };
      } catch (error) {
        await restaurarDeTodosLosRoles(true);
        throw error;
      }
    },
  },
  {
    titulo: '(e) el archivo de configuracion del servidor (ALTER SYSTEM SET ... y pg_reload_conf())',
    requiere: 'superusuario',
    async preparar() {
      try {
        await alterarDelServidor(CONTAMINADOS);
        await esperarAQueSeVea(CONTAMINADOS);
        const api = await crearApi();
        return {
          ...api,
          cerrar: async () => {
            try {
              await api.app.close();
            } finally {
              await restaurarDelServidor();
              if (valoresIniciales) await esperarAQueSeVea(valoresIniciales);
            }
          },
        };
      } catch (error) {
        await restaurarDelServidor();
        throw error;
      }
    },
  },
];

beforeAll(async () => {
  esSuper = await esSuperusuario();
  // Si una ejecucion anterior murio a medias, se quitan primero los restos (antes de leer los valores de referencia).
  await limpiarRestos();
  valoresIniciales = await parametrosDeUnaConexionNueva();
  try {
    await alterarDeLaBase(CONTAMINADOS);
    puedeAlterarLaBase = true;
  } catch {
    puedeAlterarLaBase = false;
  } finally {
    await restaurarDeLaBase();
  }
  if (!puedeAlterarLaBase) {
    console.warn(
      '[criterio 107] AVISO: el dueno de la base de pruebas no puede ejecutar ALTER DATABASE ... SET; la variante (c) se omite.',
    );
  }
  if (!esSuper) {
    console.warn(
      '[criterio 107] AVISO: el dueno de la base de pruebas no es superusuario (nube); las variantes (d) ALTER ROLE ALL y (e) ALTER SYSTEM se omiten. Corren en Docker y en la CI.',
    );
  }
});
afterAll(limpiarRestos);

// Premisas: la contaminacion que usan las pruebas existe de verdad en PostgreSQL (no dependen de la API).
describe('criterio 107: premisas de la contaminacion (solo PostgreSQL)', () => {
  it('criterio 107: set_config(..., false) en una transaccion que confirma sigue visible en la siguiente de la misma conexion', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query(
        `SELECT set_config('DateStyle', 'SQL, DMY', false), set_config('IntervalStyle', 'iso_8601', false),
                set_config('extra_float_digits', '-15', false), set_config('bytea_output', 'escape', false)`,
      );
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(LEER_PARAMETROS);
      await cliente.query('ROLLBACK');
      return rows[0] as Parametros;
    });

    expect(visto).toEqual({ ...CONTAMINADOS, DateStyle: 'SQL, DMY' });
  });

  it('criterio 107: ?options=-c DateStyle=German -c IntervalStyle=iso_8601 … deja esos valores en la sesion', async () => {
    const cliente = new pg.Client({
      connectionString: urlConOpciones(urlAppPruebas(), opcionesDeUrl(CONTAMINADOS_ALEMAN)),
    });
    await cliente.connect();
    try {
      const { rows } = await cliente.query(LEER_PARAMETROS);

      expect(rows[0]).toEqual({ ...CONTAMINADOS_ALEMAN, DateStyle: 'German, DMY' });
    } finally {
      await cliente.end();
    }
  });
});

describe.each(VARIANTES)('criterio 107: conexion contaminada $titulo', (variante) => {
  let datos: DatosDeAislamiento;
  let suspendidaId: string;
  let instantesGuardados: Map<string, { creada: string; suspendida: string | null }>;
  let entorno: Entorno | undefined;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
    suspendidaId = (await crearAcademiaDePrueba({ nombreCorto: 'suspendida-formato', estado: 'SUSPENDIDA' })).id;
    // Los instantes guardados se leen ANTES de contaminar, con el formato normal.
    instantesGuardados = new Map(
      (await leerAcademias()).map((fila) => [
        fila.id,
        { creada: fila.creada_en.toISOString(), suspendida: fila.suspendida_en?.toISOString() ?? null },
      ]),
    );
  });
  afterEach(async () => {
    await entorno?.cerrar();
    entorno = undefined;
  });

  /** Crea la API de la variante; omite la prueba con aviso si la variante requiere privilegios que no hay. */
  async function iniciar(contexto: TestContext): Promise<Entorno> {
    if (variante.requiere === 'dueno-de-la-base' && !puedeAlterarLaBase) {
      contexto.skip('el dueno de la base no puede ejecutar ALTER DATABASE ... SET');
    }
    if (variante.requiere === 'superusuario' && !esSuper) {
      contexto.skip('exige superusuario (ALTER ROLE ALL / ALTER SYSTEM): corre en Docker y en la CI');
    }
    entorno = await variante.preparar();
    if (variante.requiere !== undefined) {
      // Premisa de la variante: una conexion nueva del rol de la app ya ve la contaminacion.
      expect(await parametrosDeUnaConexionNueva(), 'la contaminacion no esta activa').toEqual(
        expect.objectContaining({ bytea_output: 'escape', extra_float_digits: '-15' }),
      );
    }
    return entorno;
  }

  const servidor = () => (entorno as Entorno).app.getHttpServer();
  const cookie = () => cookieDeSesion(datos.superadmin, AHORA);

  it('criterio 107: dentro de conAcademia y de comoPlataforma, current_setting de los cuatro parametros da exactamente los valores fijados', async (ctx) => {
    const { baseDatos } = await iniciar(ctx);

    const enAcademia = await baseDatos.conAcademia(datos.B.id, async (tx) => {
      return (
        await tx.cliente.$queryRaw<Parametros[]>`SELECT current_setting('DateStyle') AS "DateStyle",
        current_setting('IntervalStyle') AS "IntervalStyle", current_setting('extra_float_digits') AS extra_float_digits,
        current_setting('bytea_output') AS bytea_output`
      )[0];
    });
    const enPlataforma = await baseDatos.comoPlataforma(async (tx) => {
      return (
        await tx.cliente.$queryRaw<Parametros[]>`SELECT current_setting('DateStyle') AS "DateStyle",
        current_setting('IntervalStyle') AS "IntervalStyle", current_setting('extra_float_digits') AS extra_float_digits,
        current_setting('bytea_output') AS bytea_output`
      )[0];
    });

    expect(enAcademia).toEqual(ESPERADOS);
    expect(enPlataforma).toEqual(ESPERADOS);
  });

  it('criterio 107: el 5.o intento fallido bloquea, durante el bloqueo la clave correcta responde 423 (no 200) y a los 15 minutos entra', async (ctx) => {
    const { reloj } = await iniciar(ctx);
    const fallar = () =>
      request(servidor())
        .post('/api/plataforma/sesion')
        .send({ correo: datos.superadmin.correo, clave: 'clave-equivocada-123' });
    const entrar = () =>
      request(servidor())
        .post('/api/plataforma/sesion')
        .send({ correo: datos.superadmin.correo, clave: datos.superadmin.clave });

    for (let i = 1; i <= 4; i++) expect((await fallar()).status, `intento ${i}`).toBe(401);
    expect((await fallar()).status, '5.o intento').toBe(423);

    const durante = await entrar();
    expect(durante.status, 'la clave correcta durante el bloqueo no debe entrar').toBe(423);
    expect((durante.body as { codigo: string }).codigo).toBe('CUENTA_BLOQUEADA');
    expect(durante.headers['set-cookie'], 'durante el bloqueo no hay cookie').toBeUndefined();
    reloj.avanzar(QUINCE_MINUTOS - 1000);
    expect((await entrar()).status, 'a los 14:59 sigue bloqueado').toBe(423);
    reloj.avanzar(1000);
    expect((await entrar()).status, 'a los 15:00 la clave correcta entra').toBe(200);
  });

  it('criterio 107: GET /api/plataforma/academias responde 200 con creadaEn y suspendidaEn iguales a los instantes guardados', async (ctx) => {
    await iniciar(ctx);

    const respuesta = await request(servidor()).get('/api/plataforma/academias').set('Cookie', cookie());

    expect(respuesta.status).toBe(200);
    const academias = (respuesta.body as RespuestaListado).academias;
    expect(academias.map((academia) => academia.id).sort()).toEqual([datos.A.id, datos.B.id, suspendidaId].sort());
    for (const academia of academias) {
      const guardados = instantesGuardados.get(academia.id);
      expect(academia.creadaEn, `creadaEn de ${academia.id}`).toBe(guardados?.creada);
      expect(academia.suspendidaEn, `suspendidaEn de ${academia.id}`).toBe(guardados?.suspendida);
    }
    expect(academias.find((academia) => academia.id === suspendidaId)?.suspendidaEn).not.toBeNull();
  });

  it('criterio 107: SELECT now(), 0.1::float8 y un bytea llegan como un Date valido, 0.1 y los bytes 01 02', async (ctx) => {
    const { baseDatos } = await iniciar(ctx);

    const [enAcademia, enPlataforma] = await Promise.all([
      baseDatos.conAcademia(datos.B.id, async (tx) => {
        const filas = await tx.cliente.$queryRaw<
          { ahora: unknown; decimal: unknown; tercio: unknown; bytes: unknown }[]
        >`SELECT now() AS ahora, 0.1::float8 AS decimal, (1::float8 / 3) AS tercio, decode('0102', 'hex') AS bytes`;
        return filas[0];
      }),
      baseDatos.comoPlataforma(async (tx) => {
        const filas = await tx.cliente.$queryRaw<
          { ahora: unknown; decimal: unknown; tercio: unknown; bytes: unknown }[]
        >`SELECT now() AS ahora, 0.1::float8 AS decimal, (1::float8 / 3) AS tercio, decode('0102', 'hex') AS bytes`;
        return filas[0];
      }),
    ]);

    for (const fila of [enAcademia, enPlataforma]) {
      expect(fila?.ahora).toBeInstanceOf(Date);
      expect(Math.abs((fila?.ahora as Date).getTime() - Date.now())).toBeLessThan(5000);
      expect(fila?.decimal).toBe(0.1);
      // Con extra_float_digits = -15 solo llegaria "0.3": el valor exacto confirma que se lee sin perdida.
      expect(fila?.tercio).toBe(1 / 3);
      expect(Array.from(fila?.bytes as Uint8Array)).toEqual([1, 2]);
    }
  });

  describe('resolverAcademia', () => {
    // La sonda reemplaza `resolver_academia` por la misma funcion con un `pg_notify` al comienzo: avisa de los valores que la
    // API dejo en la transaccion ANTES de que la funcion haga nada. Se restaura al terminar.
    const notificaciones: string[] = [];
    let oyente: pg.Client | undefined;
    let definicionOriginal: string | undefined;

    beforeEach(async () => {
      notificaciones.length = 0;
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_get_functiondef('public.resolver_academia(text)'::regprocedure) AS definicion`,
      );
      const guardada = (rows[0] as { definicion: string }).definicion;
      definicionOriginal = guardada.replace(
        new RegExp(`${escaparParaRegExp(MARCA_INICIO_SONDA)}[\\s\\S]*?${escaparParaRegExp(MARCA_FIN_SONDA)}`),
        '',
      );
      const conSonda = definicionOriginal.replace(
        /\bBEGIN\b/i,
        `BEGIN ${MARCA_INICIO_SONDA} PERFORM pg_notify('${CANAL_SONDA}', current_setting('DateStyle') || '|' || current_setting('IntervalStyle') || '|' || current_setting('extra_float_digits') || '|' || current_setting('bytea_output')); ${MARCA_FIN_SONDA}`,
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
    afterEach(async () => {
      await oyente?.end().catch(() => undefined);
      oyente = undefined;
      if (definicionOriginal) await ejecutarComo('propietario', definicionOriginal);
    });

    it('criterio 107: la transaccion de resolverAcademia ya trae los cuatro parametros fijados antes de llamar a resolver_academia', async (ctx) => {
      const { baseDatos } = await iniciar(ctx);

      await baseDatos.resolverAcademia(datos.A.nombreCorto);
      await esperarHasta(() => notificaciones.length > 0);

      expect(notificaciones.length, 'resolver_academia no se llamo').toBeGreaterThan(0);
      const esperado = PARAMETROS.map((nombre) => ESPERADOS[nombre]).join('|');
      expect(notificaciones).toEqual(notificaciones.map(() => esperado));
    });
  });
});

function escaparParaRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
