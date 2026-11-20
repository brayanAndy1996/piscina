import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { EnviadorCorreo, MensajeDeCorreo } from './enviador-correo';

/**
 * Envío simulado (D-19): no manda nada. Registra solo la plantilla, la academia y que hubo un envío; nunca el destinatario, el enlace ni
 * el token (DT-8 de 005: el enlace es una credencial y el registro técnico nunca lleva tokens, criterio 43 de 002). En desarrollo, el
 * enlace se ve en la respuesta del envío y en la pantalla.
 */
@Injectable()
export class EnviadorCorreoSimulado implements EnviadorCorreo {
  constructor(private readonly registro: PinoLogger) {
    this.registro.setContext(EnviadorCorreoSimulado.name);
  }

  enviar(mensaje: MensajeDeCorreo): Promise<void> {
    this.registro.info(
      { academiaId: mensaje.academiaId, plantilla: mensaje.plantilla },
      'Correo simulado: envío registrado',
    );
    return Promise.resolve();
  }
}
