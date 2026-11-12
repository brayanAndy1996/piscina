import { Prisma } from '../../generated/prisma/client';
import { codigoDeErrorDeBase, leerSeguro } from './errores-base';

/**
 * Errores de la base para el registro técnico y para la causa de `ErrorTransaccionAbortada` (spec 001, criterios 161 y 162,
 * P-42). INTERNO a esta carpeta salvo lo que exporta `index.ts`.
 *
 * El mensaje de un error de Prisma puede llevar los valores de la consulta (un DNI, una alergia: Ley 29733, RNF-05) y su pila,
 * en las primeras líneas, un fragmento del código de la llamada con los argumentos. Por eso un error de Prisma o de la base nunca
 * se registra tal cual: se convierte en un objeto con solo el tipo y los códigos (`errorParaRegistro`), o en una `CausaLimpia`
 * (un `Error` de AquaGestión con un texto fijo). Nada de aquí lanza con ninguna entrada: cada lectura va por `leerSeguro` y la
 * recursión tiene límite de profundidad y un conjunto de errores vistos.
 */

/** Por qué una operación del envoltorio marcó la transacción (criterios 154, 156 y 160). */
export type CircunstanciaDeLaCausa = 'sin-resultado' | 'llamada-tardia' | 'rechazo-tras-trabajo';

const CLASES_DE_PRISMA = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
];
const NOMBRES_DE_BASE: ReadonlySet<string> = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'DriverAdapterError',
  'DatabaseError',
  'CausaLimpia',
]);
const MODELOS: ReadonlySet<string> = new Set(Object.values(Prisma.ModelName));
const CODIGO_DE_PRISMA = /^P\d{4}$/;
const CODIGO_DE_SISTEMA = /^E[A-Z0-9_]{1,40}$/;
const NOMBRE_DE_TIPO = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const OPERACION = /^(?:\$queryRaw|\$executeRaw|[a-z][A-Za-z0-9]*\.[a-zA-Z]+)$/;
const MARCO_DE_PILA = /^\s+at\s/;
const NIVELES_MAXIMOS = 10;
const MARCOS_MAXIMOS = 40;

const TEXTO_DE_LA_CIRCUNSTANCIA: Readonly<Record<CircunstanciaDeLaCausa, string>> = {
  'sin-resultado': 'Operación sin resultado',
  'llamada-tardia': 'Llamada que llegó después de que el envoltorio se apagó',
  'rechazo-tras-trabajo': 'Operación rechazada después de que el trabajo terminó',
};

const esObjeto = (valor: unknown): valor is object => typeof valor === 'object' && valor !== null;

const textoSiCumple = (valor: unknown, patron: RegExp): string | undefined =>
  typeof valor === 'string' && patron.test(valor) ? valor : undefined;

/** Los datos de un error de la base que sí se pueden registrar: el tipo, los códigos y el modelo. Nunca un mensaje. */
interface DatosSeguros {
  readonly tipo: string;
  readonly codigoPrisma?: string;
  readonly sqlstate?: string;
  readonly codigoDeSistema?: string;
  readonly modelo?: string;
}

function sqlstateSeguro(error: unknown): string | null {
  try {
    return codigoDeErrorDeBase(error);
  } catch {
    return null;
  }
}

function datosSeguros(error: unknown): DatosSeguros {
  const nombre = textoSiCumple(leerSeguro(error, 'name'), NOMBRE_DE_TIPO);
  const tipo = nombre ?? (error instanceof Error ? 'Error' : 'ErrorDeBase');
  const sqlstate = sqlstateSeguro(error);
  const codigo = leerSeguro(error, 'code');
  const delaCausa = leerSeguro(leerSeguro(error, 'cause'), 'code');
  const codigoPrisma =
    textoSiCumple(codigo, CODIGO_DE_PRISMA) ?? textoSiCumple(leerSeguro(error, 'errorCode'), CODIGO_DE_PRISMA);
  const codigoDeSistema = textoSiCumple(codigo, CODIGO_DE_SISTEMA) ?? textoSiCumple(delaCausa, CODIGO_DE_SISTEMA);
  const modeloLeido = leerSeguro(leerSeguro(error, 'meta'), 'modelName');
  const modelo = typeof modeloLeido === 'string' && MODELOS.has(modeloLeido) ? modeloLeido : undefined;
  return {
    tipo,
    ...(codigoPrisma === undefined ? {} : { codigoPrisma }),
    ...(sqlstate === null ? {} : { sqlstate }),
    ...(codigoDeSistema === undefined ? {} : { codigoDeSistema }),
    ...(modelo === undefined ? {} : { modelo }),
  };
}

