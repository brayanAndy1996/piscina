// spec: 004-planes-clases-aforo (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { expect } from 'vitest';
import { type Contexto, ejecutarComo, type RolPruebas, urlPropietarioPruebas } from './base-datos';
import { escucharAplicacion, LIMITE_DE_SEGURIDAD_MS } from './carreras';
import type { TransaccionAcademiaPrueba } from './modulos';
import { crearUsuarioDePrueba, rutasRegistradas, type UsuarioDePrueba } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la historia 004 (spec.md, "Contrato" y "Cambios al modelo de datos"): crear planes, clases
 * y entrenadores de una academia; escribir filas de `planes` y `clases` con una conexión del dueño o de la app, también inválidas;
 * instantáneas para comprobar que una operación rechazada no escribió nada; un cliente HTTP con `GET`, `POST`, `PATCH` y `DELETE`; y
 * una retención de la fila de una clase (o del actor) para las carreras deterministas.
 *
 * Solo usan SQL, HTTP y los contratos públicos: no importan nada de la implementación (las funciones de producción se cargan con
 * importación dinámica y, si faltan, la prueba falla con un mensaje claro). Todas las lecturas de filas de negocio filtran por
 * `academia_id` de forma explícita y fijan el contexto de la academia, así que sirven con un dueño superusuario (CI y Docker de
 * Windows) y con uno que no lo es (nube).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Constantes del contrato
// ---------------------------------------------------------------------------------------------------------------------

export type NivelNatacion = 'BASICO' | 'INTERMEDIO' | 'AVANZADO';
/** Los niveles en el orden del contrato (`NIVELES`). */
export const NIVELES: readonly NivelNatacion[] = ['BASICO', 'INTERMEDIO', 'AVANZADO'];
/** Los bloques de 1 hora de 08:00 a 19:00 (RN-09), escritos a mano. */
export const BLOQUES: readonly string[] = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
];

export const ACCION_PLAN_CREADO = 'PLAN_CREADO';
export const ACCION_PLAN_ACTUALIZADO = 'PLAN_ACTUALIZADO';
export const ACCION_CLASE_CREADA = 'CLASE_CREADA';
export const ACCION_CLASE_ACTUALIZADA = 'CLASE_ACTUALIZADA';

/** Una hora `HH:MM` o `HH:MM:SS` más una hora (sin pasar de las 23). Sirve también para horas inválidas de las pruebas. */
export function masUnaHora(hora: string): string {
  const [horas = '', ...resto] = hora.split(':');
  return [String(Number(horas) + 1).padStart(2, '0'), ...resto].join(':');
}

// ---------------------------------------------------------------------------------------------------------------------
// Filas de la base
// ---------------------------------------------------------------------------------------------------------------------

/** Columnas de negocio de `planes` (sin `id`, `academia_id`, `creado_en` ni `actualizado_en`), con los nombres de la base. */
export interface ColumnasPlan {
  nombre: string;
  veces_por_semana: number;
  clases_por_mes: number;
  duracion_minutos: number;
  precio: string;
  dias_permitidos: readonly number[];
  franjas_permitidas: readonly string[];
  niveles_aplicables: readonly string[];
  vigencia_inicio: string | null;
  vigencia_fin: string | null;
  activo: boolean;
}

/** Columnas de negocio de `clases` (sin `id`, `academia_id`, `creado_en` ni `actualizado_en`), con los nombres de la base. */
export interface ColumnasClase {
  nivel: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  entrenador_id: string;
  aforo: number;
  activo: boolean;
}

/** Cualquier valor, también inválido, para cada columna: así las pruebas de `CHECK` escriben lo que la API nunca dejaría pasar. */
export type Libre<T> = { [K in keyof T]?: unknown };

/** Un plan válido de ejemplo (el de la spec: 3 veces por semana, 12 clases, S/ 120.00), con un nombre que no se repite. */
export function planValido(): ColumnasPlan {
  return {
    nombre: `Plan de prueba ${randomBytes(4).toString('hex')}`,
    veces_por_semana: 3,
    clases_por_mes: 12,
    duracion_minutos: 60,
    precio: '120.00',
    dias_permitidos: [1, 3, 5],
    franjas_permitidas: ['08:00', '09:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO'],
    vigencia_inicio: null,
    vigencia_fin: null,
    activo: true,
  };
}

