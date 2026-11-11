import jwt from 'jsonwebtoken';

/** Lo que lleva el token de sesión (JWT HS256). `iat` y `exp` están en segundos desde 1970, tomados del reloj. */
export interface ClaimsSesion {
  /** Id de quien inicia sesión. */
  readonly sub: string;
  /** Qué tipo de sesión es (por ejemplo `plataforma`): un token de un tipo no sirve para otro. */
  readonly tipo: string;
  /** Versión de token del usuario: subirla en la base invalida todos sus tokens anteriores. */
  readonly ver: number;
  readonly iat: number;
  readonly exp: number;
}

const ALGORITMO = 'HS256';

function aSegundos(fecha: Date): number {
  return Math.floor(fecha.getTime() / 1000);
}

/**
 * Firma un JWT HS256 con `iat` igual a `ahora` y `exp = iat + duracionSegundos`. La hora la da quien llama (el reloj
 * inyectable), nunca la del sistema, para poder probar los bordes de vencimiento.
 */
export function firmarToken(
  datos: Pick<ClaimsSesion, 'sub' | 'tipo' | 'ver'>,
  secreto: string,
  ahora: Date,
  duracionSegundos: number,
): string {
  const iat = aSegundos(ahora);
  const claims: ClaimsSesion = { sub: datos.sub, tipo: datos.tipo, ver: datos.ver, iat, exp: iat + duracionSegundos };
  return jwt.sign(claims, secreto, { algorithm: ALGORITMO });
}

/**
 * Verifica la firma (solo HS256: rechaza `none` y cualquier otro algoritmo) y el vencimiento según `ahora`. Devuelve
 * los claims de sesión, o `null` si el token no es válido por cualquier motivo: no distingue el motivo a propósito.
 * Un token sin `sub`, `tipo`, `ver`, `iat` o `exp` con el tipo correcto tampoco es válido.
 */
export function verificarToken(token: string, secreto: string, ahora: Date): ClaimsSesion | null {
  let carga: string | jwt.JwtPayload;
  try {
    carga = jwt.verify(token, secreto, { algorithms: [ALGORITMO], clockTimestamp: aSegundos(ahora) });
  } catch {
    return null;
  }
  if (typeof carga === 'string') return null;
  const { sub, tipo, ver, iat, exp } = carga as Record<string, unknown>;
  if (
    typeof sub !== 'string' ||
    typeof tipo !== 'string' ||
    typeof ver !== 'number' ||
    !Number.isInteger(ver) ||
    typeof iat !== 'number' ||
    typeof exp !== 'number'
  ) {
    return null;
  }
  return { sub, tipo, ver, iat, exp };
}
