import {
  type ActualizarClase,
  actualizarClaseSchema,
  type Clase,
  type CrearClase,
  crearClaseSchema,
} from '@aquagestion/contratos';

import { numeroODeTexto } from '../../lib/numeros';

/** Los campos del formulario de una clase. Los selectores guardan el valor de su opción y el aforo, el texto de la entrada. */
export interface CamposClase {
  nivel: string;
  diaSemana: string;
  horaInicio: string;
  entrenadorId: string;
  aforo: string;
  activo: boolean;
}

export type CampoClase = keyof CamposClase;

export const CAMPOS_CLASE: readonly CampoClase[] = [
  'nivel',
  'diaSemana',
  'horaInicio',
  'entrenadorId',
  'aforo',
  'activo',
];

export function esCampoClase(nombre: unknown): nombre is CampoClase {
  return CAMPOS_CLASE.some((campo) => campo === nombre);
}

/** Los campos con los valores de una clase (`null`: clase nueva, con lo que se eligió en la grilla si se indica). */
export function aCamposClase(clase: Clase | null): CamposClase {
  if (!clase) return { nivel: '', diaSemana: '', horaInicio: '', entrenadorId: '', aforo: '', activo: true };
  return {
    nivel: clase.nivel,
    diaSemana: String(clase.diaSemana),
    horaInicio: clase.horaInicio,
    entrenadorId: clase.entrenador.id,
    aforo: String(clase.aforo),
    activo: clase.activo,
  };
}

/** Los campos que el formulario cambió frente a la clase con la que se llenó: solo el entrenador, el aforo y el estado (DR-4 de 004). */
export function cambiosDeClase(campos: CamposClase, base: Clase): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  if (campos.entrenadorId !== base.entrenador.id) cambios['entrenadorId'] = campos.entrenadorId;
  const aforo = numeroODeTexto(campos.aforo);
  if (aforo !== base.aforo) cambios['aforo'] = aforo;
  if (campos.activo !== base.activo) cambios['activo'] = campos.activo;
  return cambios;
}

export function camposEditadosDeClase(campos: CamposClase, base: Clase | null): string[] {
  return base ? Object.keys(cambiosDeClase(campos, base)) : [];
}

/** Si dos clases valen lo mismo en lo que el formulario edita y muestra (el nombre del entrenador no cuenta: es un dato suyo). */
export function sonIgualesClases(a: Clase | null, b: Clase | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.nivel === b.nivel &&
    a.diaSemana === b.diaSemana &&
    a.horaInicio === b.horaInicio &&
    a.aforo === b.aforo &&
    a.activo === b.activo &&
    a.entrenador.id === b.entrenador.id &&
    a.entrenador.activo === b.entrenador.activo
  );
}

export type ErroresClase = Partial<Record<CampoClase, string>>;
export type ResultadoValidacion<T> = { correcto: true; datos: T } | { correcto: false; errores: ErroresClase };

function erroresDe(problemas: readonly { path: readonly PropertyKey[]; message: string }[]): ErroresClase {
  const errores: ErroresClase = {};
  for (const problema of problemas) {
    const campo = problema.path[0];
    if (esCampoClase(campo) && errores[campo] === undefined) errores[campo] = problema.message;
  }
  return errores;
}

const MENSAJES_VACIO: Partial<Record<CampoClase, string>> = {
  nivel: 'Elige un nivel.',
  diaSemana: 'Elige un día.',
  horaInicio: 'Elige un bloque.',
  entrenadorId: 'Elige un entrenador.',
};

/** Valida una clase nueva con el esquema compartido de la API. Un selector sin elegir da un mensaje claro y no el del esquema. */
export function validarClaseNueva(campos: CamposClase): ResultadoValidacion<CrearClase> {
  const vacios: ErroresClase = {};
  for (const campo of ['nivel', 'diaSemana', 'horaInicio', 'entrenadorId'] as const) {
    if (campos[campo] === '') vacios[campo] = MENSAJES_VACIO[campo] ?? 'Elige una opción.';
  }
  const resultado = crearClaseSchema.safeParse({
    nivel: campos.nivel,
    diaSemana: numeroODeTexto(campos.diaSemana),
    horaInicio: campos.horaInicio,
    entrenadorId: campos.entrenadorId,
    aforo: numeroODeTexto(campos.aforo),
  });
  if (resultado.success) return { correcto: true, datos: resultado.data };
  return { correcto: false, errores: { ...erroresDe(resultado.error.issues), ...vacios } };
}

/** Valida los cambios de una clase con el esquema compartido. */
export function validarCambiosDeClase(campos: CamposClase, base: Clase): ResultadoValidacion<ActualizarClase> {
  const resultado = actualizarClaseSchema.safeParse(cambiosDeClase(campos, base));
  return resultado.success
    ? { correcto: true, datos: resultado.data }
    : { correcto: false, errores: erroresDe(resultado.error.issues) };
}