/** Una clase válida de ejemplo del entrenador dado (lunes 08:00, nivel básico, aforo 30). */
export function claseValida(entrenadorId: string): ColumnasClase {
  return {
    nivel: 'BASICO',
    dia_semana: 1,
    hora_inicio: '08:00',
    hora_fin: '09:00',
    entrenador_id: entrenadorId,
    aforo: 30,
    activo: true,
  };
}

const TIPO_DE_COLUMNA: Readonly<Record<string, string>> = {
  id: 'uuid',
  academia_id: 'uuid',
  nombre: 'text',
  veces_por_semana: 'smallint',
  clases_por_mes: 'smallint',
  duracion_minutos: 'smallint',
  precio: 'numeric',
  dias_permitidos: 'smallint[]',
  franjas_permitidas: 'time(0)[]',
  niveles_aplicables: 'nivel_natacion[]',
  vigencia_inicio: 'date',
  vigencia_fin: 'date',
  activo: 'boolean',
  nivel: 'nivel_natacion',
  dia_semana: 'smallint',
  hora_inicio: 'time(0)',
  hora_fin: 'time(0)',
  entrenador_id: 'uuid',
  aforo: 'smallint',
  creado_en: 'timestamptz',
  actualizado_en: 'timestamptz',
};

function tipoDe(columna: string): string {
  const tipo = TIPO_DE_COLUMNA[columna];
  if (tipo === undefined) throw new Error(`Columna desconocida en la utilidad de pruebas: ${columna}`);
  return tipo;
}

/** Opciones de las escrituras directas: el contexto de la transacción (por defecto, el de la academia de la fila) y un `id` fijo. */
export interface OpcionesDeEscritura {
  /** `undefined` explícito (la propiedad presente) deja la transacción sin contexto; `{}` también. */
  contexto?: Contexto;
  id?: string;
}

function contextoDe(academiaId: string, opciones: OpcionesDeEscritura): Contexto | undefined {
  return 'contexto' in opciones ? opciones.contexto : { academiaId };
}

async function insertar(
  rol: RolPruebas,
  tabla: 'planes' | 'clases',
  academiaId: string,
  columnas: Record<string, unknown>,
  opciones: OpcionesDeEscritura,
): Promise<string> {
  const id = opciones.id ?? randomUUID();
  const ahora = new Date();
  const todas: Record<string, unknown> = {
    id,
    academia_id: academiaId,
    ...columnas,
    creado_en: ahora,
    actualizado_en: ahora,
  };
  const nombres = Object.keys(todas);
  const marcas = nombres.map((nombre, i) => `$${i + 1}::${tipoDe(nombre)}`);
  await ejecutarComo(
    rol,
    `INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (${marcas.join(', ')})`,
    Object.values(todas),
    contextoDe(academiaId, opciones),
  );
  return id;
}

/**
 * Inserta un plan con una conexión del rol indicado (por defecto, el contexto de `academiaId`). `columnas` reemplaza valores del
 * plan de ejemplo, también con valores inválidos: el error de PostgreSQL (con su `code`) se propaga tal cual. Devuelve el `id`.
 */
export function insertarPlan(
  rol: RolPruebas,
  academiaId: string,
  columnas: Libre<ColumnasPlan> = {},
  opciones: OpcionesDeEscritura = {},
): Promise<string> {
  return insertar(rol, 'planes', academiaId, { ...planValido(), ...columnas }, opciones);
}

/**
 * Inserta una clase con una conexión del rol indicado (por defecto, el contexto de `academiaId`). `hora_fin` vale una hora más que
 * `hora_inicio` si no se indica. `columnas` reemplaza valores, también inválidos. Devuelve el `id`.
 */
export function insertarClase(
  rol: RolPruebas,
  academiaId: string,
  entrenadorId: string,
  columnas: Libre<ColumnasClase> = {},
  opciones: OpcionesDeEscritura = {},
): Promise<string> {
  const base = claseValida(entrenadorId);
  const horaInicio = typeof columnas.hora_inicio === 'string' ? columnas.hora_inicio : base.hora_inicio;
  return insertar(rol, 'clases', academiaId, { ...base, hora_fin: masUnaHora(horaInicio), ...columnas }, opciones);
}

