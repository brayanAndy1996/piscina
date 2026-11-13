import type { RolUsuario } from '@aquagestion/contratos';

/** Nombre de cada rol tal como se muestra en la web. */
export const ETIQUETA_ROL: Record<RolUsuario, string> = {
  ADMIN: 'Administrador',
  SECRETARIA: 'Secretaria',
  ENTRENADOR: 'Entrenador',
  ALUMNO: 'Alumno',
};
