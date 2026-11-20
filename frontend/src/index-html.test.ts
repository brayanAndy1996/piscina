// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('index.html', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('declara el idioma español', () => {
    expect(html).toMatch(/<html[^>]*\slang="es"/);
  });

  it('tiene el título de pestaña "AquaGestión"', () => {
    expect(html).toMatch(/<title>AquaGestión<\/title>/);
  });

  // Spec 005, criterio 44: el enlace de seguimiento lleva un token secreto; ninguna petición ni enlace lo manda como referente.
  it('declara <meta name="referrer" content="no-referrer"> para que el enlace de seguimiento no salga como referente', () => {
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
  });

  it('no carga recursos de otros dominios (fuentes, scripts, estilos ni imágenes)', () => {
    const recursos = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((coincidencia) => coincidencia[1] ?? '');
    expect(recursos.length).toBeGreaterThan(0);
    for (const recurso of recursos) expect(recurso).not.toMatch(/^(?:[a-z]+:)?\/\//i);
  });
});
