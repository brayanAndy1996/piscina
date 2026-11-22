// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { expect } from 'vitest';
import { Decimal } from '../../src/infraestructura/prisma';
import type { RelojFijo } from '../../src/infraestructura/reloj';
import { type Contexto, ejecutarComo, type RolPruebas, urlAppPruebas, urlPropietarioPruebas } from './base-datos';
import { escucharAplicacion } from './carreras';
import { crearAlumnoSolo } from './inscripciones';
import { type BaseDatosPrueba, ejecutar, obtenerBaseDatos, type TransaccionAcademiaPrueba } from './modulos';
import { observar, type Retenedor } from './planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type Escenario,
  rutasRegistradas,
  type UsuarioDePrueba,
} from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la historia 006a, Caja del día (spec.md, "Contrato" y "Cambios al modelo de datos"): crear
 * cajas, movimientos y cierres como dueño de las tablas (también inválidos); leer las tres tablas; un cliente HTTP con cualquier método;
 * fechas de Lima; cálculos de referencia en céntimos escritos aquí de forma independiente; y la transacción que imita a la 007 (actor
 * vigente, clases y `registrarIngresoEnCaja`), con el reloj fijo.
 *
 * Solo usan SQL, HTTP y los contratos públicos: no importan nada de la implementación de la caja (`registrarIngresoEnCaja` y las demás
 * se cargan con importación dinámica y, si faltan, la prueba falla con un mensaje claro de "falta la funcionalidad"). Todas las
 * lecturas de filas de negocio filtran por `academia_id` y fijan el contexto de la academia: sirven con un dueño superusuario (CI) y con
 * uno que no lo es (nube). Los montos viajan siempre como texto: la utilidad nunca los convierte a `number`.
 */

export type Objeto = Record<string, unknown>;
/** Cualquier valor, también inválido, para cada columna: así las pruebas de `CHECK` escriben lo que la API nunca dejaría pasar. */
export type Columnas = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------------
// Constantes del contrato
// ---------------------------------------------------------------------------------------------------------------------

export const TABLAS_006 = ['cajas', 'movimientos_caja', 'cierres_caja'] as const;
export type Tabla006 = (typeof TABLAS_006)[number];

export const ACCION_CAJA_ABIERTA = 'CAJA_ABIERTA';
export const ACCION_CAJA_CERRADA = 'CAJA_CERRADA';
export const ACCION_CAJA_REABIERTA = 'CAJA_REABIERTA';
export const ACCION_CAJA_EGRESO = 'CAJA_EGRESO_REGISTRADO';
export const ACCION_CAJA_INGRESO = 'CAJA_INGRESO_REGISTRADO';
export const ACCIONES_DE_CAJA = [
  ACCION_CAJA_ABIERTA,
  ACCION_CAJA_CERRADA,
  ACCION_CAJA_REABIERTA,
  ACCION_CAJA_EGRESO,
  ACCION_CAJA_INGRESO,
] as const;

export const IP_LOCAL = /^(::ffff:)?127\.0\.0\.1$/;

/** Los métodos de pago del contrato (`METODOS_PAGO`). */
export const METODOS_PAGO = ['EFECTIVO', 'YAPE', 'TRANSFERENCIA'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];
export type ConceptoIngreso = 'INSCRIPCION' | 'MENSUALIDAD' | 'CLASE_PARTICULAR';

// ---------------------------------------------------------------------------------------------------------------------
// Fechas de Lima (UTC-5 todo el año, sin horario de verano) y montos en céntimos
// ---------------------------------------------------------------------------------------------------------------------

/** "Hoy" de las pruebas: miércoles 11 de noviembre de 2026 (es el día de `AHORA_PRUEBAS`, 10:00 en Lima). */
export const HOY = '2026-11-11';
export const AYER = '2026-11-10';

/** El instante de una fecha y una hora de pared de Lima (`AAAA-MM-DD`, `HH:MM`, `HH:MM:SS` o `HH:MM:SS.mmm`). */
export function enLima(fecha: string, hora: string): Date {
  const completa = hora.length === 5 ? `${hora}:00` : hora;
  return new Date(`${fecha}T${completa}-05:00`);
}

/** Un monto de texto (`"126.5"`, `"0"`, `"-4.50"`) como céntimos enteros, sin pasar por coma flotante. */
export function centimos(texto: string): bigint {
  const coincidencia = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(texto);
  if (!coincidencia) throw new Error(`Monto de prueba inválido: ${texto}`);
  const signo = coincidencia[1] === '-' ? -1n : 1n;
  const valor = BigInt(coincidencia[2] ?? '0') * 100n + BigInt((coincidencia[3] ?? '').padEnd(2, '0') || '0');
  return signo * valor;
}

/** Céntimos enteros como texto con dos decimales (`12650n` → `"126.50"`, `-450n` → `"-4.50"`). */
export function montoTexto(valor: bigint): string {
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const enteros = absoluto / 100n;
  const decimales = (absoluto % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${enteros.toString()}.${decimales}`;
}

/** La suma de montos de texto, con dos decimales. */
export function sumarMontos(...montos: string[]): string {
  return montoTexto(montos.reduce((total, monto) => total + centimos(monto), 0n));
}

/** Un monto de texto o de `Decimal` con dos decimales (sirve para comparar lo que devuelve el dominio con el texto del contrato). */
export function aDosDecimales(valor: unknown): string {
  return new Decimal(String(valor)).toFixed(2);
}

// ---------------------------------------------------------------------------------------------------------------------
// Tablas de la 006a (si no existen, la prueba falla con un mensaje claro)
// ---------------------------------------------------------------------------------------------------------------------

/** Falla con un mensaje claro si la migración de la 006a todavía no creó las tres tablas. */
export async function exigirTablasDeCaja(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT t.nombre, pg_catalog.to_regclass('public.' || t.nombre) IS NOT NULL AS existe
       FROM unnest($1::text[]) AS t(nombre)`,
    [[...TABLAS_006]],
  );
  const faltan = (rows as { nombre: string; existe: boolean }[]).filter((fila) => !fila.existe).map((f) => f.nombre);
  expect(
    faltan,
    'Falta la funcionalidad de la 006a: la migración de las tres tablas de la caja no está aplicada',
  ).toEqual([]);
}

