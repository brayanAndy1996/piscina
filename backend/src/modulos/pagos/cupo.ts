import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { cuposParaInscripcionNueva } from '../matriculas';
import { sinCupo } from './errores';
import type { FilasDelCobro } from './bloqueos';

/**
 * Cada clase de la matrícula debe tener lugar para esta matrícula, que no ocupa cupo mientras está cancelada (criterios 18 c y 41 de 007): se
 * usa al cobrar o subir un comprobante de una solicitud `PAGO_RECHAZADO`; el lugar es el de una inscripción nueva en el mes de la matrícula
 * (`cuposParaInscripcionNueva`: con las reservas de prioridad si es de M+1, 010d, criterio 10). Con las clases ya bloqueadas (`bloquearClasesParaCupo`). Si alguna
 * está llena, 409 `SIN_CUPO` con las clases sin cupo, en el orden de la matrícula.
 */
export async function exigirCupoDeLaMatricula(
  tx: TransaccionAcademia,
  filas: FilasDelCobro,
  ahora: Date,
): Promise<void> {
  const clases = await tx.cliente.$queryRaw<{ id: string; aforo: number }[]>`
    SELECT id::text AS id, aforo::int AS aforo FROM clases
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${[...filas.claseIds]}::uuid[])`;
  // El cupo libre para una inscripción nueva en el mes de la matrícula (010d, DT-8 y DT-9): con las reservas de prioridad si es de M+1 respecto de
  // «ahora». La matrícula está `CANCELADA`, así que no cuenta en su propia ocupación.
  const cupos = await cuposParaInscripcionNueva(
    tx,
    clases,
    { anio: filas.matricula.anio, mes: filas.matricula.mes },
    ahora,
  );
  const llenas = clases.filter((clase) => (cupos.get(clase.id) ?? 0) < 1).map((clase) => clase.id);
  if (llenas.length > 0) throw sinCupo(filas.claseIds.filter((id) => llenas.includes(id)));
}
