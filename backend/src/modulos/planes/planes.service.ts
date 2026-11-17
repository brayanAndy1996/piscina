import { Inject, Injectable } from '@nestjs/common';
import {
  type ActualizarPlan,
  type Bloque,
  type CrearPlan,
  type NivelNatacion,
  type Plan,
  type RespuestaListaPlanes,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aDecimal, aTextoMonto } from '../../comun/dinero';
import { ErrorNegocio } from '../../comun/errores';
import { hoyEnLima } from '../../comun/fechas';
import { MENSAJE_SOLICITUD_INVALIDA } from '../../comun/validacion';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos, esViolacionDeUnicidad, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import {
  cambiosPedidosPlan,
  compararPlanes,
  type DatosDePlan,
  estadoDelPlan,
  normalizarPlan,
  planCombinado,
  validarReglasCruzadas,
} from './dominio/plan';

interface FilaPlan {
  id: string;
  nombre: string;
  veces_por_semana: number;
  clases_por_mes: number;
  duracion_minutos: number;
  precio: string;
  dias_permitidos: number[];
  franjas_permitidas: Bloque[];
  niveles_aplicables: NivelNatacion[];
  vigencia_inicio: string | null;
  vigencia_fin: string | null;
  activo: boolean;
}

/** El orden del español (la `ñ` después de la `n`, sin que las tildes cambien el orden), no el de la base, que cambia entre servidores. */
const COMPARADOR = new Intl.Collator('es');

