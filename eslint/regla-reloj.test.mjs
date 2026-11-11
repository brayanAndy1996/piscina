// Prueba de la regla del reloj (spec 000, criterio 15) con la clase Linter de ESLint, sin información de tipos.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { configuracionReloj, MENSAJE_RELOJ } from './regla-reloj.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function revisar(codigo, archivo) {
  const linter = new Linter({ configType: 'flat', cwd: raiz });
  return linter.verify(
    codigo,
    [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, configuracionReloj],
    { filename: path.join(raiz, archivo) },
  );
}

describe('regla del reloj', () => {
  it.each([
    ['new Date() sin argumentos', 'const ahora = new Date();'],
    ['Date.now()', 'const ahora = Date.now();'],
    ['new Date() dentro de una función', 'export function f() { return new Date().getTime(); }'],
    ['Date.now() en un argumento', 'console.log(Date.now());'],
  ])('rechaza %s en backend/src', (_nombre, codigo) => {
    const mensajes = revisar(codigo, 'backend/src/modulos/ejemplo/ejemplo.service.ts');
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].ruleId).toBe('no-restricted-syntax');
    expect(mensajes[0].message).toBe(MENSAJE_RELOJ);
    expect(mensajes[0].message).toContain('RELOJ');
  });

  it.each([
    ['new Date con un argumento', "const fecha = new Date('2026-01-01T00:00:00Z');"],
    ['new Date con un número', 'const fecha = new Date(0);'],
    ['Date.parse', "const ms = Date.parse('2026-01-01');"],
    ['Date.UTC', 'const ms = Date.UTC(2026, 0, 1);'],
    ['usar un reloj propio', 'const reloj = { ahora() { return 1; } }; reloj.ahora();'],
  ])('permite %s', (_nombre, codigo) => {
    expect(revisar(codigo, 'backend/src/modulos/ejemplo/ejemplo.service.ts')).toEqual([]);
  });

  it.each([
    ['la carpeta del reloj', 'backend/src/infraestructura/reloj/reloj-sistema.ts'],
    ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
    ['las pruebas de integración', 'backend/test/integracion/ejemplo.ts'],
    ['otro workspace', 'packages/contratos/src/ejemplo.ts'],
  ])('no se aplica en %s', (_nombre, archivo) => {
    expect(revisar('const ahora = new Date(); const ms = Date.now();', archivo)).toEqual([]);
  });
});
