import type { ConceptoIngreso, MetodoPago } from '../caja/movimientos';
import { aTextoMonto } from '../../comun/dinero';
import { anioYMesEnLima } from '../../comun/fechas';
import { ErrorNegocio } from '../../comun/errores';
import type { Decimal, TransaccionAcademia } from '../../infraestructura/prisma';
import { nuevoTokenQr } from '../alumnos/dominio/token-qr';
import { insertarEnAuditoriaDeAcademia } from '../auditoria/insercion';
import { registrarIngresoEnCaja } from '../caja/movimientos';
import type { UsuariosService } from '../usuarios/usuarios.service';
import { dniDelPersonal } from './errores';

/**
 * Confirmar un pago (spec 007, criterio 20; D-04, HU-04, RN-01, RN-02, RN-17). Sin Nest, dentro de la transacción de quien llama (el cobro en
 * efectivo, la aprobación de un Yape o una transferencia de la 007b, la renovación de la 010 y la clase particular de la 016). Precondiciones:
 * quien llama ya llamó a `bloquearActorVigente`, tomó el bloqueo consultivo del DNI, bloqueó el alumno, la solicitud, la matrícula y los pagos
 * (`bloquearFilasDelCobro`) y, si mueve cupo, las clases; y ya decidió todos los 409 que van antes de la caja. En este orden:
 *
 * 1. si el alumno es `CLIENTE`, que no haya ya un usuario de la academia con su DNI (409 `DNI_DEL_PERSONAL`, sin escribir nada): se decide
 *    antes de bloquear la caja, que va al final;
 * 2. `registrarIngresoEnCaja` (bloquea la caja al final): 409 `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`;
 * 3. el siguiente `numero_ticket` de la academia (seguro con la caja bloqueada: toda confirmación pasa por ella; el índice único es el
 *    respaldo, DT-13);
 * 4. el pago queda `CONFIRMADO`, con `verificado_por`, `verificado_en` y su ticket: `INSERT` si es un cobro en efectivo (nace confirmado y va
 *    después de su movimiento porque el `CHECK` exige el ticket; la llave y el trigger del criterio 5 se comprueban al `COMMIT`), o `UPDATE`
 *    del pago pendiente (007b);
 * 5. si el alumno es `CLIENTE`, su cuenta con `crearEnTransaccion` (rol `ALUMNO`, usuario y contraseña inicial iguales a su DNI, con el cambio
 *    obligatorio) y pasa a `ALUMNO_ACTIVO` con su `usuario_id`, su token del QR y la fecha de su generación (008a, criterio 2; solo al
 *    pasar de `CLIENTE` a alumno: una renovación no lo toca);
 * 6. la matrícula pasa a `VIGENTE` sin vencimiento y la solicitud, si tiene, a `CONFIRMADA`; si el alumno estaba `ALUMNO_VENCIDO` y la matrícula
 *    es del mes en curso de Lima, pasa a `ALUMNO_ACTIVO` (010a: la renovación en efectivo y la aprobación de una renovación);
 * 7. la auditoría del pago (`PAGO_REGISTRADO` o `PAGO_APROBADO`).
 *
 * Cualquier error (el de la caja, el del DNI, el de la base) hace que `conAcademia` revierta la transacción completa: no queda ni el pago, ni la
 * cuenta, ni el movimiento, ni la auditoría. Después de la caja solo se insertan filas y se actualizan las que la transacción ya bloqueó.
 */
export interface EntradaDeConfirmacion {
  readonly pagoId: string;
  readonly alumnoId: string;
  readonly matriculaId: string;
  readonly solicitudId: string | null;
  readonly concepto: ConceptoIngreso;
  readonly metodo: MetodoPago;
  /** El total a cobrar: lo que entra a la caja y lo que guarda el pago. */
  readonly monto: Decimal;
  /** El hash argon2 del DNI, calculado antes de abrir la transacción; `null` si el alumno ya tiene su cuenta. */
  readonly claveHash: string | null;
  /** El actor ya bloqueado: quien cobra o verifica. */
  readonly actor: { readonly id: string };
  readonly ip: string | null;
  /**
   * Si el pago se crea al confirmar (el cobro en efectivo), los datos que solo conoce quien lo crea. Si falta, el pago ya existe
   * `PENDIENTE_VERIFICACION` y se actualiza (007b).
   */
  readonly nuevo?: { readonly claveIdempotencia: string };
}

