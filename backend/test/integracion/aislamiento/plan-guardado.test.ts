// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, insertarConfiguracion, type DatosDeAislamiento } from '../../utilidades/datos';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';

// Criterio 145 (ataque ronda 9, F1; complementa los criterios 22, 72 y 144): un plan guardado en la conexion del pool no lleva la academia
// de otra transaccion. Con la API de pruebas en `DATABASE_POOL_MAX=1` (una sola conexion) y las academias A y B.
// Preparacion, como duenio, restaurando al final tambien si la prueba falla: una fila de `configuraciones` de A y otra de B con la clave
// `prueba_r9_semilla`; una funcion de disparador plpgsql `public.prueba_r9_academias_vistas()`, con EXECUTE revocado a PUBLIC (asi la
// comprobacion del rol, criterio 130, no la cuenta), que, solo cuando `NEW.clave` empieza por `prueba_r9_`, pone en `NEW.valor` el arreglo
// jsonb ordenado de las `academia_id` distintas que ve en `configuraciones` entre las filas cuya clave empieza por `prueba_r9_`; y un
// disparador BEFORE INSERT ... FOR EACH ROW en `configuraciones` que la ejecuta. Entonces, en 12 transacciones seguidas que alternan la academia
// (A, B, A, B, ...), cada una un `conAcademia(X, ...)` que inserta en `configuraciones` una fila con una clave nueva `prueba_r9_<n>` y lee su
// `valor` con RETURNING, en cada una `valor` es exactamente el arreglo con la sola academia X, y `current_setting('app.academia_id', true)`
// dentro de `trabajo` es X; el mensaje de falla nombra el numero de la ejecucion, la academia del contexto y las academias vistas.
//
// Autocomprobacion, como duenio, en una transaccion que se revierte: `ALTER FUNCTION public.app_academia_actual() IMMUTABLE`, y la funcion, el
// disparador y las filas semilla creados dentro de la misma transaccion; si el duenio es superusuario o tiene BYPASSRLS (Docker y CI),
// `SET LOCAL ROLE aquagestion_app` (si no puede, la autocomprobacion se omite con aviso); si no (nube), sigue como duenio, que pasa por RLS por el
// FORCE. Luego las mismas 12 inserciones en la misma conexion, alternando el contexto con `pg_catalog.set_config('app.academia_id', X, true)`: al
// menos una devuelve en `valor` una academia distinta de la del contexto (el mecanismo detecta). Control, en otra transaccion revertida y sin el
// ALTER: ninguna lo hace.

const PREFIJO = 'prueba_r9_';
const EJECUCIONES = 12;
const APP = 'aquagestion_app';

const CREAR_FUNCION = `
CREATE FUNCTION public.prueba_r9_academias_vistas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF starts_with(NEW.clave, '${PREFIJO}') THEN
    NEW.valor := COALESCE(
      (SELECT pg_catalog.jsonb_agg(DISTINCT c.academia_id ORDER BY c.academia_id)
         FROM public.configuraciones c WHERE starts_with(c.clave, '${PREFIJO}')),
      '[]'::jsonb);
  END IF;
  RETURN NEW;
END $$`;
const REVOCAR_EXECUTE = 'REVOKE EXECUTE ON FUNCTION public.prueba_r9_academias_vistas() FROM PUBLIC';
const CREAR_DISPARADOR = `CREATE TRIGGER prueba_r9_academias_vistas BEFORE INSERT ON public.configuraciones
  FOR EACH ROW EXECUTE FUNCTION public.prueba_r9_academias_vistas()`;

const INSERTAR_Y_LEER = `INSERT INTO public.configuraciones (academia_id, clave, valor, actualizado_en)
  VALUES ($1::uuid, $2, '{}'::jsonb, now()) RETURNING valor, pg_catalog.current_setting('app.academia_id', true) AS contexto`;

/** Quita el disparador, la funcion y las filas `prueba_r9_%` (como duenio, con el contexto de cada academia: en la nube el duenio pasa por RLS). */
async function restaurar(academias: readonly string[]): Promise<void> {
  await conClienteComo('propietario', async (cliente) => {
    await cliente.query('DROP TRIGGER IF EXISTS prueba_r9_academias_vistas ON public.configuraciones');
    await cliente.query('DROP FUNCTION IF EXISTS public.prueba_r9_academias_vistas()');
  });
  for (const academiaId of academias) {
    await ejecutarComo('propietario', `DELETE FROM public.configuraciones WHERE starts_with(clave, '${PREFIJO}')`, [], {
      academiaId,
    });
  }
}

/** La academia que corresponde a la ejecucion `n` (1, 2, ...): A, B, A, B, ... */
const academiaDe = (n: number, datos: DatosDeAislamiento): string => (n % 2 === 1 ? datos.A.id : datos.B.id);

const comoLista = (valor: unknown): string[] =>
  (typeof valor === 'string' ? (JSON.parse(valor) as string[]) : (valor as string[])).map((id) => id.toLowerCase());

interface Ejecucion {
  readonly n: number;
  readonly contexto: string;
  readonly vistas: string[];
  readonly contextoDentro: string | null;
}

