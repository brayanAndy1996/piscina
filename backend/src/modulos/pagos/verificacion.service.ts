import { Inject, Injectable } from '@nestjs/common';
import { type PagoPendiente, type RespuestaPagosPendientes, TOPE_DE_LA_BANDEJA } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aTextoMonto } from '../../comun/dinero';
import { anioYMesEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { tipoDeError } from '../../infraestructura/correo';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { noEncontrado } from './errores';

interface FilaPendiente {
  id: string;
  metodo: PagoPendiente['metodo'];
  monto: string;
  numero_operacion: string;
  fecha_operacion: string;
  registrado_en: Date;
  solicitud_id: string;
  codigo: string;
  nombres: string;
  apellidos: string;
  dni: string;
  anio: number;
  mes: number;
}

/**
 * Verificación de los pagos de Yape y transferencia (spec 007b, criterios 45 a 52; HU-09, RN-21, D-04, D-23). La academia sale siempre de la
 * sesión. Aquí viven las lecturas de la bandeja (la lista y el comprobante); la aprobación y el rechazo se suman con sus transacciones.
 */
@Injectable()
export class VerificacionService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(VerificacionService.name);
  }

  /**
   * `GET /api/pagos/pendientes` (criterio 45): los pagos `PENDIENTE_VERIFICACION` de la academia, del más antiguo al más nuevo (y, a igual
   * instante, por id: el orden es estable), como mucho 200. Una lectura: no bloquea, no escribe y no audita. `mesTerminado` compara el mes de la
   * matrícula con el mes de «hoy» en Lima (criterio 52). Sin datos médicos, apoderado, token, clave del archivo, número normalizado ni IP.
   */
  async listarPendientes(academiaId: string): Promise<RespuestaPagosPendientes> {
    const hoy = anioYMesEnLima(this.reloj.ahora());
    const filas = await this.baseDatos.conAcademia(
      academiaId,
      (tx) =>
        tx.cliente.$queryRaw<FilaPendiente[]>`
        SELECT p.id::text AS id, p.metodo::text AS metodo, p.monto::text AS monto, p.numero_operacion,
               p.fecha_operacion::text AS fecha_operacion, p.registrado_en, s.id::text AS solicitud_id, s.codigo,
               a.nombres, a.apellidos, a.dni, m.anio::int AS anio, m.mes::int AS mes
          FROM pagos p
          JOIN matriculas m ON m.academia_id = p.academia_id AND m.id = p.matricula_id
          JOIN solicitudes_inscripcion s ON s.academia_id = m.academia_id AND s.id = m.solicitud_id
          JOIN alumnos a ON a.academia_id = p.academia_id AND a.id = p.alumno_id
         WHERE p.academia_id = ${academiaId}::uuid AND p.estado = 'PENDIENTE_VERIFICACION'::estado_pago
         ORDER BY p.registrado_en, p.id
         LIMIT ${TOPE_DE_LA_BANDEJA}::int`,
    );
    return {
      pagos: filas.map((fila) => ({
        id: fila.id,
        metodo: fila.metodo,
        monto: aTextoMonto(fila.monto),
        numeroOperacion: fila.numero_operacion,
        fechaOperacion: fila.fecha_operacion,
        enviadoEn: fila.registrado_en.toISOString(),
        solicitud: { id: fila.solicitud_id, codigo: fila.codigo },
        cliente: { nombres: fila.nombres, apellidos: fila.apellidos, dni: fila.dni },
        mes: `${fila.anio}-${String(fila.mes).padStart(2, '0')}`,
        mesTerminado: fila.anio * 12 + fila.mes < hoy.anio * 12 + hoy.mes,
      })),
    };
  }

  /**
   * `GET /api/pagos/{id}/comprobante` (criterio 46): la imagen guardada de un pago de Yape o transferencia, en cualquier estado. Una lectura
   * corta del pago (método y clave del archivo) y, fuera de la transacción, la lectura del archivo con la academia de la sesión. Un pago en
   * efectivo, inexistente, de otra academia o con un id que no es UUID responde el mismo 404 `NO_ENCONTRADO`, sin tocar el almacén. Si el
   * archivo falta, es un fallo del servidor (500) sin datos del archivo: la respuesta nunca lleva la clave ni la ruta. No audita.
   */
  async leerComprobante(academiaId: string, idPedido: string): Promise<Buffer> {
    if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
    const id = idPedido.toLowerCase();
    const clave = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ comprobante_clave: string | null }[]>`
        SELECT comprobante_clave FROM pagos
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid AND metodo <> 'EFECTIVO'::metodo_pago`;
      return filas[0]?.comprobante_clave ?? null;
    });
    if (clave === null) throw noEncontrado();
    try {
      return await this.almacen.leer(academiaId, clave);
    } catch (error) {
      this.registro.error({ academiaId, error: { tipo: tipoDeError(error) } }, 'No se pudo leer el comprobante');
      // El filtro de errores responde 500 `ERROR_INTERNO` sin el mensaje ni la causa; los errores del almacén nunca llevan la ruta ni la clave.
      throw new Error('No se pudo leer el comprobante del pago.', { cause: error });
    }
  }
}
