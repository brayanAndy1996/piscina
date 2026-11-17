import {
  type ActualizarConfiguracion,
  CAMPOS_CONFIGURACION,
  type CampoConfiguracion,
  CLAVES_CONFIGURACION,
  type ConfiguracionAcademia,
  configuracionAcademiaSchema,
  CONFIGURACION_POR_DEFECTO,
} from '@aquagestion/contratos';

/**
 * Valores de la configuración de una academia (spec 003): funciones puras, sin base de datos ni reloj. Una clave sin fila, o con un
 * valor guardado que no cumple la tabla de claves de los contratos, vale lo de por defecto (criterios 1 a 3 y 16).
 */

/** Una fila de `configuraciones` tal como se lee: la clave de la base y el JSON guardado. */
export interface FilaDeConfiguracion {
  readonly clave: string;
  readonly valor: unknown;
}

export interface ValorEfectivo<T> {
  readonly valor: T;
  /** `true` si había una fila pero su valor no cumple la tabla de claves (se usa el valor por defecto). */
  readonly invalido: boolean;
}

/** Campo de la API de cada clave de la base; las claves que no están aquí se ignoran. */
const CAMPO_DE_CLAVE: ReadonlyMap<string, CampoConfiguracion> = new Map(
  CAMPOS_CONFIGURACION.map((campo) => [CLAVES_CONFIGURACION[campo].clave, campo] as const),
);

/** Las claves de la base que usa la configuración, en el orden de la tabla. */
export const CLAVES_EN_BASE: readonly string[] = CAMPOS_CONFIGURACION.map((campo) => CLAVES_CONFIGURACION[campo].clave);

/**
 * Valida un valor guardado con el esquema de su campo. Sin convertir ni recortar: lo guardado ya debe estar normalizado, así que
 * un teléfono con espacios en los extremos o un texto con dígitos en un campo numérico es inválido.
 */
function validar<C extends CampoConfiguracion>(
  campo: C,
  guardado: unknown,
): { ok: true; valor: ConfiguracionAcademia[C] } | { ok: false } {
  const resultado = configuracionAcademiaSchema.shape[campo].safeParse(guardado);
  if (!resultado.success || resultado.data !== guardado) return { ok: false };
  return { ok: true, valor: resultado.data as ConfiguracionAcademia[C] };
}

/**
 * El valor efectivo de un campo. `fila` es `undefined` si la academia no tiene la fila: vale lo de por defecto. Si la tiene y no es
 * válido, también vale lo de por defecto y se marca `invalido`.
 */
export function valorEfectivo<C extends CampoConfiguracion>(
  campo: C,
  fila: FilaDeConfiguracion | undefined,
): ValorEfectivo<ConfiguracionAcademia[C]> {
  const porDefecto = CONFIGURACION_POR_DEFECTO[campo];
  if (fila === undefined) return { valor: porDefecto, invalido: false };
  const comprobado = validar(campo, fila.valor);
  return comprobado.ok ? { valor: comprobado.valor, invalido: false } : { valor: porDefecto, invalido: true };
}

/** La fila de cada campo, ignorando las claves desconocidas. Si una clave se repitiera, vale la última. */
function filasPorCampo(filas: readonly FilaDeConfiguracion[]): Map<CampoConfiguracion, FilaDeConfiguracion> {
  const porCampo = new Map<CampoConfiguracion, FilaDeConfiguracion>();
  for (const fila of filas) {
    const campo = CAMPO_DE_CLAVE.get(fila.clave);
    if (campo !== undefined) porCampo.set(campo, fila);
  }
  return porCampo;
}

export interface ConfiguracionCalculada {
  readonly configuracion: ConfiguracionAcademia;
  /** Claves de la base con una fila cuyo valor no es válido (nunca el valor guardado). */
  readonly clavesInvalidas: readonly string[];
}

/** Los seis valores efectivos a partir de las filas de la academia. Las claves que no son del contrato se ignoran. */
export function configuracionEfectiva(filas: readonly FilaDeConfiguracion[]): ConfiguracionCalculada {
  const porCampo = filasPorCampo(filas);
  const configuracion: { -readonly [C in CampoConfiguracion]: ConfiguracionAcademia[C] } = {
    ...CONFIGURACION_POR_DEFECTO,
  };
  const clavesInvalidas: string[] = [];
  for (const campo of CAMPOS_CONFIGURACION) {
    const efectivo = valorEfectivo(campo, porCampo.get(campo));
    // `as never`: TypeScript no relaciona el tipo del campo con el de su valor dentro de un bucle genérico.
    configuracion[campo] = efectivo.valor as never;
    if (efectivo.invalido) clavesInvalidas.push(CLAVES_CONFIGURACION[campo].clave);
  }
  return { configuracion, clavesInvalidas };
}

/** Un campo que el `PATCH` debe escribir, con su valor efectivo de antes y el nuevo (para la auditoría). */
export interface CambioPedido {
  readonly campo: CampoConfiguracion;
  readonly clave: string;
  readonly antes: ConfiguracionAcademia[CampoConfiguracion];
  readonly despues: ConfiguracionAcademia[CampoConfiguracion];
}

/**
 * Los campos del pedido que hay que escribir (criterio 9), en el orden de la tabla de claves. Se escribe si no hay fila y el valor
 * pedido no es el de por defecto, o si hay fila y lo guardado no es exactamente el valor pedido (una fila inválida siempre se
 * reescribe, aunque el valor pedido sea el de por defecto). Los campos que no vienen en el pedido no se tocan.
 */
export function cambiosPedidos(
  filas: readonly FilaDeConfiguracion[],
  pedido: ActualizarConfiguracion,
): readonly CambioPedido[] {
  const porCampo = filasPorCampo(filas);
  const cambios: CambioPedido[] = [];
  for (const campo of CAMPOS_CONFIGURACION) {
    const nuevo = pedido[campo];
    if (nuevo === undefined) continue;
    const fila = porCampo.get(campo);
    const antes = valorEfectivo(campo, fila).valor;
    const hayQueEscribir = fila === undefined ? nuevo !== CONFIGURACION_POR_DEFECTO[campo] : fila.valor !== nuevo;
    if (hayQueEscribir) cambios.push({ campo, clave: CLAVES_CONFIGURACION[campo].clave, antes, despues: nuevo });
  }
  return cambios;
}

/** La configuración efectiva con los cambios ya escritos encima (lo que responde el `PATCH`). */
export function aplicarCambios(base: ConfiguracionAcademia, cambios: readonly CambioPedido[]): ConfiguracionAcademia {
  const resultado: { -readonly [C in CampoConfiguracion]: ConfiguracionAcademia[C] } = { ...base };
  for (const cambio of cambios) resultado[cambio.campo] = cambio.despues as never;
  return resultado;
}

/** `datosAntes` y `datosDespues` de la auditoría: solo los campos que cambiaron, con los nombres de la API. */
export function datosDeAuditoria(cambios: readonly CambioPedido[]): {
  datosAntes: Record<string, unknown>;
  datosDespues: Record<string, unknown>;
} {
  const datosAntes: Record<string, unknown> = {};
  const datosDespues: Record<string, unknown> = {};
  for (const cambio of cambios) {
    datosAntes[cambio.campo] = cambio.antes;
    datosDespues[cambio.campo] = cambio.despues;
  }
  return { datosAntes, datosDespues };
}