const FALTA_LA_TABLA = new Set(['42P01', '42704']);

async function conMensajeDeFuncionalidad<T>(trabajo: () => Promise<T>): Promise<T> {
  try {
    return await trabajo();
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    // 42P01: la tabla no existe; 42704: falta uno de los tipos. Es la funcionalidad de la 006a sin implementar.
    if (codigo !== undefined && FALTA_LA_TABLA.has(codigo)) {
      throw new Error('Falta la funcionalidad de la 006a: la migración de las tablas de la caja no está aplicada.', {
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
  fecha: 'date',
  estado: 'estado_caja',
  monto_inicial: 'numeric',
  abierta_por: 'uuid',
  abierta_en: 'timestamptz',
  clave_idempotencia: 'uuid',
  creado_en: 'timestamptz',
  actualizado_en: 'timestamptz',
  caja_id: 'uuid',
  numero: 'integer',
  tipo: 'tipo_movimiento_caja',
  concepto: 'concepto_movimiento_caja',
  metodo: 'metodo_pago',
  monto: 'numeric',
  descripcion: 'text',
  comprobante: 'text',
  alumno_id: 'uuid',
  pago_id: 'uuid',
  registrado_por: 'uuid',
  registrado_en: 'timestamptz',
  movimientos_hasta: 'integer',
  ingresos_efectivo: 'numeric',
  ingresos_yape: 'numeric',
  ingresos_transferencia: 'numeric',
  egresos_efectivo: 'numeric',
  esperado_efectivo: 'numeric',
  monto_declarado: 'numeric',
  diferencia: 'numeric',
  observacion: 'text',
  tardio: 'boolean',
  cerrado_por: 'uuid',
  cerrado_en: 'timestamptz',
  reabierto_por: 'uuid',
  reabierto_en: 'timestamptz',
  motivo_reapertura: 'text',
};

function tipoDe(columna: string): string {
  const tipo = TIPO_DE_COLUMNA[columna];
  if (tipo === undefined) throw new Error(`Columna desconocida en la utilidad de pruebas: ${columna}`);
  return tipo;
}

/** Opciones de las escrituras directas: el contexto de la transacción (por defecto, el de la academia de la fila). */
export interface OpcionesDeEscritura {
  /** La propiedad presente con `undefined` deja la transacción sin contexto; `{}` también. */
  contexto?: Contexto;
}

function contextoDe(academiaId: string, opciones: OpcionesDeEscritura): Contexto | undefined {
  return 'contexto' in opciones ? opciones.contexto : { academiaId };
}

function sqlDeInsercion(tabla: Tabla006, academiaId: string, columnas: Columnas): { sql: string; valores: unknown[] } {
  const todas: Columnas = { academia_id: academiaId, ...columnas };
  const nombres = Object.keys(todas);
  const marcas = nombres.map((nombre, i) => `$${i + 1}::${tipoDe(nombre)}`);
  return {
    sql: `INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (${marcas.join(', ')})`,
    valores: Object.values(todas),
  };
}

/**
 * `INSERT` directo con los nombres de columna de la base y el rol indicado. `columnas` puede traer valores inválidos: el error de
 * PostgreSQL (con su `code` y su `constraint`) se propaga tal cual. Devuelve el `id` de la fila si `columnas` lo trae.
 */
export async function insertarFilaCaja(
  rol: RolPruebas,
  tabla: Tabla006,
  academiaId: string,
  columnas: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<string | undefined> {
  const { sql, valores } = sqlDeInsercion(tabla, academiaId, columnas);
  await conMensajeDeFuncionalidad(() => ejecutarComo(rol, sql, valores, contextoDe(academiaId, opciones)));
  const id = columnas['id'];
  return typeof id === 'string' ? id : undefined;
}

/**
 * `UPDATE` directo de las filas que cumplen `donde` (columna → valor), sin filtrar por academia (para que las pruebas de RLS vean
 * qué filas alcanza). Devuelve las filas afectadas; el error de PostgreSQL se propaga.
 */
export async function actualizarFilasCaja(
  rol: RolPruebas,
  tabla: Tabla006,
  academiaId: string,
  donde: Columnas,
  cambios: Columnas,
  opciones: OpcionesDeEscritura = {},
): Promise<number> {
  const columnas = Object.keys(cambios);
  const condiciones = Object.keys(donde);
  const asignaciones = columnas.map((columna, i) => `${columna} = $${i + 1}::${tipoDe(columna)}`);
  const filtros = condiciones.map((columna, i) => `${columna} = $${columnas.length + i + 1}::${tipoDe(columna)}`);
  const resultado = await ejecutarComo(
    rol,
    `UPDATE ${tabla} SET ${asignaciones.join(', ')} WHERE ${filtros.join(' AND ')}`,
    [...Object.values(cambios), ...Object.values(donde)],
    contextoDe(academiaId, opciones),
  );
  return resultado.rowCount ?? 0;
}

/** `INSERT` directo que NO se espera: abre su propia conexión y transacción (con el contexto de la academia) y se observa. */
export function insertarFilaCajaSinEsperar(rol: RolPruebas, tabla: Tabla006, academiaId: string, columnas: Columnas) {
  const { sql, valores } = sqlDeInsercion(tabla, academiaId, columnas);
  const promesa = (async () => {
    const cliente = new pg.Client({ connectionString: rol === 'app' ? urlAppPruebas() : urlPropietarioPruebas() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);
      await cliente.query(sql, valores);
      await cliente.query('COMMIT');
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await cliente.end().catch(() => undefined);
    }
  })();
  return observar(promesa);
}

// ---------------------------------------------------------------------------------------------------------------------
// Filas válidas y sembradores (como dueño)
// ---------------------------------------------------------------------------------------------------------------------

/** Las columnas de una caja válida (por defecto, abierta hoy a las 09:00 de Lima con S/ 100.00). `fecha` y `abierta_en` van de la mano. */
export function filaCajaValida(abiertaPor: string, sobre: Columnas = {}): Columnas {
  const fecha = typeof sobre['fecha'] === 'string' ? sobre['fecha'] : HOY;
  return {
    id: randomUUID(),
    fecha,
    estado: 'ABIERTA',
    monto_inicial: '100.00',
    abierta_por: abiertaPor,
    abierta_en: enLima(fecha, '09:00'),
    clave_idempotencia: randomUUID(),
    creado_en: AHORA_PRUEBAS,
    actualizado_en: AHORA_PRUEBAS,
    ...sobre,
  };
}

/** Un ingreso válido (inscripción en efectivo de S/ 42.00) con el alumno y el número dados. */
export function filaIngresoValida(
  cajaId: string,
  registradoPor: string,
  alumnoId: string,
  numero: number,
  sobre: Columnas = {},
): Columnas {
  return {
    id: randomUUID(),
    caja_id: cajaId,
    numero,
    tipo: 'INGRESO',
    concepto: 'INSCRIPCION',
    metodo: 'EFECTIVO',
    monto: '42.00',
    descripcion: null,
    comprobante: null,
    alumno_id: alumnoId,
    pago_id: randomUUID(),
    registrado_por: registradoPor,
    registrado_en: enLima(HOY, '09:30'),
    clave_idempotencia: null,
    ...sobre,
  };
}

/** Un egreso válido en efectivo de S/ 10.00 con el número dado. */
export function filaEgresoValida(
  cajaId: string,
  registradoPor: string,
  numero: number,
  sobre: Columnas = {},
): Columnas {
  return {
    id: randomUUID(),
    caja_id: cajaId,
    numero,
    tipo: 'EGRESO',
    concepto: 'EGRESO_MENOR',
    metodo: 'EFECTIVO',
    monto: '10.00',
    descripcion: 'Compra de útiles de limpieza',
    comprobante: null,
    alumno_id: null,
    pago_id: null,
    registrado_por: registradoPor,
    registrado_en: enLima(HOY, '09:45'),
    clave_idempotencia: randomUUID(),
    ...sobre,
  };
}

export interface BaseDeCierre {
  montoInicial: string;
  ingresosEfectivo: string;
  ingresosYape: string;
  ingresosTransferencia: string;
  egresosEfectivo: string;
  montoDeclarado: string;
}

/**
 * Un cierre coherente: calcula `esperado_efectivo` (= inicial + ingresos en efectivo − egresos) y `diferencia` (= declarado − esperado)
 * en céntimos. Por defecto: inicial 100.00, ingresos 42.00 en efectivo, 88.00 en Yape y 120.00 en transferencia, egreso de 15.50 y
 * declarado igual al esperado (126.50, la diferencia es 0). `sobre` reemplaza columnas ya calculadas (para fabricar un cierre incoherente).
 */
export function filaCierreValida(
  cajaId: string,
  cerradoPor: string,
  base: Partial<BaseDeCierre> = {},
  sobre: Columnas = {},
): Columnas {
  const b: BaseDeCierre = {
    montoInicial: '100.00',
    ingresosEfectivo: '42.00',
    ingresosYape: '88.00',
    ingresosTransferencia: '120.00',
    egresosEfectivo: '15.50',
    montoDeclarado: '126.50',
    ...base,
  };
  const esperado = centimos(b.montoInicial) + centimos(b.ingresosEfectivo) - centimos(b.egresosEfectivo);
  const diferencia = centimos(b.montoDeclarado) - esperado;
  return {
    id: randomUUID(),
    caja_id: cajaId,
    numero: 1,
    movimientos_hasta: 0,
    monto_inicial: b.montoInicial,
    ingresos_efectivo: b.ingresosEfectivo,
    ingresos_yape: b.ingresosYape,
    ingresos_transferencia: b.ingresosTransferencia,
    egresos_efectivo: b.egresosEfectivo,
    esperado_efectivo: montoTexto(esperado),
    monto_declarado: b.montoDeclarado,
    diferencia: montoTexto(diferencia),
    observacion: diferencia === 0n ? null : 'Diferencia de la prueba',
    tardio: false,
    cerrado_por: cerradoPor,
    cerrado_en: enLima(HOY, '18:00'),
    clave_idempotencia: randomUUID(),
    reabierto_por: null,
    reabierto_en: null,
    motivo_reapertura: null,
    creado_en: enLima(HOY, '18:00'),
    ...sobre,
  };
}

export interface CajaDePrueba {
  id: string;
  academiaId: string;
  fecha: string;
  abiertaPor: string;
  claveIdempotencia: string;
  abiertaEn: Date;
}

/** Crea una caja como dueño y devuelve sus datos. `fecha` por defecto es hoy; `abierta_en`, las 09:00 de Lima de esa fecha. */
export async function crearCajaDePrueba(
  academiaId: string,
  abiertaPor: string,
  sobre: Columnas = {},
): Promise<CajaDePrueba> {
  const fila = filaCajaValida(abiertaPor, sobre);
  await insertarFilaCaja('propietario', 'cajas', academiaId, fila);
  return {
    id: fila['id'] as string,
    academiaId,
    fecha: fila['fecha'] as string,
    abiertaPor: fila['abierta_por'] as string,
    claveIdempotencia: fila['clave_idempotencia'] as string,
    abiertaEn: fila['abierta_en'] as Date,
  };
}

export interface MovimientoDePrueba {
  id: string;
  cajaId: string;
  numero: number;
  tipo: 'INGRESO' | 'EGRESO';
  monto: string;
  metodo: MetodoPago;
  pagoId: string | null;
  claveIdempotencia: string | null;
}

async function siguienteNumero(academiaId: string, cajaId: string): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT (coalesce(max(numero), 0) + 1)::int AS n FROM movimientos_caja WHERE academia_id = $1::uuid AND caja_id = $2::uuid',
    [academiaId, cajaId],
    { academiaId },
  );
  return (rows[0] as { n: number }).n;
}

/** Crea un ingreso como dueño (la caja debe estar `ABIERTA`: el trigger lo exige). El número es el siguiente de la caja. */
export async function crearIngresoDePrueba(
  academiaId: string,
  cajaId: string,
  registradoPor: string,
  alumnoId: string,
  sobre: Columnas = {},
): Promise<MovimientoDePrueba> {
  const numero = typeof sobre['numero'] === 'number' ? sobre['numero'] : await siguienteNumero(academiaId, cajaId);
  const fila = filaIngresoValida(cajaId, registradoPor, alumnoId, numero, sobre);
  await insertarFilaCaja('propietario', 'movimientos_caja', academiaId, fila);
  return {
    id: fila['id'] as string,
    cajaId,
    numero,
    tipo: 'INGRESO',
    monto: fila['monto'] as string,
    metodo: fila['metodo'] as MetodoPago,
    pagoId: fila['pago_id'] as string,
    claveIdempotencia: null,
  };
}

/** Crea un egreso como dueño (la caja debe estar `ABIERTA`). El número es el siguiente de la caja. */
export async function crearEgresoDePrueba(
  academiaId: string,
  cajaId: string,
  registradoPor: string,
  sobre: Columnas = {},
): Promise<MovimientoDePrueba> {
  const numero = typeof sobre['numero'] === 'number' ? sobre['numero'] : await siguienteNumero(academiaId, cajaId);
  const fila = filaEgresoValida(cajaId, registradoPor, numero, sobre);
  await insertarFilaCaja('propietario', 'movimientos_caja', academiaId, fila);
  return {
    id: fila['id'] as string,
    cajaId,
    numero,
    tipo: 'EGRESO',
    monto: fila['monto'] as string,
    metodo: 'EFECTIVO',
    pagoId: null,
    claveIdempotencia: fila['clave_idempotencia'] as string,
  };
}

/** Los totales de una caja calculados por SQL en `numeric` (sin coma flotante), como texto con dos decimales. */
export interface TotalesDeCaja {
  ingresosEfectivo: string;
  ingresosYape: string;
  ingresosTransferencia: string;
  egresosEfectivo: string;
  ultimoMovimiento: number;
}

export async function totalesDeCaja(academiaId: string, cajaId: string, hasta?: number): Promise<TotalesDeCaja> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO' AND metodo = 'EFECTIVO'), 0)::numeric(12,2)::text AS "ingresosEfectivo",
            coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO' AND metodo = 'YAPE'), 0)::numeric(12,2)::text AS "ingresosYape",
            coalesce(sum(monto) FILTER (WHERE tipo = 'INGRESO' AND metodo = 'TRANSFERENCIA'), 0)::numeric(12,2)::text AS "ingresosTransferencia",
            coalesce(sum(monto) FILTER (WHERE tipo = 'EGRESO'), 0)::numeric(12,2)::text AS "egresosEfectivo",
            coalesce(max(numero), 0)::int AS "ultimoMovimiento"
       FROM movimientos_caja
      WHERE academia_id = $1::uuid AND caja_id = $2::uuid AND ($3::int IS NULL OR numero <= $3::int)`,
    [academiaId, cajaId, hasta ?? null],
    { academiaId },
  );
  return rows[0] as TotalesDeCaja;
}

export interface CierreDePrueba {
  id: string;
  numero: number;
  claveIdempotencia: string;
  esperadoEfectivo: string;
  diferencia: string;
}

/**
 * Cierra una caja como lo haría el servicio (para preparar casos): calcula los totales de sus movimientos, crea el cierre con el
 * número siguiente y pasa la caja a `CERRADA`. `montoDeclarado` por defecto es el esperado en efectivo (la diferencia es 0).
 */
export async function cerrarCajaDePrueba(
  academiaId: string,
  cajaId: string,
  cerradoPor: string,
  opciones: { montoDeclarado?: string; observacion?: string; cerradoEn?: Date; tardio?: boolean; clave?: string } = {},
): Promise<CierreDePrueba> {
  const { rows: filasCaja } = await ejecutarComo(
    'propietario',
    'SELECT monto_inicial::text AS monto_inicial FROM cajas WHERE academia_id = $1::uuid AND id = $2::uuid',
    [academiaId, cajaId],
    { academiaId },
  );
  const montoInicial = (filasCaja[0] as { monto_inicial: string }).monto_inicial;
  const totales = await totalesDeCaja(academiaId, cajaId);
  const { rows: filasNumero } = await ejecutarComo(
    'propietario',
    'SELECT (coalesce(max(numero), 0) + 1)::int AS n FROM cierres_caja WHERE academia_id = $1::uuid AND caja_id = $2::uuid',
    [academiaId, cajaId],
    { academiaId },
  );
  const numero = (filasNumero[0] as { n: number }).n;
  const esperado = montoTexto(
    centimos(montoInicial) + centimos(totales.ingresosEfectivo) - centimos(totales.egresosEfectivo),
  );
  const declarado = opciones.montoDeclarado ?? esperado;
  const diferencia = montoTexto(centimos(declarado) - centimos(esperado));
  const cerradoEn = opciones.cerradoEn ?? enLima(HOY, '18:00');
  const fila = filaCierreValida(
    cajaId,
    cerradoPor,
    {
      montoInicial,
      ingresosEfectivo: totales.ingresosEfectivo,
      ingresosYape: totales.ingresosYape,
      ingresosTransferencia: totales.ingresosTransferencia,
      egresosEfectivo: totales.egresosEfectivo,
      montoDeclarado: declarado,
    },
    {
      numero,
      movimientos_hasta: totales.ultimoMovimiento,
      observacion: opciones.observacion ?? (diferencia === '0.00' ? null : 'Diferencia de la prueba'),
      tardio: opciones.tardio ?? false,
      cerrado_en: cerradoEn,
      creado_en: cerradoEn,
      ...(opciones.clave === undefined ? {} : { clave_idempotencia: opciones.clave }),
    },
  );
  await insertarFilaCaja('propietario', 'cierres_caja', academiaId, fila);
  await actualizarFilasCaja(
    'propietario',
    'cajas',
    academiaId,
    { id: cajaId },
    { estado: 'CERRADA', actualizado_en: cerradoEn },
  );
  return {
    id: fila['id'] as string,
    numero,
    claveIdempotencia: fila['clave_idempotencia'] as string,
    esperadoEfectivo: esperado,
    diferencia,
  };
}

/** Un alumno de la academia con nombre, apellido y DNI conocidos (el DNI nunca debe salir en la caja). */
export async function crearAlumnoDeCaja(
  academiaId: string,
  nombres = 'Ana María',
  apellidos = 'Quispe Rojas',
): Promise<{ id: string; nombres: string; apellidos: string; dni: string }> {
  const dni = dniInventado();
  const id = await crearAlumnoSolo(academiaId, { nombres, apellidos, dni });
  return { id, nombres, apellidos, dni };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas con el dueño (filtran por academia_id; los montos y la fecha, como texto)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaCaja {
  id: string;
  academia_id: string;
  fecha: string;
  estado: 'ABIERTA' | 'CERRADA';
  monto_inicial: string;
  abierta_por: string;
  abierta_en: Date;
  clave_idempotencia: string;
  creado_en: Date;
  actualizado_en: Date;
}

export interface FilaMovimiento {
  id: string;
  academia_id: string;
  caja_id: string;
  numero: number;
  tipo: 'INGRESO' | 'EGRESO';
  concepto: string;
  metodo: MetodoPago;
  monto: string;
  descripcion: string | null;
  comprobante: string | null;
  alumno_id: string | null;
  pago_id: string | null;
  registrado_por: string;
  registrado_en: Date;
  clave_idempotencia: string | null;
}

export interface FilaCierre {
  id: string;
  academia_id: string;
  caja_id: string;
  numero: number;
  movimientos_hasta: number;
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
  cerrado_por: string;
  cerrado_en: Date;
  clave_idempotencia: string;
  reabierto_por: string | null;
  reabierto_en: Date | null;
  motivo_reapertura: string | null;
  creado_en: Date;
}

async function leerFilas<T>(sql: string, academiaId: string): Promise<T[]> {
  const { rows } = await ejecutarComo('propietario', sql, [academiaId], { academiaId });
  return rows as T[];
}

export const leerCajas = (academiaId: string) =>
  leerFilas<FilaCaja>(
    `SELECT id, academia_id, fecha::text AS fecha, estado::text AS estado, monto_inicial::text AS monto_inicial, abierta_por,
            abierta_en, clave_idempotencia, creado_en, actualizado_en
       FROM cajas WHERE academia_id = $1::uuid ORDER BY fecha, id`,
    academiaId,
  );

export const leerMovimientos = (academiaId: string) =>
  leerFilas<FilaMovimiento>(
    `SELECT id, academia_id, caja_id, numero, tipo::text AS tipo, concepto::text AS concepto, metodo::text AS metodo,
            monto::text AS monto, descripcion, comprobante, alumno_id, pago_id, registrado_por, registrado_en, clave_idempotencia
       FROM movimientos_caja WHERE academia_id = $1::uuid ORDER BY caja_id, numero, id`,
    academiaId,
  );

export const leerCierres = (academiaId: string) =>
  leerFilas<FilaCierre>(
    `SELECT id, academia_id, caja_id, numero::int AS numero, movimientos_hasta, monto_inicial::text AS monto_inicial,
            ingresos_efectivo::text AS ingresos_efectivo, ingresos_yape::text AS ingresos_yape,
            ingresos_transferencia::text AS ingresos_transferencia, egresos_efectivo::text AS egresos_efectivo,
            esperado_efectivo::text AS esperado_efectivo, monto_declarado::text AS monto_declarado,
            diferencia::text AS diferencia, observacion, tardio, cerrado_por, cerrado_en, clave_idempotencia,
            reabierto_por, reabierto_en, motivo_reapertura, creado_en
       FROM cierres_caja WHERE academia_id = $1::uuid ORDER BY caja_id, numero, id`,
    academiaId,
  );

/** Todo lo que hay en las tres tablas de la academia, como texto: sirve para comprobar que una operación rechazada no cambió nada. */
export async function instantaneaDeCaja(academiaId: string): Promise<string> {
  return JSON.stringify({
    cajas: await leerCajas(academiaId),
    movimientos: await leerMovimientos(academiaId),
    cierres: await leerCierres(academiaId),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario: academias A y B con sus usuarios, más otra secretaria y otro administrador de A
// ---------------------------------------------------------------------------------------------------------------------

export interface EscenarioCaja extends Escenario {
  secretariaA2: UsuarioDePrueba;
  adminA2: UsuarioDePrueba;
}

/** Vacía la base y crea A y B con sus usuarios (`crearEscenario`) más una segunda secretaria y un segundo administrador de A. */
export async function crearEscenarioDeCaja(): Promise<EscenarioCaja> {
  await exigirTablasDeCaja();
  const e = await crearEscenario();
  return {
    ...e,
    secretariaA2: await crearUsuarioDePrueba({
      academiaId: e.A.id,
      rol: 'SECRETARIA',
      clave: 'Clave-Comun-2026',
      nombres: 'Marta',
      apellidos: 'Huaman',
    }),
    adminA2: await crearUsuarioDePrueba({
      academiaId: e.A.id,
      rol: 'ADMIN',
      clave: 'Clave-Comun-2026',
      nombres: 'Pedro',
      apellidos: 'Ibarra',
    }),
  };
}

/** Las cookies de sesión de cada usuario del escenario, firmadas para el instante `ahora` (el de `RELOJ` en la prueba). */
export function cookiesDeCaja(e: EscenarioCaja, ahora: Date = AHORA_PRUEBAS) {
  return {
    admin: cookieDeUsuario(e.adminA, ahora),
    admin2: cookieDeUsuario(e.adminA2, ahora),
    secretaria: cookieDeUsuario(e.secretariaA, ahora),
    secretaria2: cookieDeUsuario(e.secretariaA2, ahora),
    entrenador: cookieDeUsuario(e.entrenadorA, ahora),
    alumno: cookieDeUsuario(e.alumnoA, ahora),
    adminB: cookieDeUsuario(e.adminB, ahora),
    secretariaB: cookieDeUsuario(e.secretariaB, ahora),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaCaja {
  status: number;
  /** El cuerpo JSON ya leído (o `null` si no hay o no es un objeto JSON). */
  body: Objeto | null;
  texto: string;
  cacheControl: string | null;
}

export interface ClienteCaja {
  get(ruta: string, cookie?: string): Promise<RespuestaCaja>;
  post(ruta: string, cookie: string | undefined, cuerpo?: unknown): Promise<RespuestaCaja>;
  patch(ruta: string, cookie: string | undefined, cuerpo?: unknown): Promise<RespuestaCaja>;
  put(ruta: string, cookie: string | undefined, cuerpo?: unknown): Promise<RespuestaCaja>;
  delete(ruta: string, cookie: string | undefined): Promise<RespuestaCaja>;
  cerrar(): Promise<void>;
}

function leerJson(texto: string): Objeto | null {
  if (!texto) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
  } catch {
    return null;
  }
}

export interface AppCaja {
  app: NestExpressApplication;
  reloj: RelojFijo;
  http: ClienteCaja;
  baseDatos(): Promise<BaseDatosPrueba>;
}

/** La aplicación completa con `RELOJ` fijo, escuchando en un puerto efímero (las peticiones se pueden lanzar sin esperarlas). */
export async function crearAppCaja(ahora: Date = AHORA_PRUEBAS): Promise<AppCaja> {
  const { app, reloj } = await crearAppConReloj(ahora);
  const escuchando = await escucharAplicacion(app);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

  async function enviar(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown): Promise<RespuestaCaja> {
    const headers: Record<string, string> = {};
    if (cookie) headers['cookie'] = cookie;
    let body: string | undefined;
    if (cuerpo !== undefined) {
      body = JSON.stringify(cuerpo);
      headers['content-type'] = 'application/json';
    }
    const respuesta = await fetch(`${base}${ruta}`, { method: metodo, headers, body });
    const texto = await respuesta.text();
    return {
      status: respuesta.status,
      body: leerJson(texto),
      texto,
      cacheControl: respuesta.headers.get('cache-control'),
    };
  }

  return {
    app,
    reloj,
    baseDatos: () => obtenerBaseDatos(app),
    http: {
      get: (ruta, cookie) => enviar('GET', ruta, cookie),
      post: (ruta, cookie, cuerpo) => enviar('POST', ruta, cookie, cuerpo),
      patch: (ruta, cookie, cuerpo) => enviar('PATCH', ruta, cookie, cuerpo),
      put: (ruta, cookie, cuerpo) => enviar('PUT', ruta, cookie, cuerpo),
      delete: (ruta, cookie) => enviar('DELETE', ruta, cookie),
      cerrar: () => escuchando.cerrar(),
    },
  };
}

/** Las cinco rutas de la 006a (con `:id` como cualquier nombre de parámetro). */
const RUTAS_DE_LA_006A: readonly RegExp[] = [
  /^GET \/api\/cajas\/actual$/,
  /^POST \/api\/cajas$/,
  /^POST \/api\/cajas\/:\w+\/egresos$/,
  /^POST \/api\/cajas\/:\w+\/cierre$/,
  /^POST \/api\/cajas\/:\w+\/reapertura$/,
];

/**
 * Falla con un mensaje claro si las cinco rutas de la 006a no están registradas (la funcionalidad no existe todavía). Evita que una
 * prueba pase "por casualidad" con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDeCaja(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_006A) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 006a: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Retenciones para las carreras deterministas (sin tiempos ni esperas fijas; se usan con `conRetencion` de `inscripciones.ts`)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Retiene con `SELECT … FOR UPDATE` (una sola sentencia, en el orden de `id`) las filas de los usuarios indicados: las peticiones de esos
 * usuarios quedan esperando en `bloquearActorVigente` (su primera sentencia) y, al soltar, arrancan a la vez.
 */
export function retenerUsuarios(academiaId: string, ids: readonly string[]) {
  return async (retenedor: Retenedor): Promise<void> => {
    await retenedor.consultar(
      'SELECT id FROM usuarios WHERE academia_id = $1::uuid AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [academiaId, [...ids]],
    );
  };
}

/** Retiene con `SELECT … FOR UPDATE` la fila de una caja: quien la pida bloqueada (egreso, cierre, ingreso) queda esperando. */
export function retenerCaja(academiaId: string, cajaId: string) {
  return async (retenedor: Retenedor): Promise<void> => {
    await retenedor.consultar('SELECT id FROM cajas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
      academiaId,
      cajaId,
    ]);
  };
}

/** Un cuerpo válido de `abrirCajaSchema` (S/ 100.00) con una clave nueva. */
export const cuerpoApertura = (sobre: Objeto = {}): Objeto => ({
  claveIdempotencia: randomUUID(),
  montoInicial: '100.00',
  ...sobre,
});

/** Un cuerpo válido de `registrarEgresoSchema` (S/ 10.00) con una clave nueva. */
export const cuerpoEgreso = (sobre: Objeto = {}): Objeto => ({
  claveIdempotencia: randomUUID(),
  descripcion: 'Compra de útiles de limpieza',
  monto: '10.00',
  ...sobre,
});

/** Un cuerpo válido de `cerrarCajaSchema` con una clave nueva (el que vio la caja sin movimientos, con S/ 100.00 declarados). */
export const cuerpoCierre = (sobre: Objeto = {}): Objeto => ({
  claveIdempotencia: randomUUID(),
  montoDeclarado: '100.00',
  ultimoMovimientoVisto: 0,
  ...sobre,
});

export const cuerpoReapertura = (sobre: Objeto = {}): Objeto => ({ motivo: 'Se cerró por error a mediodía', ...sobre });

/** `/api/cajas/{id}{sufijo}`. */
export const rutaCaja = (id: string, sufijo = ''): string => `/api/cajas/${id}${sufijo}`;

export function codigoDe(respuesta: { body: Objeto | null }): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

export function detallesDe(respuesta: { body: Objeto | null }): Objeto {
  const detalles = respuesta.body?.['detalles'];
  return detalles !== null && typeof detalles === 'object' ? (detalles as Objeto) : {};
}

/** Los campos de `detalles.errores` de una respuesta 400. */
export function camposConError(respuesta: { body: Objeto | null }): string[] {
  const errores = detallesDe(respuesta)['errores'];
  return Array.isArray(errores) ? errores.map((error) => String((error as { campo?: unknown }).campo)) : [];
}

/** El mensaje del primer error de validación de un campo (`detalles.errores[].mensaje`), si lo hay. */
export function mensajeDelCampo(respuesta: { body: Objeto | null }, campo: string): string | undefined {
  const errores = detallesDe(respuesta)['errores'];
  if (!Array.isArray(errores)) return undefined;
  const error = errores.find((e) => (e as { campo?: unknown }).campo === campo) as { mensaje?: unknown } | undefined;
  return typeof error?.mensaje === 'string' ? error.mensaje : undefined;
}

// Las formas de la respuesta que las pruebas leen (el contrato: `cajaSchema`, `movimientoCajaSchema`, `cierreCajaSchema`).
export interface PersonaCajaApi {
  id: string;
  nombres: string;
  apellidos: string;
}
export interface ResumenApi {
  ingresos: { efectivo: string; yape: string; transferencia: string };
  egresos: { efectivo: string };
  esperado: { efectivo: string; yape: string; transferencia: string };
  ultimoMovimiento: number;
}
export interface MovimientoApi {
  id: string;
  numero: number;
  tipo: 'INGRESO' | 'EGRESO';
  concepto: string;
  metodo: MetodoPago;
  monto: string;
  descripcion: string | null;
  comprobante: string | null;
  alumno: PersonaCajaApi | null;
  registradoPor: PersonaCajaApi;
  registradoEn: string;
}
export interface CierreApi {
  numero: number;
  cerradoPor: PersonaCajaApi;
  cerradoEn: string;
  montoInicial: string;
  ingresos: { efectivo: string; yape: string; transferencia: string };
  egresos: { efectivo: string };
  esperado: { efectivo: string; yape: string; transferencia: string };
  montoDeclarado: string;
  diferencia: string;
  resultado: 'CUADRA' | 'SOBRANTE' | 'FALTANTE';
  observacion: string | null;
  tardio: boolean;
  movimientosHasta: number;
  reapertura: { reabiertaPor: PersonaCajaApi; reabiertaEn: string; motivo: string } | null;
}
export interface CajaApi {
  id: string;
  fecha: string;
  estado: 'ABIERTA' | 'CERRADA';
  deOtroDia: boolean;
  montoInicial: string;
  abiertaPor: PersonaCajaApi;
  abiertaEn: string;
  resumen: ResumenApi;
  movimientos: MovimientoApi[];
  cierres: CierreApi[];
}

/** La `caja` de una respuesta `{ caja }` (falla con el cuerpo recibido si no viene). */
export function cajaDe(respuesta: { status: number; body: Objeto | null }): CajaApi {
  const caja = respuesta.body?.['caja'];
  expect(
    caja,
    `la respuesta (HTTP ${respuesta.status}) no trae "caja": ${JSON.stringify(respuesta.body)}`,
  ).toBeTruthy();
  return caja as CajaApi;
}

export function movimientoDe(respuesta: { status: number; body: Objeto | null }): MovimientoApi {
  const movimiento = respuesta.body?.['movimiento'];
  expect(
    movimiento,
    `la respuesta (HTTP ${respuesta.status}) no trae "movimiento": ${JSON.stringify(respuesta.body)}`,
  ).toBeTruthy();
  return movimiento as MovimientoApi;
}

/** El esperado en efectivo de un valor `esperado` de la auditoría: el texto, o el objeto `{ efectivo, … }` (la spec no fija cuál). */
export function esperadoEfectivoDeAuditoria(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor;
  if (valor !== null && typeof valor === 'object') {
    const efectivo = (valor as { efectivo?: unknown }).efectivo;
    return typeof efectivo === 'string' ? efectivo : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Módulos de producción (se cargan con importación dinámica: antes de implementarlos fallan con un mensaje claro)
// ---------------------------------------------------------------------------------------------------------------------

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/** Carga un módulo de producción y comprueba sus exportaciones: si falta, falla con un mensaje claro de "falta la funcionalidad". */
export async function cargarFuncionalidad006<T>(rutaDesdeSrc: string, exportaciones: readonly string[]): Promise<T> {
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ_SRC, rutaDesdeSrc)).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 006a: no se pudo cargar "backend/src/${rutaDesdeSrc}" (${motivo}).`, {
      cause: error,
    });
  }
  for (const nombre of exportaciones) {
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(`Falta la funcionalidad de la 006a: "backend/src/${rutaDesdeSrc}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

/** Lo que `registrarIngresoEnCaja` recibe (contrato: `IngresoEnCaja`). */
export interface IngresoEnCajaPrueba {
  concepto: ConceptoIngreso;
  metodo: MetodoPago;
  monto: Decimal;
  alumnoId: string;
  pagoId: string;
  usuarioId: string;
  ip: string | null;
}

/** Lo que devuelven `registrarIngresoEnCaja` y `registrarEgresoEnCaja` (contrato: `MovimientoRegistrado`). */
export interface MovimientoRegistradoPrueba {
  id: string;
  cajaId: string;
  numero: number;
  registradoEn: Date;
  repetido: boolean;
}

export interface EgresoEnCajaPrueba {
  cajaId: string;
  claveIdempotencia: string;
  descripcion: string;
  monto: Decimal;
  comprobante: string | null;
  usuarioId: string;
  ip: string | null;
}

export interface ModuloCaja {
  registrarIngresoEnCaja(
    tx: TransaccionAcademiaPrueba,
    ingreso: IngresoEnCajaPrueba,
    ahora: Date,
  ): Promise<MovimientoRegistradoPrueba>;
  registrarEgresoEnCaja(
    tx: TransaccionAcademiaPrueba,
    egreso: EgresoEnCajaPrueba,
    ahora: Date,
  ): Promise<MovimientoRegistradoPrueba>;
  leerCajaAbierta(
    tx: TransaccionAcademiaPrueba,
    ahora: Date,
  ): Promise<{ id: string; fecha: string; deOtroDia: boolean } | null>;
}

/** `backend/src/modulos/caja/index.ts` (contrato: `registrarIngresoEnCaja`, `registrarEgresoEnCaja` y `leerCajaAbierta`). */
export function cargarModuloCaja(): Promise<ModuloCaja> {
  return cargarFuncionalidad006<ModuloCaja>('modulos/caja/index.ts', [
    'registrarIngresoEnCaja',
    'registrarEgresoEnCaja',
    'leerCajaAbierta',
  ]);
}

interface ModuloActor {
  bloquearActorVigente: (
    tx: TransaccionAcademiaPrueba,
    actor: { id: string; versionToken: number },
    opciones: { registro: { warn(contexto: object, mensaje: string): void }; ip: string | null },
  ) => Promise<unknown>;
}
interface ModuloCupo {
  bloquearClasesParaCupo: (tx: TransaccionAcademiaPrueba, claseIds: readonly string[]) => Promise<unknown[]>;
}

/** Un `Decimal` desde un texto (nunca desde un `number`). */
export const decimal = (texto: string): Decimal => new Decimal(texto);

export interface CobroImitado {
  academiaId: string;
  /** Quien cobra: su fila se bloquea como lo hace cada cobro de la 007 (`bloquearActorVigente`, primera sentencia). */
  actor: { id: string; versionToken?: number };
  /** Si se indica, bloquea esa clase con `bloquearClasesParaCupo` antes de tocar la caja (el orden de la 007). */
  claseId?: string;
  ingreso: Omit<IngresoEnCajaPrueba, 'usuarioId' | 'ip'> & { usuarioId?: string; ip?: string | null };
  ahora: Date;
  /** Si se indica, la transacción escribe antes una fila de auditoría con esta acción (para ver que un fallo la revierte). */
  marca?: string;
}

export type ResultadoDeCobro = { ok: true; movimiento: MovimientoRegistradoPrueba } | { ok: false; error: unknown };

/**
 * Imita la transacción de un cobro de la 007: dentro de `conAcademia`, `bloquearActorVigente`, (si hay clase) `bloquearClasesParaCupo`,
 * (si hay marca) una fila de auditoría y, al final, `registrarIngresoEnCaja`. Un error de la interfaz hace que `conAcademia` revierta
 * todo y se devuelve en `{ ok: false, error }`.
 */
export async function cobroImitado(baseDatos: BaseDatosPrueba, opciones: CobroImitado): Promise<ResultadoDeCobro> {
  const { bloquearActorVigente } = await cargarFuncionalidad006<ModuloActor>('modulos/autenticacion/index.ts', [
    'bloquearActorVigente',
  ]);
  const { bloquearClasesParaCupo } = await cargarFuncionalidad006<ModuloCupo>('modulos/clases/index.ts', [
    'bloquearClasesParaCupo',
  ]);
  const caja = await cargarModuloCaja();
  try {
    const movimiento = await baseDatos.conAcademia(opciones.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: opciones.actor.id, versionToken: opciones.actor.versionToken ?? 0 },
        { registro: { warn: () => undefined }, ip: null },
      );
      if (opciones.claseId !== undefined) await bloquearClasesParaCupo(tx, [opciones.claseId]);
      if (opciones.marca !== undefined) {
        await ejecutar(
          tx.cliente,
          `INSERT INTO auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
           VALUES ($1::uuid, $2::uuid, now(), 'SISTEMA', $3, 'prueba')`,
          randomUUID(),
          opciones.academiaId,
          opciones.marca,
        );
      }
      return caja.registrarIngresoEnCaja(
        tx,
        {
          ...opciones.ingreso,
          usuarioId: opciones.ingreso.usuarioId ?? opciones.actor.id,
          ip: opciones.ingreso.ip ?? null,
        },
        opciones.ahora,
      );
    });
    return { ok: true, movimiento };
  } catch (error) {
    return { ok: false, error };
  }
}

/** El código de negocio (`ErrorNegocio.codigo`) de un error, o `undefined`. */
export function codigoDeError(error: unknown): string | undefined {
  const codigo = (error as { codigo?: unknown } | null)?.codigo;
  return typeof codigo === 'string' ? codigo : undefined;
}

/** El estado HTTP (`ErrorNegocio.estado`) de un error, o `undefined`. */
export function estadoDeError(error: unknown): number | undefined {
  const estado = (error as { estado?: unknown } | null)?.estado;
  return typeof estado === 'number' ? estado : undefined;
}

/** El mensaje (`ErrorNegocio.mensaje`) de un error, o `undefined`. */
export function mensajeDeError(error: unknown): string | undefined {
  const mensaje = (error as { mensaje?: unknown } | null)?.mensaje;
  return typeof mensaje === 'string' ? mensaje : undefined;
}

/** Los detalles (`ErrorNegocio.detalles`) de un error, o `undefined`. */
export function detallesDeError(error: unknown): unknown {
  return (error as { detalles?: unknown } | null)?.detalles;
}

/** Espera una promesa y devuelve su resultado o su error, sin lanzar. */
export async function intentar<T>(
  promesa: Promise<T>,
): Promise<{ ok: true; valor: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, valor: await promesa };
  } catch (error) {
    return { ok: false, error };
  }
}

/** El ingreso de ejemplo de un cobro: inscripción en efectivo de S/ 42.00 del alumno, con un pago nuevo. */
export function ingresoDeEjemplo(
  alumnoId: string,
  usuarioId: string,
  sobre: Partial<IngresoEnCajaPrueba> = {},
): IngresoEnCajaPrueba {
  return {
    concepto: 'INSCRIPCION',
    metodo: 'EFECTIVO',
    monto: decimal('42.00'),
    alumnoId,
    pagoId: randomUUID(),
    usuarioId,
    ip: null,
    ...sobre,
  };
}
