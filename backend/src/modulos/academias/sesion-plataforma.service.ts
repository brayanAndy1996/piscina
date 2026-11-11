import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { fechaDeBaseONula } from '../../comun/fechas';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import {
  leerCookie,
  NOMBRE_COOKIE_PLATAFORMA,
  obtenerHashFicticio,
  ServicioTokens,
  verificarClave,
} from '../../infraestructura/seguridad';
import { estaBloqueado, evaluarIntentoFallido, REGLAS_BLOQUEO_SUPERADMIN } from './dominio/bloqueo';
import { DURACION_SESION_PLATAFORMA_SEGUNDOS, TIPO_TOKEN_PLATAFORMA, type SuperadminAutenticado } from './tipos';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noAutenticado(): ErrorNegocio {
  return new ErrorNegocio(401, 'NO_AUTENTICADO', 'Debes iniciar sesión para continuar.');
}

function credencialesInvalidas(): ErrorNegocio {
  return new ErrorNegocio(401, 'CREDENCIALES_INVALIDAS', 'El correo o la contraseña no son correctos.');
}

function cuentaBloqueada(): ErrorNegocio {
  return new ErrorNegocio(
    423,
    'CUENTA_BLOQUEADA',
    `La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en ${REGLAS_BLOQUEO_SUPERADMIN.minutosBloqueo} minutos.`,
  );
}

interface FilaSuperadmin {
  id: string;
  correo: string;
  nombre: string;
  clave_hash: string;
  version_token: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
}

interface FilaSesion {
  id: string;
  correo: string;
  nombre: string;
  version_token: number;
}

/** El superadmin de una sesión verificada, con la versión de token que traía. */
interface SesionVerificada extends SuperadminAutenticado {
  readonly versionToken: number;
}

/** Resultado de una operación de inicio de sesión que ya se confirmó en la base. */
type ResultadoAcierto = { tipo: 'ACIERTO'; superadmin: FilaSesion } | { tipo: 'BLOQUEADA' } | { tipo: 'DESAPARECIDO' };
type ResultadoFallo = { tipo: 'FALLO' } | { tipo: 'BLOQUEADA' } | { tipo: 'DESAPARECIDO' };

/**
 * Sesión del Superadmin (D-29, spec 001): inicio de sesión con bloqueo por intentos fallidos, verificación de la
 * cookie `aq_plataforma` y cierre de sesión. Todo corre como plataforma (`comoPlataforma`). La clave nunca se escribe
 * en el registro técnico ni en la respuesta.
 */
