import type { Caja, CierreCaja, MetodoPago, MovimientoCaja, PersonaCaja, ResumenCaja } from '@aquagestion/contratos';
import { aDecimal, aTextoMonto } from '../../comun/dinero';
import { fechaDeBase, fechaDeBaseONula } from '../../comun/fechas';
import { Decimal, type TransaccionAcademia } from '../../infraestructura/prisma';
import { esDeOtroDia } from './dominio/dia';
import { calcularDiferencia, calcularResumen, type MontosPorMetodo, type ResumenDeMontos } from './dominio/esperado';

/**
 * Lectura de la caja (spec 006, criterios 25 y 28): la caja con su resumen, sus movimientos y sus cierres, con una consulta por parte y dentro
 * de la transacción de quien llama. Sin Nest, sin bloqueos y sin auditoría; las funciones no guardan nada entre llamadas (cada operación
 * lee con su propia `tx`). Los montos salen de la base como texto (`::text`) y se calculan con `Decimal`: nunca pasan por `number`.
 * Ningún dato personal de más: de cada persona solo el id, los nombres y los apellidos (nunca el DNI, RNF-05).
 */

/** Los sumandos del resumen de una caja, con el número del último movimiento (0 si no tiene). */
export interface ResumenLeido {
  readonly montos: ResumenDeMontos;
  readonly ultimoMovimiento: number;
}

interface FilaDeSumas {
  ingresos_efectivo: string;
  ingresos_yape: string;
  ingresos_transferencia: string;
  egresos_efectivo: string;
  ultimo_movimiento: number;
}

/**
 * El resumen de una caja con sumas de `numeric` en la base (un solo `SELECT`) y las cuentas con `Decimal`: el esperado en efectivo
 * (monto inicial + ingresos en efectivo - egresos) lo calcula `calcularResumen`. La usan la caja actual, el egreso (efectivo disponible) y
 * el cierre, siempre con la caja ya bloqueada cuando la cifra decide algo.
 */
export async function leerResumen(
  tx: TransaccionAcademia,
  cajaId: string,
  montoInicial: Decimal | string,
): Promise<ResumenLeido> {
  const filas = await tx.cliente.$queryRaw<FilaDeSumas[]>`
    SELECT coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO'::tipo_movimiento_caja AND metodo = 'EFECTIVO'::metodo_pago), 0)::text AS ingresos_efectivo,
           coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO'::tipo_movimiento_caja AND metodo = 'YAPE'::metodo_pago), 0)::text AS ingresos_yape,
           coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO'::tipo_movimiento_caja AND metodo = 'TRANSFERENCIA'::metodo_pago), 0)::text AS ingresos_transferencia,
           coalesce(sum(monto) FILTER (WHERE tipo = 'EGRESO'::tipo_movimiento_caja), 0)::text AS egresos_efectivo,
           coalesce(max(numero), 0)::int AS ultimo_movimiento
      FROM movimientos_caja
     WHERE academia_id = ${tx.academiaId}::uuid AND caja_id = ${cajaId}::uuid`;
  const sumas = filas[0];
  if (!sumas) throw new Error('La consulta del resumen de la caja no devolvió fila.');
  const agregados: { tipo: 'INGRESO' | 'EGRESO'; metodo: MetodoPago; monto: Decimal }[] = [
    { tipo: 'INGRESO', metodo: 'EFECTIVO', monto: aDecimal(sumas.ingresos_efectivo) },
    { tipo: 'INGRESO', metodo: 'YAPE', monto: aDecimal(sumas.ingresos_yape) },
    { tipo: 'INGRESO', metodo: 'TRANSFERENCIA', monto: aDecimal(sumas.ingresos_transferencia) },
    { tipo: 'EGRESO', metodo: 'EFECTIVO', monto: aDecimal(sumas.egresos_efectivo) },
  ];
  return {
    montos: calcularResumen({ montoInicial: new Decimal(montoInicial), movimientos: agregados }),
    ultimoMovimiento: sumas.ultimo_movimiento,
  };
}

const porMetodoATexto = (montos: MontosPorMetodo) => ({
  efectivo: aTextoMonto(montos.efectivo),
  yape: aTextoMonto(montos.yape),
  transferencia: aTextoMonto(montos.transferencia),
});

