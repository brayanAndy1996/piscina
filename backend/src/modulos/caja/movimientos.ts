import type { ConceptoMovimiento, MetodoPago } from '@aquagestion/contratos';
import { aTextoMonto, montosIguales } from '../../comun/dinero';
import { fechaDeBase } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { Decimal, type TransaccionAcademia } from '../../infraestructura/prisma';
import { insertarEnAuditoriaDeAcademia } from '../auditoria/insercion';
import { esDeOtroDia } from './dominio/dia';
import {
  cajaCerrada,
  cajaDeOtroDia,
  claveYaUsada,
  efectivoInsuficiente,
  noEncontrado,
  sinCajaAbierta,
} from './errores';
import { leerResumen } from './lectura';

/**
 * Las escrituras de movimientos de la caja, sin Nest, para que el servicio de la caja y las historias siguientes las usen dentro de su
 * propia transacción (spec 006, "Interfaces del backend"): `registrarIngresoEnCaja` (la 007: cada cobro y cada verificación),
 * `registrarEgresoEnCaja` (la ruta de egresos y la 019: el pago a un entrenador desde caja) y `leerCajaAbierta`.
 *
 * Reglas (regla "Ningún cobro sin la caja abierta" y "Orden de bloqueos con la caja" de `docs/arquitectura.md`):
 * - Corren dentro de la transacción de quien llama, que ya llamó a `bloquearActorVigente` y bloqueó antes sus demás filas: la caja se
 *   bloquea AL FINAL (después de `usuarios`, de las filas del cliente y de las clases). Después de bloquearla solo se insertan filas y
 *   auditoría.
 * - El día es el de America/Lima de `ahora` (`hoyEnLima`), nunca `CURRENT_DATE`.
 * - Los errores de negocio (`ErrorNegocio`) hacen que `conAcademia` revierta la transacción completa de quien llama.
 * - Los montos son `Decimal`; `numero` se asigna con la caja bloqueada.
 */

export type { MetodoPago } from '@aquagestion/contratos';
export type ConceptoIngreso = Exclude<ConceptoMovimiento, 'EGRESO_MENOR'>;

export interface IngresoEnCaja {
  readonly concepto: ConceptoIngreso;
  readonly metodo: MetodoPago;
  /** Mayor que 0 y como mucho 100000.00, con hasta dos decimales; si no, `RangeError` sin escribir. */
  readonly monto: Decimal;
  /** El alumno (o cliente) de `tx.academiaId`; llave compuesta. */
  readonly alumnoId: string;
  /** La 007 le pone la llave foránea a `pagos`; único en la academia. */
  readonly pagoId: string;
  /** Quien cobra o verifica (el actor ya bloqueado). */
  readonly usuarioId: string;
  /** Para la auditoría. */
  readonly ip: string | null;
}

export interface EgresoEnCaja {
  readonly cajaId: string;
  readonly claveIdempotencia: string;
  readonly descripcion: string;
  readonly monto: Decimal;
  readonly comprobante: string | null;
  readonly usuarioId: string;
  readonly ip: string | null;
}

export interface MovimientoRegistrado {
  readonly id: string;
  readonly cajaId: string;
  readonly numero: number;
  readonly registradoEn: Date;
  /** `true` si ese `pagoId` (o esa clave) ya tenía su movimiento: no se insertó ni se auditó. */
  readonly repetido: boolean;
}

/** El máximo de un ingreso: el monto de un mes completo, redondeado al sol entero (criterio 24; `MONTO_COTIZADO_MAXIMO`). */
const INGRESO_MAXIMO = new Decimal('100000.00');
/** El máximo de un egreso por la interfaz: lo que cabe en `numeric(10,2)`. La ruta ya limita a 99999.99 con `montoSchema`. */
const EGRESO_MAXIMO = new Decimal('99999999.99');

/** Lanza `RangeError` si el monto no es finito, no es mayor que 0, pasa del máximo o tiene más de dos decimales. */
function validarMonto(monto: Decimal, maximo: Decimal): void {
  if (!Decimal.isDecimal(monto) || !monto.isFinite() || monto.lte(0) || monto.gt(maximo) || monto.decimalPlaces() > 2) {
    throw new RangeError('El monto del movimiento no es válido: debe ser mayor que 0 y tener hasta dos decimales.');
  }
}

