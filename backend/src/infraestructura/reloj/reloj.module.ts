import { Global, Module } from '@nestjs/common';
import { RELOJ } from './reloj';
import { RelojSistema } from './reloj-sistema';

/**
 * Registra el reloj de forma global. Las pruebas lo reemplazan con
 * `overrideProvider(RELOJ).useValue(new RelojFijo(...))`.
 */
@Global()
@Module({
  providers: [{ provide: RELOJ, useClass: RelojSistema }],
  exports: [RELOJ],
})
export class RelojModule {}
