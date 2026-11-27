import {
  cambiarHorarioSchema,
  type ClaseDeMensualidad,
  type MatriculaDelHorario,
  NOMBRE_DIA,
  type RespuestaCambioHorario,
} from '@aquagestion/contratos';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, Aviso, CampoAreaTexto, ESTILO_BOTON, Insignia, Modal } from '../../componentes/ui';
import { erroresPorCampo } from '../../lib/errores';
import { formatearMes } from '../../lib/fechas';
import { alternarClase } from '../inscripcion/campos';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { textoDeCupos } from './campos';
import { useCambiarHorario, useHorarioDelAlumno } from './hooks';
import { clasesSinCupo, esCambioDeHorarioSinSalida, mensajeDeCambioDeHorario } from './mensajes';

interface Propiedades {
  alumnoId: string;
  /** La matrícula tal como estaba al abrir; los cupos se leen de la lectura viva (`useHorarioDelAlumno`) si sigue en ella. */
  matricula: MatriculaDelHorario;
  alCerrar: () => void;
}

interface Campos {
  motivo: string;
}

function textoDeClase(clase: ClaseDeMensualidad): string {
  return `${NOMBRE_DIA[clase.diaSemana]} ${clase.horaInicio} a ${clase.horaFin}`;
}

/** Las ocurrencias que quedan son menos que las clases que le quedan por usar al alumno: el aviso del criterio 42. */
export function quedanMenosOcurrenciasQueClases(respuesta: RespuestaCambioHorario): boolean {
  const { matricula } = respuesta;
  return matricula.ocurrenciasRestantes < matricula.clasesTotales - matricula.clasesUsadas;
}

/**
 * «Cambiar horario» de una matrícula (HU-03, RN-08; criterios 35, 36 y 42 de 010): elige las clases entre las `clasesDelPlan` que da la API, con
 * sus cupos (la cantidad sale de `plan.vecesPorSemana`), y pide el motivo (de 3 a 200 caracteres, queda en la auditoría). Los cupos, los estados y
 * `ocurrenciasRestantes` los calcula la API: la web los muestra. No hay clave de idempotencia (DT-16): repetir el mismo cambio no escribe nada;
 * mientras el envío va en camino no se manda otro. No cambia el monto ni las clases del mes: el aviso del final lo dice.
 */
