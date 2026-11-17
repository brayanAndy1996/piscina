import { Inject, Injectable } from '@nestjs/common';
import {
  type ActualizarClase,
  type Bloque,
  type Clase,
  type CrearClase,
  horaFinDe,
  type NivelNatacion,
  type RespuestaListaClases,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos, esViolacionDeUnicidad, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { cambiosPedidosClase, esReactivacion, ordenDeClases } from './dominio/clase';
import { bloquearClasesParaCupo } from './cupo';

interface FilaClase {
  id: string;
  nivel: NivelNatacion;
  dia_semana: number;
  hora_inicio: Bloque;
  hora_fin: string;
  aforo: number;
  activo: boolean;
  entrenador_id: string;
  entrenador_nombres: string;
  entrenador_apellidos: string;
  entrenador_activo: boolean;
}

/** Los dos choques del bloque que la base decide con índices únicos parciales (decisión D4 de 004). */
type Choque = 'CLASE_DUPLICADA' | 'ENTRENADOR_OCUPADO';

function noEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.');
}

/** El mismo error para un entrenador que no existe, de otra academia, con otro rol o inactivo: no revela cuál de los cuatro (criterio 19). */
function entrenadorNoValido(): ErrorNegocio {
  return new ErrorNegocio(409, 'ENTRENADOR_NO_VALIDO', 'El entrenador debe ser un entrenador activo de la academia.');
}

/** ¿La fila bloqueada de `usuarios` es un entrenador activo? Sin fila (no existe o es de otra academia): no. */
function esEntrenadorActivo(fila: { rol: string; estado: string } | undefined): boolean {
  return fila !== undefined && fila.rol === 'ENTRENADOR' && fila.estado === 'ACTIVO';
}

function errorDeChoque(choque: Choque): ErrorNegocio {
  return choque === 'CLASE_DUPLICADA'
    ? new ErrorNegocio(409, 'CLASE_DUPLICADA', 'Ya hay una clase activa de ese nivel en ese día y bloque.')
    : new ErrorNegocio(409, 'ENTRENADOR_OCUPADO', 'El entrenador ya tiene otra clase activa en ese día y bloque.');
}

function aClase(fila: FilaClase): Clase {
  return {
    id: fila.id,
    nivel: fila.nivel,
    diaSemana: fila.dia_semana,
    horaInicio: fila.hora_inicio,
    horaFin: fila.hora_fin,
    aforo: fila.aforo,
    activo: fila.activo,
    entrenador: {
      id: fila.entrenador_id,
      nombres: fila.entrenador_nombres,
      apellidos: fila.entrenador_apellidos,
      activo: fila.entrenador_activo,
    },
  };
}

/** Los datos de una clase que se guardan en la auditoría al crearla, con los nombres de la API. */
function datosDeCreacion(clase: Clase) {
  return {
    id: clase.id,
    nivel: clase.nivel,
    diaSemana: clase.diaSemana,
    horaInicio: clase.horaInicio,
    horaFin: clase.horaFin,
    entrenadorId: clase.entrenador.id,
    aforo: clase.aforo,
    activo: clase.activo,
  };
}

/**
 * Clases de cada academia (spec 004, HU-17, RN-09 a RN-11). Todo corre con `conAcademia(<academia de la sesión>, …)`: la academia nunca
 * viene de la dirección, la consulta ni el cuerpo. Toda escritura empieza con `bloquearActorVigente` (DT-5 de 002); el `PATCH`
 * bloquea la fila de la clase con `bloquearClasesParaCupo` antes de leerla (criterio 22). Los choques del bloque los decide la base con
 * índices únicos parciales (D4), no una consulta previa. Sin caché.
 */
