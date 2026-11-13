// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { intentar, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado, type PuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 114 (ataque ronda 4; complementa los criterios 85, 92 y 112), parte de integracion. El punto autorizado
// (`backend/src/infraestructura/prisma/index.ts`, precision P-25) exporta `Decimal`, `codigoDeErrorDeBase`,
// `esViolacionDeUnicidad`, `sql`, `join` y `vacio`. Dentro de `conAcademia`:
//   - un fragmento con un valor y otro con `join` devuelven las filas esperadas con los valores como parametros (un valor
//     `'x''; SET ROLE postgres; --'` se guarda tal cual y no cambia el rol);
//   - los fragmentos se aceptan como unico argumento, interpolados en una plantilla de `$queryRaw`/`$executeRaw` y dentro de
//     otro fragmento;
//   - una insercion duplicada en `configuraciones` da `esViolacionDeUnicidad` verdadero y `codigoDeErrorDeBase` '23505'.

describe('criterio 114: el punto autorizado funciona contra la base', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosRonda3;
  let datos: DatosDeAislamiento;
  let punto: PuntoAutorizado;

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    baseDatos = await obtenerBaseDatosRonda3(app);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    punto = await cargarPuntoAutorizado();
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });

  type Cliente = {
    $queryRaw: (...argumentos: unknown[]) => Promise<unknown>;
    $executeRaw: (...argumentos: unknown[]) => Promise<unknown>;
    configuracion: Record<string, (argumentos?: object) => Promise<unknown>>;
  };
  const enB = <T>(trabajo: (cliente: Cliente, B: string) => Promise<T>): Promise<T> =>
    baseDatos.conAcademia(datos.B.id, (tx) => trabajo(tx.cliente as unknown as Cliente, datos.B.id));
  const claves = (filas: unknown): string[] => (filas as { clave: string }[]).map((fila) => fila.clave);

  describe('criterio 114: sql, join y vacio', () => {
    it('criterio 114: un fragmento con un valor, pasado como unico argumento, devuelve las filas esperadas', async () => {
      const filas = await enB((c) =>
        c.$queryRaw(punto.sql`SELECT clave FROM configuraciones WHERE clave = ${'clave_b_1'}`),
      );

      expect(claves(filas)).toEqual(['clave_b_1']);
    });

    it('criterio 114: un fragmento con join de valores devuelve las filas esperadas', async () => {
      const filas = await enB((c) =>
        c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE clave IN (${punto.join(['clave_b_1', 'clave_b_3'])}) ORDER BY clave`,
        ),
      );

      expect(claves(filas)).toEqual(['clave_b_1', 'clave_b_3']);
    });

    it('criterio 114: join une con coma por defecto, con y (AND) y con o (OR)', async () => {
      const filas = await enB(async (c) => {
        const porDefecto = await c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE clave IN (${punto.join(['clave_b_2', 'clave_b_4'], 'coma')}) ORDER BY clave`,
        );
        const condiciones = [punto.sql`clave LIKE ${'clave_b_%'}`, punto.sql`clave <> ${'clave_b_1'}`];
        const conY = await c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE ${punto.join(condiciones, 'y')} ORDER BY clave`,
        );
        const alternativas = [punto.sql`clave = ${'clave_b_1'}`, punto.sql`clave = ${'clave_b_2'}`];
        const conO = await c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE ${punto.join(alternativas, 'o')} ORDER BY clave`,
        );
        const sinCoincidencia = await c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE ${punto.join([punto.sql`clave = ${'clave_b_1'}`, punto.sql`clave = ${'clave_b_2'}`], 'y')}`,
        );
        return { porDefecto, conY, conO, sinCoincidencia };
      });

      expect(claves(filas.porDefecto)).toEqual(['clave_b_2', 'clave_b_4']);
      expect(claves(filas.conY)).toEqual(['clave_b_2', 'clave_b_3', 'clave_b_4']);
      expect(claves(filas.conO)).toEqual(['clave_b_1', 'clave_b_2']);
      expect(claves(filas.sinCoincidencia)).toEqual([]);
    });

    it('criterio 114: un filtro opcional con vacio no agrega nada y con un fragmento agrega la condicion (interpolado en una plantilla)', async () => {
      const resultado = await enB(async (c, B) => {
        const sinFiltro =
          await c.$queryRaw`SELECT clave FROM configuraciones WHERE academia_id = ${B}::uuid ${punto.vacio} ORDER BY clave`;
        const filtro = punto.sql`AND clave >= ${'clave_b_3'}`;
        const conFiltro =
          await c.$queryRaw`SELECT clave FROM configuraciones WHERE academia_id = ${B}::uuid ${filtro} ORDER BY clave`;
        return { sinFiltro, conFiltro };
      });

      expect(claves(resultado.sinFiltro)).toEqual(['clave_b_1', 'clave_b_2', 'clave_b_3', 'clave_b_4']);
      expect(claves(resultado.conFiltro)).toEqual(['clave_b_3', 'clave_b_4']);
    });

    it('criterio 114: los fragmentos se pueden anidar dentro de otro fragmento', async () => {
      const filas = await enB((c) => {
        const interno = punto.sql`clave = ${'clave_b_2'}`;
        const medio = punto.sql`(${interno} OR clave = ${'clave_b_4'})`;
        return c.$queryRaw(punto.sql`SELECT clave FROM configuraciones WHERE ${medio} ORDER BY clave`);
      });

      expect(claves(filas)).toEqual(['clave_b_2', 'clave_b_4']);
    });

    it('criterio 114: = ANY(${lista}::text[]) con un arreglo de valores, y con la lista vacia no devuelve filas', async () => {
      const resultado = await enB(async (c) => {
        const conLista = await c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE clave = ANY(${['clave_b_1', 'clave_b_4']}::text[]) ORDER BY clave`,
        );
        const vacia = await c.$queryRaw(
          punto.sql`SELECT clave FROM configuraciones WHERE clave = ANY(${[] as string[]}::text[]) ORDER BY clave`,
        );
        const enPlantilla =
          await c.$queryRaw`SELECT clave FROM configuraciones WHERE clave = ANY(${['clave_b_2']}::text[])`;
        return { conLista, vacia, enPlantilla };
      });

      expect(claves(resultado.conLista)).toEqual(['clave_b_1', 'clave_b_4']);
      expect(claves(resultado.vacia)).toEqual([]);
      expect(claves(resultado.enPlantilla)).toEqual(['clave_b_2']);
    });

    it('criterio 114: un fragmento como unico argumento de $executeRaw escribe y devuelve la cantidad de filas', async () => {
      const resultado = await enB(async (c, B) => {
        const escrita = await c.$executeRaw(
          punto.sql`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${B}::uuid, ${'p114_fragmento'}, '{}'::jsonb)`,
        );
        const leida = await c.$queryRaw(punto.sql`SELECT clave FROM configuraciones WHERE clave = ${'p114_fragmento'}`);
        return { escrita, leida };
      });

      expect(resultado.escrita).toBe(1);
      expect(claves(resultado.leida)).toEqual(['p114_fragmento']);
    });

    it("criterio 114: un valor 'x''; SET ROLE postgres; --' se guarda tal cual como parametro y no cambia el rol", async () => {
      const peligro = "x'; SET ROLE postgres; --";
      // El texto va en `valor` (jsonb) y no en `clave`: la clave tiene el CHECK `configuraciones_clave_formato`
      // (`^[a-z][a-z0-9_]{0,63}$`) y una clave con comillas o espacios no existe en la base.
      const CLAVE = 'p114_peligro';

      const rol = await enB(async (c, B) => {
        await c.$executeRaw(
          punto.sql`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${B}::uuid, ${CLAVE}, jsonb_build_object('texto', ${peligro}::text))`,
        );
        const guardada = (await c.$queryRaw(
          punto.sql`SELECT valor->>'texto' AS texto FROM configuraciones WHERE clave = ${CLAVE} AND valor->>'texto' = ${peligro}`,
        )) as { texto: string }[];
        const actual = (await c.$queryRaw`SELECT current_user::text AS rol`) as { rol: string }[];
        return { guardada: guardada.map((fila) => fila.texto), rol: actual[0]?.rol };
      });

      expect(rol.guardada).toEqual([peligro]);
      expect(rol.rol).toBe('aquagestion_app');
      const { rows } = await ejecutarComo(
        'propietario',
        "SELECT valor->>'texto' AS texto FROM configuraciones WHERE clave = $1",
        [CLAVE],
        {
          academiaId: datos.B.id,
        },
      );
      expect(rows).toEqual([{ texto: peligro }]);
    });

    it('criterio 114: los valores se pasan como parametros: un Date, un Decimal, un bigint, un booleano y null llegan bien', async () => {
      const instante = new Date('2026-11-12T03:30:00.000Z');

      const fila = await enB(async (c) => {
        const filas = (await c.$queryRaw(
          punto.sql`SELECT ${instante}::timestamptz AS fecha, ${new punto.Decimal('10.50')}::numeric AS monto, ${12n}::bigint AS grande,
            ${true}::boolean AS si, ${null}::text AS nada, ${5}::int AS entero`,
        )) as Record<string, unknown>[];
        return filas[0];
      });

      expect((fila?.['fecha'] as Date).toISOString()).toBe(instante.toISOString());
      expect(new punto.Decimal(fila?.['monto'] as never).equals('10.5')).toBe(true);
      expect(String(fila?.['grande'])).toBe('12');
      expect(fila?.['si']).toBe(true);
      expect(fila?.['nada']).toBeNull();
      expect(fila?.['entero']).toBe(5);
    });

    it('criterio 114: sigue respetando la seguridad por fila (solo filas de B, aunque el fragmento pida otra academia)', async () => {
      const filas = await enB((c) =>
        c.$queryRaw(punto.sql`SELECT clave FROM configuraciones WHERE academia_id = ${datos.A.id}::uuid`),
      );

      expect(claves(filas)).toEqual([]);
    });
  });

  describe('criterio 114: codigoDeErrorDeBase y esViolacionDeUnicidad con errores reales', () => {
    it('criterio 114: una insercion duplicada en configuraciones (por $executeRaw) da esViolacionDeUnicidad verdadero y codigo 23505', async () => {
      const error = await intentar(() =>
        enB(
          (c, B) =>
            c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${B}::uuid, 'clave_b_1', '{}'::jsonb)`,
        ),
      );

      expect(error, 'la insercion duplicada debia fallar').toBeDefined();
      expect(punto.esViolacionDeUnicidad(error)).toBe(true);
      expect(punto.codigoDeErrorDeBase(error)).toBe('23505');
    });

    it('criterio 114: una insercion duplicada por $queryRaw con un fragmento tambien', async () => {
      const error = await intentar(() =>
        enB((c, B) =>
          c.$queryRaw(
            punto.sql`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${B}::uuid, ${'clave_b_2'}, '{}'::jsonb) RETURNING clave`,
          ),
        ),
      );

      expect(punto.esViolacionDeUnicidad(error)).toBe(true);
      expect(punto.codigoDeErrorDeBase(error)).toBe('23505');
    });

    it('criterio 114: una insercion duplicada por un delegado (create) es una violacion de unicidad', async () => {
      const error = await intentar(() =>
        enB(
          (c, B) =>
            c.configuracion['create']?.({ data: { academiaId: B, clave: 'clave_b_1', valor: {} } }) as Promise<unknown>,
        ),
      );

      expect(error, 'el create duplicado debia fallar').toBeDefined();
      expect(punto.esViolacionDeUnicidad(error)).toBe(true);
    });

    it('criterio 114: otro error de la base (RLS, 42501) no es una violacion de unicidad y su codigo es 42501', async () => {
      const error = await intentar(() =>
        enB(
          (c) =>
            c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.A.id}::uuid, 'ajena', '{}'::jsonb)`,
        ),
      );

      expect(error, 'insertar en otra academia debia fallar').toBeDefined();
      expect(punto.esViolacionDeUnicidad(error)).toBe(false);
      expect(punto.codigoDeErrorDeBase(error)).toBe('42501');
    });

    it('criterio 114: un error que no es de la base da null y no es una violacion de unicidad', () => {
      expect(punto.codigoDeErrorDeBase(new Error('otra cosa'))).toBeNull();
      expect(punto.esViolacionDeUnicidad(new Error('otra cosa'))).toBe(false);
    });
  });

  describe('criterio 114: el envoltorio solo convierte en Sql los fragmentos del punto autorizado', () => {
    it('criterio 114: un fragmento de otra clase (un objeto cualquiera) como unico argumento rechaza con TypeError', async () => {
      const error = await intentar(() => enB((c) => c.$queryRaw({ ...punto.sql`SELECT 1` })));

      expect(error).toBeInstanceOf(TypeError);
    });

    it('criterio 114: un fragmento se acepta tambien en $queryRaw interpolado junto con valores comunes', async () => {
      const filas = await enB((c) => {
        const filtro = punto.sql`clave = ${'clave_b_1'}`;
        return c.$queryRaw`SELECT clave FROM configuraciones WHERE academia_id = ${datos.B.id}::uuid AND ${filtro}`;
      });

      expect(claves(filas)).toEqual(['clave_b_1']);
    });
  });
});
