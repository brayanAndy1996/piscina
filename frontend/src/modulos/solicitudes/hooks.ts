import type { FiltroEstadoSolicitudes } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClavesClases } from '../clases/hooks';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

/** Las claves llevan la identidad de la sesión: lo de otra academia o de otra persona nunca se reutiliza (criterio 46 de 005). */
export function useClavesSolicitudes() {
  const usuario = useUsuario();
  const base = ['solicitudes', usuario.academia.nombreCorto, usuario.id] as const;
  return { todas: base, filtro: (estado: FiltroEstadoSolicitudes) => [...base, estado] as const };
}

/** Las solicitudes del filtro elegido. Siempre se vuelve a pedir al entrar; no se reintenta ni se pide al enfocar. */
export function useSolicitudes(estado: FiltroEstadoSolicitudes) {
  const claves = useClavesSolicitudes();
  return useQuery({
    queryKey: claves.filtro(estado),
    queryFn: () => api.listarSolicitudes(estado),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * Cancela una solicitud. Antes confirma que la sesión sigue siendo la de la página (criterio 59 b de 002). Con 200, 409 o 404 vuelve a
 * pedir las listas (la solicitud ya no está como se veía) y la ocupación de las clases (el cupo se liberó).
 */
export function useCancelarSolicitud() {
  const cliente = useQueryClient();
  const claves = useClavesSolicitudes();
  const clavesClases = useClavesClases();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (entrada: Parameters<typeof api.cancelarSolicitud>[0]) => {
      await confirmarSesion();
      return api.cancelarSolicitud(entrada);
    },
    onSettled: async () => {
      await Promise.all([
        cliente.invalidateQueries({ queryKey: claves.todas }),
        cliente.invalidateQueries({ queryKey: clavesClases.ocupacion }),
      ]);
    },
  });
}