/** El resumen de la respuesta (`resumenCajaSchema`): montos con dos decimales. */
export function resumenParaRespuesta(resumen: ResumenLeido): ResumenCaja {
  return {
    ingresos: porMetodoATexto(resumen.montos.ingresos),
    egresos: { efectivo: aTextoMonto(resumen.montos.egresos.efectivo) },
    esperado: porMetodoATexto(resumen.montos.esperado),
    ultimoMovimiento: resumen.ultimoMovimiento,
  };
}

interface FilaDeCaja {
  id: string;
  fecha: string;
  estado: 'ABIERTA' | 'CERRADA';
  monto_inicial: string;
  abierta_en: Date;
  abierta_por_id: string;
  abierta_por_nombres: string;
  abierta_por_apellidos: string;
}

interface FilaDeMovimiento {
  id: string;
  numero: number;
  tipo: 'INGRESO' | 'EGRESO';
  concepto: MovimientoCaja['concepto'];
  metodo: MetodoPago;
  monto: string;
  descripcion: string | null;
  comprobante: string | null;
  registrado_en: Date;
  alumno_id: string | null;
  alumno_nombres: string | null;
  alumno_apellidos: string | null;
  registrado_por_id: string;
  registrado_por_nombres: string;
  registrado_por_apellidos: string;
}

interface FilaDeCierre {
  numero: number;
  cerrado_por_id: string;
  cerrado_por_nombres: string;
  cerrado_por_apellidos: string;
  cerrado_en: Date;
  monto_inicial: string;
  ingresos_efectivo: string;
  ingresos_yape: string;
  ingresos_transferencia: string;
  egresos_efectivo: string;
  esperado_efectivo: string;
  monto_declarado: string;
  diferencia: string;
  observacion: string | null;
  tardio: boolean;
  movimientos_hasta: number;
  reabierto_por_id: string | null;
  reabierto_por_nombres: string | null;
  reabierto_por_apellidos: string | null;
  reabierto_en: Date | null;
  motivo_reapertura: string | null;
}

const persona = (id: string, nombres: string, apellidos: string): PersonaCaja => ({ id, nombres, apellidos });

function movimientoDeFila(fila: FilaDeMovimiento): MovimientoCaja {
  return {
    id: fila.id,
    numero: fila.numero,
    tipo: fila.tipo,
    concepto: fila.concepto,
    metodo: fila.metodo,
    monto: aTextoMonto(fila.monto),
    descripcion: fila.descripcion,
    comprobante: fila.comprobante,
    alumno:
      fila.alumno_id === null ? null : persona(fila.alumno_id, fila.alumno_nombres ?? '', fila.alumno_apellidos ?? ''),
    registradoPor: persona(fila.registrado_por_id, fila.registrado_por_nombres, fila.registrado_por_apellidos),
    registradoEn: fechaDeBase(fila.registrado_en).toISOString(),
  };
}

function cierreDeFila(fila: FilaDeCierre): CierreCaja {
  const esperado = aDecimal(fila.esperado_efectivo);
  const { resultado } = calcularDiferencia(aDecimal(fila.monto_declarado), esperado);
  const reabiertoEn = fechaDeBaseONula(fila.reabierto_en);
  return {
    numero: fila.numero,
    cerradoPor: persona(fila.cerrado_por_id, fila.cerrado_por_nombres, fila.cerrado_por_apellidos),
    cerradoEn: fechaDeBase(fila.cerrado_en).toISOString(),
    montoInicial: aTextoMonto(fila.monto_inicial),
    ingresos: {
      efectivo: aTextoMonto(fila.ingresos_efectivo),
      yape: aTextoMonto(fila.ingresos_yape),
      transferencia: aTextoMonto(fila.ingresos_transferencia),
    },
    egresos: { efectivo: aTextoMonto(fila.egresos_efectivo) },
    esperado: {
      efectivo: aTextoMonto(esperado),
      yape: aTextoMonto(fila.ingresos_yape),
      transferencia: aTextoMonto(fila.ingresos_transferencia),
    },
    montoDeclarado: aTextoMonto(fila.monto_declarado),
    diferencia: aTextoMonto(fila.diferencia),
    resultado,
    observacion: fila.observacion,
    tardio: fila.tardio,
    movimientosHasta: fila.movimientos_hasta,
    reapertura:
      reabiertoEn === null
        ? null
        : {
            reabiertaPor: persona(
              fila.reabierto_por_id ?? '',
              fila.reabierto_por_nombres ?? '',
              fila.reabierto_por_apellidos ?? '',
            ),
            reabiertaEn: reabiertoEn.toISOString(),
            motivo: fila.motivo_reapertura ?? '',
          },
  };
}

