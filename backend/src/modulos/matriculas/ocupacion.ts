import { hoyEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import type { TransaccionAcademia } from '../../infraestructura/prisma';

/**
 * Ocupación de las clases (spec 005, criterios 6, 17, 20, 41 y 42; RN-11, RN-28). Una matrícula ocupa cupo en el mes M si es de M y
 * está `VIGENTE`, o `RESERVADA` con `reserva_vence_en` nula (pago en verificación, sin vencimiento) o posterior a "ahora". La reserva
 * que ya venció no ocupa nada: se calcula al leer, sin tarea programada (D1 de 005), con el "ahora" del reloj inyectable y nunca con
 * `now()`.
 *
 * Son funciones sin Nest (como `bloquearClasesParaCupo`): cuentan sin bloquear. Quien llama ya bloqueó las clases con
 * `bloquearClasesParaCupo` (en una sola llamada, antes de contar o escribir): toda escritura que cambia la ocupación de una clase pasa
 * por ese mismo bloqueo, así que la cuenta no se mueve mientras se decide.
 */

function idsValidos(claseIds: readonly string[]): string[] {
  return [...new Set(claseIds.filter((id) => PATRON_UUID.test(id)).map((id) => id.toLowerCase()))];
}

interface FilaOcupacion {
  clase_id: string;
  ocupacion: number;
}

/**
 * Cuántas matrículas que ocupan cupo en el mes `mes` incluyen a cada clase. Devuelve una entrada por cada id válido de la academia de
 * `tx` (0 si no tiene matrículas); los ids de otra academia o que no son UUID no cuentan nada.
 */
export async function contarOcupacion(
  tx: TransaccionAcademia,
  claseIds: readonly string[],
  mes: { anio: number; mes: number },
  ahora: Date,
): Promise<Map<string, number>> {
  const ids = idsValidos(claseIds);
  const mapa = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return mapa;
  const filas = await tx.cliente.$queryRaw<FilaOcupacion[]>`
    SELECT mc.clase_id::text AS clase_id, count(*)::int AS ocupacion
      FROM matricula_clases mc
      JOIN matriculas m ON m.academia_id = mc.academia_id AND m.id = mc.matricula_id
     WHERE mc.academia_id = ${tx.academiaId}::uuid AND mc.clase_id = ANY(${ids}::uuid[])
       AND m.anio = ${mes.anio}::smallint AND m.mes = ${mes.mes}::smallint
       AND (m.estado = 'VIGENTE'::estado_matricula
            OR (m.estado = 'RESERVADA'::estado_matricula
                AND (m.reserva_vence_en IS NULL OR m.reserva_vence_en > ${ahora}::timestamptz)))
     GROUP BY mc.clase_id`;
  for (const fila of filas) mapa.set(fila.clase_id, fila.ocupacion);
  return mapa;
}

/**
 * Los inscritos de cada clase para DR-5 de 004: la mayor ocupación de la clase entre el mes en curso (el de la fecha de Lima de `ahora`)
 * y los meses siguientes. Los meses pasados no cuentan.
 */
export async function contarInscritos(
  tx: TransaccionAcademia,
  claseIds: readonly string[],
  ahora: Date,
): Promise<Map<string, number>> {
  const ids = idsValidos(claseIds);
  const mapa = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return mapa;
  const [anioTexto = '0', mesTexto = '0'] = hoyEnLima(ahora).split('-');
  const anio = Number(anioTexto);
  const mes = Number(mesTexto);
  const filas = await tx.cliente.$queryRaw<FilaOcupacion[]>`
    SELECT por_mes.clase_id, max(por_mes.ocupacion)::int AS ocupacion
      FROM (SELECT mc.clase_id::text AS clase_id, m.anio, m.mes, count(*)::int AS ocupacion
              FROM matricula_clases mc
              JOIN matriculas m ON m.academia_id = mc.academia_id AND m.id = mc.matricula_id
             WHERE mc.academia_id = ${tx.academiaId}::uuid AND mc.clase_id = ANY(${ids}::uuid[])
               AND (m.anio::int, m.mes::int) >= (${anio}::int, ${mes}::int)
               AND (m.estado = 'VIGENTE'::estado_matricula
                    OR (m.estado = 'RESERVADA'::estado_matricula
                        AND (m.reserva_vence_en IS NULL OR m.reserva_vence_en > ${ahora}::timestamptz)))
             GROUP BY mc.clase_id, m.anio, m.mes) AS por_mes
     GROUP BY por_mes.clase_id`;
  for (const fila of filas) mapa.set(fila.clase_id, fila.ocupacion);
  return mapa;
}
