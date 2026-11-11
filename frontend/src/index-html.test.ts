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
});
