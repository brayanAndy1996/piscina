// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 139 (ataque ronda 7, F3; amplia el criterio 135): los listeners de un `EventEmitterAsyncResource` corren en el contexto
// asincrono donde se creo el emisor (si se crea dentro del `trabajo` de A, se guarda fuera y otra peticion B emite, el listener usa la
// transaccion de A y el envoltorio la acepta, criterio 134), y `process.getBuiltinModule` carga `async_hooks` sin importarlo. Entonces,
// en el codigo de `backend/src/` fuera de `backend/src/infraestructura/` (sin las pruebas, criterio 110), `npm run lint` (el lint
// normal, `eslint.config.mjs`, como el criterio 135) falla con:
//   - cualquier aparicion del nombre `EventEmitterAsyncResource`: como nombre importado o reexportado, como propiedad con punto o
//     calculada con un literal o una plantilla sin marcadores, como clave de un patron de desestructuracion o como identificador; venga
//     de `events`, de `node:events` o de cualquier otro lado;
//   - `getBuiltinModule` (como propiedad de cualquier objeto, con punto o calculada, o desestructurado) salvo en una llamada directa
//     `<objeto>.getBuiltinModule('<literal>')` cuyo argumento es un literal de cadena distinto de `async_hooks` y de
//     `node:async_hooks`: fallan `process.getBuiltinModule('async_hooks')`, `process.getBuiltinModule('node:async_hooks')`,
//     `process.getBuiltinModule(nombre)`, `const { getBuiltinModule } = process` y `const g = process.getBuiltinModule`; pasa
//     `process.getBuiltinModule('node:crypto')`.
// Siguen pasando `import { EventEmitter } from 'node:events'`, `new EventEmitter()` y los eventos emitidos dentro de `trabajo`
// (criterio 134). Dentro de `backend/src/infraestructura/` la regla no cambia.
//
// Los ejemplos que fallan se prueban en un modulo, en `comun/` y en `main.ts`; no en `cli/`, donde la regla de acceso a la base ya
// senala `getBuiltinModule` por otra razon (`createRequire` y `getBuiltinModule`, criterio 85) y el resultado no distinguiria esta regla.
// Cada ejemplo que falla se compara con su control: el mismo codigo sin la forma prohibida, que debe estar limpio (asi el error es de
// esta regla). Prueba de la regla con la clase `ESLint` y `eslint.config.mjs`, como en el criterio 135.
import { describe, expect, it } from 'vitest';
import { MODULO, errores, obtenerEslintPrincipal } from './ayuda-lint-ronda3.mjs';

const COMUN = 'backend/src/comun/ejemplo.ts';
const PRINCIPAL = 'backend/src/main.ts';
const OTRA_INFRAESTRUCTURA = 'backend/src/infraestructura/seguridad/ejemplo.ts';
const FUERA_DE_INFRAESTRUCTURA = [MODULO, COMUN, PRINCIPAL];

