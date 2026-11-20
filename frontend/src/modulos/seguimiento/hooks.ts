import { type ConsultarSolicitud } from '@aquagestion/contratos';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useIdDeVisita } from '../../lib/visita';
import * as api from './api';

/**
 * La consulta con el enlace secreto. El token está solo en la memoria de la página: la clave vive en la caché de TanStack Query, que no
 * se persiste (sin `persistQueryClient`), y se descarta al salir (`gcTime: 0`). Se vuelve a pedir al entrar, porque la reserva puede
 * haber vencido o la solicitud haberse cancelado (criterio 44 de 005).
 */
export function useSolicitudPorToken(nombreCorto: string, token: string) {
  const visita = useIdDeVisita();
  return useQuery({
    queryKey: ['seguimiento', nombreCorto, visita, token],
    queryFn: () => api.consultarSolicitud(nombreCorto, { token }),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** La consulta con el código y el DNI: el resultado queda solo en la memoria del formulario, sin caché. */
export function useConsultarPorCodigo(nombreCorto: string) {
  return useMutation({
    mutationFn: (consulta: ConsultarSolicitud) => api.consultarSolicitud(nombreCorto, consulta),
    gcTime: 0,
  });
}
