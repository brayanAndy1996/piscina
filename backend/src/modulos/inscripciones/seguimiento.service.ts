import { Inject, Injectable } from '@nestjs/common';
import {
  CAMPOS_DATOS_DE_PAGO,
  type ConfiguracionAcademia,
  type ConsultarSolicitud,
  type DatosDePago,
  type EstadoSolicitud,
  PATRON_CODIGO,
  PATRON_TOKEN,
  type RespuestaConsultaSolicitud,
  type VistaSolicitud,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aTextoMonto } from '../../comun/dinero';
import {
  type AcademiaResuelta,
  BaseDatos,
  Decimal,
  type Fragmento,
  sql,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { leerConfiguracion } from '../configuracion/lectura';
import { finDelMesEnLima } from '../matriculas';
import { totalACobrar } from '../pagos/dominio/total';
import { hashDeToken } from './dominio/codigos';
import { estadoVisible, unirUltimoPago } from './estado-visible';
import { solicitudNoEncontrada } from './errores';

interface FilaVista {
  codigo: string;
  estado_solicitud: EstadoSolicitud;
  creada_en: Date;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  nombres: string;
  foto_cargada: boolean;
  plan: string;
  anio: number;
  mes: number;
  clases_totales: number;
  monto_ajustado: string | null;
  monto_calculado: string;
  es_proporcional: boolean;
  /** El último pago de la matrícula (`unirUltimoPago`): todo nulo si no tiene. */
  pago_metodo: 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA' | null;
  pago_estado: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO' | null;
  pago_monto: string | null;
  pago_registrado_en: Date | null;
  pago_verificado_en: Date | null;
  pago_fecha_operacion: string | null;
  pago_motivo_rechazo: string | null;
  pago_numero_ticket: number | null;
  hay_pago_pendiente: boolean | null;
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
      const vista = await leerVistaDeSolicitud(tx, busqueda, ahora);
      if (!vista) throw solicitudNoEncontrada();
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      const respuesta: RespuestaConsultaSolicitud = {
        solicitud: vista,
        academia: { nombre: academia.nombre, telefono: configuracion.telefono },
      };
      // Los datos de pago (007b, criterio 53) solo mientras la persona todavía puede pagar, y solo los que tienen valor.
      if (vista.estado === 'PENDIENTE_PAGO' || vista.estado === 'PAGO_RECHAZADO') {
        const datosDePago = datosDePagoDe(configuracion);
        if (Object.keys(datosDePago).length > 0) respuesta.academia.datosDePago = datosDePago;
      }
      return respuesta;
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

/**
 * La vista de seguimiento de la solicitud que cumple `condicion` (el token, o el código con el DNI), con una sola consulta, sin bloquear nada, o
 * `null` si no hay ninguna. La comparten la consulta de seguimiento y la subida del comprobante (007b), que responde con la misma vista.
 * `condicion` usa los alias `s` (solicitud) y `a` (alumno); `tx` ya corre con la academia, y la consulta la filtra otra vez.
 */
export async function leerVistaDeSolicitud(
  tx: TransaccionAcademia,
  condicion: Fragmento,
  ahora: Date,
): Promise<VistaSolicitud | null> {
  const filas = await tx.cliente.$queryRaw<FilaVista[]>`
        SELECT s.codigo, s.estado::text AS estado_solicitud, s.creado_en AS creada_en, m.estado::text AS estado_matricula,
               m.reserva_vence_en, a.nombres, (a.foto_clave IS NOT NULL) AS foto_cargada, p.nombre AS plan,
               m.anio::int AS anio, m.mes::int AS mes, m.clases_totales::int AS clases_totales,
               m.monto_ajustado::text AS monto_ajustado, m.monto_calculado::text AS monto_calculado, m.es_proporcional,
               up.metodo::text AS pago_metodo, up.estado::text AS pago_estado, up.monto::text AS pago_monto,
               up.registrado_en AS pago_registrado_en, up.verificado_en AS pago_verificado_en,
               up.fecha_operacion::text AS pago_fecha_operacion, up.motivo_rechazo AS pago_motivo_rechazo,
               up.numero_ticket AS pago_numero_ticket, up.hay_pendiente AS hay_pago_pendiente,
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
          ${unirUltimoPago}
         WHERE s.academia_id = ${tx.academiaId}::uuid AND ${condicion}
         ORDER BY m.creado_en DESC
         LIMIT 1`;
  const fila = filas[0];
  return fila ? vistaDe(fila, ahora) : null;
}

/** Los datos de pago de la configuración que tienen valor (007b, criterio 53). */
function datosDePagoDe(configuracion: ConfiguracionAcademia): DatosDePago {
  const datos: DatosDePago = {};
  for (const campo of CAMPOS_DATOS_DE_PAGO) {
    const valor = configuracion[campo];
    if (valor !== undefined && valor !== null) datos[campo] = valor;
  }
  return datos;
}

/**
 * La vista de seguimiento (criterios 32 y 58 de 005; 28 de 007): completa (con el primer nombre) mientras la solicitud espera el pago
 * (`PENDIENTE_PAGO`), tiene un comprobante en revisión (`EN_VERIFICACION`), se rechazó y todavía se puede pagar (`PAGO_RECHAZADO`) o ya se
 * confirmó (`CONFIRMADA`); reducida en `VENCIDA` y `CANCELADA`. La vigente del cliente es su única solicitud con otro estado visible, así
 * que "no es la vigente" coincide con esos dos estados. La vista reducida no lleva `nombres`, `fotoCargada` ni `reservaVenceEn`: las claves
 * no se crean (no se borran después de armarlas con datos), y el plan, las clases, el mes y el monto salen de la matrícula de esa solicitud,
 * nunca de otra del mismo alumno (DR-14). El monto es el total a cobrar (`totalACobrar`). Ninguna lleva el DNI, los apellidos, el número de
 * operación, el comprobante, quién verificó ni ids internos.
 */
function vistaDe(fila: FilaVista, ahora: Date): VistaSolicitud {
  const estado = estadoVisible(
    {
      estado_solicitud: fila.estado_solicitud,
      estado_matricula: fila.estado_matricula,
      reserva_vence_en: fila.reserva_vence_en,
      estado_ultimo_pago: fila.pago_estado,
      hay_pago_pendiente: fila.hay_pago_pendiente,
      anio: fila.anio,
      mes: fila.mes,
    },
    ahora,
  );
  const mes = String(fila.mes).padStart(2, '0');
  const total = totalACobrar({
    montoAjustado: fila.monto_ajustado === null ? null : new Decimal(fila.monto_ajustado),
    montoCalculado: new Decimal(fila.monto_calculado),
  });
  const base = {
    codigo: fila.codigo,
    creadaEn: fila.creada_en.toISOString(),
    plan: { nombre: fila.plan },
    clases: JSON.parse(fila.clases) as VistaSolicitud['clases'],
    mes: `${fila.anio}-${mes}`,
    clasesTotales: fila.clases_totales,
    monto: aTextoMonto(total),
    esProporcional: fila.es_proporcional,
  };
  if (estado === 'VENCIDA' || estado === 'CANCELADA') return { ...base, estado };
  // El primer nombre de pila (DR-9, P2): nunca los demás nombres ni los apellidos.
  const nombres = fila.nombres.trim().split(/\s+/)[0] ?? '';
  if (estado === 'CONFIRMADA') {
    // Una solicitud confirmada siempre tiene su pago confirmado (criterio 5): si falta, es un fallo interno, no un valor inventado.
    const confirmadoEn = fila.pago_verificado_en ?? fila.pago_registrado_en;
    if (
      fila.pago_metodo === null ||
      fila.pago_monto === null ||
      fila.pago_numero_ticket === null ||
      confirmadoEn === null
    ) {
      throw new Error('Una solicitud confirmada no tiene su pago confirmado.');
    }
    return {
      ...base,
      estado,
      nombres,
      pago: {
        metodo: fila.pago_metodo,
        monto: aTextoMonto(fila.pago_monto),
        confirmadoEn: confirmadoEn.toISOString(),
        numeroTicket: fila.pago_numero_ticket,
      },
    };
  }
  if (estado === 'EN_VERIFICACION') {
    return {
      ...base,
      estado,
      nombres,
      fotoCargada: fila.foto_cargada,
      pago: {
        metodo: fila.pago_metodo ?? 'YAPE',
        monto: aTextoMonto(fila.pago_monto ?? total),
        fechaOperacion: fila.pago_fecha_operacion ?? '',
        enviadoEn: (fila.pago_registrado_en ?? fila.creada_en).toISOString(),
      },
    };
  }
  if (estado === 'PAGO_RECHAZADO') {
    return {
      ...base,
      estado,
      nombres,
      fotoCargada: fila.foto_cargada,
      rechazo: {
        motivo: fila.pago_motivo_rechazo ?? '',
        rechazadoEn: (fila.pago_verificado_en ?? fila.pago_registrado_en ?? fila.creada_en).toISOString(),
      },
      // El fin del mes de la matrícula en Lima: hasta entonces se puede volver a pagar.
      pagableHasta: finDelMesEnLima(new Date(Date.UTC(fila.anio, fila.mes - 1, 15, 12))).toISOString(),
    };
  }
  const vista: VistaSolicitud = {
    ...base,
    estado,
    nombres,
    fotoCargada: fila.foto_cargada,
  };
  // Sin vencimiento (el pago ya está en verificación, historia 007) la clave no existe.
  if (fila.reserva_vence_en !== null) vista.reservaVenceEn = fila.reserva_vence_en.toISOString();
  return vista;
}
