import { Inject, Injectable } from '@nestjs/common';
import {
  type ConsultarSolicitud,
  PATRON_CODIGO,
  PATRON_TOKEN,
  type RespuestaConsultaSolicitud,
  type VistaSolicitud,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { BaseDatos, type AcademiaResuelta, type Fragmento, sql } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { leerConfiguracion } from '../configuracion/lectura';
import { hashDeToken } from './dominio/codigos';
import { solicitudNoEncontrada } from './errores';

interface FilaVista {
  codigo: string;
  estado_solicitud: 'PENDIENTE_PAGO' | 'VENCIDA' | 'CANCELADA';
  creada_en: Date;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  nombres: string;
  foto_cargada: boolean;
  plan: string;
  anio: number;
  mes: number;
  clases_totales: number;
  monto: string;
  es_proporcional: boolean;
  /** JSON de las clases (`jsonb` como texto): `[{ nivel, diaSemana, horaInicio, horaFin }]`. */
  clases: string;
}

const PATRON_DNI = /^[0-9]{8}$/;

/**
 * Seguimiento de la solicitud (spec 005, criterios 29 a 32; D-05, D-27). Consulta con el token (que viaja en el cuerpo, nunca en la
 * dirección) o con el código y el DNI. La academia es la del nombre corto de la dirección: un token o un código de otra academia no
 * existe. Todo lo que no encuentra una solicitud (formato inválido, token o código inexistentes, código con otro DNI) responde el mismo
 * 404 `SOLICITUD_NO_ENCONTRADA` con el mismo cuerpo. Solo lee: no escribe, no audita y no cambia el estado de la fila (el vencimiento
 * se calcula al leer, criterio 20). Muestra la vista mínima (criterio 32), nunca datos personales ni médicos.
 */
@Injectable()
export class SeguimientoService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(SeguimientoService.name);
  }

  async consultar(academia: AcademiaResuelta, datos: ConsultarSolicitud): Promise<RespuestaConsultaSolicitud> {
    const ahora = this.reloj.ahora();
    const busqueda = 'token' in datos ? this.porToken(datos.token) : this.porCodigoYDni(datos.codigo, datos.dni);
    if (busqueda === null) throw solicitudNoEncontrada();
    return this.baseDatos.conAcademia(academia.id, async (tx) => {
      // Una sola consulta con todas las condiciones y con la vista ya armada.
      const filas = await tx.cliente.$queryRaw<FilaVista[]>`
        SELECT s.codigo, s.estado::text AS estado_solicitud, s.creado_en AS creada_en, m.estado::text AS estado_matricula,
               m.reserva_vence_en, a.nombres, (a.foto_clave IS NOT NULL) AS foto_cargada, p.nombre AS plan,
               m.anio::int AS anio, m.mes::int AS mes, m.clases_totales::int AS clases_totales,
               coalesce(m.monto_ajustado, m.monto_calculado)::text AS monto, m.es_proporcional,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('nivel', c.nivel::text, 'diaSemana', c.dia_semana::int,
                                                             'horaInicio', to_char(c.hora_inicio, 'HH24:MI'),
                                                             'horaFin', to_char(c.hora_fin, 'HH24:MI'))
                                         ORDER BY c.dia_semana, c.hora_inicio), '[]'::jsonb)::text
                  FROM matricula_clases mc
                  JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
                 WHERE mc.academia_id = s.academia_id AND mc.matricula_id = m.id) AS clases
          FROM solicitudes_inscripcion s
          JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
          JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
          JOIN planes p ON p.academia_id = m.academia_id AND p.id = m.plan_id
         WHERE s.academia_id = ${tx.academiaId}::uuid AND ${busqueda}
         ORDER BY m.creado_en DESC
         LIMIT 1`;
      const fila = filas[0];
      if (!fila) throw solicitudNoEncontrada();
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      return {
        solicitud: vistaDe(fila, ahora),
        academia: { nombre: academia.nombre, telefono: configuracion.telefono },
      };
    });
  }

  /** El token solo se busca si tiene la forma exacta (43 caracteres base64url): cualquier otra cosa es "no encontrada". */
  private porToken(token: string): Fragmento | null {
    if (!PATRON_TOKEN.test(token)) return null;
    return sql`s.token_hash = decode(${hashDeToken(token)}::text, 'hex')`;
  }

  /** El código se recorta y se pasa a mayúsculas; el DNI se recorta y debe tener 8 dígitos. No se corrige ninguna letra parecida. */
  private porCodigoYDni(codigoCrudo: string, dniCrudo: string): Fragmento | null {
    const codigo = codigoCrudo.trim().toUpperCase();
    const dni = dniCrudo.trim();
    if (!PATRON_CODIGO.test(codigo) || !PATRON_DNI.test(dni)) return null;
    return sql`s.codigo = ${codigo}::text AND a.dni = ${dni}::text`;
  }
}

/** El estado que ve el cliente: una solicitud en espera de pago cuya reserva venció se muestra `VENCIDA` aunque la fila aún no lo diga. */
function estadoVisible(fila: FilaVista, ahora: Date): VistaSolicitud['estado'] {
  if (fila.estado_solicitud !== 'PENDIENTE_PAGO') return fila.estado_solicitud;
  if (fila.estado_matricula === 'CANCELADA') return 'CANCELADA';
  if (
    fila.estado_matricula === 'RESERVADA' &&
    fila.reserva_vence_en !== null &&
    fila.reserva_vence_en.getTime() <= ahora.getTime()
  ) {
    return 'VENCIDA';
  }
  return 'PENDIENTE_PAGO';
}

/**
 * La vista de seguimiento (criterios 32 y 58): completa mientras la solicitud espera el pago y reducida en `VENCIDA` y `CANCELADA`. En la
 * 005a la vigente del cliente es su única solicitud con otro estado visible, así que "no es la vigente" coincide con esos dos estados. La
 * vista reducida no lleva `nombres`, `fotoCargada` ni `reservaVenceEn`: las claves no se crean (no se borran después de armarlas con
 * datos), y el plan, las clases, el mes y el monto salen de la matrícula de esa solicitud, nunca de otra del mismo alumno (DR-14).
 */
function vistaDe(fila: FilaVista, ahora: Date): VistaSolicitud {
  const estado = estadoVisible(fila, ahora);
  const mes = String(fila.mes).padStart(2, '0');
  const base = {
    codigo: fila.codigo,
    creadaEn: fila.creada_en.toISOString(),
    plan: { nombre: fila.plan },
    clases: JSON.parse(fila.clases) as VistaSolicitud['clases'],
    mes: `${fila.anio}-${mes}`,
    clasesTotales: fila.clases_totales,
    monto: fila.monto,
    esProporcional: fila.es_proporcional,
  };
  if (estado !== 'PENDIENTE_PAGO') return { ...base, estado };
  const vista: VistaSolicitud = {
    ...base,
    estado,
    // El primer nombre de pila (DR-9, P2): nunca los demás nombres ni los apellidos.
    nombres: fila.nombres.trim().split(/\s+/)[0] ?? '',
    fotoCargada: fila.foto_cargada,
  };
  // Sin vencimiento (el pago ya está en verificación, historia 007) la clave no existe.
  if (fila.reserva_vence_en !== null) vista.reservaVenceEn = fila.reserva_vence_en.toISOString();
  return vista;
}
