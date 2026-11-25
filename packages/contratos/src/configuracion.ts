import { z } from 'zod';
import { telefonoCelularSchema } from './inscripcion';
import { sinControles, textoVisibleSchema } from './texto';

/**
 * Configuración de cada academia (spec 003): tolerancia de tardanza (D-11), días "por vencer" (HU-11), días de prioridad al renovar
 * (D-06), intentos y minutos de bloqueo del inicio de sesión (D-07) y teléfono (D-22), más, desde la 007b, los datos de pago de la academia
 * (Yape y transferencia, criterio 53 de la spec 007). Los valores viven en `configuraciones`
 * (clave/valor por academia). Una clave sin fila, o con un valor que no cumple esta tabla, vale lo de por defecto. La API y la web
 * leen la misma tabla, así que los rangos se cambian en un solo lugar.
 */

/** Campos de la API, en el orden en que se muestran. */
export const CAMPOS_CONFIGURACION = [
  'toleranciaTardanzaMinutos',
  'diasPorVencer',
  'diasPrioridadRenovacion',
  'intentosInicioSesion',
  'minutosBloqueo',
  'telefono',
] as const;
export type CampoConfiguracion = (typeof CAMPOS_CONFIGURACION)[number];

/** Campos numéricos (enteros con rango inclusivo). */
export const CAMPOS_ENTEROS_CONFIGURACION = [
  'toleranciaTardanzaMinutos',
  'diasPorVencer',
  'diasPrioridadRenovacion',
  'intentosInicioSesion',
  'minutosBloqueo',
] as const;
export type CampoEnteroConfiguracion = (typeof CAMPOS_ENTEROS_CONFIGURACION)[number];

interface DefinicionEntera {
  /** Clave en `configuraciones.clave`. */
  readonly clave: string;
  readonly tipo: 'entero';
  readonly porDefecto: number;
  /** Límites inclusivos. */
  readonly minimo: number;
  readonly maximo: number;
  /** Textos para la pantalla de configuración. */
  readonly etiqueta: string;
  readonly unidad: string;
  readonly ayuda: string;
}

interface DefinicionTelefono {
  readonly clave: string;
  readonly tipo: 'telefono';
  readonly porDefecto: null;
  readonly etiqueta: string;
  readonly unidad: string;
  readonly ayuda: string;
}

/** Los datos de pago que la persona ve junto al formulario del comprobante (007b, criterio 53). Todos opcionales: sin valor, no se muestran. */
export const CAMPOS_DATOS_DE_PAGO = [
  'yapeNumero',
  'yapeTitular',
  'transferenciaBanco',
  'transferenciaCuenta',
  'transferenciaCci',
  'transferenciaTitular',
] as const;
export type CampoDatoDePago = (typeof CAMPOS_DATOS_DE_PAGO)[number];

interface DefinicionDatoDePago {
  readonly clave: string;
  /** `celular`: 9 dígitos que empiezan con 9; `texto`: de 1 a `maximo` caracteres visibles. */
  readonly tipo: 'celular' | 'texto';
  readonly porDefecto: null;
  /** Solo en `texto`. */
  readonly maximo?: number;
  readonly etiqueta: string;
  readonly unidad: string;
  readonly ayuda: string;
}

/**
 * La tabla de claves: campo de la API, clave en la base, tipo, valor por defecto, rango y textos de la pantalla. Rangos aprobados
 * en DR-1 de la spec 003 (para el MVP).
 */
