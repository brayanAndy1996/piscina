import { useQuery } from '@tanstack/react-query';
import { useUsuario } from '../sesion/contexto';
import * as api from './api';

/** Las claves llevan la identidad de la sesión: lo de otra persona o de otra academia nunca se reutiliza (spec 011, criterio 18). */
export function useClavesMiPanel() {
  const usuario = useUsuario();
  const base = ['mi-panel', usuario.academia.nombreCorto, usuario.id] as const;
  return {
    resumen: [...base, 'resumen'] as const,
    asistencia: (mes: string) => [...base, 'asistencia', mes] as const,
  };
}

/** El resumen del panel. Siempre se vuelve a pedir al entrar; no se reintenta (un 404 no se arregla pidiendo otra vez). */
export function useMiPanel() {
  const claves = useClavesMiPanel();
  return useQuery({
    queryKey: claves.resumen,
    queryFn: api.obtenerMiPanel,
    retry: false,
    refetchOnMount: 'always',
  });
}

/** La asistencia de un mes de la propia persona. El mes lo eligió ella de la lista que dio la API (no del reloj del navegador, DT-7). */
export function useMiAsistencia(mes: string) {
  const claves = useClavesMiPanel();
  return useQuery({
    queryKey: claves.asistencia(mes),
    queryFn: () => api.obtenerMiAsistencia(mes),
    retry: false,
    refetchOnMount: 'always',
  });
}
