import type { ClaseDeMensualidad, FilaDelListadoMensualidades } from '@aquagestion/contratos';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import type { MensualidadDeUnMes as MensualidadDeUnMesDe } from './dominio/mensualidad-elegida';
import { type MesDeCalendario, textoDelMes } from './dominio/ventana';

/**
 * La lectura de las mensualidades que decide el estado de un alumno (spec 010b, criterios 24 y 25; DT-4 de 011). La usan el listado de recepción y el panel del
 * alumno (011): con una sola lectura, el estado que ve recepción y el que ve el alumno no pueden separarse (criterio 10 de 011).
 */

export interface FilaDeMatricula {
  alumno_id: string;
  nombres: string;
  apellidos: string;
  nivel: FilaDelListadoMensualidades['nivel'];
  anio: number;
  mes: number;
  pagada: boolean;
  plan_id: string;
  plan_nombre: string;
  clases_usadas: number;
  clases_totales: number;
  /** `fecha_inicio` y `fecha_fin` de la matrícula, `AAAA-MM-DD` (el panel las muestra como `desde` y `hasta`). */
  desde: string;
  hasta: string;
  clases: ClaseDeMensualidad[];
}

/** Lo que se guarda de la mensualidad de un alumno en un mes: la pagada o, si no hay, la que está en verificación. */
export type MensualidadDeUnMes = MensualidadDeUnMesDe<FilaDeMatricula>;

/** `AAAA-MM` de un mes de calendario: la clave de `agruparPorMes`. */
export const claveDelMes = (mes: MesDeCalendario): string => textoDelMes(mes);

/** El número de mes desde el año 0 (`anio * 12 + mes − 1`): sirve para comparar meses y para la sentencia. */
export const indiceDelMes = ({ anio, mes }: MesDeCalendario): number => anio * 12 + mes - 1;

/**
 * Las matrículas de los meses dados de alumnos `ALUMNO_ACTIVO` o `ALUMNO_VENCIDO`: las pagadas (`VIGENTE` o `FINALIZADA`) y las que están en verificación
 * (`RESERVADA` sin vencimiento y con un pago `PENDIENTE_VERIFICACION`, RN-28), con el plan y las clases. Con `alumnoId`, solo las de ese alumno (el filtro va en
 * la sentencia, no en memoria). Siempre con `academia_id`; sin bloqueos. Un alumno `INACTIVO` o `CLIENTE` no devuelve filas.
 */
export async function leerMensualidadesParaEstado(
  tx: TransaccionAcademia,
  meses: readonly MesDeCalendario[],
  alumnoId: string | null,
): Promise<FilaDeMatricula[]> {
  const indices = meses.map(indiceDelMes);
  return tx.cliente.$queryRaw<FilaDeMatricula[]>`
      SELECT a.id::text AS alumno_id, a.nombres, a.apellidos, a.nivel::text AS nivel,
             m.anio::int AS anio, m.mes::int AS mes, (m.estado IN ('VIGENTE', 'FINALIZADA')) AS pagada,
             m.plan_id::text AS plan_id, p.nombre AS plan_nombre, m.clases_usadas::int AS clases_usadas, m.clases_totales::int AS clases_totales,
             to_char(m.fecha_inicio, 'YYYY-MM-DD') AS desde, to_char(m.fecha_fin, 'YYYY-MM-DD') AS hasta,
             COALESCE((
               SELECT json_agg(json_build_object('id', c.id::text, 'diaSemana', c.dia_semana::int,
                                                 'horaInicio', to_char(c.hora_inicio, 'HH24:MI'), 'horaFin', to_char(c.hora_fin, 'HH24:MI'))
                              ORDER BY c.dia_semana, c.hora_inicio, c.id)
                 FROM matricula_clases mc
                 JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
                WHERE mc.academia_id = m.academia_id AND mc.matricula_id = m.id), '[]'::json) AS clases
        FROM matriculas m
        JOIN alumnos a ON a.academia_id = m.academia_id AND a.id = m.alumno_id AND a.estado IN ('ALUMNO_ACTIVO', 'ALUMNO_VENCIDO')
        JOIN planes p ON p.academia_id = m.academia_id AND p.id = m.plan_id
       WHERE m.academia_id = ${tx.academiaId}::uuid
         AND (${alumnoId}::uuid IS NULL OR m.alumno_id = ${alumnoId}::uuid)
         AND (m.anio::int * 12 + m.mes::int - 1) = ANY(${indices}::int[])
         AND (m.estado IN ('VIGENTE', 'FINALIZADA')
              OR (m.estado = 'RESERVADA' AND m.reserva_vence_en IS NULL
                  AND EXISTS (SELECT 1 FROM pagos pg
                               WHERE pg.academia_id = m.academia_id AND pg.matricula_id = m.id AND pg.estado = 'PENDIENTE_VERIFICACION')))
       ORDER BY m.id`;
}

/**
 * Agrupa las filas por alumno y por mes (`AAAA-MM`). Si un alumno tiene una pagada y otra en verificación del mismo mes, manda la pagada (criterio 24);
 * entre dos del mismo tipo queda la primera de la lectura (orden por id).
 */
export function agruparPorMes(filas: readonly FilaDeMatricula[]): Map<string, Map<string, MensualidadDeUnMes>> {
  const porAlumno = new Map<string, Map<string, MensualidadDeUnMes>>();
  for (const fila of filas) {
    const meses = porAlumno.get(fila.alumno_id) ?? new Map<string, MensualidadDeUnMes>();
    porAlumno.set(fila.alumno_id, meses);
    const mes = claveDelMes({ anio: fila.anio, mes: fila.mes });
    const previa = meses.get(mes);
    if (previa === undefined || (fila.pagada && !previa.pagada)) meses.set(mes, { pagada: fila.pagada, fila });
  }
  return porAlumno;
}
