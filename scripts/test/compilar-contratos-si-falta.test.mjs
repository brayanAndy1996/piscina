import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { faltaCompilar } from '../compilar-contratos-si-falta.mjs';

const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(raizReal, 'scripts', 'compilar-contratos-si-falta.mjs');

describe('faltaCompilar', () => {
  let carpeta;
  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-contratos-'));
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it('es verdadero si no existe packages/contratos/dist', () => {
    expect(faltaCompilar(carpeta)).toBe(true);
  });

  it('es verdadero si dist existe pero está vacía (compilación interrumpida)', () => {
    fs.mkdirSync(path.join(carpeta, 'packages', 'contratos', 'dist'), { recursive: true });
    expect(faltaCompilar(carpeta)).toBe(true);
  });

  it('es falso si los contratos están compilados', () => {
    const dist = path.join(carpeta, 'packages', 'contratos', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.d.ts'), 'export {};\n');
    expect(faltaCompilar(carpeta)).toBe(false);
  });
});

describe('hook pre-commit', () => {
  it('compila los contratos (si faltan) antes de lint-staged, con un script de Node', () => {
    const hook = fs.readFileSync(path.join(raizReal, '.husky', 'pre-commit'), 'utf8').split('\n');
    const compilar = hook.findIndex((linea) => linea.includes('node scripts/compilar-contratos-si-falta.mjs'));
    const lintStaged = hook.findIndex((linea) => linea.includes('lint-staged'));
    expect(compilar).toBeGreaterThanOrEqual(0);
    expect(lintStaged).toBeGreaterThan(compilar);
  });

  it('con los contratos ya compilados termina en 0 sin hacer nada', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-contratos-'));
    try {
      const dist = path.join(carpeta, 'packages', 'contratos', 'dist');
      fs.mkdirSync(dist, { recursive: true });
      fs.writeFileSync(path.join(dist, 'index.d.ts'), 'export {};\n');
      const resultado = spawnSync(process.execPath, [SCRIPT, carpeta], { encoding: 'utf8' });
      expect(resultado.status).toBe(0);
      expect(resultado.stdout).toBe('');
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });

  it('si faltan y la compilación falla, termina con un código distinto de 0 (el commit se detiene)', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-contratos-'));
    try {
      const resultado = spawnSync(process.execPath, [SCRIPT, carpeta], { encoding: 'utf8' });
      expect(resultado.stdout).toContain('Compilando @aquagestion/contratos');
      expect(resultado.status).not.toBe(0);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
