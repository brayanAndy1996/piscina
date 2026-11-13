// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it, vi } from 'vitest';
import { urlAppSobre } from './base-datos';
import { crearPreparacionUnaVez, MARCA_BASE_PREPARADA } from './global-setup-compartido';
import { validarBasePruebas } from './base-pruebas';

// Preparacion compartida de la base de pruebas entre proyectos (vitest.config.mts, criterio 107 y spec 000, criterio 19). Los
// `globalSetup` de todos los proyectos corren en el mismo proceso; el primero que corre prepara la base y deja una marca propia;
// el segundo solo se salta la preparacion si encuentra esa marca, y aun asi vuelve a validar las tres URL. Nunca la deduce
// comparando las URL.

const DESARROLLO = 'postgresql://dueno:clave@127.0.0.1:5432/aquagestion';
const PRUEBAS = 'postgresql://dueno:clave@127.0.0.1:5432/aquagestion_pruebas';
const APP_DE_DESARROLLO = 'postgresql://aquagestion_app:otra@127.0.0.1:5432/aquagestion';

type Variables = Record<string, string | undefined>;

/** Hace lo mismo que `global-setup.ts` con las variables, sin migrar ninguna base. */
function prepararSimulada(entorno: Variables): () => void {
  return vi.fn(() => {
    const urlPruebas = validarBasePruebas({
      DATABASE_URL: entorno['DATABASE_URL'],
      DATABASE_URL_PRUEBAS: entorno['DATABASE_URL_PRUEBAS'],
    });
    entorno['DATABASE_URL'] = urlPruebas;
    entorno['DATABASE_URL_PRUEBAS'] = urlPruebas;
    entorno['DATABASE_URL_APP'] = urlAppSobre(urlPruebas, entorno['DATABASE_URL_APP'] ?? APP_DE_DESARROLLO);
  });
}

function armar(entorno: Variables) {
  const almacen: Record<symbol, unknown> = {};
  const preparar = prepararSimulada(entorno);
  const unaVez = crearPreparacionUnaVez({ preparar, entorno, almacen });
  return { almacen, preparar, unaVez };
}

describe('global-setup-compartido: dos proyectos en el mismo proceso (caso normal)', () => {
  it('la primera llamada prepara y deja la marca; la segunda no repite la preparacion y no falla', () => {
    const entorno: Variables = {
      DATABASE_URL: DESARROLLO,
      DATABASE_URL_PRUEBAS: PRUEBAS,
      DATABASE_URL_APP: APP_DE_DESARROLLO,
    };
    const { almacen, preparar, unaVez } = armar(entorno);

    unaVez();
    expect(almacen[MARCA_BASE_PREPARADA]).toBeDefined();
    expect(() => unaVez()).not.toThrow();

    expect(preparar).toHaveBeenCalledTimes(1);
    expect(new URL(entorno['DATABASE_URL_APP'] as string).pathname).toBe('/aquagestion_pruebas');
  });

  it('la marca lleva un valor aleatorio distinto en cada proceso', () => {
    const una = armar({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: PRUEBAS });
    const otra = armar({ DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: PRUEBAS });
    una.unaVez();
    otra.unaVez();

    const a = una.almacen[MARCA_BASE_PREPARADA] as { id: string };
    const b = otra.almacen[MARCA_BASE_PREPARADA] as { id: string };
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(16);
  });

  it('una preparacion que falla no deja marca y la siguiente llamada vuelve a intentar', () => {
    const entorno: Variables = { DATABASE_URL: DESARROLLO, DATABASE_URL_PRUEBAS: DESARROLLO };
    const { almacen, preparar, unaVez } = armar(entorno);

    expect(() => unaVez()).toThrow(/igual a DATABASE_URL/);
    expect(almacen[MARCA_BASE_PREPARADA]).toBeUndefined();
    expect(() => unaVez()).toThrow(/igual a DATABASE_URL/);
    expect(preparar).toHaveBeenCalledTimes(2);
  });
});

