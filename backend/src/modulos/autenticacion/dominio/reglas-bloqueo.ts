import type { ReglasBloqueo } from '../../academias/dominio/bloqueo';

/**
 * Bloqueo por intentos fallidos de las cuentas de una academia (D-07, DR-3 de la spec 002): 5 fallos seguidos bloquean la
 * cuenta 15 minutos. Son constantes hasta que la historia 003 las haga configurables por academia. Las funciones
 * `estaBloqueado` y `evaluarIntentoFallido` son las de la historia 001 (`academias/dominio/bloqueo.ts`).
 */
export const REGLAS_BLOQUEO_USUARIO: ReglasBloqueo = { maximoIntentos: 5, minutosBloqueo: 15 };
