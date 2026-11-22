import type { Caja, FiltroHistorialCajas } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DescargaCanceladaError, iniciarDescarga } from '../../lib/descargas-en-curso';
import { hoyEnLima } from '../../lib/fechas';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion, useVigilanteDeLaSesion } from '../sesion/hooks';
import * as api from './api';
import { entregarArchivo, nombreDelPdfDelCierre } from './descarga';

/**
 * Las claves llevan la identidad de la sesión: la caja de otra academia o de otra persona nunca se reutiliza (criterio 28 de 003). Las del
 * historial y del detalle son las de PQ12.
 */
export function useClavesCaja() {
  const usuario = useUsuario();
  const identidad = [usuario.academia.nombreCorto, usuario.id] as const;
  return {
    actual: ['caja-actual', ...identidad] as const,
    historialTodos: ['cajas-historial', ...identidad] as const,
    historial: (filtro: FiltroHistorialCajas) =>
      ['cajas-historial', ...identidad, filtro.desde ?? null, filtro.hasta ?? null] as const,
    detalleTodos: ['caja', ...identidad] as const,
    detalle: (id: string) => ['caja', ...identidad, id] as const,
  };
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
      const caja = cajaDe(salida);
      cliente.setQueryData(claves.actual, caja);
      cliente.setQueryData(claves.detalle(caja.id), caja);
    },
    // El historial y el detalle también cambian con cada escritura: se vuelven a pedir cuando se abran.
    onSettled: () =>
      Promise.all([
        cliente.invalidateQueries({ queryKey: claves.actual }),
        cliente.invalidateQueries({ queryKey: claves.historialTodos }),
        cliente.invalidateQueries({ queryKey: claves.detalleTodos }),
      ]),
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

/** El historial de cajas del filtro pedido (criterio 40). Siempre se vuelve a pedir al entrar; no se reintenta. */
export function useHistorialCajas(filtro: FiltroHistorialCajas) {
  const claves = useClavesCaja();
  return useQuery({
    queryKey: claves.historial(filtro),
    queryFn: () => api.obtenerHistorial(filtro),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** El detalle de una caja (criterio 41). Siempre se vuelve a pedir al entrar; no se reintenta. */
export function useDetalleCaja(id: string) {
  const claves = useClavesCaja();
  return useQuery({
    queryKey: claves.detalle(id),
    queryFn: () => api.obtenerCaja(id),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * Descarga el PDF de un cierre (criterio 42): antes confirma que la sesión sigue siendo la de la página (como las escrituras), pide el
 * archivo con la misma cookie y se lo entrega al navegador con su nombre.
 *
 * Cada descarga tiene su propio `AbortController` (criterio 54, DT-13) y se cancela si la persona pulsa "Cerrar sesión" (lo hace
 * `useCerrarSesionAcademia` con el registro de descargas), si la sesión se pierde o cambia de identidad, o si la página se desmonta. Antes
 * de entregar se comprueba otra vez, aunque el `fetch` haya ignorado la señal. Una descarga cancelada falla con `DescargaCanceladaError`,
 * que no lleva mensaje.
 */
export function useDescargarPdfDelCierre() {
  const confirmarSesion = useConfirmarSesion();
  const vigilarLaSesion = useVigilanteDeLaSesion();
  // Las descargas de esta página que todavía no terminaron, cada una con cómo soltar lo que registró.
  const propias = useRef(new Map<AbortController, () => void>());
  useEffect(() => {
    const descargas = propias.current;
    return () => {
      for (const [controlador, soltar] of descargas) {
        controlador.abort();
        soltar();
      }
      descargas.clear();
    };
  }, []);
  const mutacion = useMutation({
    mutationFn: async ({ cajaId, fecha, numero, controlador, sigue, soltar }: DescargaPedida) => {
      try {
        // Criterio 57 b: si la mutación estuvo en pausa (sin conexión) y la descarga se canceló mientras tanto, no pide nada.
        if (controlador.signal.aborted) throw new DescargaCanceladaError();
        await confirmarSesion();
        if (controlador.signal.aborted) throw new DescargaCanceladaError();
        const pdf = await api.obtenerPdfDelCierre({ cajaId, numero }, controlador.signal);
        // Comprobación final: la respuesta ya llegó, pero ya no corresponde si se canceló o si la identidad cambió.
        if (controlador.signal.aborted || !sigue()) throw new DescargaCanceladaError();
        entregarArchivo(pdf, nombreDelPdfDelCierre(fecha, numero));
      } catch (error) {
        if (controlador.signal.aborted || error instanceof DescargaCanceladaError) throw new DescargaCanceladaError();
        throw error;
      } finally {
        soltar();
        propias.current.delete(controlador);
      }
    },
  });
  const { mutate } = mutacion;
  /**
   * Criterio 57 b: la descarga cuenta como "en curso" desde que se pulsa, no desde que empieza su `mutationFn` (que sin conexión queda en
   * pausa). La identidad de la página también se toma al pulsar.
   */
  const descargar = useCallback(
    (datos: { cajaId: string; fecha: string; numero: number }) => {
      const { sigue, vigilar } = vigilarLaSesion();
      const { controlador, terminar } = iniciarDescarga();
      const dejarDeVigilar = vigilar(() => controlador.abort());
      const soltar = () => {
        dejarDeVigilar();
        terminar();
      };
      propias.current.set(controlador, soltar);
      mutate({ ...datos, controlador, sigue, soltar });
    },
    [mutate, vigilarLaSesion],
  );
  return {
    descargar,
    isPending: mutacion.isPending,
    isError: mutacion.isError,
    error: mutacion.error,
    variables: mutacion.variables,
  };
}

interface DescargaPedida {
  cajaId: string;
  fecha: string;
  numero: number;
  controlador: AbortController;
  sigue: () => boolean;
  soltar: () => void;
}
