import { randomBytes } from 'node:crypto';

let ultimoMilisegundo = 0;
let contador = 0;

/**
 * Un UUID (versión 7) que ordena por el instante en que se creó: 48 bits de milisegundos de la `fecha_hora` de la fila (la del reloj inyectable), 12 bits de un contador que no
 * retrocede dentro del proceso y el resto al azar. La auditoría se lee `ORDER BY fecha_hora, id`: dos filas con la misma `fecha_hora`
 * (varias operaciones en el mismo milisegundo, o con el reloj fijo de las pruebas) quedan en el orden en que se registraron y no en el de
 * un UUID al azar. No es un secreto ni una credencial: el id de una fila de auditoría solo identifica la fila. Con varias instancias de la
 * API el orden entre ellas es el de sus relojes.
 */
export function idDeAuditoriaOrdenado(fechaHora: Date): string {
  let milisegundo = Math.max(fechaHora.getTime(), ultimoMilisegundo);
  if (milisegundo === ultimoMilisegundo) {
    contador += 1;
    if (contador > 0xfff) {
      milisegundo += 1;
      contador = 0;
    }
  } else {
    contador = 0;
  }
  ultimoMilisegundo = milisegundo;
  const cola = randomBytes(8);
  // Variante RFC 4122: los dos bits altos del primer byte de la cola son `10`.
  cola[0] = ((cola[0] ?? 0) & 0x3f) | 0x80;
  const hexa = milisegundo.toString(16).padStart(12, '0');
  const alto = (0x7000 | contador).toString(16).padStart(4, '0');
  const bajo = cola.toString('hex');
  return `${hexa.slice(0, 8)}-${hexa.slice(8, 12)}-${alto}-${bajo.slice(0, 4)}-${bajo.slice(4)}`;
}
