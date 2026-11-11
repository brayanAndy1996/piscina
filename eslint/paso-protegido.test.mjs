// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 96 (ataque ronda 3, O1; reemplaza la precision P-15 y la frase del criterio 85 sobre eslint-disable) y criterio 97
// (solo se compila lo que el lint revisa). Dado el repositorio:
//   - `eslint.config.mjs` ya no fija `linterOptions.noInlineConfig` para `backend/src`: en el lint normal, un comentario
//     `eslint-disable` vuelve a apagar la regla que nombra;
//   - hay una configuracion aparte para el paso protegido (`eslint.protegido.config.mjs` en la raiz) con solo el analizador de
//     TypeScript y las reglas de los criterios 28, 73, 83, 84, 85 y 92 a 95, sobre los archivos del criterio 95, y ninguna otra
//     regla;
//   - `npm run lint` ejecuta `eslint . --max-warnings 0` y ademas ese paso con `--no-inline-config` sobre `backend/src`, y falla
//     si falla cualquiera de los dos.
// Criterio 97: ni `backend/tsconfig.build.json` ni los `tsconfig` de los que hereda activan `allowJs`.
import { spawnSync } from 'node:child_process';
import js from '@eslint/js';
import fs from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  MODULO,
  RUTA_CONFIG_PROTEGIDA,
  errores,
  obtenerEslintPrincipal,
  obtenerEslintProtegido,
  raiz,
} from './ayuda-lint-ronda3.mjs';

const PRISMA_SQL = 'export const f = (tx) => tx.cliente.$queryRaw`SET ROLE postgres`;';
const REQUIRE_PG = "export const pg = require('pg');";

/** Las formas de comentario de configuracion en linea que el paso protegido debe ignorar. */
function conComentarios(linea, reglas) {
  const lista = reglas.join(', ');
  const apagarTodas = reglas.map((regla) => `${regla}: "off"`).join(', ');
  return [
    ['// eslint-disable-next-line sin nombres', `// eslint-disable-next-line\n${linea}`],
    ['// eslint-disable-next-line con los nombres', `// eslint-disable-next-line ${lista}\n${linea}`],
    ['eslint-disable-line sin nombres', `${linea} // eslint-disable-line`],
    ['eslint-disable-line con los nombres', `${linea} // eslint-disable-line ${lista}`],
    ['/* eslint-disable */ de archivo, sin nombres', `/* eslint-disable */\n${linea}`],
    ['/* eslint-disable <reglas> */ de archivo', `/* eslint-disable ${lista} */\n${linea}`],
    ['/* eslint-disable-next-line */ de bloque', `/* eslint-disable-next-line */\n${linea}`],
    ['/* eslint-disable-line */ de bloque', `${linea} /* eslint-disable-line */`],
    ['/* eslint <reglas>: "off" */', `/* eslint ${apagarTodas} */\n${linea}`],
    ['/* eslint <reglas>: 0 */', `/* eslint ${reglas.map((regla) => `${regla}: 0`).join(', ')} */\n${linea}`],
    ['/* eslint-disable */ ... /* eslint-enable */ alrededor', `/* eslint-disable */\n${linea}\n/* eslint-enable */`],
  ];
}

describe('criterio 96: eslint.config.mjs deja de fijar noInlineConfig', () => {
  const eslint = obtenerEslintPrincipal();

  it('criterio 96: la configuracion de un archivo de backend/src no activa noInlineConfig', async () => {
    const configuracion = await eslint.calculateConfigForFile(path.join(raiz, MODULO));

    expect(configuracion?.linterOptions?.noInlineConfig ?? false).toBe(false);
  });

  it('criterio 96: // eslint-disable-next-line @typescript-eslint/no-explicit-any apaga esa regla en un archivo de backend/src', async () => {
    const sinComentario = 'export const x: any = 1;';
    const conComentario = '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const x: any = 1;';

    const antes = await eslint.lintText(sinComentario, { filePath: path.join(raiz, MODULO) });
    const despues = await eslint.lintText(conComentario, { filePath: path.join(raiz, MODULO) });

    expect(antes[0].messages.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any' && m.severity === 2)).toBe(
      true,
    );
    expect(despues[0].messages.filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toEqual([]);
    // Y no queda ningun aviso de que el comentario "no tiene efecto".
    expect(despues[0].messages.filter((m) => /has no effect/i.test(m.message))).toEqual([]);
  });

  it('criterio 96: /* eslint-disable */ de archivo apaga una regla comun en un archivo de backend/src', async () => {
    const codigo = '/* eslint-disable @typescript-eslint/no-explicit-any */\nexport const x: any = 1;';

    const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, MODULO) });

    expect(resultado.messages.filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toEqual([]);
  });
});