export function DialogoCambiarHorario({ alumnoId, matricula: inicial, alCerrar }: Propiedades) {
  const horario = useHorarioDelAlumno(alumnoId);
  const viva = horario.data?.matriculas.find((candidata) => candidata.id === inicial.id) ?? inicial;
  const { plan, clasesDelPlan } = viva;
  const actuales = new Set(inicial.clases.map((clase) => clase.id));
  const [claseIds, setClaseIds] = useState<string[]>(() => inicial.clases.map((clase) => clase.id));
  const [sinCupo, setSinCupo] = useState<string[]>([]);
  const [hecho, setHecho] = useState<RespuestaCambioHorario | null>(null);
  const enCurso = useRef(false);
  const cambiar = useCambiarHorario(alumnoId);
  useAlPerderSesion(cambiar.error, horario.error);
  const { register, handleSubmit, setError, clearErrors, formState } = useForm<Campos>({
    defaultValues: { motivo: '' },
  });
  const pendiente = cambiar.isPending;
  const sinSalida = cambiar.isError && esCambioDeHorarioSinSalida(cambiar.error);
  const dias = [...new Set(clasesDelPlan.map((clase) => clase.diaSemana))];
  const completa = claseIds.length === plan.vecesPorSemana;
  const igualAlActual = completa && claseIds.length === actuales.size && claseIds.every((id) => actuales.has(id));

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const elegirClase = (id: string) => {
    const clase = clasesDelPlan.find((candidata) => candidata.id === id);
    if (!clase) return;
    setClaseIds((anteriores) => alternarClase(anteriores, clase, clasesDelPlan, plan.vecesPorSemana));
    setSinCupo((anteriores) => anteriores.filter((otra) => otra !== id));
    cambiar.reset();
  };

  const alEnviar = (campos: Campos) => {
    // Dos envíos en el mismo paso, antes de que el botón se pinte desactivado: el segundo no envía nada.
    if (enCurso.current || pendiente || !completa) return;
    const validado = cambiarHorarioSchema.safeParse({ claseIds, motivo: campos.motivo });
    if (!validado.success) {
      for (const problema of validado.error.issues) {
        if (problema.path[0] === 'motivo') {
          setError('motivo', { message: problema.message });
          return;
        }
      }
      return;
    }
    enCurso.current = true;
    setSinCupo([]);
    cambiar.mutate(
      { matriculaId: inicial.id, datos: validado.data },
      {
        onSuccess: setHecho,
        onError: (falla) => {
          // Las clases que se llenaron se marcan y se quitan de lo elegido: la lectura ya se volvió a pedir.
          const llenas = clasesSinCupo(falla);
          if (llenas.length > 0) {
            setSinCupo(llenas);
            setClaseIds((anteriores) => anteriores.filter((id) => !llenas.includes(id)));
          }
          for (const { campo, mensaje } of erroresPorCampo(falla)) {
            if (campo === 'motivo') setError('motivo', { message: mensaje });
          }
        },
        onSettled: () => {
          enCurso.current = false;
        },
      },
    );
  };

  if (hecho) return <ResultadoDelCambio respuesta={hecho} alCerrar={alCerrar} />;

  const errorGeneral =
    cambiar.isError &&
    !esErrorDeApi(cambiar.error, 401) &&
    !esErrorDeCambioDeSesion(cambiar.error) &&
    erroresPorCampo(cambiar.error).length === 0;

  return (
    <Modal titulo="Cambiar horario" alCerrar={cerrar} ancho="amplio">
      <form onSubmit={(evento) => void handleSubmit(alEnviar)(evento)} noValidate className="mt-2 space-y-4">
        <p className="text-slate-700">
          Mensualidad de <strong className="text-slate-900">{formatearMes(inicial.mes)}</strong> · {plan.nombre}
        </p>
        <p className="text-sm text-slate-700">
          Horario actual: {inicial.clases.map((clase) => textoDeClase(clase)).join(' · ')}.
        </p>
        <Aviso>
          El cambio rige desde ahora: no cambia el monto cobrado ni las clases de la mensualidad. Una clase nueva de hoy
          solo cuenta si todavía no empezó.
        </Aviso>

        <fieldset disabled={pendiente || sinSalida} className="min-w-0 space-y-4">
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-medium text-slate-800">
              Días y horario (
              {plan.vecesPorSemana === 1 ? 'elige 1 clase' : `elige ${plan.vecesPorSemana} clases, una por día`})
            </legend>
            <p className="text-sm text-slate-700" aria-live="polite">
              Elegiste {claseIds.length} de {plan.vecesPorSemana}.
            </p>
            {clasesDelPlan.length === 0 ? (
              <p className="text-sm text-slate-700">No hay clases para este plan y el nivel del alumno.</p>
            ) : null}
            {dias.map((dia) => {
              const delDia = clasesDelPlan.filter((clase) => clase.diaSemana === dia);
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
                      const esActual = actuales.has(clase.id);
                      const marcadaSinCupo = sinCupo.includes(clase.id);
                      const bloqueada = ((llena && !esActual) || completo) && !marcada;
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
                              {esActual ? <Insignia color="azul">Su horario</Insignia> : null}
                              {marcadaSinCupo ? <Insignia color="rojo">Sin cupo</Insignia> : null}
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

          <CampoAreaTexto
            etiqueta="Motivo"
            ayuda="De 3 a 200 caracteres. Queda en la auditoría. Por ejemplo: «El alumno cambió de turno en el colegio»."
            error={formState.errors.motivo?.message}
            {...register('motivo', { onChange: () => clearErrors('motivo') })}
          />
        </fieldset>

        {horario.isError && !esErrorDeApi(horario.error, 401) ? (
          <Alerta>No pudimos actualizar los cupos. Lo que ves puede estar desactualizado.</Alerta>
        ) : null}
        {errorGeneral ? <Alerta>{mensajeDeCambioDeHorario(cambiar.error)}</Alerta> : null}
        {completa && igualAlActual ? (
          <p className="text-sm text-slate-700">Elige otras clases para cambiar el horario.</p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
          <button
            type="submit"
            disabled={pendiente || sinSalida || !completa || igualAlActual}
            className={ESTILO_BOTON.primario}
          >
            {pendiente ? 'Guardando…' : 'Cambiar horario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResultadoDelCambio({ respuesta, alCerrar }: { respuesta: RespuestaCambioHorario; alCerrar: () => void }) {
  const { matricula } = respuesta;
  const restantes = matricula.clasesTotales - matricula.clasesUsadas;
  return (
    <Modal titulo="Horario cambiado" alCerrar={alCerrar}>
      <div className="mt-2 space-y-4">
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          Se cambió el horario de la mensualidad de {formatearMes(matricula.mes)}.
        </p>
        <p className="text-slate-900">
          Horario nuevo: {matricula.clases.map((clase) => textoDeClase(clase)).join(' · ')}.
        </p>
        {quedanMenosOcurrenciasQueClases(respuesta) ? (
          <Aviso>
            Con el nuevo horario solo quedan {matricula.ocurrenciasRestantes}{' '}
            {matricula.ocurrenciasRestantes === 1 ? 'clase' : 'clases'} en {formatearMes(matricula.mes)}, y al alumno le
            quedan {restantes} por usar. Las que no alcance a usar se pierden al cerrar el mes.
          </Aviso>
        ) : (
          <p className="text-sm text-slate-700">
            Quedan {matricula.ocurrenciasRestantes} {matricula.ocurrenciasRestantes === 1 ? 'clase' : 'clases'} del
            nuevo horario en {formatearMes(matricula.mes)}; al alumno le quedan {restantes} por usar.
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.primario}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
