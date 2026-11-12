// Evaluación del rol de la API (aquagestion_app) a partir de su fila en pg_roles (spec 001, criterio 81, P-13).
// Función pura y sin dependencias: solo módulos de Node, porque el hook de sesión de la nube la importa antes de `npm ci`.
// Ronda 3 del ataque: valores por defecto del rol (criterio 103), privilegios de más (criterio 102) y verificador SCRAM-SHA-256
// de las contraseñas (criterio 104).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** Nombre del rol de la API cuando la fila no lo trae. */
const ROL_POR_DEFECTO = 'aquagestion_app';

/** Atributos que el rol de la API nunca puede tener: campo de `pg_roles`, palabra de `ALTER ROLE` y cómo se explica. */
export const ATRIBUTOS_PROHIBIDOS = Object.freeze([
  { campo: 'rolsuper', atributo: 'SUPERUSER', explicacion: 'es superusuario' },
  { campo: 'rolbypassrls', atributo: 'BYPASSRLS', explicacion: 'tiene BYPASSRLS' },
  { campo: 'rolreplication', atributo: 'REPLICATION', explicacion: 'tiene REPLICATION' },
  { campo: 'rolcreaterole', atributo: 'CREATEROLE', explicacion: 'tiene CREATEROLE' },
  { campo: 'rolcreatedb', atributo: 'CREATEDB', explicacion: 'tiene CREATEDB' },
]);

/**
 * Problemas del rol, uno por condición, cada uno con su corrección. Lista vacía: rol seguro.
 * `fila`: `{ rolname, rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb, es_miembro, roles? }`, donde
 * `roles` (opcional) son los nombres de los roles de los que es miembro. No lleva ni imprime contraseñas.
 * Cualquier valor distinto de `false` en una condición cuenta como activo (falla cerrada).
 */
