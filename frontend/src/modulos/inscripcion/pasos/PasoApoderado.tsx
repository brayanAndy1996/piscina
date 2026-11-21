import { NOMBRE_PARENTESCO, PARENTESCOS } from '@aquagestion/contratos';
import { CampoSelect, CampoTexto } from '../../../componentes/ui';
import { type FormularioInscripcion, propiedadesDe } from './comun';

/** Paso 3, solo si la persona es menor de 18 años en la fecha de Lima: los datos de su padre, madre o apoderado (RN-20). */
export function PasoApoderado({ form }: { form: FormularioInscripcion }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        La persona que se inscribe es menor de 18 años: necesitamos los datos de su padre, madre o apoderado, que es
        quien acepta los consentimientos.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto etiqueta="Nombres del apoderado" autoComplete="off" {...propiedadesDe(form, 'apoderado.nombres')} />
        <CampoTexto
          etiqueta="Apellidos del apoderado"
          autoComplete="off"
          {...propiedadesDe(form, 'apoderado.apellidos')}
        />
        <CampoTexto
          etiqueta="DNI del apoderado"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          ayuda="8 dígitos."
          {...propiedadesDe(form, 'apoderado.dni')}
        />
        <CampoTexto
          etiqueta="Celular del apoderado"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          ayuda="9 dígitos, empieza con 9."
          {...propiedadesDe(form, 'apoderado.telefono')}
        />
        <CampoSelect etiqueta="Parentesco" {...propiedadesDe(form, 'apoderado.parentesco')}>
          <option value="">Elige una opción</option>
          {PARENTESCOS.map((parentesco) => (
            <option key={parentesco} value={parentesco}>
              {NOMBRE_PARENTESCO[parentesco]}
            </option>
          ))}
        </CampoSelect>
        <CampoTexto
          etiqueta="Correo del apoderado (opcional)"
          type="email"
          inputMode="email"
          autoComplete="off"
          {...propiedadesDe(form, 'apoderado.correo')}
        />
      </div>
    </div>
  );
}
