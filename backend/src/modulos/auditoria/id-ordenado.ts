import { randomBytes } from 'node:crypto';

/** El último milisegundo que cabe en los 48 bits del UUID versión 7. */
const ULTIMO_MILISEGUNDO = 2 ** 48 - 1;
/** El contador ocupa 12 bits. */
const MAXIMO_CONTADOR = 0xfff;

let ultimoMilisegundo = 0;
let contador = 0;

/**
 * Un UUID (versión 7) que ordena por el instante en que se creó: 48 bits de milisegundos de la `fecha_hora` de la fila (la del reloj inyectable), 12 bits de un contador que no
 * retrocede dentro del proceso y el resto al azar. La auditoría se lee `ORDER BY fecha_hora, id`: dos filas con la misma `fecha_hora`
 * (varias operaciones en el mismo milisegundo, o con el reloj fijo de las pruebas) quedan en el orden en que se registraron y no en el de
 * un UUID al azar. No es un secreto ni una credencial: el id de una fila de auditoría solo identifica la fila. Con varias instancias de la
 * API el orden entre ellas es el de sus relojes.
 *
 * Lanza `RangeError` (sin cambiar el estado del generador) con un valor que no es un `Date`, con una fecha inválida, anterior a 1970 o que no cabe
 * en 48 bits, y cuando el contador desborda en el último milisegundo representable: no queda un id mayor que dar. El mensaje no lleva la fecha.
 */
export function idDeAuditoriaOrdenado(fechaHora: Date): string {
  // Se valida antes de tocar el estado: una fecha no válida no cambia ni el último milisegundo ni el contador.
  if (!(fechaHora instanceof Date)) {
    throw new RangeError('La fecha de la auditoría no es un Date.');
  }
  const instante = fechaHora.getTime();
  if (!Number.isSafeInteger(instante) || instante < 0 || instante > ULTIMO_MILISEGUNDO) {
    throw new RangeError('La fecha de la auditoría está fuera del rango que cabe en un id.');
  }
  // El estado nuevo se calcula en variables locales y se asigna solo al final, cuando ya no puede fallar.
  let milisegundo = Math.max(instante, ultimoMilisegundo);
  let siguienteContador: number;
  if (milisegundo === ultimoMilisegundo) {
    siguienteContador = contador + 1;
    if (siguienteContador > MAXIMO_CONTADOR) {
      milisegundo += 1;
      siguienteContador = 0;
    }
  } else {
    siguienteContador = 0;
  }
  if (milisegundo > ULTIMO_MILISEGUNDO) {
    throw new RangeError('No hay un id de auditoría mayor que el último que se puede dar.');
  }
  ultimoMilisegundo = milisegundo;
  contador = siguienteContador;
  const cola = randomBytes(8);
  // Variante RFC 4122: los dos bits altos del primer byte de la cola son `10`.
  cola[0] = ((cola[0] ?? 0) & 0x3f) | 0x80;
  const hexa = milisegundo.toString(16).padStart(12, '0');
  const alto = (0x7000 | contador).toString(16).padStart(4, '0');
  const bajo = cola.toString('hex');
  return `${hexa.slice(0, 8)}-${hexa.slice(8, 12)}-${alto}-${bajo.slice(0, 4)}-${bajo.slice(4)}`;
}
