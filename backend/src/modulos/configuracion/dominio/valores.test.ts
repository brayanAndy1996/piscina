import { CONFIGURACION_POR_DEFECTO, LIMITES_CONFIGURACION } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import {
  aplicarCambios,
  cambiosPedidos,
  CLAVES_EN_BASE,
  configuracionEfectiva,
  datosDeAuditoria,
  valorEfectivo,
} from './valores';

// Spec 003 (criterios 1 a 3, 6, 9 y 16): el valor efectivo de cada clave y los cambios que pide un PATCH, como funciones puras.

const ENTEROS = [
  ['toleranciaTardanzaMinutos', 'tolerancia_tardanza_minutos', 10, 0, 30],
  ['diasPorVencer', 'dias_por_vencer', 5, 1, 15],
  ['diasPrioridadRenovacion', 'dias_prioridad_renovacion', 5, 1, 15],
  ['intentosInicioSesion', 'intentos_inicio_sesion', 5, 3, 10],
  ['minutosBloqueo', 'minutos_bloqueo', 15, 5, 60],
] as const;

const INVALIDOS_NUMERICOS: readonly [string, unknown][] = [
  ['un texto', 'cinco'],
  ['un texto con dígitos', '5'],
  ['true', true],
  ['false', false],
  ['un objeto', { valor: 5 }],
  ['una lista', [5]],
  ['JSON null', null],
  ['un decimal', 5.5],
  ['Infinity (1e400)', Number.POSITIVE_INFINITY],
  ['NaN', Number.NaN],
  ['1000', 1000],
  ['un negativo', -1],
];

describe('valorEfectivo: campos enteros', () => {
  it.each(ENTEROS)('%s: sin fila vale %i por defecto', (campo, _clave, porDefecto) => {
    expect(valorEfectivo(campo, undefined)).toEqual({ valor: porDefecto, invalido: false });
  });

  it.each(ENTEROS)(
    '%s: acepta el mínimo y el máximo y rechaza uno menos y uno más (límites de los contratos)',
    (campo, clave, porDefecto, minimo, maximo) => {
      expect(LIMITES_CONFIGURACION[campo]).toEqual({ minimo, maximo });
      expect(valorEfectivo(campo, { clave, valor: minimo })).toEqual({ valor: minimo, invalido: false });
      expect(valorEfectivo(campo, { clave, valor: maximo })).toEqual({ valor: maximo, invalido: false });
      for (const fuera of [minimo - 1, maximo + 1]) {
        expect(valorEfectivo(campo, { clave, valor: fuera }), `${campo}=${fuera}`).toEqual({
          valor: porDefecto,
          invalido: true,
        });
      }
    },
  );

  it.each(ENTEROS)('%s: un valor guardado inválido vale lo de por defecto y se marca', (campo, clave, porDefecto) => {
    for (const [nombre, valor] of INVALIDOS_NUMERICOS) {
      // Los que caen dentro del rango por casualidad (5 con decimales, "5") siguen siendo inválidos: no son enteros o son texto.
      expect(valorEfectivo(campo, { clave, valor }), `${campo} con ${nombre}`).toEqual({
        valor: porDefecto,
        invalido: true,
      });
    }
  });

  it('acepta un entero guardado con decimales en cero (10.0 es el número 10)', () => {
    expect(valorEfectivo('toleranciaTardanzaMinutos', { clave: 'tolerancia_tardanza_minutos', valor: 10.0 })).toEqual({
      valor: 10,
      invalido: false,
    });
  });
});

describe('valorEfectivo: teléfono', () => {
  const fila = (valor: unknown) => ({ clave: 'telefono', valor });

  it('sin fila vale null', () => {
    expect(valorEfectivo('telefono', undefined)).toEqual({ valor: null, invalido: false });
  });

  it('JSON null es "sin teléfono" y es válido', () => {
    expect(valorEfectivo('telefono', fila(null))).toEqual({ valor: null, invalido: false });
  });

  it.each(['999 888 777', '+51 999 888 777', '(01) 555-0199', '123456', '1'.repeat(20)])('acepta %j', (telefono) => {
    expect(valorEfectivo('telefono', fila(telefono))).toEqual({ valor: telefono, invalido: false });
  });

  it.each([
    ['5 caracteres', '12345'],
    ['21 caracteres', '1'.repeat(21)],
    ['letras', 'abc def ghi'],
    ['con espacios en los extremos (lo guardado debe venir normalizado)', ' 999 888 777 '],
    ['con un salto de línea', '999\n888777'],
    ['dígitos de otro alfabeto', '٩٩٩٨٨٨٧٧٧'],
    ['un número', 999888777],
    ['true', true],
    ['una lista', ['999888777']],
    ['un objeto', { telefono: '999888777' }],
    ['vacío', ''],
  ])('un teléfono guardado con %s es inválido y vale null', (_nombre, valor) => {
    expect(valorEfectivo('telefono', fila(valor))).toEqual({ valor: null, invalido: true });
  });
});

