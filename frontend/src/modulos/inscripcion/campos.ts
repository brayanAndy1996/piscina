import {
  type ClasePublica,
  enviarInscripcionSchema,
  esMenorDeEdad,
  fechaSchema,
  nivelNatacionSchema,
  type PlanPublico,
  validarFechaNacimiento,
} from '@aquagestion/contratos';
import type { ZodError } from 'zod';

/**
 * Los campos del formulario de inscripción y su validación por pasos con los esquemas compartidos (criterio 43 de 005). La web no
 * repite ninguna regla: cada paso valida su parte de `enviarInscripcionSchema` y la fecha de nacimiento con `validarFechaNacimiento`; la
 * edad, con `esMenorDeEdad` y la fecha `hoy` que dio la API (nunca el reloj del navegador).
 *
 * Los campos tienen la misma forma que el cuerpo del envío (`alumno.dni`, `fichaMedica.contactoEmergencia.telefono`…), así los errores
 * de la API caen en el campo que corresponde. Todo es texto o casilla: lo vacío no se envía.
 */

export interface CamposInscripcion {
  alumno: {
    nombres: string;
    apellidos: string;
    dni: string;
    fechaNacimiento: string;
    telefono: string;
    correo: string;
    direccion: string;
    gradoColegio: string;
    nivel: string;
  };
  fichaMedica: {
    tipoSangre: string;
    enfermedades: string;
    alergias: string;
    medicamentos: string;
    seguro: string;
    contactoEmergencia: { nombre: string; telefono: string };
  };
  apoderado: {
    nombres: string;
    apellidos: string;
    dni: string;
    telefono: string;
    parentesco: string;
    correo: string;
  };
  inscripcion: { planId: string; claseIds: string[] };
  consentimientos: { datosPersonales: boolean; deslinde: boolean; imagen: boolean };
}

export const CAMPOS_INICIALES: CamposInscripcion = {
  alumno: {
    nombres: '',
    apellidos: '',
    dni: '',
    fechaNacimiento: '',
    telefono: '',
    correo: '',
    direccion: '',
    gradoColegio: '',
    nivel: '',
  },
  fichaMedica: {
    tipoSangre: '',
    enfermedades: '',
    alergias: '',
    medicamentos: '',
    seguro: '',
    contactoEmergencia: { nombre: '', telefono: '' },
  },
  apoderado: { nombres: '', apellidos: '', dni: '', telefono: '', parentesco: '', correo: '' },
  inscripcion: { planId: '', claseIds: [] },
  consentimientos: { datosPersonales: false, deslinde: false, imagen: false },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------------------------------------------------------------

export type Paso = 'datos' | 'ficha' | 'apoderado' | 'plan' | 'foto' | 'resumen';

export const ETIQUETA_PASO: Readonly<Record<Paso, string>> = {
  datos: 'Datos personales',
  ficha: 'Ficha médica',
  apoderado: 'Apoderado',
  plan: 'Plan y horario',
  foto: 'Foto (opcional)',
  resumen: 'Resumen y confirmación',
};

/** Los pasos del formulario: el del apoderado solo aparece si la persona es menor de edad (RN-20). */
export function pasosDeInscripcion(menor: boolean): Paso[] {
  return menor
    ? ['datos', 'ficha', 'apoderado', 'plan', 'foto', 'resumen']
    : ['datos', 'ficha', 'plan', 'foto', 'resumen'];
}

/** ¿Es menor de edad con esta fecha de nacimiento? Una fecha que todavía no es una fecha real no cuenta como menor. */
export function esMenor(fechaNacimiento: string, hoy: string): boolean {
  return fechaSchema.safeParse(fechaNacimiento).success && esMenorDeEdad(fechaNacimiento, hoy);
}

/** El paso al que pertenece un campo (por ejemplo, para llevar a la persona al campo que la API rechazó). */
export function pasoDeCampo(ruta: string): Paso {
  if (ruta.startsWith('fichaMedica')) return 'ficha';
  if (ruta.startsWith('apoderado')) return 'apoderado';
  if (ruta.startsWith('inscripcion') || ruta === 'alumno.nivel') return 'plan';
  if (ruta.startsWith('consentimientos')) return 'resumen';
  return 'datos';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Construcción del cuerpo y validación
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un campo opcional vacío no se envía. */
function sinVacios<T extends Record<string, unknown>>(objeto: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => !(typeof valor === 'string' && valor.trim() === '')),
  );
}

function alumnoDe(campos: CamposInscripcion, incluirNivel: boolean): Record<string, unknown> {
  const { nivel, ...resto } = campos.alumno;
  return sinVacios(incluirNivel ? { ...resto, nivel } : resto);
}

