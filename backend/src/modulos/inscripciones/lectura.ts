import type { Bloque, DiaSemana, NivelNatacion } from '@aquagestion/contratos';
import { aTextoMonto } from '../../comun/dinero';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { type DatosDePlan, normalizarPlan } from '../planes/dominio/plan';

/**
 * Lecturas de la oferta pública (spec 005, criterios 6, 11 y 15): planes y clases de la academia de `tx`, sin bloquear nada (la
 * cotización y el formulario son informativos: el cupo se decide al enviar, con las clases bloqueadas, D3 de 005).
 */

interface FilaPlan {
  id: string;
  nombre: string;
  veces_por_semana: number;
  clases_por_mes: number;
  duracion_minutos: number;
  precio: string;
  dias_permitidos: DiaSemana[];
  franjas_permitidas: Bloque[];
  niveles_aplicables: NivelNatacion[];
  vigencia_inicio: string | null;
  vigencia_fin: string | null;
  activo: boolean;
}

export type PlanLeido = DatosDePlan & { id: string };

function aPlan(fila: FilaPlan): PlanLeido {
  return {
    id: fila.id,
    ...normalizarPlan({
      nombre: fila.nombre,
      vecesPorSemana: fila.veces_por_semana,
      clasesPorMes: fila.clases_por_mes,
      duracionMinutos: fila.duracion_minutos,
      precio: aTextoMonto(fila.precio),
      diasPermitidos: fila.dias_permitidos,
      franjasPermitidas: fila.franjas_permitidas,
      nivelesAplicables: fila.niveles_aplicables,
      vigenciaInicio: fila.vigencia_inicio,
      vigenciaFin: fila.vigencia_fin,
      activo: fila.activo,
    }),
  };
}

/** Todos los planes de la academia (activos e inactivos): quien llama filtra los que se ofrecen con `estadoDelPlan`. */
export async function leerPlanes(tx: TransaccionAcademia): Promise<PlanLeido[]> {
  const filas = await tx.cliente.$queryRaw<FilaPlan[]>`
    SELECT id::text AS id, nombre, veces_por_semana::int AS veces_por_semana, clases_por_mes::int AS clases_por_mes,
           duracion_minutos::int AS duracion_minutos, precio::text AS precio, dias_permitidos::int[] AS dias_permitidos,
           coalesce((SELECT array_agg(to_char(f.hora, 'HH24:MI') ORDER BY f.orden)
                       FROM unnest(franjas_permitidas) WITH ORDINALITY AS f(hora, orden)), '{}'::text[]) AS franjas_permitidas,
           niveles_aplicables::text[] AS niveles_aplicables,
           to_char(vigencia_inicio, 'YYYY-MM-DD') AS vigencia_inicio, to_char(vigencia_fin, 'YYYY-MM-DD') AS vigencia_fin,
           activo
      FROM planes WHERE academia_id = ${tx.academiaId}::uuid`;
  return filas.map(aPlan);
}

/** Un plan de la academia, o `null` si no existe, es de otra academia o el id no es un UUID (el mismo resultado en los tres casos). */
export async function leerPlan(tx: TransaccionAcademia, id: string): Promise<PlanLeido | null> {
  if (!PATRON_UUID.test(id)) return null;
  const filas = await tx.cliente.$queryRaw<FilaPlan[]>`
    SELECT id::text AS id, nombre, veces_por_semana::int AS veces_por_semana, clases_por_mes::int AS clases_por_mes,
           duracion_minutos::int AS duracion_minutos, precio::text AS precio, dias_permitidos::int[] AS dias_permitidos,
           coalesce((SELECT array_agg(to_char(f.hora, 'HH24:MI') ORDER BY f.orden)
                       FROM unnest(franjas_permitidas) WITH ORDINALITY AS f(hora, orden)), '{}'::text[]) AS franjas_permitidas,
           niveles_aplicables::text[] AS niveles_aplicables,
           to_char(vigencia_inicio, 'YYYY-MM-DD') AS vigencia_inicio, to_char(vigencia_fin, 'YYYY-MM-DD') AS vigencia_fin,
           activo
      FROM planes WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id.toLowerCase()}::uuid`;
  const fila = filas[0];
  return fila ? aPlan(fila) : null;
}

/** Una clase tal como la necesitan la oferta y la validación: con su aforo y su estado (nunca se expone el aforo al público). */
export interface ClaseLeida {
  id: string;
  nivel: NivelNatacion;
  diaSemana: DiaSemana;
  horaInicio: Bloque;
  horaFin: string;
  aforo: number;
  activo: boolean;
}

interface FilaClase {
  id: string;
  nivel: NivelNatacion;
  dia_semana: DiaSemana;
  hora_inicio: Bloque;
  hora_fin: string;
  aforo: number;
  activo: boolean;
}

function aClase(fila: FilaClase): ClaseLeida {
  return {
    id: fila.id,
    nivel: fila.nivel,
    diaSemana: fila.dia_semana,
    horaInicio: fila.hora_inicio,
    horaFin: fila.hora_fin,
    aforo: fila.aforo,
    activo: fila.activo,
  };
}

/** Las clases activas de la academia. */
export async function leerClasesActivas(tx: TransaccionAcademia): Promise<ClaseLeida[]> {
  const filas = await tx.cliente.$queryRaw<FilaClase[]>`
    SELECT id::text AS id, nivel::text AS nivel, dia_semana::int AS dia_semana,
           to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fin, 'HH24:MI') AS hora_fin, aforo::int AS aforo, activo
      FROM clases WHERE academia_id = ${tx.academiaId}::uuid AND activo`;
  return filas.map(aClase);
}

/**
 * Las clases de la academia que están en `claseIds` (sin bloquearlas): las de otra academia, las que no existen y los ids que no son UUID
 * no vuelven. Solo para la cotización; el envío las bloquea con `bloquearClasesParaCupo`.
 */
export async function leerClasesPorIds(tx: TransaccionAcademia, claseIds: readonly string[]): Promise<ClaseLeida[]> {
  const ids = [...new Set(claseIds.filter((id) => PATRON_UUID.test(id)).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return [];
  const filas = await tx.cliente.$queryRaw<FilaClase[]>`
    SELECT id::text AS id, nivel::text AS nivel, dia_semana::int AS dia_semana,
           to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fin, 'HH24:MI') AS hora_fin, aforo::int AS aforo, activo
      FROM clases WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${ids}::uuid[])`;
  return filas.map(aClase);
}
