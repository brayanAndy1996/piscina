import { MATRIZ_PERMISOS, type Alcance, type Permiso, type RolUsuario } from '@aquagestion/contratos';

/** El alcance de la celda del rol para ese permiso en `MATRIZ_PERMISOS`, o `undefined` si el rol no lo tiene. Solo muestra u oculta: la API decide. */
export function alcanceDe(rol: RolUsuario, permiso: Permiso): Alcance | undefined {
  const fila: Readonly<Partial<Record<RolUsuario, Alcance>>> = MATRIZ_PERMISOS[permiso];
  return fila[rol];
}
