import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ErrorNegocio } from '../errores';
import { detallesDeZod } from './detalles-zod';

export const MENSAJE_SOLICITUD_INVALIDA = 'La solicitud no es válida.';

/**
 * Pipe que valida (y transforma) una entrada con un esquema de zod, por ejemplo
 * `@Body(new ValidarCon(crearAcademiaSchema)) datos: CrearAcademia`. Si no cumple, lanza un 400 `SOLICITUD_INVALIDA`
 * con `detalles: { errores: [{ campo, mensaje }] }`. Nunca copia el valor recibido en la respuesta.
 */
@Injectable()
export class ValidarCon<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodType<T>) {}

  transform(valor: unknown): T {
    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) return resultado.data;
    throw new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, detallesDeZod(resultado.error));
  }
}
