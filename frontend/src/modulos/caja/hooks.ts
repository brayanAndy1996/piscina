import type { Caja } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { hoyEnLima } from '../../lib/fechas';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

/** La clave lleva la identidad de la sesión: la caja de otra academia o de otra persona nunca se reutiliza (criterio 28 de 003). */
export function useClavesCaja() {
  const usuario = useUsuario();
  return { actual: ['caja-actual', usuario.academia.nombreCorto, usuario.id] as const };
}

/**
 * La fecha de hoy en Lima, al día: se recalcula cada minuto y al volver a la ventana. Una página que sigue abierta pasada la medianoche
 * vuelve a dibujarse aunque la API devuelva lo mismo que antes.
 */
export function useHoyEnLima(): string {
  const [hoy, setHoy] = useState(() => hoyEnLima());
  useEffect(() => {
    const actualizar = () => setHoy(hoyEnLima());
    const intervalo = setInterval(actualizar, 60_000);
    document.addEventListener('visibilitychange', actualizar);
    window.addEventListener('focus', actualizar);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', actualizar);
      window.removeEventListener('focus', actualizar);
    };
  }, []);
  return hoy;
}

/**
 * La caja del día. Siempre se vuelve a pedir al entrar y al volver a la ventana (una página abierta pasada la medianoche no debe seguir
 * mostrando la caja de ayer como la de hoy); no se reintenta.
 */
export function useCajaActual() {
  const claves = useClavesCaja();
  return useQuery({
    queryKey: claves.actual,
    queryFn: api.obtenerCajaActual,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
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
