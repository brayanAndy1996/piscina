import { useQuery } from '@tanstack/react-query';
import { useUsuario } from '../sesion/contexto';
import * as api from './api';

/** Las claves llevan la identidad de la sesión: el ticket de otra academia o de otra persona nunca se reutiliza (criterio 54 de 007). */
export function useClavesPagos() {
  const usuario = useUsuario();
  const base = ['pagos', usuario.academia.nombreCorto, usuario.id] as const;
  return { todas: base, ticket: (id: string) => [...base, 'ticket', id] as const };
}

/** El ticket de un pago. Siempre se vuelve a pedir al entrar; no se reintenta (un 404 no se arregla pidiendo otra vez). */
export function useTicket(pagoId: string) {
  const claves = useClavesPagos();
  return useQuery({
    queryKey: claves.ticket(pagoId),
    queryFn: () => api.obtenerTicket(pagoId),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}
