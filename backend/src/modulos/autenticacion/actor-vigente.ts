import type { RolUsuario } from '@aquagestion/contratos';
import { ErrorNegocio } from '../../comun/errores';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import type { SesionVerificada } from './tipos';

/** 401 `NO_AUTENTICADO`: el mismo error del middleware de las rutas de academia (criterio 14). */
export function noAutenticado(): ErrorNegocio {
  return new ErrorNegocio(401, 'NO_AUTENTICADO', 'Debes iniciar sesión para continuar.');
}

/**
 * El usuario de la sesión como actor de una escritura: lo que piden los servicios para bloquear su fila, decidir el alcance y
 * auditar. Sirve para los tipos de actor de cada servicio, que piden solo una parte de estos campos.
 */
export function actorDeSesion(sesion: SesionVerificada) {
  return {
    tipo: 'USUARIO' as const,
    id: sesion.usuario.id,
    academiaId: sesion.usuario.academiaId,
    rol: sesion.usuario.rol,
    versionToken: sesion.versionToken,
  };
}

/** Quien pide, tal como lo dejó la sesión: su id y la versión de token que llevaba su cookie. */
export interface ActorParaBloquear {
  readonly id: string;
  readonly versionToken: number;
}

/** Las filas que se bloquean: lo que necesitan las escrituras para decidir 404 y 409 sin volver a leer. */
export interface FilaBloqueada {
  id: string;
  dni: string;
  rol: RolUsuario;
  estado: 'ACTIVO' | 'INACTIVO';
  version_token: number;
  debe_cambiar_clave: boolean;
}

export interface OpcionesBloqueoDelActor {
  /**
   * Otro usuario de la misma academia que la escritura también va a tocar. Se bloquea junto con el actor en una sola sentencia
   * ordenada por `id` (criterio 57). Un valor que no es UUID no se busca (quien llama ya respondió 404 por él). Si es el id del actor,
   * se bloquea una sola fila y `objetivo` es la misma fila.
   */
  readonly objetivoId?: string;
  /**
   * `POST /api/sesion/clave` es lo que resuelve el cambio obligatorio pendiente (criterio 21): ahí no se exige
   * `debe_cambiar_clave = false`.
   */
  readonly permitirCambioPendiente?: boolean;
  /**
   * Con un solo usuario, `FOR SHARE` por omisión (deja que el mismo actor haga varias escrituras a la vez). Con `exclusivo`, `FOR
   * UPDATE`: para quien va a cambiar la propia fila en esa misma transacción (dos `FOR SHARE` seguidos de dos `UPDATE` se
   * interbloquearían).
   */
  readonly exclusivo?: boolean;
  /** Para el registro técnico del rechazo (nunca lleva el DNI). */
  readonly registro: { warn(contexto: object, mensaje: string): void };
  readonly ip: string | null;
}

export interface ActorYObjetivoBloqueados {
  readonly actor: FilaBloqueada;
  /** La fila de `objetivoId` si existe en la academia; `undefined` si no existe, es de otra academia o no se pidió. */
  readonly objetivo: FilaBloqueada | undefined;
}

/**
 * Bloquea la fila de quien pide y exige que siga vigente dentro de la transacción que escribe (spec 002, criterios 56 y 57). El
 * middleware autentica con una lectura sin bloqueo al empezar la petición; entre esa lectura y la escritura el actor pudo
 * desactivarse, cerrar sesión, restablecerse o cambiar su clave. Con esta función, la transacción espera esos cambios y los ve.
 *
 * Reglas para toda historia que escriba a pedido de un usuario de la academia: llamarla dentro del `conAcademia` que escribe, antes
 * de leer o escribir nada más, con la sesión de la petición (`SesionVerificada.versionToken`), y dejar que su 401 aborte la
 * transacción (no se escribe nada). Vigente es: existe en la academia de la transacción, `ACTIVO`, con el `version_token` del token
 * y, salvo `permitirCambioPendiente`, sin cambio de clave pendiente. El 401 tiene prioridad sobre los 404 y 409 del objetivo.
 *
 * Con objetivo, una sola sentencia bloquea las dos filas con `ORDER BY id FOR UPDATE`: todas las transacciones las toman en el mismo
 * orden y dos administradores que se desactivan entre sí no se esperan en cruz (`40P01`): uno responde 200 y el otro 401.
 */
export async function bloquearActorVigente(
  tx: TransaccionAcademia,
  actor: ActorParaBloquear,
  opciones: OpcionesBloqueoDelActor,
): Promise<ActorYObjetivoBloqueados> {
  const objetivoId =
    opciones.objetivoId !== undefined && PATRON_UUID.test(opciones.objetivoId) ? opciones.objetivoId : undefined;
  const conObjetivo = objetivoId !== undefined && objetivoId.toLowerCase() !== actor.id.toLowerCase();

  let filas: FilaBloqueada[];
  if (conObjetivo) {
    filas = await tx.cliente.$queryRaw<FilaBloqueada[]>`
      SELECT id::text AS id, dni, rol::text AS rol, estado::text AS estado, version_token, debe_cambiar_clave
        FROM usuarios
       WHERE academia_id = ${tx.academiaId}::uuid AND id IN (${actor.id}::uuid, ${objetivoId}::uuid)
       ORDER BY usuarios.id FOR UPDATE`;
  } else if (opciones.exclusivo || objetivoId !== undefined) {
    filas = await tx.cliente.$queryRaw<FilaBloqueada[]>`
      SELECT id::text AS id, dni, rol::text AS rol, estado::text AS estado, version_token, debe_cambiar_clave
        FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${actor.id}::uuid FOR UPDATE`;
  } else {
    filas = await tx.cliente.$queryRaw<FilaBloqueada[]>`
      SELECT id::text AS id, dni, rol::text AS rol, estado::text AS estado, version_token, debe_cambiar_clave
        FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${actor.id}::uuid FOR SHARE`;
  }

  const fila = filas.find((candidata) => candidata.id === actor.id.toLowerCase());
  const vigente =
    fila !== undefined &&
    fila.estado === 'ACTIVO' &&
    Number(fila.version_token) === actor.versionToken &&
    (opciones.permitirCambioPendiente === true || !fila.debe_cambiar_clave);
  if (!fila || !vigente) {
    opciones.registro.warn(
      { usuarioId: actor.id, academiaId: tx.academiaId, ip: opciones.ip },
      'Escritura rechazada: quien pide ya no tiene una sesión vigente',
    );
    throw noAutenticado();
  }
  const objetivo =
    objetivoId === undefined
      ? undefined
      : conObjetivo
        ? filas.find((candidata) => candidata.id === objetivoId.toLowerCase())
        : fila;
  return { actor: fila, objetivo };
}
