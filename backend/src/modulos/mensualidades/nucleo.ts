import { randomUUID } from 'node:crypto';
import type { DatosRenovacionComprobante, NivelNatacion, RespuestaRenovacion } from '@aquagestion/contratos';
import type { PinoLogger } from 'nestjs-pino';
import { aDecimal, aTextoMonto, montosIguales } from '../../comun/dinero';
import { hoyEnLima } from '../../comun/fechas';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import type { Reloj } from '../../infraestructura/reloj';
import { ipParaAuditoria } from '../auditoria';
import { insertarEnAuditoriaDeAcademia } from '../auditoria/insercion';
import { bloquearActorVigente } from '../autenticacion/actor-vigente';
import { bloquearClasesParaCupo } from '../clases';
import { leerConfiguracion } from '../configuracion/lectura';
import { type ClaseElegida, contarOcupacion, contarReservasDePrioridad } from '../matriculas';
import { confirmarPagoEnTransaccion, type CreadorDeCuentas, totalACobrar } from '../pagos';
import { estadoDelPlan } from '../planes/dominio/plan';
import { cotizarRenovacion } from './dominio/cotizacion';
import { hayCupo } from './dominio/cupo';
import { mesDeTexto, mesesPermitidos, primerDiaDelMes, textoDelMes, ventanaDeRenovacion } from './dominio/ventana';
import {
  alumnoInactivo,
  alumnoNoEncontrado,
  claveYaUsada,
  fechaOperacionNoValida,
  mensualidadYaRegistrada,
  mesNoPermitido,
  montoCambioDelCobro,
  montoDistinto,
  numeroOperacionYaUsado,
  planNoDisponible,
  seleccionNoValida,
  sinClasesEnElMes,
  sinCupoParaRenovar,
} from './errores';
import { planAplicaAlNivel, validarSeleccion } from '../inscripciones/dominio/seleccion';
import { leerPlan } from '../inscripciones/lectura';
import {
  type AlumnoLeido,
  bloquearMatriculasDelAlumno,
  clasesDeLaTitularidad,
  leerAlumno,
  leerPagoDeLaClave,
  leerRespuestaDelPago,
  type PagoDeLaClave,
  registraElMes,
} from './lectura';

/**
 * El registro de una renovación, el mismo para el efectivo y para el comprobante (spec 010a, criterios 6 a 8, 12, 13 y 19; D-03, D-04, D-06, RN-11,
 * RN-28). Sin Nest, dentro de la transacción de quien llama (`conAcademia`). Orden de bloqueos (criterio 13): `bloquearActorVigente` (primera
 * sentencia) → el bloqueo consultivo del DNI → el alumno con `FOR UPDATE` → sus matrículas con `FOR UPDATE`, por id → `bloquearClasesParaCupo` con las
 * clases elegidas, en una sola llamada → «ahora», la configuración, la ocupación y las reservas → las escrituras → la caja, al final (solo el efectivo,
 * dentro de `confirmarPagoEnTransaccion`).
 *
 * Orden de las decisiones (criterio 8): el alumno (404) → la clave (200 o `CLAVE_YA_USADA`) → `ALUMNO_INACTIVO` → `MES_NO_PERMITIDO` →
 * `MENSUALIDAD_YA_REGISTRADA` → `PLAN_NO_DISPONIBLE` → `SELECCION_NO_VALIDA` → `SIN_CLASES_EN_EL_MES` → `SIN_CUPO` → `MONTO_CAMBIO` o
 * `MONTO_DISTINTO` → `FECHA_OPERACION_NO_VALIDA` y `NUMERO_OPERACION_YA_USADO` (solo el comprobante) → la caja (solo el efectivo). Ningún rechazo
 * deja nada escrito: quien llama revierte la transacción.
 *
 * Se bloquean todas las matrículas del alumno y no solo las de M y M+1: M sale de «ahora», que se lee después de los bloqueos (DT-10 de la 007).
 */

