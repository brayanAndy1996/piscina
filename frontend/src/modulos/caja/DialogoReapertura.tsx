import { type Caja, reabrirCajaSchema } from '@aquagestion/contratos';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { erroresPorCampo } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { mensajesPorCampo } from './campos';
import { useReabrirCaja } from './hooks';
import { esErrorQueCambiaLaCaja, mensajeDeCaja } from './mensajes';

interface Propiedades {
  caja: Caja;
  /** La caja no es la de hoy en Lima (criterio 36 c, DR-8): al reabrirla solo se podrá volver a contar el efectivo y cerrarla. */
  deOtroDia?: boolean;
  alCerrar: () => void;
  alReabrir: () => void;
  /** Un error que cambió la caja (hay otra abierta, ya no existe…): la página se actualiza y muestra el mensaje. */
  alFallar: (error: unknown) => void;
}

/**
 * Reabrir una caja cerrada, solo para el administrador (HU-27, criterios 35 y 36 de 006): el motivo es obligatorio y queda en el cierre y en
 * la auditoría (sección 11.4). El diálogo pide el motivo una sola vez por envío: reabrir una caja ya abierta responde 200 sin repetir nada.
 */
export function DialogoReapertura({ caja, deOtroDia = false, alCerrar, alReabrir, alFallar }: Propiedades) {
  const form = useForm<{ motivo: string }>({ defaultValues: { motivo: '' } });
  const { register, handleSubmit, setError, clearErrors, formState } = form;
  const reabrir = useReabrirCaja();
  useAlPerderSesion(reabrir.error);
  const pendiente = reabrir.isPending;

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const enviar = handleSubmit(async ({ motivo }) => {
    const validado = reabrirCajaSchema.safeParse({ motivo });
    if (!validado.success) {
      setError('motivo', { message: mensajesPorCampo(validado.error)['motivo'] ?? 'El motivo no es válido.' });
      return;
    }
    // `mutateAsync` y no los callbacks de `mutate`: con la caja reabierta, la página cierra este diálogo y esos callbacks no se llamarían.
    try {
      await reabrir.mutateAsync({ cajaId: caja.id, datos: validado.data });
      alReabrir();
    } catch (falla) {
      if (esErrorQueCambiaLaCaja(falla)) {
        alFallar(falla);
        return;
      }
      for (const { campo, mensaje } of erroresPorCampo(falla)) {
        if (campo === 'motivo' || campo === '') setError('motivo', { message: mensaje });
      }
    }
  });

  const errorGeneral =
    reabrir.isError &&
    !esErrorQueCambiaLaCaja(reabrir.error) &&
    !esErrorDeApi(reabrir.error, 401) &&
    !esErrorDeCambioDeSesion(reabrir.error) &&
    erroresPorCampo(reabrir.error).length === 0;

  return (
    <Modal titulo="Reabrir caja" alCerrar={cerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-2 space-y-4">
        <p className="text-slate-700">
          Vas a reabrir la caja del {formatearFechaCalendario(caja.fecha)}.{' '}
          {deOtroDia
            ? 'Es la caja de un día anterior: solo podrás volver a contar el efectivo y cerrarla.'
            : 'Volverá a admitir egresos y cobros.'}{' '}
          El cierre anterior queda guardado con tu motivo.
        </p>
        <fieldset disabled={pendiente} className="min-w-0">
          <legend className="sr-only">Motivo de la reapertura</legend>
          <CampoTexto
            etiqueta="Motivo de la reapertura"
            autoComplete="off"
            ayuda="De 3 a 200 caracteres. Queda registrado en la auditoría."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: () => clearErrors('motivo') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeCaja(reabrir.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            Volver
          </button>
          <button type="submit" disabled={pendiente} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Reabriendo…' : 'Reabrir caja'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
