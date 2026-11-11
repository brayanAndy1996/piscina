// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 73 (ataque ronda 1, F1): `npm run lint` falla si el codigo de backend/src/ (sin contar las pruebas) trae un
// texto SQL (cadena, plantilla o plantilla etiquetada como $queryRaw`...` o Prisma.sql`...`) que cambia el contexto de
// sesion de PostgreSQL:
//   - fuera de backend/src/infraestructura/prisma/: set_config( con false como ultimo argumento; SET app., SET LOCAL
//     app. o SET SESSION; SET ROLE; RESET (de app.*, ROLE o ALL);
//   - ademas, fuera de backend/src/infraestructura/prisma/ y de backend/src/cli/: cualquier set_config('app.
// Se prueba con el eslint.config.mjs real, por su efecto observable (un error de ESLint), sin fijar el nombre de la
// regla, y sin informacion de tipos (los archivos de los ejemplos no estan en disco).
//
// ADAPTADO A LA RONDA 3 DEL ATAQUE (criterio 92, que reemplaza el alcance del 73): la regla del SQL de sesion ya no analiza
// cadenas, plantillas sin etiqueta ni expresiones regulares; solo el texto de las plantillas etiquetadas con $queryRaw,
// $executeRaw, Prisma.sql o sql. Los mismos textos SQL siguen probandose como plantillas etiquetadas (deben fallar) y, como
// cadena o plantilla sin etiqueta, pasan a probarse como ejemplos que pasan. Un SQL prohibido pasado como cadena a
// $queryRawUnsafe/$executeRawUnsafe falla por el criterio 92 (se nombra el metodo Unsafe). Cada cambio de sentido lleva un
// comentario "(criterio 92)".
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const eslint = new ESLint({
  cwd: raiz,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

/** Errores de ESLint (no advertencias) que produce el codigo en el archivo indicado. */
async function errores(codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, archivo) });
  const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
  expect(fatales, `error al analizar ${archivo}`).toEqual([]);
  return resultado.messages.filter((mensaje) => mensaje.severity === 2);
}

const MODULO = 'backend/src/modulos/ejemplo/ejemplo.service.ts';
const PRISMA = 'backend/src/infraestructura/prisma/base-datos.ts';
const CLI = 'backend/src/cli/superadmin.ts';

/**
 * Ejemplos de SQL en las formas de texto que la regla analiza (criterio 92): plantillas etiquetadas con $queryRaw,
 * $executeRaw, Prisma.sql y sql, con un ${} que la regla sustituye por un marcador. Y, para SQL prohibido, el mismo texto
 * como cadena de $queryRawUnsafe, que falla por el criterio 92 (el nombre Unsafe).
 */
function enFormasAnalizadas(sql) {
  return [
    ['$queryRaw etiquetada', `export const leer = (cliente, id) => cliente.$queryRaw\`${sql} \${id}\`;`],
    ['$executeRaw etiquetada', `export const leer = (cliente, id) => cliente.$executeRaw\`${sql} \${id}\`;`],
    ['Prisma.sql etiquetada', `export const leer = (id) => Prisma.sql\`${sql} \${id}\`;`],
    ['sql etiquetada', `export const leer = (id) => sql\`${sql} \${id}\`;`],
  ];
}

/** El mismo texto como cadena de $queryRawUnsafe: falla por el criterio 92, sea cual sea el SQL. */
function enUnsafe(sql) {
  return `export const leer = (cliente) => cliente.$queryRawUnsafe(${JSON.stringify(sql)});`;
}

/**
 * (criterio 92) Formas que la regla del SQL de sesion ya NO analiza: cadena y plantilla sin etiqueta (con y sin ${}). Antes
 * de la ronda 3 eran rechazadas; ahora pasan.
 */
function enFormasNoAnalizadas(sql) {
  return [
    ['cadena', `export const consulta = ${JSON.stringify(sql)};`],
    ['plantilla sin ${}', `export const consulta = \`${sql}\`;`],
    ['plantilla con ${}', `export const consulta = (id) => \`${sql} \${id}\`;`],
  ];
}

/** Todas las formas (para los ejemplos que deben pasar en cualquiera de ellas). */
function enTodasLasFormas(sql) {
  return [...enFormasAnalizadas(sql), ...enFormasNoAnalizadas(sql)];
}

/** Un SQL como plantilla etiquetada con $queryRaw, sin interpolaciones. */
const comoPlantilla = (sql) => `export const consulta = (cliente) => cliente.$queryRaw\`${sql}\`;`;

