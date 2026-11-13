import { Navigate, Outlet, useLocation } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { LayoutPanel } from '../panel/LayoutPanel';
import { ContextoUsuario } from './contexto';
import { useSesionAcademia } from './hooks';
import { MensajeDePagina } from './MensajeDePagina';

export const RUTA_CAMBIAR_CLAVE = '/cambiar-clave';

/**
 * Envuelve las páginas que piden sesión: consulta `GET /api/sesion` y decide qué mostrar (401: pide entrar por el enlace de la
 * academia; 403 `ACADEMIA_SUSPENDIDA`: academia no disponible). Con el cambio de contraseña obligatorio no deja ir a otra página
 * que no sea `/cambiar-clave`. Solo muestra; quien decide qué se puede hacer es siempre la API.
 */
export function RutaConSesion() {
  const sesion = useSesionAcademia();
  const ubicacion = useLocation();

  if (sesion.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
        <p role="status" className="text-slate-700">
          Cargando…
        </p>
      </main>
    );
  }

  if (sesion.isError) {
    if (esErrorDeApi(sesion.error, 401)) {
      return (
        <MensajeDePagina titulo="Entra por el enlace de tu academia">
          <p>
            Tu sesión no está abierta o venció. Abre el enlace de ingreso que te dio tu academia (termina en
            «/ingresar») para entrar con tu DNI.
          </p>
        </MensajeDePagina>
      );
    }
    if (esErrorDeApi(sesion.error, 403, 'ACADEMIA_SUSPENDIDA')) {
      return (
        <MensajeDePagina titulo="Academia no disponible por el momento">
          <p>Intenta de nuevo más tarde o consulta en recepción.</p>
        </MensajeDePagina>
      );
    }
    return (
      <MensajeDePagina titulo="No pudimos abrir tu sesión">
        <p>{mensajeGeneral(sesion.error)}</p>
        <button type="button" onClick={() => void sesion.refetch()} className={`${ESTILO_BOTON.secundario} mt-4`}>
          Reintentar
        </button>
      </MensajeDePagina>
    );
  }

  const { usuario } = sesion.data;
  if (usuario.debeCambiarClave && ubicacion.pathname !== RUTA_CAMBIAR_CLAVE) {
    return <Navigate to={RUTA_CAMBIAR_CLAVE} replace />;
  }

  return (
    <ContextoUsuario value={usuario}>
      <LayoutPanel>
        <Outlet />
      </LayoutPanel>
    </ContextoUsuario>
  );
}
