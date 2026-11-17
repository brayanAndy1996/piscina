import type { ConfiguracionAcademia } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

const CLAVE_CONFIGURACION = ['configuracion'] as const;
const CLAVE_MI_ACADEMIA = ['mi-academia'] as const;

/** Si la clave es la de `useMiAcademia` de esa identidad de sesión (`id|nombreCorto`, como `claveDeIdentidad`). Al cambiar la
 * sesión se descarta todo lo pedido con la identidad anterior, pero no lo que ya pidió la cabecera con la nueva. */
export function esMiAcademiaDeIdentidad(clave: readonly unknown[], identidad: string): boolean {
  return clave[0] === CLAVE_MI_ACADEMIA[0] && `${String(clave[2])}|${String(clave[1])}` === identidad;
}

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
 * Con el cambio de contraseña pendiente la API responde 403, así que no se pide (`habilitada` en falso).
 * La clave lleva la identidad de la sesión: la respuesta de otra academia o de otra persona nunca se reutiliza (criterio 28). */
export function useMiAcademia(habilitada = true) {
  const usuario = useUsuario();
  return useQuery({
    enabled: habilitada,
    queryKey: [...CLAVE_MI_ACADEMIA, usuario.academia.nombreCorto, usuario.id],
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
    // Una petición de la configuración pedida antes del guardado trae valores viejos: no debe llegar a la caché (criterio 29).
    onMutate: () => cliente.cancelQueries({ queryKey: CLAVE_CONFIGURACION }),
    mutationFn: async (cambios: Parameters<typeof api.actualizarConfiguracion>[0]) => {
      await confirmarSesion();
      return api.actualizarConfiguracion(cambios);
    },
    onSuccess: async (configuracion) => {
      // También la que empezó mientras el PATCH estaba en curso (criterio 29).
      await cliente.cancelQueries({ queryKey: CLAVE_CONFIGURACION });
      alGuardar?.(configuracion);
      cliente.setQueryData(CLAVE_CONFIGURACION, configuracion);
      // La cabecera se actualiza en segundo plano: la mutación no espera esa petición, así el formulario se desbloquea
      // apenas responde el PATCH aunque `mi-academia` tarde o no responda (criterio 31).
      void cliente.invalidateQueries({ queryKey: CLAVE_MI_ACADEMIA }).catch(() => undefined);
    },
  });
}
