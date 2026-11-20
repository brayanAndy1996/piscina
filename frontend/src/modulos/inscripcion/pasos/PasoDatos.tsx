import { GRADOS_COLEGIO, NOMBRE_GRADO_COLEGIO } from '@aquagestion/contratos';
import { CampoSelect, CampoTexto } from '../../../componentes/ui';
import { type FormularioInscripcion, propiedadesDe } from './comun';

/** Paso 1: los datos personales de quien se inscribe (HU-01). El correo, la dirección y el grado son opcionales (DR-5 de 005). */
export function PasoDatos({ form }: { form: FormularioInscripcion }) {
  const fecha = propiedadesDe(form, 'alumno.fechaNacimiento');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto etiqueta="Nombres" autoComplete="given-name" {...propiedadesDe(form, 'alumno.nombres')} />
        <CampoTexto etiqueta="Apellidos" autoComplete="family-name" {...propiedadesDe(form, 'alumno.apellidos')} />
        <CampoTexto
          etiqueta="DNI"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          ayuda="8 dígitos."
          {...propiedadesDe(form, 'alumno.dni')}
        />
        <CampoTexto
          etiqueta="Fecha de nacimiento"
          type="date"
          autoComplete="bday"
          {...fecha}
          onChange={(evento) => {
            void fecha.onChange(evento);
            // Quien acepta cambia con la edad (la persona o su apoderado): los consentimientos se vuelven a aceptar.
            form.setValue('consentimientos.datosPersonales', false);
            form.setValue('consentimientos.deslinde', false);
            form.setValue('consentimientos.imagen', false);
          }}
        />
        <CampoTexto
          etiqueta="Celular"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          ayuda="9 dígitos, empieza con 9."
          {...propiedadesDe(form, 'alumno.telefono')}
        />
        <CampoTexto
          etiqueta="Correo (opcional)"
          type="email"
          inputMode="email"
          autoComplete="email"
          ayuda="Si lo escribes, ahí te llega el enlace para seguir tu solicitud."
          {...propiedadesDe(form, 'alumno.correo')}
        />
      </div>
      <CampoTexto
        etiqueta="Dirección (opcional)"
        autoComplete="street-address"
        {...propiedadesDe(form, 'alumno.direccion')}
      />
      <CampoSelect etiqueta="Grado del colegio (opcional)" {...propiedadesDe(form, 'alumno.gradoColegio')}>
        <option value="">Sin indicar</option>
        {GRADOS_COLEGIO.map((grado) => (
          <option key={grado} value={grado}>
            {NOMBRE_GRADO_COLEGIO[grado]}
          </option>
        ))}
      </CampoSelect>
    </div>
  );
}
