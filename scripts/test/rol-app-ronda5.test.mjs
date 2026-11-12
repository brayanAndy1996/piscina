// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 123 (ataque ronda 5, F2 (b); complementa los criterios 81 y 103), precision P-29, parte de `scripts/lib/rol-app.mjs`
// (solo modulos `node:*`): `problemasDeEsquemasApp({ esquemasPropios, esquemasConCreate, esquemaConSuNombre })`, con
// `esquemasPropios: string[]` (esquemas de los que el rol es dueno), `esquemasConCreate: { esquema: string; dePublic: boolean }[]`
// (`dePublic` verdadero si el privilegio llega por `PUBLIC`) y `esquemaConSuNombre: boolean`: `[]` si no hay nada; si no, un problema
// por esquema y condicion que contiene el nombre del esquema y la correccion (`REVOKE CREATE ON SCHEMA <esquema> FROM
// aquagestion_app;` o `... FROM PUBLIC;`; `ALTER SCHEMA <esquema> OWNER TO ...;`; renombrar o eliminar el esquema `aquagestion_app`).
// Es una funcion separada de `problemasDelRolApp` (P-13) y de `problemasDeConfiguracionApp` (P-19), cuyas pruebas no cambian.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const carpetaScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_MODULO = path.join(carpetaScripts, 'lib', 'rol-app.mjs');

async function cargar(nombre) {
  const modulo = await import(/* @vite-ignore */ pathToFileURL(RUTA_MODULO).href);
  if (modulo[nombre] === undefined) {
    throw new Error(`Falta la funcionalidad de la 001 (ronda 5): scripts/lib/rol-app.mjs no exporta ${nombre}.`);
  }
  return modulo[nombre];
}

const NADA = { esquemasPropios: [], esquemasConCreate: [], esquemaConSuNombre: false };
const texto = (problemas) =>
  problemas.map((problema) => (typeof problema === 'string' ? problema : JSON.stringify(problema))).join('\n');

describe('criterio 123 (P-29): problemasDeEsquemasApp', () => {
  it('criterio 123: sin esquemas propios, sin CREATE y sin esquema con su nombre devuelve []', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    expect(problemasDeEsquemasApp(NADA)).toEqual([]);
  });

  it('criterio 123: un esquema propio da un problema que contiene el nombre del esquema y ALTER SCHEMA <esquema> OWNER TO', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({ ...NADA, esquemasPropios: ['trampa'] });

    expect(problemas).toHaveLength(1);
    expect(texto(problemas)).toContain('trampa');
    expect(texto(problemas)).toContain('ALTER SCHEMA trampa OWNER TO');
  });

  it('criterio 123: dos esquemas propios dan dos problemas, uno por esquema', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({ ...NADA, esquemasPropios: ['trampa', 'otro'] });

    expect(problemas).toHaveLength(2);
    expect(problemas.filter((problema) => texto([problema]).includes('trampa'))).toHaveLength(1);
    expect(problemas.filter((problema) => texto([problema]).includes('otro'))).toHaveLength(1);
  });

  it('criterio 123: CREATE concedido a la app da un problema con el esquema y REVOKE CREATE ON SCHEMA <esquema> FROM aquagestion_app;', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({ ...NADA, esquemasConCreate: [{ esquema: 'trampa', dePublic: false }] });

    expect(problemas).toHaveLength(1);
    expect(texto(problemas)).toContain('trampa');
    expect(texto(problemas)).toContain('REVOKE CREATE ON SCHEMA trampa FROM aquagestion_app;');
  });

  it('criterio 123: CREATE que llega por PUBLIC da un problema con REVOKE CREATE ON SCHEMA <esquema> FROM PUBLIC;', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({ ...NADA, esquemasConCreate: [{ esquema: 'trampa', dePublic: true }] });

    expect(problemas).toHaveLength(1);
    expect(texto(problemas)).toContain('trampa');
    expect(texto(problemas)).toContain('REVOKE CREATE ON SCHEMA trampa FROM PUBLIC;');
    expect(texto(problemas)).not.toContain('FROM aquagestion_app;');
  });

  it('criterio 123: un esquema con el nombre del rol da un problema que lo nombra y propone renombrar o eliminar el esquema', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({ ...NADA, esquemaConSuNombre: true });

    expect(problemas).toHaveLength(1);
    expect(texto(problemas)).toContain('aquagestion_app');
    expect(texto(problemas)).toMatch(/renombr|elimin|DROP SCHEMA|RENAME/i);
  });

  it('criterio 123: un esquema propio, con CREATE y con el nombre del rol a la vez dan un problema por cada condicion y esquema', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({
      esquemasPropios: ['trampa'],
      esquemasConCreate: [
        { esquema: 'trampa', dePublic: false },
        { esquema: 'extension', dePublic: true },
      ],
      esquemaConSuNombre: true,
    });

    expect(problemas).toHaveLength(4);
    expect(new Set(problemas.map((problema) => texto([problema]))).size).toBe(4);
    expect(texto(problemas)).toContain('extension');
  });

  it('criterio 123: el nombre de un esquema con comillas o mayusculas se conserva en el texto', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({
      ...NADA,
      esquemasConCreate: [{ esquema: 'Mi Esquema', dePublic: false }],
    });

    expect(texto(problemas)).toContain('Mi Esquema');
  });

  it('criterio 123: los problemas no incluyen ninguna contrasena ni URL', async () => {
    const problemasDeEsquemasApp = await cargar('problemasDeEsquemasApp');

    const problemas = problemasDeEsquemasApp({
      esquemasPropios: ['trampa'],
      esquemasConCreate: [{ esquema: 'trampa', dePublic: true }],
      esquemaConSuNombre: true,
    });

    expect(texto(problemas)).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('criterio 123: no cambia problemasDelRolApp (P-13): con todos los booleanos en false sigue devolviendo []', async () => {
    const problemasDelRolApp = await cargar('problemasDelRolApp');

    expect(
      problemasDelRolApp({
        rolname: 'aquagestion_app',
        rolsuper: false,
        rolbypassrls: false,
        rolreplication: false,
        rolcreaterole: false,
        rolcreatedb: false,
        es_miembro: false,
      }),
    ).toEqual([]);
  });
});
