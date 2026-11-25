// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { conClienteComo, type Contexto, ejecutarComo, type RolPruebas } from './base-datos';
import { ejecutar, type TransaccionAcademiaPrueba } from './modulos';

/**
 * Utilidades de las pruebas protegidas de la historia 007a, Pagos (spec.md, «Cambios al modelo de datos» y criterios 1 a 7): crear pagos
 * como dueño de las tablas o como la app (también inválidos), leerlos, escribir una transacción de varias sentencias y construir el pago
 * `CONFIRMADO` que, desde la 007, exige todo ingreso de la caja con `pago_id` (criterio 5).
 *
 * Solo usan SQL: no importan nada de la implementación. Todas las lecturas filtran por `academia_id` y fijan el contexto de la academia
 * (sirven con un dueño superusuario y con uno que no lo es). Los montos viajan siempre como texto.
 */

export type Columnas = Record<string, unknown>;
export type MetodoDePago = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
export type EstadoDePago = 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | 'RECHAZADO';

export const ESTADOS_DE_PAGO = ['PENDIENTE_VERIFICACION', 'CONFIRMADO', 'RECHAZADO'] as const;
export const ACCION_PAGO_REGISTRADO = 'PAGO_REGISTRADO';
export const ACCION_MONTO_AJUSTADO = 'MATRICULA_MONTO_AJUSTADO';
export const ACCION_USUARIO_CREADO = 'USUARIO_CREADO';
export const ACCION_CAJA_INGRESO_REGISTRADO = 'CAJA_INGRESO_REGISTRADO';
export const ACCION_SOLICITUD_CREADA = 'SOLICITUD_INSCRIPCION_CREADA';
export const LEYENDA_DEL_TICKET = 'Comprobante interno de pago. No es un comprobante electrónico SUNAT';

// ---------------------------------------------------------------------------------------------------------------------
// La tabla (si no existe, la prueba falla con un mensaje claro)
// ---------------------------------------------------------------------------------------------------------------------

