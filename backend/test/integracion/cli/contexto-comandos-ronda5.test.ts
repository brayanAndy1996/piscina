// spec: 001-academias-aislamiento (pruebas protegidas)
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { crearDatosDeAislamiento } from '../../utilidades/datos';
import { urlConOpciones } from '../../utilidades/ronda3';
import {
  RUTA_FIJA,
  borrarTrampa,
  crearTrampa,
  hashDeLaClaveDelAtacante,
  puedeCrearEsquemas,
  sinEspacios,
} from '../../utilidades/ronda5';

// Criterios 121 y 122 (ataque ronda 5), parte de los comandos y la semilla: `enPlataforma` (backend/src/cli/conexion.ts) tambien
// fija, local a la transaccion y en su primera sentencia (con `pg_catalog.set_config`), `search_path = pg_catalog, public, pg_temp`
// y `standard_conforming_strings = on`. Prueba:
//   - 121: con `crearClienteDelDueno(url)` y la URL del dueno con `?options=-c search_path=trampa,pg_catalog,public` (codificado),
//     dentro de `enPlataforma` current_setting('search_path') es el fijo, el contexto de plataforma esta fijado (no se uso la
//     `trampa.set_config` falsa) y `npm run plataforma:superadmin` con esa URL crea el superadmin en `public.superadmins` y no en
//     `trampa.superadmins` (leidos como dueno con `pg`);
//   - 122: con la URL del dueno con `?options=-c standard_conforming_strings=off`, dentro de `enPlataforma` el parametro es `on` y
//     una consulta cuyo texto SQL es `SELECT length('a\b') AS n` devuelve 3.
// Si el dueno de la base de pruebas no puede crear esquemas (el esquema `trampa`), los casos del 121 se omiten con aviso.

const RUTA_TRAMPA = '-c search_path=trampa,pg_catalog,public';
const RUTA_TRAMPA_CON_USER = '-c search_path="$user",trampa,pg_catalog,public';
const CADENAS_APAGADAS = '-c standard_conforming_strings=off';
const CORREO_NUEVO = 'nuevo-ronda5@aquagestion.test';
const CLAVE_NUEVA = 'Clave-Nueva-Ronda5-2026';

let creaEsquemas = false;

