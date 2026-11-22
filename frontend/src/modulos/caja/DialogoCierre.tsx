import { type Caja, cerrarCajaSchema, MENSAJE_EXPLICA_LA_DIFERENCIA } from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo } from '../../lib/errores';
import { nuevaClaveUuid } from '../../lib/uuid';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { mensajesPorCampo } from './campos';
import { useCerrarCaja } from './hooks';
import { esErrorQueCambiaLaCaja, mensajeDeCaja } from './mensajes';
import { describirDiferencia, diferenciaEnVivo, resultadoDeDiferencia } from './montos';

interface Campos {
  montoDeclarado: string;
  observacion: string;
}

interface Propiedades {
  /** La caja que muestra la página. El diálogo guarda la que vio la persona al abrirlo (o tras un `CAJA_CAMBIO`). */
  caja: Caja;
  /** Vuelve a pedir la caja y la devuelve, para mostrar el conteo al día después de un `CAJA_CAMBIO`. */
  recargar: () => Promise<Caja | null | undefined>;
  alCerrar: () => void;
  alCerrarLaCaja: () => void;
  /** Un error que cambió la caja (otra persona la cerró, ya no existe…): la página se actualiza y muestra el mensaje. */
  alFallar: (error: unknown) => void;
}

const CAMPOS = ['montoDeclarado', 'observacion'] as const;

/**
 * Cerrar la caja (HU-27, criterios 29 a 34 de 006). Muestra el esperado por método antes de contar (conteo no ciego, DR-7), pide el efectivo
 * contado, muestra la diferencia mientras se escribe (en céntimos, sin coma flotante) y exige la observación si no es cero. Envía el
 * último movimiento que la persona vio: si entró otro, la API responde `CAJA_CAMBIO`, el diálogo muestra el esperado nuevo y la
 * persona vuelve a revisar su conteo. La clave de idempotencia se genera al abrir el diálogo y se conserva en los reintentos.
 */