@Injectable()
export class SesionPlataformaService {
  /** Evita repetir la consulta cuando el middleware del prefijo y el guard autentican la misma petición. */
  private readonly autenticadas = new WeakMap<object, Promise<SesionVerificada>>();

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly tokens: ServicioTokens,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(SesionPlataformaService.name);
    // Se calcula una vez por proceso, antes de la primera petición con un correo desconocido.
    obtenerHashFicticio().catch(() => undefined);
  }

  /**
   * Inicia la sesión. Con credenciales correctas devuelve el superadmin y el token firmado; si no, lanza 401
   * `CREDENCIALES_INVALIDAS` (el mismo error con un correo inexistente o una clave equivocada) o 423 `CUENTA_BLOQUEADA`.
   * El contador de fallos se actualiza de forma atómica (bloqueando la fila), así que los intentos simultáneos no
   * pierden incrementos.
   */
  async iniciarSesion(
    correo: string,
    clave: string,
    ip: string | null,
  ): Promise<{ superadmin: SuperadminAutenticado; token: string }> {
    const fila = await this.buscarPorCorreo(correo);
    if (!fila) {
      // Mismo trabajo que con un correo real, para que el tiempo de respuesta no delate si el correo existe.
      await verificarClave(await obtenerHashFicticio(), clave);
      this.registro.warn({ ip }, 'Inicio de sesión de plataforma rechazado: credenciales inválidas');
      throw credencialesInvalidas();
    }
    // Falla cerrada (criterio 108): una fecha inválida de la fila no autoriza nada; el filtro responde 500 `ERROR_INTERNO`.
    const bloqueadoHasta = fechaDeBaseONula(fila.bloqueado_hasta);
    fechaDeBaseONula(fila.ultimo_acceso);
    if (estaBloqueado({ intentosFallidos: fila.intentos_fallidos, bloqueadoHasta }, this.reloj.ahora())) {
      this.registro.warn({ superadminId: fila.id, ip }, 'Inicio de sesión de plataforma rechazado: cuenta bloqueada');
      throw cuentaBloqueada();
    }

    // El hash tarda decenas de milisegundos: se calcula fuera de la transacción para no retener la conexión.
    const correcta = await verificarClave(fila.clave_hash, clave);
    if (!correcta) return this.rechazarIntento(fila.id, ip);
    return this.aceptarIntento(fila.id, ip);
  }

  /**
   * Devuelve el superadmin de la sesión que trae la petición (solo la cookie `aq_plataforma`; `Authorization` se
   * ignora) o lanza 401 `NO_AUTENTICADO`. Comprueba firma HS256, vencimiento según `RELOJ`, `tipo`, y que `ver` sea
   * la `version_token` actual. El resultado se recuerda para la misma petición.
   */
  autenticar(solicitud: Request): Promise<SesionVerificada> {
    let promesa = this.autenticadas.get(solicitud);
    if (!promesa) {
      promesa = this.verificarSesion(solicitud);
      this.autenticadas.set(solicitud, promesa);
    }
    return promesa;
  }

  /**
   * Cierra la sesión: si la cookie es válida, sube `version_token` y el token anterior deja de valer. Sin sesión
   * válida no cambia nada y no es un error.
   */
  async cerrarSesion(solicitud: Request): Promise<void> {
    let sesion;
    try {
      sesion = await this.autenticar(solicitud);
    } catch (error) {
      if (error instanceof ErrorNegocio && error.estado === 401) return;
      throw error;
    }
    const ahora = this.reloj.ahora();
    await this.baseDatos.comoPlataforma(async (tx) => {
      // Solo si la versión no cambió desde que se verificó: dos cierres simultáneos suben la versión una vez.
      await tx.cliente.$executeRaw`
        UPDATE superadmins
           SET version_token = version_token + 1, actualizado_en = ${ahora}::timestamptz
         WHERE id = ${sesion.id}::uuid AND version_token = ${sesion.versionToken}`;
    });
    this.registro.info({ superadminId: sesion.id }, 'Sesión de plataforma cerrada');
  }

  private async verificarSesion(solicitud: Request): Promise<SesionVerificada> {
    const token = leerCookie(solicitud.headers.cookie, NOMBRE_COOKIE_PLATAFORMA);
    if (!token) throw noAutenticado();
    const claims = this.tokens.verificar(token);
    if (!claims || claims.tipo !== TIPO_TOKEN_PLATAFORMA || !PATRON_UUID.test(claims.sub)) throw noAutenticado();
    const filas = await this.baseDatos.comoPlataforma(
      (tx) =>
        tx.cliente.$queryRaw<FilaSesion[]>`
        SELECT id::text AS id, correo, nombre, version_token FROM superadmins WHERE id = ${claims.sub}::uuid`,
    );
    const fila = filas[0];
    if (!fila || fila.version_token !== claims.ver) throw noAutenticado();
    return { id: fila.id, correo: fila.correo, nombre: fila.nombre, versionToken: fila.version_token };
  }

  private async buscarPorCorreo(correo: string): Promise<FilaSuperadmin | undefined> {
    const filas = await this.baseDatos.comoPlataforma(
      (tx) =>
        tx.cliente.$queryRaw<FilaSuperadmin[]>`
        SELECT id::text AS id, correo, nombre, clave_hash, version_token, intentos_fallidos, bloqueado_hasta,
               ultimo_acceso
          FROM superadmins WHERE correo = ${correo}`,
    );
    return filas[0];
  }

  /** Cuenta un intento fallido bajo el bloqueo de la fila y responde según el resultado, ya confirmado. */
  private async rechazarIntento(id: string, ip: string | null): Promise<never> {
    const resultado = await this.baseDatos.comoPlataforma(async (tx): Promise<ResultadoFallo> => {
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<Pick<FilaSuperadmin, 'intentos_fallidos' | 'bloqueado_hasta'>[]>`
        SELECT intentos_fallidos, bloqueado_hasta FROM superadmins WHERE id = ${id}::uuid FOR UPDATE`;
      const actual = filas[0];
      if (!actual) return { tipo: 'DESAPARECIDO' };
      const evaluacion = evaluarIntentoFallido(
        { intentosFallidos: actual.intentos_fallidos, bloqueadoHasta: fechaDeBaseONula(actual.bloqueado_hasta) },
        ahora,
      );
      if (evaluacion.tipo === 'YA_BLOQUEADA') return { tipo: 'BLOQUEADA' };
      await tx.cliente.$executeRaw`
        UPDATE superadmins
           SET intentos_fallidos = ${evaluacion.estado.intentosFallidos},
               bloqueado_hasta = ${evaluacion.estado.bloqueadoHasta}::timestamptz,
               actualizado_en = ${ahora}::timestamptz
         WHERE id = ${id}::uuid`;
      return evaluacion.bloquea ? { tipo: 'BLOQUEADA' } : { tipo: 'FALLO' };
    });
    if (resultado.tipo === 'BLOQUEADA') {
      this.registro.warn({ superadminId: id, ip }, 'Inicio de sesión de plataforma rechazado: cuenta bloqueada');
      throw cuentaBloqueada();
    }
    this.registro.warn({ superadminId: id, ip }, 'Inicio de sesión de plataforma rechazado: credenciales inválidas');
    throw credencialesInvalidas();
  }

  /** Con la clave correcta: bajo el bloqueo de la fila, vuelve a comprobar que no la bloquearon mientras tanto. */
  private async aceptarIntento(
    id: string,
    ip: string | null,
  ): Promise<{ superadmin: SuperadminAutenticado; token: string }> {
    const resultado = await this.baseDatos.comoPlataforma(async (tx): Promise<ResultadoAcierto> => {
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<
        (FilaSesion & Pick<FilaSuperadmin, 'intentos_fallidos' | 'bloqueado_hasta'>)[]
      >`
        SELECT id::text AS id, correo, nombre, version_token, intentos_fallidos, bloqueado_hasta
          FROM superadmins WHERE id = ${id}::uuid FOR UPDATE`;
      const actual = filas[0];
      if (!actual) return { tipo: 'DESAPARECIDO' };
      const bloqueadoHasta = fechaDeBaseONula(actual.bloqueado_hasta);
      if (estaBloqueado({ intentosFallidos: actual.intentos_fallidos, bloqueadoHasta }, ahora)) {
        return { tipo: 'BLOQUEADA' };
      }
      await tx.cliente.$executeRaw`
        UPDATE superadmins
           SET intentos_fallidos = 0, bloqueado_hasta = NULL,
               ultimo_acceso = ${ahora}::timestamptz, actualizado_en = ${ahora}::timestamptz
         WHERE id = ${id}::uuid`;
      return { tipo: 'ACIERTO', superadmin: actual };
    });
    if (resultado.tipo === 'BLOQUEADA') {
      this.registro.warn({ superadminId: id, ip }, 'Inicio de sesión de plataforma rechazado: cuenta bloqueada');
      throw cuentaBloqueada();
    }
    if (resultado.tipo === 'DESAPARECIDO') throw credencialesInvalidas();
    const { superadmin } = resultado;
    const token = this.tokens.firmar(
      { sub: superadmin.id, tipo: TIPO_TOKEN_PLATAFORMA, ver: superadmin.version_token },
      DURACION_SESION_PLATAFORMA_SEGUNDOS,
    );
    this.registro.info({ superadminId: superadmin.id, ip }, 'Inicio de sesión de plataforma correcto');
    return { superadmin: { id: superadmin.id, correo: superadmin.correo, nombre: superadmin.nombre }, token };
  }
}