/**
 * Una causa sin datos: el tipo y los códigos del error original, y la operación, con un mensaje fijo. Sin `cause`, `meta` ni la
 * pila del original. `code` es el SQLSTATE, para que `codigoDeErrorDeBase(causa)` siga funcionando.
 */
export class CausaLimpia extends Error {
  readonly tipo: string;
  declare readonly code?: string;
  declare readonly codigoPrisma?: string;
  declare readonly operacion?: string;

  constructor(
    datos: { readonly tipo?: string; readonly codigoPrisma?: string; readonly sqlstate?: string },
    operacion?: string,
    circunstancia?: CircunstanciaDeLaCausa,
  ) {
    const partes: string[] = [];
    if (datos.tipo !== undefined) partes.push(datos.tipo);
    if (datos.codigoPrisma !== undefined) partes.push(datos.codigoPrisma);
    if (datos.sqlstate !== undefined) partes.push(`SQLSTATE ${datos.sqlstate}`);
    const inicio = circunstancia === undefined ? 'Causa' : TEXTO_DE_LA_CIRCUNSTANCIA[circunstancia];
    const dondeFue = operacion === undefined ? '' : `: ${operacion}`;
    const detalle = partes.length === 0 ? '' : ` (${partes.join(', ')})`;
    super(`${inicio}${dondeFue}${detalle}.`);
    this.name = 'CausaLimpia';
    this.tipo = datos.tipo ?? 'Error';
    if (datos.sqlstate !== undefined) this.code = datos.sqlstate;
    if (datos.codigoPrisma !== undefined) this.codigoPrisma = datos.codigoPrisma;
    if (operacion !== undefined) this.operacion = operacion;
  }
}

/** ¿Es un error de Prisma o de la base (también de su adaptador)? Por la clase, el nombre, un código de Prisma o un SQLSTATE. */
export function esErrorDeBase(error: unknown): boolean {
  try {
    if (!esObjeto(error)) return false;
    if (CLASES_DE_PRISMA.some((clase) => error instanceof clase)) return true;
    const nombre = leerSeguro(error, 'name');
    if (typeof nombre === 'string' && (nombre.startsWith('PrismaClient') || NOMBRES_DE_BASE.has(nombre))) return true;
    if (textoSiCumple(leerSeguro(error, 'code'), CODIGO_DE_PRISMA) !== undefined) return true;
    // Un error propio que ya lleva una causa limpia (`ErrorTransaccionAbortada`) no es un error de la base aunque el SQLSTATE de su
    // causa se lea desde él (`codigoDeErrorDeBase` mira también `cause`): ya no tiene nada que limpiar.
    if (leerSeguro(error, 'cause') instanceof CausaLimpia) return false;
    return codigoDeErrorDeBase(error) !== null;
  } catch {
    return false;
  }
}

/**
 * La causa limpia de `error` (criterio 161): una `CausaLimpia` con el tipo y los códigos del error y, si se indican, la operación
 * (solo con la forma de un nombre de operación del envoltorio) y la circunstancia. Una `CausaLimpia` sin operación ni
 * circunstancia se devuelve tal cual. Nunca lleva el mensaje, la pila, `meta` ni la `cause` del error original.
 */
export function causaLimpia(error: unknown, operacion?: string, circunstancia?: CircunstanciaDeLaCausa): CausaLimpia {
  if (error instanceof CausaLimpia && operacion === undefined && circunstancia === undefined) return error;
  const operacionValida = textoSiCumple(operacion, OPERACION);
  const nombreDeCircunstancia =
    circunstancia !== undefined && Object.hasOwn(TEXTO_DE_LA_CIRCUNSTANCIA, circunstancia) ? circunstancia : undefined;
  if (error instanceof CausaLimpia) {
    return new CausaLimpia(
      {
        tipo: error.tipo,
        ...(error.codigoPrisma === undefined ? {} : { codigoPrisma: error.codigoPrisma }),
        ...(error.code === undefined ? {} : { sqlstate: error.code }),
      },
      operacionValida ?? error.operacion,
      nombreDeCircunstancia,
    );
  }
  const datos = error === undefined || error === null ? {} : datosSeguros(error);
  return new CausaLimpia(datos, operacionValida, nombreDeCircunstancia);
}

