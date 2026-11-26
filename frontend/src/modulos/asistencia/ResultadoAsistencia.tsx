import {
  CODIGOS_RECHAZO_ASISTENCIA,
  type AlumnoDeAsistencia,
  type ClasesDeAsistencia,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
} from '@aquagestion/contratos';
import type { ReactNode } from 'react';
import type { RespuestaDeMarcado } from './hooks';
import { detalleDeRechazo, ETIQUETA_ESTADO_LLEGADA, MOTIVO_DE_RECHAZO } from './mensajes';

/**
 * El resultado de marcar (HU-14, criterio 19): verde si quedó registrada, rojo si el alumno no puede ingresar y amarillo si está fuera de su
 * horario o ya marcó hoy. El color nunca va solo: cada uno lleva su título y su motivo escritos. La foto, el nombre y las clases salen de la
 * respuesta; aquí no se calcula nada del negocio.
 */
export function ResultadoAsistencia({ respuesta }: { respuesta: RespuestaDeMarcado }) {
  if (respuesta.tipo === 'REGISTRADA') {
    const { resultado } = respuesta;
    const { asistencia, alumno, clase, clases } = resultado;
    return (
      <Tarjeta color="verde" titulo="Asistencia registrada" alumno={alumno}>
        <p className="text-lg font-medium">
          Clase de {NOMBRE_DIA[clase.diaSemana]} de {clase.horaInicio} a {clase.horaFin}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="rounded-full bg-emerald-700 px-3 py-1 text-base font-semibold text-white">
            {ETIQUETA_ESTADO_LLEGADA[asistencia.estadoLlegada]}
          </span>
          <span>Llegó a las {asistencia.horaLlegada}</span>
        </p>
        <LeQuedan clases={clases} />
        {resultado.repetida ? (
          <p className="text-sm">Esta asistencia ya estaba registrada con el mismo intento.</p>
        ) : null}
      </Tarjeta>
    );
  }

  const { codigo, rechazo } = respuesta;
  const color = CODIGOS_RECHAZO_ASISTENCIA[codigo] === 'ROJA' ? 'rojo' : 'amarillo';
  const detalle = detalleDeRechazo(codigo, rechazo, respuesta.horaLocal);
  return (
    <Tarjeta color={color} titulo={color === 'rojo' ? 'No puede ingresar' : 'Atención'} alumno={rechazo.alumno}>
      <p className="text-lg font-semibold">{MOTIVO_DE_RECHAZO[codigo]}</p>
      {detalle ? <p className="text-base">{detalle}</p> : null}
      {rechazo.clases ? <LeQuedan clases={rechazo.clases} /> : null}
    </Tarjeta>
  );
}

function LeQuedan({ clases }: { clases: ClasesDeAsistencia }) {
  return (
    <p className="text-lg font-semibold">
      Le quedan {clases.restantes} de {clases.totales}
    </p>
  );
}

const ESTILO_COLOR = {
  verde: { marco: 'bg-emerald-50 text-emerald-950 ring-emerald-400', banda: 'bg-emerald-700 text-white' },
  rojo: { marco: 'bg-red-50 text-red-950 ring-red-400', banda: 'bg-red-700 text-white' },
  amarillo: { marco: 'bg-amber-50 text-amber-950 ring-amber-400', banda: 'bg-amber-300 text-amber-950' },
} as const;

function Tarjeta({
  color,
  titulo,
  alumno,
  children,
}: {
  color: keyof typeof ESTILO_COLOR;
  titulo: string;
  alumno: AlumnoDeAsistencia;
  children: ReactNode;
}) {
  const estilo = ESTILO_COLOR[color];
  const nombre = `${alumno.nombres} ${alumno.apellidos}`;
  return (
    <article
      aria-label={`Resultado: ${titulo}`}
      data-color={color}
      className={`overflow-hidden rounded-2xl shadow-sm ring-2 ${estilo.marco}`}
    >
      <h2 className={`px-4 py-3 text-xl font-bold sm:text-2xl ${estilo.banda}`}>{titulo}</h2>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
        {alumno.foto ? (
          <img
            src={alumno.foto}
            alt={`Foto de ${nombre}`}
            className="h-40 w-32 shrink-0 self-center rounded-lg object-cover ring-1 ring-slate-300 sm:self-start"
          />
        ) : (
          <div
            role="img"
            aria-label="Foto pendiente"
            className="flex h-40 w-32 shrink-0 items-center justify-center self-center rounded-lg bg-white p-2 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-300 sm:self-start"
          >
            Foto pendiente
          </div>
        )}
        <div className="min-w-0 space-y-2">
          <p className="break-words text-2xl font-semibold">{nombre}</p>
          <p className="text-lg">Nivel {NOMBRE_NIVEL[alumno.nivel]}</p>
          {children}
        </div>
      </div>
    </article>
  );
}
