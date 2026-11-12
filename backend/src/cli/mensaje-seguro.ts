import { errorParaRegistro, esErrorDeBase, CausaLimpia } from '../infraestructura/prisma';

const TIPOS_DE_BASE: ReadonlySet<string> = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'DriverAdapterError',
  'DatabaseError',
  'CausaLimpia',
  'ErrorDeBase',
]);

const esRegistro = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null;

/** ¿Es la forma limpia de un error de la base (con códigos o con un `tipo` de la lista cerrada)? */
function esLimpioDeLaBase(valor: Record<string, unknown>): boolean {
  if (valor instanceof CausaLimpia) return true;
  return (
    typeof valor['codigoPrisma'] === 'string' ||
    typeof valor['sqlstate'] === 'string' ||
    typeof valor['codigoDeSistema'] === 'string' ||
    (typeof valor['tipo'] === 'string' && TIPOS_DE_BASE.has(valor['tipo']))
  );
}

/** Lo mismo con la forma de la `CausaLimpia`, cuyo SQLSTATE viaja en `code`. */
function comoLimpio(valor: Record<string, unknown>): Record<string, unknown> {
  if (!(valor instanceof CausaLimpia)) return valor;
  return {
    tipo: valor.tipo,
    ...(valor.codigoPrisma === undefined ? {} : { codigoPrisma: valor.codigoPrisma }),
    ...(valor.code === undefined ? {} : { sqlstate: valor.code }),
  };
}

/** El primer error de la base del resultado de `errorParaRegistro`: en `causa` y `errores` a lo hondo y luego en `erroresDeLaBase`. */
function primeroDeLaBase(valor: unknown, vistos = new Set<unknown>()): Record<string, unknown> | undefined {
  if (!esRegistro(valor) || vistos.has(valor)) return undefined;
  vistos.add(valor);
  if (esLimpioDeLaBase(valor)) return comoLimpio(valor);
  const hijos: unknown[] = [valor['causa']];
  const errores = valor['errores'];
  if (Array.isArray(errores)) hijos.push(...(errores as unknown[]));
  const deLaBase = valor['erroresDeLaBase'];
  if (Array.isArray(deLaBase)) hijos.push(...(deLaBase as unknown[]));
  for (const hijo of hijos) {
    const encontrado = primeroDeLaBase(hijo, vistos);
    if (encontrado !== undefined) return encontrado;
  }
  return undefined;
}

/**
 * Texto de un error de la base para mostrar (criterio 162): solo el tipo y los códigos, nunca el mensaje de Prisma, que puede
 * llevar los valores de la consulta (Ley 29733). Recibe la forma limpia que da `errorParaRegistro`.
 */
function textoDeErrorDeBase(datos: Record<string, unknown>): string {
  const partes: string[] = [];
  if (typeof datos['tipo'] === 'string') partes.push(datos['tipo']);
  if (typeof datos['codigoPrisma'] === 'string') partes.push(datos['codigoPrisma']);
  if (typeof datos['sqlstate'] === 'string') partes.push(`SQLSTATE ${datos['sqlstate']}`);
  if (typeof datos['codigoDeSistema'] === 'string') partes.push(datos['codigoDeSistema']);
  return `error de la base (${partes.join(', ')})`;
}

/** El texto de un `Error` (criterio 165): su mensaje, o el del primer error de la base que lleva, o que no hay detalles. */
function textoDeError(error: Error): string {
  const registrado = errorParaRegistro(error);
  if (registrado === error) return error.message;
  const resultado = esRegistro(registrado) ? registrado : {};
  if (typeof resultado['mensaje'] === 'string') return resultado['mensaje'];
  const base = primeroDeLaBase(resultado);
  if (base !== undefined) return textoDeErrorDeBase(base);
  return `error sin detalles (${String(resultado['tipo'])})`;
}

/**
 * Texto de un error apto para mostrar: sin la URL de conexión, sin la contraseña de la base ni los secretos que se
 * indiquen (por ejemplo, la clave del superadmin), y de a lo sumo 300 caracteres. Un error de Prisma o de la base se resume en su
 * tipo y sus códigos (criterio 162); un `Error` que lleva uno en cualquier propiedad, en su mensaje o en los códigos (criterio 165).
 */
export function mensajeSeguro(error: unknown, secretos: readonly (string | undefined)[]): string {
  let texto: string;
  if (esErrorDeBase(error) && !(error instanceof CausaLimpia)) {
    texto = textoDeErrorDeBase(errorParaRegistro(error) as Record<string, unknown>);
  } else if (error instanceof Error) {
    texto = textoDeError(error);
  } else {
    texto = String(error);
  }
  for (const secreto of secretos) {
    if (secreto) texto = texto.split(secreto).join('***');
  }
  for (const secreto of secretos) {
    if (!secreto) continue;
    try {
      const { password } = new URL(secreto);
      if (password) texto = texto.split(decodeURIComponent(password)).join('***');
    } catch {
      // No es una URL: ya se reemplazó el texto completo.
    }
  }
  const primeraLinea = texto.split('\n').find((linea) => linea.trim() !== '') ?? 'error desconocido';
  return primeraLinea.length > 300 ? `${primeraLinea.slice(0, 300)}…` : primeraLinea;
}