function fichaDe(campos: CamposInscripcion): Record<string, unknown> {
  const { contactoEmergencia, ...resto } = campos.fichaMedica;
  return { ...sinVacios(resto), contactoEmergencia: { ...contactoEmergencia } };
}

export interface DatosDelEnvio {
  claveIdempotencia: string;
  /** El mes y el monto de la cotización que vio la persona (criterio 19). */
  mes: string;
  montoMostrado: string;
  /** La versión de los textos de consentimiento que vio. */
  version: string;
  menor: boolean;
}

/** El cuerpo de `POST /inscripcion`. Se valida con `enviarInscripcionSchema` antes de enviarlo. */
export function construirEnvio(campos: CamposInscripcion, datos: DatosDelEnvio): unknown {
  return {
    claveIdempotencia: datos.claveIdempotencia,
    alumno: alumnoDe(campos, true),
    fichaMedica: fichaDe(campos),
    ...(datos.menor ? { apoderado: sinVacios(campos.apoderado) } : {}),
    inscripcion: {
      planId: campos.inscripcion.planId,
      claseIds: campos.inscripcion.claseIds,
      mes: datos.mes,
      montoMostrado: datos.montoMostrado,
    },
    consentimientos: {
      version: datos.version,
      datosPersonales: campos.consentimientos.datosPersonales,
      deslinde: campos.consentimientos.deslinde,
      imagen: campos.consentimientos.imagen,
    },
  };
}

/** Errores por campo (`alumno.dni`): el primero de cada campo. El error de un elemento de una lista cuenta como error de la lista. */
export type Errores = Record<string, string>;

export function erroresDeEsquema(error: ZodError): Errores {
  const errores: Errores = {};
  for (const problema of error.issues) {
    const ruta = problema.path.filter((parte): parte is string => typeof parte === 'string').join('.');
    if (!(ruta in errores)) errores[ruta] = problema.message;
  }
  return errores;
}

/** Los esquemas por paso, sacados del esquema del envío. */
const ESQUEMA_ALUMNO = enviarInscripcionSchema.shape.alumno;
const ESQUEMA_DATOS = ESQUEMA_ALUMNO.omit({ nivel: true });
const ESQUEMA_FICHA = enviarInscripcionSchema.shape.fichaMedica;
const ESQUEMA_APODERADO = enviarInscripcionSchema.shape.apoderado.unwrap();
const ESQUEMA_ELECCION = enviarInscripcionSchema.shape.inscripcion.pick({ planId: true, claseIds: true });
const ESQUEMA_CONSENTIMIENTOS = enviarInscripcionSchema.shape.consentimientos;

function conPrefijo(prefijo: string, errores: Errores): Errores {
  return Object.fromEntries(
    Object.entries(errores).map(([ruta, mensaje]) => [ruta ? `${prefijo}.${ruta}` : prefijo, mensaje]),
  );
}

const ELIGE_UNA_OPCION = 'Elige una opción.';
const DATO_OBLIGATORIO = 'Este dato es obligatorio.';

