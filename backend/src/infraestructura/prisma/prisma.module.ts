import { Global, Module } from '@nestjs/common';
import { BaseDatos } from './base-datos';

/**
 * Registra `BaseDatos`, el único camino de los módulos a la base. El cliente de Prisma no es un proveedor: lo crea y lo
 * guarda `BaseDatos` en un campo privado (spec 001, criterio 100), así ningún token del contenedor de Nest lleva a él.
 */
@Global()
@Module({
  providers: [BaseDatos],
  exports: [BaseDatos],
})
export class PrismaModule {}
