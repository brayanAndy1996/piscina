import { abrirCajaSchema, type Caja } from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { erroresPorCampo } from '../../lib/errores';
import { nuevaClaveUuid } from '../../lib/uuid';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { mensajesPorCampo } from './campos';
import { useAbrirCaja } from './hooks';
import { esErrorQueCambiaLaCaja, mensajeDeCaja } from './mensajes';

interface Propiedades {
  /** Se llama con la caja ya abierta cuando la API responde 201 (o 200 en un reintento). */
  alAbrir: (caja: Caja) => void;
  /** Un error que cambió la caja (ya estaba abierta, la de ayer sigue sin cerrar…): la página se actualiza y muestra el mensaje. */
  alFallar: (error: unknown) => void;
}

/**
 * "Abrir caja" (HU-25, criterio 38 a de 006): pide el efectivo con el que empieza el día. La clave de idempotencia se genera al mostrar el
 * formulario y se conserva en los reintentos: un doble clic o una respuesta perdida no abre dos cajas (criterio 16).
 */
export function FormularioApertura({ alAbrir, alFallar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const form = useForm<{ montoInicial: string }>({ defaultValues: { montoInicial: '' } });
  const { register, handleSubmit, setError, clearErrors, formState } = form;
  const abrir = useAbrirCaja();
  useAlPerderSesion(abrir.error);
  const pendiente = abrir.isPending;

  const enviar = handleSubmit(async ({ montoInicial }) => {
    const validado = abrirCajaSchema.safeParse({ claveIdempotencia: clave, montoInicial: montoInicial.trim() });
    if (!validado.success) {
      const mensajes = mensajesPorCampo(validado.error);
      setError('montoInicial', { message: mensajes['montoInicial'] ?? 'El monto inicial no es válido.' });
      return;
    }
    // `mutateAsync` y no los callbacks de `mutate`: al abrirse la caja, la página reemplaza este formulario y esos callbacks no se llamarían.
    try {
      alAbrir(await abrir.mutateAsync(validado.data));
    } catch (falla) {
      if (esErrorQueCambiaLaCaja(falla)) {
        alFallar(falla);
        return;
      }
      for (const { campo, mensaje } of erroresPorCampo(falla)) {
        if (campo === 'montoInicial' || campo === '') setError('montoInicial', { message: mensaje });
      }
    }
  });

  const errorGeneral =
    abrir.isError &&
    !esErrorQueCambiaLaCaja(abrir.error) &&
    !esErrorDeApi(abrir.error, 401) &&
    !esErrorDeCambioDeSesion(abrir.error) &&
    erroresPorCampo(abrir.error).length === 0;

  return (
    <section
      aria-label="Abrir caja"
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <h2 className="text-xl font-semibold text-slate-900">Abrir caja</h2>
      <p className="text-slate-700">
        Todavía no abriste la caja de hoy. Antes de cobrar, registra el efectivo con el que empiezas el día.
      </p>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="space-y-4">
        <fieldset disabled={pendiente} className="min-w-0">
          <legend className="sr-only">Apertura de la caja</legend>
          <CampoTexto
            etiqueta="Monto inicial (S/)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            ayuda="El efectivo con el que empiezas el día. Puede ser 0."
            error={formState.errors.montoInicial?.message}
            {...register('montoInicial', { onChange: () => clearErrors('montoInicial') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeCaja(abrir.error)}</Alerta> : null}
        <div className="flex justify-end">
          <button type="submit" disabled={pendiente} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Abriendo…' : 'Abrir caja'}
          </button>
        </div>
      </form>
    </section>
  );
}
