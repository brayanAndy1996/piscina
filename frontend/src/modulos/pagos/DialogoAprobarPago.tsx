import type { Pago, PagoPendiente } from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario, formatearMes } from '../../lib/fechas';
import { ETIQUETA_METODO } from '../caja/montos';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useAprobarPago, useCajaDeHoyAbierta } from './hooks';
import { esAprobacionSinSalida, esErrorDeCajaAlAprobar, mensajeDeAprobacion } from './mensajes';

interface Propiedades {
  pago: PagoPendiente;
  alCerrar: () => void;
}

/**
 * Aprobar un comprobante (HU-09, D-04, criterio 47 de 007b). Confirma el pago: la persona pasa a alumno, se le crea su usuario y su ingreso
 * entra a la caja abierta de hoy. Sin la caja de hoy abierta avisa «Abre la caja antes de aprobar» y no deja confirmar (la API vuelve a
 * comprobarlo). El cuerpo es `{}`: no hay clave de idempotencia que mandar porque aprobar es idempotente en la API (un pago ya
 * confirmado responde 200 con el mismo pago), y mientras la aprobación va en camino no se envía otra: un doble clic no aprueba dos veces.
 */
export function DialogoAprobarPago({ pago, alCerrar }: Propiedades) {
  const [aprobado, setAprobado] = useState<Pago | null>(null);
  const enCurso = useRef(false);
  const aprobar = useAprobarPago();
  const { consulta: consultaCaja, caja, revisada, abierta, fallo } = useCajaDeHoyAbierta();
  useAlPerderSesion(aprobar.error, consultaCaja.error);
  const pendiente = aprobar.isPending;
  const sinSalida = aprobar.isError && esAprobacionSinSalida(aprobar.error);
  const errorDeCaja = aprobar.isError && esErrorDeCajaAlAprobar(aprobar.error);
  const errorGeneral =
    aprobar.isError && !errorDeCaja && !esErrorDeApi(aprobar.error, 401) && !esErrorDeCambioDeSesion(aprobar.error);
  const nombre = `${pago.cliente.nombres} ${pago.cliente.apellidos}`;

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const confirmar = () => {
    // Dos clics en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente || !abierta) return;
    enCurso.current = true;
    aprobar.mutate(pago.id, {
      onSuccess: setAprobado,
      onSettled: () => {
        enCurso.current = false;
      },
    });
  };

  if (aprobado) {
    return (
      <Modal titulo={`Pago aprobado: ${pago.solicitud?.codigo ?? 'Renovación'}`} alCerrar={cerrar}>
        <div className="mt-2 space-y-4">
          <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
            Se aprobó el pago de {formatearSoles(aprobado.monto)} de {nombre}.
            {aprobado.numeroTicket !== null ? ` Ticket N.º ${aprobado.numeroTicket}.` : ''}
          </p>
          <p className="text-sm text-slate-700">
            Ya es alumno de la academia y el ingreso quedó en la caja de hoy. Entra con su DNI como usuario y contraseña
            inicial, y el sistema le pide cambiarla al ingresar.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
              Cerrar
            </button>
            <Link to={`/panel/pagos/${encodeURIComponent(aprobado.id)}/ticket`} className={ESTILO_BOTON.primario}>
              Imprimir ticket
            </Link>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Aprobar el pago: ${pago.solicitud?.codigo ?? 'Renovación'}`} alCerrar={cerrar}>
      <div className="mt-2 space-y-4">
        <div className="space-y-1 text-slate-700">
          <p>
            Cliente: <strong className="break-words text-slate-900">{nombre}</strong>
          </p>
          <p>
            {ETIQUETA_METODO[pago.metodo]} · Operación{' '}
            <span className="break-all font-mono text-slate-900">{pago.numeroOperacion}</span> del{' '}
            {formatearFechaCalendario(pago.fechaOperacion)}
          </p>
        </div>
        <p className="rounded-2xl bg-sky-50 p-4 text-center ring-1 ring-sky-100">
          <span className="block text-sm text-slate-700">Monto a confirmar</span>
          <span className="block text-3xl font-semibold text-slate-900">{formatearSoles(pago.monto)}</span>
          <span className="block text-sm text-slate-700">
            Entra a la caja de hoy como {ETIQUETA_METODO[pago.metodo]}.
          </span>
        </p>
        <p className="text-sm text-slate-700">
          Antes de aprobar, comprueba en tu Yape o en el estado de cuenta que el dinero llegó. Al aprobar, la persona
          pasa a alumno y se le crea su usuario.
        </p>
        {pago.mesTerminado ? (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            Este pago es de {formatearMes(pago.mes)}, un mes que ya terminó. Se puede aprobar: la inscripción queda en
            ese mes.
          </p>
        ) : null}

        {!revisada && !fallo ? (
          <p role="status" className="text-sm text-slate-700">
            Revisando la caja…
          </p>
        ) : null}
        {fallo ? (
          <div className="space-y-2">
            <Alerta>No pudimos revisar la caja. {mensajeGeneral(consultaCaja.error)}</Alerta>
            <button type="button" onClick={() => void consultaCaja.refetch()} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          </div>
        ) : null}
        {revisada && !abierta ? (
          <div className="space-y-2">
            <Alerta>
              {caja != null && caja.estado === 'ABIERTA'
                ? `La caja abierta es del ${formatearFechaCalendario(caja.fecha)}. Ciérrala y abre la de hoy antes de aprobar el pago.`
                : caja != null
                  ? 'Abre la caja antes de aprobar el pago. La caja de hoy ya se cerró: el administrador puede reabrirla.'
                  : 'Abre la caja antes de aprobar el pago.'}
            </Alerta>
            <Link to="/panel/caja" className={ESTILO_BOTON.secundario}>
              Ir a la caja
            </Link>
          </div>
        ) : null}

        {errorDeCaja ? (
          <div className="space-y-2">
            <Alerta>{mensajeDeAprobacion(aprobar.error)}</Alerta>
            <Link to="/panel/caja" className={ESTILO_BOTON.secundario}>
              Ir a la caja
            </Link>
          </div>
        ) : null}
        {errorGeneral ? <Alerta>{mensajeDeAprobacion(aprobar.error)}</Alerta> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pendiente || sinSalida || !abierta}
            className={ESTILO_BOTON.primario}
          >
            {pendiente ? 'Aprobando…' : `Aprobar ${formatearSoles(pago.monto)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
