import { Inject, Injectable } from '@nestjs/common';
import type {
  CotizarRenovacion,
  OfertaRenovacion,
  RenovarEnEfectivo,
  RespuestaCotizacionRenovacion,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { hoyEnLima } from '../../comun/fechas';
import { BaseDatos, restriccionDeUnicidadViolada, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { actorDeSesion } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { ordenDeClases } from '../clases/dominio/clase';
import { leerConfiguracion } from '../configuracion/lectura';
import { planAplicaAlNivel, validarSeleccion } from '../inscripciones/dominio/seleccion';
import { leerClasesActivas, leerClasesPorIds, leerPlan, leerPlanes } from '../inscripciones/lectura';
import { type ClaseElegida, contarOcupacion, contarReservasDePrioridad } from '../matriculas';
import { compararPlanes, estadoDelPlan } from '../planes/dominio/plan';
import { UsuariosService } from '../usuarios/usuarios.service';
import { cotizarRenovacion } from './dominio/cotizacion';
import { cuposParaMostrar } from './dominio/cupo';
import {
  mesDeTexto,
  mesesPermitidos,
  mesSiguiente,
  primerDiaDelMes,
  textoDelMes,
  ventanaDeRenovacion,
} from './dominio/ventana';
import {
  claveYaUsada,
  mensualidadYaRegistrada,
  mesNoPermitido,
  planNoDisponible,
  seleccionNoValida,
  sinClasesEnElMes,
} from './errores';
import {
  clasesDeLaTitularidad,
  leerAlumno,
  leerClasesDeLaMatricula,
  leerMatriculasDelAlumno,
  registraElMes,
} from './lectura';
import { registrarRenovacion, type ResultadoDelRegistro } from './nucleo';

/** El orden del español para ordenar los planes por nombre. */
const COMPARADOR = new Intl.Collator('es');

/**
 * Las restricciones únicas que, al chocar, indican que otra transacción llegó antes (criterio 12): se vuelve a decidir una vez con lo que ya se
 * confirmó (el reintento con la misma clave responde 200 y el segundo del mes, `MENSUALIDAD_YA_REGISTRADA`). Se reconocen por su nombre.
 */
export const RESTRICCIONES_DE_CARRERA: readonly string[] = [
  'pagos_academia_id_clave_idempotencia_key',
  'matriculas_alumno_mes_ocupa_cupo_key',
];

/** El 409 que corresponde a una restricción única que sigue chocando después de decidir otra vez. */
export function errorDeRestriccion(error: unknown): Error | null {
  const restriccion = restriccionDeUnicidadViolada(error);
  if (restriccion === 'matriculas_alumno_mes_ocupa_cupo_key') return mensualidadYaRegistrada();
  if (restriccion === 'pagos_academia_id_clave_idempotencia_key') return claveYaUsada();
  return null;
}

/**
 * La renovación de la mensualidad en recepción (spec 010a, criterios 2, 5 y 6; HU-12, D-03, D-04, D-06). La academia sale siempre de la sesión. La
 * oferta y la cotización son lecturas informativas: no bloquean, no escriben, no auditan y no comprueban el cupo ni la mensualidad ya registrada
 * (DT-21); el registro lo decide todo con las filas bloqueadas (`registrarRenovacion`).
 */
@Injectable()
export class RenovacionService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly usuarios: UsuariosService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(RenovacionService.name);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // GET /api/alumnos/{id}/renovacion?mes= (criterio 2)
  // -------------------------------------------------------------------------------------------------------------------------------

  async oferta(academiaId: string, alumnoIdPedido: string, mesPedido: string | undefined): Promise<OfertaRenovacion> {
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const alumno = await leerAlumno(tx, alumnoIdPedido);
      const ahora = this.reloj.ahora();
      const hoy = hoyEnLima(ahora);
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      const ventana = ventanaDeRenovacion(ahora, configuracion.diasPrioridadRenovacion);
      const matriculas = await leerMatriculasDelAlumno(tx, alumno.id);
      const registrados = new Set(matriculas.filter(registraElMes).map((m) => textoDelMes(m)));
      const permitidos = mesesPermitidos(ahora, configuracion.diasPrioridadRenovacion).filter(
        (mes) => !registrados.has(mes),
      );
      const enCurso = textoDelMes(ventana.mes);
      const siguiente = textoDelMes(mesSiguiente(ventana.mes));
      const mes = mesPedido ?? (permitidos.includes(siguiente) ? siguiente : enCurso);

      const actual = matriculas.find((m) => textoDelMes(m) === enCurso && registraElMes(m)) ?? null;
      const planActual = actual === null ? null : await leerPlan(tx, actual.planId);
      const mensualidadActual =
        actual === null || planActual === null
          ? null
          : {
              mes: enCurso,
              plan: { id: planActual.id, nombre: planActual.nombre },
              clases: await leerClasesDeLaMatricula(tx, actual.id),
            };

      const base = {
        alumno: {
          id: alumno.id,
          nombres: alumno.nombres,
          apellidos: alumno.apellidos,
          nivel: alumno.nivel,
          estado: alumno.estado as 'ALUMNO_ACTIVO' | 'ALUMNO_VENCIDO' | 'INACTIVO',
        },
        mesesPermitidos: permitidos,
        mes,
        ventana: { desde: ventana.desde, hasta: ventana.hasta },
        mensualidadActual,
      };
      if (!permitidos.includes(mes)) return { ...base, planes: [], clases: [] };

      const esMesSiguiente = mes !== enCurso;
      const fechaInicio = esMesSiguiente ? primerDiaDelMes(mesDeTexto(mes)) : hoy;
      const planes = (await leerPlanes(tx))
        .filter((plan) => estadoDelPlan(plan, fechaInicio) === 'VIGENTE' && planAplicaAlNivel(plan, alumno.nivel))
        .sort((a, b) => compararPlanes(a, b, COMPARADOR));
      const clases = (await leerClasesActivas(tx)).filter((clase) => clase.nivel === alumno.nivel).sort(ordenDeClases);
      const ids = clases.map((clase) => clase.id);
      const ocupacion = await contarOcupacion(tx, ids, mesDeTexto(mes), ahora);
      const reservas = esMesSiguiente
        ? await contarReservasDePrioridad(tx, ids, ventana.mes, ahora)
        : new Map<string, number>();
      const titulares = new Set(esMesSiguiente ? await clasesDeLaTitularidad(tx, alumno.id, ventana.mes) : []);
      return {
        ...base,
        planes: planes.map((plan) => ({
          id: plan.id,
          nombre: plan.nombre,
          vecesPorSemana: plan.vecesPorSemana,
          clasesPorMes: plan.clasesPorMes,
          duracionMinutos: plan.duracionMinutos,
          precio: plan.precio,
          diasPermitidos: plan.diasPermitidos,
          franjasPermitidas: plan.franjasPermitidas,
          nivelesAplicables: plan.nivelesAplicables,
        })),
        clases: clases.map((clase) => ({
          id: clase.id,
          nivel: clase.nivel,
          diaSemana: clase.diaSemana,
          horaInicio: clase.horaInicio,
          horaFin: clase.horaFin,
          cuposRestantes: cuposParaMostrar({
            aforo: clase.aforo,
            ocupacion: ocupacion.get(clase.id) ?? 0,
            reservas: reservas.get(clase.id) ?? 0,
            esTitular: titulares.has(clase.id),
            esMesSiguiente,
          }),
          conPrioridad: titulares.has(clase.id),
        })),
      };
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/alumnos/{id}/renovacion/cotizacion (criterio 5)
  // -------------------------------------------------------------------------------------------------------------------------------

  /**
   * Las mismas validaciones del registro, en su orden (alumno → mes → plan → selección → clases restantes) y el mismo cálculo; sin bloquear, sin
   * escribir y sin exigir cupo ni caja (DT-21).
   */
  async cotizar(
    academiaId: string,
    alumnoIdPedido: string,
    datos: CotizarRenovacion,
  ): Promise<RespuestaCotizacionRenovacion> {
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const alumno = await leerAlumno(tx, alumnoIdPedido);
      const ahora = this.reloj.ahora();
      const hoy = hoyEnLima(ahora);
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      const registrados = new Set(
        (await leerMatriculasDelAlumno(tx, alumno.id)).filter(registraElMes).map((m) => textoDelMes(m)),
      );
      const permitidos = mesesPermitidos(ahora, configuracion.diasPrioridadRenovacion);
      if (!permitidos.includes(datos.mes)) throw mesNoPermitido(permitidos.filter((mes) => !registrados.has(mes)));

      const esMesSiguiente =
        datos.mes !== textoDelMes(ventanaDeRenovacion(ahora, configuracion.diasPrioridadRenovacion).mes);
      const fechaInicio = esMesSiguiente ? primerDiaDelMes(mesDeTexto(datos.mes)) : hoy;
      const plan = await leerPlan(tx, datos.planId);
      if (!plan || estadoDelPlan(plan, fechaInicio) !== 'VIGENTE' || !planAplicaAlNivel(plan, alumno.nivel)) {
        throw planNoDisponible();
      }
      const clases = await leerClasesPorIds(tx, datos.claseIds);
      const errores = validarSeleccion(plan, alumno.nivel, clases, datos.claseIds, 'claseIds');
      if (errores.length > 0) throw seleccionNoValida(errores);
      const porId = new Map(clases.map((clase) => [clase.id, clase]));
      const elegidas: ClaseElegida[] = datos.claseIds.flatMap((id) => {
        const clase = porId.get(id.toLowerCase());
        return clase ? [{ diaSemana: clase.diaSemana, horaInicio: clase.horaInicio }] : [];
      });
      const cotizacion = cotizarRenovacion(plan, elegidas, datos.mes, ahora);
      if (cotizacion.clasesRestantes === 0) throw sinClasesEnElMes();
      return { cotizacion };
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/alumnos/{id}/renovacion/efectivo (criterio 6)
  // -------------------------------------------------------------------------------------------------------------------------------

  /**
   * 201 con la renovación cobrada o 200 con la misma respuesta si repite la clave. Con una carrera por la clave o por el mes que otra transacción
   * ya tomó, se vuelve a decidir una vez con lo confirmado (como la 007a); si la restricción sigue chocando, su 409.
   */
  async registrarEnEfectivo(
    sesion: SesionVerificada,
    alumnoIdPedido: string,
    datos: RenovarEnEfectivo,
    ip: string | null,
  ): Promise<ResultadoDelRegistro> {
    const actor = actorDeSesion(sesion);
    for (let intento = 0; ; intento++) {
      try {
        return await this.baseDatos.conAcademia(actor.academiaId, (tx) =>
          this.enTransaccion(tx, actor, alumnoIdPedido, datos, ip),
        );
      } catch (error) {
        const restriccion = restriccionDeUnicidadViolada(error);
        if (restriccion !== null && RESTRICCIONES_DE_CARRERA.includes(restriccion) && intento === 0) continue;
        throw errorDeRestriccion(error) ?? error;
      }
    }
  }

  private enTransaccion(
    tx: TransaccionAcademia,
    actor: ReturnType<typeof actorDeSesion>,
    alumnoIdPedido: string,
    datos: RenovarEnEfectivo,
    ip: string | null,
  ): Promise<ResultadoDelRegistro> {
    return registrarRenovacion(
      tx,
      { reloj: this.reloj, usuarios: this.usuarios, registro: this.registro },
      {
        actor: { id: actor.id, versionToken: actor.versionToken },
        ip,
        alumnoIdPedido,
        mes: datos.mes,
        planId: datos.planId,
        claseIds: datos.claseIds,
        via: { tipo: 'EFECTIVO', claveIdempotencia: datos.claveIdempotencia, montoMostrado: datos.montoMostrado },
      },
    );
  }
}
