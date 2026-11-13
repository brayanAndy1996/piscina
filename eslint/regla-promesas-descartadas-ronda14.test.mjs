// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 164 (ataque ronda 14, O2; amplia el criterio 159 y P-41): una funcion `async` pasada a `process.nextTick`, `setImmediate`,
// `setTimeout`, `setInterval` o `queueMicrotask` no pasa el lint.
//
// La regla propia `aquagestion-promesas/sin-promesas-descartadas` (sin tipos, en el lint normal y en el paso protegido, en
// `ARCHIVOS_DE_CODIGO` salvo las pruebas y el cliente generado) falla ademas con (iii): toda llamada (tambien dentro de una expresion, no solo
// como sentencia) a una de esas funciones con al menos un argumento que es una funcion `async` escrita en el lugar. "Una de esas funciones" es
// un identificador con uno de esos nombres (tambien importado de `node:timers` o desestructurado de `process`) o un acceso a miembro cuya
// propiedad tiene uno de esos nombres (con punto o con corchetes y una cadena literal o una plantilla sin expresiones), cualquiera que sea el
// objeto. En (ii) y (iii) la regla mira a traves de los envoltorios de tipos de TypeScript (`as`, `satisfies`, `!` y `<T>`, tambien anidados).
// En el paso protegido ningun comentario la apaga (criterio 96). Pasan: esas funciones con una funcion que no es `async` y una funcion `async`
// pasada a cualquier otra funcion. No aplica al frontend, a `backend/test/`, a las pruebas de `backend/src/` ni a `e2e/`.
//
// Se usa la clase `ESLint` como en las pruebas de los criterios 96 y 159. Para el lint normal CON tipos se analiza el texto en la ruta de un
// archivo que ya existe en `backend/src/modulos/` (el servicio de proyecto de `typescript-eslint` no acepta `lintText` con un archivo que no
// existe); no se escribe nada en disco.
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { obtenerEslintPrincipal, obtenerEslintProtegido, raiz } from './ayuda-lint-ronda3.mjs';

const REGLA_PROPIA = 'aquagestion-promesas/sin-promesas-descartadas';

const ARCHIVO_DE_MODULO = (extension) => `backend/src/modulos/ejemplo/ejemplo.service.${extension}`;
/** Un archivo que existe, para el analisis con tipos (se analiza el texto del ejemplo, no el contenido del disco). */
const ARCHIVO_EXISTENTE_CON_TIPOS = 'backend/src/modulos/salud/salud.service.ts';

/** Mensajes de severidad 2 de la regla indicada para el codigo en `archivo`, con el ESLint dado. */
async function mensajesDe(eslint, regla, codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, archivo) });
  expect(
    resultado.messages.filter((mensaje) => mensaje.fatal),
    `error al analizar ${archivo}: ${codigo}`,
  ).toEqual([]);
  return resultado.messages.filter((mensaje) => mensaje.severity === 2 && mensaje.ruleId === regla);
}

// ---------------------------------------------------------------------------------------------------------------
// Sentencias de los ejemplos. Se escriben sin tipos para que valgan en .ts, .js y .mjs. `envolver` las pone dentro de una funcion.
// ---------------------------------------------------------------------------------------------------------------

const CUERPO = '{\n    await x;\n  }';

