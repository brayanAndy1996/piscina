import { Global, Module } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../entorno';
import { ALMACEN_ARCHIVOS } from './almacen-archivos';
import { AlmacenArchivosDisco } from './almacen-archivos-disco';

/**
 * Registra el almacén de archivos de forma global. Hoy es el de disco local sobre `ALMACEN_DIRECTORIO` (D-21); con el hosting se cambia
 * por el proveedor real sin tocar los servicios. Las pruebas lo reemplazan con `overrideProvider(ALMACEN_ARCHIVOS).useValue(...)`.
 */
@Global()
@Module({
  providers: [
    {
      provide: ALMACEN_ARCHIVOS,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno) => new AlmacenArchivosDisco(entorno.ALMACEN_DIRECTORIO),
    },
  ],
  exports: [ALMACEN_ARCHIVOS],
})
export class AlmacenArchivosModule {}
