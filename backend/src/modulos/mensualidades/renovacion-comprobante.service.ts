import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  COMPROBANTE_LADO_GUARDADO,
  type DatosRenovacionComprobante,
  datosRenovacionComprobanteSchema,
  DATOS_RENOVACION_LARGO_MAXIMO,
  type FotoTipo,
  normalizarNumeroOperacion,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { recodificarImagen } from '../../comun/http/recodificar-imagen';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { tipoDeError } from '../../infraestructura/correo';
import {
  BaseDatos,
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  restriccionDeUnicidadViolada,
  type TransaccionAcademia,
} from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { solicitudInvalida } from '../inscripciones/errores';
import { numeroOperacionYaUsado } from '../pagos/errores';
import { UsuariosService } from '../usuarios/usuarios.service';
import { leerAlumno, leerRespuestaDelPago } from './lectura';
import { decidirLaClave, type PedidoDeRenovacion, registrarRenovacion, type ResultadoDelRegistro } from './nucleo';
import { errorDeRestriccion, RESTRICCIONES_DE_CARRERA } from './renovacion.service';

/** Lo máximo que espera la relectura de `resolverConfirmacionIncierta` a que termine la transacción del registro (criterio 61 de 005). */
const ESPERA_RELECTURA_MS = 5000;

/** Las decisiones de la propia transacción (409, 404, 401, academia): con ellas es seguro que no se confirmó nada. */
function esRechazoDeLaTransaccion(error: unknown): boolean {
  return (
    error instanceof ErrorAcademiaNoEncontrada ||
    error instanceof ErrorAcademiaSuspendida ||
    error instanceof ErrorNegocio
  );
}

/**
 * La renovación con el comprobante de Yape o transferencia (spec 010a, criterios 7, 8, 12 y 13; HU-08, HU-12, RN-04, RN-28, D-04). Es una ruta con
 * sesión de `ADMIN` o `SECRETARIA`: recepción sube la foto que le muestra o le envía el alumno. Orden de las comprobaciones (las de la sesión, el
 * permiso, el tipo y el tamaño las deciden el middleware, el guard y el lector binario antes de leer el cuerpo, criterio 8):
 *
 * 1. `X-Renovacion-Datos` (`datosRenovacionComprobanteSchema`): 400 `SOLICITUD_INVALIDA`.
 * 2. Una lectura corta, sin bloqueos del alumno y sin tocar archivos: `bloquearActorVigente` (401), el alumno (404) y la clave de idempotencia (200
 *    con la renovación ya registrada o 409 `CLAVE_YA_USADA`).
 * 3. La imagen, fuera de toda transacción: firma, `sharp`, lados y megapíxeles (400 `IMAGEN_NO_VALIDA`), recodificada como JPEG de como mucho
 *    2000 píxeles y sin metadatos. Se guarda con `academias/{academiaId}/pagos/{pagoId}/comprobante-{uuid}.jpg` **antes** de la transacción (un
 *    archivo sin referencia no lo ve nadie; una referencia a un archivo que no existe, sí).
 * 4. La transacción de escritura (`registrarRenovacion`): bloquea en el orden de la regla, decide otra vez con lo ya confirmado y escribe la matrícula
 *    `RESERVADA` sin vencimiento, sus clases, el pago `PENDIENTE_VERIFICACION` y la auditoría. No toca la caja ni el estado del alumno.
 * 5. Si la transacción rechazó (o ya existía: 200), se borra el archivo nuevo. Con cualquier otro error no se sabe si el `COMMIT` llegó: se relee el
 *    pago por su id (criterios 61 y 64 de 005) y se decide con lo que se ve. Un comprobante guardado nunca se borra después (es evidencia).
 */
