import { Inject, Injectable } from '@nestjs/common';
import type { CambiarHorario, HorarioDelAlumno, RespuestaCambioHorario } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { anioYMesEnLima } from '../../comun/fechas';
import { BaseDatos, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { insertarEnAuditoriaDeAcademia } from '../auditoria/insercion';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { bloquearClasesParaCupo } from '../clases';
import { ordenDeClases } from '../clases/dominio/clase';
import { type ErrorDeSeleccion, validarSeleccion } from '../inscripciones/dominio/seleccion';
import { leerClasesActivas, leerClasesPorIds, leerPlan } from '../inscripciones/lectura';
import { type ClaseElegida, clasesRestantes } from '../matriculas';
import { cuposDelHorario } from './cupo-del-horario';
import { diferenciaDeClases, sePuedeCambiarElHorario } from './dominio/horario';
import { inicioDelMesEnLima, textoDelMes } from './dominio/ventana';
import { matriculaNoModificable, seleccionNoValida, sinCupoParaRenovar } from './errores';
import {
  bloquearMatriculaParaElCambio,
  leerAlumno,
  leerAlumnoDeLaMatricula,
  leerClaseIdsDeLaMatricula,
  leerClasesDeLaMatricula,
  leerMatriculasParaElCambio,
  type MatriculaParaElCambio,
} from './lectura';
import { bloquearAlumno } from './nucleo';

/** Un dato que las comprobaciones anteriores garantizan: si falta, es un error interno y no un caso de negocio. */
function exigir<T>(valor: T | undefined, descripcion: string): T {
  if (valor === undefined) throw new Error(`Error interno del cambio de horario: falta ${descripcion}.`);
  return valor;
}

export const ACCION_HORARIO_CAMBIADO = 'MATRICULA_HORARIO_CAMBIADO';

/**
 * Los errores de la selección sin la posición de la clase: el cuerpo de un rechazo no distingue una clase que no existe de una de otra academia ni cuál de
 * las pedidas falló (criterio 41), así que cada mensaje sale una sola vez, en el campo de la lista.
 */
function erroresUniformes(errores: readonly ErrorDeSeleccion[]): ErrorDeSeleccion[] {
  return [...new Set(errores.map((error) => error.mensaje))].map((mensaje) => ({ campo: 'claseIds', mensaje }));
}

/**
 * El cambio de horario de una matrícula (spec 010c, criterios 35 a 41; HU-03, RN-08, RN-11, RN-22, D-23, DT-15, DT-16, DT-20). Una sola transacción de la
 * academia de la sesión, con el orden de bloqueos del criterio 39: `bloquearActorVigente` (primera sentencia) → el alumno con `FOR UPDATE` → la matrícula con
 * `FOR UPDATE` → `bloquearClasesParaCupo` con las clases que salen y las que entran, en una sola llamada → «ahora» → decisiones → `DELETE` de las clases que
 * salen e `INSERT` de las que entran con `agregada_en` = «ahora» → la auditoría. La matrícula no se actualiza: `clases_totales`, `clases_usadas`, el monto, los
 * pagos y la caja no cambian (criterio 37, DR-9).
 *
 * Orden de las decisiones: el actor (401) → la matrícula (404; de otra academia o de un `CLIENTE`, igual que una que no existe) → `MATRICULA_NO_MODIFICABLE`
 * → un cambio sin diferencias (200, sin escribir ni auditar: un doble clic o dos peticiones iguales a la vez no duplican nada) → `SELECCION_NO_VALIDA` (el plan
 * de la matrícula tal como está hoy y el nivel actual del alumno, DT-20) → `SIN_CUPO` (solo las clases que entran). Ningún rechazo deja nada escrito.
 */
@Injectable()
export class HorarioService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(HorarioService.name);
  }

  /**
   * `GET /api/alumnos/{id}/horario` (criterio 46, DT-38): lo que la pantalla de «Cambiar horario» necesita. Una transacción de la academia de la sesión, sin
   * bloquear, sin escribir y sin auditar. Las matrículas son las que `sePuedeCambiarElHorario` acepta con el «ahora» de `RELOJ`, por mes; de cada una, el plan
   * tal como está hoy y las clases activas del nivel actual del alumno que ese plan deja elegir (`validarSeleccion`: día y franja), con el cupo de `cuposDelHorario`,
   * la misma cuenta del cambio, recortado a 0. 404 si el alumno no existe, es de otra academia o es un `CLIENTE`.
   */
  async leer(academiaId: string, alumnoIdPedido: string): Promise<HorarioDelAlumno> {
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const alumno = await leerAlumno(tx, alumnoIdPedido);
      const ahora = this.reloj.ahora();
      const mesEnCurso = anioYMesEnLima(ahora);
      const matriculas = (await leerMatriculasParaElCambio(tx, alumno.id)).filter((matricula) =>
        sePuedeCambiarElHorario(matricula, mesEnCurso),
      );
      const activas = (await leerClasesActivas(tx)).filter((clase) => clase.nivel === alumno.nivel).sort(ordenDeClases);

      const salida: HorarioDelAlumno['matriculas'] = [];
      for (const matricula of matriculas) {
        // El plan de una matrícula existe siempre: la llave foránea compuesta (academia_id, plan_id) lo garantiza.
        const plan = exigir((await leerPlan(tx, matricula.planId)) ?? undefined, 'el plan de la matrícula');
        const clases = await leerClasesDeLaMatricula(tx, matricula.id);
        const delPlan = activas.filter(
          (clase) => plan.diasPermitidos.includes(clase.diaSemana) && plan.franjasPermitidas.includes(clase.horaInicio),
        );
        const { cupoLibrePorClase, esMesSiguiente, titulares } = await cuposDelHorario(tx, {
          alumnoId: alumno.id,
          mesDeLaMatricula: { anio: matricula.anio, mes: matricula.mes },
          mesEnCurso,
          ahora,
          clases: delPlan,
          propias: new Set(clases.map((clase) => clase.id)),
        });
        salida.push({
          id: matricula.id,
          mes: textoDelMes(matricula),
          estado: matricula.estado === 'VIGENTE' ? 'VIGENTE' : 'EN_VERIFICACION',
          plan: {
            id: plan.id,
            nombre: plan.nombre,
            vecesPorSemana: plan.vecesPorSemana,
            diasPermitidos: [...plan.diasPermitidos],
            franjasPermitidas: [...plan.franjasPermitidas],
          },
          clases,
          clasesTotales: matricula.clasesTotales,
          clasesUsadas: matricula.clasesUsadas,
          clasesDelPlan: delPlan.map((clase) => ({
            id: clase.id,
            nivel: clase.nivel,
            diaSemana: clase.diaSemana,
            horaInicio: clase.horaInicio,
            horaFin: clase.horaFin,
            cuposRestantes: Math.max(0, exigir(cupoLibrePorClase.get(clase.id), 'el cupo de una clase del plan')),
            conPrioridad: esMesSiguiente && titulares.has(clase.id),
          })),
        });
      }
      return { alumno: { id: alumno.id, nivel: alumno.nivel }, matriculas: salida };
    });
  }

  async cambiar(
    sesion: SesionVerificada,
    matriculaIdPedido: string,
    datos: CambiarHorario,
    ip: string | null,
  ): Promise<RespuestaCambioHorario> {
    const actor = actorDeSesion(sesion);
    return this.baseDatos.conAcademia(actor.academiaId, (tx) =>
      this.enTransaccion(tx, actor, matriculaIdPedido, datos, ip),
    );
  }

  private async enTransaccion(
    tx: TransaccionAcademia,
    actor: ReturnType<typeof actorDeSesion>,
    matriculaIdPedido: string,
    datos: CambiarHorario,
    ip: string | null,
  ): Promise<RespuestaCambioHorario> {
    // 1. El actor sigue vigente: su 401 gana a cualquier 404 o 409.
    await bloquearActorVigente(tx, { id: actor.id, versionToken: actor.versionToken }, { registro: this.registro, ip });
    // 2. El alumno de la matrícula (lectura sin bloqueo; 404 si no es de la academia o es un `CLIENTE`) y su fila con `FOR UPDATE`.
    const alumnoId = await leerAlumnoDeLaMatricula(tx, matriculaIdPedido);
    const alumno = await bloquearAlumno(tx, alumnoId);
    // 3. La matrícula con `FOR UPDATE` y sus clases de ahora.
    const matricula = await bloquearMatriculaParaElCambio(tx, matriculaIdPedido.toLowerCase(), alumno.id);
    const actuales = await leerClaseIdsDeLaMatricula(tx, matricula.id);
    // `claseIdsSchema` ya rechaza los ids repetidos (sin distinguir mayúsculas): solo se normalizan y se ordenan.
    const pedidas = datos.claseIds.map((id) => id.toLowerCase()).sort();
    const diferencia = diferenciaDeClases(actuales, pedidas);
    // 4. Las clases que salen y las que entran, en una sola llamada (el SQL las ordena por id): quien las tuvo antes ya terminó.
    const bloqueadas = await bloquearClasesParaCupo(tx, [...diferencia.salen, ...diferencia.entran]);
    // 5. «Ahora», después de todos los bloqueos (DT-10 de la 007, DT-16 de la 009).
    const ahora = this.reloj.ahora();
    const mesEnCurso = anioYMesEnLima(ahora);

    if (!sePuedeCambiarElHorario(matricula, mesEnCurso)) throw matriculaNoModificable();

    // Un cambio sin diferencias (como conjunto): 200 con lo que hay, sin escribir ni auditar (criterio 37, DT-16).
    if (diferencia.salen.length === 0 && diferencia.entran.length === 0) {
      return this.responder(tx, matricula, mesEnCurso, ahora);
    }

    // El plan de la matrícula tal como está hoy y el nivel actual del alumno (criterio 4, DT-20).
    const plan = exigir((await leerPlan(tx, matricula.planId)) ?? undefined, 'el plan de la matrícula');
    const quedan = await leerClasesPorIds(tx, diferencia.seQuedan);
    const errores = validarSeleccion(plan, alumno.nivel, [...bloqueadas, ...quedan], pedidas, 'claseIds');
    if (errores.length > 0) throw seleccionNoValida(erroresUniformes(errores));

    // El cupo de cada clase que entra, para este alumno y en el mes de la matrícula (criterio 36); las que se quedan no se vuelven a comprobar.
    // La misma cuenta que la lectura del horario (criterio 46).
    const aforos = new Map(bloqueadas.map((clase) => [clase.id, clase.aforo]));
    const { cupoLibrePorClase } = await cuposDelHorario(tx, {
      alumnoId: alumno.id,
      mesDeLaMatricula: { anio: matricula.anio, mes: matricula.mes },
      mesEnCurso,
      ahora,
      clases: diferencia.entran.map((id) => ({
        id,
        aforo: exigir(aforos.get(id), 'una clase que entra, ya validada'),
      })),
      propias: new Set(actuales),
    });
    const sinLugar = diferencia.entran.filter(
      (id) => exigir(cupoLibrePorClase.get(id), 'el cupo de una clase que entra') < 1,
    );
    if (sinLugar.length > 0) throw sinCupoParaRenovar(sinLugar);

    // Escrituras: las filas de las clases que salen se borran y las que entran se insertan con «ahora»; las que se quedan no cambian.
    if (diferencia.salen.length > 0) {
      await tx.cliente.$executeRaw`
        DELETE FROM matricula_clases
         WHERE academia_id = ${tx.academiaId}::uuid AND matricula_id = ${matricula.id}::uuid
           AND clase_id = ANY(${[...diferencia.salen]}::uuid[])`;
    }
    if (diferencia.entran.length > 0) {
      await tx.cliente.$executeRaw`
        INSERT INTO matricula_clases (academia_id, matricula_id, clase_id, agregada_en)
        SELECT ${tx.academiaId}::uuid, ${matricula.id}::uuid, clase.id, ${ahora}::timestamptz
          FROM unnest(${[...diferencia.entran]}::uuid[]) AS clase(id)`;
    }
    // La auditoría (criterio 40): quién, cuándo, por qué y las clases de antes y de después. Sin DNI, nombres ni datos médicos.
    await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
      actorTipo: 'USUARIO',
      actorId: actor.id,
      accion: ACCION_HORARIO_CAMBIADO,
      entidad: 'matricula',
      entidadId: matricula.id,
      motivo: datos.motivo,
      datosAntes: { claseIds: actuales },
      datosDespues: { claseIds: pedidas },
      ip,
    });
    return this.responder(tx, matricula, mesEnCurso, ahora);
  }

  /** La matrícula tal como queda (criterio 35): sus clases, las que le quedan por usar sin cambios y las ocurrencias del nuevo horario que faltan. */
  private async responder(
    tx: TransaccionAcademia,
    matricula: MatriculaParaElCambio,
    mesEnCurso: { anio: number; mes: number },
    ahora: Date,
  ): Promise<RespuestaCambioHorario> {
    const clases = await leerClasesDeLaMatricula(tx, matricula.id);
    const elegidas: ClaseElegida[] = clases.map((clase) => ({
      diaSemana: clase.diaSemana,
      horaInicio: clase.horaInicio,
    }));
    // Del mes en curso se cuenta desde «ahora» (la clase de hoy cuenta si todavía no empezó); del siguiente, desde las 00:00 de Lima del día 1 (DT-6).
    const esDelMesEnCurso = matricula.anio === mesEnCurso.anio && matricula.mes === mesEnCurso.mes;
    const desde = esDelMesEnCurso ? ahora : inicioDelMesEnLima({ anio: matricula.anio, mes: matricula.mes });
    return {
      matricula: {
        id: matricula.id,
        mes: textoDelMes(matricula),
        clases,
        clasesTotales: matricula.clasesTotales,
        clasesUsadas: matricula.clasesUsadas,
        ocurrenciasRestantes: clasesRestantes(elegidas, desde),
      },
    };
  }
}
