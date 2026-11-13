// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  conTransaccionRevertida,
  type Contexto,
  ejecutarComo,
  limpiarBase,
  tablasDelNegocio,
} from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';

const INSERTAR_AUDITORIA = `INSERT INTO auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
  VALUES (gen_random_uuid(), $1::uuid, now(), 'SISTEMA', 'PRUEBA_RLS', 'prueba')`;
const INSERTAR_CONFIGURACION = `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
  VALUES ($1::uuid, $2, '{}'::jsonb, now())`;
const INSERTAR_ACADEMIA = `INSERT INTO academias (id, nombre, nombre_corto, creada_en, actualizada_en)
  VALUES (gen_random_uuid(), 'Academia nueva', $1, now(), now())`;
const INSERTAR_AUDITORIA_PLATAFORMA = `INSERT INTO auditoria_plataforma (id, fecha_hora, actor_tipo, accion, entidad)
  VALUES (gen_random_uuid(), now(), 'SISTEMA', 'PRUEBA_RLS', 'prueba')`;

const TABLAS_DE_LA_001 = ['academias', 'auditoria', 'auditoria_plataforma', 'configuraciones', 'superadmins'];

let datos: DatosDeAislamiento;

async function contar(tabla: string, contexto?: Contexto, filtro = ''): Promise<number> {
  const { rows } = await ejecutarComo('app', `SELECT count(*)::int AS n FROM "${tabla}" ${filtro}`, [], contexto);
  return (rows[0] as { n: number }).n;
}

beforeAll(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});

