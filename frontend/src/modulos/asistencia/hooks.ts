import { useMutation } from '@tanstack/react-query';
import { formatearHora } from '../../lib/fechas';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';
import type { IntentoDeMarcado, SalidaDeMarcado } from './api';

/** Lo que muestra la pantalla: la salida de la API y la hora de Lima del equipo en que llegó (solo para redactar «antes» o «después» de la clase). */
export type RespuestaDeMarcado = SalidaDeMarcado & { horaLocal: string };

/**
 * Marca una asistencia por QR o de forma manual (criterios 2 y 5). Antes confirma que la sesión sigue siendo la de la página. No guarda nada en
 * la caché de consultas (`gcTime: 0`): lo leído del QR y la foto del alumno no deben quedar en la memoria de la página más de lo que se ve.
 * Reintentar con el mismo intento usa la misma `claveIdempotencia`, así que no descuenta otra clase (criterio 13).
 */
export function useMarcarAsistencia() {
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    gcTime: 0,
    mutationFn: async (intento: IntentoDeMarcado): Promise<RespuestaDeMarcado> => {
      await confirmarSesion();
      const salida =
        intento.via === 'QR'
          ? await api.marcarPorQr({ contenido: intento.contenido, claveIdempotencia: intento.claveIdempotencia })
          : await api.marcarManual({ alumnoId: intento.alumnoId, claveIdempotencia: intento.claveIdempotencia });
      return { ...salida, horaLocal: formatearHora(new Date().toISOString()) };
    },
  });
}
