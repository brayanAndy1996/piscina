import { Global, Module } from '@nestjs/common';
import { ENVIADOR_CORREO } from './enviador-correo';
import { EnviadorCorreoSimulado } from './enviador-correo-simulado';

/**
 * Registra el enviador de correo de forma global. Hoy es el simulado (D-19); con el hosting se cambia por el proveedor real sin tocar
 * los servicios. Las pruebas lo reemplazan con `overrideProvider(ENVIADOR_CORREO).useValue(...)`.
 */
@Global()
@Module({
  providers: [{ provide: ENVIADOR_CORREO, useClass: EnviadorCorreoSimulado }],
  exports: [ENVIADOR_CORREO],
})
export class CorreoModule {}
