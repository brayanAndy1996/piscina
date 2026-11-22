import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Los límites de generación del PDF del cierre, por proceso (spec 006b, criterio 49 b y c; DT-8): como mucho `simultaneos` PDF se generan a la
 * vez y como mucho `enEspera` descargas más esperan su turno, en orden de llegada. Contando todas las academias de la instancia.
 */
export const LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8 } as const;

/** Cuántas descargas del PDF puede tener una misma persona en curso o esperando turno a la vez (criterio 49 c): un doble clic sigue funcionando. */
export const LIMITE_PDF_POR_PERSONA = 2;

/** Lo que devuelve `turno`: libera el lugar. Se puede llamar más de una vez; solo la primera cuenta. */
export type LiberarTurno = () => void;

/**
 * La cola de generación del PDF del cierre (spec 006b, criterio 49 b y c). Una sola instancia por proceso de la API (proveedor de Nest): lleva
 * cuántas generaciones hay en curso, la fila de las que esperan (en orden de llegada) y cuántas tiene cada persona en curso o en espera. Es
 * memoria del proceso, como los contadores de `@nestjs/throttler` (PO-6): con varias instancias de la API, cada una tiene los suyos.
 *
 * Quien la usa (`HistorialService.pdf`) envuelve con ella su propia llamada al generador inyectado, no el generador real, así que vale también
 * con el generador de las pruebas, y pide el turno antes de abrir la transacción de lectura: una descarga que espera no tiene ninguna
 * transacción abierta, y una cola llena responde 429 sin leer nada.
 *
 * Orden de las dos comprobaciones: primero el límite por persona (`sesion.usuario.id`, no la academia ni la IP) y después el lugar en la cola.
 * Los dos son 429 `DEMASIADAS_SOLICITUDES` por el filtro de errores; ninguno llama al generador.
 */
@Injectable()
export class ColaPdfCierre {
  private enCurso = 0;
  /** La fila de espera, en orden de llegada: cada elemento da el turno a su descarga cuando le toca. */
  private readonly espera: (() => void)[] = [];
  private readonly porPersona = new Map<string, number>();

  /**
   * Pide un turno para generar un PDF. Resuelve con la función que lo libera cuando hay lugar para generar (enseguida si hay menos de
   * `simultaneos` en curso; si no, cuando le toque, en orden de llegada). Lanza `HttpException(429)` si la persona ya tiene
   * `LIMITE_PDF_POR_PERSONA` descargas en curso o esperando, o si ya hay `simultaneos` en curso y `enEspera` esperando. Quien obtiene el turno
   * debe liberarlo en un `finally`.
   */
  async turno(usuarioId: string): Promise<LiberarTurno> {
    if ((this.porPersona.get(usuarioId) ?? 0) >= LIMITE_PDF_POR_PERSONA) throw demasiadasSolicitudes();
    const hayLugarYa = this.enCurso < LIMITES_PDF_CIERRE.simultaneos;
    if (!hayLugarYa && this.espera.length >= LIMITES_PDF_CIERRE.enEspera) throw demasiadasSolicitudes();

    this.porPersona.set(usuarioId, (this.porPersona.get(usuarioId) ?? 0) + 1);
    if (hayLugarYa) {
      this.enCurso += 1;
    } else {
      await new Promise<void>((otorgar) => this.espera.push(otorgar));
    }
    return this.crearLiberacion(usuarioId);
  }

  /** Cuántas generaciones hay en curso y cuántas descargas esperan (para las pruebas y los registros). */
  get estado(): { enCurso: number; enEspera: number } {
    return { enCurso: this.enCurso, enEspera: this.espera.length };
  }

  private crearLiberacion(usuarioId: string): LiberarTurno {
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      const restantes = (this.porPersona.get(usuarioId) ?? 1) - 1;
      if (restantes <= 0) this.porPersona.delete(usuarioId);
      else this.porPersona.set(usuarioId, restantes);
      // El lugar pasa al primero de la fila (`enCurso` no cambia); si nadie espera, queda libre.
      const siguiente = this.espera.shift();
      if (siguiente) siguiente();
      else this.enCurso -= 1;
    };
  }
}

/** El 429 que el filtro de errores convierte en `DEMASIADAS_SOLICITUDES` con su mensaje de siempre. */
function demasiadasSolicitudes(): HttpException {
  return new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
}
