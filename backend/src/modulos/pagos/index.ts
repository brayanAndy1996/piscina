// Contrato público del módulo de pagos para las historias siguientes (spec 007, «Interfaces del backend» y «Reglas para las historias siguientes»).
// Sin Nest, dentro de la transacción de quien llama:
//   confirmarPagoEnTransaccion(tx, usuarios, entrada, ahora)  todo pago se confirma aquí (la 007b al aprobar, la 010 al renovar, la 016 en una clase
//     particular): registra el ingreso en la caja abierta de hoy (la caja se bloquea al final), numera el ticket y, si es el primer pago, crea la
//     cuenta del alumno. La base no acepta un pago confirmado sin su movimiento (criterio 5).
//   bloquearFilasDelCobro(tx, …)  el orden de bloqueos de un cobro: consultivo del DNI → alumno → solicitud → matrícula → pagos.
//   totalACobrar(matricula)       el total sale de lo guardado en la matrícula (D-03), nunca del plan.
//   leerPago(tx, pagoId)          el pago tal como lo muestra la API (`pagoSchema`), sin bloquear: lo usa la renovación de la 010.
export { bloquearFilasDelCobro, leerDniDeLaSolicitud, type FilasDelCobro } from './bloqueos';
export {
  confirmarPagoEnTransaccion,
  type CreadorDeCuentas,
  type EntradaDeConfirmacion,
  type ResultadoDeConfirmacion,
} from './confirmacion';
export { totalACobrar, type DatosDelTotal } from './dominio/total';
export { leerPago } from './cobros.service';
export { PagosModule } from './pagos.module';
