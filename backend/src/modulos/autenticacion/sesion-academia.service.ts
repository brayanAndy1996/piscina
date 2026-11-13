import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { CambiarClave, RespuestaSesionAcademia, RolUsuario } from '@aquagestion/contratos';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { fechaDeBaseONula } from '../../comun/fechas';
import { MENSAJE_SOLICITUD_INVALIDA } from '../../comun/validacion';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import {
  type AcademiaResuelta,
  BaseDatos,
  ErrorAcademiaNoEncontrada,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import {
  hashearClave,
  leerCookie,
  NOMBRE_COOKIE_ACADEMIA,
  obtenerHashFicticio,
  ServicioTokens,
  verificarClave,
} from '../../infraestructura/seguridad';
import { AuditoriaService } from '../auditoria';
import { estaBloqueado, evaluarIntentoFallido } from '../academias/dominio/bloqueo';
import { bloquearActorVigente, noAutenticado } from './actor-vigente';
import { duracionSesionSegundos } from './dominio/duracion-sesion';
import { REGLAS_BLOQUEO_USUARIO } from './dominio/reglas-bloqueo';
import { type SesionVerificada, TIPO_TOKEN_ACADEMIA } from './tipos';

function credencialesInvalidas(): ErrorNegocio {
  return new ErrorNegocio(401, 'CREDENCIALES_INVALIDAS', 'El DNI o la contraseña no son correctos.');
}

function cuentaBloqueada(): ErrorNegocio {
  return new ErrorNegocio(
    423,
    'CUENTA_BLOQUEADA',
    `La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en ${REGLAS_BLOQUEO_USUARIO.minutosBloqueo} minutos.`,
  );
}

function usuarioInactivo(): ErrorNegocio {
  return new ErrorNegocio(403, 'USUARIO_INACTIVO', 'Tu cuenta está desactivada. Consulta en recepción.');
}

function claveActualIncorrecta(): ErrorNegocio {
  return new ErrorNegocio(400, 'CLAVE_ACTUAL_INCORRECTA', 'La contraseña actual no es correcta.');
}

/** 400 `SOLICITUD_INVALIDA` por la contraseña nueva (criterio 23): el campo es `claveNueva`, como el de la validación del esquema. */
function claveNuevaInvalida(mensaje: string): ErrorNegocio {
  return new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, {
    errores: [{ campo: 'claveNueva', mensaje }],
  });
}

interface FilaIngreso {
  id: string;
  nombres: string;
  apellidos: string;
  rol: RolUsuario;
  estado: 'ACTIVO' | 'INACTIVO';
  clave_hash: string;
  debe_cambiar_clave: boolean;
  version_token: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
}

interface FilaSesion {
  id: string;
  nombres: string;
  apellidos: string;
  rol: RolUsuario;
  estado: 'ACTIVO' | 'INACTIVO';
  debe_cambiar_clave: boolean;
  version_token: number;
  academia_nombre: string;
  academia_nombre_corto: string;
}

interface FilaCambio extends FilaIngreso {
  dni: string;
}

/** Lo que se leyó de la fila para verificar la clave: la operación solo vale si sigue siendo lo vigente (criterio 120 de 001). */
interface ClaveVerificada {
  readonly claveHash: string;
  readonly versionToken: number;
}

type ResultadoFallo = { tipo: 'FALLO' } | { tipo: 'BLOQUEADA' } | { tipo: 'DESAPARECIDO' };
type ResultadoAcierto =
  | { tipo: 'ACIERTO'; fila: FilaIngreso }
  | { tipo: 'BLOQUEADA' }
  | { tipo: 'INACTIVO' }
  | { tipo: 'DESAPARECIDO' }
  | { tipo: 'CAMBIADA' };

/** Una sesión iniciada o renovada: lo que responde la ruta y lo que va en la cookie. */
export interface SesionEmitida {
  readonly respuesta: RespuestaSesionAcademia;
  readonly token: string;
  readonly duracionSegundos: number;
}

