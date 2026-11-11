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

/** Los lugares donde puede viajar el SQLSTATE: el error mismo, su `cause` y `meta.driverAdapterError.cause` de Prisma. */
function candidatos(error: Record<string, unknown>): unknown[] {
  const causa = esRegistro(error['cause']) ? error['cause'] : {};
  const meta = esRegistro(error['meta']) ? error['meta'] : {};
  const delAdaptador = esRegistro(meta['driverAdapterError']) ? meta['driverAdapterError'] : {};
  const causaDelAdaptador = esRegistro(delAdaptador['cause']) ? delAdaptador['cause'] : {};
  return [
    error['originalCode'],
    error['code'],
    causa['originalCode'],
    causa['code'],
    causaDelAdaptador['originalCode'],
    causaDelAdaptador['code'],
    meta['code'],
  ];
}

/** El SQLSTATE de cinco caracteres de un error de la base (de Prisma o del adaptador), o `null` si no es de la base. */
export function codigoDeErrorDeBase(error: unknown): string | null {
  if (!esRegistro(error)) return null;
  for (const candidato of candidatos(error)) {
    const codigo = sqlstateDe(candidato);
    if (codigo) return codigo;
  }
  return error['code'] === 'P2002' ? UNICIDAD : null;
}

/** Verdadero con el código `P2002` de Prisma o con el SQLSTATE `23505` (violación de una restricción única). */
export function esViolacionDeUnicidad(error: unknown): boolean {
  return codigoDeErrorDeBase(error) === UNICIDAD || (esRegistro(error) && error['code'] === 'P2002');
}
