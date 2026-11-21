import { Inject, Injectable } from '@nestjs/common';
import {
  type EstadoSolicitud,
  esMenorDeEdad,
  type FiltroEstadoSolicitudes,
  type RespuestaListaSolicitudes,
  type RespuestaSolicitudPanel,
  type SolicitudPanel,
  type CancelarSolicitud,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { hoyEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos, type Fragmento, sql, type TransaccionAcademia, vacio } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { bloquearClasesParaCupo } from '../clases';
import { noEncontrado, solicitudNoCancelable } from './errores';
import { estadoVisible, estadoVisibleSql } from './estado-visible';

/** Cuántas solicitudes trae la lista como mucho (criterio 38): las más recientes después de filtrar. */
export const TOPE_DE_LA_LISTA = 200;

/** El estado visible que corresponde a cada filtro de la lista (`TODAS` no filtra). */
const ESTADO_DEL_FILTRO: Readonly<Record<Exclude<FiltroEstadoSolicitudes, 'TODAS'>, EstadoSolicitud>> = {
  ACTIVAS: 'PENDIENTE_PAGO',
  VENCIDAS: 'VENCIDA',
  CANCELADAS: 'CANCELADA',
};

interface FilaDeLaLista {
  id: string;
  codigo: string;
  estado_solicitud: EstadoSolicitud;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  creada_en: Date;
  reserva_vence_en: Date | null;
  nombres: string;
  apellidos: string;
  dni: string;
  telefono: string;
  fecha_nacimiento: string;
  plan_id: string;
  plan_nombre: string;
  anio: number;
  mes: number;
  clases_totales: number;
  monto: string;
  /** JSON de las clases (`jsonb` como texto): `[{ id, nivel, diaSemana, horaInicio, horaFin }]`. */
  clases: string;
}

interface FilaBloqueadaDeLaSolicitud {
  estado: EstadoSolicitud;
}

interface FilaBloqueadaDeLaMatricula {
  id: string;
  estado: FilaDeLaLista['estado_matricula'];
  reserva_vence_en: Date | null;
}

/**
 * El panel de solicitudes de inscripción (spec 005b, criterios 38 y 39; RN-22, RN-28; D-23). Todo corre con
 * `conAcademia(<academia de la sesión>, …)`: la academia nunca viene de la dirección, la consulta ni el cuerpo.
 *
 * - `listar`: lectura sin bloqueos ni auditoría. Las 200 solicitudes más recientes de la academia, filtradas por estado visible.
 * - `cancelar`: en una sola transacción, `bloquearActorVigente` → la solicitud `FOR UPDATE` → su matrícula `FOR UPDATE` →
 *   `bloquearClasesParaCupo` con sus clases (una llamada). No toma `alumnos` ni los bloqueos consultivos del envío, así que no entra en
 *   ciclo con el envío (alumno → solicitudes → matrículas → clases) ni con la foto (alumno → solicitud). No envía correo ni toca la foto
 *   (DR-17 y DR-18).
 */
@Injectable()
export class SolicitudesService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(SolicitudesService.name);
  }

  /** `GET /api/solicitudes?estado=`: de la más nueva a la más antigua (`creadaEn` y, a igual `creadaEn`, `id`), como mucho 200. */
  async listar(academiaId: string, filtro: FiltroEstadoSolicitudes): Promise<RespuestaListaSolicitudes> {
    const ahora = this.reloj.ahora();
    const solicitudes = await this.baseDatos.conAcademia(academiaId, (tx) => this.leerElementos(tx, ahora, { filtro }));
    return { solicitudes };
  }

  /**
   * `POST /api/solicitudes/{id}/cancelar` (criterio 39). Una solicitud `PENDIENTE_PAGO` (vencida o no) pasa a `CANCELADA` y su matrícula
   * `RESERVADA`, a `CANCELADA` con `reserva_vence_en` nulo (lo exige `matriculas_reserva_coherente`): el cupo se libera en ese momento.
   * Una ya `CANCELADA` responde 200 sin escribir ni auditar; la fila `VENCIDA` del criterio 21 b, 409 `SOLICITUD_NO_CANCELABLE`; un id
   * que no es UUID, que no existe o de otra academia, 404 `NO_ENCONTRADO` (el mismo cuerpo).
   */
  async cancelar(
    sesion: SesionVerificada,
    idPedido: string,
    datos: CancelarSolicitud,
    ip: string | null,
  ): Promise<RespuestaSolicitudPanel> {
    const actor = actorDeSesion(sesion);
    return this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
      const id = idPedido.toLowerCase();

      const solicitudes = await tx.cliente.$queryRaw<FilaBloqueadaDeLaSolicitud[]>`
        SELECT estado::text AS estado FROM solicitudes_inscripcion
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid
           FOR UPDATE`;
      const solicitud = solicitudes[0];
      if (!solicitud) throw noEncontrado();
      const matriculas = await tx.cliente.$queryRaw<FilaBloqueadaDeLaMatricula[]>`
        SELECT id::text AS id, estado::text AS estado, reserva_vence_en FROM matriculas
         WHERE academia_id = ${tx.academiaId}::uuid AND solicitud_id = ${id}::uuid
         ORDER BY id
           FOR UPDATE`;
      const matricula = matriculas[0];
      if (!matricula) throw noEncontrado();
      const clases = await tx.cliente.$queryRaw<{ clase_id: string }[]>`
        SELECT DISTINCT clase_id::text AS clase_id FROM matricula_clases
         WHERE academia_id = ${tx.academiaId}::uuid AND matricula_id = ANY(${matriculas.map((fila) => fila.id)}::uuid[])`;
      await bloquearClasesParaCupo(
        tx,
        clases.map((fila) => fila.clase_id),
      );

      const ahora = this.reloj.ahora();
      const antes = estadoVisible(
        {
          estado_solicitud: solicitud.estado,
          estado_matricula: matricula.estado,
          reserva_vence_en: matricula.reserva_vence_en,
        },
        ahora,
      );
      if (antes !== 'CANCELADA') {
        // La fila `VENCIDA` (la solicitud anterior de un cliente que volvió) ya no es `PENDIENTE_PAGO` ni `CANCELADA`: no se cancela.
        if (solicitud.estado !== 'PENDIENTE_PAGO') throw solicitudNoCancelable();
        await tx.cliente.$executeRaw`
          UPDATE solicitudes_inscripcion SET estado = 'CANCELADA'::estado_solicitud, actualizado_en = ${ahora}::timestamptz
           WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid`;
        await tx.cliente.$executeRaw`
          UPDATE matriculas SET estado = 'CANCELADA'::estado_matricula, reserva_vence_en = NULL, actualizado_en = ${ahora}::timestamptz
           WHERE academia_id = ${tx.academiaId}::uuid AND solicitud_id = ${id}::uuid AND estado = 'RESERVADA'::estado_matricula`;
        await this.auditoria.registrarEnAcademia(tx, {
          actorTipo: 'USUARIO',
          actorId: actor.id,
          accion: 'SOLICITUD_INSCRIPCION_CANCELADA',
          entidad: 'solicitud_inscripcion',
          entidadId: id,
          motivo: datos.motivo,
          datosAntes: { estado: antes },
          datosDespues: { estado: 'CANCELADA' },
          ip,
        });
      }
      const [elemento] = await this.leerElementos(tx, ahora, { id });
      if (!elemento) throw noEncontrado();
      return { solicitud: elemento };
    });
  }

  /**
   * Los elementos del panel (criterio 38) con una sola consulta: la solicitud, el alumno, la matrícula (`m.solicitud_id = s.id`), el plan y
   * las clases (por día y hora). Con `id`, solo esa solicitud; con `filtro`, las de ese estado visible, de la más nueva a la más antigua y
   * hasta el tope. Los datos de la persona son los que tiene hoy el alumno (no hay historial); el plan, las clases, el mes y el monto son
   * los de la matrícula de la solicitud.
   */
  private async leerElementos(
    tx: TransaccionAcademia,
    ahora: Date,
    pedido: { filtro: FiltroEstadoSolicitudes } | { id: string },
  ): Promise<SolicitudPanel[]> {
    let condicion: Fragmento = vacio;
    let tope: Fragmento = vacio;
    if ('id' in pedido) {
      condicion = sql`AND s.id = ${pedido.id}::uuid`;
    } else {
      if (pedido.filtro !== 'TODAS')
        condicion = sql`AND ${estadoVisibleSql(ahora)} = ${ESTADO_DEL_FILTRO[pedido.filtro]}`;
      tope = sql`LIMIT ${TOPE_DE_LA_LISTA}::int`;
    }
    const filas = await tx.cliente.$queryRaw<FilaDeLaLista[]>`
      SELECT s.id::text AS id, s.codigo, s.estado::text AS estado_solicitud, m.estado::text AS estado_matricula,
             s.creado_en AS creada_en, m.reserva_vence_en, a.nombres, a.apellidos, a.dni, a.telefono,
             a.fecha_nacimiento::text AS fecha_nacimiento, p.id::text AS plan_id, p.nombre AS plan_nombre,
             m.anio::int AS anio, m.mes::int AS mes, m.clases_totales::int AS clases_totales,
             coalesce(m.monto_ajustado, m.monto_calculado)::text AS monto,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id::text, 'nivel', c.nivel::text, 'diaSemana', c.dia_semana::int,
                                                           'horaInicio', to_char(c.hora_inicio, 'HH24:MI'),
                                                           'horaFin', to_char(c.hora_fin, 'HH24:MI'))
                                       ORDER BY c.dia_semana, c.hora_inicio, c.id), '[]'::jsonb)::text
                FROM matricula_clases mc
                JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
               WHERE mc.academia_id = s.academia_id AND mc.matricula_id = m.id) AS clases
        FROM solicitudes_inscripcion s
        JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
        JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
        JOIN planes p ON p.academia_id = m.academia_id AND p.id = m.plan_id
       WHERE s.academia_id = ${tx.academiaId}::uuid ${condicion}
       ORDER BY s.creado_en DESC, s.id DESC
       ${tope}`;
    const hoy = hoyEnLima(ahora);
    return filas.map((fila) => {
      const estado = estadoVisible(fila, ahora);
      return {
        id: fila.id,
        codigo: fila.codigo,
        estado,
        creadaEn: fila.creada_en.toISOString(),
        reservaVenceEn:
          estado === 'PENDIENTE_PAGO' && fila.reserva_vence_en ? fila.reserva_vence_en.toISOString() : null,
        nombres: fila.nombres,
        apellidos: fila.apellidos,
        dni: fila.dni,
        telefono: fila.telefono,
        menorDeEdad: esMenorDeEdad(fila.fecha_nacimiento, hoy),
        plan: { id: fila.plan_id, nombre: fila.plan_nombre },
        clases: JSON.parse(fila.clases) as SolicitudPanel['clases'],
        mes: `${fila.anio}-${String(fila.mes).padStart(2, '0')}`,
        clasesTotales: fila.clases_totales,
        monto: fila.monto,
      };
    });
  }
}
