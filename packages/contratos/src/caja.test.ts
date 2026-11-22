import { describe, expect, it } from 'vitest';
import {
  abrirCajaSchema,
  cerrarCajaSchema,
  MENSAJE_EXPLICA_LA_DIFERENCIA,
  reabrirCajaSchema,
  registrarEgresoSchema,
} from './caja';
import { montoConSignoSchema, montoDeLecturaSchema, restarMontos } from './dinero';

// Spec 006a, criterios 11, 18, 30 y 35 (prueba no protegida): los bordes de los esquemas de entrada de la caja y los formatos de lectura.

const CLAVE = '6f1c6d3e-3b52-4d4b-9a40-0a7a3d6c9f11';

describe('abrirCajaSchema', () => {
  it('acepta la clave y el monto inicial, también cero', () => {
    expect(abrirCajaSchema.safeParse({ claveIdempotencia: CLAVE, montoInicial: '0' }).success).toBe(true);
    expect(abrirCajaSchema.safeParse({ claveIdempotencia: CLAVE, montoInicial: '99999.99' }).success).toBe(true);
  });

  it.each([{ fecha: '2026-11-11' }, { academiaId: CLAVE }, { cajaId: CLAVE }])(
    'rechaza un campo de más: %j',
    (extra) => {
      expect(abrirCajaSchema.safeParse({ claveIdempotencia: CLAVE, montoInicial: '1', ...extra }).success).toBe(false);
    },
  );
});

describe('registrarEgresoSchema', () => {
  const base = { claveIdempotencia: CLAVE, descripcion: 'Compra de útiles', monto: '15.5' };

  it('recorta la descripción y normaliza el comprobante vacío, nulo o ausente a null', () => {
    for (const comprobante of [undefined, null, '', '   ']) {
      const resultado = registrarEgresoSchema.parse({ ...base, descripcion: '  Compra de útiles  ', comprobante });
      expect(resultado.comprobante).toBeNull();
      expect(resultado.descripcion).toBe('Compra de útiles');
    }
    expect(registrarEgresoSchema.parse({ ...base, comprobante: '  B001-1  ' }).comprobante).toBe('B001-1');
  });

  it('rechaza un comprobante de más de 60 caracteres ya recortado y uno con controles', () => {
    expect(registrarEgresoSchema.safeParse({ ...base, comprobante: 'a'.repeat(61) }).success).toBe(false);
    expect(registrarEgresoSchema.safeParse({ ...base, comprobante: 'B001\n123' }).success).toBe(false);
    expect(registrarEgresoSchema.safeParse({ ...base, comprobante: 'a'.repeat(60) }).success).toBe(true);
  });

  it.each([{ metodo: 'YAPE' }, { concepto: 'INSCRIPCION' }, { tipo: 'INGRESO' }, { alumnoId: CLAVE }])(
    'rechaza un campo de más: %j',
    (extra) => {
      expect(registrarEgresoSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    },
  );

  it('rechaza un monto de cero y uno con tres decimales', () => {
    expect(registrarEgresoSchema.safeParse({ ...base, monto: '0' }).success).toBe(false);
    expect(registrarEgresoSchema.safeParse({ ...base, monto: '5.555' }).success).toBe(false);
  });
});

describe('cerrarCajaSchema', () => {
  const base = { claveIdempotencia: CLAVE, montoDeclarado: '0', ultimoMovimientoVisto: 0 };

  it('acepta cero como efectivo contado y como último movimiento visto', () => {
    expect(cerrarCajaSchema.safeParse(base).success).toBe(true);
  });

  it.each([-1, 1_000_001, 1.5, '3', null])('rechaza un ultimoMovimientoVisto de %j', (visto) => {
    expect(cerrarCajaSchema.safeParse({ ...base, ultimoMovimientoVisto: visto }).success).toBe(false);
  });

  it('una observación vacía o de solo espacios no cuenta como ausente (PP6 c); la nula o ausente sí', () => {
    expect(cerrarCajaSchema.safeParse({ ...base, observacion: '' }).success).toBe(false);
    expect(cerrarCajaSchema.safeParse({ ...base, observacion: '   ' }).success).toBe(false);
    expect(cerrarCajaSchema.safeParse({ ...base, observacion: null }).success).toBe(true);
    expect(cerrarCajaSchema.parse({ ...base, observacion: '  Faltó un sol  ' }).observacion).toBe('Faltó un sol');
  });

  it('el mensaje de la diferencia sin explicar es el del contrato', () => {
    expect(MENSAJE_EXPLICA_LA_DIFERENCIA).toBe('Explica la diferencia (sobrante o faltante)');
  });
});

describe('reabrirCajaSchema', () => {
  it('pide un motivo de 3 a 200 caracteres visibles', () => {
    expect(reabrirCajaSchema.safeParse({ motivo: 'abc' }).success).toBe(true);
    expect(reabrirCajaSchema.safeParse({ motivo: 'ab' }).success).toBe(false);
    expect(reabrirCajaSchema.safeParse({ motivo: 'a'.repeat(201) }).success).toBe(false);
    expect(reabrirCajaSchema.safeParse({ motivo: 'abc', extra: 1 }).success).toBe(false);
  });
});

describe('formatos de lectura (PP3)', () => {
  it('montoDeLecturaSchema: dos decimales exactos y hasta 9999999999.99, sin signo', () => {
    for (const valido of ['0.00', '126.50', '100000.00', '9999999999.99']) {
      expect(montoDeLecturaSchema.safeParse(valido).success, valido).toBe(true);
    }
    for (const invalido of ['-1.00', '1', '1.5', '10000000000.00', '01.00', '1e2', '']) {
      expect(montoDeLecturaSchema.safeParse(invalido).success, invalido).toBe(false);
    }
  });

  it('montoConSignoSchema: el tope es el de numeric(12,2) y rechaza "-0.00"', () => {
    expect(montoConSignoSchema.safeParse('-9999999999.99').success).toBe(true);
    expect(montoConSignoSchema.safeParse('-10000000000.00').success).toBe(false);
    expect(montoConSignoSchema.safeParse('-0.00').success).toBe(false);
    expect(montoConSignoSchema.safeParse('0.00').success).toBe(true);
  });

  it('restarMontos acepta los montos de respuesta y rechaza lo que no es un monto con RangeError', () => {
    expect(restarMontos('1200.50', '0.50')).toBe('1200.00');
    expect(restarMontos('9999999999.99', '0')).toBe('9999999999.99');
    for (const invalido of ['', '-1', '1,5', '1e2', ' 1', '1.505', '01']) {
      expect(() => restarMontos(invalido, '1'), invalido).toThrow(RangeError);
      expect(() => restarMontos('1', invalido), invalido).toThrow(RangeError);
    }
  });
});
