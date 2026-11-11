// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, ejecutarComo, limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import {
  crearDatosDeAislamiento,
  leerAcademias,
  leerAuditoriaDeAcademia,
  leerAuditoriaPlataforma,
  leerSuperadmin,
  type DatosDeAislamiento,
} from '../../utilidades/datos';
import { esperarHasta, obtenerAuditoria } from '../../utilidades/modulos';
import {
  citar,
  nombreDeLaBase,
  obtenerBaseDatosRonda3,
  urlConOpciones,
  type BaseDatosRonda3,
} from '../../utilidades/ronda3';
import { cookieDeSesion } from '../../utilidades/superadmins';

// Criterio 98 (ataque ronda 3, F3; complementa los criterios 72 y 90): `@prisma/adapter-pg` envia las fechas sin desfase y
// descarta el desfase al leerlas, asi que toda transaccion de `BaseDatos` (`conAcademia`, `comoPlataforma` y
// `resolverAcademia`) fija `TimeZone` en `UTC`, local a la transaccion, en la misma primera sentencia que fija el contexto, antes
// de `trabajo`. Con la API en DATABASE_POOL_MAX=1, un RelojFijo en un instante que en America/Lima cae en otro dia
// (2026-11-12T03:30:00.000Z) y cada una de estas condiciones: (a) un `trabajo` anterior ejecuto
// set_config('TimeZone', 'America/Lima', false) y confirmo; (b) DATABASE_URL_APP lleva ?options=-c TimeZone=Pacific/Kiritimati
// (codificado); (c) la base de pruebas tiene ALTER DATABASE ... SET TimeZone = 'America/Lima' (si el dueno puede; si no, se
// omite con aviso; se restaura con RESET):
//   - creada_en, suspendida_en, fecha_hora de auditoria_plataforma y de auditoria, ultimo_acceso y bloqueado_hasta, leidos como
//     dueno con `pg`, coinciden al milisegundo con el instante de RELOJ;
//   - la API los devuelve sin desfase (creadaEn y suspendidaEn en ISO 8601 UTC) y el bloqueo dura exactamente 15 minutos;
//   - un valor que pone la base (SELECT now() con $queryRaw, o una columna con valor por defecto now()) llega como un Date a
//     menos de 5 segundos del instante real.
// El rol de la app con TimeZone propio (ALTER ROLE ... SET) lo rechaza el criterio 103 (configuracion-rol.test.ts).

const AHORA = new Date('2026-11-12T03:30:00.000Z'); // 22:30 del 11/11 en America/Lima
const UN_MINUTO = 60_000;
const QUINCE_MINUTOS = 15 * UN_MINUTO;
const CANAL_SONDA = 'sonda_zona_horaria_prueba';
const MARCA_INICIO_SONDA = '/*sonda-zona-horaria-prueba*/';
const MARCA_FIN_SONDA = '/*fin-sonda-zona-horaria-prueba*/';

interface RespuestaAcademia {
  academia: {
    id: string;
    nombre: string;
    nombreCorto: string;
    estado: string;
    creadaEn: string;
    suspendidaEn: string | null;
  };
}

async function restaurarZonaDeLaBase(): Promise<void> {
  const base = citar(await nombreDeLaBase());
  await ejecutarComo('propietario', `ALTER DATABASE ${base} RESET TimeZone`).catch(() => undefined);
}

async function elDuenoPuedeAlterarLaBase(): Promise<boolean> {
  const base = citar(await nombreDeLaBase());
  try {
    await ejecutarComo('propietario', `ALTER DATABASE ${base} SET TimeZone = 'America/Lima'`);
    return true;
  } catch {
    return false;
  } finally {
    await restaurarZonaDeLaBase();
  }
}

interface Entorno {
  readonly app: NestExpressApplication;
  readonly baseDatos: BaseDatosRonda3;
  readonly reloj: RelojFijo;
  readonly cerrar: () => Promise<void>;
}

