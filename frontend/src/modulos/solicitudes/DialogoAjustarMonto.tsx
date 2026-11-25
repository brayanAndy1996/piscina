import { ajustarMontoSchema, type SolicitudPanel } from '@aquagestion/contratos';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo } from '../../lib/errores';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useAjustarMonto } from './hooks';
import { esAjusteSinSalida, mensajeDeAjuste } from './mensajes';

interface Propiedades {
  solicitud: SolicitudPanel;
  alCerrar: () => void;
  /** Se llama con la solicitud ya ajustada cuando la API responde 200. */
  alAjustar: (solicitud: SolicitudPanel) => void;
}

interface Campos {
  montoAjustado: string;
  motivo: string;
}

const CAMPOS = ['montoAjustado', 'motivo'] as const;

/**
 * Ajustar el monto de una solicitud sin pagar (HU-34, RN-25, criterio 11 de 007): solo el administrador, en soles enteros de 1 en
 * adelante y con un motivo. Valida con el esquema compartido; el ajuste queda en la auditoría. El mismo monto con el mismo motivo es
 * idempotente en la API, así que un doble clic no cambia nada, y el botón se desactiva mientras espera.
 */
export function DialogoAjustarMonto({ solicitud, alCerrar, alAjustar }: Propiedades) {
  const form = useForm<Campos>({ defaultValues: { montoAjustado: '', motivo: '' } });
  const { register, handleSubmit, setError, clearErrors, formState } = form;
  const ajustar = useAjustarMonto();
  useAlPerderSesion(ajustar.error);
  const pendiente = ajustar.isPending;
  const sinSalida = ajustar.isError && esAjusteSinSalida(ajustar.error);

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const enviar = handleSubmit((campos) => {
    if (pendiente) return;
    const validado = ajustarMontoSchema.safeParse({
      montoAjustado: campos.montoAjustado.trim(),
      motivo: campos.motivo,
    });
    if (!validado.success) {
      for (const problema of validado.error.issues) {
        const campo = CAMPOS.find((nombre) => nombre === problema.path[0]);
        if (campo && !formState.errors[campo]) setError(campo, { message: problema.message });
      }
      return;
    }
    ajustar.mutate(
      { id: solicitud.id, datos: validado.data },
      {
        onSuccess: alAjustar,
        onError: (falla) => {
          for (const { campo, mensaje } of erroresPorCampo(falla)) {
            const propio = CAMPOS.find((nombre) => nombre === campo);
            if (propio) setError(propio, { message: mensaje });
          }
        },
      },
    );
  });

  const errorGeneral =
    ajustar.isError &&
    !esErrorDeApi(ajustar.error, 401) &&
    !esErrorDeCambioDeSesion(ajustar.error) &&
    erroresPorCampo(ajustar.error).length === 0;

  return (
    <Modal titulo={`Ajustar el monto de la solicitud ${solicitud.codigo}`} alCerrar={cerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-2 space-y-4">
        <div className="space-y-1 text-slate-700">
          <p>
            Cliente:{' '}
            <strong className="break-words text-slate-900">
              {solicitud.nombres} {solicitud.apellidos}
            </strong>
          </p>
          <p>
            Total actual: <strong className="text-slate-900">{formatearSoles(solicitud.monto)}</strong>
            {solicitud.ajuste ? ` (calculado: ${formatearSoles(solicitud.ajuste.montoCalculado)})` : ''}
          </p>
          <p className="text-sm">
            El nuevo monto reemplaza al calculado. No cambia el cupo ni las clases del mes. Queda registrado en la
            auditoría.
          </p>
        </div>
        <fieldset disabled={pendiente || sinSalida} className="min-w-0 space-y-3">
          <legend className="sr-only">Datos del ajuste</legend>
          <CampoTexto
            etiqueta="Nuevo monto (S/)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="35"
            ayuda="En soles enteros, de 1 a 99999."
            error={formState.errors.montoAjustado?.message}
            {...register('montoAjustado', { onChange: () => clearErrors('montoAjustado') })}
          />
          <CampoTexto
            etiqueta="Motivo del ajuste"
            autoComplete="off"
            ayuda="De 3 a 200 caracteres."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: () => clearErrors('motivo') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeAjuste(ajustar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button type="submit" disabled={pendiente || sinSalida} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Guardando…' : 'Guardar ajuste'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
