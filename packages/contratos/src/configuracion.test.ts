import { describe, expect, it } from 'vitest';
import {
  actualizarConfiguracionSchema,
  CAMPOS_CONFIGURACION,
  CAMPOS_ENTEROS_CONFIGURACION,
  CLAVES_CONFIGURACION,
  configuracionAcademiaSchema,
  CONFIGURACION_POR_DEFECTO,
  LIMITES_CONFIGURACION,
  respuestaConfiguracionSchema,
  respuestaMiAcademiaSchema,
  telefonoAcademiaSchema,
} from './index';

// Spec 003 (criterios 1, 8 y 10): la tabla de claves, el teléfono y el cuerpo del PATCH. Los valores esperados están escritos a mano.

const LIMITES_ESPERADOS = {
  toleranciaTardanzaMinutos: [0, 30],
  diasPorVencer: [1, 15],
  diasPrioridadRenovacion: [1, 15],
  intentosInicioSesion: [3, 10],
  minutosBloqueo: [5, 60],
} as const;

describe('tabla de claves de la configuración (criterio 1, DR-1)', () => {
  it('trae los seis campos con su clave en la base', () => {
    expect([...CAMPOS_CONFIGURACION]).toEqual([
      'toleranciaTardanzaMinutos',
      'diasPorVencer',
      'diasPrioridadRenovacion',
      'intentosInicioSesion',
      'minutosBloqueo',
      'telefono',
    ]);
    expect(CAMPOS_CONFIGURACION.map((campo) => CLAVES_CONFIGURACION[campo].clave)).toEqual([
      'tolerancia_tardanza_minutos',
      'dias_por_vencer',
      'dias_prioridad_renovacion',
      'intentos_inicio_sesion',
      'minutos_bloqueo',
      'telefono',
    ]);
  });

  it('los valores por defecto son los de las decisiones', () => {
    expect(CONFIGURACION_POR_DEFECTO).toEqual({
      toleranciaTardanzaMinutos: 10,
      diasPorVencer: 5,
      diasPrioridadRenovacion: 5,
      intentosInicioSesion: 5,
      minutosBloqueo: 15,
      telefono: null,
    });
    expect(configuracionAcademiaSchema.parse(CONFIGURACION_POR_DEFECTO)).toEqual(CONFIGURACION_POR_DEFECTO);
  });

  it.each(Object.entries(LIMITES_ESPERADOS))('los límites de %s son %j', (campo, [minimo, maximo]) => {
    expect(LIMITES_CONFIGURACION[campo as keyof typeof LIMITES_ESPERADOS]).toEqual({ minimo, maximo });
  });

  it('los textos de la pantalla de cada campo no están vacíos (salvo la unidad del teléfono)', () => {
    for (const campo of CAMPOS_CONFIGURACION) {
      expect(CLAVES_CONFIGURACION[campo].etiqueta.length).toBeGreaterThan(0);
      expect(CLAVES_CONFIGURACION[campo].ayuda.length).toBeGreaterThan(0);
    }
    for (const campo of CAMPOS_ENTEROS_CONFIGURACION)
      expect(CLAVES_CONFIGURACION[campo].unidad.length).toBeGreaterThan(0);
  });
});

