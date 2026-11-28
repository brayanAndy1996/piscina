import { describe, expect, it } from 'vitest';
import { edadEnFecha, esMenorDeEdad, mensualidadDelPanelSchema, miPanelSchema, siguienteDelPanelSchema } from './index';

// Spec 011, criterio 17 (prueba obligatoria): los contratos del panel del alumno y la edad en una fecha.

const mensualidad = {
  mes: '2026-11',
  plan: { nombre: 'Plan 12 clases' },
  clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
  clasesUsadas: 5,
  clasesTotales: 12,
  clasesRestantes: 7,
  desde: '2026-11-01',
  hasta: '2026-11-30',
};

const panel = {
  hoy: '2026-11-24',
  mesEnCurso: '2026-11',
  alumno: { nombres: 'Alma', apellidos: 'Prueba', dni: '12345678', nivel: 'BASICO', edad: 11, estado: 'ALUMNO_ACTIVO' },
  mensualidad: {
    estado: 'AL_DIA',
    actual: mensualidad,
    siguiente: { ...mensualidad, mes: '2026-12', estado: 'PAGADA' },
  },
  mesesDeAsistencia: ['2026-11', '2026-10'],
};

describe('criterio 17: los esquemas del panel son estrictos', () => {
  it('aceptan la respuesta completa y la de un alumno sin mensualidad', () => {
    expect(miPanelSchema.safeParse(panel).success).toBe(true);
    expect(
      miPanelSchema.safeParse({
        ...panel,
        mensualidad: { estado: null, actual: null, siguiente: null },
        mesesDeAsistencia: ['2026-11'],
      }).success,
    ).toBe(true);
  });

  it('rechazan una clave de más en cualquier nivel (id, dni dentro de actual, apoderado)', () => {
    expect(miPanelSchema.safeParse({ ...panel, id: 'x' }).success).toBe(false);
    expect(miPanelSchema.safeParse({ ...panel, apoderado: { nombres: 'X' } }).success).toBe(false);
    expect(miPanelSchema.safeParse({ ...panel, alumno: { ...panel.alumno, id: 'x' } }).success).toBe(false);
    expect(
      miPanelSchema.safeParse({ ...panel, alumno: { ...panel.alumno, fechaNacimiento: '2015-01-01' } }).success,
    ).toBe(false);
    expect(
      miPanelSchema.safeParse({ ...panel, mensualidad: { ...panel.mensualidad, actual: { ...mensualidad, dni: '1' } } })
        .success,
    ).toBe(false);
    expect(mensualidadDelPanelSchema.safeParse({ ...mensualidad, plan: { nombre: 'A', id: 'x' } }).success).toBe(false);
    expect(
      mensualidadDelPanelSchema.safeParse({
        ...mensualidad,
        clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00', id: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('siguiente exige su estado (PAGADA o EN_VERIFICACION) y es estricta', () => {
    expect(siguienteDelPanelSchema.safeParse({ ...mensualidad, estado: 'PAGADA' }).success).toBe(true);
    expect(siguienteDelPanelSchema.safeParse({ ...mensualidad, estado: 'EN_VERIFICACION' }).success).toBe(true);
    expect(siguienteDelPanelSchema.safeParse(mensualidad).success).toBe(false);
    expect(siguienteDelPanelSchema.safeParse({ ...mensualidad, estado: 'VIGENTE' }).success).toBe(false);
    expect(siguienteDelPanelSchema.safeParse({ ...mensualidad, estado: 'PAGADA', id: 'x' }).success).toBe(false);
  });

  it('rechazan valores fuera de dominio', () => {
    expect(mensualidadDelPanelSchema.safeParse({ ...mensualidad, clasesUsadas: -1 }).success).toBe(false);
    expect(mensualidadDelPanelSchema.safeParse({ ...mensualidad, mes: '2026-13' }).success).toBe(false);
    expect(miPanelSchema.safeParse({ ...panel, mensualidad: { ...panel.mensualidad, estado: 'OTRO' } }).success).toBe(
      false,
    );
    expect(miPanelSchema.safeParse({ ...panel, alumno: { ...panel.alumno, estado: 'CLIENTE' } }).success).toBe(false);
  });
});

describe('criterio 17: edadEnFecha', () => {
  it.each([
    ['la víspera del cumpleaños', '2015-12-01', '2026-11-30', 10],
    ['el día del cumpleaños', '2014-12-01', '2026-12-01', 12],
    ['el día antes', '2014-12-01', '2026-11-30', 11],
    ['el día después', '2014-12-01', '2026-12-02', 12],
    ['nació hoy', '2026-11-24', '2026-11-24', 0],
    ['nació el 1 de enero y hoy es el 31/12', '2000-01-01', '2026-12-31', 26],
    ['nació el 31 de diciembre y hoy es el 1/1', '2000-12-31', '2026-01-01', 25],
  ])('%s', (_nombre, nacimiento, hoy, esperada) => {
    expect(edadEnFecha(nacimiento, hoy)).toBe(esperada);
  });

  it('el 29 de febrero: cumple el 29/2 en los años bisiestos y el 1/3 en los no bisiestos', () => {
    expect(edadEnFecha('2000-02-29', '2024-02-28')).toBe(23);
    expect(edadEnFecha('2000-02-29', '2024-02-29')).toBe(24);
    expect(edadEnFecha('2000-02-29', '2025-02-28')).toBe(24);
    expect(edadEnFecha('2000-02-29', '2025-03-01')).toBe(25);
    expect(edadEnFecha('2000-02-29', '2025-03-02')).toBe(25);
  });

  it('esMenorDeEdad(f, h) === (edadEnFecha(f, h) < 18) para 1 000 pares al azar', () => {
    let semilla = 20261128;
    const azar = (): number => {
      semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
      return semilla / 2 ** 32;
    };
    const fecha = (): string => {
      const anio = 1990 + Math.floor(azar() * 45);
      const mes = 1 + Math.floor(azar() * 12);
      const dia = 1 + Math.floor(azar() * 29);
      return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    };
    for (let i = 0; i < 1000; i += 1) {
      const [a, b] = [fecha(), fecha()].sort() as [string, string];
      // Nacimiento no posterior a hoy; algunos 29 de febrero reales.
      expect(esMenorDeEdad(a, b), `${a} → ${b}`).toBe(edadEnFecha(a, b) < 18);
    }
    for (const [a, b] of [
      ['2008-02-29', '2026-02-28'],
      ['2008-02-29', '2026-03-01'],
      ['2008-02-29', '2028-02-28'],
      ['2008-02-29', '2026-03-02'],
    ] as const) {
      expect(esMenorDeEdad(a, b), `${a} → ${b}`).toBe(edadEnFecha(a, b) < 18);
    }
  });
});
