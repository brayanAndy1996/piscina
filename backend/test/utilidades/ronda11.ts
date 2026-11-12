// spec: 001-academias-aislamiento (pruebas protegidas)
import { expect } from 'vitest';
import { ejecutarComo } from './base-datos';
import { leerAuditoriaDeAcademia, leerAuditoriaPlataforma } from './datos';
import type { BaseDatosRonda3 } from './ronda3';

/**
 * Ayudas de las pruebas protegidas de la ronda 11 del ataque (criterios 153 a 155): consultas lanzadas a la vez dentro de `trabajo`
 * (`Promise.all`, `Promise.allSettled`, `map` con funciones `async`) y bloqueos de transaccion. Todo lo escrito se lee como duenio, con
 * una conexion nueva.
 */

let contador = 0;
/** Un numero distinto por caso ejecutado en este proceso: claves `prueba_r11_<n>`, nombres cortos `prueba-r11-<n>` y acciones `PRUEBA_R11_<n>`. */
export function siguienteNumero(): number {
  contador += 1;
  return contador;
}
export const claveDe = (n: number, sufijo = ''): string => `prueba_r11_${n}${sufijo}`;
export const nombreCortoDe = (n: number, sufijo = ''): string => `prueba-r11-${n}${sufijo}`;
export const accionDe = (n: number): string => `PRUEBA_R11_${n}`;

/** Los delegados de los modelos que usan estas pruebas, con la forma amplia que tiene el envoltorio (criterio 100). */
export interface DelegadosRonda11 {
  configuracion: {
    update(argumentos: object): Promise<unknown>;
    create(argumentos: object): Promise<unknown>;
  };
  academia: {
    update(argumentos: object): Promise<unknown>;
    create(argumentos: object): Promise<unknown>;
  };
}

/** Atrapa solo el P2025 de Prisma ("el registro no existe"); relanza cualquier otro error. */
export async function ignorarP2025(consulta: Promise<unknown>): Promise<void> {
  try {
    await consulta;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'P2025') throw error;
  }
}

/** Atrapa cualquier error sin relanzarlo (para consultas enviadas sin `await`). */
export const nada = (): undefined => undefined;

/** Lo que dejo un caso en `configuraciones` de una academia: las filas cuya clave empieza por `prefijo`, con su valor. */
export async function leerConfiguraciones(
  academiaId: string,
  prefijo: string,
): Promise<{ clave: string; valor: unknown }[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT clave, valor FROM configuraciones WHERE academia_id = $1::uuid AND starts_with(clave, $2) ORDER BY clave',
    [academiaId, prefijo],
    { academiaId },
  );
  return rows as { clave: string; valor: unknown }[];
}

/** Valor (jsonb) de una configuracion de la academia, o `undefined` si no existe. */
export async function leerValorDeConfiguracion(academiaId: string, clave: string): Promise<unknown> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT valor FROM configuraciones WHERE academia_id = $1::uuid AND clave = $2',
    [academiaId, clave],
    { academiaId },
  );
  return (rows[0] as { valor: unknown } | undefined)?.valor;
}

/** Cantidad de registros de `auditoria` de la academia con esa accion. */
export async function contarAuditoriaDeAcademia(academiaId: string, accion: string): Promise<number> {
  return (await leerAuditoriaDeAcademia(academiaId, accion)).length;
}

/** Cantidad de registros de `auditoria_plataforma` con esa accion. */
export async function contarAuditoriaDePlataforma(accion: string): Promise<number> {
  return (await leerAuditoriaPlataforma(accion)).length;
}

/** Academias (nombre corto y nombre) cuyo nombre corto empieza por `prefijo`, leidas como duenio. */
export async function leerAcademiasPorPrefijo(prefijo: string): Promise<{ nombre_corto: string; nombre: string }[]> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT nombre_corto, nombre FROM academias WHERE starts_with(nombre_corto, $1) ORDER BY nombre_corto',
    [prefijo],
    { plataforma: true },
  );
  return rows as { nombre_corto: string; nombre: string }[];
}

/**
 * `motivo_suspension` de una academia, leido como duenio. La API solo puede actualizar `estado`, `motivo_suspension`, `suspendida_en` y
 * `actualizada_en` de `academias`: los casos que necesitan un `update` que se pueda comprobar usan `motivo_suspension`.
 */
export async function leerMotivoDeAcademia(academiaId: string): Promise<string | null | undefined> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT motivo_suspension FROM academias WHERE id = $1::uuid',
    [academiaId],
    { plataforma: true },
  );
  return (rows[0] as { motivo_suspension: string | null } | undefined)?.motivo_suspension;
}

/**
 * Con `DATABASE_POOL_MAX=1`, la siguiente transaccion usa la misma conexion: `conAcademia(B, ...)` resuelve, lee su propio contexto
 * (criterio 23) y no ve nada del caso (nada con la clave `prueba_r11_`).
 */
export async function esperarConexionSana(base: BaseDatosRonda3, academiaIdB: string, contexto: string): Promise<void> {
  const visto = await base.conAcademia(academiaIdB, async (tx) => {
    const filas = await tx.cliente.$queryRaw<
      { academia: string | null; plataforma: string | null; del_caso: number; propias: number }[]
    >`SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma,
        (SELECT count(*)::int FROM configuraciones WHERE starts_with(clave, 'prueba_r11_')) AS del_caso,
        (SELECT count(*)::int FROM configuraciones) AS propias`;
    return filas[0];
  });
  expect(visto?.academia?.toLowerCase(), `${contexto}: contexto de B`).toBe(academiaIdB.toLowerCase());
  expect(visto?.plataforma, `${contexto}: no debe quedar el contexto de plataforma`).not.toBe('si');
  expect(visto?.del_caso, `${contexto}: B no ve nada del caso`).toBe(0);
  expect(visto?.propias, `${contexto}: B ve sus propias configuraciones`).toBe(4);
}
