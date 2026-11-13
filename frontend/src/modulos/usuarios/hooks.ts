import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

const CLAVE_USUARIOS = ['usuarios'] as const;

/**
 * Toda acción que escribe (o que manda un DNI) confirma antes que la sesión sigue siendo la de la página (criterio 59 b).
 */

/** La lista del personal (con inactivos, PO-4). Un 401 no se reintenta: la sesión venció. */
export function useUsuarios() {
  return useQuery({ queryKey: CLAVE_USUARIOS, queryFn: api.listarPersonal, retry: false });
}

export function useCrearUsuario() {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: Parameters<typeof api.crearUsuario>[0]) => {
      await confirmarSesion();
      return api.crearUsuario(datos);
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/** Las acciones sobre una cuenta vuelven a pedir la lista también tras un 409 o un 404, para mostrar el estado real. */
export function useDesactivarUsuario() {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: Parameters<typeof api.desactivarUsuario>[0]) => {
      await confirmarSesion();
      return api.desactivarUsuario(datos);
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

export function useReactivarUsuario() {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: Parameters<typeof api.reactivarUsuario>[0]) => {
      await confirmarSesion();
      return api.reactivarUsuario(datos);
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

export function useRestablecerClaveUsuario() {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: Parameters<typeof api.restablecerClaveUsuario>[0]) => {
      await confirmarSesion();
      return api.restablecerClaveUsuario(datos);
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

/**
 * Busca por DNI con `POST`. Es una mutación y no una consulta: el DNI no entra en una clave de la caché ni en la dirección
 * (criterio 43).
 */
export function useBuscarUsuarioPorDni() {
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: Parameters<typeof api.buscarUsuarioPorDni>[0]) => {
      await confirmarSesion();
      return api.buscarUsuarioPorDni(datos);
    },
  });
}
