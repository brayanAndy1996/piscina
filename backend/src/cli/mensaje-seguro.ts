/**
 * Texto de un error apto para mostrar: sin la URL de conexión, sin la contraseña de la base ni los secretos que se
 * indiquen (por ejemplo, la clave del superadmin), y de a lo sumo 300 caracteres.
 */
export function mensajeSeguro(error: unknown, secretos: readonly (string | undefined)[]): string {
  let texto = error instanceof Error ? error.message : String(error);
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
