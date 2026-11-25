import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  COMPROBANTE_LADO_GUARDADO,
  DATOS_PAGO_LARGO_MAXIMO,
  type DatosComprobante,
  datosComprobanteSchema,
  type EstadoSolicitud,
  type FotoTipo,
  normalizarNumeroOperacion,
  PATRON_TOKEN,
  type VistaSolicitud,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aDecimal, aTextoMonto, montosIguales } from '../../comun/dinero';
import { ErrorNegocio } from '../../comun/errores';
import { hoyEnLima } from '../../comun/fechas';
import { recodificarImagen } from '../../comun/http/recodificar-imagen';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { tipoDeError } from '../../infraestructura/correo';
import {
  type AcademiaResuelta,
  BaseDatos,
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  restriccionDeUnicidadViolada,
  sql,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService, ipParaAuditoria } from '../auditoria';
import { bloquearClasesParaCupo } from '../clases';
import { hashDeToken } from '../inscripciones/dominio/codigos';
import { estadoVisible, unirUltimoPago } from '../inscripciones/estado-visible';
import { leerVistaDeSolicitud } from '../inscripciones/seguimiento.service';
import { bloquearFilasDelCobro, leerDniDeLaSolicitud } from './bloqueos';
import { exigirCupoDeLaMatricula } from './cupo';
import { totalACobrar } from './dominio/total';
import {
  claveYaUsada,
  montoDistinto,
  numeroOperacionYaUsado,
  pagoEnVerificacion,
  solicitudNoEditable,
  solicitudNoEncontrada,
  solicitudYaPagada,
} from './errores';
import { solicitudInvalida } from '../inscripciones/errores';

/** Lo máximo que espera la relectura de `resolverConfirmacionIncierta` a que termine la transacción de la subida (criterio 64 de 005). */
const ESPERA_RELECTURA_MS = 5000;

/** Lo que responde la subida: la vista de seguimiento y si el pago se creó ahora (201) o ya estaba (200, un reintento con la misma clave). */
export interface ResultadoDelComprobante {
  readonly solicitud: VistaSolicitud;
  readonly creado: boolean;
}

interface FilaDeLaSolicitud {
  solicitud_id: string;
  alumno_id: string;
  matricula_id: string;
  estado_solicitud: EstadoSolicitud;
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  anio: number;
  mes: number;
  creada_en: Date;
  estado_ultimo_pago: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO' | null;
  hay_pago_pendiente: boolean | null;
}

interface FilaDelPagoDeLaClave {
  id: string;
  matricula_id: string;
  metodo: string;
  monto: string;
  numero_operacion_normalizado: string | null;
  fecha_operacion: string | null;
}

/** Cómo termina la comprobación previa: seguir adelante con la solicitud, o responder con la vista de un reintento. */
type Previa =
  | { readonly reintento: false; readonly fila: FilaDeLaSolicitud }
  | { readonly reintento: true; readonly vista: VistaSolicitud };

/** Las decisiones de la propia transacción (409, 404, academia): con ellas es seguro que no se confirmó nada. */
function esRechazoDeLaTransaccion(error: unknown): boolean {
  return (
    error instanceof ErrorAcademiaNoEncontrada ||
    error instanceof ErrorAcademiaSuspendida ||
    error instanceof ErrorNegocio
  );
}

