import { type RegistroDeAsistencia, NOMBRE_DIA, type ResultadoAsistencia } from '@aquagestion/contratos';
import { useId, useState } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoSelect, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import {
  diaDeLaSemanaDeFecha,
  formatearFechaCalendario,
  formatearMes,
  mesActualEnLima,
  mesAnterior,
} from '../../lib/fechas';
import { useAsistenciaDelMes } from '../asistencia/hooks';
import { ETIQUETA_ESTADO_LLEGADA, ETIQUETA_REGISTRO, mensajeDeAsistenciaDelMes } from '../asistencia/mensajes';
import { useAlPerderSesion } from '../sesion/hooks';
import { DialogoAsistenciaPosterior } from './DialogoAsistenciaPosterior';

interface Propiedades {
  alumnoId: string;
  nombre: string;
  /** `REGISTRAR_ASISTENCIA`: sin él la sección es de solo consulta y no ofrece el registro posterior. */
  puedeRegistrar: boolean;
}

type MesElegido = 'actual' | 'anterior';

function textoDeLlegada(registro: RegistroDeAsistencia): string {
  const origen = registro.registroPosterior ? 'Posterior' : registro.metodo === 'MANUAL' ? 'Manual' : null;
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
 * La sección «Asistencia» de `/panel/alumnos/{id}` (009b, criterios 31 y 32): el mes en curso o el anterior, cada día con «Puntual», «Tarde» o
 * «Falta», la hora y «Manual» o «Posterior», y los totales. «Registrar asistencia posterior» solo en el mes en curso. Los totales se cuentan de
 * los registros que responde la API; las clases restantes son las de la matrícula de ese mes.
 */
export function AsistenciaDelMes({ alumnoId, nombre, puedeRegistrar }: Propiedades) {
  const idTitulo = useId();
  const [elegido, setElegido] = useState<MesElegido>('actual');
  const [dialogo, setDialogo] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const mesEnCurso = mesActualEnLima();
  const mes = elegido === 'actual' ? mesEnCurso : mesAnterior(mesEnCurso);
  const consulta = useAsistenciaDelMes(alumnoId, mes);
  useAlPerderSesion(consulta.error);
  const datos = consulta.data;

  const puntuales =
    datos?.registros.filter((r) => r.tipo === 'ASISTENCIA' && r.estadoLlegada === 'PUNTUAL').length ?? 0;
  const tardes = datos?.registros.filter((r) => r.tipo === 'ASISTENCIA' && r.estadoLlegada === 'TARDE').length ?? 0;
  const faltas = datos?.registros.filter((r) => r.tipo === 'FALTA') ?? [];

  const alRegistrar = (resultado: ResultadoAsistencia) => {
    setDialogo(false);
    const { fecha, horaLlegada, estadoLlegada } = resultado.asistencia;
    setHecho(
      `Se registró la asistencia del ${formatearFechaCalendario(fecha)} a las ${horaLlegada} (${ETIQUETA_ESTADO_LLEGADA[estadoLlegada]}).`,
    );
  };

  return (
    <section
      aria-labelledby={idTitulo}
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id={idTitulo} className="text-xl font-semibold text-slate-900">
          Asistencia
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <CampoSelect
              etiqueta="Mes"
              value={elegido}
              onChange={(evento) => {
                setElegido(evento.target.value === 'anterior' ? 'anterior' : 'actual');
                setHecho(null);
              }}
            >
              <option value="actual">{formatearMes(mesEnCurso)}</option>
              <option value="anterior">{formatearMes(mesAnterior(mesEnCurso))}</option>
            </CampoSelect>
          </div>
          {puedeRegistrar && elegido === 'actual' && datos ? (
            <button
              type="button"
              onClick={() => {
                setHecho(null);
                setDialogo(true);
              }}
              className={ESTILO_BOTON.secundario}
            >
              Registrar asistencia posterior
            </button>
          ) : null}
        </div>
      </div>

      {hecho ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 ring-1 ring-emerald-200">
          {hecho}
        </p>
      ) : null}

      {datos ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar la asistencia. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <dl aria-label={`Totales de ${formatearMes(mes)}`} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total etiqueta="Puntual" valor={puntuales} />
            <Total etiqueta="Tarde" valor={tardes} />
            <Total etiqueta="Faltas" valor={faltas.length} />
            <Total etiqueta="Clases restantes" valor={datos.matricula ? datos.matricula.clasesRestantes : '—'} />
          </dl>
          {datos.matricula === null ? (
            <p className="text-sm text-slate-600">No tuvo una mensualidad en {formatearMes(mes)}.</p>
          ) : null}
          {datos.registros.length === 0 ? (
            <p className="text-slate-700">No hay asistencias ni faltas en {formatearMes(mes)}.</p>
          ) : (
            <ul aria-label={`Asistencia de ${formatearMes(mes)}`} className="divide-y divide-slate-200">
              {datos.registros.map((registro) => {
                const etiqueta =
                  registro.tipo === 'FALTA' ? ETIQUETA_REGISTRO.FALTA : ETIQUETA_REGISTRO[registro.estadoLlegada];
                const color =
                  registro.tipo === 'FALTA' ? 'rojo' : registro.estadoLlegada === 'PUNTUAL' ? 'verde' : 'ambar';
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
                        <span className="text-sm text-slate-700">{textoDeLlegada(registro)}</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <div className="space-y-3">
            <Alerta>{mensajeDeAsistenciaDelMes(consulta.error)}</Alerta>
            {esErrorDeApi(consulta.error, 404) || esErrorDeApi(consulta.error, 403) ? null : (
              <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
                Volver a intentar
              </button>
            )}
          </div>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Cargando la asistencia…
        </p>
      )}

      {dialogo ? (
        <DialogoAsistenciaPosterior
          alumnoId={alumnoId}
          nombre={nombre}
          mes={mesEnCurso}
          faltas={faltas}
          alCerrar={() => setDialogo(false)}
          alRegistrar={alRegistrar}
        />
      ) : null}
    </section>
  );
}
