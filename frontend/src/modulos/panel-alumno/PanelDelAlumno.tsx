import { type MiPanel, type MensualidadDelPanel, NOMBRE_NIVEL } from '@aquagestion/contratos';
import { useId, type ReactNode } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { formatearFechaCalendario } from '../../lib/fechas';
import { useAlPerderSesion } from '../sesion/hooks';
import { COLOR_ESTADO_MENSUALIDAD, ETIQUETA_ESTADO_MENSUALIDAD } from '../mensualidades/etiquetas';
import {
  TEXTO_INACTIVO,
  TEXTO_PARA_RENOVAR,
  TEXTO_SIN_MENSUALIDAD,
  TEXTO_SOLO_LECTURA,
  mensajeDelPanel,
  textoDeClase,
  textoDeClases,
  textoDeEdad,
  textoDelSiguiente,
} from './etiquetas';
import { useMiPanel } from './hooks';
import { MiAsistencia } from './MiAsistencia';

const ESTILO_SECCION = 'space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6';

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={ESTILO_SECCION}>
      <h2 id={id} className="text-xl font-semibold text-slate-900">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** El plan, el horario y las clases de una mensualidad. */
function Detalle({ mensualidad }: { mensualidad: MensualidadDelPanel }) {
  return (
    <>
      <p className="break-words text-lg font-medium text-slate-900">{mensualidad.plan.nombre}</p>
      <ul aria-label="Días y horas de tus clases" className="space-y-1 text-slate-800">
        {mensualidad.clases.map((clase) => (
          <li key={`${clase.diaSemana}-${clase.horaInicio}`}>{textoDeClase(clase)}</li>
        ))}
      </ul>
    </>
  );
}

function MiMensualidad({ panel }: { panel: MiPanel }) {
  const { alumno, mensualidad } = panel;
  const { estado, actual, siguiente } = mensualidad;

  if (alumno.estado === 'INACTIVO') {
    return <p className="text-slate-800">{TEXTO_INACTIVO}</p>;
  }

  if (estado !== null && actual !== null) {
    return (
      <>
        <p>
          <Insignia color={COLOR_ESTADO_MENSUALIDAD[estado]}>{ETIQUETA_ESTADO_MENSUALIDAD[estado]}</Insignia>
        </p>
        <Detalle mensualidad={actual} />
        <p className="text-slate-800">{textoDeClases(actual)}</p>
        <p className="font-medium text-slate-900">
          {estado === 'VENCIDO' ? 'Venció el' : 'Vence el'} {formatearFechaCalendario(actual.hasta)}
        </p>
        {siguiente ? <p className="text-slate-800">{textoDelSiguiente(siguiente.mes, siguiente.estado)}</p> : null}
        {estado === 'POR_VENCER' || estado === 'VENCIDO' ? (
          <p className="text-slate-800">{TEXTO_PARA_RENOVAR}</p>
        ) : null}
      </>
    );
  }

  if (siguiente) {
    return (
      <>
        <p className="font-medium text-slate-900">
          Tu mensualidad empieza el {formatearFechaCalendario(siguiente.desde)}.
        </p>
        <Detalle mensualidad={siguiente} />
        <p className="text-slate-800">{textoDelSiguiente(siguiente.mes, siguiente.estado)}</p>
      </>
    );
  }

  return <p className="text-slate-800">{TEXTO_SIN_MENSUALIDAD}</p>;
}

/**
 * El panel del alumno y de su apoderado en `/panel` (spec 011, HU-06, D-08, D-14): sus datos, su mensualidad y su asistencia. Solo lectura: no
 * tiene campos ni acciones de edición; la contraseña y «Mi carnet» están en el inicio. No pide ningún id (la API usa la sesión) y no usa el
 * reloj del navegador: el mes en curso y los meses salen de la API (DT-7).
 */
export function PanelDelAlumno() {
  const consulta = useMiPanel();
  useAlPerderSesion(consulta.error);
  const panel = consulta.data;

  if (!panel) {
    if (consulta.isError) {
      if (esErrorDeApi(consulta.error, 401)) return null;
      return (
        <div className="space-y-3">
          <Alerta>{mensajeDelPanel(consulta.error)}</Alerta>
          {esErrorDeApi(consulta.error, 404) ? null : (
            <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
              Volver a intentar
            </button>
          )}
        </div>
      );
    }
    return (
      <p role="status" className="text-slate-700">
        Cargando tu panel…
      </p>
    );
  }

  const { alumno } = panel;
  return (
    <div className="space-y-6">
      {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
        <Alerta>No pudimos actualizar tu panel. Lo que ves puede estar desactualizado.</Alerta>
      ) : null}

      <Seccion titulo="Mis datos">
        <p className="break-words text-lg font-medium text-slate-900">
          {alumno.nombres} {alumno.apellidos}
        </p>
        <ul className="space-y-1 text-slate-800">
          <li>DNI: {alumno.dni}</li>
          <li>{textoDeEdad(alumno.edad)}</li>
          <li>Nivel: {NOMBRE_NIVEL[alumno.nivel]}</li>
        </ul>
      </Seccion>

      <Seccion titulo="Mi mensualidad">
        <MiMensualidad panel={panel} />
      </Seccion>

      <MiAsistencia mesEnCurso={panel.mesEnCurso} mesesDeAsistencia={panel.mesesDeAsistencia} />

      <p className="text-sm text-slate-700">{TEXTO_SOLO_LECTURA}</p>
    </div>
  );
}
