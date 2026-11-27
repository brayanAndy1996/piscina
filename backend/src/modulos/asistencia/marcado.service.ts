import { Inject, Injectable } from '@nestjs/common';
import {
  CODIGOS_RECHAZO_ASISTENCIA,
  type CodigoRechazoAsistencia,
  type MetodoAsistencia,
  rechazoAsistenciaSchema,
  type ResultadoAsistencia,
  resultadoAsistenciaSchema,
  tokenDelContenidoQr,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { horaEnLima, hoyEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { BaseDatos, restriccionDeUnicidadViolada, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { alumnoNoEncontrado, leerFotoComoData } from '../alumnos';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { leerConfiguracion } from '../configuracion/lectura';
import { decidirMarcado, decidirPosterior } from './dominio/validaciones';
import { dentroDeLaVentana, diaIsoEnLima, ventanaDeLaClase } from './dominio/ventana';
import { claveYaUsada, qrNoReconocido, rechazoDeAsistencia } from './errores';
import {
  bloquearAlumnoPorId,
  bloquearAlumnoPorToken,
  bloquearClasesDeLaMatricula,
  bloquearFaltasDelDia,
  bloquearMatriculaDelDia,
  cubreElDia,
  type FilaDeAsistencia,
  type FilaDeClase,
  type FilaDelAlumno,
  hayPagoEnVerificacion,
  leerAsistenciaDeHoy,
  leerAsistenciaPorClave,
  leerClase,
  leerClasesDeLaMatricula,
  leerClasesDelDia,
} from './lectura';

/**
 * De dónde sale el alumno y qué se registra: el contenido del QR (el token sale solo de él), el id de la búsqueda (criterios 2 y 5) o, en el registro
 * posterior de la 009b (criterio 28), el id del alumno con el día que se corrige, la hora a la que llegó y el motivo.
 */
export type EntradaDeMarcado =
  | { readonly tipo: 'QR'; readonly contenido: string }
  | { readonly tipo: 'MANUAL'; readonly alumnoId: string }
  | {
      readonly tipo: 'POSTERIOR';
      readonly alumnoId: string;
      readonly fecha: string;
      readonly horaLlegada: string;
      readonly motivo: string;
    };

/** Lo que responde el marcado: el resultado y si se creó ahora (201) o ya estaba (200, un reintento con la misma clave). */
export interface ResultadoDelMarcado {
  readonly resultado: ResultadoAsistencia;
  readonly creado: boolean;
}

/** Las restricciones únicas que, al chocar, indican que otra transacción llegó antes: se vuelve a decidir con lo que ya se confirmó. */
const RESTRICCION_UN_DIA = 'asistencias_un_dia_key';
const RESTRICCION_CLAVE = 'asistencias_academia_id_clave_idempotencia_key';
const INTENTOS_ANTE_UNA_CARRERA = 2;

interface ClasesDeLaMatricula {
  usadas: number;
  totales: number;
  restantes: number;
}

type SalidaDeLaTransaccion =
  | {
      readonly tipo: 'REGISTRO';
      readonly alumno: FilaDelAlumno;
      readonly creado: boolean;
      readonly asistencia: ResultadoAsistencia['asistencia'];
      readonly clase: ResultadoAsistencia['clase'];
      readonly clases: ClasesDeLaMatricula;
    }
  | {
      readonly tipo: 'RECHAZO';
      readonly alumno: FilaDelAlumno;
      readonly codigo: CodigoRechazoAsistencia;
      readonly claseDeHoy: { horaInicio: string; horaFin: string } | null;
      readonly asistenciaDeHoy: {
        horaLlegada: string;
        estadoLlegada: 'PUNTUAL' | 'TARDE';
        metodo: MetodoAsistencia;
      } | null;
      readonly clases: ClasesDeLaMatricula | null;
    };

/**
 * El marcado de asistencia por QR y manual (spec 009a, criterios 2 a 18; HU-14, HU-15, RN-14 a RN-16, D-11, D-16). La academia sale siempre de la
 * sesión. Un solo caso de uso, en una sola transacción de la academia y en este orden (criterio 14):
 *
 * 1. `bloquearActorVigente` (401 antes que cualquier 404 o 409).
 * 2. El alumno con `FOR SHARE`, por token (solo `tokenDelContenidoQr` y `(academia, qr_token)`; DT-4) o por id: sin fila, 404.
 * 3. La clave de idempotencia: ya usada por el mismo alumno, 200 con la misma asistencia; por otro, 409 `CLAVE_YA_USADA`.
 * 4. La matrícula del día con `FOR UPDATE` (DT-5), el punto de orden del descuento y de «una por día». Con ella tomada se vuelve a mirar la clave:
 *    dos peticiones con la misma clave esperaron aquí y la segunda debe responder 200, no 409 (criterio 13).
 * 5. «Ahora» (después de todos los bloqueos, DT-16), la tolerancia de la academia (`leerConfiguracion(tx)`), la asistencia de hoy, el pago en
 *    verificación y la clase del día; `decidirMarcado` (puro) elige el código del criterio 7 o «registrar».
 * 6. Si registra: `INSERT` de la asistencia y `UPDATE` de `clases_usadas`. La asistencia no mueve cupo: nunca se toma `clases` con `FOR UPDATE` ni `FOR SHARE`.
 *
 * Desde la 009b (criterio 37, DT-22), entre la matrícula y «ahora» se toman las clases de la matrícula con `FOR KEY SHARE` (el mismo modo de la llave
 * foránea del `INSERT`): una espera detrás de un cobro, una cancelación o una inscripción que cruza el fin de la clase responde `FUERA_DE_HORARIO` y no
 * registra con la hora de antes. El registro posterior (criterio 28, D-16) usa el mismo caso de uso con la fecha D en lugar de hoy, y toma además la
 * falta de esa clase y fecha con `FOR UPDATE`, que cubre con su asistencia; sí audita (`ASISTENCIA_POSTERIOR_REGISTRADA`, criterio 29). La clave de
 * idempotencia solo repite un registro del mismo alumno **y** del mismo tipo (marcado o posterior, criterio 36).
 *
 * La transacción devuelve un valor (registro o rechazo) y no lanza el rechazo: la foto se lee **después** de cerrarla (DT-11) y recién entonces se
 * arma el 201, el 200 o el 409 con `detalles`. Un choque de unicidad (`asistencias_un_dia_key` o la clave) se resuelve con el nombre de la
 * restricción, después del `ROLLBACK`, volviendo a decidir con lo que la otra transacción confirmó. No audita: la fila ya dice quién, cuándo y
 * cómo (criterio 18); el posterior sí. Nunca se escribe en el registro técnico el contenido del QR, el token ni el DNI (criterio 17).
 */
@Injectable()
export class MarcadoService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
    private readonly auditoria: AuditoriaService,
  ) {
    this.registro.setContext(MarcadoService.name);
  }

  async marcar(
    sesion: SesionVerificada,
    entrada: EntradaDeMarcado,
    claveIdempotencia: string,
    ip: string | null,
  ): Promise<ResultadoDelMarcado> {
    const actor = actorDeSesion(sesion);
    const clave = claveIdempotencia.toLowerCase();
    // Antes de la transacción solo se saca el token; un contenido sin la forma responde 404 dentro de ella, después de `bloquearActorVigente`.
    const token = entrada.tipo === 'QR' ? tokenDelContenidoQr(entrada.contenido) : null;

    let salida: SalidaDeLaTransaccion | undefined;
    for (let intento = 1; salida === undefined; intento++) {
      try {
        salida = await this.baseDatos.conAcademia(actor.academiaId, (tx) =>
          this.decidirYRegistrar(tx, actor, entrada, token, clave, ip),
        );
      } catch (error) {
        const restriccion = restriccionDeUnicidadViolada(error);
        const reintentable = restriccion === RESTRICCION_UN_DIA || restriccion === RESTRICCION_CLAVE;
        if (reintentable && intento < INTENTOS_ANTE_UNA_CARRERA) continue;
        if (restriccion === RESTRICCION_UN_DIA) throw rechazoDeAsistencia('ASISTENCIA_YA_REGISTRADA');
        if (restriccion === RESTRICCION_CLAVE) throw claveYaUsada();
        throw error;
      }
    }
    return this.responder(actor.academiaId, salida);
  }

  private async decidirYRegistrar(
    tx: TransaccionAcademia,
    actor: ReturnType<typeof actorDeSesion>,
    entrada: EntradaDeMarcado,
    token: string | null,
    clave: string,
    ip: string | null,
  ): Promise<SalidaDeLaTransaccion> {
    const posterior = entrada.tipo === 'POSTERIOR';

    // 1. El actor sigue vigente: su 401 gana a cualquier 404 o 409 (criterio 6).
    await bloquearActorVigente(tx, { id: actor.id, versionToken: actor.versionToken }, { registro: this.registro, ip });

    // 2. El alumno, con `FOR SHARE` (criterio 14).
    const alumno = await this.bloquearAlumno(tx, entrada, token);

    // 3. La clave ya usada (fila c del criterio 7): del mismo alumno y del mismo tipo de registro, 200; si no, 409 (criterio 36).
    const previa = await leerAsistenciaPorClave(tx, clave);
    if (previa) return this.repetir(tx, alumno, previa, posterior);

    // 4. La matrícula del día, con `FOR UPDATE`. El día se elige con un «ahora» provisional (o es la fecha del posterior); el definitivo se lee después.
    const diaProvisional = entrada.tipo === 'POSTERIOR' ? entrada.fecha : hoyEnLima(this.reloj.ahora());
    const bloqueada = await bloquearMatriculaDelDia(tx, alumno.id, diaProvisional);
    if (bloqueada) {
      // Quien esperaba esta matrícula pudo ser una petición con la misma clave: lo que confirmó ya se ve (lectura comprometida).
      const confirmada = await leerAsistenciaPorClave(tx, clave);
      if (confirmada) return this.repetir(tx, alumno, confirmada, posterior);
      // Las clases de la matrícula con `FOR KEY SHARE`, antes de leer «ahora»: el `INSERT` ya no espera ninguna fila después de la hora (criterio 37).
      await bloquearClasesDeLaMatricula(tx, bloqueada.id);
      // La falta de esa clase y fecha, para cubrirla (criterio 28).
      if (entrada.tipo === 'POSTERIOR') await bloquearFaltasDelDia(tx, alumno.id, entrada.fecha);
    }

    // 5. «Ahora», después de todos los bloqueos (DT-16): si el día cambió durante la espera, la matrícula bloqueada ya no es la del día.
    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    const dia = entrada.tipo === 'POSTERIOR' ? entrada.fecha : hoy;
    const matricula = bloqueada && cubreElDia(bloqueada, dia) ? bloqueada : null;
    const configuracion = await leerConfiguracion(tx, { registro: this.registro });
    const asistenciaDelDia = await leerAsistenciaDeHoy(tx, alumno.id, dia);
    const pagoEnVerificacion = !posterior && matricula === null && (await hayPagoEnVerificacion(tx, alumno.id, dia));
    const clasesDelDia = matricula ? await leerClasesDelDia(tx, matricula.id, diaIsoEnLima(dia)) : [];
    const clase = elegirClase(clasesDelDia, dia, ahora);
    const datosDeLaMatricula = matricula
      ? {
          clasesTotales: matricula.clases_totales,
          clasesUsadas: matricula.clases_usadas,
          creadaEn: matricula.creado_en,
        }
      : null;
    const claseDelRechazo = clase ? { horaInicio: clase.hora_inicio, horaFin: clase.hora_fin } : null;
    // Para decidir, la clase suma cuándo entró a la matrícula (010c, criterio 38); la respuesta no la lleva.
    const claseParaDecidir = clase
      ? { horaInicio: clase.hora_inicio, horaFin: clase.hora_fin, agregadaEn: clase.agregada_en ?? null }
      : null;

    const decision =
      entrada.tipo === 'POSTERIOR'
        ? decidirPosterior({
            ahora,
            hoy,
            fecha: entrada.fecha,
            horaLlegada: entrada.horaLlegada,
            toleranciaMinutos: configuracion.toleranciaTardanzaMinutos,
            alumnoInactivo: alumno.estado === 'INACTIVO',
            yaTieneAsistencia: asistenciaDelDia !== null,
            matricula: datosDeLaMatricula,
            clase: claseParaDecidir,
          })
        : decidirMarcado({
            ahora,
            hoy,
            toleranciaMinutos: configuracion.toleranciaTardanzaMinutos,
            alumnoInactivo: alumno.estado === 'INACTIVO',
            yaMarcoHoy: asistenciaDelDia !== null,
            matricula: datosDeLaMatricula,
            pagoEnVerificacion,
            claseDeHoy: claseParaDecidir,
          });

    if (decision.tipo === 'RECHAZO') {
      return {
        tipo: 'RECHAZO',
        alumno,
        codigo: decision.codigo,
        claseDeHoy: claseDelRechazo,
        asistenciaDeHoy: asistenciaDelDia
          ? {
              horaLlegada: horaEnLima(asistenciaDelDia.llegada_en),
              estadoLlegada: asistenciaDelDia.estado_llegada,
              metodo: asistenciaDelDia.metodo,
            }
          : null,
        clases: matricula ? contar(matricula.clases_usadas, matricula.clases_totales) : null,
      };
    }

    // 6. Registrar: la fila y el descuento, en la misma transacción.
    if (matricula === null || clase === null)
      throw new Error('Una asistencia se registra con la matrícula y la clase del día.');
    const llegadaEn: Date = decision.llegadaEn ?? ahora;
    const metodo = entrada.tipo === 'QR' ? 'QR' : 'MANUAL';
    const motivo = entrada.tipo === 'POSTERIOR' ? entrada.motivo : null;
    const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
      INSERT INTO asistencias (academia_id, alumno_id, matricula_id, clase_id, fecha, llegada_en, registrado_en, metodo, estado_llegada,
                               registrado_por, registro_posterior, motivo, clave_idempotencia)
      VALUES (${tx.academiaId}::uuid, ${alumno.id}::uuid, ${matricula.id}::uuid, ${clase.id}::uuid, ${dia}::date, ${llegadaEn}::timestamptz,
              ${ahora}::timestamptz, ${metodo}::metodo_asistencia, ${decision.estadoLlegada}::estado_llegada, ${actor.id}::uuid,
              ${posterior}::boolean, ${motivo}::text, ${clave}::uuid)
      RETURNING id::text AS id`;
    const asistenciaId = filas[0]?.id;
    if (asistenciaId === undefined) throw new Error('El INSERT de la asistencia no devolvió la fila.');
    const descontadas = await tx.cliente.$queryRaw<{ clases_usadas: number; clases_totales: number }[]>`
      UPDATE matriculas SET clases_usadas = clases_usadas + 1, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${matricula.id}::uuid
       RETURNING clases_usadas::int AS clases_usadas, clases_totales::int AS clases_totales`;
    const despues = descontadas[0];
    if (!despues) throw new Error('El UPDATE de la matrícula no devolvió la fila.');

    if (entrada.tipo === 'POSTERIOR') {
      // Si la tarea ya registró la falta de esa clase y fecha, queda cubierta por esta asistencia (criterio 28); la auditoría nace en la misma transacción (criterio 29).
      const cubiertas = await tx.cliente.$queryRaw<{ id: string }[]>`
        UPDATE inasistencias SET asistencia_id = ${asistenciaId}::uuid, cubierta_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumno.id}::uuid AND clase_id = ${clase.id}::uuid
           AND fecha = ${dia}::date AND asistencia_id IS NULL
         RETURNING id::text AS id`;
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'ASISTENCIA_POSTERIOR_REGISTRADA',
        entidad: 'asistencia',
        entidadId: asistenciaId,
        motivo: entrada.motivo,
        datosDespues: {
          alumnoId: alumno.id,
          claseId: clase.id,
          fecha: dia,
          horaLlegada: horaEnLima(llegadaEn),
          estadoLlegada: decision.estadoLlegada,
          faltaCubierta: cubiertas.length > 0,
        },
        ip,
      });
    }

    return {
      tipo: 'REGISTRO',
      alumno,
      creado: true,
      asistencia: {
        id: asistenciaId,
        fecha: dia,
        horaLlegada: horaEnLima(llegadaEn),
        llegadaEn: llegadaEn.toISOString(),
        estadoLlegada: decision.estadoLlegada,
        metodo,
        registroPosterior: posterior,
      },
      clase: datosDeLaClase(clase),
      clases: contar(despues.clases_usadas, despues.clases_totales),
    };
  }

  /** El alumno con `FOR SHARE`, o el 404 que corresponde a la vía: `QR_NO_RECONOCIDO` por QR y `NO_ENCONTRADO` por id (criterios 3 y 5). */
  private async bloquearAlumno(
    tx: TransaccionAcademia,
    entrada: EntradaDeMarcado,
    token: string | null,
  ): Promise<FilaDelAlumno> {
    if (entrada.tipo === 'QR') {
      const alumno = token === null ? null : await bloquearAlumnoPorToken(tx, token);
      if (!alumno) throw qrNoReconocido();
      return alumno;
    }
    // Un id que no es UUID no se consulta: el mismo 404 que uno inexistente, de otra academia o de un cliente.
    const alumno = PATRON_UUID.test(entrada.alumnoId) ? await bloquearAlumnoPorId(tx, entrada.alumnoId) : null;
    if (!alumno) throw alumnoNoEncontrado();
    return alumno;
  }

  /**
   * El reintento con una clave que ya registró una asistencia: de otro alumno o de otro tipo de registro (marcado contra posterior), 409; del mismo alumno
   * y del mismo tipo, el mismo resultado (criterios 13 y 36). Entre QR y manual vale el 200: los dos son marcado.
   */
  private async repetir(
    tx: TransaccionAcademia,
    alumno: FilaDelAlumno,
    previa: FilaDeAsistencia,
    posterior: boolean,
  ): Promise<SalidaDeLaTransaccion> {
    if (previa.alumno_id !== alumno.id || previa.registro_posterior !== posterior) throw claveYaUsada();
    const clase = await leerClase(tx, previa.clase_id);
    const matricula = await leerClasesDeLaMatricula(tx, previa.matricula_id);
    if (!clase || !matricula) throw new Error('La asistencia guardada no tiene su clase o su matrícula.');
    return {
      tipo: 'REGISTRO',
      alumno,
      creado: false,
      asistencia: {
        id: previa.id,
        fecha: previa.fecha,
        horaLlegada: horaEnLima(previa.llegada_en),
        llegadaEn: previa.llegada_en.toISOString(),
        estadoLlegada: previa.estado_llegada,
        metodo: previa.metodo,
        registroPosterior: previa.registro_posterior,
      },
      clase: datosDeLaClase(clase),
      clases: contar(matricula.clases_usadas, matricula.clases_totales),
    };
  }

  /** Fuera de la transacción: la foto del alumno (con la academia de la sesión) y el 201, el 200 o el 409 con sus `detalles`. */
  private async responder(academiaId: string, salida: SalidaDeLaTransaccion): Promise<ResultadoDelMarcado> {
    const foto = await leerFotoComoData(this.almacen, this.registro, academiaId, salida.alumno.foto_clave);
    const alumno = {
      id: salida.alumno.id,
      nombres: salida.alumno.nombres,
      apellidos: salida.alumno.apellidos,
      nivel: salida.alumno.nivel,
      foto,
    };
    if (salida.tipo === 'RECHAZO') {
      const detalles = rechazoAsistenciaSchema.parse({
        alerta: CODIGOS_RECHAZO_ASISTENCIA[salida.codigo],
        alumno,
        claseDeHoy: salida.claseDeHoy,
        asistenciaDeHoy: salida.asistenciaDeHoy,
        clases: salida.clases,
      });
      throw rechazoDeAsistencia(salida.codigo, detalles);
    }
    const resultado = resultadoAsistenciaSchema.parse({
      asistencia: salida.asistencia,
      alumno,
      clase: salida.clase,
      clases: salida.clases,
      repetida: !salida.creado,
    });
    return { resultado, creado: salida.creado };
  }
}

function contar(usadas: number, totales: number): ClasesDeLaMatricula {
  return { usadas, totales, restantes: totales - usadas };
}

function datosDeLaClase(clase: FilaDeClase): ResultadoAsistencia['clase'] {
  return {
    id: clase.id,
    nivel: clase.nivel,
    diaSemana: clase.dia_semana as ResultadoAsistencia['clase']['diaSemana'],
    horaInicio: clase.hora_inicio,
    horaFin: clase.hora_fin,
  };
}

/** La clase de hoy: la que está en curso si hay más de una (no debería, DR-4 de 005) y, si no, la primera. `null` sin clase hoy. */
function elegirClase(clases: readonly FilaDeClase[], hoy: string, ahora: Date): FilaDeClase | null {
  const enCurso = clases.find((clase) =>
    dentroDeLaVentana(ahora, ventanaDeLaClase(hoy, clase.hora_inicio, clase.hora_fin)),
  );
  return enCurso ?? clases[0] ?? null;
}
