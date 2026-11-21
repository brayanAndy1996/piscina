import { z } from 'zod';
import { diaSemanaSchema, horaBloqueSchema, nivelNatacionSchema } from './horario';
import { clasePublicaSchema } from './inscripcion';
import { textoVisibleSchema } from './texto';

/**
 * Seguimiento de la solicitud de inscripción (spec 005, criterios 29 a 32; D-05, D-27). El cliente sigue su solicitud con un enlace
 * secreto (el token) o con el código y su DNI. Lo que ve es una vista mínima: nunca datos personales ni médicos (RNF-05, Ley 29733).
 */

/**
 * Alfabeto de Crockford: los dígitos y las letras sin I, L, O ni U (para no confundirlas con 1, 0 y V al leer el código).
 * Cada carácter del código sale de aquí.
 */
export const ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Largo de cada parte del código `AQ-XXXXXX` y del token (32 bytes en base64url sin relleno). */
export const LARGO_CODIGO = 6;
export const LARGO_TOKEN = 43;
/** Los textos de la consulta no pasan de este largo; el formato lo comprueba el servicio y, si no cumple, responde el 404 único. */
export const LARGO_MAXIMO_CONSULTA = 100;

export const PATRON_CODIGO = /^AQ-[0-9A-HJKMNP-TV-Z]{6}$/;
export const PATRON_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Código de una solicitud: `AQ-` y 6 caracteres del alfabeto de Crockford en mayúsculas. Se recorta y se pasa a mayúsculas antes de validar. */
export const codigoSolicitudSchema = z
  .string('El código debe ser un texto.')
  .trim()
  .toUpperCase()
  .regex(PATRON_CODIGO, 'El código debe tener el formato AQ-XXXXXX.');

/** Token de seguimiento: 43 caracteres base64url (32 bytes). Sin recortar: un espacio es error. */
export const tokenSeguimientoSchema = z
  .string('El enlace de seguimiento no es válido.')
  .regex(PATRON_TOKEN, 'El enlace de seguimiento no es válido.');

/**
 * `POST /api/a/{nombreCorto}/solicitudes/consulta`: `{ token }` o `{ codigo, dni }`, estrictos (los dos juntos, ninguno o un campo de más es
 * un 400). Cada dato es un texto de hasta 100 caracteres: el formato del token, del código y del DNI lo comprueba el servicio y, si no
 * se cumple, responde el mismo 404 de una solicitud que no existe (criterio 31), para no distinguir lo que existe de lo que no.
 */
export const consultarSolicitudSchema = z.union([
  z.strictObject({ token: z.string('El token debe ser un texto.').max(LARGO_MAXIMO_CONSULTA) }),
  z.strictObject({
    codigo: z.string('El código debe ser un texto.').max(LARGO_MAXIMO_CONSULTA),
    dni: z.string('El DNI debe ser un texto.').max(LARGO_MAXIMO_CONSULTA),
  }),
]);
export type ConsultarSolicitud = z.infer<typeof consultarSolicitudSchema>;

/** Estados que ve el cliente; la 007 suma los suyos. `VENCIDA` se calcula al leer cuando la reserva ya venció (criterio 20). */
export const ESTADOS_SOLICITUD = ['PENDIENTE_PAGO', 'VENCIDA', 'CANCELADA'] as const;
export const estadoSolicitudSchema = z.enum(ESTADOS_SOLICITUD);
export type EstadoSolicitud = z.infer<typeof estadoSolicitudSchema>;

/** Los campos que lleva toda vista de seguimiento: los de la solicitud y su matrícula, nunca datos de la persona. */
const baseVistaSolicitud = {
  codigo: z.string(),
  creadaEn: z.iso.datetime(),
  plan: z.strictObject({ nombre: z.string() }),
  clases: z.array(clasePublicaSchema.pick({ nivel: true, diaSemana: true, horaInicio: true, horaFin: true })),
  mes: z.string(),
  clasesTotales: z.number().int(),
  monto: z.string(),
  esProporcional: z.boolean(),
};

/**
 * Vista completa: la solicitud es la vigente del cliente y espera el pago (`PENDIENTE_PAGO`). Lleva el primer nombre de pila (DR-9),
 * si ya subió su foto y, mientras la reserva corre, cuándo vence (sin vencimiento si el pago ya está en verificación, historia 007).
 */
export const vistaSolicitudCompletaSchema = z.strictObject({
  ...baseVistaSolicitud,
  estado: z.literal('PENDIENTE_PAGO'),
  reservaVenceEn: z.iso.datetime().optional(),
  nombres: z.string(),
  fotoCargada: z.boolean(),
});

/**
 * Vista reducida (criterio 58, DR-14): una solicitud `VENCIDA` o `CANCELADA` ya no es la vigente del cliente, así que no muestra el
 * nombre, la foto ni el vencimiento: las claves `nombres`, `fotoCargada` y `reservaVenceEn` no existen (P3).
 */
export const vistaSolicitudReducidaSchema = z.strictObject({
  ...baseVistaSolicitud,
  estado: z.enum(['VENCIDA', 'CANCELADA']),
});

