import { types } from 'node:util';

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
/** La lista cerrada de `tipo` de un error de la base (criterio 166, P-42); `esErrorDeBase` acepta además los `PrismaClient…`. */
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
const PROFUNDIDAD_MAXIMA = 10;
const OBJETOS_MAXIMOS = 200;
const CLAVES_MAXIMAS = 100;
const DE_LA_BASE_MAXIMOS = 10;

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

/** El nombre de la clase del error (criterio 165): su `name` solo si es el de su constructor y tiene forma de identificador. */
function nombreDeClase(error: unknown): string {
  try {
    const nombre = leerSeguro(error, 'name');
    const constructor: unknown = esObjeto(error) ? Reflect.get(error, 'constructor') : undefined;
    const deLaClase: unknown =
      typeof constructor === 'function' || esObjeto(constructor) ? Reflect.get(constructor, 'name') : undefined;
    return typeof nombre === 'string' && nombre === deLaClase && NOMBRE_DE_TIPO.test(nombre) ? nombre : 'Error';
  } catch {
    return 'Error';
  }
}

/** El `tipo` de un error de la base: su `name` solo si está en la lista cerrada (criterio 166); si no, `ErrorDeBase`. */
function tipoDeBase(error: unknown): string {
  const nombre = leerSeguro(error, 'name');
  return typeof nombre === 'string' && NOMBRES_DE_BASE.has(nombre) ? nombre : 'ErrorDeBase';
}

