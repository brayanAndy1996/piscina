import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

const CLAVE_USUARIOS = ['usuarios'] as const;

/** La lista del personal (con inactivos, PO-4). Un 401 no se reintenta: la sesión venció. */
export function useUsuarios() {
  return useQuery({ queryKey: CLAVE_USUARIOS, queryFn: api.listarPersonal, retry: false });
}

export function useCrearUsuario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.crearUsuario,
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Las acciones sobre una cuenta vuelven a pedir la lista también tras un 409 o un 404, para mostrar el estado real. */
export function useDesactivarUsuario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.desactivarUsuario,
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

export function useReactivarUsuario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.reactivarUsuario,
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

export function useRestablecerClaveUsuario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.restablecerClaveUsuario,
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/**
 * Busca por DNI con `POST`. Es una mutación y no una consulta: el DNI no entra en una clave de la caché ni en la dirección
 * (criterio 43).
 */
export function useBuscarUsuarioPorDni() {
  return useMutation({ mutationFn: api.buscarUsuarioPorDni });
}
