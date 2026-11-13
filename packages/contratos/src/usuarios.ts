import { z } from 'zod';
import { dniSchema } from './sesion';
import { textoVisibleSchema } from './texto';

/** Nombres y apellidos: recortados, de 2 a 100 caracteres visibles, sin controles (como los textos de la spec 001). */
const nombresSchema = textoVisibleSchema({ sujeto: 'El nombre', min: 2, max: 100, visibles: 2 });
const apellidosSchema = textoVisibleSchema({ sujeto: 'El apellido', min: 2, max: 100, visibles: 2 });

/** Roles del personal; los alumnos no se crean aquí (HU-04, historia 007). */
export const rolPersonalSchema = z.enum(['ADMIN', 'SECRETARIA', 'ENTRENADOR']);
export type RolPersonal = z.infer<typeof rolPersonalSchema>;

export const estadoUsuarioSchema = z.enum(['ACTIVO', 'INACTIVO']);
export type EstadoUsuario = z.infer<typeof estadoUsuarioSchema>;

/** `POST /api/usuarios`: la contraseña inicial es el DNI y debe cambiarla al entrar (RN-02); nunca viaja en el cuerpo. */
export const crearUsuarioSchema = z.strictObject({
  dni: dniSchema,
  nombres: nombresSchema,
  apellidos: apellidosSchema,
  rol: rolPersonalSchema,
});
export type CrearUsuario = z.infer<typeof crearUsuarioSchema>;

/** `POST /api/plataforma/academias/{id}/administradores`: el rol es siempre `ADMIN`. */
export const crearAdministradorSchema = z.strictObject({
  dni: dniSchema,
  nombres: nombresSchema,
  apellidos: apellidosSchema,
});
export type CrearAdministrador = z.infer<typeof crearAdministradorSchema>;

/**
 * `POST /api/usuarios/buscar-por-dni`: el DNI va en el cuerpo y no en la dirección (PO-3, Ley 29733). No exige el formato del
 * DNI: el servicio recorta y, si no son 8 dígitos, responde 404 como cuando no existe.
 */
export const buscarUsuarioPorDniSchema = z.strictObject({
  dni: z.string().max(64, 'El DNI es demasiado largo.'),
});
export type BuscarUsuarioPorDni = z.infer<typeof buscarUsuarioPorDniSchema>;

/**
 * Cuerpo vacío de las acciones sobre un usuario (desactivar, reactivar, restablecer): `{}`, o ningún cuerpo. Estricto: un campo de
 * más (por ejemplo `academiaId`) es un 400.
 */
export const cuerpoVacioSchema = z.preprocess((valor) => (valor === undefined ? {} : valor), z.strictObject({}));

/** Un usuario del personal o un alumno tal como lo ve quien gestiona cuentas. `ultimoAcceso` en ISO 8601 UTC. */
export const usuarioResumenSchema = z.strictObject({
  id: z.uuid(),
  dni: z.string(),
  nombres: z.string(),
  apellidos: z.string(),
  rol: z.enum(['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO']),
  estado: estadoUsuarioSchema,
  debeCambiarClave: z.boolean(),
  /** `bloqueado_hasta` es posterior a la hora actual según `RELOJ`. */
  bloqueado: z.boolean(),
  ultimoAcceso: z.iso.datetime().nullable(),
});
export type UsuarioResumen = z.infer<typeof usuarioResumenSchema>;

/** Lo que el Superadmin ve de un administrador: sin rol ni último acceso (D-29). */
export const administradorResumenSchema = usuarioResumenSchema.omit({ rol: true, ultimoAcceso: true });
export type AdministradorResumen = z.infer<typeof administradorResumenSchema>;

export const respuestaUsuarioSchema = z.strictObject({ usuario: usuarioResumenSchema });
export type RespuestaUsuario = z.infer<typeof respuestaUsuarioSchema>;

export const respuestaListaUsuariosSchema = z.strictObject({ usuarios: z.array(usuarioResumenSchema) });
export type RespuestaListaUsuarios = z.infer<typeof respuestaListaUsuariosSchema>;

export const respuestaAdministradorSchema = z.strictObject({ administrador: administradorResumenSchema });
export type RespuestaAdministrador = z.infer<typeof respuestaAdministradorSchema>;

export const respuestaListaAdministradoresSchema = z.strictObject({
  administradores: z.array(administradorResumenSchema),
});
export type RespuestaListaAdministradores = z.infer<typeof respuestaListaAdministradoresSchema>;
