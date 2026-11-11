// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 117 (ataque ronda 4, observacion; complementa el criterio 99), parte unitaria: `cargarEnvRaiz` no se exporta en el
// `index` de `infraestructura/entorno/` (`main.ts` la importa de su archivo `cargar-env`), para que ningun modulo la tenga al
// alcance. La regla de lint que prohibe importar `cargar-env` y `dotenv` se prueba en `eslint/regla-entorno.test.mjs`.

describe('criterio 117: el index de infraestructura/entorno no exporta cargarEnvRaiz', () => {
  it('criterio 117: el index cargado no tiene cargarEnvRaiz', async () => {
    const indice = await cargarFuncionalidad<Record<string, unknown>>('infraestructura/entorno/index.ts', [
      'validarEntorno',
    ]);

    expect('cargarEnvRaiz' in indice).toBe(false);
    expect(indice['cargarEnvRaiz']).toBeUndefined();
  });

  it('criterio 117: el index sigue exportando lo demas (validarEntorno, retirarVariablesSensibles, ENTORNO y EntornoModule)', async () => {
    const indice = await cargarFuncionalidad<Record<string, unknown>>('infraestructura/entorno/index.ts', [
      'validarEntorno',
    ]);

    for (const nombre of ['validarEntorno', 'retirarVariablesSensibles', 'ENTORNO', 'EntornoModule', 'leerNodeEnv']) {
      expect(indice[nombre], nombre).toBeDefined();
    }
  });

  it('criterio 117: cargarEnvRaiz sigue existiendo en su archivo, para main.ts', async () => {
    const archivo = await cargarFuncionalidad<Record<string, unknown>>('infraestructura/entorno/cargar-env.ts', [
      'cargarEnvRaiz',
    ]);

    expect(typeof archivo['cargarEnvRaiz']).toBe('function');
  });
});
