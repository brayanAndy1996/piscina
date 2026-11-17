// spec: 002-autenticacion-roles (pruebas protegidas)
import { crearAcademiaDePrueba } from './academias';
import { cookieDeUsuario, crearUsuarioDePrueba, type RolUsuario, type UsuarioDePrueba } from './usuarios';

/**
 * Sesión de academia válida para las pruebas de la 001 que llaman a rutas `/api` de prueba (spec 002, criterio 18: toda ruta de
 * `/api` que no sea `/salud`, `/plataforma` ni `/a` exige sesión). Crea, con una conexión del dueño, un usuario activo de la
 * academia y devuelve el valor de la cabecera `Cookie` (`aq_sesion=<token>`), firmado sin pasar por el inicio de sesión.
 *
 * Debe llamarse después de `limpiarBase()` (una limpieza borra al usuario). Con la hora real: las aplicaciones de las pruebas de
 * la 001 usan el reloj del sistema. Si no se pasa academia, crea una nueva (activa) y la devuelve junto con la sesión.
 */
export async function sesionDeAcademia(
  academia?: { readonly id: string },
  opciones: { rol?: RolUsuario; ahora?: Date } = {},
): Promise<{ cookie: string; usuario: UsuarioDePrueba; academiaId: string }> {
  const academiaId = academia?.id ?? (await crearAcademiaDePrueba()).id;
  const usuario = await crearUsuarioDePrueba({ academiaId, rol: opciones.rol ?? 'ADMIN' });
  return { cookie: cookieDeUsuario(usuario, opciones.ahora ?? new Date()), usuario, academiaId };
}
