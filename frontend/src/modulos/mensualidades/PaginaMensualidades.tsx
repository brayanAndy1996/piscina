import {
  type ConsultaListadoMensualidades,
  ESTADOS_MENSUALIDAD,
  type EstadoMensualidad,
  estadoMensualidadSchema,
  type FilaDelListadoMensualidades,
  NIVELES,
  type NivelNatacion,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  nivelNatacionSchema,
} from '@aquagestion/contratos';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, Aviso, CampoSelect, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario, formatearMes, mesActualEnLima, mesAnterior } from '../../lib/fechas';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { COLOR_ESTADO_MENSUALIDAD, ETIQUETA_ESTADO_MENSUALIDAD, textoDeClasesUsadas } from './etiquetas';
import { useListadoMensualidades } from './hooks';

/** Cuántos meses hacia atrás ofrece el filtro «Mes»: el mes en curso y los 11 anteriores. */
const MESES_OFRECIDOS = 12;

/** Los filtros tal como están en pantalla; el texto vacío es «Todos». */
interface Filtros {
  mes: string;
  estado: string;
  planId: string;
  nivel: string;
  claseId: string;
}

const SIN_FILTROS = { estado: '', planId: '', nivel: '', claseId: '' } as const;

/** Lo que viaja a la API: solo lo elegido. `mes` siempre va, así el listado y las opciones hablan del mismo mes. */
function consultaDe(filtros: Filtros): ConsultaListadoMensualidades {
  const estado = estadoMensualidadSchema.safeParse(filtros.estado);
  const nivel = nivelNatacionSchema.safeParse(filtros.nivel);
  return {
    mes: filtros.mes,
    ...(estado.success ? { estado: estado.data } : {}),
    ...(filtros.planId ? { planId: filtros.planId } : {}),
    ...(nivel.success ? { nivel: nivel.data } : {}),
    ...(filtros.claseId ? { claseId: filtros.claseId } : {}),
  };
}

function mesesParaElegir(mesEnCurso: string): string[] {
  const meses = [mesEnCurso];
  while (meses.length < MESES_OFRECIDOS) meses.push(mesAnterior(meses[meses.length - 1] ?? mesEnCurso));
  return meses;
}

interface OpcionDeHorario {
  id: string;
  etiqueta: string;
}

/**
 * Las opciones de «Plan» y «Horario»: los de las mensualidades del listado del mes sin otros filtros (la API de planes y clases es del
 * administrador y la secretaria también usa esta página). Un horario es una clase concreta: si dos clases comparten día y hora, se distinguen
 * por el nivel de los alumnos que las tienen.
 */
