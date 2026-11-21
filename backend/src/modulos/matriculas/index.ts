// Contrato público del módulo de matrículas para las historias siguientes (spec 005, "Interfaces del backend"):
//   contarOcupacion(tx, claseIds, { anio, mes }, ahora)  cuántas matrículas que ocupan cupo en ese mes incluye cada clase.
//   contarInscritos(tx, claseIds, ahora)                  la mayor ocupación de cada clase entre el mes en curso y los siguientes (DR-5 de 004).
// Cuentan sin bloquear: quien llama ya bloqueó las clases con `bloquearClasesParaCupo`. Sin Nest, como `leerConfiguracion`.
// El cobro (`clasesRestantes`, `montoProporcional`, `calcularTotal`) está en `dominio/cobro.ts`.
export { contarInscritos, contarOcupacion } from './ocupacion';
export {
  baseProporcional,
  calcularTotal,
  clasesRestantes,
  montoProporcional,
  type ClaseElegida,
  type Descuento,
  type Racional,
} from './dominio/cobro';
export { finDelMesEnLima, RESERVA_SIN_PAGO_MS, vencimientoDeReserva } from './dominio/reserva';
