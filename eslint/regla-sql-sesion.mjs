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
// Ataque ronda 4: tampoco se llama a funciones que ejecutan SQL dado como texto (`query_to_xml`, `ts_stat`, `dblink…`, `crosstab…`,
// `cron.…`) ni a funciones calificadas con un esquema que no sea `pg_catalog` ni `public` (criterio 109); la cláusula `SET` de un
// `UPDATE`, de `ON CONFLICT DO UPDATE` o de `MERGE … UPDATE` no es `SET` de sesión (115); en `cli/` se admiten además los cuatro
// parámetros de formato de la sesión con sus valores exactos (107); y se analiza toda plantilla con una etiqueta `sql`, de donde
// venga, `.sql`, `.$queryRaw`, `.$executeRaw` o un alias de la `sql` del punto autorizado (112).
// Se exporta por separado para poder probarla con ESLint.

import { ARCHIVOS_DE_CODIGO, EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS } from './archivos-de-codigo.mjs';
import { analizarImportaciones, nombreDePropiedad, variableDe } from './ayuda-ambito.mjs';
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
  // Antes de unir las concatenaciones se guarda una copia: `set_config` con un ajuste fijo exige el literal sin concatenar (107).
  const sinUnir = normalizado.replace(/\s+/g, ' ').trim();
  // Une `'a' || 'b'` y las cadenas separadas solo por espacio ('a' 'b'), hasta que no quede ninguna. Dos cadenas pegadas
  // (`'it''s'`) son una sola con una comilla escapada: no se unen.
  const union = /'((?:[^']|'')*)'(?: ?\|\| ?| )'((?:[^']|'')*)'/;
  for (let vuelta = 0; vuelta < 1000 && union.test(normalizado); vuelta += 1) {
    normalizado = normalizado.replace(union, (_todo, a, b) => `'${a}${b}'`);
  }
  return { texto: normalizado.replace(/\s+/g, ' ').trim(), sinUnir, uescapeInvalido: estado.uescapeInvalido };
}

// ---------------------------------------------------------------------------------------------------------------------
// Análisis del texto normalizado (criterios 73, 83 y 84)
// ---------------------------------------------------------------------------------------------------------------------

/** Formas que prohíben el contexto de sesión en cualquier parte del texto normalizado. */
const PATRONES_EN_CUALQUIER_PARTE = [
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

/**
 * Formas de `SET` de sesión que se buscan en cualquier parte de una sentencia (criterios 73 y 84). Pero si en la misma sentencia las
 * precede la palabra `update` (fuera de una cadena), son la cláusula `SET` de un `UPDATE`, de `ON CONFLICT DO UPDATE` o de
 * `MERGE … UPDATE`, que asigna columnas (criterio 115).
 */
const PATRONES_DE_SET_EN_CUALQUIER_PARTE = [
  /\bset\s+(?:local\s+|session\s+)?app\./g,
  /\bset\s+(?:local\s+|session\s+)?role\b/g,
  /\bset\s+(?:local\s+|session\s+)?session\s+authorization\b/g,
  /\bset\s+session\b/g,
];

// Funciones que ejecutan o leen SQL o tablas a partir de un texto o un nombre (criterio 109). Se aplican al texto normalizado sin el
// contenido de las cadenas: una llamada no puede estar dentro de una cadena, y así una cadena como 'a.b(' no da un falso positivo.
const IDENTIFICADOR_SQL = String.raw`[\p{L}_][\p{L}\p{N}_$]*`;
const PATRON_FUNCION_DE_TEXTO = new RegExp(
  String.raw`(?<![\p{L}\p{N}_$.])(?:${IDENTIFICADOR_SQL}\.)*(?:query_to_xml(?:schema|_and_xmlschema)?|cursor_to_xml(?:schema)?|(?:table|schema|database)_to_xml(?:schema|_and_xmlschema)?|ts_stat|ts_rewrite|dblink[\p{L}\p{N}_$]*|crosstab[\p{L}\p{N}_$]*|connectby|pg_background[\p{L}\p{N}_$]*)\s*\(`,
  'u',
);
// Toda llamada calificada con un esquema que no sea `pg_catalog` ni `public`: AquaGestión solo usa el esquema `public`, y una
// extensión nueva no abre otro camino sin que se revise. No distingue una llamada de `INSERT INTO otro.tabla (…)`.
const PATRON_ESQUEMA_AJENO = new RegExp(
  String.raw`(?<![\p{L}\p{N}_$.])(?!(?:pg_catalog|public)\.)${IDENTIFICADOR_SQL}(?:\.${IDENTIFICADOR_SQL})+\s*\(`,
  'u',
);

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

/** El texto con el contenido de cada cadena `'…'` reemplazado por espacios (mismo largo, mismas posiciones). */
function sinCadenas(normalizado) {
  let resultado = '';
  let enCadena = false;
  for (let i = 0; i < normalizado.length; i += 1) {
    const c = normalizado[i];
    if (c === "'") {
      if (enCadena && normalizado[i + 1] === "'") {
        resultado += '  ';
        i += 1;
        continue;
      }
      enCadena = !enCadena;
      resultado += c;
    } else {
      resultado += enCadena ? ' ' : c;
    }
  }
  return resultado;
}

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

/** Los parámetros que `BaseDatos` y `enPlataforma` fijan en cada transacción, con sus valores exactos (criterios 98, 107, 121 y 122). */
const AJUSTES_FIJOS_PERMITIDOS = new Map([
  ["'timezone'", "'utc'"],
  ["'datestyle'", "'iso, mdy'"],
  ["'intervalstyle'", "'postgres'"],
  ["'extra_float_digits'", "'1'"],
  ["'bytea_output'", "'hex'"],
  // Criterios 121 y 122 (ataque ronda 5): el `search_path` fijo y las cadenas estándar.
  ["'search_path'", "'pg_catalog, public, pg_temp'"],
  ["'standard_conforming_strings'", "'on'"],
]);

/**
 * ¿Es una llamada permitida a `set_config`? Tercer argumento exactamente `true` y, o bien un primer argumento literal `'app.…'`
 * (puede estar armado con una concatenación de literales: `argumentos` es el texto con las concatenaciones unidas), o bien,
 * exactamente, uno de los pares de `AJUSTES_FIJOS_PERMITIDOS` escritos como literales simples, sin concatenación
 * (`argumentosSinUnir`). El texto ya está en minúsculas, así que no distingue mayúsculas: lo usa `enPlataforma` en `cli/`. Fuera de
 * `cli/` y de `infraestructura/prisma/` la regla `set-config-app` prohíbe además toda llamada.
 */
function esLlamadaPermitida(argumentos, argumentosSinUnir) {
  if (argumentos.length !== 3 || argumentos[2] !== 'true') return false;
  if (/^'app\.[^']*'$/.test(argumentos[0])) return true;
  return (
    argumentosSinUnir.length === 3 &&
    argumentosSinUnir[2] === 'true' &&
    AJUSTES_FIJOS_PERMITIDOS.get(argumentosSinUnir[0]) === argumentosSinUnir[1]
  );
}

function violaSentencia(sentencia) {
  if (/^reset\b/.test(sentencia)) return PATRON_RESET.test(sentencia);
  if (PATRONES_DE_SENTENCIA.some((patron) => patron.test(sentencia))) return true;
  // Las formas de `SET` de sesión en cualquier parte de la sentencia cuentan salvo que las precida `update` fuera de una cadena
  // (la cláusula `SET` de un UPDATE, ON CONFLICT DO UPDATE o MERGE … UPDATE; criterio 115).
  const sinTexto = sinCadenas(sentencia);
  return PATRONES_DE_SET_EN_CUALQUIER_PARTE.some((patron) =>
    [...sentencia.matchAll(patron)].some((coincidencia) => !/\bupdate\b/.test(sinTexto.slice(0, coincidencia.index))),
  );
}

/**
 * Analiza un texto SQL. Devuelve `{ sesion, setConfig }`: `sesion` si incumple las reglas de los criterios 73, 83, 84, 93, 94,
 * 107, 109 y 115 (válidas fuera de `infraestructura/prisma/`); `setConfig` si llama a `set_config` de cualquier forma (se prohíbe
 * además fuera de `cli/`).
 */
export function analizarSql(texto) {
  const { texto: normalizado, sinUnir, uescapeInvalido } = normalizarConEstado(texto);
  const llamadas = llamadasASetConfig(normalizado);
  const llamadasSinUnir = llamadasASetConfig(sinUnir);
  const sinTexto = sinCadenas(normalizado);
  const sesion =
    uescapeInvalido ||
    PATRONES_EN_CUALQUIER_PARTE.some((patron) => patron.test(normalizado)) ||
    PATRON_FUNCION_DE_TEXTO.test(sinTexto) ||
    PATRON_ESQUEMA_AJENO.test(sinTexto) ||
    llamadas.length !== llamadasSinUnir.length ||
    llamadas.some((argumentos, i) => !esLlamadaPermitida(argumentos, llamadasSinUnir[i] ?? [])) ||
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

/**
 * ¿La etiqueta de una plantilla es una de las que llegan a la base (criterios 92 y 112)? `<expr>.$queryRaw`, `<expr>.$executeRaw`,
 * cualquier propiedad `.sql` (`Prisma.sql`, `bd.sql`…), el identificador `sql` (venga de donde venga) o un alias de la `sql` del
 * punto autorizado (`import { sql as s }`). Analizar de más no abre caminos.
 */
function esEtiquetaDeSql(context, importaciones, etiqueta) {
  if (etiqueta.type === 'Identifier') {
    return etiqueta.name === 'sql' || importaciones().sqlImportada.has(variableDe(context, etiqueta));
  }
  if (etiqueta.type !== 'MemberExpression') return false;
  const nombre = nombreDePropiedad(etiqueta);
  return nombre === '$queryRaw' || nombre === '$executeRaw' || nombre === 'sql';
}

function crearRegla({ prohibido, mensaje }) {
  return {
    meta: { type: 'problem', schema: [], messages: { prohibido: '{{ mensaje }}' } },
    create(context) {
      let importacionesCache;
      const importaciones = () => (importacionesCache ??= analizarImportaciones(context));
      // Solo el texto de las plantillas etiquetadas que llegan a la base (criterio 92): no las cadenas, ni las plantillas sin
      // etiqueta, ni las expresiones regulares.
      return {
        TaggedTemplateExpression(nodo) {
          if (!esEtiquetaDeSql(context, importaciones, nodo.tag)) return;
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

/** Archivos a los que se aplica la regla: todas las extensiones que `tsx` ejecuta, también `.jsx` (criterios 95 y 119). */
export const archivosConReglaSqlSesion = ARCHIVOS_DE_CODIGO;

/** Exentos: `BaseDatos`, el cliente generado y las pruebas (solo `.test.<ts|mts|cts|js|mjs|cjs>`; criterios 110 y 118). */
export const archivosExentosSqlSesion = [
  'backend/src/infraestructura/prisma/**',
  EXENCION_CLIENTE_GENERADO,
  EXENCION_PRUEBAS,
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