export interface ResultadoDeConfirmacion {
  readonly numeroTicket: number;
  readonly usuarioCreado: boolean;
}

/** El caso de uso `UsuariosService.crearEnTransaccion`, lo único que la confirmación necesita del módulo de usuarios. */
export type CreadorDeCuentas = Pick<UsuariosService, 'crearEnTransaccion'>;

export async function confirmarPagoEnTransaccion(
  tx: TransaccionAcademia,
  usuarios: CreadorDeCuentas,
  entrada: EntradaDeConfirmacion,
  ahora: Date,
): Promise<ResultadoDeConfirmacion> {
  const alumnos = await tx.cliente.$queryRaw<
    { dni: string; nombres: string; apellidos: string; estado: string; usuario_id: string | null }[]
  >`
    SELECT dni, nombres, apellidos, estado::text AS estado, usuario_id::text AS usuario_id FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.alumnoId}::uuid`;
  const alumno = alumnos[0];
  if (!alumno) throw new Error('El alumno del pago no existe.');
  const creaCuenta = alumno.estado === 'CLIENTE' && alumno.usuario_id === null;
  if (creaCuenta && entrada.claveHash === null) throw new Error('Falta la contraseña inicial del alumno.');

  // 1. El DNI del personal (DR-1). Sin bloqueo: la fila de `usuarios` no se toca y no entra en el orden de bloqueos.
  if (creaCuenta) {
    const personal = await tx.cliente.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND dni = ${alumno.dni}) AS existe`;
    if (personal[0]?.existe === true) throw dniDelPersonal();
  }

  // 2. La caja, al final de los bloqueos: sin caja abierta de hoy no se cobra ni se verifica (RN-17).
  await registrarIngresoEnCaja(
    tx,
    {
      concepto: entrada.concepto,
      metodo: entrada.metodo,
      monto: entrada.monto,
      alumnoId: entrada.alumnoId,
      pagoId: entrada.pagoId,
      usuarioId: entrada.actor.id,
      ip: entrada.ip,
    },
    ahora,
  );

  // 3. El siguiente número de ticket de la academia.
  const numeros = await tx.cliente.$queryRaw<{ numero: number }[]>`
    SELECT (coalesce(max(numero_ticket), 0) + 1)::int AS numero FROM pagos WHERE academia_id = ${tx.academiaId}::uuid`;
  const numeroTicket = numeros[0]?.numero ?? 1;
  const monto = aTextoMonto(entrada.monto);

  // 4. El pago, confirmado y completo.
  if (entrada.nuevo !== undefined) {
    await tx.cliente.$executeRaw`
      INSERT INTO pagos (id, academia_id, alumno_id, matricula_id, concepto, metodo, estado, monto, registrado_por, verificado_por,
                         registrado_en, verificado_en, numero_ticket, clave_idempotencia, creado_en, actualizado_en)
      VALUES (${entrada.pagoId}::uuid, ${tx.academiaId}::uuid, ${entrada.alumnoId}::uuid, ${entrada.matriculaId}::uuid,
              ${entrada.concepto}::concepto_movimiento_caja, ${entrada.metodo}::metodo_pago, 'CONFIRMADO'::estado_pago, ${monto}::numeric,
              ${entrada.actor.id}::uuid, ${entrada.actor.id}::uuid, ${ahora}::timestamptz, ${ahora}::timestamptz, ${numeroTicket}::int,
              ${entrada.nuevo.claveIdempotencia}::uuid, ${ahora}::timestamptz, ${ahora}::timestamptz)`;
  } else {
    await tx.cliente.$executeRaw`
      UPDATE pagos
         SET estado = 'CONFIRMADO'::estado_pago, verificado_por = ${entrada.actor.id}::uuid, verificado_en = ${ahora}::timestamptz,
             numero_ticket = ${numeroTicket}::int, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.pagoId}::uuid`;
  }

  // 5. La cuenta del alumno (HU-04, RN-02): su DNI es el usuario y la contraseña inicial, con el cambio obligatorio.
  let usuarioCreado = false;
  if (creaCuenta && entrada.claveHash !== null) {
    let cuentaId: string;
    try {
      const cuenta = await usuarios.crearEnTransaccion(
        tx,
        {
          dni: alumno.dni,
          nombres: alumno.nombres,
          apellidos: alumno.apellidos,
          rol: 'ALUMNO',
          claveHash: entrada.claveHash,
        },
        { tipo: 'USUARIO', id: entrada.actor.id },
        entrada.ip,
      );
      cuentaId = cuenta.id;
    } catch (error) {
      // Con el bloqueo consultivo del DNI no debería llegar: si otro camino creó ese usuario, es el mismo caso del paso 1.
      if (error instanceof ErrorNegocio && error.codigo === 'DNI_EN_USO') throw dniDelPersonal();
      throw error;
    }
    await tx.cliente.$executeRaw`
      UPDATE alumnos SET estado = 'ALUMNO_ACTIVO'::estado_alumno, usuario_id = ${cuentaId}::uuid, qr_token = ${nuevoTokenQr()},
             qr_generado_en = ${ahora}::timestamptz, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.alumnoId}::uuid`;
    usuarioCreado = true;
  }

  // 6. La matrícula y la solicitud.
  await tx.cliente.$executeRaw`
    UPDATE matriculas SET estado = 'VIGENTE'::estado_matricula, reserva_vence_en = NULL, actualizado_en = ${ahora}::timestamptz
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.matriculaId}::uuid`;
  // 6 b. Un alumno vencido que paga la mensualidad del mes en curso vuelve a estar activo, en la misma transacción (8.8, 4.5; spec 010a, criterios 6 y 15).
  //      La de otro mes (la renovación del mes siguiente) no lo cambia: lo decide el cierre de mes (010b). La fila del alumno ya está bloqueada.
  if (alumno.estado === 'ALUMNO_VENCIDO') {
    const matriculas = await tx.cliente.$queryRaw<{ anio: number; mes: number }[]>`
      SELECT anio::int AS anio, mes::int AS mes FROM matriculas
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.matriculaId}::uuid`;
    const enCurso = anioYMesEnLima(ahora);
    if (matriculas[0]?.anio === enCurso.anio && matriculas[0]?.mes === enCurso.mes) {
      await tx.cliente.$executeRaw`
        UPDATE alumnos SET estado = 'ALUMNO_ACTIVO'::estado_alumno, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.alumnoId}::uuid`;
    }
  }
  if (entrada.solicitudId !== null) {
    await tx.cliente.$executeRaw`
      UPDATE solicitudes_inscripcion SET estado = 'CONFIRMADA'::estado_solicitud, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrada.solicitudId}::uuid`;
  }

  // 7. La auditoría del pago, sin el DNI.
  await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
    actorTipo: 'USUARIO',
    actorId: entrada.actor.id,
    accion: entrada.nuevo !== undefined ? 'PAGO_REGISTRADO' : 'PAGO_APROBADO',
    entidad: 'pago',
    entidadId: entrada.pagoId,
    ...(entrada.nuevo !== undefined
      ? {
          datosDespues: {
            matriculaId: entrada.matriculaId,
            metodo: entrada.metodo,
            monto,
            concepto: entrada.concepto,
            numeroTicket,
          },
        }
      : { datosAntes: { estado: 'PENDIENTE_VERIFICACION' }, datosDespues: { estado: 'CONFIRMADO', numeroTicket } }),
    ip: entrada.ip,
  });
  return { numeroTicket, usuarioCreado };
}
