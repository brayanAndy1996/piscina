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

/**
 * Fila que devuelve la consulta sobre los esquemas de la base (spec 001, criterio 123, precisión P-29).
 */
export interface FilaEsquemas {
  /** Dueño de cualquier esquema de la base (`pg_namespace.nspowner`), no solo de `public`. */
  readonly dueno_de_esquema: boolean;
  /** `CREATE` sobre cualquier esquema de la base, concedido al rol o a `PUBLIC`. */
  readonly crea_en_esquema: boolean;
  /** Existe un esquema con el nombre del rol: el `search_path` por defecto (`"$user", public`) lo buscaría antes. */
  readonly esquema_con_su_nombre: boolean;
}

const CONDICIONES_DE_ESQUEMAS: readonly (readonly [keyof FilaEsquemas, string])[] = [
  ['dueno_de_esquema', 'es dueño de un esquema de la base (ALTER SCHEMA <esquema> OWNER TO <dueño>;)'],
  [
    'crea_en_esquema',
    'tiene CREATE sobre un esquema de la base (REVOKE CREATE ON SCHEMA <esquema> FROM <rol de la API>; o … FROM PUBLIC;)',
  ],
  ['esquema_con_su_nombre', 'existe un esquema con el nombre del rol (renombra o elimina ese esquema)'],
];

/**
 * Decide si los esquemas de la base hacen inseguro al rol de la API (criterio 123): un problema por cada campo distinto de
 * `false` (falla cerrada, como `problemasDelRol`). Función pura: no toca la base. Aparte de `problemasDelRol` y
 * `problemasDeConfiguracion`, cuyo resultado no cambia.
 */
export function problemasDeEsquemas(fila: FilaEsquemas): string[] {
  return CONDICIONES_DE_ESQUEMAS.filter(([campo]) => fila[campo] !== false).map(([, texto]) => texto);
}
