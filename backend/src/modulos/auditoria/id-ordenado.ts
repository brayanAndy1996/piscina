import { randomBytes } from 'node:crypto';

/** El último milisegundo que cabe en los 48 bits del UUID versión 7. */
const ULTIMO_MILISEGUNDO = 2 ** 48 - 1;
/** El contador ocupa 12 bits. */
const MAXIMO_CONTADOR = 0xfff;

/**
 * El `getTime` de `Date.prototype`, guardado al cargar el módulo: comprueba la ranura interna del valor sin consultar su prototipo ni sus propiedades,
 * y un reemplazo posterior de `Date.prototype.getTime` en el proceso no cambia la decisión.
 */
// eslint-disable-next-line @typescript-eslint/unbound-method -- se usa siempre con `.call(valor)`
const leerInstante = Date.prototype.getTime;

let ultimoMilisegundo = 0;
let contador = 0;

/**
 * Un UUID (versión 7) que ordena por el instante en que se creó: 48 bits de milisegundos de la `fecha_hora` de la fila (la del reloj inyectable), 12 bits de un contador que no
 * retrocede dentro del proceso y el resto al azar. La auditoría se lee `ORDER BY fecha_hora, id`: dos filas con la misma `fecha_hora`
 * (varias operaciones en el mismo milisegundo, o con el reloj fijo de las pruebas) quedan en el orden en que se registraron y no en el de
 * un UUID al azar. No es un secreto ni una credencial: el id de una fila de auditoría solo identifica la fila. Con varias instancias de la
 * API el orden entre ellas es el de sus relojes.
 *
 * Un `Date` es un valor con la ranura interna de fecha, sin importar su prototipo ni el contexto donde se creó (`vm`, subclases, prototipo cambiado); su
 * instante es el de la ranura, no el de un `getTime` propio. No se usa `instanceof`: consulta el prototipo y un `Proxy` puede hacerlo lanzar.
 *
 * @throws RangeError (sin cambiar el estado del generador) con un valor sin la ranura de fecha (primitivo, `null`, objeto, `Proxy`), con una fecha inválida,
 * anterior a 1970 o que no cabe en 48 bits, y cuando el contador desborda en el último milisegundo representable: no queda un id mayor que dar. El mensaje no
 * lleva la causa ni la fecha.
 */
export function idDeAuditoriaOrdenado(fechaHora: Date): string {
  // Se valida antes de tocar el estado: una fecha no válida no cambia ni el último milisegundo ni el contador.
  // La única operación sobre el valor es `leerInstante.call`: cualquier error (primitivo, objeto sin la ranura, `Proxy`, revocado o no) es un valor que no es un Date.
  let instante: number;
  try {
    instante = leerInstante.call(fechaHora);
  } catch {
    throw new RangeError('La fecha de la auditoría no es un Date.');
  }
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
