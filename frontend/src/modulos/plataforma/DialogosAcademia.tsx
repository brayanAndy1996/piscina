import {
  type AcademiaResumen,
  reactivarAcademiaSchema,
  suspenderAcademiaSchema,
  type SuspenderAcademia,
} from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useReactivarAcademia, useRedirigirSiNoAutenticado, useSuspenderAcademia } from './hooks';
import { mensajeDeAccion } from './mensajes';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from './ui';

interface Propiedades {
  academia: AcademiaResumen;
  alCerrar: () => void;
}

type CamposMotivo = z.input<typeof suspenderAcademiaSchema>;

/**
 * Suspender: pide el motivo (obligatorio, DR-4) y la confirmación. El motivo va en un campo de una sola línea: un salto
 * de línea en medio del texto es un carácter de control y la API lo rechaza (criterio 76).
 */
export function DialogoSuspender({ academia, alCerrar }: Propiedades) {
  const suspender = useSuspenderAcademia();
  const { register, handleSubmit, formState } = useForm<CamposMotivo, unknown, SuspenderAcademia>({
    resolver: zodResolver(suspenderAcademiaSchema),
    defaultValues: { motivo: '' },
  });
  useRedirigirSiNoAutenticado(suspender.error);

  const enviar = handleSubmit(({ motivo }) => {
    suspender.mutate({ id: academia.id, motivo }, { onSuccess: alCerrar });
  });

  return (
    <Modal titulo={`Suspender ${academia.nombre}`} alCerrar={alCerrar}>
      <p className="mt-2 text-slate-700">
        Mientras esté suspendida, sus usuarios no podrán entrar y su página pública dejará de estar disponible.
      </p>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-4">
        <CampoTexto
          etiqueta="Motivo de la suspensión"
          error={formState.errors.motivo?.message}
          autoComplete="off"
          {...register('motivo')}
        />
        {suspender.isError ? <Alerta>{mensajeDeAccion(suspender.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cancelar
          </button>
          <button type="submit" disabled={suspender.isPending} className={ESTILO_BOTON.peligro}>
            {suspender.isPending ? 'Suspendiendo…' : 'Suspender academia'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type CamposReactivar = { motivo: string };

/** Reactivar: pide confirmación; el motivo es opcional. */
export function DialogoReactivar({ academia, alCerrar }: Propiedades) {
  const reactivar = useReactivarAcademia();
  const { register, handleSubmit, setError, formState } = useForm<CamposReactivar>({ defaultValues: { motivo: '' } });
  useRedirigirSiNoAutenticado(reactivar.error);

  const enviar = handleSubmit(({ motivo }) => {
    const limpio = motivo.trim();
    if (limpio !== '') {
      const validado = reactivarAcademiaSchema.safeParse({ motivo: limpio });
      if (!validado.success) {
        setError('motivo', { message: validado.error.issues[0]?.message ?? 'El motivo no es válido.' });
        return;
      }
    }
    reactivar.mutate({ id: academia.id, motivo: limpio === '' ? undefined : limpio }, { onSuccess: alCerrar });
  });

  return (
    <Modal titulo={`Reactivar ${academia.nombre}`} alCerrar={alCerrar}>
      <p className="mt-2 text-slate-700">La academia volverá a estar activa y sus usuarios podrán entrar de nuevo.</p>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-4">
        <CampoTexto
          etiqueta="Motivo (opcional)"
          error={formState.errors.motivo?.message}
          autoComplete="off"
          {...register('motivo')}
        />
        {reactivar.isError ? <Alerta>{mensajeDeAccion(reactivar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cancelar
          </button>
          <button type="submit" disabled={reactivar.isPending} className={ESTILO_BOTON.primario}>
            {reactivar.isPending ? 'Reactivando…' : 'Reactivar academia'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
