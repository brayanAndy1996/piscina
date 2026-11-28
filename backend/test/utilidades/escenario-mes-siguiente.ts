// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import type { AppCarnet } from './escenario-carnet';
import { prepararEscenarioDeCierre } from './escenario-cierre';
import { ampliarEscenarioDeHorario, type EscenarioDeHorario } from './escenario-horario';
import { INSTANTES, NOVIEMBRE } from './escenario-renovacion';
import {
  cotizacionEsperada,
  type CotizacionEsperada,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  instanteEnLima,
  type Objeto,
  type OpcionesCuerpo,
  type RespuestaApi,
  rutaPublica,
  variante,
} from './inscripciones';
import { type ClaseDePrueba, crearClaseDePrueba, crearPlanDePrueba, type PlanDePrueba } from './planes-clases';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 010d (inscripción pública al mes siguiente). Solo usan SQL, HTTP y los contratos públicos: no importan
 * nada de la implementación interna. Reutilizan el escenario de la 010c (A y B con sus usuarios, el plan de 3 por semana de S/ 120.00, el plan de una
 * clase por semana de S/ 40.00, la caja de hoy, el cierre de mes y la tarea de faltas) y le suman la clase c de los sábados a las 10:00 (aforo 20) de A
 * y de B, que es la clase de los ejemplos de la spec. Con «ahora» el 27/11/2026 y N = 5, el mes en curso (M) es noviembre y el siguiente (M+1), diciembre.
 */

export const MES_NOV = '2026-11';
export const MES_DIC = '2026-12';
export const MES_ENE_2027 = '2027-01';
export const DIC = { anio: 2026, mes: 12 } as const;
export const NOV = NOVIEMBRE;

