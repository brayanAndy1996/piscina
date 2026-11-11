import { Global, Module } from '@nestjs/common';
import { BaseDatos } from './base-datos';
import { PrismaService } from './prisma.service';

/** Registra `BaseDatos`, el único camino de los módulos a la base. `PrismaService` no se exporta. */
@Global()
@Module({
  providers: [PrismaService, BaseDatos],
  exports: [BaseDatos],
})
export class PrismaModule {}