export interface DependenciasDelRegistro {
  readonly reloj: Reloj;
  readonly usuarios: CreadorDeCuentas;
  readonly registro: PinoLogger;
}

/** Lo que cambia entre las dos rutas. */
export type ViaDelRegistro =
  | { readonly tipo: 'EFECTIVO'; readonly claveIdempotencia: string; readonly montoMostrado: string }
  | {
      readonly tipo: 'COMPROBANTE';
      readonly datos: DatosRenovacionComprobante;
      /** El número de operación normalizado (ya validado por el contrato). */
      readonly numeroNormalizado: string;
      readonly pagoId: string;
      /** La clave del archivo ya guardado en el almacén. */
      readonly comprobanteClave: string;
    };

export interface PedidoDeRenovacion {
  readonly actor: { readonly id: string; readonly versionToken: number };
  readonly ip: string | null;
  readonly alumnoIdPedido: string;
  readonly mes: string;
  readonly planId: string;
  readonly claseIds: readonly string[];
  readonly via: ViaDelRegistro;
}

export interface ResultadoDelRegistro {
  readonly respuesta: RespuestaRenovacion;
  /** `true` si se creó ahora (201); `false` si ya estaba (200, un reintento con la misma clave). */
  readonly creada: boolean;
}

/** La clave de idempotencia del pedido: la del pago (`pagos_academia_id_clave_idempotencia_key`). */
export function claveDelPedido(via: ViaDelRegistro): string {
  return (via.tipo === 'EFECTIVO' ? via.claveIdempotencia : via.datos.claveIdempotencia).toLowerCase();
}

function mismosIds(a: readonly string[], b: readonly string[]): boolean {
  const ordenadas = [...a].map((id) => id.toLowerCase()).sort();
  const otras = [...b].map((id) => id.toLowerCase()).sort();
  return ordenadas.length === otras.length && ordenadas.every((id, i) => id === otras[i]);
}

/**
 * ¿El pago de esa clave es el mismo de este pedido? Los mismos datos: el mismo alumno, la misma ruta (efectivo o el mismo método), el mismo mes,
 * plan, clases y monto y, en el comprobante, la misma fecha y el mismo número de operación normalizado. Un pago rechazado nunca se repite: la
 * persona manda otro comprobante con otra clave.
 */
function esElMismoPedido(pago: PagoDeLaClave, alumnoId: string, pedido: PedidoDeRenovacion): boolean {
  const { via } = pedido;
  const comun =
    pago.alumnoId === alumnoId &&
    pago.esDeRenovacion &&
    pago.concepto === 'MENSUALIDAD' &&
    pago.mes === pedido.mes &&
    pago.planId === pedido.planId.toLowerCase() &&
    mismosIds(pago.claseIds, pedido.claseIds);
  if (!comun) return false;
  if (via.tipo === 'EFECTIVO') {
    return pago.metodo === 'EFECTIVO' && pago.estado === 'CONFIRMADO' && montosIguales(pago.monto, via.montoMostrado);
  }
  return (
    pago.metodo === via.datos.metodo &&
    pago.estado !== 'RECHAZADO' &&
    montosIguales(pago.monto, via.datos.monto) &&
    pago.fechaOperacion === via.datos.fechaOperacion &&
    pago.numeroOperacionNormalizado === via.numeroNormalizado
  );
}

/**
 * La decisión de la clave de idempotencia (criterio 12), sin bloquear: la respuesta repetida (200) si el pago de esa clave es el mismo pedido,
 * `CLAVE_YA_USADA` si no, y `null` si la clave es nueva. Sirve para la lectura corta del comprobante y para la transacción de escritura.
 */
export async function decidirLaClave(
  tx: TransaccionAcademia,
  pedido: PedidoDeRenovacion,
  alumnoId: string,
): Promise<RespuestaRenovacion | null> {
  const pago = await leerPagoDeLaClave(tx, claveDelPedido(pedido.via));
  if (pago === null) return null;
  if (!esElMismoPedido(pago, alumnoId, pedido)) throw claveYaUsada();
  return leerRespuestaDelPago(tx, pago.id, true);
}

