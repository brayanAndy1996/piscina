// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 135 (ataque ronda 6, F3; complementa el criterio 134): con el codigo de backend/src/ (sin las pruebas, criterio 110),
// `npm run lint` (el lint normal, `eslint.config.mjs`; no el paso protegido) falla con una regla propia (orientativo:
// `aquagestion/sin-transaccion-guardada`) si se asigna (`=`, `??=`, `||=` o `&&=`) a una propiedad de `this` (`this.x`, `this.#x`,
// `this.a.b`, `this[x]`), o a una variable declarada en el nivel del modulo o a una propiedad de ella, un valor que, quitando
// parentesis, `as`, `satisfies` y `!`, es:
//   - un identificador que ESLint resuelve (por ambito) a un parametro, o a una propiedad desestructurada de un parametro, de una
//     funcion pasada como `trabajo` a `<algo>.conAcademia(id, trabajo)` o a `<algo>.comoPlataforma(trabajo)`;
//   - un identificador declarado con una anotacion de tipo `TransaccionAcademia`, `TransaccionPlataforma` o `ClienteTransaccion`
//     (tambien calificada, `X.TransaccionAcademia`);
//   - o un acceso `.cliente` sobre uno de esos.
// Ademas, fuera de `backend/src/infraestructura/`, la regla falla con cualquier importacion de `async_hooks` o `node:async_hooks` (por
// cualquiera de las vias del criterio 85): `AsyncLocalStorage.snapshot()` o `AsyncResource.bind` guardados dentro de `trabajo` y
// ejecutados desde otra peticion llevarian el contexto de la transaccion. Pasan, por ejemplo: `const t = tx` dentro de `trabajo`,
// `this.auditoria.registrarEnAcademia(tx, entrada)`, `this.cliente = clienteHttp` en un constructor y `this.total = filas.length`. Fallan:
// `this.tx = tx`, `this.#tx = tx`, `this.cliente = tx.cliente`, `this.estado.tx = tx`, `transaccionGuardada = tx` (variable del modulo),
// `this.tx = tx as TransaccionAcademia`, `this.c = cliente` con `async ({ cliente }) => ...` pasado a `comoPlataforma`,
// `this.t = transaccion` con `transaccion: TransaccionPlataforma` como parametro de un metodo, e
// `import { AsyncLocalStorage } from 'node:async_hooks'` en un modulo. Las copias por alias (`const t = tx; this.x = t`),
// `Object.assign(this, { tx })` y una transaccion guardada dentro de un arreglo o de una funcion no se siguen: la garantia es el
// criterio 134 (riesgo aceptado), y por eso esta prueba no fija su resultado.
// Prueba de la regla con la clase `ESLint` y `eslint.config.mjs`, como en el criterio 92. Cada ejemplo que falla se compara con su
// control: el mismo codigo con una linea inocua en lugar de la asignacion, que debe estar limpio (asi el error es de esta regla).
import { describe, expect, it } from 'vitest';
import { CLI, MODULO, errores, obtenerEslintPrincipal } from './ayuda-lint-ronda3.mjs';

const COMUN = 'backend/src/comun/ejemplo.ts';
const PRINCIPAL = 'backend/src/main.ts';
const PRISMA = 'backend/src/infraestructura/prisma/base-datos.ts';
const OTRA_INFRAESTRUCTURA = 'backend/src/infraestructura/seguridad/ejemplo.ts';
const INOCUA = 'const copia = 1;';

const CABECERA = `import type {
  BaseDatos,
  ClienteTransaccion,
  TransaccionAcademia,
  TransaccionPlataforma,
} from '../../infraestructura/prisma';
import type * as Tipos from '../../infraestructura/prisma';
`;

const CAMPOS = `  baseDatos!: BaseDatos;
  auditoria!: { registrarEnAcademia(tx: unknown, entrada: unknown): Promise<void> };
  tx: unknown;
  #tx: unknown;
  c: unknown;
  t: unknown;
  cliente: unknown;
  total = 0;
  estado: { tx?: unknown } = {};

  leer() {
    return this.#tx;
  }
`;

/** Una clase con un metodo cuyo `trabajo` de `conAcademia` ejecuta `linea`. */
const enConAcademia = (linea, modulo = '') =>
  `${CABECERA}${modulo}
export class ServicioEjemplo {
${CAMPOS}
  async guardar(id: string, entrada: unknown) {
    return this.baseDatos.conAcademia(id, async (tx) => {
      ${linea}
    });
  }
}
`;

