-- Historia 009b · Faltas (revisión). Criterio 12 y 131 de 001: toda tabla con `academia_id` y `id` tiene UNIQUE (academia_id, id), el mismo nombre que las demás
-- tablas (`<tabla>_academia_id_id_key`). La migración 20261126120000_inasistencias no lo definió y ya está aplicada, así que se agrega aquí.
-- Reversible a mano: ALTER TABLE "inasistencias" DROP CONSTRAINT "inasistencias_academia_id_id_key".
ALTER TABLE "inasistencias" ADD CONSTRAINT "inasistencias_academia_id_id_key" UNIQUE ("academia_id", "id");
