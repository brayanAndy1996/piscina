import { describe, expect, it } from 'vitest';
import { destinatariosDelEnlace } from './destinatarios';

// Pruebas de apoyo (no protegidas) de `destinatariosDelEnlace` (spec 005, criterio 57).
describe('destinatariosDelEnlace (apoyo)', () => {
  it('lleva el correo de la persona y el del apoderado, sin repetir', () => {
    expect(destinatariosDelEnlace({ alumno: { correo: 'a@x.test' }, apoderado: { correo: 'b@x.test' } })).toEqual([
      'a@x.test',
      'b@x.test',
    ]);
    expect(destinatariosDelEnlace({ alumno: { correo: 'a@x.test' }, apoderado: { correo: 'a@x.test' } })).toEqual([
      'a@x.test',
    ]);
  });

  it('solo compara el texto exacto: sin otras equivalencias', () => {
    expect(
      destinatariosDelEnlace({ alumno: { correo: 'a.b@x.test' }, apoderado: { correo: 'ab@x.test' } }),
    ).toHaveLength(2);
  });

  it('con un solo correo o ninguno', () => {
    expect(destinatariosDelEnlace({ alumno: {}, apoderado: { correo: 'b@x.test' } })).toEqual(['b@x.test']);
    expect(destinatariosDelEnlace({ alumno: { correo: 'a@x.test' }, apoderado: {} })).toEqual(['a@x.test']);
    expect(destinatariosDelEnlace({ alumno: { correo: 'a@x.test' } })).toEqual(['a@x.test']);
    expect(destinatariosDelEnlace({ alumno: {} })).toEqual([]);
  });
});
