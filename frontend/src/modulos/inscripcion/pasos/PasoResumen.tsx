import {
  type ClasePublica,
  type Cotizacion,
  NOMBRE_DIA,
  NOMBRE_NIVEL,
  type NivelNatacion,
  type PlanPublico,
  type TextosConsentimiento,
} from '@aquagestion/contratos';
import { CampoCasilla } from '../../../componentes/ui';
import { formatearSoles } from '../../../lib/dinero';
import { formatearFechaCalendario, formatearMes } from '../../../lib/fechas';
import { type FormularioInscripcion, mensajeDeError } from './comun';

/** El monto a pagar y por qué: proporcional "N de M clases" si entra a mitad de mes, y que el precio ya incluye IGV (D-03, HU-34). */
export function CuadroDeMonto({ cotizacion }: { cotizacion: Cotizacion }) {
  return (
    <section aria-label="Monto a pagar" className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-200">
      <p className="text-sm text-slate-700">Monto a pagar por {formatearMes(cotizacion.mes)}</p>
      <p className="text-3xl font-semibold text-sky-900">{formatearSoles(cotizacion.monto)}</p>
      {cotizacion.esProporcional ? (
        <p className="mt-1 text-sm text-slate-800">
          Proporcional: {cotizacion.clasesTotales} de {cotizacion.clasesPorMes} clases (del{' '}
          {formatearFechaCalendario(cotizacion.fechaInicio)} al {formatearFechaCalendario(cotizacion.fechaFin)}). El
          plan completo cuesta {formatearSoles(cotizacion.precioPlan)}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Mes completo: {cotizacion.clasesTotales} clases (del {formatearFechaCalendario(cotizacion.fechaInicio)} al{' '}
          {formatearFechaCalendario(cotizacion.fechaFin)}).
        </p>
      )}
      <p className="mt-1 text-sm text-slate-700">El precio ya incluye IGV.</p>
    </section>
  );
}

interface Propiedades {
  form: FormularioInscripcion;
  nombreCompleto: string;
  nivel: NivelNatacion;
  plan: PlanPublico;
  clases: readonly ClasePublica[];
  cotizacion: Cotizacion;
  menor: boolean;
  textos: TextosConsentimiento;
}

/**
 * Paso final: el resumen de lo elegido, la cotización y las casillas de los consentimientos con sus textos (HU-01, D-07, RNF-05). Los dos
 * primeros son obligatorios; el de imagen es opcional y no impide inscribirse.
 */
export function PasoResumen({ form, nombreCompleto, nivel, plan, clases, cotizacion, menor, textos }: Propiedades) {
  const errores = form.formState.errors;
  const alCambiar = (ruta: 'consentimientos.datosPersonales' | 'consentimientos.deslinde' | 'consentimientos.imagen') =>
    form.register(ruta, { onChange: () => form.clearErrors(ruta) });
  const quien = menor ? 'Acepto, como padre, madre o apoderado,' : 'Acepto';
  return (
    <div className="space-y-5">
      <section aria-label="Lo que elegiste" className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-slate-600 sm:text-slate-800">Persona que se inscribe</dt>
          <dd className="break-words text-slate-900 mb-2 sm:mb-0">{nombreCompleto}</dd>
          <dt className="font-medium text-slate-600 sm:text-slate-800">Nivel</dt>
          <dd className="text-slate-900 mb-2 sm:mb-0">{NOMBRE_NIVEL[nivel]}</dd>
          <dt className="font-medium text-slate-600 sm:text-slate-800">Plan</dt>
          <dd className="break-words text-slate-900 mb-2 sm:mb-0">{plan.nombre}</dd>
          <dt className="font-medium text-slate-600 sm:text-slate-800">Clases</dt>
          <dd className="text-slate-900 mb-2 sm:mb-0">
            <ul>
              {clases.map((clase) => (
                <li key={clase.id}>
                  {NOMBRE_DIA[clase.diaSemana]} de {clase.horaInicio} a {clase.horaFin}
                </li>
              ))}
            </ul>
          </dd>
        </dl>
      </section>

      <CuadroDeMonto cotizacion={cotizacion} />

      <fieldset className="min-w-0 space-y-4">
        <legend className="text-base font-semibold text-slate-900">Consentimientos</legend>
        <div>
          <p className="text-sm text-slate-800">{textos.DATOS_PERSONALES}</p>
          <CampoCasilla
            etiqueta={`${quien} el tratamiento de datos personales`}
            error={mensajeDeError(errores, 'consentimientos.datosPersonales')}
            {...alCambiar('consentimientos.datosPersonales')}
          />
        </div>
        <div>
          <p className="text-sm text-slate-800">{textos.DESLINDE}</p>
          <CampoCasilla
            etiqueta={`${quien} el deslinde de responsabilidad`}
            error={mensajeDeError(errores, 'consentimientos.deslinde')}
            {...alCambiar('consentimientos.deslinde')}
          />
        </div>
        <div>
          <p className="text-sm text-slate-800">{textos.IMAGEN}</p>
          <CampoCasilla etiqueta="Autorizo el uso de imagen (opcional)" {...alCambiar('consentimientos.imagen')} />
        </div>
      </fieldset>
    </div>
  );
}