/** Instantes de Lima usados por varias pruebas (el 27/11/2026 es viernes; el 1/12, martes). */
export const INSTANTE = {
  ...INSTANTES,
  /** Los extremos de la ventana de diciembre, con N = 5. */
  antesDeLaVentana: INSTANTES.ultimoAntesDeLaVentana,
  /** El 30/11 a las 22:00 de Lima (ya es 1/12 a las 03:00 en UTC): la reserva de 24 horas cruza el día 1. */
  lunes30a22: instanteEnLima('2026-11-30', '22:00'),
  /** El 28/11 a las 10:00 y a las 11:00: el vencimiento de dos reservas hechas el 27/11 a las 10:00 y a las 11:00. */
  sabado28a10: instanteEnLima('2026-11-28', '10:00'),
  viernes27a11: instanteEnLima('2026-11-27', '11:00'),
  martes1: instanteEnLima('2026-12-01', '00:00'),
  miercoles2: instanteEnLima('2026-12-02', '10:00'),
  jueves31dic: instanteEnLima('2026-12-31', '10:00'),
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Rutas y contratos
// ---------------------------------------------------------------------------------------------------------------------

export const rutaMeses = (nombreCorto = 'academia-a'): string => rutaPublica(nombreCorto, '/inscripcion/meses');
export const rutaFormulario = (nombreCorto = 'academia-a', consulta = ''): string =>
  rutaPublica(nombreCorto, `/inscripcion${consulta}`);
export const rutaCotizacion = (nombreCorto = 'academia-a'): string =>
  rutaPublica(nombreCorto, '/inscripcion/cotizacion');
export const rutaEnvio = (nombreCorto = 'academia-a'): string => rutaPublica(nombreCorto, '/inscripcion');

/** Falla con un mensaje claro si `GET /api/a/:nombreCorto/inscripcion/meses` no está registrada (la funcionalidad no existe todavía). */
export function exigirRutaDeMeses(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  const patron = /^GET \/api\/a\/:\w+\/inscripcion\/meses$/;
  if (!registradas.some((ruta) => patron.test(ruta))) {
    throw new Error(`Falta la funcionalidad de la 010d: ninguna ruta registrada coincide con ${String(patron)}.`);
  }
}

interface EsquemaDePrueba {
  safeParse(valor: unknown): { success: boolean; error?: unknown };
}

export interface ContratosDe010d {
  mesesInscripcionSchema: EsquemaDePrueba;
  consultaFormularioSchema: EsquemaDePrueba;
  cotizarInscripcionSchema: EsquemaDePrueba;
  respuestaFormularioInscripcionSchema: EsquemaDePrueba;
}

/** Los esquemas de `@aquagestion/contratos` que agrega la 010d (criterio 16). Falla con un mensaje claro si faltan. */
export async function cargarContratosDe010d(): Promise<ContratosDe010d> {
  const modulo = (await import('@aquagestion/contratos')) as Record<string, unknown>;
  for (const nombre of ['mesesInscripcionSchema', 'consultaFormularioSchema']) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 010d: @aquagestion/contratos no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as ContratosDe010d;
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------------------------------------------------

export interface EscenarioMesSiguiente extends EscenarioDeHorario {
  /** La clase c de los ejemplos de la spec: sábado BASICO a las 10:00, aforo 20, de A. */
  c: ClaseDePrueba;
  /** La misma clase en B. */
  cB: ClaseDePrueba;
  /** El plan de una clase por semana (4 al mes, S/ 40.00) de B, con sábado a las 10:00. */
  planUnDiaB: PlanDePrueba;
}

/**
 * El escenario de la 010c (con el cierre de mes y las rutas de la 010a) más la clase c de los sábados a las 10:00 en A y en B y el plan de una clase por
 * semana de B. El plan de A de una clase por semana (`planUnDia`: lunes, martes, miércoles, viernes y sábado; 10:00, 17:00, 18:00 y 19:00) sirve para c.
 */
export async function prepararEscenarioDeMesSiguiente(ctx: AppCarnet): Promise<EscenarioMesSiguiente> {
  const esc = await ampliarEscenarioDeHorario(ctx, await prepararEscenarioDeCierre(ctx));
  const { e } = esc;
  const c = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
    nivel: 'BASICO',
    dia_semana: 6,
    hora_inicio: '10:00',
    aforo: 20,
  });
  const cB = await crearClaseDePrueba(e.B.id, e.lunesB.entrenador_id, {
    nivel: 'BASICO',
    dia_semana: 6,
    hora_inicio: '10:00',
    aforo: 20,
  });
  const planUnDiaB = await crearPlanDePrueba(e.B.id, {
    nombre: 'Plan de una clase por semana',
    veces_por_semana: 1,
    clases_por_mes: 4,
    precio: '40.00',
    dias_permitidos: [1, 2, 3, 5, 6],
    franjas_permitidas: ['10:00', '17:00', '18:00', '19:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
  });
  return { ...esc, c, cB, planUnDiaB };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cotizaciones y cuerpos
// ---------------------------------------------------------------------------------------------------------------------

/**
 * La cotización que debe dar la API para un plan y unas clases en el mes `AAAA-MM` desde el día 1 (las 00:00 de Lima): la del mes siguiente (criterio 3). Usa el
 * cálculo independiente de las pruebas de la 005 (`cotizacionEsperada`), que cuenta las ocurrencias desde el instante dado.
 */
export function cotizacionDelMes(
  plan: { clases_por_mes: number; precio: string },
  clases: readonly { dia_semana: number; hora_inicio: string }[],
  mes: string,
): CotizacionEsperada {
  return cotizacionEsperada(plan, clases, instanteEnLima(`${mes}-01`, '00:00'));
}

export interface OpcionesDelEnvio extends Omit<OpcionesCuerpo, 'sobre' | 'ahora'> {
  /** Cambios sobre el cuerpo (ver `variante`). */
  sobre?: Objeto;
  /** Con este «ahora» se calcula el monto mostrado de un mes que no es `mes` (por defecto, el del mes pedido desde el día 1). */
  montoMostrado?: string;
}

/**
 * El cuerpo de un envío para el mes `AAAA-MM` con el monto de la cotización del mes desde el día 1 (M+1) o, si `ahoraDeM` se da, con la cotización de M en ese instante.
 * Un mismo cuerpo vale para el público y para recepción.
 */
export async function cuerpoParaMes(
  e: EscenarioInscripcion,
  mes: string,
  opciones: OpcionesDelEnvio & { ahoraDeM?: Date } = {},
): Promise<Objeto> {
  const { sobre, montoMostrado, ahoraDeM, ...resto } = opciones;
  const plan = resto.plan ?? e.plan;
  const clases = resto.clases ?? [e.lunes, e.miercoles, e.viernes];
  const monto =
    montoMostrado ??
    (ahoraDeM ? cotizacionEsperada(plan, clases, ahoraDeM).monto : cotizacionDelMes(plan, clases, mes).monto);
  return cuerpoInscripcion(e, {
    ...resto,
    sobre: variante({ inscripcion: { mes, montoMostrado: monto } }, sobre ?? {}),
  });
}

/** El cuerpo de la cotización (`cotizarInscripcionSchema`), con `mes` si se da. */
export function cuerpoDeCotizacion(
  opciones: { planId: string; nivel?: string; claseIds: readonly string[]; mes?: unknown },
  sobre: Objeto = {},
): Objeto {
  const cuerpo: Objeto = {
    planId: opciones.planId,
    nivel: opciones.nivel ?? 'BASICO',
    claseIds: [...opciones.claseIds],
    ...(opciones.mes === undefined ? {} : { mes: opciones.mes }),
    ...sobre,
  };
  for (const [clave, valor] of Object.entries(cuerpo)) if (valor === undefined) delete cuerpo[clave];
  return cuerpo;
}

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones (la aplicación del carnet sirve también las rutas públicas)
// ---------------------------------------------------------------------------------------------------------------------

interface Cliente {
  http: {
    get(ruta: string, opciones?: { cookie?: string; headers?: Record<string, string> }): Promise<RespuestaApi>;
    post(
      ruta: string,
      cuerpo?: unknown,
      opciones?: { cookie?: string; headers?: Record<string, string> },
    ): Promise<RespuestaApi>;
  };
}

export const pedirMeses = (ctx: Cliente, nombreCorto = 'academia-a'): Promise<RespuestaApi> =>
  ctx.http.get(rutaMeses(nombreCorto));

export const pedirFormulario = (ctx: Cliente, consulta = '', nombreCorto = 'academia-a'): Promise<RespuestaApi> =>
  ctx.http.get(rutaFormulario(nombreCorto, consulta));

export const cotizarPublico = (ctx: Cliente, cuerpo: unknown, nombreCorto = 'academia-a'): Promise<RespuestaApi> =>
  ctx.http.post(rutaCotizacion(nombreCorto), cuerpo);

export const enviarPublico = (
  ctx: Cliente,
  cuerpo: unknown,
  opciones: { cookie?: string; nombreCorto?: string } = {},
): Promise<RespuestaApi> =>
  ctx.http.post(rutaEnvio(opciones.nombreCorto ?? 'academia-a'), cuerpo, { cookie: opciones.cookie });

/** La consulta pública de seguimiento por token. */
export const consultarSolicitud = (ctx: Cliente, token: string, nombreCorto = 'academia-a'): Promise<RespuestaApi> =>
  ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), { token });

