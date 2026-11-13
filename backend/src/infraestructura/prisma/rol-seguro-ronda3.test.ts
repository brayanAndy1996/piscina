// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 103 (ataque ronda 3, O2; complementa los criterios 80 y 81), precision P-19: `rol-seguro.ts` exporta
// `problemasDeConfiguracion(fila: { readonly tiene_configuracion: boolean }): string[]`: `[]` con `false`; un problema con `true` o
// con cualquier valor distinto de `false`. Es una funcion separada de `problemasDelRol` (P-12), cuyas pruebas pasan filas sin
// campos nuevos y no cambian.

type Fila = { readonly tiene_configuracion: unknown };

async function cargar(): Promise<(fila: Fila) => string[]> {
  const modulo = await cargarFuncionalidad<{ problemasDeConfiguracion: (fila: Fila) => string[] }>(
    'infraestructura/prisma/rol-seguro.ts',
    ['problemasDeConfiguracion'],
  );
  return modulo.problemasDeConfiguracion;
}

describe('criterio 103 (P-19): problemasDeConfiguracion', () => {
  it('criterio 103: con tiene_configuracion en false no devuelve ningun problema', async () => {
    const problemasDeConfiguracion = await cargar();

    expect(problemasDeConfiguracion({ tiene_configuracion: false })).toEqual([]);
  });

  it('criterio 103: con tiene_configuracion en true devuelve un problema', async () => {
    const problemasDeConfiguracion = await cargar();

    const problemas = problemasDeConfiguracion({ tiene_configuracion: true });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.length).toBeGreaterThan(0);
  });

  it.each([
    ['1', 1],
    ['"t"', 't'],
    ['"true"', 'true'],
    ['"f" (texto)', 'f'],
    ['null', null],
    ['undefined', undefined],
    ['un objeto', {}],
  ])(
    'criterio 103: con tiene_configuracion igual a %s (distinto de false) devuelve un problema',
    async (_nombre, valor) => {
      const problemasDeConfiguracion = await cargar();

      expect(problemasDeConfiguracion({ tiene_configuracion: valor }).length).toBeGreaterThan(0);
    },
  );

  it('criterio 103: el problema no incluye ninguna contrasena ni URL', async () => {
    const problemasDeConfiguracion = await cargar();

    const texto = problemasDeConfiguracion({ tiene_configuracion: true }).join(' ');

    expect(texto).not.toMatch(/postgres(ql)?:\/\//);
  });
});