/** La caja bloqueada: lo que las operaciones necesitan para decidir sin volver a leer. */
export interface CajaBloqueada {
  id: string;
  fecha: string;
  estado: 'ABIERTA' | 'CERRADA';
  monto_inicial: string;
  abierta_en: Date;
}

/**
 * La caja ABIERTA de `tx.academiaId`, con `FOR UPDATE` (o `null` si no hay). En `ReadCommitted`, si un cierre confirma mientras se espera, la
 * condición `estado = 'ABIERTA'` se vuelve a evaluar sobre la fila nueva y ya no la devuelve: el cobro ve que no hay caja abierta (criterio
 * 33 c). Hay como mucho una abierta por academia (índice único parcial).
 */
export async function bloquearCajaAbierta(tx: TransaccionAcademia): Promise<CajaBloqueada | null> {
  const filas = await tx.cliente.$queryRaw<CajaBloqueada[]>`
    SELECT id::text AS id, fecha::text AS fecha, estado::text AS estado, monto_inicial::text AS monto_inicial, abierta_en
      FROM cajas
     WHERE academia_id = ${tx.academiaId}::uuid AND estado = 'ABIERTA'::estado_caja
       FOR UPDATE`;
  return filas[0] ?? null;
}

/** La caja `cajaId` de `tx.academiaId`, con `FOR UPDATE`; `null` si no existe en la academia o el id no es un UUID. */
export async function bloquearCaja(tx: TransaccionAcademia, cajaId: string): Promise<CajaBloqueada | null> {
  if (!PATRON_UUID.test(cajaId)) return null;
  const filas = await tx.cliente.$queryRaw<CajaBloqueada[]>`
    SELECT id::text AS id, fecha::text AS fecha, estado::text AS estado, monto_inicial::text AS monto_inicial, abierta_en
      FROM cajas
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${cajaId.toLowerCase()}::uuid
       FOR UPDATE`;
  return filas[0] ?? null;
}

/** El número del siguiente movimiento de la caja (1, 2, 3…). Seguro solo con la caja bloqueada. */
async function siguienteNumero(tx: TransaccionAcademia, cajaId: string): Promise<number> {
  const filas = await tx.cliente.$queryRaw<{ numero: number }[]>`
    SELECT (coalesce(max(numero), 0) + 1)::int AS numero FROM movimientos_caja
     WHERE academia_id = ${tx.academiaId}::uuid AND caja_id = ${cajaId}::uuid`;
  return filas[0]?.numero ?? 1;
}

interface FilaDeMovimientoPrevio {
  id: string;
  caja_id: string;
  numero: number;
  registrado_en: Date;
  tipo: 'INGRESO' | 'EGRESO';
  monto: string;
  descripcion: string | null;
  comprobante: string | null;
}

/**
 * Registra el ingreso de un cobro en la caja abierta (spec 006, criterio 24; D-04, RN-17). Corre dentro de la transacción de quien llama
 * (que ya llamó a `bloquearActorVigente` y bloqueó antes sus demás filas), en este orden:
 * 1. bloquea la caja abierta de `tx.academiaId` con `FOR UPDATE`: si no hay, 409 `SIN_CAJA_ABIERTA`; si es de otro día según `ahora` en Lima,
 *    409 `CAJA_DE_OTRO_DIA` (la transacción de quien llama debe revertirse: no queda un cobro sin su movimiento);
 * 2. si ya hay un movimiento con ese `pagoId` en la academia, lo devuelve con `repetido: true`, sin insertar ni auditar;
 * 3. si no, comprueba el monto (`RangeError` sin escribir), inserta el `INGRESO` con el siguiente `numero` y audita
 *    `CAJA_INGRESO_REGISTRADO`.
 * Un `alumnoId` de otra academia o que no existe hace fallar la transacción (23503, llave compuesta).
 */
