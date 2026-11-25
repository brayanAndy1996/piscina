-- Historia 007a · Pagos (spec 007, criterio 7; DT-4). Una solicitud cuyo pago se confirma pasa a `CONFIRMADA`: es el único estado nuevo que se
-- guarda en la fila. `EN_VERIFICACION` y `PAGO_RECHAZADO` se calculan al leer, con el último pago de su matrícula (007b).
-- Va sola en su migración porque PostgreSQL no deja usar un valor nuevo de un enum en la transacción que lo crea: la migración `pagos` (que
-- sigue a esta) ya puede usarlo.
ALTER TYPE "estado_solicitud" ADD VALUE 'CONFIRMADA';
