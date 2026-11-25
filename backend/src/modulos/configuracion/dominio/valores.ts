import {
  type ActualizarConfiguracion,
  CAMPOS_CONFIGURACION,
  CAMPOS_DATOS_DE_PAGO,
  type CampoConfiguracion,
  type CampoDatoDePago,
  CLAVES_CONFIGURACION,
  type ConfiguracionAcademia,
  configuracionAcademiaSchema,
  CONFIGURACION_POR_DEFECTO,
} from '@aquagestion/contratos';

/**
 * Valores de la configuración de una academia (spec 003): funciones puras, sin base de datos ni reloj. Una clave sin fila, o con un
 * valor guardado que no cumple la tabla de claves de los contratos, vale lo de por defecto (criterios 1 a 3 y 16). Desde la 007b, la tabla suma
 * los datos de pago (criterio 53 de la spec 007): su valor por defecto es «sin valor» y la configuración efectiva solo trae los que tienen uno.
 */

/** Todos los campos de la tabla, en su orden: los de siempre y, después, los datos de pago. */
const TODOS_LOS_CAMPOS: readonly (CampoConfiguracion | CampoDatoDePago)[] = [
  ...CAMPOS_CONFIGURACION,
  ...CAMPOS_DATOS_DE_PAGO,
];
type Campo = CampoConfiguracion | CampoDatoDePago;

function esDatoDePago(campo: Campo): campo is CampoDatoDePago {
  return (CAMPOS_DATOS_DE_PAGO as readonly string[]).includes(campo);
}

/** El valor de un campo sin fila: el de la tabla de los contratos o, en un dato de pago, ninguno (`null`). */
function porDefectoDe(campo: Campo): unknown {
  return esDatoDePago(campo) ? null : CONFIGURACION_POR_DEFECTO[campo];
}

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
const CAMPO_DE_CLAVE: ReadonlyMap<string, Campo> = new Map(
  TODOS_LOS_CAMPOS.map((campo) => [CLAVES_CONFIGURACION[campo].clave, campo] as const),
);

/** Las claves de la base que usa la configuración, en el orden de la tabla. */
export const CLAVES_EN_BASE: readonly string[] = TODOS_LOS_CAMPOS.map((campo) => CLAVES_CONFIGURACION[campo].clave);

/**
 * Valida un valor guardado con el esquema de su campo. Sin convertir ni recortar: lo guardado ya debe estar normalizado, así que
 * un teléfono con espacios en los extremos o un texto con dígitos en un campo numérico es inválido.
 */
function validar<C extends Campo>(
  campo: C,
  guardado: unknown,
): { ok: true; valor: ConfiguracionAcademia[C] } | { ok: false } {
  // Un dato de pago quitado se guarda como `null`: es «sin valor», no un valor inválido.
  if (esDatoDePago(campo) && guardado === null) return { ok: true, valor: null as ConfiguracionAcademia[C] };
  const resultado = configuracionAcademiaSchema.shape[campo].safeParse(guardado);
  if (!resultado.success || resultado.data !== guardado) return { ok: false };
  return { ok: true, valor: resultado.data as ConfiguracionAcademia[C] };
}

/**
 * El valor efectivo de un campo. `fila` es `undefined` si la academia no tiene la fila: vale lo de por defecto. Si la tiene y no es
 * válido, también vale lo de por defecto y se marca `invalido`.
 */
export function valorEfectivo<C extends Campo>(
  campo: C,
  fila: FilaDeConfiguracion | undefined,
): ValorEfectivo<ConfiguracionAcademia[C]> {
  const porDefecto = porDefectoDe(campo) as ConfiguracionAcademia[C];
  if (fila === undefined) return { valor: porDefecto, invalido: false };
  const comprobado = validar(campo, fila.valor);
  return comprobado.ok ? { valor: comprobado.valor, invalido: false } : { valor: porDefecto, invalido: true };
}

/** La fila de cada campo, ignorando las claves desconocidas. Si una clave se repitiera, vale la última. */
function filasPorCampo(filas: readonly FilaDeConfiguracion[]): Map<Campo, FilaDeConfiguracion> {
  const porCampo = new Map<Campo, FilaDeConfiguracion>();
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

/**
 * Los valores efectivos a partir de las filas de la academia: los seis de siempre y, solo si tienen valor, los datos de pago. Las claves que
 * no son del contrato se ignoran.
 */
export function configuracionEfectiva(filas: readonly FilaDeConfiguracion[]): ConfiguracionCalculada {
  const porCampo = filasPorCampo(filas);
  const configuracion: { -readonly [C in Campo]?: ConfiguracionAcademia[C] } = { ...CONFIGURACION_POR_DEFECTO };
  const clavesInvalidas: string[] = [];
  for (const campo of TODOS_LOS_CAMPOS) {
    const efectivo = valorEfectivo(campo, porCampo.get(campo));
    // `as never`: TypeScript no relaciona el tipo del campo con el de su valor dentro de un bucle genérico.
    if (!esDatoDePago(campo) || (efectivo.valor !== null && efectivo.valor !== undefined)) {
      configuracion[campo] = efectivo.valor as never;
    }
    if (efectivo.invalido) clavesInvalidas.push(CLAVES_CONFIGURACION[campo].clave);
  }
  return { configuracion: configuracion as ConfiguracionAcademia, clavesInvalidas };
}

/** Un campo que el `PATCH` debe escribir, con su valor efectivo de antes y el nuevo (para la auditoría). */
export interface CambioPedido {
  readonly campo: Campo;
  readonly clave: string;
  readonly antes: ConfiguracionAcademia[Campo];
  readonly despues: ConfiguracionAcademia[Campo];
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
  for (const campo of TODOS_LOS_CAMPOS) {
    const nuevo = pedido[campo];
    if (nuevo === undefined) continue;
    const fila = porCampo.get(campo);
    const antes = valorEfectivo(campo, fila).valor;
    const hayQueEscribir = fila === undefined ? nuevo !== porDefectoDe(campo) : fila.valor !== nuevo;
    if (hayQueEscribir) cambios.push({ campo, clave: CLAVES_CONFIGURACION[campo].clave, antes, despues: nuevo });
  }
  return cambios;
}

/** La configuración efectiva con los cambios ya escritos encima (lo que responde el `PATCH`). */
export function aplicarCambios(base: ConfiguracionAcademia, cambios: readonly CambioPedido[]): ConfiguracionAcademia {
  const resultado: { -readonly [C in Campo]?: ConfiguracionAcademia[C] } = { ...base };
  for (const cambio of cambios) {
    // Un dato de pago que se quita (`null`) deja de estar en la respuesta.
    if (esDatoDePago(cambio.campo) && cambio.despues === null) delete resultado[cambio.campo];
    else resultado[cambio.campo] = cambio.despues as never;
  }
  return resultado as ConfiguracionAcademia;
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