/** El valor de un campo del formulario por su ruta (`alumno.dni`). */
function valorEn(campos: unknown, ruta: string): unknown {
  let actual = campos;
  for (const parte of ruta.split('.')) {
    if (typeof actual !== 'object' || actual === null) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

/** Un campo obligatorio vacío no dice "se esperaba texto": dice que es obligatorio. */
function pedirDato(errores: Errores, campos: CamposInscripcion): Errores {
  for (const ruta of Object.keys(errores)) {
    const valor = valorEn(campos, ruta);
    if (typeof valor === 'string' && valor.trim() === '') errores[ruta] = DATO_OBLIGATORIO;
  }
  return errores;
}

/** Una lista desplegable sin elegir no dice "no es válido": pide elegir. */
function pedirElegir(errores: Errores, ruta: string, valor: string): void {
  if (valor.trim() === '' && ruta in errores) errores[ruta] = ELIGE_UNA_OPCION;
}

export interface ContextoDePaso {
  /** La fecha de hoy en Lima, de la API. */
  hoy: string;
  /** El plan elegido, si hay uno. */
  plan: PlanPublico | undefined;
}

/** Los errores de un paso, o un objeto vacío si está bien. Valida con los esquemas compartidos. */
export function validarPaso(paso: Paso, campos: CamposInscripcion, contexto: ContextoDePaso): Errores {
  switch (paso) {
    case 'datos': {
      const resultado = ESQUEMA_DATOS.safeParse(alumnoDe(campos, false));
      const errores = pedirDato(
        conPrefijo('alumno', resultado.success ? {} : erroresDeEsquema(resultado.error)),
        campos,
      );
      if (!('alumno.fechaNacimiento' in errores)) {
        const mensaje = validarFechaNacimiento(campos.alumno.fechaNacimiento, contexto.hoy);
        if (mensaje) errores['alumno.fechaNacimiento'] = mensaje;
      }
      return errores;
    }
    case 'ficha': {
      const resultado = ESQUEMA_FICHA.safeParse(fichaDe(campos));
      const errores = pedirDato(
        conPrefijo('fichaMedica', resultado.success ? {} : erroresDeEsquema(resultado.error)),
        campos,
      );
      pedirElegir(errores, 'fichaMedica.tipoSangre', campos.fichaMedica.tipoSangre);
      return errores;
    }
    case 'apoderado': {
      const resultado = ESQUEMA_APODERADO.safeParse(sinVacios(campos.apoderado));
      const errores = pedirDato(
        conPrefijo('apoderado', resultado.success ? {} : erroresDeEsquema(resultado.error)),
        campos,
      );
      pedirElegir(errores, 'apoderado.parentesco', campos.apoderado.parentesco);
      if (!('apoderado.dni' in errores) && campos.apoderado.dni.trim() === campos.alumno.dni.trim()) {
        errores['apoderado.dni'] = 'El DNI del apoderado no puede ser igual al de la persona que se inscribe.';
      }
      return errores;
    }
    case 'plan': {
      const errores: Errores = {};
      if (!nivelNatacionSchema.safeParse(campos.alumno.nivel).success) errores['alumno.nivel'] = 'Elige tu nivel.';
      if (campos.inscripcion.planId === '' || !contexto.plan) {
        errores['inscripcion.planId'] = 'Elige un plan.';
        return errores;
      }
      const resultado = ESQUEMA_ELECCION.safeParse(campos.inscripcion);
      if (!resultado.success) {
        const deLista = erroresDeEsquema(resultado.error);
        if (deLista['claseIds']) errores['inscripcion.claseIds'] = deLista['claseIds'];
      }
      const cantidad = contexto.plan.vecesPorSemana;
      if (!('inscripcion.claseIds' in errores) && campos.inscripcion.claseIds.length !== cantidad) {
        errores['inscripcion.claseIds'] = cantidad === 1 ? 'Elige 1 clase.' : `Elige ${cantidad} clases, una por día.`;
      }
      return errores;
    }
    case 'foto':
      // La foto es opcional y se avisa al elegir el archivo: el paso no tiene nada que validar.
      return {};
    case 'resumen': {
      const resultado = ESQUEMA_CONSENTIMIENTOS.safeParse({ ...campos.consentimientos, version: 'x' });
      return conPrefijo('consentimientos', resultado.success ? {} : erroresDeEsquema(resultado.error));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Oferta: planes y clases
// ---------------------------------------------------------------------------------------------------------------------------------

/** Los planes que aplican al nivel elegido (RN-07, D-15). */
export function planesParaNivel(planes: readonly PlanPublico[], nivel: string): PlanPublico[] {
  return planes.filter((plan) => (plan.nivelesAplicables as readonly string[]).includes(nivel));
}

/**
 * Las clases que se pueden elegir con un plan y un nivel: del nivel, en un día y una franja del plan (criterio 43). Ordenadas por día y
 * hora, como las muestra la web.
 */
export function clasesParaPlan(clases: readonly ClasePublica[], plan: PlanPublico, nivel: string): ClasePublica[] {
  return clases
    .filter(
      (clase) =>
        clase.nivel === nivel &&
        plan.diasPermitidos.includes(clase.diaSemana) &&
        plan.franjasPermitidas.includes(clase.horaInicio),
    )
    .sort(
      (a, b) => a.diaSemana - b.diaSemana || (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0),
    );
}

/**
 * Elige o quita una clase: una sola por día (elegir otra del mismo día reemplaza a la anterior). Con todas las que pide el plan ya
 * elegidas, otro día no se agrega. Devuelve la lista nueva.
 */
export function alternarClase(
  elegidas: readonly string[],
  clase: ClasePublica,
  conocidas: readonly ClasePublica[],
  vecesPorSemana: number,
): string[] {
  if (elegidas.includes(clase.id)) return elegidas.filter((id) => id !== clase.id);
  const delMismoDia = new Set(conocidas.filter((otra) => otra.diaSemana === clase.diaSemana).map((otra) => otra.id));
  const resto = elegidas.filter((id) => !delMismoDia.has(id));
  if (resto.length >= vecesPorSemana) return [...elegidas];
  return [...resto, clase.id];
}

export { nuevaClaveUuid as nuevaClaveDeEnvio } from '../../lib/uuid';
