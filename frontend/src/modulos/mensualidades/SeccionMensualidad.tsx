import {
  type ClaseDeMensualidad,
  type MatriculaDelHorario,
  NOMBRE_DIA,
  type OfertaRenovacion,
  puede,
} from '@aquagestion/contratos';
import { useId, useState } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { formatearFechaCalendario, formatearMes, hoyEnLima, mesActualEnLima, mesAnterior } from '../../lib/fechas';
import { useAsistenciaDelMes } from '../asistencia/hooks';
import { COLOR_ESTADO_ALUMNO, ETIQUETA_ESTADO_ALUMNO } from '../carnet/etiquetas';
import { useUsuario } from '../sesion/contexto';
import { useAlPerderSesion } from '../sesion/hooks';
import { DialogoCambiarHorario } from './DialogoCambiarHorario';
import { DialogoRenovar } from './DialogoRenovar';
import {
  COLOR_ESTADO_MENSUALIDAD,
  ETIQUETA_ESTADO_MENSUALIDAD,
  textoDeClasesPerdidas,
  textoDeClasesUsadas,
} from './etiquetas';
import { useEstadoDeMensualidadDelAlumno, useHorarioDelAlumno, useOfertaRenovacion } from './hooks';
import { mensajeDeHorario, mensajeDeOferta } from './mensajes';

interface Propiedades {
  alumnoId: string;
}

function TextoDeClases({ clases }: { clases: readonly ClaseDeMensualidad[] }) {
  return (
    <ul aria-label="Clases de la mensualidad" className="mt-1 flex flex-wrap gap-2">
      {clases.map((clase) => (
        <li key={clase.id} className="rounded-lg bg-sky-50 px-3 py-1 text-sm text-slate-900 ring-1 ring-sky-100">
          {NOMBRE_DIA[clase.diaSemana]} {clase.horaInicio} a {clase.horaFin}
        </li>
      ))}
    </ul>
  );
}

/** La ventana de renovación abierta es la que permite un mes posterior al en curso: lo decide la API en `mesesPermitidos`. */
function haySiguientePermitido(oferta: OfertaRenovacion, mesEnCurso: string): boolean {
  return oferta.mesesPermitidos.some((mes) => mes > mesEnCurso);
}

/**
 * El estado de la mensualidad del alumno (010b, criterio 31) y, de la última mensualidad cerrada, las clases que no usó (RN-23). El estado lo da
 * la API (`GET /api/mensualidades`): la web no lo calcula. Las clases perdidas son las restantes de la matrícula del mes anterior.
 */
function EstadoDeLaMensualidad({ alumnoId, oferta }: { alumnoId: string; oferta: OfertaRenovacion }) {
  const mesEnCurso = mesActualEnLima();
  const inactivo = oferta.alumno.estado === 'INACTIVO';
  // El listado no trae a un alumno inactivo: no se pide.
  const estado = useEstadoDeMensualidadDelAlumno(alumnoId, !inactivo);
  const cerrada = useAsistenciaDelMes(alumnoId, mesAnterior(mesEnCurso));
  useAlPerderSesion(estado.error);
  useAlPerderSesion(cerrada.error);
  const fila = estado.data?.fila ?? null;
  const perdidas = cerrada.data?.matricula?.clasesRestantes ?? 0;

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-slate-800">Estado de la mensualidad</p>
      {inactivo ? (
        <p className="text-slate-700">El alumno está inactivo: no tiene estado de mensualidad.</p>
      ) : fila ? (
        <div className="space-y-1">
          <p>
            <Insignia color={COLOR_ESTADO_MENSUALIDAD[fila.estado]}>
              {ETIQUETA_ESTADO_MENSUALIDAD[fila.estado]}
            </Insignia>
          </p>
          <p className="text-slate-900">
            {fila.estado === 'VENCIDO' ? 'Su última mensualidad fue la de ' : 'Mensualidad de '}
            {formatearMes(fila.mensualidad.mes)} ·{' '}
            {textoDeClasesUsadas(fila.mensualidad.clasesUsadas, fila.mensualidad.clasesTotales)}.
          </p>
          {fila.siguiente ? (
            <p className="text-sm text-slate-700">
              Mes siguiente, {formatearMes(fila.siguiente.mes)}:{' '}
              {fila.siguiente.estado === 'PAGADA' ? 'pagada' : 'con el pago por verificar'}.
            </p>
          ) : null}
        </div>
      ) : estado.data ? (
        <p className="text-slate-700">
          Sin mensualidad pagada ni por verificar en {formatearMes(mesEnCurso)} ni en{' '}
          {formatearMes(mesAnterior(mesEnCurso))}.
        </p>
      ) : estado.isError ? (
        esErrorDeApi(estado.error, 401) ? null : (
          <p className="text-slate-700">No pudimos consultar el estado de la mensualidad.</p>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Consultando el estado…
        </p>
      )}
      {perdidas > 0 ? (
        <p className="text-sm text-slate-800">
          {textoDeClasesPerdidas(perdidas)} en {formatearMes(mesAnterior(mesEnCurso))}; se perdieron al cerrar el mes.
        </p>
      ) : null}
    </div>
  );
}

