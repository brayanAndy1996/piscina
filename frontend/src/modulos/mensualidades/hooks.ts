import type { CotizarRenovacion, DatosRenovacionComprobante, RenovarEnEfectivo } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClavesAsistenciaDelMes } from '../asistencia/hooks';
import { useClavesCaja } from '../caja/hooks';
import { useClavesCarnet } from '../carnet/hooks';
import { useClavesClases } from '../clases/hooks';
import { useClavesPagos } from '../pagos/hooks';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

/** Las claves llevan la identidad de la sesión: lo de otra academia o de otra persona nunca se reutiliza (criterio 20). */
export function useClavesMensualidades() {
  const usuario = useUsuario();
  const base = ['mensualidades', usuario.academia.nombreCorto, usuario.id] as const;
  return {
    todas: base,
    de: (alumnoId: string) => [...base, alumnoId] as const,
    oferta: (alumnoId: string, mes: string | null) => [...base, alumnoId, 'oferta', mes] as const,
    cotizacion: (alumnoId: string, datos: CotizarRenovacion) =>
      [...base, alumnoId, 'cotizacion', datos.mes, datos.planId, [...datos.claseIds].sort()] as const,
  };
}

/** La oferta de renovación de un alumno (criterio 2). Siempre se vuelve a pedir al entrar (los cupos cambian); no se reintenta. */
export function useOfertaRenovacion(alumnoId: string, mes: string | null) {
  const claves = useClavesMensualidades();
  return useQuery({
    queryKey: claves.oferta(alumnoId, mes),
    queryFn: () => api.obtenerOferta(alumnoId, mes ?? undefined),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** La cotización de lo elegido (criterio 5). Solo se pide con una selección completa; nunca se reutiliza una vieja. */
export function useCotizacionDeRenovacion(alumnoId: string, datos: CotizarRenovacion | null) {
  const claves = useClavesMensualidades();
  return useQuery({
    queryKey: datos ? claves.cotizacion(alumnoId, datos) : [...claves.de(alumnoId), 'cotizacion', null],
    queryFn: () => (datos ? api.cotizarRenovacion(alumnoId, datos) : Promise.reject(new Error('Sin selección.'))),
    enabled: datos !== null,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * Lo que cambia con una renovación: la oferta y la sección, el carnet (su matrícula), la asistencia del mes, la ocupación de las clases, la
 * caja (el efectivo entra) y la bandeja de pagos (un comprobante queda por verificar). Se vuelve a pedir pase lo que pase: un 409 significa
 * que lo que se veía ya no es lo que hay.
 */
function useRefrescarTrasRenovar(alumnoId: string) {
  const cliente = useQueryClient();
  const claves = useClavesMensualidades();
  const clavesCarnet = useClavesCarnet();
  const clavesAsistencia = useClavesAsistenciaDelMes();
  const clavesClases = useClavesClases();
  const clavesCaja = useClavesCaja();
  const clavesPagos = useClavesPagos();
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: claves.de(alumnoId) }),
      cliente.invalidateQueries({ queryKey: clavesCarnet.de(alumnoId) }),
      cliente.invalidateQueries({ queryKey: clavesAsistencia.de(alumnoId) }),
      cliente.invalidateQueries({ queryKey: clavesClases.ocupacion }),
      cliente.invalidateQueries({ queryKey: clavesCaja.actual }),
      cliente.invalidateQueries({ queryKey: clavesCaja.historialTodos }),
      cliente.invalidateQueries({ queryKey: clavesCaja.detalleTodos }),
      cliente.invalidateQueries({ queryKey: clavesPagos.pendientes }),
    ]);
}

/**
 * Renueva en efectivo (criterio 6). Antes confirma que la sesión sigue siendo la de la página. La clave de idempotencia la pone quien llama
 * y no cambia entre intentos: un doble clic o un reintento no cobra dos veces (criterio 12).
 */
export function useRenovarEnEfectivo(alumnoId: string) {
  const confirmarSesion = useConfirmarSesion();
  const refrescar = useRefrescarTrasRenovar(alumnoId);
  return useMutation({
    mutationFn: async (datos: RenovarEnEfectivo) => {
      await confirmarSesion();
      return api.renovarEnEfectivo(alumnoId, datos);
    },
    onSettled: refrescar,
  });
}

/** Renueva con el comprobante de Yape o transferencia (criterio 7): queda en verificación. Misma clave estable que el efectivo. */
export function useRenovarConComprobante(alumnoId: string) {
  const confirmarSesion = useConfirmarSesion();
  const refrescar = useRefrescarTrasRenovar(alumnoId);
  return useMutation({
    mutationFn: async ({ datos, archivo }: { datos: DatosRenovacionComprobante; archivo: File }) => {
      await confirmarSesion();
      return api.subirComprobanteDeRenovacion(alumnoId, datos, archivo);
    },
    onSettled: refrescar,
  });
}
