import { afterEach, describe, expect, it } from 'vitest';
import { hoyEnLima } from '../../../comun/fechas';
import {
  cambiosPedidosPlan,
  compararPlanes,
  type DatosDePlan,
  estadoDelPlan,
  normalizarPlan,
  ordenarDias,
  ordenarFranjas,
  ordenarNiveles,
  planCombinado,
  validarReglasCruzadas,
} from './plan';

const GUARDADO: DatosDePlan = {
  nombre: 'Plan Mensual',
  vecesPorSemana: 3,
  clasesPorMes: 12,
  duracionMinutos: 60,
  precio: '120.00',
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['08:00', '09:00'],
  nivelesAplicables: ['BASICO', 'INTERMEDIO'],
  vigenciaInicio: '2026-03-01',
  vigenciaFin: '2026-06-30',
  activo: true,
};

describe('normalizarPlan (criterio 8)', () => {
  it('ordena los días de 1 a 7, las franjas por hora y los niveles en el orden del contrato, sin repetidos', () => {
    expect(ordenarDias([7, 1, 3, 3])).toEqual([1, 3, 7]);
    expect(ordenarFranjas(['19:00', '08:00', '12:00'])).toEqual(['08:00', '12:00', '19:00']);
    expect(ordenarNiveles(['AVANZADO', 'BASICO', 'INTERMEDIO'])).toEqual(['BASICO', 'INTERMEDIO', 'AVANZADO']);
    expect(
      normalizarPlan({
        ...GUARDADO,
        diasPermitidos: [5, 1, 3],
        franjasPermitidas: ['09:00', '08:00'],
        nivelesAplicables: ['INTERMEDIO', 'BASICO'],
      }),
    ).toEqual(GUARDADO);
  });
});

describe('planCombinado y validarReglasCruzadas (criterio 12)', () => {
  it('combina lo guardado con lo pedido; null en una vigencia la quita', () => {
    const combinado = planCombinado(GUARDADO, { precio: '130', vigenciaFin: null, diasPermitidos: [6, 2, 4] });

    expect(combinado).toMatchObject({
      precio: '130.00',
      vigenciaInicio: '2026-03-01',
      vigenciaFin: null,
      diasPermitidos: [2, 4, 6],
      nombre: 'Plan Mensual',
    });
  });

  it('sin problemas con un plan válido', () => {
    expect(validarReglasCruzadas(GUARDADO, { precio: '1' })).toEqual([]);
  });

  it('menos días que veces por semana: el error va al campo enviado', () => {
    const subeVeces = { vecesPorSemana: 4 };
    const bajaDias = { diasPermitidos: [1, 3] };

    expect(validarReglasCruzadas(planCombinado(GUARDADO, subeVeces), subeVeces).map((p) => p.campo)).toEqual([
      'vecesPorSemana',
    ]);
    expect(validarReglasCruzadas(planCombinado(GUARDADO, bajaDias), bajaDias).map((p) => p.campo)).toEqual([
      'diasPermitidos',
    ]);
    const ambos = { vecesPorSemana: 5, diasPermitidos: [1, 2, 3] };
    expect(validarReglasCruzadas(planCombinado(GUARDADO, ambos), ambos).map((p) => p.campo)).toEqual([
      'diasPermitidos',
    ]);
  });

  it('el fin antes del inicio: el error va a la fecha enviada', () => {
    const soloFin = { vigenciaFin: '2026-02-28' };
    const soloInicio = { vigenciaInicio: '2026-07-01' };
    const ambas = { vigenciaInicio: '2026-09-01', vigenciaFin: '2026-08-01' };

    expect(validarReglasCruzadas(planCombinado(GUARDADO, soloFin), soloFin).map((p) => p.campo)).toEqual([
      'vigenciaFin',
    ]);
    expect(validarReglasCruzadas(planCombinado(GUARDADO, soloInicio), soloInicio).map((p) => p.campo)).toEqual([
      'vigenciaInicio',
    ]);
    expect(validarReglasCruzadas(planCombinado(GUARDADO, ambas), ambas).map((p) => p.campo)).toEqual(['vigenciaFin']);
  });

  it('una vigencia de un solo día y quitar una fecha son válidas', () => {
    const unDia = { vigenciaInicio: '2026-06-30' };
    const sinFin = { vigenciaFin: null };

    expect(validarReglasCruzadas(planCombinado(GUARDADO, unDia), unDia)).toEqual([]);
    expect(validarReglasCruzadas(planCombinado(GUARDADO, sinFin), sinFin)).toEqual([]);
  });
});