/** Falla con un mensaje claro si la migración de la 007a todavía no creó `pagos`. */
export async function exigirTablaDePagos(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT pg_catalog.to_regclass('public.pagos') IS NOT NULL AS existe`,
  );
  expect(
    (rows[0] as { existe: boolean }).existe,
    'Falta la funcionalidad de la 007a: la migración de la tabla pagos no está aplicada',
  ).toBe(true);
}

const FALTA_LA_TABLA = new Set(['42P01', '42704']);

/** Convierte "no existe la tabla pagos" o "no existe el tipo estado_pago" en un mensaje claro de funcionalidad pendiente. */
export async function conMensajeDePagos<T>(trabajo: () => Promise<T>): Promise<T> {
  try {
    return await trabajo();
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (code !== undefined && FALTA_LA_TABLA.has(code) && /pagos|estado_pago/.test(message ?? '')) {
      throw new Error('Falta la funcionalidad de la 007a: la migración de la tabla pagos no está aplicada.', {
        cause: error,
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Escrituras directas (también inválidas)
// ---------------------------------------------------------------------------------------------------------------------

const TIPO_DE_COLUMNA: Readonly<Record<string, string>> = {
  id: 'uuid',
  academia_id: 'uuid',
  alumno_id: 'uuid',
  matricula_id: 'uuid',
  concepto: 'concepto_movimiento_caja',
  metodo: 'metodo_pago',
  estado: 'estado_pago',
  monto: 'numeric',
  numero_operacion: 'text',
  numero_operacion_normalizado: 'text',
  fecha_operacion: 'date',
  comprobante_clave: 'text',
  ip_origen: 'inet',
  registrado_por: 'uuid',
  verificado_por: 'uuid',
  registrado_en: 'timestamptz',
  verificado_en: 'timestamptz',
  motivo_rechazo: 'text',
  numero_ticket: 'integer',
  clave_idempotencia: 'uuid',
  creado_en: 'timestamptz',
  actualizado_en: 'timestamptz',
};

function tipoDe(columna: string): string {
  const tipo = TIPO_DE_COLUMNA[columna];
  if (tipo === undefined) throw new Error(`Columna desconocida en la utilidad de pruebas de pagos: ${columna}`);
  return tipo;
}

export interface OpcionesDeEscritura {
  /** La propiedad presente con `undefined` deja la transacción sin contexto; `{}` también. */
  contexto?: Contexto;
}

function contextoDe(academiaId: string, opciones: OpcionesDeEscritura): Contexto | undefined {
  return 'contexto' in opciones ? opciones.contexto : { academiaId };
}

/** El `INSERT` de una fila de `pagos` (con cualquier valor, también inválido) y sus parámetros. */
export function sqlInsertarPago(academiaId: string, columnas: Columnas): { sql: string; valores: unknown[] } {
  const todas: Columnas = { academia_id: academiaId, ...columnas };
  const nombres = Object.keys(todas);
  const marcas = nombres.map((nombre, i) => `$${i + 1}::${tipoDe(nombre)}`);
  return {
    sql: `INSERT INTO pagos (${nombres.join(', ')}) VALUES (${marcas.join(', ')})`,
    valores: Object.values(todas),
  };
}

/** `INSERT` directo en `pagos` con el rol indicado; el error de PostgreSQL (con su `code` y su `constraint`) se propaga tal cual. */
export async function insertarPago(
  rol: RolPruebas,
  academiaId: string,
  columnas: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<void> {
  const { sql, valores } = sqlInsertarPago(academiaId, columnas);
  await conMensajeDePagos(() => ejecutarComo(rol, sql, valores, contextoDe(academiaId, opciones)));
}

/** `UPDATE` directo de los pagos que cumplen `donde`; devuelve las filas afectadas. El error de PostgreSQL se propaga. */
export async function actualizarPagos(
  rol: RolPruebas,
  academiaId: string,
  donde: Columnas,
  cambios: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<number> {
  const columnas = Object.keys(cambios);
  const condiciones = Object.keys(donde);
  const asignaciones = columnas.map((columna, i) => `${columna} = $${i + 1}::${tipoDe(columna)}`);
  const filtros = condiciones.map((columna, i) => `${columna} = $${columnas.length + i + 1}::${tipoDe(columna)}`);
  const resultado = await conMensajeDePagos(() =>
    ejecutarComo(
      rol,
      `UPDATE pagos SET ${asignaciones.join(', ')} WHERE ${filtros.join(' AND ')}`,
      [...Object.values(cambios), ...Object.values(donde)],
      contextoDe(academiaId, opciones),
    ),
  );
  return resultado.rowCount ?? 0;
}

export interface Paso {
  sql: string;
  valores?: unknown[];
}

/**
 * Una transacción de varias sentencias con el rol y el contexto indicados: `BEGIN`, las sentencias en orden, `COMMIT`. Si algo falla
 * (también en el `COMMIT`, donde se comprueban las restricciones diferidas), hace `ROLLBACK` y rechaza con el error de `pg` (con su `code`).
 */
export async function ejecutarTransaccion(
  rol: RolPruebas,
  contexto: Contexto | undefined,
  pasos: readonly Paso[],
): Promise<void> {
  await conMensajeDePagos(() =>
    conClienteComo(rol, async (cliente) => {
      await cliente.query('BEGIN');
      try {
        if (contexto?.academiaId !== undefined) {
          await cliente.query("SELECT set_config('app.academia_id', $1, true)", [contexto.academiaId]);
        }
        const plataforma = contexto?.plataforma;
        if (plataforma !== undefined && plataforma !== false) {
          await cliente.query("SELECT set_config('app.plataforma', $1, true)", [
            plataforma === true ? 'si' : plataforma,
          ]);
        }
        for (const paso of pasos) await cliente.query(paso.sql, paso.valores ?? []);
        await cliente.query('COMMIT');
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas (como dueño, con el contexto de la academia)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaPago {
  id: string;
  academia_id: string;
  alumno_id: string;
  matricula_id: string;
  concepto: string;
  metodo: MetodoDePago;
  estado: EstadoDePago;
  monto: string;
  numero_operacion: string | null;
  numero_operacion_normalizado: string | null;
  fecha_operacion: string | null;
  comprobante_clave: string | null;
  ip_origen: string | null;
  registrado_por: string | null;
  verificado_por: string | null;
  registrado_en: Date;
  verificado_en: Date | null;
  motivo_rechazo: string | null;
  numero_ticket: number | null;
  clave_idempotencia: string;
  creado_en: Date;
  actualizado_en: Date;
}

export async function leerPagos(academiaId: string): Promise<FilaPago[]> {
  const { rows } = await conMensajeDePagos(() =>
    ejecutarComo(
      'propietario',
      `SELECT id, academia_id, alumno_id, matricula_id, concepto::text AS concepto, metodo::text AS metodo, estado::text AS estado,
              monto::text AS monto, numero_operacion, numero_operacion_normalizado, fecha_operacion::text AS fecha_operacion,
              comprobante_clave, host(ip_origen) AS ip_origen, registrado_por, verificado_por, registrado_en, verificado_en,
              motivo_rechazo, numero_ticket, clave_idempotencia, creado_en, actualizado_en
         FROM pagos WHERE academia_id = $1::uuid ORDER BY registrado_en, id`,
      [academiaId],
      { academiaId },
    ),
  );
  return rows as FilaPago[];
}

/** Los pagos de una matrícula, de la más antigua a la más nueva. */
export async function leerPagosDeMatricula(academiaId: string, matriculaId: string): Promise<FilaPago[]> {
  return (await leerPagos(academiaId)).filter((pago) => pago.matricula_id === matriculaId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Matrículas de apoyo (un plan y una matrícula del alumno, como dueño)
// ---------------------------------------------------------------------------------------------------------------------

export interface MatriculaDeApoyo {
  planId: string;
  matriculaId: string;
}

/**
 * El SQL (con sus parámetros `$n`) de un plan y una matrícula `CANCELADA` del mes de noviembre de 2026 para un alumno: lo mínimo que
 * necesita un pago (la llave `(academia_id, matricula_id, alumno_id)` de la 007, criterio 1). Una matrícula `CANCELADA` no ocupa cupo
 * ni choca con el índice de una matrícula por alumno y mes. Sirve con una conexión de `pg` y con la transacción de la API.
 */
function sentenciasDeMatriculaDeApoyo(
  academiaId: string,
  alumnoId: string,
  ids: MatriculaDeApoyo,
): { sql: string; valores: unknown[] }[] {
  return [
    {
      sql: `INSERT INTO planes (id, academia_id, nombre, veces_por_semana, clases_por_mes, precio, dias_permitidos, franjas_permitidas,
                               niveles_aplicables, creado_en, actualizado_en)
            VALUES ($1::uuid, $2::uuid, $3, 1, 12, 120.00, ARRAY[1]::smallint[], ARRAY['08:00']::time(0)[],
                    ARRAY['BASICO']::nivel_natacion[], now(), now())`,
      valores: [ids.planId, academiaId, `plan_de_apoyo_${randomUUID().replaceAll('-', '')}`],
    },
    {
      sql: `INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                                  es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en,
                                  creado_en, actualizado_en)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2026, 11, DATE '2026-11-01', DATE '2026-11-30', 12, 0, false, 120.00, 12,
                    120.00, 'CANCELADA'::estado_matricula, NULL, now(), now())`,
      valores: [ids.matriculaId, academiaId, alumnoId, ids.planId],
    },
  ];
}

/** Crea, como dueño, un plan y una matrícula `CANCELADA` para el alumno (el soporte de un pago directo). */
export async function crearMatriculaDeApoyo(academiaId: string, alumnoId: string): Promise<MatriculaDeApoyo> {
  const ids = { planId: randomUUID(), matriculaId: randomUUID() };
  await ejecutarTransaccion(
    'propietario',
    { academiaId },
    sentenciasDeMatriculaDeApoyo(academiaId, alumnoId, ids).map(({ sql, valores }) => ({ sql, valores })),
  );
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------------
// Filas válidas de pagos
// ---------------------------------------------------------------------------------------------------------------------

export const T_PAGO = new Date('2026-11-11T14:30:00.000Z');
export const T_VERIFICACION = new Date('2026-11-11T14:45:00.000Z');

let siguienteNumero = 1000 + Math.floor(Math.random() * 100_000);
/** Un número de operación inventado (solo dígitos, sin ceros adelante) que no se repite dentro del proceso. */
export function numeroDeOperacionInventado(): string {
  siguienteNumero += 1;
  return String(siguienteNumero);
}

export interface PadresDelPago {
  alumnoId: string;
  matriculaId: string;
  /** Quien registra y verifica (por defecto, nadie para Yape o transferencia pendientes). */
  usuarioId?: string;
}

/**
 * Un pago válido. Por defecto, un Yape `PENDIENTE_VERIFICACION` de S/ 42.00 (la inscripción) con su número de operación, comprobante y fecha
 * de operación. `estado: 'CONFIRMADO'` con `EFECTIVO` arma el efectivo confirmado (con `usuarioId` como quien cobra y el ticket `numeroTicket`);
 * `estado: 'RECHAZADO'` arma el rechazado con su motivo. Un pago `CONFIRMADO` necesita su movimiento de caja en la misma transacción
 * (criterio 5): ver `crearPagoConfirmadoConMovimiento`.
 */
export function filaPagoValida(
  academiaId: string,
  padres: PadresDelPago,
  opciones: { metodo?: MetodoDePago; estado?: EstadoDePago; numeroTicket?: number; monto?: string } = {},
  sobre: Columnas = {},
): Columnas {
  const metodo = opciones.metodo ?? 'YAPE';
  const estado = opciones.estado ?? 'PENDIENTE_VERIFICACION';
  const id = randomUUID();
  const numero = metodo === 'EFECTIVO' ? null : numeroDeOperacionInventado();
  const base: Columnas = {
    id,
    alumno_id: padres.alumnoId,
    matricula_id: padres.matriculaId,
    concepto: 'INSCRIPCION',
    metodo,
    estado,
    monto: opciones.monto ?? '42.00',
    numero_operacion: numero,
    numero_operacion_normalizado: numero,
    fecha_operacion: metodo === 'EFECTIVO' ? null : '2026-11-10',
    comprobante_clave:
      metodo === 'EFECTIVO' ? null : `academias/${academiaId}/pagos/${id}/comprobante-${randomUUID()}.jpg`,
    ip_origen: metodo === 'EFECTIVO' ? null : '203.0.113.7',
    registrado_por: metodo === 'EFECTIVO' ? (padres.usuarioId ?? null) : null,
    verificado_por: null,
    registrado_en: T_PAGO,
    verificado_en: null,
    motivo_rechazo: null,
    numero_ticket: null,
    clave_idempotencia: randomUUID(),
    creado_en: T_PAGO,
    actualizado_en: T_PAGO,
  };
  if (estado === 'CONFIRMADO') {
    base['verificado_por'] = padres.usuarioId ?? null;
    base['verificado_en'] = metodo === 'EFECTIVO' ? T_PAGO : T_VERIFICACION;
    base['numero_ticket'] = opciones.numeroTicket ?? 1;
  }
  if (estado === 'RECHAZADO') {
    base['verificado_por'] = padres.usuarioId ?? null;
    base['verificado_en'] = T_VERIFICACION;
    base['motivo_rechazo'] = 'La imagen no se lee';
  }
  return { ...base, ...sobre };
}

// ---------------------------------------------------------------------------------------------------------------------
// El pago CONFIRMADO que acompaña a todo ingreso de la caja (criterio 5): lo usan las utilidades de la 006
// ---------------------------------------------------------------------------------------------------------------------

export interface DatosDelIngreso {
  academiaId: string;
  pagoId: string;
  alumnoId: string;
  metodo: MetodoDePago;
  monto: string;
  concepto: string;
  /** Quien registró el ingreso (también quien cobró o verificó). */
  usuarioId: string;
  /** El instante del ingreso (también el del pago). */
  registradoEn: Date | string;
}

/**
 * Las sentencias (en orden) que crean, para un ingreso de la caja, un plan, una matrícula del alumno y el pago `CONFIRMADO` con el mismo
 * `id`, alumno, método, monto y concepto del ingreso: lo que exige la base desde la 007 (criterios 1 y 5). Un pago de Yape o de
 * transferencia lleva su número de operación, su comprobante y su fecha de operación inventados. El `numero_ticket` es el siguiente de la
 * academia. Se ejecutan en la misma transacción que inserta el movimiento (el orden entre las dos tablas es libre).
 */
export function sentenciasDelPagoDeSoporte(datos: DatosDelIngreso): { sql: string; valores: unknown[] }[] {
  const apoyo: MatriculaDeApoyo = { planId: randomUUID(), matriculaId: randomUUID() };
  const efectivo = datos.metodo === 'EFECTIVO';
  const numero = efectivo ? null : numeroDeOperacionInventado();
  const instante = datos.registradoEn instanceof Date ? datos.registradoEn.toISOString() : datos.registradoEn;
  return [
    ...sentenciasDeMatriculaDeApoyo(datos.academiaId, datos.alumnoId, apoyo),
    {
      sql: `INSERT INTO pagos (id, academia_id, alumno_id, matricula_id, concepto, metodo, estado, monto, numero_operacion,
                               numero_operacion_normalizado, fecha_operacion, comprobante_clave, registrado_por, verificado_por,
                               registrado_en, verificado_en, numero_ticket, clave_idempotencia, creado_en, actualizado_en)
            SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::concepto_movimiento_caja, $6::metodo_pago, 'CONFIRMADO'::estado_pago,
                   $7::numeric, $8::text, $8::text, $9::date, $10::text, $11::uuid, $11::uuid, $12::timestamptz, $12::timestamptz,
                   coalesce(max(numero_ticket), 0) + 1, $13::uuid, $12::timestamptz, $12::timestamptz
              FROM pagos WHERE academia_id = $2::uuid`,
      valores: [
        datos.pagoId,
        datos.academiaId,
        datos.alumnoId,
        apoyo.matriculaId,
        datos.concepto,
        datos.metodo,
        datos.monto,
        numero,
        efectivo ? null : '2026-11-10',
        efectivo ? null : `academias/${datos.academiaId}/pagos/${datos.pagoId}/comprobante-${randomUUID()}.jpg`,
        datos.usuarioId,
        instante,
        randomUUID(),
      ],
    },
  ];
}

/** Dentro de la transacción de la API (`conAcademia`): crea el pago `CONFIRMADO` de un ingreso ya registrado en la caja. */
export async function insertarPagoDeSoporteEnTransaccion(
  tx: TransaccionAcademiaPrueba,
  datos: Omit<DatosDelIngreso, 'academiaId'>,
): Promise<void> {
  await conMensajeDePagos(async () => {
    for (const { sql, valores } of sentenciasDelPagoDeSoporte({ ...datos, academiaId: tx.academiaId })) {
      await ejecutar(tx.cliente, sql, ...valores);
    }
  });
}

/**
 * Un pago confirmado real: en una sola transacción como dueño, el movimiento de caja de su ingreso y su pago `CONFIRMADO` (con una matrícula
 * del alumno si no se indica). Devuelve los ids. El movimiento toma el siguiente número de la caja.
 */
export async function crearPagoConfirmadoConMovimiento(
  academiaId: string,
  datos: {
    cajaId: string;
    alumnoId: string;
    usuarioId: string;
    matriculaId?: string;
    metodo?: MetodoDePago;
    monto?: string;
    numeroTicket?: number;
    registradoEn?: Date;
  },
): Promise<{ pagoId: string; movimientoId: string; matriculaId: string }> {
  const matriculaId = datos.matriculaId ?? (await crearMatriculaDeApoyo(academiaId, datos.alumnoId)).matriculaId;
  const pagoId = randomUUID();
  const movimientoId = randomUUID();
  const metodo = datos.metodo ?? 'EFECTIVO';
  const instante = datos.registradoEn ?? new Date('2026-11-11T14:35:00.000Z');
  const pago = filaPagoValida(
    academiaId,
    { alumnoId: datos.alumnoId, matriculaId, usuarioId: datos.usuarioId },
    { metodo, estado: 'CONFIRMADO', monto: datos.monto, numeroTicket: datos.numeroTicket },
    { id: pagoId, registrado_en: instante, verificado_en: instante, creado_en: instante, actualizado_en: instante },
  );
  const { sql, valores } = sqlInsertarPago(academiaId, pago);
  await ejecutarTransaccion('propietario', { academiaId }, [
    {
      sql: `INSERT INTO movimientos_caja (id, academia_id, caja_id, numero, tipo, concepto, metodo, monto, alumno_id, pago_id, registrado_por,
                                         registrado_en)
            SELECT $1::uuid, $2::uuid, $3::uuid, coalesce(max(numero), 0) + 1, 'INGRESO', 'INSCRIPCION', $4::metodo_pago, $5::numeric,
                   $6::uuid, $7::uuid, $8::uuid, $9::timestamptz
              FROM movimientos_caja WHERE academia_id = $2::uuid AND caja_id = $3::uuid`,
      valores: [
        movimientoId,
        academiaId,
        datos.cajaId,
        metodo,
        datos.monto ?? '42.00',
        datos.alumnoId,
        pagoId,
        datos.usuarioId,
        instante.toISOString(),
      ],
    },
    { sql, valores },
  ]);
  return { pagoId, movimientoId, matriculaId };
}
