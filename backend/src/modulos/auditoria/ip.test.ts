// spec: 001-academias-aislamiento (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../../comun/errores';

// Criterio 152 (ataque ronda 10, O2; P-37): `ipParaAuditoria(ip)`, exportada desde `modulos/auditoria/index.ts`, es una funcion pura que da:
//   - con `null` o `undefined`: `null`;
//   - con una IPv4 o una IPv6 sin zona (incluida la IPv4 mapeada y `::1`): el mismo texto;
//   - con un texto que contiene `%` y cuya parte anterior al primer `%` es una IPv6 valida: esa parte (`fe80::1%eth0` y `fe80::1%25eth0`
//     dan `fe80::1`);
//   - con cualquier otro texto (vacio, solo espacios, una IP con espacios alrededor, `no-es-ip`, `203.0.113.5%eth0`, `%eth0`, `zz::1%eth0`):
//     lanza un `Error` (no un `ErrorNegocio`: es un 500) cuyo mensaje no contiene el texto recibido. Nunca devuelve `null` en lugar de una
//     IP recibida que no se pudo normalizar.
// Se carga con importacion dinamica y se tipa aqui con el contrato (antes de implementarla, la prueba falla con un mensaje claro).

type IpParaAuditoria = (ip: string | null | undefined) => string | null;

async function cargar(): Promise<IpParaAuditoria> {
  const ruta = pathToFileURL(path.join(__dirname, 'index.ts')).href;
  const modulo = (await import(/* @vite-ignore */ ruta)) as { ipParaAuditoria?: IpParaAuditoria };
  if (typeof modulo.ipParaAuditoria !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 001: "backend/src/modulos/auditoria/index.ts" no exporta ipParaAuditoria.',
    );
  }
  return modulo.ipParaAuditoria;
}

describe('criterio 152: ipParaAuditoria (P-37)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('criterio 152: con %s da null (actor SISTEMA sin IP, criterio 32)', async (_nombre, entrada) => {
    const ipParaAuditoria = await cargar();

    expect(ipParaAuditoria(entrada)).toBeNull();
  });

  it.each([
    ['una IPv4', '203.0.113.5'],
    ['la IPv4 de loopback', '127.0.0.1'],
    ['una IPv6 sin zona', '2001:db8::1'],
    ['una IPv6 de enlace local sin zona', 'fe80::1'],
    ['la IPv6 de loopback', '::1'],
    ['la IPv4 mapeada', '::ffff:203.0.113.5'],
    ['la IPv4 mapeada de loopback (la de supertest)', '::ffff:127.0.0.1'],
  ])('criterio 152: con %s da el mismo texto', async (_nombre, ip) => {
    const ipParaAuditoria = await cargar();

    expect(ipParaAuditoria(ip)).toBe(ip);
  });

  it.each([
    { ip: 'fe80::1%eth0', esperado: 'fe80::1' },
    { ip: 'fe80::1%25eth0', esperado: 'fe80::1' },
    { ip: 'fe80::abcd:1%en0', esperado: 'fe80::abcd:1' },
    { ip: '::1%lo', esperado: '::1' },
  ])(
    'criterio 152: con la IPv6 con zona $ip da la parte anterior al primer signo de porcentaje: $esperado',
    async ({ ip, esperado }) => {
      const ipParaAuditoria = await cargar();

      expect(ipParaAuditoria(ip)).toBe(esperado);
    },
  );

  it.each([
    ['vacio', ''],
    ['solo espacios', '   '],
    ['una IPv4 con espacios delante', ' 203.0.113.5'],
    ['una IPv4 con espacios detras', '203.0.113.5 '],
    ['una IPv6 con espacios alrededor', ' fe80::1 '],
    ['un texto que no es IP', 'no-es-ip'],
    ['una IPv4 con zona', '203.0.113.5%eth0'],
    ['solo la zona', '%eth0'],
    ['una IPv6 invalida con zona', 'zz::1%eth0'],
    ['una IPv4 incompleta', '203.0.113'],
    ['una IPv4 con octeto fuera de rango', '256.0.0.1'],
  ])('criterio 152: con %s lanza un Error cuyo mensaje no contiene el texto recibido', async (_nombre, ip) => {
    const ipParaAuditoria = await cargar();

    let lanzado: unknown;
    let devuelto: unknown;
    try {
      devuelto = ipParaAuditoria(ip);
    } catch (error) {
      lanzado = error;
    }

    expect(
      lanzado,
      `debia lanzar y devolvio ${JSON.stringify(devuelto)} (nunca null en lugar de una IP recibida)`,
    ).toBeInstanceOf(Error);
    expect(lanzado).not.toBeInstanceOf(ErrorNegocio);
    if (ip !== '') expect((lanzado as Error).message).not.toContain(ip);
  });
});
