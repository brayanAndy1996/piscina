// spec: 005-inscripcion-publica (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, criterio 7): `TIPO_DE_COLUMNA` suma `registrada_por` (uuid) para escribir esa columna de `solicitudes_inscripcion`. No se quitó ni se cambió nada más.
// Actualizada por la 010a (spec 010-mensualidades, criterio 1: `CHECK matriculas_renovacion_sin_vencimiento`, una matrícula sin solicitud nunca tiene `reserva_vence_en`): `filaValida('matriculas')` queda sin vencimiento
// (la fila ya no tiene solicitud, así que no puede tener reserva) y `sqlLlenarClase`, cuando llena con matrículas `RESERVADA` con vencimiento, siembra también la solicitud de cada una. No cambia lo que comprueban las pruebas
// que usan estas utilidades.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { DestinationStream } from 'pino';
import { expect } from 'vitest';
import { type Contexto, ejecutarComo, type RolPruebas } from './base-datos';
import { escucharAplicacion } from './carreras';
import {
  abrirRetenedor,
  type ClaseDePrueba,
  conLimite,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  esperarEspera,
  observar,
  type PlanDePrueba,
  type Retenedor,
} from './planes-clases';
import { AHORA_PRUEBAS, crearAppConReloj, crearEscenario, dniInventado, type Escenario } from './usuarios';
import type { RelojFijo } from '../../src/infraestructura/reloj';

/**
 * Utilidades de las pruebas protegidas de la historia 005a (spec.md, "Contrato" y "Cambios al modelo de datos"): un escenario con
 * planes y clases, cuerpos del formulario, un cliente HTTP para las rutas públicas y las del panel, filas de las siete tablas nuevas
 * (también inválidas y también `VENCIDA` o `CANCELADA`, que la 005a no puede producir por API), cálculos de referencia escritos aquí
 * de forma independiente (clases restantes, monto, ocupación), retenciones de filas para las carreras deterministas y un almacén de
 * límites sin tope para las pruebas que envían muchas veces desde la misma dirección.
 *
 * Solo usan SQL, HTTP y los contratos públicos: no importan nada de la implementación de la 005. Lo que viene de producción (esquemas
 * de contratos, `contarOcupacion`, el token del enviador de correo) se carga con importación dinámica y, si falta, la prueba falla con
 * un mensaje claro. Todas las lecturas filtran por `academia_id` y fijan el contexto de la academia: sirven con un dueño superusuario
 * (CI) y con uno que no lo es (nube).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Constantes y cálculos de referencia (escritos aquí, sin librerías de fechas: Lima es UTC-5 todo el año)
// ---------------------------------------------------------------------------------------------------------------------

/** Mensualidad de ejemplo: miércoles 11 de noviembre de 2026, 10:00 en Lima (el mismo instante de `AHORA_PRUEBAS`). */
export const AHORA_005 = AHORA_PRUEBAS;
export const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1000;
export const ACCION_SOLICITUD_CREADA = 'SOLICITUD_INSCRIPCION_CREADA';
export const IP_RE = /^(::ffff:)?127\.0\.0\.1$/;

const OFFSET_LIMA_MS = 5 * 60 * 60 * 1000;

export interface FechaLima {
  anio: number;
  mes: number;
  dia: number;
  /** `AAAA-MM-DD`. */
  texto: string;
  /** `AAAA-MM`. */
  mesTexto: string;
  /** Último día del mes. */
  ultimoDia: number;
}

/** La fecha de calendario de un instante en America/Lima (UTC-5 sin horario de verano). */
export function fechaEnLima(instante: Date): FechaLima {
  const lima = new Date(instante.getTime() - OFFSET_LIMA_MS);
  const anio = lima.getUTCFullYear();
  const mes = lima.getUTCMonth() + 1;
  const dia = lima.getUTCDate();
  const dos = (n: number) => String(n).padStart(2, '0');
  return {
    anio,
    mes,
    dia,
    texto: `${anio}-${dos(mes)}-${dos(dia)}`,
    mesTexto: `${anio}-${dos(mes)}`,
    ultimoDia: new Date(Date.UTC(anio, mes, 0)).getUTCDate(),
  };
}

