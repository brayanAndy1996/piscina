import { Inject, Injectable } from '@nestjs/common';
import {
  type Bloque,
  type ClasePublica,
  type Cotizacion,
  type CotizarInscripcion,
  type DiaSemana,
  esMenorDeEdad,
  type EnviarInscripcion,
  type PlanPublico,
  type RespuestaCotizacion,
  type RespuestaFormularioInscripcion,
  type RespuestaInscripcionCreada,
  textosConsentimiento,
  validarFechaNacimiento,
  VERSION_CONSENTIMIENTOS,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { isIPv4 } from 'node:net';
import { aDecimal, montosIguales } from '../../comun/dinero';
import { hoyEnLima } from '../../comun/fechas';
import { claveDeConexion } from '../../comun/http/conexion';
import {
  BaseDatos,
  type AcademiaResuelta,
  restriccionDeUnicidadViolada,
  sql,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { ENVIADOR_CORREO, enviarSinEsperar, tipoDeError, type EnviadorCorreo } from '../../infraestructura/correo';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService, ipParaAuditoria } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { bloquearClasesParaCupo } from '../clases';
import { leerConfiguracion } from '../configuracion/lectura';
import { type ClaseElegida, contarOcupacion, vencimientoDeReserva } from '../matriculas';
import { estadoDelPlan, compararPlanes } from '../planes/dominio/plan';
import { cotizarInscripcion } from './dominio/cotizacion';
import { hashDeToken, nuevoCodigo, nuevoToken } from './dominio/codigos';
import { destinatariosDelEnlace } from './dominio/destinatarios';
import { planAplicaAlNivel, validarSeleccion } from './dominio/seleccion';
import {
  dniYaRegistrado,
  limiteDeReservasPendientes,
  mesCambio,
  montoCambio,
  planNoDisponible,
  seleccionNoValida,
  sinClasesEnElMes,
  sinCupo,
  solicitudInvalida,
  solicitudYaRegistrada,
  textosActualizados,
} from './errores';
import { leerClasesActivas, leerClasesPorIds, leerPlan, leerPlanes, type PlanLeido } from './lectura';
import { ordenDeClases } from '../clases/dominio/clase';

/** Cuántas solicitudes sin pagar puede tener a la vez una misma conexión (criterio 59) en una academia (DR-8 de 005). */
export const LIMITE_RESERVAS_POR_CONEXION = 5;

/** Cuántos códigos nuevos se prueban si el elegido ya existe en la academia (con 32^6 posibles, casi nunca pasa del primero). */
const INTENTOS_DE_CODIGO = 5;

/** El orden del español para ordenar los planes por nombre. */
const COMPARADOR = new Intl.Collator('es');

/** Las restricciones únicas que, al chocar, se convierten en un 409 después del `ROLLBACK` (por su nombre, nunca por el mensaje). */
const RESTRICCION_DE_CLAVE = 'solicitudes_inscripcion_academia_id_clave_idempotencia_key';
const RESTRICCIONES_DE_DNI: readonly string[] = [
  'alumnos_academia_id_dni_key',
  'solicitudes_inscripcion_alumno_pendiente_key',
  'matriculas_alumno_mes_ocupa_cupo_key',
];

interface FilaAlumnoExistente {
  id: string;
  estado: string;
}

interface FilaSolicitudDelCliente {
  id: string;
}

interface FilaMatriculaDelCliente {
  id: string;
  solicitud_id: string | null;
  reserva_vence_en: Date | null;
}

/** Lo que el envío necesita saber de quien se inscribe, ya comprobado: el alumno que se reutiliza, si lo hay. */
interface ClienteExistente {
  id: string;
}

/**
 * Inscripción pública (spec 005, criterios 6, 11 y 12 a 28; HU-01, HU-02, HU-34, RN-01, RN-11, RN-25, RN-28, D-05, D-07, D-23). La
 * academia sale siempre del nombre corto de la dirección (resuelto por `ResolverAcademiaPipe`), nunca del cuerpo ni de la consulta, y
 * todo corre con `conAcademia(academia.id, …)`: un id de otra academia se comporta como uno que no existe (RLS y consultas por
 * `academia_id`). Sin caché.
 *
 * - Formulario y cotización: lecturas informativas, sin bloquear ni escribir; el cupo se decide al enviar (D3).
 * - Envío: una sola transacción con este orden de bloqueos (arquitectura, "Orden de bloqueos con alumnos y solicitudes"): bloqueos
 *   consultivos de la IP y del DNI, filas del cliente (`alumnos`, `solicitudes_inscripcion`, `matriculas`), clases
 *   (`bloquearClasesParaCupo`, una sola llamada) y las escrituras. Los 409 se deciden en el orden del contrato. El correo se envía
 *   después de confirmar y nunca hace fallar la respuesta.
 */
@Injectable()
export class InscripcionesService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ENVIADOR_CORREO) private readonly correo: EnviadorCorreo,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(InscripcionesService.name);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // GET /api/a/{nombreCorto}/inscripcion (criterio 6)
  // -------------------------------------------------------------------------------------------------------------------------------

  async leerFormulario(academia: AcademiaResuelta): Promise<RespuestaFormularioInscripcion> {
    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    const [anio = '0', mes = '0'] = hoy.split('-');
    return this.baseDatos.conAcademia(academia.id, async (tx) => {
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      const planes = (await leerPlanes(tx))
        .filter((plan) => estadoDelPlan(plan, hoy) === 'VIGENTE')
        .sort((a, b) => compararPlanes(a, b, COMPARADOR));
      const clases = (await leerClasesActivas(tx)).sort(ordenDeClases);
      const ocupacion = await contarOcupacion(
        tx,
        clases.map((clase) => clase.id),
        { anio: Number(anio), mes: Number(mes) },
        ahora,
      );
      const clasesConCupo: ClasePublica[] = [];
      for (const clase of clases) {
        const cuposRestantes = Math.max(0, clase.aforo - (ocupacion.get(clase.id) ?? 0));
        if (cuposRestantes <= 0) continue;
        clasesConCupo.push({
          id: clase.id,
          nivel: clase.nivel,
          diaSemana: clase.diaSemana,
          horaInicio: clase.horaInicio,
          horaFin: clase.horaFin,
          cuposRestantes,
        });
      }
      const planesPublicos: PlanPublico[] = planes.map((plan) => ({
        id: plan.id,
        nombre: plan.nombre,
        vecesPorSemana: plan.vecesPorSemana,
        clasesPorMes: plan.clasesPorMes,
        duracionMinutos: plan.duracionMinutos,
        precio: plan.precio,
        diasPermitidos: plan.diasPermitidos,
        franjasPermitidas: plan.franjasPermitidas,
        nivelesAplicables: plan.nivelesAplicables,
      }));
      return {
        academia: { nombre: academia.nombre, telefono: configuracion.telefono },
        mes: `${anio}-${mes}`,
        hoy,
        planes: planesPublicos,
        clases: clasesConCupo,
        consentimientos: {
          version: VERSION_CONSENTIMIENTOS,
          textos: textosConsentimiento(academia.nombre, { menor: false }),
          textosMenor: textosConsentimiento(academia.nombre, { menor: true }),
        },
      };
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/a/{nombreCorto}/inscripcion/cotizacion (criterio 11)
  // -------------------------------------------------------------------------------------------------------------------------------

  /**
   * Las mismas validaciones de plan y de clases que el envío (criterio 15) y el mismo cálculo; no escribe, no bloquea y no exige cupo (el
   * cupo se comprueba al enviar).
   */
  async cotizar(academia: AcademiaResuelta, datos: CotizarInscripcion): Promise<RespuestaCotizacion> {
    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    return this.baseDatos.conAcademia(academia.id, async (tx) => {
      const plan = await leerPlan(tx, datos.planId);
      if (!plan || !planDisponible(plan, datos.nivel, hoy)) throw planNoDisponible();
      const clases = await leerClasesPorIds(tx, datos.claseIds);
      const errores = validarSeleccion(plan, datos.nivel, clases, datos.claseIds, 'claseIds');
      if (errores.length > 0) throw seleccionNoValida(errores);
      const cotizacion = cotizarInscripcion(plan, clasesElegidas(clases, datos.claseIds), ahora);
      if (cotizacion.clasesRestantes === 0) throw sinClasesEnElMes();
      return { cotizacion };
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // POST /api/a/{nombreCorto}/inscripcion (criterios 12 a 28)
  // -------------------------------------------------------------------------------------------------------------------------------

  async enviar(
    academia: AcademiaResuelta,
    datos: EnviarInscripcion,
    ip: string | null,
    recepcion?: SesionVerificada,
  ): Promise<RespuestaInscripcionCreada> {
    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    const menor = this.validarDatosDeHoy(datos, hoy);
    const ipOrigen = ipParaAuditoria(ip);

    let creada: ResultadoDelEnvio;
    try {
      creada = await this.baseDatos.conAcademia(academia.id, (tx) =>
        this.enviarEnTransaccion(tx, academia, datos, {
          ahora,
          hoy,
          menor,
          ipOrigen,
          actor: recepcion === undefined ? null : actorDeSesion(recepcion),
        }),
      );
    } catch (error) {
      throw await this.errorDeEscritura(academia.id, error, datos);
    }

    const respuesta: RespuestaInscripcionCreada = {
      solicitud: {
        codigo: creada.codigo,
        token: creada.token,
        enlace: `/a/${academia.nombreCorto}/solicitud/${creada.token}`,
        estado: 'PENDIENTE_PAGO',
        reservaVenceEn: creada.reservaVenceEn.toISOString(),
        cotizacion: creada.cotizacion,
      },
    };
    // Después de confirmar (D-05, D-19) y sin esperar: ni un proveedor lento ni un fallo del correo cambian la respuesta.
    this.enviarCorreos(academia, datos, respuesta.solicitud.codigo, respuesta.solicitud.enlace);
    return respuesta;
  }

  /**
   * Los 400 que dependen de la fecha de hoy en Lima (criterios 12 y 13): la fecha de nacimiento no es futura ni de hace más de 100 años,
   * el apoderado es obligatorio para menores y no va en mayores, y su DNI no es el de la persona. Devuelve si es menor de edad.
   */
  private validarDatosDeHoy(datos: EnviarInscripcion, hoy: string): boolean {
    const errores: { campo: string; mensaje: string }[] = [];
    const problemaDeFecha = validarFechaNacimiento(datos.alumno.fechaNacimiento, hoy);
    if (problemaDeFecha !== null) errores.push({ campo: 'alumno.fechaNacimiento', mensaje: problemaDeFecha });
    const menor = problemaDeFecha === null && esMenorDeEdad(datos.alumno.fechaNacimiento, hoy);
    if (problemaDeFecha === null) {
      if (menor && !datos.apoderado) {
        errores.push({ campo: 'apoderado', mensaje: 'Una persona menor de edad se inscribe con su apoderado.' });
      }
      if (!menor && datos.apoderado) {
        errores.push({ campo: 'apoderado', mensaje: 'Solo las personas menores de edad llevan apoderado.' });
      }
    }
    if (datos.apoderado && datos.apoderado.dni === datos.alumno.dni) {
      errores.push({
        campo: 'apoderado.dni',
        mensaje: 'El DNI del apoderado no puede ser el de la persona que se inscribe.',
      });
    }
    if (errores.length > 0) throw solicitudInvalida(errores);
    return menor;
  }

  private async enviarEnTransaccion(
    tx: TransaccionAcademia,
    academia: AcademiaResuelta,
    datos: EnviarInscripcion,
    contexto: {
      ahora: Date;
      hoy: string;
      menor: boolean;
      ipOrigen: string | null;
      /** Quien inscribe desde recepción (007, criterio 34): un `ADMIN` o una `SECRETARIA` con su sesión; `null` si se inscribe el público. */
      actor: { id: string; versionToken: number } | null;
    },
  ): Promise<ResultadoDelEnvio> {
    const { ahora, hoy, menor, ipOrigen, actor } = contexto;
    // 0. Desde recepción, el actor sigue vigente dentro de la transacción: primera sentencia (DT-5 de 002, criterio 34 a). Si dejó de serlo,
    //    401 sin escribir nada.
    if (actor !== null) {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip: ipOrigen },
      );
    }
    const dni = datos.alumno.dni;
    const claseIds = datos.inscripcion.claseIds.map((id) => id.toLowerCase());
    const planId = datos.inscripcion.planId.toLowerCase();
    const [anioTexto = '0', mesTexto = '0'] = hoy.split('-');
    const mesActual = `${anioTexto}-${mesTexto}`;

    // 1. Bloqueos consultivos, siempre en este orden: la conexión de origen y después el DNI. Ordenan los envíos de una misma conexión
    //    (el límite del criterio 25) y de una misma persona (el DNI único, el reuso de un cliente y la idempotencia) sin llegar a
    //    `23505`. La conexión es la clave del criterio 59 (una IPv4 por dirección, una IPv6 por bloque /64), así que dos envíos del
    //    mismo /64 también se ordenan (criterio 60).
    const conexion = claveDeConexion(ipOrigen ?? '');
    await tx.cliente.$executeRaw`
      SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`inscripcion-ip:${tx.academiaId}:${conexion}`}::text, 0))`;
    await tx.cliente.$executeRaw`
      SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`inscripcion-dni:${tx.academiaId}:${dni}`}::text, 0))`;

    // 2. Idempotencia: la misma clave ya creó una solicitud (doble clic o reintento). Con el mismo DNI se devuelve su código (nunca el
    //    token); con otro DNI, nada (no se revela el código de otra persona).
    const previas = await tx.cliente.$queryRaw<{ codigo: string; dni: string }[]>`
      SELECT s.codigo, a.dni
        FROM solicitudes_inscripcion s
        JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
       WHERE s.academia_id = ${tx.academiaId}::uuid AND s.clave_idempotencia = ${datos.claveIdempotencia.toLowerCase()}::uuid`;
    const previa = previas[0];
    if (previa) throw solicitudYaRegistrada(previa.dni === dni ? previa.codigo : null);

    // 3. Textos de los consentimientos y mes: lo que vio el cliente tiene que ser lo vigente.
    if (datos.consentimientos.version !== VERSION_CONSENTIMIENTOS) {
      throw textosActualizados(VERSION_CONSENTIMIENTOS, textosConsentimiento(academia.nombre, { menor }));
    }
    if (datos.inscripcion.mes !== mesActual) throw mesCambio(mesActual);

    // 4. El plan: activo, vigente hoy y para el nivel elegido (un mismo error para todos los casos).
    const plan = await leerPlan(tx, planId);
    if (!plan || !planDisponible(plan, datos.alumno.nivel, hoy)) throw planNoDisponible();

    // 5. La persona: filas del cliente (`alumnos`, `solicitudes_inscripcion`, `matriculas`) con `FOR UPDATE`.
    const cliente = await this.comprobarPersona(tx, dni, ahora);

    // 6. Límite de reservas sin pagar por conexión (criterio 25). Una IP desconocida es una conexión más (clave ''), igual que en el
    //    bloqueo consultivo: sus solicitudes se guardan con `ip_origen` nulo y se cuentan juntas. La recepción no tiene este límite
    //    (007, criterio 34 b) y sus solicitudes no cuentan en el de la conexión.
    if (
      actor === null &&
      (await this.reservasActivasDeLaConexion(tx, ipOrigen, conexion, ahora)) >= LIMITE_RESERVAS_POR_CONEXION
    ) {
      throw limiteDeReservasPendientes();
    }

    // 7. Las clases, bloqueadas con UNA sola llamada y antes de contar la ocupación o escribir (regla "Cupo de una clase" de 004).
    const bloqueadas = await bloquearClasesParaCupo(tx, claseIds);
    const errores = validarSeleccion(plan, datos.alumno.nivel, bloqueadas, claseIds, 'inscripcion.claseIds');
    if (errores.length > 0) throw seleccionNoValida(errores);
    const elegidas = clasesElegidas(bloqueadas, claseIds);
    const cotizacion = cotizarInscripcion(plan, elegidas, ahora);
    if (cotizacion.clasesRestantes === 0) throw sinClasesEnElMes();

    // 8. Cupo: ninguna clase puede pasar de su aforo. Se cuenta con las clases ya bloqueadas, así que dos envíos por el último cupo
    //    se ordenan y exactamente uno entra.
    const ocupacion = await contarOcupacion(tx, claseIds, { anio: Number(anioTexto), mes: Number(mesTexto) }, ahora);
    const llenas = bloqueadas.filter((clase) => (ocupacion.get(clase.id) ?? 0) >= clase.aforo).map((clase) => clase.id);
    if (llenas.length > 0) throw sinCupo(claseIds.filter((id) => llenas.includes(id)));

    // 9. El monto que vio el cliente es el que se guarda.
    if (!montosIguales(datos.inscripcion.montoMostrado, cotizacion.monto)) throw montoCambio(cotizacion);

    // 10. Escrituras.
    // Las 24 horas o el fin del mes en Lima, lo que ocurra primero (criterio 54): nunca una reserva que cruce el mes.
    const reservaVenceEn = vencimientoDeReserva(ahora);
    const alumnoId = await this.escribirPersona(tx, datos, cliente, menor, ahora);
    const token = nuevoToken();
    const { id: solicitudId, codigo } = await this.crearSolicitud(tx, {
      alumnoId,
      token,
      claveIdempotencia: datos.claveIdempotencia.toLowerCase(),
      ipOrigen,
      registradaPor: actor?.id ?? null,
      ahora,
    });
    await this.crearMatricula(tx, { alumnoId, solicitudId, planId, plan, cotizacion, claseIds, reservaVenceEn, ahora });
    await this.crearConsentimientos(tx, { alumnoId, solicitudId, datos, menor, ipOrigen, ahora });
    await this.auditoria.registrarEnAcademia(tx, {
      // Quien inscribe desde recepción es un usuario de la academia (007, criterio 34 c); el público, `PUBLICO`.
      actorTipo: actor === null ? 'PUBLICO' : 'USUARIO',
      actorId: actor?.id ?? null,
      accion: 'SOLICITUD_INSCRIPCION_CREADA',
      entidad: 'solicitud_inscripcion',
      entidadId: solicitudId,
      datosDespues: {
        codigo,
        planId,
        claseIds,
        mes: cotizacion.mes,
        clasesTotales: cotizacion.clasesTotales,
        montoCalculado: cotizacion.monto,
        esProporcional: cotizacion.esProporcional,
        menorDeEdad: menor,
        reservaVenceEn: reservaVenceEn.toISOString(),
      },
      ip: ipOrigen,
    });
    return { codigo, token, reservaVenceEn, cotizacion };
  }

  /**
   * ¿Se puede inscribir esta persona? (criterio 21). Bloquea (`FOR UPDATE`) su fila de `alumnos` y, si es un cliente, sus solicitudes en
   * espera de pago y sus reservas. Devuelve el cliente que se reutiliza (el que no tiene una solicitud activa), o `null` si el DNI es
   * nuevo. Un alumno que no es cliente, una solicitud activa o un usuario del personal con ese DNI dan el mismo `DNI_YA_REGISTRADO`.
   */
  private async comprobarPersona(tx: TransaccionAcademia, dni: string, ahora: Date): Promise<ClienteExistente | null> {
    const alumnos = await tx.cliente.$queryRaw<FilaAlumnoExistente[]>`
      SELECT id::text AS id, estado::text AS estado
        FROM alumnos WHERE academia_id = ${tx.academiaId}::uuid AND dni = ${dni}
         FOR UPDATE`;
    const alumno = alumnos[0];
    // Sin bloqueo: la fila de `usuarios` no se toca y no entra en el orden de bloqueos.
    const personal = await tx.cliente.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM usuarios WHERE academia_id = ${tx.academiaId}::uuid AND dni = ${dni}) AS existe`;
    if (personal[0]?.existe === true) throw dniYaRegistrado();
    if (!alumno) return null;
    if (alumno.estado !== 'CLIENTE') throw dniYaRegistrado();

    const solicitudes = await tx.cliente.$queryRaw<FilaSolicitudDelCliente[]>`
      SELECT id::text AS id FROM solicitudes_inscripcion
       WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumno.id}::uuid AND estado = 'PENDIENTE_PAGO'::estado_solicitud
         FOR UPDATE`;
    const matriculas = await tx.cliente.$queryRaw<FilaMatriculaDelCliente[]>`
      SELECT id::text AS id, solicitud_id::text AS solicitud_id, reserva_vence_en
        FROM matriculas
       WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumno.id}::uuid AND estado = 'RESERVADA'::estado_matricula
         FOR UPDATE`;
    // Una solicitud activa es una `PENDIENTE_PAGO` cuya matrícula todavía ocupa cupo (la misma definición que el conteo de reservas de la
    // conexión): una matrícula `RESERVADA` sin vencimiento (pago en verificación) o con un vencimiento posterior a "ahora". Una solicitud
    // en espera de pago sin esa matrícula (cancelada, vencida o inexistente) ya no ocupa nada y no impide volver a inscribirse; el envío
    // la pasa a `VENCIDA` y cancela las reservas vencidas.
    const conCupo = new Set(
      matriculas
        .filter(
          (m) =>
            m.solicitud_id !== null && (m.reserva_vence_en === null || m.reserva_vence_en.getTime() > ahora.getTime()),
        )
        .map((m) => m.solicitud_id),
    );
    if (solicitudes.some((s) => conCupo.has(s.id))) throw dniYaRegistrado();
    return { id: alumno.id };
  }

  /**
   * Cuántas solicitudes activas se crearon desde la misma conexión en la academia (criterio 60; las vencidas y las canceladas no
   * cuentan, y tampoco las que inscribió recepción, `registrada_por` no nulo: 007, criterio 34 b). La conexión es la clave del criterio 59: una IPv4 cuenta las filas con esa dirección (también escrita como IPv6 mapeada,
   * porque `ip_origen` guarda la dirección exacta tal como llegó) y un bloque /64 cuenta las filas dentro del bloque, salvo las IPv6
   * mapeadas (que son IPv4 aunque caigan en `::/64`). Una IP desconocida (`ip` nula, clave de conexión `''`) cuenta las filas con
   * `ip_origen` nulo: es una conexión más, con el mismo tope. Los valores van como parámetros, nunca concatenados en el texto de la
   * consulta.
   */
  private async reservasActivasDeLaConexion(
    tx: TransaccionAcademia,
    ip: string | null,
    conexion: string,
    ahora: Date,
  ): Promise<number> {
    const mismaConexion =
      ip === null
        ? sql`s.ip_origen IS NULL`
        : isIPv4(conexion)
          ? sql`s.ip_origen IN (${conexion}::inet, ${`::ffff:${conexion}`}::inet)`
          : conexion.endsWith('/64')
            ? sql`(s.ip_origen <<= ${conexion}::cidr AND NOT s.ip_origen <<= '::ffff:0:0/96'::cidr)`
            : sql`s.ip_origen = ${ip}::inet`;
    const filas = await tx.cliente.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM solicitudes_inscripcion s
        JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
       WHERE s.academia_id = ${tx.academiaId}::uuid AND ${mismaConexion} AND s.estado = 'PENDIENTE_PAGO'::estado_solicitud
         AND s.registrada_por IS NULL AND m.estado = 'RESERVADA'::estado_matricula AND (m.reserva_vence_en IS NULL OR m.reserva_vence_en > ${ahora}::timestamptz)`;
    return filas[0]?.n ?? 0;
  }

  /**
   * Escribe la persona, su ficha médica y su apoderado, y devuelve el id del alumno. Un cliente que vuelve (criterio 21 b) conserva su
   * alumno: se actualizan sus datos, sus solicitudes en espera de pago vencidas pasan a `VENCIDA` y sus reservas vencidas a `CANCELADA`,
   * y el apoderado se reemplaza (o se quita, si ya es mayor de edad: el único `DELETE`).
   */
  private async escribirPersona(
    tx: TransaccionAcademia,
    datos: EnviarInscripcion,
    cliente: ClienteExistente | null,
    menor: boolean,
    ahora: Date,
  ): Promise<string> {
    const { alumno, fichaMedica, apoderado } = datos;
    let alumnoId: string;
    if (cliente) {
      alumnoId = cliente.id;
      await tx.cliente.$executeRaw`
        UPDATE solicitudes_inscripcion SET estado = 'VENCIDA'::estado_solicitud, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid AND estado = 'PENDIENTE_PAGO'::estado_solicitud`;
      await tx.cliente.$executeRaw`
        UPDATE matriculas SET estado = 'CANCELADA'::estado_matricula, reserva_vence_en = NULL, actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid AND estado = 'RESERVADA'::estado_matricula
           AND reserva_vence_en IS NOT NULL AND reserva_vence_en <= ${ahora}::timestamptz`;
      await tx.cliente.$executeRaw`
        UPDATE alumnos
           SET nombres = ${alumno.nombres}, apellidos = ${alumno.apellidos}, fecha_nacimiento = ${alumno.fechaNacimiento}::date,
               telefono = ${alumno.telefono}, correo = ${alumno.correo ?? null}, direccion = ${alumno.direccion ?? null},
               grado_colegio = ${alumno.gradoColegio ?? null}::grado_colegio, nivel = ${alumno.nivel}::nivel_natacion,
               actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid`;
    } else {
      const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
        INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, correo, direccion, grado_colegio,
                             nivel, estado, creado_en, actualizado_en)
        VALUES (gen_random_uuid(), ${tx.academiaId}::uuid, ${alumno.dni}, ${alumno.nombres}, ${alumno.apellidos},
                ${alumno.fechaNacimiento}::date, ${alumno.telefono}, ${alumno.correo ?? null}, ${alumno.direccion ?? null},
                ${alumno.gradoColegio ?? null}::grado_colegio, ${alumno.nivel}::nivel_natacion, 'CLIENTE'::estado_alumno,
                ${ahora}::timestamptz, ${ahora}::timestamptz)
        RETURNING id::text AS id`;
      const creado = filas[0];
      if (!creado) throw new Error('La inserción del alumno no devolvió ninguna fila.');
      alumnoId = creado.id;
    }

    await tx.cliente.$executeRaw`
      INSERT INTO fichas_medicas (alumno_id, academia_id, tipo_sangre, enfermedades, alergias, medicamentos, seguro,
                                  contacto_emergencia_nombre, contacto_emergencia_telefono, creado_en, actualizado_en)
      VALUES (${alumnoId}::uuid, ${tx.academiaId}::uuid, ${fichaMedica.tipoSangre}::tipo_sangre, ${fichaMedica.enfermedades ?? null},
              ${fichaMedica.alergias ?? null}, ${fichaMedica.medicamentos ?? null}, ${fichaMedica.seguro ?? null},
              ${fichaMedica.contactoEmergencia.nombre}, ${fichaMedica.contactoEmergencia.telefono},
              ${ahora}::timestamptz, ${ahora}::timestamptz)
      ON CONFLICT (academia_id, alumno_id) DO UPDATE
        SET tipo_sangre = EXCLUDED.tipo_sangre, enfermedades = EXCLUDED.enfermedades, alergias = EXCLUDED.alergias,
            medicamentos = EXCLUDED.medicamentos, seguro = EXCLUDED.seguro,
            contacto_emergencia_nombre = EXCLUDED.contacto_emergencia_nombre,
            contacto_emergencia_telefono = EXCLUDED.contacto_emergencia_telefono, actualizado_en = EXCLUDED.actualizado_en`;

    if (menor && apoderado) {
      await tx.cliente.$executeRaw`
        INSERT INTO apoderados (alumno_id, academia_id, nombres, apellidos, dni, telefono, parentesco, correo, creado_en, actualizado_en)
        VALUES (${alumnoId}::uuid, ${tx.academiaId}::uuid, ${apoderado.nombres}, ${apoderado.apellidos}, ${apoderado.dni},
                ${apoderado.telefono}, ${apoderado.parentesco}::parentesco, ${apoderado.correo ?? null},
                ${ahora}::timestamptz, ${ahora}::timestamptz)
        ON CONFLICT (academia_id, alumno_id) DO UPDATE
          SET nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos, dni = EXCLUDED.dni, telefono = EXCLUDED.telefono,
              parentesco = EXCLUDED.parentesco, correo = EXCLUDED.correo, actualizado_en = EXCLUDED.actualizado_en`;
    } else if (cliente) {
      await tx.cliente.$executeRaw`
        DELETE FROM apoderados WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumnoId}::uuid`;
    }
    return alumnoId;
  }

  /**
   * Crea la solicitud con su código y el SHA-256 de su token (el token no se guarda). Si el código ya existe en la academia (choque con
   * un único resultado posible), elige otro dentro de la misma transacción: `ON CONFLICT … DO NOTHING RETURNING` y se mira si volvió una
   * fila. Los demás índices únicos (clave de idempotencia, solicitud en espera del alumno) fallan con `23505`.
   */
  private async crearSolicitud(
    tx: TransaccionAcademia,
    datos: {
      alumnoId: string;
      token: string;
      claveIdempotencia: string;
      ipOrigen: string | null;
      registradaPor: string | null;
      ahora: Date;
    },
  ): Promise<{ id: string; codigo: string }> {
    const hash = hashDeToken(datos.token);
    for (let intento = 0; intento < INTENTOS_DE_CODIGO; intento++) {
      const codigo = nuevoCodigo();
      const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
        INSERT INTO solicitudes_inscripcion (id, academia_id, alumno_id, codigo, token_hash, clave_idempotencia, estado, ip_origen,
                                             registrada_por, creado_en, actualizado_en)
        VALUES (gen_random_uuid(), ${tx.academiaId}::uuid, ${datos.alumnoId}::uuid, ${codigo}, decode(${hash}::text, 'hex'),
                ${datos.claveIdempotencia}::uuid, 'PENDIENTE_PAGO'::estado_solicitud, ${datos.ipOrigen}::inet,
                ${datos.registradaPor}::uuid, ${datos.ahora}::timestamptz, ${datos.ahora}::timestamptz)
        ON CONFLICT ON CONSTRAINT solicitudes_inscripcion_academia_id_codigo_key DO NOTHING
        RETURNING id::text AS id`;
      const creada = filas[0];
      if (creada) return { id: creada.id, codigo };
    }
    throw new Error('No se pudo elegir un código de solicitud libre.');
  }

  private async crearMatricula(
    tx: TransaccionAcademia,
    datos: {
      alumnoId: string;
      solicitudId: string;
      planId: string;
      plan: PlanLeido;
      cotizacion: Cotizacion;
      claseIds: readonly string[];
      reservaVenceEn: Date;
      ahora: Date;
    },
  ): Promise<void> {
    const { cotizacion, plan, ahora } = datos;
    const [anio = '0', mes = '0'] = cotizacion.mes.split('-');
    const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
      INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, solicitud_id, anio, mes, fecha_inicio, fecha_fin, clases_totales,
                              clases_usadas, es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado,
                              reserva_vence_en, creado_en, actualizado_en)
      VALUES (gen_random_uuid(), ${tx.academiaId}::uuid, ${datos.alumnoId}::uuid, ${datos.planId}::uuid, ${datos.solicitudId}::uuid,
              ${Number(anio)}::smallint, ${Number(mes)}::smallint, ${cotizacion.fechaInicio}::date, ${cotizacion.fechaFin}::date,
              ${cotizacion.clasesTotales}::smallint, 0, ${cotizacion.esProporcional}, ${aDecimal(plan.precio)}::numeric(10,2),
              ${plan.clasesPorMes}::smallint, ${aDecimal(cotizacion.monto)}::numeric(10,2), 'RESERVADA'::estado_matricula,
              ${datos.reservaVenceEn}::timestamptz, ${ahora}::timestamptz, ${ahora}::timestamptz)
      RETURNING id::text AS id`;
    const matricula = filas[0];
    if (!matricula) throw new Error('La inserción de la matrícula no devolvió ninguna fila.');
    await tx.cliente.$executeRaw`
      INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
      SELECT ${tx.academiaId}::uuid, ${matricula.id}::uuid, clase.id
        FROM unnest(${[...datos.claseIds]}::uuid[]) AS clase(id)`;
  }

  /**
   * La evidencia de lo que aceptó (criterio 14, D-07): una fila por cada tipo aceptado (los dos obligatorios) y una de `IMAGEN` si el
   * formulario la trae (con su valor), con la versión, "ahora", la IP y quién lo otorga (`TITULAR`, o `APODERADO` si es menor).
   */
  private async crearConsentimientos(
    tx: TransaccionAcademia,
    datos: {
      alumnoId: string;
      solicitudId: string;
      datos: EnviarInscripcion;
      menor: boolean;
      ipOrigen: string | null;
      ahora: Date;
    },
  ): Promise<void> {
    const { consentimientos } = datos.datos;
    const tipos = ['DATOS_PERSONALES', 'DESLINDE'];
    const aceptados = [true, true];
    if (consentimientos.imagen !== undefined) {
      tipos.push('IMAGEN');
      aceptados.push(consentimientos.imagen);
    }
    await tx.cliente.$executeRaw`
      INSERT INTO consentimientos (id, academia_id, alumno_id, solicitud_id, tipo, version, aceptado_en, ip, otorgado_por, aceptado)
      SELECT gen_random_uuid(), ${tx.academiaId}::uuid, ${datos.alumnoId}::uuid, ${datos.solicitudId}::uuid,
             c.tipo::tipo_consentimiento, ${consentimientos.version}, ${datos.ahora}::timestamptz, ${datos.ipOrigen}::inet,
             ${datos.menor ? 'APODERADO' : 'TITULAR'}::otorgante_consentimiento, c.aceptado
        FROM unnest(${tipos}::text[], ${aceptados}::boolean[]) AS c(tipo, aceptado)`;
  }

  /**
   * El error que sale de una transacción que falló por una restricción única, decidido después del `ROLLBACK` por el nombre de la
   * restricción (nunca por el mensaje) y sin releer las filas que la otra transacción pudo cambiar (criterio 32 de 004): la clave de
   * idempotencia repetida es `SOLICITUD_YA_REGISTRADA`; el DNI, la solicitud en espera o la matrícula del mes repetidos, `DNI_YA_REGISTRADO`.
   * Los bloqueos consultivos hacen que esto casi nunca ocurra (una sola conexión y un solo DNI a la vez); es la red de seguridad.
   */
  private async errorDeEscritura(academiaId: string, error: unknown, datos: EnviarInscripcion): Promise<unknown> {
    const restriccion = restriccionDeUnicidadViolada(error);
    if (restriccion === RESTRICCION_DE_CLAVE) {
      return solicitudYaRegistrada(await this.codigoDeLaClave(academiaId, datos));
    }
    if (restriccion !== null && RESTRICCIONES_DE_DNI.includes(restriccion)) return dniYaRegistrado();
    return error;
  }

  /** El código de la solicitud que ya usó esa clave, solo si es de la misma persona; ante cualquier fallo, `null` (nunca un 500). */
  private async codigoDeLaClave(academiaId: string, datos: EnviarInscripcion): Promise<string | null> {
    try {
      return await this.baseDatos.conAcademia(academiaId, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ codigo: string; dni: string }[]>`
          SELECT s.codigo, a.dni
            FROM solicitudes_inscripcion s
            JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
           WHERE s.academia_id = ${tx.academiaId}::uuid AND s.clave_idempotencia = ${datos.claveIdempotencia.toLowerCase()}::uuid`;
        const fila = filas[0];
        return fila && fila.dni === datos.alumno.dni ? fila.codigo : null;
      });
    } catch (error) {
      this.registro.warn(
        { academiaId, error: { tipo: tipoDeError(error) } },
        'No se pudo leer la solicitud de una clave repetida; se responde sin su código',
      );
      return null;
    }
  }

  /**
   * El correo con el enlace de seguimiento, después de confirmar (criterios 27, 51, 52 y 57; DR-13): un envío por cada destinatario
   * distinto (el correo de la persona y el del apoderado), todos con el mismo código y el mismo enlace. Ninguno se espera: la respuesta
   * no depende del proveedor, y cada fallo se registra solo con su tipo (sin el destinatario, el enlace ni el token) y no detiene al otro.
   */
  private enviarCorreos(academia: AcademiaResuelta, datos: EnviarInscripcion, codigo: string, enlace: string): void {
    for (const para of destinatariosDelEnlace(datos)) {
      enviarSinEsperar(
        this.correo,
        {
          academiaId: academia.id,
          para,
          plantilla: 'SEGUIMIENTO_SOLICITUD',
          datos: { nombreAcademia: academia.nombre, codigo, enlace },
        },
        this.registro,
      );
    }
  }
}

interface ResultadoDelEnvio {
  codigo: string;
  token: string;
  reservaVenceEn: Date;
  cotizacion: Cotizacion;
}

/** ¿Se ofrece el plan hoy para ese nivel? Activo, vigente hoy (la fecha es la de Lima) y con el nivel entre los que aplica. */
function planDisponible(plan: PlanLeido, nivel: Parameters<typeof planAplicaAlNivel>[1], hoy: string): boolean {
  return estadoDelPlan(plan, hoy) === 'VIGENTE' && planAplicaAlNivel(plan, nivel);
}

/** Las clases elegidas en el orden pedido, con lo que necesita el conteo de clases restantes. Las que no vienen en `clases` se omiten. */
function clasesElegidas(
  clases: readonly { id: string; diaSemana: number; horaInicio: string }[],
  claseIds: readonly string[],
): ClaseElegida[] {
  const porId = new Map(clases.map((clase) => [clase.id.toLowerCase(), clase]));
  const resultado: ClaseElegida[] = [];
  for (const id of claseIds) {
    const clase = porId.get(id.toLowerCase());
    // Las clases ya pasaron por la validación: el día es de 1 a 7 y la hora, un bloque.
    if (clase) resultado.push({ diaSemana: clase.diaSemana as DiaSemana, horaInicio: clase.horaInicio as Bloque });
  }
  return resultado;
}