describe('criterio 96: la configuracion del paso protegido', () => {
  it('criterio 96: existe eslint.protegido.config.mjs en la raiz', () => {
    expect(fs.existsSync(RUTA_CONFIG_PROTEGIDA), 'falta eslint.protegido.config.mjs').toBe(true);
  });

  it('criterio 96: con allowInlineConfig: false, require("pg") precedido de cualquier comentario sigue dando error', async () => {
    const eslint = obtenerEslintProtegido();
    const sinComentario = await errores(eslint, REQUIRE_PG, MODULO);
    expect(sinComentario.length, 'require(pg) debia fallar').toBeGreaterThan(0);
    const reglas = [...new Set(sinComentario.map((m) => m.ruleId).filter(Boolean))];

    for (const [forma, codigo] of conComentarios(REQUIRE_PG, reglas)) {
      expect(
        (await errores(eslint, codigo, MODULO)).length,
        `${forma}: el comentario apago la regla:\n${codigo}`,
      ).toBeGreaterThan(0);
    }
  });

  it('criterio 96: con allowInlineConfig: false, un $queryRaw con SET ROLE precedido de cualquier comentario sigue dando error', async () => {
    const eslint = obtenerEslintProtegido();
    const sinComentario = await errores(eslint, PRISMA_SQL, MODULO);
    expect(sinComentario.length, 'el SET ROLE debia fallar').toBeGreaterThan(0);
    const reglas = [...new Set(sinComentario.map((m) => m.ruleId).filter(Boolean))];

    for (const [forma, codigo] of conComentarios(PRISMA_SQL, reglas)) {
      expect(
        (await errores(eslint, codigo, MODULO)).length,
        `${forma}: el comentario apago la regla:\n${codigo}`,
      ).toBeGreaterThan(0);
    }
  });

  it('criterio 96: los comentarios que nombran reglas se ignoran aunque la regla no exista en el paso protegido', async () => {
    const codigo = `// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-imports\n${REQUIRE_PG}`;

    expect((await errores(obtenerEslintProtegido(), codigo, MODULO)).length).toBeGreaterThan(0);
  });

  it('criterio 96: con eslint.config.mjs, el mismo comentario apaga la regla (el paso protegido es el que no se puede apagar)', async () => {
    const principal = obtenerEslintPrincipal();
    const reglas = [...new Set((await errores(principal, PRISMA_SQL, MODULO)).map((m) => m.ruleId).filter(Boolean))];
    expect(reglas.length, 'el ejemplo debia fallar con eslint.config.mjs').toBeGreaterThan(0);

    const restantes = (
      await errores(principal, `// eslint-disable-next-line ${reglas.join(', ')}\n${PRISMA_SQL}`, MODULO)
    ).filter((m) => reglas.includes(m.ruleId));

    expect(restantes).toEqual([]);
  });

  it('criterio 96: el paso protegido no aplica ninguna otra regla (solo las de los criterios 28, 73, 83, 84, 85 y 92 a 95)', async () => {
    const eslint = obtenerEslintProtegido();
    // Un archivo que incumple reglas comunes (variable sin usar, any, var, console, == en lugar de ===, etc.) pero no las de
    // acceso a la base ni las del SQL: con el paso protegido no da ningun error.
    const codigo = [
      'var sinUsar = 1;',
      'export const x: any = 1;',
      'export function f(a, b) {',
      '  if (a == b) console.log(c);',
      '  debugger;',
      '  return undeclared;',
      '}',
      'const sinExportar = 2;',
      'let nunca = 3;',
    ].join('\n');

    const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, MODULO) });

    expect(resultado.messages.filter((m) => m.fatal)).toEqual([]);
    expect(resultado.messages.filter((m) => m.severity === 2)).toEqual([]);
  });

  it('criterio 96: la configuracion de un archivo de backend/src solo trae reglas de los criterios del paso protegido', async () => {
    const configuracion = await obtenerEslintProtegido().calculateConfigForFile(path.join(raiz, MODULO));
    const activas = Object.entries(configuracion?.rules ?? {})
      .filter(
        ([, valor]) =>
          (Array.isArray(valor) ? valor[0] : valor) !== 0 && (Array.isArray(valor) ? valor[0] : valor) !== 'off',
      )
      .map(([nombre]) => nombre);

    // Ninguna regla de js.configs.recommended ni de typescript-eslint.recommended (con y sin tipos), salvo las `no-restricted-*`,
    // que son las que usan las reglas de acceso a la base y de importaciones.
    const generales = new Set([
      ...Object.keys(js.configs.recommended.rules),
      ...[...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.recommended].flatMap((configuracion) =>
        Object.keys(configuracion.rules ?? {}),
      ),
      'eqeqeq',
      'no-console',
      'no-var',
      'prefer-const',
    ]);
    const incluidas = activas.filter((nombre) => generales.has(nombre) && !/(^|\/)no-restricted-/.test(nombre));

    expect(
      incluidas,
      'el paso protegido incluye reglas que no son de los criterios 28, 73, 83, 84, 85 y 92 a 95',
    ).toEqual([]);
    expect(activas.length, 'el paso protegido no tiene ninguna regla activa').toBeGreaterThan(0);
  });

  it('criterio 96: el paso protegido cubre las extensiones del criterio 95 y no las pruebas', async () => {
    const eslint = obtenerEslintProtegido();
    for (const extension of ['ts', 'tsx', 'mts', 'cts', 'js', 'mjs', 'cjs']) {
      const archivo = `backend/src/modulos/ejemplo/ejemplo.service.${extension}`;
      const codigo =
        extension === 'cjs' || extension === 'cts'
          ? REQUIRE_PG.replace('export ', '')
          : "import pg from 'pg';\nexport const x = pg;";
      expect((await errores(eslint, codigo, archivo)).length, `.${extension}`).toBeGreaterThan(0);
    }
    expect(await errores(eslint, REQUIRE_PG, 'backend/src/modulos/ejemplo/ejemplo.service.test.ts')).toEqual([]);
  });
});

