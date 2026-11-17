import { type Permiso, puede } from '@aquagestion/contratos';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ESTILO_BOTON } from '../../componentes/ui';
import { useUsuario } from './contexto';

/**
 * Muestra la página solo si el rol tiene el permiso en `MATRIZ_PERMISOS`. Es una ayuda de pantalla: aunque alguien llegue a la
 * dirección, la API responde 403 `SIN_PERMISO` a lo que su rol no permite.
 */
export function RequierePermiso({ permiso, children }: { permiso: Permiso; children: ReactNode }) {
  const usuario = useUsuario();
  if (puede(usuario.rol, permiso)) return <>{children}</>;
  return (
    <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-sky-100">
      <h1 className="text-2xl font-semibold text-slate-900">No tienes permiso para ver esta página</h1>
      <p className="mt-2 text-slate-700">Tu rol no incluye esta opción.</p>
      <Link to="/panel" className={`${ESTILO_BOTON.primario} mt-4`}>
        Volver al inicio
      </Link>
    </section>
  );
}
