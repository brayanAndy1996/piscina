import { type PagoPendiente, TOPE_DE_LA_BANDEJA } from '@aquagestion/contratos';
import { useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario, formatearFechaHora, formatearMes } from '../../lib/fechas';
import { ETIQUETA_METODO } from '../caja/montos';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { DialogoAprobarPago } from './DialogoAprobarPago';
import { DialogoRechazarPago } from './DialogoRechazarPago';
import { usePagosPendientes } from './hooks';
import { descripcionDelPago, esRenovacion, rotuloDelPago } from './mensajes';
import { VisorComprobante } from './VisorComprobante';

/**
 * `/panel/pagos`: la bandeja de verificación de pagos por Yape o transferencia (HU-09, criterio 56 de 007b). Lista los comprobantes pendientes
 * del más antiguo al más nuevo, con su imagen ampliable, para aprobarlos (entran a la caja abierta) o rechazarlos con un motivo. `ADMIN` y
 * `SECRETARIA`.
 */
export function PaginaPagos() {
  return (
    <RequierePermiso permiso="VERIFICAR_PAGOS">
      <ContenidoPagos />
    </RequierePermiso>
  );
}

type Accion = { tipo: 'ver' | 'aprobar' | 'rechazar'; pago: PagoPendiente };

function ContenidoPagos() {
  const consulta = usePagosPendientes();
  useAlPerderSesion(consulta.error);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const pagos = consulta.data;

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">Pagos por verificar</h1>
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          disabled={consulta.isFetching}
          className={ESTILO_BOTON.secundario}
        >
          {consulta.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
      <p className="text-slate-700">
        Comprobantes de Yape y transferencia que enviaron los clientes y renovaciones que registró recepción. Compara la
        imagen y el número de operación con tu Yape o tu estado de cuenta y apruébalos (el ingreso entra a la caja
        abierta de hoy) o recházalos con un motivo. Mientras un comprobante está en revisión, su cupo sigue reservado.
      </p>

      {hecho ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          {hecho}
        </p>
      ) : null}

      {pagos ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar la lista. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          {pagos.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
              No hay comprobantes por verificar.
            </p>
          ) : (
            <ul aria-label="Pagos por verificar" className="space-y-3">
              {pagos.map((pago) => (
                <li key={pago.id}>
                  <TarjetaPago
                    pago={pago}
                    alVer={() => setAccion({ tipo: 'ver', pago })}
                    alAprobar={() => {
                      setHecho(null);
                      setAccion({ tipo: 'aprobar', pago });
                    }}
                    alRechazar={() => {
                      setHecho(null);
                      setAccion({ tipo: 'rechazar', pago });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {pagos.length >= TOPE_DE_LA_BANDEJA ? (
            <p className="text-sm text-slate-700">Se muestran los {TOPE_DE_LA_BANDEJA} más antiguos.</p>
          ) : null}
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : (
            <Alerta>No se pudieron cargar los pagos. {mensajeGeneral(consulta.error)}</Alerta>
          )}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando pagos…
        </p>
      )}

      {accion?.tipo === 'ver' ? (
        <VisorComprobante key={accion.pago.id} pago={accion.pago} alCerrar={() => setAccion(null)} />
      ) : null}
      {accion?.tipo === 'aprobar' ? (
        <DialogoAprobarPago key={accion.pago.id} pago={accion.pago} alCerrar={() => setAccion(null)} />
      ) : null}
      {accion?.tipo === 'rechazar' ? (
        <DialogoRechazarPago
          key={accion.pago.id}
          pago={accion.pago}
          alCerrar={() => setAccion(null)}
          alRechazar={(rechazado) => {
            const nombre = `${rechazado.cliente.nombres} ${rechazado.cliente.apellidos}`;
            setHecho(
              esRenovacion(rechazado)
                ? `Pago de ${nombre} (${rotuloDelPago(rechazado).toLowerCase()}) rechazado. Se liberó el cupo y el alumno puede renovar de nuevo ese mes.`
                : `Pago de ${nombre} (${rechazado.solicitud?.codigo ?? ''}) rechazado. El cliente verá el motivo en su seguimiento.`,
            );
            setAccion(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface PropiedadesTarjeta {
  pago: PagoPendiente;
  alVer: () => void;
  alAprobar: () => void;
  alRechazar: () => void;
}

function TarjetaPago({ pago, alVer, alAprobar, alRechazar }: PropiedadesTarjeta) {
  const nombre = `${pago.cliente.nombres} ${pago.cliente.apellidos}`;
  const renovacion = esRenovacion(pago);
  return (
    <article
      aria-label={`Pago de ${descripcionDelPago(pago)}`}
      className={`space-y-3 rounded-2xl bg-white p-4 shadow-sm sm:p-5 ${
        pago.mesTerminado ? 'ring-2 ring-amber-400' : 'ring-1 ring-sky-100'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-lg font-semibold text-slate-900 ${renovacion ? '' : 'font-mono tracking-wider'}`}>
            {rotuloDelPago(pago)}
          </p>
          <p className="break-words text-lg font-semibold text-slate-900">{nombre}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pago.mesTerminado ? <Insignia color="ambar">Mes terminado</Insignia> : null}
          <Insignia color="azul">{ETIQUETA_METODO[pago.metodo]}</Insignia>
        </div>
      </div>

      {pago.mesTerminado ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {renovacion
            ? `Es de ${formatearMes(pago.mes)}, un mes que ya terminó. Se puede aprobar o rechazar.`
            : `Es de ${formatearMes(pago.mes)}, un mes que ya terminó. Se puede aprobar o rechazar; si lo rechazas, el cliente ya no podrá volver a pagar.`}
        </p>
      ) : null}

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="font-medium text-slate-600 sm:text-slate-800">Monto</dt>
        <dd className="mb-2 text-lg font-semibold text-slate-900 sm:mb-0">{formatearSoles(pago.monto)}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">N.º de operación</dt>
        <dd className="mb-2 break-all font-mono text-slate-900 sm:mb-0">{pago.numeroOperacion}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">DNI</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">{pago.cliente.dni}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Mes</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">{formatearMes(pago.mes)}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Fecha de la operación</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">{formatearFechaCalendario(pago.fechaOperacion)}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Enviado</dt>
        <dd className="text-slate-900">{formatearFechaHora(pago.enviadoEn)}</dd>
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <button
          type="button"
          onClick={alVer}
          aria-label={`Ver el comprobante de ${descripcionDelPago(pago)}`}
          className={ESTILO_BOTON.secundario}
        >
          Ver comprobante
        </button>
        <button
          type="button"
          onClick={alRechazar}
          aria-label={`Rechazar el pago de ${descripcionDelPago(pago)}`}
          className={ESTILO_BOTON.secundario}
        >
          Rechazar
        </button>
        <button
          type="button"
          onClick={alAprobar}
          aria-label={`Aprobar el pago de ${descripcionDelPago(pago)}`}
          className={ESTILO_BOTON.primario}
        >
          Aprobar
        </button>
      </div>
    </article>
  );
}
