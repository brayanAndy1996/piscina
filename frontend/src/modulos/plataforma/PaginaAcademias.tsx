import type { AcademiaResumen } from '@aquagestion/contratos';
import { useState } from 'react';
import { DialogoReactivar, DialogoSuspender } from './DialogosAcademia';
import { FormularioNuevaAcademia } from './FormularioNuevaAcademia';
import { formatearFecha } from './fechas';
import {
  RUTA_INGRESAR,
  useAcademias,
  useCerrarSesion,
  useRedirigirSiNoAutenticado,
  useSesionPlataforma,
} from './hooks';
import { mensajeGeneral } from './mensajes';
import { Alerta, ESTILO_BOTON } from './ui';
import { useNavigate } from 'react-router';

type Accion =
  | { tipo: 'nueva' }
  | { tipo: 'suspender'; academia: AcademiaResumen }
  | { tipo: 'reactivar'; academia: AcademiaResumen };

/** `/plataforma/academias`: las academias de la plataforma y sus acciones (crear, suspender, reactivar). */
export function PaginaAcademias() {
  const navegar = useNavigate();
  const sesion = useSesionPlataforma();
  const academias = useAcademias();
  const cerrar = useCerrarSesion();
  const [accion, setAccion] = useState<Accion | null>(null);
  useRedirigirSiNoAutenticado(sesion.error, academias.error, cerrar.error);

  function cerrarSesion() {
    cerrar.mutate(undefined, { onSuccess: () => void navegar(RUTA_INGRESAR, { replace: true }) });
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white shadow-sm ring-1 ring-sky-100">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-sky-900">AquaGestión · Plataforma</p>
            {sesion.data ? <p className="truncate text-sm text-slate-600">{sesion.data.superadmin.correo}</p> : null}
          </div>
          <button type="button" onClick={cerrarSesion} disabled={cerrar.isPending} className={ESTILO_BOTON.secundario}>
            {cerrar.isPending ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Academias</h1>
          <button type="button" onClick={() => setAccion({ tipo: 'nueva' })} className={ESTILO_BOTON.primario}>
            Nueva academia
          </button>
        </div>

        {cerrar.isError ? (
          <div className="mt-4">
            <Alerta>No se pudo cerrar la sesión. {mensajeGeneral(cerrar.error)}</Alerta>
          </div>
        ) : null}

        <div className="mt-4">
          <ListaAcademias
            consulta={academias}
            alSuspender={(academia) => setAccion({ tipo: 'suspender', academia })}
            alReactivar={(academia) => setAccion({ tipo: 'reactivar', academia })}
          />
        </div>
      </main>

      {accion?.tipo === 'nueva' ? <FormularioNuevaAcademia alCerrar={() => setAccion(null)} /> : null}
      {accion?.tipo === 'suspender' ? (
        <DialogoSuspender academia={accion.academia} alCerrar={() => setAccion(null)} />
      ) : null}
      {accion?.tipo === 'reactivar' ? (
        <DialogoReactivar academia={accion.academia} alCerrar={() => setAccion(null)} />
      ) : null}
    </div>
  );
}

interface PropiedadesLista {
  consulta: ReturnType<typeof useAcademias>;
  alSuspender: (academia: AcademiaResumen) => void;
  alReactivar: (academia: AcademiaResumen) => void;
}

function ListaAcademias({ consulta, alSuspender, alReactivar }: PropiedadesLista) {
  if (consulta.isPending) {
    return (
      <p role="status" className="text-slate-600">
        Cargando academias…
      </p>
    );
  }
  if (consulta.isError) {
    return (
      <div className="space-y-3">
        <Alerta>No se pudieron cargar las academias. {mensajeGeneral(consulta.error)}</Alerta>
        <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
          Reintentar
        </button>
      </div>
    );
  }
  if (consulta.data.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
        Todavía no hay academias. Crea la primera con «Nueva academia».
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {consulta.data.map((academia) => (
        <li key={academia.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
          <FilaAcademia academia={academia} alSuspender={alSuspender} alReactivar={alReactivar} />
        </li>
      ))}
    </ul>
  );
}

interface PropiedadesFila {
  academia: AcademiaResumen;
  alSuspender: (academia: AcademiaResumen) => void;
  alReactivar: (academia: AcademiaResumen) => void;
}

function FilaAcademia({ academia, alSuspender, alReactivar }: PropiedadesFila) {
  const suspendida = academia.estado === 'SUSPENDIDA';
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900">{academia.nombre}</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${
              suspendida ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
            }`}
          >
            {suspendida ? 'Suspendida' : 'Activa'}
          </span>
        </div>
        <p className="mt-1 break-all text-sm text-slate-700">
          <span className="font-mono">{academia.nombreCorto}</span>
          <span aria-hidden="true"> · </span>
          <span>Creada el {formatearFecha(academia.creadaEn)}</span>
        </p>
        {suspendida ? (
          <p className="mt-1 break-words text-sm text-amber-900">
            {academia.suspendidaEn ? `Suspendida el ${formatearFecha(academia.suspendidaEn)}. ` : null}
            {academia.motivoSuspension ? `Motivo: ${academia.motivoSuspension}` : null}
          </p>
        ) : null}
      </div>
      {suspendida ? (
        <button
          type="button"
          onClick={() => alReactivar(academia)}
          aria-label={`Reactivar ${academia.nombre}`}
          className={`${ESTILO_BOTON.primario} shrink-0`}
        >
          Reactivar
        </button>
      ) : (
        <button
          type="button"
          onClick={() => alSuspender(academia)}
          aria-label={`Suspender ${academia.nombre}`}
          className={`${ESTILO_BOTON.secundario} shrink-0`}
        >
          Suspender
        </button>
      )}
    </div>
  );
}
