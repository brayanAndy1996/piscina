import { isIPv4, isIPv6 } from 'node:net';

/**
 * Clave de conexión de una petición (spec 005, criterio 59; DR-8, DR-15). Agrupa las direcciones para los límites por conexión (criterios
 * 25, 33, 49 y 60):
 *
 * - una IPv4 da la misma dirección;
 * - una IPv6 mapeada a IPv4 (`::ffff:203.0.113.1`, en cualquier forma escrita) da la IPv4;
 * - cualquier otra IPv6 da su bloque /64 en forma canónica (RFC 5952: minúsculas, sin ceros a la izquierda y la racha más larga de
 *   grupos en cero como `::`), por ejemplo `2001:db8:1:2::/64`; la zona de una IPv6 de enlace local (`%eth0`) se ignora;
 * - un texto que no es una IP (o la IP vacía) da el mismo texto, sin lanzar errores.
 *
 * Es una función pura, sin dependencias de la red ni del reloj. Un cliente IPv6 suele recibir un /64 entero, así que contar por
 * dirección exacta dejaría saltarse los límites con solo cambiar de dirección.
 */
export function claveDeConexion(ip: string): string {
  try {
    if (isIPv4(ip)) return ip;
    const base = ip.includes('%') ? ip.slice(0, ip.indexOf('%')) : ip;
    if (!isIPv6(base)) return ip;
    const grupos = expandirIPv6(base);
    if (grupos === null) return ip;
    if (grupos.slice(0, 5).every((grupo) => grupo === 0) && grupos[5] === 0xffff) {
      const alto = grupos[6] ?? 0;
      const bajo = grupos[7] ?? 0;
      return `${alto >> 8}.${alto & 0xff}.${bajo >> 8}.${bajo & 0xff}`;
    }
    const bloque = [...grupos.slice(0, 4), 0, 0, 0, 0];
    return `${escribirCanonica(bloque)}/64`;
  } catch {
    return ip;
  }
}

/** Los ocho grupos de 16 bits de una IPv6 ya validada con `net.isIPv6` (con `::`, IPv4 al final o mayúsculas), o `null` si no se puede. */
function expandirIPv6(texto: string): number[] | null {
  let cuerpo = texto;
  const ultimoDosPuntos = cuerpo.lastIndexOf(':');
  const cola = cuerpo.slice(ultimoDosPuntos + 1);
  if (cola.includes('.')) {
    // IPv4 al final: se reescribe como dos grupos hexadecimales.
    if (!isIPv4(cola)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = cola.split('.').map((octeto) => Number(octeto));
    cuerpo = `${cuerpo.slice(0, ultimoDosPuntos + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const partes = cuerpo.split('::');
  if (partes.length > 2) return null;
  const aGrupos = (parte: string | undefined): number[] | null => {
    if (parte === undefined || parte === '') return [];
    const resultado: number[] = [];
    for (const grupo of parte.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(grupo)) return null;
      resultado.push(parseInt(grupo, 16));
    }
    return resultado;
  };
  const cabeza = aGrupos(partes[0]);
  const resto = partes.length === 2 ? aGrupos(partes[1]) : [];
  if (cabeza === null || resto === null) return null;
  const conocidos = [...cabeza, ...resto];
  if (partes.length === 1) {
    return conocidos.length === 8 ? conocidos : null;
  }
  const faltan = 8 - conocidos.length;
  if (faltan < 1) return null;
  return [...cabeza, ...new Array<number>(faltan).fill(0), ...resto];
}

/** Forma canónica de RFC 5952 de ocho grupos: la racha más larga (de al menos dos) de ceros se escribe `::`; la primera si hay empate. */
function escribirCanonica(grupos: readonly number[]): string {
  let inicioMejor = -1;
  let largoMejor = 0;
  let i = 0;
  while (i < grupos.length) {
    if (grupos[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < grupos.length && grupos[j] === 0) j++;
    if (j - i > largoMejor) {
      largoMejor = j - i;
      inicioMejor = i;
    }
    i = j;
  }
  const texto = (desde: number, hasta: number): string =>
    grupos
      .slice(desde, hasta)
      .map((grupo) => grupo.toString(16))
      .join(':');
  if (largoMejor < 2) return texto(0, grupos.length);
  return `${texto(0, inicioMejor)}::${texto(inicioMejor + largoMejor, grupos.length)}`;
}
