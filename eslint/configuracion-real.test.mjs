// Carga el eslint.config.mjs real del repositorio y confirma que la regla del reloj (spec 000, criterio 15) quedó
// conectada: activa en backend/src/** y desactivada en el reloj mismo y en las pruebas.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: raiz });

async function reglaDelReloj(archivo) {
  const configuracion = await eslint.calculateConfigForFile(path.join(raiz, archivo));
  return configuracion.rules['no-restricted-syntax'];
}

describe('eslint.config.mjs real: regla del reloj', () => {
  it.each(['backend/src/main.ts', 'backend/src/modulos/cobro/cobro.servicio.ts'])(
    'está en error con los dos selectores en %s',
    async (archivo) => {
      const regla = await reglaDelReloj(archivo);
      expect(regla?.[0]).toBe(2);
      expect(regla?.slice(1)).toHaveLength(2);
    },
  );

  it.each([
    'backend/src/infraestructura/reloj/reloj.ts',
    'backend/src/modulos/cobro/cobro.servicio.test.ts',
    'backend/test/integracion/salud/salud.test.ts',
    'frontend/src/main.tsx',
  ])('no se aplica en %s', async (archivo) => {
    const regla = await reglaDelReloj(archivo);
    expect(regla === undefined || regla[0] === 0).toBe(true);
  });
});
