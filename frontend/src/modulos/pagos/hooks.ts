import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { useClavesCaja, useCajaActual, useHoyEnLima } from '../caja/hooks';
import { useClavesClases } from '../clases/hooks';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import { useClavesSolicitudes } from '../solicitudes/hooks';
import * as api from './api';

/** Las claves llevan la identidad de la sesión: el ticket o la bandeja de otra academia o de otra persona nunca se reutilizan (criterio 54 de 007). */
export function useClavesPagos() {
  const usuario = useUsuario();
  const base = ['pagos', usuario.academia.nombreCorto, usuario.id] as const;
  return {
    todas: base,
    ticket: (id: string) => [...base, 'ticket', id] as const,
    pendientes: [...base, 'pendientes'] as const,
  };
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

/** La bandeja de verificación. Siempre se vuelve a pedir al entrar y al volver a la ventana (otra persona pudo resolver un pago); no se reintenta. */
export function usePagosPendientes() {
  const claves = useClavesPagos();
  return useQuery({
    queryKey: claves.pendientes,
    queryFn: api.listarPagosPendientes,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export type ImagenDelComprobante =
  { estado: 'cargando' } | { estado: 'lista'; url: string } | { estado: 'error'; error: unknown };

/**
 * La imagen de un comprobante, pedida con la sesión (`pedirArchivo`) y mostrada con una dirección de objeto (criterio 56 de 007b). La
 * dirección se libera al cambiar de pago y al salir, y una petición en camino se cancela al salir. No pasa por la caché: la imagen de un
 * comprobante no se guarda en ninguna parte del navegador.
 */
export function useImagenDelComprobante(pagoId: string, intento: number): ImagenDelComprobante {
  const [resultado, setResultado] = useState<{ para: string; intento: number; imagen: ImagenDelComprobante } | null>(
    null,
  );
  useEffect(() => {
    const control = new AbortController();
    let url: string | null = null;
    void api.pedirComprobante(pagoId, control.signal).then(
      (blob) => {
        if (control.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResultado({ para: pagoId, intento, imagen: { estado: 'lista', url } });
      },
      (error: unknown) => {
        if (control.signal.aborted) return;
        setResultado({ para: pagoId, intento, imagen: { estado: 'error', error } });
      },
    );
    return () => {
      control.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [pagoId, intento]);
  // Una imagen de otro pago o de un intento anterior no se muestra mientras llega la nueva.
  return resultado && resultado.para === pagoId && resultado.intento === intento
    ? resultado.imagen
    : { estado: 'cargando' };
}

/**
 * Lo que cambia con la aprobación o el rechazo de un pago: la bandeja, las solicitudes (el estado visible cambia), la ocupación de las clases
 * (un rechazo libera el cupo) y la caja (una aprobación entra a su ingreso por Yape o transferencia). Se vuelve a pedir pase lo que pase: un
 * 409 significa que lo que se veía ya no es lo que hay.
 */
function useRefrescarTrasResolverUnPago() {
  const cliente = useQueryClient();
  const claves = useClavesPagos();
  const clavesSolicitudes = useClavesSolicitudes();
  const clavesClases = useClavesClases();
  const clavesCaja = useClavesCaja();
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: claves.pendientes }),
      cliente.invalidateQueries({ queryKey: clavesSolicitudes.todas }),
      cliente.invalidateQueries({ queryKey: clavesClases.ocupacion }),
      cliente.invalidateQueries({ queryKey: clavesCaja.actual }),
      cliente.invalidateQueries({ queryKey: clavesCaja.historialTodos }),
      cliente.invalidateQueries({ queryKey: clavesCaja.detalleTodos }),
    ]);
}

/** Aprueba un pago (HU-09, criterio 47). Antes confirma que la sesión sigue siendo la de la página (criterio 59 b de 002). */
export function useAprobarPago() {
  const confirmarSesion = useConfirmarSesion();
  const refrescar = useRefrescarTrasResolverUnPago();
  return useMutation({
    mutationFn: async (pagoId: string) => {
      await confirmarSesion();
      return api.aprobarPago(pagoId);
    },
    onSettled: refrescar,
  });
}

/** Rechaza un pago con un motivo (HU-09, criterio 49). */
export function useRechazarPago() {
  const confirmarSesion = useConfirmarSesion();
  const refrescar = useRefrescarTrasResolverUnPago();
  return useMutation({
    mutationFn: async (entrada: Parameters<typeof api.rechazarPago>[0]) => {
      await confirmarSesion();
      return api.rechazarPago(entrada);
    },
    onSettled: refrescar,
  });
}

/** Si la caja de hoy está abierta (la aprobación entra a ella, criterio 47): la consulta, si ya se revisó y si falló. Es un aviso: la API decide. */
export function useCajaDeHoyAbierta() {
  const consulta = useCajaActual();
  const revisada = useRecienPedida(consulta);
  const hoy = useHoyEnLima();
  const caja = consulta.data;
  const abierta = revisada && caja != null && caja.estado === 'ABIERTA' && !caja.deOtroDia && caja.fecha >= hoy;
  const fallo = !revisada && consulta.isError && !esErrorDeApi(consulta.error, 401);
  return { consulta, caja, revisada, abierta, fallo };
}
