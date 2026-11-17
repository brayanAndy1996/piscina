import type { Plan } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import {
  aCamposPlan,
  cambiosDePlan,
  camposEditadosDePlan,
  sonIgualesPlanes,
  validarCambiosDePlan,
  validarPlanNuevo,
} from './campos';
import { ordenarPlanes } from './hooks';

const PLAN: Plan = {
  id: 'a1111111-1111-4111-8111-111111111111',
  nombre: '3 veces por semana',
  vecesPorSemana: 3,
  clasesPorMes: 12,
  duracionMinutos: 60,
  precio: '120.00',
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['18:00', '19:00'],
  nivelesAplicables: ['BASICO', 'AVANZADO'],
  vigenciaInicio: null,
  vigenciaFin: null,
  activo: true,
  estado: 'VIGENTE',
};

describe('cambios de un plan frente a su base', () => {
  it('sin tocar nada no hay cambios', () => {
    expect(cambiosDePlan(aCamposPlan(PLAN), PLAN)).toEqual({});
    expect(camposEditadosDePlan(aCamposPlan(PLAN), PLAN)).toEqual([]);
  });

  it('el precio se compara como texto con dos decimales: "120" y "120.5" frente a "120.00"', () => {
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), precio: '120' }, PLAN)).toEqual({});
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), precio: ' 120.0 ' }, PLAN)).toEqual({});
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), precio: '120.5' }, PLAN)).toEqual({ precio: '120.5' });
  });

  it('el precio nunca se convierte en número, ni siquiera uno inválido', () => {
    const cambios = cambiosDePlan({ ...aCamposPlan(PLAN), precio: '1e2' }, PLAN);
    expect(cambios).toEqual({ precio: '1e2' });
    expect(typeof cambios['precio']).toBe('string');
  });

  it('los enteros viajan como número; un texto que no es entero se deja tal cual', () => {
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), clasesPorMes: ' 8 ' }, PLAN)).toEqual({ clasesPorMes: 8 });
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), clasesPorMes: '8.5' }, PLAN)).toEqual({ clasesPorMes: '8.5' });
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), clasesPorMes: '' }, PLAN)).toEqual({ clasesPorMes: '' });
  });

  it('las listas se comparan sin importar el orden de los clics y se envían ordenadas', () => {
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), diasPermitidos: [5, 1, 3] }, PLAN)).toEqual({});
    expect(
      cambiosDePlan(
        {
          ...aCamposPlan(PLAN),
          diasPermitidos: [5, 2, 1],
          franjasPermitidas: ['19:00', '08:00'],
          nivelesAplicables: ['AVANZADO', 'INTERMEDIO', 'BASICO'],
        },
        PLAN,
      ),
    ).toEqual({
      diasPermitidos: [1, 2, 5],
      franjasPermitidas: ['08:00', '19:00'],
      nivelesAplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    });
  });

  it('una fecha vacía quita la vigencia (null) y el nombre se recorta', () => {
    const conVigencia: Plan = { ...PLAN, vigenciaInicio: '2027-01-01', vigenciaFin: '2027-03-31' };
    expect(
      cambiosDePlan({ ...aCamposPlan(conVigencia), vigenciaFin: '', nombre: '  Nuevo nombre ' }, conVigencia),
    ).toEqual({ vigenciaFin: null, nombre: 'Nuevo nombre' });
  });

  it('activar y desactivar', () => {
    expect(cambiosDePlan({ ...aCamposPlan(PLAN), activo: false }, PLAN)).toEqual({ activo: false });
  });

  it('dos planes con el mismo precio escrito distinto son iguales', () => {
    expect(sonIgualesPlanes(PLAN, { ...PLAN, precio: '120' })).toBe(true);
    expect(sonIgualesPlanes(PLAN, { ...PLAN, estado: 'VENCIDO' })).toBe(true);
    expect(sonIgualesPlanes(PLAN, { ...PLAN, diasPermitidos: [1, 3] })).toBe(false);
    expect(sonIgualesPlanes(PLAN, null)).toBe(false);
    expect(sonIgualesPlanes(null, null)).toBe(true);
  });
});

