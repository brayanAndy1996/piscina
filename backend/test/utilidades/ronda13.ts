// spec: 001-academias-aislamiento (pruebas protegidas)
import { inspect } from 'node:util';
import { expect } from 'vitest';
import { cargarFuncionalidad, type BaseDatosRonda3, type ClienteRonda3 } from './ronda3';

/**
 * Ayudas de las pruebas protegidas de la ronda 13 del ataque (criterios 160 a 162): rechazos de operaciones del envoltorio despues de
 * que `trabajo` termino, y causas y registros tecnicos de errores de Prisma sin valores. Todo lo escrito se lee como duenio, con una
 * conexion nueva.
 */

export {
  contarAuditoriaDeAcademia,
  contarAuditoriaDePlataforma,
  leerAcademiasPorPrefijo,
  leerValorDeConfiguracion,
  nada,
} from './ronda11';

let contador = 0;
/** Un numero distinto por caso ejecutado en este proceso: claves `prueba_r13_<n>`, nombres cortos `prueba-r13-<n>` y acciones `PRUEBA_R13_<n>`. */
export function siguienteNumero(): number {
  contador += 1;
  return contador;
}
export const claveDe = (n: number): string => `prueba_r13_${n}`;
export const nombreCortoDe = (n: number): string => `prueba-r13-${n}`;
export const accionDe = (n: number): string => `PRUEBA_R13_${n}`;

/** Valor reconocible que devuelve `trabajo`: si una llamada resuelve con el, la transaccion se reporto como confirmada. */
export const VALOR = 'valor-reconocible-r13';

/** Datos personales de mentira que viajan como parametros o argumentos: nunca deben aparecer en una causa ni en un registro. */
export const DNI_DE_PRUEBA = '44556677';
export const ALERGIA_DE_PRUEBA = 'penicilina-r13';

/** Los delegados que usan estas pruebas, con la forma amplia que tiene el envoltorio (criterio 100). */
export interface DelegadosRonda13 {
  configuracion: {
    create(argumentos: object): Promise<unknown>;
    update(argumentos: object): Promise<unknown>;
  };
  academia: {
    create(argumentos: object): Promise<unknown>;
    update(argumentos: object): Promise<unknown>;
  };
  auditoria: { create(argumentos: object): Promise<unknown> };
  auditoriaPlataforma: { create(argumentos: object): Promise<unknown> };
}

export const delegadosDe = (cliente: ClienteRonda3): DelegadosRonda13 => cliente as unknown as DelegadosRonda13;

/** Texto completo de un error, como lo veria alguien que lo imprime con `util.inspect` (mensaje, pila, propiedades y `cause`). */
export const textoCompleto = (valor: unknown): string => inspect(valor, { depth: null, showHidden: true });

/** Las propiedades propias de un valor (tambien las no enumerables, como `message` y `stack`), como JSON, sin fallar con ciclos. */
export function propiasComoJson(valor: unknown): string {
  if (typeof valor !== 'object' || valor === null) return JSON.stringify(valor) ?? '';
  const vistos = new WeakSet<object>();
  const plano: Record<string, unknown> = {};
  for (const clave of Object.getOwnPropertyNames(valor)) {
    plano[clave] = (valor as Record<string, unknown>)[clave];
  }
  return JSON.stringify(plano, (_clave, actual: unknown) => {
    if (typeof actual === 'object' && actual !== null) {
      if (vistos.has(actual)) return '[ciclo]';
      vistos.add(actual);
    }
    return actual;
  });
}

/** Guarda lo que rechaza una promesa que nadie espera (se usa en lugar de `void`, para no dejar rechazos sin manejar en Vitest). */
export function crearGuardador(): { guardados: unknown[]; guardar: (error: unknown) => void } {
  const guardados: unknown[] = [];
  return {
    guardados,
    guardar: (error: unknown) => {
      guardados.push(error);
    },
  };
}

/**
 * Con `DATABASE_POOL_MAX=1`, la siguiente transaccion usa la misma conexion: `conAcademia(B, ...)` resuelve, lee su propio contexto
 * (criterio 23) y no ve nada del caso (nada con la clave `prueba_r13_`).
 */
export async function esperarConexionSana(base: BaseDatosRonda3, academiaIdB: string, contexto: string): Promise<void> {
  const visto = await base.conAcademia(academiaIdB, async (tx) => {
    const filas = await tx.cliente.$queryRaw<
      { academia: string | null; plataforma: string | null; del_caso: number; propias: number }[]
    >`SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma,
        (SELECT count(*)::int FROM configuraciones WHERE starts_with(clave, 'prueba_r13_')) AS del_caso,
        (SELECT count(*)::int FROM configuraciones) AS propias`;
    return filas[0];
  });
  expect(visto?.academia?.toLowerCase(), `${contexto}: contexto de B`).toBe(academiaIdB.toLowerCase());
  expect(visto?.plataforma, `${contexto}: no debe quedar el contexto de plataforma`).not.toBe('si');
  expect(visto?.del_caso, `${contexto}: B no ve nada del caso`).toBe(0);
  expect(visto?.propias, `${contexto}: B ve sus propias configuraciones`).toBe(4);
}

/** Lo que exporta `backend/src/infraestructura/prisma/index.ts` desde la ronda 13 (P-42). */
export interface CausaLimpiaPrueba extends Error {
  readonly code?: string;
  readonly codigoPrisma?: string;
  readonly operacion?: string;
}
export type CircunstanciaDeLaCausaPrueba = 'sin-resultado' | 'llamada-tardia' | 'rechazo-tras-trabajo';
export interface ModuloRegistroDeErrores {
  CausaLimpia: new (...argumentos: never[]) => CausaLimpiaPrueba;
  causaLimpia: (error: unknown, operacion?: string, circunstancia?: CircunstanciaDeLaCausaPrueba) => CausaLimpiaPrueba;
  esErrorDeBase: (error: unknown) => boolean;
  errorParaRegistro: (error: unknown) => unknown;
}

/** `CausaLimpia`, `causaLimpia`, `esErrorDeBase` y `errorParaRegistro` del punto autorizado; si faltan, falla con "falta la funcionalidad". */
export function cargarRegistroDeErrores(): Promise<ModuloRegistroDeErrores> {
  return cargarFuncionalidad<ModuloRegistroDeErrores>('infraestructura/prisma/index.ts', [
    'CausaLimpia',
    'causaLimpia',
    'esErrorDeBase',
    'errorParaRegistro',
  ]);
}

/** El resultado de `errorParaRegistro` de un error de la base, como objeto (falla si no es un objeto plano). */
export function comoObjeto(valor: unknown, contexto: string): Record<string, unknown> {
  expect(typeof valor, `${contexto}: debia ser un objeto`).toBe('object');
  expect(valor, `${contexto}: no debia ser null`).not.toBeNull();
  return valor as Record<string, unknown>;
}

/** `ErrorTransaccionAbortada` con las dos opciones del constructor (P-36 y su ampliacion: `motivo` y `cause`). */
export interface ModuloErrorAbortada {
  ErrorTransaccionAbortada: new (opciones?: {
    readonly cause?: unknown;
    readonly motivo?: 'abortada' | 'incompleta';
  }) => Error;
}

/** `ErrorTransaccionAbortada` de `infraestructura/prisma/index.ts`; si falta, falla con "falta la funcionalidad". */
export function cargarClaseAbortada(): Promise<ModuloErrorAbortada> {
  return cargarFuncionalidad<ModuloErrorAbortada>('infraestructura/prisma/index.ts', ['ErrorTransaccionAbortada']);
}
