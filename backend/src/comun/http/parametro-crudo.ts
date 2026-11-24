import type { Request } from 'express';

/**
 * El valor crudo de un parámetro de la consulta, tal como llegó: `undefined` si no viene, el texto si viene una vez (también vacío) y un arreglo
 * si se repite o se escribe con corchetes (`nombre[]=…`, `nombre[x]=…`). Express 5 no arma arreglos ni objetos con esa forma, así que se mira la
 * dirección original. Un arreglo no pasa un esquema de texto: el 400 sale en ese campo (spec 005b criterio 38, spec 006b PQ3).
 */
export function parametroCrudo(solicitud: Request, nombre: string): string | string[] | undefined {
  const posicion = solicitud.originalUrl.indexOf('?');
  const parametros = new URLSearchParams(posicion === -1 ? '' : solicitud.originalUrl.slice(posicion + 1));
  const valores: string[] = [];
  let conCorchetes = false;
  for (const [clave, valor] of parametros) {
    if (clave === nombre) {
      valores.push(valor);
    } else if (clave.startsWith(`${nombre}[`)) {
      valores.push(valor);
      conCorchetes = true;
    }
  }
  if (valores.length === 0) return undefined;
  const [unico] = valores;
  return valores.length === 1 && !conCorchetes && unico !== undefined ? unico : valores;
}
