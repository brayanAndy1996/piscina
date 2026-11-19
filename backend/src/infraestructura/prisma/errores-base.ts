/**
 * Lectura del código de error de PostgreSQL (SQLSTATE) en los errores de Prisma y de su adaptador (spec 001, criterio 114,
 * precisión P-25). Los módulos no importan `Prisma`: usan estas dos funciones desde el punto autorizado.
 */

const UNICIDAD = '23505';

/** Un SQLSTATE: cinco caracteres de clase conocida. Descarta los códigos de Prisma (`P2002`) y de Node (`EPERM`). */
const PATRON_SQLSTATE = /^(?:[0-5][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/;

const esRegistro = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null;

const sqlstateDe = (valor: unknown): string | null =>
  typeof valor === 'string' && PATRON_SQLSTATE.test(valor) ? valor : null;

/** Lee una propiedad sin dejar que un getter lance (los errores del registro nunca deben fallar al leerse). */
export function leerSeguro(valor: unknown, clave: string): unknown {
  try {
    return esRegistro(valor) ? valor[clave] : undefined;
  } catch {
    return undefined;
  }
}

/** Los lugares donde puede viajar el SQLSTATE: el error mismo, su `cause` y `meta.driverAdapterError.cause` de Prisma. */
function candidatos(error: Record<string, unknown>): unknown[] {
  const causa = leerSeguro(error, 'cause');
  const delAdaptador = leerSeguro(leerSeguro(error, 'meta'), 'driverAdapterError');
  const causaDelAdaptador = leerSeguro(delAdaptador, 'cause');
  return [
    leerSeguro(error, 'originalCode'),
    leerSeguro(error, 'code'),
    leerSeguro(causa, 'originalCode'),
    leerSeguro(causa, 'code'),
    leerSeguro(causaDelAdaptador, 'originalCode'),
    leerSeguro(causaDelAdaptador, 'code'),
    leerSeguro(leerSeguro(error, 'meta'), 'code'),
  ];
}

/** El SQLSTATE de cinco caracteres de un error de la base (de Prisma o del adaptador), o `null` si no es de la base. */
export function codigoDeErrorDeBase(error: unknown): string | null {
  if (!esRegistro(error)) return null;
  for (const candidato of candidatos(error)) {
    const codigo = sqlstateDe(candidato);
    if (codigo) return codigo;
  }
  return leerSeguro(error, 'code') === 'P2002' ? UNICIDAD : null;
}

/** Verdadero con el código `P2002` de Prisma o con el SQLSTATE `23505` (violación de una restricción única). */
export function esViolacionDeUnicidad(error: unknown): boolean {
  return codigoDeErrorDeBase(error) === UNICIDAD || leerSeguro(error, 'code') === 'P2002';
}

/** El nombre de una restricción o índice que dice el error, si es un texto (`constraint` de `pg` o `constraint.index` del adaptador). */
function nombreDeRestriccion(valor: unknown): string | null {
  if (typeof valor === 'string') return valor.length > 0 ? valor : null;
  const indice = leerSeguro(valor, 'index');
  return typeof indice === 'string' && indice.length > 0 ? indice : null;
}

/**
 * El nombre de la restricción única que violó el error (por ejemplo `clases_nivel_bloque_activo_key`), tomado de los campos
 * estructurados del error y nunca de su mensaje: `meta.driverAdapterError.cause.constraint.index` en un `$queryRaw` de Prisma 7, o
 * `constraint` en el error del adaptador. `null` si el error no es una violación de unicidad o no trae el nombre.
 */
export function restriccionDeUnicidadViolada(error: unknown): string | null {
  if (!esViolacionDeUnicidad(error)) return null;
  const causa = leerSeguro(error, 'cause');
  const causaDelAdaptador = leerSeguro(leerSeguro(leerSeguro(error, 'meta'), 'driverAdapterError'), 'cause');
  for (const lugar of [causaDelAdaptador, causa, error]) {
    const nombre = nombreDeRestriccion(leerSeguro(lugar, 'constraint'));
    if (nombre) return nombre;
  }
  return null;
}
