/** Valores permitidos de `NODE_ENV` (spec 001, criterio 78): igualdad exacta, sin recorte ni cambio de mayúsculas. */
export const VALORES_NODE_ENV = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof VALORES_NODE_ENV)[number];

/** Mensaje de `NODE_ENV` inválida: nombra la variable y los valores permitidos, nunca el valor recibido. */
export const MENSAJE_NODE_ENV_INVALIDA = `La variable NODE_ENV debe ser ${VALORES_NODE_ENV.join(', ')}.`;

export type LecturaNodeEnv =
  { readonly ok: true; readonly valor: NodeEnv | undefined } | { readonly ok: false; readonly problema: string };

/**
 * Lee `NODE_ENV`. Ausente: se comporta fuera de producción (`valor` indefinido). Definida, aunque sea vacía: debe ser
 * exactamente `development`, `test` o `production`. La usan `validarEntorno` y la semilla. No depende de nada más,
 * para que la semilla funcione en un clon recién instalado.
 */
export function leerNodeEnv(env: Readonly<Record<string, string | undefined>>): LecturaNodeEnv {
  const valor = env['NODE_ENV'];
  if (valor === undefined) return { ok: true, valor: undefined };
  if ((VALORES_NODE_ENV as readonly string[]).includes(valor)) return { ok: true, valor: valor as NodeEnv };
  return { ok: false, problema: MENSAJE_NODE_ENV_INVALIDA };
}
