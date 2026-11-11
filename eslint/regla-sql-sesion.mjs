// Regla del SQL de sesión (spec 001, criterios 73, 83 y 84, ataque rondas 1 y 2): solo `BaseDatos` (infraestructura/prisma)
// cambia el contexto de sesión y la transacción de PostgreSQL. En `backend/src/`, fuera de `infraestructura/prisma/` y de
// las pruebas, ningún texto SQL (cadena, plantilla o plantilla etiquetada) puede, ya normalizado con `normalizarSql`:
//   - hacer `SET`, `SET LOCAL` o `SET SESSION` de `app.…`, `ROLE` o `SESSION AUTHORIZATION`, ni `RESET` de una variable;
//   - llamar a `set_config` con un tercer argumento que no sea exactamente `true` o con un primer argumento que no sea
//     un literal simple `'app.…'`;
//   - contener `ALTER ROLE|USER|DATABASE|SYSTEM`, `CREATE [GLOBAL|LOCAL] TEMP[ORARY]`, `INTO TEMP[ORARY]`,
//     `UPDATE pg_settings` o `pg_notify(`;
//   - tener como sentencia (al inicio del texto o después de `;`) `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`,
//     `RELEASE`, `BEGIN`, `START TRANSACTION`, cualquier `SET`, un `RESET` (P-14), `DISCARD`, `LISTEN`, `UNLISTEN` o
//     `NOTIFY` (también dentro de un bloque `DO`);
//   - además, fuera de `cli/`, llamar a `set_config` de cualquier forma.
// La regla solo ve texto literal: el SQL armado por concatenación de variables no se detecta (la garantía real es el
// criterio 72: cada transacción fija los dos valores de contexto). Un comentario `eslint-disable` no apaga la regla:
// `noInlineConfig` en la configuración de estos archivos (P-15). Se exporta por separado para poder probarla con ESLint.

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

/** Decodifica los escapes de `U&'…'` y `U&"…"` (`\XXXX`, `\+XXXXXX` y `\\`). */
function decodificarEscapesU(texto) {
  return texto.replace(/\\(?:\\|([0-9a-fA-F]{4})|\+([0-9a-fA-F]{6}))/g, (todo, u4, u6) => {
    const codigo = u4 ?? u6;
    if (codigo === undefined) return '\\';
    try {
      return String.fromCodePoint(Number.parseInt(codigo, 16));
    } catch {
      return todo;
    }
  });
}

/**
 * Divide el texto en partes: `{ literal: false, valor }` para el SQL fuera de las cadenas (con los identificadores entre
 * comillas dobles ya sin comillas y los comentarios reemplazados por un espacio) y `{ literal: true, valor }` para cada
 * cadena (`'…'`, `E'…'`, `U&'…'`, `N'…'` y las de dólar), con su contenido ya decodificado.
 */
function partirSql(texto) {
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
      if (prefijo === 'e') contenido = decodificarEscapesE(contenido);
      else if (prefijo === 'u&') contenido = decodificarEscapesU(contenido);
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
      actual += prefijo === 'u&' ? decodificarEscapesU(contenido) : contenido;
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
  const partes = partirSql(String(texto));
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
  return normalizado.replace(/\s+/g, ' ').trim();
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

/** Contenido (con `''` ya sin duplicar) de cada cadena de un texto normalizado. */
function cadenasDe(normalizado) {
  return partirSql(normalizado)
    .filter((parte) => parte.literal)
    .map((parte) => parte.valor);
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

/** ¿Es una llamada permitida a `set_config`? Primer argumento un literal `'app.…'` y tercero exactamente `true`. */
function esLlamadaPermitida(argumentos) {
  return argumentos.length === 3 && /^'app\.[^']*'$/.test(argumentos[0]) && argumentos[2] === 'true';
}

function violaSentencia(sentencia, profundidad) {
  if (/^reset\b/.test(sentencia)) return PATRON_RESET.test(sentencia);
  if (PATRONES_DE_SENTENCIA.some((patron) => patron.test(sentencia))) return true;
  // Un bloque DO ejecuta las sentencias de su cuerpo: se revisan también.
  if (/^do\b/.test(sentencia) && profundidad < 4) {
    return cadenasDe(sentencia).some((cuerpo) => analizarSql(cuerpo, profundidad + 1).sesion);
  }
  return false;
}

/**
 * Analiza un texto SQL. Devuelve `{ sesion, setConfig }`: `sesion` si incumple las reglas de los criterios 73, 83 y 84
 * (válidas fuera de `infraestructura/prisma/`); `setConfig` si llama a `set_config` de cualquier forma (se prohíbe además
 * fuera de `cli/`).
 */
export function analizarSql(texto, profundidad = 0) {
  const normalizado = normalizarSql(texto);
  const llamadas = llamadasASetConfig(normalizado);
  const sesion =
    PATRONES_EN_CUALQUIER_PARTE.some((patron) => patron.test(normalizado)) ||
    llamadas.some((argumentos) => !esLlamadaPermitida(argumentos)) ||
    sentenciasDe(normalizado).some((sentencia) => violaSentencia(sentencia, profundidad));
  return { sesion, setConfig: llamadas.length > 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reglas de ESLint
// ---------------------------------------------------------------------------------------------------------------------

/** Texto de una plantilla con un marcador `?` en lugar de cada `${…}`. */
function textoDePlantilla(nodo) {
  return nodo.quasis.map((q) => q.value.cooked ?? q.value.raw).join('?');
}

function crearRegla({ prohibido, mensaje }) {
  return {
    meta: { type: 'problem', schema: [], messages: { prohibido: '{{ mensaje }}' } },
    create(context) {
      function revisar(nodo, texto) {
        if (prohibido(analizarSql(texto))) {
          context.report({ node: nodo, messageId: 'prohibido', data: { mensaje } });
        }
      }
      return {
        Literal(nodo) {
          if (typeof nodo.value === 'string') revisar(nodo, nodo.value);
        },
        TemplateLiteral(nodo) {
          revisar(nodo, textoDePlantilla(nodo));
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
  },
};

/** Archivos a los que se aplica la regla. */
export const archivosConReglaSqlSesion = ['backend/src/**/*.ts'];

/** Exentos: `BaseDatos` y las pruebas. */
export const archivosExentosSqlSesion = [
  'backend/src/infraestructura/prisma/**',
  'backend/src/generated/**',
  '**/*.test.ts',
];

/** Bloques de configuración plana listos para agregar a `eslint.config.mjs`. */
export const configuracionSqlSesion = [
  {
    name: 'aquagestion/regla-sql-sesion',
    files: archivosConReglaSqlSesion,
    ignores: archivosExentosSqlSesion,
    plugins: { 'aquagestion-sql': pluginSqlSesion },
    rules: { 'aquagestion-sql/sesion-en-modulos': 'error' },
  },
  {
    name: 'aquagestion/regla-sql-sesion-set-config-app',
    files: archivosConReglaSqlSesion,
    ignores: [...archivosExentosSqlSesion, 'backend/src/cli/**'],
    plugins: { 'aquagestion-sql': pluginSqlSesion },
    rules: { 'aquagestion-sql/set-config-app': 'error' },
  },
  // P-15: ningún comentario `eslint-disable` (ni `/* eslint … */`) puede apagar estas reglas ni las de acceso a la base.
  {
    name: 'aquagestion/sin-configuracion-en-linea',
    files: archivosConReglaSqlSesion,
    ignores: archivosExentosSqlSesion,
    linterOptions: { noInlineConfig: true },
  },
];
