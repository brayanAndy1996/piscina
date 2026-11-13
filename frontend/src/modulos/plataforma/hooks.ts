import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import * as api from './api';

export const RUTA_INGRESAR = '/plataforma/ingresar';
export const RUTA_ACADEMIAS = '/plataforma/academias';

const CLAVE_SESION = ['plataforma', 'sesion'] as const;
const CLAVE_ACADEMIAS = ['plataforma', 'academias'] as const;

/** Sesión del superadmin: un 401 es una respuesta esperada (no hay sesión), no hay que reintentar. */
export function useSesionPlataforma() {
  return useQuery({ queryKey: CLAVE_SESION, queryFn: api.obtenerSesion, retry: false, refetchOnWindowFocus: false });
}

export function useAcademias() {
  return useQuery({ queryKey: CLAVE_ACADEMIAS, queryFn: api.listarAcademias, retry: false });
}

export function useIniciarSesion() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.iniciarSesion,
    onSuccess: (datos) => {
      cliente.setQueryData(CLAVE_SESION, datos);
    },
  });
}

export function useCrearAcademia() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.crearAcademia,
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_ACADEMIAS }),
  });
}

export function useSuspenderAcademia() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => api.suspenderAcademia(id, { motivo }),
    // También tras un 409: la lista se vuelve a pedir para mostrar el estado real.
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_ACADEMIAS }),
  });
}

export function useReactivarAcademia() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo?: string | undefined }) =>
      api.reactivarAcademia(id, motivo === undefined ? {} : { motivo }),
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVE_ACADEMIAS }),
  });
}

/** Cierra la sesión. La página de ingreso borra de la memoria lo que se había pedido con ella. */
export function useCerrarSesion() {
  return useMutation({ mutationFn: api.cerrarSesion });
}

/** Si alguno de los errores es un 401 (sin sesión o sesión vencida), lleva a `/plataforma/ingresar`. */
export function useRedirigirSiNoAutenticado(...errores: unknown[]): void {
  const navegar = useNavigate();
  const sinSesion = errores.some((error) => esErrorDeApi(error, 401));
  useEffect(() => {
    if (sinSesion) void navegar(RUTA_INGRESAR, { replace: true });
  }, [sinSesion, navegar]);
}