@Injectable()
export class RenovacionComprobanteService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly usuarios: UsuariosService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(RenovacionComprobanteService.name);
  }

  /** `datosCrudos` es la cabecera cruda: cualquier cosa que no tenga su forma exacta es un 400, nunca un error del servidor. */
  async registrar(
    sesion: SesionVerificada,
    alumnoIdPedido: string,
    datosCrudos: unknown,
    cuerpo: Buffer,
    tipo: FotoTipo,
    ip: string | null,
  ): Promise<ResultadoDelRegistro> {
    const actor = actorDeSesion(sesion);
    const datos = this.leerDatos(datosCrudos);
    const numeroNormalizado = normalizarNumeroOperacion(datos.numeroOperacion);
    if (numeroNormalizado === null) {
      throw solicitudInvalida([{ campo: 'numeroOperacion', mensaje: 'El número de operación no es válido.' }]);
    }
    const pagoId = randomUUID();
    const clave = `academias/${actor.academiaId}/pagos/${pagoId}/comprobante-${randomUUID()}.jpg`;
    const pedido: PedidoDeRenovacion = {
      actor: { id: actor.id, versionToken: actor.versionToken },
      ip,
      alumnoIdPedido,
      mes: datos.mes,
      planId: datos.planId,
      claseIds: datos.claseIds,
      via: { tipo: 'COMPROBANTE', datos, numeroNormalizado, pagoId, comprobanteClave: clave },
    };

    // Lectura corta (actor, alumno y clave): una clave repetida responde sin procesar la imagen.
    const yaRegistrada = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      const alumno = await leerAlumno(tx, alumnoIdPedido);
      return decidirLaClave(tx, pedido, alumno.id);
    });
    if (yaRegistrada !== null) return { respuesta: yaRegistrada, creada: false };

    // La imagen, fuera de toda transacción.
    const jpeg = await recodificarImagen(cuerpo, tipo, COMPROBANTE_LADO_GUARDADO);
    const guardado = await Promise.resolve()
      .then(() => this.almacen.guardar(actor.academiaId, clave, jpeg, 'image/jpeg'))
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    if (!guardado.ok) {
      this.registro.error(
        { academiaId: actor.academiaId, error: { tipo: tipoDeError(guardado.error) } },
        'No se pudo guardar el comprobante',
      );
      // Un error nuevo y sin causa: el del almacén lleva la ruta. La respuesta es 500 `ERROR_INTERNO` y la base no cambió.
      throw new Error('No se pudo guardar el comprobante de la renovación.');
    }

    let resultado: ResultadoDelRegistro;
    try {
      resultado = await this.escribir(actor.academiaId, pedido);
    } catch (error) {
      const decidido = this.rechazoDeLaBase(error);
      if (decidido !== null || esRechazoDeLaTransaccion(error)) {
        // Lo decidió la propia transacción (409, 404, 401, academia o un índice único): es seguro que no se confirmó nada.
        await this.borrarSinFallar(actor.academiaId, clave);
        throw decidido ?? error;
      }
      return this.resolverConfirmacionIncierta(actor.academiaId, pagoId, clave, error);
    }
    // Un reintento que ganó la carrera (200): el archivo nuevo no lo referencia nadie.
    if (!resultado.creada) await this.borrarSinFallar(actor.academiaId, clave);
    else this.registro.info({ academiaId: actor.academiaId }, 'Comprobante de la renovación guardado');
    return resultado;
  }

  /**
   * `X-Renovacion-Datos`: un JSON ASCII de hasta 2048 bytes que cumple `datosRenovacionComprobanteSchema` (criterio 7). Sin la cabecera, repetida
   * (Node la junta con una coma y deja de ser un JSON), de otro tipo, con bytes fuera de ASCII, demasiado larga o que no es JSON: 400
   * `SOLICITUD_INVALIDA`; un valor que no cumple el esquema: 400 con los campos.
   */
  private leerDatos(crudos: unknown): DatosRenovacionComprobante {
    if (typeof crudos !== 'string' || crudos.trim() === '') {
      throw solicitudInvalida([{ campo: '', mensaje: 'Faltan los datos del pago (cabecera X-Renovacion-Datos).' }]);
    }
    if (Buffer.byteLength(crudos, 'latin1') > DATOS_RENOVACION_LARGO_MAXIMO) {
      throw solicitudInvalida([{ campo: '', mensaje: 'Los datos del pago son demasiado largos.' }]);
    }
    if (Array.from(crudos).some((caracter) => (caracter.codePointAt(0) ?? 0) > 0x7f)) {
      throw solicitudInvalida([{ campo: '', mensaje: 'Los datos del pago solo pueden llevar caracteres ASCII.' }]);
    }
    let valor: unknown;
    try {
      valor = JSON.parse(crudos);
    } catch {
      throw solicitudInvalida([{ campo: '', mensaje: 'Los datos del pago no son un JSON válido.' }]);
    }
    // Un `ZodError` lo convierte el filtro de errores en el 400 con `detalles.errores[].campo`.
    return datosRenovacionComprobanteSchema.parse(valor);
  }

  /** Los índices únicos que, al chocar en el `INSERT`, dicen por qué se rechazó: el nombre del índice, nunca un 500. */
  private rechazoDeLaBase(error: unknown): Error | null {
    if (restriccionDeUnicidadViolada(error) === 'pagos_numero_operacion_abierto_key') return numeroOperacionYaUsado();
    return errorDeRestriccion(error);
  }

  /**
   * La transacción de escritura. Con una carrera por la clave o por el mes que otra transacción ya tomó, se vuelve a decidir una vez con lo que
   * esa transacción confirmó (200 repetida o 409 `MENSUALIDAD_YA_REGISTRADA`); si el choque sigue, el 409 de su restricción.
   */
  private async escribir(academiaId: string, pedido: PedidoDeRenovacion): Promise<ResultadoDelRegistro> {
    for (let intento = 0; ; intento++) {
      try {
        return await this.baseDatos.conAcademia(academiaId, (tx: TransaccionAcademia) =>
          registrarRenovacion(tx, { reloj: this.reloj, usuarios: this.usuarios, registro: this.registro }, pedido),
        );
      } catch (error) {
        const restriccion = restriccionDeUnicidadViolada(error);
        if (restriccion !== null && RESTRICCIONES_DE_CARRERA.includes(restriccion) && intento === 0) continue;
        throw error;
      }
    }
  }

  /**
   * La transacción terminó con un error que no decidió ella (de la base, de la conexión, del `COMMIT`): no se sabe si el `COMMIT` llegó (criterios 61
   * y 64 de 005). No se borra ningún archivo todavía: se relee el pago por su id en una transacción nueva de la academia que no escribe nada, con
   * `FOR SHARE` (espera a que la transacción del registro termine) y `lock_timeout` de `ESPERA_RELECTURA_MS`. Si el pago está con esta clave de
   * archivo, el registro quedó (201 y el archivo se conserva); si no está, no quedó (se borra el archivo nuevo y se relanza el error original, 500);
   * si la relectura falla o la espera se agota, no se borra nada y se relanza el error original. La clave del archivo lleva un UUID nuevo: si el pago
   * no está ahora, no lo estará nunca, y borrarla es seguro.
   */
  private async resolverConfirmacionIncierta(
    academiaId: string,
    pagoId: string,
    clave: string,
    errorOriginal: unknown,
  ): Promise<ResultadoDelRegistro> {
    try {
      this.registro.warn(
        { academiaId, error: { tipo: tipoDeError(errorOriginal) } },
        'Confirmación del comprobante de la renovación incierta',
      );
    } catch {
      // Un registro que falla no cambia la respuesta.
    }
    let respuesta: Awaited<ReturnType<typeof leerRespuestaDelPago>> | null;
    try {
      respuesta = await this.baseDatos.conAcademia(
        academiaId,
        async (tx) => {
          const filas = await tx.cliente.$queryRaw<{ comprobante_clave: string | null }[]>`
            SELECT comprobante_clave FROM pagos
             WHERE academia_id = ${tx.academiaId}::uuid AND id = ${pagoId}::uuid
               FOR SHARE`;
          if (filas[0]?.comprobante_clave !== clave) return null;
          return leerRespuestaDelPago(tx, pagoId, false);
        },
        // `lock_timeout` local a esta transacción (como `SET LOCAL`, que los módulos no pueden ejecutar): la espera agotada es `55P03`.
        { esperaMaximaDeBloqueoMs: ESPERA_RELECTURA_MS },
      );
    } catch {
      // Ni la base ni la academia responden: no se sabe nada, no se borra nada (queda, como mucho, un archivo sin referencia).
      throw errorOriginal;
    }
    if (respuesta === null) {
      await this.borrarSinFallar(academiaId, clave);
      throw errorOriginal;
    }
    this.registro.info({ academiaId }, 'Comprobante de la renovación guardado');
    return { respuesta, creada: true };
  }

  /** Borra un archivo nuevo que nadie referencia: un borrado que falla deja un aviso con el tipo del error y nada más. */
  private async borrarSinFallar(academiaId: string, clave: string): Promise<void> {
    try {
      await this.almacen.borrar(academiaId, clave);
    } catch (error) {
      try {
        this.registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, 'No se pudo borrar un archivo');
      } catch {
        // Un registro que falla no cambia la respuesta.
      }
    }
  }
}
