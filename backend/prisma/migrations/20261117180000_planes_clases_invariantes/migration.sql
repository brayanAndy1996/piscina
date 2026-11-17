-- Historia 004, ronda 1 del ataque adversarial (criterio 33): más invariantes de `planes` en la base. La migración `planes_clases` ya
-- está aplicada en las bases de desarrollo y no se edita: los CHECK se reemplazan aquí, con el mismo nombre, en una sola sentencia por
-- tabla (sin ventana en la que falte alguno). Prisma no conoce los CHECK: no hay cambios en schema.prisma ni en los privilegios.
--
-- `ADD CONSTRAINT` valida las filas que ya existen: si una base de desarrollo tiene filas inválidas escritas a mano, esta migración
-- falla y hay que corregirlas. No hay datos reales (repositorio público, D-26) y la semilla cumple todo lo de abajo.
--
-- Cuidados con los arreglos:
-- - `<@` y `cardinality` aplanan las dimensiones: `'{{1,2},{3,4}}'` pasaba. Se exige una sola dimensión (`array_ndims = 1`) que empiece
--   en el índice 1 (`array_lower`, para rechazar `'[0:2]={1,2,3}'`).
-- - Un CHECK que da NULL cuenta como cumplido, y `array_ndims` de un arreglo vacío es NULL: el `CASE ... ELSE false` lo convierte en
--   rechazo.
-- - `array_position` lanza `0A000` (no `23514`) con un arreglo de varias dimensiones, y PostgreSQL no garantiza el orden de evaluación
--   de un `AND`: el `CASE` fija que solo se llame con una dimensión. `array_position(col, NULL)` encuentra un elemento NULL.

ALTER TABLE "planes"
  -- En PostgreSQL `'NaN'::numeric` es igual a sí mismo y mayor que cualquier número: `precio > 0` lo dejaba pasar.
  DROP CONSTRAINT "planes_precio_positivo",
  ADD CONSTRAINT "planes_precio_positivo" CHECK ("precio" > 0 AND "precio" <> 'NaN'::numeric),

  DROP CONSTRAINT "planes_dias_permitidos_validos",
  ADD CONSTRAINT "planes_dias_permitidos_validos" CHECK (
    CASE
      WHEN array_ndims("dias_permitidos") = 1 AND array_lower("dias_permitidos", 1) = 1
        THEN array_position("dias_permitidos", NULL) IS NULL
          AND cardinality("dias_permitidos") >= "veces_por_semana"
          AND "dias_permitidos" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
      ELSE false
    END
  ),

  DROP CONSTRAINT "planes_franjas_permitidas_validas",
  ADD CONSTRAINT "planes_franjas_permitidas_validas" CHECK (
    CASE
      WHEN array_ndims("franjas_permitidas") = 1 AND array_lower("franjas_permitidas", 1) = 1
        THEN array_position("franjas_permitidas", NULL) IS NULL
          AND cardinality("franjas_permitidas") >= 1
          AND "franjas_permitidas" <@ ARRAY['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']::time(0)[]
      ELSE false
    END
  ),

  DROP CONSTRAINT "planes_niveles_aplicables_no_vacios",
  ADD CONSTRAINT "planes_niveles_aplicables_no_vacios" CHECK (
    CASE
      WHEN array_ndims("niveles_aplicables") = 1 AND array_lower("niveles_aplicables", 1) = 1
        THEN array_position("niveles_aplicables", NULL) IS NULL AND cardinality("niveles_aplicables") >= 1
      ELSE false
    END
  ),

  -- `'infinity'` y `'-infinity'` son fechas válidas de PostgreSQL pero no son un día: la API y el estado del plan trabajan con días.
  ADD CONSTRAINT "planes_vigencia_finita" CHECK (
    ("vigencia_inicio" IS NULL OR isfinite("vigencia_inicio")) AND ("vigencia_fin" IS NULL OR isfinite("vigencia_fin"))
  );
