-- Historia 011 · Panel del alumno y del apoderado, criterio 1 (RN-29, D-28, DT-3). Una cuenta de usuario, un alumno por academia: el panel toma «mi alumno» de la
-- sesión (`usuario_id`) y, si dos alumnos de la misma academia compartieran la cuenta, mostraría a otro. El rol de la API tiene `UPDATE (usuario_id)` en `alumnos`:
-- el índice lo impide para siempre. Los `NULL` son distintos entre sí (los clientes, sin cuenta, no chocan). Sin cambios de privilegios ni de políticas de RLS.
-- Si una base tuviera dos alumnos con la misma cuenta, la migración falla: no hay datos reales (D-26) y en desarrollo no puede pasar.
-- Reversible a mano: DROP INDEX "alumnos_academia_id_usuario_id_key".
CREATE UNIQUE INDEX "alumnos_academia_id_usuario_id_key" ON "alumnos"("academia_id", "usuario_id");
