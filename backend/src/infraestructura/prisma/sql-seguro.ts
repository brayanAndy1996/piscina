import { Prisma } from '../../generated/prisma/client';

/**
 * Fragmentos de SQL del punto autorizado (spec 001, criterios 112 y 114, precisión P-25).
 *
 * Los módulos arman SQL con `sql`, `join` y `vacio`, que solo aceptan valores como parámetros (nunca texto de SQL) y
 * devuelven fragmentos opacos: objetos congelados, sin prototipo ni claves propias, sin ningún camino al `Sql` de Prisma ni al
 * cliente. El `Sql` real vive en un `WeakMap` privado de este archivo; solo el envoltorio de la transacción lo recupera, con
 * `aSql`, al enviar la consulta. No existe un equivalente de `Prisma.raw` ni de `Prisma.join` con separador libre.
 */

declare const marcaFragmento: unique symbol;

/** Fragmento opaco de SQL creado por `sql`, `join` o `vacio`. */
export interface Fragmento {
  readonly [marcaFragmento]: true;
}

type Simple = string | number | bigint | boolean | null | Date | Prisma.Decimal;
/** Lo que se puede interpolar en un fragmento: siempre viaja como parámetro. */
export type ValorSql = Simple | Uint8Array | readonly Simple[];

const sqlDe = new WeakMap<object, Prisma.Sql>();

function crearFragmento(consulta: Prisma.Sql): Fragmento {
  const fragmento = Object.freeze(Object.create(null) as object);
  sqlDe.set(fragmento, consulta);
  return fragmento as Fragmento;
}

/** El `Sql` de Prisma de un fragmento, o `undefined` si el valor no es un fragmento de este archivo. Solo para el envoltorio. */
export function aSql(valor: unknown): Prisma.Sql | undefined {
  return typeof valor === 'object' && valor !== null ? sqlDe.get(valor) : undefined;
}

/**
 * Comprueba que `partes` es un arreglo de cadenas con su `raw` (arreglo de cadenas del mismo largo) y un elemento más que los
 * valores. Lo comparten `sql` y el envoltorio.
 */
export function sonPartesDePlantilla(partes: unknown, cantidadDeValores: number): partes is TemplateStringsArray {
  if (!Array.isArray(partes)) return false;
  const raw: unknown = (partes as { raw?: unknown }).raw;
  if (!Array.isArray(raw)) return false;
  return (
    partes.length === cantidadDeValores + 1 &&
    raw.length === partes.length &&
    partes.every((parte) => typeof parte === 'string') &&
    raw.every((parte) => typeof parte === 'string')
  );
}

function esSimple(valor: unknown): valor is Simple {
  switch (typeof valor) {
    case 'string':
    case 'number':
    case 'bigint':
    case 'boolean':
      return true;
    case 'object':
      return valor === null || valor instanceof Date || Prisma.Decimal.isDecimal(valor);
    default:
      return false;
  }
}

/** Convierte un valor admitido en lo que Prisma recibe como parámetro, o un fragmento en su `Sql`. */
function convertir(valor: unknown): unknown {
  const fragmento = aSql(valor);
  if (fragmento) return fragmento;
  if (esSimple(valor) || valor instanceof Uint8Array) return valor;
  if (Array.isArray(valor) && valor.every(esSimple)) return valor;
  throw new TypeError('Valor no admitido en un fragmento de SQL: usa texto, números, fechas, Decimal o fragmentos.');
}

/** Etiqueta de plantilla: los valores interpolados viajan siempre como parámetros. */
export function sql(partes: TemplateStringsArray, ...valores: readonly (ValorSql | Fragmento)[]): Fragmento {
  if (!sonPartesDePlantilla(partes, valores.length)) {
    throw new TypeError('sql se usa como etiqueta de plantilla: sql`SELECT …`.');
  }
  return crearFragmento(Prisma.sql(partes, ...valores.map(convertir)));
}

const SEPARADORES: ReadonlyMap<string, string> = new Map([
  ['coma', ', '],
  ['y', ' AND '],
  ['o', ' OR '],
]);

/** Une valores o fragmentos con `', '` (`'coma'`, por defecto), `' AND '` (`'y'`) o `' OR '` (`'o'`). */
export function join(
  elementos: readonly (ValorSql | Fragmento)[],
  separador: 'coma' | 'y' | 'o' = 'coma',
): Fragmento {
  if (!Array.isArray(elementos) || elementos.length === 0) {
    throw new TypeError('join necesita al menos un elemento.');
  }
  const texto = typeof separador === 'string' ? SEPARADORES.get(separador) : undefined;
  if (texto === undefined) throw new TypeError("El separador de join debe ser 'coma', 'y' u 'o'.");
  return crearFragmento(Prisma.join(elementos.map(convertir), texto));
}

/** El fragmento vacío: útil para filtros opcionales. */
export const vacio: Fragmento = crearFragmento(Prisma.empty);
