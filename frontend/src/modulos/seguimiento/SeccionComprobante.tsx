import {
  type DatosDePago,
  datosComprobanteSchema,
  type MetodoConComprobante,
  type VistaSolicitudCompleta,
  type VistaSolicitudPagoRechazado,
} from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoSelect, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo } from '../../lib/errores';
import { formatearFechaCalendario, hoyEnLima } from '../../lib/fechas';
import { nuevaClaveUuid } from '../../lib/uuid';
import { CampoFoto } from '../foto/CampoFoto';
import { useFotoElegida } from '../foto/hooks';
import { FOTO_MEGABYTES_MAXIMOS } from '../foto/validacion';
import { useSubirComprobante } from './hooks';
import {
  esFalloQueCambiaLaSolicitud,
  mensajeDeFalloDeComprobante,
  totalDelMontoDistinto,
} from './mensajes-comprobante';

interface Propiedades {
  nombreCorto: string;
  /** El token de la dirección: solo en la memoria de la página. */
  token: string;
  solicitud: VistaSolicitudCompleta | VistaSolicitudPagoRechazado;
  /** Los datos de pago de la academia que tienen valor (criterio 53). */
  datosDePago: DatosDePago | undefined;
  telefono: string | null;
  /** Vuelve a consultar la solicitud (después de enviar, o si dejó de poder pagarse). */
  alActualizar: () => Promise<unknown>;
  /** Un aviso que debe seguir a la vista aunque esta sección desaparezca (la solicitud cambió de estado). */
  alAvisar: (mensaje: string | null) => void;
}

interface Campos {
  metodo: MetodoConComprobante;
  numeroOperacion: string;
  monto: string;
  fechaOperacion: string;
}

const CAMPOS = ['metodo', 'numeroOperacion', 'monto', 'fechaOperacion'] as const;

