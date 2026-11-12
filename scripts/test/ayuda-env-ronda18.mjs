// spec: 001-academias-aislamiento (pruebas protegidas)
// Ayuda de las pruebas del ataque ronda 18 (criterios 172 a 174, P-45): los conjuntos de prueba (a), (d) y (f), el generador con semilla
// fija, `VARIABLES_5433`, `URL_5432`, `URL_5433`, `RESTO` y la carga del `dotenv` del backend. No es una prueba (no termina en
// `.test.mjs`): la importan `entorno-dotenv-ronda18.test.mjs`, `completar-env-ronda18.test.mjs` y `preparar-sesion-ronda18.test.mjs`.
// Solo usa modulos `node:*` y el `dotenv` instalado.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** El `dotenv` instalado del backend: el analizador contra el que se compara todo (criterio 172). */
export const dotenv = createRequire(path.join(raizReal, 'backend', 'package.json'))('dotenv');

export const U = '\uFEFF';

export const EJEMPLO_REAL = fs.readFileSync(path.join(raizReal, '.env.example'), 'utf8');

/** Las lineas de variables activas de `.env.example`, en su orden, con `5432` cambiado por `5433`. */
export const VARIABLES_5433 = EJEMPLO_REAL.split(/\r?\n/)
  .filter((linea) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(linea))
  .map((linea) => linea.replaceAll('5432', '5433'));

export const nombreDe = (linea) => linea.slice(0, linea.indexOf('='));
export const NOMBRES_REALES = VARIABLES_5433.map(nombreDe);

/** La `DATABASE_URL` de `.env.example` (con su puerto 5432) y con 5433. */
export const URL_5432 = EJEMPLO_REAL.split(/\r?\n/)
  .find((linea) => linea.startsWith('DATABASE_URL='))
  .slice('DATABASE_URL='.length);
export const URL_5433 = URL_5432.replaceAll('5432', '5433');

/** Las lineas de `VARIABLES_5433` sin la de `DATABASE_URL`. `RESTO` las une con `\n`. */
export const LINEAS_RESTO = VARIABLES_5433.filter((linea) => !linea.startsWith('DATABASE_URL='));
export const RESTO = LINEAS_RESTO.join('\n');

const entreComillas = (linea, comilla) => linea.replace(/=(.*)$/, `=${comilla}$1${comilla}`);

/** Conjunto (a) del criterio 169 (el de la ronda 17): [nombre, texto]. */
export const CONJUNTO_A = [
  ['e1 (BOM, \\r\\n, \\r\\n final)', `${U}${VARIABLES_5433.join('\r\n')}\r\n`],
  ['e2 (BOM, comentario inicial, \\n)', `${U}# Configuración\n${VARIABLES_5433.join('\n')}\n`],
  ['e3 (BOM, export DATABASE_URL)', `${U}export ${VARIABLES_5433[0]}\n${VARIABLES_5433.slice(1).join('\n')}\n`],
  [
    'e4 (BOM, DATABASE_URL entre comillas dobles)',
    `${U}${entreComillas(VARIABLES_5433[0], '"')}\n${VARIABLES_5433.slice(1).join('\n')}\n`,
  ],
  [
    'e4 (BOM, DATABASE_URL entre comillas simples)',
    `${U}${entreComillas(VARIABLES_5433[0], "'")}\n${VARIABLES_5433.slice(1).join('\n')}\n`,
  ],
  [
    'e5 (BOM, PUERTO_API con comentario en la linea)',
    `${U}PUERTO_API=3000 # comentario\n${VARIABLES_5433.join('\n')}\n`,
  ],
  ['e6 (BOM, primera linea en blanco)', `${U}\n${VARIABLES_5433.join('\n')}\n`],
  ['e7 (control sin BOM, \\r\\n)', `${VARIABLES_5433.join('\r\n')}\r\n`],
  ['e8 (solo el BOM)', U],
  ['e8 (texto vacio)', ''],
];

/**
 * Conjunto (d) del criterio 172 (variables repetidas y saltos de linea) para la variable `nombre` (`DATABASE_URL` por omision;
 * `DATABASE_URL_APP` para las utilidades de prueba): [nombre del caso, texto]. Cada texto define todas las variables de
 * `.env.example`. `incluirSaltoDeLinea` agrega (d7) (F2), que solo se arma para `DATABASE_URL`.
 */