/** El alumno con `FOR UPDATE` (después del bloqueo consultivo): 404 si dejó de existir o es un `CLIENTE`. */
export async function bloquearAlumno(tx: TransaccionAcademia, alumnoId: string): Promise<AlumnoLeido> {
  const filas = await tx.cliente.$queryRaw<
    {
      id: string;
      dni: string;
      nombres: string;
      apellidos: string;
      nivel: NivelNatacion;
      estado: AlumnoLeido['estado'];
    }[]
  >`
    SELECT id::text AS id, dni, nombres, apellidos, nivel::text AS nivel, estado::text AS estado
      FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid
       FOR UPDATE`;
  const alumno = filas[0];
  if (!alumno || alumno.estado === 'CLIENTE') throw alumnoNoEncontrado();
  return alumno;
}

export async function registrarRenovacion(
  tx: TransaccionAcademia,
  deps: DependenciasDelRegistro,
  pedido: PedidoDeRenovacion,
): Promise<ResultadoDelRegistro> {
  const { via } = pedido;
  // 1. El actor sigue vigente: 401 antes que cualquier 404 o 409.
  await bloquearActorVigente(
    tx,
    { id: pedido.actor.id, versionToken: pedido.actor.versionToken },
    { registro: deps.registro, ip: pedido.ip },
  );
  // 2. El alumno (404 con un id que no es UUID, inexistente, de otra academia o de un `CLIENTE`): lectura sin bloqueo, que da el DNI del consultivo.
  const previo = await leerAlumno(tx, pedido.alumnoIdPedido);
  await tx.cliente.$executeRaw`
    SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`inscripcion-dni:${tx.academiaId}:${previo.dni}`}::text, 0))`;
  // 3. El alumno con `FOR UPDATE`.
  const alumno = await bloquearAlumno(tx, previo.id);
  // 4. La clave de idempotencia (criterio 12): decide 200 o 409 antes de todo lo demás, también con la caja cerrada.
  const repetida = await decidirLaClave(tx, pedido, alumno.id);
  if (repetida !== null) return { respuesta: repetida, creada: false };
  // 5. Sus matrículas con `FOR UPDATE`, por id.
  const matriculas = await bloquearMatriculasDelAlumno(tx, alumno.id);
  // 6. Las clases elegidas, en una sola llamada y antes de contar o escribir: quien las tuvo antes ya terminó.
  const claseIds = [...new Set(pedido.claseIds.map((id) => id.toLowerCase()))];
  const bloqueadas = await bloquearClasesParaCupo(tx, claseIds);
  // 7. «Ahora», después de todos los bloqueos (DT-10 de la 007): toda decisión de la transacción usa este instante.
  const ahora = deps.reloj.ahora();
  const hoy = hoyEnLima(ahora);
  const configuracion = await leerConfiguracion(tx, { registro: deps.registro });

  if (alumno.estado === 'INACTIVO') throw alumnoInactivo();

  // El mes (criterio 3): uno de los permitidos con «ahora»; el detalle del error no lista los que ya tienen su mensualidad.
  const ventana = ventanaDeRenovacion(ahora, configuracion.diasPrioridadRenovacion);
  const registrados = new Set(matriculas.filter(registraElMes).map((m) => textoDelMes(m)));
  const permitidos = mesesPermitidos(ahora, configuracion.diasPrioridadRenovacion);
  if (!permitidos.includes(pedido.mes)) throw mesNoPermitido(permitidos.filter((mes) => !registrados.has(mes)));
  if (registrados.has(pedido.mes)) throw mensualidadYaRegistrada();
  const esMesSiguiente = pedido.mes !== textoDelMes(ventana.mes);
  const mes = mesDeTexto(pedido.mes);

  // El plan (criterio 4, DT-5): activo, vigente el día en que empieza la mensualidad y para el nivel actual del alumno.
  const fechaInicio = esMesSiguiente ? primerDiaDelMes(mes) : hoy;
  const plan = await leerPlan(tx, pedido.planId);
  if (!plan || estadoDelPlan(plan, fechaInicio) !== 'VIGENTE' || !planAplicaAlNivel(plan, alumno.nivel)) {
    throw planNoDisponible();
  }
  const errores = validarSeleccion(plan, alumno.nivel, bloqueadas, pedido.claseIds, 'claseIds');
  if (errores.length > 0) throw seleccionNoValida(errores);
  const porId = new Map(bloqueadas.map((clase) => [clase.id, clase]));
  const elegidas: ClaseElegida[] = claseIds.flatMap((id) => {
    const clase = porId.get(id);
    return clase
      ? [
          {
            diaSemana: clase.diaSemana as ClaseElegida['diaSemana'],
            horaInicio: clase.horaInicio as ClaseElegida['horaInicio'],
          },
        ]
      : [];
  });
  const cotizacion = cotizarRenovacion(plan, elegidas, pedido.mes, ahora);
  if (cotizacion.clasesRestantes === 0) throw sinClasesEnElMes();

  // El cupo (criterio 9, DT-4): el del mes siguiente aparta el lugar de los titulares de prioridad y le devuelve al alumno el suyo.
  const ocupacion = await contarOcupacion(tx, claseIds, mes, ahora);
  const reservas = esMesSiguiente
    ? await contarReservasDePrioridad(tx, claseIds, ventana.mes, ahora)
    : new Map<string, number>();
  const titulares = new Set(esMesSiguiente ? await clasesDeLaTitularidad(tx, alumno.id, ventana.mes) : []);
  const sinLugar = bloqueadas
    .filter(
      (clase) =>
        !hayCupo({
          aforo: clase.aforo,
          ocupacion: ocupacion.get(clase.id) ?? 0,
          reservas: reservas.get(clase.id) ?? 0,
          esTitular: titulares.has(clase.id),
          esMesSiguiente,
        }),
    )
    .map((clase) => clase.id)
    .sort();
  if (sinLugar.length > 0) throw sinCupoParaRenovar(sinLugar);
  const conPrioridad = claseIds.filter((id) => titulares.has(id)).sort();

  // El monto: el total de lo que se va a guardar (D-03, una sola vez hacia arriba).
  const total = totalACobrar({ montoCalculado: aDecimal(cotizacion.monto), montoAjustado: null });
  if (via.tipo === 'EFECTIVO') {
    if (!montosIguales(via.montoMostrado, total)) throw montoCambioDelCobro(aTextoMonto(total));
  } else {
    if (!montosIguales(via.datos.monto, total)) throw montoDistinto(aTextoMonto(total));
    // La fecha de la operación (DR-1): ni futura ni anterior al primer día de la ventana (mes siguiente) o al día 1 del mes en curso.
    const primerDia = esMesSiguiente ? ventana.desde : primerDiaDelMes(ventana.mes);
    if (via.datos.fechaOperacion > hoy || via.datos.fechaOperacion < primerDia) throw fechaOperacionNoValida();
    // El número de operación sin duplicados entre los pagos abiertos del mismo método (DR-9 de 007). El índice único lo vuelve a decidir
    // si dos renovaciones de alumnos distintos llegan a la vez (cada una tiene su propio bloqueo del alumno).
    const usados = await tx.cliente.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM pagos
       WHERE academia_id = ${tx.academiaId}::uuid AND metodo = ${via.datos.metodo}::metodo_pago
         AND numero_operacion_normalizado = ${via.numeroNormalizado}
         AND estado IN ('PENDIENTE_VERIFICACION'::estado_pago, 'CONFIRMADO'::estado_pago)
       LIMIT 1`;
    if (usados.length > 0) throw numeroOperacionYaUsado();
  }

  // Escrituras: la matrícula `RESERVADA` sin solicitud ni vencimiento (DT-2, RN-28) y sus clases.
  const matriculaId = randomUUID();
  await tx.cliente.$executeRaw`
    INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, solicitud_id, anio, mes, fecha_inicio, fecha_fin, clases_totales,
                            clases_usadas, es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado,
                            reserva_vence_en, creado_en, actualizado_en)
    VALUES (${matriculaId}::uuid, ${tx.academiaId}::uuid, ${alumno.id}::uuid, ${plan.id}::uuid, NULL,
            ${mes.anio}::smallint, ${mes.mes}::smallint, ${cotizacion.fechaInicio}::date, ${cotizacion.fechaFin}::date,
            ${cotizacion.clasesTotales}::smallint, 0, ${cotizacion.esProporcional}, ${aDecimal(plan.precio)}::numeric(10,2),
            ${plan.clasesPorMes}::smallint, ${aDecimal(cotizacion.monto)}::numeric(10,2), 'RESERVADA'::estado_matricula,
            NULL, ${ahora}::timestamptz, ${ahora}::timestamptz)`;
  await tx.cliente.$executeRaw`
    INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
    SELECT ${tx.academiaId}::uuid, ${matriculaId}::uuid, clase.id
      FROM unnest(${[...claseIds]}::uuid[]) AS clase(id)`;

  let pagoId: string;
  if (via.tipo === 'EFECTIVO') {
    // El ingreso en la caja abierta de hoy (la caja se bloquea al final), el ticket, la matrícula `VIGENTE` y, si es de M, el alumno `ALUMNO_ACTIVO`.
    pagoId = randomUUID();
    await confirmarPagoEnTransaccion(
      tx,
      deps.usuarios,
      {
        pagoId,
        alumnoId: alumno.id,
        matriculaId,
        solicitudId: null,
        concepto: 'MENSUALIDAD',
        metodo: 'EFECTIVO',
        monto: total,
        claveHash: null,
        actor: { id: pedido.actor.id },
        ip: pedido.ip,
        nuevo: { claveIdempotencia: claveDelPedido(via) },
      },
      ahora,
    );
  } else {
    // El pago pendiente: sin caja (el Yape entra al verificarlo, D-04) y sin cambiar el estado del alumno.
    pagoId = via.pagoId;
    await tx.cliente.$executeRaw`
      INSERT INTO pagos (id, academia_id, alumno_id, matricula_id, concepto, metodo, estado, monto, numero_operacion,
                         numero_operacion_normalizado, fecha_operacion, comprobante_clave, ip_origen, registrado_por,
                         registrado_en, clave_idempotencia, creado_en, actualizado_en)
      VALUES (${pagoId}::uuid, ${tx.academiaId}::uuid, ${alumno.id}::uuid, ${matriculaId}::uuid,
              'MENSUALIDAD'::concepto_movimiento_caja, ${via.datos.metodo}::metodo_pago, 'PENDIENTE_VERIFICACION'::estado_pago,
              ${aTextoMonto(total)}::numeric, ${via.datos.numeroOperacion}, ${via.numeroNormalizado}, ${via.datos.fechaOperacion}::date,
              ${via.comprobanteClave}, ${ipParaAuditoria(pedido.ip)}::inet, ${pedido.actor.id}::uuid,
              ${ahora}::timestamptz, ${claveDelPedido(via)}::uuid, ${ahora}::timestamptz, ${ahora}::timestamptz)`;
  }
  // La auditoría de la renovación (DT-18): quién eligió el mes, el plan, las clases y la prioridad. Sin DNI, nombres ni datos médicos.
  await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
    actorTipo: 'USUARIO',
    actorId: pedido.actor.id,
    accion: 'RENOVACION_REGISTRADA',
    entidad: 'matricula',
    entidadId: matriculaId,
    datosDespues: {
      mes: pedido.mes,
      planId: plan.id,
      claseIds: [...claseIds].sort(),
      clasesTotales: cotizacion.clasesTotales,
      total: aTextoMonto(total),
      metodo: via.tipo === 'EFECTIVO' ? 'EFECTIVO' : via.datos.metodo,
      conPrioridad,
    },
    ip: pedido.ip,
  });
  return { respuesta: await leerRespuestaDelPago(tx, pagoId, false), creada: true };
}
