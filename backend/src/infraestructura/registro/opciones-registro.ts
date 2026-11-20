import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

/** Texto fijo que reemplaza los valores sensibles en los registros. */
export const TEXTO_REDACTADO = '[Redactado]';

/**
 * Rutas de los registros cuyo valor nunca debe aparecer: cookies, credenciales y la cabecera `Referer`. La página de seguimiento lleva
 * el token en su dirección (D-27) y un navegador puede mandar esa dirección en `Referer` a cualquier ruta de la API (spec 005, criterio
 * 53): se redacta en toda la API y en todos los niveles.
 */
export const RUTAS_REDACTADAS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.referer',
  'res.headers["set-cookie"]',
];

/**
 * `nestjs-pino` crea un solo `pino-http` por proceso (con el primer destino que recibe) y las aplicaciones siguientes lo reutilizan. Para
 * que cada aplicación con un destino propio (las pruebas que capturan el registro) lo vea de verdad, el logger escribe siempre en este
 * destino, que reenvía al último destino pedido. En producción no se pide ningún destino y nada de esto interviene.
 */
let destinoPedido: DestinationStream | undefined;
const destinoReenviado: DestinationStream = {
  write(mensaje: string): void {
    destinoPedido?.write(mensaje);
  },
};

export interface OpcionesRegistro {
  readonly nodeEnv: string | undefined;
  /** Nivel de los registros. Por defecto `silent` en pruebas e `info` en el resto. */
  readonly nivel?: string;
  /** Destino de los registros. Por defecto, la salida estándar. Se usa en las pruebas. */
  readonly destino?: DestinationStream;
}

/**
 * Configuración de `nestjs-pino`: registros en JSON con `pino`, con los valores de `cookie`, `authorization` y
 * `set-cookie` reemplazados por un texto fijo. En desarrollo se muestran en formato legible con `pino-pretty`.
 */
export function crearOpcionesRegistro({ nodeEnv, nivel, destino }: OpcionesRegistro): Params {
  const base = {
    level: nivel ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    redact: { paths: [...RUTAS_REDACTADAS], censor: TEXTO_REDACTADO },
  };
  if (destino) {
    destinoPedido = destino;
    return { pinoHttp: [base, destinoReenviado] };
  }
  if (nodeEnv === 'development') {
    return { pinoHttp: { ...base, transport: { target: 'pino-pretty', options: { singleLine: true } } } };
  }
  return { pinoHttp: base };
}
