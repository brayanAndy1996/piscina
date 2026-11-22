import type { Caja } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

/** La clave lleva la identidad de la sesión: la caja de otra academia o de otra persona nunca se reutiliza (criterio 28 de 003). */
export function useClavesCaja() {
  const usuario = useUsuario();
  return { actual: ['caja-actual', usuario.academia.nombreCorto, usuario.id] as const };
}

/** La caja del día. Siempre se vuelve a pedir al entrar; no se reintenta ni se pide al enfocar. */
export function useCajaActual() {
  const claves = useClavesCaja();
  return useQuery({
    queryKey: claves.actual,
    queryFn: api.obtenerCajaActual,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * Las cuatro escrituras de la caja comparten la forma: antes confirman que la sesión sigue siendo la de la página (criterio 59 b de 002)
 * y, con la respuesta, dejan la caja nueva en la consulta. Pase lo que pase, al terminar vuelven a pedir la caja: un 409 significa que lo que
 * se veía ya no es lo que hay.
 */
function useEscrituraDeCaja<Entrada, Salida>(
  escribir: (entrada: Entrada) => Promise<Salida>,
  cajaDe: (salida: Salida) => Caja,
) {
  const cliente = useQueryClient();
  const claves = useClavesCaja();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (entrada: Entrada) => {
      await confirmarSesion();
      return escribir(entrada);
    },
    onSuccess: (salida) => {
      cliente.setQueryData(claves.actual, cajaDe(salida));
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: claves.actual }),
  });
}

export function useAbrirCaja() {
  return useEscrituraDeCaja(api.abrirCaja, (caja) => caja);
}

export function useRegistrarEgreso() {
  return useEscrituraDeCaja(api.registrarEgreso, (respuesta) => respuesta.caja);
}

export function useCerrarCaja() {
  return useEscrituraDeCaja(api.cerrarCaja, (caja) => caja);
}

export function useReabrirCaja() {
  return useEscrituraDeCaja(api.reabrirCaja, (caja) => caja);
}