const soloMarcos = (pila: unknown): string | undefined => {
  if (typeof pila !== 'string') return undefined;
  const marcos = pila
    .split('\n')
    .filter((linea) => MARCO_DE_PILA.test(linea))
    .slice(0, MARCOS_MAXIMOS);
  return marcos.length === 0 ? undefined : marcos.join('\n');
};

/** Un error de la base como objeto plano: solo el tipo, los códigos, el modelo y los marcos de la pila. */
function limpio(error: unknown): Record<string, unknown> {
  const pila = soloMarcos(leerSeguro(error, 'stack'));
  return { ...datosSeguros(error), ...(pila === undefined ? {} : { pila }) };
}

/** Los errores que cuelgan de este por `cause` y `errors`. */
function hijosDe(error: unknown): unknown[] {
  const hijos: unknown[] = [];
  const causa = leerSeguro(error, 'cause');
  if (causa !== undefined) hijos.push(causa);
  const varios = leerSeguro(error, 'errors');
  if (Array.isArray(varios)) hijos.push(...(varios as unknown[]).slice(0, NIVELES_MAXIMOS));
  return hijos;
}

/**
 * ¿Algún nivel de la cadena de `cause` y `errors` es un error de la base que no sea una `CausaLimpia`? Una cadena más profunda que
 * el límite cuenta como que sí: ante la duda, se limpia.
 */
function llevaBaseSinLimpiar(error: unknown, nivel = 0, vistos = new WeakSet<object>()): boolean {
  if (!esObjeto(error) || error instanceof CausaLimpia) return false;
  if (vistos.has(error)) return false;
  vistos.add(error);
  if (esErrorDeBase(error)) return true;
  if (nivel >= NIVELES_MAXIMOS) return hijosDe(error).length > 0;
  return hijosDe(error).some((hijo) => llevaBaseSinLimpiar(hijo, nivel + 1, vistos));
}

/** Copia un error propio que lleva un error de la base en su cadena, con las causas convertidas. */
function copiaConCausasLimpias(error: unknown, nivel: number, vistos: WeakSet<object>): unknown {
  if (!esObjeto(error)) return { tipo: typeof error };
  if (error instanceof CausaLimpia) return error;
  if (esErrorDeBase(error)) return limpio(error);
  if (vistos.has(error) || nivel >= NIVELES_MAXIMOS) return { tipo: 'truncado' };
  vistos.add(error);
  const mensaje = leerSeguro(error, 'message');
  const pila = leerSeguro(error, 'stack');
  const causa = leerSeguro(error, 'cause');
  const varios = leerSeguro(error, 'errors');
  return {
    tipo: textoSiCumple(leerSeguro(error, 'name'), NOMBRE_DE_TIPO) ?? 'Error',
    ...(typeof mensaje === 'string' ? { mensaje } : {}),
    ...(typeof pila === 'string' ? { pila } : {}),
    ...(causa === undefined ? {} : { causa: copiaConCausasLimpias(causa, nivel + 1, vistos) }),
    ...(Array.isArray(varios)
      ? {
          errores: (varios as unknown[])
            .slice(0, NIVELES_MAXIMOS)
            .map((e) => copiaConCausasLimpias(e, nivel + 1, vistos)),
        }
      : {}),
  };
}

/**
 * Lo que se registra de un error (criterio 162):
 * - un error de Prisma o de la base (`esErrorDeBase`), salvo una `CausaLimpia`: un objeto con solo `tipo`, `codigoPrisma`,
 *   `sqlstate`, `codigoDeSistema`, `modelo` y `pila` (los marcos);
 * - un `Error` propio con un error de la base en su cadena de `cause` o `errors`: `{ tipo, mensaje, pila, causa?, errores? }` con
 *   las causas convertidas;
 * - cualquier otro `Error` (también una `CausaLimpia` y un `ErrorTransaccionAbortada`): el mismo objeto;
 * - lo que no es un `Error`: `{ tipo: typeof valor }`, nunca su valor.
 */
export function errorParaRegistro(error: unknown): unknown {
  try {
    if (!(error instanceof Error)) return { tipo: typeof error };
    if (error instanceof CausaLimpia) return error;
    if (esErrorDeBase(error)) return limpio(error);
    if (!llevaBaseSinLimpiar(error)) return error;
    return copiaConCausasLimpias(error, 0, new WeakSet<object>());
  } catch {
    return { tipo: 'Error' };
  }
}
