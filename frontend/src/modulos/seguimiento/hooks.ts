import type { ConsultarSolicitud, DatosComprobante } from '@aquagestion/contratos';
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

/**
 * La subida del comprobante. La clave de idempotencia va dentro de `datos` y la pone quien llama: no cambia entre intentos. Las
 * devoluciones de llamada van en la propia mutación y no en cada `mutate`: siguen corriendo aunque la página cambie mientras espera.
 */
export function useSubirComprobante(
  nombreCorto: string,
  opciones: { alTerminar?: () => Promise<unknown> | void; alFallar?: (error: unknown) => Promise<unknown> | void } = {},
) {
  const { alTerminar, alFallar } = opciones;
  return useMutation({
    mutationFn: ({ token, datos, archivo }: { token: string; datos: DatosComprobante; archivo: File }) =>
      api.subirComprobante(nombreCorto, token, datos, archivo),
    ...(alTerminar ? { onSuccess: alTerminar } : {}),
    ...(alFallar ? { onError: alFallar } : {}),
  });
}
