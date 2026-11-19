import type { NivelNatacion } from '@aquagestion/contratos';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import type { TransaccionAcademia } from '../../infraestructura/prisma';

/** Una clase bloqueada para el cupo, en el formato de la API (horas `HH:MM` locales de Lima, sin zona). */
export interface ClaseBloqueada {
  id: string;
  nivel: NivelNatacion;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  aforo: number;
  activo: boolean;
  entrenadorId: string;
}

interface FilaClaseBloqueada {
  id: string;
  nivel: NivelNatacion;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  aforo: number;
  activo: boolean;
  entrenador_id: string;
}

/**
 * Bloquea las clases de `tx.academiaId` que estén en `claseIds` y devuelve su estado actual (spec 004, criterio 23; RN-11).
 *
 * Es la regla común del cupo: toda operación que ocupa, libera o mueve cupos (inscripción y su reserva, renovación, recuperación,
 * cambio de horario, asistencia en otro horario) y todo cambio del aforo o del estado de una clase la llama con todas las clases que
 * toca, en una sola llamada, después de `bloquearActorVigente` (si hay actor) y antes de contar la ocupación o escribir. Así dos
 * operaciones sobre el último cupo se ordenan, y ninguna cuenta con un aforo viejo. Nunca se bloquea una clase y después una fila de
 * `usuarios` con `FOR UPDATE` o `FOR SHARE`.
 *
 * Una sola sentencia, `ORDER BY id FOR UPDATE`: todas las transacciones toman las filas en el mismo orden y dos operaciones que piden
 * `[c1, c2]` y `[c2, c1]` no se esperan en cruz (`40P01`). Los ids de otra academia, los que no existen, los repetidos y los que no
 * son UUID no devuelven nada de más ni fallan; con una lista sin ids válidos no ejecuta ninguna sentencia. Es una función sin Nest,
 * como `leerConfiguracion`, para que las historias 005 a 020 la usen sin depender del módulo.
 */
export async function bloquearClasesParaCupo(
  tx: TransaccionAcademia,
  claseIds: readonly string[],
): Promise<ClaseBloqueada[]> {
  const ids = [...new Set(claseIds.filter((id) => PATRON_UUID.test(id)).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return [];
  // `clases.id` y no `id` en el ORDER BY: `id` sería la columna de salida (texto), que se ordena distinto de la columna uuid.
  const filas = await tx.cliente.$queryRaw<FilaClaseBloqueada[]>`
    SELECT clases.id::text AS id, clases.nivel::text AS nivel, clases.dia_semana::int AS dia_semana,
           to_char(clases.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(clases.hora_fin, 'HH24:MI') AS hora_fin,
           clases.aforo::int AS aforo, clases.activo, clases.entrenador_id::text AS entrenador_id
      FROM clases
     WHERE clases.academia_id = ${tx.academiaId}::uuid AND clases.id = ANY(${ids}::uuid[])
     ORDER BY clases.id
       FOR UPDATE`;
  return filas.map((fila) => ({
    id: fila.id,
    nivel: fila.nivel,
    diaSemana: fila.dia_semana,
    horaInicio: fila.hora_inicio,
    horaFin: fila.hora_fin,
    aforo: fila.aforo,
    activo: fila.activo,
    entrenadorId: fila.entrenador_id,
  }));
}