/** Las formas de la especificacion (criterio 164): dan error en `.ts`, `.js` y `.mjs`, tambien precedidas de comentarios. */
const FALLAN_BASE = {
  'process.nextTick(async () => { ... })': `process.nextTick(async () => ${CUERPO});`,
  'process.nextTick(async function () { ... })': `process.nextTick(async function () ${CUERPO});`,
  'setImmediate(async () => { ... })': `setImmediate(async () => ${CUERPO});`,
  'setTimeout(async () => { ... }, 0)': `setTimeout(async () => ${CUERPO}, 0);`,
  'setInterval(async () => { ... }, 10)': `setInterval(async () => ${CUERPO}, 10);`,
  'queueMicrotask(async () => { ... })': `queueMicrotask(async () => ${CUERPO});`,
  'globalThis.queueMicrotask(async () => { ... })': `globalThis.queueMicrotask(async () => ${CUERPO});`,
  "process['nextTick'](async () => { ... })": `process['nextTick'](async () => ${CUERPO});`,
  'process?.nextTick(async () => { ... })': `process?.nextTick(async () => ${CUERPO});`,
  'const { nextTick } = process; nextTick(async () => { ... })': `const { nextTick } = process;\n  nextTick(async () => ${CUERPO});`,
  'const t = setTimeout(async () => { ... }, 0) (la llamada no es una sentencia)': `const t = setTimeout(async () => ${CUERPO}, 0);\n  return t;`,
};

/** Otras formas que la especificacion incluye en la definicion de "una de esas funciones" y de "al menos un argumento". */
const FALLAN_OTRAS = {
  'globalThis.setTimeout(async () => { ... }, 0)': `globalThis.setTimeout(async () => ${CUERPO}, 0);`,
  'timers.setImmediate(async () => { ... })': `timers.setImmediate(async () => ${CUERPO});`,
  'process[`nextTick`](async () => { ... }) (plantilla sin expresiones)': `process[\`nextTick\`](async () => ${CUERPO});`,
  "globalThis['setInterval'](async () => { ... }, 5)": `globalThis['setInterval'](async () => ${CUERPO}, 5);`,
  'setTimeout(async function () { ... }, 0)': `setTimeout(async function () ${CUERPO}, 0);`,
  'cualquier objeto: reloj.setTimeout(async () => { ... }, 0)': `reloj.setTimeout(async () => ${CUERPO}, 0);`,
  'la funcion async en una posicion que no es la primera: setTimeout(hacer, async () => { ... })': `setTimeout(hacer, async () => ${CUERPO});`,
  'return setTimeout(async () => { ... }, 0)': `return setTimeout(async () => ${CUERPO}, 0);`,
  'dentro de otra expresion: await new Promise((r) => setTimeout(async () => { ... }, 0))': `await new Promise((r) => setTimeout(async () => ${CUERPO}, 0));`,
  'setTimeout?.(async () => { ... }, 0)': `setTimeout?.(async () => ${CUERPO}, 0);`,
};

/** Los envoltorios de tipos de TypeScript (solo `.ts`). */
const FALLAN_CON_TIPOS_DE_TS = {
  'setTimeout((async () => { ... }) as () => void, 0)': `setTimeout((async () => ${CUERPO}) as () => void, 0);`,
  '((async () => { ... })() as unknown); como sentencia': `((async () => ${CUERPO})() as unknown);`,
  'setTimeout((async () => { ... }) satisfies () => void, 0)': `setTimeout((async () => ${CUERPO}) satisfies () => void, 0);`,
  'setTimeout((async () => { ... })!, 0)': `setTimeout((async () => ${CUERPO})!, 0);`,
  'setTimeout(<() => void>(async () => { ... }), 0)': `setTimeout(<() => void>(async () => ${CUERPO}), 0);`,
  'setTimeout(((async () => { ... }) as unknown) as () => void, 0) (anidados)': `setTimeout(((async () => ${CUERPO}) as unknown) as () => void, 0);`,
  'process.nextTick((async () => { ... }) as () => void)': `process.nextTick((async () => ${CUERPO}) as () => void);`,
  '((async () => { ... })() satisfies unknown); como sentencia': `((async () => ${CUERPO})() satisfies unknown);`,
  '(async () => { ... })()!; como sentencia': `(async () => ${CUERPO})()!;`,
  '<unknown>(async () => { ... })(); como sentencia': `<unknown>(async () => ${CUERPO})();`,
  '(((async () => { ... })() as unknown) as void); como sentencia (anidados)': `(((async () => ${CUERPO})() as unknown) as void);`,
  '((async () => { ... }) as () => Promise<void>)(); (el envoltorio en la funcion llamada)': `((async () => ${CUERPO}) as () => Promise<void>)();`,
  '(process as NodeJS.Process).nextTick(async () => { ... }) (el envoltorio en el objeto)': `(process as NodeJS.Process).nextTick(async () => ${CUERPO});`,
  '(process.nextTick as typeof process.nextTick)(async () => { ... }) (el envoltorio en la funcion llamada)': `(process.nextTick as typeof process.nextTick)(async () => ${CUERPO});`,
};

