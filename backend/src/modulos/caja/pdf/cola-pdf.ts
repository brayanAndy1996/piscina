import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { errorDeAborto } from './aborto';

/**
 * Los límites de generación del PDF del cierre, por proceso (spec 006b, criterios 49 b y c y 52; DT-8 y DT-11):
 * - `simultaneos`: cuántos PDF se generan a la vez, contando todas las academias de la instancia;
 * - `enEspera`: cuántas descargas más esperan su turno, en orden de llegada;
 * - `porPersona`: cuántas descargas puede tener una misma persona en curso o esperando (un doble clic sigue funcionando);
 * - `porAcademia`: cuántas puede tener una misma academia en curso o esperando, sumando a todas sus personas (un `ADMIN` puede crear cuentas).
 */
export const LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8, porPersona: 2, porAcademia: 4 } as const;

/** Lo que devuelve `turno`: libera el lugar. Se puede llamar más de una vez; solo la primera cuenta. */
export type LiberarTurno = () => void;

/** Quién pide el turno: la persona y la academia de la sesión (nunca la de la dirección). */
export interface SolicitanteDeTurno {
  readonly usuarioId: string;
  readonly academiaId: string;
}

/**
 * Un pedido en la fila. `esperando` mientras no le toca; `otorgado` cuando recibió el lugar (desde ese momento el lugar es de quien llamó y se
 * libera con `LiberarTurno`); `retirado` si su señal se activó antes de que le tocara. Todo ocurre en el mismo hilo, así que este estado decide
 * la carrera entre otorgar el turno y abortar: gana lo que ocurrió primero y un lugar nunca se pierde ni se duplica.
 */
interface Pedido {
  estado: 'esperando' | 'otorgado' | 'retirado';
  readonly otorgar: () => void;
}

/**
 * La cola de generación del PDF del cierre (spec 006b, criterios 49 b y c, 51 y 52). Una sola instancia por proceso de la API (proveedor de Nest):
 * lleva cuántas generaciones hay en curso, la fila de las que esperan (en orden de llegada) y cuántas tiene cada persona y cada academia en curso o
 * en espera. Es memoria del proceso, como los contadores de `@nestjs/throttler` (PO-6): con varias instancias de la API, cada una tiene los suyos.
 *
 * Quien la usa (`HistorialService.pdf`) envuelve con ella su propia llamada al generador inyectado, no el generador real, así que vale también
 * con el generador de las pruebas, y pide el turno antes de abrir la transacción de lectura: una descarga que espera no tiene ninguna
 * transacción abierta, y una cola llena responde 429 sin leer nada.
 *
 * Orden de las tres comprobaciones: la persona (`sesion.usuario.id`, no la academia ni la IP), la academia (`sesion.usuario.academiaId`) y el lugar
 * en la cola. Los tres son el mismo 429 `DEMASIADAS_SOLICITUDES` por el filtro de errores (no dicen qué límite se alcanzó); ninguno llama al
 * generador y un pedido rechazado no suma en ningún contador.
 *
 * Una descarga abandonada (criterio 51) libera su lugar: si su señal se activa mientras espera, sale de la fila y descuenta persona y academia.
 */
@Injectable()
export class ColaPdfCierre {
  private enCurso = 0;
  /** La fila de espera, en orden de llegada. Solo tiene pedidos `esperando`: el que se retira sale al instante. */
  private readonly espera: Pedido[] = [];
  private readonly porPersona = new Map<string, number>();
  private readonly porAcademia = new Map<string, number>();

