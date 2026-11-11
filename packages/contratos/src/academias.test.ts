import { describe, expect, it } from 'vitest';
import {
  academiaPublicaSchema,
  academiaResumenSchema,
  crearAcademiaSchema,
  nombreCortoSchema,
  PALABRAS_RESERVADAS,
  reactivarAcademiaSchema,
  respuestaAcademiaSchema,
  respuestaListaAcademiasSchema,
  suspenderAcademiaSchema,
} from './index';

const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';

describe('nombreCortoSchema (criterio 49)', () => {
  it.each([
    ['delfines', 'delfines'],
    ['  Delfines  ', 'delfines'],
    ['LOS-DELFINES', 'los-delfines'],
    ['club-2026', 'club-2026'],
    ['a1b', 'a1b'],
    ['x'.repeat(30), 'x'.repeat(30)],
    ['delfines\n', 'delfines'],
  ])('acepta y normaliza %j como %j', (entrada, esperado) => {
    expect(nombreCortoSchema.parse(entrada)).toBe(esperado);
  });

  it.each([
    ['muy corto', 'ab'],
    ['31 caracteres', 'x'.repeat(31)],
    ['vacío', ''],
    ['solo espacios', '   '],
    ['empieza con número', '1delfines'],
    ['empieza con guion', '-delfines'],
    ['termina con guion', 'delfines-'],
    ['guiones seguidos', 'del--fines'],
    ['con espacio en medio', 'del fines'],
    ['con salto de línea en medio', 'del\nfines'],
    ['con guion bajo', 'del_fines'],
    ['con tilde', 'natación'],
    ['con eñe', 'peña'],
    ['con punto', 'del.fines'],
    ['con barra', 'del/fines'],
    ['con ..', '..'],
    ['con porcentaje', 'del%20fines'],
    ['con e cirílica', 'dеlfines'],
    ['con İ turca', 'İzmir'],
    ['con carácter nulo', 'delfines\u0000'],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(nombreCortoSchema.safeParse(entrada).success).toBe(false);
  });

  it('rechaza las 23 palabras reservadas, también con mayúsculas y espacios', () => {
    expect(PALABRAS_RESERVADAS).toHaveLength(23);
    for (const palabra of PALABRAS_RESERVADAS) {
      expect(nombreCortoSchema.safeParse(palabra).success, palabra).toBe(false);
      expect(nombreCortoSchema.safeParse(` ${palabra.toUpperCase()} `).success, palabra).toBe(false);
    }
  });

  it('acepta una palabra que solo contiene una reservada', () => {
    expect(nombreCortoSchema.parse('admin-norte')).toBe('admin-norte');
    expect(nombreCortoSchema.parse('apis')).toBe('apis');
  });
});

describe('crearAcademiaSchema (criterio 49)', () => {
  it('recorta el nombre y normaliza el nombre corto', () => {
    expect(crearAcademiaSchema.parse({ nombre: '  Academia Los Delfines ', nombreCorto: ' Delfines ' })).toEqual({
      nombre: 'Academia Los Delfines',
      nombreCorto: 'delfines',
    });
  });

  it.each([
    ['nombre muy corto', { nombre: 'ab', nombreCorto: 'delfines' }],
    ['nombre de 101 caracteres', { nombre: 'x'.repeat(101), nombreCorto: 'delfines' }],
    ['nombre solo con espacios', { nombre: '     ', nombreCorto: 'delfines' }],
    ['nombre con salto de línea', { nombre: 'Los\nDelfines', nombreCorto: 'delfines' }],
    ['nombre con tabulador', { nombre: 'Los\tDelfines', nombreCorto: 'delfines' }],
    ['nombre con carácter nulo', { nombre: 'Los\u0000Delfines', nombreCorto: 'delfines' }],
    ['sin nombre', { nombreCorto: 'delfines' }],
    ['sin nombre corto', { nombre: 'Los Delfines' }],
    ['nombre corto reservado', { nombre: 'Los Delfines', nombreCorto: 'admin' }],
    ['con un campo de más', { nombre: 'Los Delfines', nombreCorto: 'delfines', estado: 'ACTIVA' }],
    ['nombre que no es texto', { nombre: 123, nombreCorto: 'delfines' }],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(crearAcademiaSchema.safeParse(entrada).success).toBe(false);
  });

  it('nombra el campo del problema en la ruta del error', () => {
    const resultado = crearAcademiaSchema.safeParse({ nombre: 'Los Delfines', nombreCorto: 'a' });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues.map((problema) => problema.path.join('.'))).toContain('nombreCorto');
  });

  it('acepta un nombre de 3 y de 100 caracteres', () => {
    expect(crearAcademiaSchema.safeParse({ nombre: 'abc', nombreCorto: 'delfines' }).success).toBe(true);
    expect(crearAcademiaSchema.safeParse({ nombre: 'x'.repeat(100), nombreCorto: 'delfines' }).success).toBe(true);
  });
});

