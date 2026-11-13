import { Module } from '@nestjs/common';
import { ServicioTokens } from './servicio-tokens';

/** Seguridad compartida: la reutiliza la sesión de plataforma (001) y los usuarios de las academias (002). */
@Module({
  providers: [ServicioTokens],
  exports: [ServicioTokens],
})
export class SeguridadModule {}