export function DialogoCierre({ caja, recargar, alCerrar, alCerrarLaCaja, alFallar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const [vista, setVista] = useState(caja);
  const [recargando, setRecargando] = useState(false);
  // La caja no se pudo actualizar tras un `CAJA_CAMBIO`: con la vista vieja, cada reintento volvería a dar `CAJA_CAMBIO`.
  const [sinActualizar, setSinActualizar] = useState(false);
  const form = useForm<Campos>({ defaultValues: { montoDeclarado: '', observacion: '' } });
  const { register, handleSubmit, setError, clearErrors, control, formState } = form;
  const escrito = useWatch({ control });
  const cerrarCaja = useCerrarCaja();
  useAlPerderSesion(cerrarCaja.error);
  const pendiente = cerrarCaja.isPending || recargando;

  const esperado = vista.resumen.esperado;
  const diferencia = diferenciaEnVivo(escrito.montoDeclarado ?? '', esperado.efectivo);
  const hayDiferencia = diferencia !== null && resultadoDeDiferencia(diferencia) !== 'CUADRA';

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  /** Vuelve a pedir la caja. Solo da el diálogo por actualizado si el último movimiento cambió; si no, no deja reintentar con la vista vieja. */
  const actualizar = async () => {
    setRecargando(true);
    try {
      const nueva = await recargar();
      if (
        nueva &&
        nueva.id === vista.id &&
        nueva.estado === 'ABIERTA' &&
        nueva.resumen.ultimoMovimiento !== vista.resumen.ultimoMovimiento
      ) {
        setVista(nueva);
        setSinActualizar(false);
        return;
      }
    } catch {
      // Se trata igual que una vista que no cambió.
    } finally {
      setRecargando(false);
    }
    setSinActualizar(true);
  };

  const enviar = handleSubmit(async (campos) => {
    if (sinActualizar) {
      await actualizar();
      return;
    }
    const observacion = campos.observacion.trim();
    const validado = cerrarCajaSchema.safeParse({
      claveIdempotencia: clave,
      montoDeclarado: campos.montoDeclarado.trim(),
      ultimoMovimientoVisto: vista.resumen.ultimoMovimiento,
      // Una observación vacía no se envía: la API la rechazaría aunque no haya diferencia (PP6 c de 006).
      ...(observacion === '' ? {} : { observacion }),
    });
    if (!validado.success) {
      const mensajes = mensajesPorCampo(validado.error);
      for (const campo of CAMPOS) {
        const mensaje = mensajes[campo];
        if (mensaje) setError(campo, { message: mensaje });
      }
      return;
    }
    const diferenciaFinal = diferenciaEnVivo(validado.data.montoDeclarado, esperado.efectivo);
    if (diferenciaFinal !== null && resultadoDeDiferencia(diferenciaFinal) !== 'CUADRA' && !validado.data.observacion) {
      setError('observacion', { message: MENSAJE_EXPLICA_LA_DIFERENCIA });
      return;
    }
    // `mutateAsync` y no los callbacks de `mutate`: con la caja cerrada, la página cierra este diálogo y esos callbacks no se llamarían.
    try {
      await cerrarCaja.mutateAsync({ cajaId: vista.id, datos: validado.data });
      alCerrarLaCaja();
    } catch (falla) {
      if (esErrorDeApi(falla, 409, 'CAJA_CAMBIO')) {
        // Entró un movimiento después de que la persona cargó la pantalla: se muestra el esperado nuevo y se vuelve a pedir el conteo.
        await actualizar();
        return;
      }
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
    cerrarCaja.isError &&
    !esErrorQueCambiaLaCaja(cerrarCaja.error) &&
    !esErrorDeApi(cerrarCaja.error, 401) &&
    !esErrorDeCambioDeSesion(cerrarCaja.error) &&
    erroresPorCampo(cerrarCaja.error).length === 0;

  return (
    <Modal titulo="Cerrar caja" alCerrar={cerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-2 space-y-4">
        <div className="space-y-1 rounded-xl bg-sky-50 p-3 text-slate-800 ring-1 ring-sky-100">
          <p>
            Efectivo esperado en el cajón:{' '}
            <strong className="text-lg text-slate-900">{formatearSoles(esperado.efectivo)}</strong>
          </p>
          <p className="text-sm text-slate-700">
            Yape esperado: {formatearSoles(esperado.yape)}. Transferencia esperada:{' '}
            {formatearSoles(esperado.transferencia)}. No suman al efectivo.
          </p>
        </div>
        <fieldset disabled={pendiente} className="min-w-0 space-y-3">
          <legend className="sr-only">Conteo de la caja</legend>
          <CampoTexto
            etiqueta="Efectivo contado (S/)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            ayuda="Cuenta el efectivo del cajón y escribe el total."
            error={formState.errors.montoDeclarado?.message}
            {...register('montoDeclarado', { onChange: () => clearErrors('montoDeclarado') })}
          />
          {diferencia !== null ? (
            <p
              role="status"
              className={`rounded-lg px-3 py-2 text-base font-medium ring-1 ${
                hayDiferencia
                  ? 'bg-amber-50 text-amber-900 ring-amber-200'
                  : 'bg-emerald-50 text-emerald-900 ring-emerald-200'
              }`}
            >
              Diferencia: {describirDiferencia(diferencia)}
            </p>
          ) : null}
          <CampoTexto
            etiqueta={hayDiferencia ? 'Observación (obligatoria)' : 'Observación (opcional)'}
            autoComplete="off"
            ayuda={
              hayDiferencia
                ? 'Explica la diferencia. Un egreso mal registrado también se explica aquí. De 3 a 500 caracteres.'
                : 'De 3 a 500 caracteres.'
            }
            error={formState.errors.observacion?.message}
            {...register('observacion', { onChange: () => clearErrors('observacion') })}
          />
        </fieldset>
        {sinActualizar ? (
          <Alerta>No se pudo actualizar la caja. Vuelve a intentarlo.</Alerta>
        ) : errorGeneral ? (
          <Alerta>{mensajeDeCaja(cerrarCaja.error)}</Alerta>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            Volver
          </button>
          <button type="submit" disabled={pendiente} className={ESTILO_BOTON.primario}>
            {cerrarCaja.isPending ? 'Cerrando…' : sinActualizar ? 'Actualizar caja' : 'Cerrar caja'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
