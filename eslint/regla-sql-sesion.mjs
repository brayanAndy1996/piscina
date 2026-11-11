// Reglas del SQL (spec 001, criterios 73, 83, 84 y 92 a 94, ataque rondas 1 a 3): el SQL solo llega a la base en plantillas
// etiquetadas (`$queryRaw`, `$executeRaw`, `Prisma.sql` o `sql`) y solo ese texto se analiza. En `backend/src/`, fuera de
// `infraestructura/prisma/` y de las pruebas, el texto de esas plantillas, ya normalizado con `normalizarSql`, no puede:
//   - hacer `SET`, `SET LOCAL` o `SET SESSION` de `app.…`, `ROLE` o `SESSION AUTHORIZATION`, ni `RESET` de una variable;
//   - llamar a `set_config` con un tercer argumento que no sea exactamente `true` o con un primer argumento que no sea
//     un literal simple `'app.…'` (en `cli/` se admite además exactamente `set_config('TimeZone', 'UTC', true)`);
//   - contener `ALTER ROLE|USER|DATABASE|SYSTEM|DEFAULT PRIVILEGES`, `CREATE [GLOBAL|LOCAL] TEMP[ORARY]`,
//     `INTO TEMP[ORARY]`, `UPDATE pg_settings`, `pg_notify(`, `WITH HOLD`, ni llamar a funciones de objetos grandes
//     (`lo_…`, `loread`, `lowrite`), a bloqueos consultivos de sesión ni a `pg_terminate_backend`/`pg_cancel_backend`;
//   - tener como sentencia (al inicio del texto o después de `;`) `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`,
//     `RELEASE`, `BEGIN`, `START TRANSACTION`, cualquier `SET`, un `RESET` (P-14), `DISCARD`, `LISTEN`, `UNLISTEN`,
//     `NOTIFY`, `DECLARE`, `CLOSE`, `FETCH`, `MOVE`, `PREPARE`, `EXECUTE`, `DEALLOCATE` o `DO`;
//   - además, fuera de `cli/`, llamar a `set_config` de cualquier forma.
// La regla de formas (criterio 92) obliga a que el SQL llegue a la base solo en esas plantillas: no se nombran
// `$queryRawUnsafe` ni `$executeRawUnsafe`, `$queryRaw` y `$executeRaw` solo se usan como etiqueta (o con `Prisma.sql`/`sql`
// etiquetados), y no se usan `Prisma.raw`, `Prisma.Sql` como valor ni `Prisma.join` con separador. Las cadenas, las plantillas
// sin etiqueta y las expresiones regulares no se analizan: no llegan a la base. Un comentario `eslint-disable` apaga estas
// reglas en el lint normal, pero no en el paso protegido (`eslint.protegido.config.mjs` con `--no-inline-config`, criterio 96).
// Se exporta por separado para poder probarla con ESLint.

import { reglaFormasDeSql } from './regla-sql-formas.mjs';

export const MENSAJE_SQL_SESION =
  'Solo BaseDatos (infraestructura/prisma) cambia el contexto de sesión y la transacción de PostgreSQL: no uses ' +
  'set_config con otra cosa que un literal app.… y true, ni SET, RESET, ALTER ROLE, COMMIT, tablas temporales ni ' +
  'notificaciones en los módulos; usa conAcademia o comoPlataforma.';

export const MENSAJE_SET_CONFIG_APP =
  "Solo BaseDatos (infraestructura/prisma) fija el contexto de la API con set_config('app.…'): usa conAcademia o " +
  'comoPlataforma.';

// ---------------------------------------------------------------------------------------------------------------------
// Normalización (criterio 83)
// ---------------------------------------------------------------------------------------------------------------------

const PATRON_IDENTIFICADOR = /[\p{L}\p{N}_$]/u;
const PATRON_ETIQUETA_DOLAR = /^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u;