/** [descripcion, codigo que falla, control limpio] para `EventEmitterAsyncResource`. */
const NOMBRE_PROHIBIDO = [
  [
    "import { EventEmitterAsyncResource as E } from 'node:events'",
    "import { EventEmitterAsyncResource as E } from 'node:events';\nexport const x = E;",
    "import { EventEmitter as E } from 'node:events';\nexport const x = E;",
  ],
  [
    "import { EventEmitterAsyncResource } from 'node:events' y new EventEmitterAsyncResource()",
    "import { EventEmitterAsyncResource } from 'node:events';\nexport const x = new EventEmitterAsyncResource();",
    "import { EventEmitter } from 'node:events';\nexport const x = new EventEmitter();",
  ],
  [
    "export { EventEmitterAsyncResource } from 'events'",
    "export { EventEmitterAsyncResource } from 'events';",
    "export { EventEmitter } from 'events';",
  ],
  [
    "export { EventEmitterAsyncResource as Emisor } from 'node:events'",
    "export { EventEmitterAsyncResource as Emisor } from 'node:events';",
    "export { EventEmitter as Emisor } from 'node:events';",
  ],
  [
    'events.EventEmitterAsyncResource (propiedad con punto de un import por defecto)',
    "import events from 'node:events';\nexport const x = events.EventEmitterAsyncResource;",
    "import events from 'node:events';\nexport const x = events.EventEmitter;",
  ],
  [
    'EventEmitter.EventEmitterAsyncResource',
    "import { EventEmitter } from 'node:events';\nexport const x = EventEmitter.EventEmitterAsyncResource;",
    "import { EventEmitter } from 'node:events';\nexport const x = EventEmitter.defaultMaxListeners;",
  ],
  [
    "require('events')['EventEmitterAsyncResource'] (propiedad calculada con un literal)",
    "export const x = require('events')['EventEmitterAsyncResource'];",
    "export const x = require('events')['EventEmitter'];",
  ],
  [
    'require(...)[`EventEmitterAsyncResource`] (propiedad calculada con una plantilla sin marcadores)',
    "export const x = require('events')[`EventEmitterAsyncResource`];",
    "export const x = require('events')[`EventEmitter`];",
  ],
  [
    "(await import('node:events')).EventEmitterAsyncResource",
    "export const cargar = async () => (await import('node:events')).EventEmitterAsyncResource;",
    "export const cargar = async () => (await import('node:events')).EventEmitter;",
  ],
  [
    "import * as events from 'node:events' y events['EventEmitterAsyncResource']",
    "import * as events from 'node:events';\nexport const x = events['EventEmitterAsyncResource'];",
    "import * as events from 'node:events';\nexport const x = events['EventEmitter'];",
  ],
  [
    'const { EventEmitterAsyncResource: E } = events (clave de un patron de desestructuracion)',
    "import * as events from 'node:events';\nconst { EventEmitterAsyncResource: E } = events;\nexport const x = E;",
    "import * as events from 'node:events';\nconst { EventEmitter: E } = events;\nexport const x = E;",
  ],
  [
    "const { EventEmitterAsyncResource } = require('events') (clave abreviada)",
    "const { EventEmitterAsyncResource } = require('events');\nexport const x = EventEmitterAsyncResource;",
    "const { EventEmitter } = require('events');\nexport const x = EventEmitter;",
  ],
  [
    'class Emisor extends EventEmitterAsyncResource',
    "import { EventEmitterAsyncResource } from 'node:events';\nexport class Emisor extends EventEmitterAsyncResource {}",
    "import { EventEmitter } from 'node:events';\nexport class Emisor extends EventEmitter {}",
  ],
  [
    "import { EventEmitterAsyncResource } from './otro-modulo' (venga de cualquier otro lado)",
    "import { EventEmitterAsyncResource } from './otro-modulo';\nexport const x = EventEmitterAsyncResource;",
    "import { EventEmitter } from './otro-modulo';\nexport const x = EventEmitter;",
  ],
  [
    'otro.EventEmitterAsyncResource (propiedad de cualquier objeto)',
    'export const x = (otro: Record<string, unknown>) => otro.EventEmitterAsyncResource;',
    'export const x = (otro: Record<string, unknown>) => otro.EventEmitter;',
  ],
  [
    'EventEmitterAsyncResource como identificador (una clase propia con ese nombre)',
    'export class EventEmitterAsyncResource {}',
    'export class EmisorPropio {}',
  ],
];

/** [descripcion, codigo que falla, control limpio] para `getBuiltinModule`. */
const GET_BUILTIN_MODULE_PROHIBIDO = [
  [
    "process.getBuiltinModule('async_hooks')",
    "export const hooks = process.getBuiltinModule('async_hooks');",
    "export const hooks = process.getBuiltinModule('node:crypto');",
  ],
  [
    "process.getBuiltinModule('node:async_hooks')",
    "export const hooks = process.getBuiltinModule('node:async_hooks');",
    "export const hooks = process.getBuiltinModule('node:crypto');",
  ],
  [
    'process.getBuiltinModule(nombre) (argumento que no es un literal)',
    'export const cargar = (nombre: string) => process.getBuiltinModule(nombre);',
    "export const cargar = (nombre: string) => process.getBuiltinModule('node:crypto') ?? nombre;",
  ],
  [
    'process.getBuiltinModule(`node:${nombre}`) (plantilla con marcadores)',
    'export const cargar = (nombre: string) => process.getBuiltinModule(`node:${nombre}`);',
    "export const cargar = (nombre: string) => process.getBuiltinModule('node:crypto') ?? nombre;",
  ],
  [
    "otro.getBuiltinModule('async_hooks') (propiedad de cualquier objeto)",
    "export const hooks = (otro: { getBuiltinModule(n: string): unknown }) => otro.getBuiltinModule('async_hooks');",
    "export const hooks = (otro: { getBuiltinModule(n: string): unknown }) => otro.getBuiltinModule('node:crypto');",
  ],
  [
    "globalThis.process.getBuiltinModule('async_hooks')",
    "export const hooks = globalThis.process.getBuiltinModule('async_hooks');",
    "export const hooks = globalThis.process.getBuiltinModule('node:crypto');",
  ],
  [
    'const { getBuiltinModule } = process (desestructurado)',
    'const { getBuiltinModule } = process;\nexport const g = getBuiltinModule;',
    'const { pid } = process;\nexport const g = pid;',
  ],
  [
    'const g = process.getBuiltinModule (sin llamada)',
    'export const g = process.getBuiltinModule;',
    'export const g = process.pid;',
  ],
  [
    'process.getBuiltinModule.bind(process) (no es una llamada directa con un literal)',
    'export const g = process.getBuiltinModule.bind(process);',
    'export const g = process.cwd.bind(process);',
  ],
  [
    "const g = process.getBuiltinModule; g('async_hooks')",
    "const g = process.getBuiltinModule;\nexport const hooks = g('async_hooks');",
    'const g = process.cwd;\nexport const hooks = g();',
  ],
];

