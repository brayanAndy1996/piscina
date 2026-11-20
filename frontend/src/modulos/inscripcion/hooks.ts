import { useMutation, useQuery } from '@tanstack/react-query';
import { useIdDeVisita } from '../../lib/visita';
import * as api from './api';

/**
 * La oferta del formulario (planes vigentes, clases con cupo y textos de consentimiento). Cupos y precios cambian: no se guarda entre
 * visitas (la clave lleva el identificador de la visita). Las claves no llevan sesión: la página es pública y la academia es la de la dirección.
 */
export function useFormularioInscripcion(nombreCorto: string) {
  const visita = useIdDeVisita();
  return useQuery({
    queryKey: ['inscripcion-formulario', nombreCorto, visita],
    queryFn: () => api.obtenerFormulario(nombreCorto),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** La cotización (no escribe ni reserva nada, criterio 11). */
export function useCotizar(nombreCorto: string) {
  return useMutation({ mutationFn: (datos: Parameters<typeof api.cotizar>[1]) => api.cotizar(nombreCorto, datos) });
}

/** El envío. La clave de idempotencia viaja en el cuerpo y es la misma en cada reintento del mismo formulario. */
export function useEnviarInscripcion(nombreCorto: string) {
  return useMutation({
    mutationFn: (datos: Parameters<typeof api.enviarInscripcion>[1]) => api.enviarInscripcion(nombreCorto, datos),
  });
}