describe('cambiosPedidosPlan (criterios 10 y 12)', () => {
  it('lo que ya vale no es un cambio: "120", "120.0" y "120.00"; los mismos días en otro orden', () => {
    for (const precio of ['120', '120.0', '120.00']) {
      expect(cambiosPedidosPlan(GUARDADO, { precio }).campos).toEqual([]);
    }
    expect(
      cambiosPedidosPlan(GUARDADO, { diasPermitidos: [5, 3, 1], activo: true, nombre: 'Plan Mensual' }).campos,
    ).toEqual([]);
  });

  it('devuelve solo los campos que cambian, con antes y después en el formato de la API', () => {
    const cambios = cambiosPedidosPlan(GUARDADO, {
      precio: '130.5',
      clasesPorMes: 12,
      nivelesAplicables: ['AVANZADO', 'BASICO', 'INTERMEDIO'],
      vigenciaFin: null,
      activo: false,
    });

    expect(cambios.campos).toEqual(['precio', 'nivelesAplicables', 'vigenciaFin', 'activo']);
    expect(cambios.antes).toEqual({
      precio: '120.00',
      nivelesAplicables: ['BASICO', 'INTERMEDIO'],
      vigenciaFin: '2026-06-30',
      activo: true,
    });
    expect(cambios.despues).toEqual({
      precio: '130.50',
      nivelesAplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
      vigenciaFin: null,
      activo: false,
    });
  });

  it('cambiar solo las mayúsculas del nombre sí es un cambio', () => {
    expect(cambiosPedidosPlan(GUARDADO, { nombre: 'plan mensual' }).campos).toEqual(['nombre']);
  });
});

describe('estadoDelPlan (criterio 14)', () => {
  const vigencia = { vigenciaInicio: '2026-11-30', vigenciaFin: '2026-12-31' };

  it('INACTIVO manda sobre las fechas', () => {
    expect(estadoDelPlan({ activo: false, vigenciaInicio: null, vigenciaFin: null }, '2026-11-17')).toBe('INACTIVO');
    expect(estadoDelPlan({ activo: false, ...vigencia }, '2026-12-01')).toBe('INACTIVO');
  });

  it('sin fechas siempre es VIGENTE', () => {
    expect(estadoDelPlan({ activo: true, vigenciaInicio: null, vigenciaFin: null }, '2026-11-17')).toBe('VIGENTE');
  });

  it('PROGRAMADO antes del inicio, VIGENTE con los dos días incluidos y VENCIDO después del fin', () => {
    expect(estadoDelPlan({ activo: true, ...vigencia }, '2026-11-29')).toBe('PROGRAMADO');
    expect(estadoDelPlan({ activo: true, ...vigencia }, '2026-11-30')).toBe('VIGENTE');
    expect(estadoDelPlan({ activo: true, ...vigencia }, '2026-12-31')).toBe('VIGENTE');
    expect(estadoDelPlan({ activo: true, ...vigencia }, '2027-01-01')).toBe('VENCIDO');
  });

  it('con solo el inicio o solo el fin', () => {
    expect(estadoDelPlan({ activo: true, vigenciaInicio: '2026-11-30', vigenciaFin: null }, '2026-11-29')).toBe(
      'PROGRAMADO',
    );
    expect(estadoDelPlan({ activo: true, vigenciaInicio: '2026-11-30', vigenciaFin: null }, '2030-01-01')).toBe(
      'VIGENTE',
    );
    expect(estadoDelPlan({ activo: true, vigenciaInicio: null, vigenciaFin: '2026-11-29' }, '2026-11-29')).toBe(
      'VIGENTE',
    );
    expect(estadoDelPlan({ activo: true, vigenciaInicio: null, vigenciaFin: '2026-11-29' }, '2026-11-30')).toBe(
      'VENCIDO',
    );
  });

  it('un plan de un solo día es VIGENTE ese día', () => {
    const unDia = { activo: true, vigenciaInicio: '2026-11-29', vigenciaFin: '2026-11-29' };
    expect(estadoDelPlan(unDia, '2026-11-28')).toBe('PROGRAMADO');
    expect(estadoDelPlan(unDia, '2026-11-29')).toBe('VIGENTE');
    expect(estadoDelPlan(unDia, '2026-11-30')).toBe('VENCIDO');
  });

  it('en el cambio de mes y de año', () => {
    const fin = { activo: true, vigenciaInicio: null, vigenciaFin: '2026-12-31' };
    expect(estadoDelPlan(fin, '2026-12-31')).toBe('VIGENTE');
    expect(estadoDelPlan(fin, '2027-01-01')).toBe('VENCIDO');
  });
});

