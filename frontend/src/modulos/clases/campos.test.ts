import type { Clase } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import {
  aCamposClase,
  cambiosDeClase,
  camposEditadosDeClase,
  sonIgualesClases,
  validarCambiosDeClase,
  validarClaseNueva,
} from './campos';
import { ordenarClases } from './hooks';

const ENTRENADOR = 'e1111111-1111-4111-8111-111111111111';
const OTRO = 'e2222222-2222-4222-8222-222222222222';

const CLASE: Clase = {
  id: 'c1111111-1111-4111-8111-111111111111',
  nivel: 'BASICO',
  diaSemana: 1,
  horaInicio: '18:00',
  horaFin: '19:00',
  aforo: 30,
  activo: true,
  entrenador: { id: ENTRENADOR, nombres: 'Mario', apellidos: 'Castro Vega', activo: true },
};

describe('cambios de una clase frente a su base', () => {
  it('sin tocar nada no hay cambios', () => {
    expect(cambiosDeClase(aCamposClase(CLASE), CLASE)).toEqual({});
    expect(camposEditadosDeClase(aCamposClase(CLASE), CLASE)).toEqual([]);
    expect(camposEditadosDeClase(aCamposClase(null), null)).toEqual([]);
  });

  it('solo el entrenador, el aforo y el estado pueden cambiar', () => {
    expect(cambiosDeClase({ ...aCamposClase(CLASE), entrenadorId: OTRO, aforo: ' 45 ', activo: false }, CLASE)).toEqual(
      { entrenadorId: OTRO, aforo: 45, activo: false },
    );
    // El nivel, el día y la hora del formulario no entran en los cambios aunque se alteraran.
    expect(
      cambiosDeClase({ ...aCamposClase(CLASE), nivel: 'AVANZADO', diaSemana: '2', horaInicio: '09:00' }, CLASE),
    ).toEqual({});
  });

  it('un aforo que no es entero se deja como texto para que el esquema lo rechace', () => {
    expect(cambiosDeClase({ ...aCamposClase(CLASE), aforo: '20.5' }, CLASE)).toEqual({ aforo: '20.5' });
    expect(cambiosDeClase({ ...aCamposClase(CLASE), aforo: '' }, CLASE)).toEqual({ aforo: '' });
  });

  it('dos clases son iguales aunque el nombre del entrenador cambie', () => {
    expect(sonIgualesClases(CLASE, { ...CLASE, entrenador: { ...CLASE.entrenador, nombres: 'Mario José' } })).toBe(
      true,
    );
    expect(sonIgualesClases(CLASE, { ...CLASE, entrenador: { ...CLASE.entrenador, activo: false } })).toBe(false);
    expect(sonIgualesClases(CLASE, { ...CLASE, aforo: 31 })).toBe(false);
    expect(sonIgualesClases(CLASE, null)).toBe(false);
  });
});

describe('validación con los esquemas compartidos', () => {
  const NUEVA = {
    nivel: 'BASICO',
    diaSemana: '1',
    horaInicio: '08:00',
    entrenadorId: ENTRENADOR,
    aforo: '20',
    activo: true,
  };

  it('una clase nueva válida da el cuerpo de la API', () => {
    expect(validarClaseNueva(NUEVA)).toEqual({
      correcto: true,
      datos: { nivel: 'BASICO', diaSemana: 1, horaInicio: '08:00', entrenadorId: ENTRENADOR, aforo: 20 },
    });
  });

  it.each(['20', '50', ' 35 '])('el aforo %j se acepta', (aforo) => {
    expect(validarClaseNueva({ ...NUEVA, aforo }).correcto).toBe(true);
  });

  it.each(['19', '51', '0', '-20', '20.5', 'veinte', '', '2e1', '1e9', '99999999999999999999'])(
    'el aforo %j se rechaza junto al aforo',
    (aforo) => {
      const resultado = validarClaseNueva({ ...NUEVA, aforo });
      expect(resultado.correcto).toBe(false);
      if (!resultado.correcto) expect(Object.keys(resultado.errores)).toEqual(['aforo']);
    },
  );

  it('un selector sin elegir dice qué elegir', () => {
    const resultado = validarClaseNueva({ ...NUEVA, nivel: '', diaSemana: '', horaInicio: '', entrenadorId: '' });
    expect(resultado).toEqual({
      correcto: false,
      errores: {
        nivel: 'Elige un nivel.',
        diaSemana: 'Elige un día.',
        horaInicio: 'Elige un bloque.',
        entrenadorId: 'Elige un entrenador.',
      },
    });
  });

  it('el último bloque es el de las 19:00; las 20:00 no valen', () => {
    expect(validarClaseNueva({ ...NUEVA, horaInicio: '19:00' }).correcto).toBe(true);
    expect(validarClaseNueva({ ...NUEVA, horaInicio: '20:00' }).correcto).toBe(false);
  });

  it('al editar, solo se valida y envía lo cambiado', () => {
    expect(validarCambiosDeClase({ ...aCamposClase(CLASE), aforo: '40' }, CLASE)).toEqual({
      correcto: true,
      datos: { aforo: 40 },
    });
    const mal = validarCambiosDeClase({ ...aCamposClase(CLASE), aforo: '51' }, CLASE);
    expect(mal.correcto).toBe(false);
    if (!mal.correcto) expect(Object.keys(mal.errores)).toEqual(['aforo']);
  });
});

describe('orden de la lista', () => {
  it('por día, hora de inicio, nivel y, a igualdad, id', () => {
    const base = (id: string, extra: Partial<Clase>): Clase => ({
      ...CLASE,
      id: `c000000${id}-1111-4111-8111-111111111111`,
      ...extra,
    });
    const clases = [
      base('1', { diaSemana: 2, horaInicio: '08:00' }),
      base('2', { nivel: 'AVANZADO' }),
      base('3', { nivel: 'BASICO', horaInicio: '19:00' }),
      base('4', { nivel: 'INTERMEDIO' }),
      base('5', { nivel: 'BASICO' }),
    ];
    expect(ordenarClases(clases).map((clase) => clase.id.charAt(7))).toEqual(['5', '4', '2', '3', '1']);
  });
});
