// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 159 (ataque ronda 13, F1 (a); amplia el criterio 96 y precisa el 156 y el 157; P-41): ninguna promesa descartada en `backend/src`.
//
// Dos garantias, con la clase `ESLint` como las pruebas del criterio 96:
//   - lint normal, CON tipos (`eslint.config.mjs`), en los `.ts` y `.tsx` de `backend/src/` salvo las pruebas y el cliente generado:
//     `@typescript-eslint/no-floating-promises` en `error` con `ignoreVoid: false`, `ignoreIIFE: false` y `checkThenables: true`. El archivo con
//     tipos se escribe en una carpeta temporal dentro de `backend/src/modulos/` y se borra al terminar (el servicio de proyecto de
//     `typescript-eslint` no acepta `lintText` con un archivo que no existe);
//   - lint normal y paso protegido, SIN tipos (`eslint.config.mjs` y `eslint.protegido.config.mjs`, este ultimo con `allowInlineConfig: false`),
//     en `ARCHIVOS_DE_CODIGO` salvo las pruebas y el cliente generado: la regla propia `aquagestion-promesas/sin-promesas-descartadas` falla con
//     (i) todo operador `void`, salvo `void 0`; y (ii) una sentencia que es la llamada directa a una funcion `async` escrita en el lugar sin
//     `await`. En el paso protegido ningun comentario la apaga.
// Pasan: `await x`, `return x`, `x.then(ok, err)`, `x.catch(fn)`, `x.then(ok).catch(fn)`, `await Promise.all([...])` y `void 0`. No aplica al
// frontend, a `backend/test/`, a las pruebas de `backend/src/` ni a `e2e/`. El codigo actual de `backend/src` pasa la regla propia.
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { obtenerEslintPrincipal, obtenerEslintProtegido, raiz } from './ayuda-lint-ronda3.mjs';

const REGLA_PROPIA = 'aquagestion-promesas/sin-promesas-descartadas';
const REGLA_DE_TIPOS = '@typescript-eslint/no-floating-promises';

const ARCHIVO_DE_MODULO = (extension) => `backend/src/modulos/ejemplo/ejemplo.service.${extension}`;

/** Mensajes de severidad 2 de la regla indicada para el codigo en `archivo`, con el ESLint dado (sin informacion de tipos). */
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

const ATAQUE = `void (async () => {
    await tx.cliente.configuracion.update({ where: {}, data: {} });
    await auditoria.registrarEnAcademia(tx, {});
  })();`;

const ATAQUE_CON_IP = `void (async () => {
    await tx.cliente.configuracion.update({ where: {}, data: {} });
    const ip = ipParaAuditoria(solicitud.ip);
    await auditoria.registrarEnAcademia(tx, { ip });
  })();`;

const COMO_SENTENCIA = {
  'void <promesa>': 'void promesa;',
  'void 1': 'void 1;',
  'void de una llamada': 'void hacer();',
  'la forma exacta del ataque: void (async () => { await ...; await ...; })()': ATAQUE,
  'la variante con ipParaAuditoria entre las dos consultas': ATAQUE_CON_IP,
  'void de una funcion async con nombre': 'void (async function () { await promesa; })();',
  '(async () => { ... })(); sin await':
    '(async () => {\n    await tx.cliente.configuracion.update({});\n    await auditoria.registrarEnAcademia(tx, {});\n  })();',
  '(async function () { ... })(); sin await': '(async function () {\n    await promesa;\n  })();',
  '(async () => { ... })?.(); sin await': '(async () => {\n    await promesa;\n  })?.();',
};

const PASAN = {
  'void 0': 'void 0;',
  'await promesa': 'await promesa;',
  'return promesa': 'return promesa;',
  'promesa.then(ok, err)': 'promesa.then(ok, err);',
  'promesa.catch(fn)': 'promesa.catch(fn);',
  'promesa.then(ok).catch(fn)': 'promesa.then(ok).catch(fn);',
  'await Promise.all([...])': 'await Promise.all([promesa, tx.cliente.configuracion.update({})]);',
  '(async () => { ... })().catch(fn)': '(async () => {\n    await promesa;\n  })().catch(fn);',
  'await (async () => { ... })()': 'await (async () => {\n    await promesa;\n  })();',
  'una funcion async que no se llama': 'const luego = async () => {\n    await promesa;\n  };\n  return luego;',
  'dentro de un trabajo con await y una cadena atrapada':
    'await base.conAcademia(id, async (tx) => {\n    await tx.cliente.configuracion.update({});\n    promesa.then(ok).catch(fn);\n    return 1;\n  });',
};

