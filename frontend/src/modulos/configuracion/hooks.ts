import type { ConfiguracionAcademia } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

const CLAVE_CONFIGURACION = ['configuracion'] as const;
const CLAVE_MI_ACADEMIA = ['mi-academia'] as const;

/** La configuración efectiva de la academia. Solo la pide el administrador. No se reintenta ni se vuelve a pedir al enfocar.
 * Siempre se vuelve a pedir al entrar a la página, aunque haya caché: el formulario no se muestra con valores viejos (criterio 27). */
export function useConfiguracion() {
  return useQuery({
    queryKey: CLAVE_CONFIGURACION,
    queryFn: api.obtenerConfiguracion,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** Nombre y teléfono de la academia de la sesión (D-22). Si falla, el panel funciona igual, sin teléfono (criterio 24).
 * Con el cambio de contraseña pendiente la API responde 403, así que no se pide (`habilitada` en falso). */
export function useMiAcademia(habilitada = true) {
  return useQuery({
    enabled: habilitada,
    queryKey: CLAVE_MI_ACADEMIA,
    queryFn: api.obtenerMiAcademia,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Guarda solo lo que cambió. Antes confirma que la sesión sigue siendo la de la página (criterio 59 b de 002).
 * `alGuardar` recibe la respuesta antes de que se actualice la caché: así el formulario fija su base de llenado primero (criterio 27 e). */
export function useActualizarConfiguracion(alGuardar?: (configuracion: ConfiguracionAcademia) => void) {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (cambios: Parameters<typeof api.actualizarConfiguracion>[0]) => {
      await confirmarSesion();
      return api.actualizarConfiguracion(cambios);
    },
    onSuccess: (configuracion) => {
      alGuardar?.(configuracion);
      cliente.setQueryData(CLAVE_CONFIGURACION, configuracion);
      return cliente.invalidateQueries({ queryKey: CLAVE_MI_ACADEMIA });
    },
  });
}
