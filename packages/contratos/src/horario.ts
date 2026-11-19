import { z } from 'zod';

/**
 * Niveles, días, bloques y fechas de la academia (spec 004). Los comparten los planes, las clases y las historias siguientes
 * (inscripción, asistencia, evaluaciones). Los días van de 1 (lunes) a 7 (domingo), como en ISO 8601; los bloques son horas
 * locales de Lima de 1 hora, de 08:00 a 20:00 (RN-09).
 */

/** Niveles de natación en el orden en que se muestran y se ordenan (D-15). */
export const NIVELES = ['BASICO', 'INTERMEDIO', 'AVANZADO'] as const;
export type NivelNatacion = (typeof NIVELES)[number];
export const nivelNatacionSchema = z.enum(NIVELES);

/** Nombre de cada nivel para mostrarlo en pantalla. */
export const NOMBRE_NIVEL: Readonly<Record<NivelNatacion, string>> = {
  BASICO: 'Básico',
  INTERMEDIO: 'Intermedio',
  AVANZADO: 'Avanzado',
};

/** Los días de la semana de 1 (lunes) a 7 (domingo). */
export const DIAS_SEMANA = [1, 2, 3, 4, 5, 6, 7] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];
export const NOMBRE_DIA: Readonly<Record<DiaSemana, string>> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

function esDiaSemana(valor: number): valor is DiaSemana {
  return (DIAS_SEMANA as readonly number[]).includes(valor);
}

/** Un día de la semana: entero de 1 a 7. Estricto: un texto con dígitos, un decimal o `null` no se convierten. */
export const diaSemanaSchema = z
  .number('El día debe ser un número entero de 1 a 7.')
  .int('El día debe ser un número entero de 1 a 7.')
  .min(1, 'El día debe ser de 1 (lunes) a 7 (domingo).')
  .max(7, 'El día debe ser de 1 (lunes) a 7 (domingo).')
  // Solo estrecha el tipo a `DiaSemana` (1 a 7): no agrega mensajes, porque corre únicamente si lo anterior no encontró errores.
  .refine(esDiaSemana, { when: (carga) => carga.issues === undefined || carga.issues.length === 0 });

/** Horas de inicio de los bloques de 1 hora (RN-09), en el formato `HH:MM` de la API. */
export const BLOQUES = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
] as const;
export type Bloque = (typeof BLOQUES)[number];

/**
 * Un bloque de 1 hora por su hora de inicio: `"08:00"` a `"19:00"`, exactamente en ese formato (`"8:00"`, `"08:30"`,
 * `"08:00:00"` y `"20:00"` no valen).
 */
export const horaBloqueSchema = z.enum(BLOQUES, 'La hora debe ser un bloque de 1 hora, de 08:00 a 19:00.');

/** Hora en que termina el bloque: una hora después de su inicio (`"19:00"` termina a las `"20:00"`). */
export function horaFinDe(bloque: Bloque): string {
  const hora = Number(bloque.slice(0, 2)) + 1;
  return `${String(hora).padStart(2, '0')}:00`;
}

const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` si el texto es una fecha real `AAAA-MM-DD` (por ejemplo, `2026-02-30` no lo es). Sin zona horaria. */
export function esFechaReal(texto: string): boolean {
  const partes = PATRON_FECHA.exec(texto);
  if (!partes) return false;
  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  // PostgreSQL no tiene año 0; y `setUTCFullYear` con las tres partes no desplaza los años 0 a 99 como lo hace `Date.UTC`.
  if (anio < 1) return false;
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio, mes - 1, dia);
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/** Una fecha de calendario `AAAA-MM-DD` real, sin hora ni zona. */
export const fechaSchema = z
  .string('La fecha debe ser un texto AAAA-MM-DD.')
  .regex(PATRON_FECHA, 'La fecha debe tener el formato AAAA-MM-DD.')
  .refine(esFechaReal, { message: 'La fecha no existe en el calendario.' });
