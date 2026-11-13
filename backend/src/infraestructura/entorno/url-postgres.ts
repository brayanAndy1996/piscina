/**
 * Parámetros de conexión que el cliente `pg` (con `pg-connection-string`) toma de la cadena de consulta por encima de la
 * parte principal de la URL (spec 001, criterio 143, precisión P-34). Una URL que los lleve podría conectar con otro
 * usuario, otro servidor u otra base que los de la parte principal. La lista es igual en `scripts/lib/entorno.mjs`.
 */
export const PARAMETROS_DE_CONEXION_PROHIBIDOS: readonly string[] = [
  'user',
  'host',
  'hostaddr',
  'password',
  'port',
  'dbname',
  'database',
];

/**
 * Nombres de `PARAMETROS_DE_CONEXION_PROHIBIDOS` presentes en la cadena de consulta de `url`: en minúsculas, sin repetir y
 * en el orden en que aparecen. `[]` si no hay. No devuelve ni registra valores. Lanza `TypeError` si `url` no es una URL
 * que `new URL` acepte (falla cerrada: quien la llama ya validó el formato).
 */
export function parametrosDeConexionProhibidos(url: string): string[] {
  const encontrados: string[] = [];
  for (const nombre of new URL(url).searchParams.keys()) {
    const minusculas = nombre.toLowerCase();
    if (PARAMETROS_DE_CONEXION_PROHIBIDOS.includes(minusculas) && !encontrados.includes(minusculas)) {
      encontrados.push(minusculas);
    }
  }
  return encontrados;
}
