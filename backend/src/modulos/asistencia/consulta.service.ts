import { Inject, Injectable } from '@nestjs/common';
import { type AsistenciaDelMes, asistenciaDelMesSchema, type MetodoAsistencia } from '@aquagestion/contratos';
import { anioYMesEnLima, horaEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { alumnoNoEncontrado } from '../alumnos';

interface FilaDeAsistenciaDelMes {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  llegada_en: Date;
  estado_llegada: 'PUNTUAL' | 'TARDE';
  metodo: MetodoAsistencia;
  registro_posterior: boolean;
  falta_cubierta: boolean;
}

interface FilaDeFaltaDelMes {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
}

/**
 * La asistencia de un alumno en un mes (spec 009b, criterio 31; D-08, D-23): las clases de su matrícula del mes (`VIGENTE` o `FINALIZADA`), cada asistencia
 * con su hora, estado y método, y cada falta sin cubrir, de la más antigua a la más nueva. Una falta cubierta aparece solo como su asistencia
 * (`faltaCubierta`). Sin DNI, sin motivo y sin quién registró. Una sola transacción de la academia de la sesión, sin bloqueos, sin escribir y sin auditar. Todo lo
 * que no se puede mostrar (un id que no es UUID, que no existe, de otra academia o de un `CLIENTE`) es el mismo 404 de la 008.
 */
@Injectable()
export class ConsultaDeAsistenciaService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** `mes` es `AAAA-MM` ya validado, o `undefined` para el mes en curso de Lima. */
  async delMes(academiaId: string, alumnoId: string, mes: string | undefined): Promise<AsistenciaDelMes> {
    if (!PATRON_UUID.test(alumnoId)) throw alumnoNoEncontrado();
    const { anio, mes: numeroDeMes } = mes === undefined ? anioYMesEnLima(this.reloj.ahora()) : partesDelMes(mes);
    const texto = `${String(anio).padStart(4, '0')}-${String(numeroDeMes).padStart(2, '0')}`;
    const desde = `${texto}-01`;

    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const alumnos = await tx.cliente.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM alumnos
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid AND estado <> 'CLIENTE'`;
      if (alumnos.length === 0) throw alumnoNoEncontrado();

      const matriculas = await tx.cliente.$queryRaw<{ clases_totales: number; clases_usadas: number }[]>`
        SELECT clases_totales::int AS clases_totales, clases_usadas::int AS clases_usadas
          FROM matriculas
         WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid
           AND anio = ${anio}::int AND mes = ${numeroDeMes}::int AND estado IN ('VIGENTE', 'FINALIZADA')
         ORDER BY (estado = 'VIGENTE') DESC, creado_en DESC, id
         LIMIT 1`;
      const asistencias = await tx.cliente.$queryRaw<FilaDeAsistenciaDelMes[]>`
        SELECT to_char(s.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(c.hora_fin, 'HH24:MI') AS hora_fin,
               s.llegada_en, s.estado_llegada::text AS estado_llegada, s.metodo::text AS metodo, s.registro_posterior,
               EXISTS (SELECT 1 FROM inasistencias i
                        WHERE i.academia_id = s.academia_id AND i.asistencia_id = s.id) AS falta_cubierta
          FROM asistencias s
          JOIN clases c ON c.academia_id = s.academia_id AND c.id = s.clase_id
         WHERE s.academia_id = ${tx.academiaId}::uuid AND s.alumno_id = ${alumnoId}::uuid
           AND s.fecha >= ${desde}::date AND s.fecha < (${desde}::date + INTERVAL '1 month')
         ORDER BY s.fecha, s.llegada_en, s.id`;
      const faltas = await tx.cliente.$queryRaw<FilaDeFaltaDelMes[]>`
        SELECT to_char(i.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(c.hora_fin, 'HH24:MI') AS hora_fin
          FROM inasistencias i
          JOIN clases c ON c.academia_id = i.academia_id AND c.id = i.clase_id
         WHERE i.academia_id = ${tx.academiaId}::uuid AND i.alumno_id = ${alumnoId}::uuid AND i.asistencia_id IS NULL
           AND i.fecha >= ${desde}::date AND i.fecha < (${desde}::date + INTERVAL '1 month')
         ORDER BY i.fecha, c.hora_inicio, i.id`;

      const registros = [
        ...asistencias.map((fila) => ({
          orden: `${fila.fecha}|${fila.hora_inicio}|0`,
          registro: {
            tipo: 'ASISTENCIA' as const,
            fecha: fila.fecha,
            clase: { horaInicio: fila.hora_inicio, horaFin: fila.hora_fin },
            horaLlegada: horaEnLima(fila.llegada_en),
            estadoLlegada: fila.estado_llegada,
            metodo: fila.metodo,
            registroPosterior: fila.registro_posterior,
            faltaCubierta: fila.falta_cubierta,
          },
        })),
        ...faltas.map((fila) => ({
          orden: `${fila.fecha}|${fila.hora_inicio}|1`,
          registro: {
            tipo: 'FALTA' as const,
            fecha: fila.fecha,
            clase: { horaInicio: fila.hora_inicio, horaFin: fila.hora_fin },
          },
        })),
      ]
        .sort((a, b) => (a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : 0))
        .map((elemento) => elemento.registro);

      const matricula = matriculas[0];
      return asistenciaDelMesSchema.parse({
        mes: texto,
        matricula: matricula
          ? {
              clasesTotales: matricula.clases_totales,
              clasesUsadas: matricula.clases_usadas,
              clasesRestantes: matricula.clases_totales - matricula.clases_usadas,
            }
          : null,
        registros,
      });
    });
  }
}

function partesDelMes(mes: string): { anio: number; mes: number } {
  const [anio = 0, numero = 0] = mes.split('-').map(Number);
  return { anio, mes: numero };
}
