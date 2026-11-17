import {
  AFORO_MAXIMO,
  AFORO_MINIMO,
  BLOQUES,
  type Clase,
  DIAS_SEMANA,
  horaFinDe,
  NIVELES,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
} from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoCasilla, CampoSelect, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { campoRaiz, useBaseDeLlenado } from '../../lib/base-de-llenado';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import type { EntrenadorElegible } from './api';
import {
  aCamposClase,
  cambiosDeClase,
  type CampoClase,
  type CamposClase,
  camposEditadosDeClase,
  type ErroresClase,
  esCampoClase,
  sonIgualesClases,
  validarCambiosDeClase,
  validarClaseNueva,
} from './campos';
import { useActualizarClase, useCrearClase, useEntrenadores } from './hooks';

export const MENSAJE_ENTRENADOR_NO_VALIDO = 'Elige un entrenador activo de tu academia.';
export const MENSAJE_ENTRENADOR_OCUPADO = 'Ese entrenador ya tiene otra clase activa a esa hora.';
export const MENSAJE_CLASE_DUPLICADA = 'Ya hay una clase activa de ese nivel el mismo día y a la misma hora.';

const AVISO_BASE_NUEVA =
  'Otro administrador cambió esta clase mientras editabas. Actualizamos los campos que no tocaste; revisa los tuyos antes de guardar.';

export function nombreDeEntrenador(entrenador: { nombres: string; apellidos: string }): string {
  return `${entrenador.apellidos}, ${entrenador.nombres}`;
}

interface Propiedades {
  /** La clase que se edita (lo último que llegó del servidor), o `null` para crear una nueva. */
  clase: Clase | null;
  alCerrar: () => void;
  alCrear?: (clase: Clase) => void;
}

/**
 * "Nueva clase" y "Editar clase" (HU-17). Una clase creada solo cambia de entrenador, de aforo y de estado: para moverla se desactiva y
 * se crea otra (DR-4 de 004). Valida con los esquemas compartidos y muestra junto a cada campo los errores 400 y 409
 * (`ENTRENADOR_NO_VALIDO`, `ENTRENADOR_OCUPADO` y `CLASE_DUPLICADA`).
 */
