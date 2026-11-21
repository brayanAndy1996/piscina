import { type Clase, NOMBRE_DIA, NOMBRE_NIVEL } from '@aquagestion/contratos';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { mensajeGeneral } from '../../lib/errores';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { FormularioClase } from './FormularioClase';
import { GrillaSemanal, type OcupacionPorClase } from './GrillaSemanal';
import { useClases, useOcupacion } from './hooks';

type Dialogo = { tipo: 'nueva' } | { tipo: 'editar'; id: string };

const AVISO_SIN_COMPROBAR = 'No pudimos comprobar si las clases cambiaron. Lo que ves puede estar desactualizado.';

/** `/panel/clases`: la semana de clases con su entrenador y su aforo (HU-17). Solo el administrador (sección 2.1). */
export function PaginaClases() {
  return (
    <RequierePermiso permiso="CONFIGURAR_PLANES_HORARIOS_AFORO">
      <ContenidoClases />
    </RequierePermiso>
  );
}

function ContenidoClases() {
  const consulta = useClases();
  const ocupacionConsulta = useOcupacion();
  useAlPerderSesion(consulta.error, ocupacionConsulta.error);
  const verGrilla = useRecienPedida(consulta);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [creada, setCreada] = useState<Clase | null>(null);
  const clases = consulta.data;
  const ocupacion = useMemo<OcupacionPorClase | undefined>(
    () =>
      ocupacionConsulta.data
        ? new Map(ocupacionConsulta.data.ocupacion.map((fila) => [fila.claseId, fila]))
        : undefined,
    [ocupacionConsulta.data],
  );
  // La clase que se edita es siempre la última que llegó: el formulario decide qué hacer con una base nueva (criterio 27 de 003).
  const claseEditada = dialogo?.tipo === 'editar' ? clases?.find((clase) => clase.id === dialogo.id) : undefined;

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Clases y horarios</h1>
        {verGrilla ? (
          <button
            type="button"
            onClick={() => {
              setCreada(null);
              setDialogo({ tipo: 'nueva' });
            }}
            className={ESTILO_BOTON.primario}
          >
            Nueva clase
          </button>
        ) : null}
      </div>
      <p className="text-slate-700">
        Las clases duran un bloque de 1 hora, de 08:00 a 20:00. Toca una clase para cambiar su entrenador, su aforo (de
        20 a 50 alumnos) o su estado. Cada clase muestra sus inscritos frente a su aforo; no cuentan las reservas
        vencidas ni las canceladas.
      </p>
      {creada ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          Clase creada: {NOMBRE_NIVEL[creada.nivel]}, {NOMBRE_DIA[creada.diaSemana].toLowerCase()} de{' '}
          {creada.horaInicio} a {creada.horaFin}.
        </p>
      ) : null}

      {verGrilla && clases ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? <Alerta>{AVISO_SIN_COMPROBAR}</Alerta> : null}
          {clases.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
              Todavía no hay clases. Crea la primera con «Nueva clase».
            </p>
          ) : null}
          {ocupacionConsulta.isError && !esErrorDeApi(ocupacionConsulta.error, 401) ? (
            <p className="text-sm text-slate-700">
              No pudimos cargar los inscritos de cada clase. Por ahora se ve solo el aforo.
            </p>
          ) : null}
          <GrillaSemanal
            clases={clases}
            ocupacion={ocupacion}
            alElegir={(clase) => setDialogo({ tipo: 'editar', id: clase.id })}
          />
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : (
            <Alerta>No se pudieron cargar las clases. {mensajeGeneral(consulta.error)}</Alerta>
          )}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando clases…
        </p>
      )}

      {dialogo?.tipo === 'nueva' ? (
        <FormularioClase
          clase={null}
          alCerrar={() => setDialogo(null)}
          alCrear={(nueva) => {
            setCreada(nueva);
            setDialogo(null);
          }}
        />
      ) : null}
      {dialogo?.tipo === 'editar' && claseEditada ? (
        <FormularioClase key={claseEditada.id} clase={claseEditada} alCerrar={() => setDialogo(null)} />
      ) : null}
    </div>
  );
}
