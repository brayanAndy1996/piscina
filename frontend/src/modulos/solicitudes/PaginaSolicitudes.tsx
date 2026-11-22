import {
  FILTROS_ESTADO_SOLICITUDES,
  type FiltroEstadoSolicitudes,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  type SolicitudPanel,
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
import { ESTADO_EN_PALABRAS } from '../../lib/estado-solicitud';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { DialogoCancelarSolicitud } from './DialogoCancelarSolicitud';
import { useSolicitudes } from './hooks';

const TEXTO_DEL_FILTRO: Readonly<Record<FiltroEstadoSolicitudes, string>> = {
  ACTIVAS: 'Activas',
  VENCIDAS: 'Vencidas',
  CANCELADAS: 'Canceladas',
  TODAS: 'Todas',
};

const SIN_SOLICITUDES: Readonly<Record<FiltroEstadoSolicitudes, string>> = {
  ACTIVAS: 'No hay solicitudes activas.',
  VENCIDAS: 'No hay solicitudes vencidas.',
  CANCELADAS: 'No hay solicitudes canceladas.',
  TODAS: 'Todavía no hay solicitudes.',
};

/** `/panel/solicitudes`: las solicitudes de inscripción de la academia, para cancelarlas si hace falta (HU-01). `ADMIN` y `SECRETARIA`. */
export function PaginaSolicitudes() {
  return (
    <RequierePermiso permiso="REGISTRAR_INSCRIPCION_Y_COBRO">
      <ContenidoSolicitudes />
    </RequierePermiso>
  );
}

function ContenidoSolicitudes() {
  const [filtro, setFiltro] = useState<FiltroEstadoSolicitudes>('ACTIVAS');
  const [aCancelar, setACancelar] = useState<SolicitudPanel | null>(null);
  const [cancelada, setCancelada] = useState<SolicitudPanel | null>(null);
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
        Lo que enviaron los clientes desde el formulario. Una solicitud sin pagar guarda sus cupos hasta que vence su
        reserva; si el cliente ya no va a venir, cancélala para liberar el cupo.
      </p>

      <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {FILTROS_ESTADO_SOLICITUDES.map((opcion) => (
          <button
            key={opcion}
            type="button"
            aria-pressed={opcion === filtro}
            onClick={() => {
              setFiltro(opcion);
              setCancelada(null);
            }}
            className={`min-h-11 rounded-lg px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
              opcion === filtro ? 'bg-sky-700 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300'
            }`}
          >
            {TEXTO_DEL_FILTRO[opcion]}
          </button>
        ))}
      </div>

      {cancelada ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          Solicitud {cancelada.codigo} cancelada. El cupo quedó libre.
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
                  <TarjetaSolicitud solicitud={solicitud} alCancelar={() => setACancelar(solicitud)} />
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
            setCancelada(hecha);
            setACancelar(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TarjetaSolicitud({ solicitud, alCancelar }: { solicitud: SolicitudPanel; alCancelar: () => void }) {
  const estado = ESTADO_EN_PALABRAS[solicitud.estado];
  const sePuedeCancelar = solicitud.estado === 'PENDIENTE_PAGO' || solicitud.estado === 'VENCIDA';
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
        <dt className="font-medium text-slate-600 sm:text-slate-800">Monto</dt>
        <dd className="mb-2 text-slate-900 sm:mb-0">{formatearSoles(solicitud.monto)}</dd>
        {solicitud.reservaVenceEn ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Reserva hasta</dt>
            <dd className="mb-2 text-slate-900 sm:mb-0">{formatearFechaHora(solicitud.reservaVenceEn)}</dd>
          </>
        ) : null}
        <dt className="font-medium text-slate-600 sm:text-slate-800">Creada</dt>
        <dd className="text-slate-900">{formatearFechaHora(solicitud.creadaEn)}</dd>
      </dl>

      {sePuedeCancelar ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={alCancelar}
            aria-label={`Cancelar la solicitud ${solicitud.codigo}`}
            className={ESTILO_BOTON.secundario}
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </article>
  );
}