/** `PATCH /api/configuracion` con la sesión del administrador. */
export const cambiarConfiguracion = (
  ctx: Pick<AppCarnet, 'http'>,
  cookie: string,
  cuerpo: Objeto,
): Promise<RespuestaApi> => ctx.http.enviar('PATCH', '/api/configuracion', { cookie, cuerpo });

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas de las respuestas
// ---------------------------------------------------------------------------------------------------------------------

export interface MesDeInscripcion {
  mes: string;
  fechaInicio: string;
  inscripcionHasta: string;
}

export interface RespuestaDeMeses {
  hoy: string;
  meses: MesDeInscripcion[];
  aperturaMesSiguiente: string | null;
}

/** El cuerpo de `GET …/inscripcion/meses` (falla con el estado y el texto recibidos si no es un 200). */
export function mesesDe(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>): RespuestaDeMeses {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 400)}`).toBe(
    200,
  );
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as RespuestaDeMeses;
}

export interface ClaseDelFormulario {
  id: string;
  cuposRestantes: number;
  [clave: string]: unknown;
}

/** Las clases del formulario público de una respuesta 200. */
export function clasesDelFormulario(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>): ClaseDelFormulario[] {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 400)}`).toBe(
    200,
  );
  return (respuesta.body?.['clases'] ?? []) as ClaseDelFormulario[];
}

/** Los cupos restantes de una clase en el formulario (`undefined` si la clase no aparece). */
export const cuposDe = (
  respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>,
  claseId: string,
): number | undefined => clasesDelFormulario(respuesta).find((clase) => clase.id === claseId)?.cuposRestantes;

export function planesDelFormulario(respuesta: Pick<RespuestaApi, 'status' | 'body' | 'texto'>): Objeto[] {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 400)}`).toBe(
    200,
  );
  return (respuesta.body?.['planes'] ?? []) as Objeto[];
}

/** Un identificador que no existe (para un plan o una clase inventados). */
export const idInexistente = (): string => randomUUID();
