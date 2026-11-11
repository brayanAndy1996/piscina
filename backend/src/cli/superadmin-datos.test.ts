import { iniciarSesionPlataformaSchema } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { hayDatosDeSuperadmin, leerDatosSuperadmin } from './superadmin-datos';

const VALIDAS = {
  SUPERADMIN_CORREO: 'dueno@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
  SUPERADMIN_CLAVE: 'Clave-Segura-2026',
};

describe('leerDatosSuperadmin', () => {
  it('con datos válidos devuelve el correo recortado y en minúsculas, el nombre recortado y la clave tal cual', () => {
    const lectura = leerDatosSuperadmin({
      SUPERADMIN_CORREO: '  Dueno@AquaGestion.TEST ',
      SUPERADMIN_NOMBRE: ' Dueño ',
      SUPERADMIN_CLAVE: ' clave con espacios 1 ',
    });

    expect(lectura).toEqual({
      ok: true,
      datos: { correo: 'dueno@aquagestion.test', nombre: 'Dueño', clave: ' clave con espacios 1 ' },
    });
  });

  it.each([
    ['correo sin arroba', { SUPERADMIN_CORREO: 'no-es-un-correo' }, 'SUPERADMIN_CORREO'],
    [
      'correo de más de 254 caracteres',
      { SUPERADMIN_CORREO: `${'a'.repeat(250)}@aquagestion.test` },
      'SUPERADMIN_CORREO',
    ],
    ['correo faltante', { SUPERADMIN_CORREO: undefined }, 'SUPERADMIN_CORREO'],
    ['correo vacío', { SUPERADMIN_CORREO: '' }, 'SUPERADMIN_CORREO'],
    ['nombre de 2 caracteres', { SUPERADMIN_NOMBRE: 'Ab' }, 'SUPERADMIN_NOMBRE'],
    ['nombre de 101 caracteres', { SUPERADMIN_NOMBRE: 'n'.repeat(101) }, 'SUPERADMIN_NOMBRE'],
    ['nombre de solo espacios', { SUPERADMIN_NOMBRE: '      ' }, 'SUPERADMIN_NOMBRE'],
    ['clave de 11 caracteres', { SUPERADMIN_CLAVE: 'Clave-corta' }, 'SUPERADMIN_CLAVE'],
    ['clave de 129 caracteres', { SUPERADMIN_CLAVE: 'x'.repeat(129) }, 'SUPERADMIN_CLAVE'],
    ['clave faltante', { SUPERADMIN_CLAVE: undefined }, 'SUPERADMIN_CLAVE'],
  ])('rechaza %s nombrando la variable y sin mostrar su valor', (_caso, cambio, variable) => {
    const entorno = { ...VALIDAS, ...cambio };

    const lectura = leerDatosSuperadmin(entorno);

    expect(lectura.ok).toBe(false);
    if (lectura.ok) return;
    expect(lectura.problemas.join('\n')).toContain(variable);
    for (const valor of Object.values(entorno)) {
      if (valor && valor.length > 8) expect(lectura.problemas.join('\n')).not.toContain(valor);
    }
  });

  it('acepta los límites: nombre de 3 y 100, clave de 12 y 128', () => {
    for (const [nombre, clave] of [
      ['Abc', 'a'.repeat(12)],
      ['n'.repeat(100), 'a'.repeat(128)],
    ] as const) {
      expect(leerDatosSuperadmin({ ...VALIDAS, SUPERADMIN_NOMBRE: nombre, SUPERADMIN_CLAVE: clave }).ok).toBe(true);
    }
  });

  it('informa todos los problemas a la vez', () => {
    const lectura = leerDatosSuperadmin({});

    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(lectura.problemas).toHaveLength(3);
  });

  it('valida el correo igual que el esquema de inicio de sesión de contratos', () => {
    for (const correo of ['  A@B.TEST ', 'a@b', 'sin-arroba', `${'a'.repeat(250)}@b.test`, 'a b@c.test', 'ñ@c.test']) {
      const propio = leerDatosSuperadmin({ ...VALIDAS, SUPERADMIN_CORREO: correo });
      const contratos = iniciarSesionPlataformaSchema.shape.correo.safeParse(correo);
      expect(propio.ok, correo).toBe(contratos.success);
      if (propio.ok && contratos.success) expect(propio.datos.correo).toBe(contratos.data);
    }
  });
});

describe('hayDatosDeSuperadmin', () => {
  it('es verdadero solo si las tres variables están definidas y no vacías', () => {
    expect(hayDatosDeSuperadmin(VALIDAS)).toBe(true);
    expect(hayDatosDeSuperadmin({ ...VALIDAS, SUPERADMIN_CLAVE: '' })).toBe(false);
    expect(hayDatosDeSuperadmin({ ...VALIDAS, SUPERADMIN_NOMBRE: undefined })).toBe(false);
    expect(hayDatosDeSuperadmin({})).toBe(false);
  });
});