describe('criterio 139: el lint normal (eslint.config.mjs) rechaza EventEmitterAsyncResource en cualquier forma, fuera de backend/src/infraestructura/', () => {
  const eslint = () => obtenerEslintPrincipal();

  it.each(NOMBRE_PROHIBIDO)(
    'criterio 139: %s falla el lint en un modulo, en comun/ y en main.ts (y su control esta limpio)',
    async (_nombre, codigo, control) => {
      for (const archivo of FUERA_DE_INFRAESTRUCTURA) {
        expect(
          await errores(eslint(), control, archivo),
          `el control no esta limpio en ${archivo}:\n${control}`,
        ).toEqual([]);
        expect(
          (await errores(eslint(), codigo, archivo)).length,
          `el lint no rechazo en ${archivo}:\n${codigo}`,
        ).toBeGreaterThan(0);
      }
    },
  );

  it('criterio 139: EventEmitterAsyncResource tambien falla dentro de un archivo de cli/ (importado de node:events)', async () => {
    const codigo =
      "import { EventEmitterAsyncResource } from 'node:events';\nexport const x = EventEmitterAsyncResource;";

    expect((await errores(eslint(), codigo, 'backend/src/cli/superadmin.ts')).length).toBeGreaterThan(0);
  });
});

describe('criterio 139: el lint normal rechaza getBuiltinModule salvo en una llamada directa con un literal distinto de async_hooks', () => {
  const eslint = () => obtenerEslintPrincipal();

  it.each(GET_BUILTIN_MODULE_PROHIBIDO)(
    'criterio 139: %s falla el lint en un modulo, en comun/ y en main.ts (y su control esta limpio)',
    async (_nombre, codigo, control) => {
      for (const archivo of FUERA_DE_INFRAESTRUCTURA) {
        expect(
          await errores(eslint(), control, archivo),
          `el control no esta limpio en ${archivo}:\n${control}`,
        ).toEqual([]);
        expect(
          (await errores(eslint(), codigo, archivo)).length,
          `el lint no rechazo en ${archivo}:\n${codigo}`,
        ).toBeGreaterThan(0);
      }
    },
  );

  it.each([
    ["process.getBuiltinModule('node:crypto')", "export const cripto = process.getBuiltinModule('node:crypto');"],
    ["process.getBuiltinModule('crypto')", "export const cripto = process.getBuiltinModule('crypto');"],
    ["process.getBuiltinModule('node:fs')", "export const fs = process.getBuiltinModule('node:fs');"],
  ])('criterio 139: %s pasa el lint', async (_nombre, codigo) => {
    for (const archivo of FUERA_DE_INFRAESTRUCTURA) {
      expect(await errores(eslint(), codigo, archivo), `el lint rechazo en ${archivo}:\n${codigo}`).toEqual([]);
    }
  });
});

describe('criterio 139: lo que sigue pasando', () => {
  const eslint = () => obtenerEslintPrincipal();

  it("criterio 139: import { EventEmitter } from 'node:events' y new EventEmitter() pasan", async () => {
    const codigo = "import { EventEmitter } from 'node:events';\nexport const emisor = new EventEmitter();";

    for (const archivo of FUERA_DE_INFRAESTRUCTURA) {
      expect(await errores(eslint(), codigo, archivo), archivo).toEqual([]);
    }
  });

  it('criterio 139: un EventEmitter creado, usado y emitido dentro de trabajo (criterio 134) pasa', async () => {
    const codigo = `import { EventEmitter } from 'node:events';
import type { BaseDatos } from '../../infraestructura/prisma';

export async function avisar(baseDatos: BaseDatos, id: string) {
  return baseDatos.conAcademia(id, async (tx) => {
    const emisor = new EventEmitter();
    let visto = '';
    emisor.on('listo', () => {
      visto = tx.academiaId;
    });
    emisor.emit('listo');
    return visto;
  });
}
`;

    for (const archivo of FUERA_DE_INFRAESTRUCTURA) {
      expect(await errores(eslint(), codigo, archivo), archivo).toEqual([]);
    }
  });
});

describe('criterio 139: donde no se aplica', () => {
  const eslint = () => obtenerEslintPrincipal();
  const PROHIBIDOS = [
    "import { EventEmitterAsyncResource } from 'node:events';\nexport const x = EventEmitterAsyncResource;",
    "export const hooks = process.getBuiltinModule('async_hooks');",
  ];

  it.each([
    ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
    ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
    ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
  ])('criterio 139: EventEmitterAsyncResource y getBuiltinModule no fallan en %s', async (_nombre, archivo) => {
    for (const codigo of PROHIBIDOS) {
      expect(await errores(eslint(), codigo, archivo), `${archivo}: ${codigo}`).toEqual([]);
    }
  });

  it('criterio 139: dentro de backend/src/infraestructura/ la regla no cambia (no senala estas formas)', async () => {
    for (const codigo of PROHIBIDOS) {
      expect(await errores(eslint(), codigo, OTRA_INFRAESTRUCTURA), `${OTRA_INFRAESTRUCTURA}: ${codigo}`).toEqual([]);
    }
  });
});