/**
 * Sesión de los usuarios de una academia (spec 002): ingreso con bloqueo por intentos fallidos, verificación de la cookie
 * `aq_sesion` en cada petición, cierre de sesión y cambio de la propia contraseña. Todo corre con `conAcademia(<academia de la
 * sesión>, …)`: la academia nunca viene de la dirección ni del cuerpo (criterio 20). Ni la clave ni el DNI escrito ni el token
 * llegan al registro técnico (criterio 43).
 */
@Injectable()
export class SesionAcademiaService {
  /** Evita repetir la consulta cuando el middleware y el manejador autentican la misma petición. Nunca guarda nada entre peticiones. */
  private readonly autenticadas = new WeakMap<object, Promise<SesionVerificada>>();

  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly tokens: ServicioTokens,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(SesionAcademiaService.name);
    // Se calcula una vez por proceso, antes de la primera petición con un DNI desconocido.
    obtenerHashFicticio().catch(() => undefined);
  }

  /**
   * Inicia la sesión de un usuario de `academia` (activa). Con credenciales correctas devuelve la respuesta y el token firmado; si
   * no, 401 `CREDENCIALES_INVALIDAS` (el mismo error con un DNI inexistente, de otra academia o con la clave equivocada), 403
   * `USUARIO_INACTIVO` (solo con la clave correcta) o 423 `CUENTA_BLOQUEADA`.
   */
  async iniciarSesion(
    academia: AcademiaResuelta,
    dni: string,
    clave: string,
    ip: string | null,
  ): Promise<SesionEmitida> {
    const fila = await this.baseDatos.conAcademia(academia.id, async (tx) => {
      const filas = await tx.cliente.$queryRaw<FilaIngreso[]>`
        SELECT id::text AS id, nombres, apellidos, rol::text AS rol, estado::text AS estado, clave_hash,
               debe_cambiar_clave, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso
          FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND dni = ${dni}`;
      return filas[0];
    });
    if (!fila) {
      // Mismo trabajo que con un DNI real, para que el tiempo de respuesta no delate si el DNI existe.
      await verificarClave(await obtenerHashFicticio(), clave);
      // Y las mismas sentencias del conteo, sobre un id que no existe: no cambia ninguna fila (criterio 53).
      await this.contarFalloEnBase(academia.id, randomUUID());
      this.registro.warn({ academiaId: academia.id, ip }, 'Inicio de sesión rechazado: credenciales inválidas');
      throw credencialesInvalidas();
    }
    // Falla cerrada (criterio 108 de 001): una fecha inválida de la fila no autoriza nada; el filtro responde 500.
    const bloqueadoHasta = fechaDeBaseONula(fila.bloqueado_hasta);
    fechaDeBaseONula(fila.ultimo_acceso);
    if (estaBloqueado({ intentosFallidos: fila.intentos_fallidos, bloqueadoHasta }, this.reloj.ahora())) {
      this.registro.warn(
        { usuarioId: fila.id, academiaId: academia.id, ip },
        'Inicio de sesión rechazado: cuenta bloqueada',
      );
      throw cuentaBloqueada();
    }

    // El hash tarda decenas de milisegundos: se calcula fuera de la transacción para no retener la conexión.
    const correcta = await verificarClave(fila.clave_hash, clave);
    if (!correcta) return this.rechazarIntento(academia.id, fila.id, ip);
    return this.aceptarIntento(academia, fila.id, ip, {
      claveHash: fila.clave_hash,
      versionToken: Number(fila.version_token),
    });
  }

  /**
   * Devuelve la sesión de la petición (solo la cookie `aq_sesion`; `Authorization` se ignora) o lanza 401 `NO_AUTENTICADO`, o 403
   * `ACADEMIA_SUSPENDIDA`. Comprueba la firma HS256, el vencimiento según `RELOJ`, `tipo`, `aca` y `sub` (UUID) y, en
   * `conAcademia(aca, …)`, que el usuario existe en esa academia, está `ACTIVO` y que su `version_token` es `ver`. El rol y el
   * cambio obligatorio salen de la fila, no del token. El resultado se recuerda solo para esta petición.
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
   * Cierra la sesión: si la cookie es válida, sube `version_token` y esa cookie y las demás sesiones de la cuenta dejan de valer
   * (DR-8). Sin sesión válida, o con la academia suspendida, no cambia nada y no es un error. No se audita (DR-9).
   */
  async cerrarSesion(solicitud: Request): Promise<void> {
    let sesion: SesionVerificada;
    try {
      sesion = await this.autenticar(solicitud);
    } catch (error) {
      if (error instanceof ErrorNegocio && (error.estado === 401 || error.codigo === 'ACADEMIA_SUSPENDIDA')) return;
      throw error;
    }
    const ahora = this.reloj.ahora();
    await this.baseDatos.conAcademia(sesion.usuario.academiaId, async (tx) => {
      // Solo si la versión no cambió desde que se verificó: dos cierres simultáneos suben la versión una vez.
      await tx.cliente.$executeRaw`
        UPDATE usuarios
           SET version_token = version_token + 1, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${sesion.usuario.id}::uuid
           AND version_token = ${sesion.versionToken}`;
    });
    this.registro.info(
      { usuarioId: sesion.usuario.id, academiaId: sesion.usuario.academiaId },
      'Sesión de academia cerrada',
    );
  }

  /**
   * Cambia la propia contraseña (criterios 22 a 25). `datos.claveNueva` ya cumple el esquema compartido; aquí se comprueba que no
   * sea el DNI ni la actual (400 `SOLICITUD_INVALIDA` en el campo `claveNueva`). Una `claveActual` equivocada cuenta como un intento
   * fallido (400 `CLAVE_ACTUAL_INCORRECTA`, o 423 si este fallo bloquea la cuenta); con la cuenta bloqueada responde 423 sin
   * verificar la clave. Sube `version_token` (las demás sesiones dejan de valer) y devuelve la sesión nueva.
   */
  async cambiarClave(sesion: SesionVerificada, datos: CambiarClave, ip: string | null): Promise<SesionEmitida> {
    const { usuario } = sesion;
    const fila = await this.leerParaCambio(usuario.academiaId, usuario.id);
    if (!fila || fila.estado !== 'ACTIVO' || Number(fila.version_token) !== sesion.versionToken) throw noAutenticado();

    const bloqueadoHasta = fechaDeBaseONula(fila.bloqueado_hasta);
    if (estaBloqueado({ intentosFallidos: fila.intentos_fallidos, bloqueadoHasta }, this.reloj.ahora())) {
      this.registro.warn(
        { usuarioId: usuario.id, academiaId: usuario.academiaId, ip },
        'Cambio de contraseña rechazado: cuenta bloqueada',
      );
      throw cuentaBloqueada();
    }
    const correcta = await verificarClave(fila.clave_hash, datos.claveActual);
    if (!correcta) {
      await this.contarFallo(usuario.academiaId, usuario.id, ip, 'Cambio de contraseña');
      throw claveActualIncorrecta();
    }
    // Solo con la actual correcta se mira la nueva (criterio 58): antes, el DNI se podía probar sin contar intentos.
    if (datos.claveNueva === fila.dni) throw claveNuevaInvalida('La contraseña nueva no puede ser igual a tu DNI.');
    // La actual ya se verificó contra el hash: la nueva es igual a ella si y solo si los textos son iguales.
    if (datos.claveNueva === datos.claveActual) {
      throw claveNuevaInvalida('La contraseña nueva debe ser distinta de la actual.');
    }
    const claveHash = await hashearClave(datos.claveNueva);

    const ahora = this.reloj.ahora();
    const resultado = await this.baseDatos.conAcademia(usuario.academiaId, async (tx) => {
      // Fila propia bloqueada y vigente (criterio 56): si dejó de serlo, 401 y no se escribe nada. Esta ruta es la que resuelve el
      // cambio obligatorio pendiente, así que no se exige `debe_cambiar_clave = false`.
      await bloquearActorVigente(
        tx,
        { id: usuario.id, versionToken: sesion.versionToken },
        { permitirCambioPendiente: true, exclusivo: true, registro: this.registro, ip },
      );
      const actuales = await tx.cliente.$queryRaw<
        Pick<FilaCambio, 'clave_hash' | 'intentos_fallidos' | 'bloqueado_hasta'>[]
      >`
        SELECT clave_hash, intentos_fallidos, bloqueado_hasta
          FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${usuario.id}::uuid`;
      const actual = actuales[0];
      if (!actual) return { tipo: 'SESION_PERDIDA' as const };
      // Otro cambio ganó la carrera (criterio 25): la contraseña actual ya no es la que se verificó.
      if (actual.clave_hash !== fila.clave_hash) return { tipo: 'CLAVE_CAMBIADA' as const };
      if (
        estaBloqueado(
          { intentosFallidos: actual.intentos_fallidos, bloqueadoHasta: fechaDeBaseONula(actual.bloqueado_hasta) },
          ahora,
        )
      ) {
        return { tipo: 'BLOQUEADA' as const };
      }
      const versionNueva = sesion.versionToken + 1;
      await tx.cliente.$executeRaw`
        UPDATE usuarios
           SET clave_hash = ${claveHash}, debe_cambiar_clave = false, version_token = ${versionNueva},
               intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${usuario.id}::uuid`;
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: usuario.id,
        accion: 'USUARIO_CLAVE_CAMBIADA',
        entidad: 'usuario',
        entidadId: usuario.id,
        ip,
      });
      return { tipo: 'CAMBIADA' as const, versionNueva };
    });

    if (resultado.tipo === 'SESION_PERDIDA') throw noAutenticado();
    if (resultado.tipo === 'CLAVE_CAMBIADA') throw claveActualIncorrecta();
    if (resultado.tipo === 'BLOQUEADA') throw cuentaBloqueada();
    this.registro.info({ usuarioId: usuario.id, academiaId: usuario.academiaId, ip }, 'Cambio de contraseña correcto');
    const nueva: SesionVerificada = {
      usuario: { ...usuario, debeCambiarClave: false },
      versionToken: resultado.versionNueva,
      academia: sesion.academia,
    };
    return this.emitir(nueva);
  }

  /**
   * Anota en el registro técnico una petición que el middleware de las rutas de academia rechazó (sin sesión, academia suspendida,
   * cambio de contraseña pendiente): esas peticiones no llegan al registro de peticiones de Nest. Lleva el método, la IP, el código
   * del rechazo y, si se conocen, el usuario y su academia; nunca la dirección (podría llevar datos personales), la cookie ni el
   * cuerpo (criterio 43).
   */
  registrarRechazo(solicitud: Request, error: unknown, sesion?: SesionVerificada): void {
    const codigo = error instanceof ErrorNegocio ? error.codigo : 'ERROR';
    const contexto = {
      metodo: solicitud.method,
      ip: solicitud.ip ?? null,
      codigo,
      ...(sesion ? { usuarioId: sesion.usuario.id, academiaId: sesion.usuario.academiaId } : {}),
    };
    // Como el registro de peticiones de Nest, una línea por petición (a nivel `info`).
    this.registro.info(contexto, 'Petición de academia rechazada');
  }

  /** La respuesta de una sesión (`RespuestaSesionAcademia`): nunca lleva el DNI, el hash ni la versión de token. */
  respuestaDe(sesion: SesionVerificada): RespuestaSesionAcademia {
    const { usuario, academia } = sesion;
    return {
      usuario: {
        id: usuario.id,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        rol: usuario.rol,
        debeCambiarClave: usuario.debeCambiarClave,
        academia: { nombreCorto: academia.nombreCorto, nombre: academia.nombre },
      },
    };
  }

  /** Firma el token de la sesión con la versión de token y la duración del rol. */
  private emitir(sesion: SesionVerificada): SesionEmitida {
    const duracionSegundos = duracionSesionSegundos(sesion.usuario.rol);
    const token = this.tokens.firmar(
      { sub: sesion.usuario.id, tipo: TIPO_TOKEN_ACADEMIA, aca: sesion.usuario.academiaId, ver: sesion.versionToken },
      duracionSegundos,
    );
    return { respuesta: this.respuestaDe(sesion), token, duracionSegundos };
  }

  private async verificarSesion(solicitud: Request): Promise<SesionVerificada> {
    const token = leerCookie(solicitud.headers.cookie, NOMBRE_COOKIE_ACADEMIA);
    if (!token) throw noAutenticado();
    const claims = this.tokens.verificar(token);
    if (
      !claims ||
      claims.tipo !== TIPO_TOKEN_ACADEMIA ||
      !PATRON_UUID.test(claims.sub) ||
      claims.aca === undefined ||
      !PATRON_UUID.test(claims.aca)
    ) {
      throw noAutenticado();
    }
    const { sub, aca, ver } = claims;
    let fila: FilaSesion | undefined;
    try {
      fila = await this.baseDatos.conAcademia(aca, async (tx) => {
        const filas = await tx.cliente.$queryRaw<FilaSesion[]>`
          SELECT u.id::text AS id, u.nombres, u.apellidos, u.rol::text AS rol, u.estado::text AS estado,
                 u.debe_cambiar_clave, u.version_token, a.nombre AS academia_nombre,
                 a.nombre_corto AS academia_nombre_corto
            FROM usuarios u JOIN academias a ON a.id = u.academia_id
           WHERE u.academia_id = ${tx.academiaId}::uuid AND u.id = ${sub}::uuid`;
        return filas[0];
      });
    } catch (error) {
      // Un token firmado con una academia que ya no existe no es una sesión; una academia suspendida sí responde 403.
      if (error instanceof ErrorAcademiaNoEncontrada) throw noAutenticado();
      throw error;
    }
    if (!fila || fila.estado !== 'ACTIVO' || Number(fila.version_token) !== ver) throw noAutenticado();
    return {
      usuario: {
        id: fila.id,
        academiaId: aca.toLowerCase(),
        rol: fila.rol,
        nombres: fila.nombres,
        apellidos: fila.apellidos,
        debeCambiarClave: fila.debe_cambiar_clave,
      },
      versionToken: Number(fila.version_token),
      academia: { nombreCorto: fila.academia_nombre_corto, nombre: fila.academia_nombre },
    };
  }

  private leerParaCambio(academiaId: string, id: string): Promise<FilaCambio | undefined> {
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const filas = await tx.cliente.$queryRaw<FilaCambio[]>`
        SELECT id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, clave_hash,
               debe_cambiar_clave, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso
          FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid`;
      return filas[0];
    });
  }

  /**
   * Cuenta un intento fallido bajo el bloqueo de la fila y devuelve el resultado ya confirmado. Dos intentos simultáneos no
   * pierden incrementos: el segundo espera a que el primero termine y cuenta sobre el valor nuevo.
   */
  private contarFalloEnBase(academiaId: string, id: string): Promise<ResultadoFallo> {
    return this.baseDatos.conAcademia(academiaId, async (tx: TransaccionAcademia): Promise<ResultadoFallo> => {
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<Pick<FilaIngreso, 'intentos_fallidos' | 'bloqueado_hasta'>[]>`
        SELECT intentos_fallidos, bloqueado_hasta
          FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const actual = filas[0];
      // Sin fila (id inexistente) el `UPDATE` también se envía, con valores neutros y sin afectar ninguna fila: la secuencia de
      // sentencias es la misma con o sin cuenta (criterio 53).
      const evaluacion = evaluarIntentoFallido(
        actual
          ? { intentosFallidos: actual.intentos_fallidos, bloqueadoHasta: fechaDeBaseONula(actual.bloqueado_hasta) }
          : { intentosFallidos: 0, bloqueadoHasta: null },
        ahora,
        REGLAS_BLOQUEO_USUARIO,
      );
      if (evaluacion.tipo === 'YA_BLOQUEADA') return { tipo: 'BLOQUEADA' };
      await tx.cliente.$executeRaw`
        UPDATE usuarios
           SET intentos_fallidos = ${evaluacion.estado.intentosFallidos},
               bloqueado_hasta = ${evaluacion.estado.bloqueadoHasta}::timestamptz,
               actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid`;
      if (!actual) return { tipo: 'DESAPARECIDO' };
      return evaluacion.bloquea ? { tipo: 'BLOQUEADA' } : { tipo: 'FALLO' };
    });
  }

  /** Cuenta el fallo y, si lo bloquea (o ya estaba bloqueada), responde 423. Si no, vuelve para que quien llama responda el suyo. */
  private async contarFallo(academiaId: string, id: string, ip: string | null, operacion: string): Promise<void> {
    const resultado = await this.contarFalloEnBase(academiaId, id);
    if (resultado.tipo === 'BLOQUEADA') {
      this.registro.warn({ usuarioId: id, academiaId, ip }, `${operacion} rechazado: cuenta bloqueada`);
      throw cuentaBloqueada();
    }
    this.registro.warn({ usuarioId: id, academiaId, ip }, `${operacion} rechazado: contraseña incorrecta`);
  }

  private async rechazarIntento(academiaId: string, id: string, ip: string | null): Promise<never> {
    await this.contarFallo(academiaId, id, ip, 'Inicio de sesión');
    throw credencialesInvalidas();
  }

  /**
   * Con la clave correcta: bajo el bloqueo de la fila, vuelve a comprobar que la clave y la versión de token siguen siendo las
   * que se verificaron (si cambiaron, no se emite nada ni se escribe nada), que no la bloquearon mientras tanto y que la cuenta
   * está activa. Pone el contador en 0 y `ultimo_acceso` en la hora del reloj.
   */
  private async aceptarIntento(
    academia: AcademiaResuelta,
    id: string,
    ip: string | null,
    leida: ClaveVerificada,
  ): Promise<SesionEmitida> {
    const resultado = await this.baseDatos.conAcademia(academia.id, async (tx): Promise<ResultadoAcierto> => {
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<FilaIngreso[]>`
        SELECT id::text AS id, nombres, apellidos, rol::text AS rol, estado::text AS estado, clave_hash,
               debe_cambiar_clave, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso
          FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const actual = filas[0];
      if (!actual) return { tipo: 'DESAPARECIDO' };
      if (actual.clave_hash !== leida.claveHash || Number(actual.version_token) !== leida.versionToken) {
        return { tipo: 'CAMBIADA' };
      }
      const bloqueadoHasta = fechaDeBaseONula(actual.bloqueado_hasta);
      if (estaBloqueado({ intentosFallidos: actual.intentos_fallidos, bloqueadoHasta }, ahora)) {
        return { tipo: 'BLOQUEADA' };
      }
      if (actual.estado !== 'ACTIVO') return { tipo: 'INACTIVO' };
      await tx.cliente.$executeRaw`
        UPDATE usuarios
           SET intentos_fallidos = 0, bloqueado_hasta = NULL,
               ultimo_acceso = ${ahora}::timestamptz, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid`;
      return { tipo: 'ACIERTO', fila: actual };
    });
    const contexto = { usuarioId: id, academiaId: academia.id, ip };
    if (resultado.tipo === 'BLOQUEADA') {
      this.registro.warn(contexto, 'Inicio de sesión rechazado: cuenta bloqueada');
      throw cuentaBloqueada();
    }
    if (resultado.tipo === 'INACTIVO') {
      this.registro.warn(contexto, 'Inicio de sesión rechazado: usuario inactivo');
      throw usuarioInactivo();
    }
    if (resultado.tipo === 'DESAPARECIDO') throw credencialesInvalidas();
    if (resultado.tipo === 'CAMBIADA') {
      this.registro.warn(
        contexto,
        'Inicio de sesión rechazado: la clave o las sesiones cambiaron durante la verificación',
      );
      throw credencialesInvalidas();
    }
    const { fila } = resultado;
    this.registro.info(contexto, 'Inicio de sesión correcto');
    return this.emitir({
      usuario: {
        id: fila.id,
        academiaId: academia.id,
        rol: fila.rol,
        nombres: fila.nombres,
        apellidos: fila.apellidos,
        debeCambiarClave: fila.debe_cambiar_clave,
      },
      versionToken: Number(fila.version_token),
      academia: { nombreCorto: academia.nombreCorto, nombre: academia.nombre },
    });
  }
}
