import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  guardarErrorDeCuerpo,
  lanzarErrorDeCuerpoGuardado,
  permitirErrorDeCuerpoDiferido,
} from './error-de-cuerpo-diferido';

const nuevaSolicitud = (): Request => ({}) as Request;

/** El estado HTTP de la excepción que lanza `lanzarErrorDeCuerpoGuardado`, o `null` si no lanza una `HttpException`. */
function estadoLanzado(solicitud: Request): number | null {
  try {
    lanzarErrorDeCuerpoGuardado(solicitud);
    return null;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : null;
  }
}

describe('error del cuerpo diferido (spec 002, orden: permiso antes que validación del cuerpo)', () => {
  it('no guarda nada si la petición no se marcó: el error se responde al instante', () => {
    const solicitud = nuevaSolicitud();

    expect(guardarErrorDeCuerpo(solicitud, new SyntaxError('roto'))).toBe(false);
    expect(() => lanzarErrorDeCuerpoGuardado(solicitud)).not.toThrow();
  });

  it('guarda el primer error de una petición marcada y no lo reemplaza', () => {
    const solicitud = nuevaSolicitud();
    permitirErrorDeCuerpoDiferido(solicitud);
    const primero = new HttpException('primero', 400);

    expect(guardarErrorDeCuerpo(solicitud, primero)).toBe(true);
    expect(guardarErrorDeCuerpo(solicitud, new HttpException('segundo', 413))).toBe(true);

    expect(() => lanzarErrorDeCuerpoGuardado(solicitud)).toThrow(primero);
  });

  it('un JSON roto (SyntaxError) se lanza como 400', () => {
    const solicitud = nuevaSolicitud();
    permitirErrorDeCuerpoDiferido(solicitud);
    guardarErrorDeCuerpo(solicitud, new SyntaxError('Unexpected end of JSON input'));

    expect(estadoLanzado(solicitud)).toBe(400);
  });

  it('un error de http-errors de 4xx (por ejemplo, 413) conserva su estado; uno de 5xx se relanza tal cual', () => {
    const grande = nuevaSolicitud();
    permitirErrorDeCuerpoDiferido(grande);
    guardarErrorDeCuerpo(grande, Object.assign(new Error('too large'), { statusCode: 413 }));
    const interno = nuevaSolicitud();
    permitirErrorDeCuerpoDiferido(interno);
    const falla = Object.assign(new Error('boom'), { statusCode: 500 });
    guardarErrorDeCuerpo(interno, falla);

    expect(estadoLanzado(grande)).toBe(413);
    expect(() => lanzarErrorDeCuerpoGuardado(interno)).toThrow(falla);
  });

  it('el estado de una petición no pasa a otra', () => {
    const una = nuevaSolicitud();
    const otra = nuevaSolicitud();
    permitirErrorDeCuerpoDiferido(una);
    guardarErrorDeCuerpo(una, new SyntaxError('roto'));

    expect(() => lanzarErrorDeCuerpoGuardado(otra)).not.toThrow();
    expect(guardarErrorDeCuerpo(otra, new SyntaxError('roto'))).toBe(false);
  });
});
