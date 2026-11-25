import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { contarOcupacion } from '../matriculas';
import { sinCupo } from './errores';
import type { FilasDelCobro } from './bloqueos';

/**
 * Cada clase de la matrícula debe tener lugar para esta matrícula, que no ocupa cupo mientras está cancelada (criterios 18 c y 41 de 007): se
 * usa al cobrar o subir un comprobante de una solicitud `PAGO_RECHAZADO`. Con las clases ya bloqueadas (`bloquearClasesParaCupo`). Si alguna
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
  const ocupacion = await contarOcupacion(
    tx,
    filas.claseIds,
    { anio: filas.matricula.anio, mes: filas.matricula.mes },
    ahora,
  );
  const llenas = clases.filter((clase) => (ocupacion.get(clase.id) ?? 0) >= clase.aforo).map((clase) => clase.id);
  if (llenas.length > 0) throw sinCupo(filas.claseIds.filter((id) => llenas.includes(id)));
}
