import { describe, expect, it } from 'vitest';
import { iniciarSesionPlataformaSchema, respuestaSesionPlataformaSchema, superadminSesionSchema } from './index';

const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';

describe('iniciarSesionPlataformaSchema (criterios 36 y 42)', () => {
  it('recorta y pasa a minúsculas el correo y deja la clave tal cual', () => {
    expect(
      iniciarSesionPlataformaSchema.parse({ correo: '  Super.Admin@AquaGestion.test ', clave: '  Clave 123  ' }),
    ).toEqual({ correo: 'super.admin@aquagestion.test', clave: '  Clave 123  ' });
  });

  it('acepta un correo de exactamente 254 caracteres y una clave de 1 y de 128 caracteres', () => {
    const local = 'a'.repeat(64);
    const dominio = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    const correo = `${local}@${dominio}`;
    expect(correo).toHaveLength(254);
    expect(iniciarSesionPlataformaSchema.safeParse({ correo, clave: 'x' }).success).toBe(true);
    expect(iniciarSesionPlataformaSchema.safeParse({ correo: 'a@b.co', clave: 'x'.repeat(128) }).success).toBe(true);
  });

  it.each([
    ['correo de más de 254 caracteres', { correo: `${'a'.repeat(250)}@b.co`, clave: 'x' }],
    ['correo inválido', { correo: 'no-es-un-correo', clave: 'x' }],
    ['correo vacío', { correo: '', clave: 'x' }],
    ['clave vacía', { correo: 'a@b.co', clave: '' }],
    ['clave de 129 caracteres', { correo: 'a@b.co', clave: 'x'.repeat(129) }],
    ['sin clave', { correo: 'a@b.co' }],
    ['sin correo', { clave: 'x' }],
    ['campo de más', { correo: 'a@b.co', clave: 'x', recordarme: true }],
    ['clave que no es texto', { correo: 'a@b.co', clave: 12345 }],
    ['cuerpo ausente', undefined],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(iniciarSesionPlataformaSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('respuestaSesionPlataformaSchema (criterio 36)', () => {
  const superadmin = { id: ID, correo: 'superadmin@aquagestion.test', nombre: 'Superadmin' };

  it('acepta { superadmin: { id, correo, nombre } }', () => {
    expect(respuestaSesionPlataformaSchema.parse({ superadmin })).toEqual({ superadmin });
    expect(superadminSesionSchema.parse(superadmin)).toEqual(superadmin);
  });

  it.each([
    ['con el hash de la clave', { superadmin: { ...superadmin, claveHash: '$argon2id$...' } }],
    ['con un token', { superadmin, token: 'abc' }],
    ['con un id que no es UUID', { superadmin: { ...superadmin, id: '1' } }],
    ['sin nombre', { superadmin: { id: ID, correo: superadmin.correo } }],
  ])('rechaza una respuesta %s', (_nombre, valor) => {
    expect(respuestaSesionPlataformaSchema.safeParse(valor).success).toBe(false);
  });
});
