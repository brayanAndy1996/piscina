import { Inject, Injectable } from '@nestjs/common';
import {
  type PagoPendiente,
  type RechazarPago,
  type RespuestaPago,
  type RespuestaPagosPendientes,
  TOPE_DE_LA_BANDEJA,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aTextoMonto } from '../../comun/dinero';
import { anioYMesEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { ENVIADOR_CORREO, type EnviadorCorreo, tipoDeError } from '../../infraestructura/correo';
import { BaseDatos, Decimal, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { hashearClave } from '../../infraestructura/seguridad';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { bloquearClasesParaCupo } from '../clases';
import { UsuariosService } from '../usuarios/usuarios.service';
import {
  type AcademiaDelAviso,
  type AvisoDeRenovacion,
  avisarPagoConfirmado,
  avisarPagoRechazado,
  avisarRenovacionConfirmada,
  avisarRenovacionRechazada,
  avisoDeRenovacion,
  type DestinatarioDelAviso,
  destinatariosDelAviso,
} from './avisos';
import { bloquearFilasDelPago, type DatosDelPagoLeido, type FilasDelPago, leerDatosDelPago } from './bloqueos';
import { confirmarPagoEnTransaccion } from './confirmacion';
import { leerPago } from './cobros.service';
import { decidirAprobacion, decidirRechazo } from './dominio/estado-pago';
import { noEncontrado, pagoYaConfirmado, pagoYaRechazado } from './errores';

/** El aviso que se envía después de confirmar: el del cobro de una solicitud o el de una renovación; ninguno en un reintento (200). */
type AvisoPendiente =
  | { readonly tipo: 'PAGO'; readonly aviso: DestinatarioDelAviso }
  | { readonly tipo: 'RENOVACION'; readonly aviso: AvisoDeRenovacion }
  | null;

interface FilaPendiente {
  id: string;
  metodo: PagoPendiente['metodo'];
  monto: string;
  numero_operacion: string;
  fecha_operacion: string;
  registrado_en: Date;
  /** Nulo en una renovación (010a): la matrícula no tiene solicitud. */
  solicitud_id: string | null;
  codigo: string | null;
  nombres: string;
  apellidos: string;
  dni: string;
  anio: number;
  mes: number;
}

/**
 * Verificación de los pagos de Yape y transferencia (spec 007b, criterios 45 a 52; HU-09, RN-21, D-04, D-23). La academia sale siempre de la
 * sesión. Las lecturas de la bandeja (la lista y el comprobante) y las dos escrituras:
 *
 * - `aprobar`: una lectura corta previa (sin bloqueos) trae el alumno y su DNI desde el pago y, solo si todavía es un cliente, se calcula el
 *   hash argon2 de su contraseña inicial **antes** de abrir la transacción (criterio 23). La transacción toma `usuarios` (actor) → consultivo del
 *   DNI → `alumnos` → `solicitudes_inscripcion` → `matriculas` → `pagos` → la caja, al final (criterio 19): no mueve cupo, así que no bloquea las
 *   clases. Orden de las decisiones: 404 → 200 si ya está `CONFIRMADO` → `PAGO_YA_RECHAZADO` → `DNI_DEL_PERSONAL` → la caja.
 * - `rechazar`: las mismas filas y, como libera el cupo de la matrícula, las clases antes de escribir (`bloquearClasesParaCupo`); no toca la caja.
 *
 * Los correos van después de confirmar, sin esperar (D-19). Un reintento (200) no escribe, no audita y no envía nada.
 */
@Injectable()
export class VerificacionService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    private readonly usuarios: UsuariosService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(ENVIADOR_CORREO) private readonly correo: EnviadorCorreo,
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
          LEFT JOIN solicitudes_inscripcion s ON s.academia_id = m.academia_id AND s.id = m.solicitud_id
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
        solicitud:
          fila.solicitud_id === null || fila.codigo === null ? null : { id: fila.solicitud_id, codigo: fila.codigo },
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

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/pagos/{id}/aprobacion (criterios 47, 48 y 52)
  // -------------------------------------------------------------------------------------------------------------------------------

  async aprobar(sesion: SesionVerificada, pagoIdPedido: string, ip: string | null): Promise<RespuestaPago> {
    const actor = actorDeSesion(sesion);
    // Lectura corta, sin bloqueos y fuera de la transacción: el DNI del alumno y, solo si es un cliente (hay cuenta por crear), el hash de su
    // contraseña inicial, que tarda decenas de milisegundos (criterio 23).
    const leido = await this.baseDatos.conAcademia(actor.academiaId, (tx) => leerDatosDelPago(tx, pagoIdPedido));
    const claveHash = leido?.esCliente === true ? await hashearClave(leido.dni) : null;

    const resultado = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      // 1. El actor sigue vigente: 401 antes que cualquier 404 o 409.
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      const { filas, pago } = await this.bloquearElPago(tx, pagoIdPedido, leido);
      // 2. La decisión (criterio 48): ya confirmado, 200 con el mismo pago; rechazado, 409.
      const decision = decidirAprobacion(pago.estado);
      if (decision === 'RECHAZADO_ANTES') throw pagoYaRechazado();
      if (decision === 'YA_CONFIRMADO') return { respuesta: await this.respuestaDelPago(tx, pago.id), aviso: null };

      // 3. «Ahora» después de bloquear las filas: toda decisión de la transacción usa este instante (DT-10).
      const ahora = this.reloj.ahora();
      // 4. La confirmación (criterio 20): el DNI del personal y la caja, al final, los decide ella. Con el método real del pago (YAPE o
      //    TRANSFERENCIA), que no suma al efectivo esperado (D-04).
      await confirmarPagoEnTransaccion(
        tx,
        this.usuarios,
        {
          pagoId: pago.id,
          alumnoId: filas.alumno.id,
          matriculaId: filas.matricula.id,
          solicitudId: filas.solicitud?.id ?? null,
          concepto: pago.concepto,
          metodo: pago.metodo,
          monto: new Decimal(pago.monto),
          claveHash,
          actor: { id: actor.id },
          ip,
        },
        ahora,
      );
      return {
        respuesta: await this.respuestaDelPago(tx, pago.id),
        aviso: await this.avisoDe(tx, filas, ahora),
      };
    });
    if (resultado.aviso?.tipo === 'PAGO') {
      avisarPagoConfirmado(this.correo, this.registro, this.academiaDe(sesion), resultado.aviso.aviso);
    } else if (resultado.aviso?.tipo === 'RENOVACION') {
      avisarRenovacionConfirmada(this.correo, this.registro, this.academiaDe(sesion), resultado.aviso.aviso);
    }
    return resultado.respuesta;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/pagos/{id}/rechazo (criterios 49, 50 y 52)
  // -------------------------------------------------------------------------------------------------------------------------------

  async rechazar(
    sesion: SesionVerificada,
    pagoIdPedido: string,
    datos: RechazarPago,
    ip: string | null,
  ): Promise<RespuestaPago> {
    const actor = actorDeSesion(sesion);
    const leido = await this.baseDatos.conAcademia(actor.academiaId, (tx) => leerDatosDelPago(tx, pagoIdPedido));

    const resultado = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      const { filas, pago } = await this.bloquearElPago(tx, pagoIdPedido, leido);
      // La decisión (criterio 49): ya rechazado, 200 con el pago como está (sin escribir, auditar ni avisar); confirmado, 409.
      const decision = decidirRechazo(pago.estado);
      if (decision === 'CONFIRMADO_ANTES') throw pagoYaConfirmado();
      if (decision === 'YA_RECHAZADO') return { respuesta: await this.respuestaDelPago(tx, pago.id), aviso: null };

      // Las clases de la matrícula, en una sola llamada y antes de escribir: el rechazo libera su cupo (RN-28, criterio 50). Quien las tuvo
      // antes (un envío o un cobro por el último cupo) ya terminó.
      await bloquearClasesParaCupo(tx, filas.claseIds);
      const ahora = this.reloj.ahora();
      await tx.cliente.$executeRaw`
        UPDATE pagos
           SET estado = 'RECHAZADO'::estado_pago, verificado_por = ${actor.id}::uuid, verificado_en = ${ahora}::timestamptz,
               motivo_rechazo = ${datos.motivo}, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${pago.id}::uuid`;
      // La matrícula deja de ocupar cupo: `CANCELADA` y sin vencimiento (lo exige `matriculas_reserva_coherente`). La solicitud sigue
      // `PENDIENTE_PAGO` en la fila y se ve `PAGO_RECHAZADO` (o `VENCIDA` si el mes ya terminó, criterio 52).
      await tx.cliente.$executeRaw`
        UPDATE matriculas SET estado = 'CANCELADA'::estado_matricula, reserva_vence_en = NULL, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${filas.matricula.id}::uuid`;
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'PAGO_RECHAZADO',
        entidad: 'pago',
        entidadId: pago.id,
        motivo: datos.motivo,
        datosAntes: { estado: 'PENDIENTE_VERIFICACION' },
        datosDespues: { estado: 'RECHAZADO' },
        ip,
      });
      return {
        respuesta: await this.respuestaDelPago(tx, pago.id),
        aviso: await this.avisoDe(tx, filas, ahora),
      };
    });
    if (resultado.aviso?.tipo === 'PAGO') {
      avisarPagoRechazado(this.correo, this.registro, this.academiaDe(sesion), resultado.aviso.aviso, datos.motivo);
    } else if (resultado.aviso?.tipo === 'RENOVACION') {
      avisarRenovacionRechazada(
        this.correo,
        this.registro,
        this.academiaDe(sesion),
        resultado.aviso.aviso,
        datos.motivo,
      );
    }
    return resultado.respuesta;
  }

  /**
   * Las filas del pago, en el orden de la regla, y el pago entre ellas. 404 `NO_ENCONTRADO` si el id no es un UUID, no existe, es de otra
   * academia o las filas cambiaron de forma que ya no coinciden. Va después de `bloquearActorVigente` (AT-2 de 004).
   */
  private async bloquearElPago(
    tx: TransaccionAcademia,
    pagoIdPedido: string,
    leido: DatosDelPagoLeido | null,
  ): Promise<{ filas: FilasDelPago; pago: FilasDelPago['pagos'][number] }> {
    if (leido === null) throw noEncontrado();
    const filas = await bloquearFilasDelPago(tx, { pagoId: pagoIdPedido, leido });
    const pago = filas?.pagos.find((fila) => fila.id === pagoIdPedido.toLowerCase());
    if (filas === null || pago === undefined) throw noEncontrado();
    return { filas, pago };
  }

  /**
   * A quién avisar después de confirmar la aprobación o el rechazo: con solicitud, el aviso del cobro de la 007 (con su código); sin ella (una
   * renovación, spec 010a, DR-7), el de la renovación (con el mes y el plan). Se lee dentro de la transacción; el envío va después de confirmarla.
   */
  private async avisoDe(tx: TransaccionAcademia, filas: FilasDelPago, ahora: Date): Promise<AvisoPendiente> {
    if (filas.solicitud !== null) {
      return { tipo: 'PAGO', aviso: await destinatariosDelAviso(tx, filas.alumno.id, filas.solicitud.codigo, ahora) };
    }
    return { tipo: 'RENOVACION', aviso: await avisoDeRenovacion(tx, filas.alumno.id, filas.matricula.id, ahora) };
  }

  private async respuestaDelPago(tx: TransaccionAcademia, pagoId: string): Promise<RespuestaPago> {
    const pago = await leerPago(tx, pagoId);
    if (pago === null) throw new Error('El pago verificado no existe.');
    return { pago };
  }

  private academiaDe(sesion: SesionVerificada): AcademiaDelAviso {
    return { id: sesion.usuario.academiaId, nombre: sesion.academia.nombre, nombreCorto: sesion.academia.nombreCorto };
  }
}
