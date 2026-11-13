import { Inject, Injectable } from '@nestjs/common';
import { type CrearUsuario, dniSchema, type RolUsuario, type UsuarioResumen } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { fechaDeBase, fechaDeBaseONula } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { hashearClave } from '../../infraestructura/seguridad';
import { AuditoriaService } from '../auditoria';
import { bloquearActorVigente } from '../autenticacion/actor-vigente';
import { estaBloqueado } from '../academias/dominio/bloqueo';
import {
  type ActorDeRestablecimiento,
  evaluarAlcanceDeRestablecimiento,
  ROLES_DEL_PERSONAL,
} from './dominio/alcance-restablecimiento';

/** Quien hace la operación, tal como se anota en la auditoría. */
export interface ActorAuditoria {
  readonly tipo: 'USUARIO' | 'SUPERADMIN' | 'SISTEMA';
  readonly id: string | null;
}

/** Quien crea un usuario: un usuario de la academia (con la versión de token de su sesión) o el Superadmin. */
export type ActorDeCreacion =
  | { readonly tipo: 'USUARIO'; readonly id: string; readonly versionToken: number }
  | { readonly tipo: 'SUPERADMIN'; readonly id: string };

/** Quien restablece una contraseña: un usuario con su rol y la versión de token de su sesión, o el Superadmin. */
export type ActorQueRestablece =
  | { readonly tipo: 'USUARIO'; readonly id: string; readonly rol: RolUsuario; readonly versionToken: number }
  | { readonly tipo: 'SUPERADMIN'; readonly id: string };

/** Quien desactiva o reactiva: el usuario de la sesión, con la versión de token con la que se autenticó. */
export interface ActorQueCambiaEstado {
  readonly id: string;
  readonly academiaId: string;
  readonly versionToken: number;
}

interface FilaUsuario {
  id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  rol: RolUsuario;
  estado: 'ACTIVO' | 'INACTIVO';
  debe_cambiar_clave: boolean;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
}

/**
 * Apellidos y luego nombres, en el orden del español (la `ñ` después de la `n`, sin que las tildes cambien el orden) y no en el de
 * la configuración de la base, que cambia de un servidor a otro; el id desempata para que el orden sea siempre el mismo.
 */
