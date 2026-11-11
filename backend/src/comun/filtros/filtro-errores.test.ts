import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { errorApiSchema } from '@aquagestion/contratos';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { FiltroErrores } from './filtro-errores';

function ejecutar(excepcion: unknown) {
  const json = vi.fn<(cuerpo: unknown) => void>();
  const status = vi.fn<(codigo: number) => { json: typeof json }>(() => ({ json }));
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  const registro = { error: vi.fn() };
  new FiltroErrores(registro as unknown as PinoLogger).catch(excepcion, host);
  return { estado: status.mock.calls[0]?.[0], cuerpo: json.mock.calls[0]?.[0], registro };
}

describe('FiltroErrores', () => {
  it('convierte un error no controlado en 500 ERROR_INTERNO, sin traza ni mensaje original', () => {
    const original = new Error('connection string postgresql://u:clave@host/base falló');
    const { estado, cuerpo, registro } = ejecutar(original);

    expect(estado).toBe(500);
    expect(errorApiSchema.parse(cuerpo)).toEqual({
      codigo: 'ERROR_INTERNO',
      mensaje: 'Ocurrió un error inesperado. Intenta de nuevo más tarde.',
    });
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toContain('clave');
    expect(texto).not.toContain('falló');
    expect(texto).not.toContain('stack');
    expect(texto).not.toContain('at ');
    expect(registro.error).toHaveBeenCalledTimes(1);
  });

  it('registra el error completo con su traza, en nivel error', () => {
    const original = new Error('boom');
    const { registro } = ejecutar(original);

    const [datos] = registro.error.mock.calls[0] as [{ err: Error }, string];
    expect(datos.err).toBe(original);
    expect(datos.err.stack).toContain('boom');
  });

  it('trata como error interno cualquier valor lanzado que no sea un Error', () => {
    const { estado, cuerpo } = ejecutar('cadena lanzada');
    expect(estado).toBe(500);
    expect(errorApiSchema.parse(cuerpo).codigo).toBe('ERROR_INTERNO');
  });

  it('convierte NotFoundException en 404 NO_ENCONTRADO sin registrar un error', () => {
    const { estado, cuerpo, registro } = ejecutar(new NotFoundException('Cannot GET /x'));
    expect(estado).toBe(404);
    expect(errorApiSchema.parse(cuerpo)).toEqual({
      codigo: 'NO_ENCONTRADO',
      mensaje: 'No se encontró el recurso solicitado.',
    });
    expect(registro.error).not.toHaveBeenCalled();
  });

  it('conserva el estado de otras HttpException con un código derivado y sin el mensaje original', () => {
    const malo = ejecutar(new BadRequestException('campo "dni" inválido en tabla secreta'));
    expect(malo.estado).toBe(400);
    expect(errorApiSchema.parse(malo.cuerpo).codigo).toBe('SOLICITUD_INVALIDA');
    expect(JSON.stringify(malo.cuerpo)).not.toContain('secreta');

    const prohibido = ejecutar(new ForbiddenException());
    expect(prohibido.estado).toBe(403);
    expect(errorApiSchema.parse(prohibido.cuerpo).codigo).toBe('PROHIBIDO');
  });

  it('usa SOLICITUD_INVALIDA para un estado 4xx sin código propio', () => {
    const { estado, cuerpo } = ejecutar(new HttpException('raro', 418));
    expect(estado).toBe(418);
    expect(errorApiSchema.parse(cuerpo).codigo).toBe('SOLICITUD_INVALIDA');
  });

  it('trata una HttpException 5xx como error interno y la registra', () => {
    const { estado, cuerpo, registro } = ejecutar(new HttpException('detalle interno', 503));
    expect(estado).toBe(503);
    expect(errorApiSchema.parse(cuerpo).codigo).toBe('ERROR_INTERNO');
    expect(JSON.stringify(cuerpo)).not.toContain('detalle interno');
    expect(registro.error).toHaveBeenCalledTimes(1);
  });
});
