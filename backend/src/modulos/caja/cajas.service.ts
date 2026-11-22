import { Inject, Injectable } from '@nestjs/common';
import type {
  AbrirCaja,
  CerrarCaja,
  ReabrirCaja,
  RegistrarEgreso,
  RespuestaCaja,
  RespuestaCajaActual,
  RespuestaEgreso,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { aDecimal, aTextoMonto, montosIguales } from '../../comun/dinero';
import { hoyEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import {
  BaseDatos,
  errorParaRegistro,
  restriccionDeUnicidadViolada,
  type Fragmento,
  sql,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { insertarEnAuditoriaDeAcademia } from '../auditoria/insercion';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { esCierreTardio } from './dominio/dia';
import { calcularDiferencia } from './dominio/esperado';
import {
  cajaCambio,
  cajaCerrada,
  cajaDelDiaCerrada,
  cajaPendienteDeCierre,
  cajaYaAbierta,
  claveYaUsada,
  hayOtraCajaAbierta,
  noEncontrado,
  observacionObligatoria,
} from './errores';
import { leerCaja, leerResumen } from './lectura';
import { bloquearCaja, registrarEgresoEnCaja } from './movimientos';

/** Los choques de los índices únicos que la apertura traduce a su 409 (regla «El 409 de un choque» de 004). */
const RESTRICCION_UNA_ABIERTA = 'cajas_una_abierta_por_academia';
const RESTRICCION_UNA_POR_DIA = 'cajas_academia_id_fecha_key';
const RESTRICCION_CLAVE_DE_CAJA = 'cajas_academia_id_clave_idempotencia_key';
const RESTRICCION_CLAVE_DE_EGRESO = 'movimientos_caja_academia_id_clave_idempotencia_key';
const RESTRICCION_CLAVE_DE_CIERRE = 'cierres_caja_academia_id_clave_idempotencia_key';
const RESTRICCION_UN_CIERRE_VIGENTE = 'cierres_caja_un_vigente_por_caja';

/**
 * El bloqueo consultivo `'caja:' || academia_id`, el segundo en el orden de bloqueos (después del actor, antes de la fila de la caja): ordena
 * la apertura y la reapertura, las dos operaciones que pueden dejar una caja abierta. Un solo sitio para que el orden no se desvíe.
 */
async function bloquearCajasDeLaAcademia(tx: TransaccionAcademia): Promise<void> {
  await tx.cliente.$executeRaw`
    SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`caja:${tx.academiaId}`}::text, 0))`;
}

interface FilaDeCaja {
  id: string;
  fecha: string;
  monto_inicial: string;
}

/** Resultado de la apertura: la caja y si se creó ahora (201) o ya existía con esa clave (200). */
export interface ResultadoDeApertura {
  readonly caja: RespuestaCaja['caja'];
  readonly creada: boolean;
}

/** Resultado del egreso: el movimiento y la caja como están ahora, y si se registró ahora (201) o ya existía con esa clave (200). */
export interface ResultadoDeEgreso {
  readonly respuesta: RespuestaEgreso;
  readonly creado: boolean;
}

/**
 * La caja del día (spec 006a; HU-25 a HU-27, RN-17, RN-22; D-04, D-23). Todo corre con `conAcademia(<academia de la sesión>, …)`: la academia
 * nunca viene de la dirección, la consulta ni el cuerpo. Cada escritura va en una sola transacción, con este orden de bloqueos (el de la
 * 007: la caja, al final):
 * 1. `bloquearActorVigente`, primera sentencia (DT-5 de 002);
 * 2. solo la apertura y la reapertura: el bloqueo consultivo `'caja:' || academia_id`, que ordena las dos operaciones que pueden dejar una caja
 *    abierta y decide los 409 de la apertura en un orden fijo;
 * 3. la fila de la caja con `FOR UPDATE` (egreso, cierre y reapertura);
 * 4. escrituras y auditoría. Ninguna transacción de esta historia bloquea `alumnos`, `solicitudes_inscripcion`, `matriculas` ni `clases`.
 *
 * Los 23505 que lleguen igual (una escritura fuera del bloqueo) se traducen por el nombre de la restricción después del `ROLLBACK`: nunca un
 * 500. Las respuestas de una clave repetida no escriben ni auditan (regla de idempotencia). El servicio no guarda nada entre peticiones.
 */
@Injectable()
export class CajasService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(CajasService.name);
  }

  /**
   * `GET /api/cajas/actual` (criterio 28): la caja `ABIERTA` de la academia (de hoy o de otro día); si no hay, la de hoy ya cerrada; si
   * tampoco, `null`. Lectura sin bloqueos, sin escritura y sin auditoría.
   */
  async actual(academiaId: string): Promise<RespuestaCajaActual> {
    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    const caja = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM cajas
         WHERE academia_id = ${tx.academiaId}::uuid AND (estado = 'ABIERTA'::estado_caja OR fecha = ${hoy}::date)
         ORDER BY CASE WHEN estado = 'ABIERTA'::estado_caja THEN 0 ELSE 1 END
         LIMIT 1`;
      const fila = filas[0];
      return fila ? leerCaja(tx, fila.id, ahora) : null;
    });
    return { caja };
  }

  /**
   * `POST /api/cajas` (criterios 10 a 16): abre la caja de hoy. Orden de los errores: `CLAVE_YA_USADA` (o el 200 de la clave repetida) →
   * `CAJA_YA_ABIERTA` → `CAJA_PENDIENTE_DE_CIERRE` → `CAJA_DEL_DIA_CERRADA`. La fecha sale del reloj en America/Lima, nunca del cliente.
   */
  async abrir(sesion: SesionVerificada, datos: AbrirCaja, ip: string | null): Promise<ResultadoDeApertura> {
    const academiaId = sesion.usuario.academiaId;
    try {
      return await this.abrirEnTransaccion(sesion, datos, ip);
    } catch (error) {
      // La misma clave en dos transacciones a la vez que no se ordenaron en el bloqueo consultivo: la segunda ya ve la caja de la primera.
      if (restriccionDeUnicidadViolada(error) === RESTRICCION_CLAVE_DE_CAJA) {
        try {
          return await this.abrirEnTransaccion(sesion, datos, ip);
        } catch (otro) {
          throw await this.traducirChoque(otro, academiaId, 'apertura');
        }
      }
      throw await this.traducirChoque(error, academiaId, 'apertura');
    }
  }

  private abrirEnTransaccion(
    sesion: SesionVerificada,
    datos: AbrirCaja,
    ip: string | null,
  ): Promise<ResultadoDeApertura> {
    const actor = actorDeSesion(sesion);
    return this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      await bloquearCajasDeLaAcademia(tx);
      const ahora = this.reloj.ahora();
      const hoy = hoyEnLima(ahora);

      const conLaClave = await tx.cliente.$queryRaw<FilaDeCaja[]>`
        SELECT id::text AS id, fecha::text AS fecha, monto_inicial::text AS monto_inicial FROM cajas
         WHERE academia_id = ${tx.academiaId}::uuid AND clave_idempotencia = ${datos.claveIdempotencia}::uuid`;
      const repetida = conLaClave[0];
      if (repetida) {
        if (!montosIguales(repetida.monto_inicial, datos.montoInicial)) throw claveYaUsada();
        const caja = await leerCaja(tx, repetida.id, ahora);
        if (!caja) throw noEncontrado();
        return { caja, creada: false };
      }

      const abiertas = await tx.cliente.$queryRaw<FilaDeCaja[]>`
        SELECT id::text AS id, fecha::text AS fecha, monto_inicial::text AS monto_inicial FROM cajas
         WHERE academia_id = ${tx.academiaId}::uuid AND estado = 'ABIERTA'::estado_caja`;
      const abierta = abiertas[0];
      if (abierta) {
        throw abierta.fecha === hoy
          ? cajaYaAbierta(abierta.id, abierta.fecha)
          : cajaPendienteDeCierre(abierta.id, abierta.fecha);
      }

      const delDia = await tx.cliente.$queryRaw<FilaDeCaja[]>`
        SELECT id::text AS id, fecha::text AS fecha, monto_inicial::text AS monto_inicial FROM cajas
         WHERE academia_id = ${tx.academiaId}::uuid AND fecha = ${hoy}::date`;
      const cerradaDeHoy = delDia[0];
      if (cerradaDeHoy) throw cajaDelDiaCerrada(cerradaDeHoy.id, cerradaDeHoy.fecha);

      const montoInicial = aTextoMonto(aDecimal(datos.montoInicial));
      const creadas = await tx.cliente.$queryRaw<{ id: string }[]>`
        INSERT INTO cajas (academia_id, fecha, estado, monto_inicial, abierta_por, abierta_en, clave_idempotencia, actualizado_en)
        VALUES (${tx.academiaId}::uuid, ${hoy}::date, 'ABIERTA'::estado_caja, ${montoInicial}::numeric, ${actor.id}::uuid,
                ${ahora}::timestamptz, ${datos.claveIdempotencia}::uuid, ${ahora}::timestamptz)
        RETURNING id::text AS id`;
      const creada = creadas[0];
      if (!creada) throw new Error('La apertura de la caja no devolvió fila.');
      await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'CAJA_ABIERTA',
        entidad: 'caja',
        entidadId: creada.id,
        datosDespues: { fecha: hoy, montoInicial },
        ip,
      });
      const caja = await leerCaja(tx, creada.id, ahora);
      if (!caja) throw noEncontrado();
      return { caja, creada: true };
    });
  }

  /**
   * `POST /api/cajas/{id}/egresos` (criterios 17 a 22): `registrarEgresoEnCaja` con la caja de la dirección (D4: el egreso nunca cae en una
   * caja distinta de la que la persona tiene en pantalla) y, después, la caja como está ahora con el movimiento. El `{id}` lo valida la
   * transacción después de `bloquearActorVigente`: un id que no es UUID responde el mismo 404 que uno inexistente o de otra academia.
   */
  async registrarEgreso(
    sesion: SesionVerificada,
    idPedido: string,
    datos: RegistrarEgreso,
    ip: string | null,
  ): Promise<ResultadoDeEgreso> {
    const actor = actorDeSesion(sesion);
    try {
      return await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
        await bloquearActorVigente(
          tx,
          { id: actor.id, versionToken: actor.versionToken },
          { registro: this.registro, ip },
        );
        const ahora = this.reloj.ahora();
        const registrado = await registrarEgresoEnCaja(
          tx,
          {
            cajaId: idPedido,
            claveIdempotencia: datos.claveIdempotencia,
            descripcion: datos.descripcion,
            monto: aDecimal(datos.monto),
            comprobante: datos.comprobante,
            usuarioId: actor.id,
            ip,
          },
          ahora,
        );
        const caja = await leerCaja(tx, registrado.cajaId, ahora);
        const movimiento = caja?.movimientos.find((candidato) => candidato.id === registrado.id);
        if (!caja || !movimiento) throw noEncontrado();
        return { respuesta: { movimiento, caja }, creado: !registrado.repetido };
      });
    } catch (error) {
      throw await this.traducirChoque(error, actor.academiaId, 'egreso');
    }
  }

  /**
   * `POST /api/cajas/{id}/cierre` (criterios 29 a 34): calcula el resumen con los movimientos de la caja (ya bloqueada), crea el cierre con la
   * foto de lo calculado, pasa la caja a `CERRADA` y audita, todo en una transacción. Orden de los errores: 404 → `CLAVE_YA_USADA` (o el 200
   * de la clave repetida, aunque la caja se haya reabierto) → `CAJA_CERRADA` → `CAJA_CAMBIO` → 400 `observacion`.
   */
  async cerrar(
    sesion: SesionVerificada,
    idPedido: string,
    datos: CerrarCaja,
    ip: string | null,
  ): Promise<RespuestaCaja> {
    const actor = actorDeSesion(sesion);
    try {
      return await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
        await bloquearActorVigente(
          tx,
          { id: actor.id, versionToken: actor.versionToken },
          { registro: this.registro, ip },
        );
        const ahora = this.reloj.ahora();
        const caja = await bloquearCaja(tx, idPedido);
        if (!caja) throw noEncontrado();

        const previos = await tx.cliente.$queryRaw<{ caja_id: string; monto_declarado: string }[]>`
          SELECT caja_id::text AS caja_id, monto_declarado::text AS monto_declarado FROM cierres_caja
           WHERE academia_id = ${tx.academiaId}::uuid AND clave_idempotencia = ${datos.claveIdempotencia}::uuid`;
        const previo = previos[0];
        if (previo) {
          if (previo.caja_id !== caja.id || !montosIguales(previo.monto_declarado, datos.montoDeclarado)) {
            throw claveYaUsada();
          }
          return this.respuestaDeCaja(tx, caja.id, ahora);
        }

        if (caja.estado === 'CERRADA') throw cajaCerrada();
        const resumen = await leerResumen(tx, caja.id, caja.monto_inicial);
        if (resumen.ultimoMovimiento !== datos.ultimoMovimientoVisto) throw cajaCambio(resumen.ultimoMovimiento);
        const declarado = aDecimal(datos.montoDeclarado);
        const { diferencia, resultado } = calcularDiferencia(declarado, resumen.montos.esperado.efectivo);
        const observacion = datos.observacion ?? null;
        if (!diferencia.isZero() && observacion === null) throw observacionObligatoria();

        const numeros = await tx.cliente.$queryRaw<{ numero: number }[]>`
          SELECT (coalesce(max(numero), 0) + 1)::int AS numero FROM cierres_caja
           WHERE academia_id = ${tx.academiaId}::uuid AND caja_id = ${caja.id}::uuid`;
        const numero = numeros[0]?.numero ?? 1;
        const tardio = esCierreTardio(caja.fecha, ahora);
        const esperado = {
          efectivo: aTextoMonto(resumen.montos.esperado.efectivo),
          yape: aTextoMonto(resumen.montos.esperado.yape),
          transferencia: aTextoMonto(resumen.montos.esperado.transferencia),
        };
        await tx.cliente.$executeRaw`
          INSERT INTO cierres_caja (academia_id, caja_id, numero, movimientos_hasta, monto_inicial, ingresos_efectivo, ingresos_yape,
                                    ingresos_transferencia, egresos_efectivo, esperado_efectivo, monto_declarado, diferencia, observacion,
                                    tardio, cerrado_por, cerrado_en, clave_idempotencia, creado_en)
          VALUES (${tx.academiaId}::uuid, ${caja.id}::uuid, ${numero}::smallint, ${resumen.ultimoMovimiento}::int,
                  ${aTextoMonto(caja.monto_inicial)}::numeric, ${aTextoMonto(resumen.montos.ingresos.efectivo)}::numeric,
                  ${aTextoMonto(resumen.montos.ingresos.yape)}::numeric, ${aTextoMonto(resumen.montos.ingresos.transferencia)}::numeric,
                  ${aTextoMonto(resumen.montos.egresos.efectivo)}::numeric, ${esperado.efectivo}::numeric,
                  ${aTextoMonto(declarado)}::numeric, ${aTextoMonto(diferencia)}::numeric, ${observacion}, ${tardio}::boolean,
                  ${actor.id}::uuid, ${ahora}::timestamptz, ${datos.claveIdempotencia}::uuid, ${ahora}::timestamptz)`;
        await tx.cliente.$executeRaw`
          UPDATE cajas SET estado = 'CERRADA'::estado_caja, actualizado_en = ${ahora}::timestamptz
           WHERE academia_id = ${tx.academiaId}::uuid AND id = ${caja.id}::uuid`;
        await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
          actorTipo: 'USUARIO',
          actorId: actor.id,
          accion: 'CAJA_CERRADA',
          entidad: 'caja',
          entidadId: caja.id,
          datosDespues: {
            numeroCierre: numero,
            esperado,
            montoDeclarado: aTextoMonto(declarado),
            diferencia: aTextoMonto(diferencia),
            resultado,
            observacion,
            tardio,
          },
          ip,
        });
        return this.respuestaDeCaja(tx, caja.id, ahora);
      });
    } catch (error) {
      throw await this.traducirChoque(error, actor.academiaId, 'cierre');
    }
  }

  /**
   * `POST /api/cajas/{id}/reapertura` (criterios 35 y 36; solo el administrador, `REABRIR_CAJA`): el cierre vigente guarda quién, cuándo y el
   * motivo, y la caja pasa a `ABIERTA`. Orden: 404 → 200 si ya está abierta (sin escribir ni auditar) → 409 `HAY_OTRA_CAJA_ABIERTA`. Toma
   * el bloqueo consultivo de la academia antes que la fila de la caja, como la apertura, para que nunca queden dos cajas abiertas.
   */
  async reabrir(
    sesion: SesionVerificada,
    idPedido: string,
    datos: ReabrirCaja,
    ip: string | null,
  ): Promise<RespuestaCaja> {
    const actor = actorDeSesion(sesion);
    try {
      return await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
        await bloquearActorVigente(
          tx,
          { id: actor.id, versionToken: actor.versionToken },
          { registro: this.registro, ip },
        );
        if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
        await bloquearCajasDeLaAcademia(tx);
        const ahora = this.reloj.ahora();
        const caja = await bloquearCaja(tx, idPedido);
        if (!caja) throw noEncontrado();
        if (caja.estado === 'ABIERTA') return this.respuestaDeCaja(tx, caja.id, ahora);

        const otras = await tx.cliente.$queryRaw<{ id: string; fecha: string }[]>`
          SELECT id::text AS id, fecha::text AS fecha FROM cajas
           WHERE academia_id = ${tx.academiaId}::uuid AND estado = 'ABIERTA'::estado_caja AND id <> ${caja.id}::uuid`;
        const otra = otras[0];
        if (otra) throw hayOtraCajaAbierta(otra.id, otra.fecha);

        // `reabierto_en` nunca precede a `cerrado_en` (CHECK `cierres_caja_reapertura_posterior`): con el reloj de otra instancia unos
        // milisegundos atrás, o tras un ajuste de la hora del servidor, se toma el instante del cierre en lugar de fallar con un 500.
        const reabiertos = await tx.cliente.$queryRaw<
          { numero: number; monto_declarado: string; diferencia: string; reabierto_en: Date }[]
        >`
          UPDATE cierres_caja
             SET reabierto_por = ${actor.id}::uuid, reabierto_en = GREATEST(${ahora}::timestamptz, cerrado_en),
                 motivo_reapertura = ${datos.motivo}
           WHERE academia_id = ${tx.academiaId}::uuid AND caja_id = ${caja.id}::uuid AND reabierto_en IS NULL
          RETURNING numero::int AS numero, monto_declarado::text AS monto_declarado, diferencia::text AS diferencia,
                    reabierto_en`;
        const cierre = reabiertos[0];
        // Una caja `CERRADA` tiene siempre un cierre vigente (lo garantizan el cierre y las pruebas): si no lo tiene, algo escribió fuera del servicio.
        if (!cierre) throw new Error('La caja cerrada no tiene un cierre vigente que reabrir.');
        // La misma hora que quedó en `reabierto_en` (la de `ahora`, o la del cierre si el `GREATEST` la subió) para la caja y la auditoría.
        const reabiertoEn = cierre.reabierto_en;
        await tx.cliente.$executeRaw`
          UPDATE cajas SET estado = 'ABIERTA'::estado_caja, actualizado_en = ${reabiertoEn}::timestamptz
           WHERE academia_id = ${tx.academiaId}::uuid AND id = ${caja.id}::uuid`;
        await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, reabiertoEn, {
          actorTipo: 'USUARIO',
          actorId: actor.id,
          accion: 'CAJA_REABIERTA',
          entidad: 'caja',
          entidadId: caja.id,
          motivo: datos.motivo,
          datosAntes: {
            estado: 'CERRADA',
            numeroCierre: cierre.numero,
            montoDeclarado: aTextoMonto(cierre.monto_declarado),
            diferencia: aTextoMonto(cierre.diferencia),
          },
          datosDespues: { estado: 'ABIERTA' },
          ip,
        });
        return this.respuestaDeCaja(tx, caja.id, ahora);
      });
    } catch (error) {
      throw await this.traducirChoque(error, actor.academiaId, 'reapertura');
    }
  }

  private async respuestaDeCaja(tx: TransaccionAcademia, cajaId: string, ahora: Date): Promise<RespuestaCaja> {
    const caja = await leerCaja(tx, cajaId, ahora);
    if (!caja) throw noEncontrado();
    return { caja };
  }

  /**
   * El error que se responde cuando una escritura choca con un índice único (23505) que la lógica no alcanzó a decidir, por el nombre de la
   * restricción y después del `ROLLBACK` (regla «El 409 de un choque» de 004): nunca un 500. Para afinar el 409 de la apertura se relee la
   * caja en otra transacción; si esa lectura falla, se responde el 409 sin detalles. Cualquier otro error sube tal cual.
   */
  private async traducirChoque(
    error: unknown,
    academiaId: string,
    operacion: 'apertura' | 'egreso' | 'cierre' | 'reapertura',
  ): Promise<unknown> {
    const restriccion = restriccionDeUnicidadViolada(error);
    if (restriccion === null) return error;
    switch (restriccion) {
      case RESTRICCION_CLAVE_DE_CAJA:
      case RESTRICCION_CLAVE_DE_EGRESO:
      case RESTRICCION_CLAVE_DE_CIERRE:
        return claveYaUsada();
      case RESTRICCION_UN_CIERRE_VIGENTE:
        return cajaCerrada();
      case RESTRICCION_UNA_ABIERTA: {
        const abierta = await this.cajaDeLaRestriccion(academiaId, sql`estado = 'ABIERTA'::estado_caja`);
        if (operacion === 'reapertura') return hayOtraCajaAbierta(abierta?.id, abierta?.fecha);
        if (abierta !== null && abierta.fecha !== hoyEnLima(this.reloj.ahora())) {
          return cajaPendienteDeCierre(abierta.id, abierta.fecha);
        }
        return cajaYaAbierta(abierta?.id, abierta?.fecha);
      }
      case RESTRICCION_UNA_POR_DIA: {
        const delDia = await this.cajaDeLaRestriccion(academiaId, sql`fecha = ${hoyEnLima(this.reloj.ahora())}::date`);
        return cajaDelDiaCerrada(delDia?.id, delDia?.fecha);
      }
      default:
        return error;
    }
  }

  /** La caja (id y fecha) que cumple la condición, leída en una transacción nueva; `null` si no se encuentra o la lectura falla. */
  private async cajaDeLaRestriccion(
    academiaId: string,
    condicion: Fragmento,
  ): Promise<{ id: string; fecha: string } | null> {
    try {
      return await this.baseDatos.conAcademia(academiaId, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ id: string; fecha: string }[]>`
          SELECT id::text AS id, fecha::text AS fecha FROM cajas
           WHERE academia_id = ${tx.academiaId}::uuid AND ${condicion}
           ORDER BY fecha DESC LIMIT 1`;
        return filas[0] ?? null;
      });
    } catch (error) {
      this.registro.warn(
        { error: errorParaRegistro(error) },
        'No se pudo releer la caja del choque; se responde el 409 sin detalles',
      );
      return null;
    }
  }
}