const mensajeDe = (e: Ejecucion): string =>
  `ejecucion ${e.n}: contexto ${e.contexto}, academias vistas ${JSON.stringify(e.vistas)}`;

describe('criterio 145: un plan guardado en la conexion del pool no lleva la academia de otra transaccion', () => {
  let datos: DatosDeAislamiento;
  let app: NestExpressApplication | undefined;

  beforeEach(async () => {
    // Si una ejecucion anterior murio a medias, el disparador o la funcion pueden seguir ahi: se quitan antes de sembrar.
    await restaurar([]);
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });
  afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
    await restaurar([datos.A.id, datos.B.id]);
  });
  afterAll(async () => {
    await restaurar([]);
  });

  async function prepararEnLaBase(): Promise<void> {
    await insertarConfiguracion(datos.A.id, `${PREFIJO}semilla`);
    await insertarConfiguracion(datos.B.id, `${PREFIJO}semilla`);
    await conClienteComo('propietario', async (cliente) => {
      await cliente.query(CREAR_FUNCION);
      await cliente.query(REVOCAR_EXECUTE);
      await cliente.query(CREAR_DISPARADOR);
    });
  }

  it('criterio 145 (premisa): el disparador de la prueba funciona: una insercion con el contexto de una academia ve solo sus filas', async () => {
    await prepararEnLaBase();

    // Con el rol de la app (sujeto a RLS): el duenio puede ser superusuario (CI y Docker) y entonces se salta RLS y veria A y B.
    const { rows } = await ejecutarComo('app', INSERTAR_Y_LEER, [datos.A.id, `${PREFIJO}premisa`], {
      academiaId: datos.A.id,
    });

    expect(comoLista((rows[0] as { valor: unknown }).valor)).toEqual([datos.A.id]);
  });

  it('criterio 145: en 12 transacciones seguidas que alternan A y B con una sola conexion, cada insercion ve solo la academia de su contexto', async () => {
    await prepararEnLaBase();
    app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '1' } });
    const base: BaseDatosRonda3 = await obtenerBaseDatosRonda3(app);

    const ejecuciones: Ejecucion[] = [];
    for (let n = 1; n <= EJECUCIONES; n++) {
      const contexto = academiaDe(n, datos);
      const fila = await base.conAcademia(contexto, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ valor: unknown; contexto: string | null }[]>`
          INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
          VALUES (${contexto}::uuid, ${`${PREFIJO}${n}`}, '{}'::jsonb, now())
          RETURNING valor, current_setting('app.academia_id', true) AS contexto`;
        return filas[0];
      });
      ejecuciones.push({
        n,
        contexto,
        vistas: comoLista(fila?.valor),
        contextoDentro: fila?.contexto?.toLowerCase() ?? null,
      });
    }

    expect(ejecuciones).toHaveLength(EJECUCIONES);
    for (const ejecucion of ejecuciones) {
      expect(ejecucion.vistas, mensajeDe(ejecucion)).toEqual([ejecucion.contexto]);
      expect(ejecucion.contextoDentro, `${mensajeDe(ejecucion)} (current_setting dentro de trabajo)`).toBe(
        ejecucion.contexto,
      );
    }
  });

  it('criterio 145: el disparador, la funcion y las filas de la prueba se quitan al terminar (restauracion)', async () => {
    await prepararEnLaBase();
    await restaurar([datos.A.id, datos.B.id]);

    const objetos = await conClienteComo(
      'propietario',
      async (cliente) =>
        (
          await cliente.query(
            `SELECT (SELECT count(*)::int FROM pg_catalog.pg_trigger WHERE tgname = 'prueba_r9_academias_vistas') AS disparadores,
                    (SELECT count(*)::int FROM pg_catalog.pg_proc WHERE proname = 'prueba_r9_academias_vistas') AS funciones`,
          )
        ).rows[0] as { disparadores: number; funciones: number },
    );
    const restantes = await Promise.all(
      [datos.A.id, datos.B.id].map(async (academiaId) => {
        const { rows } = await ejecutarComo(
          'propietario',
          `SELECT count(*)::int AS n FROM public.configuraciones WHERE starts_with(clave, '${PREFIJO}')`,
          [],
          { academiaId },
        );
        return (rows[0] as { n: number }).n;
      }),
    );

    expect(objetos).toEqual({ disparadores: 0, funciones: 0 });
    expect(restantes, 'filas prueba_r9_ que quedan en A y en B').toEqual([0, 0]);
  });
});