// Criterio 13: sin contexto, o con un contexto vacío o que no es exactamente "si", no se ve ni se escribe nada.
describe('criterio 13: sin contexto, la app no ve ni escribe nada', () => {
  const SIN_CONTEXTO: [string, () => Contexto | undefined][] = [
    ['sin contexto', () => undefined],
    ['app.academia_id vacío', () => ({ academiaId: '' })],
    ['app.plataforma vacío', () => ({ plataforma: '' })],
    ['app.academia_id y app.plataforma vacíos', () => ({ academiaId: '', plataforma: '' })],
    ['app.plataforma igual a "no"', () => ({ plataforma: 'no' })],
    ['app.plataforma igual a "SI" (mayúsculas)', () => ({ plataforma: 'SI' })],
    ['app.plataforma igual a "si " (con espacio)', () => ({ plataforma: 'si ' })],
    ['app.plataforma igual a "true"', () => ({ plataforma: 'true' })],
  ];

  it('criterio 13: hay datos, y las cinco tablas de la 001 existen', async () => {
    expect(await tablasDelNegocio()).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
    const { rows } = await ejecutarComo('propietario', 'SELECT count(*)::int AS n FROM auditoria_plataforma', [], {
      plataforma: true,
    });
    expect((rows[0] as { n: number }).n).toBe(2);
    expect(await contar('auditoria', { academiaId: datos.A.id })).toBe(datos.filas.auditoriaA);
  });

  describe.each(SIN_CONTEXTO)('%s', (_nombre, contexto) => {
    it('criterio 13: SELECT sobre cada tabla de public devuelve 0 filas', async () => {
      const tablas = await tablasDelNegocio();
      expect(tablas).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
      for (const tabla of tablas) {
        expect(await contar(tabla, contexto()), `filas visibles en ${tabla}`).toBe(0);
      }
    });

    it('criterio 13: INSERT en auditoria y en configuraciones falla con 42501', async () => {
      await expect(ejecutarComo('app', INSERTAR_AUDITORIA, [datos.A.id], contexto())).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        ejecutarComo('app', INSERTAR_CONFIGURACION, [datos.A.id, 'clave_nueva'], contexto()),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('criterio 13: INSERT en academias y en auditoria_plataforma falla con 42501', async () => {
      await expect(ejecutarComo('app', INSERTAR_ACADEMIA, ['intrusa'], contexto())).rejects.toMatchObject({
        code: '42501',
      });
      await expect(ejecutarComo('app', INSERTAR_AUDITORIA_PLATAFORMA, [], contexto())).rejects.toMatchObject({
        code: '42501',
      });
    });

    it('criterio 13: UPDATE afecta 0 filas', async () => {
      const configuraciones = await ejecutarComo(
        'app',
        "UPDATE configuraciones SET valor = '1'::jsonb",
        [],
        contexto(),
      );
      const academias = await ejecutarComo('app', "UPDATE academias SET estado = 'SUSPENDIDA'", [], contexto());
      const superadmins = await ejecutarComo('app', 'UPDATE superadmins SET intentos_fallidos = 9', [], contexto());
      expect([configuraciones.rowCount, academias.rowCount, superadmins.rowCount]).toEqual([0, 0, 0]);
    });
  });

  it('criterio 13: nada cambió en los datos después de los intentos', async () => {
    expect(await contar('configuraciones', { academiaId: datos.A.id })).toBe(datos.filas.configuracionesA);
    const { rows } = await ejecutarComo('propietario', 'SELECT estado::text AS estado FROM academias', [], {
      plataforma: true,
    });
    expect((rows as { estado: string }[]).every((fila) => fila.estado === 'ACTIVA')).toBe(true);
  });
});

// Criterio 14: un id de academia que no es un UUID, o que no existe, nunca muestra filas de alguna academia.
describe('criterio 14: academia_id inválido o inexistente', () => {
  const INVALIDOS = ['abc', "' OR 1=1", "'; DROP TABLE auditoria; --", 'x'.repeat(200), randomUUID()];

  it.each(INVALIDOS)('criterio 14: con app.academia_id = %j cada consulta falla o devuelve 0 filas', async (valor) => {
    const tablas = await tablasDelNegocio();
    expect(tablas).toEqual(expect.arrayContaining(TABLAS_DE_LA_001));
    for (const tabla of tablas) {
      try {
        expect(await contar(tabla, { academiaId: valor }), `filas visibles en ${tabla}`).toBe(0);
      } catch (error) {
        // Un error de conversión de UUID también es un resultado aceptable (nunca filas de alguna academia).
        expect(error, `${tabla} con app.academia_id inválido`).toBeInstanceOf(Error);
        expect((error as { code?: string }).code, `${tabla}: el error no vino de PostgreSQL`).toMatch(/^[0-9A-Z]{5}$/);
      }
    }
  });

  it('criterio 14: con un id inválido, INSERT y UPDATE tampoco funcionan', async () => {
    for (const valor of ['abc', randomUUID()]) {
      await expect(ejecutarComo('app', INSERTAR_AUDITORIA, [datos.A.id], { academiaId: valor })).rejects.toBeInstanceOf(
        Error,
      );
      const resultado = await ejecutarComo('app', "UPDATE configuraciones SET valor = '1'::jsonb", [], {
        academiaId: randomUUID(),
      });
      expect(resultado.rowCount).toBe(0);
    }
  });
});

// Criterio 15: contexto de la academia A.
describe('criterio 15: en contexto de la academia A solo se ven los datos de A', () => {
  it('criterio 15: auditoria devuelve solo filas de A y el total coincide', async () => {
    const { rows } = await ejecutarComo('app', 'SELECT academia_id FROM auditoria', [], { academiaId: datos.A.id });
    expect(rows).toHaveLength(datos.filas.auditoriaA);
    expect((rows as { academia_id: string }[]).every((fila) => fila.academia_id === datos.A.id)).toBe(true);
  });

  it('criterio 15: configuraciones devuelve solo filas de A y el total coincide', async () => {
    const { rows } = await ejecutarComo('app', 'SELECT academia_id FROM configuraciones', [], {
      academiaId: datos.A.id,
    });
    expect(rows).toHaveLength(datos.filas.configuracionesA);
    expect((rows as { academia_id: string }[]).every((fila) => fila.academia_id === datos.A.id)).toBe(true);
  });

  it('criterio 15: lo mismo para B (los totales de A y B son distintos a propósito)', async () => {
    expect(await contar('auditoria', { academiaId: datos.B.id })).toBe(datos.filas.auditoriaB);
    expect(await contar('configuraciones', { academiaId: datos.B.id })).toBe(datos.filas.configuracionesB);
    expect(datos.filas.auditoriaA).not.toBe(datos.filas.auditoriaB);
  });

  it('criterio 15: academias devuelve solo la fila de A', async () => {
    const { rows } = await ejecutarComo('app', 'SELECT id FROM academias', [], { academiaId: datos.A.id });
    expect(rows).toEqual([{ id: datos.A.id }]);
  });

  it('criterio 15: superadmins y auditoria_plataforma devuelven 0 filas', async () => {
    expect(await contar('superadmins', { academiaId: datos.A.id })).toBe(0);
    expect(await contar('auditoria_plataforma', { academiaId: datos.A.id })).toBe(0);
  });
});

// Criterio 16: contexto de A, intentos de tocar datos de B o la tabla de academias.
describe('criterio 16: en contexto de A no se puede escribir en B ni en academias', () => {
  const contextoA = () => ({ academiaId: datos.A.id });

  it('criterio 16: INSERT en auditoria con academia_id de B falla con 42501', async () => {
    await expect(ejecutarComo('app', INSERTAR_AUDITORIA, [datos.B.id], contextoA())).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('criterio 16: INSERT en configuraciones con academia_id de B falla con 42501', async () => {
    await expect(
      ejecutarComo('app', INSERTAR_CONFIGURACION, [datos.B.id, 'clave_intrusa'], contextoA()),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 16: INSERT en auditoria y configuraciones con academia_id de A sí funciona (control)', async () => {
    await conTransaccionRevertida('app', contextoA(), async (cliente) => {
      await cliente.query(INSERTAR_AUDITORIA, [datos.A.id]);
      await cliente.query(INSERTAR_CONFIGURACION, [datos.A.id, 'clave_control']);
      const { rows } = await cliente.query<{ n: number }>('SELECT count(*)::int AS n FROM configuraciones');
      expect(rows[0]?.n).toBe(datos.filas.configuracionesA + 1);
    });
  });

  it('criterio 16: UPDATE de configuraciones WHERE academia_id = B afecta 0 filas', async () => {
    const resultado = await ejecutarComo(
      'app',
      "UPDATE configuraciones SET valor = '1'::jsonb WHERE academia_id = $1::uuid",
      [datos.B.id],
      contextoA(),
    );
    expect(resultado.rowCount).toBe(0);
  });

  it('criterio 16: un UPDATE que cambia el academia_id de una fila de A a B falla con 42501', async () => {
    await expect(
      ejecutarComo(
        'app',
        'UPDATE configuraciones SET academia_id = $1::uuid WHERE academia_id = $2::uuid',
        [datos.B.id, datos.A.id],
        contextoA(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 16: INSERT en academias falla con 42501', async () => {
    await expect(ejecutarComo('app', INSERTAR_ACADEMIA, ['intrusa'], contextoA())).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('criterio 16: UPDATE de academias afecta 0 filas, incluida la de A', async () => {
    const todas = await ejecutarComo('app', 'UPDATE academias SET actualizada_en = now()', [], contextoA());
    const propia = await ejecutarComo(
      'app',
      "UPDATE academias SET estado = 'SUSPENDIDA', suspendida_en = now() WHERE id = $1::uuid",
      [datos.A.id],
      contextoA(),
    );
    expect([todas.rowCount, propia.rowCount]).toEqual([0, 0]);
  });
});

// Criterio 17: contexto de plataforma.
describe('criterio 17: en contexto de plataforma solo se ven y escriben las tablas de plataforma', () => {
  const plataforma = () => ({ plataforma: true });

  it('criterio 17: academias devuelve todas las filas', async () => {
    const { rows } = await ejecutarComo('app', 'SELECT id FROM academias', [], plataforma());
    expect((rows as { id: string }[]).map((fila) => fila.id).sort()).toEqual([datos.A.id, datos.B.id].sort());
  });

  it('criterio 17: academias admite INSERT y UPDATE', async () => {
    await conTransaccionRevertida('app', plataforma(), async (cliente) => {
      const alta = await cliente.query(INSERTAR_ACADEMIA, ['nueva-academia']);
      const cambio = await cliente.query(
        "UPDATE academias SET estado = 'SUSPENDIDA', motivo_suspension = 'prueba', suspendida_en = now(), actualizada_en = now() WHERE id = $1::uuid",
        [datos.A.id],
      );
      expect([alta.rowCount, cambio.rowCount]).toEqual([1, 1]);
    });
  });

  it('criterio 17: superadmins y auditoria_plataforma devuelven sus filas', async () => {
    expect(await contar('superadmins', plataforma())).toBe(1);
    expect(await contar('auditoria_plataforma', plataforma())).toBe(2);
  });

  it('criterio 17: auditoria_plataforma admite INSERT', async () => {
    await conTransaccionRevertida('app', plataforma(), async (cliente) => {
      const alta = await cliente.query(INSERTAR_AUDITORIA_PLATAFORMA);
      expect(alta.rowCount).toBe(1);
    });
  });

  it('criterio 17: auditoria y configuraciones devuelven 0 filas', async () => {
    expect(await contar('auditoria', plataforma())).toBe(0);
    expect(await contar('configuraciones', plataforma())).toBe(0);
  });

  it('criterio 17: INSERT en auditoria y en configuraciones falla con 42501', async () => {
    await expect(ejecutarComo('app', INSERTAR_AUDITORIA, [datos.A.id], plataforma())).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      ejecutarComo('app', INSERTAR_CONFIGURACION, [datos.A.id, 'clave_plataforma'], plataforma()),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('criterio 17: UPDATE de configuraciones afecta 0 filas', async () => {
    const resultado = await ejecutarComo('app', "UPDATE configuraciones SET valor = '1'::jsonb", [], plataforma());
    expect(resultado.rowCount).toBe(0);
  });
});

// Criterio 18: la marca de plataforma no amplía el acceso a datos de academias.
describe('criterio 18: plataforma y academia A a la vez', () => {
  const ambos = () => ({ plataforma: true, academiaId: datos.A.id });

  it('criterio 18: auditoria y configuraciones muestran solo filas de A', async () => {
    const auditoria = await ejecutarComo('app', 'SELECT academia_id FROM auditoria', [], ambos());
    const configuraciones = await ejecutarComo('app', 'SELECT academia_id FROM configuraciones', [], ambos());
    expect(auditoria.rows).toHaveLength(datos.filas.auditoriaA);
    expect(configuraciones.rows).toHaveLength(datos.filas.configuracionesA);
    for (const fila of [
      ...(auditoria.rows as { academia_id: string }[]),
      ...(configuraciones.rows as { academia_id: string }[]),
    ]) {
      expect(fila.academia_id).toBe(datos.A.id);
    }
  });

  it('criterio 18: no se puede escribir en B con ambas marcas', async () => {
    await expect(ejecutarComo('app', INSERTAR_AUDITORIA, [datos.B.id], ambos())).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      ejecutarComo('app', INSERTAR_CONFIGURACION, [datos.B.id, 'clave_intrusa'], ambos()),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

// Criterio 19: la app no puede borrar ni vaciar, ni modificar la auditoría.
describe('criterio 19: UPDATE, DELETE y TRUNCATE prohibidos donde corresponde', () => {
  const CONTEXTOS: [string, () => Contexto | undefined][] = [
    ['sin contexto', () => undefined],
    ['contexto de A', () => ({ academiaId: datos.A.id })],
    ['contexto de plataforma', () => ({ plataforma: true })],
    ['contexto de plataforma y de A', () => ({ plataforma: true, academiaId: datos.A.id })],
  ];

  describe.each(CONTEXTOS)('%s', (_nombre, contexto) => {
    it.each(['auditoria', 'auditoria_plataforma'])(
      'criterio 19: UPDATE, DELETE y TRUNCATE sobre %s fallan con 42501',
      async (tabla) => {
        await expect(ejecutarComo('app', `UPDATE ${tabla} SET motivo = 'x'`, [], contexto())).rejects.toMatchObject({
          code: '42501',
        });
        await expect(ejecutarComo('app', `DELETE FROM ${tabla}`, [], contexto())).rejects.toMatchObject({
          code: '42501',
        });
        await expect(ejecutarComo('app', `TRUNCATE ${tabla}`, [], contexto())).rejects.toMatchObject({
          code: '42501',
        });
      },
    );

    it.each(['academias', 'superadmins', 'configuraciones'])(
      'criterio 19: DELETE y TRUNCATE sobre %s fallan con 42501',
      async (tabla) => {
        await expect(ejecutarComo('app', `DELETE FROM ${tabla}`, [], contexto())).rejects.toMatchObject({
          code: '42501',
        });
        await expect(ejecutarComo('app', `TRUNCATE ${tabla}`, [], contexto())).rejects.toMatchObject({
          code: '42501',
        });
      },
    );
  });

  it('criterio 19: después de los intentos, los datos siguen intactos', async () => {
    expect(await contar('auditoria', { academiaId: datos.A.id })).toBe(datos.filas.auditoriaA);
    expect(await contar('auditoria', { academiaId: datos.B.id })).toBe(datos.filas.auditoriaB);
    expect(await contar('auditoria_plataforma', { plataforma: true })).toBe(2);
    expect(await contar('academias', { plataforma: true })).toBe(2);
  });
});