/**
 * «Cambiar horario» (010c, criterio 42): una fila por cada matrícula que devuelve `GET /api/alumnos/{id}/horario` (la de M y la de M+1) con su plan,
 * sus clases y el botón. Solo para `MODIFICAR_HORARIO_ALUMNO`; la sección decide si la muestra. Las matrículas y los cupos los da la API.
 */
function HorarioDeLasMatriculas({ alumnoId }: { alumnoId: string }) {
  const consulta = useHorarioDelAlumno(alumnoId);
  useAlPerderSesion(consulta.error);
  // Se guarda la matrícula tal como estaba al abrir: si la lectura se renueva y ya no la trae (un 409), el diálogo sigue mostrando su error.
  const [dialogo, setDialogo] = useState<MatriculaDelHorario | null>(null);
  const matriculas = consulta.data?.matriculas ?? [];

  return (
    <div className="space-y-2" aria-label="Horario de las mensualidades" role="group">
      <p className="text-sm font-medium text-slate-800">Horario</p>
      {consulta.data ? (
        matriculas.length > 0 ? (
          <ul className="space-y-3">
            {matriculas.map((matricula) => (
              <li
                key={matricula.id}
                className="flex flex-col gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-slate-900">
                    {formatearMes(matricula.mes)} · <strong>{matricula.plan.nombre}</strong>
                    {matricula.estado === 'EN_VERIFICACION' ? (
                      <>
                        {' '}
                        <Insignia color="ambar">Pago por verificar</Insignia>
                      </>
                    ) : null}
                  </p>
                  <TextoDeClases clases={matricula.clases} />
                </div>
                <button
                  type="button"
                  onClick={() => setDialogo(matricula)}
                  aria-label={`Cambiar horario de ${formatearMes(matricula.mes)}`}
                  className={ESTILO_BOTON.secundario}
                >
                  Cambiar horario
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-700">El alumno no tiene una mensualidad cuyo horario se pueda cambiar.</p>
        )
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <Alerta>{mensajeDeHorario(consulta.error)}</Alerta>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Consultando el horario…
        </p>
      )}
      {dialogo ? (
        <DialogoCambiarHorario alumnoId={alumnoId} matricula={dialogo} alCerrar={() => setDialogo(null)} />
      ) : null}
    </div>
  );
}

/**
 * La sección «Mensualidad» de `/panel/alumnos/{id}` (010a, criterio 20): la mensualidad del mes en curso (plan y clases), los meses que se
 * pueden renovar ahora y el botón «Renovar». Solo para quien puede cobrar (`REGISTRAR_INSCRIPCION_Y_COBRO`); la página decide si la muestra.
 * Todo lo que dice sale de la oferta de la API: la web no calcula ventanas ni montos.
 */
export function SeccionMensualidad({ alumnoId }: Propiedades) {
  const idTitulo = useId();
  const usuario = useUsuario();
  const puedeCambiarHorario = puede(usuario.rol, 'MODIFICAR_HORARIO_ALUMNO');
  const consulta = useOfertaRenovacion(alumnoId, null);
  useAlPerderSesion(consulta.error);
  const [dialogo, setDialogo] = useState(false);
  const oferta = consulta.data;
  const mesEnCurso = mesActualEnLima();
  const inactivo = oferta?.alumno.estado === 'INACTIVO';
  const puedeRenovar = oferta !== undefined && oferta.mesesPermitidos.length > 0 && !inactivo;

  return (
    <section
      aria-labelledby={idTitulo}
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={idTitulo} className="text-xl font-semibold text-slate-900">
          Mensualidad
        </h2>
        {oferta ? (
          <button
            type="button"
            disabled={!puedeRenovar}
            onClick={() => setDialogo(true)}
            className={ESTILO_BOTON.primario}
          >
            Renovar
          </button>
        ) : null}
      </div>

      {oferta ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar la mensualidad. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800">Estado del alumno</p>
            <Insignia color={COLOR_ESTADO_ALUMNO[oferta.alumno.estado]}>
              {ETIQUETA_ESTADO_ALUMNO[oferta.alumno.estado]}
            </Insignia>
          </div>
          <EstadoDeLaMensualidad alumnoId={alumnoId} oferta={oferta} />
          <div>
            <p className="text-sm font-medium text-slate-800">Mes en curso: {formatearMes(mesEnCurso)}</p>
            {oferta.mensualidadActual ? (
              <div className="mt-1 space-y-1">
                <p className="text-slate-900">
                  Mensualidad de {formatearMes(oferta.mensualidadActual.mes)} ·{' '}
                  <strong>{oferta.mensualidadActual.plan.nombre}</strong>
                </p>
                <TextoDeClases clases={oferta.mensualidadActual.clases} />
              </div>
            ) : (
              <p className="mt-1 text-slate-700">No tiene mensualidad en {formatearMes(mesEnCurso)}.</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800">Renovación</p>
            {inactivo ? (
              <p className="text-slate-700">El alumno está inactivo y no puede renovar.</p>
            ) : oferta.mesesPermitidos.length > 0 ? (
              <p className="text-slate-900">
                Se puede renovar: {oferta.mesesPermitidos.map((mes) => formatearMes(mes)).join(' y ')}.
              </p>
            ) : (
              <p className="text-slate-700">
                No hay meses por renovar: el alumno ya tiene su mensualidad registrada, pagada o por verificar.
              </p>
            )}
            {haySiguientePermitido(oferta, mesEnCurso) ? (
              <p className="text-sm text-slate-700">
                La renovación del mes siguiente está abierta del {formatearFechaCalendario(oferta.ventana.desde)} al{' '}
                {formatearFechaCalendario(oferta.ventana.hasta)}: el lugar de cada alumno vigente queda apartado para él
                hasta el día 1.
              </p>
            ) : hoyEnLima() < oferta.ventana.desde ? (
              <p className="text-sm text-slate-700">
                La renovación del mes siguiente se abre el {formatearFechaCalendario(oferta.ventana.desde)}.
              </p>
            ) : null}
          </div>
          {puedeCambiarHorario ? <HorarioDeLasMatriculas alumnoId={alumnoId} /> : null}
        </>
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <div className="space-y-3">
            <Alerta>{mensajeDeOferta(consulta.error)}</Alerta>
            {esErrorDeApi(consulta.error, 404) || esErrorDeApi(consulta.error, 403) ? null : (
              <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
                Volver a intentar
              </button>
            )}
          </div>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Cargando la mensualidad…
        </p>
      )}

      {dialogo && oferta ? (
        <DialogoRenovar alumnoId={alumnoId} ofertaInicial={oferta} alCerrar={() => setDialogo(false)} />
      ) : null}
    </section>
  );
}
