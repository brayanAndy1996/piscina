import {
  BLOQUES,
  DIAS_SEMANA,
  horaFinDe,
  NIVELES,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  LIMITES_PLAN,
  type Plan,
} from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoCasilla, CampoTexto, ESTILO_BOTON, GrupoCasillas, Modal } from '../../componentes/ui';
import { useBaseDeLlenado, campoRaiz } from '../../lib/base-de-llenado';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import {
  aCamposPlan,
  cambiosDePlan,
  type CampoPlan,
  camposEditadosDePlan,
  type CamposPlan,
  esCampoPlan,
  type ErroresPlan,
  sonIgualesPlanes,
  validarCambiosDePlan,
  validarPlanNuevo,
} from './campos';
import { useActualizarPlan, useCrearPlan } from './hooks';

export const MENSAJE_NOMBRE_EN_USO =
  'Ya hay un plan con ese nombre en tu academia (se comparan sin distinguir mayúsculas).';

const AVISO_BASE_NUEVA =
  'Otro administrador cambió este plan mientras editabas. Actualizamos los campos que no tocaste; revisa los tuyos antes de guardar.';

const OPCIONES_DIAS = DIAS_SEMANA.map((dia) => ({ valor: dia, etiqueta: NOMBRE_DIA[dia] }));
const OPCIONES_FRANJAS = BLOQUES.map((bloque) => ({ valor: bloque, etiqueta: `${bloque} a ${horaFinDe(bloque)}` }));
const OPCIONES_NIVELES = NIVELES.map((nivel) => ({ valor: nivel, etiqueta: NOMBRE_NIVEL[nivel] }));

interface Propiedades {
  /** El plan que se edita (lo último que llegó del servidor), o `null` para crear uno nuevo. */
  plan: Plan | null;
  alCerrar: () => void;
  /** Se llama con el plan nuevo apenas responde la creación. */
  alCrear?: (plan: Plan) => void;
}

/**
 * "Nuevo plan" y "Editar plan" (HU-19, RN-07). El precio es un texto con hasta dos decimales y nunca un número (criterio 10). Valida con
 * los esquemas compartidos antes de enviar y muestra junto a cada campo los errores 400 y 409 de la API.
 *
 * Al editar, el formulario compara siempre contra su base de llenado y el `PATCH` lleva solo lo editado (criterio 27 de 003); mientras
 * se guarda, los campos quedan desactivados y se desbloquean apenas responde la escritura (criterios 29 de 004 y 31 de 003).
 */