export async function registrarIngresoEnCaja(
  tx: TransaccionAcademia,
  ingreso: IngresoEnCaja,
  ahora: Date,
): Promise<MovimientoRegistrado> {
  const caja = await bloquearCajaAbierta(tx);
  if (!caja) throw sinCajaAbierta();
  if (esDeOtroDia(caja.fecha, ahora)) throw cajaDeOtroDia(caja.id, caja.fecha);

  const previos = await tx.cliente.$queryRaw<FilaDeMovimientoPrevio[]>`
    SELECT id::text AS id, caja_id::text AS caja_id, numero, registrado_en, tipo::text AS tipo, monto::text AS monto, descripcion, comprobante
      FROM movimientos_caja
     WHERE academia_id = ${tx.academiaId}::uuid AND pago_id = ${ingreso.pagoId}::uuid`;
  const previo = previos[0];
  if (previo) {
    return {
      id: previo.id,
      cajaId: previo.caja_id,
      numero: previo.numero,
      registradoEn: fechaDeBase(previo.registrado_en),
      repetido: true,
    };
  }

  validarMonto(ingreso.monto, INGRESO_MAXIMO);
  const monto = aTextoMonto(ingreso.monto);
  const numero = await siguienteNumero(tx, caja.id);
  const filas = await tx.cliente.$queryRaw<{ id: string; registrado_en: Date }[]>`
    INSERT INTO movimientos_caja (academia_id, caja_id, numero, tipo, concepto, metodo, monto, alumno_id, pago_id, registrado_por, registrado_en)
    VALUES (${tx.academiaId}::uuid, ${caja.id}::uuid, ${numero}::int, 'INGRESO'::tipo_movimiento_caja,
            ${ingreso.concepto}::concepto_movimiento_caja, ${ingreso.metodo}::metodo_pago, ${monto}::numeric,
            ${ingreso.alumnoId}::uuid, ${ingreso.pagoId}::uuid, ${ingreso.usuarioId}::uuid, ${ahora}::timestamptz)
    RETURNING id::text AS id, registrado_en`;
  const insertado = filas[0];
  if (!insertado) throw new Error('El ingreso de la caja no devolvió fila.');
  await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
    actorTipo: 'USUARIO',
    actorId: ingreso.usuarioId,
    accion: 'CAJA_INGRESO_REGISTRADO',
    entidad: 'movimiento_caja',
    entidadId: insertado.id,
    datosDespues: {
      cajaId: caja.id,
      numero,
      concepto: ingreso.concepto,
      metodo: ingreso.metodo,
      monto,
      alumnoId: ingreso.alumnoId,
      pagoId: ingreso.pagoId,
    },
    ip: ingreso.ip,
  });
  return {
    id: insertado.id,
    cajaId: caja.id,
    numero,
    registradoEn: fechaDeBase(insertado.registrado_en),
    repetido: false,
  };
}

/**
 * Registra un egreso menor, siempre en efectivo (DR-3), en la caja `cajaId` (spec 006, criterios 17 y 19 a 22). La usan la ruta de egresos y
 * la 019 (pago a un entrenador desde caja, RN-35). Bloquea la caja con `FOR UPDATE` y decide en este orden: 404 `NO_ENCONTRADO` (la caja no
 * existe en la academia) → la clave de idempotencia (los mismos datos devuelven el movimiento ya registrado con `repetido: true`; otros datos o
 * otra caja, 409 `CLAVE_YA_USADA`; la clave se mira antes que el estado de la caja) → 409 `CAJA_CERRADA` → 409 `CAJA_DE_OTRO_DIA` → 409
 * `EFECTIVO_INSUFICIENTE` (el egreso no deja el efectivo esperado por debajo de cero, DR-4). Después inserta con el siguiente `numero` y audita
 * `CAJA_EGRESO_REGISTRADO`. `RangeError` si el monto no es válido.
 */