function opcionesDelCatalogo(filas: readonly FilaDelListadoMensualidades[]) {
  const planes = new Map<string, string>();
  const clases = new Map<string, { texto: string; dia: number; hora: string; niveles: Set<NivelNatacion> }>();
  for (const fila of filas) {
    planes.set(fila.mensualidad.plan.id, fila.mensualidad.plan.nombre);
    for (const clase of fila.mensualidad.clases) {
      const actual = clases.get(clase.id) ?? {
        texto: `${NOMBRE_DIA[clase.diaSemana]} ${clase.horaInicio} a ${clase.horaFin}`,
        dia: clase.diaSemana,
        hora: clase.horaInicio,
        niveles: new Set<NivelNatacion>(),
      };
      actual.niveles.add(fila.nivel);
      clases.set(clase.id, actual);
    }
  }
  const ordenadas = [...clases.entries()].sort(([, a], [, b]) => a.dia - b.dia || a.hora.localeCompare(b.hora));
  const repetidas = new Set<string>();
  const vistas = new Set<string>();
  for (const [, clase] of ordenadas) (vistas.has(clase.texto) ? repetidas : vistas).add(clase.texto);
  const horarios: OpcionDeHorario[] = ordenadas.map(([id, clase]) => {
    const niveles = [...clase.niveles].map((nivel) => NOMBRE_NIVEL[nivel]).join(' y ');
    return { id, etiqueta: repetidas.has(clase.texto) ? `${clase.texto} · ${niveles}` : clase.texto };
  });
  const listaDePlanes = [...planes.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { planes: listaDePlanes, horarios };
}

/**
 * `/panel/mensualidades`: quién está al día, por vencer, vencido o con un pago por verificar (HU-11, criterio 32 de 010). Los estados y los
 * totales los calcula la API; la web los muestra. Solo con `REGISTRAR_INSCRIPCION_Y_COBRO` (`ADMIN` y `SECRETARIA`).
 */
export function PaginaMensualidades() {
  return (
    <RequierePermiso permiso="REGISTRAR_INSCRIPCION_Y_COBRO">
      <ContenidoMensualidades />
    </RequierePermiso>
  );
}

function ContenidoMensualidades() {
  const mesEnCurso = mesActualEnLima();
  const [filtros, setFiltros] = useState<Filtros>({ mes: mesEnCurso, ...SIN_FILTROS });
  const consulta = useListadoMensualidades(consultaDe(filtros));
  // Las opciones salen del listado del mes sin otros filtros: con uno elegido seguirían apareciendo todas las demás.
  const catalogo = useListadoMensualidades({ mes: filtros.mes });
  useAlPerderSesion(consulta.error);
  useAlPerderSesion(catalogo.error);
  const opciones = useMemo(() => opcionesDelCatalogo(catalogo.data?.alumnos ?? []), [catalogo.data]);
  const meses = useMemo(() => mesesParaElegir(mesEnCurso), [mesEnCurso]);

  const listado = consulta.data;
  const actualizando = consulta.isPlaceholderData || (consulta.isFetching && listado !== undefined);
  const hayFiltros =
    filtros.estado !== '' ||
    filtros.planId !== '' ||
    filtros.nivel !== '' ||
    filtros.claseId !== '' ||
    filtros.mes !== mesEnCurso;
  // Un plan o un horario de otro mes no existe en este: al cambiar de mes se limpian.
  const cambiar = (campo: keyof Filtros, valor: string) =>
    setFiltros((previos) =>
      campo === 'mes' ? { ...previos, mes: valor, planId: '', claseId: '' } : { ...previos, [campo]: valor },
    );

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Mensualidades</h1>
      <p className="text-slate-700">
        Mira quién está al día, por vencer, vencido o con un pago por verificar. Entra a un alumno para renovar su
        mensualidad.
      </p>

      <form
        aria-label="Filtros"
        onSubmit={(evento) => evento.preventDefault()}
        className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1.3fr]">
          <CampoSelect etiqueta="Mes" value={filtros.mes} onChange={(e) => cambiar('mes', e.target.value)}>
            {meses.map((mes) => (
              <option key={mes} value={mes}>
                {formatearMes(mes)}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect etiqueta="Estado" value={filtros.estado} onChange={(e) => cambiar('estado', e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_MENSUALIDAD.map((estado) => (
              <option key={estado} value={estado}>
                {ETIQUETA_ESTADO_MENSUALIDAD[estado]}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect etiqueta="Plan" value={filtros.planId} onChange={(e) => cambiar('planId', e.target.value)}>
            <option value="">Todos</option>
            {opciones.planes.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.nombre}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect etiqueta="Nivel" value={filtros.nivel} onChange={(e) => cambiar('nivel', e.target.value)}>
            <option value="">Todos</option>
            {NIVELES.map((nivel) => (
              <option key={nivel} value={nivel}>
                {NOMBRE_NIVEL[nivel]}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect etiqueta="Horario" value={filtros.claseId} onChange={(e) => cambiar('claseId', e.target.value)}>
            <option value="">Todos</option>
            {opciones.horarios.map((horario) => (
              <option key={horario.id} value={horario.id}>
                {horario.etiqueta}
              </option>
            ))}
          </CampoSelect>
        </div>
        {hayFiltros ? (
          <div className="flex justify-end">
            <button
              type="button"
              className={ESTILO_BOTON.secundario}
              onClick={() => setFiltros({ mes: mesEnCurso, ...SIN_FILTROS })}
            >
              Quitar filtros
            </button>
          </div>
        ) : null}
      </form>

      {listado ? (
        <div aria-busy={actualizando} className="space-y-4">
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar el listado. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <p role="status" className="text-slate-800">
            {actualizando
              ? 'Actualizando…'
              : `Mensualidades de ${formatearMes(listado.mes)}. Hoy es ${formatearFechaCalendario(listado.hoy)}.`}
          </p>

          <dl aria-label="Totales por estado" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {ESTADOS_MENSUALIDAD.map((estado) => (
              <Total key={estado} estado={estado} cantidad={listado.totales[estado]} />
            ))}
          </dl>

          {listado.hayMas ? (
            <Aviso>
              Hay más de 500 alumnos con estos filtros y se muestran los primeros 500. Usa los filtros para acotar la
              lista.
            </Aviso>
          ) : null}

          {listado.alumnos.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
              {hayFiltros ? 'Ningún alumno cumple estos filtros.' : 'No hay mensualidades en este mes.'}
            </p>
          ) : (
            <ul aria-label="Alumnos" className="space-y-3">
              {listado.alumnos.map((fila) => (
                <li key={fila.alumnoId}>
                  <TarjetaDeMensualidad fila={fila} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <div className="space-y-3">
            <Alerta>No se pudo cargar el listado. {mensajeGeneral(consulta.error)}</Alerta>
            <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
              Volver a intentar
            </button>
          </div>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Cargando las mensualidades…
        </p>
      )}
    </div>
  );
}

function Total({ estado, cantidad }: { estado: EstadoMensualidad; cantidad: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
      <dt>
        <Insignia color={COLOR_ESTADO_MENSUALIDAD[estado]}>{ETIQUETA_ESTADO_MENSUALIDAD[estado]}</Insignia>
      </dt>
      <dd className="mt-2 text-3xl font-semibold text-slate-900">{cantidad}</dd>
    </div>
  );
}

function textoDeSiguiente(siguiente: NonNullable<FilaDelListadoMensualidades['siguiente']>): string {
  return `${formatearMes(siguiente.mes)}: ${siguiente.estado === 'PAGADA' ? 'pagada' : 'pago por verificar'}`;
}

function TarjetaDeMensualidad({ fila }: { fila: FilaDelListadoMensualidades }) {
  const { mensualidad } = fila;
  return (
    <Link
      to={`/panel/alumnos/${encodeURIComponent(fila.alumnoId)}`}
      className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
    >
      <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <span className="min-w-0">
          <span className="block break-words text-lg font-semibold text-sky-900">
            {fila.apellidos}, {fila.nombres}
          </span>
          <span className="block text-slate-700">
            Nivel {NOMBRE_NIVEL[fila.nivel]} · {mensualidad.plan.nombre}
          </span>
        </span>
        <span>
          <Insignia color={COLOR_ESTADO_MENSUALIDAD[fila.estado]}>{ETIQUETA_ESTADO_MENSUALIDAD[fila.estado]}</Insignia>
        </span>
      </span>
      <span className="mt-2 block text-sm text-slate-800">
        Mensualidad de {formatearMes(mensualidad.mes)} ·{' '}
        {textoDeClasesUsadas(mensualidad.clasesUsadas, mensualidad.clasesTotales)}
      </span>
      {mensualidad.clases.length > 0 ? (
        <span className="mt-1 block text-sm text-slate-700">
          {mensualidad.clases
            .map((clase) => `${NOMBRE_DIA[clase.diaSemana]} ${clase.horaInicio} a ${clase.horaFin}`)
            .join(' · ')}
        </span>
      ) : null}
      {fila.siguiente ? (
        <span className="mt-1 block text-sm text-slate-800">Mes siguiente, {textoDeSiguiente(fila.siguiente)}</span>
      ) : null}
      <span className="mt-2 block text-sm font-medium text-sky-800">Ver alumno y renovar →</span>
    </Link>
  );
}