/**
 * El ejemplo debe fallar el lint en un modulo normal y estar limpio en backend/src/infraestructura/prisma/: asi se sabe
 * que el error es de la regla del contexto de sesion y no de otra cosa del ejemplo.
 */
async function esRechazadoSoloFueraDePrisma(codigo) {
  expect(await errores(codigo, PRISMA), `el ejemplo tiene otros errores de lint: ${codigo}`).toEqual([]);
  const encontrados = await errores(codigo, MODULO);
  expect(encontrados.length, `el lint no rechazo: ${codigo}`).toBeGreaterThan(0);
}

// Primer grupo: vale fuera de backend/src/infraestructura/prisma/.
const PROHIBIDAS_FUERA_DE_PRISMA = [
  ['set_config con false como ultimo argumento', "SELECT set_config('app.plataforma', 'si', false)"],
  ['set_config con false y otro nombre', "SELECT set_config('search_path', 'public', false)"],
  ['set_config con false, espacios y mayusculas', "SELECT set_config( 'app.academia_id' , $1 , FALSE )"],
  ['SET app.', "SET app.plataforma = 'si'"],
  ['SET LOCAL app.', "SET LOCAL app.academia_id = 'x'"],
  ['SET SESSION', "SET SESSION app.plataforma = 'si'"],
  ['SET SESSION AUTHORIZATION', 'SET SESSION AUTHORIZATION postgres'],
  ['SET ROLE', 'SET ROLE postgres'],
  ['RESET de app.', 'RESET app.plataforma'],
  ['RESET ROLE', 'RESET ROLE'],
  ['RESET ALL', 'RESET ALL'],
  ['SET ROLE en minusculas', 'set role postgres'],
  ['RESET ALL con mayusculas mezcladas', 'Reset All'],
  ['set_config en minusculas y false en mayusculas', "select SET_CONFIG('app.x', 'y', False)"],
];

describe('criterio 73: contexto de sesion fuera de infraestructura/prisma', () => {
  for (const [descripcion, sql] of PROHIBIDAS_FUERA_DE_PRISMA) {
    describe(descripcion, () => {
      it.each(enFormasAnalizadas(sql))('criterio 73: un modulo con %s falla el lint', async (_forma, codigo) => {
        await esRechazadoSoloFueraDePrisma(codigo);
      });

      // (criterio 92) Antes, tambien fallaban la cadena y las plantillas sin etiqueta (cinco formas); ahora solo se analizan las
      // plantillas etiquetadas, y un SQL pasado como cadena a $queryRawUnsafe falla por el nombre Unsafe.
      it('criterio 92: el mismo texto como cadena de $queryRawUnsafe falla el lint, y no en backend/src/infraestructura/prisma/', async () => {
        await esRechazadoSoloFueraDePrisma(enUnsafe(sql));
      });

      it('criterio 92: el mismo texto como cadena o plantilla sin etiqueta ya no es SQL para el lint y pasa', async () => {
        for (const [forma, codigo] of enFormasNoAnalizadas(sql)) {
          expect(await errores(codigo, MODULO), `forma ${forma}: ${codigo}`).toEqual([]);
        }
      });

      it('criterio 73: el mismo texto no falla dentro de backend/src/infraestructura/prisma/', async () => {
        expect(await errores(comoPlantilla(sql), PRISMA)).toEqual([]);
      });

      it('criterio 73: el mismo texto tampoco se salva en backend/src/cli/', async () => {
        expect((await errores(comoPlantilla(sql), CLI)).length).toBeGreaterThan(0);
      });

      it.each([
        ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
        ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
        ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
      ])('criterio 73: el mismo texto no falla en %s', async (_nombre, archivo) => {
        expect(await errores(comoPlantilla(sql), archivo)).toEqual([]);
      });
    });
  }
});

