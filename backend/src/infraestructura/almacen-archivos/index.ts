// Contrato público del almacén de archivos para las historias siguientes (spec 005, criterio 36 y "Interfaces del backend"):
//   AlmacenArchivos     guardar(academiaId, clave, contenido, tipo), leer(academiaId, clave), borrar(academiaId, clave).
//   ALMACEN_ARCHIVOS    el token de inyección (como ENVIADOR_CORREO).
//   AlmacenArchivosDisco  la implementación de disco local; `new AlmacenArchivosDisco(raiz)`.
export { ALMACEN_ARCHIVOS, type AlmacenArchivos, type TipoDeArchivo } from './almacen-archivos';
export { AlmacenArchivosDisco, ErrorDeAlmacenArchivos } from './almacen-archivos-disco';
export { AlmacenArchivosModule } from './almacen-archivos.module';