const envolver = (sentencia, antes = '') =>
  `export async function caso(base, id, tx, auditoria, solicitud, promesa, ok, err, fn, hacer) {\n  ${antes}${antes ? '\n  ' : ''}${sentencia}\n}\n`;

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

describe.each(SIN_TIPOS)('criterio 159, regla propia con %s', (_nombre, obtener, extensiones) => {
  for (const extension of extensiones) {
    describe(`en un .${extension}`, () => {
      it.each(Object.entries(COMO_SENTENCIA))(
        'criterio 159: %s da error de la regla propia',
        async (_forma, sentencia) => {
          const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, envolver(sentencia), ARCHIVO_DE_MODULO(extension));

          expect(mensajes.length, `la regla propia no rechazo: ${sentencia}`).toBeGreaterThan(0);
        },
      );

      it.each(Object.entries(PASAN))('criterio 159: %s no da error de la regla propia', async (_forma, sentencia) => {
        const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, envolver(sentencia), ARCHIVO_DE_MODULO(extension));

        expect(mensajes, `la regla propia rechazo una forma permitida: ${sentencia}`).toEqual([]);
      });
    });
  }
});

describe('criterio 159: en el paso protegido ningun comentario apaga la regla propia', () => {
  const COMENTARIOS = {
    '// eslint-disable-next-line aquagestion-promesas/sin-promesas-descartadas':
      '// eslint-disable-next-line aquagestion-promesas/sin-promesas-descartadas',
    '/* eslint-disable aquagestion-promesas/sin-promesas-descartadas */':
      '/* eslint-disable aquagestion-promesas/sin-promesas-descartadas */',
    '/* eslint-disable */': '/* eslint-disable */',
    '// eslint-disable-next-line': '// eslint-disable-next-line',
  };
  const FORMAS = {
    'void promesa': 'void promesa;',
    'void (async () => { ... })()': ATAQUE,
    '(async () => { ... })();': '(async () => {\n    await promesa;\n  })();',
  };

  for (const extension of ['ts', 'js', 'mjs']) {
    for (const [nombreComentario, comentario] of Object.entries(COMENTARIOS)) {
      for (const [nombreForma, sentencia] of Object.entries(FORMAS)) {
        it(`criterio 159: en un .${extension}, ${nombreForma} precedido de ${nombreComentario} sigue dando error`, async () => {
          const mensajes = await mensajesDe(
            obtenerEslintProtegido(),
            REGLA_PROPIA,
            envolver(sentencia, comentario),
            ARCHIVO_DE_MODULO(extension),
          );

          expect(mensajes.length, `un comentario apago la regla propia: ${comentario}`).toBeGreaterThan(0);
        });
      }
    }
  }

  it('criterio 159: ni siquiera /* eslint-disable */ al principio del archivo apaga la regla propia', async () => {
    const codigo = `/* eslint-disable */\n${envolver('void promesa;')}`;

    const mensajes = await mensajesDe(obtenerEslintProtegido(), REGLA_PROPIA, codigo, ARCHIVO_DE_MODULO('ts'));

    expect(mensajes.length).toBeGreaterThan(0);
  });

  it('criterio 159: void 0 y las formas con .catch siguen pasando aunque haya comentarios', async () => {
    for (const sentencia of [PASAN['void 0'], PASAN['promesa.catch(fn)'], PASAN['promesa.then(ok).catch(fn)']]) {
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
// Alcance: pruebas, frontend, backend/test y e2e quedan fuera
// ---------------------------------------------------------------------------------------------------------------

describe.each(SIN_TIPOS)('criterio 159, fuera de alcance con %s', (_nombre, obtener) => {
  const FORMA_DEL_ATAQUE = envolver(ATAQUE);

  it.each([
    'backend/src/modulos/ejemplo/ejemplo.service.test.ts',
    'backend/src/infraestructura/prisma/ejemplo.test.mjs',
    'backend/test/integracion/aislamiento/ejemplo.test.ts',
    'frontend/src/ejemplo.ts',
    'e2e/ejemplo.spec.ts',
  ])('criterio 159: %s con void (async () => { ... })() no da error de la regla propia', async (archivo) => {
    const mensajes = await mensajesDe(obtener(), REGLA_PROPIA, FORMA_DEL_ATAQUE, archivo);

    expect(mensajes).toEqual([]);
  });

  it('criterio 159: un archivo de frontend/src con void promesa no da error de la regla propia', async () => {
    const mensajes = await mensajesDe(
      obtener(),
      REGLA_PROPIA,
      'export function f(promesa) {\n  void promesa;\n}\n',
      'frontend/src/ejemplo.tsx',
    );

    expect(mensajes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Configuracion real: lo que cada paso activa para cada archivo
// ---------------------------------------------------------------------------------------------------------------

describe('criterio 159: la configuracion real activa cada regla donde corresponde', () => {
  const principal = new ESLint({ cwd: raiz });

  it('criterio 159: eslint.config.mjs pone no-floating-promises en error con ignoreVoid false, ignoreIIFE false y checkThenables true en backend/src', async () => {
    const configuracion = await principal.calculateConfigForFile(path.join(raiz, ARCHIVO_DE_MODULO('ts')));

    const regla = configuracion.rules[REGLA_DE_TIPOS];
    expect(regla?.[0], 'severidad error').toBe(2);
    expect(regla?.[1]).toMatchObject({ ignoreVoid: false, ignoreIIFE: false, checkThenables: true });
  });

  it('criterio 159: eslint.config.mjs pone la regla propia en error en backend/src', async () => {
    const configuracion = await principal.calculateConfigForFile(path.join(raiz, ARCHIVO_DE_MODULO('ts')));

    expect(configuracion.rules[REGLA_PROPIA]?.[0]).toBe(2);
  });

  it.each([
    'backend/src/modulos/ejemplo/ejemplo.service.test.ts',
    'backend/test/integracion/aislamiento/ejemplo.test.ts',
  ])('criterio 159: en %s no esta la regla propia ni ignoreVoid en false', async (archivo) => {
    const configuracion = await principal.calculateConfigForFile(path.join(raiz, archivo));

    const propia = configuracion.rules[REGLA_PROPIA];
    expect(propia === undefined || propia[0] === 0, 'la regla propia no aplica a las pruebas').toBe(true);
    expect(configuracion.rules[REGLA_DE_TIPOS]?.[1]?.ignoreVoid, 'las pruebas pueden usar void').not.toBe(false);
  });

  it.each(['frontend/src/ejemplo.tsx', 'e2e/ejemplo.spec.ts'])(
    'criterio 159: en %s no esta la regla propia',
    async (archivo) => {
      const configuracion = await principal.calculateConfigForFile(path.join(raiz, archivo));

      const propia = configuracion.rules[REGLA_PROPIA];
      expect(propia === undefined || propia[0] === 0).toBe(true);
      expect(
        configuracion.rules[REGLA_DE_TIPOS]?.[1]?.ignoreVoid,
        'la configuracion de tipos es solo de backend/src',
      ).not.toBe(false);
    },
  );

  it.each(['ts', 'js', 'mjs', 'tsx', 'jsx'])(
    'criterio 159: el paso protegido pone la regla propia en error en un .%s de backend/src y no activa no-floating-promises',
    async (extension) => {
      const configuracion = await obtenerEslintProtegido().calculateConfigForFile(
        path.join(raiz, `backend/src/modulos/ejemplo/ejemplo.service.${extension}`),
      );

      expect(configuracion.rules[REGLA_PROPIA]?.[0]).toBe(2);
      expect(configuracion.rules[REGLA_DE_TIPOS], 'no exige tipos').toBeUndefined();
    },
  );
});

describe('criterio 159: el codigo actual de backend/src pasa la regla propia en los dos pasos', () => {
  it.each([
    ['eslint.config.mjs', obtenerEslintPrincipal],
    ['paso protegido', obtenerEslintProtegido],
  ])(
    'criterio 159: ningun archivo de backend/src (salvo pruebas) da error de la regla propia con %s',
    async (_nombre, obtener) => {
      const resultados = await obtener().lintFiles(['backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']);

      const infracciones = resultados
        .filter((resultado) => !resultado.filePath.includes(`${path.sep}zz-r13-`))
        .flatMap((resultado) =>
          resultado.messages
            .filter((mensaje) => mensaje.ruleId === REGLA_PROPIA)
            .map((mensaje) => `${path.relative(raiz, resultado.filePath)}:${mensaje.line}`),
        );
      expect(
        infracciones,
        'promesas descartadas en el codigo actual (main.ts: arrancar().catch; envoltorio.ts: anterior.then(entregar, nada))',
      ).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Con tipos: no-floating-promises sobre archivos reales en una carpeta temporal dentro de backend/src/modulos/
// ---------------------------------------------------------------------------------------------------------------

const PREAMBULO_CON_TIPOS = `declare const tx: { cliente: { configuracion: { update(argumentos: object): Promise<unknown> } } };
declare const auditoria: { registrarEnAcademia(tx: unknown, entrada: object): Promise<void> };
declare function ipParaAuditoria(ip: string | null): string | null;
declare const promesa: Promise<number>;
declare const ok: (valor: number) => number;
declare const err: (motivo: unknown) => number;
declare const fn: (motivo: unknown) => void;
declare const base: { conAcademia<T>(id: string, trabajo: (tx: unknown) => Promise<T>): Promise<T> };
declare const id: string;
async function hacer(): Promise<void> {
  await Promise.resolve();
}
`;

const ATAQUE_TIPADO = `void (async () => {
    await tx.cliente.configuracion.update({ where: {}, data: {} });
    await auditoria.registrarEnAcademia(tx, {});
  })();`;

const ATAQUE_TIPADO_CON_IP = `void (async () => {
    await tx.cliente.configuracion.update({ where: {}, data: {} });
    const ip = ipParaAuditoria('127.0.0.1');
    await auditoria.registrarEnAcademia(tx, { ip });
  })();`;

/** Formas que el lint con tipos rechaza con `no-floating-promises`; `tambienPropia` si ademas las rechaza la regla propia. */
const CON_TIPOS_QUE_FALLAN = {
  'la forma exacta del ataque (void con una funcion async)': { sentencia: ATAQUE_TIPADO, tambienPropia: true },
  'la variante con ipParaAuditoria entre las dos consultas': { sentencia: ATAQUE_TIPADO_CON_IP, tambienPropia: true },
  'void promesa': { sentencia: 'void promesa;', tambienPropia: true },
  '(async () => { ... })();': {
    sentencia: '(async () => {\n    await tx.cliente.configuracion.update({});\n  })();',
    tambienPropia: true,
  },
  'hacer(); con async function hacer()': { sentencia: 'hacer();', tambienPropia: false },
  'promesa.then(() => 1);': { sentencia: 'promesa.then(() => 1);', tambienPropia: false },
  'promesa.finally(() => 1);': { sentencia: 'promesa.finally(() => 1);', tambienPropia: false },
};

const CON_TIPOS_QUE_PASAN = {
  'await promesa': 'await promesa;',
  'promesa.then(ok, err)': 'promesa.then(ok, err);',
  'promesa.catch(fn)': 'promesa.catch(fn);',
  'promesa.then(ok).catch(fn)': 'promesa.then(ok).catch(fn);',
  'void 0': 'void 0;',
  'promesa.then(ok).catch(fn) dentro de un trabajo con await':
    'await base.conAcademia(id, async (tx2) => {\n    await Promise.resolve(tx2);\n    promesa.then(ok).catch(fn);\n    return 1;\n  });',
};

describe('criterio 159: lint normal con tipos (no-floating-promises) sobre archivos reales de backend/src/modulos/', () => {
  const carpeta = path.join(raiz, 'backend', 'src', 'modulos', `zz-r13-${process.pid}`);
  const nombres = new Map();
  /** archivo -> mensajes de severidad 2 */
  let porArchivo;

  const rutaDe = (nombre) => path.join(carpeta, nombre);

  beforeAll(async () => {
    // Carpetas temporales que dejo una ejecucion interrumpida.
    const modulos = path.join(raiz, 'backend', 'src', 'modulos');
    for (const entrada of fs.readdirSync(modulos)) {
      if (entrada.startsWith('zz-r13-')) fs.rmSync(path.join(modulos, entrada), { recursive: true, force: true });
    }
    fs.mkdirSync(carpeta, { recursive: true });
    const crear = (clave, nombreDeArchivo, sentencia) => {
      nombres.set(clave, nombreDeArchivo);
      fs.writeFileSync(
        rutaDe(nombreDeArchivo),
        `${PREAMBULO_CON_TIPOS}export async function caso(): Promise<void> {\n  ${sentencia}\n}\n`,
      );
    };
    Object.entries(CON_TIPOS_QUE_FALLAN).forEach(([clave, { sentencia }], indice) =>
      crear(`falla:${clave}`, `falla-${indice}.ts`, sentencia),
    );
    Object.entries(CON_TIPOS_QUE_PASAN).forEach(([clave, sentencia], indice) =>
      crear(`pasa:${clave}`, `pasa-${indice}.ts`, sentencia),
    );
    // Una prueba de backend/src con void (async () => { ... })(): fuera de alcance.
    nombres.set('prueba', 'ejemplo.service.test.ts');
    // Con una prueba omitida dentro, para que Vitest no falle ("No test suite found") si encuentra este archivo en una carpeta que quedo.
    fs.writeFileSync(
      rutaDe('ejemplo.service.test.ts'),
      `import { it } from 'vitest';\n${PREAMBULO_CON_TIPOS}it.skip('ejemplo de una prueba de backend/src', () => undefined);\nexport async function caso(): Promise<void> {\n  ${ATAQUE_TIPADO}\n}\n`,
    );

    const eslint = new ESLint({ cwd: raiz });
    const resultados = await eslint.lintFiles([`backend/src/modulos/${path.basename(carpeta)}/*.ts`]);
    porArchivo = new Map(resultados.map((resultado) => [path.basename(resultado.filePath), resultado.messages]));
  }, 280_000);

  afterAll(() => {
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const reglasDe = (clave) => {
    const mensajes = porArchivo.get(nombres.get(clave)) ?? [];
    expect(
      mensajes.filter((mensaje) => mensaje.fatal),
      `error al analizar ${clave}`,
    ).toEqual([]);
    return mensajes.filter((mensaje) => mensaje.severity === 2).map((mensaje) => mensaje.ruleId);
  };

  it.each(Object.entries(CON_TIPOS_QUE_FALLAN))(
    'criterio 159: %s da error de @typescript-eslint/no-floating-promises',
    (forma, { tambienPropia }) => {
      const reglas = reglasDe(`falla:${forma}`);

      expect(reglas, `reglas con error: ${JSON.stringify(reglas)}`).toContain(REGLA_DE_TIPOS);
      if (tambienPropia) expect(reglas, 'tambien la regla propia').toContain(REGLA_PROPIA);
    },
  );

  it.each(Object.entries(CON_TIPOS_QUE_PASAN))('criterio 159: %s no da error de ninguna de las dos reglas', (forma) => {
    const reglas = reglasDe(`pasa:${forma}`);

    expect(reglas).not.toContain(REGLA_DE_TIPOS);
    expect(reglas).not.toContain(REGLA_PROPIA);
  });

  it('criterio 159: una prueba *.test.ts de backend/src con void (async () => { ... })() no da error de ninguna de las dos reglas', () => {
    const reglas = reglasDe('prueba');

    expect(reglas).not.toContain(REGLA_DE_TIPOS);
    expect(reglas).not.toContain(REGLA_PROPIA);
  });
});