describe('global-setup-compartido: sin la marca siempre se prepara y se valida (hueco del criterio 19 de la historia 000)', () => {
  it('DATABASE_URL = DATABASE_URL_PRUEBAS (…_pruebas) y DATABASE_URL_APP apuntando a la base de desarrollo: se rechaza', () => {
    const entorno: Variables = {
      DATABASE_URL: PRUEBAS,
      DATABASE_URL_PRUEBAS: PRUEBAS,
      DATABASE_URL_APP: APP_DE_DESARROLLO,
    };
    const { almacen, preparar, unaVez } = armar(entorno);

    expect(() => unaVez()).toThrow(/igual a DATABASE_URL/);

    expect(preparar).toHaveBeenCalledTimes(1);
    expect(almacen[MARCA_BASE_PREPARADA]).toBeUndefined();
    expect(entorno['DATABASE_URL_APP']).toBe(APP_DE_DESARROLLO);
  });

  it('la misma configuracion tampoco se acepta aunque se repita la llamada', () => {
    const entorno: Variables = {
      DATABASE_URL: PRUEBAS,
      DATABASE_URL_PRUEBAS: PRUEBAS,
      DATABASE_URL_APP: APP_DE_DESARROLLO,
    };
    const { unaVez } = armar(entorno);

    expect(() => unaVez()).toThrow();
    expect(() => unaVez()).toThrow();
  });
});

describe('global-setup-compartido: con la marca, la segunda llamada vuelve a validar las tres URL', () => {
  function preparada(): { entorno: Variables; unaVez: () => void } {
    const entorno: Variables = {
      DATABASE_URL: DESARROLLO,
      DATABASE_URL_PRUEBAS: PRUEBAS,
      DATABASE_URL_APP: APP_DE_DESARROLLO,
    };
    const { unaVez } = armar(entorno);
    unaVez();
    return { entorno, unaVez };
  }

  it.each([
    ['DATABASE_URL_APP apunta a la base de desarrollo', { DATABASE_URL_APP: APP_DE_DESARROLLO }, /DATABASE_URL_APP/],
    [
      'DATABASE_URL_APP apunta a otra base _pruebas',
      { DATABASE_URL_APP: 'postgresql://aquagestion_app:otra@127.0.0.1:5432/otra_pruebas' },
      /misma base/,
    ],
    [
      'DATABASE_URL_APP apunta a otro servidor',
      { DATABASE_URL_APP: 'postgresql://aquagestion_app:otra@10.0.0.9:5432/aquagestion_pruebas' },
      /misma base/,
    ],
    ['DATABASE_URL_APP falta', { DATABASE_URL_APP: undefined }, /falta DATABASE_URL_APP/],
    ['DATABASE_URL apunta a la base de desarrollo', { DATABASE_URL: DESARROLLO }, /DATABASE_URL/],
    [
      'DATABASE_URL_PRUEBAS apunta a la base de desarrollo',
      { DATABASE_URL_PRUEBAS: DESARROLLO },
      /DATABASE_URL_PRUEBAS/,
    ],
    [
      'DATABASE_URL_PRUEBAS cambio a otra base _pruebas',
      {
        DATABASE_URL: 'postgresql://dueno:clave@127.0.0.1:5432/otra_pruebas',
        DATABASE_URL_PRUEBAS: 'postgresql://dueno:clave@127.0.0.1:5432/otra_pruebas',
        DATABASE_URL_APP: 'postgresql://aquagestion_app:otra@127.0.0.1:5432/otra_pruebas',
      },
      /cambiaron/,
    ],
    ['una URL no es valida', { DATABASE_URL_APP: 'no es una url' }, /no es una URL v/],
  ] as [string, Variables, RegExp][])('%s: se rechaza', (_nombre, cambios, mensaje) => {
    const { entorno, unaVez } = preparada();
    Object.assign(entorno, cambios);

    expect(() => unaVez()).toThrow(mensaje);
  });

  it('con todo en orden la segunda llamada no falla aunque se repita', () => {
    const { unaVez } = preparada();

    expect(() => unaVez()).not.toThrow();
    expect(() => unaVez()).not.toThrow();
  });
});
