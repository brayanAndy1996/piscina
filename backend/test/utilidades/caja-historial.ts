// spec: 006-caja (pruebas protegidas)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as contratos from '@aquagestion/contratos';
import { expect } from 'vitest';
import * as indiceDeCaja from '../../src/modulos/caja/index';
import { ejecutarComo, urlAppPruebas } from './base-datos';
import {
  actualizarFilasCaja,
  type AppCaja,
  type CajaDePrueba,
  cerrarCajaDePrueba,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  HOY,
  type Objeto,
  type PersonaCajaApi,
  type RespuestaCaja,
} from './caja';
import { escucharAplicacion, LIMITE_DE_SEGURIDAD_MS } from './carreras';
import { obtenerBaseDatos } from './modulos';
import { AHORA_PRUEBAS, crearAppConReloj, rutasRegistradas, type UsuarioDePrueba } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 006b, Historial y PDF del cierre (spec.md, criterios 40 a 43 y PQ1 a PQ15). Se suman a
 * `caja.ts` (la 006a) sin tocarlo: un cliente HTTP que también lee cuerpos binarios y cabeceras, una aplicación con el generador del PDF
 * reemplazable (`overrideProvider(GENERADOR_PDF_CIERRE)`, PQ8), el escenario de alcance C1 a C5 de PQ2, la lectura de las conexiones de la
 * app en `pg_stat_activity` (PQ9 c) y las formas de las respuestas del historial.
 *
 * Solo usan SQL, HTTP y los contratos públicos. Lo que todavía no existe (las rutas, los esquemas, el token del generador, `textoParaPdf`)
 * se busca sin romper la importación del archivo: si falta, la prueba falla con un mensaje claro de "falta la funcionalidad de la 006b".
 */

// ---------------------------------------------------------------------------------------------------------------------
// Fechas del escenario
// ---------------------------------------------------------------------------------------------------------------------

/** El día de las pruebas es 2026-11-11 (`HOY`); esta es la fecha de 31 días atrás contando los dos extremos: el rango por defecto. */
export const DESDE_POR_DEFECTO = '2026-10-12';

// ---------------------------------------------------------------------------------------------------------------------
// Funcionalidad de la 006b (se busca sin romper la importación)
// ---------------------------------------------------------------------------------------------------------------------

const RAIZ_SRC = path.resolve(__dirname, '..', '..', 'src');

