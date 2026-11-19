// Contrato público del módulo de clases para las historias siguientes (spec 004, "Para las historias siguientes"):
//   bloquearClasesParaCupo(tx, claseIds)  bloquea con una sola sentencia, ORDER BY id FOR UPDATE, las clases de `tx.academiaId` que estén
//   en `claseIds` y devuelve su estado actual. Toda operación que ocupa, libera o mueve cupos, y todo cambio del aforo o del estado de una
//   clase, la llama (después de `bloquearActorVigente` y antes de contar la ocupación o escribir). Sin Nest, como `leerConfiguracion`.
export { ClasesModule } from './clases.module';
export { ClasesService } from './clases.service';
export { bloquearClasesParaCupo, type ClaseBloqueada } from './cupo';
