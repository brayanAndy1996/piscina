import { cobrarEnEfectivoSchema, type Pago, type SolicitudPanel } from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, Aviso, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { nuevaClaveUuid } from '../../lib/uuid';
import { useCajaActual, useHoyEnLima } from '../caja/hooks';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useCobrarEnEfectivo } from './hooks';
import { esCobroSinSalida, esErrorDeCajaAlCobrar, mensajeDeCobro, totalDelCambioDeMonto } from './mensajes';

interface Propiedades {
  solicitud: SolicitudPanel;
  alCerrar: () => void;
}

/** Lo que queda a la vista cuando el cobro terminó: el pago (con su número de ticket) y la solicitud ya confirmada. */
interface CobroHecho {
  pago: Pago;
  solicitud: SolicitudPanel;
}

/**
 * Cobrar una solicitud en efectivo (HU-07, criterios 13 a 19 y 54 de 007). Muestra el total que se va a cobrar y lo envía como
 * `montoMostrado`: si el administrador lo cambió mientras el diálogo estaba abierto, la API responde 409 `MONTO_CAMBIO` con el total nuevo,
 * que se muestra y obliga a confirmar otra vez (nunca se cobra un monto que quien cobra no vio). La clave de idempotencia se genera al abrir
 * y no cambia entre intentos, y mientras el cobro va en camino no se envía otro: un doble clic no cobra dos veces. Sin la caja de hoy
 * abierta avisa «Abre la caja antes de cobrar» y no deja confirmar. Al terminar ofrece imprimir el ticket.
 */
export function DialogoCobrarEfectivo({ solicitud, alCerrar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const [total, setTotal] = useState(solicitud.monto);
  const [hecho, setHecho] = useState<CobroHecho | null>(null);
  const enCurso = useRef(false);
  const cobrar = useCobrarEnEfectivo();
  const consultaCaja = useCajaActual();
  const cajaRevisada = useRecienPedida(consultaCaja);
  const hoy = useHoyEnLima();
  useAlPerderSesion(cobrar.error, consultaCaja.error);
  const pendiente = cobrar.isPending;
  const sinSalida = cobrar.isError && esCobroSinSalida(cobrar.error);

  const caja = consultaCaja.data;
  const cajaDeHoyAbierta =
    cajaRevisada && caja != null && caja.estado === 'ABIERTA' && !caja.deOtroDia && caja.fecha >= hoy;
  const falloLaCaja = !cajaRevisada && consultaCaja.isError && !esErrorDeApi(consultaCaja.error, 401);

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const confirmar = () => {
    // Dos clics en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente || !cajaDeHoyAbierta) return;
    const datos = cobrarEnEfectivoSchema.safeParse({ claveIdempotencia: clave, montoMostrado: total });
    if (!datos.success) return;
    enCurso.current = true;
    cobrar.mutate(
      { id: solicitud.id, datos: datos.data },
      {
        onSuccess: (respuesta) => setHecho({ pago: respuesta.pago, solicitud: respuesta.solicitud }),
        onError: (falla) => {
          // El total que se ve pasa a ser el nuevo: el próximo clic cobra lo que la persona acaba de leer.
          const nuevo = totalDelCambioDeMonto(falla);
          if (nuevo) setTotal(nuevo);
        },
        onSettled: () => {
          enCurso.current = false;
        },
      },
    );
  };

  const montoCambio = cobrar.isError && totalDelCambioDeMonto(cobrar.error) !== null;
  const errorDeCaja = cobrar.isError && esErrorDeCajaAlCobrar(cobrar.error);
  const errorGeneral =
    cobrar.isError &&
    !montoCambio &&
    !errorDeCaja &&
    !esErrorDeApi(cobrar.error, 401) &&
    !esErrorDeCambioDeSesion(cobrar.error);

  if (hecho) {
    return (
      <Modal titulo={`Cobro registrado: ${hecho.solicitud.codigo}`} alCerrar={cerrar}>
        <div className="mt-2 space-y-4">
          <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
            Se cobró {formatearSoles(hecho.pago.monto)} en efectivo a {hecho.solicitud.nombres}{' '}
            {hecho.solicitud.apellidos}.
            {hecho.pago.numeroTicket !== null ? ` Ticket N.º ${hecho.pago.numeroTicket}.` : ''}
          </p>
          <p className="text-sm text-slate-700">
            Ya es alumno de la academia. Entra con su DNI como usuario y contraseña inicial, y el sistema le pide
            cambiarla al ingresar.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
              Cerrar
            </button>
            <Link to={`/panel/pagos/${encodeURIComponent(hecho.pago.id)}/ticket`} className={ESTILO_BOTON.primario}>
              Imprimir ticket
            </Link>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Cobrar en efectivo: ${solicitud.codigo}`} alCerrar={cerrar}>
      <div className="mt-2 space-y-4">
        <div className="space-y-1 text-slate-700">
          <p>
            Cliente:{' '}
            <strong className="break-words text-slate-900">
              {solicitud.nombres} {solicitud.apellidos}
            </strong>
          </p>
          <p>Plan: {solicitud.plan.nombre}</p>
        </div>
        <p className="rounded-2xl bg-sky-50 p-4 text-center ring-1 ring-sky-100">
          <span className="block text-sm text-slate-700">Total a cobrar</span>
          <span className="block text-3xl font-semibold text-slate-900">{formatearSoles(total)}</span>
          <span className="block text-sm text-slate-700">En efectivo. El precio ya incluye IGV.</span>
        </p>

        {!cajaRevisada && !falloLaCaja ? (
          <p role="status" className="text-sm text-slate-700">
            Revisando la caja…
          </p>
        ) : null}
        {falloLaCaja ? (
          <div className="space-y-2">
            <Alerta>No pudimos revisar la caja. {mensajeGeneral(consultaCaja.error)}</Alerta>
            <button type="button" onClick={() => void consultaCaja.refetch()} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          </div>
        ) : null}
        {cajaRevisada && !cajaDeHoyAbierta ? (
          <div className="space-y-2">
            <Alerta>
              {caja != null && caja.estado === 'ABIERTA'
                ? `La caja abierta es del ${formatearFechaCalendario(caja.fecha)}. Ciérrala y abre la de hoy antes de cobrar.`
                : caja != null
                  ? 'Abre la caja antes de cobrar. La caja de hoy ya se cerró: el administrador puede reabrirla.'
                  : 'Abre la caja antes de cobrar.'}
            </Alerta>
            <Link to="/panel/caja" className={ESTILO_BOTON.secundario}>
              Ir a la caja
            </Link>
          </div>
        ) : null}

        {montoCambio ? <Aviso>{mensajeDeCobro(cobrar.error)}</Aviso> : null}
        {errorDeCaja ? (
          <div className="space-y-2">
            <Alerta>{mensajeDeCobro(cobrar.error)}</Alerta>
            <Link to="/panel/caja" className={ESTILO_BOTON.secundario}>
              Ir a la caja
            </Link>
          </div>
        ) : null}
        {errorGeneral ? <Alerta>{mensajeDeCobro(cobrar.error)}</Alerta> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pendiente || sinSalida || !cajaDeHoyAbierta}
            className={ESTILO_BOTON.primario}
          >
            {pendiente ? 'Cobrando…' : `Cobrar ${formatearSoles(total)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
