import { type PagoPendiente, rechazarPagoSchema } from '@aquagestion/contratos';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoAreaTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo } from '../../lib/errores';
import { ETIQUETA_METODO } from '../caja/montos';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useRechazarPago } from './hooks';
import { esRechazoSinSalida, mensajeDeRechazo } from './mensajes';

interface Propiedades {
  pago: PagoPendiente;
  alCerrar: () => void;
  /** Se llama cuando la API responde 200: el pago quedó rechazado. */
  alRechazar: (pago: PagoPendiente) => void;
}

interface Campos {
  motivo: string;
}

/**
 * Rechazar un comprobante (HU-09, RN-28, D-05, criterio 49 de 007b). El motivo es obligatorio (de 3 a 200 caracteres) y lo verá el cliente
 * en su seguimiento y en el correo; el cupo se libera y puede enviar otro comprobante o volver a inscribirse. Valida con el esquema
 * compartido. Rechazar no exige caja. El cuerpo es solo el motivo: rechazar es idempotente en la API (un pago ya rechazado responde 200),
 * y mientras el rechazo va en camino no se envía otro.
 */
export function DialogoRechazarPago({ pago, alCerrar, alRechazar }: Propiedades) {
  const { register, handleSubmit, setError, clearErrors, formState } = useForm<Campos>({
    defaultValues: { motivo: '' },
  });
  const enCurso = useRef(false);
  const rechazar = useRechazarPago();
  useAlPerderSesion(rechazar.error);
  const pendiente = rechazar.isPending;
  const sinSalida = rechazar.isError && esRechazoSinSalida(rechazar.error);

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const alEnviar = (campos: Campos) => {
    // Dos envíos en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente) return;
    const validado = rechazarPagoSchema.safeParse({ motivo: campos.motivo });
    if (!validado.success) {
      setError('motivo', { message: validado.error.issues[0]?.message ?? 'Escribe el motivo del rechazo.' });
      return;
    }
    enCurso.current = true;
    rechazar.mutate(
      { id: pago.id, datos: validado.data },
      {
        onSuccess: () => alRechazar(pago),
        onError: (falla) => {
          for (const { campo, mensaje } of erroresPorCampo(falla)) {
            if (campo === 'motivo') setError('motivo', { message: mensaje });
          }
        },
        onSettled: () => {
          enCurso.current = false;
        },
      },
    );
  };

  const errorGeneral =
    rechazar.isError &&
    !esErrorDeApi(rechazar.error, 401) &&
    !esErrorDeCambioDeSesion(rechazar.error) &&
    erroresPorCampo(rechazar.error).length === 0;

  return (
    <Modal titulo={`Rechazar el pago: ${pago.solicitud?.codigo ?? 'Renovación'}`} alCerrar={cerrar}>
      <form onSubmit={(evento) => void handleSubmit(alEnviar)(evento)} noValidate className="mt-2 space-y-4">
        <div className="space-y-1 text-slate-700">
          <p>
            Cliente:{' '}
            <strong className="break-words text-slate-900">
              {pago.cliente.nombres} {pago.cliente.apellidos}
            </strong>
          </p>
          <p>
            {ETIQUETA_METODO[pago.metodo]} por {formatearSoles(pago.monto)} · Operación{' '}
            <span className="break-all font-mono text-slate-900">{pago.numeroOperacion}</span>
          </p>
          <p className="text-sm">
            El cliente verá este motivo en su seguimiento y en el correo que le enviamos. Se libera el cupo, y puede
            enviar otro comprobante mientras el mes siga abierto.
          </p>
        </div>
        <fieldset disabled={pendiente || sinSalida} className="min-w-0">
          <legend className="sr-only">Motivo del rechazo</legend>
          <CampoAreaTexto
            etiqueta="Motivo del rechazo"
            ayuda="De 3 a 200 caracteres. Por ejemplo: «La imagen no se lee» o «No encontramos la operación»."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: () => clearErrors('motivo') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeRechazo(rechazar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button type="submit" disabled={pendiente || sinSalida} className={ESTILO_BOTON.peligro}>
            {pendiente ? 'Rechazando…' : 'Rechazar el pago'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
