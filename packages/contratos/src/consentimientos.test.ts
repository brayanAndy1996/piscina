import { describe, expect, it } from 'vitest';
import { TIPOS_CONSENTIMIENTO, textosConsentimiento, VERSION_CONSENTIMIENTOS } from './index';

describe('consentimientos (criterio 14, D-07, RNF-05)', () => {
  it('la versión es un texto no vacío y los tipos son los tres de D-07 (sin WhatsApp)', () => {
    expect(VERSION_CONSENTIMIENTOS.trim().length).toBeGreaterThan(0);
    expect([...TIPOS_CONSENTIMIENTO]).toEqual(['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN']);
  });

  it('trae un texto por tipo, con el nombre de la academia y los datos de salud', () => {
    const textos = textosConsentimiento('Academia Los Delfines', { menor: false });

    expect(Object.keys(textos).sort()).toEqual(['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN']);
    for (const tipo of TIPOS_CONSENTIMIENTO) expect(textos[tipo]).toContain('Academia Los Delfines');
    expect(textos.DATOS_PERSONALES).toMatch(/salud/i);
  });

  it('si la persona es menor, el de datos personales menciona los datos de menores y al apoderado', () => {
    const mayor = textosConsentimiento('Academia Los Delfines', { menor: false });
    const menor = textosConsentimiento('Academia Los Delfines', { menor: true });

    expect(menor.DATOS_PERSONALES).toMatch(/menores/i);
    expect(menor.DATOS_PERSONALES).toMatch(/apoderado/i);
    expect(mayor.DATOS_PERSONALES).not.toMatch(/menores/i);
    expect(menor.DATOS_PERSONALES).not.toBe(mayor.DATOS_PERSONALES);
  });

  it('el nombre de la academia entra tal cual, sin interpretarse como patrón de reemplazo', () => {
    const nombre = 'Club $& Los Tiburones %s $1 $$';

    const textos = textosConsentimiento(nombre, { menor: true });

    for (const tipo of TIPOS_CONSENTIMIENTO) expect(textos[tipo]).toContain(nombre);
  });
});
