// Contrato público del módulo de alumnos para las historias siguientes (spec 008, "Interfaces del backend"):
//   nuevoTokenQr()        el token aleatorio del QR del carnet (32 bytes en base64url, 43 caracteres); lo usa `confirmarPagoEnTransaccion` al pasar un
//                         cliente a alumno. El contenido del QR es `AQ1:` + el token (`contenidoQr` y `tokenDelContenidoQr`, de `@aquagestion/contratos`):
//                         la asistencia (009) lo lee con `tokenDelContenidoQr` y busca por `(academia_id, qr_token)` en la academia de la sesión.
//   leerFotoComoData()    la foto del alumno como `data:image/jpeg;base64,…` (o `null`), leída del almacén fuera de la transacción; la usan el carnet y la asistencia (009).
//   GENERADOR_PDF_CARNET  el token con el que `AlumnosModule` provee el generador del PDF (las pruebas lo reemplazan).
export { AlumnosModule } from './alumnos.module';
export { CarnetService, type CriterioDeCarnet } from './carnet.service';
export { nuevoTokenQr } from './dominio/token-qr';
export { type DatosPdfCarnet, GENERADOR_PDF_CARNET, type GeneradorPdfCarnet, generarPdfCarnet } from './pdf/carnet-pdf';
export { leerFotoComoData } from './foto-como-data';
