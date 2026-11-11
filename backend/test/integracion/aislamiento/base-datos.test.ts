// spec: 001-academias-aislamiento (pruebas protegidas)
import { Controller, Get, Param } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { contarDeAcademia, crearDatosDeAislamiento, insertarAuditoria } from '../../utilidades/datos';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { type BaseDatosPrueba, cargarPrisma, obtenerBaseDatos, uuidInexistente } from '../../utilidades/modulos';

interface Contexto {
  academia: string | null;
  plataforma: string | null;
  pid: number;
}

const LEER_CONTEXTO = `SELECT current_setting('app.academia_id', true) AS academia,
                              current_setting('app.plataforma', true) AS plataforma,
                              pg_backend_pid()::int AS pid`;

const INSERTAR_AUDITORIA = `INSERT INTO auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
  VALUES (gen_random_uuid(), $1::uuid, now(), 'SISTEMA', 'PRUEBA_TX', 'prueba')`;
const INSERTAR_AUDITORIA_PLATAFORMA = `INSERT INTO auditoria_plataforma (id, fecha_hora, actor_tipo, accion, entidad)
  VALUES (gen_random_uuid(), now(), 'SISTEMA', 'PRUEBA_TX', 'prueba')`;

async function contexto(tx: { cliente: { $queryRawUnsafe<T>(sql: string): Promise<T> } }): Promise<Contexto> {
  const filas = await tx.cliente.$queryRawUnsafe<Contexto[]>(LEER_CONTEXTO);
  return filas[0] as Contexto;
}

async function filasDePlataforma(accion: string): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT count(*)::int AS n FROM auditoria_plataforma WHERE accion = $1',
    [accion],
    { plataforma: true },
  );
  return (rows[0] as { n: number }).n;
}

