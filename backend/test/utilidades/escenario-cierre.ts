// spec: 010-mensualidades (pruebas protegidas)
// Ajuste por el criterio 34 de 010-mensualidades (trigger de matricula_clases), consecuencia directa de A2, decidido por el orquestador el 27/11/2026: los sembradores
// de matrículas cerradas (`sembrarSolicitud`; `sembrarEnMasa` en la 005b; `sembrarAlumno` en escenario-cierre) siembran la matrícula abierta (`VIGENTE`), insertan sus clases y
// después la pasan a su estado final (mismas columnas y valores que antes).
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { ejecutarComo } from './base-datos';
import type { AppCarnet } from './escenario-carnet';
import { type EscenarioDeAsistencia } from './escenario-asistencia';
import { exigirRutasDe010a } from './escenario-renovacion';
import { prepararEscenarioDe009b } from './escenario-faltas';
import { leerAlumnos, leerMatriculas, type RespuestaApi } from './inscripciones';
import { dniInventado, rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 010b (cierre de mes y listado de mensualidades). Solo usan SQL, HTTP y los contratos públicos
 * (`CierreDeMesService.cerrar(ahora)` del criterio 27, que las pruebas llaman directamente con `TAREAS_PROGRAMADAS` apagada, como la 009b con
 * `FaltasService`): no leen la implementación interna. Reutilizan el escenario de la 009 y el de la 010a. Lo que todavía no existe (el servicio del
 * cierre y la ruta del listado) se exige con un mensaje claro: ninguna prueba pasa por casualidad con una ruta inexistente (por ejemplo, el 401 sin
 * sesión que ya da el guardia global de la 002).
 *
 * Contrato que fijan estas utilidades: `CierreDeMesService` se exporta de `backend/src/modulos/mensualidades/cierre-de-mes.service.ts` y está
 * registrado en un módulo que **siempre** se carga (como `FaltasService`, en `AsistenciaModule`): solo la tarea (`CierreDeMesTarea`) vive en el módulo
 * condicionado por `TAREAS_PROGRAMADAS`; con `inactivas`, las pruebas obtienen el servicio con `app.get(CierreDeMesService)`.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Lo que la 010b agrega: la ruta del listado y el servicio del cierre
// ---------------------------------------------------------------------------------------------------------------------

export const RUTA_MENSUALIDADES = '/api/mensualidades';

/** `GET /api/mensualidades` con la cadena de consulta dada (`{ mes: '2026-11', planId }`; un valor `undefined` se omite; una lista repite el parámetro). */
export function rutaListado(consulta: Record<string, string | readonly string[] | undefined> = {}): string {
  const partes: string[] = [];
  for (const [clave, valor] of Object.entries(consulta)) {
    if (valor === undefined) continue;
    for (const uno of typeof valor === 'string' ? [valor] : valor) {
      partes.push(`${encodeURIComponent(clave)}=${encodeURIComponent(uno)}`);
    }
  }
  return partes.length === 0 ? RUTA_MENSUALIDADES : `${RUTA_MENSUALIDADES}?${partes.join('&')}`;
}

/** Falla con un mensaje claro si la ruta del listado de la 010b no está registrada (la funcionalidad no existe todavía). */
export function exigirRutasDe010b(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  if (!registradas.some((ruta) => /^GET \/api\/mensualidades$/.test(ruta))) {
    throw new Error('Falta la funcionalidad de la 010b: ninguna ruta registrada coincide con GET /api/mensualidades.');
  }
}

const RUTA_SRC = path.resolve(__dirname, '..', '..', 'src');

/** Lo que el contrato público del cierre promete (criterio 27): `cerrar(ahora)` se puede llamar directamente. */
export interface ServicioDeCierre {
  cerrar(ahora: Date): Promise<unknown>;
}

/** `CierreDeMesService` de `backend/src/modulos/mensualidades/cierre-de-mes.service.ts` (plan, «Cierre de mes»). Falla con un mensaje claro si todavía no existe. */
export async function cargarClaseDeCierre(): Promise<new (...argumentos: never[]) => ServicioDeCierre> {
  const ruta = path.join(RUTA_SRC, 'modulos', 'mensualidades', 'cierre-de-mes.service.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 010b: no se pudo cargar "backend/src/modulos/mensualidades/cierre-de-mes.service.ts" (${motivo}).`,
      { cause: error },
    );
  }
  const clase = modulo['CierreDeMesService'];
  if (typeof clase !== 'function') {
    throw new Error('Falta la funcionalidad de la 010b: "cierre-de-mes.service.ts" no exporta CierreDeMesService.');
  }
  return clase as new (...argumentos: never[]) => ServicioDeCierre;
}

