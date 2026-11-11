// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from './academias';
import { ejecutarComo } from './base-datos';
import { crearSuperadminDePrueba, type SuperadminDePrueba } from './superadmins';

/** Inserta una fila en `auditoria` con una conexión del dueño y el contexto de la academia. */
export async function insertarAuditoria(
  academiaId: string,
  accion = 'ACCION_DE_PRUEBA',
  fechaHora = new Date(),
): Promise<string> {
  const id = randomUUID();
  await ejecutarComo(
    'propietario',
    `INSERT INTO auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
     VALUES ($1::uuid, $2::uuid, $3, 'SISTEMA', $4, 'prueba')`,
    [id, academiaId, fechaHora, accion],
    { academiaId },
  );
  return id;
}

/** Inserta una fila en `configuraciones` con una conexión del dueño y el contexto de la academia. */
export async function insertarConfiguracion(academiaId: string, clave: string, valor: unknown = {}): Promise<void> {
  await ejecutarComo(
    'propietario',
    `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en) VALUES ($1::uuid, $2, $3::jsonb, $4)`,
    [academiaId, clave, JSON.stringify(valor), new Date()],
    { academiaId },
  );
}

/** Inserta una fila en `auditoria_plataforma` con una conexión del dueño y el contexto de plataforma. */
export async function insertarAuditoriaPlataforma(accion = 'ACCION_DE_PRUEBA'): Promise<string> {
  const id = randomUUID();
  await ejecutarComo(
    'propietario',
    `INSERT INTO auditoria_plataforma (id, fecha_hora, actor_tipo, accion, entidad)
     VALUES ($1::uuid, $2, 'SISTEMA', $3, 'prueba')`,
    [id, new Date(), accion],
    { plataforma: true },
  );
  return id;
}

export interface DatosDeAislamiento {
  A: AcademiaDePrueba;
  B: AcademiaDePrueba;
  superadmin: SuperadminDePrueba;
  /** Filas por academia: distintas a propósito, para que una unión de las dos se note. */
  filas: { auditoriaA: number; auditoriaB: number; configuracionesA: number; configuracionesB: number };
}

/**
 * "Hay datos" (spec 001, bloque B): dos academias A y B con filas en `auditoria` y `configuraciones` (A con 2 y 2 filas;
 * B con 3 y 4), un superadmin y dos filas en `auditoria_plataforma`. Debe llamarse después de `limpiarBase()`.
 */
export async function crearDatosDeAislamiento(): Promise<DatosDeAislamiento> {
  const A = await crearAcademiaDePrueba({ nombreCorto: 'academia-a', nombre: 'Academia A' });
  const B = await crearAcademiaDePrueba({ nombreCorto: 'academia-b', nombre: 'Academia B' });
  for (let i = 1; i <= 2; i++) await insertarAuditoria(A.id, `ACCION_A_${i}`);
  for (let i = 1; i <= 3; i++) await insertarAuditoria(B.id, `ACCION_B_${i}`);
  for (let i = 1; i <= 2; i++) await insertarConfiguracion(A.id, `clave_a_${i}`);
  for (let i = 1; i <= 4; i++) await insertarConfiguracion(B.id, `clave_b_${i}`);
  const superadmin = await crearSuperadminDePrueba();
  await insertarAuditoriaPlataforma('ACCION_PLATAFORMA_1');
  await insertarAuditoriaPlataforma('ACCION_PLATAFORMA_2');
  return {
    A,
    B,
    superadmin,
    filas: { auditoriaA: 2, auditoriaB: 3, configuracionesA: 2, configuracionesB: 4 },
  };
}

export interface FilaSuperadmin {
  id: string;
  correo: string;
  nombre: string;
  clave_hash: string;
  version_token: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
}

/** Lee un superadmin con una conexión del dueño (contexto de plataforma). */
export async function leerSuperadmin(id: string): Promise<FilaSuperadmin | undefined> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT id, correo, nombre, clave_hash, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso FROM superadmins WHERE id = $1::uuid',
    [id],
    { plataforma: true },
  );
  return rows[0] as FilaSuperadmin | undefined;
}

export interface FilaAuditoria {
  id: string;
  fecha_hora: Date;
  actor_tipo: string;
  actor_id: string | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  datos_antes: unknown;
  datos_despues: unknown;
  motivo: string | null;
  ip: string | null;
}

const COLUMNAS_AUDITORIA =
  'id, fecha_hora, actor_tipo::text AS actor_tipo, actor_id, accion, entidad, entidad_id, datos_antes, datos_despues, motivo, host(ip) AS ip';

/** Filas de `auditoria_plataforma` (con una conexión del dueño), de la más antigua a la más nueva. */
export async function leerAuditoriaPlataforma(accion?: string): Promise<FilaAuditoria[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ${COLUMNAS_AUDITORIA} FROM auditoria_plataforma WHERE ($1::text IS NULL OR accion = $1) ORDER BY fecha_hora, id`,
    [accion ?? null],
    { plataforma: true },
  );
  return rows as FilaAuditoria[];
}

/** Filas de `auditoria` de una academia (con una conexión del dueño y su contexto). */
export async function leerAuditoriaDeAcademia(academiaId: string, accion?: string): Promise<FilaAuditoria[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ${COLUMNAS_AUDITORIA} FROM auditoria WHERE academia_id = $2::uuid AND ($1::text IS NULL OR accion = $1) ORDER BY fecha_hora, id`,
    [accion ?? null, academiaId],
    { academiaId },
  );
  return rows as FilaAuditoria[];
}

/** Filas de `academias` (con una conexión del dueño y el contexto de plataforma). */
export async function leerAcademias(): Promise<
  {
    id: string;
    nombre: string;
    nombre_corto: string;
    estado: string;
    motivo_suspension: string | null;
    suspendida_en: Date | null;
    creada_en: Date;
  }[]
> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT id, nombre, nombre_corto, estado::text AS estado, motivo_suspension, suspendida_en, creada_en FROM academias ORDER BY nombre_corto',
    [],
    { plataforma: true },
  );
  return rows as never;
}

/** Cantidad de filas de una tabla de academia (`auditoria` o `configuraciones`) vistas con el contexto de esa academia. */
export async function contarDeAcademia(tabla: 'auditoria' | 'configuraciones', academiaId: string): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT count(*)::int AS n FROM ${tabla} WHERE academia_id = $1::uuid`,
    [academiaId],
    { academiaId },
  );
  return (rows[0] as { n: number }).n;
}