/** Formas que NO dan error de la regla propia. */
const PASAN = {
  'process.nextTick(() => { hacer().catch(fn); })': 'process.nextTick(() => {\n    hacer().catch(fn);\n  });',
  'setTimeout(function () { return 1; }, 0)': 'setTimeout(function () {\n    return 1;\n  }, 0);',
  'setImmediate(resolver)': 'setImmediate(resolver);',
  'queueMicrotask(() => undefined)': 'queueMicrotask(() => undefined);',
  'queueMicrotask(() => hacer().catch(fn))': 'queueMicrotask(() => hacer().catch(fn));',
  'await Promise.all(lista.map(async (x) => x))': 'await Promise.all(lista.map(async (x) => x));',
  'otra(async () => 1)': 'otra(async () => 1);',
  'await new Promise((resolver) => setTimeout(resolver, 10))':
    'await new Promise((resolver) => setTimeout(resolver, 10));',
  'process.nextTick(resolver, 1, 2)': 'process.nextTick(resolver, 1, 2);',
  'setTimeout(...argumentos)': 'setTimeout(...argumentos);',
  'const t = setTimeout(() => 1, 0)': 'const t = setTimeout(() => 1, 0);\n  return t;',
  'un nombre que solo se parece: miSetTimeout(async () => 1)': 'miSetTimeout(async () => 1);',
  'una propiedad que solo se parece: reloj.setTimeoutAsync(async () => 1)': 'reloj.setTimeoutAsync(async () => 1);',
  "una propiedad que no es de las cinco: reloj['esperar'](async () => 1)": "reloj['esperar'](async () => 1);",
  'una funcion async que no se pasa: const luego = async () => ...':
    'const luego = async () => {\n    await x;\n  };\n  return luego;',
  'una funcion async pasada por referencia (limite aceptado): setTimeout(hacerAsync, 0)': 'setTimeout(hacerAsync, 0);',
  'una funcion async como valor de una propiedad de un objeto: setTimeout({ f: async () => 1 }, 0)':
    'setTimeout({ f: async () => 1 }, 0);',
};

const PASAN_CON_TIPOS_DE_TS = {
  'setTimeout((() => 1) as () => void, 0)': 'setTimeout((() => 1) as () => void, 0);',
  'otra((async () => 1) as () => Promise<number>)': 'otra((async () => 1) as () => Promise<number>);',
  '(hacer() as unknown); (sin funcion async escrita en el lugar)': '(hacer() as unknown);',
  'setImmediate(resolver!)': 'setImmediate(resolver!);',
};

const envolver = (sentencia, antes = '') =>
  `export async function caso(x, reloj, timers, lista, resolver, hacer, hacerAsync, fn, argumentos, otra) {\n  ${antes}${antes ? '\n  ' : ''}${sentencia}\n}\n`;

// ---------------------------------------------------------------------------------------------------------------
// Sin tipos: la regla propia, en el lint normal y en el paso protegido
// ---------------------------------------------------------------------------------------------------------------

const SIN_TIPOS = [
  ['eslint.config.mjs', obtenerEslintPrincipal, ['ts']],
  [
    'paso protegido (eslint.protegido.config.mjs, sin comentarios en linea)',
    obtenerEslintProtegido,
    ['ts', 'js', 'mjs'],
  ],
];