describe('validación con los esquemas compartidos', () => {
  const NUEVO = {
    ...aCamposPlan(null),
    nombre: 'Plan de prueba',
    vecesPorSemana: '2',
    clasesPorMes: '8',
    precio: '90',
    diasPermitidos: [2, 4],
    franjasPermitidas: ['17:00'],
    nivelesAplicables: ['BASICO'],
  };

  it('un plan nuevo válido da el cuerpo de la API: precio como texto y duración 60 por defecto', () => {
    const resultado = validarPlanNuevo(NUEVO);
    expect(resultado).toEqual({
      correcto: true,
      datos: {
        nombre: 'Plan de prueba',
        vecesPorSemana: 2,
        clasesPorMes: 8,
        duracionMinutos: 60,
        precio: '90',
        diasPermitidos: [2, 4],
        franjasPermitidas: ['17:00'],
        nivelesAplicables: ['BASICO'],
      },
    });
  });

  it.each([
    ['nombre', { nombre: 'ab' }],
    ['vecesPorSemana', { vecesPorSemana: '8' }],
    ['clasesPorMes', { clasesPorMes: '0' }],
    ['clasesPorMes', { clasesPorMes: '32' }],
    ['duracionMinutos', { duracionMinutos: '14' }],
    ['precio', { precio: '0' }],
    ['precio', { precio: '0.00' }],
    ['precio', { precio: '120.505' }],
    ['precio', { precio: '120,50' }],
    ['precio', { precio: '1e2' }],
    ['precio', { precio: '100000' }],
    ['precio', { precio: '' }],
    ['diasPermitidos', { diasPermitidos: [] }],
    ['diasPermitidos', { diasPermitidos: [2] }],
    ['franjasPermitidas', { franjasPermitidas: [] }],
    ['nivelesAplicables', { nivelesAplicables: [] }],
    ['vigenciaInicio', { vigenciaInicio: '2026-02-30' }],
    ['vigenciaFin', { vigenciaInicio: '2027-02-01', vigenciaFin: '2027-01-31' }],
  ])('un plan nuevo con %s inválido no se envía: %j', (campo, cambio) => {
    const resultado = validarPlanNuevo({ ...NUEVO, ...cambio });
    expect(resultado.correcto).toBe(false);
    if (!resultado.correcto) expect(Object.keys(resultado.errores)).toContain(campo);
  });

  it('los precios válidos se aceptan como texto', () => {
    for (const precio of ['120', '120.5', '0.01', '99999.99']) {
      expect(validarPlanNuevo({ ...NUEVO, precio }).correcto).toBe(true);
    }
  });

  it('los grupos de casillas vacíos dicen qué elegir, sin hablar de "valores"', () => {
    const resultado = validarPlanNuevo({ ...NUEVO, diasPermitidos: [], franjasPermitidas: [], nivelesAplicables: [] });
    expect(resultado).toEqual({
      correcto: false,
      errores: {
        diasPermitidos: 'Elige al menos un día.',
        franjasPermitidas: 'Elige al menos una franja.',
        nivelesAplicables: 'Elige al menos un nivel.',
      },
    });
  });

  it('al editar, las reglas que cruzan campos usan lo guardado más lo cambiado', () => {
    // Subir las veces por semana a 4 con 3 días guardados.
    const subir = validarCambiosDePlan({ ...aCamposPlan(PLAN), vecesPorSemana: '4' }, PLAN);
    expect(subir.correcto).toBe(false);
    if (!subir.correcto) expect(Object.keys(subir.errores)).toEqual(['diasPermitidos']);
    // Subirlas y sumar el día que falta es válido.
    const ambos = validarCambiosDePlan(
      { ...aCamposPlan(PLAN), vecesPorSemana: '4', diasPermitidos: [1, 3, 5, 6] },
      PLAN,
    );
    expect(ambos.correcto).toBe(true);
    // Una fecha de fin anterior a la de inicio guardada.
    const conInicio: Plan = { ...PLAN, vigenciaInicio: '2027-01-01' };
    const fin = validarCambiosDePlan({ ...aCamposPlan(conInicio), vigenciaFin: '2026-12-31' }, conInicio);
    expect(fin.correcto).toBe(false);
    if (!fin.correcto) expect(Object.keys(fin.errores)).toEqual(['vigenciaFin']);
  });

  it('al editar solo se validan y envían los campos cambiados', () => {
    const resultado = validarCambiosDePlan({ ...aCamposPlan(PLAN), precio: '130.5' }, PLAN);
    expect(resultado).toEqual({ correcto: true, datos: { precio: '130.5' } });
  });
});

describe('orden de la lista', () => {
  it('por nombre en español y, a igual nombre, por id', () => {
    const planes: Plan[] = [
      { ...PLAN, id: 'a1111111-1111-4111-8111-111111111112', nombre: 'Verano' },
      { ...PLAN, id: 'a1111111-1111-4111-8111-111111111113', nombre: 'Álamo' },
      { ...PLAN, id: 'a1111111-1111-4111-8111-111111111115', nombre: 'Básico' },
      { ...PLAN, id: 'a1111111-1111-4111-8111-111111111114', nombre: 'Básico' },
    ];
    expect(ordenarPlanes(planes).map((plan) => plan.id.slice(-1))).toEqual(['3', '4', '5', '2']);
  });
});
