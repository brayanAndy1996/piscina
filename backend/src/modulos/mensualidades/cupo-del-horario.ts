import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { contarOcupacion, contarReservasDePrioridad } from '../matriculas';
import { cupoLibre } from './dominio/cupo';
import { clasesDeLaTitularidad } from './lectura';

/**
 * El cupo libre de unas clases para el alumno que cambia el horario de una matrícula (spec 010c, criterios 36 y 46; D-06, RN-11, DT-4, DT-38). Lo usan el
 * cambio (`HorarioService.cambiar`, que exige 1 o más) y la lectura que alimenta la pantalla (`HorarioService.leer`, que muestra el cupo recortado a 0):
 * una sola cuenta, para que lo que la pantalla muestra y lo que el cambio decide no puedan diverger.
 *
 * Sin bloquear nada: en el cambio, quien llama ya bloqueó las clases con `bloquearClasesParaCupo` antes de contar. El cupo es el de la definición «Cupo
 * libre» sin contar la matrícula que se cambia: en las clases que la matrícula ya tiene (`propias`), su propio lugar se resta de la ocupación. En el mes
 * siguiente, las reservas de prioridad restan a quien no es titular de la clase y no a quien sí lo es (la matrícula de M `VIGENTE` que la incluye).
 */

export interface EntradaDelCupoDelHorario {
  readonly alumnoId: string;
  /** El mes de la matrícula que se cambia. */
  readonly mesDeLaMatricula: { readonly anio: number; readonly mes: number };
  /** El mes en curso de Lima (M) con el «ahora» de la operación. */
  readonly mesEnCurso: { readonly anio: number; readonly mes: number };
  readonly ahora: Date;
  /** Las clases que se miran, con su aforo (leído con bloqueo en el cambio, sin él en la lectura). */
  readonly clases: readonly { readonly id: string; readonly aforo: number }[];
  /** Los ids de las clases que la matrícula ya tiene (su propio lugar no cuenta). */
  readonly propias: ReadonlySet<string>;
}

export interface CuposDelHorario {
  /** El cupo libre de cada clase, que puede ser menor que 0 si el aforo bajó por debajo de los inscritos (DR-5 de 004). */
  readonly cupoLibrePorClase: ReadonlyMap<string, number>;
  /** ¿El mes de la matrícula es el mes siguiente a M? */
  readonly esMesSiguiente: boolean;
  /** Las clases en las que el alumno es titular de prioridad; vacío si la matrícula no es del mes siguiente. */
  readonly titulares: ReadonlySet<string>;
}

export async function cuposDelHorario(
  tx: TransaccionAcademia,
  entrada: EntradaDelCupoDelHorario,
): Promise<CuposDelHorario> {
  const { mesDeLaMatricula, mesEnCurso, ahora } = entrada;
  const ids = entrada.clases.map((clase) => clase.id);
  const esMesSiguiente = mesDeLaMatricula.anio !== mesEnCurso.anio || mesDeLaMatricula.mes !== mesEnCurso.mes;
  const ocupacion = await contarOcupacion(tx, ids, mesDeLaMatricula, ahora);
  const reservas = esMesSiguiente
    ? await contarReservasDePrioridad(tx, ids, mesEnCurso, ahora)
    : new Map<string, number>();
  const titulares = new Set(esMesSiguiente ? await clasesDeLaTitularidad(tx, entrada.alumnoId, mesEnCurso) : []);
  const cupoLibrePorClase = new Map(
    entrada.clases.map((clase) => [
      clase.id,
      cupoLibre({
        aforo: clase.aforo,
        ocupacion: (ocupacion.get(clase.id) ?? 0) - (entrada.propias.has(clase.id) ? 1 : 0),
        reservas: reservas.get(clase.id) ?? 0,
        esTitular: titulares.has(clase.id),
        esMesSiguiente,
      }),
    ]),
  );
  return { cupoLibrePorClase, esMesSiguiente, titulares };
}
