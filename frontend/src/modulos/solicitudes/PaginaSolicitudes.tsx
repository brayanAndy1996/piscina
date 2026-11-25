import {
  FILTROS_ESTADO_SOLICITUDES,
  type FiltroEstadoSolicitudes,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  type SolicitudPanel,
  puede,
  TOPE_DE_LA_LISTA,
} from '@aquagestion/contratos';
import { useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { enlaceTelefono } from '../../componentes/Telefono';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { formatearFechaHora, formatearMes } from '../../lib/fechas';
import { mensajeGeneral } from '../../lib/errores';
import { ESTADO_DE_PAGO_EN_PALABRAS, ESTADO_EN_PALABRAS } from '../../lib/estado-solicitud';
import { ETIQUETA_METODO } from '../caja/montos';
import { useUsuario } from '../sesion/contexto';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { DialogoAjustarMonto } from './DialogoAjustarMonto';
import { DialogoCancelarSolicitud } from './DialogoCancelarSolicitud';
import { DialogoCobrarEfectivo } from './DialogoCobrarEfectivo';
import { useSolicitudes } from './hooks';

const TEXTO_DEL_FILTRO: Readonly<Record<FiltroEstadoSolicitudes, string>> = {
  ACTIVAS: 'Activas',
  VENCIDAS: 'Vencidas',
  CANCELADAS: 'Canceladas',
  CONFIRMADAS: 'Confirmadas',
  TODAS: 'Todas',
};

const SIN_SOLICITUDES: Readonly<Record<FiltroEstadoSolicitudes, string>> = {
  ACTIVAS: 'No hay solicitudes activas.',
  VENCIDAS: 'No hay solicitudes vencidas.',
  CANCELADAS: 'No hay solicitudes canceladas.',
  CONFIRMADAS: 'No hay solicitudes confirmadas.',
  TODAS: 'Todavía no hay solicitudes.',
};

/**
 * `/panel/solicitudes`: las solicitudes de inscripción de la academia, para cobrarlas en efectivo, ajustar su monto (solo el administrador),
 * imprimir el ticket de las pagadas y cancelarlas si hace falta (HU-01, HU-07, HU-34). `ADMIN` y `SECRETARIA`.
 */
export function PaginaSolicitudes() {
  return (
    <RequierePermiso permiso="REGISTRAR_INSCRIPCION_Y_COBRO">
      <ContenidoSolicitudes />
    </RequierePermiso>
  );
}

function ContenidoSolicitudes() {
  const [filtro, setFiltro] = useState<FiltroEstadoSolicitudes>('ACTIVAS');
  const usuario = useUsuario();
  const puedeAjustar = puede(usuario.rol, 'AJUSTAR_MONTO_COBRO');
  const [aCancelar, setACancelar] = useState<SolicitudPanel | null>(null);
  const [aCobrar, setACobrar] = useState<SolicitudPanel | null>(null);
  const [aAjustar, setAAjustar] = useState<SolicitudPanel | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const consulta = useSolicitudes(filtro);
  useAlPerderSesion(consulta.error);
  const solicitudes = consulta.data;

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Solicitudes de inscripción</h1>
      <p className="text-slate-700">
        Lo que enviaron los clientes desde el formulario. Cobra en efectivo a quien paga en recepción (con la caja de
        hoy abierta). Una solicitud sin pagar guarda sus cupos hasta que vence su reserva; si el cliente ya no va a
        venir, cancélala para liberar el cupo.
      </p>

      <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {FILTROS_ESTADO_SOLICITUDES.map((opcion) => (
          <button
            key={opcion}
            type="button"
            aria-pressed={opcion === filtro}
            onClick={() => {
              setFiltro(opcion);
              setHecho(null);
            }}
            className={`min-h-11 rounded-lg px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
              opcion === filtro ? 'bg-sky-700 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300'
            }`}
          >
            {TEXTO_DEL_FILTRO[opcion]}
          </button>
        ))}
      </div>

      {hecho ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          {hecho}
        </p>
      ) : null}

      {solicitudes ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar la lista. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          {solicitudes.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
              {SIN_SOLICITUDES[filtro]}
            </p>
          ) : (
            <ul aria-label="Solicitudes" className="space-y-3">
              {solicitudes.map((solicitud) => (
                <li key={solicitud.id}>
                  <TarjetaSolicitud
                    solicitud={solicitud}
                    puedeAjustar={puedeAjustar}
                    alCancelar={() => {
                      setHecho(null);
                      setACancelar(solicitud);
                    }}
                    alCobrar={() => {
                      setHecho(null);
                      setACobrar(solicitud);
                    }}
                    alAjustar={() => {
                      setHecho(null);
                      setAAjustar(solicitud);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {solicitudes.length >= TOPE_DE_LA_LISTA ? (
            <p className="text-sm text-slate-700">Se muestran las {TOPE_DE_LA_LISTA} más recientes.</p>
          ) : null}
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : (
            <Alerta>No se pudieron cargar las solicitudes. {mensajeGeneral(consulta.error)}</Alerta>
          )}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando solicitudes…
        </p>
      )}

      {aCancelar ? (
        <DialogoCancelarSolicitud
          key={aCancelar.id}
          solicitud={aCancelar}
          alCerrar={() => setACancelar(null)}
          alCancelar={(hecha) => {
            setHecho(`Solicitud ${hecha.codigo} cancelada. El cupo quedó libre.`);
            setACancelar(null);
          }}
        />
      ) : null}

      {aCobrar ? (
        <DialogoCobrarEfectivo key={aCobrar.id} solicitud={aCobrar} alCerrar={() => setACobrar(null)} />
      ) : null}

      {aAjustar ? (
        <DialogoAjustarMonto
          key={aAjustar.id}
          solicitud={aAjustar}
          alCerrar={() => setAAjustar(null)}
          alAjustar={(ajustada) => {
            setHecho(`Monto de la solicitud ${ajustada.codigo} ajustado a ${formatearSoles(ajustada.monto)}.`);
            setAAjustar(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface PropiedadesTarjeta {
  solicitud: SolicitudPanel;
  puedeAjustar: boolean;
  alCancelar: () => void;
  alCobrar: () => void;
  alAjustar: () => void;
}

function TarjetaSolicitud({ solicitud, puedeAjustar, alCancelar, alCobrar, alAjustar }: PropiedadesTarjeta) {
  const estado = ESTADO_EN_PALABRAS[solicitud.estado];
  const sePuedeCancelar = solicitud.estado === 'PENDIENTE_PAGO' || solicitud.estado === 'VENCIDA';
  const sePuedeCobrar = solicitud.estado === 'PENDIENTE_PAGO';
  const ticket = solicitud.estado === 'CONFIRMADA' && solicitud.pago?.estado === 'CONFIRMADO' ? solicitud.pago : null;
  return (
    <article
      aria-label={`Solicitud ${solicitud.codigo}`}
      className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-lg font-semibold tracking-wider text-slate-900">{solicitud.codigo}</p>
          <p className="break-words text-lg font-semibold text-slate-900">
            {solicitud.nombres} {solicitud.apellidos}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {solicitud.menorDeEdad ? <Insignia color="azul">Menor de edad</Insignia> : null}
          <Insignia color={estado.color}>{estado.titulo}</Insignia>
        </div>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="font-medium text-slate-600 sm:text-slate-800">DNI</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">{solicitud.dni}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Teléfono</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">
          <a href={enlaceTelefono(solicitud.telefono)} className="text-sky-800 underline">
            {solicitud.telefono}
          </a>
        </dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Plan</dt>
        <dd className="mb-2 break-words text-slate-900 sm:mb-0">{solicitud.plan.nombre}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Mes</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">
          {formatearMes(solicitud.mes)} ({solicitud.clasesTotales} clases)
        </dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Días y horas</dt>
        <dd className="mb-2 text-slate-900 sm:col-span-3 sm:mb-0">
          <ul>
            {solicitud.clases.map((clase) => (
              <li key={clase.id}>
                {NOMBRE_DIA[clase.diaSemana]} de {clase.horaInicio} a {clase.horaFin} ({NOMBRE_NIVEL[clase.nivel]})
              </li>
            ))}
          </ul>
        </dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Total</dt>
        <dd className={`mb-2 font-semibold text-slate-900 sm:mb-0 ${solicitud.reservaVenceEn ? '' : 'sm:col-span-3'}`}>
          {formatearSoles(solicitud.monto)}
        </dd>
        {solicitud.reservaVenceEn ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Reserva hasta</dt>
            <dd className="mb-2 text-slate-900 sm:mb-0">{formatearFechaHora(solicitud.reservaVenceEn)}</dd>
          </>
        ) : null}
        {solicitud.ajuste ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Ajuste</dt>
            <dd className="mb-2 break-words text-slate-900 sm:col-span-3 sm:mb-0">
              Monto ajustado por el administrador (calculado: {formatearSoles(solicitud.ajuste.montoCalculado)}).
              Motivo: {solicitud.ajuste.motivo}
            </dd>
          </>
        ) : null}
        {solicitud.pago ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Pago</dt>
            <dd className="mb-2 break-words text-slate-900 sm:col-span-3 sm:mb-0">
              <ResumenDelPago pago={solicitud.pago} />
            </dd>
          </>
        ) : null}
        <dt className="font-medium text-slate-600 sm:text-slate-800">Creada</dt>
        <dd className="text-slate-900">{formatearFechaHora(solicitud.creadaEn)}</dd>
      </dl>

      {sePuedeCobrar || sePuedeCancelar || ticket ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {sePuedeCancelar ? (
            <button
              type="button"
              onClick={alCancelar}
              aria-label={`Cancelar la solicitud ${solicitud.codigo}`}
              className={ESTILO_BOTON.secundario}
            >
              Cancelar
            </button>
          ) : null}
          {sePuedeCobrar && puedeAjustar ? (
            <button
              type="button"
              onClick={alAjustar}
              aria-label={`Ajustar el monto de la solicitud ${solicitud.codigo}`}
              className={ESTILO_BOTON.secundario}
            >
              Ajustar monto
            </button>
          ) : null}
          {sePuedeCobrar ? (
            <button
              type="button"
              onClick={alCobrar}
              aria-label={`Cobrar en efectivo la solicitud ${solicitud.codigo}`}
              className={ESTILO_BOTON.primario}
            >
              Cobrar en efectivo
            </button>
          ) : null}
          {ticket ? (
            <Link
              to={`/panel/pagos/${encodeURIComponent(ticket.id)}/ticket`}
              aria-label={`Imprimir el ticket de la solicitud ${solicitud.codigo}`}
              className={ESTILO_BOTON.secundario}
            >
              Imprimir ticket
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** El último pago de la matrícula en una línea: método, estado, cuándo y, si lo hay, el número de operación, el motivo del rechazo y el ticket. */
function ResumenDelPago({ pago }: { pago: NonNullable<SolicitudPanel['pago']> }) {
  const cuando = pago.verificadoEn ?? pago.registradoEn;
  return (
    <>
      {ETIQUETA_METODO[pago.metodo]} · {ESTADO_DE_PAGO_EN_PALABRAS[pago.estado]} el {formatearFechaHora(cuando)}
      {pago.numeroTicket !== null ? ` · Ticket N.º ${pago.numeroTicket}` : ''}
      {pago.numeroOperacion ? ` · Operación ${pago.numeroOperacion}` : ''}
      {pago.motivoRechazo ? ` · Motivo del rechazo: ${pago.motivoRechazo}` : ''}
    </>
  );
}