interface Variante {
  readonly titulo: string;
  readonly requierePrivilegios?: boolean;
  /** Crea la API con una sola conexion contaminada con una zona horaria distinta de UTC. */
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

const VARIANTES: Variante[] = [
  {
    titulo: "(a) un trabajo anterior ejecuta set_config('TimeZone', 'America/Lima', false) y confirma",
    async preparar() {
      const api = await crearApi();
      await api.baseDatos.comoPlataforma(async (tx) => {
        await tx.cliente.$queryRaw`SELECT set_config('TimeZone', 'America/Lima', false)`;
      });
      return { ...api, cerrar: () => api.app.close() };
    },
  },
  {
    titulo: '(b) DATABASE_URL_APP lleva ?options=-c TimeZone=Pacific/Kiritimati',
    async preparar() {
      const api = await crearApi(urlConOpciones(urlAppPruebas(), '-c TimeZone=Pacific/Kiritimati'));
      return { ...api, cerrar: () => api.app.close() };
    },
  },
  {
    titulo: "(c) la base tiene ALTER DATABASE ... SET TimeZone = 'America/Lima'",
    requierePrivilegios: true,
    async preparar() {
      const base = citar(await nombreDeLaBase());
      await ejecutarComo('propietario', `ALTER DATABASE ${base} SET TimeZone = 'America/Lima'`);
      try {
        const api = await crearApi();
        return {
          ...api,
          cerrar: async () => {
            try {
              await api.app.close();
            } finally {
              await restaurarZonaDeLaBase();
            }
          },
        };
      } catch (error) {
        await restaurarZonaDeLaBase();
        throw error;
      }
    },
  },
];

let puedeAlterarLaBase = false;

beforeAll(async () => {
  await restaurarZonaDeLaBase();
  puedeAlterarLaBase = await elDuenoPuedeAlterarLaBase();
  if (!puedeAlterarLaBase) {
    console.warn(
      '[criterio 98] AVISO: el dueno de la base de pruebas no puede ejecutar ALTER DATABASE ... SET; la variante (c) se omite.',
    );
  }
});
afterAll(restaurarZonaDeLaBase);

// Premisas: la contaminacion que usan las pruebas existe de verdad en PostgreSQL (no dependen de la API).
describe('criterio 98: premisas de la contaminacion (solo PostgreSQL)', () => {
  it("criterio 98: set_config('TimeZone', ..., false) despues de uno local sigue visible en la transaccion siguiente de la conexion", async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('TimeZone', 'UTC', true)");
      await cliente.query("SELECT set_config('TimeZone', 'America/Lima', false)");
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      const { rows } = await cliente.query("SELECT current_setting('TimeZone') AS zona");
      await cliente.query('ROLLBACK');
      return (rows[0] as { zona: string }).zona;
    });

    expect(visto).toBe('America/Lima');
  });

  it('criterio 98: ?options=-c TimeZone=Pacific/Kiritimati deja esa zona en la sesion', async () => {
    const cliente = new pg.Client({
      connectionString: urlConOpciones(urlAppPruebas(), '-c TimeZone=Pacific/Kiritimati'),
    });
    await cliente.connect();
    try {
      const { rows } = await cliente.query("SELECT current_setting('TimeZone') AS zona");

      expect((rows[0] as { zona: string }).zona).toBe('Pacific/Kiritimati');
    } finally {
      await cliente.end();
    }
  });
});

