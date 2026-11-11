import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ENTORNO, type Entorno } from '../entorno';

/**
 * Cliente de Prisma. La conexión es perezosa: no se conecta al arrancar, así la API arranca con la base caída y se
 * recupera sola cuando vuelve (spec 000, criterio 8). La historia 001 lo amplía para fijar la academia.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENTORNO) entorno: Entorno) {
    super({ adapter: new PrismaPg({ connectionString: entorno.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
