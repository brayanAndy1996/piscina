import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { respuestaOcupacionSchema } from './clases';
import { consultaListaSolicitudesSchema } from './solicitudes';

// Lo que no cubre `foto-panel-protegido.test.ts` (005b): la consulta de la lista y la ocupación de las clases.

describe('consultaListaSolicitudesSchema (criterio 38)', () => {
  it('sin estado vale ACTIVAS', () => {
    expect(consultaListaSolicitudesSchema.parse({})).toEqual({ estado: 'ACTIVAS' });
    expect(consultaListaSolicitudesSchema.parse({ estado: undefined })).toEqual({ estado: 'ACTIVAS' });
  });

  it.each(['ACTIVAS', 'VENCIDAS', 'CANCELADAS', 'TODAS'])('acepta %s', (estado) => {
    expect(consultaListaSolicitudesSchema.parse({ estado })).toEqual({ estado });
  });

  it('ignora los demás parámetros', () => {
    expect(consultaListaSolicitudesSchema.parse({ estado: 'TODAS', academiaId: randomUUID(), limite: '1' })).toEqual({
      estado: 'TODAS',
    });
  });

  it.each([['activas'], [''], [['ACTIVAS']], [['ACTIVAS', 'TODAS']], [null], [1]])(
    'rechaza %j con el error en el campo estado',
    (estado) => {
      const resultado = consultaListaSolicitudesSchema.safeParse({ estado });

      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues[0]?.path).toEqual(['estado']);
    },
  );
});

describe('respuestaOcupacionSchema (criterio 40)', () => {
  const elemento = (cambios: Record<string, unknown> = {}) => ({
    claseId: randomUUID(),
    inscritos: 3,
    cuposRestantes: 17,
    ...cambios,
  });

  it('acepta el mes y una lista (también vacía) de elementos', () => {
    expect(respuestaOcupacionSchema.safeParse({ mes: '2026-11', ocupacion: [] }).success).toBe(true);
    expect(respuestaOcupacionSchema.safeParse({ mes: '2026-12', ocupacion: [elemento(), elemento()] }).success).toBe(
      true,
    );
  });

  it.each([
    ['un mes mal escrito', { mes: '11-2026', ocupacion: [] }],
    ['el mes 13', { mes: '2026-13', ocupacion: [] }],
    ['una clave de más', { mes: '2026-11', ocupacion: [], total: 0 }],
    ['sin ocupación', { mes: '2026-11' }],
    ['un elemento con una clave de más', { mes: '2026-11', ocupacion: [elemento({ aforo: 20 })] }],
    ['inscritos negativos', { mes: '2026-11', ocupacion: [elemento({ inscritos: -1 })] }],
    ['cuposRestantes con decimales', { mes: '2026-11', ocupacion: [elemento({ cuposRestantes: 1.5 })] }],
    ['una clase que no es un UUID', { mes: '2026-11', ocupacion: [elemento({ claseId: 'abc' })] }],
  ])('rechaza %s', (_nombre, cuerpo) => {
    expect(respuestaOcupacionSchema.safeParse(cuerpo).success).toBe(false);
  });
});
