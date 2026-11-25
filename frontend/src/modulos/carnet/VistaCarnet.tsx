import { type Carnet, NOMBRE_NIVEL, resumenDeHorario } from '@aquagestion/contratos';
import type { ReactNode } from 'react';
import { Insignia } from '../../componentes/ui';
import { formatearFechaCalendario, formatearFechaHora } from '../../lib/fechas';
import { COLOR_ESTADO_ALUMNO, ETIQUETA_ESTADO_ALUMNO } from './etiquetas';
import { QrDelCarnet } from './QrDelCarnet';

interface Propiedades {
  carnet: Carnet;
  /** Los botones que le tocan a quien mira (descargar, regenerar). El carnet del alumno solo lleva la descarga. */
  acciones?: ReactNode;
}

/**
 * La tarjeta del carnet digital (HU-13, criterios 7 a 10, 19 y 20 de 008): la academia, la foto (o «Foto pendiente», D-24), el nombre, el DNI,
 * el nivel, el plan, el horario, la vigencia y el QR. La usan el panel del alumno y el del personal. Solo muestra lo que trae `carnetSchema`; el
 * texto del QR solo se usa para dibujarlo. Sin acciones de edición (D-14).
 */
export function VistaCarnet({ carnet, acciones }: Propiedades) {
  const { academia, alumno, foto, matricula, qr } = carnet;
  const nombre = `${alumno.nombres} ${alumno.apellidos}`;

  return (
    <article
      aria-label={`Carnet de ${nombre}`}
      className="mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-sky-200"
    >
      <header className="bg-sky-800 px-4 py-3 text-center text-white">
        <p className="break-words text-sm font-medium uppercase tracking-wide text-sky-100">Carnet de alumno</p>
        <p className="break-words text-lg font-semibold">{academia.nombre}</p>
      </header>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          {foto ? (
            <img
              src={foto}
              alt={`Foto de ${nombre}`}
              className="h-28 w-24 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
            />
          ) : (
            <div
              role="img"
              aria-label="Foto pendiente"
              className="flex h-28 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-100 p-2 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-200"
            >
              Foto pendiente
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <h2 className="break-words text-xl font-semibold text-slate-900">{nombre}</h2>
            <p className="text-slate-700">
              DNI <span className="font-mono text-slate-900">{alumno.dni}</span>
            </p>
            <p className="flex flex-wrap items-center gap-2 text-slate-700">
              <span>Nivel {NOMBRE_NIVEL[alumno.nivel]}</span>
              <Insignia color={COLOR_ESTADO_ALUMNO[alumno.estado]}>{ETIQUETA_ESTADO_ALUMNO[alumno.estado]}</Insignia>
            </p>
          </div>
        </div>

        {matricula ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-slate-700">
            <dt className="font-medium">Plan</dt>
            <dd className="break-words text-slate-900">{matricula.plan}</dd>
            <dt className="font-medium">Horario</dt>
            <dd className="text-slate-900">{resumenDeHorario(matricula.clases)}</dd>
            <dt className="font-medium">Vigencia</dt>
            <dd className="text-slate-900">
              Del {formatearFechaCalendario(matricula.desde)} al {formatearFechaCalendario(matricula.hasta)}{' '}
              <span className={matricula.vigenteHoy ? 'text-emerald-800' : 'text-amber-800'}>
                ({matricula.vigenteHoy ? 'vigente hoy' : 'no vigente hoy'})
              </span>
            </dd>
          </dl>
        ) : (
          <p className="rounded-lg bg-slate-50 p-3 text-slate-700">Sin matrícula registrada.</p>
        )}

        <section
          aria-label="Código QR"
          className="flex flex-col items-center gap-2 border-t border-dashed border-slate-300 pt-5"
        >
          {qr ? (
            <>
              <QrDelCarnet contenido={qr.contenido} />
              <p className="text-center text-sm text-slate-700">Muestra este QR en la entrada de la piscina.</p>
              <p className="text-center text-xs text-slate-600">QR generado el {formatearFechaHora(qr.generadoEn)}</p>
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-center text-amber-900 ring-1 ring-amber-200">
              QR sin generar: pide en recepción que lo generen
            </p>
          )}
        </section>

        {acciones ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">{acciones}</div>
        ) : null}
      </div>
    </article>
  );
}