/** Lo mismo con `comoPlataforma` y la propiedad desestructurada `cliente` del parametro. */
const enComoPlataformaDesestructurado = (linea) =>
  `${CABECERA}
export class ServicioEjemplo {
${CAMPOS}
  async guardar() {
    return this.baseDatos.comoPlataforma(async ({ cliente }) => {
      ${linea}
    });
  }
}
`;

/** Lo mismo con `comoPlataforma` y el parametro entero. */
const enComoPlataforma = (linea) =>
  `${CABECERA}
export class ServicioEjemplo {
${CAMPOS}
  async guardar() {
    return this.baseDatos.comoPlataforma(async (tx) => {
      ${linea}
    });
  }
}
`;

/** Un metodo con los parametros indicados (sin `conAcademia` ni `comoPlataforma`). */
const enMetodo = (parametros, linea) =>
  `${CABECERA}
export class ServicioEjemplo {
${CAMPOS}
  guardar(${parametros}) {
    ${linea}
  }
}
`;

/** Un nivel de modulo con la variable indicada y una funcion que ejecuta `linea` dentro de `trabajo`. */
const enModulo = (declaracion, linea) =>
  `${CABECERA}
${declaracion}
export async function guardar(baseDatos: BaseDatos, id: string) {
  return baseDatos.conAcademia(id, async (tx) => {
    ${linea}
  });
}
`;

/** Ejemplos que FALLAN: [descripcion, construir(linea)] con la linea que asigna; el control usa `INOCUA`. */
const FALLAN = [
  ['this.tx = tx', (l) => enConAcademia(l ?? 'this.tx = tx;')],
  ['this.#tx = tx', (l) => enConAcademia(l ?? 'this.#tx = tx;')],
  ['this.cliente = tx.cliente', (l) => enConAcademia(l ?? 'this.cliente = tx.cliente;')],
  ['this.estado.tx = tx', (l) => enConAcademia(l ?? 'this.estado.tx = tx;')],
  ['this.tx = tx as TransaccionAcademia', (l) => enConAcademia(l ?? 'this.tx = tx as TransaccionAcademia;')],
  ['this.tx = tx!', (l) => enConAcademia(l ?? 'this.tx = tx!;')],
  ['this.tx = (tx)', (l) => enConAcademia(l ?? 'this.tx = (tx);')],
  [
    'this.tx = tx satisfies TransaccionAcademia',
    (l) => enConAcademia(l ?? 'this.tx = tx satisfies TransaccionAcademia;'),
  ],
  ['this.tx = ((tx as TransaccionAcademia)!)', (l) => enConAcademia(l ?? 'this.tx = ((tx as TransaccionAcademia)!);')],
  [
    'this.cliente = (tx.cliente as ClienteTransaccion)',
    (l) => enConAcademia(l ?? 'this.cliente = (tx.cliente as ClienteTransaccion);'),
  ],
  ['this.tx ??= tx', (l) => enConAcademia(l ?? 'this.tx ??= tx;')],
  ['this.tx ||= tx', (l) => enConAcademia(l ?? 'this.tx ||= tx;')],
  ['this.tx &&= tx', (l) => enConAcademia(l ?? 'this.tx &&= tx;')],
  ["this['tx'] = tx", (l) => enConAcademia(l ?? "this['tx'] = tx;")],
  ['this[entrada] = tx (propiedad calculada)', (l) => enConAcademia(l ?? 'this[String(entrada)] = tx;')],
  [
    'transaccionGuardada = tx (variable declarada en el nivel del modulo)',
    (l) => enModulo('let transaccionGuardada: unknown;', l ?? 'transaccionGuardada = tx;'),
  ],
  [
    'registro.tx = tx (propiedad de una variable del nivel del modulo)',
    (l) => enModulo('const registro: { tx?: unknown } = {};', l ?? 'registro.tx = tx;'),
  ],
  [
    'registro.cliente = tx.cliente (variable del modulo)',
    (l) => enModulo('const registro: { cliente?: unknown } = {};', l ?? 'registro.cliente = tx.cliente;'),
  ],
  [
    'this.c = cliente con async ({ cliente }) => ... pasado a comoPlataforma',
    (l) => enComoPlataformaDesestructurado(l ?? 'this.c = cliente;'),
  ],
  ['this.tx = tx en el trabajo de comoPlataforma', (l) => enComoPlataforma(l ?? 'this.tx = tx;')],
  [
    'this.c = cliente con ({ cliente }) desestructurado en conAcademia',
    (l) =>
      `${CABECERA}
export class ServicioEjemplo {
${CAMPOS}
  async guardar(id: string) {
    return this.baseDatos.conAcademia(id, async ({ cliente }) => {
      ${l ?? 'this.c = cliente;'}
    });
  }
}
`,
  ],
  [
    'this.t = transaccion con transaccion: TransaccionPlataforma como parametro de un metodo',
    (l) => enMetodo('transaccion: TransaccionPlataforma', l ?? 'this.t = transaccion;'),
  ],
  [
    'this.t = transaccion con transaccion: TransaccionAcademia como parametro de un metodo',
    (l) => enMetodo('transaccion: TransaccionAcademia', l ?? 'this.t = transaccion;'),
  ],
  [
    'this.c = cliente con cliente: ClienteTransaccion como parametro de un metodo',
    (l) => enMetodo('cliente: ClienteTransaccion', l ?? 'this.c = cliente;'),
  ],
  [
    'this.t = t con una anotacion calificada (Tipos.TransaccionAcademia)',
    (l) => enMetodo('t: Tipos.TransaccionAcademia', l ?? 'this.t = t;'),
  ],
  [
    'this.c = t.cliente con t: TransaccionAcademia',
    (l) => enMetodo('t: TransaccionAcademia', l ?? 'this.c = t.cliente;'),
  ],
  [
    'this.t = guardada con una constante local anotada como TransaccionAcademia',
    (l) => enConAcademia(`const guardada: TransaccionAcademia = tx; ${l ?? 'this.t = guardada;'}`),
  ],
  [
    'this.t = t con una variable de la clase anotada (parametro del constructor)',
    (l) =>
      `${CABECERA}
export class ServicioEjemplo {
${CAMPOS}
  constructor(t: TransaccionAcademia) {
    ${l ?? 'this.t = t;'}
  }
}
`,
  ],
];

