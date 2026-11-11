/**
 * Fechas que la API lee de la base (spec 001, criterio 108, precisión P-27). Si algo escapa a los parámetros de formato que
 * `BaseDatos` fija en cada transacción (criterio 107), el adaptador de Prisma puede devolver un `Invalid Date`. Decidir o
 * responder con esa fecha daría una respuesta silenciosamente equivocada (por ejemplo, una cuenta que nunca se bloquea): estas
 * funciones fallan cerrado con un error interno, que el filtro global traduce a 500 `ERROR_INTERNO` y registra sin datos.
 */

/** Error interno: una fecha leída de la base no es un `Date` válido. El mensaje no incluye ningún dato de la fila. */
export class ErrorFechaDeBaseInvalida extends Error {
  constructor() {
    super('Una fecha leída de la base de datos no es válida.');
    this.name = 'ErrorFechaDeBaseInvalida';
  }
}

/** Devuelve el `Date` válido, o lanza `ErrorFechaDeBaseInvalida` si el valor no lo es. */
export function fechaDeBase(valor: unknown): Date {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  throw new ErrorFechaDeBaseInvalida();
}

/** Como `fechaDeBase`, pero acepta `null` (columna sin valor). */
export function fechaDeBaseONula(valor: unknown): Date | null {
  return valor === null ? null : fechaDeBase(valor);
}