describe.each(VARIANTES)('criterio 98: conexion contaminada $titulo', (variante) => {
  let datos: DatosDeAislamiento;
  let entorno: Entorno | undefined;
  const clave = () => datos.superadmin.clave;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });
  afterEach(async () => {
    await entorno?.cerrar();
    entorno = undefined;
  });

  /** Crea la API de la variante; omite la prueba con aviso si la variante requiere privilegios. */
  async function iniciar(contexto: TestContext): Promise<Entorno> {
    if (variante.requierePrivilegios && !puedeAlterarLaBase) {
      contexto.skip('el dueno de la base no puede ejecutar ALTER DATABASE ... SET');
    }
    entorno = await variante.preparar();
    return entorno;
  }

  const servidor = () => (entorno as Entorno).app.getHttpServer();
  const cookie = () => cookieDeSesion(datos.superadmin, AHORA);

  it('criterio 98: dentro de conAcademia y de comoPlataforma, current_setting(TimeZone) es UTC', async (ctx) => {
    const { baseDatos } = await iniciar(ctx);

    const enAcademia = await baseDatos.conAcademia(datos.B.id, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ zona: string }[]>`SELECT current_setting('TimeZone') AS zona`;
      return filas[0]?.zona;
    });
    const enPlataforma = await baseDatos.comoPlataforma(async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ zona: string }[]>`SELECT current_setting('TimeZone') AS zona`;
      return filas[0]?.zona;
    });

    expect({ enAcademia, enPlataforma }).toEqual({ enAcademia: 'UTC', enPlataforma: 'UTC' });
  });

  it('criterio 98: un valor que pone la base (SELECT now()) llega como un Date a menos de 5 segundos del instante real', async (ctx) => {
    const { baseDatos } = await iniciar(ctx);

    const [enAcademia, enPlataforma] = await Promise.all([
      baseDatos.conAcademia(
        datos.B.id,
        async (tx) => (await tx.cliente.$queryRaw<{ ahora: unknown }[]>`SELECT now() AS ahora`)[0]?.ahora,
      ),
      baseDatos.comoPlataforma(
        async (tx) => (await tx.cliente.$queryRaw<{ ahora: unknown }[]>`SELECT now() AS ahora`)[0]?.ahora,
      ),
    ]);

    for (const ahora of [enAcademia, enPlataforma]) {
      expect(ahora).toBeInstanceOf(Date);
      expect(Math.abs((ahora as Date).getTime() - Date.now())).toBeLessThan(5000);
    }
  });

  it('criterio 98: una columna con valor por defecto now() llega como un Date a menos de 5 segundos del instante real', async (ctx) => {
    const { baseDatos } = await iniciar(ctx);

    const leida = await baseDatos.conAcademia(datos.B.id, async (tx) => {
      await tx.cliente
        .$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'clave_con_defecto', '{}'::jsonb)`;
      const filas = await tx.cliente.$queryRaw<{ actualizado_en: unknown }[]>`
        SELECT actualizado_en FROM configuraciones WHERE clave = 'clave_con_defecto'`;
      return filas[0]?.actualizado_en;
    });

    expect(leida).toBeInstanceOf(Date);
    expect(Math.abs((leida as Date).getTime() - Date.now())).toBeLessThan(5000);
  });

  it('criterio 98: crear una academia guarda creada_en y la fecha_hora de la auditoria en el instante de RELOJ, y la API lo devuelve sin desfase', async (ctx) => {
    await iniciar(ctx);

    const respuesta = await request(servidor())
      .post('/api/plataforma/academias')
      .set('Cookie', cookie())
      .send({ nombre: 'Academia de Natacion Zona', nombreCorto: 'zona-horaria' });

    expect(respuesta.status).toBe(201);
    const academia = (respuesta.body as RespuestaAcademia).academia;
    expect(academia.creadaEn).toBe(AHORA.toISOString());
    const filas = (await leerAcademias()).filter((fila) => fila.nombre_corto === 'zona-horaria');
    expect(filas).toHaveLength(1);
    expect(filas[0]?.creada_en.toISOString()).toBe(AHORA.toISOString());
    const auditoria = await leerAuditoriaPlataforma('ACADEMIA_CREADA');
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.fecha_hora.toISOString()).toBe(AHORA.toISOString());
  });

  it('criterio 98: suspender una academia guarda suspendida_en y la fecha_hora de la auditoria en el instante de RELOJ', async (ctx) => {
    const { reloj } = await iniciar(ctx);
    reloj.avanzar(UN_MINUTO);
    const instante = new Date(AHORA.getTime() + UN_MINUTO);

    const respuesta = await request(servidor())
      .post(`/api/plataforma/academias/${datos.A.id}/suspender`)
      .set('Cookie', cookie())
      .send({ motivo: 'Falta de pago de la mensualidad' });

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as RespuestaAcademia).academia.suspendidaEn).toBe(instante.toISOString());
    const fila = (await leerAcademias()).find((academia) => academia.id === datos.A.id);
    expect(fila?.suspendida_en?.toISOString()).toBe(instante.toISOString());
    const auditoria = await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA');
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.fecha_hora.toISOString()).toBe(instante.toISOString());
  });

  it('criterio 98: registrarEnAcademia y registrarEnPlataforma guardan fecha_hora en el instante de RELOJ', async (ctx) => {
    const { app, baseDatos, reloj } = await iniciar(ctx);
    reloj.avanzar(2 * UN_MINUTO);
    const instante = new Date(AHORA.getTime() + 2 * UN_MINUTO);
    const auditoria = await obtenerAuditoria(app);
    const entrada = { actorTipo: 'SISTEMA' as const, actorId: null, entidad: 'prueba', entidadId: null };

    await baseDatos.conAcademia(datos.B.id, (tx) =>
      auditoria.registrarEnAcademia(tx, {
        ...entrada,
        accion: 'ZONA_ACADEMIA',
      }),
    );
    await baseDatos.comoPlataforma((tx) =>
      auditoria.registrarEnPlataforma(tx as never, { ...entrada, accion: 'ZONA_PLATAFORMA' }),
    );

    const deAcademia = await leerAuditoriaDeAcademia(datos.B.id, 'ZONA_ACADEMIA');
    expect(deAcademia).toHaveLength(1);
    expect(deAcademia[0]?.fecha_hora.toISOString()).toBe(instante.toISOString());
    const deLaPlataforma = await leerAuditoriaPlataforma('ZONA_PLATAFORMA');
    expect(deLaPlataforma).toHaveLength(1);
    expect(deLaPlataforma[0]?.fecha_hora.toISOString()).toBe(instante.toISOString());
  });

  it('criterio 98: un inicio de sesion correcto guarda ultimo_acceso en el instante de RELOJ', async (ctx) => {
    await iniciar(ctx);

    const respuesta = await request(servidor())
      .post('/api/plataforma/sesion')
      .send({ correo: datos.superadmin.correo, clave: clave() });

    expect(respuesta.status).toBe(200);
    const fila = await leerSuperadmin(datos.superadmin.id);
    expect(fila?.ultimo_acceso?.toISOString()).toBe(AHORA.toISOString());
  });

  it('criterio 98: el 5.o fallo guarda bloqueado_hasta = instante + 15 minutos, y el bloqueo dura exactamente 15 minutos', async (ctx) => {
    const { reloj } = await iniciar(ctx);
    const fallar = () =>
      request(servidor())
        .post('/api/plataforma/sesion')
        .send({ correo: datos.superadmin.correo, clave: 'clave-equivocada-123' });
    const entrar = () =>
      request(servidor()).post('/api/plataforma/sesion').send({ correo: datos.superadmin.correo, clave: clave() });

    for (let i = 1; i <= 4; i++) expect((await fallar()).status, `intento ${i}`).toBe(401);
    expect((await fallar()).status).toBe(423);

    const fila = await leerSuperadmin(datos.superadmin.id);
    expect(fila?.bloqueado_hasta?.toISOString()).toBe(new Date(AHORA.getTime() + QUINCE_MINUTOS).toISOString());
    reloj.avanzar(QUINCE_MINUTOS - 1000);
    expect((await entrar()).status, 'a los 14:59 sigue bloqueado').toBe(423);
    reloj.avanzar(1000);
    expect((await entrar()).status, 'a los 15:00 la clave correcta entra').toBe(200);
  });

  describe('resolverAcademia', () => {
    // La sonda reemplaza `resolver_academia` por la misma funcion con un `pg_notify` al comienzo: avisa de la zona horaria que la
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
        `BEGIN ${MARCA_INICIO_SONDA} PERFORM pg_notify('${CANAL_SONDA}', current_setting('TimeZone')); ${MARCA_FIN_SONDA}`,
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

    it('criterio 98: la transaccion de resolverAcademia ya trae TimeZone en UTC antes de llamar a resolver_academia', async (ctx) => {
      const { baseDatos } = await iniciar(ctx);

      await baseDatos.resolverAcademia(datos.A.nombreCorto);
      await esperarHasta(() => notificaciones.length > 0);

      expect(notificaciones.length, 'resolver_academia no se llamo').toBeGreaterThan(0);
      expect(notificaciones).toEqual(notificaciones.map(() => 'UTC'));
    });
  });
});

function escaparParaRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