describe.each(SIN_TIPOS)('criterio 164, regla propia con %s', (_nombre, obtener, extensiones) => {
  for (const extension of extensiones) {
    describe(`en un .${extension}`, () => {
      it.each(Object.entries({ ...FALLAN_BASE, ...FALLAN_OTRAS }))(
        'criterio 164: %s da error de la regla propia',
        async (_forma, sentencia) => {
          const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, envolver(sentencia), ARCHIVO_DE_MODULO(extension));

          expect(mensajes.length, `la regla propia no rechazo: ${sentencia}`).toBeGreaterThan(0);
        },
      );

      it.each(Object.entries(PASAN))('criterio 164: %s no da error de la regla propia', async (_forma, sentencia) => {
        const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, envolver(sentencia), ARCHIVO_DE_MODULO(extension));

        expect(mensajes, `la regla propia rechazo una forma permitida: ${sentencia}`).toEqual([]);
      });
    });
  }

  describe('en un .ts, con los envoltorios de tipos de TypeScript', () => {
    it.each(Object.entries(FALLAN_CON_TIPOS_DE_TS))(
      'criterio 164: %s da error de la regla propia',
      async (_forma, sentencia) => {
        const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, envolver(sentencia), ARCHIVO_DE_MODULO('ts'));

        expect(mensajes.length, `la regla propia no rechazo: ${sentencia}`).toBeGreaterThan(0);
      },
    );

    it.each(Object.entries(PASAN_CON_TIPOS_DE_TS))(
      'criterio 164: %s no da error de la regla propia',
      async (_forma, sentencia) => {
        const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, envolver(sentencia), ARCHIVO_DE_MODULO('ts'));

        expect(mensajes, `la regla propia rechazo una forma permitida: ${sentencia}`).toEqual([]);
      },
    );
  });
});

