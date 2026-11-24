// spec: 006-caja (pruebas protegidas)
import { leerAuditoriaDeAcademia } from './datos';
import { ejecutarComo } from './base-datos';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from './academias';
import { cerrarCajaDePrueba, crearCajaDePrueba, enLima, HOY, instantaneaDeCaja, type CajaDePrueba } from './caja';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  instantaneaDeUsuarios,
  type RolUsuario,
  type UsuarioDePrueba,
} from './usuarios';

/**
 * Utilidades de las pruebas protegidas de los criterios 51 a 53 de la 006b (ronda adversarial 2): más academias (C y D) y más personas con
 * `VER_REPORTES_FINANCIEROS` que las del escenario de la 006a (A y B), cajas cerradas para descargar y una caja muy grande. Todo se crea como dueño
 * de las tablas, con sembradores de las utilidades de la 006a (`caja.ts`) y de la 002 (`usuarios.ts`).
 */

export interface PersonaConCookie {
  usuario: UsuarioDePrueba;
  /** El valor de la cabecera `Cookie` de una sesión válida en `AHORA_PRUEBAS`. */
  cookie: string;
}

/** Crea una persona de la academia (clave `CLAVE_COMUN`, sin cambio pendiente) y su cookie de sesión. */
export async function crearPersonaConCookie(
  academiaId: string,
  rol: RolUsuario,
  nombres = 'Persona',
  apellidos = 'Adicional',
  ahora: Date = AHORA_PRUEBAS,
): Promise<PersonaConCookie> {
  const usuario = await crearUsuarioDePrueba({ academiaId, rol, clave: CLAVE_COMUN, nombres, apellidos });
  return { usuario, cookie: cookieDeUsuario(usuario, ahora) };
}

/**
 * La cookie de sesión de una persona con un vencimiento mucho más lejano que el de siempre (sirve para una descarga que debe seguir válida aunque la
 * prueba adelante `RELOJ` más allá del vencimiento de las demás).
 */
export function cookieDeLargaDuracion(usuario: UsuarioDePrueba, ahora: Date = AHORA_PRUEBAS): string {
  const iat = Math.floor(ahora.getTime() / 1000);
  return cookieDeUsuario(usuario, ahora, { exp: iat + 7 * 24 * 3600 });
}

export interface AcademiaConPersonas {
  academia: AcademiaDePrueba;
  personas: PersonaConCookie[];
}

/** Crea una academia activa y una persona por cada rol de `roles` (en ese orden). */
export async function crearAcademiaConPersonas(
  nombreCorto: string,
  nombre: string,
  roles: readonly RolUsuario[],
): Promise<AcademiaConPersonas> {
  const academia = await crearAcademiaDePrueba({ nombre, nombreCorto });
  const personas: PersonaConCookie[] = [];
  for (const [i, rol] of roles.entries()) {
    personas.push(
      await crearPersonaConCookie(academia.id, rol, `${rol === 'ADMIN' ? 'Admin' : 'Secre'}${i + 1}`, nombre),
    );
  }
  return { academia, personas };
}

/** La caja de hoy de una academia, abierta por `abiertaPor` y ya cerrada (cierre 1) por `cerradoPor` a las 09:50 de Lima. */
export async function crearCajaDeHoyCerrada(
  academiaId: string,
  abiertaPor: string,
  cerradoPor: string,
  montoInicial = '50.00',
): Promise<CajaDePrueba> {
  const caja = await crearCajaDePrueba(academiaId, abiertaPor, { monto_inicial: montoInicial });
  await cerrarCajaDePrueba(academiaId, caja.id, cerradoPor, { cerradoEn: enLima(HOY, '09:50:00') });
  return caja;
}

/** La fecha `AAAA-MM-DD` de `dias` días después del 1 de octubre de 2026 (siempre antes de `HOY`). */
export function fechaDeOctubre(dias: number): string {
  const fecha = new Date(Date.UTC(2026, 9, 1 + dias));
  return fecha.toISOString().slice(0, 10);
}

/**
 * Crea `cantidad` cajas cerradas de días anteriores (del 1 de octubre de 2026 en adelante, una por día), abiertas por `abiertaPor` y cerradas por
 * `cerradoPor` (cierre 1). Cada una tiene una fecha distinta, así que sus PDF se distinguen por `datos.caja.id` y `datos.caja.fecha`.
 */
export async function crearCajasCerradas(
  academiaId: string,
  abiertaPor: string,
  cerradoPor: string,
  cantidad: number,
): Promise<CajaDePrueba[]> {
  const cajas: CajaDePrueba[] = [];
  for (let i = 0; i < cantidad; i += 1) {
    const fecha = fechaDeOctubre(i);
    const caja = await crearCajaDePrueba(academiaId, abiertaPor, { fecha, monto_inicial: '100.00' });
    await cerrarCajaDePrueba(academiaId, caja.id, cerradoPor, { cerradoEn: enLima(fecha, '18:00:00') });
    cajas.push(caja);
  }
  return cajas;
}

/**
 * Crea `cantidad` egresos de S/ 1.00 en una caja abierta, como dueño de las tablas y en una sola sentencia (sin un `INSERT` por fila): el número va de
 * 1 a `cantidad`, la descripción es `Gasto 00001` y el comprobante, `B001-00001`.
 */
export async function crearMovimientosMasivos(
  academiaId: string,
  cajaId: string,
  registradoPor: string,
  cantidad: number,
  fecha: string,
): Promise<void> {
  await ejecutarComo(
    'propietario',
    `INSERT INTO movimientos_caja (academia_id, caja_id, numero, tipo, concepto, metodo, monto, descripcion, comprobante,
                                   registrado_por, registrado_en, clave_idempotencia)
     SELECT $1::uuid, $2::uuid, n, 'EGRESO'::tipo_movimiento_caja, 'EGRESO_MENOR'::concepto_movimiento_caja, 'EFECTIVO'::metodo_pago,
            1.00, 'Gasto ' || lpad(n::text, 5, '0'), 'B001-' || lpad(n::text, 5, '0'), $3::uuid,
            $4::timestamptz + n * interval '1 second', gen_random_uuid()
       FROM generate_series(1, $5::int) AS n`,
    [academiaId, cajaId, registradoPor, enLima(fecha, '09:30'), cantidad],
    { academiaId },
  );
}

/** Cambia el nombre de una academia como dueño (contexto de plataforma). */
export async function renombrarAcademia(academiaId: string, nombre: string): Promise<void> {
  await ejecutarComo('propietario', 'UPDATE academias SET nombre = $2 WHERE id = $1::uuid', [academiaId, nombre], {
    plataforma: true,
  });
}

/**
 * Todo lo que una operación sin escritura no debe cambiar en las academias dadas: las filas de `cajas`, `movimientos_caja` y `cierres_caja` y la
 * auditoría. Con `incluirUsuarios`, también las filas de `usuarios` (para las pruebas que cambian a una persona y no deben cambiar nada más).
 */
export async function fotoDeEscrituras(
  academiaIds: readonly string[],
  opciones: { incluirUsuarios?: boolean } = {},
): Promise<Record<string, string>> {
  const foto: Record<string, string> = {};
  for (const id of academiaIds) {
    foto[`caja:${id}`] = await instantaneaDeCaja(id);
    foto[`auditoria:${id}`] = JSON.stringify(await leerAuditoriaDeAcademia(id));
    if (opciones.incluirUsuarios) foto[`usuarios:${id}`] = await instantaneaDeUsuarios(id);
  }
  return foto;
}
