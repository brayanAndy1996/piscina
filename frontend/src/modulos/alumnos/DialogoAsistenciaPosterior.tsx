import {
  type RegistrarAsistenciaPosterior,
  type ResultadoAsistencia,
  type RegistroDeFalta,
  NOMBRE_DIA,
  registrarAsistenciaPosteriorSchema,
} from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoAreaTexto, CampoSelect, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { diaDeLaSemanaDeFecha, hoyEnLima } from '../../lib/fechas';
import { nuevaClaveUuid } from '../../lib/uuid';
import { useRegistrarAsistenciaPosterior } from '../asistencia/hooks';
import { campoDeRechazoPosterior, codigoDeRechazoPosterior, mensajeDeRegistroPosterior } from '../asistencia/mensajes';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';

interface Propiedades {
  alumnoId: string;
  nombre: string;
  /** El mes en curso `AAAA-MM`: el registro posterior solo vale para días de ese mes (criterio 28). */
  mes: string;
  /** Las faltas sin cubrir del mes: los días de clase ya terminados sin asistencia que el sistema conoce. */
  faltas: readonly RegistroDeFalta[];
  alCerrar: () => void;
  /** Se llama con el resultado cuando la API responde 201 (o 200 si es un reintento con la misma clave). */
  alRegistrar: (resultado: ResultadoAsistencia) => void;
}

interface Campos {
  dia: string;
  fecha: string;
  horaLlegada: string;
  motivo: string;
}

const OTRO_DIA = 'OTRO';

/** «Vie 13/11 · 18:00 a 19:00 (falta)»: corto para que entre en la lista desplegable de un celular. */
function etiquetaDeFalta(falta: RegistroDeFalta): string {
  const dia = NOMBRE_DIA[diaDeLaSemanaDeFecha(falta.fecha)].slice(0, 3);
  const [, mes = '', diaDelMes = ''] = falta.fecha.split('-');
  return `${dia} ${diaDelMes}/${mes} · ${falta.clase.horaInicio} a ${falta.clase.horaFin} (falta)`;
}

/**
 * Registrar una asistencia posterior (D-16, criterio 32 de 009): el día de una clase que ya terminó, la hora a la que llegó el alumno y el motivo,
 * que queda en la auditoría. Los días de clase sin asistencia que el sistema conoce son las faltas del mes; para otro día se escribe la fecha. La
 * `claveIdempotencia` se genera al abrir el diálogo y se conserva en los reintentos: un doble clic o un reintento tras un corte no descuenta dos
 * clases. Las reglas (mes en curso, clase terminada, hora dentro de la clase) las decide la API: aquí solo se muestran sus rechazos.
 */
