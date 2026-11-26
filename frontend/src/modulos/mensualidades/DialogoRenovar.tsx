import {
  type CotizarRenovacion,
  datosRenovacionComprobanteSchema,
  NOMBRE_DIA,
  type OfertaRenovacion,
  type PlanPublico,
  renovarEnEfectivoSchema,
  type RespuestaRenovacion,
} from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, Aviso, CampoSelect, CampoTexto, ESTILO_BOTON, Insignia, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario, formatearMes, hoyEnLima, mesActualEnLima } from '../../lib/fechas';
import { nuevaClaveUuid } from '../../lib/uuid';
import { alternarClase } from '../inscripcion/campos';
import { CampoFoto } from '../foto/CampoFoto';
import { useFotoElegida } from '../foto/hooks';
import { FOTO_MEGABYTES_MAXIMOS } from '../foto/validacion';
import { useCajaDeHoyAbierta } from '../pagos/hooks';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { clasesDelPlan, textoDeCupos } from './campos';
import {
  useCotizacionDeRenovacion,
  useOfertaRenovacion,
  useRenovarConComprobante,
  useRenovarEnEfectivo,
} from './hooks';
import {
  clasesSinCupo,
  esCambioDeMonto,
  esErrorDeCajaAlRenovar,
  esErrorDeCampoDelComprobante,
  esRenovacionSinSalida,
  mensajeDeOferta,
  mensajeDeRenovacion,
  totalDeLaRenovacion,
} from './mensajes';

interface Propiedades {
  alumnoId: string;
  /** La oferta que ya tiene a la vista la sección: de ahí salen el alumno y los meses; los planes y las clases se piden por mes. */
  ofertaInicial: OfertaRenovacion;
  alCerrar: () => void;
}

type Metodo = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';

const METODOS: readonly { valor: Metodo; etiqueta: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'YAPE', etiqueta: 'Yape' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia bancaria' },
];

const NOMBRE_COMPROBANTE = {
  vistaPrevia: 'Vista previa de la imagen del comprobante',
  cambiar: 'Cambiar la imagen',
  quitar: 'Quitar la imagen',
};

/**
 * «Renovar» la mensualidad de un alumno (HU-12, D-03, D-04, D-06; criterio 20 de 010). Se elige el mes (los que la API permite ahora), el plan
 * y las clases (con los cupos y la marca «Su horario» en las que el alumno ya tenía), y se cobra: en efectivo (necesita la caja de hoy
 * abierta) o con el comprobante de Yape o transferencia, que queda en la bandeja de verificación. El monto sale de la cotización de la API:
 * la web no calcula nada. La `claveIdempotencia` se genera al abrir el diálogo y no cambia entre intentos; mientras el envío va en camino
 * no se manda otro, así que un doble clic o un reintento no cobra dos veces.
 */
