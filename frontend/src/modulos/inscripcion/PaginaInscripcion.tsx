import {
  type ClasePublica,
  cotizarInscripcionSchema,
  type Cotizacion,
  enviarInscripcionSchema,
  type MesesInscripcion,
  NOMBRE_DIA,
  type RespuestaInscripcionCreada,
  type TextosConsentimiento,
} from '@aquagestion/contratos';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Path, useForm, useWatch } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { ErrorDeApi, esErrorDeApi } from '../../api/cliente';
import { MarcoPublico } from '../../componentes/MarcoPublico';
import { frasePorTelefono } from '../../componentes/Telefono';
import { Alerta, Aviso, ESTILO_BOTON } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { formatearDiaYMes, formatearMes, mesSiguiente, nombreDelMes } from '../../lib/fechas';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { useFotoElegida, useSubirFoto } from '../foto/hooks';
import {
  CAMPOS_INICIALES,
  type CamposInscripcion,
  construirEnvio,
  type Errores,
  erroresDeEsquema,
  ETIQUETA_PASO,
  esMenor,
  nuevaClaveDeEnvio,
  type Paso,
  pasoDeCampo,
  pasosDeInscripcion,
  validarPaso,
} from './campos';
import { ConfirmacionInscripcion } from './ConfirmacionInscripcion';
import {
  clasesSinCupoDe,
  codigoDeSolicitudYaRegistrada,
  cotizacionDeMontoCambio,
  textosActualizadosDe,
} from './errores';
import { useCotizar, useEnviarInscripcion, useFormularioInscripcion, useMesesInscripcion } from './hooks';
import { PasoApoderado } from './pasos/PasoApoderado';
import { PasoDatos } from './pasos/PasoDatos';
import { PasoFicha } from './pasos/PasoFicha';
import { PasoFoto } from './pasos/PasoFoto';
import { PasoMes } from './pasos/PasoMes';
import { PasoPlan } from './pasos/PasoPlan';
import { PasoResumen } from './pasos/PasoResumen';
import { mensajeDeError } from './pasos/comun';

type Solicitud = RespuestaInscripcionCreada['solicitud'];

/**
 * `/a/{nombreCorto}/inscripcion`: el formulario público de inscripción (HU-01, HU-02; criterio 43 de 005), sin sesión, para el celular y
 * para la PC de recepción. Guía por pasos: datos personales, ficha médica, apoderado (solo si es menor), nivel, plan y clases, la
 * foto opcional (que se sube aparte, después del 201) y el resumen con la cotización y los consentimientos. Si la academia está en la ventana
 * de renovación, el primer paso pregunta desde cuándo empieza la persona: este mes o el siguiente completo (010d, criterio 17). Es el mismo
 * formulario para el cliente y para la secretaria que inscribe desde «Nueva inscripción» (DR-3).
 */
export function PaginaInscripcion() {
  const { nombreCorto = '' } = useParams();
  return (
    <MarcoPublico nombreCorto={nombreCorto} ancho="amplio">
      <ContenidoInscripcion nombreCorto={nombreCorto} />
    </MarcoPublico>
  );
}

function ContenidoInscripcion({ nombreCorto }: { nombreCorto: string }) {
  const meses = useMesesInscripcion(nombreCorto);

  if (meses.data === undefined) {
    if (meses.isPending) {
      return (
        <p role="status" className="text-slate-600">
          Cargando el formulario…
        </p>
      );
    }
    return <ErrorDeCarga error={meses.error} reintentar={() => void meses.refetch()} />;
  }
  if (meses.data.meses.length === 0) {
    return <Alerta>Por ahora no hay meses disponibles para inscribirse.</Alerta>;
  }
  const recargarMeses = async (): Promise<MesesInscripcion | undefined> => {
    const resultado = await meses.refetch();
    return resultado.isError ? undefined : resultado.data;
  };
  return <Asistente nombreCorto={nombreCorto} meses={meses.data} recargarMeses={recargarMeses} />;
}

