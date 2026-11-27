// Contrato público del módulo de mensualidades para las historias siguientes (spec 010a, «Reglas para las historias siguientes»):
//   registrarRenovacion(tx, deps, pedido)  el registro de una renovación dentro de la transacción de quien llama, con el orden de bloqueos de la
//     010a (actor → consultivo del DNI → alumno → matrículas → clases → ahora → escrituras → caja).
//   CierreDeMesService.cerrar(ahora?)  el cierre de mes (010b); lo llama `CierreDeMesTarea` (módulo `TareasMensualidadesModule`, cargado solo con
//     `TAREAS_PROGRAMADAS=activas`, la misma variable que controla la tarea de faltas de la 009b). El servicio está en `MensualidadesModule`, siempre cargado.
//   estadoDeMensualidad(entrada)  el estado de la mensualidad de un alumno en un mes (010b, pura).
// El cupo del mes siguiente (la 010d, las recuperaciones) se cuenta con `contarOcupacion` y `contarReservasDePrioridad` de `matriculas/` y la
// función `cupoLibre` de `dominio/cupo.ts`, después de `bloquearClasesParaCupo`.
export { MensualidadesModule } from './mensualidades.module';
export { registrarRenovacion } from './nucleo';
export { cupoLibre, cuposParaMostrar, hayCupo } from './dominio/cupo';
export { cotizarRenovacion } from './dominio/cotizacion';
export { estaPorVencer, mesesPermitidos, ventanaDeRenovacion, type VentanaDeRenovacion } from './dominio/ventana';
export { CierreDeMesService, type ResultadoDelCierre } from './cierre-de-mes.service';
export { TareasMensualidadesModule } from './tareas-mensualidades.module';
export { estadoDeMensualidad, type EntradaDeEstado } from './dominio/estado';
