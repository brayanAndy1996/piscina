import type { RegistrarAsistenciaPosterior } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatearHora } from '../../lib/fechas';
import { useUsuario } from '../sesion/contexto';
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

/** Las claves llevan la identidad de la sesión (009b, plan): la asistencia de un alumno de otra academia o de otra persona nunca se reutiliza. */
export function useClavesAsistenciaDelMes() {
  const usuario = useUsuario();
  const base = ['asistencia-mes', usuario.academia.nombreCorto, usuario.id] as const;
  return {
    de: (alumnoId: string) => [...base, alumnoId] as const,
    delMes: (alumnoId: string, mes: string) => [...base, alumnoId, mes] as const,
  };
}

/** La asistencia de un alumno en un mes (criterio 31). Se vuelve a pedir al entrar; no se reintenta (un 403 o un 404 no se arreglan pidiendo otra vez). */
export function useAsistenciaDelMes(alumnoId: string, mes: string) {
  const claves = useClavesAsistenciaDelMes();
  return useQuery({
    queryKey: claves.delMes(alumnoId, mes),
    queryFn: () => api.obtenerAsistenciaDelMes(alumnoId, mes),
    retry: false,
    refetchOnMount: 'always',
  });
}

/**
 * Registra una asistencia posterior (criterio 28). Antes confirma que la sesión sigue siendo la de la página. Reintentar con la misma
 * `claveIdempotencia` no descuenta otra clase (criterio 13). Al terminar, con éxito o no, vuelve a pedir la asistencia de ese alumno.
 */
export function useRegistrarAsistenciaPosterior() {
  const cliente = useQueryClient();
  const claves = useClavesAsistenciaDelMes();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: RegistrarAsistenciaPosterior) => {
      await confirmarSesion();
      return api.registrarAsistenciaPosterior(datos);
    },
    onSettled: (_resultado, _error, { alumnoId }) => cliente.invalidateQueries({ queryKey: claves.de(alumnoId) }),
  });
}