/**
 * Subida del comprobante de Yape o transferencia (spec 007b, criterios 36 a 44; HU-08, RN-04, RN-28, D-04, D-07). Es una ruta pública: sin
 * sesión, la persona se identifica con el token de su solicitud. Orden de las comprobaciones (las tres primeras, el límite por conexión, el
 * tipo y el tamaño, son middlewares de Express):
 *
 * 1. Academia (el pipe del controlador) y `X-Pago-Datos` (`datosComprobanteSchema`): 400.
 * 2. Token (404 `SOLICITUD_NO_ENCONTRADA`), clave de idempotencia (200 o 409 `CLAVE_YA_USADA`), fecha de la operación (400) y estado visible
 *    de la solicitud (409), con una lectura corta, sin bloqueos y sin tocar archivos.
 * 3. La imagen: se valida y se vuelve a codificar como JPEG de como mucho 2000 píxeles, sin metadatos (criterio 40), fuera de toda transacción.
 * 4. Se guarda con una clave del servidor, `academias/{academiaId}/pagos/{pagoId}/comprobante-{uuid}.jpg`, **antes** de la transacción (un
 *    archivo sin referencia no lo ve nadie; una referencia a un archivo que no existe, sí).
 * 5. La transacción bloquea, en el orden de la regla de bloqueos, el consultivo del DNI → alumno → solicitud → matrícula → pagos (y las clases
 *    si hay que volver a pedir el cupo), decide otra vez con lo ya confirmado (clave, estado, monto, número de operación, cupo) y escribe el
 *    pago `PENDIENTE_VERIFICACION`, la matrícula `RESERVADA` sin vencimiento y la auditoría. No toca la caja: el ingreso entra al aprobar.
 * 6. Si la transacción rechazó, se borra el archivo nuevo. Con cualquier otro error no se sabe si el `COMMIT` llegó: se relee el pago por su
 *    id (criterios 61 y 64 de 005) y se decide con lo que se ve. Un comprobante guardado nunca se borra después (es evidencia).
 */