describe('criterio 145: autocomprobacion, el mecanismo detecta una funcion de contexto IMMUTABLE (como duenio, en una transaccion que se revierte)', () => {
  let datos: DatosDeAislamiento;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });

  /**
   * Como duenio, en una transaccion que se revierte: con o sin `ALTER FUNCTION ... IMMUTABLE`, crea la funcion, el disparador y las filas
   * semilla, y hace las 12 inserciones alternando el contexto con `set_config(..., true)` en la misma conexion. Devuelve `undefined` si el
   * duenio es superusuario o tiene BYPASSRLS y no puede hacer `SET LOCAL ROLE aquagestion_app`.
   */
  async function doceInserciones(inmutable: boolean): Promise<Ejecucion[] | undefined> {
    return conClienteComo('propietario', async (cliente: pg.ClientBase) => {
      await cliente.query('BEGIN');
      try {
        if (inmutable) await cliente.query('ALTER FUNCTION public.app_academia_actual() IMMUTABLE');
        // Las filas semilla, con el contexto de cada academia (en la nube el duenio pasa por RLS por el FORCE).
        for (const academiaId of [datos.A.id, datos.B.id]) {
          await cliente.query("SELECT pg_catalog.set_config('app.academia_id', $1, true)", [academiaId]);
          await cliente.query(
            `INSERT INTO public.configuraciones (academia_id, clave, valor, actualizado_en)
             VALUES ($1::uuid, '${PREFIJO}semilla', '{}'::jsonb, now())`,
            [academiaId],
          );
        }
        await cliente.query(CREAR_FUNCION);
        await cliente.query(REVOCAR_EXECUTE);
        await cliente.query(CREAR_DISPARADOR);
        const { rows } = await cliente.query(
          'SELECT rolsuper OR rolbypassrls AS salta FROM pg_catalog.pg_roles WHERE rolname = current_user',
        );
        if ((rows[0] as { salta: boolean }).salta) {
          await cliente.query('SAVEPOINT cambio_de_rol');
          try {
            await cliente.query(`SET LOCAL ROLE ${APP}`);
          } catch {
            console.warn(
              `[criterio 145] AVISO: el duenio de la base de pruebas es superusuario o tiene BYPASSRLS y no puede hacer SET LOCAL ROLE ${APP}; la autocomprobacion se omite.`,
            );
            return undefined;
          }
        }
        const ejecuciones: Ejecucion[] = [];
        for (let n = 1; n <= EJECUCIONES; n++) {
          const contexto = academiaDe(n, datos);
          await cliente.query("SELECT pg_catalog.set_config('app.academia_id', $1, true)", [contexto]);
          const fila = (await cliente.query(INSERTAR_Y_LEER, [contexto, `${PREFIJO}${n}`])).rows[0] as {
            valor: unknown;
            contexto: string | null;
          };
          ejecuciones.push({
            n,
            contexto,
            vistas: comoLista(fila.valor),
            contextoDentro: fila.contexto?.toLowerCase() ?? null,
          });
        }
        return ejecuciones;
      } finally {
        await cliente.query('ROLLBACK').catch(() => undefined);
      }
    });
  }

  const mezcladas = (ejecuciones: readonly Ejecucion[]): Ejecucion[] =>
    ejecuciones.filter((e) => e.vistas.some((id) => id !== e.contexto));

  it('criterio 145: con app_academia_actual() en IMMUTABLE, al menos una de las 12 inserciones devuelve una academia distinta de la del contexto', async (contexto: TestContext) => {
    const ejecuciones = await doceInserciones(true);
    if (ejecuciones === undefined) contexto.skip('el duenio no puede hacer SET LOCAL ROLE aquagestion_app');

    expect(ejecuciones).toHaveLength(EJECUCIONES);
    const mezcla = mezcladas(ejecuciones ?? []);
    expect(
      mezcla.length,
      `con IMMUTABLE debia verse una academia ajena; lo visto: ${(ejecuciones ?? []).map(mensajeDe).join(' | ')}`,
    ).toBeGreaterThan(0);
  });

  it('criterio 145 (control): sin el ALTER, en otra transaccion revertida, ninguna de las 12 inserciones ve una academia ajena', async (contexto: TestContext) => {
    const ejecuciones = await doceInserciones(false);
    if (ejecuciones === undefined) contexto.skip('el duenio no puede hacer SET LOCAL ROLE aquagestion_app');

    expect(ejecuciones).toHaveLength(EJECUCIONES);
    for (const ejecucion of ejecuciones ?? []) {
      expect(ejecucion.vistas, mensajeDe(ejecucion)).toEqual([ejecucion.contexto]);
    }
  });

  it('criterio 145: lo creado en la autocomprobacion se revirtio (la funcion de contexto sigue STABLE y no queda disparador, funcion ni filas)', async () => {
    await doceInserciones(true);

    const { volatilidad, disparadores, funciones } = await conClienteComo('propietario', async (cliente) => {
      const fila = (
        await cliente.query(
          `SELECT (SELECT p.provolatile::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'app_academia_actual') AS volatilidad,
                  (SELECT count(*)::int FROM pg_catalog.pg_trigger WHERE tgname = 'prueba_r9_academias_vistas') AS disparadores,
                  (SELECT count(*)::int FROM pg_catalog.pg_proc WHERE proname = 'prueba_r9_academias_vistas') AS funciones`,
        )
      ).rows[0] as { volatilidad: string; disparadores: number; funciones: number };
      return fila;
    });

    expect(volatilidad).toBe('s');
    expect(disparadores).toBe(0);
    expect(funciones).toBe(0);
  });
});
