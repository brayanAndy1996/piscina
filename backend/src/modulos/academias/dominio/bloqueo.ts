/**
 * Reglas del bloqueo por intentos fallidos del Superadmin (D-07, DR-3 de la spec 001): 5 fallos seguidos bloquean la
 * cuenta 15 minutos. Son funciones puras, sin base de datos ni reloj propio: reciben la hora, así se prueban los
 * bordes. La atomicidad frente a intentos simultáneos la da el bloqueo de la fila (`SELECT ... FOR UPDATE`) en quien
 * las llama.
 */
export interface ReglasBloqueo {
  /** Intentos fallidos seguidos que bloquean la cuenta. */
  readonly maximoIntentos: number;
  /** Minutos que dura el bloqueo. */
  readonly minutosBloqueo: number;
}

export const REGLAS_BLOQUEO_SUPERADMIN: ReglasBloqueo = { maximoIntentos: 5, minutosBloqueo: 15 };

export interface EstadoBloqueo {
  readonly intentosFallidos: number;
  readonly bloqueadoHasta: Date | null;
}

/** La cuenta está bloqueada mientras `bloqueadoHasta` sea posterior a `ahora`; cumplido el plazo, ya no. */
export function estaBloqueado(estado: EstadoBloqueo, ahora: Date): boolean {
  return estado.bloqueadoHasta !== null && estado.bloqueadoHasta.getTime() > ahora.getTime();
}

export type ResultadoIntentoFallido =
  /** La cuenta ya estaba bloqueada: no se cambia nada (otro intento la bloqueó antes). */
  | { readonly tipo: 'YA_BLOQUEADA' }
  /** Nuevo estado tras contar el fallo; `bloquea` es verdadero si este fallo es el que la bloquea. */
  | { readonly tipo: 'FALLO'; readonly estado: EstadoBloqueo; readonly bloquea: boolean };

/**
 * Cuenta un intento fallido. Si la cuenta estaba bloqueada, no cambia nada. Si un bloqueo anterior ya venció, el conteo
 * vuelve a empezar desde 1. Al llegar al máximo, se bloquea hasta `ahora + minutosBloqueo` y el contador queda en el
 * valor alcanzado.
 */
export function evaluarIntentoFallido(
  estado: EstadoBloqueo,
  ahora: Date,
  reglas: ReglasBloqueo = REGLAS_BLOQUEO_SUPERADMIN,
): ResultadoIntentoFallido {
  if (estaBloqueado(estado, ahora)) return { tipo: 'YA_BLOQUEADA' };
  const bloqueoVencido = estado.bloqueadoHasta !== null;
  const intentosFallidos = (bloqueoVencido ? 0 : estado.intentosFallidos) + 1;
  if (intentosFallidos >= reglas.maximoIntentos) {
    const bloqueadoHasta = new Date(ahora.getTime() + reglas.minutosBloqueo * 60_000);
    return { tipo: 'FALLO', estado: { intentosFallidos, bloqueadoHasta }, bloquea: true };
  }
  return { tipo: 'FALLO', estado: { intentosFallidos, bloqueadoHasta: null }, bloquea: false };
}

/** Estado tras un ingreso correcto: contador en 0 y sin bloqueo. */
export const ESTADO_SIN_FALLOS: EstadoBloqueo = { intentosFallidos: 0, bloqueadoHasta: null };
