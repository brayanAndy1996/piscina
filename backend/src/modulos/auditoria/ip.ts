import { isIP, isIPv6 } from 'node:net';

/**
 * Normaliza la IP que se guarda en la auditoría (spec 001, criterio 152, P-37). La columna es `inet`, que no admite la zona
 * de una IPv6 de enlace local (`fe80::1%eth0`, que es como Node la entrega).
 *
 * - `null` o `undefined`: `null` (actor `SISTEMA` sin IP).
 * - Una IPv4 o una IPv6 sin zona (incluida la IPv4 mapeada): el mismo texto.
 * - Un texto con `%` cuya parte anterior al primer `%` es una IPv6 válida: esa parte (`fe80::1%eth0` y `fe80::1%25eth0` dan
 *   `fe80::1`).
 * - Cualquier otro texto: lanza un `Error` cuyo mensaje no repite lo recibido. La operación entera falla; nunca se guarda
 *   `NULL` en lugar de una IP recibida que no se pudo normalizar.
 */
export function ipParaAuditoria(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  const corte = typeof ip === 'string' ? ip.indexOf('%') : -1;
  const sinZona = corte === -1 ? ip : ip.slice(0, corte);
  const valida = typeof sinZona === 'string' && (corte === -1 ? isIP(sinZona) !== 0 : isIPv6(sinZona));
  if (!valida) throw new Error('La IP de la petición no es válida para la auditoría.');
  return sinZona;
}
