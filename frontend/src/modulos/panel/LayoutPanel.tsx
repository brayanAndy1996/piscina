import { type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { useUsuario } from '../sesion/contexto';
import { useCerrarSesionAcademia } from '../sesion/hooks';

/**
 * Marco de las páginas con sesión: el nombre de la academia y "Cerrar sesión" siempre a la mano. Cerrar sesión cierra la cuenta
 * en todos los dispositivos (DR-8) y lleva al ingreso de la misma academia.
 */
export function LayoutPanel({ children }: { children: ReactNode }) {
  const usuario = useUsuario();
  const navegar = useNavigate();
  const cerrar = useCerrarSesionAcademia();
  const rutaIngreso = `/a/${encodeURIComponent(usuario.academia.nombreCorto)}/ingresar`;

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white shadow-sm ring-1 ring-sky-100">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-sky-800">AquaGestión</p>
            <p className="break-words text-lg font-semibold text-slate-900">{usuario.academia.nombre}</p>
          </div>
          <button
            type="button"
            onClick={() => cerrar.mutate(undefined, { onSuccess: () => void navegar(rutaIngreso, { replace: true }) })}
            disabled={cerrar.isPending}
            className={ESTILO_BOTON.secundario}
          >
            {cerrar.isPending ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 pt-4">
        {cerrar.isError ? <Alerta>No se pudo cerrar la sesión. {mensajeGeneral(cerrar.error)}</Alerta> : null}
      </div>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
