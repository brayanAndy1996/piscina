import { Controller, Get, Param } from '@nestjs/common';
import type { AcademiaPublica } from '@aquagestion/contratos';
import { BaseDatos, type AcademiaResuelta } from '../../infraestructura/prisma';
import { leerConfiguracion } from '../configuracion/lectura';
import { ResolverAcademiaPipe } from './resolver-academia.pipe';

/** Rutas públicas de una academia por su nombre corto (D-27). Sin sesión. */
@Controller('a')
export class AcademiaPublicaController {
  constructor(private readonly baseDatos: BaseDatos) {}

  /**
   * Lo único que un visitante puede saber de una academia activa: su nombre corto, su nombre y su teléfono (el valor efectivo de la
   * configuración, o `null`; DR-4 de 003 y criterio 5 de 005). Sin caché: se lee con la transacción de la petición, así que un cambio
   * confirmado se ve en la siguiente. Nunca el id, el estado ni el motivo.
   */
  @Get(':nombreCorto')
  async obtener(@Param('nombreCorto', ResolverAcademiaPipe) academia: AcademiaResuelta): Promise<AcademiaPublica> {
    const configuracion = await this.baseDatos.conAcademia(academia.id, (tx) => leerConfiguracion(tx));
    return { nombreCorto: academia.nombreCorto, nombre: academia.nombre, telefono: configuracion.telefono };
  }
}