/**
 * `UPDATE` directo de una fila por `id` con una conexión del rol indicado (por defecto, el contexto de `academiaId`; sin filtrar por
 * academia, para que las pruebas de RLS vean qué filas alcanza). Devuelve las filas afectadas. El error de PostgreSQL se propaga.
 */
export async function actualizarFila(
  rol: RolPruebas,
  tabla: 'planes' | 'clases',
  academiaId: string,
  id: string,
  cambios: Record<string, unknown>,
  opciones: Pick<OpcionesDeEscritura, 'contexto'> = {},
): Promise<number> {
  const columnas = Object.keys(cambios);
  const asignaciones = columnas.map((columna, i) => `${columna} = $${i + 2}::${tipoDe(columna)}`);
  const resultado = await ejecutarComo(
    rol,
    `UPDATE ${tabla} SET ${asignaciones.join(', ')} WHERE id = $1::uuid`,
    [id, ...Object.values(cambios)],
    contextoDe(academiaId, opciones),
  );
  return resultado.rowCount ?? 0;
}

const FALTA_LA_TABLA = new Set(['42P01', '42704']);

async function conMensajeDeFuncionalidad<T>(trabajo: () => Promise<T>): Promise<T> {
  try {
    return await trabajo();
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    // 42P01: la tabla no existe; 42704: falta el tipo nivel_natacion. Es la funcionalidad de la 004 sin implementar.
    if (codigo !== undefined && FALTA_LA_TABLA.has(codigo)) {
      throw new Error(
        'Falta la funcionalidad de la 004: la migración de las tablas planes y clases no está aplicada.',
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

/** Falla con un mensaje claro si la migración de la 004 todavía no creó las tablas. */
export async function exigirTablasDePlanesYClases(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT pg_catalog.to_regclass('public.planes') IS NOT NULL AS planes,
            pg_catalog.to_regclass('public.clases') IS NOT NULL AS clases`,
  );
  const fila = rows[0] as { planes: boolean; clases: boolean };
  expect(fila, 'Falta la funcionalidad de la 004: las tablas public.planes y public.clases no existen').toEqual({
    planes: true,
    clases: true,
  });
}

export interface PlanDePrueba extends ColumnasPlan {
  id: string;
  academiaId: string;
}

export interface ClaseDePrueba extends ColumnasClase {
  id: string;
  academiaId: string;
}

/** Crea un plan con una conexión del dueño y el contexto de su academia. */
export async function crearPlanDePrueba(
  academiaId: string,
  columnas: Partial<ColumnasPlan> = {},
): Promise<PlanDePrueba> {
  const plan = { ...planValido(), ...columnas };
  const id = await conMensajeDeFuncionalidad(() => insertarPlan('propietario', academiaId, plan));
  return { ...plan, id, academiaId };
}

/** Crea una clase con una conexión del dueño y el contexto de su academia (el entrenador debe ser de la misma academia). */
export async function crearClaseDePrueba(
  academiaId: string,
  entrenadorId: string,
  columnas: Partial<ColumnasClase> = {},
): Promise<ClaseDePrueba> {
  const base = claseValida(entrenadorId);
  const inicio = columnas.hora_inicio ?? base.hora_inicio;
  const clase: ColumnasClase = { ...base, hora_fin: masUnaHora(inicio), ...columnas };
  const id = await conMensajeDeFuncionalidad(() => insertarClase('propietario', academiaId, entrenadorId, clase));
  return { ...clase, id, academiaId };
}

/** Un entrenador activo de la academia (usuario con rol `ENTRENADOR`). */
export function crearEntrenadorDePrueba(
  academiaId: string,
  datos: { nombres?: string; apellidos?: string; estado?: 'ACTIVO' | 'INACTIVO' } = {},
): Promise<UsuarioDePrueba> {
  return crearUsuarioDePrueba({ academiaId, rol: 'ENTRENADOR', ...datos });
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas con el dueño (filtran por academia_id)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaPlan {
  id: string;
  academia_id: string;
  nombre: string;
  veces_por_semana: number;
  clases_por_mes: number;
  duracion_minutos: number;
  /** El texto exacto que guarda `numeric(10,2)`. */
  precio: string;
  dias_permitidos: number[];
  /** `HH:MM`, en el orden guardado. */
  franjas_permitidas: string[];
  niveles_aplicables: string[];
  vigencia_inicio: string | null;
  vigencia_fin: string | null;
  activo: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

export interface FilaClase {
  id: string;
  academia_id: string;
  nivel: string;
  dia_semana: number;
  /** `HH:MM`. */
  hora_inicio: string;
  hora_fin: string;
  entrenador_id: string;
  aforo: number;
  activo: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

const COLUMNAS_PLAN = `id, academia_id, nombre, veces_por_semana, clases_por_mes, duracion_minutos, precio::text AS precio,
  dias_permitidos,
  coalesce((SELECT array_agg(to_char(f.hora, 'HH24:MI') ORDER BY f.orden) FROM unnest(franjas_permitidas)
              WITH ORDINALITY AS f(hora, orden)), '{}'::text[]) AS franjas_permitidas,
  niveles_aplicables::text[] AS niveles_aplicables,
  to_char(vigencia_inicio, 'YYYY-MM-DD') AS vigencia_inicio, to_char(vigencia_fin, 'YYYY-MM-DD') AS vigencia_fin,
  activo, creado_en, actualizado_en`;

const COLUMNAS_CLASE = `id, academia_id, nivel::text AS nivel, dia_semana, to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
  to_char(hora_fin, 'HH24:MI') AS hora_fin, entrenador_id, aforo, activo, creado_en, actualizado_en`;

/** Todos los planes de una academia, ordenados por id (filtra por `academia_id` y fija el contexto). */
export async function leerPlanes(academiaId: string): Promise<FilaPlan[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ${COLUMNAS_PLAN} FROM planes WHERE academia_id = $1::uuid ORDER BY id`,
    [academiaId],
    { academiaId },
  );
  return rows as FilaPlan[];
}

export async function leerPlan(academiaId: string, id: string): Promise<FilaPlan | undefined> {
  return (await leerPlanes(academiaId)).find((fila) => fila.id === id);
}

/** Todas las clases de una academia, ordenadas por id (filtra por `academia_id` y fija el contexto). */
export async function leerClases(academiaId: string): Promise<FilaClase[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ${COLUMNAS_CLASE} FROM clases WHERE academia_id = $1::uuid ORDER BY id`,
    [academiaId],
    { academiaId },
  );
  return rows as FilaClase[];
}

export async function leerClase(academiaId: string, id: string): Promise<FilaClase | undefined> {
  return (await leerClases(academiaId)).find((fila) => fila.id === id);
}

/** Instantánea de los planes y las clases de una academia (con `actualizado_en`), para comparar antes y después. */
export async function instantaneaDePlanesYClases(academiaId: string): Promise<string> {
  return JSON.stringify({ planes: await leerPlanes(academiaId), clases: await leerClases(academiaId) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------------------------------------------------

/** Un plan como lo devuelve la API (`planSchema`). */
export interface PlanApi {
  id: string;
  nombre: string;
  vecesPorSemana: number;
  clasesPorMes: number;
  duracionMinutos: number;
  precio: string;
  diasPermitidos: number[];
  franjasPermitidas: string[];
  nivelesAplicables: string[];
  vigenciaInicio: string | null;
  vigenciaFin: string | null;
  activo: boolean;
  estado: string;
}

/** Una clase como la devuelve la API (`claseSchema`). */
export interface ClaseApi {
  id: string;
  nivel: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  aforo: number;
  activo: boolean;
  entrenador: { id: string; nombres: string; apellidos: string; activo: boolean };
}

export interface CuerpoPC {
  codigo?: string;
  mensaje?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
  plan?: PlanApi;
  planes?: PlanApi[];
  clase?: ClaseApi;
  clases?: ClaseApi[];
}

export interface RespuestaPC {
  status: number;
  body: CuerpoPC | null;
  cacheControl: string | null;
}

/** Cliente HTTP sobre la aplicación escuchando en un puerto efímero (las peticiones se pueden lanzar sin esperarlas). */
export interface ClientePC {
  get(ruta: string, cookie: string): Promise<RespuestaPC>;
  post(ruta: string, cookie: string, cuerpo?: unknown): Promise<RespuestaPC>;
  patch(ruta: string, cookie: string, cuerpo?: unknown): Promise<RespuestaPC>;
  delete(ruta: string, cookie: string): Promise<RespuestaPC>;
  /** Cierra la aplicación. */
  cerrar(): Promise<void>;
}

function leerCuerpo(texto: string): CuerpoPC | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as CuerpoPC;
  } catch {
    return null;
  }
}

/** Pone la aplicación a escuchar en `127.0.0.1` (puerto libre, portable a Windows) y devuelve un cliente con todos los métodos. */
export async function escucharParaPlanesClases(app: NestExpressApplication): Promise<ClientePC> {
  const base = await escucharAplicacion(app);
  const direccion = app.getHttpServer().address() as { port: number };
  const url = `http://127.0.0.1:${direccion.port}`;

  async function enviar(
    metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    ruta: string,
    cookie: string,
    cuerpo?: unknown,
  ): Promise<RespuestaPC> {
    const respuesta = await fetch(`${url}${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return {
      status: respuesta.status,
      body: leerCuerpo(await respuesta.text()),
      cacheControl: respuesta.headers.get('cache-control'),
    };
  }

  return {
    get: (ruta, cookie) => enviar('GET', ruta, cookie),
    post: (ruta, cookie, cuerpo) => enviar('POST', ruta, cookie, cuerpo),
    patch: (ruta, cookie, cuerpo) => enviar('PATCH', ruta, cookie, cuerpo),
    delete: (ruta, cookie) => enviar('DELETE', ruta, cookie),
    cerrar: () => base.cerrar(),
  };
}

/** Las seis rutas del contrato de la 004 (con `:id` como cualquier nombre de parámetro). */
const RUTAS_DE_LA_004: readonly RegExp[] = [
  /^GET \/api\/planes$/,
  /^POST \/api\/planes$/,
  /^PATCH \/api\/planes\/:\w+$/,
  /^GET \/api\/clases$/,
  /^POST \/api\/clases$/,
  /^PATCH \/api\/clases\/:\w+$/,
];

/**
 * Falla con un mensaje claro si las seis rutas de la 004 no están registradas (la funcionalidad no existe todavía). Evita que una
 * prueba pase "por casualidad" con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDePlanesYClases(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_004) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 004: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

/** Un cuerpo válido de `crearPlanSchema` (la spec: 3 veces por semana, 12 clases, S/ 120.00), con un nombre que no se repite. */
export function cuerpoPlan(sobrescribir: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nombre: `Plan de prueba ${randomBytes(4).toString('hex')}`,
    vecesPorSemana: 3,
    clasesPorMes: 12,
    precio: '120.00',
    diasPermitidos: [1, 3, 5],
    franjasPermitidas: ['08:00', '09:00', '18:00'],
    nivelesAplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    ...sobrescribir,
  };
}

/** Un cuerpo válido de `crearClaseSchema` del entrenador dado (lunes 08:00, nivel básico, aforo 30). */
export function cuerpoClase(entrenadorId: string, sobrescribir: Record<string, unknown> = {}): Record<string, unknown> {
  return { nivel: 'BASICO', diaSemana: 1, horaInicio: '08:00', entrenadorId, aforo: 30, ...sobrescribir };
}

/** Una copia del cuerpo sin la propiedad indicada. */
export function sinCampo(cuerpo: Record<string, unknown>, campo: string): Record<string, unknown> {
  const copia = { ...cuerpo };
  delete copia[campo];
  return copia;
}

/** Los campos de `detalles.errores` de una respuesta 400. */
export function camposConError(respuesta: { body: CuerpoPC | null }): string[] {
  return (respuesta.body?.detalles?.errores ?? []).map((error) => error.campo);
}

// ---------------------------------------------------------------------------------------------------------------------
// Retenciones para las carreras deterministas (sin tiempos ni esperas fijas)
// ---------------------------------------------------------------------------------------------------------------------

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * Sesiones cuya cadena de bloqueos llega al `pid` de la prueba: las bloqueadas directamente por ella y, transitivamente, las que
 * esperan a una de esas. `UNION` descarta repetidos y corta cualquier ciclo.
 */
const SQL_SESIONES_EN_LA_CADENA = `
  WITH RECURSIVE cadena(pid) AS (
    SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
    UNION
    SELECT a.pid FROM pg_stat_activity a JOIN cadena c ON c.pid = ANY(pg_blocking_pids(a.pid))
  )
  SELECT count(*)::int AS n FROM cadena`;

async function conectar(): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
  await cliente.connect();
  return cliente;
}

async function cerrarSinFallar(cliente: pg.Client): Promise<void> {
  await cliente.query('ROLLBACK').catch(() => undefined);
  await cliente.end().catch(() => undefined);
}

/** Observa una promesa sin consumirla: `terminada()` dice si ya se resolvió o rechazó. */
export function observar<T>(promesa: Promise<T>): { terminada: () => boolean; resultado: Promise<T> } {
  let terminada = false;
  const resultado = promesa.finally(() => {
    terminada = true;
  });
  // Evita un rechazo sin atender si la prueba falla antes de esperar el resultado.
  resultado.catch(() => undefined);
  return { terminada: () => terminada, resultado };
}

/** Espera `promesa` con el límite de seguridad; el temporizador se cancela al terminar. */
export async function conLimite<T>(promesa: Promise<T>, mensaje: string): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), LIMITE_DE_SEGURIDAD_MS);
  });
  try {
    return await Promise.race([promesa, vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Una transacción abierta de la prueba, con el contexto de una academia, que retiene lo que bloquea hasta `liberar`. */
export interface Retenedor {
  /** `pg_backend_pid()` de la transacción de la prueba. */
  readonly pid: number;
  consultar(sql: string, parametros?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Cuántas sesiones esperan, directa o transitivamente, algo que la transacción de la prueba retiene. */
  sesionesEsperando(): Promise<number>;
  /** Termina la transacción y cierra las conexiones. */
  liberar(como: 'COMMIT' | 'ROLLBACK'): Promise<void>;
}

/** Abre la transacción de la prueba (rol dueño, con el contexto de la academia) y un vigía para detectar quién espera. */
export async function abrirRetenedor(academiaId: string): Promise<Retenedor> {
  const retenedor = await conectar();
  let vigia: pg.Client | undefined;
  try {
    vigia = await conectar();
    await retenedor.query('BEGIN');
    await retenedor.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);
    const { rows } = await retenedor.query('SELECT pg_backend_pid() AS pid');
    const pid = (rows[0] as { pid: number }).pid;
    const vigiaListo = vigia;
    let cerrado = false;
    return {
      pid,
      async consultar(sql, parametros = []) {
        return (await retenedor.query(sql, parametros)).rows as Record<string, unknown>[];
      },
      async sesionesEsperando() {
        const { rows: filas } = await vigiaListo.query(SQL_SESIONES_EN_LA_CADENA, [pid]);
        return (filas[0] as { n: number }).n;
      },
      async liberar(como) {
        if (cerrado) return;
        cerrado = true;
        try {
          await retenedor.query(como);
        } finally {
          await cerrarSinFallar(retenedor);
          await cerrarSinFallar(vigiaListo);
        }
      },
    };
  } catch (error) {
    await cerrarSinFallar(retenedor);
    if (vigia) await cerrarSinFallar(vigia);
    throw error;
  }
}

/**
 * Espera, sin esperas fijas (solo consultas al vigía cada 5 ms y el límite de seguridad), a que se cumpla `condicion` o a que
 * alguna de las `peticiones` termine. Devuelve `true` si se cumplió la condición (la petición quedó esperando) y `false` si una
 * petición respondió antes. Lanza un error claro si se alcanza el límite de seguridad.
 */
export async function esperarEspera(
  condicion: () => Promise<boolean>,
  peticiones: readonly { terminada: () => boolean }[],
  mensaje: string,
): Promise<boolean> {
  const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
  while (!peticiones.some((peticion) => peticion.terminada())) {
    if (await condicion()) return true;
    if (Date.now() > limite) throw new Error(`Límite de seguridad (${LIMITE_DE_SEGURIDAD_MS} ms): ${mensaje}`);
    await pausa(5);
  }
  return false;
}

/** Lo que la transacción de la prueba hace sobre la fila de la clase mientras retiene su bloqueo. */
export type CambioDeLaClase =
  /** `SELECT … FOR UPDATE` sin cambiar nada (el caso de control). */
  | { tipo: 'bloquear' }
  /** `SELECT … FOR UPDATE` y `UPDATE` del aforo, sin confirmar. */
  | { tipo: 'aforo'; aforo: number };

/** El instante que la prueba le pone a `actualizado_en` al cambiar el aforo: distinto de cualquier otro (la API usa `RELOJ`). */
export const ACTUALIZADO_EN_DE_LA_PRUEBA = '2026-01-01T00:00:00.000Z';

/**
 * Criterio 22: retiene la fila de la clase en una transacción propia y sin confirmar (con `cambio`), envía las peticiones de
 * `enviar` sin esperarlas, espera a que todas queden esperando el bloqueo (directa o transitivamente) o a que alguna responda,
 * entonces confirma (`COMMIT`) o revierte (`ROLLBACK`) y devuelve las respuestas en el orden de `enviar`. Las peticiones deben
 * pasar por el middleware y por `bloquearActorVigente` (no bloquean la fila de la clase) y quedar esperando en
 * `bloquearClasesParaCupo`.
 */
export async function conClaseRetenida<T>(opciones: {
  academiaId: string;
  claseId: string;
  cambio: CambioDeLaClase;
  liberar: 'COMMIT' | 'ROLLBACK';
  enviar: (() => Promise<T>)[];
}): Promise<{ resultados: T[]; todasEsperaron: boolean }> {
  const retenedor = await abrirRetenedor(opciones.academiaId);
  try {
    await retenedor.consultar('SELECT id FROM clases WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
      opciones.academiaId,
      opciones.claseId,
    ]);
    if (opciones.cambio.tipo === 'aforo') {
      await retenedor.consultar(
        'UPDATE clases SET aforo = $3::smallint, actualizado_en = $4::timestamptz WHERE academia_id = $1::uuid AND id = $2::uuid',
        [opciones.academiaId, opciones.claseId, opciones.cambio.aforo, ACTUALIZADO_EN_DE_LA_PRUEBA],
      );
    }
    const peticiones = opciones.enviar.map((enviar) => observar(enviar()));
    let todasEsperaron = false;
    try {
      todasEsperaron = await esperarEspera(
        async () => (await retenedor.sesionesEsperando()) >= peticiones.length,
        peticiones,
        'las peticiones ni respondieron ni quedaron esperando el bloqueo de la clase.',
      );
    } finally {
      await retenedor.liberar(opciones.liberar);
    }
    const resultados = await conLimite(
      Promise.all(peticiones.map((peticion) => peticion.resultado)),
      'Límite de seguridad: las peticiones no respondieron tras liberar el bloqueo.',
    );
    return { resultados, todasEsperaron };
  } finally {
    await retenedor.liberar('ROLLBACK');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Función de producción de la 004 (se carga con importación dinámica: antes de implementarla falla con un mensaje claro)
// ---------------------------------------------------------------------------------------------------------------------

/** Lo que `bloquearClasesParaCupo` devuelve por cada clase que existe en la academia de la transacción (spec, criterio 23). */
export interface ClaseBloqueada {
  id: string;
  nivel: NivelNatacion;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  aforo: number;
  activo: boolean;
  entrenadorId: string;
}

export interface ModuloClases {
  bloquearClasesParaCupo(tx: TransaccionAcademiaPrueba, claseIds: readonly string[]): Promise<ClaseBloqueada[]>;
}

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/** `backend/src/modulos/clases/index.ts` (contrato: `bloquearClasesParaCupo`, reexportada desde `cupo.ts`). */
export async function cargarModuloClases(): Promise<ModuloClases> {
  const ruta = 'modulos/clases/index.ts';
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ_SRC, ruta)).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 004: no se pudo cargar "backend/src/${ruta}" (${motivo}).`, {
      cause: error,
    });
  }
  if (typeof modulo['bloquearClasesParaCupo'] !== 'function') {
    throw new Error(`Falta la funcionalidad de la 004: "backend/src/${ruta}" no exporta bloquearClasesParaCupo.`);
  }
  return modulo as unknown as ModuloClases;
}
