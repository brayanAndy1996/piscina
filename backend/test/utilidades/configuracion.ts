// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect } from 'vitest';
import { ejecutarComo } from './base-datos';
import { type ClienteHttp, escucharAplicacion } from './carreras';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la historia 003 (spec.md, "Contrato" y "Tabla de claves"): escribir y leer filas de
 * `configuraciones` como dueño de las tablas (con cualquier valor JSON, también inválido), instantáneas para comprobar que una
 * operación rechazada no escribió nada y un cliente HTTP que sí envía `PATCH`. Solo usan SQL y HTTP: no importan nada de la
 * implementación. Todas las lecturas de filas filtran por `academia_id` de forma explícita y fijan el contexto de la academia, así
 * que sirven con un dueño superusuario (CI y Docker de Windows) y con uno que no lo es (nube).
 */

export type CampoConfiguracion =
  | 'toleranciaTardanzaMinutos'
  | 'diasPorVencer'
  | 'diasPrioridadRenovacion'
  | 'intentosInicioSesion'
  | 'minutosBloqueo'
  | 'telefono';

/** Clave de cada campo de la API en `configuraciones.clave` (tabla de claves del contrato, escrita aquí a mano). */
export const CLAVE_EN_BASE: Readonly<Record<CampoConfiguracion, string>> = {
  toleranciaTardanzaMinutos: 'tolerancia_tardanza_minutos',
  diasPorVencer: 'dias_por_vencer',
  diasPrioridadRenovacion: 'dias_prioridad_renovacion',
  intentosInicioSesion: 'intentos_inicio_sesion',
  minutosBloqueo: 'minutos_bloqueo',
  telefono: 'telefono',
};

export interface ValoresDeConfiguracion {
  toleranciaTardanzaMinutos: number;
  diasPorVencer: number;
  diasPrioridadRenovacion: number;
  intentosInicioSesion: number;
  minutosBloqueo: number;
  telefono: string | null;
}

/** Valores por defecto de la tabla de claves (criterio 1): D-11, HU-11, D-06, D-07 con DR-3 de 002 y D-22. */
export const POR_DEFECTO: Readonly<ValoresDeConfiguracion> = {
  toleranciaTardanzaMinutos: 10,
  diasPorVencer: 5,
  diasPrioridadRenovacion: 5,
  intentosInicioSesion: 5,
  minutosBloqueo: 15,
  telefono: null,
};

export const MINUTO = 60 * 1000;
export const ACCION_AUDITORIA = 'CONFIGURACION_ACTUALIZADA';

export interface FilaConfiguracion {
  clave: string;
  valor: unknown;
  actualizado_en: Date;
}

/**
 * Escribe (inserta o reemplaza) una fila de `configuraciones` con una conexión del dueño. `valor` es cualquier valor JSON, también
 * uno inválido para la clave (un texto, un booleano, un objeto, una lista, `null`, un decimal…): se guarda como `jsonb` tal cual.
 */
export async function fijarFilaConfiguracion(
  academiaId: string,
  clave: string,
  valor: unknown,
  actualizadoEn: Date = new Date(),
): Promise<void> {
  await ejecutarComo(
    'propietario',
    `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
     VALUES ($1::uuid, $2, $3::jsonb, $4)
     ON CONFLICT (academia_id, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = EXCLUDED.actualizado_en`,
    [academiaId, clave, JSON.stringify(valor), actualizadoEn],
    { academiaId },
  );
}

/** Escribe una fila por campo con la clave de la tabla de claves (`fijarConfiguracion(A, { minutosBloqueo: 30 })`). */
export async function fijarConfiguracion(
  academiaId: string,
  valores: Partial<Record<CampoConfiguracion, unknown>>,
  actualizadoEn?: Date,
): Promise<void> {
  for (const [campo, valor] of Object.entries(valores)) {
    await fijarFilaConfiguracion(academiaId, CLAVE_EN_BASE[campo as CampoConfiguracion], valor, actualizadoEn);
  }
}

/** Borra una fila de `configuraciones` (con el dueño de las tablas): la clave vuelve a valer lo de por defecto. */
export async function quitarFilaConfiguracion(academiaId: string, clave: string): Promise<void> {
  await ejecutarComo(
    'propietario',
    'DELETE FROM configuraciones WHERE academia_id = $1::uuid AND clave = $2',
    [academiaId, clave],
    { academiaId },
  );
}

