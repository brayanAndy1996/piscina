import { type Carnet, regenerarQrSchema } from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoAreaTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { erroresPorCampo } from '../../lib/errores';
import { nuevaClaveUuid } from '../../lib/uuid';
import { esRegeneracionSinSalida, mensajeDeRegeneracion } from '../carnet/mensajes';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useRegenerarQr } from './hooks';

interface Propiedades {
  alumnoId: string;
  nombre: string;
  alCerrar: () => void;
  /** Se llama con el carnet nuevo cuando la API responde 200. */
  alRegenerar: (carnet: Carnet) => void;
}

interface Campos {
  motivo: string;
}

/**
 * Regenerar el QR de un alumno (HU-13, RN-06, criterios 13 y 14 de 008). El motivo es obligatorio (de 3 a 200 caracteres) y queda en la
 * auditoría. La `claveIdempotencia` se genera al abrir el diálogo y se conserva en los reintentos: un doble clic o un reintento tras un corte
 * no deja inservible el carnet recién impreso. Avisa que el carnet impreso y el QR del celular dejan de servir.
 */
export function DialogoRegenerarQr({ alumnoId, nombre, alCerrar, alRegenerar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const { register, handleSubmit, setError, clearErrors, formState } = useForm<Campos>({
    defaultValues: { motivo: '' },
  });
  const enCurso = useRef(false);
  const regenerar = useRegenerarQr();
  useAlPerderSesion(regenerar.error);
  const pendiente = regenerar.isPending;
  const sinSalida = regenerar.isError && esRegeneracionSinSalida(regenerar.error);

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const alEnviar = (campos: Campos) => {
    // Dos envíos en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente) return;
    const validado = regenerarQrSchema.safeParse({ claveIdempotencia: clave, motivo: campos.motivo });
    if (!validado.success) {
      const mensaje = validado.error.issues.find((problema) => problema.path[0] === 'motivo')?.message;
      setError('motivo', { message: mensaje ?? 'Escribe el motivo de la regeneración.' });
      return;
    }
    enCurso.current = true;
    regenerar.mutate(
      { alumnoId, datos: validado.data },
      {
        onSuccess: alRegenerar,
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
    regenerar.isError &&
    !esErrorDeApi(regenerar.error, 401) &&
    !esErrorDeCambioDeSesion(regenerar.error) &&
    erroresPorCampo(regenerar.error).length === 0;

  return (
    <Modal titulo="Regenerar el QR" alCerrar={cerrar}>
      <form onSubmit={(evento) => void handleSubmit(alEnviar)(evento)} noValidate className="mt-2 space-y-4">
        <p className="text-slate-700">
          Alumno: <strong className="break-words text-slate-900">{nombre}</strong>
        </p>
        <p role="note" className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
          El carnet impreso y el QR del celular dejarán de servir; habrá que imprimir uno nuevo.
        </p>
        <fieldset disabled={pendiente || sinSalida} className="min-w-0">
          <legend className="sr-only">Motivo de la regeneración</legend>
          <CampoAreaTexto
            etiqueta="Motivo"
            ayuda="De 3 a 200 caracteres. Por ejemplo: «Perdió el carnet» o «Se compartió el QR»."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: () => clearErrors('motivo') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeRegeneracion(regenerar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button type="submit" disabled={pendiente || sinSalida} className={ESTILO_BOTON.peligro}>
            {pendiente ? 'Regenerando…' : 'Regenerar el QR'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