export function FormularioClase({ clase, alCerrar, alCrear }: Propiedades) {
  const form = useForm<CamposClase>({ defaultValues: aCamposClase(clase) });
  const { register, handleSubmit, setError, clearErrors, reset, control, formState } = form;
  const valores = useWatch({ control });
  const [guardado, setGuardado] = useState(false);
  const entrenadores = useEntrenadores();

  const { baseDeLlenado, fijarBase, avisoBaseNueva } = useBaseDeLlenado<CamposClase, Clase | null>({
    base: clase,
    form,
    aCampos: aCamposClase,
    camposEditados: camposEditadosDeClase,
    sonIguales: sonIgualesClases,
  });
  const editando = baseDeLlenado !== null;

  const crear = useCrearClase((nueva) => alCrear?.(nueva));
  const actualizar = useActualizarClase((guardadaAhora) => {
    fijarBase(guardadaAhora);
    reset(aCamposClase(guardadaAhora));
    setGuardado(true);
  });
  const escritura = editando ? actualizar : crear;
  const pendiente = crear.isPending || actualizar.isPending;
  useAlPerderSesion(crear.error, actualizar.error, entrenadores.error);

  const actuales: CamposClase = { ...aCamposClase(baseDeLlenado), ...valores };
  const hayCambios = baseDeLlenado ? Object.keys(cambiosDeClase(actuales, baseDeLlenado)).length > 0 : true;

  // Los choques del bloque dependen del nivel, el día, la hora, el entrenador y el estado: al cambiar uno, el aviso de choque ya no vale.
  const alEditar = (campo: CampoClase) => {
    clearErrors(campo === 'aforo' ? campo : ['nivel', 'entrenadorId', 'activo', campo]);
    setGuardado(false);
  };

  const ponerErrores = (errores: ErroresClase) => {
    for (const [campo, mensaje] of Object.entries(errores)) {
      if (esCampoClase(campo)) setError(campo, { message: mensaje });
    }
  };

  const alFallar = (error: unknown) => {
    if (esErrorDeApi(error, 409, 'ENTRENADOR_NO_VALIDO')) {
      setError('entrenadorId', { message: MENSAJE_ENTRENADOR_NO_VALIDO });
      return;
    }
    if (esErrorDeApi(error, 409, 'ENTRENADOR_OCUPADO')) {
      setError('entrenadorId', { message: MENSAJE_ENTRENADOR_OCUPADO });
      return;
    }
    if (esErrorDeApi(error, 409, 'CLASE_DUPLICADA')) {
      // Al crear, choca el nivel; al reactivar una clase, el estado.
      setError(editando ? 'activo' : 'nivel', { message: MENSAJE_CLASE_DUPLICADA });
      return;
    }
    for (const { campo, mensaje } of erroresPorCampo(error)) {
      const raiz = campoRaiz(campo);
      if (esCampoClase(raiz)) setError(raiz, { message: mensaje });
    }
  };

  const enviar = handleSubmit((enviados) => {
    setGuardado(false);
    const campos: CamposClase = { ...aCamposClase(baseDeLlenado), ...enviados };
    if (baseDeLlenado === null) {
      const validado = validarClaseNueva(campos);
      if (!validado.correcto) return ponerErrores(validado.errores);
      crear.mutate(validado.datos, { onError: alFallar });
      return;
    }
    const validado = validarCambiosDeClase(campos, baseDeLlenado);
    if (!validado.correcto) return ponerErrores(validado.errores);
    actualizar.mutate({ id: baseDeLlenado.id, cambios: validado.datos }, { onError: alFallar });
  });

  const errorGeneral =
    escritura.isError &&
    !esErrorDeApi(escritura.error, 401) &&
    !esErrorDeCambioDeSesion(escritura.error) &&
    !esErrorDeApi(escritura.error, 409) &&
    erroresPorCampo(escritura.error).length === 0;

  const error = (campo: CampoClase) => formState.errors[campo]?.message;
  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  // Los entrenadores activos y, al editar, también el actual aunque esté inactivo (se muestra marcado).
  const elegibles: EntrenadorElegible[] = [...(entrenadores.data ?? [])].filter(
    (entrenador) => entrenador.activo || entrenador.id === baseDeLlenado?.entrenador.id,
  );
  if (baseDeLlenado && !elegibles.some((entrenador) => entrenador.id === baseDeLlenado.entrenador.id)) {
    elegibles.push(baseDeLlenado.entrenador);
  }
  elegibles.sort((a, b) => nombreDeEntrenador(a).localeCompare(nombreDeEntrenador(b), 'es'));

  return (
    <Modal titulo={editando ? 'Editar clase' : 'Nueva clase'} alCerrar={cerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-4">
        <fieldset disabled={pendiente} className="min-w-0 space-y-4">
          <legend className="sr-only">Datos de la clase</legend>
          {baseDeLlenado ? (
            <div className="rounded-lg bg-sky-50 p-3 text-slate-800">
              <p className="font-medium">
                {NOMBRE_NIVEL[baseDeLlenado.nivel]} · {NOMBRE_DIA[baseDeLlenado.diaSemana as keyof typeof NOMBRE_DIA]}{' '}
                de {baseDeLlenado.horaInicio} a {baseDeLlenado.horaFin}
              </p>
              <p className="text-sm text-slate-700">
                El nivel, el día y la hora no se cambian. Para mover la clase, desactívala y crea otra.
              </p>
            </div>
          ) : (
            <>
              <CampoSelect
                etiqueta="Nivel"
                error={error('nivel')}
                {...register('nivel', { onChange: () => alEditar('nivel') })}
              >
                <option value="">Elige un nivel</option>
                {NIVELES.map((nivel) => (
                  <option key={nivel} value={nivel}>
                    {NOMBRE_NIVEL[nivel]}
                  </option>
                ))}
              </CampoSelect>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoSelect
                  etiqueta="Día"
                  error={error('diaSemana')}
                  {...register('diaSemana', { onChange: () => alEditar('diaSemana') })}
                >
                  <option value="">Elige un día</option>
                  {DIAS_SEMANA.map((dia) => (
                    <option key={dia} value={String(dia)}>
                      {NOMBRE_DIA[dia]}
                    </option>
                  ))}
                </CampoSelect>
                <CampoSelect
                  etiqueta="Bloque"
                  error={error('horaInicio')}
                  {...register('horaInicio', { onChange: () => alEditar('horaInicio') })}
                >
                  <option value="">Elige un bloque</option>
                  {BLOQUES.map((bloque) => (
                    <option key={bloque} value={bloque}>
                      {bloque} a {horaFinDe(bloque)}
                    </option>
                  ))}
                </CampoSelect>
              </div>
            </>
          )}

          {entrenadores.isError && !esErrorDeApi(entrenadores.error, 401) ? (
            <div className="space-y-2">
              <Alerta>No se pudo cargar la lista de entrenadores. {mensajeGeneral(entrenadores.error)}</Alerta>
              <button type="button" onClick={() => void entrenadores.refetch()} className={ESTILO_BOTON.secundario}>
                Reintentar
              </button>
            </div>
          ) : null}
          <CampoSelect
            etiqueta="Entrenador"
            error={error('entrenadorId')}
            {...register('entrenadorId', { onChange: () => alEditar('entrenadorId') })}
          >
            <option value="">{entrenadores.isPending ? 'Cargando entrenadores…' : 'Elige un entrenador'}</option>
            {elegibles.map((entrenador) => (
              <option key={entrenador.id} value={entrenador.id}>
                {nombreDeEntrenador(entrenador)}
                {entrenador.activo ? '' : ' (inactivo)'}
              </option>
            ))}
          </CampoSelect>
          {entrenadores.isSuccess && !elegibles.some((entrenador) => entrenador.activo) ? (
            <p className="text-sm text-slate-700">
              No hay entrenadores activos. Crea uno en «Usuarios» para poder armar clases.
            </p>
          ) : null}

          <CampoTexto
            etiqueta="Aforo (alumnos)"
            inputMode="numeric"
            autoComplete="off"
            ayuda={`De ${AFORO_MINIMO} a ${AFORO_MAXIMO} alumnos.`}
            error={error('aforo')}
            {...register('aforo', { onChange: () => alEditar('aforo') })}
          />
          {editando ? (
            <CampoCasilla
              etiqueta="Clase activa"
              ayuda="Una clase inactiva se conserva en la grilla, pero ya no cuenta para los choques de horario."
              error={error('activo')}
              {...register('activo', { onChange: () => alEditar('activo') })}
            />
          ) : null}
        </fieldset>

        {avisoBaseNueva && hayCambios ? (
          <p role="status" className="rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200">
            {AVISO_BASE_NUEVA}
          </p>
        ) : null}
        {guardado ? (
          <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
            Clase guardada.
          </p>
        ) : null}
        {errorGeneral ? <Alerta>{mensajeGeneral(escritura.error)}</Alerta> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {editando ? 'Cerrar' : 'Cancelar'}
          </button>
          <button type="submit" disabled={!hayCambios || pendiente} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear clase'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