export function DialogoRenovar({ alumnoId, ofertaInicial, alCerrar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const mesEnCurso = mesActualEnLima();
  const permitidos = ofertaInicial.mesesPermitidos;
  const [mes, setMes] = useState(permitidos.includes(ofertaInicial.mes) ? ofertaInicial.mes : (permitidos[0] ?? ''));
  const [hecho, setHecho] = useState<RespuestaRenovacion | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const consulta = useOfertaRenovacion(alumnoId, mes === '' ? null : mes);
  useAlPerderSesion(consulta.error);
  const oferta = consulta.data;
  const nombre = `${ofertaInicial.alumno.nombres} ${ofertaInicial.alumno.apellidos}`;

  const cerrar = () => {
    if (!enCurso) alCerrar();
  };

  if (hecho) return <ResultadoDeRenovacion nombre={nombre} respuesta={hecho} alCerrar={alCerrar} />;

  return (
    <Modal titulo="Renovar la mensualidad" alCerrar={cerrar} ancho="amplio">
      <div className="mt-2 space-y-4">
        <p className="text-slate-700">
          Alumno: <strong className="break-words text-slate-900">{nombre}</strong>
        </p>
        <fieldset disabled={enCurso} className="min-w-0">
          <CampoSelect etiqueta="Mes a renovar" value={mes} onChange={(evento) => setMes(evento.target.value)}>
            {permitidos.map((valor) => (
              <option key={valor} value={valor}>
                {formatearMes(valor)}
              </option>
            ))}
          </CampoSelect>
        </fieldset>
        {mes > mesEnCurso ? (
          <Aviso>
            Estás renovando {formatearMes(mes)}, el mes siguiente. Hasta el día 1, el lugar de cada alumno vigente en
            sus clases queda apartado para él: las clases con «Su horario» son las que este alumno ya tenía.
          </Aviso>
        ) : null}

        {oferta ? (
          <FormularioDeRenovacion
            key={oferta.mes}
            alumnoId={alumnoId}
            oferta={oferta}
            clave={clave}
            alEnviando={setEnCurso}
            alCerrar={cerrar}
            alTerminar={setHecho}
          />
        ) : consulta.isError ? (
          <div className="space-y-3">
            {esErrorDeApi(consulta.error, 401) ? null : <Alerta>{mensajeDeOferta(consulta.error)}</Alerta>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
                Volver
              </button>
              {esErrorDeApi(consulta.error, 404) || esErrorDeApi(consulta.error, 403) ? null : (
                <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
                  Volver a intentar
                </button>
              )}
            </div>
          </div>
        ) : (
          <p role="status" className="text-slate-700">
            Cargando los planes y las clases…
          </p>
        )}
      </div>
    </Modal>
  );
}

interface PropiedadesFormulario {
  alumnoId: string;
  oferta: OfertaRenovacion;
  clave: string;
  alEnviando: (enCurso: boolean) => void;
  alCerrar: () => void;
  alTerminar: (respuesta: RespuestaRenovacion) => void;
}

type CampoComprobante = 'numeroOperacion' | 'monto' | 'fechaOperacion';

/** El plan y las clases con las que se abre el formulario: las de la mensualidad actual, si siguen en la oferta y tienen lugar. */
function seleccionInicial(oferta: OfertaRenovacion): { planId: string; claseIds: string[] } {
  const actual = oferta.mensualidadActual;
  const plan = actual ? oferta.planes.find((candidato) => candidato.id === actual.plan.id) : undefined;
  if (!actual || !plan) return { planId: '', claseIds: [] };
  const disponibles = new Map(clasesDelPlan(oferta.clases, plan).map((clase) => [clase.id, clase]));
  const claseIds: string[] = [];
  for (const clase of actual.clases) {
    const disponible = disponibles.get(clase.id);
    if (disponible && disponible.cuposRestantes > 0) claseIds.push(disponible.id);
  }
  return { planId: plan.id, claseIds: claseIds.length === plan.vecesPorSemana ? claseIds : [] };
}

function FormularioDeRenovacion({ alumnoId, oferta, clave, alEnviando, alCerrar, alTerminar }: PropiedadesFormulario) {
  const inicial = useState(() => seleccionInicial(oferta))[0];
  const [planId, setPlanId] = useState(inicial.planId);
  const [claseIds, setClaseIds] = useState<string[]>(inicial.claseIds);
  const [metodo, setMetodo] = useState<Metodo>('EFECTIVO');
  const [cambioDeMonto, setCambioDeMonto] = useState<{ firma: string; total: string } | null>(null);
  const [numeroOperacion, setNumeroOperacion] = useState('');
  const [montoEscrito, setMontoEscrito] = useState<string | null>(null);
  const [fechaOperacion, setFechaOperacion] = useState(hoyEnLima());
  const [errores, setErrores] = useState<Partial<Record<CampoComprobante, string>>>({});
  const [faltaImagen, setFaltaImagen] = useState(false);
  const elegida = useFotoElegida();
  const enCurso = useRef(false);

  const efectivo = useRenovarEnEfectivo(alumnoId);
  const comprobante = useRenovarConComprobante(alumnoId);
  const mutacion = metodo === 'EFECTIVO' ? efectivo : comprobante;
  const falla: unknown = mutacion.isError ? mutacion.error : null;
  const { consulta: consultaCaja, caja, revisada, abierta, fallo } = useCajaDeHoyAbierta();

  const plan: PlanPublico | undefined = oferta.planes.find((candidato) => candidato.id === planId);
  const filas = plan ? clasesDelPlan(oferta.clases, plan) : [];
  const dias = [...new Set(filas.map((clase) => clase.diaSemana))];
  const completa = plan !== undefined && claseIds.length === plan.vecesPorSemana;
  const seleccion: CotizarRenovacion | null = completa ? { mes: oferta.mes, planId, claseIds } : null;
  const firma = seleccion ? `${seleccion.planId}|${[...seleccion.claseIds].sort().join(',')}` : '';
  const cotizacion = useCotizacionDeRenovacion(alumnoId, seleccion);
  useAlPerderSesion(cotizacion.error, consultaCaja.error, efectivo.error, comprobante.error);

  const total = cambioDeMonto && cambioDeMonto.firma === firma ? cambioDeMonto.total : (cotizacion.data?.monto ?? null);
  const monto = montoEscrito ?? total ?? '';
  const pendiente = mutacion.isPending;
  const sinSalida = mutacion.isError && esRenovacionSinSalida(mutacion.error);
  const futuro = oferta.mes > mesActualEnLima();
  const minimaFecha = futuro ? oferta.ventana.desde : `${oferta.mes}-01`;
  const hoy = hoyEnLima();

  const avisoDeMonto = metodo === 'EFECTIVO' && mutacion.isError && esCambioDeMonto(mutacion.error);
  const errorDeCaja = mutacion.isError && esErrorDeCajaAlRenovar(mutacion.error);
  // En el comprobante, el monto, el número y la fecha se avisan dentro de su campo y no se repiten abajo.
  const enSuCampo =
    metodo !== 'EFECTIVO' &&
    mutacion.isError &&
    (esCambioDeMonto(mutacion.error) ||
      esErrorDeCampoDelComprobante(mutacion.error) ||
      erroresPorCampo(mutacion.error).length > 0);
  const errorGeneral =
    mutacion.isError &&
    !avisoDeMonto &&
    !errorDeCaja &&
    !enSuCampo &&
    !esErrorDeApi(mutacion.error, 401) &&
    !esErrorDeCambioDeSesion(mutacion.error);

  const limpiarResultado = () => {
    efectivo.reset();
    comprobante.reset();
    setErrores({});
    setCambioDeMonto(null);
  };

  const elegirPlan = (id: string) => {
    setPlanId(id);
    setClaseIds([]);
    limpiarResultado();
  };

  const elegirClase = (id: string) => {
    const clase = filas.find((candidata) => candidata.id === id);
    if (!plan || !clase) return;
    setClaseIds((actuales) => alternarClase(actuales, clase, filas, plan.vecesPorSemana));
    limpiarResultado();
  };

  const alFallar = (error: unknown) => {
    // El total que se ve pasa a ser el nuevo: el próximo envío lleva lo que la persona acaba de leer.
    const nuevo = totalDeLaRenovacion(error);
    if (nuevo) {
      setCambioDeMonto({ firma, total: nuevo });
      setMontoEscrito(null);
      if (metodo !== 'EFECTIVO') setErrores({ monto: mensajeDeRenovacion(error) });
    }
    // Las clases que se llenaron se quitan de lo elegido: la oferta ya se volvió a pedir.
    const llenas = clasesSinCupo(error);
    if (llenas.length > 0) setClaseIds((actuales) => actuales.filter((id) => !llenas.includes(id)));
    const delServidor: Partial<Record<CampoComprobante, string>> = {};
    if (esErrorDeApi(error, 409, 'NUMERO_OPERACION_YA_USADO')) delServidor.numeroOperacion = mensajeDeRenovacion(error);
    if (esErrorDeApi(error, 409, 'FECHA_OPERACION_NO_VALIDA')) delServidor.fechaOperacion = mensajeDeRenovacion(error);
    for (const { campo, mensaje } of erroresPorCampo(error)) {
      if (campo === 'numeroOperacion' || campo === 'monto' || campo === 'fechaOperacion') delServidor[campo] = mensaje;
    }
    if (Object.keys(delServidor).length > 0) setErrores((anteriores) => ({ ...anteriores, ...delServidor }));
  };

  const terminar = (respuesta: RespuestaRenovacion) => {
    alEnviando(false);
    alTerminar(respuesta);
  };

  const cobrarEnEfectivo = () => {
    // Dos clics en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente || !abierta || !seleccion || total === null) return;
    const datos = renovarEnEfectivoSchema.safeParse({ claveIdempotencia: clave, ...seleccion, montoMostrado: total });
    if (!datos.success) return;
    enCurso.current = true;
    alEnviando(true);
    efectivo.mutate(datos.data, {
      onSuccess: terminar,
      onError: (error) => {
        alEnviando(false);
        alFallar(error);
      },
      onSettled: () => {
        enCurso.current = false;
      },
    });
  };

  const enviarComprobante = () => {
    if (enCurso.current || pendiente || !seleccion) return;
    const archivo = elegida.foto?.archivo;
    setFaltaImagen(!archivo);
    const problemas: Partial<Record<CampoComprobante, string>> = {};
    if (fechaOperacion === '') problemas.fechaOperacion = 'Elige la fecha de la operación.';
    else if (fechaOperacion > hoy) problemas.fechaOperacion = 'La fecha de la operación no puede ser posterior a hoy.';
    else if (fechaOperacion < minimaFecha) {
      problemas.fechaOperacion = `La fecha de la operación no puede ser anterior al ${formatearFechaCalendario(minimaFecha)}.`;
    }
    const datos = datosRenovacionComprobanteSchema.safeParse({
      claveIdempotencia: clave,
      ...seleccion,
      metodo,
      numeroOperacion,
      monto: monto.trim(),
      fechaOperacion,
    });
    if (!datos.success) {
      for (const problema of datos.error.issues) {
        const campo = problema.path[0];
        if ((campo === 'numeroOperacion' || campo === 'monto' || campo === 'fechaOperacion') && !problemas[campo]) {
          problemas[campo] = problema.message;
        }
      }
    }
    setErrores(problemas);
    if (!archivo || !datos.success || Object.keys(problemas).length > 0) return;
    enCurso.current = true;
    alEnviando(true);
    comprobante.mutate(
      { datos: datos.data, archivo },
      {
        onSuccess: (respuesta) => {
          elegida.elegir(null);
          terminar(respuesta);
        },
        onError: (error) => {
          alEnviando(false);
          alFallar(error);
        },
        onSettled: () => {
          enCurso.current = false;
        },
      },
    );
  };

  return (
    <form
      noValidate
      onSubmit={(evento) => {
        evento.preventDefault();
        if (metodo === 'EFECTIVO') cobrarEnEfectivo();
        else enviarComprobante();
      }}
      className="space-y-4"
    >
      <fieldset disabled={pendiente} className="min-w-0 space-y-4">
        <legend className="sr-only">Datos de la renovación</legend>

        <fieldset className="min-w-0">
          <legend className="text-sm font-medium text-slate-800">Plan</legend>
          {oferta.planes.length === 0 ? (
            <p className="mt-1 text-sm text-slate-700">
              No hay planes disponibles para este alumno en {formatearMes(oferta.mes)}.
            </p>
          ) : (
            <div className="mt-1 space-y-2">
              {oferta.planes.map((candidato) => (
                <label
                  key={candidato.id}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-white p-3 text-base text-slate-900 ring-1 ring-slate-300 has-[:checked]:ring-2 has-[:checked]:ring-sky-700"
                >
                  <input
                    type="radio"
                    name="plan"
                    value={candidato.id}
                    checked={planId === candidato.id}
                    onChange={() => elegirPlan(candidato.id)}
                    className="mt-1 size-5 shrink-0 accent-sky-700"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{candidato.nombre}</span>
                    <span className="block text-sm text-slate-700">
                      {candidato.vecesPorSemana === 1 ? '1 vez' : `${candidato.vecesPorSemana} veces`} por semana ·{' '}
                      {candidato.clasesPorMes} clases al mes · {formatearSoles(candidato.precio)} al mes
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {plan ? (
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-medium text-slate-800">
              Días y horario (
              {plan.vecesPorSemana === 1 ? 'elige 1 clase' : `elige ${plan.vecesPorSemana} clases, una por día`})
            </legend>
            <p className="text-sm text-slate-700" aria-live="polite">
              Elegiste {claseIds.length} de {plan.vecesPorSemana}.
            </p>
            {filas.length === 0 ? (
              <p className="text-sm text-slate-700">No hay clases para este plan y el nivel del alumno.</p>
            ) : null}
            {dias.map((dia) => {
              const delDia = filas.filter((clase) => clase.diaSemana === dia);
              const diaConElegida = delDia.some((otra) => claseIds.includes(otra.id));
              const completo = claseIds.length >= plan.vecesPorSemana && !diaConElegida;
              return (
                <div
                  key={dia}
                  role="group"
                  aria-label={NOMBRE_DIA[dia]}
                  className="rounded-lg bg-white p-3 ring-1 ring-slate-200"
                >
                  <p className="text-sm font-semibold text-slate-900">{NOMBRE_DIA[dia]}</p>
                  <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                    {delDia.map((clase) => {
                      const marcada = claseIds.includes(clase.id);
                      const llena = clase.cuposRestantes === 0;
                      const bloqueada = (llena || completo) && !marcada;
                      return (
                        <label
                          key={clase.id}
                          className={`flex min-h-11 items-center gap-3 text-base ${bloqueada ? 'cursor-not-allowed text-slate-500' : 'cursor-pointer text-slate-900'}`}
                        >
                          <input
                            type="checkbox"
                            checked={marcada}
                            disabled={bloqueada}
                            onChange={() => elegirClase(clase.id)}
                            className="size-5 shrink-0 accent-sky-700"
                          />
                          <span>
                            {clase.horaInicio} a {clase.horaFin}
                            <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                              {llena ? 'Llena' : textoDeCupos(clase.cuposRestantes)}
                              {clase.conPrioridad ? <Insignia color="azul">Su horario</Insignia> : null}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </fieldset>
        ) : null}

        {completa ? (
          <section aria-label="Cotización" className="rounded-2xl bg-sky-50 p-4 text-center ring-1 ring-sky-100">
            {cotizacion.data ? (
              <>
                <span className="block text-sm text-slate-700">Total a cobrar</span>
                <span className="block text-3xl font-semibold text-slate-900">{formatearSoles(total ?? '')}</span>
                <span className="block text-sm text-slate-700">
                  {cotizacion.data.clasesTotales} clases · del {formatearFechaCalendario(cotizacion.data.fechaInicio)}{' '}
                  al {formatearFechaCalendario(cotizacion.data.fechaFin)}. El precio ya incluye IGV.
                </span>
                {cotizacion.data.esProporcional ? (
                  <span className="mt-1 block text-sm text-slate-800">
                    Monto proporcional: {cotizacion.data.clasesTotales} de {cotizacion.data.clasesPorMes} clases del mes
                    (precio del plan {formatearSoles(cotizacion.data.precioPlan)}).
                  </span>
                ) : null}
              </>
            ) : cotizacion.isError ? (
              esErrorDeApi(cotizacion.error, 401) ? null : (
                <span role="alert" className="block text-sm text-red-800">
                  {mensajeDeRenovacion(cotizacion.error)}
                </span>
              )
            ) : (
              <span role="status" className="block text-sm text-slate-700">
                Calculando el monto…
              </span>
            )}
          </section>
        ) : null}

        {completa && total !== null ? (
          <>
            <CampoSelect
              etiqueta="Método de pago"
              value={metodo}
              onChange={(evento) => {
                setMetodo(
                  evento.target.value === 'YAPE'
                    ? 'YAPE'
                    : evento.target.value === 'TRANSFERENCIA'
                      ? 'TRANSFERENCIA'
                      : 'EFECTIVO',
                );
                limpiarResultado();
              }}
            >
              {METODOS.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </CampoSelect>

            {metodo === 'EFECTIVO' ? (
              <>
                {!revisada && !fallo ? (
                  <p role="status" className="text-sm text-slate-700">
                    Revisando la caja…
                  </p>
                ) : null}
                {fallo ? (
                  <div className="space-y-2">
                    <Alerta>No pudimos revisar la caja. {mensajeGeneral(consultaCaja.error)}</Alerta>
                    <button
                      type="button"
                      onClick={() => void consultaCaja.refetch()}
                      className={ESTILO_BOTON.secundario}
                    >
                      Reintentar
                    </button>
                  </div>
                ) : null}
                {revisada && !abierta ? (
                  <div className="space-y-2">
                    <Alerta>
                      {caja != null && caja.estado === 'ABIERTA'
                        ? `La caja abierta es del ${formatearFechaCalendario(caja.fecha)}. Ciérrala y abre la de hoy antes de cobrar.`
                        : caja != null
                          ? 'Abre la caja antes de cobrar. La caja de hoy ya se cerró: el administrador puede reabrirla.'
                          : 'Abre la caja antes de cobrar.'}
                    </Alerta>
                    <Link to="/panel/caja" className={ESTILO_BOTON.secundario}>
                      Ir a la caja
                    </Link>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-700">
                  El comprobante queda por verificar en «Pagos por verificar». El lugar queda reservado y la mensualidad
                  empieza a valer cuando se aprueba el pago; el ingreso entra a la caja abierta en ese momento.
                </p>
                <CampoTexto
                  etiqueta="Número de operación"
                  autoComplete="off"
                  autoCapitalize="characters"
                  ayuda="Lo ves en el comprobante del Yape o de la transferencia."
                  value={numeroOperacion}
                  onChange={(evento) => {
                    setNumeroOperacion(evento.target.value);
                    setErrores((anteriores) => ({ ...anteriores, numeroOperacion: undefined }));
                  }}
                  error={errores.numeroOperacion}
                />
                <CampoTexto
                  etiqueta="Monto pagado (S/)"
                  inputMode="decimal"
                  autoComplete="off"
                  ayuda={`Debe ser igual al total a pagar: ${formatearSoles(total)}.`}
                  value={monto}
                  onChange={(evento) => {
                    setMontoEscrito(evento.target.value);
                    setErrores((anteriores) => ({ ...anteriores, monto: undefined }));
                  }}
                  error={errores.monto}
                />
                <CampoTexto
                  etiqueta="Fecha de la operación"
                  type="date"
                  min={minimaFecha}
                  max={hoy}
                  value={fechaOperacion}
                  onChange={(evento) => {
                    setFechaOperacion(evento.target.value);
                    setErrores((anteriores) => ({ ...anteriores, fechaOperacion: undefined }));
                  }}
                  error={errores.fechaOperacion}
                />
                <div>
                  <CampoFoto
                    foto={elegida.foto}
                    aviso={elegida.aviso}
                    alElegir={(archivo) => {
                      setFaltaImagen(false);
                      elegida.elegir(archivo);
                    }}
                    etiqueta="Imagen del comprobante (cámara o galería)"
                    nombre={NOMBRE_COMPROBANTE}
                  />
                  <p className="mt-1 text-sm text-slate-600">JPG o PNG de hasta {FOTO_MEGABYTES_MAXIMOS} MB.</p>
                  {faltaImagen && !elegida.foto ? (
                    <p role="alert" className="mt-1 text-sm text-red-700">
                      Elige la imagen del comprobante.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </>
        ) : null}
      </fieldset>

      {avisoDeMonto ? <Aviso>{mensajeDeRenovacion(falla)}</Aviso> : null}
      {errorDeCaja ? (
        <div className="space-y-2">
          <Alerta>{mensajeDeRenovacion(falla)}</Alerta>
          <Link to="/panel/caja" className={ESTILO_BOTON.secundario}>
            Ir a la caja
          </Link>
        </div>
      ) : null}
      {errorGeneral ? <Alerta>{mensajeDeRenovacion(falla)}</Alerta> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={alCerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
          {sinSalida ? 'Cerrar' : 'Volver'}
        </button>
        {metodo === 'EFECTIVO' ? (
          <button
            type="submit"
            disabled={pendiente || sinSalida || !completa || total === null || !abierta}
            className={ESTILO_BOTON.primario}
          >
            {pendiente ? 'Cobrando…' : total !== null && completa ? `Cobrar ${formatearSoles(total)}` : 'Cobrar'}
          </button>
        ) : (
          <button
            type="submit"
            disabled={pendiente || sinSalida || !completa || total === null}
            className={ESTILO_BOTON.primario}
          >
            {pendiente ? 'Enviando…' : 'Enviar a verificación'}
          </button>
        )}
      </div>
    </form>
  );
}

function ResultadoDeRenovacion({
  nombre,
  respuesta,
  alCerrar,
}: {
  nombre: string;
  respuesta: RespuestaRenovacion;
  alCerrar: () => void;
}) {
  const { renovacion, pago, repetida } = respuesta;
  const enVerificacion = renovacion.estado === 'EN_VERIFICACION';
  return (
    <Modal titulo={enVerificacion ? 'Renovación enviada a verificación' : 'Renovación registrada'} alCerrar={alCerrar}>
      <div className="mt-2 space-y-4">
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          {enVerificacion
            ? `Se envió a verificación el pago de ${formatearSoles(pago.monto)} de ${nombre}.`
            : `Se cobró ${formatearSoles(pago.monto)} en efectivo a ${nombre}.`}
          {pago.numeroTicket !== null ? ` Ticket N.º ${pago.numeroTicket}.` : ''}
        </p>
        {repetida ? (
          <Aviso>Esta renovación ya estaba registrada con la misma clave: no se cobró otra vez.</Aviso>
        ) : null}
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-slate-600">Mes</dt>
          <dd className="text-slate-900">{formatearMes(renovacion.mes)}</dd>
          <dt className="font-medium text-slate-600">Plan</dt>
          <dd className="text-slate-900">{renovacion.plan.nombre}</dd>
          <dt className="font-medium text-slate-600">Clases</dt>
          <dd className="text-slate-900">
            {renovacion.clasesTotales} del {formatearFechaCalendario(renovacion.fechaInicio)} al{' '}
            {formatearFechaCalendario(renovacion.fechaFin)}
          </dd>
          <dt className="font-medium text-slate-600">Horario</dt>
          <dd className="text-slate-900">
            {renovacion.clases
              .map((clase) => `${NOMBRE_DIA[clase.diaSemana]} ${clase.horaInicio} a ${clase.horaFin}`)
              .join(' · ')}
          </dd>
        </dl>
        <p className="text-sm text-slate-700">
          {enVerificacion
            ? 'El lugar queda reservado. La mensualidad empieza a valer cuando se apruebe el comprobante en «Pagos por verificar».'
            : 'La mensualidad ya está vigente y el ingreso quedó en la caja de hoy.'}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cerrar
          </button>
          {enVerificacion ? (
            <Link to="/panel/pagos" className={ESTILO_BOTON.primario}>
              Ir a pagos por verificar
            </Link>
          ) : (
            <Link to={`/panel/pagos/${encodeURIComponent(pago.id)}/ticket`} className={ESTILO_BOTON.primario}>
              Imprimir ticket
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}