// Criterios 21, 22, 24, 25 y 26 con la configuración normal de la API.
describe('BaseDatos: conAcademia y comoPlataforma', () => {
  let app: NestExpressApplication;
  let appHttp: NestExpressApplication;
  let baseDatos: BaseDatosPrueba;
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;

  beforeAll(async () => {
    app = await crearAppDePruebas();
    baseDatos = await obtenerBaseDatos(app);
    appHttp = await crearAppDePruebas({ controladores: [crearControladorDePrueba(() => baseDatos)] });
  });
  beforeEach(async () => {
    await limpiarBase();
    ({ A, B } = await crearDatosDeAislamiento());
  });
  afterAll(async () => {
    await app.close();
    await appHttp?.close();
  });

  describe('criterio 21: conAcademia fija la academia en una transacción', () => {
    it('criterio 21: app.academia_id es el id de A, app.plataforma no es "si" y tx.academiaId es el id de A', async () => {
      const visto = await baseDatos.conAcademia(A.id, async (tx) => ({
        academiaId: tx.academiaId,
        ...(await contexto(tx)),
      }));

      expect(visto.academiaId).toBe(A.id);
      expect(visto.academia).toBe(A.id);
      expect(visto.plataforma).not.toBe('si');
    });

    it('criterio 21: el trabajo corre dentro de una transacción y el resultado se devuelve tras confirmarla', async () => {
      let visibleDuranteElTrabajo = -1;
      const resultado = await baseDatos.conAcademia(A.id, async (tx) => {
        await tx.cliente.$executeRawUnsafe(INSERTAR_AUDITORIA, A.id);
        visibleDuranteElTrabajo = await contarDeAcademia('auditoria', A.id);
        return 'resultado-del-trabajo';
      });

      expect(resultado).toBe('resultado-del-trabajo');
      // Durante el trabajo, otra conexión no veía la fila nueva (la transacción seguía abierta).
      expect(visibleDuranteElTrabajo).toBe(2);
      // Después de devolver, la fila está confirmada.
      expect(await contarDeAcademia('auditoria', A.id)).toBe(3);
    });

    it('criterio 21: dentro de conAcademia(A) solo se ven las filas de A', async () => {
      const total = await baseDatos.conAcademia(A.id, async (tx) => {
        const filas = await tx.cliente.$queryRawUnsafe<{ academia_id: string }[]>('SELECT academia_id FROM auditoria');
        return filas.map((fila) => fila.academia_id);
      });

      expect(total).toHaveLength(2);
      expect(new Set(total)).toEqual(new Set([A.id]));
      expect(B.id).not.toBe(A.id);
    });
  });

  describe('criterio 22: un error revierte todo', () => {
    it('criterio 22: conAcademia rechaza con el mismo error y no deja las filas insertadas', async () => {
      const error = new Error('falla a propósito');

      await expect(
        baseDatos.conAcademia(A.id, async (tx) => {
          await tx.cliente.$executeRawUnsafe(INSERTAR_AUDITORIA, A.id);
          await tx.cliente.$executeRawUnsafe(
            `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en) VALUES ($1::uuid, 'se_revierte', '{}'::jsonb, now())`,
            A.id,
          );
          throw error;
        }),
      ).rejects.toBe(error);

      expect(await contarDeAcademia('auditoria', A.id)).toBe(2);
      expect(await contarDeAcademia('configuraciones', A.id)).toBe(2);
    });

    it('criterio 22: comoPlataforma rechaza con el mismo error y no deja las filas insertadas', async () => {
      const error = new Error('falla a propósito en la plataforma');

      await expect(
        baseDatos.comoPlataforma(async (tx) => {
          await tx.cliente.$executeRawUnsafe(INSERTAR_AUDITORIA_PLATAFORMA);
          throw error;
        }),
      ).rejects.toBe(error);

      expect(await filasDePlataforma('PRUEBA_TX')).toBe(0);
    });

    it('criterio 22: un error de la base dentro del trabajo también revierte lo anterior', async () => {
      await expect(
        baseDatos.conAcademia(A.id, async (tx) => {
          await tx.cliente.$executeRawUnsafe(INSERTAR_AUDITORIA, A.id);
          await tx.cliente.$executeRawUnsafe(INSERTAR_AUDITORIA, B.id); // viola RLS
        }),
      ).rejects.toBeInstanceOf(Error);

      expect(await contarDeAcademia('auditoria', A.id)).toBe(2);
      expect(await contarDeAcademia('auditoria', B.id)).toBe(3);
    });
  });

  describe('criterio 24: 50 llamadas simultáneas', () => {
    it('criterio 24: cada llamada ve solo filas de su academia y su propio id', async () => {
      const llamadas = Array.from({ length: 50 }, (_, i) => {
        const propia = i % 2 === 0 ? A : B;
        return baseDatos.conAcademia(propia.id, async (tx) => {
          await tx.cliente.$queryRawUnsafe('SELECT 1 AS n FROM pg_sleep(0.01)');
          const filas = await tx.cliente.$queryRawUnsafe<{ academia_id: string }[]>(
            'SELECT academia_id FROM auditoria',
          );
          const { academia } = await contexto(tx);
          return {
            esperada: propia.id,
            academia,
            ids: new Set(filas.map((fila) => fila.academia_id)),
            total: filas.length,
          };
        });
      });

      const resultados = await Promise.all(llamadas);

      expect(resultados).toHaveLength(50);
      for (const resultado of resultados) {
        expect(resultado.academia).toBe(resultado.esperada);
        expect([...resultado.ids]).toEqual([resultado.esperada]);
        expect(resultado.total).toBe(resultado.esperada === A.id ? 2 : 3);
      }
    });
  });

  describe('criterio 25: academias inexistentes o suspendidas', () => {
    it.each(['abc', '', "' OR 1=1", '123', 'g0000000-0000-4000-8000-000000000000', 'null'])(
      'criterio 25: conAcademia(%j) rechaza con ErrorAcademiaNoEncontrada sin ejecutar el trabajo',
      async (id) => {
        const { ErrorAcademiaNoEncontrada } = await cargarPrisma();
        const trabajo = vi.fn(() => Promise.resolve('no'));

        await expect(baseDatos.conAcademia(id, trabajo)).rejects.toBeInstanceOf(ErrorAcademiaNoEncontrada);
        expect(trabajo).not.toHaveBeenCalled();
      },
    );

    it('criterio 25: el UUID de una academia que no existe rechaza con ErrorAcademiaNoEncontrada', async () => {
      const { ErrorAcademiaNoEncontrada } = await cargarPrisma();
      const trabajo = vi.fn(() => Promise.resolve('no'));

      await expect(baseDatos.conAcademia(uuidInexistente(), trabajo)).rejects.toBeInstanceOf(ErrorAcademiaNoEncontrada);
      expect(trabajo).not.toHaveBeenCalled();
    });

    it('criterio 25: una academia suspendida rechaza con ErrorAcademiaSuspendida sin ejecutar el trabajo', async () => {
      const { ErrorAcademiaSuspendida } = await cargarPrisma();
      const suspendida = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });
      const trabajo = vi.fn(() => Promise.resolve('no'));

      await expect(baseDatos.conAcademia(suspendida.id, trabajo)).rejects.toBeInstanceOf(ErrorAcademiaSuspendida);
      expect(trabajo).not.toHaveBeenCalled();
    });

    it('criterio 25: el error llega al filtro como 404 ACADEMIA_NO_ENCONTRADA', async () => {
      const respuesta = await pedirConAcademia(`/api/prueba-academia/${uuidInexistente()}`);

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ACADEMIA_NO_ENCONTRADA');
    });

    it('criterio 25: el UUID mal formado llega al filtro como 404 ACADEMIA_NO_ENCONTRADA', async () => {
      const respuesta = await pedirConAcademia('/api/prueba-academia/abc');

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ACADEMIA_NO_ENCONTRADA');
    });

    it('criterio 25: el error de academia suspendida llega al filtro como 403 ACADEMIA_SUSPENDIDA', async () => {
      const suspendida = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });

      const respuesta = await pedirConAcademia(`/api/prueba-academia/${suspendida.id}`);

      expect(respuesta.status).toBe(403);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ACADEMIA_SUSPENDIDA');
    });

    it('criterio 25: una academia activa responde 200 por el mismo camino (control)', async () => {
      const respuesta = await pedirConAcademia(`/api/prueba-academia/${A.id}`);

      expect(respuesta.status).toBe(200);
    });
  });

  describe('criterio 26: comoPlataforma fija solo la marca de plataforma', () => {
    it('criterio 26: app.plataforma es "si" y app.academia_id está vacío o nulo', async () => {
      const visto = await baseDatos.comoPlataforma((tx) => contexto(tx));

      expect(visto.plataforma).toBe('si');
      expect(visto.academia === null || visto.academia === '').toBe(true);
    });

    it('criterio 26: dentro de comoPlataforma se ven las academias y no los datos internos', async () => {
      const visto = await baseDatos.comoPlataforma(async (tx) => {
        const academias = await tx.cliente.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM academias');
        const auditoria = await tx.cliente.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM auditoria');
        const config = await tx.cliente.$queryRawUnsafe<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM configuraciones',
        );
        return { academias: academias[0]?.n, auditoria: auditoria[0]?.n, configuraciones: config[0]?.n };
      });

      expect(visto).toEqual({ academias: 2, auditoria: 0, configuraciones: 0 });
    });
  });

  describe('criterio 28: BaseDatos no expone el cliente de Prisma', () => {
    it('criterio 28: BaseDatos ofrece los cuatro métodos del contrato y ninguna propiedad pública de Prisma', async () => {
      const { BaseDatos } = await cargarPrisma();

      for (const metodo of ['conAcademia', 'comoPlataforma', 'resolverAcademia', 'comprobarConexion']) {
        expect(typeof (baseDatos as unknown as Record<string, unknown>)[metodo], metodo).toBe('function');
      }
      const nombres = new Set<string>();
      for (let objeto: object | null = BaseDatos.prototype as object; objeto && objeto !== Object.prototype;) {
        for (const nombre of Object.getOwnPropertyNames(objeto)) nombres.add(nombre);
        objeto = Object.getPrototypeOf(objeto) as object | null;
      }
      // El cliente de Prisma ($queryRaw, $transaction, $executeRaw, …) no es parte de lo que BaseDatos ofrece.
      const prohibidos = [...nombres, ...Object.keys(baseDatos)].filter((nombre) => nombre.startsWith('$'));
      expect(prohibidos).toEqual([]);
      for (const prohibido of ['$queryRaw', '$queryRawUnsafe', '$transaction', '$executeRaw', '$connect']) {
        expect(prohibido in baseDatos, prohibido).toBe(false);
      }
    });

    it('criterio 28: comprobarConexion y resolverAcademia funcionan con la configuración normal', async () => {
      await expect(baseDatos.comprobarConexion()).resolves.toBeUndefined();
      await expect(baseDatos.resolverAcademia(A.nombreCorto)).resolves.toEqual({
        id: A.id,
        nombre: A.nombre,
        nombreCorto: A.nombreCorto,
        estado: 'ACTIVA',
      });
      await expect(baseDatos.resolverAcademia('no-existe')).resolves.toBeNull();
    });
  });

  /** Una petición a un controlador de prueba que llama a `conAcademia` con el id de la ruta. */
  function pedirConAcademia(ruta: string) {
    return request(appHttp.getHttpServer()).get(ruta);
  }
});