export function FormularioPlan({ plan, alCerrar, alCrear }: Propiedades) {
  const form = useForm<CamposPlan>({ defaultValues: aCamposPlan(plan) });
  const { register, handleSubmit, setValue, setError, clearErrors, reset, control, formState } = form;
  const valores = useWatch({ control });
  const [guardado, setGuardado] = useState(false);

  const { baseDeLlenado, fijarBase, avisoBaseNueva } = useBaseDeLlenado<CamposPlan, Plan | null>({
    base: plan,
    form,
    aCampos: aCamposPlan,
    camposEditados: camposEditadosDePlan,
    sonIguales: sonIgualesPlanes,
  });
  const editando = baseDeLlenado !== null;

  const crear = useCrearPlan((nuevo) => alCrear?.(nuevo));
  const actualizar = useActualizarPlan((guardadoAhora) => {
    // La respuesta de la API es la nueva base (criterio 27 e de 003).
    fijarBase(guardadoAhora);
    reset(aCamposPlan(guardadoAhora));
    setGuardado(true);
  });
  const escritura = editando ? actualizar : crear;
  const pendiente = crear.isPending || actualizar.isPending;
  useAlPerderSesion(crear.error, actualizar.error);

  const actuales: CamposPlan = { ...aCamposPlan(baseDeLlenado), ...valores };
  const hayCambios = baseDeLlenado ? Object.keys(cambiosDePlan(actuales, baseDeLlenado)).length > 0 : true;

  const alEditar = (campo: CampoPlan) => {
    clearErrors(campo);
    setGuardado(false);
  };

  const ponerErrores = (errores: ErroresPlan) => {
    for (const [campo, mensaje] of Object.entries(errores)) {
      if (esCampoPlan(campo)) setError(campo, { message: mensaje });
    }
  };

  const alFallar = (error: unknown) => {
    if (esErrorDeApi(error, 409, 'NOMBRE_PLAN_EN_USO')) {
      setError('nombre', { message: MENSAJE_NOMBRE_EN_USO });
      return;
    }
    for (const { campo, mensaje } of erroresPorCampo(error)) {
      const raiz = campoRaiz(campo);
      if (esCampoPlan(raiz)) setError(raiz, { message: mensaje });
    }
  };

  const enviar = handleSubmit((enviados) => {
    setGuardado(false);
    const campos: CamposPlan = { ...aCamposPlan(baseDeLlenado), ...enviados };
    if (baseDeLlenado === null) {
      const validado = validarPlanNuevo(campos);
      if (!validado.correcto) return ponerErrores(validado.errores);
      crear.mutate(validado.datos, { onError: alFallar });
      return;
    }
    const validado = validarCambiosDePlan(campos, baseDeLlenado);
    if (!validado.correcto) return ponerErrores(validado.errores);
    actualizar.mutate({ id: baseDeLlenado.id, cambios: validado.datos }, { onError: alFallar });
  });

  const errorGeneral =
    escritura.isError &&
    !esErrorDeApi(escritura.error, 401) &&
    !esErrorDeCambioDeSesion(escritura.error) &&
    !esErrorDeApi(escritura.error, 409, 'NOMBRE_PLAN_EN_USO') &&
    erroresPorCampo(escritura.error).length === 0;

  const error = (campo: CampoPlan) => formState.errors[campo]?.message;
  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  return (
    <Modal titulo={editando ? 'Editar plan' : 'Nuevo plan'} alCerrar={cerrar} ancho="amplio">
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-5">
        <fieldset disabled={pendiente} className="min-w-0 space-y-5">
          <legend className="sr-only">Datos del plan</legend>
          <CampoTexto
            etiqueta="Nombre del plan"
            autoComplete="off"
            ayuda={`De ${LIMITES_PLAN.nombre.minimo} a ${LIMITES_PLAN.nombre.maximo} caracteres. No puede repetirse en tu academia.`}
            error={error('nombre')}
            {...register('nombre', { onChange: () => alEditar('nombre') })}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <CampoTexto
              etiqueta="Veces por semana"
              inputMode="numeric"
              autoComplete="off"
              ayuda={`De ${LIMITES_PLAN.vecesPorSemana.minimo} a ${LIMITES_PLAN.vecesPorSemana.maximo}.`}
              error={error('vecesPorSemana')}
              {...register('vecesPorSemana', { onChange: () => alEditar('vecesPorSemana') })}
            />
            <CampoTexto
              etiqueta="Clases por mes"
              inputMode="numeric"
              autoComplete="off"
              ayuda={`De ${LIMITES_PLAN.clasesPorMes.minimo} a ${LIMITES_PLAN.clasesPorMes.maximo}.`}
              error={error('clasesPorMes')}
              {...register('clasesPorMes', { onChange: () => alEditar('clasesPorMes') })}
            />
            <CampoTexto
              etiqueta="Duración (minutos)"
              inputMode="numeric"
              autoComplete="off"
              ayuda={`De ${LIMITES_PLAN.duracionMinutos.minimo} a ${LIMITES_PLAN.duracionMinutos.maximo}. Es informativa.`}
              error={error('duracionMinutos')}
              {...register('duracionMinutos', { onChange: () => alEditar('duracionMinutos') })}
            />
          </div>
          <CampoTexto
            etiqueta="Precio (S/)"
            inputMode="decimal"
            autoComplete="off"
            ayuda="Monto final en soles, con IGV incluido y hasta dos decimales. Por ejemplo: 120.00. Un cambio de precio vale solo para inscripciones y renovaciones nuevas."
            error={error('precio')}
            {...register('precio', { onChange: () => alEditar('precio') })}
          />
          <GrupoCasillas
            leyenda="Días permitidos"
            ayuda="El alumno elegirá tantos días como veces por semana tenga el plan."
            error={error('diasPermitidos')}
            opciones={OPCIONES_DIAS}
            seleccionados={actuales.diasPermitidos}
            alCambiar={(nuevos) => {
              setValue('diasPermitidos', nuevos, { shouldDirty: true });
              alEditar('diasPermitidos');
            }}
          />
          <GrupoCasillas
            leyenda="Franjas permitidas"
            error={error('franjasPermitidas')}
            opciones={OPCIONES_FRANJAS}
            seleccionados={actuales.franjasPermitidas}
            alCambiar={(nuevos) => {
              setValue('franjasPermitidas', nuevos, { shouldDirty: true });
              alEditar('franjasPermitidas');
            }}
          />
          <GrupoCasillas
            leyenda="Niveles"
            error={error('nivelesAplicables')}
            opciones={OPCIONES_NIVELES}
            seleccionados={actuales.nivelesAplicables}
            alCambiar={(nuevos) => {
              setValue('nivelesAplicables', nuevos, { shouldDirty: true });
              alEditar('nivelesAplicables');
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="Vigente desde (opcional)"
              type="date"
              ayuda="Sin fecha, desde ya."
              error={error('vigenciaInicio')}
              {...register('vigenciaInicio', { onChange: () => alEditar('vigenciaInicio') })}
            />
            <CampoTexto
              etiqueta="Vigente hasta (opcional)"
              type="date"
              ayuda="Sin fecha, sin límite."
              error={error('vigenciaFin')}
              {...register('vigenciaFin', { onChange: () => alEditar('vigenciaFin') })}
            />
          </div>
          {editando ? (
            <CampoCasilla
              etiqueta="Plan activo"
              ayuda="Un plan inactivo se conserva, pero no se ofrece en inscripciones nuevas."
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
            Plan guardado.
          </p>
        ) : null}
        {errorGeneral ? <Alerta>{mensajeGeneral(escritura.error)}</Alerta> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {editando ? 'Cerrar' : 'Cancelar'}
          </button>
          <button type="submit" disabled={!hayCambios || pendiente} className={ESTILO_BOTON.primario}>
            {pendiente ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear plan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
