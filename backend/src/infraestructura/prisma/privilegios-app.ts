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
    { tabla: 'planes', columna: null, privilegio: 'SELECT' },
    { tabla: 'planes', columna: null, privilegio: 'INSERT' },
    { tabla: 'planes', columna: 'nombre', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'veces_por_semana', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'clases_por_mes', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'duracion_minutos', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'precio', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'dias_permitidos', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'franjas_permitidas', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'niveles_aplicables', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'vigencia_inicio', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'vigencia_fin', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'activo', privilegio: 'UPDATE' },
    { tabla: 'planes', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'clases', columna: null, privilegio: 'SELECT' },
    { tabla: 'clases', columna: null, privilegio: 'INSERT' },
    { tabla: 'clases', columna: 'entrenador_id', privilegio: 'UPDATE' },
    { tabla: 'clases', columna: 'aforo', privilegio: 'UPDATE' },
    { tabla: 'clases', columna: 'activo', privilegio: 'UPDATE' },
    { tabla: 'clases', columna: 'actualizado_en', privilegio: 'UPDATE' },
    // Historia 005 (criterio 2): las siete tablas de la inscripción. `apoderados` es la única con DELETE.
    { tabla: 'alumnos', columna: null, privilegio: 'SELECT' },
    { tabla: 'alumnos', columna: null, privilegio: 'INSERT' },
    { tabla: 'alumnos', columna: 'nombres', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'apellidos', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'fecha_nacimiento', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'telefono', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'correo', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'direccion', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'grado_colegio', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'nivel', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'foto_clave', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'usuario_id', privilegio: 'UPDATE' },
    // Historia 008a (criterio 1): el token del QR del carnet, su fecha y la clave de la última regeneración. Nada más de `alumnos` cambia.
    { tabla: 'alumnos', columna: 'qr_token', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'qr_generado_en', privilegio: 'UPDATE' },
    { tabla: 'alumnos', columna: 'qr_clave_idempotencia', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: null, privilegio: 'SELECT' },
    { tabla: 'apoderados', columna: null, privilegio: 'INSERT' },
    { tabla: 'apoderados', columna: null, privilegio: 'DELETE' },
    { tabla: 'apoderados', columna: 'nombres', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: 'apellidos', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: 'dni', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: 'telefono', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: 'parentesco', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: 'correo', privilegio: 'UPDATE' },
    { tabla: 'apoderados', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: null, privilegio: 'SELECT' },
    { tabla: 'fichas_medicas', columna: null, privilegio: 'INSERT' },
    { tabla: 'fichas_medicas', columna: 'tipo_sangre', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'enfermedades', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'alergias', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'medicamentos', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'seguro', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'contacto_emergencia_nombre', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'contacto_emergencia_telefono', privilegio: 'UPDATE' },
    { tabla: 'fichas_medicas', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'consentimientos', columna: null, privilegio: 'SELECT' },
    { tabla: 'consentimientos', columna: null, privilegio: 'INSERT' },
    { tabla: 'solicitudes_inscripcion', columna: null, privilegio: 'SELECT' },
    { tabla: 'solicitudes_inscripcion', columna: null, privilegio: 'INSERT' },
    { tabla: 'solicitudes_inscripcion', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'solicitudes_inscripcion', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'matriculas', columna: null, privilegio: 'SELECT' },
    { tabla: 'matriculas', columna: null, privilegio: 'INSERT' },
    { tabla: 'matriculas', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'matriculas', columna: 'reserva_vence_en', privilegio: 'UPDATE' },
    { tabla: 'matriculas', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'matriculas', columna: 'monto_ajustado', privilegio: 'UPDATE' },
    { tabla: 'matriculas', columna: 'motivo_ajuste', privilegio: 'UPDATE' },
    // Historia 009 (criterio 1): cada asistencia descuenta una clase de la matrícula.
    { tabla: 'matriculas', columna: 'clases_usadas', privilegio: 'UPDATE' },
    { tabla: 'matricula_clases', columna: null, privilegio: 'SELECT' },
    { tabla: 'matricula_clases', columna: null, privilegio: 'INSERT' },
    // Historia 006 (criterio 2): las tres tablas de la caja. Nada se borra y los movimientos no cambian (sin UPDATE). En `cajas` solo
    // cambian el estado y `actualizado_en`; en `cierres_caja`, solo los datos de la reapertura (ningún monto de un cierre cambia).
    { tabla: 'cajas', columna: null, privilegio: 'SELECT' },
    { tabla: 'cajas', columna: null, privilegio: 'INSERT' },
    { tabla: 'cajas', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'cajas', columna: 'actualizado_en', privilegio: 'UPDATE' },
    { tabla: 'movimientos_caja', columna: null, privilegio: 'SELECT' },
    { tabla: 'movimientos_caja', columna: null, privilegio: 'INSERT' },
    { tabla: 'cierres_caja', columna: null, privilegio: 'SELECT' },
    { tabla: 'cierres_caja', columna: null, privilegio: 'INSERT' },
    { tabla: 'cierres_caja', columna: 'reabierto_por', privilegio: 'UPDATE' },
    { tabla: 'cierres_caja', columna: 'reabierto_en', privilegio: 'UPDATE' },
    { tabla: 'cierres_caja', columna: 'motivo_reapertura', privilegio: 'UPDATE' },
    // Historia 007 (criterio 2): `pagos` (sin DELETE; solo cambian al resolverse el estado, quién y cuándo, el motivo y el ticket). La
    // confirmación pasa al alumno a `ALUMNO_ACTIVO` con su cuenta (`alumnos.estado` y `usuario_id`) y el ajuste del administrador cambia
    // `matriculas.monto_ajustado` y `motivo_ajuste`.
    { tabla: 'pagos', columna: null, privilegio: 'SELECT' },
    { tabla: 'pagos', columna: null, privilegio: 'INSERT' },
    { tabla: 'pagos', columna: 'estado', privilegio: 'UPDATE' },
    { tabla: 'pagos', columna: 'verificado_por', privilegio: 'UPDATE' },
    { tabla: 'pagos', columna: 'verificado_en', privilegio: 'UPDATE' },
    { tabla: 'pagos', columna: 'motivo_rechazo', privilegio: 'UPDATE' },
    { tabla: 'pagos', columna: 'numero_ticket', privilegio: 'UPDATE' },
    { tabla: 'pagos', columna: 'actualizado_en', privilegio: 'UPDATE' },
    // Historia 009 (criterio 1): `asistencias` (una asistencia no cambia ni se borra: sin UPDATE ni DELETE).
    { tabla: 'asistencias', columna: null, privilegio: 'SELECT' },
    { tabla: 'asistencias', columna: null, privilegio: 'INSERT' },
    // Historia 009b (criterio 22): `inasistencias` (una falta no se borra: solo se cubre, una vez, con la asistencia del día).
    { tabla: 'inasistencias', columna: null, privilegio: 'SELECT' },
    { tabla: 'inasistencias', columna: null, privilegio: 'INSERT' },
    { tabla: 'inasistencias', columna: 'asistencia_id', privilegio: 'UPDATE' },
    { tabla: 'inasistencias', columna: 'cubierta_en', privilegio: 'UPDATE' },
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