/** Texto del script de npm, con `npm run <otro>` sustituido por el del otro script (recursivo). */
function expandirScript(scripts, nombre, vistos = new Set()) {
  if (vistos.has(nombre)) return '';
  vistos.add(nombre);
  const texto = scripts[nombre] ?? '';
  return texto.replace(/npm\s+run\s+(?:--silent\s+|-s\s+)?([\w:.-]+)/g, (_todo, otro) =>
    scripts[otro] === undefined ? _todo : `(${expandirScript(scripts, otro, vistos)})`,
  );
}

describe('criterio 96: el script lint de package.json', () => {
  const paquete = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const lint = expandirScript(paquete.scripts, 'lint');

  it('criterio 96: ejecuta eslint . --max-warnings 0', () => {
    expect(lint).toMatch(/eslint\s+\.\s+--max-warnings\s+0/);
  });

  it('criterio 96: ejecuta ademas el paso protegido con --no-inline-config, la configuracion aparte, --max-warnings 0 y backend/src', () => {
    const paso = lint.match(/eslint[^&|;()]*--no-inline-config[^&|;()]*/)?.[0] ?? '';

    expect(paso, `no hay un paso de eslint con --no-inline-config en: ${lint}`).not.toBe('');
    expect(paso).toMatch(/--config\s+eslint\.protegido\.config\.mjs|-c\s+eslint\.protegido\.config\.mjs/);
    expect(paso).toMatch(/--max-warnings\s+0/);
    expect(paso).toMatch(/backend\/src/);
  });

  it('criterio 96: los dos pasos se encadenan con && (falla si falla cualquiera)', () => {
    const aPrincipal = lint.search(/eslint\s+\.\s+--max-warnings\s+0/);
    const aProtegido = lint.search(/eslint[^&|;()]*--no-inline-config/);

    expect(aPrincipal).toBeGreaterThanOrEqual(0);
    expect(aProtegido).toBeGreaterThan(aPrincipal);
    const entre = lint.slice(aPrincipal, aProtegido);
    expect(entre).toContain('&&');
    expect(entre).not.toMatch(/\|\||;|\|\s*true/);
    expect(lint).not.toMatch(/\|\|\s*true|;\s*exit\s+0/);
  });

  it('criterio 96: el paso principal no se salta con --no-inline-config y el protegido no usa --no-warn-ignored ni --quiet', () => {
    const paso = lint.match(/eslint[^&|;()]*--no-inline-config[^&|;()]*/)?.[0] ?? '';

    expect(paso, 'no hay un paso con --no-inline-config').not.toBe('');
    expect(paso).not.toMatch(/--quiet|--no-warn-ignored|--fix|--rule/);
  });
});

