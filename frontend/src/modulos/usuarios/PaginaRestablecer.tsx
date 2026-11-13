import type { UsuarioResumen } from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { useUsuario } from '../sesion/contexto';
import { ETIQUETA_ROL } from '../sesion/etiquetas';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { DialogoAccionUsuario, nombreCompleto } from './DialogoAccionUsuario';
import { useBuscarUsuarioPorDni } from './hooks';

interface Campos {
  dni: string;
}

/**
 * `/panel/restablecer`: la secretaria (solo alumnos) o el administrador buscan a una persona por su DNI y le devuelven la
 * contraseña inicial, que es su DNI (HU-05, criterios 34 y 35). El DNI viaja en el cuerpo de un `POST`: no va en la dirección de
 * la API ni de la página (criterio 43).
 */
export function PaginaRestablecer() {
  return (
    <RequierePermiso permiso="RESTABLECER_CLAVE">
      <ContenidoRestablecer />
    </RequierePermiso>
  );
}

function ContenidoRestablecer() {
  const yo = useUsuario();
  const buscar = useBuscarUsuarioPorDni();
  const [confirmando, setConfirmando] = useState(false);
  const [restablecido, setRestablecido] = useState<UsuarioResumen | null>(null);
  const { register, handleSubmit, reset, setFocus, formState } = useForm<Campos>({ defaultValues: { dni: '' } });
  useAlPerderSesion(buscar.error);

  const enviar = handleSubmit(({ dni }) => {
    setRestablecido(null);
    buscar.mutate({ dni });
  });

  const encontrado = buscar.isSuccess ? buscar.data : null;
  const noEncontrado = esErrorDeApi(buscar.error, 404);
  const errorGeneral = buscar.isError && !noEncontrado && !esErrorDeApi(buscar.error, 401);

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Restablecer contraseña</h1>
      <p className="text-slate-700">
        Busca a la persona por su DNI. Al restablecer, su contraseña vuelve a ser su DNI y el sistema le pedirá
        cambiarla al entrar.
      </p>

      <form
        onSubmit={(evento) => void enviar(evento)}
        noValidate
        className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100"
      >
        <CampoTexto
          etiqueta="DNI de la persona"
          inputMode="numeric"
          autoComplete="off"
          error={formState.errors.dni?.message}
          {...register('dni', {
            required: 'Escribe el DNI.',
            onChange: () => {
              buscar.reset();
              setRestablecido(null);
            },
          })}
        />
        <button type="submit" disabled={buscar.isPending} className={`${ESTILO_BOTON.primario} w-full sm:w-auto`}>
          {buscar.isPending ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {noEncontrado ? (
        <Alerta>
          No encontramos una cuenta con ese DNI que puedas restablecer. Revisa el número
          {yo.rol === 'SECRETARIA' ? ' (la secretaria solo restablece contraseñas de alumnos).' : '.'}
        </Alerta>
      ) : null}
      {errorGeneral ? <Alerta>{mensajeGeneral(buscar.error)}</Alerta> : null}

      {restablecido ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          Listo. La contraseña de {nombreCompleto(restablecido)} ahora es su DNI y tendrá que cambiarla al entrar.
        </p>
      ) : null}

      {encontrado ? (
        <section aria-label="Persona encontrada" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900">
              {encontrado.apellidos}, {encontrado.nombres}
            </h2>
            <Insignia color={encontrado.estado === 'INACTIVO' ? 'gris' : 'verde'}>
              {encontrado.estado === 'INACTIVO' ? 'Inactivo' : 'Activo'}
            </Insignia>
            {encontrado.bloqueado ? <Insignia color="ambar">Bloqueado</Insignia> : null}
          </div>
          <p className="mt-1 text-sm text-slate-700">
            DNI <span className="font-mono">{encontrado.dni}</span>
            <span aria-hidden="true"> · </span>
            {ETIQUETA_ROL[encontrado.rol]}
          </p>
          {encontrado.id === yo.id ? (
            <p className="mt-3 text-slate-700">
              Esta es tu propia cuenta. Para cambiar tu contraseña usa «Cambiar contraseña» en el inicio.
            </p>
          ) : (
            <div className="mt-3">
              <button type="button" onClick={() => setConfirmando(true)} className={ESTILO_BOTON.primario}>
                Restablecer contraseña
              </button>
            </div>
          )}
        </section>
      ) : null}

      {confirmando && encontrado ? (
        <DialogoAccionUsuario
          accion="restablecer"
          usuario={encontrado}
          alCerrar={() => setConfirmando(false)}
          alExito={(usuario) => {
            setRestablecido(usuario);
            buscar.reset();
            reset({ dni: '' });
            setFocus('dni');
          }}
        />
      ) : null}
    </div>
  );
}
