import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { CajasController } from './cajas.controller';
import { CajasService } from './cajas.service';
import { HistorialService } from './historial.service';
import { GENERADOR_PDF_CIERRE, generarPdfCierre } from './pdf/cierre-pdf';
import { ColaPdfCierre } from './pdf/cola-pdf';

/**
 * La caja del día de cada academia (spec 006a): apertura, egresos, cierre y reapertura; y su historial (spec 006b): la lista de cajas, el
 * detalle y el PDF de cada cierre. Los cobros de la 007 entran por `registrarIngresoEnCaja`. El generador del PDF se provee con un token para
 * que las pruebas de integración lo reemplacen con `overrideProvider(GENERADOR_PDF_CIERRE)` (PQ8). `ColaPdfCierre` es una sola por proceso: acota
 * las generaciones a la vez y las descargas en espera (criterio 49 b y c).
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [CajasController],
  providers: [
    CajasService,
    HistorialService,
    ColaPdfCierre,
    { provide: GENERADOR_PDF_CIERRE, useValue: { generar: generarPdfCierre } },
  ],
  exports: [CajasService],
})
export class CajaModule {}
