/** Un texto de enteros como número; cualquier otro texto se deja tal cual para que el esquema compartido lo rechace con su mensaje. */
export function numeroODeTexto(texto: string): number | string {
  const recortado = texto.trim();
  return /^-?[0-9]+$/.test(recortado) ? Number(recortado) : recortado;
}
