import type { UsuarioResumen } from '@aquagestion/contratos';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaHora } from '../../lib/fechas';
import { useUsuario } from '../sesion/contexto';
import { ETIQUETA_ROL } from '../sesion/etiquetas';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { type AccionUsuario, DialogoAccionUsuario, nombreCompleto } from './DialogoAccionUsuario';
import { FormularioNuevoUsuario } from './FormularioNuevoUsuario';
import { useUsuarios } from './hooks';

type Dialogo = { tipo: 'nuevo' } | { tipo: 'accion'; accion: AccionUsuario; usuario: UsuarioResumen };

/** `/panel/usuarios`: el personal de la academia (administrador, criterio 49). */
export function PaginaUsuarios() {
  return (
    <RequierePermiso permiso="GESTIONAR_USUARIOS">
      <ContenidoUsuarios />
    </RequierePermiso>
  );
}

function ContenidoUsuarios() {
  const yo = useUsuario();
  const usuarios = useUsuarios();
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  useAlPerderSesion(usuarios.error);

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Usuarios</h1>
        <button type="button" onClick={() => setDialogo({ tipo: 'nuevo' })} className={ESTILO_BOTON.primario}>
          Nuevo usuario
        </button>
      </div>

      <ListaUsuarios
        consulta={usuarios}
        miId={yo.id}
        alElegir={(accion, usuario) => setDialogo({ tipo: 'accion', accion, usuario })}
      />

      {dialogo?.tipo === 'nuevo' ? <FormularioNuevoUsuario alCerrar={() => setDialogo(null)} /> : null}
      {dialogo?.tipo === 'accion' ? (
        <DialogoAccionUsuario accion={dialogo.accion} usuario={dialogo.usuario} alCerrar={() => setDialogo(null)} />
      ) : null}
    </div>
  );
}

interface PropiedadesLista {
  consulta: ReturnType<typeof useUsuarios>;
  miId: string;
  alElegir: (accion: AccionUsuario, usuario: UsuarioResumen) => void;
}

function ListaUsuarios({ consulta, miId, alElegir }: PropiedadesLista) {
  if (consulta.isPending) {
    return (
      <p role="status" className="text-slate-600">
        Cargando usuarios…
      </p>
    );
  }
  if (consulta.isError) {
    return (
      <div className="space-y-3">
        <Alerta>No se pudieron cargar los usuarios. {mensajeGeneral(consulta.error)}</Alerta>
        <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
          Reintentar
        </button>
      </div>
    );
  }
  if (consulta.data.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
        Todavía no hay personal registrado. Crea el primero con «Nuevo usuario».
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {consulta.data.map((usuario) => (
        <li key={usuario.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
          <FilaUsuario usuario={usuario} esYo={usuario.id === miId} alElegir={alElegir} />
        </li>
      ))}
    </ul>
  );
}

interface PropiedadesFila {
  usuario: UsuarioResumen;
  esYo: boolean;
  alElegir: (accion: AccionUsuario, usuario: UsuarioResumen) => void;
}

function FilaUsuario({ usuario, esYo, alElegir }: PropiedadesFila) {
  const inactivo = usuario.estado === 'INACTIVO';
  const nombre = nombreCompleto(usuario);
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900">
            {usuario.apellidos}, {usuario.nombres}
          </h2>
          {esYo ? <Insignia color="azul">Tú</Insignia> : null}
          <Insignia color={inactivo ? 'gris' : 'verde'}>{inactivo ? 'Inactivo' : 'Activo'}</Insignia>
          {usuario.bloqueado ? <Insignia color="ambar">Bloqueado</Insignia> : null}
        </div>
        <p className="mt-1 text-sm text-slate-700">
          DNI <span className="font-mono">{usuario.dni}</span>
          <span aria-hidden="true"> · </span>
          {ETIQUETA_ROL[usuario.rol]}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {usuario.ultimoAcceso ? `Último acceso: ${formatearFechaHora(usuario.ultimoAcceso)}` : 'Aún no ha ingresado'}
          {usuario.debeCambiarClave ? ' · Pendiente de cambiar su contraseña' : ''}
        </p>
      </div>
      {esYo ? null : (
        <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
          <button
            type="button"
            onClick={() => alElegir('restablecer', usuario)}
            aria-label={`Restablecer contraseña de ${nombre}`}
            className={ESTILO_BOTON.secundario}
          >
            Restablecer contraseña
          </button>
          {inactivo ? (
            <button
              type="button"
              onClick={() => alElegir('reactivar', usuario)}
              aria-label={`Reactivar a ${nombre}`}
              className={ESTILO_BOTON.primario}
            >
              Reactivar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => alElegir('desactivar', usuario)}
              aria-label={`Desactivar a ${nombre}`}
              className={ESTILO_BOTON.secundario}
            >
              Desactivar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
