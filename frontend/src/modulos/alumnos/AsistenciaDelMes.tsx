import type { ResultadoAsistencia } from '@aquagestion/contratos';
import { useId, useState } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoSelect, ESTILO_BOTON } from '../../componentes/ui';
import { formatearFechaCalendario, formatearMes, mesActualEnLima, mesAnterior } from '../../lib/fechas';
import { useAsistenciaDelMes } from '../asistencia/hooks';
import { ListaDeAsistencia } from '../asistencia/ListaDeAsistencia';
import { ETIQUETA_ESTADO_LLEGADA, mensajeDeAsistenciaDelMes } from '../asistencia/mensajes';
import { useAlPerderSesion } from '../sesion/hooks';
import { DialogoAsistenciaPosterior } from './DialogoAsistenciaPosterior';

interface Propiedades {
  alumnoId: string;
  nombre: string;
  /** `REGISTRAR_ASISTENCIA`: sin él la sección es de solo consulta y no ofrece el registro posterior. */
  puedeRegistrar: boolean;
}

type MesElegido = 'actual' | 'anterior';

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
          <ListaDeAsistencia datos={datos} mes={mes} />
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
