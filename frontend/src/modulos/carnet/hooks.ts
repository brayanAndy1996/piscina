import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { DescargaCanceladaError, iniciarDescarga } from '../../lib/descargas-en-curso';
import { entregarArchivo } from '../caja/descarga';
import { useUsuario } from '../sesion/contexto';
import { CLAVE_CERRAR_SESION, useConfirmarSesion, useVigilanteDeLaSesion } from '../sesion/hooks';
import * as api from './api';

/** El nombre del PDF, igual al que pone la API (criterio 11 de 008): sin nombres ni DNI. */
export const NOMBRE_DEL_PDF_DEL_CARNET = 'carnet.pdf';

/** Las claves llevan la identidad de la sesión: el carnet de otra academia o de otra persona nunca se reutiliza (criterio 19 de 008). */
export function useClavesCarnet() {
  const usuario = useUsuario();
  const base = ['carnet', usuario.academia.nombreCorto, usuario.id] as const;
  return {
    todas: base,
    mio: [...base, 'mio'] as const,
    de: (alumnoId: string) => [...base, 'alumno', alumnoId] as const,
  };
}

/** El carnet de la propia persona. Siempre se vuelve a pedir al entrar (el QR pudo regenerarse); no se reintenta. */
export function useMiCarnet() {
  const claves = useClavesCarnet();
  return useQuery({
    queryKey: claves.mio,
    queryFn: api.obtenerMiCarnet,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/** El carnet de un alumno, para el personal. Siempre se vuelve a pedir al entrar; no se reintenta (un 404 no se arregla pidiendo otra vez). */
export function useCarnetDelAlumno(alumnoId: string) {
  const claves = useClavesCarnet();
  return useQuery({
    queryKey: claves.de(alumnoId),
    queryFn: () => api.obtenerCarnet(alumnoId),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/**
 * Descarga el PDF del carnet (criterio 11): antes confirma que la sesión sigue siendo la de la página, pide el archivo con la misma cookie y
 * se lo entrega al navegador. Con `alumnoId` nulo es el de la propia persona (`/api/mi-carnet/pdf`, sin id).
 *
 * Como la del cierre de caja (criterio 54 de 006), cada descarga tiene su propio `AbortController` y se cancela si la persona pulsa "Cerrar
 * sesión", si la sesión se pierde o cambia de identidad o si la página se desmonta; antes de entregar se comprueba otra vez. Una descarga
 * cancelada falla con `DescargaCanceladaError`, que no lleva mensaje. Una descarga a la vez.
 */
export function useDescargarPdfDelCarnet(alumnoId: string | null) {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  const vigilarLaSesion = useVigilanteDeLaSesion();
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
  const seEstaCerrandoLaSesion = useCallback(
    () => cliente.isMutating({ mutationKey: CLAVE_CERRAR_SESION }) > 0,
    [cliente],
  );
  const enCurso = useRef(false);
  const mutacion = useMutation({
    mutationFn: async ({ controlador, sigue, soltar }: DescargaPedida) => {
      const cancelada = () => {
        if (seEstaCerrandoLaSesion()) controlador.abort();
        return controlador.signal.aborted;
      };
      try {
        if (cancelada()) throw new DescargaCanceladaError();
        await confirmarSesion();
        if (cancelada()) throw new DescargaCanceladaError();
        const pdf = await api.obtenerPdfDelCarnet(alumnoId, controlador.signal);
        if (cancelada() || !sigue()) throw new DescargaCanceladaError();
        entregarArchivo(pdf, NOMBRE_DEL_PDF_DEL_CARNET);
      } catch (error) {
        if (controlador.signal.aborted || error instanceof DescargaCanceladaError) throw new DescargaCanceladaError();
        throw error;
      } finally {
        soltar();
        propias.current.delete(controlador);
        enCurso.current = false;
      }
    },
  });
  const { mutate } = mutacion;
  const descargar = useCallback(() => {
    if (seEstaCerrandoLaSesion()) return;
    if (enCurso.current) return;
    enCurso.current = true;
    const { sigue, vigilar } = vigilarLaSesion();
    const { controlador, terminar } = iniciarDescarga();
    const dejarDeVigilar = vigilar(() => controlador.abort());
    const soltar = () => {
      dejarDeVigilar();
      terminar();
    };
    propias.current.set(controlador, soltar);
    mutate({ controlador, sigue, soltar });
  }, [mutate, vigilarLaSesion, seEstaCerrandoLaSesion]);
  const cerrandoLaSesion = useIsMutating({ mutationKey: CLAVE_CERRAR_SESION }) > 0;
  return {
    descargar,
    cerrandoLaSesion,
    isPending: mutacion.isPending,
    isError: mutacion.isError,
    error: mutacion.error,
  };
}

interface DescargaPedida {
  controlador: AbortController;
  sigue: () => boolean;
  soltar: () => void;
}