export function DialogoAsistenciaPosterior({ alumnoId, nombre, mes, faltas, alCerrar, alRegistrar }: Propiedades) {
  const [clave] = useState(nuevaClaveUuid);
  const { register, handleSubmit, setError, clearErrors, control, formState } = useForm<Campos>({
    defaultValues: { dia: faltas[0]?.fecha ?? OTRO_DIA, fecha: '', horaLlegada: '', motivo: '' },
  });
  const enCurso = useRef(false);
  const registrar = useRegistrarAsistenciaPosterior();
  useAlPerderSesion(registrar.error);
  const pendiente = registrar.isPending;
  const sinSalida = registrar.isError && (esErrorDeApi(registrar.error, 404) || esErrorDeApi(registrar.error, 403));

  const dia = useWatch({ control, name: 'dia' });
  const faltaElegida = dia === OTRO_DIA ? undefined : faltas.find((falta) => falta.fecha === dia);
  const escribeLaFecha = dia === OTRO_DIA || faltas.length === 0;
  const campoDeFecha = escribeLaFecha ? 'fecha' : 'dia';

  const alCambiar = (campo: keyof Campos) => () => {
    clearErrors(campo);
    if (registrar.isError) registrar.reset();
  };

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const alEnviar = (campos: Campos) => {
    // Dos envíos en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente) return;
    const validado = registrarAsistenciaPosteriorSchema.safeParse({
      alumnoId,
      fecha: escribeLaFecha ? campos.fecha : campos.dia,
      horaLlegada: campos.horaLlegada,
      motivo: campos.motivo,
      claveIdempotencia: clave,
    });
    if (!validado.success) {
      for (const problema of validado.error.issues) {
        const campo = problema.path[0];
        if (campo === 'fecha') setError(campoDeFecha, { message: problema.message });
        else if (campo === 'horaLlegada' || campo === 'motivo') setError(campo, { message: problema.message });
      }
      return;
    }
    const datos: RegistrarAsistenciaPosterior = validado.data;
    enCurso.current = true;
    registrar.mutate(datos, {
      onSuccess: alRegistrar,
      onSettled: () => {
        enCurso.current = false;
      },
    });
  };

  const rechazo = registrar.isError ? codigoDeRechazoPosterior(registrar.error) : null;
  const campoDelRechazo = rechazo ? campoDeRechazoPosterior(rechazo) : null;
  const mensajeDelRechazo = registrar.isError ? mensajeDeRegistroPosterior(registrar.error) : undefined;
  const errorGeneral =
    registrar.isError &&
    !esErrorDeApi(registrar.error, 401) &&
    !esErrorDeCambioDeSesion(registrar.error) &&
    campoDelRechazo === null;
  const errorDe = (campo: 'fecha' | 'horaLlegada' | 'motivo', campoVisible: string = campo) =>
    formState.errors[campoVisible as keyof Campos]?.message ??
    (campoDelRechazo === campo ? mensajeDelRechazo : undefined);

  return (
    <Modal titulo="Registrar asistencia posterior" alCerrar={cerrar}>
      <form onSubmit={(evento) => void handleSubmit(alEnviar)(evento)} noValidate className="mt-2 space-y-4">
        <p className="text-slate-700">
          Alumno: <strong className="break-words text-slate-900">{nombre}</strong>
        </p>
        <p role="note" className="text-sm text-slate-600">
          Para una clase de este mes que ya terminó. Descuenta una clase de su mensualidad y, si tenía falta ese día, la
          cubre.
        </p>
        <fieldset disabled={pendiente || sinSalida} className="min-w-0 space-y-4">
          <legend className="sr-only">Datos de la asistencia posterior</legend>
          {faltas.length > 0 ? (
            <CampoSelect
              etiqueta="Día de la clase"
              error={escribeLaFecha ? undefined : errorDe('fecha', 'dia')}
              {...register('dia', { onChange: alCambiar('dia') })}
            >
              {faltas.map((falta) => (
                <option key={`${falta.fecha}-${falta.clase.horaInicio}`} value={falta.fecha}>
                  {etiquetaDeFalta(falta)}
                </option>
              ))}
              <option value={OTRO_DIA}>Otro día de este mes</option>
            </CampoSelect>
          ) : null}
          {escribeLaFecha ? (
            <CampoTexto
              etiqueta="Fecha de la clase"
              type="date"
              min={`${mes}-01`}
              max={hoyEnLima()}
              ayuda="Un día de este mes, hasta hoy."
              error={errorDe('fecha')}
              {...register('fecha', { onChange: alCambiar('fecha') })}
            />
          ) : null}
          <CampoTexto
            etiqueta="Hora de llegada"
            type="time"
            {...(faltaElegida ? { min: faltaElegida.clase.horaInicio } : {})}
            ayuda={
              faltaElegida
                ? `Entre las ${faltaElegida.clase.horaInicio} y las ${faltaElegida.clase.horaFin}, dentro de su clase.`
                : 'La hora de Lima a la que llegó, dentro de su clase.'
            }
            error={errorDe('horaLlegada')}
            {...register('horaLlegada', { onChange: alCambiar('horaLlegada') })}
          />
          <CampoAreaTexto
            etiqueta="Motivo"
            ayuda="De 3 a 200 caracteres. Por ejemplo: «No se leyó su QR en la puerta». Queda en la auditoría."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: alCambiar('motivo') })}
          />
        </fieldset>
        {errorGeneral ? <Alerta>{mensajeDelRechazo}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button type="submit" disabled={pendiente || sinSalida} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Registrando…' : 'Registrar asistencia'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
