/**
 * Matriz de permisos (sección 2.1 de los requerimientos, más `GESTIONAR_USUARIOS` y `RESTABLECER_CLAVE` de la spec 002). La
 * comparten la API (guard de permisos) y la web (menú). Quien decide siempre es la API: la web solo muestra u oculta.
 *
 * El guard de la API solo decide si el rol pasa (`puede`); el alcance de cada celda (`SUS_ALUMNOS`, `PROPIO`…) lo aplica el
 * servicio de cada historia.
 */

/** Roles de las cuentas con usuario. "Cliente" no es un rol: su único permiso (autoinscripción) es una ruta pública. */
export const ROLES_USUARIO = ['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const;
export type RolUsuario = (typeof ROLES_USUARIO)[number];

/**
 * Alcances de una celda de la matriz. `TODO`; `SUS_ALUMNOS` ("solo los suyos"); `SUS_CLASES`; `PROPIO` ("propia", sus pagos);
 * `SU_CAJA` ("parcial: su caja"); `LOS_QUE_SUBE`; `ALUMNOS` (solo cuentas de alumno).
 */
export const ALCANCES = ['TODO', 'SUS_ALUMNOS', 'SUS_CLASES', 'PROPIO', 'SU_CAJA', 'LOS_QUE_SUBE', 'ALUMNOS'] as const;
export type Alcance = (typeof ALCANCES)[number];

export const PERMISOS = [
  'CONFIGURAR_PLANES_HORARIOS_AFORO',
  'CREAR_CODIGOS_DESCUENTO',
  'AUTORIZAR_CLASES_PARTICULARES',
  'COBRAR_CLASE_PARTICULAR',
  'REGISTRAR_INSCRIPCION_Y_COBRO',
  'VERIFICAR_PAGOS',
  'ABRIR_CERRAR_CAJA',
  'REGISTRAR_ASISTENCIA',
  'MODIFICAR_HORARIO_ALUMNO',
  'VER_FICHA_ALUMNO',
  'EDITAR_RENDIMIENTO',
  'SUBIR_MULTIMEDIA',
  'VER_REPORTES_FINANCIEROS',
  'VER_REPORTES_ASISTENCIA',
  'VER_CARNET',
  'AUTORIZAR_ASISTENCIA_OTRO_HORARIO',
  'REGISTRAR_PAGOS_ENTRENADORES',
  'VER_PAGOS_RECIBIDOS',
  'REGISTRAR_DIAS_CIERRE',
  'EMITIR_CERTIFICADOS',
  'VER_MULTIMEDIA',
  'GESTIONAR_USUARIOS',
  'RESTABLECER_CLAVE',
] as const;
export type Permiso = (typeof PERMISOS)[number];

export type FilaDePermiso = Readonly<Partial<Record<RolUsuario, Alcance>>>;

/**
 * Qué rol tiene cada permiso y con qué alcance. Una celda ausente es "no". `RESTABLECER_CLAVE` del `ADMIN` vale `TODO`: "no a sí
 * mismo" es una regla del servicio (409 `OPERACION_SOBRE_SI_MISMO`), no un alcance.
 */
export const MATRIZ_PERMISOS: Readonly<Record<Permiso, FilaDePermiso>> = {
  CONFIGURAR_PLANES_HORARIOS_AFORO: { ADMIN: 'TODO' },
  CREAR_CODIGOS_DESCUENTO: { ADMIN: 'TODO' },
  AUTORIZAR_CLASES_PARTICULARES: { ADMIN: 'TODO' },
  COBRAR_CLASE_PARTICULAR: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  REGISTRAR_INSCRIPCION_Y_COBRO: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  VERIFICAR_PAGOS: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  ABRIR_CERRAR_CAJA: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  REGISTRAR_ASISTENCIA: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  MODIFICAR_HORARIO_ALUMNO: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  VER_FICHA_ALUMNO: { ADMIN: 'TODO', SECRETARIA: 'TODO', ENTRENADOR: 'SUS_ALUMNOS' },
  EDITAR_RENDIMIENTO: { ENTRENADOR: 'SUS_ALUMNOS' },
  SUBIR_MULTIMEDIA: { ADMIN: 'TODO', ENTRENADOR: 'SUS_ALUMNOS' },
  VER_REPORTES_FINANCIEROS: { ADMIN: 'TODO', SECRETARIA: 'SU_CAJA' },
  VER_REPORTES_ASISTENCIA: { ADMIN: 'TODO', SECRETARIA: 'TODO', ENTRENADOR: 'SUS_CLASES', ALUMNO: 'PROPIO' },
  VER_CARNET: { ADMIN: 'TODO', SECRETARIA: 'TODO', ALUMNO: 'PROPIO' },
  AUTORIZAR_ASISTENCIA_OTRO_HORARIO: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  REGISTRAR_PAGOS_ENTRENADORES: { ADMIN: 'TODO' },
  VER_PAGOS_RECIBIDOS: { ENTRENADOR: 'PROPIO' },
  REGISTRAR_DIAS_CIERRE: { ADMIN: 'TODO' },
  EMITIR_CERTIFICADOS: { ADMIN: 'TODO' },
  VER_MULTIMEDIA: { ADMIN: 'TODO', ENTRENADOR: 'LOS_QUE_SUBE', ALUMNO: 'PROPIO' },
  GESTIONAR_USUARIOS: { ADMIN: 'TODO' },
  RESTABLECER_CLAVE: { ADMIN: 'TODO', SECRETARIA: 'ALUMNOS' },
};

/**
 * `true` si la celda del rol para ese permiso no está vacía. Falla cerrada: un rol o un permiso que no existen (por ejemplo, un
 * texto que llegó de fuera) no pasan, y no se leen propiedades heredadas.
 */
export function puede(rol: string, permiso: string): boolean {
  if (!Object.hasOwn(MATRIZ_PERMISOS, permiso)) return false;
  const fila = MATRIZ_PERMISOS[permiso as Permiso];
  return Object.hasOwn(fila, rol) && fila[rol as RolUsuario] !== undefined;
}