/** Decodifica los escapes de una cadena `E'…'`. */
function decodificarEscapesE(texto) {
  return texto.replace(
    /\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([\s\S]))/g,
    (_todo, octal, hexa, u4, u8, otro) => {
      try {
        if (octal !== undefined) return String.fromCodePoint(Number.parseInt(octal, 8));
        if (hexa !== undefined) return String.fromCodePoint(Number.parseInt(hexa, 16));
        if (u4 !== undefined) return String.fromCodePoint(Number.parseInt(u4, 16));
        if (u8 !== undefined) return String.fromCodePoint(Number.parseInt(u8, 16));
      } catch {
        return '';
      }
      switch (otro) {
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        default:
          return otro;
      }
    },
  );
}

/** Escapa un carácter para usarlo dentro de una expresión regular. */
const escaparRegex = (caracter) => caracter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Decodifica los escapes de `U&'…'` y `U&"…"`: `<e>XXXX`, `<e>+XXXXXX` y `<e><e>` (el propio carácter), donde `<e>` es el
 * carácter de escape: `\` o, con `UESCAPE 'x'`, el carácter `x` (criterio 93).
 */
function decodificarEscapesU(texto, escape = '\\') {
  const e = escaparRegex(escape);
  const patron = new RegExp(`${e}(?:${e}|([0-9a-fA-F]{4})|\\+([0-9a-fA-F]{6}))`, 'g');
  return texto.replace(patron, (todo, u4, u6) => {
    const codigo = u4 ?? u6;
    if (codigo === undefined) return escape;
    try {
      return String.fromCodePoint(Number.parseInt(codigo, 16));
    } catch {
      return todo;
    }
  });
}

/** Salta espacios, saltos de línea y comentarios SQL (de línea y de bloque, estos anidados) desde `i`; devuelve la posición siguiente. */
function saltarBlancos(texto, i) {
  let j = i;
  while (j < texto.length) {
    if (/\s/.test(texto[j])) {
      j += 1;
    } else if (texto[j] === '-' && texto[j + 1] === '-') {
      while (j < texto.length && texto[j] !== '\n' && texto[j] !== '\r') j += 1;
    } else if (texto[j] === '/' && texto[j + 1] === '*') {
      let profundidad = 1;
      j += 2;
      while (j < texto.length && profundidad > 0) {
        if (texto[j] === '/' && texto[j + 1] === '*') {
          profundidad += 1;
          j += 2;
        } else if (texto[j] === '*' && texto[j + 1] === '/') {
          profundidad -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
    } else {
      break;
    }
  }
  return j;
}

/**
 * Mira si después de una cadena `U&…` (desde `desde`) sigue la cláusula `UESCAPE 'x'`, con blancos y comentarios entre las
 * partes. Devuelve `null` si no hay cláusula; si la hay, `{ fin, escape }` con la posición siguiente a su literal y el carácter
 * de escape, o `escape: null` si el literal no es un solo carácter válido para PostgreSQL (vacío, de más de un carácter, un
 * dígito hexadecimal, `+`, `'`, `"` o un espacio).
 */
