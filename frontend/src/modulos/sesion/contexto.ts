import type { UsuarioSesion } from '@aquagestion/contratos';
import { createContext, useContext } from 'react';

export const ContextoUsuario = createContext<UsuarioSesion | null>(null);

/** El usuario de la sesión. Solo se usa dentro de `RutaConSesion`, que no muestra nada sin sesión. */
export function useUsuario(): UsuarioSesion {
  const usuario = useContext(ContextoUsuario);
  if (!usuario) throw new Error('useUsuario se usó fuera de RutaConSesion.');
  return usuario;
}
