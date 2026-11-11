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
