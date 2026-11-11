import { describe, expect, it } from 'vitest';
import { crearOpcionesRegistro, RUTAS_REDACTADAS, TEXTO_REDACTADO } from './opciones-registro';

describe('crearOpcionesRegistro', () => {
  it('redacta cookie, authorization y set-cookie con un texto fijo', () => {
    const opciones = crearOpcionesRegistro({ nodeEnv: 'production' });
    const pino = opciones.pinoHttp as { redact: { paths: string[]; censor: string } };

    expect(pino.redact.paths).toEqual(
      expect.arrayContaining(['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]']),
    );
    expect(pino.redact.censor).toBe(TEXTO_REDACTADO);
    expect(RUTAS_REDACTADAS).toHaveLength(3);
  });

  it('queda en silencio en pruebas y en info en el resto', () => {
    expect((crearOpcionesRegistro({ nodeEnv: 'test' }).pinoHttp as { level: string }).level).toBe('silent');
    expect((crearOpcionesRegistro({ nodeEnv: 'production' }).pinoHttp as { level: string }).level).toBe('info');
    expect((crearOpcionesRegistro({ nodeEnv: 'test', nivel: 'info' }).pinoHttp as { level: string }).level).toBe(
      'info',
    );
  });

  it('usa un formato legible solo en desarrollo', () => {
    const desarrollo = crearOpcionesRegistro({ nodeEnv: 'development' }).pinoHttp as { transport?: { target: string } };
    const produccion = crearOpcionesRegistro({ nodeEnv: 'production' }).pinoHttp as { transport?: unknown };
    expect(desarrollo.transport?.target).toBe('pino-pretty');
    expect(produccion.transport).toBeUndefined();
  });
});
