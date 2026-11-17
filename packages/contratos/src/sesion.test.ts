import { describe, expect, it } from 'vitest';
import {
  cambiarClaveSchema,
  claveNuevaSchema,
  dniSchema,
  iniciarSesionAcademiaSchema,
  respuestaSesionAcademiaSchema,
} from './index';

const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';

describe('dniSchema (criterio 44)', () => {
  it.each([
    ['12345678', '12345678'],
    ['  12345678  ', '12345678'],
    ['01234567', '01234567'],
    ['00000000', '00000000'],
  ])('acepta %j y lo deja como %j (texto recortado)', (entrada, esperado) => {
    expect(dniSchema.parse(entrada)).toBe(esperado);
  });

  it.each([
    '',
    '   ',
    '1234567',
    '123456789',
    '1234567a',
    '1234-5678',
    '1234 5678',
    '1234\u00005678',
    '１２３４５６７８',
    '12345678\n9',
  ])('rechaza %j', (entrada) => {
    expect(dniSchema.safeParse(entrada).success).toBe(false);
  });

  it('rechaza lo que no es texto', () => {
    expect(dniSchema.safeParse(12345678).success).toBe(false);
    expect(dniSchema.safeParse(null).success).toBe(false);
    expect(dniSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('iniciarSesionAcademiaSchema (criterios 13 y 44)', () => {
  it('recorta el usuario y deja la clave tal cual, sin recortarla', () => {
    expect(iniciarSesionAcademiaSchema.parse({ usuario: ' 12345678 ', clave: '  Clave 1  ' })).toEqual({
      usuario: '12345678',
      clave: '  Clave 1  ',
    });
  });

  it('acepta una clave de 1 y de 128 caracteres, y de 128 emojis (puntos de código)', () => {
    expect(iniciarSesionAcademiaSchema.safeParse({ usuario: '12345678', clave: 'x' }).success).toBe(true);
    expect(iniciarSesionAcademiaSchema.safeParse({ usuario: '12345678', clave: 'x'.repeat(128) }).success).toBe(true);
    expect(iniciarSesionAcademiaSchema.safeParse({ usuario: '12345678', clave: '🏊'.repeat(128) }).success).toBe(true);
  });

  it.each([
    ['clave vacía', { usuario: '12345678', clave: '' }],
    ['clave de 129 caracteres', { usuario: '12345678', clave: 'x'.repeat(129) }],
    ['clave de 129 emojis', { usuario: '12345678', clave: '🏊'.repeat(129) }],
    ['clave con un control', { usuario: '12345678', clave: 'clave\u0000mala' }],
    ['clave con un salto de línea', { usuario: '12345678', clave: 'clave\nmala' }],
    ['clave que no es texto', { usuario: '12345678', clave: 12345 }],
    ['usuario de 7 dígitos', { usuario: '1234567', clave: 'x' }],
    ['usuario con letras', { usuario: '1234567a', clave: 'x' }],
    ['usuario que es un número', { usuario: 12345678, clave: 'x' }],
    ['sin usuario', { clave: 'x' }],
    ['sin clave', { usuario: '12345678' }],
    ['campo de más', { usuario: '12345678', clave: 'x', recordarme: true }],
    ['una academia de más', { usuario: '12345678', clave: 'x', academiaId: ID }],
    ['cuerpo ausente', undefined],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(iniciarSesionAcademiaSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('claveNuevaSchema (criterios 23 y 44)', () => {
  it.each([
    ['de exactamente 8 caracteres', 'Abcdefg8'],
    ['de exactamente 128 caracteres', 'x'.repeat(128)],
    ['de 8 emojis (16 unidades UTF-16)', '🏊'.repeat(8)],
    ['de 128 emojis', '🏊'.repeat(128)],
    ['con tildes y eñes', 'Contraseña-ñandú'],
    ['con espacios en los extremos', '  clave con espacios  '],
  ])('acepta una clave %s y no la recorta ni la normaliza', (_nombre, clave) => {
    expect(claveNuevaSchema.parse(clave)).toBe(clave);
  });

  it.each([
    ['vacía', ''],
    ['de 7 caracteres', 'Abcdef7'],
    ['de 7 emojis (14 unidades UTF-16)', '🏊'.repeat(7)],
    ['de 129 caracteres', 'x'.repeat(129)],
    ['de 129 emojis', '🏊'.repeat(129)],
    ['con un control', 'Clave\u0000con-control'],
    ['con un salto de línea', 'Clave-con\nsalto-1'],
    ['con un tabulador', 'Clave-con\ttab-1'],
    ['con un sustituto suelto', 'Clave-con-\ud800-suelto'],
  ])('rechaza una clave %s', (_nombre, clave) => {
    expect(claveNuevaSchema.safeParse(clave).success).toBe(false);
  });
});

describe('cambiarClaveSchema (criterios 23 y 44)', () => {
  it('acepta la clave actual y la nueva', () => {
    expect(cambiarClaveSchema.parse({ claveActual: '12345678', claveNueva: 'Una-Clave-2026' })).toEqual({
      claveActual: '12345678',
      claveNueva: 'Una-Clave-2026',
    });
  });

  it('informa el campo claveNueva cuando la nueva no cumple', () => {
    const resultado = cambiarClaveSchema.safeParse({ claveActual: 'x', claveNueva: 'corta' });

    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues.map((problema) => problema.path.join('.'))).toContain('claveNueva');
  });

  it.each([
    ['sin claveNueva', { claveActual: 'x' }],
    ['sin claveActual', { claveNueva: 'Una-Clave-2026' }],
    ['claveActual vacía', { claveActual: '', claveNueva: 'Una-Clave-2026' }],
    ['claveActual de 129 caracteres', { claveActual: 'x'.repeat(129), claveNueva: 'Una-Clave-2026' }],
    ['campo de más', { claveActual: 'x', claveNueva: 'Una-Clave-2026', cerrarSesiones: true }],
    ['claveNueva que no es texto', { claveActual: 'x', claveNueva: 12345678 }],
    ['cuerpo ausente', undefined],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(cambiarClaveSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('respuestaSesionAcademiaSchema (criterio 44)', () => {
  const usuario = {
    id: ID,
    nombres: 'Rosa',
    apellidos: 'Alvarez',
    rol: 'ADMIN',
    debeCambiarClave: false,
    academia: { nombreCorto: 'delfines', nombre: 'Los Delfines' },
  };

  it('acepta el usuario de la sesión', () => {
    expect(respuestaSesionAcademiaSchema.parse({ usuario })).toEqual({ usuario });
  });

  it.each([
    ['el DNI', { ...usuario, dni: '12345678' }],
    ['el hash', { ...usuario, claveHash: '$argon2id$x' }],
    ['la versión de token', { ...usuario, versionToken: 1 }],
  ])('rechaza un usuario que trae %s (esquema estricto)', (_nombre, otro) => {
    expect(respuestaSesionAcademiaSchema.safeParse({ usuario: otro }).success).toBe(false);
  });

  it('rechaza un rol que no existe y una academia con campos de más', () => {
    expect(respuestaSesionAcademiaSchema.safeParse({ usuario: { ...usuario, rol: 'SUPERADMIN' } }).success).toBe(false);
    expect(
      respuestaSesionAcademiaSchema.safeParse({
        usuario: { ...usuario, academia: { nombreCorto: 'delfines', nombre: 'Los Delfines', id: ID } },
      }).success,
    ).toBe(false);
  });
});
