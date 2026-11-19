import {
  type Bloque,
  BLOQUES,
  horaFinDe,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  type EstadoPlan,
  type Plan,
} from '@aquagestion/contratos';
import { useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { FormularioPlan } from './FormularioPlan';
import { usePlanes } from './hooks';

type Dialogo = { tipo: 'nuevo' } | { tipo: 'editar'; id: string };

const AVISO_SIN_COMPROBAR = 'No pudimos comprobar si los planes cambiaron. Lo que ves puede estar desactualizado.';

const INSIGNIA_ESTADO: Record<EstadoPlan, { color: 'verde' | 'azul' | 'ambar' | 'gris'; texto: string }> = {
  VIGENTE: { color: 'verde', texto: 'Vigente' },
  PROGRAMADO: { color: 'azul', texto: 'Programado' },
  VENCIDO: { color: 'ambar', texto: 'Vencido' },
  INACTIVO: { color: 'gris', texto: 'Inactivo' },
};

/** `/panel/planes`: los planes que vende la academia (HU-19, RN-07). Solo el administrador (sección 2.1). */
export function PaginaPlanes() {
  return (
    <RequierePermiso permiso="CONFIGURAR_PLANES_HORARIOS_AFORO">
      <ContenidoPlanes />
    </RequierePermiso>
  );
}

function ContenidoPlanes() {
  const consulta = usePlanes();
  useAlPerderSesion(consulta.error);
  const verLista = useRecienPedida(consulta);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [creado, setCreado] = useState<string | null>(null);
  const planes = consulta.data;
  // El plan que se edita es siempre el último que llegó: el formulario decide qué hacer con una base nueva (criterio 27 de 003).
  const planEditado = dialogo?.tipo === 'editar' ? planes?.find((plan) => plan.id === dialogo.id) : undefined;

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Planes</h1>
        {verLista ? (
          <button
            type="button"
            onClick={() => {
              setCreado(null);
              setDialogo({ tipo: 'nuevo' });
            }}
            className={ESTILO_BOTON.primario}
          >
            Nuevo plan
          </button>
        ) : null}
      </div>
      <p className="text-slate-700">
        Los precios ya incluyen IGV. Un cambio de precio vale solo para las inscripciones y renovaciones nuevas: no
        cambia lo que ya se cobró.
      </p>
      {creado ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          Plan «{creado}» creado.
        </p>
      ) : null}

      {verLista && planes ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? <Alerta>{AVISO_SIN_COMPROBAR}</Alerta> : null}
          <ListaPlanes planes={planes} alEditar={(plan) => setDialogo({ tipo: 'editar', id: plan.id })} />
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : (
            <Alerta>No se pudieron cargar los planes. {mensajeGeneral(consulta.error)}</Alerta>
          )}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando planes…
        </p>
      )}

      {dialogo?.tipo === 'nuevo' ? (
        <FormularioPlan
          plan={null}
          alCerrar={() => setDialogo(null)}
          alCrear={(nuevo) => {
            setCreado(nuevo.nombre);
            setDialogo(null);
          }}
        />
      ) : null}
      {dialogo?.tipo === 'editar' && planEditado ? (
        <FormularioPlan key={planEditado.id} plan={planEditado} alCerrar={() => setDialogo(null)} />
      ) : null}
    </div>
  );
}

function ListaPlanes({ planes, alEditar }: { planes: readonly Plan[]; alEditar: (plan: Plan) => void }) {
  if (planes.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
        Todavía no hay planes. Crea el primero con «Nuevo plan».
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {planes.map((plan) => (
        <li key={plan.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
          <FilaPlan plan={plan} alEditar={alEditar} />
        </li>
      ))}
    </ul>
  );
}

function franjasEnTexto(franjas: readonly Bloque[]): string {
  if (franjas.length === BLOQUES.length)
    return `Todas las franjas (${BLOQUES[0]} a ${horaFinDe(BLOQUES[BLOQUES.length - 1] ?? '19:00')})`;
  return franjas.map((franja) => `${franja} a ${horaFinDe(franja)}`).join(', ');
}

function vigenciaEnTexto(plan: Plan): string {
  const { vigenciaInicio: inicio, vigenciaFin: fin } = plan;
  if (inicio && fin) return `Del ${formatearFechaCalendario(inicio)} al ${formatearFechaCalendario(fin)}`;
  if (inicio) return `Desde el ${formatearFechaCalendario(inicio)}, sin fecha de fin`;
  if (fin) return `Hasta el ${formatearFechaCalendario(fin)}`;
  return 'Sin fechas de vigencia';
}

function FilaPlan({ plan, alEditar }: { plan: Plan; alEditar: (plan: Plan) => void }) {
  const estado = INSIGNIA_ESTADO[plan.estado];
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900">{plan.nombre}</h2>
          <Insignia color={estado.color}>{estado.texto}</Insignia>
        </div>
        <p className="text-slate-900">
          <span className="text-xl font-semibold">{formatearSoles(plan.precio)}</span>
          <span className="text-sm text-slate-700"> · IGV incluido</span>
        </p>
        <p className="text-sm text-slate-700">
          {plan.vecesPorSemana} {plan.vecesPorSemana === 1 ? 'vez' : 'veces'} por semana · {plan.clasesPorMes}{' '}
          {plan.clasesPorMes === 1 ? 'clase' : 'clases'} al mes · {plan.duracionMinutos} min
        </p>
        <p className="text-sm text-slate-700">Días: {plan.diasPermitidos.map((dia) => NOMBRE_DIA[dia]).join(', ')}</p>
        <p className="text-sm text-slate-700">Franjas: {franjasEnTexto(plan.franjasPermitidas)}</p>
        <p className="text-sm text-slate-700">
          Niveles: {plan.nivelesAplicables.map((nivel) => NOMBRE_NIVEL[nivel]).join(', ')}
        </p>
        <p className="text-sm text-slate-700">{vigenciaEnTexto(plan)}</p>
      </div>
      <div className="md:shrink-0">
        <button
          type="button"
          onClick={() => alEditar(plan)}
          aria-label={`Editar el plan ${plan.nombre}`}
          className={ESTILO_BOTON.secundario}
        >
          Editar
        </button>
      </div>
    </div>
  );
}