  /**
   * Pide un turno para generar un PDF. Resuelve con la función que lo libera cuando hay lugar para generar (enseguida si hay menos de
   * `simultaneos` en curso; si no, cuando le toque, en orden de llegada). Lanza `HttpException(429)` si la persona ya tiene `porPersona`
   * descargas en curso o esperando, si su academia ya tiene `porAcademia`, o si ya hay `simultaneos` en curso y `enEspera` esperando. Quien obtiene
   * el turno debe liberarlo en un `finally`.
   *
   * Con `senal`: si ya está activa al llamar, rechaza con un `AbortError` sin contar nada; si se activa mientras espera, el pedido sale de la fila,
   * descuenta persona y academia y rechaza con un `AbortError`. Si se activa después de otorgado el turno, no hace nada: el lugar es de quien
   * llama.
   */
  async turno(solicitante: SolicitanteDeTurno, senal?: AbortSignal): Promise<LiberarTurno> {
    if (senal?.aborted) throw errorDeAborto();
    const { usuarioId, academiaId } = solicitante;
    if ((this.porPersona.get(usuarioId) ?? 0) >= LIMITES_PDF_CIERRE.porPersona) throw demasiadasSolicitudes();
    if ((this.porAcademia.get(academiaId) ?? 0) >= LIMITES_PDF_CIERRE.porAcademia) throw demasiadasSolicitudes();
    const hayLugarYa = this.enCurso < LIMITES_PDF_CIERRE.simultaneos;
    if (!hayLugarYa && this.espera.length >= LIMITES_PDF_CIERRE.enEspera) throw demasiadasSolicitudes();

    sumar(this.porPersona, usuarioId);
    sumar(this.porAcademia, academiaId);
    if (hayLugarYa) {
      this.enCurso += 1;
    } else {
      await this.esperarTurno(solicitante, senal);
    }
    return this.crearLiberacion(solicitante);
  }

  /** Cuántas generaciones hay en curso y cuántas descargas esperan. Hoy lo leen solo las pruebas. */
  get estado(): { enCurso: number; enEspera: number } {
    return { enCurso: this.enCurso, enEspera: this.espera.length };
  }

  /** Entra a la fila y resuelve cuando le toca; si su señal se activa antes, sale de la fila, descuenta sus cupos y rechaza con `AbortError`. */
  private esperarTurno(solicitante: SolicitanteDeTurno, senal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolver, rechazar) => {
      const alAbortar = () => {
        if (pedido.estado !== 'esperando') return;
        pedido.estado = 'retirado';
        const posicion = this.espera.indexOf(pedido);
        if (posicion !== -1) this.espera.splice(posicion, 1);
        restar(this.porPersona, solicitante.usuarioId);
        restar(this.porAcademia, solicitante.academiaId);
        rechazar(errorDeAborto());
      };
      const pedido: Pedido = {
        estado: 'esperando',
        otorgar: () => {
          pedido.estado = 'otorgado';
          senal?.removeEventListener('abort', alAbortar);
          resolver();
        },
      };
      this.espera.push(pedido);
      senal?.addEventListener('abort', alAbortar, { once: true });
    });
  }

  private crearLiberacion({ usuarioId, academiaId }: SolicitanteDeTurno): LiberarTurno {
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      restar(this.porPersona, usuarioId);
      restar(this.porAcademia, academiaId);
      // El lugar pasa al primero de la fila (`enCurso` no cambia); si nadie espera, queda libre. Todo pedido de la fila sigue `esperando`: el que
      // se retira sale de ella en el mismo momento.
      const siguiente = this.espera.shift();
      if (siguiente) siguiente.otorgar();
      else this.enCurso -= 1;
    };
  }
}

function sumar(contador: Map<string, number>, clave: string): void {
  contador.set(clave, (contador.get(clave) ?? 0) + 1);
}

function restar(contador: Map<string, number>, clave: string): void {
  const restantes = (contador.get(clave) ?? 1) - 1;
  if (restantes <= 0) contador.delete(clave);
  else contador.set(clave, restantes);
}

/** El 429 que el filtro de errores convierte en `DEMASIADAS_SOLICITUDES` con su mensaje de siempre. */
function demasiadasSolicitudes(): HttpException {
  return new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
}
