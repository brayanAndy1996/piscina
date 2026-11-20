import { describe, expect, it, vi } from 'vitest';
import type { EnviadorCorreo, MensajeDeCorreo } from './enviador-correo';
import { enviarSinEsperar, tipoDeError } from './enviar-sin-esperar';

// Pruebas de apoyo (no protegidas) de `enviarSinEsperar` y `tipoDeError` (spec 005, criterios 51 y 52).
const mensaje: MensajeDeCorreo = {
  academiaId: 'academia-1',
  para: 'persona@ejemplo.test',
  plantilla: 'SEGUIMIENTO_SOLICITUD',
  datos: { codigo: 'AQ-000000', enlace: '/a/x/solicitud/secreto' },
};

async function dejarPasar(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolver) => setImmediate(resolver));
}

describe('tipoDeError (apoyo)', () => {
  class ErrorPropio extends Error {}

  it('da el nombre de la clase para un Error, "Error" si no es un identificador y typeof para lo demás', () => {
    expect(tipoDeError(new ErrorPropio('x'))).toBe('ErrorPropio');
    expect(tipoDeError(new TypeError('x'))).toBe('TypeError');
    const conNombre = new Error('x');
    conNombre.name = 'persona@ejemplo.test';
    expect(tipoDeError(conNombre)).toBe('Error');
    expect(tipoDeError('texto')).toBe('string');
    expect(tipoDeError({ a: 1 })).toBe('object');
    expect(tipoDeError(null)).toBe('object');
    expect(tipoDeError(undefined)).toBe('undefined');
  });

  it('no lanza con un Proxy, un getter que lanza ni un error sin prototipo', () => {
    const proxy = new Proxy(new Error('x'), {
      getPrototypeOf() {
        throw new Error('trampa');
      },
    });
    expect(tipoDeError(proxy)).toBe('Error');
    const sinPrototipo = Object.setPrototypeOf(new Error('x'), null) as unknown;
    expect(() => tipoDeError(sinPrototipo)).not.toThrow();
    class Malo extends Error {
      static override get name(): string {
        throw new Error('getter');
      }
    }
    expect(tipoDeError(new Malo('x'))).toBe('Error');
  });
});

describe('enviarSinEsperar (apoyo)', () => {
  it('vuelve de inmediato aunque la promesa no se resuelva nunca', async () => {
    const enviar = vi.fn(() => new Promise<void>(() => undefined));
    const enviador: EnviadorCorreo = { enviar };
    const registro = { warn: vi.fn() };

    expect(enviarSinEsperar(enviador, mensaje, registro)).toBeUndefined();
    await dejarPasar();

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(registro.warn).not.toHaveBeenCalled();
  });

  it('registra solo el tipo si rechaza o lanza, y nunca deja un rechazo sin atrapar', async () => {
    const registro = { warn: vi.fn() };
    const rechaza: EnviadorCorreo = { enviar: () => Promise.reject(new RangeError('persona@ejemplo.test')) };
    const lanza: EnviadorCorreo = {
      enviar: () => {
        // Un valor que no es un Error (un texto con un dato sensible), lanzado de forma síncrona.
        throw 'secreto' as unknown as Error;
      },
    };
    const alRechazar = vi.fn();
    process.on('unhandledRejection', alRechazar);
    try {
      enviarSinEsperar(rechaza, mensaje, registro);
      enviarSinEsperar(lanza, mensaje, registro);
      await dejarPasar();
    } finally {
      process.off('unhandledRejection', alRechazar);
    }

    expect(alRechazar).not.toHaveBeenCalled();
    expect(registro.warn).toHaveBeenCalledTimes(2);
    expect(registro.warn).toHaveBeenCalledWith(
      { academiaId: 'academia-1', plantilla: 'SEGUIMIENTO_SOLICITUD', error: { tipo: 'RangeError' } },
      'No se pudo enviar el correo',
    );
    expect(registro.warn).toHaveBeenCalledWith(
      { academiaId: 'academia-1', plantilla: 'SEGUIMIENTO_SOLICITUD', error: { tipo: 'string' } },
      'No se pudo enviar el correo',
    );
    expect(JSON.stringify(registro.warn.mock.calls)).not.toContain('persona@ejemplo.test');
    expect(JSON.stringify(registro.warn.mock.calls)).not.toContain('secreto');
  });

  it('un registro que lanza tampoco produce un rechazo sin atrapar', async () => {
    const registro = {
      warn: () => {
        throw new Error('registro roto');
      },
    };
    const alRechazar = vi.fn();
    process.on('unhandledRejection', alRechazar);
    try {
      enviarSinEsperar({ enviar: () => Promise.reject(new Error('x')) }, mensaje, registro);
      await dejarPasar();
    } finally {
      process.off('unhandledRejection', alRechazar);
    }

    expect(alRechazar).not.toHaveBeenCalled();
  });
});
