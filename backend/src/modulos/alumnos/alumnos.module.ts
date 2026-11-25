import { Module } from '@nestjs/common';
import { AlumnosController } from './alumnos.controller';
import { BusquedaService } from './busqueda.service';
import { CarnetService } from './carnet.service';
import { MiCarnetController } from './mi-carnet.controller';
import { GENERADOR_PDF_CARNET, generarPdfCarnet } from './pdf/carnet-pdf';

/**
 * Los alumnos y su carnet digital (spec 008a): el carnet con su QR, el PDF, la regeneración del QR y la búsqueda. El generador del PDF se provee con
 * un token para que las pruebas de integración lo reemplacen con `overrideProvider(GENERADOR_PDF_CARNET)` (criterio 12). El almacén de archivos y el
 * reloj son globales.
 */
@Module({
  controllers: [AlumnosController, MiCarnetController],
  providers: [
    CarnetService,
    BusquedaService,
    { provide: GENERADOR_PDF_CARNET, useValue: { generar: generarPdfCarnet } },
  ],
  exports: [CarnetService],
})
export class AlumnosModule {}
