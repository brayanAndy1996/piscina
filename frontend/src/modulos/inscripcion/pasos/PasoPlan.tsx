import {
  type ClasePublica,
  NIVELES,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  type RespuestaFormularioInscripcion,
} from '@aquagestion/contratos';
import { useWatch } from 'react-hook-form';
import { frasePorTelefono } from '../../../componentes/Telefono';
import { CampoSelect } from '../../../componentes/ui';
import { formatearSoles } from '../../../lib/dinero';
import { alternarClase, clasesParaPlan, planesParaNivel } from '../campos';
import { type FormularioInscripcion, mensajeDeError } from './comun';

interface Propiedades {
  form: FormularioInscripcion;
  oferta: RespuestaFormularioInscripcion;
  /** Clases que se llenaron mientras la persona elegía: se marcan como llenas y ya no se pueden elegir (HU-02). */
  llenas: readonly ClasePublica[];
}

function textoDeCupos(cupos: number): string {
  return cupos === 1 ? '1 cupo' : `${cupos} cupos`;
}

/**
 * Paso 4: nivel, plan y clases (HU-02, RN-08, D-15). Solo se ofrecen los planes que aplican al nivel y las clases del nivel con cupo, en
 * los días y franjas del plan, una por día y tantas como las veces por semana del plan, cada una con sus cupos restantes.
 */
export function PasoPlan({ form, oferta, llenas }: Propiedades) {
  const { register, setValue, clearErrors, formState, control } = form;
  const nivel = useWatch({ control, name: 'alumno.nivel' });
  const planId = useWatch({ control, name: 'inscripcion.planId' });
  const elegidas = useWatch({ control, name: 'inscripcion.claseIds' });

  const planes = planesParaNivel(oferta.planes, nivel);
  const plan = planes.find((candidato) => candidato.id === planId);
  const disponibles = plan ? clasesParaPlan(oferta.clases, plan, nivel) : [];
  const idsDisponibles = new Set(disponibles.map((clase) => clase.id));
  const sinCupo = plan ? clasesParaPlan(llenas, plan, nivel).filter((clase) => !idsDisponibles.has(clase.id)) : [];
  const filas = [...disponibles, ...sinCupo].sort(
    (a, b) => a.diaSemana - b.diaSemana || (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0),
  );
  const dias = [...new Set(filas.map((clase) => clase.diaSemana))];
  const llenasIds = new Set(sinCupo.map((clase) => clase.id));
  const errorNivel = mensajeDeError(formState.errors, 'alumno.nivel');
  const errorPlan = mensajeDeError(formState.errors, 'inscripcion.planId');
  const errorClases = mensajeDeError(formState.errors, 'inscripcion.claseIds');

  const alElegir = (clase: ClasePublica) => {
    if (!plan) return;
    setValue('inscripcion.claseIds', alternarClase(elegidas, clase, filas, plan.vecesPorSemana), { shouldDirty: true });
    clearErrors('inscripcion.claseIds');
  };

  return (
    <div className="space-y-5">
      <CampoSelect
        etiqueta="Nivel"
        error={errorNivel}
        {...register('alumno.nivel', {
          onChange: () => {
            clearErrors(['alumno.nivel', 'inscripcion.planId', 'inscripcion.claseIds']);
            setValue('inscripcion.planId', '');
            setValue('inscripcion.claseIds', []);
          },
        })}
      >
        <option value="">Elige tu nivel</option>
        {NIVELES.map((valor) => (
          <option key={valor} value={valor}>
            {NOMBRE_NIVEL[valor]}
          </option>
        ))}
      </CampoSelect>

      {nivel !== '' ? (
        <fieldset className="min-w-0" aria-describedby={errorPlan ? 'error-plan' : undefined}>
          <legend className="text-sm font-medium text-slate-800">Plan</legend>
          {planes.length === 0 ? (
            <p className="mt-1 text-sm text-slate-700">
              Por ahora no hay planes para este nivel.{frasePorTelefono(oferta.academia.telefono)}
            </p>
          ) : (
            <div className="mt-1 space-y-2">
              {planes.map((candidato) => (
                <label
                  key={candidato.id}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-white p-3 text-base text-slate-900 ring-1 ring-slate-300 has-[:checked]:ring-2 has-[:checked]:ring-sky-700"
                >
                  <input
                    type="radio"
                    value={candidato.id}
                    className="mt-1 size-5 shrink-0 accent-sky-700"
                    {...register('inscripcion.planId', {
                      onChange: () => {
                        clearErrors(['inscripcion.planId', 'inscripcion.claseIds']);
                        setValue('inscripcion.claseIds', []);
                      },
                    })}
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
          {errorPlan ? (
            <p id="error-plan" role="alert" className="mt-1 text-sm text-red-700">
              {errorPlan}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {plan ? (
        <fieldset className="min-w-0 space-y-3" aria-describedby={errorClases ? 'error-clases' : undefined}>
          <legend className="text-sm font-medium text-slate-800">
            Días y horario (
            {plan.vecesPorSemana === 1 ? 'elige 1 clase' : `elige ${plan.vecesPorSemana} clases, una por día`})
          </legend>
          <p className="text-sm text-slate-700" aria-live="polite">
            Elegiste {elegidas.length} de {plan.vecesPorSemana}.
          </p>
          {filas.length === 0 ? (
            <p className="text-sm text-slate-700">
              No hay clases con cupo para este plan y nivel.{frasePorTelefono(oferta.academia.telefono)}
            </p>
          ) : null}
          {dias.map((dia) => {
            const delDia = filas.filter((clase) => clase.diaSemana === dia);
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
                    const llena = llenasIds.has(clase.id);
                    const marcada = elegidas.includes(clase.id);
                    // Con todas las clases del plan ya elegidas, un día nuevo se bloquea hasta quitar alguna.
                    const diaConElegida = delDia.some((otra) => elegidas.includes(otra.id));
                    const completo = elegidas.length >= plan.vecesPorSemana && !diaConElegida;
                    return (
                      <label
                        key={clase.id}
                        className={`flex min-h-11 items-center gap-3 text-base ${llena || (completo && !marcada) ? 'cursor-not-allowed text-slate-500' : 'cursor-pointer text-slate-900'}`}
                      >
                        <input
                          type="checkbox"
                          checked={marcada}
                          disabled={llena || (completo && !marcada)}
                          onChange={() => alElegir(clase)}
                          className="size-5 shrink-0 accent-sky-700"
                        />
                        <span>
                          {clase.horaInicio} a {clase.horaFin}
                          <span className="block text-sm text-slate-600">
                            {llena ? 'Llena' : textoDeCupos(clase.cuposRestantes)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {errorClases ? (
            <p id="error-clases" role="alert" className="text-sm text-red-700">
              {errorClases}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