/** El `CierreDeMesService` de la aplicación de pruebas. */
export async function servicioDeCierre(app: NestExpressApplication): Promise<ServicioDeCierre> {
  const clase = await cargarClaseDeCierre();
  let servicio: ServicioDeCierre;
  try {
    servicio = app.get<ServicioDeCierre>(clase);
  } catch (error) {
    throw new Error(
      'Falta la funcionalidad de la 010b: CierreDeMesService no está registrado en la aplicación (debe estar en un módulo que siempre se carga, como FaltasService).',
      { cause: error },
    );
  }
  expect(typeof servicio.cerrar, 'CierreDeMesService.cerrar(ahora)').toBe('function');
  return servicio;
}

/** Una vuelta de la tarea del cierre con el instante `ahora` (se llama directamente, sin esperar al `@Cron`). */
export async function ejecutarCierre(ctx: Pick<AppCarnet, 'app'>, ahora: Date): Promise<void> {
  await (await servicioDeCierre(ctx.app)).cerrar(ahora);
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------------------------------------------------

/**
 * El escenario de la 009 con la tarea de faltas (A y B con sus usuarios, el plan, las clases y la caja de hoy), la comprobación de que las rutas de la 010a
 * y el servicio del cierre existen, y sin artefactos que una prueba anterior haya dejado en la base (disparadores y tabla de vigilancia).
 */
export async function prepararEscenarioDeCierre(ctx: AppCarnet): Promise<EscenarioDeAsistencia> {
  await quitarArtefactosDeCierre();
  const esc = await prepararEscenarioDe009b(ctx, { rutas: false });
  exigirRutasDe010a(ctx.app);
  await servicioDeCierre(ctx.app);
  return esc;
}

// ---------------------------------------------------------------------------------------------------------------------
// Alumnos sembrados (como dueño de las tablas)
// ---------------------------------------------------------------------------------------------------------------------

export type EstadoDeAlumno = 'CLIENTE' | 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'INACTIVO';
export type EstadoDeMatricula = 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';

export interface MesDeCierre {
  anio: number;
  mes: number;
}

export const OCTUBRE: MesDeCierre = { anio: 2026, mes: 10 };
export const NOVIEMBRE: MesDeCierre = { anio: 2026, mes: 11 };
export const DICIEMBRE: MesDeCierre = { anio: 2026, mes: 12 };
export const ENERO_2027: MesDeCierre = { anio: 2027, mes: 1 };

export interface MatriculaSembrada {
  mes: MesDeCierre;
  estado: EstadoDeMatricula;
  clasesTotales?: number;
  clasesUsadas?: number;
}

export interface AlumnoSembrado {
  estado: EstadoDeAlumno;
  matriculas: readonly MatriculaSembrada[];
  academia?: 'A' | 'B';
  /** Las clases de cada matrícula (por defecto, los lunes, miércoles y viernes de las 18:00 de su academia). */
  claseIds?: readonly string[];
  nombres?: string;
  apellidos?: string;
  dni?: string;
}

export interface AlumnoConMatriculas {
  academiaId: string;
  alumnoId: string;
  dni: string;
  /** Los ids de las matrículas sembradas, en el orden de `matriculas`. */
  matriculaIds: string[];
}

const dos = (n: number): string => String(n).padStart(2, '0');

/**
 * Siembra un alumno de A (o de B) con el estado dado y una matrícula por cada elemento de `matriculas` (sin solicitud ni vencimiento, como las que deja la renovación; `creado_en`
 * el 11/11/2026, antes de cualquier día que prueben estas pruebas). No crea pagos, cuentas ni QR: el cierre solo mira los estados.
 */
export async function sembrarAlumno(
  esc: Pick<EscenarioDeAsistencia, 'e'>,
  spec: AlumnoSembrado,
): Promise<AlumnoConMatriculas> {
  const { e } = esc;
  const esB = spec.academia === 'B';
  const academiaId = esB ? e.B.id : e.A.id;
  const planId = esB ? e.planB.id : e.plan.id;
  const claseIds =
    spec.claseIds ?? (esB ? [e.lunesB.id, e.miercolesB.id, e.viernesB.id] : [e.lunes.id, e.miercoles.id, e.viernes.id]);
  const alumnoId = randomUUID();
  const dni = spec.dni ?? dniInventado();
  const creado = new Date('2026-11-11T15:00:00.000Z');
  await ejecutarComo(
    'propietario',
    `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion, $6::estado_alumno, $7, $7)`,
    [alumnoId, academiaId, dni, spec.nombres ?? 'Alumno', spec.apellidos ?? 'Del cierre', spec.estado, creado],
    { academiaId },
  );
  const matriculaIds: string[] = [];
  for (const matricula of spec.matriculas) {
    const id = randomUUID();
    matriculaIds.push(id);
    const ultimo = new Date(Date.UTC(matricula.mes.anio, matricula.mes.mes, 0)).getUTCDate();
    await ejecutarComo(
      'propietario',
      `INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                              es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::smallint, $6::smallint, $7::date, $8::date, $9, $10,
               false, 120.00, 12, 120.00, 'VIGENTE'::estado_matricula, NULL, $11, $11)`,
      [
        id,
        academiaId,
        alumnoId,
        planId,
        matricula.mes.anio,
        matricula.mes.mes,
        `${matricula.mes.anio}-${dos(matricula.mes.mes)}-01`,
        `${matricula.mes.anio}-${dos(matricula.mes.mes)}-${dos(ultimo)}`,
        matricula.clasesTotales ?? 12,
        matricula.clasesUsadas ?? 0,
        creado,
      ],
      { academiaId },
    );
    await ejecutarComo(
      'propietario',
      `INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
       SELECT $1::uuid, $2::uuid, c FROM unnest($3::uuid[]) AS c`,
      [academiaId, id, [...claseIds]],
      { academiaId },
    );
    // 010c (criterio 34): las clases de una matrícula cerrada no se insertan; se siembra `VIGENTE` y, con sus clases ya puestas, pasa a su estado final.
    if (matricula.estado !== 'VIGENTE') {
      await ejecutarComo(
        'propietario',
        `UPDATE matriculas SET estado = $3::estado_matricula WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [academiaId, id, matricula.estado],
        { academiaId },
      );
    }
  }
  return { academiaId, alumnoId, dni, matriculaIds };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------------------------------

/** El estado de un alumno (falla si no existe). */
export async function estadoDelAlumno(academiaId: string, alumnoId: string): Promise<string> {
  const fila = (await leerAlumnos(academiaId)).find((alumno) => alumno.id === alumnoId);
  expect(fila, `el alumno ${alumnoId} debía existir en ${academiaId}`).toBeTruthy();
  return (fila as NonNullable<typeof fila>).estado;
}

export interface MatriculaDelCierre {
  id: string;
  estado: string;
  clasesTotales: number;
  clasesUsadas: number;
}

/** Las matrículas de un alumno por mes (`'2026-11'`): el estado y las clases (falla si el alumno tiene dos del mismo mes en la lectura). */
export async function matriculasPorMes(
  academiaId: string,
  alumnoId: string,
): Promise<Record<string, MatriculaDelCierre>> {
  const resultado: Record<string, MatriculaDelCierre> = {};
  for (const fila of await leerMatriculas(academiaId)) {
    if (fila.alumno_id !== alumnoId) continue;
    resultado[`${fila.anio}-${dos(fila.mes)}`] = {
      id: fila.id,
      estado: fila.estado,
      clasesTotales: fila.clases_totales,
      clasesUsadas: fila.clases_usadas,
    };
  }
  return resultado;
}

/** El estado de la matrícula de un mes de un alumno (`undefined` si no tiene). */
export async function estadoDeLaMatricula(
  academiaId: string,
  alumnoId: string,
  mes: MesDeCierre,
): Promise<string | undefined> {
  return (await matriculasPorMes(academiaId, alumnoId))[`${mes.anio}-${dos(mes.mes)}`]?.estado;
}

/** Todas las filas de `alumnos` y `matriculas` de una academia, con sus fechas de actualización, como un texto para compararlo antes y después. */
export async function instantaneaDeAcademiaDelCierre(academiaId: string): Promise<string> {
  return JSON.stringify([await leerAlumnos(academiaId), await leerMatriculas(academiaId)]);
}

/**
 * Lo mismo de A y de B juntas: lo que una vuelta del cierre que no tiene nada que hacer (o una academia saltada o suspendida) no puede cambiar.
 */
export async function instantaneaDelCierre(esc: Pick<EscenarioDeAsistencia, 'e'>): Promise<string> {
  return JSON.stringify([
    await instantaneaDeAcademiaDelCierre(esc.e.A.id),
    await instantaneaDeAcademiaDelCierre(esc.e.B.id),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// El listado (criterios 25 y 26)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaDelListado {
  alumnoId: string;
  nombres: string;
  apellidos: string;
  nivel: string;
  estado: string;
  mensualidad: {
    mes: string;
    plan: { id: string; nombre: string };
    clases: unknown[];
    clasesUsadas: number;
    clasesTotales: number;
  } | null;
  siguiente: { mes: string; estado: string } | null;
}

export interface ListadoApi {
  mes: string;
  hoy: string;
  totales: unknown;
  alumnos: FilaDelListado[];
  hayMas: boolean;
}

/** El listado de una respuesta 200; si no lo es, falla con el estado y el cuerpo recibidos. */
export function listadoDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>): ListadoApi {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`).toBe(
    200,
  );
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  const listado = respuesta.body as unknown as ListadoApi;
  expect(Array.isArray(listado.alumnos), 'el listado debe traer `alumnos`').toBe(true);
  return listado;
}

/** La suma de todos los números que hay dentro de un valor (para los totales por estado, sea cual sea su forma). */
export function sumaDeNumeros(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  if (Array.isArray(valor)) return valor.reduce<number>((suma, uno) => suma + sumaDeNumeros(uno), 0);
  if (valor !== null && typeof valor === 'object') {
    return Object.values(valor).reduce<number>((suma, uno) => suma + sumaDeNumeros(uno), 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vigilancia y fallas forzadas (disparadores temporales: se crean y se borran aquí, con el dueño de las tablas)
// ---------------------------------------------------------------------------------------------------------------------

const PROPIETARIO = 'propietario' as const;

/** Borra todo lo que `vigilarCierre` y `forzarFallaDeCierreEn` crean (también lo que dejó una prueba anterior que murió a medias). */
export async function quitarArtefactosDeCierre(): Promise<void> {
  const { rows: disparadores } = await ejecutarComo(
    PROPIETARIO,
    `SELECT t.tgname AS disparador, c.relname AS tabla FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgname LIKE 'zz\\_%cierre\\_%'`,
  );
  for (const fila of disparadores as { disparador: string; tabla: string }[]) {
    await ejecutarComo(PROPIETARIO, `DROP TRIGGER IF EXISTS ${fila.disparador} ON public.${fila.tabla}`);
  }
  const { rows: funciones } = await ejecutarComo(
    PROPIETARIO,
    `SELECT p.proname AS nombre FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'zz\\_%cierre\\_%'`,
  );
  for (const fila of funciones as { nombre: string }[]) {
    await ejecutarComo(PROPIETARIO, `DROP FUNCTION IF EXISTS public.${fila.nombre}() CASCADE`);
  }
  await ejecutarComo(PROPIETARIO, 'DROP TABLE IF EXISTS public.zz_cierre_sentencias');
}

export interface VigilanciaDelCierre {
  /** Las sentencias `UPDATE` que el cierre ejecutó sobre `matriculas` y `alumnos`, con la academia de su contexto. */
  sentencias(): Promise<{ tabla: string; academia: string | null }[]>;
  /** Quita los disparadores y la tabla. */
  quitar(): Promise<void>;
}

/**
 * Vigila lo que el cierre escribe: (1) un disparador por fila antes de cada `UPDATE` de `matriculas` y `alumnos` que falla (`P0001`) si la academia de la
 * fila no es la del contexto de la transacción (`app.academia_id`): una escritura con el contexto de otra academia o de la plataforma no pasa;
 * (2) un disparador por sentencia que cuenta las sentencias `UPDATE` de cada tabla con la academia de su contexto (para comprobar que escribe con sentencias de
 * muchas filas, sin bucles). Hay que crearla **después** de sembrar los datos de la prueba.
 */
export async function vigilarCierre(): Promise<VigilanciaDelCierre> {
  await ejecutarComo(PROPIETARIO, `CREATE TABLE public.zz_cierre_sentencias (tabla text NOT NULL, academia text)`);
  await ejecutarComo(PROPIETARIO, 'GRANT INSERT ON public.zz_cierre_sentencias TO PUBLIC');
  await ejecutarComo(
    PROPIETARIO,
    `CREATE FUNCTION public.zz_cierre_contexto() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
     AS $$ BEGIN
       IF NEW.academia_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.academia_id', true), '')::uuid THEN
         RAISE EXCEPTION 'El cierre escribió con el contexto de otra academia' USING ERRCODE = 'P0001';
       END IF;
       RETURN NEW;
     END $$`,
  );
  await ejecutarComo(
    PROPIETARIO,
    `CREATE FUNCTION public.zz_cierre_cuenta() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
     AS $$ BEGIN
       INSERT INTO public.zz_cierre_sentencias (tabla, academia) VALUES (TG_TABLE_NAME, pg_catalog.current_setting('app.academia_id', true));
       RETURN NULL;
     END $$`,
  );
  await ejecutarComo(PROPIETARIO, 'REVOKE ALL ON FUNCTION public.zz_cierre_contexto() FROM PUBLIC');
  await ejecutarComo(PROPIETARIO, 'REVOKE ALL ON FUNCTION public.zz_cierre_cuenta() FROM PUBLIC');
  for (const tabla of ['matriculas', 'alumnos']) {
    await ejecutarComo(
      PROPIETARIO,
      `CREATE TRIGGER zz_cierre_contexto_${tabla} BEFORE UPDATE ON public.${tabla} FOR EACH ROW EXECUTE FUNCTION public.zz_cierre_contexto()`,
    );
    await ejecutarComo(
      PROPIETARIO,
      `CREATE TRIGGER zz_cierre_cuenta_${tabla} AFTER UPDATE ON public.${tabla} FOR EACH STATEMENT EXECUTE FUNCTION public.zz_cierre_cuenta()`,
    );
  }
  return {
    async sentencias() {
      const { rows } = await ejecutarComo(PROPIETARIO, 'SELECT tabla, academia FROM public.zz_cierre_sentencias');
      return rows as { tabla: string; academia: string | null }[];
    },
    quitar: quitarArtefactosDeCierre,
  };
}

/**
 * Hace fallar (`P0001`) todo `UPDATE` de `matriculas` de la academia indicada que deje una matrícula en `FINALIZADA`, con un disparador temporal. Devuelve la
 * función que lo quita: la prueba la llama siempre, también si falla. Solo afecta a esa academia.
 */
export async function forzarFallaDeCierreEn(academiaId: string): Promise<() => Promise<void>> {
  const sufijo = academiaId.replaceAll('-', '').slice(0, 12);
  const funcion = `zz_falla_cierre_${sufijo}`;
  await ejecutarComo(
    PROPIETARIO,
    `CREATE FUNCTION public.${funcion}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
     AS $$ BEGIN RAISE EXCEPTION 'Falla forzada por la prueba' USING ERRCODE = 'P0001'; END $$`,
  );
  await ejecutarComo(PROPIETARIO, `REVOKE ALL ON FUNCTION public.${funcion}() FROM PUBLIC`);
  await ejecutarComo(
    PROPIETARIO,
    `CREATE TRIGGER ${funcion} BEFORE UPDATE ON public.matriculas FOR EACH ROW
       WHEN (NEW.academia_id = '${academiaId}'::uuid AND NEW.estado = 'FINALIZADA' AND OLD.estado IS DISTINCT FROM 'FINALIZADA')
       EXECUTE FUNCTION public.${funcion}()`,
  );
  return async () => {
    await ejecutarComo(PROPIETARIO, `DROP TRIGGER IF EXISTS ${funcion} ON public.matriculas`);
    await ejecutarComo(PROPIETARIO, `DROP FUNCTION IF EXISTS public.${funcion}()`);
  };
}
