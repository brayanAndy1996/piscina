import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

/** Texto fijo que reemplaza los valores sensibles en los registros. */
export const TEXTO_REDACTADO = '[Redactado]';

/** Rutas de los registros cuyo valor nunca debe aparecer: cookies y credenciales. */
export const RUTAS_REDACTADAS = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];

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
  if (destino) return { pinoHttp: [base, destino] };
  if (nodeEnv === 'development') {
    return { pinoHttp: { ...base, transport: { target: 'pino-pretty', options: { singleLine: true } } } };
  }
  return { pinoHttp: base };
}
