import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ENTORNO, type Entorno } from '../entorno';

/**
 * Cliente de Prisma. INTERNO a esta carpeta: los módulos solo llegan a la base a través de `BaseDatos` (spec 001,
 * criterio 28; lo exige una regla de ESLint).
 *
 * Se conecta con `DATABASE_URL_APP` (el rol `aquagestion_app`, sujeto a RLS) y nunca con `DATABASE_URL`. La conexión
 * es perezosa: no se conecta al arrancar, así la API arranca con la base caída y se recupera sola cuando vuelve
 * (spec 000, criterio 8).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENTORNO) entorno: Entorno) {
    super({
      adapter: new PrismaPg({ connectionString: entorno.DATABASE_URL_APP, max: entorno.DATABASE_POOL_MAX }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
