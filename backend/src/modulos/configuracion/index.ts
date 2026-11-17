// Contrato público del módulo de configuración para las historias siguientes (spec 003, "Para las historias siguientes"):
//   leerConfiguracion(tx)  devuelve los valores efectivos de `tx.academiaId` con una consulta dentro de la transacción de quien llama.
//   Sin caché: se lee en la propia transacción de la operación que necesita el valor. Un valor guardado inválido vale lo de por defecto.
export type { ConfiguracionAcademia } from '@aquagestion/contratos';
export { ConfiguracionModule } from './configuracion.module';
export { ConfiguracionService } from './configuracion.service';
export { leerConfiguracion, type OpcionesDeLectura, type RegistroDeAvisos } from './lectura';
