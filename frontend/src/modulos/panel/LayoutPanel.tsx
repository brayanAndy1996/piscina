import { type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { useMiAcademia } from '../configuracion/hooks';
import { useUsuario } from '../sesion/contexto';
import { useCerrarSesionAcademia } from '../sesion/hooks';

/**
 * Marco de las páginas con sesión: el nombre de la academia y "Cerrar sesión" siempre a la mano. Cerrar sesión cierra la cuenta
 * en todos los dispositivos (DR-8) y lleva al ingreso de la misma academia.
 */
export function LayoutPanel({
  children,
  aviso = null,
  alCerrarAviso,
}: {
  children: ReactNode;
  /** Un aviso para quien usa la página, por ejemplo que la sesión cambió en otra pestaña. */
  aviso?: string | null;
  alCerrarAviso?: () => void;
}) {
  const usuario = useUsuario();
  const miAcademia = useMiAcademia(!usuario.debeCambiarClave);
  const navegar = useNavigate();
  const cerrar = useCerrarSesionAcademia();
  // Solo se usa la respuesta de la academia de la sesión vigente. Mientras tarda, si falla o si la consulta está desactivada,
  // el panel funciona igual: con el nombre de la sesión y sin teléfono (criterios 24 y 28).
  const propia = miAcademia.data?.nombreCorto === usuario.academia.nombreCorto ? miAcademia.data : undefined;
  const nombre = propia?.nombre ?? usuario.academia.nombre;
  const telefono = propia?.telefono ?? null;
  const rutaIngreso = `/a/${encodeURIComponent(usuario.academia.nombreCorto)}/ingresar`;

  return (
    <div className="min-h-screen bg-sky-50 print:bg-white">
      <header className="bg-white shadow-sm ring-1 ring-sky-100 print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-sky-800">AquaGestión</p>
            <p className="break-words text-lg font-semibold text-slate-900">{nombre}</p>
            {telefono ? (
              <p className="break-words text-sm text-slate-700">
                Teléfono:{' '}
                <a href={`tel:${telefono.replace(/[^+\d]/g, '')}`} className="text-sky-800 underline">
                  {telefono}
                </a>
              </p>
            ) : null}
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
      <div className="mx-auto max-w-4xl px-4 pt-4 print:hidden">
        {aviso ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
          >
            <p className="min-w-0 break-words">{aviso}</p>
            {alCerrarAviso ? (
              <button type="button" onClick={alCerrarAviso} className={ESTILO_BOTON.secundario}>
                Entendido
              </button>
            ) : null}
          </div>
        ) : null}
        {cerrar.isError ? <Alerta>No se pudo cerrar la sesión. {mensajeGeneral(cerrar.error)}</Alerta> : null}
      </div>
      <main className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