/**
 * La caja `cajaId` de `tx.academiaId` con su resumen, sus movimientos (por `numero`) y sus cierres (por `numero`), o `null` si no existe en la
 * academia. `deOtroDia` sale de `ahora` en America/Lima. Quien abrió, quien registró y quien cerró se muestran aunque la cuenta se haya
 * desactivado después (la llave compuesta las conserva). Una consulta por parte, sin bloqueos.
 */
export async function leerCaja(tx: TransaccionAcademia, cajaId: string, ahora: Date): Promise<Caja | null> {
  const cajas = await tx.cliente.$queryRaw<FilaDeCaja[]>`
    SELECT c.id::text AS id, c.fecha::text AS fecha, c.estado::text AS estado, c.monto_inicial::text AS monto_inicial, c.abierta_en,
           u.id::text AS abierta_por_id, u.nombres AS abierta_por_nombres, u.apellidos AS abierta_por_apellidos
      FROM cajas c
      JOIN usuarios u ON u.academia_id = c.academia_id AND u.id = c.abierta_por
     WHERE c.academia_id = ${tx.academiaId}::uuid AND c.id = ${cajaId}::uuid`;
  const caja = cajas[0];
  if (!caja) return null;

  const movimientos = await tx.cliente.$queryRaw<FilaDeMovimiento[]>`
    SELECT m.id::text AS id, m.numero, m.tipo::text AS tipo, m.concepto::text AS concepto, m.metodo::text AS metodo,
           m.monto::text AS monto, m.descripcion, m.comprobante, m.registrado_en,
           a.id::text AS alumno_id, a.nombres AS alumno_nombres, a.apellidos AS alumno_apellidos,
           r.id::text AS registrado_por_id, r.nombres AS registrado_por_nombres, r.apellidos AS registrado_por_apellidos
      FROM movimientos_caja m
      LEFT JOIN alumnos a ON a.academia_id = m.academia_id AND a.id = m.alumno_id
      JOIN usuarios r ON r.academia_id = m.academia_id AND r.id = m.registrado_por
     WHERE m.academia_id = ${tx.academiaId}::uuid AND m.caja_id = ${cajaId}::uuid
     ORDER BY m.numero`;

  const cierres = await tx.cliente.$queryRaw<FilaDeCierre[]>`
    SELECT k.numero::int AS numero, k.cerrado_por::text AS cerrado_por_id, cp.nombres AS cerrado_por_nombres,
           cp.apellidos AS cerrado_por_apellidos, k.cerrado_en, k.monto_inicial::text AS monto_inicial,
           k.ingresos_efectivo::text AS ingresos_efectivo, k.ingresos_yape::text AS ingresos_yape,
           k.ingresos_transferencia::text AS ingresos_transferencia, k.egresos_efectivo::text AS egresos_efectivo,
           k.esperado_efectivo::text AS esperado_efectivo, k.monto_declarado::text AS monto_declarado,
           k.diferencia::text AS diferencia, k.observacion, k.tardio, k.movimientos_hasta,
           k.reabierto_por::text AS reabierto_por_id, rp.nombres AS reabierto_por_nombres,
           rp.apellidos AS reabierto_por_apellidos, k.reabierto_en, k.motivo_reapertura
      FROM cierres_caja k
      JOIN usuarios cp ON cp.academia_id = k.academia_id AND cp.id = k.cerrado_por
      LEFT JOIN usuarios rp ON rp.academia_id = k.academia_id AND rp.id = k.reabierto_por
     WHERE k.academia_id = ${tx.academiaId}::uuid AND k.caja_id = ${cajaId}::uuid
     ORDER BY k.numero`;

  const resumen = await leerResumen(tx, cajaId, caja.monto_inicial);
  return {
    id: caja.id,
    fecha: caja.fecha,
    estado: caja.estado,
    deOtroDia: esDeOtroDia(caja.fecha, ahora),
    montoInicial: aTextoMonto(caja.monto_inicial),
    abiertaPor: persona(caja.abierta_por_id, caja.abierta_por_nombres, caja.abierta_por_apellidos),
    abiertaEn: fechaDeBase(caja.abierta_en).toISOString(),
    resumen: resumenParaRespuesta(resumen),
    movimientos: movimientos.map(movimientoDeFila),
    cierres: cierres.map(cierreDeFila),
  };
}
