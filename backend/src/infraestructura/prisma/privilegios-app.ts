/**
 * Privilegios que el rol de la API (`aquagestion_app`) puede tener sobre las tablas del esquema `public` (spec 001,
 * criterio 2; criterio 102, precisión P-20). `columna: null` es la tabla entera; el privilegio va en mayúsculas.
 *
 * La API compara los privilegios efectivos del rol (concedidos a él o a `PUBLIC`) con esta lista y se niega a atender datos si
 * hay alguno de más (`ErrorRolBaseDatosInseguro`). `scripts/lib/rol-app.mjs` tiene la misma lista para `npm run db:crear`
 * (los scripts no pueden importar el backend): una prueba compara las dos. Toda historia que agregue una tabla amplía esta
 * lista y la de los scripts en su especificación, igual que la lista del criterio 10.
 */
export interface PrivilegioApp {
  readonly tabla: string;
  readonly columna: string | null;
  readonly privilegio: string;
}

export const PRIVILEGIOS_APP: readonly PrivilegioApp[] = Object.freeze(
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
    { tabla: 'usuarios', columna: null, privilegio: 'SELECT' },
    { tabla: 'usuarios', columna: null, privilegio: 'INSERT' },
    { tabla: 'usuarios', columna: 'clave_hash', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'debe_cambiar_clave', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'version_token', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'intentos_fallidos', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'bloqueado_hasta', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'ultimo_acceso', privilegio: 'UPDATE' },
    { tabla: 'usuarios', columna: 'actualizado_en', privilegio: 'UPDATE' },
  ].map((privilegio) => Object.freeze(privilegio)),
);

/** Texto de un privilegio para los mensajes: `UPDATE (nombre_corto) en academias` o `TRUNCATE en auditoria`. */
function describir({ tabla, columna, privilegio }: PrivilegioApp): string {
  return columna === null ? `${privilegio} en ${tabla}` : `${privilegio} (${columna}) en ${tabla}`;
}

/**
 * Los privilegios efectivos del rol que no están en `PRIVILEGIOS_APP`, uno por texto (con la tabla, el privilegio y, si es de
 * columna, la columna). Lista vacía: no hay nada de más. Un efectivo `(t, null, p)` se permite si `(t, null, p)` está en la
 * lista; uno `(t, c, p)`, si está `(t, null, p)` o `(t, c, p)`. Un privilegio que falta no se informa. Función pura.
 */
export function privilegiosDeMas(efectivos: readonly PrivilegioApp[]): string[] {
  const permitidos = new Set(PRIVILEGIOS_APP.map((p) => JSON.stringify([p.tabla, p.columna, p.privilegio])));
  return efectivos
    .filter((efectivo) => {
      const tablaEntera = permitidos.has(JSON.stringify([efectivo.tabla, null, efectivo.privilegio]));
      const columna = permitidos.has(JSON.stringify([efectivo.tabla, efectivo.columna, efectivo.privilegio]));
      return !(tablaEntera || (efectivo.columna !== null && columna));
    })
    .map(describir);
}

// ---------------------------------------------------------------------------------------------------------------------
// Privilegios en todos los esquemas (spec 001, criterio 130, precisión P-31)
// ---------------------------------------------------------------------------------------------------------------------

/** Una función de `public` sobre la que la app puede tener `EXECUTE`, identificada por nombre y argumentos. */
export interface FuncionApp {
  readonly esquema: 'public';
  readonly nombre: string;
  /** Lo que devuelve `pg_get_function_identity_arguments` (`''` si no tiene argumentos). */
  readonly argumentos: string;
}

/**
 * Las únicas funciones sobre las que la app puede tener `EXECUTE` (criterio 130). Toda historia que agregue una función a
 * `public` la agrega aquí en su especificación, o revoca en su migración el `EXECUTE` de `PUBLIC`. La misma lista está en
 * `scripts/lib/rol-app.mjs`: una prueba compara las dos.
 */
export const FUNCIONES_APP: readonly FuncionApp[] = Object.freeze(
  [
    { esquema: 'public' as const, nombre: 'app_academia_actual', argumentos: '' },
    { esquema: 'public' as const, nombre: 'app_es_plataforma', argumentos: '' },
    { esquema: 'public' as const, nombre: 'resolver_academia', argumentos: 'p_nombre_corto text' },
  ].map((funcion) => Object.freeze(funcion)),
);

/**
 * "Esquemas permitidos además de `public`" (criterio 130): hoy ninguno. Solo una especificación la amplía, con la
 * justificación de cada elemento. Un esquema de esta lista puede tener objetos propios y `USAGE` para la app.
 */
export const ESQUEMAS_PERMITIDOS: readonly string[] = Object.freeze([] as string[]);