/** Lo que se ve cuando no cargaron los meses o la oferta: el motivo y la forma de intentar de nuevo. */
function ErrorDeCarga({ error, reintentar }: { error: unknown; reintentar: () => void }) {
  return (
    <div className="space-y-3">
      <Alerta>{textoDeErrorDeCarga(error)}</Alerta>
      <button type="button" onClick={reintentar} className={ESTILO_BOTON.secundario}>
        Reintentar
      </button>
    </div>
  );
}

function textoDeErrorDeCarga(error: unknown): string {
  return esErrorDeApi(error, 429)
    ? 'Hiciste demasiadas consultas desde esta conexión. Espera un minuto e inténtalo de nuevo.'
    : mensajeGeneral(error);
}

/** Un nombre de ruta de campo de la API como ruta del formulario: sin los números de posición (`claseIds.2` es `claseIds`). */
function rutaDeCampo(campo: string): string {
  return campo
    .split('.')
    .filter((parte) => !/^[0-9]+$/.test(parte))
    .join('.');
}

interface DetalleDeError {
  /** Lo que se le dice a la persona. */
  texto: string;
  /** Si la persona ya tiene una solicitud o puede consultarla, un enlace a la consulta con código y DNI. */
  conConsulta: boolean;
}

function Asistente({
  nombreCorto,
  meses,
  recargarMeses,
}: {
  nombreCorto: string;
  meses: MesesInscripcion;
  recargarMeses: () => Promise<MesesInscripcion | undefined>;
}) {
  const form = useForm<CamposInscripcion>({ defaultValues: CAMPOS_INICIALES });
  const { control, getValues, setError: marcarError, setValue } = form;
  // La clave se crea una vez por formulario: un doble clic o un reintento no duplica la solicitud (criterio 43).
  const [claveDeEnvio] = useState(nuevaClaveDeEnvio);
  const clienteDeConsultas = useQueryClient();
  const conElegirMes = meses.meses.length > 1;
  const [pasoActual, setPaso] = useState<Paso>(conElegirMes ? 'mes' : 'datos');
  const [recargandoMeses, setRecargandoMeses] = useState(false);
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [creada, setCreada] = useState<Solicitud | null>(null);
  const [llenas, setLlenas] = useState<ClasePublica[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<DetalleDeError | null>(null);
  // Tras un cambio de monto o de mes, enviar de nuevo pide una confirmación explícita (criterio 43).
  const [pideConfirmar, setPideConfirmar] = useState(false);
  const [textosNuevos, setTextosNuevos] = useState<{
    menor: boolean;
    version: string;
    textos: TextosConsentimiento;
  } | null>(null);
  const cotizar = useCotizar(nombreCorto);
  const enviar = useEnviarInscripcion(nombreCorto);
  const fotoElegida = useFotoElegida();
  const subirFoto = useSubirFoto(nombreCorto);

  const fechaNacimiento = useWatch({ control, name: 'alumno.fechaNacimiento' });
  const nivel = useWatch({ control, name: 'alumno.nivel' });
  const planId = useWatch({ control, name: 'inscripcion.planId' });
  const claseIds = useWatch({ control, name: 'inscripcion.claseIds' });
  const mesDelFormulario = useWatch({ control, name: 'inscripcion.mes' });

  // El mes de la inscripción: el único que ofrece la API, o el que la persona eligió entre dos. Sin elegir todavía, es `null` y la persona
  // está en el paso del mes (010d, criterio 17). La oferta (planes, clases y cupos) es la de ese mes.
  const mesesOfrecidos = meses.meses.map((ofrecido) => ofrecido.mes);
  const mesElegido: string | null = conElegirMes
    ? mesesOfrecidos.includes(mesDelFormulario)
      ? mesDelFormulario
      : null
    : (mesesOfrecidos[0] ?? null);
  const paso: Paso = conElegirMes && mesElegido === null ? 'mes' : pasoActual;
  const consultaOferta = useFormularioInscripcion(nombreCorto, mesElegido);
  const oferta = consultaOferta.data;
  const hoy = oferta?.hoy ?? meses.hoy;
  const telefonoAcademia = oferta?.academia.telefono ?? null;
  const recargarOferta = () => {
    if (mesElegido !== null) void consultaOferta.refetch();
  };

  const menor = esMenor(fechaNacimiento, hoy);
  const pasos = pasosDeInscripcion(menor, conElegirMes);
  const indice = Math.max(0, pasos.indexOf(paso));
  const plan = oferta?.planes.find((candidato) => candidato.id === planId);
  const elegidas = [...(oferta?.clases ?? []), ...llenas].filter((clase) => claseIds.includes(clase.id));
  const textosVigentes =
    textosNuevos && textosNuevos.menor === menor
      ? textosNuevos
      : oferta
        ? {
            version: oferta.consentimientos.version,
            textos: menor ? oferta.consentimientos.textosMenor : oferta.consentimientos.textos,
          }
        : null;

  // Al cambiar de paso, el foco va al encabezado del paso (lectores de pantalla y teclado) y la pantalla se acerca a él.
  const encabezado = useRef<HTMLHeadingElement>(null);
  const primerPaso = useRef(true);
  useEffect(() => {
    if (primerPaso.current) {
      primerPaso.current = false;
      return;
    }
    encabezado.current?.focus();
  }, [paso]);

  /** Un paso que no existe en este formulario (el del mes, con un solo mes) cae en el del plan. */
  const pasoQueExiste = (destino: Paso): Paso => (pasos.includes(destino) ? destino : 'plan');

  const irA = (nuevo: Paso) => {
    setPaso(nuevo);
    setAviso(null);
    setError(null);
  };

  const marcarErrores = (errores: Errores) => {
    let primero = true;
    for (const [ruta, message] of Object.entries(errores)) {
      marcarError(ruta as Path<CamposInscripcion>, { message }, { shouldFocus: primero });
      primero = false;
    }
  };

  // --- Errores de la selección: la persona vuelve a elegir con la oferta al día ---------------------------------------------------

  const volverAElegir = (texto: string, opciones: { quitarPlan?: boolean; quitarClases?: boolean } = {}) => {
    if (opciones.quitarPlan) setValue('inscripcion.planId', '');
    if (opciones.quitarClases || opciones.quitarPlan) setValue('inscripcion.claseIds', []);
    setPaso('plan');
    setCotizacion(null);
    setPideConfirmar(false);
    setAviso(null);
    setError({ texto, conConsulta: false });
    recargarOferta();
  };

  /**
   * Ya no quedan clases este mes con las clases elegidas. Si todavía no abre la inscripción al mes siguiente, el aviso dice desde qué fecha
   * (DR-4); si ya está abierta, que se puede volver a elegir el mes. Sin el mes siguiente a la vista, el mensaje de la API.
   */
  const textoSinClasesEnElMes = (mensajeDeLaApi: string): string => {
    const base = 'Ya no quedan clases este mes con las clases elegidas.';
    if (meses.aperturaMesSiguiente) {
      const mesDeLaApertura = meses.aperturaMesSiguiente.slice(0, 7);
      return `${base} Las inscripciones para ${nombreDelMes(mesSiguiente(mesDeLaApertura))} se abren el ${formatearDiaYMes(meses.aperturaMesSiguiente)}.`;
    }
    const siguiente = meses.meses[1];
    if (siguiente && mesElegido !== siguiente.mes) {
      return `${base} Puedes volver al primer paso y elegir ${nombreDelMes(siguiente.mes)} completo.`;
    }
    return mensajeDeLaApi;
  };

  /**
   * El mes cambió desde que la persona empezó (010d, criterio 17): se piden de nuevo los meses y la oferta, se descarta lo que dependía del
   * mes (plan, clases y cotización) y se pide elegir otra vez. Con dos meses, la persona vuelve al paso del mes; con uno, al del plan.
   */
  const reiniciarPorCambioDeMes = async () => {
    setValue('inscripcion.mes', '');
    setValue('inscripcion.planId', '');
    setValue('inscripcion.claseIds', []);
    setCotizacion(null);
    setLlenas([]);
    setPideConfirmar(false);
    setAviso(null);
    setError(null);
    setRecargandoMeses(true);
    // La oferta se pide otra vez aunque falle la recarga de los meses.
    void clienteDeConsultas.invalidateQueries({ queryKey: ['inscripcion', nombreCorto, 'oferta'] });
    const nuevos = await recargarMeses();
    setRecargandoMeses(false);
    const variosMeses = (nuevos ?? meses).meses.length > 1;
    setPaso(variosMeses ? 'mes' : 'plan');
    setError({
      texto: `Cambió el mes desde que empezaste la inscripción. ${variosMeses ? 'Elige otra vez desde cuándo quieres empezar.' : 'Elige otra vez el plan y las clases.'}`,
      conConsulta: false,
    });
  };

  /** Elegir el otro mes descarta lo que dependía del mes: el plan, las clases y la cotización (010d, criterio 17). */
  const elegirMes = (mes: string) => {
    if (mes === mesElegido) return;
    setValue('inscripcion.mes', mes, { shouldDirty: true });
    form.clearErrors('inscripcion.mes');
    setValue('inscripcion.planId', '');
    setValue('inscripcion.claseIds', []);
    setCotizacion(null);
    setLlenas([]);
    setPideConfirmar(false);
    setAviso(null);
    setError(null);
  };

  /** Errores que comparten la cotización y el envío (el mismo orden de la spec). Devuelve `true` si ya los atendió. */
  const atenderErrorDeSeleccion = (falla: unknown): boolean => {
    if (!(falla instanceof ErrorDeApi) || falla.estado !== 409) return false;
    switch (falla.codigo) {
      case 'PLAN_NO_DISPONIBLE':
        volverAElegir(falla.message, { quitarPlan: true });
        return true;
      case 'SELECCION_NO_VALIDA':
        volverAElegir(falla.message, { quitarClases: true });
        return true;
      case 'SIN_CLASES_EN_EL_MES':
        volverAElegir(textoSinClasesEnElMes(falla.message));
        return true;
      case 'MES_CAMBIO':
        void reiniciarPorCambioDeMes();
        return true;
      case 'SIN_CUPO': {
        const ids = new Set(clasesSinCupoDe(falla.detalles));
        const nuevasLlenas = [...(oferta?.clases ?? []), ...llenas].filter((clase) => ids.has(clase.id));
        setLlenas((anteriores) => [
          ...anteriores,
          ...nuevasLlenas.filter((clase) => !anteriores.some((otra) => otra.id === clase.id)),
        ]);
        setValue(
          'inscripcion.claseIds',
          getValues('inscripcion.claseIds').filter((id) => !ids.has(id)),
        );
        const nombres = nuevasLlenas.map(
          (clase) => `${NOMBRE_DIA[clase.diaSemana]} ${clase.horaInicio} a ${clase.horaFin}`,
        );
        volverAElegir(
          nombres.length > 0
            ? `Se llenó: ${nombres.join(', ')}. Elige otra opción.`
            : 'Alguna de las clases elegidas se llenó. Elige otra opción.',
        );
        return true;
      }
      default:
        return false;
    }
  };

  // --- Cotización ----------------------------------------------------------------------------------------------------------------

  const pedirCotizacion = (alTerminar: (nueva: Cotizacion) => void) => {
    const campos = getValues();
    const pedido = cotizarInscripcionSchema.safeParse({
      planId: campos.inscripcion.planId,
      nivel: campos.alumno.nivel,
      claseIds: campos.inscripcion.claseIds,
      ...(mesElegido !== null ? { mes: mesElegido } : {}),
    });
    if (!pedido.success) {
      marcarErrores(
        Object.fromEntries(
          Object.entries(erroresDeEsquema(pedido.error)).map(([ruta, m]) => [`inscripcion.${ruta}`, m]),
        ),
      );
      return;
    }
    cotizar.mutate(pedido.data, {
      onSuccess: alTerminar,
      onError: (falla) => {
        if (atenderErrorDeSeleccion(falla)) return;
        setError({
          texto: esErrorDeApi(falla, 429)
            ? `Hiciste demasiadas consultas desde esta conexión. Espera un minuto e inténtalo de nuevo.${frasePorTelefono(telefonoAcademia)}`
            : mensajeGeneral(falla),
          conConsulta: false,
        });
      },
    });
  };

  // --- Envío ---------------------------------------------------------------------------------------------------------------------

  const atenderErrorDeEnvio = (falla: unknown) => {
    if (atenderErrorDeSeleccion(falla)) return;
    const telefono = frasePorTelefono(telefonoAcademia);
    if (esErrorDeApi(falla, 400, 'SOLICITUD_INVALIDA')) {
      const errores: Errores = {};
      for (const { campo, mensaje } of erroresPorCampo(falla)) {
        const ruta = rutaDeCampo(campo);
        if (!(ruta in errores)) errores[ruta] = mensaje;
      }
      const rutas = Object.keys(errores);
      marcarErrores(errores);
      const primera = rutas[0];
      setPaso(primera ? pasoQueExiste(pasoDeCampo(primera)) : 'datos');
      setError({
        texto:
          primera === 'apoderado' || primera === ''
            ? (errores[primera] ?? falla.message)
            : 'Revisa los datos marcados en rojo.',
        conConsulta: false,
      });
      return;
    }
    if (esErrorDeApi(falla, 409, 'MONTO_CAMBIO')) {
      const nueva = cotizacionDeMontoCambio(falla.detalles);
      if (nueva) {
        const anterior = cotizacion?.monto;
        setCotizacion(nueva);
        setPideConfirmar(true);
        setError(null);
        setAviso(
          `${falla.message} ${anterior ? `Antes: ${formatearSoles(anterior)}. ` : ''}Ahora: ${formatearSoles(nueva.monto)}.`,
        );
        return;
      }
    }
    if (esErrorDeApi(falla, 409, 'TEXTOS_ACTUALIZADOS')) {
      const nuevos = textosActualizadosDe(falla.detalles);
      if (nuevos) setTextosNuevos({ menor, ...nuevos });
      setValue('consentimientos.datosPersonales', false);
      setValue('consentimientos.deslinde', false);
      setValue('consentimientos.imagen', false);
      recargarOferta();
      setError(null);
      setAviso(falla.message);
      return;
    }
    if (esErrorDeApi(falla, 409, 'SOLICITUD_YA_REGISTRADA')) {
      const codigo = codigoDeSolicitudYaRegistrada(falla.detalles);
      setError({
        texto: codigo
          ? `Tu solicitud ya se registró. Tu código es ${codigo}. Para seguirla, usa tu código y tu DNI.`
          : `${falla.message}${telefono}`,
        conConsulta: true,
      });
      return;
    }
    if (esErrorDeApi(falla, 409, 'DNI_YA_REGISTRADO')) {
      setError({ texto: `${falla.message}${telefono}`, conConsulta: true });
      return;
    }
    if (esErrorDeApi(falla, 409, 'LIMITE_DE_RESERVAS_PENDIENTES')) {
      setError({ texto: `${falla.message}${telefono}`, conConsulta: false });
      return;
    }
    if (esErrorDeApi(falla, 429)) {
      setError({
        texto: `Hiciste demasiados envíos desde esta conexión. Espera un rato e inténtalo de nuevo.${telefono}`,
        conConsulta: false,
      });
      return;
    }
    setError({ texto: mensajeGeneral(falla), conConsulta: false });
  };

  const enviarFormulario = () => {
    if (enviar.isPending || creada || !cotizacion || !textosVigentes) return;
    const campos = getValues();
    const contexto = { hoy, plan };
    const deConsentimientos = validarPaso('resumen', campos, contexto);
    if (Object.keys(deConsentimientos).length > 0) {
      marcarErrores(deConsentimientos);
      return;
    }
    const validado = enviarInscripcionSchema.safeParse(
      construirEnvio(campos, {
        claveIdempotencia: claveDeEnvio,
        mes: cotizacion.mes,
        montoMostrado: cotizacion.monto,
        version: textosVigentes.version,
        menor,
      }),
    );
    if (!validado.success) {
      const errores = erroresDeEsquema(validado.error);
      marcarErrores(errores);
      const primera = Object.keys(errores)[0];
      setPaso(primera ? pasoQueExiste(pasoDeCampo(primera)) : 'datos');
      setError({ texto: 'Revisa los datos marcados en rojo.', conConsulta: false });
      return;
    }
    setAviso(null);
    setError(null);
    enviar.mutate(validado.data, {
      onSuccess: (solicitud) => {
        // La foto se sube una sola vez, con el token del 201. Pase lo que pase con ella, la solicitud ya quedó creada: la página
        // muestra el código y el enlace (criterio 43). El token no sale de la memoria de la página.
        if (fotoElegida.foto) subirFoto.mutate({ token: solicitud.token, archivo: fotoElegida.foto.archivo });
        fotoElegida.elegir(null);
        // Lo escrito no se queda en la página: solo el código y el enlace.
        form.reset({ ...CAMPOS_INICIALES, inscripcion: { ...CAMPOS_INICIALES.inscripcion, mes: mesElegido ?? '' } });
        setCreada(solicitud);
      },
      onError: atenderErrorDeEnvio,
    });
  };

  // --- Navegación ----------------------------------------------------------------------------------------------------------------

  const avanzar = () => {
    if (cotizar.isPending || enviar.isPending) return;
    const errores = validarPaso(paso, getValues(), { hoy, plan, mesesOfrecidos });
    if (Object.keys(errores).length > 0) {
      marcarErrores(errores);
      return;
    }
    if (paso === 'plan') {
      setPideConfirmar(false);
      pedirCotizacion((nueva) => {
        setCotizacion(nueva);
        irA('foto');
      });
      return;
    }
    if (paso === 'resumen') {
      enviarFormulario();
      return;
    }
    const siguiente = pasos[indice + 1];
    if (siguiente) irA(siguiente);
  };

  const alEnviarForm = (evento: FormEvent) => {
    evento.preventDefault();
    avanzar();
  };

  if (creada) {
    const foto = subirFoto.isPending
      ? 'subiendo'
      : subirFoto.isSuccess
        ? 'cargada'
        : subirFoto.isError
          ? 'fallo'
          : null;
    return <ConfirmacionInscripcion solicitud={creada} telefono={telefonoAcademia} foto={foto} />;
  }

  // Sin la oferta del mes elegido no se puede seguir: en los demás pasos se espera aquí (o se reintenta); en el del mes, el botón espera.
  if (paso !== 'mes' && oferta === undefined) {
    if (consultaOferta.isError) {
      return <ErrorDeCarga error={consultaOferta.error} reintentar={recargarOferta} />;
    }
    return (
      <p role="status" className="text-slate-600">
        Cargando el formulario…
      </p>
    );
  }

  const esperandoOferta = paso === 'mes' && mesElegido !== null && oferta === undefined;
  const ocupado = cotizar.isPending || enviar.isPending || recargandoMeses;
  const etiquetaBoton = (() => {
    if (paso === 'plan') return cotizar.isPending ? 'Calculando…' : 'Siguiente';
    if (paso === 'mes' && esperandoOferta && !consultaOferta.isError) return 'Cargando…';
    if (paso === 'resumen') {
      if (enviar.isPending) return 'Enviando…';
      return pideConfirmar ? 'Confirmar el nuevo monto y enviar' : 'Enviar inscripción';
    }
    return 'Siguiente';
  })();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-sky-900">Inscripción</h1>
        <p className="mt-1 text-slate-700">Completa los pasos para reservar tu lugar en la academia.</p>
        <p className="mt-1 text-sm text-slate-700">
          ¿Ya te inscribiste?{' '}
          <Link to={`/a/${encodeURIComponent(nombreCorto)}/solicitud`} className="text-sky-800 underline">
            Consulta tu solicitud
          </Link>
        </p>
      </div>

      <nav aria-label="Avance de la inscripción" className="space-y-2">
        <p className="text-sm font-medium text-slate-800">
          Paso {indice + 1} de {pasos.length}
        </p>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-sky-100">
          <div
            className="h-full rounded-full bg-sky-700"
            style={{ width: `${((indice + 1) / pasos.length) * 100}%` }}
          />
        </div>
        <ol className="hidden flex-wrap gap-x-4 gap-y-1 text-sm sm:flex">
          {pasos.map((nombre, posicion) => (
            <li
              key={nombre}
              aria-current={nombre === paso ? 'step' : undefined}
              className={nombre === paso ? 'font-semibold text-sky-900' : 'text-slate-600'}
            >
              {posicion + 1}. {ETIQUETA_PASO[nombre]}
            </li>
          ))}
        </ol>
      </nav>

      <form
        onSubmit={alEnviarForm}
        noValidate
        className="space-y-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
      >
        <h2 ref={encabezado} tabIndex={-1} className="text-xl font-semibold text-slate-900 outline-none">
          {ETIQUETA_PASO[paso]}
        </h2>

        {aviso ? <Aviso>{aviso}</Aviso> : null}

        <fieldset disabled={ocupado} className="min-w-0 space-y-5">
          <legend className="sr-only">{ETIQUETA_PASO[paso]}</legend>
          {paso === 'mes' ? (
            <PasoMes
              meses={meses}
              valor={mesElegido ?? ''}
              alElegir={elegirMes}
              error={mensajeDeError(form.formState.errors, 'inscripcion.mes')}
              oferta={{
                cargando: esperandoOferta && !consultaOferta.isError,
                error: mesElegido !== null && consultaOferta.isError ? textoDeErrorDeCarga(consultaOferta.error) : null,
                reintentar: recargarOferta,
              }}
            />
          ) : null}
          {paso === 'datos' ? <PasoDatos form={form} /> : null}
          {paso === 'ficha' ? <PasoFicha form={form} /> : null}
          {paso === 'apoderado' ? <PasoApoderado form={form} /> : null}
          {paso === 'plan' && oferta ? (
            <>
              {conElegirMes ? (
                <p className="text-sm text-slate-700">Los planes y los cupos son de {formatearMes(oferta.mes)}.</p>
              ) : null}
              <PasoPlan form={form} oferta={oferta} llenas={llenas} />
            </>
          ) : null}
          {paso === 'foto' ? (
            <PasoFoto foto={fotoElegida.foto} aviso={fotoElegida.aviso} alElegir={fotoElegida.elegir} />
          ) : null}
          {paso === 'resumen' && cotizacion && plan && textosVigentes && nivelValido(nivel) ? (
            <PasoResumen
              form={form}
              nombreCompleto={`${getValues('alumno.nombres').trim()} ${getValues('alumno.apellidos').trim()}`}
              nivel={nivel}
              plan={plan}
              clases={elegidas}
              cotizacion={cotizacion}
              menor={menor}
              textos={textosVigentes.textos}
            />
          ) : null}
        </fieldset>

        {error ? (
          <div className="space-y-2">
            <Alerta>{error.texto}</Alerta>
            {error.conConsulta ? (
              <p className="text-sm text-slate-700">
                <Link to={`/a/${encodeURIComponent(nombreCorto)}/solicitud`} className="text-sky-800 underline">
                  Consultar mi solicitud con el código y mi DNI
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {indice > 0 ? (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                const anterior = pasos[indice - 1];
                if (anterior) irA(anterior);
              }}
              className={ESTILO_BOTON.secundario}
            >
              Atrás
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={ocupado || (esperandoOferta && !consultaOferta.isError)}
            className={ESTILO_BOTON.primario}
          >
            {etiquetaBoton}
          </button>
        </div>
      </form>
    </div>
  );
}

function nivelValido(nivel: string): nivel is 'BASICO' | 'INTERMEDIO' | 'AVANZADO' {
  return nivel === 'BASICO' || nivel === 'INTERMEDIO' || nivel === 'AVANZADO';
}