function leerUescape(texto, desde) {
  let j = saltarBlancos(texto, desde);
  const palabra = /^uescape(?![\p{L}\p{N}_$])/iu.exec(texto.slice(j, j + 12));
  if (!palabra) return null;
  j = saltarBlancos(texto, j + palabra[0].length);
  if (texto[j] !== "'") return { fin: j, escape: null };
  let contenido = '';
  j += 1;
  while (j < texto.length) {
    if (texto[j] === "'" && texto[j + 1] === "'") {
      contenido += "'";
      j += 2;
    } else if (texto[j] === "'") {
      j += 1;
      break;
    } else {
      contenido += texto[j];
      j += 1;
    }
  }
  const caracteres = [...contenido];
  const unico = caracteres.length === 1 ? caracteres[0] : null;
  const valido = unico !== null && !/[0-9a-fA-F+'"\s]/.test(unico);
  return { fin: j, escape: valido ? unico : null };
}

/**
 * Divide el texto en partes: `{ literal: false, valor }` para el SQL fuera de las cadenas (con los identificadores entre
 * comillas dobles ya sin comillas y los comentarios reemplazados por un espacio) y `{ literal: true, valor }` para cada
 * cadena (`'…'`, `E'…'`, `U&'…'`, `N'…'` y las de dólar), con su contenido ya decodificado.
 */
function partirSql(texto, estado = { uescapeInvalido: false }) {
  const partes = [];
  let actual = '';
  const cerrarOtro = () => {
    if (actual !== '') partes.push({ literal: false, valor: actual });
    actual = '';
  };
  /** Quita del final de `actual` un prefijo de cadena (`e`, `n`, `u&`) si está pegado a la comilla. */
  const quitarPrefijo = (prefijos) => {
    const coincidencia = new RegExp(`(?:^|[^\\p{L}\\p{N}_$])(${prefijos})$`, 'iu').exec(actual);
    if (!coincidencia) return null;
    actual = actual.slice(0, actual.length - coincidencia[1].length);
    return coincidencia[1].toLowerCase();
  };
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const siguiente = texto[i + 1];
    if (c === '-' && siguiente === '-') {
      while (i < texto.length && texto[i] !== '\n' && texto[i] !== '\r') i += 1;
      actual += ' ';
      continue;
    }
    if (c === '/' && siguiente === '*') {
      let profundidad = 1;
      i += 2;
      while (i < texto.length && profundidad > 0) {
        if (texto[i] === '/' && texto[i + 1] === '*') {
          profundidad += 1;
          i += 2;
        } else if (texto[i] === '*' && texto[i + 1] === '/') {
          profundidad -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      actual += ' ';
      continue;
    }
    if (c === "'") {
      const prefijo = quitarPrefijo('e|n|u&');
      const conEscapes = prefijo === 'e';
      let contenido = '';
      i += 1;
      while (i < texto.length) {
        if (conEscapes && texto[i] === '\\' && i + 1 < texto.length) {
          contenido += texto[i] + texto[i + 1];
          i += 2;
        } else if (texto[i] === "'" && texto[i + 1] === "'") {
          contenido += conEscapes ? "\\'" : "'";
          i += 2;
        } else if (texto[i] === "'") {
          i += 1;
          break;
        } else {
          contenido += texto[i];
          i += 1;
        }
      }
      if (prefijo === 'e') {
        contenido = decodificarEscapesE(contenido);
      } else if (prefijo === 'u&') {
        const uescape = leerUescape(texto, i);
        if (uescape) {
          i = uescape.fin;
          if (uescape.escape === null) estado.uescapeInvalido = true;
        }
        contenido = decodificarEscapesU(contenido, uescape?.escape ?? '\\');
      }
      cerrarOtro();
      partes.push({ literal: true, valor: contenido });
      continue;
    }
    if (c === '"') {
      const prefijo = quitarPrefijo('u&');
      let contenido = '';
      i += 1;
      while (i < texto.length) {
        if (texto[i] === '"' && texto[i + 1] === '"') {
          contenido += '"';
          i += 2;
        } else if (texto[i] === '"') {
          i += 1;
          break;
        } else {
          contenido += texto[i];
          i += 1;
        }
      }
      if (prefijo === 'u&') {
        const uescape = leerUescape(texto, i);
        if (uescape) {
          i = uescape.fin;
          if (uescape.escape === null) estado.uescapeInvalido = true;
        }
        actual += decodificarEscapesU(contenido, uescape?.escape ?? '\\');
      } else {
        actual += contenido;
      }
      continue;
    }
    if (c === '$' && !PATRON_IDENTIFICADOR.test(actual.at(-1) ?? ' ')) {
      const apertura = PATRON_ETIQUETA_DOLAR.exec(texto.slice(i));
      if (apertura) {
        const marca = apertura[0];
        const inicio = i + marca.length;
        const fin = texto.indexOf(marca, inicio);
        const contenido = fin === -1 ? texto.slice(inicio) : texto.slice(inicio, fin);
        i = fin === -1 ? texto.length : fin + marca.length;
        cerrarOtro();
        partes.push({ literal: true, valor: contenido });
        continue;
      }
    }
    actual += c;
    i += 1;
  }
  cerrarOtro();
  return partes;
}

/**
 * Normaliza un texto SQL (criterio 83): sin comentarios; las cadenas `E'…'`, `U&'…'`, `N'…'` y las de dólar quedan como
 * `'…'`; las concatenaciones de literales (`'ap' || 'p.plataforma'`) quedan unidas; sin comillas dobles en los
 * identificadores (también `U&"…"`); sin espacios ni saltos de línea alrededor de `.`; los espacios repetidos, en uno; y
 * todo en minúsculas. El contenido de las cadenas conserva sus comillas simples duplicadas (`''`).
 */
export function normalizarSql(texto) {
  return normalizarConEstado(texto).texto;
}

/** Como `normalizarSql`, y además informa si algún `UESCAPE` no era un solo carácter válido (criterio 93). */
function normalizarConEstado(texto) {
  const estado = { uescapeInvalido: false };
  const partes = partirSql(String(texto), estado);
  let normalizado = partes
    .map((parte) =>
      parte.literal
        ? `'${parte.valor.toLowerCase().replaceAll("'", "''")}'`
        : parte.valor
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/ ?\. ?/g, '.'),
    )
    .join('');
  // Une `'a' || 'b'` y las cadenas separadas solo por espacio ('a' 'b'), hasta que no quede ninguna. Dos cadenas pegadas
  // (`'it''s'`) son una sola con una comilla escapada: no se unen.
  const union = /'((?:[^']|'')*)'(?: ?\|\| ?| )'((?:[^']|'')*)'/;
  for (let vuelta = 0; vuelta < 1000 && union.test(normalizado); vuelta += 1) {
    normalizado = normalizado.replace(union, (_todo, a, b) => `'${a}${b}'`);
  }
  return { texto: normalizado.replace(/\s+/g, ' ').trim(), uescapeInvalido: estado.uescapeInvalido };
}

// ---------------------------------------------------------------------------------------------------------------------
// Análisis del texto normalizado (criterios 73, 83 y 84)
// ---------------------------------------------------------------------------------------------------------------------

/** Formas que prohíben el contexto de sesión en cualquier parte del texto normalizado. */
const PATRONES_EN_CUALQUIER_PARTE = [
  /\bset\s+(?:local\s+|session\s+)?app\./,
  /\bset\s+(?:local\s+|session\s+)?role\b/,
  /\bset\s+(?:local\s+|session\s+)?session\s+authorization\b/,
  /\bset\s+session\b/,
  /\balter\s+(?:role|user|database|system)\b/,
  /\balter\s+default\s+privileges\b/,
  /\bwith\s+hold\b/,
  // Objetos grandes, bloqueos consultivos de sesión y control de otras conexiones (criterio 94). Los bloqueos de transacción
  // (`pg_advisory_xact_lock`, `pg_try_advisory_xact_lock`) no encajan: llevan `xact_` entre `advisory_` y `lock`.
  /(?<![\p{L}\p{N}_$])(?:pg_catalog\.)?(?:lo_[\p{L}\p{N}_$]+|loread|lowrite|pg_(?:try_)?advisory_(?:lock|unlock)(?:_shared|_all)?|pg_terminate_backend|pg_cancel_backend)\s*\(/u,
  /\bcreate\s+(?:(?:global|local)\s+)?temp(?:orary)?\b/,
  /\binto\s+temp(?:orary)?\b/,
  /\bupdate\s+(?:pg_catalog\.)?pg_settings\b/,
  /\b(?:pg_catalog\.)?pg_notify\s*\(/,
];

/** Sentencias de transacción, de sesión y de notificación, al inicio de una sentencia. */
const PATRONES_DE_SENTENCIA = [
  /^(?:commit|end|rollback|abort|savepoint|release|begin)\b/,
  /^start\s+transaction\b/,
  /^set\b/,
  /^(?:discard|listen|unlisten|notify)\b/,
  /^(?:declare|close|fetch|move|prepare|execute|deallocate|do)\b/,
];

/** `RESET` solo cuenta si la sentencia es exactamente `RESET ALL|<parámetro>|SESSION AUTHORIZATION` (P-14). */
const PATRON_RESET =
  /^reset\s+(?:all|session\s+authorization|[\p{L}_][\p{L}\p{N}_$]*(?:\.[\p{L}\p{N}_$]+)*)(?:\s*\?)*$/u;

const PATRON_LLAMADA_SET_CONFIG = /(?:\bpg_catalog\.)?\bset_config\s*\(/g;

/** Parte el texto normalizado en sentencias por `;` fuera de las cadenas. */
function sentenciasDe(normalizado) {
  const sentencias = [];
  let actual = '';
  let enCadena = false;
  for (let i = 0; i < normalizado.length; i += 1) {
    const c = normalizado[i];
    if (c === "'") {
      if (enCadena && normalizado[i + 1] === "'") {
        actual += "''";
        i += 1;
        continue;
      }
      enCadena = !enCadena;
    }
    if (c === ';' && !enCadena) {
      sentencias.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  sentencias.push(actual.trim());
  return sentencias.filter((sentencia) => sentencia !== '');
}

/** Argumentos de la llamada cuyo paréntesis de apertura está justo antes de `desde`, separados por comas de primer nivel. */
function argumentosDeLlamada(normalizado, desde) {
  const argumentos = [];
  let actual = '';
  let profundidad = 1;
  let enCadena = false;
  for (let i = desde; i < normalizado.length; i += 1) {
    const c = normalizado[i];
    if (c === "'") {
      if (enCadena && normalizado[i + 1] === "'") {
        actual += "''";
        i += 1;
        continue;
      }
      enCadena = !enCadena;
    } else if (!enCadena && c === '(') {
      profundidad += 1;
    } else if (!enCadena && c === ')') {
      profundidad -= 1;
      if (profundidad === 0) {
        argumentos.push(actual.trim());
        return argumentos;
      }
    } else if (!enCadena && c === ',' && profundidad === 1) {
      argumentos.push(actual.trim());
      actual = '';
      continue;
    }
    actual += c;
  }
  // Llamada sin cerrar: se devuelve lo leído, que no cumplirá la forma permitida.
  argumentos.push(actual.trim());
  return argumentos;
}

/** Llamadas a `set_config` del texto normalizado, con sus argumentos. */
function llamadasASetConfig(normalizado) {
  return [...normalizado.matchAll(PATRON_LLAMADA_SET_CONFIG)].map((coincidencia) =>
    argumentosDeLlamada(normalizado, coincidencia.index + coincidencia[0].length),
  );
}

/**
 * ¿Es una llamada permitida a `set_config`? Primer argumento un literal `'app.…'` y tercero exactamente `true`; o, exactamente,
 * `set_config('timezone', 'utc', true)` (el texto ya está en minúsculas): lo usa `enPlataforma` en `cli/` (criterio 98). Fuera
 * de `cli/` y de `infraestructura/prisma/` la regla `set-config-app` prohíbe además toda llamada.
 */
function esLlamadaPermitida(argumentos) {
  if (argumentos.length !== 3 || argumentos[2] !== 'true') return false;
  return /^'app\.[^']*'$/.test(argumentos[0]) || (argumentos[0] === "'timezone'" && argumentos[1] === "'utc'");
}

function violaSentencia(sentencia) {
  if (/^reset\b/.test(sentencia)) return PATRON_RESET.test(sentencia);
  return PATRONES_DE_SENTENCIA.some((patron) => patron.test(sentencia));
}

/**
 * Analiza un texto SQL. Devuelve `{ sesion, setConfig }`: `sesion` si incumple las reglas de los criterios 73, 83, 84, 93 y 94
 * (válidas fuera de `infraestructura/prisma/`); `setConfig` si llama a `set_config` de cualquier forma (se prohíbe además
 * fuera de `cli/`).
 */
export function analizarSql(texto) {
  const { texto: normalizado, uescapeInvalido } = normalizarConEstado(texto);
  const llamadas = llamadasASetConfig(normalizado);
  const sesion =
    uescapeInvalido ||
    PATRONES_EN_CUALQUIER_PARTE.some((patron) => patron.test(normalizado)) ||
    llamadas.some((argumentos) => !esLlamadaPermitida(argumentos)) ||
    sentenciasDe(normalizado).some((sentencia) => violaSentencia(sentencia));
  return { sesion, setConfig: llamadas.length > 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reglas de ESLint
// ---------------------------------------------------------------------------------------------------------------------

/** Texto de una plantilla con un marcador `?` en lugar de cada `${…}`. */
function textoDePlantilla(nodo) {
  return nodo.quasis.map((q) => q.value.cooked ?? q.value.raw).join('?');
}

/** Nombre de la propiedad de un acceso `a.b` o `a['b']` (con un literal); `null` si no se puede saber. */
function nombreDePropiedad(acceso) {
  const propiedad = acceso.property;
  if (!acceso.computed) return propiedad.type === 'Identifier' ? propiedad.name : null;
  if (propiedad.type === 'Literal' && typeof propiedad.value === 'string') return propiedad.value;
  if (propiedad.type === 'TemplateLiteral' && propiedad.expressions.length === 0) {
    return propiedad.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/**
 * ¿La etiqueta de una plantilla es una de las que llegan a la base (criterio 92)? `<expr>.$queryRaw`, `<expr>.$executeRaw`,
 * `Prisma.sql` o el identificador `sql`.
 */
function esEtiquetaDeSql(etiqueta) {
  if (etiqueta.type === 'Identifier') return etiqueta.name === 'sql';
  if (etiqueta.type !== 'MemberExpression') return false;
  const nombre = nombreDePropiedad(etiqueta);
  if (nombre === '$queryRaw' || nombre === '$executeRaw') return true;
  return nombre === 'sql' && etiqueta.object.type === 'Identifier' && etiqueta.object.name === 'Prisma';
}

function crearRegla({ prohibido, mensaje }) {
  return {
    meta: { type: 'problem', schema: [], messages: { prohibido: '{{ mensaje }}' } },
    create(context) {
      // Solo el texto de las plantillas etiquetadas que llegan a la base (criterio 92): no las cadenas, ni las plantillas sin
      // etiqueta, ni las expresiones regulares.
      return {
        TaggedTemplateExpression(nodo) {
          if (!esEtiquetaDeSql(nodo.tag)) return;
          if (prohibido(analizarSql(textoDePlantilla(nodo.quasi)))) {
            context.report({ node: nodo.quasi, messageId: 'prohibido', data: { mensaje } });
          }
        },
      };
    },
  };
}

export const pluginSqlSesion = {
  meta: { name: 'aquagestion-sql-sesion' },
  rules: {
    'sesion-en-modulos': crearRegla({ prohibido: (analisis) => analisis.sesion, mensaje: MENSAJE_SQL_SESION }),
    'set-config-app': crearRegla({ prohibido: (analisis) => analisis.setConfig, mensaje: MENSAJE_SET_CONFIG_APP }),
    'formas-de-sql': reglaFormasDeSql,
  },
};

/** Archivos a los que se aplica la regla: todas las extensiones que `tsx` ejecuta (criterio 95). */
export const archivosConReglaSqlSesion = ['backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'];

/** Exentos: `BaseDatos` y las pruebas. */
export const archivosExentosSqlSesion = [
  'backend/src/infraestructura/prisma/**',
  'backend/src/generated/**',
  '**/*.test.*',
];

/** Bloques de configuración plana listos para agregar a `eslint.config.mjs` y a la del paso protegido. */
export const configuracionSqlSesion = [
  {
    name: 'aquagestion/regla-sql-sesion',
    files: archivosConReglaSqlSesion,
    ignores: archivosExentosSqlSesion,
    plugins: { 'aquagestion-sql': pluginSqlSesion },
    rules: { 'aquagestion-sql/sesion-en-modulos': 'error', 'aquagestion-sql/formas-de-sql': 'error' },
  },
  {
    name: 'aquagestion/regla-sql-sesion-set-config-app',
    files: archivosConReglaSqlSesion,
    ignores: [...archivosExentosSqlSesion, 'backend/src/cli/**'],
    plugins: { 'aquagestion-sql': pluginSqlSesion },
    rules: { 'aquagestion-sql/set-config-app': 'error' },
  },
];
