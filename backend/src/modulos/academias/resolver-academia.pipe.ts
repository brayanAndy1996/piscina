import { Injectable, type PipeTransform } from '@nestjs/common';
import { nombreCortoSchema } from '@aquagestion/contratos';
import {
  BaseDatos,
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  type AcademiaResuelta,
} from '../../infraestructura/prisma';

/**
 * Convierte el `{nombreCorto}` de una dirección pública en la academia activa, para las rutas `/a/{nombreCorto}` de 001,
 * 002 y 005: `@Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta`.
 *
 * - El texto ya decodificado se recorta y se pasa a minúsculas (`Delfines` encuentra `delfines`) y debe cumplir el
 *   formato del nombre corto; si no, 404 `ACADEMIA_NO_ENCONTRADA` sin tocar la base.
 * - Una academia que no existe responde 404 con el mismo cuerpo; una suspendida, 403 `ACADEMIA_SUSPENDIDA` (DR-4).
 * - El resultado trae el `id`: la ruta que necesite datos internos de la academia llama después a
 *   `baseDatos.conAcademia(academia.id, ...)`.
 */
@Injectable()
export class ResolverAcademiaPipe implements PipeTransform<unknown, Promise<AcademiaResuelta>> {
  constructor(private readonly baseDatos: BaseDatos) {}

  async transform(valor: unknown): Promise<AcademiaResuelta> {
    const nombre = nombreCortoSchema.safeParse(valor);
    if (!nombre.success) throw new ErrorAcademiaNoEncontrada();
    const academia = await this.baseDatos.resolverAcademia(nombre.data);
    if (!academia) throw new ErrorAcademiaNoEncontrada();
    if (academia.estado === 'SUSPENDIDA') throw new ErrorAcademiaSuspendida();
    return academia;
  }
}
