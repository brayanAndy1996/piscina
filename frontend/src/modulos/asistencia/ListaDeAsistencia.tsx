import { type AsistenciaDelMes, NOMBRE_DIA, type RegistroDeAsistencia } from '@aquagestion/contratos';
import { Insignia } from '../../componentes/ui';
import { diaDeLaSemanaDeFecha, formatearFechaCalendario, formatearMes } from '../../lib/fechas';
import { ETIQUETA_REGISTRO } from './mensajes';

interface Propiedades {
  datos: AsistenciaDelMes;
  /** El mes de `datos` (`AAAA-MM`): solo para los textos. */
  mes: string;
  /** «Manual» o «Posterior» junto a la hora de llegada: lo ve el personal, no la familia (spec 011, criterio 18). */
  mostrarOrigen?: boolean;
  /** El texto cuando no hubo mensualidad ese mes, según quién lee («No tuvo…» o «No tuviste…»). */
  sinMensualidad?: string;
}

function textoDeLlegada(registro: RegistroDeAsistencia, mostrarOrigen: boolean): string {
  const origen = !mostrarOrigen
    ? null
    : registro.registroPosterior
      ? 'Posterior'
      : registro.metodo === 'MANUAL'
        ? 'Manual'
        : null;
  return `Llegó a las ${registro.horaLlegada}${origen ? ` · ${origen}` : ''}`;
}

function Total({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <dt className="text-sm text-slate-700">{etiqueta}</dt>
      <dd className="text-2xl font-semibold text-slate-900">{valor}</dd>
    </div>
  );
}

/**
 * Los totales del mes y la lista de cada día con «Puntual», «Tarde» o «Falta» y la hora de llegada. La comparten la ficha de recepción
 * (`AsistenciaDelMes`, 009b) y el panel del alumno (011, DT-10). Los totales se cuentan de los registros que responde la API; las clases
 * restantes son las de la matrícula de ese mes.
 */
export function ListaDeAsistencia({
  datos,
  mes,
  mostrarOrigen = true,
  sinMensualidad = `No tuvo una mensualidad en ${formatearMes(mes)}.`,
}: Propiedades) {
  const puntuales = datos.registros.filter((r) => r.tipo === 'ASISTENCIA' && r.estadoLlegada === 'PUNTUAL').length;
  const tardes = datos.registros.filter((r) => r.tipo === 'ASISTENCIA' && r.estadoLlegada === 'TARDE').length;
  const faltas = datos.registros.filter((r) => r.tipo === 'FALTA').length;

  return (
    <>
      <dl aria-label={`Totales de ${formatearMes(mes)}`} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Total etiqueta="Puntual" valor={puntuales} />
        <Total etiqueta="Tarde" valor={tardes} />
        <Total etiqueta="Faltas" valor={faltas} />
        <Total etiqueta="Clases restantes" valor={datos.matricula ? datos.matricula.clasesRestantes : '—'} />
      </dl>
      {datos.matricula === null ? <p className="text-sm text-slate-600">{sinMensualidad}</p> : null}
      {datos.registros.length === 0 ? (
        <p className="text-slate-700">No hay asistencias ni faltas en {formatearMes(mes)}.</p>
      ) : (
        <ul aria-label={`Asistencia de ${formatearMes(mes)}`} className="divide-y divide-slate-200">
          {datos.registros.map((registro) => {
            const etiqueta =
              registro.tipo === 'FALTA' ? ETIQUETA_REGISTRO.FALTA : ETIQUETA_REGISTRO[registro.estadoLlegada];
            const color = registro.tipo === 'FALTA' ? 'rojo' : registro.estadoLlegada === 'PUNTUAL' ? 'verde' : 'ambar';
            return (
              <li
                key={`${registro.fecha}-${registro.clase.horaInicio}-${registro.tipo}`}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {NOMBRE_DIA[diaDeLaSemanaDeFecha(registro.fecha)]} {formatearFechaCalendario(registro.fecha)}
                  </p>
                  <p className="text-sm text-slate-700">
                    Clase de {registro.clase.horaInicio} a {registro.clase.horaFin}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Insignia color={color}>{etiqueta}</Insignia>
                  {registro.tipo === 'ASISTENCIA' ? (
                    <span className="text-sm text-slate-700">{textoDeLlegada(registro, mostrarOrigen)}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
