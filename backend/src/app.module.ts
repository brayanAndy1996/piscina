import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { FiltroErrores } from './comun/filtros/filtro-errores';
import { type Entorno, EntornoModule } from './infraestructura/entorno';
import { PrismaModule } from './infraestructura/prisma';
import { crearOpcionesRegistro } from './infraestructura/registro';
import { RelojModule } from './infraestructura/reloj';
import { AuditoriaModule } from './modulos/auditoria';
import { SaludModule } from './modulos/salud/salud.module';

export interface OpcionesApp {
  /** Nivel de los registros (por defecto `silent` en pruebas e `info` en el resto). */
  readonly nivelRegistro?: string;
  /** Destino de los registros (por defecto, la salida estándar). Lo usan las pruebas. */
  readonly destinoRegistro?: DestinationStream;
}

@Module({})
export class AppModule {
  /** Arma la aplicación con el entorno ya validado. */
  static registrar(entorno: Entorno, opciones: OpcionesApp = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EntornoModule.paraRaiz(entorno),
        LoggerModule.forRoot(
          crearOpcionesRegistro({
            nodeEnv: entorno.NODE_ENV,
            nivel: opciones.nivelRegistro,
            destino: opciones.destinoRegistro,
          }),
        ),
        RelojModule,
        PrismaModule,
        AuditoriaModule,
        SaludModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: FiltroErrores }],
    };
  }
}
