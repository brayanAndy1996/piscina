import { Inject, Injectable } from '@nestjs/common';
import {
  type EstadoSolicitud,
  type FiltroEstadoSolicitudes,
  type RespuestaListaSolicitudes,
  type RespuestaSolicitudPanel,
  type CancelarSolicitud,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { bloquearClasesParaCupo } from '../clases';
import { noEncontrado, solicitudConPagoPendiente, solicitudNoCancelable } from './errores';
import { estadoVisible } from './estado-visible';
import { leerElementosDelPanel } from './panel-solicitudes';

interface FilaBloqueadaDeLaSolicitud {
  estado: EstadoSolicitud;
}

interface FilaBloqueadaDeLaMatricula {
  id: string;
  estado: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  anio: number;
  mes: number;
}

interface FilaBloqueadaDelPago {
  estado: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO';
}

/**
 * El panel de solicitudes de inscripción (spec 005b, criterios 38 y 39; RN-22, RN-28; D-23). Todo corre con
 * `conAcademia(<academia de la sesión>, …)`: la academia nunca viene de la dirección, la consulta ni el cuerpo.
 *
 * - `listar`: lectura sin bloqueos ni auditoría. Las 200 solicitudes más recientes de la academia, filtradas por estado visible.
 * - `cancelar`: en una sola transacción, `bloquearActorVigente` → la solicitud `FOR UPDATE` → su matrícula `FOR UPDATE` → sus pagos `FOR UPDATE` →
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
    const solicitudes = await this.baseDatos.conAcademia(academiaId, (tx) =>
      leerElementosDelPanel(tx, ahora, { filtro }),
    );
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
        SELECT id::text AS id, estado::text AS estado, reserva_vence_en, anio::int AS anio, mes::int AS mes FROM matriculas
         WHERE academia_id = ${tx.academiaId}::uuid AND solicitud_id = ${id}::uuid
         ORDER BY id
           FOR UPDATE`;
      const matricula = matriculas[0];
      if (!matricula) throw noEncontrado();
      // Los pagos de la matrícula (007, criterio 30), después de la matrícula y antes de las clases: el orden de bloqueos de un cobro.
      // `ORDER BY registrado_en DESC, id DESC`: el primero es el último pago.
      const pagos = await tx.cliente.$queryRaw<FilaBloqueadaDelPago[]>`
        SELECT estado::text AS estado FROM pagos
         WHERE academia_id = ${tx.academiaId}::uuid AND matricula_id = ANY(${matriculas.map((fila) => fila.id)}::uuid[])
         ORDER BY registrado_en DESC, id DESC
           FOR UPDATE`;
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
          estado_ultimo_pago: pagos[0]?.estado ?? null,
          hay_pago_pendiente: pagos.some((pago) => pago.estado === 'PENDIENTE_VERIFICACION'),
          anio: matricula.anio,
          mes: matricula.mes,
        },
        ahora,
      );
      // Un comprobante en revisión (007b): primero se aprueba o se rechaza (DR-12).
      if (antes === 'EN_VERIFICACION') throw solicitudConPagoPendiente();
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
      const [elemento] = await leerElementosDelPanel(tx, ahora, { id });
      if (!elemento) throw noEncontrado();
      return { solicitud: elemento };
    });
  }
}
