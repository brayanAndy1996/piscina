// Evaluación del rol de la API (aquagestion_app) a partir de su fila en pg_roles (spec 001, criterio 81, P-13).
// Función pura y sin dependencias: solo módulos de Node, porque el hook de sesión de la nube la importa antes de `npm ci`.

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
