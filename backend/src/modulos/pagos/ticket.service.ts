import { Injectable } from '@nestjs/common';
import { LEYENDA_TICKET, type RespuestaTicket } from '@aquagestion/contratos';
import { aTextoMonto } from '../../comun/dinero';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos } from '../../infraestructura/prisma';
import { leerConfiguracion } from '../configuracion/lectura';
import { PinoLogger } from 'nestjs-pino';
import { noEncontrado } from './errores';

interface FilaDelTicket {
  numero_ticket: number;
  verificado_en: Date;
  concepto: 'INSCRIPCION' | 'MENSUALIDAD' | 'CLASE_PARTICULAR';
  metodo: 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
  numero_operacion: string | null;
  monto: string;
  nombres: string;
  apellidos: string;
  plan: string;
  anio: number;
  mes: number;
  academia_nombre: string;
  cobrador_nombres: string;
  cobrador_apellidos: string;
}

/**
 * El ticket interno de un pago confirmado (spec 007a, criterios 25 a 27; HU-07, D-09, DR-4): los datos que imprime la web. Es una lectura sin
 * bloqueos, sin escritura y sin auditoría; se puede pedir las veces que haga falta. Un pago pendiente o rechazado, de otra academia, inexistente
 * o con un id que no es UUID responde el mismo 404 `NO_ENCONTRADO`. Nunca lleva el DNI de nadie (DR-4) ni ids internos.
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(TicketService.name);
  }

  async leer(academiaId: string, idPedido: string): Promise<RespuestaTicket> {
    if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
    const id = idPedido.toLowerCase();
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const filas = await tx.cliente.$queryRaw<FilaDelTicket[]>`
        SELECT p.numero_ticket, p.verificado_en, p.concepto::text AS concepto, p.metodo::text AS metodo, p.numero_operacion,
               p.monto::text AS monto, a.nombres, a.apellidos, pl.nombre AS plan, m.anio::int AS anio, m.mes::int AS mes,
               ac.nombre AS academia_nombre, u.nombres AS cobrador_nombres, u.apellidos AS cobrador_apellidos
          FROM pagos p
          JOIN alumnos a ON a.academia_id = p.academia_id AND a.id = p.alumno_id
          JOIN matriculas m ON m.academia_id = p.academia_id AND m.id = p.matricula_id
          JOIN planes pl ON pl.academia_id = m.academia_id AND pl.id = m.plan_id
          JOIN usuarios u ON u.academia_id = p.academia_id AND u.id = p.verificado_por
          JOIN academias ac ON ac.id = p.academia_id
         WHERE p.academia_id = ${tx.academiaId}::uuid AND p.id = ${id}::uuid AND p.estado = 'CONFIRMADO'::estado_pago`;
      const fila = filas[0];
      if (!fila) throw noEncontrado();
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      return {
        ticket: {
          academia: { nombre: fila.academia_nombre, telefono: configuracion.telefono },
          numero: fila.numero_ticket,
          fechaHora: fila.verificado_en.toISOString(),
          alumno: { nombres: fila.nombres, apellidos: fila.apellidos },
          concepto: fila.concepto,
          plan: { nombre: fila.plan },
          mes: `${fila.anio}-${String(fila.mes).padStart(2, '0')}`,
          metodo: fila.metodo,
          numeroOperacion: fila.metodo === 'EFECTIVO' ? null : fila.numero_operacion,
          monto: aTextoMonto(fila.monto),
          cobradoPor: { nombres: fila.cobrador_nombres, apellidos: fila.cobrador_apellidos },
          leyenda: LEYENDA_TICKET,
        },
      };
    });
  }
}