function noEncontrado(): ErrorNegocio {
  return new ErrorNegocio(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.');
}

function nombreEnUso(): ErrorNegocio {
  return new ErrorNegocio(409, 'NOMBRE_PLAN_EN_USO', 'Ya existe un plan con ese nombre en la academia.');
}

/** Un plan de la base en el formato de la API (sin `id` ni `estado`): el precio sale del texto de `numeric(10,2)`, nunca de un `number`. */
function aDatosDePlan(fila: FilaPlan): DatosDePlan {
  return normalizarPlan({
    nombre: fila.nombre,
    vecesPorSemana: fila.veces_por_semana,
    clasesPorMes: fila.clases_por_mes,
    duracionMinutos: fila.duracion_minutos,
    precio: aTextoMonto(fila.precio),
    diasPermitidos: fila.dias_permitidos,
    franjasPermitidas: fila.franjas_permitidas,
    nivelesAplicables: fila.niveles_aplicables,
    vigenciaInicio: fila.vigencia_inicio,
    vigenciaFin: fila.vigencia_fin,
    activo: fila.activo,
  });
}

/**
 * Planes de cada academia (spec 004, HU-19, RN-07). Todo corre con `conAcademia(<academia de la sesión>, …)`: la academia nunca viene de
 * la dirección, la consulta ni el cuerpo. Toda escritura empieza con `bloquearActorVigente` (DT-5 de 002) y audita en la misma
 * transacción. El precio es un `Decimal` en el código y `numeric(10,2)` en la base; viaja como texto con dos decimales (D-03, D3). El
 * estado del plan se calcula al leer con la fecha de Lima de `RELOJ` (D10). Sin caché.
 */
@Injectable()
export class PlanesService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(PlanesService.name);
  }

  /** `GET /api/planes`: todos los de la academia, activos e inactivos, por nombre en español y, a igual nombre, por id (criterio 15). */
  async listar(academiaId: string): Promise<RespuestaListaPlanes> {
    const filas = await this.baseDatos.conAcademia(academiaId, (tx) => this.leerPlanes(tx));
    const hoy = hoyEnLima(this.reloj.ahora());
    const planes = filas.map((fila) => this.aPlan(fila, hoy)).sort((a, b) => compararPlanes(a, b, COMPARADOR));
    return { planes };
  }

  /**
   * `POST /api/planes` (criterios 8, 10 y 11): en una sola transacción, bloquea y comprueba la fila del administrador (primera
   * sentencia), inserta con `ON CONFLICT DO NOTHING` (el índice único de `lower(nombre)` decide el 409, también con dos creaciones
   * simultáneas) y audita `PLAN_CREADO`. Los días, las franjas y los niveles se guardan ordenados.
   */
  async crear(sesion: SesionVerificada, datos: CrearPlan, ip: string | null): Promise<Plan> {
    const actor = actorDeSesion(sesion);
    const plan = normalizarPlan({
      nombre: datos.nombre,
      vecesPorSemana: datos.vecesPorSemana,
      clasesPorMes: datos.clasesPorMes,
      duracionMinutos: datos.duracionMinutos,
      precio: aTextoMonto(datos.precio),
      diasPermitidos: datos.diasPermitidos,
      franjasPermitidas: datos.franjasPermitidas,
      nivelesAplicables: datos.nivelesAplicables,
      vigenciaInicio: datos.vigenciaInicio ?? null,
      vigenciaFin: datos.vigenciaFin ?? null,
      activo: true,
    });
    const fila = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      const ahora = this.reloj.ahora();
      const creados = await tx.cliente.$queryRaw<{ id: string }[]>`
        INSERT INTO planes (id, academia_id, nombre, veces_por_semana, clases_por_mes, duracion_minutos, precio, dias_permitidos,
                            franjas_permitidas, niveles_aplicables, vigencia_inicio, vigencia_fin, activo, creado_en, actualizado_en)
        VALUES (gen_random_uuid(), ${tx.academiaId}::uuid, ${plan.nombre}, ${plan.vecesPorSemana}::smallint,
                ${plan.clasesPorMes}::smallint, ${plan.duracionMinutos}::smallint, ${aDecimal(plan.precio)}::numeric(10,2),
                ${plan.diasPermitidos}::smallint[], ${plan.franjasPermitidas}::time(0)[],
                ${plan.nivelesAplicables}::text[]::nivel_natacion[], ${plan.vigenciaInicio}::date, ${plan.vigenciaFin}::date,
                true, ${ahora}::timestamptz, ${ahora}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING id::text AS id`;
      const creado = creados[0];
      if (!creado) throw nombreEnUso();
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'PLAN_CREADO',
        entidad: 'plan',
        entidadId: creado.id,
        datosDespues: { id: creado.id, ...plan },
        ip,
      });
      return { id: creado.id, ...plan };
    });
    return this.aPlan(fila, hoyEnLima(this.reloj.ahora()));
  }

  /**
   * `PATCH /api/planes/{id}` (criterios 11 a 13): en una sola transacción, bloquea y comprueba la fila del administrador (primera
   * sentencia) y después la fila del plan con `FOR UPDATE` (dos cambios simultáneos se ordenan y sus auditorías se encadenan). Orden de
   * los errores: 404 (id inexistente, de otra academia o que no es UUID, con el mismo cuerpo), 400 de las reglas que cruzan campos con
   * lo guardado, 409 `NOMBRE_PLAN_EN_USO`. Sin cambios, no escribe ni audita. Si el nombre choca con un plan que se crea a la vez, el
   * índice lo detiene: la transacción se revierte y se responde 409.
   */
  async actualizar(sesion: SesionVerificada, id: string, pedido: ActualizarPlan, ip: string | null): Promise<Plan> {
    const actor = actorDeSesion(sesion);
    let resultado: { id: string } & DatosDePlan;
    try {
      resultado = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
        await bloquearActorVigente(
          tx,
          { id: actor.id, versionToken: actor.versionToken },
          { registro: this.registro, ip },
        );
        if (!PATRON_UUID.test(id)) throw noEncontrado();
        const idPlan = id.toLowerCase();
        const filas = await tx.cliente.$queryRaw<FilaPlan[]>`
          SELECT id::text AS id, nombre, veces_por_semana::int AS veces_por_semana, clases_por_mes::int AS clases_por_mes,
               duracion_minutos::int AS duracion_minutos, precio::text AS precio, dias_permitidos::int[] AS dias_permitidos,
               coalesce((SELECT array_agg(to_char(f.hora, 'HH24:MI') ORDER BY f.orden)
                           FROM unnest(franjas_permitidas) WITH ORDINALITY AS f(hora, orden)), '{}'::text[]) AS franjas_permitidas,
               niveles_aplicables::text[] AS niveles_aplicables,
               to_char(vigencia_inicio, 'YYYY-MM-DD') AS vigencia_inicio, to_char(vigencia_fin, 'YYYY-MM-DD') AS vigencia_fin,
               activo
            FROM planes WHERE academia_id = ${tx.academiaId}::uuid AND id = ${idPlan}::uuid
             FOR UPDATE`;
        const guardado = filas[0];
        if (!guardado) throw noEncontrado();
        const antes = aDatosDePlan(guardado);

        const combinado = planCombinado(antes, pedido);
        const problemas = validarReglasCruzadas(combinado, pedido);
        if (problemas.length > 0) {
          throw new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, {
            errores: problemas.map((problema) => ({ campo: problema.campo, mensaje: problema.mensaje })),
          });
        }
        const cambios = cambiosPedidosPlan(antes, pedido);
        if (cambios.campos.length === 0) return { id: idPlan, ...antes };

        const ahora = this.reloj.ahora();
        const actualizados = await tx.cliente.$queryRaw<{ id: string }[]>`
          UPDATE planes
             SET nombre = ${combinado.nombre}, veces_por_semana = ${combinado.vecesPorSemana}::smallint,
                 clases_por_mes = ${combinado.clasesPorMes}::smallint, duracion_minutos = ${combinado.duracionMinutos}::smallint,
                 precio = ${aDecimal(combinado.precio)}::numeric(10,2), dias_permitidos = ${combinado.diasPermitidos}::smallint[],
                 franjas_permitidas = ${combinado.franjasPermitidas}::time(0)[],
                 niveles_aplicables = ${combinado.nivelesAplicables}::text[]::nivel_natacion[],
                 vigencia_inicio = ${combinado.vigenciaInicio}::date, vigencia_fin = ${combinado.vigenciaFin}::date,
                 activo = ${combinado.activo}, actualizado_en = ${ahora}::timestamptz
           WHERE academia_id = ${tx.academiaId}::uuid AND id = ${idPlan}::uuid
             AND NOT EXISTS (SELECT 1 FROM planes otro
                              WHERE otro.academia_id = ${tx.academiaId}::uuid AND otro.id <> ${idPlan}::uuid
                                AND lower(otro.nombre) = lower(${combinado.nombre}))
          RETURNING id::text AS id`;
        // Con la fila del plan bloqueada, que no se actualice solo puede ser por el nombre de otro plan.
        if (actualizados.length !== 1) throw nombreEnUso();
        await this.auditoria.registrarEnAcademia(tx, {
          actorTipo: 'USUARIO',
          actorId: actor.id,
          accion: 'PLAN_ACTUALIZADO',
          entidad: 'plan',
          entidadId: idPlan,
          datosAntes: cambios.antes,
          datosDespues: cambios.despues,
          ip,
        });
        return { id: idPlan, ...combinado };
      });
    } catch (error) {
      // Una creación simultánea con el mismo nombre que escapa a la comprobación: la detiene el índice único de `lower(nombre)`. La
      // única restricción única que este `UPDATE` puede violar es esa. Se decide después del ROLLBACK.
      if (esViolacionDeUnicidad(error)) throw nombreEnUso();
      throw error;
    }
    return this.aPlan(resultado, hoyEnLima(this.reloj.ahora()));
  }

  private async leerPlanes(tx: TransaccionAcademia): Promise<({ id: string } & DatosDePlan)[]> {
    const filas = await tx.cliente.$queryRaw<FilaPlan[]>`
      SELECT id::text AS id, nombre, veces_por_semana::int AS veces_por_semana, clases_por_mes::int AS clases_por_mes,
               duracion_minutos::int AS duracion_minutos, precio::text AS precio, dias_permitidos::int[] AS dias_permitidos,
               coalesce((SELECT array_agg(to_char(f.hora, 'HH24:MI') ORDER BY f.orden)
                           FROM unnest(franjas_permitidas) WITH ORDINALITY AS f(hora, orden)), '{}'::text[]) AS franjas_permitidas,
               niveles_aplicables::text[] AS niveles_aplicables,
               to_char(vigencia_inicio, 'YYYY-MM-DD') AS vigencia_inicio, to_char(vigencia_fin, 'YYYY-MM-DD') AS vigencia_fin,
               activo
        FROM planes WHERE academia_id = ${tx.academiaId}::uuid`;
    return filas.map((fila) => ({ id: fila.id, ...aDatosDePlan(fila) }));
  }

  private aPlan(plan: { id: string } & DatosDePlan, hoy: string): Plan {
    return { ...plan, estado: estadoDelPlan(plan, hoy) };
  }
}
