import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from '../carnet/api';
import { useClavesCarnet } from '../carnet/hooks';

/**
 * Regenera el QR de un alumno (HU-13, criterio 13). Antes confirma que la sesión sigue siendo la de la página. Con el 200 deja el carnet nuevo
 * en la caché (el QR anterior ya no sirve y no debe verse), y de todos modos vuelve a pedirlo al terminar.
 */
export function useRegenerarQr() {
  const cliente = useQueryClient();
  const claves = useClavesCarnet();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (entrada: Parameters<typeof api.regenerarQr>[0]) => {
      await confirmarSesion();
      return api.regenerarQr(entrada);
    },
    onSuccess: (carnet, { alumnoId }) => {
      cliente.setQueryData(claves.de(alumnoId), carnet);
    },
    onSettled: (_datos, _error, { alumnoId }) => cliente.invalidateQueries({ queryKey: claves.de(alumnoId) }),
  });
}

/**
 * Busca alumnos por DNI o nombre (criterio 16). Es una consulta que viaja por `POST` para que el texto no vaya en la dirección; no escribe
 * nada, por eso no pasa por la caché de consultas: el DNI buscado no se guarda en ninguna parte. Un resultado de una búsqueda anterior que
 * llega tarde se descarta (la mutación solo atiende a la última).
 */
export function useBuscarAlumnos() {
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    gcTime: 0,
    mutationFn: async (datos: Parameters<typeof api.buscarAlumnos>[0]) => {
      await confirmarSesion();
      return api.buscarAlumnos(datos);
    },
  });
}
