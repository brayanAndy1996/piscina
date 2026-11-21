import type { FieldErrors, Path, UseFormReturn } from 'react-hook-form';
import type { CamposInscripcion } from '../campos';

export type FormularioInscripcion = UseFormReturn<CamposInscripcion>;

/** El mensaje del error de un campo (`alumno.dni`), o `undefined`. */
export function mensajeDeError(errores: FieldErrors<CamposInscripcion>, ruta: string): string | undefined {
  let actual: unknown = errores;
  for (const parte of ruta.split('.')) {
    if (typeof actual !== 'object' || actual === null) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  if (typeof actual !== 'object' || actual === null) return undefined;
  const mensaje = (actual as { message?: unknown }).message;
  return typeof mensaje === 'string' ? mensaje : undefined;
}

/** Lo que un campo de texto necesita: el registro del formulario y su error. Al escribir, se borra el error del campo. */
export function propiedadesDe(form: FormularioInscripcion, ruta: Path<CamposInscripcion>) {
  return {
    ...form.register(ruta, { onChange: () => form.clearErrors(ruta) }),
    error: mensajeDeError(form.formState.errors, ruta),
  };
}
