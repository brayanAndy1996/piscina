import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

/** Cuentas de usuario de una academia: personal y alumnos (spec 002). `UsuariosService.crearEnTransaccion` lo usará la historia 007. */
@Module({
  imports: [AuditoriaModule],
  controllers: [UsuariosController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}