/** Carga un módulo de producción de la 006b; si falta, falla con un mensaje claro de "falta la funcionalidad". */
export async function cargarFuncionalidad006b<T>(rutaDesdeSrc: string, exportaciones: readonly string[]): Promise<T> {
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ_SRC, rutaDesdeSrc)).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 006b: no se pudo cargar "backend/src/${rutaDesdeSrc}" (${motivo}).`, {
      cause: error,
    });
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 006b: "backend/src/${rutaDesdeSrc}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

/** Un valor exportado por `@aquagestion/contratos` (esquema o constante de la 006b); si falta, falla con un mensaje claro. */
export function contratoDe<T>(nombre: string): T {
  const valor = (contratos as unknown as Record<string, unknown>)[nombre];
  if (valor === undefined) {
    throw new Error(`Falta la funcionalidad de la 006b: "@aquagestion/contratos" no exporta ${nombre}.`);
  }
  return valor as T;
}

/** Lo mínimo de un esquema de zod que las pruebas usan. */
export interface EsquemaPrueba {
  safeParse(valor: unknown): {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
}

/** `generarPdfCierre` (PQ8), reexportada en `caja/index.ts`. */
function generadorReal(): (datos: unknown) => Promise<Buffer> {
  const real = (indiceDeCaja as unknown as Record<string, unknown>)['generarPdfCierre'];
  if (typeof real !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 006b: "backend/src/modulos/caja/index.ts" no exporta generarPdfCierre.',
    );
  }
  return real as (datos: unknown) => Promise<Buffer>;
}

/** El token de Nest `GENERADOR_PDF_CIERRE` (PQ8), o `undefined` si todavía no existe. */
function tokenDelGenerador(): unknown {
  return (indiceDeCaja as unknown as Record<string, unknown>)['GENERADOR_PDF_CIERRE'];
}

// ---------------------------------------------------------------------------------------------------------------------
// El generador del PDF, reemplazable
// ---------------------------------------------------------------------------------------------------------------------

/** Un PDF mínimo y bien formado, para las pruebas que no miran el contenido. */
export const PDF_FALSO = Buffer.from('%PDF-1.4\n% generador falso de la prueba\n%%EOF\n', 'latin1');

/**
 * Qué hace el generador reemplazado al llamarlo:
 * - `falso`: devuelve `PDF_FALSO`;
 * - `real`: llama al `generarPdfCierre` verdadero con los mismos datos;
 * - `rechaza`: devuelve una promesa rechazada;
 * - `lanza`: lanza una excepción al llamarlo (sin devolver ninguna promesa);
 * - `retiene`: devuelve una promesa que la prueba resuelve después con `soltarRetenido()` (el generador real con esos datos).
 */
export type ModoDelGenerador = 'falso' | 'real' | 'rechaza' | 'lanza' | 'retiene';

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export class GeneradorDePrueba {
  modo: ModoDelGenerador = 'falso';
  /** Los datos (`DatosPdfCierre`) de cada llamada, en orden. */
  readonly llamadas: unknown[] = [];
  private retenido: { datos: unknown; resolver: (pdf: Buffer) => void; rechazar: (error: unknown) => void } | undefined;

  /** Lo que se instala con `overrideProvider(GENERADOR_PDF_CIERRE).useValue(...)`: la interfaz `GeneradorPdfCierre`. */
  readonly proveedor = { generar: (datos: unknown): Promise<Buffer> => this.generar(datos) };

  private generar(datos: unknown): Promise<Buffer> {
    this.llamadas.push(datos);
    switch (this.modo) {
      case 'falso':
        return Promise.resolve(PDF_FALSO);
      case 'real':
        return generadorReal()(datos);
      case 'rechaza':
        return Promise.reject(new Error('Falla simulada del generador del PDF (promesa rechazada)'));
      case 'lanza':
        throw new Error('Falla simulada del generador del PDF (excepción al llamarlo)');
      case 'retiene':
        return new Promise<Buffer>((resolver, rechazar) => {
          this.retenido = { datos, resolver, rechazar };
        });
    }
  }

  /** Vuelve al estado inicial: modo `falso` y sin llamadas registradas (suelta lo que haya retenido). */
  restablecer(): void {
    this.cancelarRetenido();
    this.modo = 'falso';
    this.llamadas.length = 0;
  }

  /** Espera, con el límite de seguridad, a que haya al menos `n` llamadas. */
  async esperarLlamadas(n: number): Promise<void> {
    const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
    while (this.llamadas.length < n) {
      if (Date.now() > limite) {
        throw new Error(
          `Límite de seguridad: el generador del PDF no recibió ${n} llamada(s) (recibió ${this.llamadas.length})`,
        );
      }
      await pausa(5);
    }
  }

  /** Resuelve la promesa retenida con el PDF que arma el generador real con los datos recibidos. */
  async soltarRetenido(): Promise<void> {
    const retenido = this.retenido;
    if (!retenido) throw new Error('El generador de la prueba no tiene ninguna llamada retenida.');
    this.retenido = undefined;
    try {
      retenido.resolver(await generadorReal()(retenido.datos));
    } catch (error) {
      retenido.rechazar(error);
    }
  }

  /** Resuelve lo retenido con el PDF falso (para no dejar una petición colgada si la prueba falla antes de soltarla). */
  cancelarRetenido(): void {
    const retenido = this.retenido;
    this.retenido = undefined;
    retenido?.resolver(PDF_FALSO);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cliente HTTP con cabeceras y cuerpo binario
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaHistorial extends RespuestaCaja {
  headers: Headers;
  /** El cuerpo tal como llegó (los bytes de un PDF no se leen como texto). */
  cuerpo: Buffer;
}

export interface ClienteHistorial {
  get(ruta: string, cookie?: string): Promise<RespuestaHistorial>;
  enviar(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown): Promise<RespuestaHistorial>;
  cerrar(): Promise<void>;
}

function leerJsonSeguro(texto: string): Objeto | null {
  if (!texto) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
  } catch {
    return null;
  }
}

export interface AppHistorial {
  app: AppCaja['app'];
  reloj: AppCaja['reloj'];
  http: ClienteHistorial;
  baseDatos: AppCaja['baseDatos'];
}

/**
 * La aplicación completa con `RELOJ` fijo, escuchando en un puerto efímero. Si se pasa un `generador` y el token `GENERADOR_PDF_CIERRE`
 * ya existe, lo instala con `overrideProvider` (PQ8); si todavía no existe, la aplicación arranca igual y la prueba falla con su propio
 * mensaje al pedir el PDF.
 */
export async function crearAppHistorial(
  ahora: Date = AHORA_PRUEBAS,
  generador?: GeneradorDePrueba,
): Promise<AppHistorial> {
  const token = tokenDelGenerador();
  const { app, reloj } = await crearAppConReloj(ahora, {
    ajustar: (constructor) =>
      generador && token !== undefined
        ? constructor.overrideProvider(token).useValue(generador.proveedor)
        : constructor,
  });
  const escuchando = await escucharAplicacion(app);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

  async function enviar(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown): Promise<RespuestaHistorial> {
    const headers: Record<string, string> = {};
    if (cookie) headers['cookie'] = cookie;
    let body: string | undefined;
    if (cuerpo !== undefined) {
      body = JSON.stringify(cuerpo);
      headers['content-type'] = 'application/json';
    }
    const respuesta = await fetch(`${base}${ruta}`, { method: metodo, headers, body });
    const crudo = Buffer.from(await respuesta.arrayBuffer());
    const texto = crudo.toString('utf8');
    return {
      status: respuesta.status,
      body: leerJsonSeguro(texto),
      texto,
      cacheControl: respuesta.headers.get('cache-control'),
      headers: respuesta.headers,
      cuerpo: crudo,
    };
  }

  return {
    app,
    reloj,
    baseDatos: () => obtenerBaseDatos(app),
    http: {
      get: (ruta, cookie) => enviar('GET', ruta, cookie),
      enviar,
      cerrar: () => escuchando.cerrar(),
    },
  };
}

/** Las tres rutas de la 006b (con `:id` y `:numero` como cualquier nombre de parámetro). */
const RUTAS_DE_LA_006B: readonly RegExp[] = [
  /^GET \/api\/cajas$/,
  /^GET \/api\/cajas\/:\w+$/,
  /^GET \/api\/cajas\/:\w+\/cierres\/:\w+\/pdf$/,
];

/**
 * Falla con un mensaje claro si las tres rutas de la 006b no están registradas (la funcionalidad no existe todavía). Evita que una
 * prueba pase por casualidad con una ruta inexistente.
 */
export function exigirRutasDeHistorial(app: AppCaja['app']): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_006B) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 006b: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

/** Falla con un mensaje claro si el generador del PDF todavía no se puede reemplazar (falta el token de PQ8). */
export function exigirGeneradorInyectable(): void {
  if (tokenDelGenerador() === undefined) {
    throw new Error(
      'Falta la funcionalidad de la 006b: "backend/src/modulos/caja/index.ts" no exporta GENERADOR_PDF_CIERRE (PQ8).',
    );
  }
  generadorReal();
}

// ---------------------------------------------------------------------------------------------------------------------
// Formas de las respuestas del historial (PQ3, PQ4)
// ---------------------------------------------------------------------------------------------------------------------

export interface UltimoCierreApi {
  numero: number;
  montoDeclarado: string;
  diferencia: string;
  resultado: 'CUADRA' | 'SOBRANTE' | 'FALTANTE';
  tardio: boolean;
  cerradoPor: PersonaCajaApi;
  cerradoEn: string;
}

export interface CajaHistorialApi {
  id: string;
  fecha: string;
  estado: 'ABIERTA' | 'CERRADA';
  deOtroDia: boolean;
  montoInicial: string;
  abiertaPor: PersonaCajaApi;
  totalIngresos: { efectivo: string; yape: string; transferencia: string };
  totalEgresos: { efectivo: string };
  ultimoCierre: UltimoCierreApi | null;
}

export interface RespuestaListaApi {
  desde: string;
  hasta: string;
  cajas: CajaHistorialApi[];
}

/** El cuerpo `{ desde, hasta, cajas }` de una respuesta 200 de la lista (falla con lo recibido si no viene así). */
export function listaDe(respuesta: { status: number; body: Objeto | null }): RespuestaListaApi {
  expect(
    Array.isArray(respuesta.body?.['cajas']),
    `la respuesta (HTTP ${respuesta.status}) no trae "cajas": ${JSON.stringify(respuesta.body)}`,
  ).toBe(true);
  return respuesta.body as unknown as RespuestaListaApi;
}

/** Los ids de las cajas de una respuesta de la lista, en el orden recibido. */
export function idsDeLista(respuesta: { status: number; body: Objeto | null }): string[] {
  return listaDe(respuesta).cajas.map((caja) => caja.id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Escenario de alcance C1 a C5 (PQ2)
// ---------------------------------------------------------------------------------------------------------------------

export const FECHA_C1 = '2026-11-03';
export const FECHA_C2 = '2026-11-04';
export const FECHA_C3 = '2026-11-05';
export const FECHA_C4 = '2026-11-09';
/** C5 es la caja de hoy. */
export const FECHA_C5 = HOY;

export interface EscenarioDeAlcance {
  /** La secretaria S1 (Lucia Benites) y la secretaria S2 (Marta Huaman). */
  s1: UsuarioDePrueba;
  s2: UsuarioDePrueba;
  /** El administrador de A que opera las cajas (Rosa Alvarez). */
  admin: UsuarioDePrueba;
  alumno: { id: string; nombres: string; apellidos: string; dni: string };
  /** C1: la abrió y la cerró S1. */
  c1: CajaDePrueba;
  /** C2: la abrió S2 y la cerró el ADMIN. */
  c2: CajaDePrueba;
  /** C3: la abrió el ADMIN, S1 hizo el cierre 1, el ADMIN la reabrió e hizo el cierre 2. */
  c3: CajaDePrueba;
  /** C4: la abrió S2 y sigue abierta (de otro día). */
  c4: CajaDePrueba;
  /** C5 (DR-13): la de hoy, cerrada, que abrió S2 y cerró el ADMIN. */
  c5: CajaDePrueba;
}

/** Marca como reabierto el cierre `numero` de una caja y devuelve la caja a `ABIERTA` (lo que haría la reapertura), como dueño. */
export async function reabrirCajaDePrueba(
  academiaId: string,
  cajaId: string,
  numeroDelCierre: number,
  reabiertoPor: string,
  reabiertoEn: Date,
  motivo = 'Se cerró por error',
): Promise<void> {
  await actualizarFilasCaja(
    'propietario',
    'cierres_caja',
    academiaId,
    { caja_id: cajaId, numero: numeroDelCierre },
    { reabierto_por: reabiertoPor, reabierto_en: reabiertoEn, motivo_reapertura: motivo },
  );
  await actualizarFilasCaja(
    'propietario',
    'cajas',
    academiaId,
    { id: cajaId },
    { estado: 'ABIERTA', actualizado_en: reabiertoEn },
  );
}

/**
 * El escenario de PQ2 en A, con cajas creadas como dueño: C1 a C5 con las fechas `FECHA_C1` a `FECHA_C5` (las cuatro primeras, antes de
 * hoy) y S1 = `secretariaA`, S2 = `secretariaA2`, ADMIN = `adminA`. C1 trae un ingreso del ADMIN y un egreso de S2; C5, un Yape de S2. Solo
 * C4 queda abierta.
 */
export async function crearEscenarioDeAlcance(e: EscenarioCaja): Promise<EscenarioDeAlcance> {
  const s1 = e.secretariaA;
  const s2 = e.secretariaA2;
  const admin = e.adminA;
  const alumno = await crearAlumnoDeCaja(e.A.id, 'Ana María', 'Quispe Rojas');

  const c1 = await crearCajaDePrueba(e.A.id, s1.id, { fecha: FECHA_C1, monto_inicial: '100.00' });
  await crearIngresoDePrueba(e.A.id, c1.id, admin.id, alumno.id, {
    monto: '42.00',
    registrado_en: enLima(FECHA_C1, '10:00'),
  });
  await crearEgresoDePrueba(e.A.id, c1.id, s2.id, { monto: '10.00', registrado_en: enLima(FECHA_C1, '11:00') });
  await cerrarCajaDePrueba(e.A.id, c1.id, s1.id, { cerradoEn: enLima(FECHA_C1, '18:00') });

  const c2 = await crearCajaDePrueba(e.A.id, s2.id, { fecha: FECHA_C2, monto_inicial: '50.00' });
  await cerrarCajaDePrueba(e.A.id, c2.id, admin.id, { cerradoEn: enLima(FECHA_C2, '18:00') });

  const c3 = await crearCajaDePrueba(e.A.id, admin.id, { fecha: FECHA_C3, monto_inicial: '70.00' });
  await cerrarCajaDePrueba(e.A.id, c3.id, s1.id, { cerradoEn: enLima(FECHA_C3, '18:00') });
  await reabrirCajaDePrueba(e.A.id, c3.id, 1, admin.id, enLima(FECHA_C3, '19:00'), 'Falto contar un sobre');
  await cerrarCajaDePrueba(e.A.id, c3.id, admin.id, { cerradoEn: enLima(FECHA_C3, '20:00') });

  const c5 = await crearCajaDePrueba(e.A.id, s2.id, { fecha: FECHA_C5, monto_inicial: '30.00' });
  await crearIngresoDePrueba(e.A.id, c5.id, s2.id, alumno.id, {
    monto: '88.00',
    metodo: 'YAPE',
    concepto: 'MENSUALIDAD',
    registrado_en: enLima(FECHA_C5, '09:15'),
  });
  await cerrarCajaDePrueba(e.A.id, c5.id, admin.id, { cerradoEn: enLima(FECHA_C5, '09:50') });

  // La única abierta (el índice `cajas_una_abierta_por_academia` exige que sea la última en crearse abierta).
  const c4 = await crearCajaDePrueba(e.A.id, s2.id, { fecha: FECHA_C4, monto_inicial: '20.00' });

  return { s1, s2, admin, alumno, c1, c2, c3, c4, c5 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas de la base para el PDF (PQ9)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Las conexiones del rol de la app a la base de pruebas que están `idle in transaction` ahora (PQ9 c): una lectura que terminó no deja
 * ninguna. Filtra por `datname = current_database()` y por el nombre del rol de la app.
 */
export async function conexionesInactivasEnTransaccion(): Promise<{ pid: number; state: string; query: string }[]> {
  const rolDeLaApp = decodeURIComponent(new URL(urlAppPruebas()).username);
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT pid, state, left(query, 200) AS query
       FROM pg_stat_activity
      WHERE datname = current_database() AND usename = $1 AND state LIKE 'idle in transaction%'
      ORDER BY pid`,
    [rolDeLaApp],
  );
  return rows as { pid: number; state: string; query: string }[];
}