describe('criterio 96: el paso protegido sobre el codigo real de backend/src', () => {
  it('criterio 96: eslint --no-inline-config --config eslint.protegido.config.mjs --max-warnings 0 backend/src termina con codigo 0', () => {
    const eslintBin = path.join(raiz, 'node_modules', 'eslint', 'bin', 'eslint.js');
    const resultado = spawnSync(
      process.execPath,
      [
        eslintBin,
        '--no-inline-config',
        '--config',
        'eslint.protegido.config.mjs',
        '--max-warnings',
        '0',
        'backend/src',
      ],
      { cwd: raiz, encoding: 'utf8', timeout: 120_000 },
    );

    expect(`${resultado.stdout}${resultado.stderr}`.trim(), 'el paso protegido encontro errores').toBe('');
    expect(resultado.status).toBe(0);
  }, 120_000);
});

describe('criterio 97: solo se compila lo que el lint revisa', () => {
  /** Lee un tsconfig (con comentarios) y devuelve la cadena de configuraciones que hereda, de la hija a la ultima. */
  function cadenaDeConfiguraciones(archivo, vistos = new Set()) {
    const ruta = path.resolve(archivo);
    if (vistos.has(ruta)) return [];
    vistos.add(ruta);
    const { config, error } = ts.readConfigFile(ruta, ts.sys.readFile);
    if (error) throw new Error(`No se pudo leer ${ruta}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    const extiende =
      config.extends === undefined ? [] : Array.isArray(config.extends) ? config.extends : [config.extends];
    const padres = extiende
      .filter((origen) => origen.startsWith('.'))
      .flatMap((origen) =>
        cadenaDeConfiguraciones(
          path.resolve(path.dirname(ruta), origen.endsWith('.json') ? origen : `${origen}.json`),
          vistos,
        ),
      );
    return [{ ruta, config }, ...padres];
  }

  it('criterio 97: backend/tsconfig.build.json y los tsconfig de los que hereda no activan allowJs', () => {
    const cadena = cadenaDeConfiguraciones(path.join(raiz, 'backend', 'tsconfig.build.json'));

    expect(cadena.length).toBeGreaterThanOrEqual(2);
    for (const { ruta, config } of cadena) {
      expect(config.compilerOptions?.allowJs, `${path.relative(raiz, ruta)} activa allowJs`).not.toBe(true);
      expect(config.compilerOptions?.checkJs, `${path.relative(raiz, ruta)} activa checkJs`).not.toBe(true);
    }
  });

  it('criterio 97: tsconfig.base.json y backend/tsconfig.json tampoco activan allowJs', () => {
    for (const archivo of ['tsconfig.base.json', path.join('backend', 'tsconfig.json')]) {
      for (const { ruta, config } of cadenaDeConfiguraciones(path.join(raiz, archivo))) {
        expect(config.compilerOptions?.allowJs, `${path.relative(raiz, ruta)} activa allowJs`).not.toBe(true);
      }
    }
  });
});