/** Un privilegio efectivo de la app (concedido a ella, heredado o a `PUBLIC`) sobre un objeto de un esquema revisado. */
export interface PrivilegioEnEsquema {
  /** `pg_namespace.nspname`. */
  readonly esquema: string;
  readonly tipo: 'esquema' | 'tabla' | 'columna' | 'secuencia' | 'funcion';
  /** `null` si `tipo` es `esquema`. */
  readonly objeto: string | null;
  /** Solo si `tipo` es `columna`. */
  readonly columna: string | null;
  /** Solo si `tipo` es `funcion` (`pg_get_function_identity_arguments`). */
  readonly argumentos: string | null;
  /** En mayúsculas: SELECT, USAGE, EXECUTE… */
  readonly privilegio: string;
  /** Solo si `tipo` es `esquema`: tiene relaciones o funciones que no son de extensiones. */
  readonly conObjetosPropios?: boolean | null;
}

const texto = (valor: unknown): string | null => (typeof valor === 'string' ? valor : null);

/** Texto de un privilegio de más para el registro: siempre el esquema, el objeto, la columna y el privilegio, los que haya. */
function describirEnEsquema(efectivo: Record<string, unknown>): string {
  const esquema = texto(efectivo['esquema']);
  const objeto = texto(efectivo['objeto']);
  const columna = texto(efectivo['columna']);
  const argumentos = texto(efectivo['argumentos']);
  const privilegio = texto(efectivo['privilegio']) ?? '(privilegio desconocido)';
  const tipo = texto(efectivo['tipo']);
  const nombre = [esquema ?? '(esquema desconocido)', objeto].filter((parte) => parte !== null).join('.');
  switch (tipo) {
    case 'esquema':
      return `${privilegio} en el esquema ${esquema ?? '(esquema desconocido)'}`;
    case 'tabla':
      return `${privilegio} en ${nombre}`;
    case 'columna':
      return `${privilegio} (${columna ?? '?'}) en ${nombre}`;
    case 'secuencia':
      return `${privilegio} en la secuencia ${nombre}`;
    case 'funcion':
      return `${privilegio} en la función ${nombre}(${argumentos ?? '?'})`;
    default:
      return `${privilegio} en un objeto de tipo desconocido (${tipo ?? 'sin tipo'}) ${nombre}`;
  }
}

const PRIVILEGIOS_APP_SET: ReadonlySet<string> = new Set(
  PRIVILEGIOS_APP.map((p) => JSON.stringify([p.tabla, p.columna, p.privilegio])),
);

/** ¿Está permitido el privilegio efectivo? Falla cerrada: un tipo desconocido o un campo que falta no se permite. */
function estaPermitidoEnEsquema(efectivo: Record<string, unknown>): boolean {
  const esquema = texto(efectivo['esquema']);
  const objeto = texto(efectivo['objeto']);
  const privilegio = texto(efectivo['privilegio']);
  if (esquema === null || privilegio === null) return false;
  switch (efectivo['tipo']) {
    case 'tabla':
    case 'secuencia':
      return (
        objeto !== null && esquema === 'public' && PRIVILEGIOS_APP_SET.has(JSON.stringify([objeto, null, privilegio]))
      );
    case 'columna': {
      const columna = texto(efectivo['columna']);
      if (objeto === null || columna === null || esquema !== 'public') return false;
      return privilegiosDeMas([{ tabla: objeto, columna, privilegio }]).length === 0;
    }
    case 'funcion': {
      const argumentos = texto(efectivo['argumentos']);
      return (
        objeto !== null &&
        argumentos !== null &&
        privilegio === 'EXECUTE' &&
        FUNCIONES_APP.some((f) => f.esquema === esquema && f.nombre === objeto && f.argumentos === argumentos)
      );
    }
    case 'esquema':
      return (
        privilegio === 'USAGE' &&
        (esquema === 'public' || efectivo['conObjetosPropios'] === false || ESQUEMAS_PERMITIDOS.includes(esquema))
      );
    default:
      return false;
  }
}

/**
 * Los privilegios efectivos de la app en los esquemas revisados que no están permitidos (criterio 130, P-31), uno por texto
 * con el esquema, el objeto, la columna si la hay y el privilegio. Lista vacía: nada de más. Tabla, columna y secuencia solo
 * de `public` y solo lo de `PRIVILEGIOS_APP`; `EXECUTE` solo sobre `FUNCIONES_APP`; `USAGE` sobre `public`, o sobre un esquema
 * sin objetos propios (`conObjetosPropios` exactamente `false`) o de `ESQUEMAS_PERMITIDOS`. Falla cerrada. Función pura.
 */
export function privilegiosDeMasEnEsquemas(efectivos: readonly PrivilegioEnEsquema[]): string[] {
  return efectivos
    .map((efectivo) => efectivo as unknown as Record<string, unknown>)
    .filter((efectivo) => !estaPermitidoEnEsquema(efectivo))
    .map(describirEnEsquema);
}