describe('configuracionEfectiva (criterios 1 a 3)', () => {
  it('sin filas, los valores por defecto', () => {
    expect(configuracionEfectiva([])).toEqual({ configuracion: CONFIGURACION_POR_DEFECTO, clavesInvalidas: [] });
  });

  it('mezcla los valores guardados con los de por defecto', () => {
    const resultado = configuracionEfectiva([
      { clave: 'minutos_bloqueo', valor: 30 },
      { clave: 'telefono', valor: '999 888 777' },
    ]);
    expect(resultado.configuracion).toEqual({
      ...CONFIGURACION_POR_DEFECTO,
      minutosBloqueo: 30,
      telefono: '999 888 777',
    });
    expect(resultado.clavesInvalidas).toEqual([]);
  });

  it('ignora las claves que no son del contrato (también las que parecen campos de la API)', () => {
    const resultado = configuracionEfectiva([
      { clave: 'logo', valor: 'x' },
      { clave: 'minutosBloqueo', valor: 30 },
      { clave: 'clave_de_una_historia_futura', valor: 1 },
    ]);
    expect(resultado).toEqual({ configuracion: CONFIGURACION_POR_DEFECTO, clavesInvalidas: [] });
  });

  it('un valor inválido vale lo de por defecto y la clave (no el valor) queda en clavesInvalidas', () => {
    const resultado = configuracionEfectiva([
      { clave: 'intentos_inicio_sesion', valor: '9' },
      { clave: 'minutos_bloqueo', valor: 30 },
      { clave: 'dias_por_vencer', valor: 99 },
    ]);
    expect(resultado.configuracion).toEqual({ ...CONFIGURACION_POR_DEFECTO, minutosBloqueo: 30 });
    expect(resultado.clavesInvalidas).toEqual(['dias_por_vencer', 'intentos_inicio_sesion']);
    expect(JSON.stringify(resultado.clavesInvalidas)).not.toContain('99');
  });

  it('CLAVES_EN_BASE son las seis claves de la tabla', () => {
    expect([...CLAVES_EN_BASE]).toEqual([
      'tolerancia_tardanza_minutos',
      'dias_por_vencer',
      'dias_prioridad_renovacion',
      'intentos_inicio_sesion',
      'minutos_bloqueo',
      'telefono',
    ]);
  });
});

describe('cambiosPedidos (criterios 7 y 9)', () => {
  it('sin fila, un valor distinto del de por defecto se escribe, con su valor de antes (el de por defecto)', () => {
    expect(cambiosPedidos([], { minutosBloqueo: 30 })).toEqual([
      { campo: 'minutosBloqueo', clave: 'minutos_bloqueo', antes: 15, despues: 30 },
    ]);
  });

  it('sin fila, el valor de por defecto no se escribe', () => {
    expect(cambiosPedidos([], { minutosBloqueo: 15, telefono: null, toleranciaTardanzaMinutos: 10 })).toEqual([]);
  });

  it('con fila igual al valor pedido no se escribe', () => {
    const filas = [
      { clave: 'minutos_bloqueo', valor: 30 },
      { clave: 'telefono', valor: '999 888 777' },
    ];
    expect(cambiosPedidos(filas, { minutosBloqueo: 30, telefono: '999 888 777' })).toEqual([]);
  });

  it('con fila distinta se escribe, también cuando el nuevo es el de por defecto', () => {
    expect(cambiosPedidos([{ clave: 'minutos_bloqueo', valor: 30 }], { minutosBloqueo: 15 })).toEqual([
      { campo: 'minutosBloqueo', clave: 'minutos_bloqueo', antes: 30, despues: 15 },
    ]);
  });

  it('quitar el teléfono guarda null y el antes es el teléfono', () => {
    expect(cambiosPedidos([{ clave: 'telefono', valor: '999 888 777' }], { telefono: null })).toEqual([
      { campo: 'telefono', clave: 'telefono', antes: '999 888 777', despues: null },
    ]);
  });

  it('una fila inválida siempre se reescribe, aunque el valor pedido sea el de por defecto; el antes es el de por defecto', () => {
    expect(cambiosPedidos([{ clave: 'minutos_bloqueo', valor: 'x' }], { minutosBloqueo: 15 })).toEqual([
      { campo: 'minutosBloqueo', clave: 'minutos_bloqueo', antes: 15, despues: 15 },
    ]);
    expect(cambiosPedidos([{ clave: 'telefono', valor: ' 999 888 777 ' }], { telefono: '999 888 777' })).toEqual([
      { campo: 'telefono', clave: 'telefono', antes: null, despues: '999 888 777' },
    ]);
  });

  it('solo mira los campos pedidos y los devuelve en el orden de la tabla', () => {
    const cambios = cambiosPedidos([{ clave: 'dias_por_vencer', valor: 9 }], {
      telefono: '999 888 777',
      toleranciaTardanzaMinutos: 20,
    });
    expect(cambios.map((cambio) => cambio.campo)).toEqual(['toleranciaTardanzaMinutos', 'telefono']);
  });

  it('ignora las filas de claves desconocidas', () => {
    expect(cambiosPedidos([{ clave: 'logo', valor: 1 }], { minutosBloqueo: 15 })).toEqual([]);
  });
});

describe('aplicarCambios y datosDeAuditoria (criterio 7)', () => {
  const cambios = cambiosPedidos([{ clave: 'telefono', valor: '111 222 333' }], {
    minutosBloqueo: 30,
    telefono: null,
  });

  it('aplicarCambios deja lo demás igual y no modifica la base', () => {
    const base = { ...CONFIGURACION_POR_DEFECTO, telefono: '111 222 333', diasPorVencer: 7 };
    const resultado = aplicarCambios(base, cambios);
    expect(resultado).toEqual({ ...base, minutosBloqueo: 30, telefono: null });
    expect(base.telefono).toBe('111 222 333');
  });

  it('datosDeAuditoria trae solo los campos cambiados, con los nombres de la API', () => {
    expect(datosDeAuditoria(cambios)).toEqual({
      datosAntes: { minutosBloqueo: 15, telefono: '111 222 333' },
      datosDespues: { minutosBloqueo: 30, telefono: null },
    });
  });
});
