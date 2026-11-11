// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 81 (ataque ronda 2, F1), parte unitaria: la funcion pura de `scripts/lib/rol-app.mjs` que evalua la fila de
// `pg_roles` de `aquagestion_app` (la usan `db:crear` y el hook de sesion de la nube). Devuelve la lista de problemas con su
// correccion; vacia si el rol es seguro. Plan, seccion 14: el modulo no tiene dependencias, para que el hook (que corre
// antes de `npm ci`) tambien pueda importarlo.
// Contrato supuesto (la spec no fija el nombre ni la forma de la fila): `problemasDelRolApp(fila)` con la fila
// `{ rolname, rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb, es_miembro }`; cada problema es un texto
// (o un objeto con el texto) que nombra la condicion y la correccion, por ejemplo `ALTER ROLE aquagestion_app NOREPLICATION;`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const carpetaScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_MODULO = path.join(carpetaScripts, 'lib', 'rol-app.mjs');

async function cargarProblemas() {
  let modulo;
  try {
    modulo = await import(/* @vite-ignore */ RUTA_MODULO);
  } catch (error) {
    throw new Error(
      `Falta la funcionalidad de la 001 (criterio 81): no se pudo cargar scripts/lib/rol-app.mjs (${error.message}).`,
      {
        cause: error,
      },
    );
  }
  if (typeof modulo.problemasDelRolApp !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 001 (criterio 81): scripts/lib/rol-app.mjs no exporta problemasDelRolApp.',
    );
  }
  return modulo.problemasDelRolApp;
}

const ROL_SEGURO = {
  rolname: 'aquagestion_app',
  rolsuper: false,
  rolbypassrls: false,
  rolreplication: false,
  rolcreaterole: false,
  rolcreatedb: false,
  es_miembro: false,
};

/** Texto de un problema, sea un texto o un objeto. */
const comoTexto = (problema) => (typeof problema === 'string' ? problema : JSON.stringify(problema));

describe('criterio 81: problemasDelRolApp evalua la fila de pg_roles de aquagestion_app', () => {
  it('con todos los atributos en falso y sin membresias no devuelve ningun problema', async () => {
    const problemasDelRolApp = await cargarProblemas();

    expect(problemasDelRolApp({ ...ROL_SEGURO })).toEqual([]);
  });

  it.each([
    ['superusuario', 'rolsuper', 'SUPERUSER'],
    ['BYPASSRLS', 'rolbypassrls', 'BYPASSRLS'],
    ['REPLICATION', 'rolreplication', 'REPLICATION'],
    ['CREATEROLE', 'rolcreaterole', 'CREATEROLE'],
    ['CREATEDB', 'rolcreatedb', 'CREATEDB'],
  ])(
    '%s, solo, produce un problema que nombra la condicion y su correccion ALTER ROLE',
    async (_nombre, campo, atributo) => {
      const problemasDelRolApp = await cargarProblemas();

      const problemas = problemasDelRolApp({ ...ROL_SEGURO, [campo]: true });

      expect(problemas.length).toBeGreaterThan(0);
      const texto = problemas.map(comoTexto).join('\n');
      expect(texto).toContain(atributo);
      expect(texto).toContain(`ALTER ROLE aquagestion_app NO${atributo};`);
    },
  );

  it('ser miembro de algun rol produce un problema con su correccion REVOKE ... FROM aquagestion_app', async () => {
    const problemasDelRolApp = await cargarProblemas();

    const problemas = problemasDelRolApp({ ...ROL_SEGURO, es_miembro: true });

    expect(problemas.length).toBeGreaterThan(0);
    const texto = problemas.map(comoTexto).join('\n');
    expect(texto).toMatch(/REVOKE\b/);
    expect(texto).toContain('FROM aquagestion_app');
  });

  it('devuelve todos los problemas, no solo el primero', async () => {
    const problemasDelRolApp = await cargarProblemas();

    const problemas = problemasDelRolApp({ ...ROL_SEGURO, rolreplication: true, rolcreatedb: true, es_miembro: true });

    expect(new Set(problemas.map(comoTexto)).size).toBeGreaterThanOrEqual(3);
  });

  it('no incluye ninguna contrasena (la fila no la lleva y el texto no la inventa)', async () => {
    const problemasDelRolApp = await cargarProblemas();

    const problemas = problemasDelRolApp({ ...ROL_SEGURO, rolreplication: true, rolpassword: 'clave-secreta-123' });

    expect(problemas.map(comoTexto).join('\n')).not.toContain('clave-secreta-123');
  });
});

describe('criterio 81: scripts/lib/rol-app.mjs no tiene dependencias (el hook lo importa antes de npm ci)', () => {
  it('solo importa modulos incluidos en Node (node:...) o archivos del propio proyecto', () => {
    if (!fs.existsSync(RUTA_MODULO)) {
      throw new Error('Falta la funcionalidad de la 001 (criterio 81): no existe scripts/lib/rol-app.mjs.');
    }
    const codigo = fs.readFileSync(RUTA_MODULO, 'utf8');
    const especificadores = [...codigo.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    const dinamicos = [...codigo.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

    for (const especificador of [...especificadores, ...dinamicos]) {
      expect(
        especificador.startsWith('node:') || especificador.startsWith('./') || especificador.startsWith('../'),
        `scripts/lib/rol-app.mjs importa un paquete externo: ${especificador}`,
      ).toBe(true);
    }
  });
});