function datosSeguros(error: unknown): DatosSeguros {
  const tipo = esErrorDeBase(error) ? tipoDeBase(error) : nombreDeClase(error);
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

/**
 * La pila de un error de la base sin datos (criterio 163): se lee solo DESPUES del encabezado exacto que escribe V8, `nombre: mensaje`
 * (o `nombre` solo con el mensaje vacío), y solo si lo que sigue está vacío o empieza con un salto de línea. Un mensaje con una línea
 * que empieza con espacios y `at ` (con un DNI, por ejemplo) está dentro del encabezado y no se confunde con un marco. Si `name`,
 * `message` o `stack` no son cadenas, si leerlos lanza o si el `stack` no empieza con el encabezado, no hay pila (falla cerrada).
 */
const pilaSinEncabezado = (error: unknown): string | undefined => {
  const nombre = leerSeguro(error, 'name');
  const mensaje = leerSeguro(error, 'message');
  const pila = leerSeguro(error, 'stack');
  if (typeof nombre !== 'string' || typeof mensaje !== 'string' || typeof pila !== 'string') return undefined;
  const encabezado = mensaje === '' ? nombre : `${nombre}: ${mensaje}`;
  if (!pila.startsWith(encabezado)) return undefined;
  const resto = pila.slice(encabezado.length);
  if (resto !== '' && !resto.startsWith('\n')) return undefined;
  const marcos = resto
    .split('\n')
    .filter((linea) => MARCO_DE_PILA.test(linea))
    .slice(0, MARCOS_MAXIMOS);
  return marcos.length === 0 ? undefined : marcos.join('\n');
};

/** Un error de la base como objeto plano: solo el tipo, los códigos, el modelo y los marcos de la pila. */
function limpio(error: unknown): Record<string, unknown> {
  const pila = pilaSinEncabezado(error);
  return { ...datosSeguros(error), ...(pila === undefined ? {} : { pila }) };
}

/** Lee `objeto[clave]` (texto o Symbol) sin dejar que un getter lance. */
function leerClave(objeto: object, clave: PropertyKey): unknown {
  try {
    return Reflect.get(objeto, clave);
  } catch {
    return undefined;
  }
}

/** Binarios por la ranura interna del motor; nunca por instanceof, prototipo ni Symbol.toStringTag (criterio 167). */
const esHojaBinaria = (valor: object): boolean => ArrayBuffer.isView(valor) || types.isAnyArrayBuffer(valor);

/**
 * Las claves de `objeto` (propias, texto y Symbol, enumerables o no, y enumerables heredadas), o `undefined` si pasan del tope o no
 * se dejan listar (falla cerrada, criterio 167). Primero se mira `length` (arreglos, `String` y objetos con forma de arreglo), luego
 * `Reflect.ownKeys`, y solo si no pasan del tope se recorre `for…in`, que se corta al pasarlo. Nunca junta más de
 * `CLAVES_MAXIMAS + 1` claves por su cuenta.
 */
function clavesDe(objeto: object): PropertyKey[] | undefined {
  const largo = leerClave(objeto, 'length');
  if (typeof largo === 'number' && largo > CLAVES_MAXIMAS) return undefined;
  let propias: PropertyKey[];
  try {
    propias = Reflect.ownKeys(objeto);
  } catch {
    return undefined;
  }
  if (propias.length > CLAVES_MAXIMAS) return undefined;
  const claves = new Set<PropertyKey>(propias);
  try {
    // Se buscan también las heredadas enumerables: pino las serializa.
    for (const clave in objeto) {
      claves.add(clave);
      if (claves.size > CLAVES_MAXIMAS) return undefined;
    }
  } catch {
    return undefined;
  }
  return [...claves];
}

interface Busqueda {
  readonly deLaBase: readonly object[];
  readonly agotada: boolean;
  /** Verdadero si la búsqueda saltó al menos una hoja binaria (criterio 167, R16-1). */
  readonly conBinarios: boolean;
}

/** Recorre el grafo de `raiz` por niveles y junta los errores de la base (sin entrar en ellos ni en las `CausaLimpia`). */
function buscarErroresDeLaBase(raiz: object): Busqueda {
  const vistos = new WeakSet<object>([raiz]);
  const deLaBase: object[] = [];
  let conBinarios = false;
  let pendientes: object[] = [raiz];
  let visitados = 1;
  for (let nivel = 0; pendientes.length > 0; nivel += 1) {
    const siguientes: object[] = [];
    for (const objeto of pendientes) {
      const claves = clavesDe(objeto);
      if (claves === undefined) return { deLaBase, agotada: true, conBinarios };
      const valores: unknown[] = [];
      for (const clave of claves) {
        const valor = leerClave(objeto, clave);
        // Una `cause` función no se llama nunca: pino la llamaría (criterio 168).
        if (clave === 'cause' && typeof valor === 'function') return { deLaBase, agotada: true, conBinarios };
        valores.push(valor);
      }
      // `cause` y `errors` por su nombre (getters y heredadas incluidas), fuera del tope de claves (criterio 168).
      const causa = leerClave(objeto, 'cause');
      if (typeof causa === 'function') return { deLaBase, agotada: true, conBinarios };
      valores.push(causa, leerClave(objeto, 'errors'));
      for (const valor of valores) {
        if (!esObjeto(valor) || vistos.has(valor)) continue;
        vistos.add(valor);
        if (esHojaBinaria(valor)) {
          conBinarios = true;
          continue;
        }
        if (valor instanceof CausaLimpia) continue;
        if (esErrorDeBase(valor)) {
          deLaBase.push(valor);
          continue;
        }
        visitados += 1;
        if (nivel + 1 > PROFUNDIDAD_MAXIMA || visitados > OBJETOS_MAXIMOS)
          return { deLaBase, agotada: true, conBinarios };
        siguientes.push(valor);
      }
    }
    pendientes = siguientes;
  }
  return { deLaBase, agotada: false, conBinarios };
}

interface MensajesDeLaBase {
  readonly textos: readonly string[];
  readonly verificables: boolean;
}

/** Los mensajes de los errores de la base encontrados; si alguno no se puede leer o no es una cadena, no son verificables. */
function mensajesDeLaBase(deLaBase: readonly object[]): MensajesDeLaBase {
  const textos: string[] = [];
  let verificables = true;
  for (const error of deLaBase) {
    let mensaje: unknown;
    try {
      mensaje = Reflect.get(error, 'message');
    } catch {
      verificables = false;
      continue;
    }
    if (typeof mensaje === 'string') {
      if (mensaje !== '') textos.push(mensaje);
    } else if (mensaje !== undefined) {
      verificables = false;
    }
  }
  return { textos, verificables };
}

/** Para `mensaje`: inclusión en los dos sentidos (criterio 165). Sin poder verificar, se toma por copia. */
const copia = (texto: string, de: MensajesDeLaBase): boolean =>
  !de.verificables || de.textos.some((m) => texto.includes(m) || m.includes(texto));

interface Contexto {
  readonly mensajes: MensajesDeLaBase;
  readonly colocados: Set<object>;
  readonly enCadena: WeakSet<object>;
}

/** Convierte el error y su cadena de `cause` y `errors`: los de la base a su forma limpia, los demás con `tipo`, `mensaje` y `pila`. */
function convertir(valor: unknown, nivel: number, contexto: Contexto): unknown {
  if (!esObjeto(valor)) return { tipo: typeof valor };
  if (valor instanceof CausaLimpia) return valor;
  if (esErrorDeBase(valor)) {
    contexto.colocados.add(valor);
    return limpio(valor);
  }
  if (!(valor instanceof Error)) return { tipo: typeof valor };
  if (nivel > PROFUNDIDAD_MAXIMA || contexto.enCadena.has(valor)) return { tipo: 'truncado' };
  contexto.enCadena.add(valor);
  const mensaje = leerSeguro(valor, 'message');
  const pila = pilaSinEncabezado(valor);
  const pilaCompleta = leerSeguro(valor, 'stack');
  const conservaMensaje = typeof mensaje === 'string' && !copia(mensaje, contexto.mensajes);
  const { textos, verificables } = contexto.mensajes;
  const conservaPila =
    pila !== undefined &&
    verificables &&
    typeof mensaje === 'string' &&
    typeof pilaCompleta === 'string' &&
    !textos.some((m) => mensaje.includes(m) || pilaCompleta.includes(m));
  const causa = leerSeguro(valor, 'cause');
  const varios = leerSeguro(valor, 'errors');
  return {
    tipo: nombreDeClase(valor),
    ...(conservaMensaje ? { mensaje } : {}),
    ...(conservaPila ? { pila } : {}),
    ...(causa === undefined ? {} : { causa: convertir(causa, nivel + 1, contexto) }),
    ...(Array.isArray(varios)
      ? { errores: (varios as unknown[]).slice(0, NIVELES_MAXIMOS).map((e) => convertir(e, nivel + 1, contexto)) }
      : {}),
  };
}

/**
 * Lo que se registra de un error (criterios 162, 165 y 166):
 * - un error de Prisma o de la base (`esErrorDeBase`), salvo una `CausaLimpia`: un objeto con solo `tipo` (de la lista cerrada),
 *   `codigoPrisma`, `sqlstate`, `codigoDeSistema`, `modelo` y `pila` (los marcos);
 * - un `Error` con un error de la base en cualquier propiedad de su grafo: un objeto nuevo con solo `tipo`, `mensaje`, `pila`,
 *   `causa`, `errores`, `erroresDeLaBase` y `truncado`; si un tope se agota, falla cerrada `{ tipo, truncado: true }`;
 * - un `Error` con un binario (`Buffer`, arreglo tipado, `ArrayBuffer`…) en su grafo, aunque sin errores de la base: la misma forma
 *   convertida, sin el binario (criterio 167, R16-1); si se agota un tope o hay una `cause` función (nunca se llama, criterio 168),
 *   falla cerrada;
 * - cualquier otro `Error` (también una `CausaLimpia` y un `ErrorTransaccionAbortada`): el mismo objeto;
 * - lo que no es un `Error`: `{ tipo: typeof valor }`, nunca su valor.
 */
export function errorParaRegistro(error: unknown): unknown {
  try {
    if (!(error instanceof Error)) return { tipo: typeof error };
    if (error instanceof CausaLimpia) return error;
    if (esErrorDeBase(error)) return limpio(error);
    const { deLaBase, agotada, conBinarios } = buscarErroresDeLaBase(error);
    if (deLaBase.length === 0 && !agotada && !conBinarios) return error;
    if (agotada) {
      const encontrados = deLaBase.slice(0, DE_LA_BASE_MAXIMOS).map(limpio);
      return {
        tipo: nombreDeClase(error),
        truncado: true,
        ...(encontrados.length > 0 ? { erroresDeLaBase: encontrados } : {}),
      };
    }
    const contexto: Contexto = { mensajes: mensajesDeLaBase(deLaBase), colocados: new Set(), enCadena: new WeakSet() };
    const convertido = convertir(error, 0, contexto) as Record<string, unknown>;
    const otros = deLaBase.filter((e) => !contexto.colocados.has(e));
    return {
      ...convertido,
      ...(otros.length > 0 ? { erroresDeLaBase: otros.slice(0, DE_LA_BASE_MAXIMOS).map(limpio) } : {}),
      ...(otros.length > DE_LA_BASE_MAXIMOS ? { truncado: true } : {}),
    };
  } catch {
    return { tipo: 'Error' };
  }
}
