import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AjustarMonto,
  type CobrarEnEfectivo,
  esMenorDeEdad,
  type Pago,
  type RespuestaSolicitudPanel,
  type SolicitudPanel,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aDecimal, aTextoMonto, montosIguales } from '../../comun/dinero';
import { hoyEnLima } from '../../comun/fechas';
import { ENVIADOR_CORREO, enviarSinEsperar, type EnviadorCorreo } from '../../infraestructura/correo';
import { BaseDatos, restriccionDeUnicidadViolada, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { hashearClave } from '../../infraestructura/seguridad';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { bloquearClasesParaCupo } from '../clases';
import { estadoVisible } from '../inscripciones/estado-visible';
import { leerElementosDelPanel } from '../inscripciones/panel-solicitudes';
import { contarOcupacion } from '../matriculas';
import { UsuariosService } from '../usuarios/usuarios.service';
import { bloquearFilasDelCobro, type FilasDelCobro, leerDniDeLaSolicitud } from './bloqueos';
import { confirmarPagoEnTransaccion } from './confirmacion';
import { totalACobrar } from './dominio/total';
import {
  claveYaUsada,
  montoCambioDelCobro,
  noEncontrado,
  pagoEnVerificacion,
  sinCupo,
  solicitudNoAjustable,
  solicitudNoCobrable,
  solicitudYaPagada,
} from './errores';

/** Las restricciones únicas que, al chocar, indican que otra transacción llegó antes: se vuelve a decidir con lo que ya se confirmó. */
const RESTRICCIONES_DE_CARRERA: readonly string[] = [
  'pagos_academia_id_clave_idempotencia_key',
  'pagos_un_abierto_por_matricula',
  'pagos_academia_id_numero_ticket_key',
];

/** Lo que responde el cobro: el pago, la solicitud del panel y si se creó ahora (201) o ya estaba (200, un reintento). */
export interface ResultadoDelCobro {
  readonly pago: Pago;
  readonly solicitud: SolicitudPanel;
  readonly creado: boolean;
}

interface DestinatarioDelAviso {
  readonly correos: readonly string[];
  readonly codigo: string;
}

interface FilaDelPago {
  id: string;
  estado: Pago['estado'];
  metodo: Pago['metodo'];
  concepto: Pago['concepto'];
  monto: string;
  registrado_en: Date;
  verificado_en: Date | null;
  numero_operacion: string | null;
  fecha_operacion: string | null;
  motivo_rechazo: string | null;
  numero_ticket: number | null;
}

/**
 * El pago que se muestra (`pagoSchema`): nunca el comprobante, la clave de idempotencia, la IP ni quién lo registró. Lee con la `tx` de quien
 * llama (sin bloquear).
 */
export async function leerPago(tx: TransaccionAcademia, pagoId: string): Promise<Pago | null> {
  const filas = await tx.cliente.$queryRaw<FilaDelPago[]>`
    SELECT id::text AS id, estado::text AS estado, metodo::text AS metodo, concepto::text AS concepto, monto::text AS monto,
           registrado_en, verificado_en, numero_operacion, fecha_operacion::text AS fecha_operacion, motivo_rechazo, numero_ticket
      FROM pagos WHERE academia_id = ${tx.academiaId}::uuid AND id = ${pagoId}::uuid`;
  const fila = filas[0];
  if (!fila) return null;
  return {
    id: fila.id,
    estado: fila.estado,
    metodo: fila.metodo,
    concepto: fila.concepto,
    monto: aTextoMonto(fila.monto),
    registradoEn: fila.registrado_en.toISOString(),
    verificadoEn: fila.verificado_en ? fila.verificado_en.toISOString() : null,
    numeroOperacion: fila.numero_operacion,
    fechaOperacion: fila.fecha_operacion,
    motivoRechazo: fila.motivo_rechazo,
    numeroTicket: fila.numero_ticket,
  };
}

/**
 * Cobro en efectivo en recepción y ajuste del monto (spec 007a, criterios 10 a 25; HU-07, HU-34, RN-25, D-03, D-04). La academia sale siempre de
 * la sesión. Todo corre con `conAcademia` y, a pedido de un usuario, con `bloquearActorVigente` como primera sentencia.
 *
 * - `cobrarEnEfectivo`: una lectura corta previa (sin bloqueos) trae el DNI del alumno y, solo si es un cliente, se calcula el hash argon2 de su
 *   contraseña inicial **antes** de abrir la transacción (criterio 23). La transacción toma `usuarios` (actor) → bloqueo consultivo del DNI →
 *   `alumnos` → `solicitudes_inscripcion` → `matriculas` → `pagos` → `clases` → la caja, al final (criterio 19). «Ahora» se lee después de bloquear las
 *   clases (DT-10, criterio 18 b). Las decisiones siguen el orden del contrato: clave de idempotencia (200 o `CLAVE_YA_USADA`), estado de la
 *   solicitud, monto, cupo, DNI del personal y caja. El correo va después de confirmar, sin esperar.
 * - `ajustarMonto`: las mismas filas, sin clases ni caja; así ajuste y cobro se ordenan (criterio 12).
 */
@Injectable()
export class CobrosService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    private readonly usuarios: UsuariosService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ENVIADOR_CORREO) private readonly correo: EnviadorCorreo,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(CobrosService.name);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/solicitudes/{id}/pago-efectivo (criterios 13 a 19 y 51 a)
  // -------------------------------------------------------------------------------------------------------------------------------

  async cobrarEnEfectivo(
    sesion: SesionVerificada,
    solicitudIdPedido: string,
    datos: CobrarEnEfectivo,
    ip: string | null,
  ): Promise<ResultadoDelCobro> {
    const actor = actorDeSesion(sesion);
    // Lectura corta, sin bloqueos y fuera de la transacción del cobro: el DNI de quien se va a cobrar y, solo si todavía es un cliente (hay
    // cuenta por crear), el hash argon2 de su contraseña inicial, que tarda decenas de milisegundos (criterio 23).
    const previa = await this.baseDatos.conAcademia(actor.academiaId, (tx) =>
      leerDniDeLaSolicitud(tx, solicitudIdPedido),
    );
    const claveHash = previa?.esCliente === true ? await hashearClave(previa.dni) : null;

    // Con una carrera por una clave o una matrícula que otro cobro ya tomó, se vuelve a decidir con lo que esa transacción confirmó (una vez).
    for (let intento = 0; ; intento++) {
      try {
        const resultado = await this.baseDatos.conAcademia(actor.academiaId, (tx) =>
          this.cobrarEnTransaccion(tx, sesion, solicitudIdPedido, datos, previa, claveHash, ip),
        );
        if (resultado.aviso !== null) this.avisarPagoConfirmado(sesion, resultado.aviso);
        return { pago: resultado.pago, solicitud: resultado.solicitud, creado: resultado.creado };
      } catch (error) {
        const restriccion = restriccionDeUnicidadViolada(error);
        if (restriccion !== null && RESTRICCIONES_DE_CARRERA.includes(restriccion) && intento === 0) continue;
        if (restriccion === 'pagos_un_abierto_por_matricula') throw solicitudYaPagada();
        if (restriccion === 'pagos_academia_id_clave_idempotencia_key') throw claveYaUsada();
        throw error;
      }
    }
  }

  private async cobrarEnTransaccion(
    tx: TransaccionAcademia,
    sesion: SesionVerificada,
    solicitudIdPedido: string,
    datos: CobrarEnEfectivo,
    previa: { alumnoId: string; dni: string; esCliente: boolean } | null,
    claveHash: string | null,
    ip: string | null,
  ): Promise<ResultadoDeLaTransaccion> {
    const actor = actorDeSesion(sesion);
    // 1. El actor sigue vigente: 401 antes que cualquier 404 o 409.
    await bloquearActorVigente(tx, { id: actor.id, versionToken: actor.versionToken }, { registro: this.registro, ip });
    if (previa === null) throw noEncontrado();
    // 2. Las filas, en el orden de la regla: consultivo del DNI → alumno → solicitud → matrícula → pagos.
    const filas = await bloquearFilasDelCobro(tx, {
      solicitudId: solicitudIdPedido,
      alumnoId: previa.alumnoId,
      dni: previa.dni,
    });
    if (filas === null) throw noEncontrado();
    // 3. Las clases de la matrícula, en una sola llamada y antes de decidir (DT-10): quien las tuvo antes ya terminó.
    await bloquearClasesParaCupo(tx, filas.claseIds);
    // 4. «Ahora» después de bloquear las clases (criterio 18 b): toda decisión de la transacción usa este instante.
    const ahora = this.reloj.ahora();
    const claveIdempotencia = datos.claveIdempotencia.toLowerCase();

    // 5. La clave de idempotencia (criterio 17): antes que el estado de la solicitud y que la caja.
    const previos = await tx.cliente.$queryRaw<
      { id: string; matricula_id: string; metodo: string; estado: string; monto: string }[]
    >`
      SELECT id::text AS id, matricula_id::text AS matricula_id, metodo::text AS metodo, estado::text AS estado, monto::text AS monto
        FROM pagos WHERE academia_id = ${tx.academiaId}::uuid AND clave_idempotencia = ${claveIdempotencia}::uuid`;
    const repetido = previos[0];
    if (repetido) {
      const mismoCobro =
        repetido.matricula_id === filas.matricula.id &&
        repetido.metodo === 'EFECTIVO' &&
        repetido.estado === 'CONFIRMADO' &&
        montosIguales(repetido.monto, datos.montoMostrado);
      if (!mismoCobro) throw claveYaUsada();
      return { ...(await this.respuestaDe(tx, ahora, filas.solicitud.id, repetido.id)), creado: false, aviso: null };
    }

    // 6. El estado visible de la solicitud (criterio 15).
    const estado = estadoVisible(
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
    if (estado === 'CONFIRMADA') throw solicitudYaPagada();
    if (estado === 'EN_VERIFICACION') throw pagoEnVerificacion();
    if (estado === 'VENCIDA' || estado === 'CANCELADA') throw solicitudNoCobrable(estado);

    // 7. El monto que vio quien cobra es el total (criterio 16).
    const total = totalACobrar(filas.matricula);
    if (!montosIguales(datos.montoMostrado, total)) throw montoCambioDelCobro(aTextoMonto(total));

    // 8. El cupo (criterio 18): con la reserva vigente el cupo ya es suyo y no se cuenta (a); tras un rechazo (007b) vuelve a pedirlo (c).
    if (estado === 'PAGO_RECHAZADO') await this.exigirCupo(tx, filas, ahora);

    // 9. El pago: el DNI del personal y la caja, al final, los decide la confirmación.
    const pagoId = randomUUID();
    await confirmarPagoEnTransaccion(
      tx,
      this.usuarios,
      {
        pagoId,
        alumnoId: filas.alumno.id,
        matriculaId: filas.matricula.id,
        solicitudId: filas.solicitud.id,
        concepto: 'INSCRIPCION',
        metodo: 'EFECTIVO',
        monto: total,
        claveHash,
        actor: { id: actor.id },
        ip,
        nuevo: { claveIdempotencia },
      },
      ahora,
    );
    return {
      ...(await this.respuestaDe(tx, ahora, filas.solicitud.id, pagoId)),
      creado: true,
      aviso: await this.destinatariosDelAviso(tx, filas, ahora),
    };
  }

  /** Cada clase de la matrícula debe tener lugar para esta matrícula (que no ocupa cupo mientras está cancelada). Con las clases ya bloqueadas. */
  private async exigirCupo(tx: TransaccionAcademia, filas: FilasDelCobro, ahora: Date): Promise<void> {
    const clases = await tx.cliente.$queryRaw<{ id: string; aforo: number }[]>`
      SELECT id::text AS id, aforo::int AS aforo FROM clases
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${[...filas.claseIds]}::uuid[])`;
    const ocupacion = await contarOcupacion(
      tx,
      filas.claseIds,
      { anio: filas.matricula.anio, mes: filas.matricula.mes },
      ahora,
    );
    const llenas = clases.filter((clase) => (ocupacion.get(clase.id) ?? 0) >= clase.aforo).map((clase) => clase.id);
    if (llenas.length > 0) throw sinCupo(filas.claseIds.filter((id) => llenas.includes(id)));
  }

  private async respuestaDe(
    tx: TransaccionAcademia,
    ahora: Date,
    solicitudId: string,
    pagoId: string,
  ): Promise<{ pago: Pago; solicitud: SolicitudPanel }> {
    const pago = await leerPago(tx, pagoId);
    const [solicitud] = await leerElementosDelPanel(tx, ahora, { id: solicitudId });
    if (!pago || !solicitud) throw new Error('El cobro no dejó su pago o su solicitud.');
    return { pago, solicitud };
  }

  /** A quién avisar del pago (criterio 51 a): el correo actual del alumno y, si es menor, el de su apoderado, sin repetir. */
  private async destinatariosDelAviso(
    tx: TransaccionAcademia,
    filas: FilasDelCobro,
    ahora: Date,
  ): Promise<DestinatarioDelAviso> {
    const personas = await tx.cliente.$queryRaw<
      { correo: string | null; fecha_nacimiento: string; correo_apoderado: string | null }[]
    >`
      SELECT a.correo, a.fecha_nacimiento::text AS fecha_nacimiento, ap.correo AS correo_apoderado
        FROM alumnos a
        LEFT JOIN apoderados ap ON ap.academia_id = a.academia_id AND ap.alumno_id = a.id
       WHERE a.academia_id = ${tx.academiaId}::uuid AND a.id = ${filas.alumno.id}::uuid`;
    const persona = personas[0];
    const correos: string[] = [];
    if (persona) {
      const menor = esMenorDeEdad(persona.fecha_nacimiento, hoyEnLima(ahora));
      for (const correo of [persona.correo, menor ? persona.correo_apoderado : null]) {
        if (correo !== null && correo !== undefined && correo !== '' && !correos.includes(correo)) correos.push(correo);
      }
    }
    return { correos, codigo: filas.solicitud.codigo };
  }

  /** Después de confirmar y sin esperar (D-19, criterio 51): ni un proveedor lento ni un fallo cambian la respuesta. Sin el DNI ni el token. */
  private avisarPagoConfirmado(sesion: SesionVerificada, aviso: DestinatarioDelAviso): void {
    for (const para of aviso.correos) {
      enviarSinEsperar(
        this.correo,
        {
          academiaId: sesion.usuario.academiaId,
          para,
          plantilla: 'PAGO_CONFIRMADO',
          datos: {
            nombreAcademia: sesion.academia.nombre,
            codigo: aviso.codigo,
            enlaceDeIngreso: `/a/${sesion.academia.nombreCorto}/ingresar`,
            aviso:
              'Tu usuario y tu contraseña inicial son tu DNI. Al entrar por primera vez debes cambiar tu contraseña.',
          },
        },
        this.registro,
      );
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/solicitudes/{id}/ajuste-monto (criterios 11 y 12)
  // -------------------------------------------------------------------------------------------------------------------------------

  async ajustarMonto(
    sesion: SesionVerificada,
    solicitudIdPedido: string,
    datos: AjustarMonto,
    ip: string | null,
  ): Promise<RespuestaSolicitudPanel> {
    const actor = actorDeSesion(sesion);
    return this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      // El DNI para el bloqueo consultivo se lee aquí, sin bloqueo: no cambia (criterio 12).
      const previa = await leerDniDeLaSolicitud(tx, solicitudIdPedido);
      if (previa === null) throw noEncontrado();
      const filas = await bloquearFilasDelCobro(tx, {
        solicitudId: solicitudIdPedido,
        alumnoId: previa.alumnoId,
        dni: previa.dni,
      });
      if (filas === null) throw noEncontrado();
      const ahora = this.reloj.ahora();
      const estado = estadoVisible(
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
      if (estado !== 'PENDIENTE_PAGO' && estado !== 'PAGO_RECHAZADO') throw solicitudNoAjustable(estado);

      const nuevo = aDecimal(datos.montoAjustado);
      const mismoMonto = filas.matricula.montoAjustado !== null && filas.matricula.montoAjustado.equals(nuevo);
      const mismoMotivo = filas.matricula.motivoAjuste === datos.motivo;
      // El mismo monto con el mismo motivo que ya tiene: nada que escribir ni auditar.
      if (!(mismoMonto && mismoMotivo)) {
        const antes = {
          montoAjustado: filas.matricula.montoAjustado === null ? null : aTextoMonto(filas.matricula.montoAjustado),
          total: aTextoMonto(totalACobrar(filas.matricula)),
        };
        await tx.cliente.$executeRaw`
          UPDATE matriculas
             SET monto_ajustado = ${aTextoMonto(nuevo)}::numeric, motivo_ajuste = ${datos.motivo}, actualizado_en = ${ahora}::timestamptz
           WHERE academia_id = ${tx.academiaId}::uuid AND id = ${filas.matricula.id}::uuid`;
        const despues = {
          montoAjustado: aTextoMonto(nuevo),
          total: aTextoMonto(totalACobrar({ ...filas.matricula, montoAjustado: nuevo })),
        };
        await this.auditoria.registrarEnAcademia(tx, {
          actorTipo: 'USUARIO',
          actorId: actor.id,
          accion: 'MATRICULA_MONTO_AJUSTADO',
          entidad: 'matricula',
          entidadId: filas.matricula.id,
          motivo: datos.motivo,
          datosAntes: antes,
          datosDespues: despues,
          ip,
        });
      }
      const [solicitud] = await leerElementosDelPanel(tx, ahora, { id: filas.solicitud.id });
      if (!solicitud) throw noEncontrado();
      return { solicitud };
    });
  }
}

interface ResultadoDeLaTransaccion {
  readonly pago: Pago;
  readonly solicitud: SolicitudPanel;
  readonly creado: boolean;
  /** A quién avisar después de confirmar, solo si el cobro se creó en esta transacción. */
  readonly aviso: DestinatarioDelAviso | null;
}
