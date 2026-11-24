import type { FiltroEstadoSolicitudes } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClavesCaja } from '../caja/hooks';
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

/**
 * Lo que cambia con un cobro o un ajuste: las listas de solicitudes, la ocupación de las clases (el cupo pasa de reservado a ocupado) y la
 * caja (el cobro entra a su efectivo). Se vuelve a pedir pase lo que pase: un 409 significa que lo que se veía ya no es lo que hay.
 */
function useRefrescarTrasUnPago() {
  const cliente = useQueryClient();
  const claves = useClavesSolicitudes();
  const clavesClases = useClavesClases();
  const clavesCaja = useClavesCaja();
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: claves.todas }),
      cliente.invalidateQueries({ queryKey: clavesClases.ocupacion }),
      cliente.invalidateQueries({ queryKey: clavesCaja.actual }),
      cliente.invalidateQueries({ queryKey: clavesCaja.historialTodos }),
      cliente.invalidateQueries({ queryKey: clavesCaja.detalleTodos }),
    ]);
}

/**
 * Cobra una solicitud en efectivo (HU-07, criterios 13 a 19 de 007). Antes confirma que la sesión sigue siendo la de la página. La clave de
 * idempotencia la pone quien llama y no cambia entre intentos: un doble clic o un reintento no cobra dos veces (criterio 17).
 */
export function useCobrarEnEfectivo() {
  const confirmarSesion = useConfirmarSesion();
  const refrescar = useRefrescarTrasUnPago();
  return useMutation({
    mutationFn: async (entrada: Parameters<typeof api.cobrarEnEfectivo>[0]) => {
      await confirmarSesion();
      return api.cobrarEnEfectivo(entrada);
    },
    onSettled: refrescar,
  });
}

/** Ajusta el monto de una solicitud sin pagar (RN-25, HU-34, criterio 11). Solo `ADMIN`: la API vuelve a comprobarlo. */
export function useAjustarMonto() {
  const confirmarSesion = useConfirmarSesion();
  const refrescar = useRefrescarTrasUnPago();
  return useMutation({
    mutationFn: async (entrada: Parameters<typeof api.ajustarMonto>[0]) => {
      await confirmarSesion();
      return api.ajustarMonto(entrada);
    },
    onSettled: refrescar,
  });
}
