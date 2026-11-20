import {
  type EstadoSolicitud,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  type RespuestaConsultaSolicitud,
} from '@aquagestion/contratos';
import { formatearSoles } from '../../lib/dinero';
import { formatearFechaHora, formatearMes } from '../../lib/fechas';
import { Insignia } from '../../componentes/ui';
import { frasePorTelefono } from '../../componentes/Telefono';

const ESTADO_EN_PALABRAS: Readonly<Record<EstadoSolicitud, { titulo: string; color: 'ambar' | 'gris' }>> = {
  PENDIENTE_PAGO: { titulo: 'Pendiente de pago', color: 'ambar' },
  VENCIDA: { titulo: 'Vencida', color: 'gris' },
  CANCELADA: { titulo: 'Cancelada', color: 'gris' },
};

function Explicacion({ respuesta }: { respuesta: RespuestaConsultaSolicitud }) {
  const { solicitud, academia } = respuesta;
  const ayuda = frasePorTelefono(academia.telefono);
  switch (solicitud.estado) {
    case 'PENDIENTE_PAGO':
      return (
        <p>
          Tu cupo está reservado
          {solicitud.reservaVenceEn ? ` hasta el ${formatearFechaHora(solicitud.reservaVenceEn)} (hora de Lima)` : ''}.
          Paga {formatearSoles(solicitud.monto)} en recepción antes de esa hora para confirmar tu inscripción; si no, el
          cupo se libera.{ayuda}
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
  }
}

/**
 * Lo que muestra el seguimiento (criterio 44 de 005, DR-9): el estado en palabras, el plan, los días y las horas, el mes, el monto, la
 * fecha límite de la reserva y el teléfono de la academia. Es la vista mínima de la API: no hay nada más que mostrar.
 */
export function VistaSeguimiento({ respuesta }: { respuesta: RespuestaConsultaSolicitud }) {
  const { solicitud } = respuesta;
  const estado = ESTADO_EN_PALABRAS[solicitud.estado];
  return (
    <article
      aria-label="Tu solicitud"
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-slate-700">Hola, {solicitud.nombres}</p>
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
        {solicitud.reservaVenceEn ? (
          <>
            <dt className="font-medium text-slate-600 sm:text-slate-800">Reserva hasta</dt>
            <dd className="text-slate-900 mb-2 sm:mb-0">{formatearFechaHora(solicitud.reservaVenceEn)}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}
