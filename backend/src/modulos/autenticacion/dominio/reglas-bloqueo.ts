import type { ConfiguracionAcademia } from '@aquagestion/contratos';
import type { ReglasBloqueo } from '../../academias/dominio/bloqueo';

/**
 * Bloqueo por intentos fallidos de las cuentas de una academia (D-07, DR-3 de la spec 002): con los valores por defecto, 5 fallos
 * seguidos bloquean la cuenta 15 minutos. Desde la spec 003 son valores de cada academia (`intentosInicioSesion` y
 * `minutosBloqueo` de la configuración, ya validados y con su valor por defecto si faltan o son inválidos). Las funciones
 * `estaBloqueado` y `evaluarIntentoFallido` son las de la historia 001 (`academias/dominio/bloqueo.ts`). El bloqueo del Superadmin
 * sigue fijo (`REGLAS_BLOQUEO_SUPERADMIN`, criterio 18 de 003).
 */
export function reglasBloqueoDe(
  configuracion: Pick<ConfiguracionAcademia, 'intentosInicioSesion' | 'minutosBloqueo'>,
): ReglasBloqueo {
  return { maximoIntentos: configuracion.intentosInicioSesion, minutosBloqueo: configuracion.minutosBloqueo };
}

const MILISEGUNDOS_POR_MINUTO = 60_000;

/**
 * Los minutos que faltan para que termine un bloqueo (criterio 19 de la spec 003): se calculan con `bloqueado_hasta` y la hora del
 * reloj, redondeados hacia arriba y como mínimo 1. No leen nada más: un cambio de los minutos de bloqueo de la academia no
 * alarga ni acorta un bloqueo ya puesto. Sin fecha (o con una no válida) dicen 1.
 */
export function minutosRestantes(bloqueadoHasta: Date | null, ahora: Date): number {
  if (bloqueadoHasta === null) return 1;
  const faltan = Math.ceil((bloqueadoHasta.getTime() - ahora.getTime()) / MILISEGUNDOS_POR_MINUTO);
  return Number.isFinite(faltan) ? Math.max(1, faltan) : 1;
}
