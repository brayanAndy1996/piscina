import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { crearOpcionesRegistro, RUTAS_REDACTADAS, TEXTO_REDACTADO } from './opciones-registro';

describe('crearOpcionesRegistro', () => {
  it('redacta cookie, authorization, referer, x-token-solicitud, x-pago-datos y set-cookie con un texto fijo', () => {
    const opciones = crearOpcionesRegistro({ nodeEnv: 'production' });
    const pino = opciones.pinoHttp as { redact: { paths: string[]; censor: string } };

    expect(pino.redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers.referer',
        'req.headers["x-token-solicitud"]',
        'req.headers["x-pago-datos"]',
        'res.headers["set-cookie"]',
      ]),
    );
    expect(pino.redact.censor).toBe(TEXTO_REDACTADO);
    expect(RUTAS_REDACTADAS).toHaveLength(6);
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

  describe('con un destino propio (las pruebas que capturan el registro)', () => {
    const capturar = (): { destino: DestinationStream; mensajes: string[] } => {
      const mensajes: string[] = [];
      return { destino: { write: (mensaje: string) => void mensajes.push(mensaje) }, mensajes };
    };
    const reenviador = (destino: DestinationStream): DestinationStream => {
      const { pinoHttp } = crearOpcionesRegistro({ nodeEnv: 'test', destino });
      const [base, salida] = pinoHttp as [{ redact: { paths: string[] } }, DestinationStream];
      expect(base.redact.paths).toEqual(expect.arrayContaining(RUTAS_REDACTADAS));
      return salida;
    };

    it('devuelve la configuración y un destino que reenvía lo que se escribe al destino pedido', () => {
      const { destino, mensajes } = capturar();

      reenviador(destino).write('{"msg":"uno"}\n');

      expect(mensajes).toEqual(['{"msg":"uno"}\n']);
    });

    it('reenvía siempre al último destino pedido y el anterior deja de recibir', () => {
      const primero = capturar();
      const segundo = capturar();
      const salida = reenviador(primero.destino);
      reenviador(segundo.destino);

      salida.write('{"msg":"dos"}\n');

      expect(segundo.mensajes).toEqual(['{"msg":"dos"}\n']);
      expect(primero.mensajes).toEqual([]);
    });

    it('sin destino no devuelve un reenviador (producción)', () => {
      expect(Array.isArray(crearOpcionesRegistro({ nodeEnv: 'production' }).pinoHttp)).toBe(false);
    });
  });
});
