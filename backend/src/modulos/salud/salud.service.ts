import { Injectable } from '@nestjs/common';
import type { RespuestaSalud } from '@aquagestion/contratos';
import { BaseDatos } from '../../infraestructura/prisma';

/** Tiempo máximo de espera de la base de datos, en milisegundos. */
export const LIMITE_BASE_DATOS_MS = 2000;

@Injectable()
export class SaludService {
  constructor(private readonly baseDatos: BaseDatos) {}

  /** Comprueba la conexión (`BaseDatos.comprobarConexion`) con un límite de 2 s. Nunca lanza: una base caída o lenta es `error`. */
  async comprobar(): Promise<RespuestaSalud> {
    let temporizador: NodeJS.Timeout | undefined;
    const limite = new Promise<false>((resolver) => {
      temporizador = setTimeout(() => resolver(false), LIMITE_BASE_DATOS_MS);
    });
    const consulta = (async () => {
      await this.baseDatos.comprobarConexion();
      return true as const;
    })();
    try {
      const baseDatosOk = await Promise.race([consulta, limite]);
      return baseDatosOk ? { estado: 'ok', baseDatos: 'ok' } : { estado: 'error', baseDatos: 'error' };
    } catch {
      return { estado: 'error', baseDatos: 'error' };
    } finally {
      clearTimeout(temporizador);
    }
  }
}