export async function registrarEgresoEnCaja(
  tx: TransaccionAcademia,
  egreso: EgresoEnCaja,
  ahora: Date,
): Promise<MovimientoRegistrado> {
  validarMonto(egreso.monto, EGRESO_MAXIMO);
  const caja = await bloquearCaja(tx, egreso.cajaId);
  if (!caja) throw noEncontrado();

  const previos = await tx.cliente.$queryRaw<FilaDeMovimientoPrevio[]>`
    SELECT id::text AS id, caja_id::text AS caja_id, numero, registrado_en, tipo::text AS tipo, monto::text AS monto, descripcion, comprobante
      FROM movimientos_caja
     WHERE academia_id = ${tx.academiaId}::uuid AND clave_idempotencia = ${egreso.claveIdempotencia}::uuid`;
  const previo = previos[0];
  if (previo) {
    const mismosDatos =
      previo.caja_id === caja.id &&
      previo.tipo === 'EGRESO' &&
      previo.descripcion === egreso.descripcion &&
      (previo.comprobante ?? null) === egreso.comprobante &&
      montosIguales(previo.monto, egreso.monto);
    if (!mismosDatos) throw claveYaUsada();
    return {
      id: previo.id,
      cajaId: previo.caja_id,
      numero: previo.numero,
      registradoEn: fechaDeBase(previo.registrado_en),
      repetido: true,
    };
  }

  if (caja.estado === 'CERRADA') throw cajaCerrada();
  if (esDeOtroDia(caja.fecha, ahora)) throw cajaDeOtroDia(caja.id, caja.fecha);
  const resumen = await leerResumen(tx, caja.id, caja.monto_inicial);
  if (egreso.monto.gt(resumen.montos.esperado.efectivo)) {
    throw efectivoInsuficiente(aTextoMonto(resumen.montos.esperado.efectivo));
  }

  const monto = aTextoMonto(egreso.monto);
  const numero = resumen.ultimoMovimiento + 1;
  const filas = await tx.cliente.$queryRaw<{ id: string; registrado_en: Date }[]>`
    INSERT INTO movimientos_caja (academia_id, caja_id, numero, tipo, concepto, metodo, monto, descripcion, comprobante, registrado_por,
                                  registrado_en, clave_idempotencia)
    VALUES (${tx.academiaId}::uuid, ${caja.id}::uuid, ${numero}::int, 'EGRESO'::tipo_movimiento_caja, 'EGRESO_MENOR'::concepto_movimiento_caja,
            'EFECTIVO'::metodo_pago, ${monto}::numeric, ${egreso.descripcion}, ${egreso.comprobante}, ${egreso.usuarioId}::uuid,
            ${ahora}::timestamptz, ${egreso.claveIdempotencia}::uuid)
    RETURNING id::text AS id, registrado_en`;
  const insertado = filas[0];
  if (!insertado) throw new Error('El egreso de la caja no devolvió fila.');
  await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
    actorTipo: 'USUARIO',
    actorId: egreso.usuarioId,
    accion: 'CAJA_EGRESO_REGISTRADO',
    entidad: 'movimiento_caja',
    entidadId: insertado.id,
    datosDespues: { cajaId: caja.id, numero, descripcion: egreso.descripcion, monto, comprobante: egreso.comprobante },
    ip: egreso.ip,
  });
  return {
    id: insertado.id,
    cajaId: caja.id,
    numero,
    registradoEn: fechaDeBase(insertado.registrado_en),
    repetido: false,
  };
}

/**
 * La caja abierta de `tx.academiaId` (de hoy o de otro día según `ahora` en Lima), o `null` si no hay. Lectura sin bloqueo, para que la 007
 * avise antes de empezar ("abre la caja") sin decidir con ella: la decisión la toma `registrarIngresoEnCaja` con la caja bloqueada.
 */
export async function leerCajaAbierta(
  tx: TransaccionAcademia,
  ahora: Date,
): Promise<{ id: string; fecha: string; deOtroDia: boolean } | null> {
  const filas = await tx.cliente.$queryRaw<{ id: string; fecha: string }[]>`
    SELECT id::text AS id, fecha::text AS fecha FROM cajas
     WHERE academia_id = ${tx.academiaId}::uuid AND estado = 'ABIERTA'::estado_caja`;
  const caja = filas[0];
  return caja ? { id: caja.id, fecha: caja.fecha, deOtroDia: esDeOtroDia(caja.fecha, ahora) } : null;
}
