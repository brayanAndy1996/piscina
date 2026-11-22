import type { RespuestaSesionAcademia, UsuarioSesion } from '@aquagestion/contratos';
import { matchQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { cancelarDescargasEnCurso } from '../../lib/descargas-en-curso';
import { useIdDeVisita } from '../../lib/visita';
import * as api from './api';
import { useUsuario } from './contexto';

export const CLAVE_SESION = ['sesion'] as const;
const CLAVE_ACADEMIA_PUBLICA = 'academia-publica';

export const RUTA_CAMBIAR_CLAVE = '/cambiar-clave';

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
 * La sesión sigue siendo de la misma persona, pero ahora debe cambiar su contraseña (por ejemplo, otra persona la restableció):
 * la acción no se envió. `RutaConSesion` lleva a `/cambiar-clave`; no es el aviso de "Tu sesión cambió".
 */
export class CambioDeClavePendienteError extends Error {
  constructor() {
    super('Debes cambiar tu contraseña antes de seguir. No se envió la acción.');
    this.name = 'CambioDeClavePendienteError';
  }
}

/**
 * La acción no se envió porque la sesión cambió (otra persona o academia, o cambio de contraseña pendiente). `RutaConSesion`
 * ya lleva a la página que corresponde: los formularios no muestran ningún mensaje de error por esto.
 */
export function esErrorDeCambioDeSesion(error: unknown): boolean {
  return error instanceof SesionCambiadaError || error instanceof CambioDeClavePendienteError;
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
 * Criterio 54 de 006: lo que la web sabe de la sesión, para una acción larga (como preparar un PDF) que no debe entregar nada si, mientras
 * tanto, la sesión se perdió o es de otra persona o academia. `sigue()` lo dice con lo que hay ahora en la memoria de la página;
 * `vigilar(alPerder)` avisa en cuanto la sesión de la memoria deja de ser la de la página, y devuelve cómo dejar de vigilar. Las dos usan
 * la identidad de la página en el momento de llamar a `iniciar()`. Solo se usa dentro de `RutaConSesion`.
 */
export function useVigilanteDeLaSesion(): () => {
  sigue: () => boolean;
  vigilar: (alPerder: () => void) => () => void;
} {
  const cliente = useQueryClient();
  const mostrada = useUsuario();
  return useCallback(() => {
    const identidadDeLaPagina = claveDeIdentidad(mostrada);
    const sigue = () => {
      const estado = cliente.getQueryState<RespuestaSesionAcademia>(CLAVE_SESION);
      if (esErrorDeSesion(estado?.error)) return false;
      const usuario = estado?.data?.usuario;
      return usuario !== undefined && claveDeIdentidad(usuario) === identidadDeLaPagina;
    };
    const vigilar = (alPerder: () => void) =>
      cliente.getQueryCache().subscribe((evento) => {
        if (matchQuery({ queryKey: CLAVE_SESION }, evento.query) && !sigue()) alPerder();
      });
    return { sigue, vigilar };
  }, [cliente, mostrada]);
}

export interface OpcionesConfirmarSesion {
  /** Solo para la propia acción de cambiar la contraseña desde `/cambiar-clave`. */
  permitirCambioPendiente?: boolean;
}

/**
 * Criterio 59 b) y 61: antes de una acción que escribe o manda datos personales, vuelve a pedir la sesión. Si sigue siendo la
 * misma persona y academia, deja seguir; si no, lanza `SesionCambiadaError` (y `RutaConSesion` lleva a `/panel` con la identidad
 * nueva); si es la misma persona pero ahora debe cambiar su contraseña, lanza `CambioDeClavePendienteError` (y `RutaConSesion`
 * lleva a `/cambiar-clave`), salvo con `permitirCambioPendiente`; si ya no vale (401, academia suspendida), lanza ese error y
 * `RutaConSesion` muestra la página que corresponde. Solo se usa dentro de `RutaConSesion`. "Cerrar sesión" no la llama:
 * siempre cierra.
 */
export function useConfirmarSesion(opciones: OpcionesConfirmarSesion = {}): () => Promise<void> {
  const cliente = useQueryClient();
  const mostrada = useUsuario();
  const { permitirCambioPendiente = false } = opciones;
  return useCallback(async () => {
    const actual = await pedirLaSesion(cliente);
    if (claveDeIdentidad(actual.usuario) !== claveDeIdentidad(mostrada)) throw new SesionCambiadaError();
    if (actual.usuario.debeCambiarClave && !permitirCambioPendiente) throw new CambioDeClavePendienteError();
  }, [cliente, mostrada, permitirCambioPendiente]);
}

/**
 * Lo público de una academia (nombre y teléfono). No se guarda entre visitas: la clave lleva el identificador de la visita, así que cada
 * vez que se abre una página pública se pide de nuevo y al salir de ella la respuesta se descarta (criterio 45 de 005, DR-4 de 003): un
 * teléfono que la academia cambió se ve enseguida.
 */
export function useAcademiaPublica(nombreCorto: string) {
  const visita = useIdDeVisita();
  return useQuery({
    queryKey: [CLAVE_ACADEMIA_PUBLICA, nombreCorto, visita],
    queryFn: () => api.obtenerAcademiaPublica(nombreCorto),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
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
    mutationFn: () => {
      // Criterio 54 de 006: una descarga en camino no debe llegar a la persona siguiente; se cancela al pulsar, aunque `DELETE` tarde o falle.
      cancelarDescargasEnCurso();
      return api.cerrarSesion();
    },
    onSuccess: () => {
      cliente.clear();
    },
  });
}

export function useCambiarClave() {
  const cliente = useQueryClient();
  const confirmarSesion = useConfirmarSesion({ permitirCambioPendiente: true });
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
