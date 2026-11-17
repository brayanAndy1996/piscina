import type { ConfiguracionAcademia } from '@aquagestion/contratos';
import { join, type TransaccionAcademia } from '../../infraestructura/prisma';
import { CLAVES_EN_BASE, configuracionEfectiva, type FilaDeConfiguracion } from './dominio/valores';

/** El registro técnico que usan las funciones de este archivo: solo `warn`, para poder pasarle el de cualquier servicio. */
export interface RegistroDeAvisos {
  warn(contexto: object, mensaje: string): void;
}

export interface OpcionesDeLectura {
  /** Si se pasa, cada fila con un valor inválido se anota como aviso (la academia y la clave, nunca el valor). */
  readonly registro?: RegistroDeAvisos;
}

/**
 * Las filas de `configuraciones` de la academia de la transacción, con una sola sentencia `SELECT`: siempre la misma, exista o no
 * cada fila. La comparten `leerConfiguracion` y el `PATCH`. Sin caché: cada llamada consulta la base.
 */
export async function leerFilasDeConfiguracion(tx: TransaccionAcademia): Promise<FilaDeConfiguracion[]> {
  return tx.cliente.$queryRaw<FilaDeConfiguracion[]>`
    SELECT clave, valor FROM configuraciones
     WHERE academia_id = ${tx.academiaId}::uuid AND clave IN (${join(CLAVES_EN_BASE)})`;
}

/** Anota en el registro técnico las claves con un valor guardado inválido: la academia y la clave, sin el valor (criterio 3). */
export function avisarValoresInvalidos(
  registro: RegistroDeAvisos | undefined,
  academiaId: string,
  clavesInvalidas: readonly string[],
): void {
  if (registro === undefined) return;
  for (const clave of clavesInvalidas) {
    registro.warn({ academiaId, clave }, 'Valor de configuración inválido: se usa el valor por defecto');
  }
}

/**
 * Los valores efectivos de la configuración de `tx.academiaId` (spec 003, criterio 6): lo guardado si es válido y, si no hay fila o
 * no es válido, el valor por defecto de la tabla de claves de los contratos. Hace una sola consulta dentro de la transacción de
 * quien llama y no guarda nada entre llamadas: un cambio confirmado se ve en la siguiente.
 *
 * Es una función sin Nest (como `insertarEnAuditoriaDeAcademia`) para que cualquier módulo la use dentro de su transacción sin
 * depender del módulo de configuración. Regla para las historias siguientes: leer la configuración con la `tx` de la operación que
 * la necesita, sin caché.
 */
export async function leerConfiguracion(
  tx: TransaccionAcademia,
  opciones: OpcionesDeLectura = {},
): Promise<ConfiguracionAcademia> {
  const filas = await leerFilasDeConfiguracion(tx);
  const { configuracion, clavesInvalidas } = configuracionEfectiva(filas);
  avisarValoresInvalidos(opciones.registro, tx.academiaId, clavesInvalidas);
  return configuracion;
}
