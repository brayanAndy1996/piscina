import { type Ticket } from '@aquagestion/contratos';
import { Link, useParams } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaHora, formatearMes } from '../../lib/fechas';
import { ETIQUETA_METODO } from '../caja/montos';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { useTicket } from './hooks';

const ETIQUETA_CONCEPTO: Readonly<Record<Ticket['concepto'], string>> = {
  INSCRIPCION: 'Inscripción',
  MENSUALIDAD: 'Mensualidad',
  CLASE_PARTICULAR: 'Clase particular',
  EGRESO_MENOR: 'Egreso menor',
};

/**
 * `/panel/pagos/{id}/ticket`: el ticket interno de un pago confirmado, para imprimir (HU-07, criterios 26 y 27 de 007; DR-4, DT-14). Es una
 * página: no genera archivos. Al imprimir se ocultan el marco del panel y los botones (ver `estilos.css`), y el ticket queda en una
 * columna angosta para papel de 80 mm o centrado en una hoja A4. `ADMIN` y `SECRETARIA`.
 */
export function PaginaTicket() {
  return (
    <RequierePermiso permiso="REGISTRAR_INSCRIPCION_Y_COBRO">
      <ContenidoTicket />
    </RequierePermiso>
  );
}

function ContenidoTicket() {
  const { id = '' } = useParams();
  const consulta = useTicket(id);
  useAlPerderSesion(consulta.error);
  const ticket = consulta.data;

  return (
    <div className="space-y-4">
      <Link to="/panel/solicitudes" className="inline-block text-sky-800 underline print:hidden">
        ← Volver a las solicitudes
      </Link>

      {ticket ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h1 className="text-2xl font-semibold text-slate-900">Ticket N.º {ticket.numero}</h1>
            <button type="button" onClick={() => window.print()} className={ESTILO_BOTON.primario}>
              Imprimir
            </button>
          </div>
          <TicketImpreso ticket={ticket} />
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : (
            <>
              <h1 className="text-2xl font-semibold text-slate-900">Ticket</h1>
              <Alerta>
                {esErrorDeApi(consulta.error, 404)
                  ? 'No encontramos ese ticket. Solo los pagos confirmados de tu academia tienen ticket.'
                  : `No se pudo cargar el ticket. ${mensajeGeneral(consulta.error)}`}
              </Alerta>
            </>
          )}
          {esErrorDeApi(consulta.error, 404) ? null : (
            <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando el ticket…
        </p>
      )}
    </div>
  );
}

/** El ticket tal como se imprime (criterio 26): sin DNI y con la leyenda fija de que no es un comprobante electrónico SUNAT. */
function TicketImpreso({ ticket }: { ticket: Ticket }) {
  return (
    <article
      aria-label="Ticket de pago"
      className="ticket mx-auto w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 text-slate-900 shadow-sm ring-1 ring-sky-100"
    >
      <header className="space-y-1 text-center">
        <p className="break-words text-lg font-semibold">{ticket.academia.nombre}</p>
        {ticket.academia.telefono ? <p className="text-sm">Teléfono: {ticket.academia.telefono}</p> : null}
        <p className="text-base font-semibold">Ticket N.º {ticket.numero}</p>
        <p className="text-sm">{formatearFechaHora(ticket.fechaHora)} (hora de Lima)</p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-y border-dashed border-slate-400 py-3 text-sm">
        <dt className="font-medium">Alumno</dt>
        <dd className="break-words text-right">
          {ticket.alumno.nombres} {ticket.alumno.apellidos}
        </dd>
        <dt className="font-medium">Concepto</dt>
        <dd className="text-right">{ETIQUETA_CONCEPTO[ticket.concepto]}</dd>
        <dt className="font-medium">Plan</dt>
        <dd className="break-words text-right">{ticket.plan.nombre}</dd>
        <dt className="font-medium">Mes</dt>
        <dd className="text-right">{formatearMes(ticket.mes)}</dd>
        <dt className="font-medium">Método</dt>
        <dd className="text-right">{ETIQUETA_METODO[ticket.metodo]}</dd>
        {ticket.numeroOperacion ? (
          <>
            <dt className="font-medium">N.º de operación</dt>
            <dd className="break-all text-right">{ticket.numeroOperacion}</dd>
          </>
        ) : null}
        <dt className="font-medium">Atendido por</dt>
        <dd className="break-words text-right">
          {ticket.cobradoPor.nombres} {ticket.cobradoPor.apellidos}
        </dd>
      </dl>

      <p className="flex items-baseline justify-between text-lg font-semibold">
        <span>Total</span>
        <span>{formatearSoles(ticket.monto)}</span>
      </p>
      <p className="text-center text-xs">El precio ya incluye IGV.</p>
      <p className="text-center text-xs">{ticket.leyenda}</p>
    </article>
  );
}