export const CLAVES_CONFIGURACION = {
  toleranciaTardanzaMinutos: {
    clave: 'tolerancia_tardanza_minutos',
    tipo: 'entero',
    porDefecto: 10,
    minimo: 0,
    maximo: 30,
    etiqueta: 'Tolerancia de tardanza',
    unidad: 'minutos',
    ayuda:
      'Minutos desde el inicio de la clase hasta los que se marca la asistencia como puntual; después se marca como tarde.',
  },
  diasPorVencer: {
    clave: 'dias_por_vencer',
    tipo: 'entero',
    porDefecto: 5,
    minimo: 1,
    maximo: 15,
    etiqueta: 'Días para marcar una mensualidad "por vencer"',
    unidad: 'días',
    ayuda: 'Una mensualidad se muestra como "por vencer" durante estos últimos días antes de su fecha de vencimiento.',
  },
  diasPrioridadRenovacion: {
    clave: 'dias_prioridad_renovacion',
    tipo: 'entero',
    porDefecto: 5,
    minimo: 1,
    maximo: 15,
    etiqueta: 'Días de prioridad para renovar',
    unidad: 'días',
    ayuda:
      'Durante estos últimos días del mes, quien renueva conserva su horario antes de que se ofrezca el cupo a otras personas. No cambia solo cuando cambian los días "por vencer".',
  },
  intentosInicioSesion: {
    clave: 'intentos_inicio_sesion',
    tipo: 'entero',
    porDefecto: 5,
    minimo: 3,
    maximo: 10,
    etiqueta: 'Intentos fallidos antes del bloqueo',
    unidad: 'intentos',
    ayuda: 'Intentos seguidos con la contraseña equivocada que bloquean la cuenta de un usuario de la academia.',
  },
  minutosBloqueo: {
    clave: 'minutos_bloqueo',
    tipo: 'entero',
    porDefecto: 15,
    minimo: 5,
    maximo: 60,
    etiqueta: 'Duración del bloqueo',
    unidad: 'minutos',
    ayuda:
      'Tiempo que una cuenta queda bloqueada tras los intentos fallidos. Un bloqueo ya puesto no cambia si se modifica este valor.',
  },
  telefono: {
    clave: 'telefono',
    tipo: 'telefono',
    porDefecto: null,
    etiqueta: 'Teléfono de la academia',
    unidad: '',
    ayuda: 'De 6 a 20 caracteres: dígitos, espacios, guiones, paréntesis y un + al inicio. Déjalo vacío para quitarlo.',
  },
  yapeNumero: {
    clave: 'yape_numero',
    tipo: 'celular',
    porDefecto: null,
    etiqueta: 'Número de Yape',
    unidad: '',
    ayuda: 'Celular de 9 dígitos al que la persona envía el Yape. Déjalo vacío para no mostrarlo.',
  },
  yapeTitular: {
    clave: 'yape_titular',
    tipo: 'texto',
    porDefecto: null,
    maximo: 80,
    etiqueta: 'Titular del Yape',
    unidad: '',
    ayuda: 'Nombre que aparece en el Yape, para que la persona compruebe que paga al lugar correcto.',
  },
  transferenciaBanco: {
    clave: 'transferencia_banco',
    tipo: 'texto',
    porDefecto: null,
    maximo: 80,
    etiqueta: 'Banco de la transferencia',
    unidad: '',
    ayuda: 'Banco de la cuenta que recibe las transferencias.',
  },
  transferenciaCuenta: {
    clave: 'transferencia_cuenta',
    tipo: 'texto',
    porDefecto: null,
    maximo: 40,
    etiqueta: 'Número de cuenta',
    unidad: '',
    ayuda: 'Número de la cuenta que recibe las transferencias.',
  },
  transferenciaCci: {
    clave: 'transferencia_cci',
    tipo: 'texto',
    porDefecto: null,
    maximo: 40,
    etiqueta: 'CCI',
    unidad: '',
    ayuda: 'Código de cuenta interbancario, para transferencias desde otro banco.',
  },
  transferenciaTitular: {
    clave: 'transferencia_titular',
    tipo: 'texto',
    porDefecto: null,
    maximo: 80,
    etiqueta: 'Titular de la cuenta',
    unidad: '',
    ayuda: 'Nombre del titular de la cuenta que recibe las transferencias.',
  },
} as const satisfies Record<
  CampoConfiguracion | CampoDatoDePago,
  DefinicionEntera | DefinicionTelefono | DefinicionDatoDePago
>;

/** Valores por defecto de cada campo (criterio 1). */
export const CONFIGURACION_POR_DEFECTO: Readonly<ConfiguracionAcademia> = {
  toleranciaTardanzaMinutos: CLAVES_CONFIGURACION.toleranciaTardanzaMinutos.porDefecto,
  diasPorVencer: CLAVES_CONFIGURACION.diasPorVencer.porDefecto,
  diasPrioridadRenovacion: CLAVES_CONFIGURACION.diasPrioridadRenovacion.porDefecto,
  intentosInicioSesion: CLAVES_CONFIGURACION.intentosInicioSesion.porDefecto,
  minutosBloqueo: CLAVES_CONFIGURACION.minutosBloqueo.porDefecto,
  telefono: CLAVES_CONFIGURACION.telefono.porDefecto,
};