describe('compararPlanes (criterio 15)', () => {
  const comparador = new Intl.Collator('es');

  it('ordena por nombre en español y, a igual nombre, por id', () => {
    const planes = [
      { nombre: 'Ñandú', id: '3' },
      { nombre: 'Nube', id: '2' },
      { nombre: 'álamo', id: '1' },
      { nombre: 'Zorro', id: '4' },
      { nombre: 'Nube', id: '0' },
    ];

    expect(planes.sort((a, b) => compararPlanes(a, b, comparador)).map((p) => `${p.nombre}${p.id}`)).toEqual([
      'álamo1',
      'Nube0',
      'Nube2',
      'Ñandú3',
      'Zorro4',
    ]);
  });
});

describe('estadoDelPlan con la fecha de Lima del reloj y el proceso en otra zona (criterio 14)', () => {
  const TZ_ORIGINAL = process.env['TZ'];

  afterEach(() => {
    if (TZ_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = TZ_ORIGINAL;
  });

  const plan = { activo: true, vigenciaInicio: null, vigenciaFin: '2026-11-29' };
  const estadoEn = (instante: string) => estadoDelPlan(plan, hoyEnLima(new Date(instante)));

  it.each(['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles'])(
    'con vigenciaFin 2026-11-29: a las 04:59:59Z es VIGENTE y a las 05:00:00Z es VENCIDO (TZ=%s)',
    (zona) => {
      process.env['TZ'] = zona;

      expect(estadoEn('2026-11-30T04:59:59.000Z')).toBe('VIGENTE');
      expect(estadoEn('2026-11-30T05:00:00.000Z')).toBe('VENCIDO');
    },
  );

  it('lo mismo en el cambio de mes y de año', () => {
    process.env['TZ'] = 'Asia/Tokyo';
    const finDeMes = { activo: true, vigenciaInicio: null, vigenciaFin: '2026-11-30' };
    const finDeAnio = { activo: true, vigenciaInicio: null, vigenciaFin: '2026-12-31' };

    expect(estadoDelPlan(finDeMes, hoyEnLima(new Date('2026-12-01T04:59:59.000Z')))).toBe('VIGENTE');
    expect(estadoDelPlan(finDeMes, hoyEnLima(new Date('2026-12-01T05:00:00.000Z')))).toBe('VENCIDO');
    expect(estadoDelPlan(finDeAnio, hoyEnLima(new Date('2027-01-01T04:59:59.000Z')))).toBe('VIGENTE');
    expect(estadoDelPlan(finDeAnio, hoyEnLima(new Date('2027-01-01T05:00:00.000Z')))).toBe('VENCIDO');
  });
});
