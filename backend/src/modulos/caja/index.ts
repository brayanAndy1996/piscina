// Contrato público del módulo de caja para las historias siguientes (spec 006, "Interfaces del backend" y "Reglas para las historias
// siguientes"). Sin Nest, dentro de la transacción de quien llama (que ya llamó a `bloquearActorVigente` y bloqueó antes sus demás filas:
// la caja se bloquea AL FINAL):
//   registrarIngresoEnCaja(tx, ingreso, ahora)  la 007 y la 016: todo cobro en efectivo y toda verificación de Yape o transferencia registra su
//     ingreso aquí, antes de confirmar. Lanza 409 SIN_CAJA_ABIERTA o CAJA_DE_OTRO_DIA: la transacción completa se revierte. Un pago entra una
//     sola vez a la caja (`pagoId` único).
//   registrarEgresoEnCaja(tx, egreso, ahora)    la ruta de egresos y la 019 (pago a un entrenador desde caja, RN-35).
//   leerCajaAbierta(tx, ahora)                  lectura sin bloqueo, para avisar "abre la caja" sin decidir con ella.
// El PDF del cierre (006b):
//   generarPdfCierre(datos, senal?)  pura respecto de la base; arma el PDF por tramos y se puede abandonar con una señal (`AbortError`).
//   GENERADOR_PDF_CIERRE             el token con el que `CajaModule` provee el generador (las pruebas lo reemplazan).
//   ColaPdfCierre, LIMITES_PDF_CIERRE  la cola por proceso que limita las generaciones a la vez y las descargas por persona y por academia (429).
//   textoParaPdf(texto)              deja un texto de usuario seguro para la fuente estándar (solo Latin-1, sin cambiar la estructura del PDF).
export { CajaModule } from './caja.module';
export { CajasService } from './cajas.service';
export { instalarHeadSinRutasDeCaja } from './head-sin-ruta';
export {
  type ConceptoIngreso,
  type EgresoEnCaja,
  type IngresoEnCaja,
  leerCajaAbierta,
  type MetodoPago,
  type MovimientoRegistrado,
  registrarEgresoEnCaja,
  registrarIngresoEnCaja,
} from './movimientos';
export { type DatosPdfCierre, GENERADOR_PDF_CIERRE, type GeneradorPdfCierre, generarPdfCierre } from './pdf/cierre-pdf';
export { ColaPdfCierre, LIMITES_PDF_CIERRE } from './pdf/cola-pdf';
export { textoParaPdf } from './pdf/texto-pdf';
