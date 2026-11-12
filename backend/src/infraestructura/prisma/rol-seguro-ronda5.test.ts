// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 123 (ataque ronda 5, F2 (b); complementa los criterios 80, 81 y 103), precision P-29: `rol-seguro.ts` exporta
// `problemasDeEsquemas(fila: { readonly dueno_de_esquema: boolean; readonly crea_en_esquema: boolean; readonly
// esquema_con_su_nombre: boolean }): string[]`: un problema por cada campo distinto de `false` (falla cerrada, como
// `problemasDelRol`), `[]` si los tres son `false`. Es una funcion separada de `problemasDelRol` (P-12) y de
// `problemasDeConfiguracion` (P-19), cuyas pruebas no cambian.

type Fila = {
  readonly dueno_de_esquema: unknown;
  readonly crea_en_esquema: unknown;
  readonly esquema_con_su_nombre: unknown;
};

async function cargar(): Promise<(fila: Fila) => string[]> {
  const modulo = await cargarFuncionalidad<{ problemasDeEsquemas: (fila: Fila) => string[] }>(
    'infraestructura/prisma/rol-seguro.ts',
    ['problemasDeEsquemas'],
  );
  return modulo.problemasDeEsquemas;
}

const SEGURA: Fila = { dueno_de_esquema: false, crea_en_esquema: false, esquema_con_su_nombre: false };
const CAMPOS = ['dueno_de_esquema', 'crea_en_esquema', 'esquema_con_su_nombre'] as const;

describe('criterio 123 (P-29): problemasDeEsquemas', () => {
  it('criterio 123: con los tres campos en false devuelve []', async () => {
    const problemasDeEsquemas = await cargar();

    expect(problemasDeEsquemas(SEGURA)).toEqual([]);
  });

  it.each(CAMPOS)('criterio 123: con solo %s en true devuelve un problema', async (campo) => {
    const problemasDeEsquemas = await cargar();

    const problemas = problemasDeEsquemas({ ...SEGURA, [campo]: true });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.length).toBeGreaterThan(0);
  });

  it('criterio 123: cada campo da un problema distinto (los textos no se repiten)', async () => {
    const problemasDeEsquemas = await cargar();

    const textos = CAMPOS.map((campo) => problemasDeEsquemas({ ...SEGURA, [campo]: true })[0]);

    expect(new Set(textos).size).toBe(3);
  });

  it('criterio 123: con dos campos en true devuelve dos problemas distintos', async () => {
    const problemasDeEsquemas = await cargar();

    const problemas = problemasDeEsquemas({ ...SEGURA, dueno_de_esquema: true, crea_en_esquema: true });

    expect(problemas).toHaveLength(2);
    expect(new Set(problemas).size).toBe(2);
  });

  it('criterio 123: con los tres campos en true devuelve tres problemas', async () => {
    const problemasDeEsquemas = await cargar();

    expect(
      problemasDeEsquemas({ dueno_de_esquema: true, crea_en_esquema: true, esquema_con_su_nombre: true }),
    ).toHaveLength(3);
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
    'criterio 123: un campo igual a %s (distinto de false) falla cerrado: devuelve un problema',
    async (_nombre, valor) => {
      const problemasDeEsquemas = await cargar();

      for (const campo of CAMPOS) {
        expect(problemasDeEsquemas({ ...SEGURA, [campo]: valor }).length, campo).toBeGreaterThan(0);
      }
    },
  );

  it('criterio 123: los problemas no incluyen ninguna contrasena ni URL', async () => {
    const problemasDeEsquemas = await cargar();

    const texto = problemasDeEsquemas({
      dueno_de_esquema: true,
      crea_en_esquema: true,
      esquema_con_su_nombre: true,
    }).join(' ');

    expect(texto).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('criterio 123: no cambia el resultado de problemasDelRol (P-12): sigue devolviendo [] con una fila segura y sin los campos nuevos', async () => {
    const modulo = await cargarFuncionalidad<{ problemasDelRol: (fila: Record<string, boolean>) => string[] }>(
      'infraestructura/prisma/rol-seguro.ts',
      ['problemasDelRol'],
    );
    const fila = {
      rolsuper: false,
      rolbypassrls: false,
      rolreplication: false,
      rolcreaterole: false,
      rolcreatedb: false,
      es_miembro: false,
      dueno_de_la_base: false,
      crea_en_base: false,
      temporales: false,
      crea_en_public: false,
      es_dueno: false,
    };

    expect(modulo.problemasDelRol(fila)).toEqual([]);
  });
});
