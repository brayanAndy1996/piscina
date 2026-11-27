/**
 * Un valor como JSON ASCII para una cabecera HTTP: una cabecera solo admite caracteres de un byte, y un número de operación puede traer
 * dígitos de ancho completo, que la API normaliza. Cada carácter fuera de ASCII imprimible va como `\uXXXX`.
 */
export function jsonParaCabecera(valor: unknown): string {
  return JSON.stringify(valor).replace(
    /[^\x20-\x7e]/g,
    (caracter) => `\\u${caracter.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