describe('actualizarConfiguracionSchema: enteros (criterio 8)', () => {
  it.each(Object.entries(LIMITES_ESPERADOS))(
    '%s acepta el mínimo y el máximo y rechaza uno menos y uno más',
    (campo, [minimo, maximo]) => {
      for (const valor of [minimo, maximo, Math.floor((minimo + maximo) / 2)]) {
        expect(actualizarConfiguracionSchema.safeParse({ [campo]: valor }).success, `${campo}=${valor}`).toBe(true);
      }
      for (const valor of [minimo - 1, maximo + 1]) {
        const resultado = actualizarConfiguracionSchema.safeParse({ [campo]: valor });
        expect(resultado.success, `${campo}=${valor}`).toBe(false);
        expect(resultado.error?.issues[0]?.path).toEqual([campo]);
      }
    },
  );

  it.each([
    ['un decimal', 10.5],
    ['un texto con dígitos', '10'],
    ['un texto', 'diez'],
    ['true', true],
    ['false', false],
    ['null', null],
    ['un objeto', { valor: 10 }],
    ['una lista', [10]],
    ['Infinity (1e400 al leer el JSON)', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rechaza %s en un campo numérico', (_nombre, valor) => {
    expect(actualizarConfiguracionSchema.safeParse({ toleranciaTardanzaMinutos: valor }).success).toBe(false);
  });

  it('acepta 10.0 y 1e1 (son el número 10 al leer el JSON)', () => {
    for (const texto of ['10.0', '1e1']) {
      const cuerpo = JSON.parse(`{"toleranciaTardanzaMinutos":${texto}}`) as unknown;
      expect(actualizarConfiguracionSchema.parse(cuerpo)).toEqual({ toleranciaTardanzaMinutos: 10 });
    }
  });

  it('rechaza 1e400 al leerlo del JSON (infinito)', () => {
    const cuerpo = JSON.parse('{"toleranciaTardanzaMinutos":1e400}') as unknown;
    expect(actualizarConfiguracionSchema.safeParse(cuerpo).success).toBe(false);
  });

  it('lee -0 como 0', () => {
    const resultado = actualizarConfiguracionSchema.parse({ toleranciaTardanzaMinutos: -0 });
    expect(Object.is(resultado.toleranciaTardanzaMinutos, 0)).toBe(true);
  });
});

describe('actualizarConfiguracionSchema: forma del cuerpo (criterio 8)', () => {
  it('acepta un campo, varios o los seis', () => {
    expect(actualizarConfiguracionSchema.parse({ minutosBloqueo: 30 })).toEqual({ minutosBloqueo: 30 });
    expect(
      actualizarConfiguracionSchema.parse({
        toleranciaTardanzaMinutos: 0,
        diasPorVencer: 15,
        diasPrioridadRenovacion: 1,
        intentosInicioSesion: 10,
        minutosBloqueo: 5,
        telefono: null,
      }),
    ).toEqual({
      toleranciaTardanzaMinutos: 0,
      diasPorVencer: 15,
      diasPrioridadRenovacion: 1,
      intentosInicioSesion: 10,
      minutosBloqueo: 5,
      telefono: null,
    });
  });

  it.each([
    ['{}', {}],
    ['un cuerpo que no es un objeto', 'texto'],
    ['una lista', []],
    ['null', null],
    ['un campo que no es del contrato (nombre)', { nombre: 'Otra' }],
    ['logo', { logo: 'x' }],
    ['academiaId', { academiaId: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f' }],
    ['un campo válido y uno de más', { minutosBloqueo: 20, academia_id: 'x' }],
    ['el nombre de la clave en la base', { minutos_bloqueo: 20 }],
  ])('rechaza %s', (_nombre, cuerpo) => {
    expect(actualizarConfiguracionSchema.safeParse(cuerpo).success).toBe(false);
  });

  it('el 400 de un campo de más indica el campo; el de {} es del cuerpo entero', () => {
    const deMas = actualizarConfiguracionSchema.safeParse({ minutosBloqueo: 20, academiaId: 'x' });
    expect(deMas.error?.issues.some((problema) => (problema as { keys?: string[] }).keys?.includes('academiaId'))).toBe(
      true,
    );
    const vacio = actualizarConfiguracionSchema.safeParse({});
    expect(vacio.error?.issues[0]?.path).toEqual([]);
  });
});

describe('telefonoAcademiaSchema (criterio 10)', () => {
  it.each([
    ['999 888 777', '999 888 777'],
    ['  999888777  ', '999888777'],
    ['+51 999 888 777', '+51 999 888 777'],
    ['(01) 555-0199', '(01) 555-0199'],
    ['123456', '123456'],
    ['+12 34-56 (78)', '+12 34-56 (78)'],
    ['1'.repeat(20), '1'.repeat(20)],
  ])('acepta %j y lo guarda como %j', (entrada, esperado) => {
    expect(telefonoAcademiaSchema.parse(entrada)).toBe(esperado);
  });

  it.each([
    ['5 caracteres', '12345'],
    ['21 caracteres', '1'.repeat(21)],
    ['vacío', ''],
    ['solo espacios', '      '],
    ['letras', '999 abc 777'],
    ['+ en medio', '999+888777'],
    ['dos +', '++51999888'],
    ['solo símbolos (menos de 6 dígitos)', '(---) +  ()'],
    ['5 dígitos con símbolos', '+51 (99) -8-'],
    ['dígitos de otro alfabeto (árabe)', '٩٩٩٨٨٨٧٧٧'],
    ['dígitos de ancho completo', '９９９８８８７７７'],
    ['un tabulador en medio', '999\t888777'],
    ['un salto de línea en medio', '999\n888777'],
    ['un carácter nulo', '999888\u0000777'],
    ['un punto', '999.888.777'],
    ['un número', 999888777 as unknown as string],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(telefonoAcademiaSchema.safeParse(entrada).success).toBe(false);
  });

  it('en el PATCH, null quita el teléfono y un texto se recorta', () => {
    expect(actualizarConfiguracionSchema.parse({ telefono: null })).toEqual({ telefono: null });
    expect(actualizarConfiguracionSchema.parse({ telefono: ' 999 888 777 ' })).toEqual({ telefono: '999 888 777' });
    expect(actualizarConfiguracionSchema.safeParse({ telefono: 999888777 }).success).toBe(false);
  });
});

describe('respuestas', () => {
  it('respuestaConfiguracionSchema exige los seis campos y nada más', () => {
    expect(respuestaConfiguracionSchema.safeParse({ configuracion: CONFIGURACION_POR_DEFECTO }).success).toBe(true);
    const sinTelefono: Record<string, unknown> = { ...CONFIGURACION_POR_DEFECTO };
    delete sinTelefono['telefono'];
    expect(respuestaConfiguracionSchema.safeParse({ configuracion: sinTelefono }).success).toBe(false);
    expect(
      respuestaConfiguracionSchema.safeParse({ configuracion: { ...CONFIGURACION_POR_DEFECTO, extra: 1 } }).success,
    ).toBe(false);
  });

  it('respuestaMiAcademiaSchema trae nombre, nombreCorto y telefono (texto o null)', () => {
    for (const telefono of [null, '999 888 777']) {
      expect(
        respuestaMiAcademiaSchema.safeParse({ academia: { nombre: 'Academia', nombreCorto: 'academia', telefono } })
          .success,
      ).toBe(true);
    }
    expect(respuestaMiAcademiaSchema.safeParse({ academia: { nombre: 'A', nombreCorto: 'a' } }).success).toBe(false);
    expect(
      respuestaMiAcademiaSchema.safeParse({ academia: { nombre: 'A', nombreCorto: 'a', telefono: null, id: 'x' } })
        .success,
    ).toBe(false);
  });
});
