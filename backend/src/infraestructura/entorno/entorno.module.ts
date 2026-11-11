import { type DynamicModule, Module } from '@nestjs/common';
import type { Entorno } from './entorno';

/** Token para inyectar el entorno ya validado: `@Inject(ENTORNO) entorno: Entorno`. */
export const ENTORNO = Symbol('ENTORNO');

@Module({})
export class EntornoModule {
  static paraRaiz(entorno: Entorno): DynamicModule {
    return {
      module: EntornoModule,
      global: true,
      providers: [{ provide: ENTORNO, useValue: entorno }],
      exports: [ENTORNO],
    };
  }
}
