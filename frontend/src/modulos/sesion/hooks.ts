import type { RespuestaSesionAcademia } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import * as api from './api';

export const CLAVE_SESION = ['sesion'] as const;
const CLAVE_ACADEMIA_PUBLICA = 'academia-publica';

/** Lo que muestra la web de una academia suspendida (DR-4 de 001). */
export const MENSAJE_ACADEMIA_SUSPENDIDA = 'Academia no disponible por el momento.';

/** Sesión de la academia: un 401 es una respuesta esperada (no hay sesión), no hay que reintentar. */
export function useSesionAcademia() {
  return useQuery({ queryKey: CLAVE_SESION, queryFn: api.obtenerSesion, retry: false, refetchOnWindowFocus: false });
}

export function useAcademiaPublica(nombreCorto: string) {
  return useQuery({
    queryKey: [CLAVE_ACADEMIA_PUBLICA, nombreCorto],
    queryFn: () => api.obtenerAcademiaPublica(nombreCorto),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Ingreso. La sesión se guarda solo en la memoria de TanStack Query (nunca en `localStorage` ni `sessionStorage`); la cookie
 * httpOnly la pone la API.
 */
export function useIniciarSesionAcademia(nombreCorto: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: Parameters<typeof api.iniciarSesion>[1]) => api.iniciarSesion(nombreCorto, datos),
    onSuccess: (datos) => {
      cliente.setQueryData(CLAVE_SESION, datos);
    },
  });
}

/** Cierra la sesión (en todos los dispositivos de la cuenta) y vacía lo que había en la memoria de la página. */
export function useCerrarSesionAcademia() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.cerrarSesion,
    onSuccess: () => {
      cliente.clear();
    },
  });
}

export function useCambiarClave() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.cambiarClave,
    onSuccess: (datos: RespuestaSesionAcademia) => {
      cliente.setQueryData(CLAVE_SESION, datos);
    },
  });
}

/** Una respuesta que significa "la sesión ya no vale": 401, academia suspendida o cambio de contraseña pendiente. */
function esErrorDeSesion(error: unknown): boolean {
  return (
    esErrorDeApi(error, 401) ||
    esErrorDeApi(error, 403, 'ACADEMIA_SUSPENDIDA') ||
    esErrorDeApi(error, 403, 'CAMBIO_DE_CLAVE_OBLIGATORIO')
  );
}

/**
 * Si alguna llamada de una página interna responde que la sesión ya no vale, vuelve a pedir la sesión: `RutaConSesion` muestra
 * entonces la página que corresponde (sin sesión, academia no disponible o cambio de contraseña).
 */
export function useAlPerderSesion(...errores: unknown[]): void {
  const cliente = useQueryClient();
  const perdida = errores.some(esErrorDeSesion);
  useEffect(() => {
    if (perdida) void cliente.invalidateQueries({ queryKey: CLAVE_SESION });
  }, [perdida, cliente]);
}
