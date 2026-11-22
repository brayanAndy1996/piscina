import { type Caja, registrarEgresoSchema } from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo } from '../../lib/errores';
import { nuevaClaveUuid } from '../../lib/uuid';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { mensajesPorCampo } from './campos';
import { useRegistrarEgreso } from './hooks';
import { esErrorQueCambiaLaCaja, mensajeDeCaja } from './mensajes';

interface Campos {
  descripcion: string;
  monto: string;
  comprobante: string;
}

interface Propiedades {
  caja: Caja;
  alCerrar: () => void;
  /** Se llama con el monto del egreso ya registrado. */
  alRegistrar: (monto: string) => void;
  /** Un error que cambió la caja (ya se cerró, pasó la medianoche…): la página se actualiza y muestra el mensaje. */
  alFallar: (error: unknown) => void;
}

const CAMPOS = ['descripcion', 'monto', 'comprobante'] as const;

/**
 * Registrar un egreso menor (HU-26, criterios 17 a 22 de 006): siempre en efectivo, con la descripción, el monto y un comprobante opcional.
 * La clave de idempotencia se genera al abrir el diálogo y se conserva en los reintentos. Un egreso que dejaría el efectivo en negativo
 * (409 `EFECTIVO_INSUFICIENTE`) se explica con el disponible y el diálogo sigue abierto.
 */
export function DialogoEgreso({ caja, alCerrar, alRegistrar, alFallar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const form = useForm<Campos>({ defaultValues: { descripcion: '', monto: '', comprobante: '' } });
  const { register, handleSubmit, setError, clearErrors, formState } = form;
  const registrar = useRegistrarEgreso();
  useAlPerderSesion(registrar.error);
  const pendiente = registrar.isPending;

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const enviar = handleSubmit(async (campos) => {
    const validado = registrarEgresoSchema.safeParse({
      claveIdempotencia: clave,
      descripcion: campos.descripcion,
      monto: campos.monto.trim(),
      comprobante: campos.comprobante,
    });
    if (!validado.success) {
      const mensajes = mensajesPorCampo(validado.error);
      for (const campo of CAMPOS) {
        const mensaje = mensajes[campo];
        if (mensaje) setError(campo, { message: mensaje });
      }
      return;
    }
    // `mutateAsync` y no los callbacks de `mutate`: con el egreso hecho, la página cierra este diálogo y esos callbacks no se llamarían.
    try {
      const respuesta = await registrar.mutateAsync({ cajaId: caja.id, datos: validado.data });
      alRegistrar(respuesta.movimiento.monto);
    } catch (falla) {
      if (esErrorQueCambiaLaCaja(falla)) {
        alFallar(falla);
        return;
      }
      for (const { campo, mensaje } of erroresPorCampo(falla)) {
        const propio = CAMPOS.find((nombre) => nombre === campo);
        if (propio) setError(propio, { message: mensaje });
      }
    }
  });

  const errorGeneral =
    registrar.isError &&
    !esErrorQueCambiaLaCaja(registrar.error) &&
    !esErrorDeApi(registrar.error, 401) &&
    !esErrorDeCambioDeSesion(registrar.error) &&
    erroresPorCampo(registrar.error).length === 0;

  return (
    <Modal titulo="Registrar egreso" alCerrar={cerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-2 space-y-4">
        <p className="text-slate-700">
          El egreso sale del efectivo de la caja. Efectivo disponible:{' '}
          <strong className="text-slate-900">{formatearSoles(caja.resumen.esperado.efectivo)}</strong>.
        </p>
        <fieldset disabled={pendiente} className="min-w-0 space-y-3">
          <legend className="sr-only">Datos del egreso</legend>
          <CampoTexto
            etiqueta="Descripción"
            autoComplete="off"
            ayuda="Para qué fue el gasto. De 3 a 200 caracteres."
            error={formState.errors.descripcion?.message}
            {...register('descripcion', { onChange: () => clearErrors('descripcion') })}
          />
          <CampoTexto
            etiqueta="Monto (S/)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            error={formState.errors.monto?.message}
            {...register('monto', { onChange: () => clearErrors('monto') })}
          />
          <CampoTexto
            etiqueta="Comprobante (opcional)"
            autoComplete="off"
            ayuda="Por ejemplo, el número de la boleta. Hasta 60 caracteres."
            error={formState.errors.comprobante?.message}
            {...register('comprobante', { onChange: () => clearErrors('comprobante') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeCaja(registrar.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            Volver
          </button>
          <button type="submit" disabled={pendiente} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Registrando…' : 'Registrar egreso'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