const COMPARADOR = new Intl.Collator('es');
function ordenarPorNombre<T extends { apellidos: string; nombres: string; id: string }>(filas: T[]): T[] {
  return [...filas].sort(
    (a, b) =>
      COMPARADOR.compare(a.apellidos, b.apellidos) ||
      COMPARADOR.compare(a.nombres, b.nombres) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function noEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.');
}

function sobreSiMismo(): ErrorNegocio {
  return new ErrorNegocio(409, 'OPERACION_SOBRE_SI_MISMO', 'No puedes hacer esta operación sobre tu propia cuenta.');
}

function dniEnUso(): ErrorNegocio {
  return new ErrorNegocio(409, 'DNI_EN_USO', 'Ya existe un usuario con ese DNI en la academia.');
}

/**
 * Cuentas de usuario de una academia (spec 002): crear, listar, desactivar, reactivar, buscar por DNI y restablecer la
 * contraseña. Toda operación corre con `conAcademia(<academia de la sesión>, …)` y filtra además por `academia_id`; la auditoría va
 * en la misma transacción. Las contraseñas se hashean antes de abrir la transacción (argon2 tarda decenas de milisegundos). Nada
 * de lo que sale de aquí lleva el hash, la versión de token ni el contador de intentos; ni el DNI buscado llega al registro técnico
 * (criterio 43).
 */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(UsuariosService.name);
  }

  /**
   * Crea un usuario dentro de la transacción de quien llama (la historia 007 lo usa para la cuenta del alumno, HU-04). El DNI es
   * único por academia: si ya existe, 409 `DNI_EN_USO` sin crear ni auditar nada, también con dos creaciones simultáneas (el
   * segundo `INSERT` espera al primero y no inserta nada). Audita `USUARIO_CREADO` en la misma transacción. `claveHash` se calcula
   * fuera de la transacción.
   */
  async crearEnTransaccion(
    tx: TransaccionAcademia,
    datos: { dni: string; nombres: string; apellidos: string; rol: RolUsuario; claveHash: string },
    actor: ActorAuditoria,
    ip: string | null,
  ): Promise<UsuarioResumen> {
    const ahora = this.reloj.ahora();
    const filas = await tx.cliente.$queryRaw<FilaUsuario[]>`
      INSERT INTO usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, debe_cambiar_clave, estado,
                            version_token, intentos_fallidos, creado_en, actualizado_en)
      VALUES (gen_random_uuid(), ${tx.academiaId}::uuid, ${datos.dni}, ${datos.nombres}, ${datos.apellidos},
              ${datos.rol}::rol_usuario, ${datos.claveHash}, true, 'ACTIVO'::estado_usuario, 0, 0,
              ${ahora}::timestamptz, ${ahora}::timestamptz)
      ON CONFLICT (academia_id, dni) DO NOTHING
      RETURNING id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, debe_cambiar_clave,
                intentos_fallidos, bloqueado_hasta, ultimo_acceso`;
    const fila = filas[0];
    if (!fila) throw dniEnUso();
    const resumen = this.aResumen(fila, ahora);
    await this.auditoria.registrarEnAcademia(tx, {
      actorTipo: actor.tipo,
      actorId: actor.id,
      accion: 'USUARIO_CREADO',
      entidad: 'usuario',
      entidadId: resumen.id,
      datosDespues: {
        id: resumen.id,
        dni: resumen.dni,
        nombres: resumen.nombres,
        apellidos: resumen.apellidos,
        rol: resumen.rol,
        estado: resumen.estado,
      },
      ip,
    });
    return resumen;
  }

  /**
   * `POST /api/usuarios`: crea un miembro del personal de la academia indicada, con la contraseña inicial igual a su DNI (RN-02). Si
   * quien crea es un usuario de la academia, su fila se bloquea y debe seguir vigente en la misma transacción (criterio 56): si no,
   * 401 sin crear nada.
   */
  async crearPersonal(
    academiaId: string,
    datos: CrearUsuario,
    actor: ActorDeCreacion,
    ip: string | null,
  ): Promise<UsuarioResumen> {
    const claveHash = await hashearClave(datos.dni);
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      if (actor.tipo === 'USUARIO') {
        await bloquearActorVigente(tx, actor, { registro: this.registro, ip });
      }
      return this.crearEnTransaccion(tx, { ...datos, claveHash }, { tipo: actor.tipo, id: actor.id }, ip);
    });
  }

  /** El personal de la academia (administradores, secretarias y entrenadores; también los inactivos), por apellidos y nombres. */
  async listarPersonal(academiaId: string): Promise<UsuarioResumen[]> {
    const ahora = this.reloj.ahora();
    const filas = await this.baseDatos.conAcademia(
      academiaId,
      (tx) =>
        tx.cliente.$queryRaw<FilaUsuario[]>`
        SELECT id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, debe_cambiar_clave,
               intentos_fallidos, bloqueado_hasta, ultimo_acceso
          FROM usuarios
         WHERE academia_id = ${academiaId}::uuid AND rol IN ('ADMIN', 'SECRETARIA', 'ENTRENADOR')
         ORDER BY id`,
    );
    return ordenarPorNombre(filas).map((fila) => this.aResumen(fila, ahora));
  }

  /** Los administradores de la academia (para el Superadmin, D-29), también los inactivos. */
  async listarAdministradores(academiaId: string): Promise<UsuarioResumen[]> {
    const ahora = this.reloj.ahora();
    const filas = await this.baseDatos.conAcademia(
      academiaId,
      (tx) =>
        tx.cliente.$queryRaw<FilaUsuario[]>`
        SELECT id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, debe_cambiar_clave,
               intentos_fallidos, bloqueado_hasta, ultimo_acceso
          FROM usuarios
         WHERE academia_id = ${academiaId}::uuid AND rol = 'ADMIN'::rol_usuario
         ORDER BY id`,
    );
    return ordenarPorNombre(filas).map((fila) => this.aResumen(fila, ahora));
  }

  /**
   * Desactiva a un miembro del personal activo (DR-6): sube su `version_token` (su sesión deja de valer) y audita
   * `USUARIO_DESACTIVADO`. Si quien pide ya no está vigente al escribir, 401 (criterio 56). Sobre sí mismo, 409
   * `OPERACION_SOBRE_SI_MISMO`; sobre uno ya inactivo, 409 `USUARIO_YA_INACTIVO`; sobre un alumno, uno de otra academia o
   * un id inválido, 404. Con la fila bloqueada, dos desactivaciones simultáneas dan 200 y 409.
   */
  desactivar(actor: ActorQueCambiaEstado, id: string, ip: string | null): Promise<UsuarioResumen> {
    return this.cambiarEstado(actor, id, ip, 'INACTIVO');
  }

  /**
   * Reactiva a un miembro del personal inactivo (DR-6). No cambia la contraseña ni sube la versión de token. Sobre sí mismo, 409
   * `OPERACION_SOBRE_SI_MISMO`, antes de "ya activo" (criterio 55).
   */
  reactivar(actor: ActorQueCambiaEstado, id: string, ip: string | null): Promise<UsuarioResumen> {
    return this.cambiarEstado(actor, id, ip, 'ACTIVO');
  }

  /**
   * Busca por DNI al usuario que `actor` puede restablecer (criterio 34). El DNI se recorta; si no son 8 dígitos, no existe, es de
   * otra academia o está fuera del alcance de quien pide, 404 `NO_ENCONTRADO` con el mismo cuerpo. Es una consulta: no escribe ni
   * audita. El DNI buscado nunca se registra (criterio 43, PO-3).
   */
  async buscarParaRestablecer(
    actor: { id: string; academiaId: string; rol: RolUsuario },
    dniEscrito: string,
  ): Promise<UsuarioResumen> {
    const dni = dniSchema.safeParse(dniEscrito);
    if (!dni.success) throw noEncontrado();
    const ahora = this.reloj.ahora();
    const fila = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      const filas = await tx.cliente.$queryRaw<FilaUsuario[]>`
        SELECT id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, debe_cambiar_clave,
               intentos_fallidos, bloqueado_hasta, ultimo_acceso
          FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND dni = ${dni.data}`;
      return filas[0];
    });
    if (!fila) throw noEncontrado();
    // Para el actor, un usuario fuera de su alcance es como uno que no existe; el 409 de "sí mismo" es de restablecer, no de buscar.
    const alcance = evaluarAlcanceDeRestablecimiento({ tipo: 'USUARIO', id: actor.id, rol: actor.rol }, fila);
    if (alcance === 'FUERA_DE_ALCANCE') throw noEncontrado();
    return this.aResumen(fila, ahora);
  }

  /**
   * Restablece la contraseña (HU-05, criterios 35, 36 y 40): la clave vuelve a ser el DNI, debe cambiarla al entrar, el contador de
   * fallos queda en 0, se desbloquea y sube la versión de token (las sesiones abiertas dejan de valer). No cambia el estado: un
   * usuario inactivo sigue inactivo (PO-5). Audita `USUARIO_CLAVE_RESTABLECIDA` sin datos de la clave. Si quien pide es un usuario
   * y ya no está vigente, 401 antes que cualquier 404 o 409 (criterio 56).
   */
  async restablecer(
    academiaId: string,
    actor: ActorQueRestablece,
    id: string,
    ip: string | null,
  ): Promise<UsuarioResumen> {
    // Transacción 1: quién es y si el actor puede tocarlo. El DNI no se puede cambiar con el rol de la API, así que sigue valiendo
    // en la transacción 2. Un usuario que pide debe seguir vigente aquí también: un id que no existe responde 401, no 404, si quien
    // pide ya dejó de valer (criterio 56).
    const objetivo = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      if (!PATRON_UUID.test(id)) throw noEncontrado();
      const fila = await this.leerObjetivoDeRestablecimiento(tx, actor, id, ip);
      if (!fila) throw noEncontrado();
      this.exigirAlcance(actor, fila);
      return fila;
    });
    const claveHash = await hashearClave(objetivo.dni);

    const ahora = this.reloj.ahora();
    const fila = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      const actual = await this.bloquearObjetivoDeRestablecimiento(tx, actor, objetivo.id, ip);
      if (!actual) throw noEncontrado();
      this.exigirAlcance(actor, actual);
      const filas = await tx.cliente.$queryRaw<FilaUsuario[]>`
        UPDATE usuarios
           SET clave_hash = ${claveHash}, debe_cambiar_clave = true, intentos_fallidos = 0, bloqueado_hasta = NULL,
               version_token = version_token + 1, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${objetivo.id}::uuid
        RETURNING id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, debe_cambiar_clave,
                  intentos_fallidos, bloqueado_hasta, ultimo_acceso`;
      const actualizada = filas[0];
      if (!actualizada) throw new Error('El usuario bloqueado no devolvió fila al restablecer su contraseña.');
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: actor.tipo,
        actorId: actor.id,
        accion: 'USUARIO_CLAVE_RESTABLECIDA',
        entidad: 'usuario',
        entidadId: objetivo.id,
        ip,
      });
      return actualizada;
    });
    this.registro.info(
      { usuarioId: fila.id, academiaId, actorTipo: actor.tipo, actorId: actor.id, ip },
      'Contraseña restablecida',
    );
    return this.aResumen(fila, ahora);
  }

  /** Transacción 1 de restablecer: solo lee al objetivo (con el actor bloqueado y vigente si es un usuario; el Superadmin no tiene fila). */
  private async leerObjetivoDeRestablecimiento(
    tx: TransaccionAcademia,
    actor: ActorQueRestablece,
    id: string,
    ip: string | null,
  ): Promise<Pick<FilaUsuario, 'id' | 'dni' | 'rol'> | undefined> {
    if (actor.tipo === 'USUARIO') {
      const { objetivo } = await bloquearActorVigente(tx, actor, { objetivoId: id, registro: this.registro, ip });
      return objetivo;
    }
    const filas = await tx.cliente.$queryRaw<Pick<FilaUsuario, 'id' | 'dni' | 'rol'>[]>`
      SELECT id::text AS id, dni, rol::text AS rol
        FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid`;
    return filas[0];
  }

  /** Transacción 2 de restablecer: bloquea al objetivo (y al actor, si es un usuario, en la misma sentencia ordenada por `id`). */
  private async bloquearObjetivoDeRestablecimiento(
    tx: TransaccionAcademia,
    actor: ActorQueRestablece,
    id: string,
    ip: string | null,
  ): Promise<Pick<FilaUsuario, 'id' | 'rol'> | undefined> {
    if (actor.tipo === 'USUARIO') {
      const { objetivo } = await bloquearActorVigente(tx, actor, { objetivoId: id, registro: this.registro, ip });
      return objetivo;
    }
    const filas = await tx.cliente.$queryRaw<Pick<FilaUsuario, 'id' | 'rol'>[]>`
      SELECT id::text AS id, rol::text AS rol
        FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    return filas[0];
  }

  private exigirAlcance(actor: ActorDeRestablecimiento, objetivo: { id: string; rol: RolUsuario }): void {
    const alcance = evaluarAlcanceDeRestablecimiento(actor, objetivo);
    if (alcance === 'FUERA_DE_ALCANCE') throw noEncontrado();
    if (alcance === 'SOBRE_SI_MISMO') {
      throw sobreSiMismo();
    }
  }

  /**
   * Desactivar o reactivar a un miembro del personal, con las filas del actor y del objetivo bloqueadas en una sola sentencia
   * ordenada por `id` y la auditoría en la misma transacción. Orden de las respuestas: id que no es UUID (404), sobre sí mismo
   * (409), actor ya no vigente (401), objetivo inexistente o no es del personal (404), ya en ese estado (409).
   */
  private cambiarEstado(
    actor: ActorQueCambiaEstado,
    id: string,
    ip: string | null,
    nuevo: 'ACTIVO' | 'INACTIVO',
  ): Promise<UsuarioResumen> {
    const accion = nuevo === 'INACTIVO' ? 'USUARIO_DESACTIVADO' : 'USUARIO_REACTIVADO';
    if (!PATRON_UUID.test(id)) return Promise.reject(noEncontrado());
    // Sobre sí mismo se decide antes que "ya activo" o "ya inactivo", al desactivar y al reactivar (criterios 31 y 55).
    if (id.toLowerCase() === actor.id.toLowerCase()) return Promise.reject(sobreSiMismo());
    return this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      const { objetivo: actual } = await bloquearActorVigente(tx, actor, {
        objetivoId: id,
        registro: this.registro,
        ip,
      });
      // Los alumnos no se gestionan aquí (su estado es de la historia 010): para este recurso no existen.
      if (!actual || !ROLES_DEL_PERSONAL.includes(actual.rol)) throw noEncontrado();
      if (actual.estado === nuevo) {
        throw nuevo === 'INACTIVO'
          ? new ErrorNegocio(409, 'USUARIO_YA_INACTIVO', 'El usuario ya está inactivo.')
          : new ErrorNegocio(409, 'USUARIO_YA_ACTIVO', 'El usuario ya está activo.');
      }
      const ahora = this.reloj.ahora();
      // Desactivar sube la versión de token: la sesión abierta de esa persona deja de valer en su siguiente petición.
      const versionNueva = Number(actual.version_token) + (nuevo === 'INACTIVO' ? 1 : 0);
      const filas = await tx.cliente.$queryRaw<FilaUsuario[]>`
        UPDATE usuarios
           SET estado = ${nuevo}::estado_usuario,
               version_token = ${versionNueva},
               actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${actual.id}::uuid
        RETURNING id::text AS id, dni, nombres, apellidos, rol::text AS rol, estado::text AS estado, debe_cambiar_clave,
                  intentos_fallidos, bloqueado_hasta, ultimo_acceso`;
      const fila = filas[0];
      if (!fila) throw new Error('El usuario bloqueado no devolvió fila al cambiar su estado.');
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion,
        entidad: 'usuario',
        entidadId: fila.id,
        datosAntes: { estado: actual.estado },
        datosDespues: { estado: nuevo },
        ip,
      });
      return this.aResumen(fila, ahora);
    });
  }

  /** `UsuarioResumen` de una fila. `bloqueado` es `bloqueado_hasta > ahora` según el reloj; falla cerrado ante una fecha inválida. */
  private aResumen(fila: FilaUsuario, ahora: Date): UsuarioResumen {
    const bloqueadoHasta = fechaDeBaseONula(fila.bloqueado_hasta);
    const ultimoAcceso = fechaDeBaseONula(fila.ultimo_acceso);
    return {
      id: fila.id,
      dni: fila.dni,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      rol: fila.rol,
      estado: fila.estado,
      debeCambiarClave: fila.debe_cambiar_clave,
      bloqueado: bloqueadoHasta !== null && estaBloqueado({ intentosFallidos: 0, bloqueadoHasta }, ahora),
      ultimoAcceso: ultimoAcceso ? fechaDeBase(ultimoAcceso).toISOString() : null,
    };
  }
}
