// Regla del SQL de sesión (spec 001, criterio 73, ataque ronda 1): solo `BaseDatos` (infraestructura/prisma) cambia el
// contexto de sesión de PostgreSQL. En `backend/src/`, fuera de `infraestructura/prisma/` y de las pruebas, ningún
// texto SQL (cadena, plantilla o plantilla etiquetada) puede contener:
//   - `set_config(` con `false` como último argumento (valor de sesión que se queda en la conexión del pool);
//   - `SET app.`, `SET LOCAL app.`, `SET SESSION`, `SET ROLE` ni `RESET` (de `app.…`, `ROLE` o `ALL`);
//   - además, fuera de `cli/`, cualquier `set_config('app.` (la API fija su contexto solo en `BaseDatos`).
// La regla solo ve texto literal: el SQL armado por concatenación o pasado en variables no se detecta (la garantía
// real es el criterio 72: cada transacción fija los dos valores de contexto).
// Se exporta por separado, como las demás, para poder probarla con ESLint.

export const MENSAJE_SQL_SESION =
  'Solo BaseDatos (infraestructura/prisma) cambia el contexto de sesión de PostgreSQL: no uses set_config(..., false), ' +
  'SET app., SET SESSION, SET ROLE ni RESET en los módulos; usa conAcademia o comoPlataforma.';

export const MENSAJE_SET_CONFIG_APP =
  "Solo BaseDatos (infraestructura/prisma) fija el contexto de la API con set_config('app.…'): usa conAcademia o " +
  'comoPlataforma.';

/** Texto SQL que cambia el contexto de sesión (aplica fuera de infraestructura/prisma). */
const PATRONES_SESION = [
  // set_config(..., false): admite una llamada anidada dentro de los argumentos.
  /set_config\s*\((?:[^()]|\([^()]*\))*,\s*false\s*\)/i,
  /\bset\s+(?:local\s+|session\s+)?app\./i,
  /\bset\s+session\b/i,
  /\bset\s+role\b/i,
  /\breset\s+(?:app\.|role\b|all\b)/i,
];

/** Cualquier `set_config('app.` (fuera también de cli). */
const PATRON_SET_CONFIG_APP = /set_config\s*\(\s*'app\./i;

/** Texto de una plantilla con un marcador `?` en lugar de cada `${…}`. */
function textoDePlantilla(nodo) {
  return nodo.quasis.map((q) => q.value.cooked ?? q.value.raw).join('?');
}

// Quita los comentarios SQL (de línea con dos guiones y de bloque): el texto comentado no se ejecuta.
function sinComentariosSql(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ');
}

function crearRegla({ patrones, mensaje }) {
  return {
    meta: { type: 'problem', schema: [], messages: { prohibido: '{{ mensaje }}' } },
    create(context) {
      function revisar(nodo, textoCrudo) {
        const texto = sinComentariosSql(textoCrudo);
        if (patrones.some((patron) => patron.test(texto))) {
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
    'sesion-en-modulos': crearRegla({ patrones: PATRONES_SESION, mensaje: MENSAJE_SQL_SESION }),
    'set-config-app': crearRegla({ patrones: [PATRON_SET_CONFIG_APP], mensaje: MENSAJE_SET_CONFIG_APP }),
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
];