/** Ejemplos que PASAN. */
const PASAN = [
  ['const t = tx dentro de trabajo', enConAcademia('const t = tx;\n      void t;')],
  [
    'this.auditoria.registrarEnAcademia(tx, entrada)',
    enConAcademia('await this.auditoria.registrarEnAcademia(tx, entrada);'),
  ],
  [
    'this.cliente = clienteHttp en un constructor',
    `${CABECERA}
interface ClienteHttp { leer(): void }
export class ServicioEjemplo {
${CAMPOS}
  constructor(clienteHttp: ClienteHttp) {
    this.cliente = clienteHttp;
  }
}
`,
  ],
  [
    'this.total = filas.length',
    enConAcademia(
      'const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;\n      this.total = filas.length;',
    ),
  ],
  [
    'this.total = tx.academiaId (un dato de la transaccion, no la transaccion)',
    enConAcademia('this.total = Number(tx.academiaId);'),
  ],
  [
    'un parametro llamado tx de una funcion que no se pasa como trabajo, sin anotacion',
    enMetodo('tx', 'this.total = Number(tx);'),
  ],
  [
    'un parametro llamado tx de una funcion interior que oculta al de trabajo',
    enConAcademia('const interior = (tx: number) => { this.total = tx; };\n      interior(1);'),
  ],
  [
    'una variable local que recibe tx (no es this ni el nivel del modulo)',
    enConAcademia('let local: unknown;\n      local = tx;\n      void local;'),
  ],
  [
    'una propiedad de un objeto local que recibe tx',
    enConAcademia('const caja: { tx?: unknown } = {};\n      caja.tx = tx;'),
  ],
  [
    'una variable del nivel del modulo que recibe un valor que no es la transaccion',
    enModulo('let contador = 0;', 'contador = 1;'),
  ],
  [
    'this.id = id con id el parametro del metodo (no el del trabajo)',
    `${CABECERA}
export class ServicioEjemplo {
${CAMPOS}
  id = '';
  async guardar(id: string) {
    this.id = id;
    return this.baseDatos.conAcademia(id, async (tx) => {
      void tx;
    });
  }
}
`,
  ],
  ['this.t = t con t: unknown (sin anotacion de transaccion)', enMetodo('t: unknown', 'this.t = t;')],
];

