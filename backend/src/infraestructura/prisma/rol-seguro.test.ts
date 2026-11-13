// spec: 001-academias-aislamiento (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Criterio 80 (ataque ronda 2, F1), parte (a): prueba unitaria de la funcion pura que decide si el rol de la API es
// inseguro a partir de la fila que devuelve la consulta del catalogo. Plan, seccion 14: `problemasDelRol(fila): string[]`
// en `infraestructura/prisma/rol-seguro.ts`; una lista vacia significa rol seguro. Los nombres de los campos de la fila son
// los de la consulta del plan. Se carga con importacion dinamica para que, antes de implementarla, la prueba falle con un
// mensaje claro ("falta ...") y no rompa la verificacion de tipos.

/** Fila de la consulta del catalogo (plan, seccion 14): una condicion por campo, todas falsas en un rol seguro. */
interface FilaRol {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolreplication: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  es_miembro: boolean;
  dueno_de_la_base: boolean;
  crea_en_base: boolean;
  temporales: boolean;
  crea_en_public: boolean;
  es_dueno: boolean;
}

type ProblemasDelRol = (fila: FilaRol) => string[];

async function cargarProblemasDelRol(): Promise<ProblemasDelRol> {
  const ruta = path.join(__dirname, 'rol-seguro.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`Falta la funcionalidad de la 001 (criterio 80): no se pudo cargar rol-seguro.ts (${motivo}).`, {
      cause: error,
    });
  }
  if (typeof modulo['problemasDelRol'] !== 'function') {
    throw new Error('Falta la funcionalidad de la 001 (criterio 80): rol-seguro.ts no exporta problemasDelRol.');
  }
  return modulo['problemasDelRol'] as ProblemasDelRol;
}

const ROL_SEGURO: FilaRol = {
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

const CONDICIONES: readonly (readonly [string, keyof FilaRol])[] = [
  ['superusuario', 'rolsuper'],
  ['BYPASSRLS', 'rolbypassrls'],
  ['REPLICATION', 'rolreplication'],
  ['CREATEROLE', 'rolcreaterole'],
  ['CREATEDB', 'rolcreatedb'],
  ['miembro explicito de otro rol (pg_auth_members)', 'es_miembro'],
  ['miembro implicito por ser dueno de la base (pg_database_owner)', 'dueno_de_la_base'],
  ['privilegio CREATE sobre la base (directo o por PUBLIC)', 'crea_en_base'],
  ['privilegio TEMPORARY sobre la base (directo o por PUBLIC)', 'temporales'],
  ['privilegio CREATE sobre el esquema public', 'crea_en_public'],
  ['dueno de un objeto del esquema public o del propio esquema', 'es_dueno'],
];

describe('criterio 80: problemasDelRol decide con la fila del catalogo', () => {
  it('criterio 80: con todas las condiciones falsas (rol seguro) no devuelve ningun problema', async () => {
    const problemasDelRol = await cargarProblemasDelRol();

    expect(problemasDelRol({ ...ROL_SEGURO })).toEqual([]);
  });

  it.each(CONDICIONES)('criterio 80: %s, sola, devuelve al menos un problema', async (_nombre, campo) => {
    const problemasDelRol = await cargarProblemasDelRol();

    const problemas = problemasDelRol({ ...ROL_SEGURO, [campo]: true });

    expect(problemas.length, `la condicion ${campo} no fue detectada`).toBeGreaterThan(0);
    for (const problema of problemas) expect(typeof problema).toBe('string');
  });

  it('criterio 80: devuelve la lista completa: dos condiciones producen al menos dos problemas distintos', async () => {
    const problemasDelRol = await cargarProblemasDelRol();

    const problemas = problemasDelRol({ ...ROL_SEGURO, rolreplication: true, crea_en_public: true });

    expect(new Set(problemas).size).toBeGreaterThanOrEqual(2);
  });

  it('criterio 80: con todas las condiciones verdaderas devuelve mas problemas que con una sola', async () => {
    const problemasDelRol = await cargarProblemasDelRol();
    const todas = Object.fromEntries(CONDICIONES.map(([, campo]) => [campo, true])) as unknown as FilaRol;

    const una = problemasDelRol({ ...ROL_SEGURO, rolcreatedb: true });
    const muchas = problemasDelRol(todas);

    expect(muchas.length).toBeGreaterThan(una.length);
  });
});
