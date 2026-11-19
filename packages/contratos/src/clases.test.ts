import { describe, expect, it } from 'vitest';
import { actualizarClaseSchema, claseSchema, crearClaseSchema } from './clases';

const ENTRENADOR = '3f2b8f0e-6a6c-4c1e-9a53-0d1c2b3a4e5f';
const CLASE = { nivel: 'BASICO', diaSemana: 1, horaInicio: '08:00', entrenadorId: ENTRENADOR, aforo: 30 };

describe('crearClaseSchema (spec 004, criterios 16, 17 y 18)', () => {
  it('acepta una clase válida, también la del último bloque', () => {
    expect(crearClaseSchema.safeParse(CLASE).success).toBe(true);
    expect(crearClaseSchema.safeParse({ ...CLASE, horaInicio: '19:00', diaSemana: 7 }).success).toBe(true);
  });

  it.each([
    ['horaInicio 07:00', { horaInicio: '07:00' }],
    ['horaInicio 20:00', { horaInicio: '20:00' }],
    ['horaInicio 08:30', { horaInicio: '08:30' }],
    ['horaInicio 8:00', { horaInicio: '8:00' }],
    ['horaInicio 08:00:00', { horaInicio: '08:00:00' }],
    ['horaInicio 24:00', { horaInicio: '24:00' }],
    ['diaSemana 0', { diaSemana: 0 }],
    ['diaSemana 8', { diaSemana: 8 }],
    ['diaSemana "1"', { diaSemana: '1' }],
    ['nivel desconocido', { nivel: 'EXPERTO' }],
    ['entrenadorId que no es UUID', { entrenadorId: 'no-es-un-uuid' }],
    ['horaFin enviada', { horaFin: '09:00' }],
    ['activo enviado', { activo: false }],
    ['academiaId', { academiaId: ENTRENADOR }],
  ])('rechaza %s', (_nombre, cambio) => {
    expect(crearClaseSchema.safeParse({ ...CLASE, ...cambio }).success).toBe(false);
  });
});

describe('actualizarClaseSchema (spec 004, criterio 21)', () => {
  it('acepta entrenadorId, aforo y activo, juntos o por separado', () => {
    expect(actualizarClaseSchema.safeParse({ aforo: 20 }).success).toBe(true);
    expect(actualizarClaseSchema.safeParse({ activo: false }).success).toBe(true);
    expect(actualizarClaseSchema.safeParse({ entrenadorId: ENTRENADOR }).success).toBe(true);
    expect(actualizarClaseSchema.safeParse({ entrenadorId: ENTRENADOR, aforo: 50, activo: true }).success).toBe(true);
  });

  it('rechaza {}, el nivel, el día, la hora y cualquier otro campo', () => {
    for (const cuerpo of [
      {},
      { nivel: 'AVANZADO' },
      { diaSemana: 2 },
      { horaInicio: '09:00' },
      { aforo: 30, horaFin: '10:00' },
      { aforo: 30, academiaId: ENTRENADOR },
      { entrenadorId: 'x' },
      { activo: 1 },
    ]) {
      expect(actualizarClaseSchema.safeParse(cuerpo).success, JSON.stringify(cuerpo)).toBe(false);
    }
  });
});

describe('claseSchema', () => {
  it('describe la respuesta de la API, con la hora de fin de las 19:00 a las 20:00', () => {
    const resultado = claseSchema.safeParse({
      id: ENTRENADOR,
      nivel: 'INTERMEDIO',
      diaSemana: 3,
      horaInicio: '19:00',
      horaFin: '20:00',
      aforo: 25,
      activo: true,
      entrenador: { id: ENTRENADOR, nombres: 'Ana', apellidos: 'Pérez', activo: true },
    });

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });
});
