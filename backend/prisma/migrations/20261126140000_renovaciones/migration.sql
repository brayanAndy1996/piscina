-- Historia 010a · Renovación con prioridad de horario. Criterio 1 (DT-2, DT-11; RN-28): una renovación (matrícula sin solicitud) nunca tiene una
-- reserva temporal: se registra y se paga en una sola operación, efectivo confirmado al instante o comprobante en verificación (sin vencimiento).
-- Solo la reserva de 24 horas de la inscripción pública (con solicitud) lleva `reserva_vence_en`. Sin tablas, columnas ni privilegios nuevos: la app
-- ya inserta matrículas sin solicitud, `matricula_clases` y pagos, y actualiza `alumnos.estado`. Se valida al crearla: hoy no hay matrículas sin
-- solicitud (la 005 y la 007 siempre la traen), así que la restricción nace ya validada.
-- Reversible a mano: ALTER TABLE "matriculas" DROP CONSTRAINT "matriculas_renovacion_sin_vencimiento".
ALTER TABLE "matriculas"
  ADD CONSTRAINT "matriculas_renovacion_sin_vencimiento" CHECK ("solicitud_id" IS NOT NULL OR "reserva_vence_en" IS NULL);
