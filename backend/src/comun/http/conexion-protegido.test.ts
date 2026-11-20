// spec: 005-inscripcion-publica (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Criterio 59 (crítico, DR-8, DR-15, nota O2 de 001; respuesta R4, ronda 1): la función pura `claveDeConexion(ip)` agrupa las direcciones
// de los límites por conexión (criterios 25, 33, 49 y 60):
//   - una IPv4 da la misma dirección;
//   - una IPv6 mapeada a IPv4, en cualquier forma escrita, da la IPv4;
//   - cualquier otra IPv6 da su bloque /64 en forma canónica (`2001:db8:1:2::/64`); la zona de una IPv6 de enlace local se ignora;
//     `::1` da `::/64`, distinta de cualquier IPv4;
//   - un texto que no es una IP (o la IP vacía) da el mismo texto, sin lanzar errores.
// Los casos están escritos a mano, de forma independiente de la implementación.

type ClaveDeConexion = (ip: string) => string;

async function cargar(): Promise<ClaveDeConexion> {
  const ruta = path.join(__dirname, 'conexion.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 005a: no se pudo cargar "backend/src/comun/http/conexion.ts" (${motivo}).`,
      { cause: error },
    );
  }
  if (typeof modulo['claveDeConexion'] !== 'function') {
    throw new Error('Falta la funcionalidad de la 005a: "comun/http/conexion.ts" no exporta claveDeConexion.');
  }
  return modulo['claveDeConexion'] as ClaveDeConexion;
}

describe('criterio 59: claveDeConexion', () => {
  it.each(['203.0.113.1', '198.51.100.9', '127.0.0.1', '0.0.0.0', '255.255.255.255'])(
    'criterio 59: la IPv4 %s da la misma dirección',
    async (ip) => {
      expect((await cargar())(ip)).toBe(ip);
    },
  );

  it.each([
    '::ffff:203.0.113.1',
    '::FFFF:203.0.113.1',
    '0:0:0:0:0:ffff:203.0.113.1',
    '::ffff:cb00:7101',
    '::FFFF:CB00:7101',
    '0000:0000:0000:0000:0000:ffff:cb00:7101',
    '0:0:0:0:0:FFFF:cb00:7101',
  ])('criterio 59: la IPv6 mapeada %s da la IPv4 203.0.113.1', async (ip) => {
    expect((await cargar())(ip)).toBe('203.0.113.1');
  });

  it('criterio 59: la IPv6 mapeada de loopback (como llega desde el propio equipo) da 127.0.0.1', async () => {
    expect((await cargar())('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it.each([
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:0:0:0:abc', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::', '2001:db8:1:2::/64'],
    ['2001:db8:1:3::1', '2001:db8:1:3::/64'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8::/64'],
    ['2001:db8:0:0:1::1', '2001:db8::/64'],
    ['2001:db8:1::5', '2001:db8:1::/64'],
    ['2001:0:0:1:abcd::1', '2001:0:0:1::/64'],
    ['fe80::1%eth0', 'fe80::/64'],
    ['fe80::1', 'fe80::/64'],
    ['::1', '::/64'],
    ['::', '::/64'],
  ])('criterio 59: la IPv6 %s da el bloque %s', async (ip, esperado) => {
    expect((await cargar())(ip)).toBe(esperado);
  });

  it('criterio 59: las direcciones del mismo /64 dan la misma clave y las de otro /64 dan otra', async () => {
    const clave = await cargar();
    const mismas = [
      '2001:db8:1:2::1',
      '2001:DB8:1:2::1',
      '2001:0db8:0001:0002:ffff:ffff:ffff:ffff',
      '2001:db8:1:2:0:0:0:abc',
    ];

    expect(new Set(mismas.map((ip) => clave(ip))).size).toBe(1);
    expect(clave('2001:db8:1:3::1')).not.toBe(clave('2001:db8:1:2::1'));
    expect(clave('2001:db9:1:2::1')).not.toBe(clave('2001:db8:1:2::1'));
  });

  it('criterio 59: la clave de ::1 es distinta de cualquier IPv4 (también de la de loopback)', async () => {
    const clave = await cargar();

    expect(clave('::1')).not.toBe(clave('127.0.0.1'));
    expect(clave('::1')).not.toBe(clave('0.0.0.0'));
    expect(clave('::ffff:0.0.0.1')).toBe('0.0.0.1');
    expect(clave('::ffff:0.0.0.1')).not.toBe(clave('::1'));
  });

  it.each([
    ['', ''],
    ['no-es-una-ip', 'no-es-una-ip'],
    ['unknown', 'unknown'],
    ['999.1.1.1', '999.1.1.1'],
    ['203.0.113', '203.0.113'],
    ['2001:db8:::1', '2001:db8:::1'],
    ['2001:db8::zz', '2001:db8::zz'],
    ['1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9'],
    ['a'.repeat(300), 'a'.repeat(300)],
  ])('criterio 59: el texto %j, que no es una IP, da el mismo texto y no lanza', async (ip, esperado) => {
    const clave = await cargar();

    expect(() => clave(ip)).not.toThrow();
    expect(clave(ip)).toBe(esperado);
  });
});
