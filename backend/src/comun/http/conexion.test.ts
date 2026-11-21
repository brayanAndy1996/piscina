import { describe, expect, it } from 'vitest';
import { claveDeConexion } from './conexion';

// Pruebas de apoyo (no protegidas) de `claveDeConexion` (spec 005, criterio 59): formas raras que la prueba protegida no recorre.
describe('claveDeConexion (apoyo)', () => {
  it.each([
    ['::ffff:0.0.0.0', '0.0.0.0'],
    ['::ffff:255.255.255.255', '255.255.255.255'],
    ['::ffff:ffff:ffff', '255.255.255.255'],
    ['0:0:0:0:0:ffff:0:1', '0.0.0.1'],
  ])('la IPv6 mapeada %s da la IPv4 %s', (ip, esperada) => {
    expect(claveDeConexion(ip)).toBe(esperada);
  });

  it.each([
    ['::203.0.113.1', '::/64'],
    ['::1.2.3.4', '::/64'],
    ['64:ff9b::203.0.113.1', '64:ff9b::/64'],
    ['2001:db8:1:2:3:4:5.6.7.8', '2001:db8:1:2::/64'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4::/64'],
    ['1::', '1::/64'],
    ['1:0:0:0:5::', '1::/64'],
    ['0:0:0:1::', '0:0:0:1::/64'],
    ['0:0:0:0:1::', '::/64'],
    ['fe80::1%25eth0', 'fe80::/64'],
    ['FE80::ABCD%eth0', 'fe80::/64'],
    ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:DB8:0000:0001::', '2001:db8:0:1::/64'],
    ['2001:db8:0:0:5:6:7:8', '2001:db8::/64'],
  ])('la IPv6 %s da %s', (ip, esperada) => {
    expect(claveDeConexion(ip)).toBe(esperada);
  });

  it.each([
    '1.2.3.4%eth0',
    '::ffff:1.2.3.4.5',
    ':::',
    '1::2::3',
    'g::1',
    '%',
    '  ',
    '203.0.113.1 ',
    ':',
    '12345::1',
    '1:2:3:4:5:6:7',
    '::ffff:256.1.1.1',
  ])('el texto %j no es una IP: se devuelve igual y no lanza', (texto) => {
    expect(() => claveDeConexion(texto)).not.toThrow();
    expect(claveDeConexion(texto)).toBe(texto);
  });
});