/** Controlador de prueba: deja que los errores de `conAcademia` lleguen al filtro de errores de la API. */
function crearControladorDePrueba(dar: () => BaseDatosPrueba): new () => unknown {
  @Controller('prueba-academia')
  class ControladorPruebaAcademia {
    @Get(':id')
    async obtener(@Param('id') id: string): Promise<{ ok: boolean }> {
      await dar().conAcademia(id, () => Promise.resolve(undefined));
      return { ok: true };
    }
  }
  return ControladorPruebaAcademia;
}

// Criterio 23: con un solo conector en el pool, el contexto no se filtra de una transacción a la siguiente.
describe('criterio 23: ninguna conexión del pool conserva el contexto', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosPrueba;
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;

  beforeAll(async () => {
    app = await crearAppDePruebas({ variables: { DATABASE_POOL_MAX: '1' } });
    baseDatos = await obtenerBaseDatos(app);
  });
  beforeEach(async () => {
    await limpiarBase();
    ({ A, B } = await crearDatosDeAislamiento());
  });
  afterAll(async () => {
    await app.close();
  });

  it('criterio 23: después de conAcademia(A), comoPlataforma lee app.academia_id vacío o nulo', async () => {
    const dentro = await baseDatos.conAcademia(A.id, (tx) => contexto(tx));
    const despues = await baseDatos.comoPlataforma((tx) => contexto(tx));

    expect(dentro.academia).toBe(A.id);
    expect(despues.pid, 'la prueba exige reutilizar la misma conexión').toBe(dentro.pid);
    expect(despues.academia === null || despues.academia === '').toBe(true);
  });

  it('criterio 23: después de un conAcademia(A) que falla, comoPlataforma lee app.academia_id vacío o nulo', async () => {
    let pidDentro = 0;
    await expect(
      baseDatos.conAcademia(A.id, async (tx) => {
        pidDentro = (await contexto(tx)).pid;
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    const despues = await baseDatos.comoPlataforma((tx) => contexto(tx));

    expect(despues.pid).toBe(pidDentro);
    expect(despues.academia === null || despues.academia === '').toBe(true);
  });

  it('criterio 23: después de comoPlataforma, conAcademia(B) lee app.plataforma distinto de "si"', async () => {
    const dentro = await baseDatos.comoPlataforma((tx) => contexto(tx));
    const despues = await baseDatos.conAcademia(B.id, (tx) => contexto(tx));

    expect(dentro.plataforma).toBe('si');
    expect(despues.pid, 'la prueba exige reutilizar la misma conexión').toBe(dentro.pid);
    expect(despues.plataforma).not.toBe('si');
    expect(despues.academia).toBe(B.id);
  });

  it('criterio 23: después de un comoPlataforma que falla, conAcademia(B) lee app.plataforma distinto de "si"', async () => {
    await expect(
      baseDatos.comoPlataforma(() => {
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    const despues = await baseDatos.conAcademia(B.id, (tx) => contexto(tx));

    expect(despues.plataforma).not.toBe('si');
  });

  it('criterio 23: alternar muchas veces no mezcla los contextos', async () => {
    for (let i = 0; i < 6; i++) {
      const propia = i % 2 === 0 ? A : B;
      const visto = await baseDatos.conAcademia(propia.id, (tx) => contexto(tx));
      expect(visto.academia).toBe(propia.id);
      expect(visto.plataforma).not.toBe('si');
      const plataforma = await baseDatos.comoPlataforma((tx) => contexto(tx));
      expect(plataforma.plataforma).toBe('si');
      expect(plataforma.academia === null || plataforma.academia === '').toBe(true);
    }
    expect(await insertarAuditoria(A.id)).toBeTruthy();
  });
});
