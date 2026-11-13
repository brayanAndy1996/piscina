import { crearAcademiaSchema, iniciarSesionPlataformaSchema } from '@aquagestion/contratos';
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

  it('aplica las reglas de texto de contratos (criterios 76 y 77) al correo, al nombre y a la clave', () => {
    const controles = ['\u0000', '\t', '\n', '\u007f', '\u0085', '\u009f'];
    for (const c of controles) {
      const clave = `Clave${c}Segura-2026`;
      const lectura = leerDatosSuperadmin({ ...VALIDAS, SUPERADMIN_CLAVE: clave });
      expect(lectura.ok, JSON.stringify(c)).toBe(iniciarSesionPlataformaSchema.shape.clave.safeParse(clave).success);
      expect(lectura.ok).toBe(false);
    }
    const nombres = [
      'Dueño de la plataforma',
      'Club 3',
      'Delfines\u202e',
      '\u2066Delfines\u2069',
      'Del\u2028fines',
      'Del\u2029fines',
      '\u200b\u200b\u200b\u200b',
      'a\u200bb',
      'a b',
      'a\u0301b',
      'Del\u200bfines',
      'ab',
    ];
    for (const nombre of nombres) {
      const propio = leerDatosSuperadmin({ ...VALIDAS, SUPERADMIN_NOMBRE: nombre });
      const contratos = crearAcademiaSchema.shape.nombre.safeParse(nombre);
      expect(propio.ok, JSON.stringify(nombre)).toBe(contratos.success);
      if (propio.ok && contratos.success) expect(propio.datos.nombre).toBe(contratos.data);
    }
    for (const correo of ['dueno\n@b.test', 'dueno@b.test\u0085', 'dueno\t@b.test']) {
      const propio = leerDatosSuperadmin({ ...VALIDAS, SUPERADMIN_CORREO: correo });
      expect(propio.ok, JSON.stringify(correo)).toBe(
        iniciarSesionPlataformaSchema.shape.correo.safeParse(correo).success,
      );
    }
  });

  it('nombra la variable y nunca incluye su valor en los problemas de texto', () => {
    const lectura = leerDatosSuperadmin({
      SUPERADMIN_CORREO: 'dueno@b.test',
      SUPERADMIN_NOMBRE: 'Delfines\u202e',
      SUPERADMIN_CLAVE: 'Clave\nSegura-2026',
    });

    expect(lectura.ok).toBe(false);
    if (!lectura.ok) {
      const texto = lectura.problemas.join('\n');
      expect(texto).toContain('SUPERADMIN_NOMBRE');
      expect(texto).toContain('SUPERADMIN_CLAVE');
      expect(texto).not.toContain('Segura');
      expect(texto).not.toContain('Delfines');
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
