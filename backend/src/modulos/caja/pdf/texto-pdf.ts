/**
 * Todo texto que sale de los datos (nombre de la academia, nombres, descripción, comprobante, observación y motivo) pasa por esta función
 * antes de escribirse en el PDF del cierre (spec 006b, PQ11). La fuente estándar del PDF (Helvetica, WinAnsi) solo muestra bien U+0020 a
 * U+007E y U+00A0 a U+00FF: todo lo demás (emojis, comillas curvas, caracteres de ancho cero, de dirección del texto, controles, saltos de
 * línea y sustitutos sueltos) se reemplaza por `?`, uno por punto de código. Primero se normaliza a NFC, así que `e` más U+0301 queda `é`.
 *
 * Es pura, idempotente y nunca lanza. La base no cambia: solo el PDF. Es la segunda capa después de los esquemas de la API (criterios 18,
 * 30 y 47), y cubre también los nombres y las filas escritas directo en la base.
 */
export function textoParaPdf(texto: string): string {
  let salida = '';
  // Iterar el texto da puntos de código completos: un emoji (dos unidades UTF-16) es un solo `?`, y un sustituto suelto también.
  for (const caracter of texto.normalize('NFC')) {
    const punto = caracter.codePointAt(0) ?? 0;
    salida += (punto >= 0x20 && punto <= 0x7e) || (punto >= 0xa0 && punto <= 0xff) ? caracter : '?';
  }
  return salida;
}
