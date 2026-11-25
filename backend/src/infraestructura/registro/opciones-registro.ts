import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

/** Texto fijo que reemplaza los valores sensibles en los registros. */
export const TEXTO_REDACTADO = '[Redactado]';

/**
 * Rutas de los registros cuyo valor nunca debe aparecer: cookies, credenciales y las cabeceras `Referer`, `X-Token-Solicitud` y `X-Pago-Datos`. La página
 * de seguimiento lleva el token en su dirección (D-27) y un navegador puede mandar esa dirección en `Referer` a cualquier ruta de la API
 * (spec 005, criterio 53); la subida de la foto lleva el token en `X-Token-Solicitud` (criterio 28, 005b; Express entrega las cabeceras en
 * minúsculas) y la del comprobante, `X-Pago-Datos`, lleva el número de operación y el monto declarado (007b, criterio 43): se redactan en toda la API y en todos los niveles.
 */
export const RUTAS_REDACTADAS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.referer',
  'req.headers["x-token-solicitud"]',
  'req.headers["x-pago-datos"]',
  'res.headers["set-cookie"]',
];

/**
 * `nestjs-pino` crea un solo `pino-http` por proceso (con el primer destino que recibe) y las aplicaciones siguientes lo reutilizan. Para
 * que cada aplicación con un destino propio (las pruebas que capturan el registro) lo vea de verdad, el logger escribe siempre en este
 * destino, que reenvía al último destino pedido. En producción no se pide ningún destino y nada de esto interviene.
 *
 * El reenviador solo resuelve el destino: el `level` y el `redact` (y el resto de la configuración de `pino`) quedan fijados por la
 * primera aplicación del proceso que crea el logger. Una aplicación posterior que pida otro nivel o rutas redactadas distintas con un
 * destino propio recibe sus registros, pero con el nivel y la redacción de la primera.
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