// Segundo grupo: cualquier set_config('app. (aunque sea con true) solo se permite en BaseDatos y en los comandos.
describe("criterio 73: set_config('app. fuera de infraestructura/prisma y de cli", () => {
  const LOCAL = "SELECT set_config('app.academia_id', $1, true)";

  it.each(enFormasAnalizadas(LOCAL))(
    'criterio 73: un modulo con %s (con true) falla el lint',
    async (_forma, codigo) => {
      await esRechazadoSoloFueraDePrisma(codigo);
    },
  );

  it.each([
    ['con SET_CONFIG, APP. y TRUE en mayusculas', `SELECT SET_CONFIG('APP.plataforma', 'si', TRUE)`],
    ['en una consulta con otras columnas', `SELECT 1 AS n, set_config('app.plataforma', 'si', true)`],
  ])('criterio 73: un modulo %s falla el lint', async (_nombre, sql) => {
    await esRechazadoSoloFueraDePrisma(comoPlantilla(sql));
  });

  it.each([
    ['la carpeta de Prisma de la infraestructura', PRISMA],
    ['los comandos', CLI],
    ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
    ['las pruebas de integracion', 'backend/test/integracion/ejemplo.test.ts'],
    ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
  ])('criterio 73: set_config(..., true) se permite en %s', async (_nombre, archivo) => {
    expect(await errores(comoPlantilla(LOCAL), archivo)).toEqual([]);
  });
});

// Ejemplos que deben pasar en un modulo normal.
describe('criterio 73: SQL que no cambia el contexto de sesion pasa el lint', () => {
  it.each([
    ['una consulta cualquiera', 'SELECT id, nombre FROM academias WHERE nombre_corto = $1'],
    // (Se quitaron de esta lista "SELECT set_config('statement_timeout', '5s', true)" y "SET LOCAL statement_timeout": el
    // criterio 83 (ataque ronda 2) prohíbe fuera de infraestructura/prisma/ y de cli/ cualquier llamada a set_config, y el 84
    // prohíbe como sentencia cualquier SET o RESET, sea de la variable que sea. Su rechazo se prueba en
    // regla-sql-sesion-ronda2.test.mjs.)
    ['un texto con la palabra reset', 'reset de la clave del usuario'],
    ['un texto sin SQL', 'Hola, bienvenido a la academia'],
  ])('criterio 73: %s', async (_nombre, sql) => {
    for (const [forma, codigo] of enTodasLasFormas(sql)) {
      expect(await errores(codigo, MODULO), `forma ${forma}: ${codigo}`).toEqual([]);
    }
  });

  it('criterio 73: una plantilla etiquetada con ${} se analiza con un marcador y pasa si no cambia el contexto', async () => {
    const codigo =
      'export const leer = (cliente, id) => cliente.$queryRaw`SELECT * FROM auditoria WHERE academia_id = ${id}`;';

    expect(await errores(codigo, MODULO)).toEqual([]);
  });

  it('criterio 73: un comentario que menciona set_config(..., false) no es un texto SQL', async () => {
    const codigo = [
      "// no uses set_config('app.plataforma', 'si', false) fuera de BaseDatos",
      'export const n = 1;',
    ].join('\n');

    expect(await errores(codigo, MODULO)).toEqual([]);
  });
});

// Plantillas con ${}: el marcador sustituye a cada expresion, tambien dentro de set_config.
describe('criterio 73: plantillas con ${}', () => {
  it.each([
    [
      '$queryRaw con el valor interpolado y false',
      "export const f = (cliente, id) => cliente.$queryRaw`SELECT set_config('app.academia_id', ${id}, false)`;",
    ],
    [
      'Prisma.sql con el valor interpolado y false',
      "export const f = (id) => Prisma.sql`SELECT set_config('search_path', ${id}, false)`;",
    ],
    // (criterio 92) Antes eran plantillas sin etiqueta (`SET ROLE ${rol}` y `SELECT set_config('app.academia_id', ${id}, true)`);
    // ahora el mismo SQL se prueba dentro de una plantilla etiquetada, la unica que se analiza.
    [
      'una plantilla $queryRaw con SET ROLE y un nombre interpolado',
      'export const f = (cliente, rol) => cliente.$queryRaw`SET ROLE ${rol}`;',
    ],
    [
      'una plantilla Prisma.sql con set_config true y nombre interpolado dentro de app.',
      "export const f = (id) => Prisma.sql`SELECT set_config('app.academia_id', ${id}, true)`;",
    ],
  ])('criterio 73: un modulo con %s falla el lint', async (_nombre, codigo) => {
    await esRechazadoSoloFueraDePrisma(codigo);
  });

  it.each([
    ['SET ROLE y un nombre interpolado', 'export const f = (rol) => `SET ROLE ${rol}`;'],
    [
      'set_config true y nombre interpolado dentro de app.',
      "export const f = (id) => `SELECT set_config('app.academia_id', ${id}, true)`;",
    ],
  ])('criterio 92: una plantilla SIN etiqueta con %s ya no es SQL para el lint y pasa', async (_nombre, codigo) => {
    expect(await errores(codigo, MODULO)).toEqual([]);
  });
});