const IMPORTACIONES_DE_ASYNC_HOOKS = [
  [
    "import { AsyncLocalStorage } from 'node:async_hooks'",
    "import { AsyncLocalStorage } from 'node:async_hooks';\nexport const x = AsyncLocalStorage;",
  ],
  [
    "import { AsyncResource } from 'async_hooks'",
    "import { AsyncResource } from 'async_hooks';\nexport const x = AsyncResource;",
  ],
  ["import * as hooks from 'node:async_hooks'", "import * as hooks from 'node:async_hooks';\nexport const x = hooks;"],
  ["import hooks from 'async_hooks'", "import hooks from 'async_hooks';\nexport const x = hooks;"],
  ["import 'node:async_hooks' (solo efectos)", "import 'node:async_hooks';\nexport const x = 1;"],
  ["export { AsyncLocalStorage } from 'node:async_hooks'", "export { AsyncLocalStorage } from 'node:async_hooks';"],
  ["export * from 'async_hooks'", "export * from 'async_hooks';"],
  ["import('node:async_hooks') dinamico", "export const cargar = () => import('node:async_hooks');"],
  ['import(`async_hooks`) con plantilla', 'export const cargar = () => import(`async_hooks`);'],
  ["require('node:async_hooks')", "export const hooks = require('node:async_hooks');"],
  ["import hooks = require('async_hooks')", "import hooks = require('async_hooks');\nexport const x = hooks;"],
];

describe('criterio 135: el lint normal (eslint.config.mjs) señala una transaccion guardada fuera de su trabajo', () => {
  const eslint = () => obtenerEslintPrincipal();

  describe('criterio 135: asignar la transaccion a this o a una variable del modulo', () => {
    it.each(FALLAN)(
      'criterio 135: %s falla el lint (y su control sin la asignacion esta limpio)',
      async (_nombre, construir) => {
        const control = construir(INOCUA);
        expect(await errores(eslint(), control, MODULO), `el control no esta limpio:\n${control}`).toEqual([]);

        const codigo = construir();
        const encontrados = await errores(eslint(), codigo, MODULO);
        expect(encontrados.length, `el lint no rechazo:\n${codigo}`).toBeGreaterThan(0);
      },
    );

    it.each([
      ['un modulo de comun/', COMUN],
      ['backend/src/main.ts', PRINCIPAL],
      ['un archivo de cli/', CLI],
    ])('criterio 135: this.tx = tx tambien falla en %s', async (_nombre, archivo) => {
      const codigo = enConAcademia('this.tx = tx;');

      expect((await errores(eslint(), codigo, archivo)).length, archivo).toBeGreaterThan(0);
      expect(await errores(eslint(), enConAcademia(INOCUA), archivo), `control en ${archivo}`).toEqual([]);
    });
  });

  describe('criterio 135: lo que pasa', () => {
    it.each(PASAN)('criterio 135: %s pasa el lint', async (_nombre, codigo) => {
      expect(await errores(eslint(), codigo, MODULO), codigo).toEqual([]);
    });
  });

  describe('criterio 135: importar async_hooks fuera de backend/src/infraestructura/', () => {
    it.each(IMPORTACIONES_DE_ASYNC_HOOKS)(
      'criterio 135: %s falla en un modulo, en cli/, en comun/ y en main.ts',
      async (_nombre, codigo) => {
        for (const archivo of [MODULO, CLI, COMUN, PRINCIPAL]) {
          expect(
            (await errores(eslint(), codigo, archivo)).length,
            `el lint no rechazo en ${archivo}: ${codigo}`,
          ).toBeGreaterThan(0);
        }
      },
    );

    it.each(IMPORTACIONES_DE_ASYNC_HOOKS.slice(0, 4))(
      'criterio 135: %s pasa dentro de backend/src/infraestructura/ (el envoltorio usa AsyncLocalStorage)',
      async (_nombre, codigo) => {
        for (const archivo of [PRISMA, OTRA_INFRAESTRUCTURA]) {
          expect(await errores(eslint(), codigo, archivo), `${archivo}: ${codigo}`).toEqual([]);
        }
      },
    );

    it('criterio 135: importar otro modulo de node: (node:events) no falla', async () => {
      const codigo = "import { EventEmitter } from 'node:events';\nexport const x = EventEmitter;";

      expect(await errores(eslint(), codigo, MODULO)).toEqual([]);
    });
  });

  describe('criterio 135: donde no se aplica', () => {
    it.each([
      ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
      ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
      ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
    ])('criterio 135: this.tx = tx y async_hooks no fallan en %s', async (_nombre, archivo) => {
      expect(await errores(eslint(), enConAcademia('this.tx = tx;'), archivo)).toEqual([]);
      expect(
        await errores(
          eslint(),
          "import { AsyncLocalStorage } from 'node:async_hooks';\nexport const x = AsyncLocalStorage;",
          archivo,
        ),
      ).toEqual([]);
    });
  });
});