export function conjuntoD(nombre = 'DATABASE_URL', { incluirSaltoDeLinea = nombre === 'DATABASE_URL' } = {}) {
  const lineaReal = VARIABLES_5433.find((linea) => linea.startsWith(`${nombre}=`));
  const valor5433 = lineaReal.slice(nombre.length + 1);
  const valor5432 = valor5433.replaceAll('5433', '5432');
  const resto = VARIABLES_5433.filter((linea) => !linea.startsWith(`${nombre}=`));
  const primera = `${nombre}=${valor5432}\n${resto.join('\n')}\n`;
  const casos = [
    ['d1 (archivos concatenados, U+FEFF delante)', `${primera}${U}${nombre}=${valor5433}\n`],
    ['d2 (U+00A0 delante)', `${primera}\u00A0${nombre}=${valor5433}\n`],
    ['d3 (la misma linea dos veces)', `${primera}${nombre}=${valor5433}\n`],
    ['d4 (tabulacion delante)', `${primera}\t${nombre}=${valor5433}\n`],
    ['d5 (la segunda con dos puntos y un espacio)', `${primera}${nombre}: ${valor5433}\n`],
    ['d6 (la segunda con export)', `${primera}export ${nombre}=${valor5433}\n`],
  ];
  if (incluirSaltoDeLinea) {
    casos.push(
      ['d7 (F2: salto de linea antes del =, \\r\\n)', `${nombre}\r\n=${valor5433}\r\n${resto.join('\r\n')}\r\n`],
      [
        'd7 (F2: espacio, tabulacion y salto de linea antes del =)',
        `${nombre} \t\n = ${valor5433}\n${resto.join('\n')}\n`,
      ],
    );
  }
  return casos;
}

/** (d1) a (d7) para `DATABASE_URL`. */
export const CONJUNTO_D = conjuntoD('DATABASE_URL');

/** (d1) tal como lo pide el criterio 174 (h6, h8). */
export const D1 = CONJUNTO_D[0][1];

/** Generador pseudoaleatorio con semilla (mulberry32): devuelve numeros en [0, 1). Determinista en todos los sistemas. */
export function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function siguiente() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Las piezas del conjunto (f) (la lista del fuzz de la ronda 18, con `DB` cambiado por `DATABASE_URL`). */
export const PIEZAS_DEL_FUZZ = [
  'DATABASE_URL',
  'K',
  '=',
  ':',
  ' ',
  '\t',
  '\n',
  '\r',
  '\r\n',
  '"',
  "'",
  '`',
  '#',
  'export ',
  '\\',
  '\uFEFF',
  '\u00A0',
  '\u2028',
  '\u3000',
  '\v',
  '\f',
  'x',
  '.',
  '-',
];

export const SEMILLA_DEL_FUZZ = 18;
export const CANTIDAD_DEL_FUZZ = 20_000;

/** Conjunto (f): `cantidad` textos de 1 a 9 piezas, generados con `mulberry32(18)`. Siempre los mismos, en el mismo orden. */
export function textosDelFuzz(cantidad = CANTIDAD_DEL_FUZZ) {
  const aleatorio = mulberry32(SEMILLA_DEL_FUZZ);
  const textos = [];
  for (let i = 0; i < cantidad; i += 1) {
    const largo = 1 + Math.floor(aleatorio() * 9);
    let texto = '';
    for (let j = 0; j < largo; j += 1) texto += PIEZAS_DEL_FUZZ[Math.floor(aleatorio() * PIEZAS_DEL_FUZZ.length)];
    textos.push(texto);
  }
  return textos;
}

/** Forma comparable de un resultado de lectura: pares ordenados por clave. */
export const comparable = (valores) =>
  JSON.stringify(Object.entries(valores).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Compara `leer(texto)` con `dotenv.parse(texto)` para cada texto. Devuelve `{ diferentes, ejemplos }`: cuantos difieren (o lanzan)
 * y los primeros `maximoEjemplos` como texto legible.
 */
export function compararConDotenv(textos, leer, maximoEjemplos = 5) {
  let diferentes = 0;
  const ejemplos = [];
  for (const texto of textos) {
    let propio;
    try {
      propio = comparable(leer(texto));
    } catch (error) {
      propio = `lanzo: ${error instanceof Error ? error.message : String(error)}`;
    }
    const esperado = comparable(dotenv.parse(texto));
    if (propio !== esperado) {
      diferentes += 1;
      if (ejemplos.length < maximoEjemplos) {
        ejemplos.push(`${JSON.stringify(texto)} -> ${propio} (dotenv: ${esperado})`);
      }
    }
  }
  return { diferentes, ejemplos };
}
