import { cambiarClaveSchema } from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { useUsuario } from './contexto';
import { esErrorDeCambioDeSesion, useAlPerderSesion, useCambiarClave } from './hooks';
import { MENSAJE_BLOQUEO } from './mensajes';

// La confirmación solo existe en la pantalla: a la API viaja `{ claveActual, claveNueva }`.
const formularioSchema = cambiarClaveSchema
  .extend({ confirmacion: z.string().min(1, 'Escribe de nuevo la contraseña nueva.') })
  .superRefine((datos, contexto) => {
    if (datos.claveNueva !== datos.confirmacion) {
      contexto.addIssue({ code: 'custom', path: ['confirmacion'], message: 'Las contraseñas no coinciden.' });
    }
    if (datos.claveNueva !== '' && datos.claveNueva === datos.claveActual) {
      contexto.addIssue({
        code: 'custom',
        path: ['claveNueva'],
        message: 'La contraseña nueva debe ser distinta de la actual.',
      });
    }
  });

type Campos = z.input<typeof formularioSchema>;

/**
 * `/cambiar-clave`: cambio de la contraseña propia (HU-05, D-14: también el alumno y el apoderado). Con el cambio obligatorio
 * del primer ingreso (RN-02, RNF-04) no hay a dónde ir hasta terminar, salvo cerrar sesión.
 */
export function PaginaCambiarClave() {
  const usuario = useUsuario();
  const navegar = useNavigate();
  const cambiar = useCambiarClave();
  const { register, handleSubmit, setError, formState } = useForm<Campos>({
    resolver: zodResolver(formularioSchema),
    defaultValues: { claveActual: '', claveNueva: '', confirmacion: '' },
  });
  useAlPerderSesion(cambiar.error);
  const obligatorio = usuario.debeCambiarClave;

  const enviar = handleSubmit(({ claveActual, claveNueva }) => {
    cambiar.mutate(
      { claveActual, claveNueva },
      {
        onSuccess: () => void navegar('/panel', { replace: true }),
        onError: (error) => {
          if (esErrorDeApi(error, 400, 'CLAVE_ACTUAL_INCORRECTA')) {
            setError('claveActual', { message: 'La contraseña actual no es correcta.' });
            return;
          }
          for (const { campo, mensaje } of erroresPorCampo(error)) {
            if (campo === 'claveActual' || campo === 'claveNueva') setError(campo, { message: mensaje });
          }
        },
      },
    );
  });

  const errorGeneral =
    cambiar.isError &&
    !esErrorDeApi(cambiar.error, 401) &&
    !esErrorDeCambioDeSesion(cambiar.error) &&
    !esErrorDeApi(cambiar.error, 423) &&
    !esErrorDeApi(cambiar.error, 400, 'CLAVE_ACTUAL_INCORRECTA') &&
    erroresPorCampo(cambiar.error).length === 0;

  return (
    <section className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-100 sm:p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Cambiar contraseña</h1>
      {obligatorio ? (
        <p className="mt-2 text-slate-700">
          Es tu primer ingreso o tu contraseña fue restablecida. Para seguir, elige una contraseña nueva. Tu contraseña
          actual es tu DNI.
        </p>
      ) : (
        <p className="mt-2 text-slate-700">Elige una contraseña nueva para tu cuenta.</p>
      )}
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-6 space-y-4">
        <CampoTexto
          etiqueta="Contraseña actual"
          type="password"
          autoComplete="current-password"
          error={formState.errors.claveActual?.message}
          {...register('claveActual')}
        />
        <CampoTexto
          etiqueta="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          ayuda="Mínimo 8 caracteres. No puede ser tu DNI ni la contraseña actual."
          error={formState.errors.claveNueva?.message}
          {...register('claveNueva')}
        />
        <CampoTexto
          etiqueta="Confirma la contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirmacion?.message}
          {...register('confirmacion')}
        />
        {esErrorDeApi(cambiar.error, 423) ? <Alerta>{MENSAJE_BLOQUEO}</Alerta> : null}
        {errorGeneral ? <Alerta>{mensajeGeneral(cambiar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {obligatorio ? null : (
            <Link to="/panel" className={ESTILO_BOTON.secundario}>
              Cancelar
            </Link>
          )}
          <button type="submit" disabled={cambiar.isPending} className={ESTILO_BOTON.primario}>
            {cambiar.isPending ? 'Guardando…' : 'Guardar contraseña nueva'}
          </button>
        </div>
      </form>
    </section>
  );
}