/** Límites inclusivos de los campos enteros. */
export const LIMITES_CONFIGURACION: Readonly<Record<CampoEnteroConfiguracion, { minimo: number; maximo: number }>> = {
  toleranciaTardanzaMinutos: {
    minimo: CLAVES_CONFIGURACION.toleranciaTardanzaMinutos.minimo,
    maximo: CLAVES_CONFIGURACION.toleranciaTardanzaMinutos.maximo,
  },
  diasPorVencer: {
    minimo: CLAVES_CONFIGURACION.diasPorVencer.minimo,
    maximo: CLAVES_CONFIGURACION.diasPorVencer.maximo,
  },
  diasPrioridadRenovacion: {
    minimo: CLAVES_CONFIGURACION.diasPrioridadRenovacion.minimo,
    maximo: CLAVES_CONFIGURACION.diasPrioridadRenovacion.maximo,
  },
  intentosInicioSesion: {
    minimo: CLAVES_CONFIGURACION.intentosInicioSesion.minimo,
    maximo: CLAVES_CONFIGURACION.intentosInicioSesion.maximo,
  },
  minutosBloqueo: {
    minimo: CLAVES_CONFIGURACION.minutosBloqueo.minimo,
    maximo: CLAVES_CONFIGURACION.minutosBloqueo.maximo,
  },
};

/** Mínimo y máximo de caracteres del teléfono, y de dígitos que debe traer (criterio 10). */
export const TELEFONO_MINIMO = 6;
export const TELEFONO_MAXIMO = 20;
export const TELEFONO_DIGITOS_MINIMOS = 6;

const PATRON_TELEFONO = /^\+?[0-9 ()-]+$/;

/**
 * Entero dentro del rango de la tabla. Estricto: un texto con dígitos, un decimal, un booleano o `null` no se convierten. `-0` se
 * lee como `0` para que no se guarde ni se audite como `-0`.
 */
function enteroDe(campo: CampoEnteroConfiguracion) {
  const { minimo, maximo } = LIMITES_CONFIGURACION[campo];
  const unidad = CLAVES_CONFIGURACION[campo].unidad;
  return z
    .number('Debe ser un número entero.')
    .int('Debe ser un número entero.')
    .min(minimo, `Debe ser como mínimo ${minimo} ${unidad}.`)
    .max(maximo, `Debe ser como máximo ${maximo} ${unidad}.`)
    .transform((valor) => (Object.is(valor, -0) ? 0 : valor));
}

/**
 * Teléfono de la academia (criterio 10): se recorta; de 6 a 20 caracteres con solo dígitos `0-9`, espacios, guiones, paréntesis y un
 * `+` opcional al inicio, con al menos 6 dígitos y sin caracteres de control.
 */
export const telefonoAcademiaSchema = sinControles(
  z
    .string('El teléfono debe ser un texto.')
    .trim()
    .min(TELEFONO_MINIMO, `El teléfono debe tener al menos ${TELEFONO_MINIMO} caracteres.`)
    .max(TELEFONO_MAXIMO, `El teléfono debe tener como máximo ${TELEFONO_MAXIMO} caracteres.`),
  'El teléfono no puede contener caracteres de control ni caracteres no válidos.',
)
  .regex(PATRON_TELEFONO, 'El teléfono solo puede tener dígitos, espacios, guiones, paréntesis y un + al inicio.')
  .refine((valor) => (valor.match(/[0-9]/g) ?? []).length >= TELEFONO_DIGITOS_MINIMOS, {
    message: `El teléfono debe tener al menos ${TELEFONO_DIGITOS_MINIMOS} dígitos.`,
  });

/** Un dato de pago de texto (007b, criterio 53): recortado, de 1 al máximo de su definición, sin controles ni caracteres de dirección. */
function textoDePago(
  campo: 'yapeTitular' | 'transferenciaBanco' | 'transferenciaCuenta' | 'transferenciaCci' | 'transferenciaTitular',
) {
  const definicion = CLAVES_CONFIGURACION[campo];
  return textoVisibleSchema({ sujeto: definicion.etiqueta, min: 1, max: definicion.maximo, visibles: 1 });
}

/** Los esquemas de cada dato de pago, sin `nullable` ni `optional`. */
const ESQUEMAS_DATOS_DE_PAGO = {
  yapeNumero: telefonoCelularSchema,
  yapeTitular: textoDePago('yapeTitular'),
  transferenciaBanco: textoDePago('transferenciaBanco'),
  transferenciaCuenta: textoDePago('transferenciaCuenta'),
  transferenciaCci: textoDePago('transferenciaCci'),
  transferenciaTitular: textoDePago('transferenciaTitular'),
} as const;