describe('criterios 121 y 122: enPlataforma fija search_path y standard_conforming_strings en los comandos y la semilla', () => {
  let cliente: ReturnType<typeof crearClienteDelDueno> | undefined;

  beforeAll(async () => {
    creaEsquemas = await puedeCrearEsquemas();
    if (!creaEsquemas) {
      console.warn(
        '[criterio 121] AVISO: el dueno de la base de pruebas no puede crear esquemas; los casos con el esquema trampa se omiten.',
      );
    }
  });
  afterAll(async () => {
    await borrarTrampa().catch(() => undefined);
  });
  beforeEach(async () => {
    await limpiarBase();
    await crearDatosDeAislamiento();
  });
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
    await borrarTrampa().catch(() => undefined);
  });

  async function prepararTrampa(contexto: TestContext): Promise<void> {
    if (!creaEsquemas) contexto.skip('el dueno de la base de pruebas no puede crear esquemas');
    await crearTrampa(await hashDeLaClaveDelAtacante('Clave-Del-Atacante-Comandos-1'));
  }

  /** Dentro de `enPlataforma`, el `search_path` es el fijo y el contexto de plataforma esta fijado (no se uso la `set_config` falsa). */
  async function comprobarEnPlataforma(contexto: TestContext, opciones: string): Promise<void> {
    await prepararTrampa(contexto);
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), opciones));

    const fila = await enPlataforma(cliente, async (tx) => {
      const filas = await tx.$queryRaw<
        { ruta: string; plataforma: string | null }[]
      >`SELECT current_setting('search_path') AS ruta, current_setting('app.plataforma', true) AS plataforma`;
      return filas[0];
    });

    expect(sinEspacios(fila?.ruta ?? '')).toBe(RUTA_FIJA);
    expect(fila?.plataforma, 'se uso la set_config falsa en vez de pg_catalog.set_config').toBe('si');
  }

  it('criterio 121: dentro de enPlataforma, current_setting(search_path) es pg_catalog, public, pg_temp aunque la URL traiga trampa, pg_catalog, public', async (contexto) => {
    await comprobarEnPlataforma(contexto, RUTA_TRAMPA);
  });

  it('criterio 121: dentro de enPlataforma, current_setting(search_path) es pg_catalog, public, pg_temp aunque la URL traiga "$user", trampa, pg_catalog, public', async (contexto) => {
    await comprobarEnPlataforma(contexto, RUTA_TRAMPA_CON_USER);
  });

  it('criterio 121 (premisa): la URL del dueno contaminada deja la trampa en el search_path de la sesion', async (contexto) => {
    await prepararTrampa(contexto);
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), RUTA_TRAMPA));

    const [fila] = await cliente.$queryRaw<{ ruta: string }[]>`SELECT current_setting('search_path') AS ruta`;

    expect(fila?.ruta).toContain('trampa');
  });

  it('criterio 121: npm run plataforma:superadmin con la URL contaminada crea el superadmin en public.superadmins y no en trampa.superadmins', async (contexto) => {
    await prepararTrampa(contexto);

    const resultado = ejecutarComando('plataforma:superadmin', {
      DATABASE_URL: urlConOpciones(urlPropietarioPruebas(), RUTA_TRAMPA),
      SUPERADMIN_CORREO: CORREO_NUEVO,
      SUPERADMIN_NOMBRE: 'Superadmin de la ronda 5',
      SUPERADMIN_CLAVE: CLAVE_NUEVA,
    });

    expect(resultado.estado, resultado.salida).toBe(0);
    const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`SELECT set_config('app.plataforma', 'si', true)`);
      const enPublic = await cliente.query('SELECT count(*)::int AS n FROM public.superadmins WHERE correo = $1', [
        CORREO_NUEVO,
      ]);
      const enTrampa = await cliente.query('SELECT count(*)::int AS n FROM trampa.superadmins WHERE correo = $1', [
        CORREO_NUEVO,
      ]);
      await cliente.query('ROLLBACK');

      expect((enPublic.rows[0] as { n: number }).n, 'el superadmin no esta en public.superadmins').toBe(1);
      expect((enTrampa.rows[0] as { n: number }).n, 'el superadmin se creo en trampa.superadmins').toBe(0);
    } finally {
      await cliente.end();
    }
  });

  it("criterio 122: dentro de enPlataforma, current_setting('standard_conforming_strings') es on aunque la URL traiga off", async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), CADENAS_APAGADAS));

    const valor = await enPlataforma(cliente, async (tx) => {
      const filas = await tx.$queryRaw<
        { valor: string }[]
      >`SELECT current_setting('standard_conforming_strings') AS valor`;
      return filas[0]?.valor;
    });

    expect(valor).toBe('on');
  });

  it("criterio 122 (premisa): la URL del dueno con off deja standard_conforming_strings en off y length('a\\b') es 2", async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), CADENAS_APAGADAS));

    const [fila] = await cliente.$queryRaw<{ valor: string; n: number }[]>`
      SELECT current_setting('standard_conforming_strings') AS valor, length('a\\b') AS n`;

    expect(fila?.valor).toBe('off');
    expect(Number(fila?.n)).toBe(2);
  });

  it("criterio 122: dentro de enPlataforma, SELECT length('a\\b') (una sola barra invertida en el texto SQL) devuelve 3 aunque la URL traiga off", async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), CADENAS_APAGADAS));

    const n = await enPlataforma(cliente, async (tx) => {
      const filas = await tx.$queryRaw<{ n: number }[]>`SELECT length('a\\b') AS n`;
      return Number(filas[0]?.n);
    });

    expect(n).toBe(3);
  });

  it('criterio 122: el comando plataforma:superadmin funciona con una URL con standard_conforming_strings=off (termina con codigo 0 y crea el superadmin)', async () => {
    const resultado = ejecutarComando('plataforma:superadmin', {
      DATABASE_URL: urlConOpciones(urlPropietarioPruebas(), CADENAS_APAGADAS),
      SUPERADMIN_CORREO: CORREO_NUEVO,
      SUPERADMIN_NOMBRE: 'Superadmin de la ronda 5',
      SUPERADMIN_CLAVE: CLAVE_NUEVA,
    });

    expect(resultado.estado, resultado.salida).toBe(0);
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT count(*)::int AS n FROM superadmins WHERE correo = $1',
      [CORREO_NUEVO],
      { plataforma: true },
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });
});
