import { NOMBRE_DIA, NOMBRE_NIVEL, type RespuestaConsultaSolicitud } from '@aquagestion/contratos';
import { Link, useParams } from 'react-router';
import { formatearSoles } from '../../lib/dinero';
import { ESTADO_EN_PALABRAS } from '../../lib/estado-solicitud';
import { formatearFecha, formatearFechaCalendario, formatearFechaHora, formatearMes } from '../../lib/fechas';
import { Insignia } from '../../componentes/ui';
import { frasePorTelefono } from '../../componentes/Telefono';
import { ETIQUETA_METODO } from '../caja/montos';

function Explicacion({ respuesta }: { respuesta: RespuestaConsultaSolicitud }) {
  const { solicitud, academia } = respuesta;
  const { nombreCorto = '' } = useParams();
  const ayuda = frasePorTelefono(academia.telefono);
  switch (solicitud.estado) {
    case 'PENDIENTE_PAGO':
      return (
        <p>
          Tu cupo está reservado
          {solicitud.reservaVenceEn ? ` hasta el ${formatearFechaHora(solicitud.reservaVenceEn)} (hora de Lima)` : ''}.
          Paga {formatearSoles(solicitud.monto)} en recepción, o con Yape o transferencia desde esta página, antes de
          esa hora para confirmar tu inscripción; si no, el cupo se libera.{ayuda}
        </p>
      );
    case 'VENCIDA':
      return (
        <p>
          La reserva venció y el cupo se liberó. Si todavía quieres inscribirte, llena el formulario de nuevo.{ayuda}
        </p>
      );
    case 'CANCELADA':
      return <p>La academia canceló esta solicitud y el cupo se liberó.{ayuda}</p>;
    case 'CONFIRMADA':
      return (
        <div className="space-y-2">
          <p>
            Tu pago está confirmado y tu inscripción quedó lista. Para ingresar usa tu DNI como usuario y como
            contraseña inicial: el sistema te pedirá cambiarla en tu primer ingreso.
          </p>
          <Link
            to={`/a/${encodeURIComponent(nombreCorto)}/ingresar`}
            className="inline-block min-h-11 py-2 text-base text-sky-800 underline"
          >
            Ingresar con mi DNI
          </Link>
        </div>
      );
    case 'EN_VERIFICACION':
      return (
        <p>
          Recibimos tu comprobante y la academia lo está revisando. Tu cupo sigue reservado mientras tanto. Vuelve a
          esta página más tarde para ver el resultado.{ayuda}
        </p>
      );
    case 'PAGO_RECHAZADO':
      return (
        <p>
          No pudimos confirmar tu pago. Motivo: {solicitud.rechazo.motivo}. Puedes enviar otro comprobante o pagar en
          recepción hasta el {formatearFecha(solicitud.pagableHasta)}.{ayuda}
        </p>
      );
  }
}

/**
 * Lo que muestra el seguimiento (criterio 44 de 005, DR-9): el estado en palabras, el plan, los días y las horas, el mes, el monto, la
 * fecha límite de la reserva y el teléfono de la academia. Es la vista mínima de la API: no hay nada más que mostrar.
 */
export function VistaSeguimiento({ respuesta }: { respuesta: RespuestaConsultaSolicitud }) {
  const { solicitud } = respuesta;
  const estado = ESTADO_EN_PALABRAS[solicitud.estado];
  // La vista reducida (VENCIDA y CANCELADA, criterio 58) no trae el nombre ni el vencimiento: solo la completa los lleva. Los estados
  // con pago (007) traen el primer nombre, pero no vencimiento.
  const completa = solicitud.estado === 'PENDIENTE_PAGO' ? solicitud : null;
  const nombre = 'nombres' in solicitud ? solicitud.nombres : null;
  const pagoConfirmado = solicitud.estado === 'CONFIRMADA' ? solicitud.pago : null;
  const pagoEnRevision = solicitud.estado === 'EN_VERIFICACION' ? solicitud.pago : null;
  return (
    <article
      aria-label="Tu solicitud"
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {nombre ? <p className="text-sm text-slate-700">Hola, {nombre}</p> : null}
          <p className="text-sm text-slate-700">Código de la solicitud</p>
          <p className="font-mono text-2xl font-semibold tracking-wider text-slate-900">{solicitud.codigo}</p>
        </div>
        <Insignia color={estado.color}>{estado.titulo}</Insignia>
      </div>

      <div className="text-slate-800">
        <Explicacion respuesta={respuesta} />
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-slate-600 sm:text-slate-800">Plan</dt>
        <dd className="break-words text-slate-900 mb-2 sm:mb-0">{solicitud.plan.nombre}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Días y horas</dt>
        <dd className="text-slate-900 mb-2 sm:mb-0">
          <ul>
            {solicitud.clases.map((clase) => (
              <li key={`${clase.diaSemana}-${clase.horaInicio}`}>
                {NOMBRE_DIA[clase.diaSemana]} de {clase.horaInicio} a {clase.horaFin} ({NOMBRE_NIVEL[clase.nivel]})
              </li>
            ))}
          </ul>
        </dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Mes</dt>
        <dd className="text-slate-900 mb-2 sm:mb-0">{formatearMes(solicitud.mes)}</dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Clases</dt>
        <dd className="text-slate-900 mb-2 sm:mb-0">
          {solicitud.clasesTotales}
          {solicitud.esProporcional ? ' (proporcional al resto del mes)' : ''}
        </dd>
        <dt className="font-medium text-slate-600 sm:text-slate-800">Monto</dt>
        <dd className="text-slate-900 mb-2 sm:mb-0">{formatearSoles(solicitud.monto)} (el precio ya incluye IGV)</dd>
        {pagoConfirmado ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Pago</dt>
            <dd className="text-slate-900 mb-2 sm:mb-0">
              {ETIQUETA_METODO[pagoConfirmado.metodo]}, confirmado el {formatearFechaHora(pagoConfirmado.confirmadoEn)}{' '}
              (ticket N.º {pagoConfirmado.numeroTicket})
            </dd>
          </>
        ) : null}
        {pagoEnRevision ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Comprobante</dt>
            <dd className="text-slate-900 mb-2 sm:mb-0">
              {ETIQUETA_METODO[pagoEnRevision.metodo]} por {formatearSoles(pagoEnRevision.monto)}, operación del{' '}
              {formatearFechaCalendario(pagoEnRevision.fechaOperacion)}, enviado el{' '}
              {formatearFechaHora(pagoEnRevision.enviadoEn)}
            </dd>
          </>
        ) : null}
        {completa?.reservaVenceEn ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Reserva hasta</dt>
            <dd className="text-slate-900 mb-2 sm:mb-0">{formatearFechaHora(completa.reservaVenceEn)}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}