export function problemasDelRolApp(fila) {
  const rol = typeof fila?.rolname === 'string' && fila.rolname !== '' ? fila.rolname : ROL_POR_DEFECTO;
  const problemas = [];
  for (const { campo, atributo, explicacion } of ATRIBUTOS_PROHIBIDOS) {
    if (fila?.[campo] !== false) {
      problemas.push(`El rol ${rol} ${explicacion}. Corrígelo con un superusuario: ALTER ROLE ${rol} NO${atributo};`);
    }
  }
  if (fila?.es_miembro !== false) {
    const roles = Array.isArray(fila?.roles) && fila.roles.length > 0 ? fila.roles : ['<rol>'];
    const revocaciones = roles.map((otro) => `REVOKE ${otro} FROM ${rol};`).join(' ');
    problemas.push(`El rol ${rol} es miembro de otro rol. Corrígelo con un superusuario: ${revocaciones}`);
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Valores por defecto propios del rol (criterio 103, P-19)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Problemas por los valores por defecto propios del rol (`ALTER ROLE aquagestion_app SET …`): `rolconfig` es la columna de
 * `pg_roles` (`string[]` o `null`) y `bases` son los nombres de las bases con filas de `pg_db_role_setting` para el rol. Lista
 * vacía si no hay ninguno; si no, un problema con `ALTER ROLE <rol> RESET ALL;` y uno por base con
 * `ALTER ROLE <rol> IN DATABASE <base> RESET ALL;`. Los valores por defecto de la base para todos los roles no cuentan (los
 * neutraliza cada transacción).
 */
export function problemasDeConfiguracionApp({ rolconfig, bases, rolname } = {}) {
  const rol = typeof rolname === 'string' && rolname !== '' ? rolname : ROL_POR_DEFECTO;
  const problemas = [];
  if (Array.isArray(rolconfig) && rolconfig.length > 0) {
    problemas.push(
      `El rol ${rol} tiene valores por defecto propios (ALTER ROLE ... SET). Corrígelo con un superusuario: ` +
        `ALTER ROLE ${rol} RESET ALL;`,
    );
  }
  for (const base of Array.isArray(bases) ? bases : []) {
    problemas.push(
      `El rol ${rol} tiene valores por defecto propios en la base ${base} (ALTER ROLE ... IN DATABASE ... SET). ` +
        `Corrígelo con un superusuario: ALTER ROLE ${rol} IN DATABASE ${base} RESET ALL;`,
    );
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Esquemas del rol (criterio 123, P-29)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Problemas por los esquemas de una base (criterio 123): uno por cada esquema y condición. `esquemasPropios` son los esquemas de
 * los que el rol es dueño; `esquemasConCreate`, los esquemas en los que puede crear (`dePublic` es verdadero si el privilegio
 * llega por `PUBLIC`); `esquemaConSuNombre` es verdadero si existe un esquema llamado como el rol (el `search_path` por defecto,
 * `"$user", public`, lo buscaría antes que `public`). Lista vacía: nada. Cada problema nombra el esquema y la corrección. No
 * modifica nada ni lleva contraseñas.
 */
export function problemasDeEsquemasApp({ esquemasPropios, esquemasConCreate, esquemaConSuNombre, rolname } = {}) {
  const rol = typeof rolname === 'string' && rolname !== '' ? rolname : ROL_POR_DEFECTO;
  const problemas = [];
  for (const esquema of Array.isArray(esquemasPropios) ? esquemasPropios : []) {
    problemas.push(
      `El rol ${rol} es dueño (propietario) del esquema ${esquema}. Corrígelo con un superusuario: ` +
        `ALTER SCHEMA ${esquema} OWNER TO <el usuario de DATABASE_URL>;`,
    );
  }
  for (const { esquema, dePublic } of Array.isArray(esquemasConCreate) ? esquemasConCreate : []) {
    const destino = dePublic ? 'PUBLIC' : rol;
    problemas.push(
      `El rol ${rol} tiene CREATE sobre el esquema ${esquema}${dePublic ? ' (concedido a PUBLIC)' : ''}. ` +
        `Corrígelo con el dueño o un superusuario: REVOKE CREATE ON SCHEMA ${esquema} FROM ${destino};`,
    );
  }
  if (esquemaConSuNombre === true) {
    problemas.push(
      `Existe un esquema con el nombre del rol (${rol}): el search_path por defecto lo buscaría antes que public. ` +
        `Corrígelo con un superusuario: renombra o elimina el esquema (ALTER SCHEMA ${rol} RENAME TO <otro>; o DROP SCHEMA ${rol};).`,
    );
  }
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Privilegios permitidos (criterio 102, P-20)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Privilegios que el rol de la API puede tener sobre el esquema `public` (criterio 2). `columna: null` es la tabla entera. Es la
 * misma lista que `backend/src/infraestructura/prisma/privilegios-app.ts` (los scripts no pueden importar el backend): una
 * prueba compara las dos. Toda historia que agregue una tabla amplía las dos listas.
 */
export const PRIVILEGIOS_APP = Object.freeze(
  [
    { tabla: 'academias', columna: null, privilegio: 'SELECT' },
    { tabla: 'academias', columna: null, privilegio: 'INSERT' },
    { tabla: 'academias', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'academias', columna: 'motivo_suspension', privilegio: 'UPDATE' },
    { tabla: 'academias', columna: 'suspendida_en', privilegio: 'UPDATE' },
    { tabla: 'academias', columna: 'actualizada_en', privilegio: 'UPDATE' },
    { tabla: 'superadmins', columna: null, privilegio: 'SELECT' },
    { tabla: 'superadmins', columna: 'intentos_fallidos', privilegio: 'UPDATE' },
    { tabla: 'superadmins', columna: 'bloqueado_hasta', privilegio: 'UPDATE' },
    { tabla: 'superadmins', columna: 'ultimo_acceso', privilegio: 'UPDATE' },
    { tabla: 'superadmins', columna: 'version_token', privilegio: 'UPDATE' },
    { tabla: 'superadmins', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'auditoria', columna: null, privilegio: 'SELECT' },
    { tabla: 'auditoria', columna: null, privilegio: 'INSERT' },
    { tabla: 'auditoria_plataforma', columna: null, privilegio: 'SELECT' },
    { tabla: 'auditoria_plataforma', columna: null, privilegio: 'INSERT' },
    { tabla: 'configuraciones', columna: null, privilegio: 'SELECT' },
    { tabla: 'configuraciones', columna: null, privilegio: 'INSERT' },
    { tabla: 'configuraciones', columna: null, privilegio: 'UPDATE' },
  ].map((privilegio) => Object.freeze(privilegio)),
);

/** ¿Está permitido el privilegio efectivo? `(t, null, p)` si está `(t, null, p)`; `(t, c, p)` si está `(t, null, p)` o `(t, c, p)`. */
function estaPermitido({ tabla, columna, privilegio }) {
  return PRIVILEGIOS_APP.some(
    (permitido) =>
      permitido.tabla === tabla &&
      permitido.privilegio === privilegio &&
      (permitido.columna === null || (columna !== null && permitido.columna === columna)),
  );
}

/** Texto de un privilegio para los mensajes: `UPDATE (nombre_corto) en academias` o `TRUNCATE en auditoria`. */
function describirPrivilegio({ tabla, columna, privilegio }) {
  return columna === null ? `${privilegio} en ${tabla}` : `${privilegio} (${columna}) en ${tabla}`;
}

/**
 * Los privilegios efectivos del rol (`[{ tabla, columna, privilegio }]`) que no están en `PRIVILEGIOS_APP`, un texto por cada
 * uno con la tabla, el privilegio y, si es de columna, la columna. Lista vacía: nada de más. Un privilegio que falta no se
 * informa.
 */
export function privilegiosDeMas(efectivos) {
  return efectivos.filter((efectivo) => !estaPermitido(efectivo)).map(describirPrivilegio);
}

/** Los privilegios efectivos que no están permitidos (los mismos objetos que recibió `privilegiosDeMas`). */
export function privilegiosNoPermitidos(efectivos) {
  return efectivos.filter((efectivo) => !estaPermitido(efectivo));
}

/**
 * Corrección de un privilegio de más: `REVOKE TRUNCATE ON auditoria FROM aquagestion_app;` o, si lo concede `PUBLIC`,
 * `… FROM PUBLIC;`. Los privilegios de columna: `REVOKE UPDATE (nombre_corto) ON academias FROM …;`. Las secuencias usan
 * `ON SEQUENCE`.
 */
export function correccionDePrivilegio(
  { tabla, columna, privilegio },
  { rol = ROL_POR_DEFECTO, viaPublic = false, secuencia = false } = {},
) {
  const objeto = secuencia ? `SEQUENCE ${tabla}` : tabla;
  const destino = viaPublic ? 'PUBLIC' : rol;
  return columna === null
    ? `REVOKE ${privilegio} ON ${objeto} FROM ${destino};`
    : `REVOKE ${privilegio} (${columna}) ON ${objeto} FROM ${destino};`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Verificador SCRAM-SHA-256 (criterio 104, P-22)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Verificador SCRAM-SHA-256 de PostgreSQL para una contraseña, calculado aquí (RFC 5802 y RFC 7677) para que la contraseña
 * nunca viaje en claro en un `CREATE ROLE … PASSWORD`: `SCRAM-SHA-256$<iteraciones>:<sal>$<StoredKey>:<ServerKey>`, con los
 * tres valores en base64. PostgreSQL reconoce un valor con ese formato como verificador y lo guarda tal cual, sin importar
 * `password_encryption`.
 *
 * PostgreSQL normaliza la contraseña con SASLprep; para ASCII imprimible (U+0020 a U+007E) no cambia nada, así que cualquier
 * otro carácter lanza un error (que no incluye la contraseña): el verificador podría no coincidir con el que PostgreSQL calcularía.
 */
export function verificadorScram(clave, { sal = randomBytes(16), iteraciones = 4096 } = {}) {
  if (typeof clave !== 'string' || !/^[ -~]*$/.test(clave)) {
    throw new Error(
      'La contraseña tiene caracteres fuera de ASCII imprimible (U+0020 a U+007E) y no se puede guardar como verificador ' +
        'SCRAM-SHA-256. Usa solo letras sin tilde, dígitos, espacios y signos ASCII.',
    );
  }
  const salted = pbkdf2Sync(clave, sal, iteraciones, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iteraciones}:${sal.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