@Injectable()
export class ClasesService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(ClasesService.name);
  }

  /** `GET /api/clases`: todas las de la academia, activas e inactivas, por día, hora y nivel, con su entrenador (criterio 24). */
  async listar(academiaId: string): Promise<RespuestaListaClases> {
    // Leer no bloquea nada: ni `FOR UPDATE` ni `FOR SHARE`.
    const filas = await this.baseDatos.conAcademia(
      academiaId,
      (tx) =>
        tx.cliente.$queryRaw<FilaClase[]>`
        SELECT c.id::text AS id, c.nivel::text AS nivel, c.dia_semana::int AS dia_semana,
               to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(c.hora_fin, 'HH24:MI') AS hora_fin,
               c.aforo::int AS aforo, c.activo, u.id::text AS entrenador_id, u.nombres AS entrenador_nombres,
               u.apellidos AS entrenador_apellidos, (u.estado = 'ACTIVO'::estado_usuario) AS entrenador_activo
          FROM clases c
          JOIN usuarios u ON u.academia_id = c.academia_id AND u.id = c.entrenador_id
         WHERE c.academia_id = ${tx.academiaId}::uuid`,
    );
    const clases = filas.map(aClase).sort(ordenDeClases);
    return { clases };
  }

  /**
   * `POST /api/clases` (criterios 16 a 20): en una sola transacción, bloquea y comprueba la fila del administrador (primera sentencia),
   * comprueba que el entrenador sea un `ENTRENADOR` `ACTIVO` de la academia (409 `ENTRENADOR_NO_VALIDO`, igual para los cuatro casos),
   * inserta con `ON CONFLICT DO NOTHING` (los índices únicos parciales deciden los choques, también entre dos creaciones simultáneas;
   * sin fila, se averigua cuál chocó: `CLASE_DUPLICADA` y, si no, `ENTRENADOR_OCUPADO`) y audita `CLASE_CREADA`.
   */
  async crear(sesion: SesionVerificada, datos: CrearClase, ip: string | null): Promise<Clase> {
    const actor = actorDeSesion(sesion);
    const entrenadorId = datos.entrenadorId.toLowerCase();
    return this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      // El entrenador se bloquea junto con el actor, en la misma sentencia y en el orden de `id` (como `desactivar` de 002): la llave
      // foránea de la clase toma `FOR KEY SHARE` sobre su fila, y si la tomara después de dejar al actor bloqueado, otra petición del
      // mismo administrador que desactiva a ese entrenador (`FOR UPDATE` sobre las dos filas) se esperaría en cruz (`40P01`). Siempre
      // antes de cualquier fila de `clases`.
      const { objetivo } = await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { objetivoId: entrenadorId, registro: this.registro, ip },
      );
      if (!esEntrenadorActivo(objetivo)) throw entrenadorNoValido();

      const ahora = this.reloj.ahora();
      const horaFin = horaFinDe(datos.horaInicio);
      const creadas = await tx.cliente.$queryRaw<{ id: string }[]>`
        INSERT INTO clases (id, academia_id, nivel, dia_semana, hora_inicio, hora_fin, entrenador_id, aforo, activo, creado_en,
                            actualizado_en)
        VALUES (gen_random_uuid(), ${tx.academiaId}::uuid, ${datos.nivel}::nivel_natacion, ${datos.diaSemana}::smallint,
                ${datos.horaInicio}::time(0), ${horaFin}::time(0), ${entrenadorId}::uuid, ${datos.aforo}::smallint, true,
                ${ahora}::timestamptz, ${ahora}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING id::text AS id`;
      const creada = creadas[0];
      if (!creada) {
        const choque = await this.buscarChoque(tx, {
          nivel: datos.nivel,
          diaSemana: datos.diaSemana,
          horaInicio: datos.horaInicio,
          entrenadorId,
          excluirId: null,
        });
        if (choque) throw errorDeChoque(choque);
        throw new Error('La inserción de una clase no creó ninguna fila y no hay una clase que choque.');
      }
      const clase = await this.leerClase(tx, creada.id);
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'CLASE_CREADA',
        entidad: 'clase',
        entidadId: clase.id,
        datosDespues: datosDeCreacion(clase),
        ip,
      });
      return clase;
    });
  }

  /**
   * `PATCH /api/clases/{id}` (criterios 21, 22 y 25): en una sola transacción, bloquea y comprueba la fila del administrador
   * (`bloquearActorVigente`, primera sentencia) y después la fila de la clase con `bloquearClasesParaCupo`, siempre y antes de leerla
   * (el aforo se lee ya con el bloqueo, así dos cambios se encadenan). Sin fila, 404 (id inexistente, de otra academia o que no es
   * UUID, con el mismo cuerpo). Cambiar el entrenador o reactivar exige un entrenador válido y activo y comprueba los choques del
   * bloque. Sin cambios, no escribe ni audita. Un choque que escapa a la comprobación (otra clase que entra al mismo bloque a la vez)
   * lo detiene el índice: la transacción se revierte y se responde 409.
   */
  async actualizar(sesion: SesionVerificada, id: string, pedido: ActualizarClase, ip: string | null): Promise<Clase> {
    const actor = actorDeSesion(sesion);
    try {
      return await this.baseDatos.conAcademia(actor.academiaId, (tx) =>
        this.actualizarEnTransaccion(tx, actor, id, pedido, ip),
      );
    } catch (error) {
      if (!esViolacionDeUnicidad(error)) throw error;
      const choque = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
        const [actual] = await tx.cliente.$queryRaw<
          { nivel: NivelNatacion; dia_semana: number; hora_inicio: string; entrenador_id: string }[]
        >`
          SELECT nivel::text AS nivel, dia_semana::int AS dia_semana, to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
                 entrenador_id::text AS entrenador_id
            FROM clases WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id.toLowerCase()}::uuid`;
        if (!actual) return null;
        return this.buscarChoque(tx, {
          nivel: actual.nivel,
          diaSemana: actual.dia_semana,
          horaInicio: actual.hora_inicio,
          entrenadorId: (pedido.entrenadorId ?? actual.entrenador_id).toLowerCase(),
          excluirId: id.toLowerCase(),
        });
      });
      throw choque ? errorDeChoque(choque) : error;
    }
  }

  private async actualizarEnTransaccion(
    tx: TransaccionAcademia,
    actor: ReturnType<typeof actorDeSesion>,
    idPedido: string,
    pedido: ActualizarClase,
    ip: string | null,
  ): Promise<Clase> {
    // Si se pide un entrenador, su fila se bloquea junto con la del actor, antes de cualquier fila de `clases` (ver `crear`).
    const { objetivo } = await bloquearActorVigente(
      tx,
      { id: actor.id, versionToken: actor.versionToken },
      { objetivoId: pedido.entrenadorId?.toLowerCase(), registro: this.registro, ip },
    );
    if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
    const id = idPedido.toLowerCase();
    const [guardada] = await bloquearClasesParaCupo(tx, [id]);
    if (!guardada) throw noEncontrado();

    const cambios = cambiosPedidosClase(guardada, pedido);
    const cambiaElEntrenador = cambios.campos.includes('entrenadorId');
    const reactiva = esReactivacion(guardada, cambios.resultante);
    if (cambiaElEntrenador) {
      if (!esEntrenadorActivo(objetivo)) throw entrenadorNoValido();
    } else if (reactiva) {
      // Reactivar con el mismo entrenador: la clase no vuelve a tomar su fila, así que no se bloquea (decisión D11).
      if (!(await this.esEntrenadorValido(tx, cambios.resultante.entrenadorId))) throw entrenadorNoValido();
    }
    if (cambios.campos.length === 0) return this.leerClase(tx, id);

    // Los índices únicos parciales solo cubren las clases activas: una clase que queda inactiva no choca con nadie.
    if (cambios.resultante.activo && (cambiaElEntrenador || reactiva)) {
      const choque = await this.buscarChoque(tx, {
        nivel: guardada.nivel,
        diaSemana: guardada.diaSemana,
        horaInicio: guardada.horaInicio,
        entrenadorId: cambios.resultante.entrenadorId,
        excluirId: id,
      });
      if (choque) throw errorDeChoque(choque);
    }

    const ahora = this.reloj.ahora();
    const actualizadas = await tx.cliente.$queryRaw<{ id: string }[]>`
      UPDATE clases
         SET entrenador_id = ${cambios.resultante.entrenadorId}::uuid, aforo = ${cambios.resultante.aforo}::smallint,
             activo = ${cambios.resultante.activo}, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${id}::uuid
      RETURNING id::text AS id`;
    if (actualizadas.length !== 1) throw new Error('La clase bloqueada no devolvió fila al actualizarla.');
    const clase = await this.leerClase(tx, id);
    await this.auditoria.registrarEnAcademia(tx, {
      actorTipo: 'USUARIO',
      actorId: actor.id,
      accion: 'CLASE_ACTUALIZADA',
      entidad: 'clase',
      entidadId: id,
      datosAntes: cambios.antes,
      datosDespues: cambios.despues,
      ip,
    });
    return clase;
  }

  /**
   * ¿Es `entrenadorId` un usuario de la academia con rol `ENTRENADOR` y estado `ACTIVO`? Una lectura simple, sin bloquear su fila
   * (decisión D11 de 004): solo para reactivar una clase con el mismo entrenador, cuya fila la clase no vuelve a tomar. Nunca se
   * bloquea `usuarios` después de `clases`.
   */
  private async esEntrenadorValido(tx: TransaccionAcademia, entrenadorId: string): Promise<boolean> {
    const filas = await tx.cliente.$queryRaw<{ valido: boolean }[]>`
      SELECT (rol = 'ENTRENADOR'::rol_usuario AND estado = 'ACTIVO'::estado_usuario) AS valido
        FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND id = ${entrenadorId}::uuid`;
    return filas[0]?.valido === true;
  }

  /**
   * Qué choca con una clase activa en ese bloque (sin contar a `excluirId`): primero otra clase activa del mismo nivel
   * (`CLASE_DUPLICADA`) y, si no, otra del mismo entrenador (`ENTRENADOR_OCUPADO`). Los índices únicos parciales lo garantizan; esto
   * solo decide el código del error.
   */
  private async buscarChoque(
    tx: TransaccionAcademia,
    bloque: {
      nivel: NivelNatacion;
      diaSemana: number;
      horaInicio: string;
      entrenadorId: string;
      excluirId: string | null;
    },
  ): Promise<Choque | null> {
    const filas = await tx.cliente.$queryRaw<{ duplicada: boolean; ocupado: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM clases
                      WHERE academia_id = ${tx.academiaId}::uuid AND activo AND nivel = ${bloque.nivel}::nivel_natacion
                        AND dia_semana = ${bloque.diaSemana}::smallint AND hora_inicio = ${bloque.horaInicio}::time(0)
                        AND id IS DISTINCT FROM ${bloque.excluirId}::uuid) AS duplicada,
             EXISTS (SELECT 1 FROM clases
                      WHERE academia_id = ${tx.academiaId}::uuid AND activo AND entrenador_id = ${bloque.entrenadorId}::uuid
                        AND dia_semana = ${bloque.diaSemana}::smallint AND hora_inicio = ${bloque.horaInicio}::time(0)
                        AND id IS DISTINCT FROM ${bloque.excluirId}::uuid) AS ocupado`;
    const fila = filas[0];
    if (fila?.duplicada) return 'CLASE_DUPLICADA';
    if (fila?.ocupado) return 'ENTRENADOR_OCUPADO';
    return null;
  }

  /** Una clase de la academia con su entrenador (la misma consulta de la lista, de una sola fila). */
  private async leerClase(tx: TransaccionAcademia, id: string): Promise<Clase> {
    const filas = await tx.cliente.$queryRaw<FilaClase[]>`
      SELECT c.id::text AS id, c.nivel::text AS nivel, c.dia_semana::int AS dia_semana,
             to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(c.hora_fin, 'HH24:MI') AS hora_fin,
             c.aforo::int AS aforo, c.activo, u.id::text AS entrenador_id, u.nombres AS entrenador_nombres,
             u.apellidos AS entrenador_apellidos, (u.estado = 'ACTIVO'::estado_usuario) AS entrenador_activo
        FROM clases c
        JOIN usuarios u ON u.academia_id = c.academia_id AND u.id = c.entrenador_id
       WHERE c.academia_id = ${tx.academiaId}::uuid AND c.id = ${id}::uuid`;
    const fila = filas[0];
    if (!fila) throw new Error('No se encontró la clase que se acaba de leer o escribir.');
    return aClase(fila);
  }
}
