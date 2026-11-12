import { errorParaRegistro, esErrorDeBase, CausaLimpia } from '../infraestructura/prisma';

/**
 * Texto de un error de la base para mostrar (criterio 162): solo el tipo y los códigos, nunca el mensaje de Prisma, que puede
 * llevar los valores de la consulta (Ley 29733).
 */
function textoDeErrorDeBase(error: unknown): string {
  const datos = errorParaRegistro(error) as Record<string, unknown>;
  const partes: string[] = [];
  if (typeof datos['tipo'] === 'string') partes.push(datos['tipo']);
  if (typeof datos['codigoPrisma'] === 'string') partes.push(datos['codigoPrisma']);
  if (typeof datos['sqlstate'] === 'string') partes.push(`SQLSTATE ${datos['sqlstate']}`);
  if (typeof datos['codigoDeSistema'] === 'string') partes.push(datos['codigoDeSistema']);
  return `error de la base (${partes.join(', ')})`;
}

/**
 * Texto de un error apto para mostrar: sin la URL de conexión, sin la contraseña de la base ni los secretos que se
 * indiquen (por ejemplo, la clave del superadmin), y de a lo sumo 300 caracteres. Un error de Prisma o de la base se resume en su
 * tipo y sus códigos (criterio 162).
 */
export function mensajeSeguro(error: unknown, secretos: readonly (string | undefined)[]): string {
  let texto =
    esErrorDeBase(error) && !(error instanceof CausaLimpia)
      ? textoDeErrorDeBase(error)
      : error instanceof Error
        ? error.message
        : String(error);
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
