import { describe, expect, it } from 'vitest';
import {
  type ActorDeRestablecimiento,
  evaluarAlcanceDeRestablecimiento,
  ROLES_DEL_PERSONAL,
} from './alcance-restablecimiento';

const ID_ACTOR = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';
const ID_OTRO = '9d6b2c1e-1d4a-4b6c-8e7f-9a0b1c2d3e4f';
const ROLES = ['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const;

const como = (rol: (typeof ROLES)[number]): ActorDeRestablecimiento => ({ tipo: 'USUARIO', id: ID_ACTOR, rol });

describe('evaluarAlcanceDeRestablecimiento (criterio 36, DR-4)', () => {
  it.each(ROLES)('el ADMIN restablece a un %s distinto de sí mismo', (rol) => {
    expect(evaluarAlcanceDeRestablecimiento(como('ADMIN'), { id: ID_OTRO, rol })).toBe('PERMITIDO');
  });

  it('el ADMIN no se restablece a sí mismo (409)', () => {
    expect(evaluarAlcanceDeRestablecimiento(como('ADMIN'), { id: ID_ACTOR, rol: 'ADMIN' })).toBe('SOBRE_SI_MISMO');
  });

  it('la SECRETARIA restablece solo a alumnos', () => {
    expect(evaluarAlcanceDeRestablecimiento(como('SECRETARIA'), { id: ID_OTRO, rol: 'ALUMNO' })).toBe('PERMITIDO');
    for (const rol of ['ADMIN', 'SECRETARIA', 'ENTRENADOR'] as const) {
      expect(evaluarAlcanceDeRestablecimiento(como('SECRETARIA'), { id: ID_OTRO, rol })).toBe('FUERA_DE_ALCANCE');
    }
  });

  it('la SECRETARIA sobre sí misma queda fuera de alcance (404), no es un 409', () => {
    expect(evaluarAlcanceDeRestablecimiento(como('SECRETARIA'), { id: ID_ACTOR, rol: 'SECRETARIA' })).toBe(
      'FUERA_DE_ALCANCE',
    );
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('un %s no restablece a nadie', (actor) => {
    for (const rol of ROLES) {
      expect(evaluarAlcanceDeRestablecimiento(como(actor), { id: ID_OTRO, rol })).toBe('FUERA_DE_ALCANCE');
    }
  });

  it('el SUPERADMIN restablece solo a administradores (criterio 40)', () => {
    const superadmin: ActorDeRestablecimiento = { tipo: 'SUPERADMIN', id: ID_ACTOR };
    expect(evaluarAlcanceDeRestablecimiento(superadmin, { id: ID_OTRO, rol: 'ADMIN' })).toBe('PERMITIDO');
    for (const rol of ['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const) {
      expect(evaluarAlcanceDeRestablecimiento(superadmin, { id: ID_OTRO, rol })).toBe('FUERA_DE_ALCANCE');
    }
  });
});

describe('ROLES_DEL_PERSONAL', () => {
  it('son el administrador, la secretaria y el entrenador (los alumnos no se gestionan aquí)', () => {
    expect([...ROLES_DEL_PERSONAL]).toEqual(['ADMIN', 'SECRETARIA', 'ENTRENADOR']);
  });
});
