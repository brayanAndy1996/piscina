import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { UsuariosModule } from '../usuarios';
import { CobrosService } from './cobros.service';
import { PagosController } from './pagos.controller';
import { TicketService } from './ticket.service';

/**
 * Pagos (spec 007a): el cobro en efectivo en recepción con su paso de cliente a alumno, el ajuste del monto y el ticket interno. La 007b suma el
 * comprobante de Yape o transferencia, la bandeja y la aprobación o el rechazo. El correo llega por `ENVIADOR_CORREO` (global).
 */
@Module({
  imports: [AuditoriaModule, UsuariosModule],
  controllers: [PagosController],
  providers: [CobrosService, TicketService],
  exports: [CobrosService, TicketService],
})
export class PagosModule {}
