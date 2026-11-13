import { HttpException } from '@nestjs/common';

/**
 * Excepción de negocio con estado HTTP, código, mensaje y detalles propios. El filtro de errores la responde tal cual
 * (formato `ErrorApi`) cuando el estado es menor que 500; los 5xx se responden como `ERROR_INTERNO` y se registran.
 *
 * - `codigo`: MAYÚSCULAS con guiones bajos, por ejemplo `NOMBRE_CORTO_EN_USO`.
 * - `mensaje`: en español, para mostrarlo al usuario.
 * - `detalles`: opcional; en un 400 `SOLICITUD_INVALIDA` cumple `detallesValidacionSchema`.
 */
export class ErrorNegocio extends HttpException {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    readonly mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(detalles === undefined ? { codigo, mensaje } : { codigo, mensaje, detalles }, estado);
    this.name = new.target.name;
  }
}
