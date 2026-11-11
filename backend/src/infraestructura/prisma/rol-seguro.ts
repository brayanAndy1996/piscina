/**
 * Fila que devuelve la consulta del catálogo sobre el rol de `DATABASE_URL_APP` (spec 001, criterio 80, P-12). Una
 * condición por campo: todas en `false` es un rol seguro.
 */
export interface FilaRol {
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
  readonly rolreplication: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  /** Miembro explícito de otro rol (`pg_auth_members`). */
  readonly es_miembro: boolean;
  /** Miembro implícito de `pg_database_owner`, por ser dueño de la base. */
  readonly dueno_de_la_base: boolean;
  /** `CREATE` sobre la base actual, directo o heredado de `PUBLIC`. */
  readonly crea_en_base: boolean;
  /** `TEMPORARY` sobre la base actual, directo o heredado de `PUBLIC`. */
  readonly temporales: boolean;
  /** `CREATE` sobre el esquema `public`. */
  readonly crea_en_public: boolean;
  /** Dueño de un objeto del esquema `public` o del propio esquema. */
  readonly es_dueno: boolean;
}

const CONDICIONES: readonly (readonly [keyof FilaRol, string])[] = [
  ['rolsuper', 'es superusuario'],
  ['rolbypassrls', 'tiene BYPASSRLS'],
  ['rolreplication', 'tiene REPLICATION'],
  ['rolcreaterole', 'tiene CREATEROLE'],
  ['rolcreatedb', 'tiene CREATEDB'],
  ['es_miembro', 'es miembro de otro rol'],
  ['dueno_de_la_base', 'es dueño de la base (miembro de pg_database_owner)'],
  ['crea_en_base', 'tiene CREATE sobre la base'],
  ['temporales', 'tiene TEMPORARY sobre la base'],
  ['crea_en_public', 'tiene CREATE sobre el esquema public'],
  ['es_dueno', 'es dueño de objetos del esquema public'],
];

/**
 * Decide si el rol de la API es inseguro. Devuelve un texto por cada condición insegura (lista vacía: rol seguro).
 * Función pura: no toca la base. Cualquier valor distinto de `false` cuenta como inseguro (falla cerrada).
 */
export function problemasDelRol(fila: FilaRol): string[] {
  return CONDICIONES.filter(([campo]) => fila[campo] !== false).map(([, texto]) => texto);
}

/**
 * Fila que devuelve la consulta sobre los valores por defecto propios del rol (`ALTER ROLE … SET`, con o sin `IN DATABASE`).
 * Spec 001, criterio 103, precisión P-19.
 */
export interface FilaConfiguracionRol {
  /** `pg_roles.rolconfig` no vacío, o alguna fila de `pg_db_role_setting` con `setrole` igual al oid del rol. */
  readonly tiene_configuracion: boolean;
}

/**
 * Decide si el rol de la API tiene valores por defecto propios (`ALTER ROLE aquagestion_app SET …`): los aplicaría PostgreSQL
 * a cada conexión nueva y podrían cambiar `row_security`, `search_path` o los tiempos límite. Devuelve un problema por esa
 * condición (lista vacía: sin valores propios). Cualquier valor distinto de `false` cuenta como inseguro (falla cerrada).
 * Función pura: no toca la base. Los valores por defecto de la base para todos los roles no cuentan: los neutraliza cada
 * transacción (criterios 72 y 98).
 */
export function problemasDeConfiguracion(fila: FilaConfiguracionRol): string[] {
  return fila.tiene_configuracion === false
    ? []
    : [
        'tiene valores por defecto propios (ALTER ROLE … SET; corrige con ALTER ROLE aquagestion_app RESET ALL; o ' +
          'ALTER ROLE aquagestion_app IN DATABASE <base> RESET ALL;)',
      ];
}
