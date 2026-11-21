import { cancelarSolicitudSchema, type SolicitudPanel } from '@aquagestion/contratos';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { erroresPorCampo } from '../../lib/errores';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useCancelarSolicitud } from './hooks';
import { esCancelacionSinSalida, mensajeDeCancelacion } from './mensajes';

interface Propiedades {
  solicitud: SolicitudPanel;
  alCerrar: () => void;
  /** Se llama con la solicitud ya cancelada cuando la API responde 200. */
  alCancelar: (solicitud: SolicitudPanel) => void;
}

/**
 * Cancelar una solicitud de inscripción (HU-01, RN-22; criterios 39 y 46 de 005): pide el motivo (de 3 a 200 caracteres visibles, con el
 * esquema compartido), desactiva el botón mientras espera y, con el 200, avisa a la página. El cliente no recibe ningún aviso (DR-17).
 */
export function DialogoCancelarSolicitud({ solicitud, alCerrar, alCancelar }: Propiedades) {
  const form = useForm<{ motivo: string }>({ defaultValues: { motivo: '' } });
  const { register, handleSubmit, setError, clearErrors, formState } = form;
  const cancelar = useCancelarSolicitud();
  useAlPerderSesion(cancelar.error);
  const pendiente = cancelar.isPending;
  const sinSalida = cancelar.isError && esCancelacionSinSalida(cancelar.error);

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const enviar = handleSubmit(({ motivo }) => {
    const validado = cancelarSolicitudSchema.safeParse({ motivo });
    if (!validado.success) {
      setError('motivo', { message: validado.error.issues[0]?.message ?? 'El motivo no es válido.' });
      return;
    }
    cancelar.mutate(
      { id: solicitud.id, datos: validado.data },
      {
        onSuccess: alCancelar,
        onError: (falla) => {
          for (const { campo, mensaje } of erroresPorCampo(falla)) {
            if (campo === 'motivo' || campo === '') setError('motivo', { message: mensaje });
          }
        },
      },
    );
  });

  const errorGeneral =
    cancelar.isError &&
    !esErrorDeApi(cancelar.error, 401) &&
    !esErrorDeCambioDeSesion(cancelar.error) &&
    erroresPorCampo(cancelar.error).length === 0;

  return (
    <Modal titulo={`Cancelar la solicitud ${solicitud.codigo}`} alCerrar={cerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-2 space-y-4">
        <div className="space-y-2 text-slate-700">
          <p>
            Vas a cancelar la solicitud de {solicitud.nombres} {solicitud.apellidos}. El cupo que tenía reservado se
            libera de inmediato.
          </p>
          <p className="text-sm">El cliente no recibe ningún aviso: avísale tú si hace falta.</p>
        </div>
        <fieldset disabled={pendiente || sinSalida} className="min-w-0">
          <legend className="sr-only">Motivo de la cancelación</legend>
          <CampoTexto
            etiqueta="Motivo de la cancelación"
            autoComplete="off"
            ayuda="De 3 a 200 caracteres. Queda registrado en la auditoría."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: () => clearErrors('motivo') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeCancelacion(cancelar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button type="submit" disabled={pendiente || sinSalida} className={ESTILO_BOTON.peligro}>
            {pendiente ? 'Cancelando…' : 'Cancelar solicitud'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