describe('criterio 164: las funciones importadas de node:timers o desestructuradas', () => {
  const MODULOS = {
    "import { setTimeout } from 'node:timers'": `import { setTimeout } from 'node:timers';\nexport async function caso(x) {\n  setTimeout(async () => {\n    await x;\n  }, 0);\n}\n`,
    "import timers from 'node:timers'; timers.setImmediate(async ...)": `import timers from 'node:timers';\nexport async function caso(x) {\n  timers.setImmediate(async () => {\n    await x;\n  });\n}\n`,
    "import * as timers from 'node:timers'; timers['setInterval'](async ...)": `import * as timers from 'node:timers';\nexport async function caso(x) {\n  timers['setInterval'](async () => {\n    await x;\n  }, 5);\n}\n`,
    "const { setImmediate } = require('node:timers'); setImmediate(async ...)": `const { setImmediate } = require('node:timers');\nexport async function caso(x) {\n  setImmediate(async () => {\n    await x;\n  });\n}\n`,
    'const { queueMicrotask } = globalThis; queueMicrotask(async ...)': `const { queueMicrotask } = globalThis;\nexport async function caso(x) {\n  queueMicrotask(async () => {\n    await x;\n  });\n}\n`,
  };

  it.each(Object.entries(MODULOS))(
    'criterio 164: %s da error de la regla propia en el paso protegido (.ts y .mjs)',
    async (_forma, codigo) => {
      for (const extension of ['ts', 'mjs']) {
        const mensajes = await mensajesDe(obtenerEslintProtegido(), REGLA_PROPIA, codigo, ARCHIVO_DE_MODULO(extension));

        expect(mensajes.length, `la regla propia no rechazo en un .${extension}: ${codigo}`).toBeGreaterThan(0);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------
// En el paso protegido ningun comentario la apaga (criterio 96)
// ---------------------------------------------------------------------------------------------------------------

describe('criterio 164: en el paso protegido ningun comentario apaga la regla propia', () => {
  const COMENTARIOS = {
    '// eslint-disable-next-line aquagestion-promesas/sin-promesas-descartadas':
      '// eslint-disable-next-line aquagestion-promesas/sin-promesas-descartadas',
    '/* eslint-disable */': '/* eslint-disable */',
  };

  for (const extension of ['ts', 'js', 'mjs']) {
    describe(`en un .${extension}`, () => {
      for (const [nombreComentario, comentario] of Object.entries(COMENTARIOS)) {
        it.each(Object.entries(FALLAN_BASE))(
          `criterio 164: %s precedido de ${nombreComentario} sigue dando error`,
          async (_forma, sentencia) => {
            const mensajes = await mensajesDe(
              obtenerEslintProtegido(),
              REGLA_PROPIA,
              envolver(sentencia, comentario),
              ARCHIVO_DE_MODULO(extension),
            );

            expect(mensajes.length, `un comentario apago la regla propia: ${comentario}\n${sentencia}`).toBeGreaterThan(
              0,
            );
          },
        );
      }
    });
  }

  it('criterio 164: en un .ts, las formas con envoltorios de tipos precedidas de /* eslint-disable */ siguen dando error', async () => {
    for (const sentencia of [
      FALLAN_CON_TIPOS_DE_TS['setTimeout((async () => { ... }) as () => void, 0)'],
      FALLAN_CON_TIPOS_DE_TS['((async () => { ... })() as unknown); como sentencia'],
    ]) {
      const mensajes = await mensajesDe(
        obtenerEslintProtegido(),
        REGLA_PROPIA,
        envolver(sentencia, '/* eslint-disable */'),
        ARCHIVO_DE_MODULO('ts'),
      );

      expect(mensajes.length, sentencia).toBeGreaterThan(0);
    }
  });

  it('criterio 164: ni siquiera /* eslint-disable */ al principio del archivo apaga la regla propia', async () => {
    const codigo = `/* eslint-disable */\n${envolver(FALLAN_BASE['process.nextTick(async () => { ... })'])}`;

    const mensajes = await mensajesDe(obtenerEslintProtegido(), REGLA_PROPIA, codigo, ARCHIVO_DE_MODULO('ts'));

    expect(mensajes.length).toBeGreaterThan(0);
  });

  it('criterio 164: las formas que pasan siguen pasando aunque haya comentarios', async () => {
    for (const sentencia of [
      PASAN['setImmediate(resolver)'],
      PASAN['process.nextTick(() => { hacer().catch(fn); })'],
    ]) {
      const mensajes = await mensajesDe(
        obtenerEslintProtegido(),
        REGLA_PROPIA,
        envolver(sentencia, '// eslint-disable-next-line no-unused-expressions'),
        ARCHIVO_DE_MODULO('ts'),
      );
      expect(mensajes, sentencia).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El lint normal CON tipos
// ---------------------------------------------------------------------------------------------------------------

describe('criterio 164: lint normal con tipos (eslint.config.mjs)', () => {
  let conTipos;
  /** Una sola instancia para todos los casos: el servicio de proyecto de typescript-eslint tarda en arrancar. */
  const obtenerConTipos = () => (conTipos ??= new ESLint({ cwd: raiz }));
  const PREAMBULO = `declare const tx: { cliente: { configuracion: { update(argumentos: object): Promise<unknown> } } };
declare const auditoria: { registrarEnAcademia(tx: unknown, entrada: object): Promise<void> };
declare const fn: (motivo: unknown) => void;
declare function hacer(): Promise<void>;
declare function resolver(): void;
`;
  const cuerpo = (sentencia) => `${PREAMBULO}export async function caso(): Promise<void> {\n  ${sentencia}\n}\n`;

  const FALLAN = {
    'process.nextTick(async () => { await tx...update(...); await auditoria.registrarEnAcademia(tx, ...); })': `process.nextTick(async () => {
    await tx.cliente.configuracion.update({ where: {}, data: {} });
    await auditoria.registrarEnAcademia(tx, {});
  });`,
    'setImmediate(async () => { ... })': `setImmediate(async () => {
    await tx.cliente.configuracion.update({ where: {}, data: {} });
    await auditoria.registrarEnAcademia(tx, {});
  });`,
    'setTimeout(async () => { ... }, 0)': 'setTimeout(async () => {\n    await hacer();\n  }, 0);',
    'setInterval(async () => { ... }, 10)': 'setInterval(async () => {\n    await hacer();\n  }, 10);',
    'queueMicrotask(async () => { ... })': 'queueMicrotask(async () => {\n    await hacer();\n  });',
    'setTimeout((async () => { ... }) as () => void, 0)':
      'setTimeout((async () => {\n    await hacer();\n  }) as () => void, 0);',
  };

  const PASAN_CON_TIPOS = {
    'process.nextTick(() => { hacer().catch(fn); })': 'process.nextTick(() => {\n    hacer().catch(fn);\n  });',
    'setImmediate(resolver)': 'setImmediate(resolver);',
    'queueMicrotask(() => undefined)': 'queueMicrotask(() => undefined);',
  };

  it('criterio 164: la configuracion real activa la regla propia en error y el analisis con tipos en backend/src/modulos/ejemplo/ejemplo.service.ts', async () => {
    const configuracion = await obtenerConTipos().calculateConfigForFile(path.join(raiz, ARCHIVO_DE_MODULO('ts')));

    expect(configuracion.rules[REGLA_PROPIA]?.[0]).toBe(2);
    expect(
      configuracion.languageOptions?.parserOptions?.projectService,
      'el analisis con tipos esta activo en backend/src',
    ).toBeTruthy();
  });

  it.each(Object.entries(FALLAN))(
    'criterio 164: %s da error de la regla propia',
    async (_forma, sentencia) => {
      const mensajes = await mensajesDe(
        obtenerConTipos(),
        REGLA_PROPIA,
        cuerpo(sentencia),
        ARCHIVO_EXISTENTE_CON_TIPOS,
      );

      expect(mensajes.length, `la regla propia no rechazo (con tipos): ${sentencia}`).toBeGreaterThan(0);
    },
    180_000,
  );

  it.each(Object.entries(PASAN_CON_TIPOS))(
    'criterio 164: %s no da error de la regla propia',
    async (_forma, sentencia) => {
      const mensajes = await mensajesDe(
        obtenerConTipos(),
        REGLA_PROPIA,
        cuerpo(sentencia),
        ARCHIVO_EXISTENTE_CON_TIPOS,
      );

      expect(mensajes, `la regla propia rechazo una forma permitida (con tipos): ${sentencia}`).toEqual([]);
    },
    180_000,
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Alcance: pruebas, frontend, backend/test y e2e quedan fuera
// ---------------------------------------------------------------------------------------------------------------

describe.each(SIN_TIPOS)('criterio 164, fuera de alcance con %s', (_nombre, obtener) => {
  const TEMPORIZADOR_ASYNC = envolver(FALLAN_BASE['setTimeout(async () => { ... }, 0)']);
  const NEXT_TICK_ASYNC = envolver(FALLAN_BASE['process.nextTick(async () => { ... })']);

  it.each([
    ['backend/src/modulos/ejemplo/ejemplo.service.test.ts', NEXT_TICK_ASYNC],
    ['backend/src/modulos/ejemplo/ejemplo.service.test.ts', TEMPORIZADOR_ASYNC],
    ['backend/src/infraestructura/prisma/ejemplo.test.mjs', NEXT_TICK_ASYNC],
    ['backend/test/integracion/aislamiento/ejemplo.test.ts', NEXT_TICK_ASYNC],
    ['backend/test/utilidades/ejemplo.ts', TEMPORIZADOR_ASYNC],
    ['frontend/src/ejemplo.ts', TEMPORIZADOR_ASYNC],
    ['frontend/src/ejemplo.tsx', NEXT_TICK_ASYNC],
    ['e2e/ejemplo.spec.ts', TEMPORIZADOR_ASYNC],
  ])(
    'criterio 164: %s con una funcion async en un temporizador no da error de la regla propia',
    async (archivo, codigo) => {
      const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, codigo, archivo);

      expect(mensajes).toEqual([]);
    },
  );
});