/** Los archivos que hay ahora en `ALMACEN_DIRECTORIO` (rutas relativas, ordenadas); `[]` si la carpeta no existe. */
export function archivosDelAlmacen(): string[] {
  const raiz = process.env['ALMACEN_DIRECTORIO'];
  if (!raiz || !fs.existsSync(raiz)) return [];
  const archivos: string[] = [];
  const recorrer = (carpeta: string) => {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const completa = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else archivos.push(path.relative(raiz, completa).split(path.sep).join('/'));
    }
  };
  recorrer(raiz);
  return archivos.sort();
}

/** `nombre.pdf` de la descarga de un cierre: `cierre-caja-<fecha de la caja>-<numero>.pdf` (PQ7). */
export const nombreDelPdf = (fecha: string, numero: number): string => `cierre-caja-${fecha}-${numero}.pdf`;

/** La cabecera `Content-Disposition` exacta de la descarga de un cierre (PQ7). */
export const dispositionDelPdf = (fecha: string, numero: number): string =>
  `attachment; filename="${nombreDelPdf(fecha, numero)}"`;

/** `/api/cajas/{id}/cierres/{numero}/pdf`. */
export const rutaPdf = (cajaId: string, numero: string | number): string =>
  `/api/cajas/${cajaId}/cierres/${numero}/pdf`;

/** Las claves de un objeto, ordenadas (para comparar la forma exacta de una respuesta). */
export const clavesDe = (objeto: unknown): string[] =>
  objeto !== null && typeof objeto === 'object' ? Object.keys(objeto).sort() : [];
