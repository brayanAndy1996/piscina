import type { EnviadorCorreo, MensajeDeCorreo } from './enviador-correo';

/** Lo único que necesita del registro técnico: un aviso con un objeto y un mensaje fijo (por ejemplo, un `PinoLogger`). */
export interface RegistroDeAvisos {
  warn(objeto: Record<string, unknown>, mensaje: string): void;
}

/** El mensaje fijo del registro de un fallo del correo: el mismo para cualquier error, sin datos del error ni del mensaje. */
const MENSAJE_DE_FALLO = 'No se pudo enviar el correo';

/** Un nombre de clase que se puede registrar: un identificador de como mucho 64 caracteres. */
const PATRON_DE_TIPO = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/**
 * El tipo de un error, lo único que se registra de él (spec 005, criterio 52): para un `Error`, el nombre de la clase de su constructor
 * si es un identificador de como mucho 64 caracteres y, si no, `"Error"` (nunca su `name` propio, que puede llevar datos); para
 * cualquier otro valor, su `typeof`. No lee el mensaje, la pila, la `cause` ni ninguna otra propiedad. Un `Proxy`, un getter que lanza o
 * un objeto sin prototipo dan `"Error"` y nunca lanzan.
 */
export function tipoDeError(valor: unknown): string {
  try {
    if (valor instanceof Error) {
      const constructor: unknown = (Object.getPrototypeOf(valor) as { constructor?: unknown } | null)?.constructor;
      const nombre: unknown = typeof constructor === 'function' ? constructor.name : undefined;
      return typeof nombre === 'string' && PATRON_DE_TIPO.test(nombre) ? nombre : 'Error';
    }
    return typeof valor;
  } catch {
    return 'Error';
  }
}

/**
 * Inicia el envío de un correo **sin esperarlo** (spec 005, criterios 51 y 52; D-05, D-19): quien llama no hace `await` de nada, así que
 * la respuesta no depende de que el proveedor responda, tarde o falle. El `then` convierte un error síncrono de `enviar` en un rechazo y
 * el `catch` atrapa todo rechazo (no hay `unhandledRejection`); el fallo se registra solo con la academia, la plantilla y el tipo del
 * error, nunca con el destinatario, el enlace, el token ni el error mismo. Se llama después de confirmar la transacción.
 */
export function enviarSinEsperar(correo: EnviadorCorreo, mensaje: MensajeDeCorreo, registro: RegistroDeAvisos): void {
  const { academiaId, plantilla } = mensaje;
  Promise.resolve()
    .then(() => correo.enviar(mensaje))
    .catch((error: unknown) => {
      try {
        registro.warn({ academiaId, plantilla, error: { tipo: tipoDeError(error) } }, MENSAJE_DE_FALLO);
      } catch {
        // Un registro que falla no puede convertirse en un rechazo sin atrapar.
      }
    });
}
