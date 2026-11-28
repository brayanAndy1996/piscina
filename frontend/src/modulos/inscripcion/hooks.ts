import { useMutation, useQuery } from '@tanstack/react-query';
import { useIdDeVisita } from '../../lib/visita';
import * as api from './api';

/**
 * Los meses para los que se puede inscribir hoy (010d, criterio 1). Cambian con el día y con la configuración: no se guardan entre visitas
 * (la clave lleva el identificador de la visita).
 */
export function useMesesInscripcion(nombreCorto: string) {
  const visita = useIdDeVisita();
  return useQuery({
    queryKey: ['inscripcion', nombreCorto, 'meses', visita],
    queryFn: () => api.obtenerMeses(nombreCorto),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * La oferta del formulario para un mes (planes vigentes, clases con cupo y textos de consentimiento). Cupos y precios cambian: no se guarda
 * entre visitas (la clave lleva el identificador de la visita) y cada mes tiene la suya. Las claves no llevan sesión: la página es pública y
 * la academia es la de la dirección. Sin mes elegido todavía (`null`), no pide nada.
 */
export function useFormularioInscripcion(nombreCorto: string, mes: string | null) {
  const visita = useIdDeVisita();
  return useQuery({
    queryKey: ['inscripcion', nombreCorto, 'oferta', mes, visita],
    queryFn: () => api.obtenerFormulario(nombreCorto, mes ?? ''),
    enabled: mes !== null,
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