/** Día de la semana ISO (1 lunes … 7 domingo) de una fecha de calendario. */
function diaIso(anio: number, mes: number, dia: number): number {
  const d = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** El instante en que empieza, en Lima, la hora `HH:MM` de una fecha de calendario. */
export function instanteEnLima(fecha: string, hora: string): Date {
  const [a = '0', m = '0', d = '0'] = fecha.split('-');
  const [h = '0', min = '0'] = hora.split(':');
  return new Date(Date.UTC(Number(a), Number(m) - 1, Number(d), Number(h), Number(min)) + OFFSET_LIMA_MS);
}

/** Clases restantes del mes en curso (spec, criterio 8), calculadas aquí: las de hoy cuentan solo si empiezan después de "ahora". */
export function clasesRestantesEsperadas(
  clases: readonly { diaSemana?: number; dia_semana?: number; horaInicio?: string; hora_inicio?: string }[],
  ahora: Date,
): number {
  const hoy = fechaEnLima(ahora);
  let cuenta = 0;
  for (let dia = hoy.dia; dia <= hoy.ultimoDia; dia++) {
    const iso = diaIso(hoy.anio, hoy.mes, dia);
    for (const clase of clases) {
      if ((clase.diaSemana ?? clase.dia_semana) !== iso) continue;
      if (dia === hoy.dia) {
        const inicio = instanteEnLima(hoy.texto, (clase.horaInicio ?? clase.hora_inicio) as string);
        if (inicio.getTime() <= ahora.getTime()) continue;
      }
      cuenta += 1;
    }
  }
  return cuenta;
}

/** `precio × totales ÷ clasesPorMes` redondeado hacia arriba al sol entero, con enteros (céntimos), como texto con dos decimales. */
export function montoEsperado(precio: string, clasesPorMes: number, clasesTotales: number): string {
  const [enteros = '0', decimales = ''] = precio.split('.');
  const centimos = BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0').slice(0, 2));
  const numerador = centimos * BigInt(clasesTotales);
  const denominador = BigInt(clasesPorMes) * 100n;
  const soles = (numerador + denominador - 1n) / denominador;
  return `${soles}.00`;
}

export interface CotizacionEsperada {
  mes: string;
  fechaInicio: string;
  fechaFin: string;
  clasesRestantes: number;
  clasesTotales: number;
  clasesPorMes: number;
  precioPlan: string;
  monto: string;
  esProporcional: boolean;
}

/** La cotización que debe dar la API para un plan y unas clases en un instante. */
export function cotizacionEsperada(
  plan: { clases_por_mes: number; precio: string },
  clases: readonly { dia_semana: number; hora_inicio: string }[],
  ahora: Date,
): CotizacionEsperada {
  const hoy = fechaEnLima(ahora);
  const restantes = clasesRestantesEsperadas(clases, ahora);
  const totales = Math.min(restantes, plan.clases_por_mes);
  return {
    mes: hoy.mesTexto,
    fechaInicio: hoy.texto,
    fechaFin: `${hoy.mesTexto}-${String(hoy.ultimoDia).padStart(2, '0')}`,
    clasesRestantes: restantes,
    clasesTotales: totales,
    clasesPorMes: plan.clases_por_mes,
    precioPlan: aDosDecimales(plan.precio),
    monto: totales > 0 ? montoEsperado(plan.precio, plan.clases_por_mes, totales) : '0.00',
    esProporcional: restantes < plan.clases_por_mes,
  };
}

/** Un monto escrito como texto, con exactamente dos decimales (`"120"` y `"120.5"` dan `"120.00"` y `"120.50"`), sin pasar por `number`. */
export function aDosDecimales(texto: string): string {
  const [enteros = '0', decimales = ''] = texto.split('.');
  return `${enteros}.${decimales.padEnd(2, '0').slice(0, 2)}`;
}

export function sha256(texto: string): Buffer {
  return createHash('sha256').update(texto).digest();
}

const ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Un código con el formato del criterio 24 (`AQ-` y 6 caracteres de Crockford). */
export function codigoAleatorio(): string {
  const bytes = randomBytes(6);
  return `AQ-${Array.from(bytes, (b) => ALFABETO_CROCKFORD.charAt(b % 32)).join('')}`;
}
export const FORMATO_CODIGO = /^AQ-[0-9A-HJKMNP-TV-Z]{6}$/;
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function tokenAleatorio(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------------------------------------------------
// Contratos y módulos de producción (importación dinámica con mensaje claro)
// ---------------------------------------------------------------------------------------------------------------------

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/** Lo que la 005a agrega a `@aquagestion/contratos` y que las pruebas necesitan para armar cuerpos. */
export interface ContratosInscripcion {
  VERSION_CONSENTIMIENTOS: string;
  TIPOS_CONSENTIMIENTO: readonly string[];
  TIPOS_SANGRE: readonly string[];
  GRADOS_COLEGIO: readonly string[];
  PARENTESCOS: readonly string[];
  textosConsentimiento: (nombreAcademia: string, opciones: { menor: boolean }) => Record<string, string>;
  esMenorDeEdad: (fechaNacimiento: string, hoy: string) => boolean;
}

export async function cargarContratos(): Promise<ContratosInscripcion> {
  let modulo: Record<string, unknown>;
  try {
    modulo = await import('@aquagestion/contratos');
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo cargar @aquagestion/contratos (${motivo}).`, { cause: error });
  }
  for (const nombre of [
    'VERSION_CONSENTIMIENTOS',
    'TIPOS_CONSENTIMIENTO',
    'TIPOS_SANGRE',
    'GRADOS_COLEGIO',
    'PARENTESCOS',
    'textosConsentimiento',
    'esMenorDeEdad',
  ]) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 005: @aquagestion/contratos no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as ContratosInscripcion;
}

/** Un módulo de producción de la 005 (ruta desde `backend/src`) con las exportaciones que el contrato dice. */
export async function cargarFuncionalidad005<T>(rutaDesdeSrc: string, exportaciones: readonly string[]): Promise<T> {
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ_SRC, rutaDesdeSrc)).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 005: no se pudo cargar "backend/src/${rutaDesdeSrc}" (${motivo}).`, {
      cause: error,
    });
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 005: "backend/src/${rutaDesdeSrc}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tipos de la base (listas de N5 leídas del catálogo: no se escriben a mano)
// ---------------------------------------------------------------------------------------------------------------------

const etiquetasDeEnum = new Map<string, string[]>();

/** Las etiquetas de un tipo enumerado de PostgreSQL, en su orden. Falla con un mensaje claro si el tipo no existe. */
export async function etiquetasDelTipo(tipo: string): Promise<string[]> {
  const conocido = etiquetasDeEnum.get(tipo);
  if (conocido) return conocido;
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT e.enumlabel AS valor FROM pg_catalog.pg_type t
       JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = $1 ORDER BY e.enumsortorder`,
    [tipo],
  );
  const lista = (rows as { valor: string }[]).map((fila) => fila.valor);
  if (lista.length === 0) {
    throw new Error(
      `Falta la funcionalidad de la 005: el tipo public.${tipo} no existe (la migración no está aplicada).`,
    );
  }
  etiquetasDeEnum.set(tipo, lista);
  return lista;
}

const TABLAS_005 = [
  'alumnos',
  'apoderados',
  'fichas_medicas',
  'consentimientos',
  'solicitudes_inscripcion',
  'matriculas',
  'matricula_clases',
] as const;
export type Tabla005 = (typeof TABLAS_005)[number];
export { TABLAS_005 };

/** Falla con un mensaje claro si la migración de la 005a todavía no creó las siete tablas. */
export async function exigirTablasDeInscripcion(): Promise<void> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT t.nombre, pg_catalog.to_regclass('public.' || t.nombre) IS NOT NULL AS existe
       FROM unnest($1::text[]) AS t(nombre) ORDER BY t.nombre`,
    [[...TABLAS_005]],
  );
  const faltan = (rows as { nombre: string; existe: boolean }[]).filter((fila) => !fila.existe).map((f) => f.nombre);
  expect(faltan, 'Falta la funcionalidad de la 005a: la migración de las siete tablas no está aplicada').toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario: academias A y B, un plan y clases en cada una
// ---------------------------------------------------------------------------------------------------------------------

export interface EscenarioInscripcion extends Escenario {
  /** Plan de A: 3 veces por semana, 12 clases por mes, S/ 120.00; lunes, miércoles y viernes; 17:00, 18:00 y 19:00; los tres niveles. */
  plan: PlanDePrueba;
  /** Clases BASICO de A, aforo 20, a las 18:00. */
  lunes: ClaseDePrueba;
  miercoles: ClaseDePrueba;
  viernes: ClaseDePrueba;
  /** Otro lunes BASICO a las 17:00 (otra opción para el mismo día). */
  lunes17: ClaseDePrueba;
  /** Martes BASICO 18:00: día que el plan no permite. */
  martes: ClaseDePrueba;
  /** Lunes BASICO 08:00: franja que el plan no permite. */
  lunes08: ClaseDePrueba;
  /** Lunes INTERMEDIO 18:00: otro nivel. */
  intermedioLunes: ClaseDePrueba;
  /** Lo mismo en B: plan igual y clases BASICO lunes, miércoles y viernes 18:00. */
  planB: PlanDePrueba;
  lunesB: ClaseDePrueba;
  miercolesB: ClaseDePrueba;
  viernesB: ClaseDePrueba;
}

/** Vacía la base y crea A y B (`crearEscenario`) con su plan y sus clases. */
export async function crearEscenarioInscripcion(): Promise<EscenarioInscripcion> {
  const e = await crearEscenario();
  const columnasPlan = {
    nombre: 'Plan 3 por semana',
    veces_por_semana: 3,
    clases_por_mes: 12,
    precio: '120.00',
    dias_permitidos: [1, 3, 5],
    franjas_permitidas: ['17:00', '18:00', '19:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
  };
  const plan = await crearPlanDePrueba(e.A.id, columnasPlan);
  const planB = await crearPlanDePrueba(e.B.id, columnasPlan);
  const entrenador2 = await crearEntrenadorDePrueba(e.A.id);
  const entrenadorB = await crearEntrenadorDePrueba(e.B.id);
  const clase = (academiaId: string, entrenadorId: string, dia: number, hora: string, nivel = 'BASICO') =>
    crearClaseDePrueba(academiaId, entrenadorId, { nivel, dia_semana: dia, hora_inicio: hora, aforo: 20 });
  return {
    ...e,
    plan,
    planB,
    lunes: await clase(e.A.id, e.entrenadorA.id, 1, '18:00'),
    miercoles: await clase(e.A.id, e.entrenadorA.id, 3, '18:00'),
    viernes: await clase(e.A.id, e.entrenadorA.id, 5, '18:00'),
    lunes17: await clase(e.A.id, e.entrenadorA.id, 1, '17:00'),
    martes: await clase(e.A.id, e.entrenadorA.id, 2, '18:00'),
    lunes08: await clase(e.A.id, e.entrenadorA.id, 1, '08:00'),
    intermedioLunes: await clase(e.A.id, entrenador2.id, 1, '18:00', 'INTERMEDIO'),
    lunesB: await clase(e.B.id, entrenadorB.id, 1, '18:00'),
    miercolesB: await clase(e.B.id, entrenadorB.id, 3, '18:00'),
    viernesB: await clase(e.B.id, entrenadorB.id, 5, '18:00'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cuerpos del formulario
// ---------------------------------------------------------------------------------------------------------------------

/** Un objeto JSON cualquiera (lo que la prueba arma o recibe). */
export type Objeto = Record<string, unknown>;

/** Mezcla `sobre` en `base` (objetos con objetos; el resto, reemplaza). Un valor `undefined` quita la propiedad. */
export function variante(base: Objeto, sobre: Objeto): Objeto {
  const resultado: Objeto = { ...base };
  for (const [clave, valor] of Object.entries(sobre)) {
    const actual = resultado[clave];
    if (valor === undefined) {
      delete resultado[clave];
    } else if (esObjetoLlano(valor) && esObjetoLlano(actual)) {
      resultado[clave] = variante(actual, valor);
    } else {
      resultado[clave] = valor;
    }
  }
  return resultado;
}

function esObjetoLlano(valor: unknown): valor is Objeto {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

export interface OpcionesCuerpo {
  /** El plan (por defecto, el de A). */
  plan?: { id: string; clases_por_mes: number; precio: string };
  /** Las clases (por defecto, lunes, miércoles y viernes de A). */
  clases?: readonly { id: string; dia_semana: number; hora_inicio: string }[];
  /** El instante con el que se calcula el monto mostrado (por defecto, `AHORA_005`). */
  ahora?: Date;
  /** Cambios sobre el cuerpo (ver `variante`). */
  sobre?: Objeto;
}

/**
 * Un cuerpo válido de `enviarInscripcionSchema` para una persona mayor de edad (nacida en 1995), con un DNI inventado y el monto
 * mostrado calculado aquí. Sin correo, sin dirección y sin imagen.
 */
export async function cuerpoInscripcion(e: EscenarioInscripcion, opciones: OpcionesCuerpo = {}): Promise<Objeto> {
  const contratos = await cargarContratos();
  const plan = opciones.plan ?? e.plan;
  const clases = opciones.clases ?? [e.lunes, e.miercoles, e.viernes];
  const ahora = opciones.ahora ?? AHORA_005;
  const cotizacion = cotizacionEsperada(plan, clases, ahora);
  const base: Objeto = {
    claveIdempotencia: randomUUID(),
    alumno: {
      nombres: 'Camila',
      apellidos: 'Quispe Rojas',
      dni: dniInventado(),
      fechaNacimiento: '1995-05-20',
      telefono: '987654321',
      nivel: 'BASICO',
    },
    fichaMedica: {
      tipoSangre: contratos.TIPOS_SANGRE[0],
      contactoEmergencia: { nombre: 'Rosa Quispe', telefono: '912345678' },
    },
    inscripcion: {
      planId: plan.id,
      claseIds: clases.map((clase) => clase.id),
      mes: cotizacion.mes,
      montoMostrado: cotizacion.monto,
    },
    consentimientos: { version: contratos.VERSION_CONSENTIMIENTOS, datosPersonales: true, deslinde: true },
  };
  return opciones.sobre ? variante(base, opciones.sobre) : base;
}

/** El cuerpo de una persona menor de edad (nacida en 2014) con su apoderado. */
export async function cuerpoInscripcionMenor(e: EscenarioInscripcion, opciones: OpcionesCuerpo = {}): Promise<Objeto> {
  const contratos = await cargarContratos();
  return cuerpoInscripcion(e, {
    ...opciones,
    sobre: variante(
      {
        alumno: { nombres: 'Mateo', apellidos: 'Quispe Rojas', fechaNacimiento: '2014-03-10' },
        apoderado: {
          nombres: 'Rosa',
          apellidos: 'Rojas Vega',
          dni: dniInventado(),
          telefono: '955123456',
          parentesco: contratos.PARENTESCOS[0],
        },
      },
      opciones.sobre ?? {},
    ),
  });
}

/** El cuerpo de la cotización (`cotizarInscripcionSchema`). */
export function cuerpoCotizacion(
  e: EscenarioInscripcion,
  opciones: { planId?: string; nivel?: string; claseIds?: string[] } = {},
): Objeto {
  return {
    planId: opciones.planId ?? e.plan.id,
    nivel: opciones.nivel ?? 'BASICO',
    claseIds: opciones.claseIds ?? [e.lunes.id, e.miercoles.id, e.viernes.id],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Aplicación de pruebas, cliente HTTP y registro de correos
// ---------------------------------------------------------------------------------------------------------------------

/** Almacén de límites de `@nestjs/throttler` que nunca bloquea: para pruebas que envían muchas veces desde la misma IP. */
const almacenSinLimites = {
  increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

export interface MensajeDeCorreo {
  academiaId: string;
  para: string;
  plantilla: string;
  datos: Record<string, string>;
}

/** `EnviadorCorreo` de prueba: registra cada mensaje; con `fallar` rechaza después de registrarlo. */
export class EnviadorDePrueba {
  readonly mensajes: MensajeDeCorreo[] = [];
  fallar = false;
  /** Se ejecuta al recibir cada mensaje (por ejemplo, para mirar la base en ese instante). */
  alEnviar?: (mensaje: MensajeDeCorreo) => Promise<void>;
  async enviar(mensaje: MensajeDeCorreo): Promise<void> {
    this.mensajes.push(mensaje);
    if (this.alEnviar) await this.alEnviar(mensaje);
    if (this.fallar) throw new Error('El proveedor de correo falló (prueba).');
  }
}

export interface RespuestaApi {
  status: number;
  /** El cuerpo JSON ya leído (o `null` si no hay o no es JSON). */
  body: Objeto | null;
  texto: string;
  headers: Headers;
  cacheControl: string | null;
}

export interface OpcionesPeticion {
  cookie?: string;
  headers?: Record<string, string>;
  /** Texto enviado tal cual como cuerpo (para JSON roto); con `content-type: application/json`. */
  crudo?: string;
}

/** Cliente HTTP sobre la aplicación escuchando en un puerto efímero (las peticiones se pueden lanzar sin esperarlas). */
export interface ClienteInscripciones {
  get(ruta: string, opciones?: OpcionesPeticion): Promise<RespuestaApi>;
  post(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion): Promise<RespuestaApi>;
  patch(ruta: string, cookie: string, cuerpo?: unknown): Promise<RespuestaApi>;
  cerrar(): Promise<void>;
}

function leerJson(texto: string): Objeto | null {
  if (!texto) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return esObjetoLlano(valor) ? valor : null;
  } catch {
    return null;
  }
}

async function crearCliente(app: NestExpressApplication, error?: Error): Promise<ClienteInscripciones> {
  const escuchando = await escucharAplicacion(app);
  const direccion = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${direccion.port}`;

  async function enviar(
    metodo: string,
    ruta: string,
    cuerpo: unknown,
    opciones: OpcionesPeticion = {},
  ): Promise<RespuestaApi> {
    // Si faltó algo de producción al armar la app (el módulo del correo), cada petición de cada prueba falla por sí misma.
    if (error) throw error;
    const headers: Record<string, string> = { ...opciones.headers };
    if (opciones.cookie) headers['cookie'] = opciones.cookie;
    let body: string | undefined;
    if (opciones.crudo !== undefined) {
      body = opciones.crudo;
      headers['content-type'] = 'application/json';
    } else if (cuerpo !== undefined) {
      body = JSON.stringify(cuerpo);
      headers['content-type'] = 'application/json';
    }
    const respuesta = await fetch(`${base}${ruta}`, { method: metodo, headers, body });
    const texto = await respuesta.text();
    return {
      status: respuesta.status,
      body: leerJson(texto),
      texto,
      headers: respuesta.headers,
      cacheControl: respuesta.headers.get('cache-control'),
    };
  }

  return {
    get: (ruta, opciones) => enviar('GET', ruta, undefined, opciones),
    post: (ruta, cuerpo, opciones) => enviar('POST', ruta, cuerpo, opciones),
    patch: (ruta, cookie, cuerpo) => enviar('PATCH', ruta, cuerpo, { cookie }),
    cerrar: () => escuchando.cerrar(),
  };
}

export interface OpcionesAppInscripciones {
  ahora?: Date;
  /** `true`: el almacén real de límites por IP (las pruebas del criterio 33). Por defecto, un almacén que nunca bloquea. */
  conLimites?: boolean;
  /** Un enviador de correo de prueba que reemplaza al simulado (necesita el token `ENVIADOR_CORREO` de `infraestructura/correo`). */
  correo?: EnviadorDePrueba;
  /**
   * Un `AlmacenArchivos` que reemplaza al de la API (005b; necesita el token `ALMACEN_ARCHIVOS` de `infraestructura/almacen-archivos`):
   * un `AlmacenArchivosDisco` sobre un directorio temporal o uno de prueba que falla. Sin esta opción, la aplicación usa el suyo.
   */
  almacen?: object;
  nivelRegistro?: string;
  destinoRegistro?: DestinationStream;
}

export interface AppInscripciones {
  app: NestExpressApplication;
  reloj: RelojFijo;
  http: ClienteInscripciones;
}

/**
 * La aplicación completa con `RELOJ` fijo, escuchando en un puerto efímero. Cada aplicación tiene sus propios contadores de límites
 * por IP; por defecto se reemplazan por un almacén sin tope.
 */
export async function crearAppInscripciones(opciones: OpcionesAppInscripciones = {}): Promise<AppInscripciones> {
  let token: symbol | undefined;
  let tokenAlmacen: symbol | undefined;
  let errorDeCorreo: Error | undefined;
  if (opciones.almacen) {
    // Igual que con el correo: si falta el módulo de la 005b, cada petición de cada prueba falla con este error.
    try {
      const modulo = await cargarFuncionalidad005<{ ALMACEN_ARCHIVOS: symbol }>(
        'infraestructura/almacen-archivos/index.ts',
        ['ALMACEN_ARCHIVOS'],
      );
      tokenAlmacen = modulo.ALMACEN_ARCHIVOS;
    } catch (error) {
      errorDeCorreo = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (opciones.correo) {
    // No se lanza aquí (rompería el `beforeAll` y dejaría las pruebas omitidas): cada petición de cada prueba falla con este error.
    try {
      const correo = await cargarFuncionalidad005<{ ENVIADOR_CORREO: symbol }>('infraestructura/correo/index.ts', [
        'ENVIADOR_CORREO',
      ]);
      token = correo.ENVIADOR_CORREO;
    } catch (error) {
      errorDeCorreo = error instanceof Error ? error : new Error(String(error));
    }
  }
  const { app, reloj } = await crearAppConReloj(opciones.ahora ?? AHORA_005, {
    nivelRegistro: opciones.nivelRegistro ?? 'silent',
    destinoRegistro: opciones.destinoRegistro,
    ajustar: (constructor) => {
      let ajustado = constructor;
      if (!opciones.conLimites) ajustado = ajustado.overrideProvider(ThrottlerStorage).useValue(almacenSinLimites);
      if (opciones.correo && token) ajustado = ajustado.overrideProvider(token).useValue(opciones.correo);
      if (opciones.almacen && tokenAlmacen)
        ajustado = ajustado.overrideProvider(tokenAlmacen).useValue(opciones.almacen);
      return ajustado;
    },
  });
  return { app, reloj, http: await crearCliente(app, errorDeCorreo) };
}

/** `/api/a/{nombreCorto}{sufijo}`. */
export const rutaPublica = (nombreCorto: string, sufijo = ''): string => `/api/a/${nombreCorto}${sufijo}`;

export function codigoDe(respuesta: { body: Objeto | null }): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

/** Los campos de `detalles.errores` de una respuesta 400. */
export function camposConError(respuesta: { body: Objeto | null }): string[] {
  const detalles = respuesta.body?.['detalles'];
  const errores = esObjetoLlano(detalles) ? detalles['errores'] : undefined;
  return Array.isArray(errores) ? errores.map((error) => String((error as { campo?: unknown }).campo)) : [];
}

export function detallesDe(respuesta: { body: Objeto | null }): Objeto {
  const detalles = respuesta.body?.['detalles'];
  return esObjetoLlano(detalles) ? detalles : {};
}

/** El cuerpo de una respuesta como texto estable (para comparar "el mismo cuerpo"). */
export function cuerpoComoTexto(respuesta: { texto: string }): string {
  return respuesta.texto;
}

/** `solicitud` de una respuesta 201 (`RespuestaInscripcionCreada`). */
export interface SolicitudCreada {
  codigo: string;
  token: string;
  enlace: string;
  estado: string;
  reservaVenceEn: string;
  cotizacion: Objeto;
}
export function solicitudDe(respuesta: { body: Objeto | null; status: number }): SolicitudCreada {
  const solicitud = respuesta.body?.['solicitud'];
  if (!esObjetoLlano(solicitud)) {
    throw new Error(`La respuesta (HTTP ${respuesta.status}) no trae una solicitud: ${JSON.stringify(respuesta.body)}`);
  }
  return solicitud as unknown as SolicitudCreada;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas con el dueño (filtran por academia_id)
// ---------------------------------------------------------------------------------------------------------------------

export interface FilaAlumno {
  id: string;
  academia_id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  telefono: string;
  correo: string | null;
  direccion: string | null;
  grado_colegio: string | null;
  nivel: string;
  foto_clave: string | null;
  estado: string;
  usuario_id: string | null;
  creado_en: Date;
  actualizado_en: Date;
}
export interface FilaApoderado {
  alumno_id: string;
  academia_id: string;
  nombres: string;
  apellidos: string;
  dni: string;
  telefono: string;
  parentesco: string;
  correo: string | null;
}
export interface FilaFicha {
  alumno_id: string;
  academia_id: string;
  tipo_sangre: string;
  enfermedades: string | null;
  alergias: string | null;
  medicamentos: string | null;
  seguro: string | null;
  contacto_emergencia_nombre: string;
  contacto_emergencia_telefono: string;
}
export interface FilaConsentimiento {
  id: string;
  academia_id: string;
  alumno_id: string;
  solicitud_id: string;
  tipo: string;
  version: string;
  aceptado_en: Date;
  ip: string | null;
  otorgado_por: string;
  aceptado: boolean;
}
export interface FilaSolicitud {
  id: string;
  academia_id: string;
  alumno_id: string;
  codigo: string;
  token_hash: Buffer;
  clave_idempotencia: string;
  estado: string;
  ip_origen: string | null;
  creado_en: Date;
  actualizado_en: Date;
}
export interface FilaMatricula {
  id: string;
  academia_id: string;
  alumno_id: string;
  plan_id: string;
  solicitud_id: string | null;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  clases_totales: number;
  clases_usadas: number;
  es_proporcional: boolean;
  precio_plan: string;
  clases_por_mes_plan: number;
  monto_calculado: string;
  monto_ajustado: string | null;
  motivo_ajuste: string | null;
  estado: string;
  reserva_vence_en: Date | null;
  creado_en: Date;
  actualizado_en: Date;
}
export interface FilaMatriculaClase {
  academia_id: string;
  matricula_id: string;
  clase_id: string;
}

const PROYECCION: Record<Tabla005, { columnas: string; orden: string }> = {
  alumnos: {
    columnas: `id, academia_id, dni, nombres, apellidos, to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento, telefono,
      correo, direccion, grado_colegio::text AS grado_colegio, nivel::text AS nivel, foto_clave, estado::text AS estado, usuario_id,
      creado_en, actualizado_en`,
    orden: 'dni, id',
  },
  apoderados: {
    columnas: `alumno_id, academia_id, nombres, apellidos, dni, telefono, parentesco::text AS parentesco, correo`,
    orden: 'alumno_id',
  },
  fichas_medicas: {
    columnas: `alumno_id, academia_id, tipo_sangre::text AS tipo_sangre, enfermedades, alergias, medicamentos, seguro,
      contacto_emergencia_nombre, contacto_emergencia_telefono`,
    orden: 'alumno_id',
  },
  consentimientos: {
    columnas: `id, academia_id, alumno_id, solicitud_id, tipo::text AS tipo, version, aceptado_en, host(ip) AS ip,
      otorgado_por::text AS otorgado_por, aceptado`,
    orden: 'tipo, id',
  },
  solicitudes_inscripcion: {
    columnas: `id, academia_id, alumno_id, codigo, token_hash, clave_idempotencia, estado::text AS estado,
      host(ip_origen) AS ip_origen, creado_en, actualizado_en`,
    orden: 'creado_en, id',
  },
  matriculas: {
    columnas: `id, academia_id, alumno_id, plan_id, solicitud_id, anio::int AS anio, mes::int AS mes,
      to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
      clases_totales::int AS clases_totales, clases_usadas::int AS clases_usadas, es_proporcional, precio_plan::text AS precio_plan,
      clases_por_mes_plan::int AS clases_por_mes_plan, monto_calculado::text AS monto_calculado,
      monto_ajustado::text AS monto_ajustado, motivo_ajuste, estado::text AS estado, reserva_vence_en, creado_en, actualizado_en`,
    orden: 'creado_en, id',
  },
  matricula_clases: { columnas: 'academia_id, matricula_id, clase_id', orden: 'matricula_id, clase_id' },
};

async function leerTabla<T>(tabla: Tabla005, academiaId: string): Promise<T[]> {
  const { columnas, orden } = PROYECCION[tabla];
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT ${columnas} FROM ${tabla} WHERE academia_id = $1::uuid ORDER BY ${orden}`,
    [academiaId],
    { academiaId },
  );
  return rows as T[];
}

export const leerAlumnos = (academiaId: string) => leerTabla<FilaAlumno>('alumnos', academiaId);
export const leerApoderados = (academiaId: string) => leerTabla<FilaApoderado>('apoderados', academiaId);
export const leerFichas = (academiaId: string) => leerTabla<FilaFicha>('fichas_medicas', academiaId);
export const leerConsentimientos = (academiaId: string) => leerTabla<FilaConsentimiento>('consentimientos', academiaId);
export const leerSolicitudes = (academiaId: string) => leerTabla<FilaSolicitud>('solicitudes_inscripcion', academiaId);
export const leerMatriculas = (academiaId: string) => leerTabla<FilaMatricula>('matriculas', academiaId);
export const leerMatriculaClases = (academiaId: string) =>
  leerTabla<FilaMatriculaClase>('matricula_clases', academiaId);

export async function leerAlumnoPorDni(academiaId: string, dni: string): Promise<FilaAlumno | undefined> {
  return (await leerAlumnos(academiaId)).find((fila) => fila.dni === dni);
}

/** Instantánea de las siete tablas de una academia, para comprobar que una operación rechazada no escribió nada. */
export async function instantaneaDeInscripciones(academiaId: string): Promise<string> {
  const partes: Record<string, unknown> = {};
  for (const tabla of TABLAS_005) partes[tabla] = await leerTabla<unknown>(tabla, academiaId);
  return JSON.stringify(partes, (_clave, valor: unknown) =>
    typeof valor === 'object' && valor !== null && (valor as { type?: string }).type === 'Buffer'
      ? Buffer.from((valor as { data: number[] }).data).toString('hex')
      : valor,
  );
}

/** Cuántas filas tienen las siete tablas de una academia. */
export async function contarFilasDeInscripciones(academiaId: string): Promise<Record<Tabla005, number>> {
  const resultado = {} as Record<Tabla005, number>;
  for (const tabla of TABLAS_005) {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT count(*)::int AS n FROM ${tabla} WHERE academia_id = $1::uuid`,
      [academiaId],
      { academiaId },
    );
    resultado[tabla] = (rows[0] as { n: number }).n;
  }
  return resultado;
}

/**
 * Ocupación de una clase en un mes (spec, "Definiciones"): matrículas del mes `VIGENTE`, o `RESERVADA` con vencimiento nulo o
 * posterior a `ahora`. Escrita aquí, independiente de `contarOcupacion`.
 */
export async function ocupacionDeClase(
  academiaId: string,
  claseId: string,
  mes: { anio: number; mes: number },
  ahora: Date,
): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT count(*)::int AS n
       FROM matricula_clases mc JOIN matriculas m ON m.academia_id = mc.academia_id AND m.id = mc.matricula_id
      WHERE mc.academia_id = $1::uuid AND mc.clase_id = $2::uuid AND m.anio = $3 AND m.mes = $4
        AND (m.estado = 'VIGENTE' OR (m.estado = 'RESERVADA' AND (m.reserva_vence_en IS NULL OR m.reserva_vence_en > $5::timestamptz)))`,
    [academiaId, claseId, mes.anio, mes.mes, ahora],
    { academiaId },
  );
  return (rows[0] as { n: number }).n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Escritura directa de filas (como dueño o como app), también inválidas
// ---------------------------------------------------------------------------------------------------------------------

const TIPO_DE_COLUMNA: Readonly<Record<string, string>> = {
  id: 'uuid',
  academia_id: 'uuid',
  alumno_id: 'uuid',
  solicitud_id: 'uuid',
  plan_id: 'uuid',
  matricula_id: 'uuid',
  clase_id: 'uuid',
  usuario_id: 'uuid',
  registrada_por: 'uuid',
  clave_idempotencia: 'uuid',
  dni: 'text',
  nombres: 'text',
  apellidos: 'text',
  telefono: 'text',
  correo: 'text',
  direccion: 'text',
  foto_clave: 'text',
  fecha_nacimiento: 'date',
  nivel: 'nivel_natacion',
  grado_colegio: 'grado_colegio',
  parentesco: 'parentesco',
  tipo_sangre: 'tipo_sangre',
  enfermedades: 'text',
  alergias: 'text',
  medicamentos: 'text',
  seguro: 'text',
  contacto_emergencia_nombre: 'text',
  contacto_emergencia_telefono: 'text',
  tipo: 'tipo_consentimiento',
  version: 'text',
  aceptado_en: 'timestamptz',
  ip: 'inet',
  otorgado_por: 'otorgante_consentimiento',
  aceptado: 'boolean',
  codigo: 'text',
  token_hash: 'bytea',
  ip_origen: 'inet',
  anio: 'smallint',
  mes: 'smallint',
  fecha_inicio: 'date',
  fecha_fin: 'date',
  clases_totales: 'smallint',
  clases_usadas: 'smallint',
  es_proporcional: 'boolean',
  precio_plan: 'numeric',
  clases_por_mes_plan: 'smallint',
  monto_calculado: 'numeric',
  monto_ajustado: 'numeric',
  motivo_ajuste: 'text',
  reserva_vence_en: 'timestamptz',
  creado_en: 'timestamptz',
  actualizado_en: 'timestamptz',
};

const TIPO_DEL_ESTADO: Readonly<Record<string, string>> = {
  alumnos: 'estado_alumno',
  solicitudes_inscripcion: 'estado_solicitud',
  matriculas: 'estado_matricula',
};

function tipoDe(tabla: string, columna: string): string {
  if (columna === 'estado') {
    const tipo = TIPO_DEL_ESTADO[tabla];
    if (tipo) return tipo;
  }
  const tipo = TIPO_DE_COLUMNA[columna];
  if (tipo === undefined) throw new Error(`Columna desconocida en la utilidad de pruebas: ${tabla}.${columna}`);
  return tipo;
}

/** Cualquier valor, también inválido, para cada columna. */
export type Libre = Record<string, unknown>;

/** Opciones de las escrituras directas: el contexto de la transacción (por defecto, el de la academia de la fila). */
export interface OpcionesDeEscritura {
  contexto?: Contexto;
}

function contextoDe(academiaId: string, opciones: OpcionesDeEscritura): Contexto | undefined {
  return 'contexto' in opciones ? opciones.contexto : { academiaId };
}

/** `INSERT` directo con los nombres de columna de la base; el error de PostgreSQL (con su `code`) se propaga tal cual. */
export async function insertarFila(
  rol: RolPruebas,
  tabla: Tabla005,
  academiaId: string,
  columnas: Libre,
  opciones: OpcionesDeEscritura = {},
): Promise<void> {
  const todas: Libre = { academia_id: academiaId, ...columnas };
  const nombres = Object.keys(todas);
  const marcas = nombres.map((nombre, i) => `$${i + 1}::${tipoDe(tabla, nombre)}`);
  await ejecutarComo(
    rol,
    `INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (${marcas.join(', ')})`,
    Object.values(todas),
    contextoDe(academiaId, opciones),
  );
}

/** `UPDATE` directo de las filas que cumplen `donde` (columna → valor); devuelve las filas afectadas. */
export async function actualizarFilas(
  rol: RolPruebas,
  tabla: Tabla005,
  academiaId: string,
  donde: Libre,
  cambios: Libre,
  opciones: OpcionesDeEscritura = {},
): Promise<number> {
  const columnas = Object.keys(cambios);
  const condiciones = Object.keys(donde);
  const asignaciones = columnas.map((columna, i) => `${columna} = $${i + 1}::${tipoDe(tabla, columna)}`);
  const filtros = condiciones.map(
    (columna, i) => `${columna} = $${columnas.length + i + 1}::${tipoDe(tabla, columna)}`,
  );
  const resultado = await ejecutarComo(
    rol,
    `UPDATE ${tabla} SET ${asignaciones.join(', ')} WHERE ${filtros.join(' AND ')}`,
    [...Object.values(cambios), ...Object.values(donde)],
    contextoDe(academiaId, opciones),
  );
  return resultado.rowCount ?? 0;
}

const hace = (ms: number, desde: Date = AHORA_005): Date => new Date(desde.getTime() - ms);

/** Valores válidos de cada tabla (para las pruebas de `CHECK`: se cambia una columna y se espera el rechazo). */
export async function filaValida(tabla: Tabla005, padres: Partial<PadresDeFila>): Promise<Libre> {
  const ahora = AHORA_005;
  switch (tabla) {
    case 'alumnos':
      return {
        id: randomUUID(),
        dni: dniInventado(),
        nombres: 'Alumno',
        apellidos: 'De Prueba',
        fecha_nacimiento: '2000-01-15',
        telefono: '987654321',
        nivel: 'BASICO',
        estado: 'CLIENTE',
        creado_en: ahora,
        actualizado_en: ahora,
      };
    case 'apoderados':
      return {
        alumno_id: padres.alumnoId,
        nombres: 'Apoderado',
        apellidos: 'De Prueba',
        dni: dniInventado(),
        telefono: '955123456',
        parentesco: (await etiquetasDelTipo('parentesco'))[0],
        creado_en: ahora,
        actualizado_en: ahora,
      };
    case 'fichas_medicas':
      return {
        alumno_id: padres.alumnoId,
        tipo_sangre: (await etiquetasDelTipo('tipo_sangre'))[0],
        contacto_emergencia_nombre: 'Contacto',
        contacto_emergencia_telefono: '912345678',
        creado_en: ahora,
        actualizado_en: ahora,
      };
    case 'consentimientos':
      return {
        id: randomUUID(),
        alumno_id: padres.alumnoId,
        solicitud_id: padres.solicitudId,
        tipo: 'DATOS_PERSONALES',
        version: 'v1-prueba',
        aceptado_en: ahora,
        ip: '203.0.113.7',
        otorgado_por: 'TITULAR',
        aceptado: true,
      };
    case 'solicitudes_inscripcion':
      return {
        id: randomUUID(),
        alumno_id: padres.alumnoId,
        codigo: codigoAleatorio(),
        token_hash: sha256(tokenAleatorio()),
        clave_idempotencia: randomUUID(),
        estado: 'PENDIENTE_PAGO',
        ip_origen: '203.0.113.7',
        creado_en: ahora,
        actualizado_en: ahora,
      };
    case 'matriculas':
      return {
        id: randomUUID(),
        alumno_id: padres.alumnoId,
        plan_id: padres.planId,
        solicitud_id: null,
        anio: 2026,
        mes: 11,
        fecha_inicio: '2026-11-11',
        fecha_fin: '2026-11-30',
        clases_totales: 10,
        clases_usadas: 0,
        es_proporcional: true,
        precio_plan: '120.00',
        clases_por_mes_plan: 12,
        monto_calculado: '100.00',
        estado: 'RESERVADA',
        // Sin solicitud no hay reserva de 24 horas (010a, criterio 1): una `RESERVADA` sin vencimiento es un pago en verificación.
        reserva_vence_en: null,
        creado_en: ahora,
        actualizado_en: ahora,
      };
    case 'matricula_clases':
      return { matricula_id: padres.matriculaId, clase_id: padres.claseId };
  }
}

export interface PadresDeFila {
  alumnoId: string;
  solicitudId: string;
  planId: string;
  matriculaId: string;
  claseId: string;
}

/** Inserta un alumno válido (como dueño) y devuelve su id. */
export async function crearAlumnoSolo(academiaId: string, columnas: Libre = {}): Promise<string> {
  const fila = { ...(await filaValida('alumnos', {})), ...columnas };
  await insertarFila('propietario', 'alumnos', academiaId, fila);
  return fila['id'] as string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Clientes, solicitudes y matrículas sembrados (también VENCIDA y CANCELADA: la cancelación por API es de la 005b)
// ---------------------------------------------------------------------------------------------------------------------

export type EstadoSembrado =
  /** Solicitud `PENDIENTE_PAGO` con su reserva vigente (la matrícula ocupa cupo). */
  | 'PENDIENTE_PAGO'
  /** `PENDIENTE_PAGO` con la reserva ya vencida (la fila aún no lo dice): se muestra `VENCIDA`. */
  | 'PENDIENTE_PAGO_VENCIDA'
  /** Solicitud `VENCIDA` y matrícula `CANCELADA`. */
  | 'VENCIDA'
  /** Solicitud `CANCELADA` y matrícula `CANCELADA`. */
  | 'CANCELADA';

export interface OpcionesSembrado {
  planId: string;
  claseIds: readonly string[];
  estado?: EstadoSembrado;
  /** DNI del alumno (por defecto, uno inventado). */
  dni?: string;
  nombres?: string;
  apellidos?: string;
  fechaNacimiento?: string;
  nivel?: string;
  /** Estado del alumno (por defecto `CLIENTE`). */
  estadoAlumno?: string;
  /** Con apoderado (la persona es menor de edad). */
  conApoderado?: boolean;
  /** El "ahora" con el que se arman las fechas (por defecto, `AHORA_005`). */
  ahora?: Date;
  /** Vencimiento de la reserva de `PENDIENTE_PAGO`; `null` = sin vencimiento (pago en verificación). Por defecto, ahora + 24 horas. */
  reservaVenceEn?: Date | null;
  ipOrigen?: string | null;
  codigo?: string;
  token?: string;
  claveIdempotencia?: string;
  /** Mes de la matrícula (por defecto, el de `ahora` en Lima). */
  mes?: { anio: number; mes: number };
  clasesTotales?: number;
  clasesPorMesPlan?: number;
  precioPlan?: string;
  monto?: string;
  creadaEn?: Date;
}

export interface SolicitudSembrada {
  alumnoId: string;
  dni: string;
  solicitudId: string;
  matriculaId: string;
  codigo: string;
  token: string;
  claveIdempotencia: string;
}

/** Siembra, como dueño, un alumno con su ficha, su solicitud, su matrícula con sus clases y los consentimientos obligatorios. */
export async function sembrarSolicitud(academiaId: string, opciones: OpcionesSembrado): Promise<SolicitudSembrada> {
  const ahora = opciones.ahora ?? AHORA_005;
  const estado = opciones.estado ?? 'PENDIENTE_PAGO';
  const hoy = fechaEnLima(ahora);
  const mes = opciones.mes ?? { anio: hoy.anio, mes: hoy.mes };
  const ultimo = new Date(Date.UTC(mes.anio, mes.mes, 0)).getUTCDate();
  const dos = (n: number) => String(n).padStart(2, '0');
  const alumnoId = randomUUID();
  const solicitudId = randomUUID();
  const matriculaId = randomUUID();
  const dni = opciones.dni ?? dniInventado();
  const codigo = opciones.codigo ?? codigoAleatorio();
  const token = opciones.token ?? tokenAleatorio();
  const claveIdempotencia = opciones.claveIdempotencia ?? randomUUID();
  const creada = opciones.creadaEn ?? ahora;

  await insertarFila('propietario', 'alumnos', academiaId, await filaDeAlumno(alumnoId, dni, opciones, creada));
  await insertarFila('propietario', 'fichas_medicas', academiaId, await filaValida('fichas_medicas', { alumnoId }));
  if (opciones.conApoderado) {
    await insertarFila('propietario', 'apoderados', academiaId, await filaValida('apoderados', { alumnoId }));
  }
  const estadoSolicitud = estado === 'VENCIDA' ? 'VENCIDA' : estado === 'CANCELADA' ? 'CANCELADA' : 'PENDIENTE_PAGO';
  await insertarFila('propietario', 'solicitudes_inscripcion', academiaId, {
    id: solicitudId,
    alumno_id: alumnoId,
    codigo,
    token_hash: sha256(token),
    clave_idempotencia: claveIdempotencia,
    estado: estadoSolicitud,
    ip_origen: opciones.ipOrigen === undefined ? '198.51.100.9' : opciones.ipOrigen,
    creado_en: creada,
    actualizado_en: creada,
  });
  const reservada = estado === 'PENDIENTE_PAGO' || estado === 'PENDIENTE_PAGO_VENCIDA';
  let vence: Date | null = null;
  if (reservada) {
    vence =
      estado === 'PENDIENTE_PAGO_VENCIDA'
        ? hace(60 * 60 * 1000, ahora)
        : opciones.reservaVenceEn === undefined
          ? new Date(ahora.getTime() + VEINTICUATRO_HORAS)
          : opciones.reservaVenceEn;
  }
  await insertarFila('propietario', 'matriculas', academiaId, {
    id: matriculaId,
    alumno_id: alumnoId,
    plan_id: opciones.planId,
    solicitud_id: solicitudId,
    anio: mes.anio,
    mes: mes.mes,
    fecha_inicio: `${mes.anio}-${dos(mes.mes)}-01`,
    fecha_fin: `${mes.anio}-${dos(mes.mes)}-${dos(ultimo)}`,
    clases_totales: opciones.clasesTotales ?? 12,
    clases_usadas: 0,
    es_proporcional: (opciones.clasesTotales ?? 12) < (opciones.clasesPorMesPlan ?? 12),
    precio_plan: opciones.precioPlan ?? '120.00',
    clases_por_mes_plan: opciones.clasesPorMesPlan ?? 12,
    monto_calculado: opciones.monto ?? '120.00',
    estado: reservada ? 'RESERVADA' : 'CANCELADA',
    reserva_vence_en: vence,
    creado_en: creada,
    actualizado_en: creada,
  });
  for (const claseId of opciones.claseIds) {
    await insertarFila('propietario', 'matricula_clases', academiaId, { matricula_id: matriculaId, clase_id: claseId });
  }
  for (const tipo of ['DATOS_PERSONALES', 'DESLINDE']) {
    await insertarFila('propietario', 'consentimientos', academiaId, {
      ...(await filaValida('consentimientos', { alumnoId, solicitudId })),
      tipo,
    });
  }
  return { alumnoId, dni, solicitudId, matriculaId, codigo, token, claveIdempotencia };
}

async function filaDeAlumno(alumnoId: string, dni: string, opciones: OpcionesSembrado, creada: Date): Promise<Libre> {
  return {
    ...(await filaValida('alumnos', {})),
    id: alumnoId,
    dni,
    nombres: opciones.nombres ?? 'Valeria',
    apellidos: opciones.apellidos ?? 'Mendoza Salas',
    fecha_nacimiento: opciones.fechaNacimiento ?? (opciones.conApoderado ? '2014-03-10' : '1995-05-20'),
    nivel: opciones.nivel ?? 'BASICO',
    estado: opciones.estadoAlumno ?? 'CLIENTE',
    creado_en: creada,
    actualizado_en: creada,
  };
}

/** El SQL (y sus parámetros) que llena una clase con `cantidad` alumnos y matrículas del mes, para correrlo con cualquier conexión. */
export function sqlLlenarClase(
  academiaId: string,
  claseId: string,
  planId: string,
  dnis: readonly string[],
  opciones: {
    mes: { anio: number; mes: number };
    estado?: 'VIGENTE' | 'RESERVADA';
    reservaVenceEn?: Date | null;
  },
): { sql: string; parametros: unknown[] } {
  const dos = (n: number) => String(n).padStart(2, '0');
  const ultimo = new Date(Date.UTC(opciones.mes.anio, opciones.mes.mes, 0)).getUTCDate();
  const estado = opciones.estado ?? 'VIGENTE';
  const conReserva =
    estado === 'RESERVADA' && opciones.reservaVenceEn !== null && opciones.reservaVenceEn !== undefined;
  const comunes = [
    academiaId,
    [...dnis],
    planId,
    opciones.mes.anio,
    opciones.mes.mes,
    `${opciones.mes.anio}-${dos(opciones.mes.mes)}-01`,
    `${opciones.mes.anio}-${dos(opciones.mes.mes)}-${dos(ultimo)}`,
    estado,
  ];
  if (!conReserva) {
    return {
      sql: `WITH a AS (
            INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
            SELECT gen_random_uuid(), $1::uuid, d, 'Relleno', 'Para el aforo', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion,
                   'CLIENTE'::estado_alumno, now(), now()
              FROM unnest($2::text[]) AS d
            RETURNING id),
          m AS (
            INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, anio, mes, fecha_inicio, fecha_fin, clases_totales, clases_usadas,
                                    es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado, reserva_vence_en,
                                    creado_en, actualizado_en)
            SELECT gen_random_uuid(), $1::uuid, a.id, $3::uuid, $4::smallint, $5::smallint, $6::date, $7::date, 12, 0,
                   false, 120.00, 12, 120.00, $8::estado_matricula, NULL, now(), now()
              FROM a
            RETURNING id)
          INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
          SELECT $1::uuid, m.id, $9::uuid FROM m`,
      parametros: [...comunes, claseId],
    };
  }
  // 010a: una matrícula `RESERVADA` con vencimiento solo existe con su solicitud (`matriculas_renovacion_sin_vencimiento`): se siembra una por cada una.
  const codigos = dnis.map(() => codigoAleatorio());
  const hashes = dnis.map(() => sha256(tokenAleatorio()).toString('hex'));
  return {
    sql: `WITH f AS (
            SELECT gen_random_uuid() AS alumno_id, gen_random_uuid() AS solicitud_id, d.dni, d.codigo, d.hash
              FROM unnest($2::text[], $10::text[], $11::text[]) AS d(dni, codigo, hash)),
          a AS (
            INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en, actualizado_en)
            SELECT f.alumno_id, $1::uuid, f.dni, 'Relleno', 'Para el aforo', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion,
                   'CLIENTE'::estado_alumno, now(), now()
              FROM f
            RETURNING id),
          s AS (
            INSERT INTO solicitudes_inscripcion (id, academia_id, alumno_id, codigo, token_hash, clave_idempotencia, estado, ip_origen,
                                                 creado_en, actualizado_en)
            SELECT f.solicitud_id, $1::uuid, f.alumno_id, f.codigo, decode(f.hash, 'hex'), gen_random_uuid(),
                   'PENDIENTE_PAGO'::estado_solicitud, '198.51.100.9'::inet, now(), now()
              FROM f
            RETURNING id),
          m AS (
            INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, solicitud_id, anio, mes, fecha_inicio, fecha_fin, clases_totales,
                                    clases_usadas, es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado,
                                    reserva_vence_en, creado_en, actualizado_en)
            SELECT gen_random_uuid(), $1::uuid, f.alumno_id, $3::uuid, f.solicitud_id, $4::smallint, $5::smallint, $6::date, $7::date,
                   12, 0, false, 120.00, 12, 120.00, $8::estado_matricula, $12::timestamptz, now(), now()
              FROM f
            RETURNING id)
          INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
          SELECT $1::uuid, m.id, $9::uuid FROM m`,
    parametros: [...comunes, claseId, codigos, hashes, opciones.reservaVenceEn],
  };
}

/** Llena una clase con `cantidad` matrículas (alumnos distintos) del mes, como dueño. */
export async function llenarClase(
  academiaId: string,
  claseId: string,
  planId: string,
  cantidad: number,
  opciones: {
    ahora?: Date;
    mes?: { anio: number; mes: number };
    estado?: 'VIGENTE' | 'RESERVADA';
    reservaVenceEn?: Date | null;
  } = {},
): Promise<void> {
  if (cantidad <= 0) return;
  const hoy = fechaEnLima(opciones.ahora ?? AHORA_005);
  const dnis = Array.from({ length: cantidad }, () => dniInventado());
  const { sql, parametros } = sqlLlenarClase(academiaId, claseId, planId, dnis, {
    mes: opciones.mes ?? { anio: hoy.anio, mes: hoy.mes },
    estado: opciones.estado,
    reservaVenceEn: opciones.reservaVenceEn,
  });
  await ejecutarComo('propietario', sql, parametros, { academiaId });
}

// ---------------------------------------------------------------------------------------------------------------------
// Retenciones para las carreras deterministas (sin tiempos ni esperas fijas)
// ---------------------------------------------------------------------------------------------------------------------

export interface ResultadoDeRetencion<T> {
  resultados: T[];
  /** `true` si todas las peticiones quedaron esperando (directa o transitivamente) lo que retuvo la prueba. */
  todasEsperaron: boolean;
}

/**
 * Abre una transacción propia (rol dueño, contexto de la academia), ejecuta `retener` (que bloquea filas con `FOR UPDATE` o escribe
 * sin confirmar), envía las peticiones de `enviar` sin esperarlas, espera (con `pg_blocking_pids`, sin esperas fijas) a que todas
 * queden esperando o a que alguna responda, y entonces confirma (`COMMIT`) o revierte (`ROLLBACK`). Con `enOrden`, cada petición se
 * envía cuando la anterior ya quedó esperando: así se sabe quién llegó primero a la cola de bloqueos.
 */
export async function conRetencion<T>(opciones: {
  academiaId: string;
  retener: (retenedor: Retenedor) => Promise<void>;
  enviar: readonly (() => Promise<T>)[];
  liberar: 'COMMIT' | 'ROLLBACK';
  enOrden?: boolean;
}): Promise<ResultadoDeRetencion<T>> {
  const retenedor = await abrirRetenedor(opciones.academiaId);
  try {
    await opciones.retener(retenedor);
    const peticiones: { terminada: () => boolean; resultado: Promise<T> }[] = [];
    let todasEsperaron = true;
    const total = opciones.enviar.length;
    for (const [indice, enviar] of opciones.enviar.entries()) {
      peticiones.push(observar(enviar()));
      if (opciones.enOrden || indice === total - 1) {
        const objetivo = indice + 1;
        try {
          const espero = await esperarEspera(
            async () => (await retenedor.sesionesEsperando()) >= objetivo,
            peticiones,
            `las ${objetivo} peticiones ni respondieron ni quedaron esperando el bloqueo de la prueba.`,
          );
          if (!espero) todasEsperaron = false;
        } catch (error) {
          await retenedor.liberar('ROLLBACK');
          throw error;
        }
      }
    }
    await retenedor.liberar(opciones.liberar);
    const resultados = await conLimite(
      Promise.all(peticiones.map((peticion) => peticion.resultado)),
      'Límite de seguridad: las peticiones no respondieron tras liberar el bloqueo.',
    );
    return { resultados, todasEsperaron };
  } finally {
    await retenedor.liberar('ROLLBACK');
  }
}

/** Retiene con `SELECT … FOR UPDATE` (una sola sentencia, en el orden de `id`) las clases indicadas. */
export function retenerClases(claseIds: readonly string[], academiaId: string) {
  return async (retenedor: Retenedor): Promise<void> => {
    await retenedor.consultar(
      'SELECT id FROM clases WHERE academia_id = $1::uuid AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [academiaId, [...claseIds]],
    );
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Otros ayudantes
// ---------------------------------------------------------------------------------------------------------------------

/** Cuántas filas de las siete tablas y de la auditoría de la academia contienen `texto` en su representación de texto. */
export async function buscarTextoEnBase(academiaId: string, texto: string): Promise<number> {
  let total = 0;
  for (const tabla of [...TABLAS_005, 'auditoria']) {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT count(*)::int AS n FROM ${tabla} t WHERE t.academia_id = $1::uuid AND strpos(t::text, $2) > 0`,
      [academiaId, texto],
      { academiaId },
    );
    total += (rows[0] as { n: number }).n;
  }
  return total;
}

export interface PlanYClaseSabado {
  plan: PlanDePrueba;
  clase: ClaseDePrueba;
}

/** Un plan de 1 vez por semana, 4 clases, S/ 40.00, solo los sábados a las 18:00, y la clase BASICO del sábado a las 18:00 (aforo 20). */
export async function crearPlanYClaseSabado(e: EscenarioInscripcion): Promise<PlanYClaseSabado> {
  const plan = await crearPlanDePrueba(e.A.id, {
    nombre: 'Plan de los sábados',
    veces_por_semana: 1,
    clases_por_mes: 4,
    precio: '40.00',
    dias_permitidos: [6],
    franjas_permitidas: ['18:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
  });
  const clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
    nivel: 'BASICO',
    dia_semana: 6,
    hora_inicio: '18:00',
    aforo: 20,
  });
  return { plan, clase };
}

/** Un plan de 2 veces por semana, 8 clases, S/ 90.00, lunes, miércoles y viernes de 17:00 a 19:00. */
export async function crearPlanDeDosVeces(e: EscenarioInscripcion): Promise<PlanDePrueba> {
  return crearPlanDePrueba(e.A.id, {
    nombre: 'Plan 2 por semana',
    veces_por_semana: 2,
    clases_por_mes: 8,
    precio: '90.00',
    dias_permitidos: [1, 3, 5],
    franjas_permitidas: ['17:00', '18:00', '19:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
  });
}

/** Cancela, como dueño, todas las solicitudes y matrículas activas de una academia (la cancelación por API es de la 005b). */
export async function cancelarTodasLasReservas(academiaId: string): Promise<void> {
  await ejecutarComo(
    'propietario',
    `WITH s AS (UPDATE solicitudes_inscripcion SET estado = 'CANCELADA', actualizado_en = now()
                 WHERE academia_id = $1::uuid AND estado = 'PENDIENTE_PAGO' RETURNING id)
     UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL, actualizado_en = now()
      WHERE academia_id = $1::uuid AND estado = 'RESERVADA'`,
    [academiaId],
    { academiaId },
  );
}

/** Los textos de un cuerpo de respuesta sin los UUID (para comparar "el mismo error" aunque cambie el id del recurso). */
export function sinUuid(texto: string): string {
  return texto.replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
}