/**
 * Lo que muestra el enlace de seguimiento (criterios 32 y 58, DR-9, DR-14): una unión estricta por estado. Nunca el DNI, los apellidos, la
 * fecha de nacimiento, el teléfono, el correo, la dirección, los datos médicos, el apoderado, los consentimientos, la foto, los ids
 * internos ni el hash del token. La 007 suma sus estados a una de las dos ramas.
 */
export const vistaSolicitudSchema = z.discriminatedUnion('estado', [
  vistaSolicitudCompletaSchema,
  vistaSolicitudReducidaSchema,
]);
export type VistaSolicitudCompleta = z.infer<typeof vistaSolicitudCompletaSchema>;
export type VistaSolicitudReducida = z.infer<typeof vistaSolicitudReducidaSchema>;
export type VistaSolicitud = z.infer<typeof vistaSolicitudSchema>;

export const respuestaConsultaSolicitudSchema = z.strictObject({
  solicitud: vistaSolicitudSchema,
  academia: z.strictObject({ nombre: z.string(), telefono: z.string().nullable() }),
});
export type RespuestaConsultaSolicitud = z.infer<typeof respuestaConsultaSolicitudSchema>;

/**
 * Panel de solicitudes de inscripción (spec 005b, criterios 38 y 39; PB11 y PB12). Lo ven `ADMIN` y `SECRETARIA`: lleva datos de contacto
 * del alumno, pero nunca datos médicos, apoderado, consentimientos, foto, IP ni token.
 */

/** Filtro de `GET /api/solicitudes?estado=` (por estado visible): `ACTIVAS` si falta; cualquier otro valor, o un arreglo, es un error. */
export const FILTROS_ESTADO_SOLICITUDES = ['ACTIVAS', 'VENCIDAS', 'CANCELADAS', 'TODAS'] as const;
export const filtroEstadoSolicitudesSchema = z
  .enum(FILTROS_ESTADO_SOLICITUDES, 'El estado debe ser ACTIVAS, VENCIDAS, CANCELADAS o TODAS.')
  .default('ACTIVAS');
export type FiltroEstadoSolicitudes = z.infer<typeof filtroEstadoSolicitudesSchema>;

/**
 * La consulta de `GET /api/solicitudes`: solo se lee `estado`; los demás parámetros se ignoran (`?academiaId=` no cambia de academia). La
 * API arma `{ estado }` con `undefined` si no viene, el texto si viene una vez y un arreglo si se repite o se escribe como `estado[]=…`
 * (que es un error).
 */
export const consultaListaSolicitudesSchema = z.object({ estado: filtroEstadoSolicitudesSchema });
export type ConsultaListaSolicitudes = z.infer<typeof consultaListaSolicitudesSchema>;

/** Cada solicitud de la lista, con las claves exactas del criterio 38 (estricto). */
export const solicitudPanelSchema = z.strictObject({
  id: z.uuid(),
  codigo: z.string(),
  estado: estadoSolicitudSchema,
  creadaEn: z.iso.datetime(),
  /** ISO si el estado visible es `PENDIENTE_PAGO` y la matrícula tiene vencimiento; si no, `null`. */
  reservaVenceEn: z.iso.datetime().nullable(),
  nombres: z.string(),
  apellidos: z.string(),
  dni: z.string(),
  telefono: z.string(),
  menorDeEdad: z.boolean(),
  plan: z.strictObject({ id: z.uuid(), nombre: z.string() }),
  clases: z.array(
    z.strictObject({
      id: z.uuid(),
      nivel: nivelNatacionSchema,
      diaSemana: diaSemanaSchema,
      horaInicio: horaBloqueSchema,
      horaFin: z.string(),
    }),
  ),
  /** `AAAA-MM`. */
  mes: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'El mes debe tener el formato AAAA-MM.'),
  clasesTotales: z.number().int().min(0),
  /** Texto con dos decimales (el ajustado si lo hay, si no el calculado). */
  monto: z.string().regex(/^[0-9]+\.[0-9]{2}$/, 'El monto debe ser un texto con dos decimales.'),
});
export type SolicitudPanel = z.infer<typeof solicitudPanelSchema>;

export const respuestaListaSolicitudesSchema = z.strictObject({ solicitudes: z.array(solicitudPanelSchema) });
export type RespuestaListaSolicitudes = z.infer<typeof respuestaListaSolicitudesSchema>;

/** Respuesta de la cancelación: la solicitud ya con `estado: 'CANCELADA'` y `reservaVenceEn: null`. */
export const respuestaSolicitudPanelSchema = z.strictObject({ solicitud: solicitudPanelSchema });
export type RespuestaSolicitudPanel = z.infer<typeof respuestaSolicitudPanelSchema>;

/** `POST /api/solicitudes/{id}/cancelar`: estricto; el motivo de 3 a 200 caracteres visibles, recortado. */
export const cancelarSolicitudSchema = z.strictObject({
  motivo: textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 }),
});
export type CancelarSolicitud = z.infer<typeof cancelarSolicitudSchema>;