describe('suspenderAcademiaSchema y reactivarAcademiaSchema', () => {
  it('suspender exige un motivo de 3 a 500 caracteres tras recortar', () => {
    expect(suspenderAcademiaSchema.parse({ motivo: '  Falta de pago  ' })).toEqual({ motivo: 'Falta de pago' });
    expect(suspenderAcademiaSchema.safeParse({ motivo: 'x'.repeat(500) }).success).toBe(true);
    for (const motivo of ['', '  ab  ', 'x'.repeat(501), 5, undefined]) {
      expect(suspenderAcademiaSchema.safeParse({ motivo }).success, String(motivo)).toBe(false);
    }
    expect(suspenderAcademiaSchema.safeParse({}).success).toBe(false);
    expect(suspenderAcademiaSchema.safeParse({ motivo: 'Falta de pago', extra: 1 }).success).toBe(false);
  });

  it('reactivar acepta {} y un motivo válido, y rechaza un motivo inválido o un campo de más', () => {
    expect(reactivarAcademiaSchema.parse({})).toEqual({});
    expect(reactivarAcademiaSchema.parse({ motivo: ' Regularizó ' })).toEqual({ motivo: 'Regularizó' });
    expect(reactivarAcademiaSchema.safeParse({ motivo: 'ab' }).success).toBe(false);
    expect(reactivarAcademiaSchema.safeParse({ motivo: 'x'.repeat(501) }).success).toBe(false);
    expect(reactivarAcademiaSchema.safeParse({ otro: 1 }).success).toBe(false);
  });
});

describe('esquemas de respuesta', () => {
  const resumen = {
    id: ID,
    nombre: 'Los Delfines',
    nombreCorto: 'delfines',
    estado: 'ACTIVA' as const,
    creadaEn: '2026-11-11T15:30:45.123Z',
    suspendidaEn: null,
    motivoSuspension: null,
  };

  it('academiaResumenSchema acepta el resumen y una academia suspendida', () => {
    expect(academiaResumenSchema.parse(resumen)).toEqual(resumen);
    const suspendida = {
      ...resumen,
      estado: 'SUSPENDIDA' as const,
      suspendidaEn: '2026-11-12T10:00:00.000Z',
      motivoSuspension: 'Falta de pago',
    };
    expect(academiaResumenSchema.parse(suspendida)).toEqual(suspendida);
  });

  it.each([
    ['con un campo de más', { ...resumen, alumnos: 12 }],
    ['con un id que no es UUID', { ...resumen, id: '123' }],
    ['con un estado desconocido', { ...resumen, estado: 'BORRADA' }],
    ['con una fecha que no es ISO UTC', { ...resumen, creadaEn: '11/11/2026' }],
    ['con una fecha con desfase', { ...resumen, creadaEn: '2026-11-11T10:30:45-05:00' }],
    ['sin suspendidaEn', { ...resumen, suspendidaEn: undefined }],
  ])('academiaResumenSchema rechaza un resumen %s', (_nombre, valor) => {
    expect(academiaResumenSchema.safeParse(valor).success).toBe(false);
  });

  it('las respuestas envuelven el resumen y son estrictas', () => {
    expect(respuestaAcademiaSchema.parse({ academia: resumen })).toEqual({ academia: resumen });
    expect(respuestaAcademiaSchema.safeParse({ academia: resumen, extra: 1 }).success).toBe(false);
    expect(respuestaListaAcademiasSchema.parse({ academias: [resumen, resumen] }).academias).toHaveLength(2);
    expect(respuestaListaAcademiasSchema.parse({ academias: [] })).toEqual({ academias: [] });
    expect(respuestaListaAcademiasSchema.safeParse({ academias: [{ ...resumen, usuarios: [] }] }).success).toBe(false);
  });

  it('academiaPublicaSchema solo tiene nombreCorto y nombre', () => {
    expect(academiaPublicaSchema.parse({ nombreCorto: 'delfines', nombre: 'Los Delfines' })).toEqual({
      nombreCorto: 'delfines',
      nombre: 'Los Delfines',
    });
    expect(academiaPublicaSchema.safeParse({ nombreCorto: 'delfines', nombre: 'x', id: ID }).success).toBe(false);
    expect(academiaPublicaSchema.safeParse({ nombreCorto: 'delfines', nombre: 'x', estado: 'ACTIVA' }).success).toBe(
      false,
    );
  });
});