/** Todas las filas de `configuraciones` de una academia, ordenadas por clave (filtra por `academia_id`). */
export async function leerFilasConfiguracion(academiaId: string): Promise<FilaConfiguracion[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT clave, valor, actualizado_en FROM configuraciones WHERE academia_id = $1::uuid ORDER BY clave',
    [academiaId],
    { academiaId },
  );
  return rows as FilaConfiguracion[];
}

/** La fila de una clave de una academia, o `undefined` si no hay. */
export async function leerFilaConfiguracion(academiaId: string, clave: string): Promise<FilaConfiguracion | undefined> {
  return (await leerFilasConfiguracion(academiaId)).find((fila) => fila.clave === clave);
}

/** Instantánea de las filas de una academia (valor y `actualizado_en` incluidos), para comparar antes y después. */
export async function instantaneaDeConfiguracion(academiaId: string): Promise<string> {
  return JSON.stringify(await leerFilasConfiguracion(academiaId));
}

/**
 * Falla con un mensaje claro si las rutas de la 003 no están registradas (la funcionalidad no existe todavía). Evita que una prueba
 * pase "por casualidad" con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */
export function exigirRutasDeConfiguracion(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const esperada of ['GET /api/configuracion', 'PATCH /api/configuracion']) {
    if (!registradas.includes(esperada)) {
      throw new Error(`Falta la funcionalidad de la 003: la ruta ${esperada} no está registrada.`);
    }
  }
}

export interface RespuestaConfiguracionHttp {
  status: number;
  body: {
    codigo?: string;
    mensaje?: string;
    detalles?: { errores?: { campo: string; mensaje: string }[] };
    configuracion?: Record<string, unknown>;
    academia?: Record<string, unknown>;
  } | null;
}

/** Cliente HTTP sobre la aplicación escuchando en un puerto efímero, con `GET`, `PATCH` y `POST` y la cabecera `Cookie`. */
export interface ClienteDeConfiguracion {
  get(ruta: string, cookie: string): Promise<RespuestaConfiguracionHttp>;
  patch(ruta: string, cookie: string, cuerpo: unknown): Promise<RespuestaConfiguracionHttp>;
  post(ruta: string, cookie: string, cuerpo: unknown): Promise<RespuestaConfiguracionHttp>;
  /** Cierra la aplicación. */
  cerrar(): Promise<void>;
}

function leerCuerpo(texto: string): RespuestaConfiguracionHttp['body'] {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as RespuestaConfiguracionHttp['body'];
  } catch {
    return null;
  }
}

/**
 * Pone la aplicación a escuchar en `127.0.0.1` (puerto libre, portable a Windows) y devuelve un cliente con `PATCH`: las carreras de
 * `backend/test/utilidades/carreras.ts` envían las peticiones sin esperarlas y su cliente solo tiene `POST`.
 */
export async function escucharParaConfiguracion(app: NestExpressApplication): Promise<ClienteDeConfiguracion> {
  const base: ClienteHttp = await escucharAplicacion(app);
  const direccion = app.getHttpServer().address() as { port: number };
  const url = `http://127.0.0.1:${direccion.port}`;

  async function enviar(
    metodo: 'GET' | 'PATCH' | 'POST',
    ruta: string,
    cookie: string,
    cuerpo?: unknown,
  ): Promise<RespuestaConfiguracionHttp> {
    const respuesta = await fetch(`${url}${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: respuesta.status, body: leerCuerpo(await respuesta.text()) };
  }

  return {
    get: (ruta, cookie) => enviar('GET', ruta, cookie),
    patch: (ruta, cookie, cuerpo) => enviar('PATCH', ruta, cookie, cuerpo),
    post: (ruta, cookie, cuerpo) => enviar('POST', ruta, cookie, cuerpo),
    cerrar: () => base.cerrar(),
  };
}

/** Comprueba que un cuerpo de éxito de `GET` o `PATCH /api/configuracion` trae `{ configuracion }` con los seis campos y nada más. */
export function esperarConfiguracion(cuerpo: unknown, esperada: Readonly<ValoresDeConfiguracion>): void {
  expect(cuerpo).toEqual({ configuracion: esperada });
  expect(Object.keys((cuerpo as { configuracion: object }).configuracion).sort()).toEqual(
    Object.keys(CLAVE_EN_BASE).sort(),
  );
}