const METODOS: readonly { valor: MetodoConComprobante; etiqueta: string }[] = [
  { valor: 'YAPE', etiqueta: 'Yape' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia bancaria' },
];

const NOMBRE_COMPROBANTE = {
  vistaPrevia: 'Vista previa de la imagen del comprobante',
  cambiar: 'Cambiar la imagen',
  quitar: 'Quitar la imagen',
};

/** Los datos de pago de la academia, solo los que tienen valor (criterio 53 de 007b). */
function DatosDePagoDeLaAcademia({ datos, telefono }: { datos: DatosDePago | undefined; telefono: string | null }) {
  const yape = datos?.yapeNumero || datos?.yapeTitular;
  const transferencia =
    datos?.transferenciaBanco || datos?.transferenciaCuenta || datos?.transferenciaCci || datos?.transferenciaTitular;
  if (!datos || (!yape && !transferencia)) {
    return (
      <p className="text-sm text-slate-700">
        La academia todavía no publicó sus datos de pago en esta página.
        {telefono ? ` Pídelos llamando al ${telefono}.` : ' Pídelos en recepción.'}
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {yape ? (
        <section aria-label="Datos para pagar con Yape" className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-100">
          <h3 className="font-semibold text-slate-900">Yape</h3>
          <dl className="mt-1 space-y-1 text-sm">
            {datos.yapeNumero ? (
              <div>
                <dt className="text-slate-600">Número</dt>
                <dd className="font-mono text-lg font-semibold text-slate-900">{datos.yapeNumero}</dd>
              </div>
            ) : null}
            {datos.yapeTitular ? (
              <div>
                <dt className="text-slate-600">A nombre de</dt>
                <dd className="break-words text-slate-900">{datos.yapeTitular}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      {transferencia ? (
        <section
          aria-label="Datos para pagar por transferencia"
          className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-100"
        >
          <h3 className="font-semibold text-slate-900">Transferencia</h3>
          <dl className="mt-1 space-y-1 text-sm">
            {datos.transferenciaBanco ? (
              <div>
                <dt className="text-slate-600">Banco</dt>
                <dd className="break-words text-slate-900">{datos.transferenciaBanco}</dd>
              </div>
            ) : null}
            {datos.transferenciaCuenta ? (
              <div>
                <dt className="text-slate-600">Número de cuenta</dt>
                <dd className="break-all font-mono text-slate-900">{datos.transferenciaCuenta}</dd>
              </div>
            ) : null}
            {datos.transferenciaCci ? (
              <div>
                <dt className="text-slate-600">CCI</dt>
                <dd className="break-all font-mono text-slate-900">{datos.transferenciaCci}</dd>
              </div>
            ) : null}
            {datos.transferenciaTitular ? (
              <div>
                <dt className="text-slate-600">Titular</dt>
                <dd className="break-words text-slate-900">{datos.transferenciaTitular}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/**
 * «Pagar con Yape o transferencia» (HU-08, D-05, criterios 36 a 42 y 55 de 007b): los datos de pago de la academia y el formulario del
 * comprobante, en `PENDIENTE_PAGO` y `PAGO_RECHAZADO`. El monto viene con el total ya escrito. La clave de idempotencia se genera al abrir
 * el formulario y no cambia entre intentos, y mientras el envío va en camino no se manda otro: un doble clic o un reintento no duplican el
 * pago. El monto, el método y el estado los decide la API; aquí solo se avisa lo que se puede comprobar sin llamarla.
 */
export function SeccionComprobante({
  nombreCorto,
  token,
  solicitud,
  datosDePago,
  telefono,
  alActualizar,
  alAvisar,
}: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const hoy = hoyEnLima();
  const desde = hoyEnLima(new Date(solicitud.creadaEn));
  const elegida = useFotoElegida();
  const [faltaImagen, setFaltaImagen] = useState(false);
  const enCurso = useRef(false);
  const { register, handleSubmit, setError, clearErrors, setValue, formState } = useForm<Campos>({
    defaultValues: { metodo: 'YAPE', numeroOperacion: '', monto: solicitud.monto, fechaOperacion: hoy },
  });

  const subir = useSubirComprobante(nombreCorto, {
    alTerminar: async () => {
      alAvisar(null);
      elegida.elegir(null);
      await alActualizar();
    },
    alFallar: async (falla) => {
      if (esFalloQueCambiaLaSolicitud(falla)) {
        alAvisar(mensajeDeFalloDeComprobante(falla, telefono));
        await alActualizar();
      }
    },
  });
  const pendiente = subir.isPending;
  // Lo que va dentro de un campo (400 por campo, monto distinto, número ya usado) o en el aviso de la página (la solicitud cambió) no se repite
  // abajo: aquí solo queda el error sin lugar propio.
  const falla: unknown = subir.error;
  const errorGeneral =
    subir.isError &&
    !esFalloQueCambiaLaSolicitud(falla) &&
    erroresPorCampo(falla).length === 0 &&
    totalDelMontoDistinto(falla) === null &&
    !esErrorDeApi(falla, 409, 'NUMERO_OPERACION_YA_USADO');

  const alEnviar = (campos: Campos) => {
    // Dos clics en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente) return;
    clearErrors();
    const archivo = elegida.foto?.archivo;
    setFaltaImagen(!archivo);
    const fecha = campos.fechaOperacion;
    const problemas: Partial<Record<(typeof CAMPOS)[number], string>> = {};
    if (fecha === '') problemas.fechaOperacion = 'Elige la fecha de la operación.';
    else if (fecha > hoy) problemas.fechaOperacion = 'La fecha de la operación no puede ser posterior a hoy.';
    else if (fecha < desde) {
      problemas.fechaOperacion = `La fecha de la operación no puede ser anterior al ${formatearFechaCalendario(desde)}, el día de tu solicitud.`;
    }
    const validado = datosComprobanteSchema.safeParse({
      claveIdempotencia: clave,
      metodo: campos.metodo,
      numeroOperacion: campos.numeroOperacion,
      monto: campos.monto.trim(),
      fechaOperacion: fecha,
    });
    if (!validado.success) {
      for (const problema of validado.error.issues) {
        const campo = CAMPOS.find((nombre) => nombre === problema.path[0]);
        if (campo && !problemas[campo]) problemas[campo] = problema.message;
      }
    }
    for (const campo of CAMPOS) {
      const mensaje = problemas[campo];
      if (mensaje) setError(campo, { message: mensaje });
    }
    if (!archivo || !validado.success || Object.keys(problemas).length > 0) return;
    enCurso.current = true;
    subir.mutate(
      { token, datos: validado.data, archivo },
      {
        onError: (error) => {
          // El monto que se ve pasa a ser el total: el próximo envío lleva lo que la persona acaba de leer.
          const total = totalDelMontoDistinto(error);
          if (total) {
            setValue('monto', total);
            setError('monto', { message: mensajeDeFalloDeComprobante(error, telefono) });
          }
          for (const { campo, mensaje } of erroresPorCampo(error)) {
            const propio = CAMPOS.find((nombre) => nombre === campo);
            if (propio) setError(propio, { message: mensaje });
          }
          if (esErrorDeApi(error, 409, 'NUMERO_OPERACION_YA_USADO')) {
            setError('numeroOperacion', { message: mensajeDeFalloDeComprobante(error, telefono) });
          }
        },
        onSettled: () => {
          enCurso.current = false;
        },
      },
    );
  };

  return (
    <section
      aria-label="Pagar con Yape o transferencia"
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Pagar con Yape o transferencia</h2>
        <p className="mt-1 text-sm text-slate-700">
          Paga {formatearSoles(solicitud.monto)} a la academia con los datos de abajo y sube aquí la imagen del
          comprobante. La academia lo revisa y confirma tu inscripción.
        </p>
      </div>
      <DatosDePagoDeLaAcademia datos={datosDePago} telefono={telefono} />
      <form onSubmit={(evento) => void handleSubmit(alEnviar)(evento)} noValidate className="space-y-4">
        <fieldset disabled={pendiente} className="min-w-0 space-y-4">
          <legend className="sr-only">Datos del comprobante</legend>
          <CampoSelect
            etiqueta="Método de pago"
            error={formState.errors.metodo?.message}
            {...register('metodo', { onChange: () => clearErrors('metodo') })}
          >
            {METODOS.map((metodo) => (
              <option key={metodo.valor} value={metodo.valor}>
                {metodo.etiqueta}
              </option>
            ))}
          </CampoSelect>
          <CampoTexto
            etiqueta="Número de operación"
            autoComplete="off"
            autoCapitalize="characters"
            ayuda="Lo ves en el comprobante de tu Yape o de tu transferencia."
            error={formState.errors.numeroOperacion?.message}
            {...register('numeroOperacion', { onChange: () => clearErrors('numeroOperacion') })}
          />
          <CampoTexto
            etiqueta="Monto pagado (S/)"
            inputMode="decimal"
            autoComplete="off"
            ayuda={`Debe ser igual al total a pagar: ${formatearSoles(solicitud.monto)}.`}
            error={formState.errors.monto?.message}
            {...register('monto', { onChange: () => clearErrors('monto') })}
          />
          <CampoTexto
            etiqueta="Fecha de la operación"
            type="date"
            min={desde}
            max={hoy}
            error={formState.errors.fechaOperacion?.message}
            {...register('fechaOperacion', { onChange: () => clearErrors('fechaOperacion') })}
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
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDeFalloDeComprobante(falla, telefono)}</Alerta> : null}
        <button type="submit" disabled={pendiente} className={`${ESTILO_BOTON.primario} w-full sm:w-auto`}>
          {pendiente ? 'Enviando…' : errorGeneral ? 'Reintentar el envío' : 'Enviar comprobante'}
        </button>
      </form>
    </section>
  );
}
