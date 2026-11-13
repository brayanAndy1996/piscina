import type { RespuestaSesionAcademia, UsuarioSesion } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import * as api from './api';
import { useUsuario } from './contexto';

export const CLAVE_SESION = ['sesion'] as const;
const CLAVE_ACADEMIA_PUBLICA = 'academia-publica';

/** Lo que muestra la web de una academia suspendida (DR-4 de 001). */
export const MENSAJE_ACADEMIA_SUSPENDIDA = 'Academia no disponible por el momento.';

/**
 * Sesión de la academia: un 401 es una respuesta esperada (no hay sesión), no hay que reintentar. Que la vuelva a pedir al
 * recuperar el foco lo hace `useVolverAPedirLaSesionAlRecuperarElFoco`: TanStack Query solo escucha `visibilitychange`.
 */
export function useSesionAcademia() {
  return useQuery({ queryKey: CLAVE_SESION, queryFn: api.obtenerSesion, retry: false, refetchOnWindowFocus: false });
}

/** La identidad de una sesión: la persona y la academia. Si cambia alguna, la página ya no es de quien la abrió. */
export function claveDeIdentidad(usuario: UsuarioSesion): string {
  return `${usuario.id}|${usuario.academia.nombreCorto}`;
}

/** Vuelve a pedir `GET /api/sesion` ahora, sin duplicar una petición que ya va en camino. Actualiza la caché. */
function pedirLaSesion(cliente: ReturnType<typeof useQueryClient>) {
  return cliente.fetchQuery({ queryKey: CLAVE_SESION, queryFn: api.obtenerSesion, staleTime: 0 });
}

/**
 * Criterio 59 a): la cookie de sesión es una por navegador y otra pestaña puede haberla cambiado. Al recuperar el foco la
 * ventana (`focus`) o volver a verse la pestaña (`visibilitychange`), vuelve a pedir la sesión. Un fallo (401, sin red) queda
 * en la consulta y lo muestra `RutaConSesion`.
 */
export function useVolverAPedirLaSesionAlRecuperarElFoco(): void {
  const cliente = useQueryClient();
  useEffect(() => {
    const pedir = () => void pedirLaSesion(cliente).catch(() => undefined);
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') pedir();
    };
    window.addEventListener('focus', pedir);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      window.removeEventListener('focus', pedir);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [cliente]);
}

/** La sesión que la página muestra ya no es la del navegador: la acción no se envió. */
export class SesionCambiadaError extends Error {
  constructor() {
    super('La sesión cambió en otra pestaña. No se envió la acción.');
    this.name = 'SesionCambiadaError';
  }
}

/**
 * Criterio 59 b): antes de una acción que escribe o manda datos personales, vuelve a pedir la sesión. Si sigue siendo la misma
 * persona y academia, deja seguir; si no, lanza `SesionCambiadaError` (y `RutaConSesion` lleva a `/panel` con la identidad
 * nueva); si ya no vale (401, academia suspendida), lanza ese error y `RutaConSesion` muestra la página que corresponde. Solo
 * se usa dentro de `RutaConSesion`. "Cerrar sesión" no la llama: siempre cierra.
 */
export function useConfirmarSesion(): () => Promise<void> {
  const cliente = useQueryClient();
  const mostrada = useUsuario();
  return useCallback(async () => {
    const actual = await pedirLaSesion(cliente);
    if (claveDeIdentidad(actual.usuario) !== claveDeIdentidad(mostrada)) throw new SesionCambiadaError();
  }, [cliente, mostrada]);
}

export function useAcademiaPublica(nombreCorto: string) {
  return useQuery({
    queryKey: [CLAVE_ACADEMIA_PUBLICA, nombreCorto],
    queryFn: () => api.obtenerAcademiaPublica(nombreCorto),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Ingreso. La sesión se guarda solo en la memoria de TanStack Query (nunca en `localStorage` ni `sessionStorage`); la cookie
 * httpOnly la pone la API.
 */
export function useIniciarSesionAcademia(nombreCorto: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: Parameters<typeof api.iniciarSesion>[1]) => api.iniciarSesion(nombreCorto, datos),
    onSuccess: (datos) => {
      cliente.setQueryData(CLAVE_SESION, datos);
    },
  });
}

/** Cierra la sesión (en todos los dispositivos de la cuenta) y vacía lo que había en la memoria de la página. */
export function useCerrarSesionAcademia() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: api.cerrarSesion,
    onSuccess: () => {
      cliente.clear();
    },
  });
}

export function useCambiarClave() {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    mutationFn: async (datos: Parameters<typeof api.cambiarClave>[0]) => {
      await confirmarSesion();
      return api.cambiarClave(datos);
    },
    onSuccess: (datos: RespuestaSesionAcademia) => {
      cliente.setQueryData(CLAVE_SESION, datos);
    },
  });
}

/** Una respuesta que significa "la sesión ya no vale": 401, academia suspendida o cambio de contraseña pendiente. */
function esErrorDeSesion(error: unknown): boolean {
  return (
    esErrorDeApi(error, 401) ||
    esErrorDeApi(error, 403, 'ACADEMIA_SUSPENDIDA') ||
    esErrorDeApi(error, 403, 'CAMBIO_DE_CLAVE_OBLIGATORIO')
  );
}

/**
 * Si alguna llamada de una página interna responde que la sesión ya no vale, vuelve a pedir la sesión: `RutaConSesion` muestra
 * entonces la página que corresponde (sin sesión, academia no disponible o cambio de contraseña).
 */
export function useAlPerderSesion(...errores: unknown[]): void {
  const cliente = useQueryClient();
  const perdida = errores.some(esErrorDeSesion);
  useEffect(() => {
    if (perdida) void cliente.invalidateQueries({ queryKey: CLAVE_SESION });
  }, [perdida, cliente]);
}