/**
 * Los datos de pago de una academia (007b, criterio 53), todos opcionales: la respuesta de la configuración solo trae los que tienen valor, y
 * la consulta del seguimiento los devuelve así en `academia.datosDePago` cuando la solicitud espera el pago. Un celular son 9 dígitos que
 * empiezan con 9.
 */
export const datosDePagoSchema = z.strictObject({
  yapeNumero: ESQUEMAS_DATOS_DE_PAGO.yapeNumero.optional(),
  yapeTitular: ESQUEMAS_DATOS_DE_PAGO.yapeTitular.optional(),
  transferenciaBanco: ESQUEMAS_DATOS_DE_PAGO.transferenciaBanco.optional(),
  transferenciaCuenta: ESQUEMAS_DATOS_DE_PAGO.transferenciaCuenta.optional(),
  transferenciaCci: ESQUEMAS_DATOS_DE_PAGO.transferenciaCci.optional(),
  transferenciaTitular: ESQUEMAS_DATOS_DE_PAGO.transferenciaTitular.optional(),
});
export type DatosDePago = z.infer<typeof datosDePagoSchema>;

/**
 * Los valores efectivos de una academia: los seis de siempre, todos presentes, y los datos de pago solo si tienen valor (007b: la respuesta
 * no trae una clave `yapeNumero: null`; así una lectura sin datos de pago es la misma de antes de la 007b).
 */
export const configuracionAcademiaSchema = z.strictObject({
  toleranciaTardanzaMinutos: enteroDe('toleranciaTardanzaMinutos'),
  diasPorVencer: enteroDe('diasPorVencer'),
  diasPrioridadRenovacion: enteroDe('diasPrioridadRenovacion'),
  intentosInicioSesion: enteroDe('intentosInicioSesion'),
  minutosBloqueo: enteroDe('minutosBloqueo'),
  telefono: telefonoAcademiaSchema.nullable(),
  ...datosDePagoSchema.shape,
});
export type ConfiguracionAcademia = z.infer<typeof configuracionAcademiaSchema>;

/**
 * `PATCH /api/configuracion`: los campos son opcionales y debe venir al menos uno. Estricto: un campo que no es del contrato (por
 * ejemplo `academiaId`, `nombre` o `logo`) es un 400. `telefono: null` quita el teléfono; `null` en un dato de pago también lo quita (007b).
 */
export const actualizarConfiguracionSchema = z
  .strictObject({
    toleranciaTardanzaMinutos: enteroDe('toleranciaTardanzaMinutos').optional(),
    diasPorVencer: enteroDe('diasPorVencer').optional(),
    diasPrioridadRenovacion: enteroDe('diasPrioridadRenovacion').optional(),
    intentosInicioSesion: enteroDe('intentosInicioSesion').optional(),
    minutosBloqueo: enteroDe('minutosBloqueo').optional(),
    telefono: telefonoAcademiaSchema.nullable().optional(),
    yapeNumero: ESQUEMAS_DATOS_DE_PAGO.yapeNumero.nullable().optional(),
    yapeTitular: ESQUEMAS_DATOS_DE_PAGO.yapeTitular.nullable().optional(),
    transferenciaBanco: ESQUEMAS_DATOS_DE_PAGO.transferenciaBanco.nullable().optional(),
    transferenciaCuenta: ESQUEMAS_DATOS_DE_PAGO.transferenciaCuenta.nullable().optional(),
    transferenciaCci: ESQUEMAS_DATOS_DE_PAGO.transferenciaCci.nullable().optional(),
    transferenciaTitular: ESQUEMAS_DATOS_DE_PAGO.transferenciaTitular.nullable().optional(),
  })
  .refine((cuerpo) => Object.values(cuerpo).some((valor) => valor !== undefined), {
    message: 'Envía al menos un campo de la configuración.',
  });
export type ActualizarConfiguracion = z.infer<typeof actualizarConfiguracionSchema>;

/** `GET` y `PATCH /api/configuracion`. */
export const respuestaConfiguracionSchema = z.strictObject({ configuracion: configuracionAcademiaSchema });
export type RespuestaConfiguracion = z.infer<typeof respuestaConfiguracionSchema>;

/** `GET /api/mi-academia` (D-22): la identidad de la academia de la sesión. */
export const respuestaMiAcademiaSchema = z.strictObject({
  academia: z.strictObject({
    nombre: z.string(),
    nombreCorto: z.string(),
    telefono: z.string().nullable(),
  }),
});
export type RespuestaMiAcademia = z.infer<typeof respuestaMiAcademiaSchema>;
