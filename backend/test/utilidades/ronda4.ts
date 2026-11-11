// spec: 001-academias-aislamiento (pruebas protegidas)
import type { Prisma } from '../../src/generated/prisma/client';
import { cargarFuncionalidad } from './ronda3';

/**
 * Ayudas de las pruebas protegidas de la ronda 4 del ataque (criterios 106 a 119). Carga el punto autorizado de
 * `infraestructura/prisma/` (precision P-25) con el mismo mensaje claro de "falta la funcionalidad" que el resto de las
 * utilidades, para que las pruebas fallen por la funcionalidad que falta y no por un error de tipos o de importacion.
 */

/** Fragmento opaco del punto autorizado (P-25): objeto congelado sin prototipo ni claves propias. */
export type Fragmento = object;

export type ValorSqlPrueba = unknown;

export interface PuntoAutorizado {
  Decimal: typeof Prisma.Decimal;
  codigoDeErrorDeBase: (error: unknown) => string | null;
  esViolacionDeUnicidad: (error: unknown) => boolean;
  sql: (partes: TemplateStringsArray, ...valores: ValorSqlPrueba[]) => Fragmento;
  join: (elementos: readonly ValorSqlPrueba[], separador?: string) => Fragmento;
  vacio: Fragmento;
}

/** `backend/src/infraestructura/prisma/index.ts` con lo que exporta el criterio 114 (P-25). */
export function cargarPuntoAutorizado(): Promise<PuntoAutorizado> {
  return cargarFuncionalidad<PuntoAutorizado>('infraestructura/prisma/index.ts', [
    'Decimal',
    'codigoDeErrorDeBase',
    'esViolacionDeUnicidad',
    'sql',
    'join',
    'vacio',
  ]);
}

/**
 * Lo que incumple una promesa respecto del criterio 106: debe ser una `Promise` nativa (prototipo `Promise.prototype`, sin
 * claves propias, sin `requestTransaction`, con el `then`, `catch` y `finally` de `Promise.prototype`). Devuelve la lista de
 * problemas (vacia si es nativa). No imprime la promesa: si fuera una `PrismaPromise`, el mensaje arrastraria el motor.
 */
export function problemasDePromesa(promesa: unknown): string[] {
  const problemas: string[] = [];
  if (typeof promesa !== 'object' || promesa === null) return ['no es un objeto'];
  if (Object.getPrototypeOf(promesa) !== Promise.prototype) problemas.push('su prototipo no es Promise.prototype');
  const claves = Reflect.ownKeys(promesa).map(String);
  if (claves.length > 0) problemas.push(`tiene claves propias: ${claves.join(', ')}`);
  const conCampos = promesa as Record<string, unknown>;
  if (conCampos['requestTransaction'] !== undefined) problemas.push('tiene requestTransaction');
  for (const nombre of ['then', 'catch', 'finally'] as const) {
    if (conCampos[nombre] !== Promise.prototype[nombre]) problemas.push(`su ${nombre} no es el de Promise.prototype`);
  }
  return problemas;
}

/** SQL (sin parametros) de lo que se le pasa a `$queryRaw` o `$executeRaw`, para clasificar consultas en los dobles. */
export function textoDeConsulta(primero: unknown): string {
  if (Array.isArray(primero)) return (primero as string[]).join('?');
  if (typeof primero === 'string') return primero;
  if (typeof primero === 'object' && primero !== null) {
    const objeto = primero as { sql?: unknown; text?: unknown; strings?: unknown };
    if (typeof objeto.sql === 'string') return objeto.sql;
    if (typeof objeto.text === 'string') return objeto.text;
    if (Array.isArray(objeto.strings)) return (objeto.strings as string[]).join('?');
  }
  return '';
}