@Injectable()
export class ComprobanteService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(ComprobanteService.name);
  }

  /** `token` y `datosCrudos` son las cabeceras crudas: cualquier cosa que no tenga su forma exacta es un 404 o un 400, nunca un error del servidor. */
  async subir(
    academia: AcademiaResuelta,
    token: unknown,
    datosCrudos: unknown,
    cuerpo: Buffer,
    tipo: FotoTipo,
    ip: string | null,
  ): Promise<ResultadoDelComprobante> {
    // 5. Los datos del pago (antes del token: los datos mal formados no dicen si el token existe).
    const datos = this.leerDatos(datosCrudos);
    // 6. El token.
    if (typeof token !== 'string' || !PATRON_TOKEN.test(token)) throw solicitudNoEncontrada();
    const hash = hashDeToken(token);
    const numeroNormalizado = normalizarNumeroOperacion(datos.numeroOperacion);
    if (numeroNormalizado === null)
      throw solicitudInvalida([{ campo: 'numeroOperacion', mensaje: 'El número de operación no es válido.' }]);

    // Comprobación previa (token, fecha, clave y estado): una lectura corta, sin bloqueos y sin tocar archivos, para no gastar CPU en una subida que no sirve.
    const previa = await this.baseDatos.conAcademia(academia.id, (tx) => this.comprobarPrevia(tx, hash, datos));
    if (previa.reintento) return { solicitud: previa.vista, creado: false };
    const { fila } = previa;

    // 9. La imagen, fuera de toda transacción.
    const jpeg = await recodificarImagen(cuerpo, tipo, COMPROBANTE_LADO_GUARDADO);

    const pagoId = randomUUID();
    const clave = `academias/${academia.id}/pagos/${pagoId}/comprobante-${randomUUID()}.jpg`;
    const guardado = await Promise.resolve()
      .then(() => this.almacen.guardar(academia.id, clave, jpeg, 'image/jpeg'))
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    if (!guardado.ok) {
      this.registro.error(
        { academiaId: academia.id, error: { tipo: tipoDeError(guardado.error) } },
        'No se pudo guardar el comprobante',
      );
      // Un error nuevo y sin causa: el del almacén lleva la ruta. La respuesta es 500 `ERROR_INTERNO` y la base no cambió.
      throw new Error('No se pudo guardar el comprobante de la solicitud.');
    }

    let resultado: ResultadoDelComprobante;
    try {
      resultado = await this.baseDatos.conAcademia(academia.id, (tx) =>
        this.registrarEnTransaccion(tx, fila, datos, numeroNormalizado, { pagoId, clave, ip }),
      );
    } catch (error) {
      const decidido = this.rechazoDeLaBase(error);
      if (decidido !== null || esRechazoDeLaTransaccion(error)) {
        // Lo decidió la propia transacción (409, 404, academia, un índice único): es seguro que no se confirmó nada.
        await this.borrarSinFallar(academia.id, clave);
        throw decidido ?? error;
      }
      return this.resolverConfirmacionIncierta(academia.id, fila.solicitud_id, pagoId, clave, error);
    }
    // Un reintento que ganó la carrera (200): el archivo nuevo no lo referencia nadie.
    if (!resultado.creado) await this.borrarSinFallar(academia.id, clave);
    else this.registro.info({ academiaId: academia.id }, 'Comprobante de la solicitud guardado');
    return resultado;
  }

  /**
   * `X-Pago-Datos`: un JSON de hasta 1024 bytes que cumple `datosComprobanteSchema` (criterio 37, paso 5). Sin la cabecera, repetida, con
   * otro tipo de valor, que no es JSON o demasiado larga: 400 `SOLICITUD_INVALIDA`; un valor que no cumple el esquema: 400 con los campos.
   */
  private leerDatos(crudos: unknown): DatosComprobante {
    if (typeof crudos !== 'string' || crudos.trim() === '') {
      throw solicitudInvalida([{ campo: '', mensaje: 'Faltan los datos del pago (cabecera X-Pago-Datos).' }]);
    }
    if (Buffer.byteLength(crudos, 'latin1') > DATOS_PAGO_LARGO_MAXIMO) {
      throw solicitudInvalida([{ campo: '', mensaje: 'Los datos del pago son demasiado largos.' }]);
    }
    let valor: unknown;
    try {
      valor = JSON.parse(crudos);
    } catch {
      throw solicitudInvalida([{ campo: '', mensaje: 'Los datos del pago no son un JSON válido.' }]);
    }
    // Un `ZodError` lo convierte el filtro de errores en el 400 con `detalles.errores[].campo`.
    return datosComprobanteSchema.parse(valor);
  }

  /** Los índices únicos que, al chocar en el `INSERT`, dicen por qué se rechazó (criterio 39): el nombre del índice, nunca un 500. */
  private rechazoDeLaBase(error: unknown): ErrorNegocio | null {
    const restriccion = restriccionDeUnicidadViolada(error);
    if (restriccion === 'pagos_numero_operacion_abierto_key') return numeroOperacionYaUsado();
    if (restriccion === 'pagos_academia_id_clave_idempotencia_key') return claveYaUsada();
    if (restriccion === 'pagos_un_abierto_por_matricula') return pagoEnVerificacion();
    return null;
  }

  /**
   * Los pasos 6 a 8 del criterio 37 con una lectura corta: el token (404), la clave de idempotencia (200 con la vista actual si es el mismo
   * comprobante, 409 `CLAVE_YA_USADA` si no), la fecha de la operación (400, que depende de cuándo se creó la solicitud) y el estado visible
   * de la solicitud (409).
   */
  private async comprobarPrevia(tx: TransaccionAcademia, hash: string, datos: DatosComprobante): Promise<Previa> {
    const ahora = this.reloj.ahora();
    const filas = await tx.cliente.$queryRaw<FilaDeLaSolicitud[]>`
      SELECT s.id::text AS solicitud_id, s.alumno_id::text AS alumno_id, m.id::text AS matricula_id, s.estado::text AS estado_solicitud,
             m.estado::text AS estado_matricula, m.reserva_vence_en, m.anio::int AS anio, m.mes::int AS mes, s.creado_en AS creada_en,
             up.estado::text AS estado_ultimo_pago, up.hay_pendiente AS hay_pago_pendiente
        FROM solicitudes_inscripcion s
        JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
        ${unirUltimoPago}
       WHERE s.academia_id = ${tx.academiaId}::uuid AND s.token_hash = decode(${hash}::text, 'hex')
       ORDER BY m.creado_en DESC
       LIMIT 1`;
    const fila = filas[0];
    if (!fila) throw solicitudNoEncontrada();

    // La clave de idempotencia (criterio 42): antes que el estado.
    const repetido = await this.leerPagoDeLaClave(tx, datos.claveIdempotencia);
    if (repetido) {
      if (!this.esElMismoComprobante(repetido, fila.matricula_id, datos)) throw claveYaUsada();
      return { reintento: true, vista: await this.vistaActual(tx, fila.solicitud_id, ahora) };
    }

    // La fecha de la operación: ni posterior a hoy ni anterior al día en que se creó la solicitud, los dos en Lima (criterio 38, RNF-12).
    if (datos.fechaOperacion > hoyEnLima(ahora) || datos.fechaOperacion < hoyEnLima(fila.creada_en)) {
      throw solicitudInvalida([
        {
          campo: 'fechaOperacion',
          mensaje: 'La fecha de la operación no puede ser posterior a hoy ni anterior a la fecha de tu solicitud.',
        },
      ]);
    }

    this.exigirEstadoQueAdmiteComprobante(fila, ahora);
    return { reintento: false, fila };
  }

  /** El pago de la academia con esa clave de idempotencia, de cualquier método y estado (la clave es única por academia). */
  private async leerPagoDeLaClave(
    tx: TransaccionAcademia,
    claveIdempotencia: string,
  ): Promise<FilaDelPagoDeLaClave | undefined> {
    const filas = await tx.cliente.$queryRaw<FilaDelPagoDeLaClave[]>`
      SELECT id::text AS id, matricula_id::text AS matricula_id, metodo::text AS metodo, monto::text AS monto,
             numero_operacion_normalizado, fecha_operacion::text AS fecha_operacion
        FROM pagos
       WHERE academia_id = ${tx.academiaId}::uuid AND clave_idempotencia = ${claveIdempotencia.toLowerCase()}::uuid`;
    return filas[0];
  }

  /** «Los mismos datos»: la misma matrícula, el mismo método, el mismo monto, la misma fecha y el mismo número de operación normalizado. */
  private esElMismoComprobante(pago: FilaDelPagoDeLaClave, matriculaId: string, datos: DatosComprobante): boolean {
    return (
      pago.matricula_id === matriculaId &&
      pago.metodo === datos.metodo &&
      montosIguales(pago.monto, datos.monto) &&
      pago.fecha_operacion === datos.fechaOperacion &&
      pago.numero_operacion_normalizado === normalizarNumeroOperacion(datos.numeroOperacion)
    );
  }

  /**
   * Solo se sube con el estado visible `PENDIENTE_PAGO` (reserva vigente) o `PAGO_RECHAZADO` (criterio 41). Los demás, 409 sin escribir:
   * `SOLICITUD_YA_PAGADA`, `PAGO_EN_VERIFICACION` o `SOLICITUD_NO_EDITABLE` (`VENCIDA` o `CANCELADA`, también en el instante del vencimiento).
   */
  private exigirEstadoQueAdmiteComprobante(
    fila: Pick<
      FilaDeLaSolicitud,
      | 'estado_solicitud'
      | 'estado_matricula'
      | 'reserva_vence_en'
      | 'estado_ultimo_pago'
      | 'hay_pago_pendiente'
      | 'anio'
      | 'mes'
    >,
    ahora: Date,
  ): 'PENDIENTE_PAGO' | 'PAGO_RECHAZADO' {
    const estado = estadoVisible(fila, ahora);
    if (estado === 'CONFIRMADA') throw solicitudYaPagada();
    if (estado === 'EN_VERIFICACION') throw pagoEnVerificacion();
    if (estado === 'PENDIENTE_PAGO' || estado === 'PAGO_RECHAZADO') return estado;
    throw solicitudNoEditable();
  }

  private vistaActual(tx: TransaccionAcademia, solicitudId: string, ahora: Date): Promise<VistaSolicitud> {
    return leerVistaDeSolicitud(tx, sql`s.id = ${solicitudId}::uuid`, ahora).then((vista) => {
      if (!vista) throw solicitudNoEncontrada();
      return vista;
    });
  }

  /**
   * La transacción de la subida (criterio 37, paso 10): bloquea las filas, decide otra vez con lo ya confirmado (la clave, el estado, el monto,
   * el número de operación y, tras un rechazo, el cupo) y escribe el pago, la matrícula y la auditoría. No toca la caja.
   */
  private async registrarEnTransaccion(
    tx: TransaccionAcademia,
    previa: FilaDeLaSolicitud,
    datos: DatosComprobante,
    numeroNormalizado: string,
    nuevo: { pagoId: string; clave: string; ip: string | null },
  ): Promise<ResultadoDelComprobante> {
    // 1. Las filas, en el orden de la regla: consultivo del DNI → alumno → solicitud → matrícula → pagos.
    const dni = await leerDniDeLaSolicitud(tx, previa.solicitud_id);
    if (dni === null) throw solicitudNoEncontrada();
    const filas = await bloquearFilasDelCobro(tx, {
      solicitudId: previa.solicitud_id,
      alumnoId: dni.alumnoId,
      dni: dni.dni,
    });
    if (filas === null) throw solicitudNoEncontrada();
    // 2. Tras un rechazo, la matrícula vuelve a pedir su cupo: las clases se bloquean antes de decidir (DT-10 de 007).
    const vuelveDeUnRechazo = filas.matricula.estado === 'CANCELADA' && filas.pagos[0]?.estado === 'RECHAZADO';
    if (vuelveDeUnRechazo) await bloquearClasesParaCupo(tx, filas.claseIds);
    // 3. «Ahora» después de bloquear: toda decisión de la transacción usa este instante.
    const ahora = this.reloj.ahora();

    // 4. La clave de idempotencia con lo que otra transacción ya confirmó (criterio 42).
    const repetido = await this.leerPagoDeLaClave(tx, datos.claveIdempotencia);
    if (repetido) {
      if (!this.esElMismoComprobante(repetido, filas.matricula.id, datos)) throw claveYaUsada();
      return { solicitud: await this.vistaActual(tx, filas.solicitud.id, ahora), creado: false };
    }

    // 5. El estado, otra vez (criterio 41).
    const estado = this.exigirEstadoQueAdmiteComprobante(
      {
        estado_solicitud: filas.solicitud.estado,
        estado_matricula: filas.matricula.estado,
        reserva_vence_en: filas.matricula.reservaVenceEn,
        estado_ultimo_pago: filas.pagos[0]?.estado ?? null,
        hay_pago_pendiente: filas.pagos.some((pago) => pago.estado === 'PENDIENTE_VERIFICACION'),
        anio: filas.matricula.anio,
        mes: filas.matricula.mes,
      },
      ahora,
    );

    // 6. El monto: ni parcial ni de más (criterio 38).
    const total = totalACobrar(filas.matricula);
    if (!montosIguales(aDecimal(datos.monto), total)) throw montoDistinto(aTextoMonto(total));

    // 7. El número de operación sin duplicados entre los pagos abiertos del mismo método (criterio 39). El índice único lo vuelve a decidir
    //    si dos subidas de solicitudes distintas llegan a la vez (cada una tiene su propio bloqueo del DNI).
    const usados = await tx.cliente.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM pagos
       WHERE academia_id = ${tx.academiaId}::uuid AND metodo = ${datos.metodo}::metodo_pago
         AND numero_operacion_normalizado = ${numeroNormalizado}
         AND estado IN ('PENDIENTE_VERIFICACION'::estado_pago, 'CONFIRMADO'::estado_pago)
       LIMIT 1`;
    if (usados.length > 0) throw numeroOperacionYaUsado();

    // 8. El cupo, solo tras un rechazo (criterio 41): con la reserva vigente el cupo ya es suyo.
    if (estado === 'PAGO_RECHAZADO') await exigirCupoDeLaMatricula(tx, filas, ahora);

    // 9. El pago pendiente, la matrícula reservada sin vencimiento (RN-28) y la auditoría.
    const ipOrigen = ipParaAuditoria(nuevo.ip);
    await tx.cliente.$executeRaw`
      INSERT INTO pagos (id, academia_id, alumno_id, matricula_id, concepto, metodo, estado, monto, numero_operacion,
                         numero_operacion_normalizado, fecha_operacion, comprobante_clave, ip_origen, registrado_por,
                         registrado_en, clave_idempotencia, creado_en, actualizado_en)
      VALUES (${nuevo.pagoId}::uuid, ${tx.academiaId}::uuid, ${filas.alumno.id}::uuid, ${filas.matricula.id}::uuid,
              'INSCRIPCION'::concepto_movimiento_caja, ${datos.metodo}::metodo_pago, 'PENDIENTE_VERIFICACION'::estado_pago,
              ${aTextoMonto(total)}::numeric, ${datos.numeroOperacion}, ${numeroNormalizado}, ${datos.fechaOperacion}::date,
              ${nuevo.clave}, ${ipOrigen}::inet, NULL, ${ahora}::timestamptz, ${datos.claveIdempotencia.toLowerCase()}::uuid,
              ${ahora}::timestamptz, ${ahora}::timestamptz)`;
    await tx.cliente.$executeRaw`
      UPDATE matriculas
         SET estado = 'RESERVADA'::estado_matricula, reserva_vence_en = NULL, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${filas.matricula.id}::uuid`;
    await this.auditoria.registrarEnAcademia(tx, {
      actorTipo: 'PUBLICO',
      actorId: null,
      accion: 'PAGO_COMPROBANTE_REGISTRADO',
      entidad: 'pago',
      entidadId: nuevo.pagoId,
      datosDespues: {
        matriculaId: filas.matricula.id,
        metodo: datos.metodo,
        monto: aTextoMonto(total),
        numeroOperacionNormalizado: numeroNormalizado,
        fechaOperacion: datos.fechaOperacion,
      },
      ip: nuevo.ip,
    });
    return { solicitud: await this.vistaActual(tx, filas.solicitud.id, ahora), creado: true };
  }

  /**
   * La transacción terminó con un error que no decidió ella (de la base, de la conexión, del `COMMIT`): no se sabe si el `COMMIT` llegó
   * (criterios 61 y 64 de 005). No se borra ningún archivo todavía: se relee el pago por su id en una transacción nueva de la academia que no
   * escribe nada, con `FOR SHARE` (espera a que la transacción de la subida termine) y `lock_timeout` de `ESPERA_RELECTURA_MS`. Si el pago
   * está con esta clave, la subida quedó (201 con la vista y el archivo se conserva); si no está, no quedó (se borra el archivo nuevo y se
   * relanza el error original, 500); si la relectura falla o la espera se agota, no se borra nada y se relanza el error original. La clave del
   * archivo lleva un UUID nuevo: si el pago no está ahora, no lo estará nunca, y borrarla es seguro.
   */
  private async resolverConfirmacionIncierta(
    academiaId: string,
    solicitudId: string,
    pagoId: string,
    clave: string,
    errorOriginal: unknown,
  ): Promise<ResultadoDelComprobante> {
    try {
      this.registro.warn(
        { academiaId, error: { tipo: tipoDeError(errorOriginal) } },
        'Confirmación del comprobante incierta',
      );
    } catch {
      // Un registro que falla no cambia la respuesta.
    }
    let vista: VistaSolicitud | null;
    try {
      vista = await this.baseDatos.conAcademia(
        academiaId,
        async (tx) => {
          const filas = await tx.cliente.$queryRaw<{ comprobante_clave: string | null }[]>`
            SELECT comprobante_clave FROM pagos
             WHERE academia_id = ${tx.academiaId}::uuid AND id = ${pagoId}::uuid
               FOR SHARE`;
          if (filas[0]?.comprobante_clave !== clave) return null;
          return this.vistaActual(tx, solicitudId, this.reloj.ahora());
        },
        // `lock_timeout` local a esta transacción (como `SET LOCAL`, que los módulos no pueden ejecutar): la espera agotada es `55P03`.
        { esperaMaximaDeBloqueoMs: ESPERA_RELECTURA_MS },
      );
    } catch {
      // Ni la base ni la academia responden: no se sabe nada, no se borra nada (queda, como mucho, un archivo sin referencia).
      throw errorOriginal;
    }
    if (vista === null) {
      await this.borrarSinFallar(academiaId, clave);
      throw errorOriginal;
    }
    this.registro.info({ academiaId }, 'Comprobante de la solicitud guardado');
    return { solicitud: vista, creado: true };
  }

  /** Borra un archivo nuevo que nadie referencia: un borrado que falla deja un aviso con el tipo del error y nada más. */
  private async borrarSinFallar(academiaId: string, clave: string): Promise<void> {
    try {
      await this.almacen.borrar(academiaId, clave);
    } catch (error) {
      try {
        this.registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, 'No se pudo borrar un archivo');
      } catch {
        // Un registro que falla no cambia la respuesta.
      }
    }
  }
}
