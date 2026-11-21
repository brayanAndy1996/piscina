import { NOMBRE_TIPO_SANGRE, TIPOS_SANGRE } from '@aquagestion/contratos';
import { CampoAreaTexto, CampoSelect, CampoTexto } from '../../../componentes/ui';
import { type FormularioInscripcion, propiedadesDe } from './comun';

/**
 * Paso 2: la ficha médica (HU-01). Son datos de salud, de acceso restringido (RN-21, RNF-05). Obligatorios: el tipo de sangre (con "No sé")
 * y el contacto de emergencia; el resto es opcional (DR-5 de 005).
 */
export function PasoFicha({ form }: { form: FormularioInscripcion }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Estos datos son de salud: solo los ve el personal autorizado de la academia. Si no hay nada que informar, deja
        los campos opcionales vacíos.
      </p>
      <CampoSelect etiqueta="Tipo de sangre" {...propiedadesDe(form, 'fichaMedica.tipoSangre')}>
        <option value="">Elige una opción</option>
        {TIPOS_SANGRE.map((tipo) => (
          <option key={tipo} value={tipo}>
            {NOMBRE_TIPO_SANGRE[tipo]}
          </option>
        ))}
      </CampoSelect>
      <CampoAreaTexto etiqueta="Enfermedades (opcional)" {...propiedadesDe(form, 'fichaMedica.enfermedades')} />
      <CampoAreaTexto etiqueta="Alergias (opcional)" {...propiedadesDe(form, 'fichaMedica.alergias')} />
      <CampoAreaTexto etiqueta="Medicamentos (opcional)" {...propiedadesDe(form, 'fichaMedica.medicamentos')} />
      <CampoTexto etiqueta="Seguro de salud (opcional)" {...propiedadesDe(form, 'fichaMedica.seguro')} />
      <fieldset className="min-w-0 space-y-4 rounded-lg border-0 p-0">
        <legend className="text-base font-semibold text-slate-900">Contacto de emergencia</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Nombre del contacto"
            autoComplete="off"
            {...propiedadesDe(form, 'fichaMedica.contactoEmergencia.nombre')}
          />
          <CampoTexto
            etiqueta="Celular del contacto"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            ayuda="9 dígitos, empieza con 9."
            {...propiedadesDe(form, 'fichaMedica.contactoEmergencia.telefono')}
          />
        </div>
      </fieldset>
    </div>
  );
}
