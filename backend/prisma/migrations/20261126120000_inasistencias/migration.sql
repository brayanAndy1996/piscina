-- Historia 009b · Faltas (D-08, D-23; criterio 22). La tabla `inasistencias` guarda la falta de quien no marcó asistencia en su clase: la registra la tarea
-- programada al terminar la clase (sin descontar clases, RN-14) y, si el alumno sí vino, el registro posterior de la secretaria la «cubre» con la asistencia
-- (DT-8): la falta no se borra, queda la evidencia de que se registró y de que se corrigió. Llaves compuestas (academia_id, …) (criterio 12 de 001), el único
-- de una falta por alumno, clase y fecha (la tarea la inserta con `ON CONFLICT DO NOTHING`), el CHECK de la cobertura, el trigger que deja cubrir una sola vez
-- (también al dueño de las tablas), la seguridad a nivel de fila activada y forzada (políticas de la forma que exige la 001, criterio 132) y los privilegios
-- mínimos del rol de la API: `SELECT`, `INSERT` y `UPDATE (asistencia_id, cubierta_en)`, sin `DELETE`. Prisma no conoce el CHECK, el trigger, las políticas ni los
-- privilegios: van a mano aquí.
-- Reversible a mano: quitar la tabla y las dos funciones (`inasistencias_se_cubre_una_vez`).

-- 1. Comprobación del rol de la API (como las migraciones anteriores).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tabla.
CREATE TABLE "inasistencias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "alumno_id" UUID NOT NULL,
    "matricula_id" UUID NOT NULL,
    "clase_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "registrada_en" TIMESTAMPTZ(3) NOT NULL,
    -- La asistencia que la cubre y cuándo: nulos mientras la falta sigue sin cubrir.
    "asistencia_id" UUID,
    "cubierta_en" TIMESTAMPTZ(3),

    CONSTRAINT "inasistencias_pkey" PRIMARY KEY ("id"),
    -- Una falta por alumno, clase y fecha: la tarea la repite sin duplicar (criterio 24). El 409 de un choque sale del nombre.
    CONSTRAINT "inasistencias_una_por_clase_key" UNIQUE ("academia_id", "alumno_id", "clase_id", "fecha"),
    -- La asistencia que cubre y su hora van juntas (criterio 22).
    CONSTRAINT "inasistencias_cubierta_coherente" CHECK (("asistencia_id" IS NULL) = ("cubierta_en" IS NULL))
);

-- Sin borrado en cascada: una academia no se borra, solo se suspende (DR-10 de 001).
ALTER TABLE "inasistencias" ADD CONSTRAINT "inasistencias_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Llaves compuestas (criterio 12 de 001 y criterio 22 de 009): nada apunta a una fila de otra academia, la matrícula es del mismo alumno y la asistencia que
-- cubre es del mismo alumno y del mismo día. Con `asistencia_id` nulo la llave no se comprueba (MATCH SIMPLE): una falta sin cubrir no apunta a nada.
ALTER TABLE "inasistencias" ADD CONSTRAINT "inasistencias_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inasistencias" ADD CONSTRAINT "inasistencias_academia_id_matricula_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "matricula_id", "alumno_id") REFERENCES "matriculas"("academia_id", "id", "alumno_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inasistencias" ADD CONSTRAINT "inasistencias_academia_id_clase_id_fkey" FOREIGN KEY ("academia_id", "clase_id") REFERENCES "clases"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "inasistencias" ADD CONSTRAINT "inasistencias_academia_id_asistencia_id_alumno_id_fecha_fkey" FOREIGN KEY ("academia_id", "asistencia_id", "alumno_id", "fecha") REFERENCES "asistencias"("academia_id", "id", "alumno_id", "fecha") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 3. Índices de lectura: la consulta del mes (por alumno y fecha) y la cobertura por matrícula.
CREATE INDEX "inasistencias_academia_id_alumno_id_fecha_idx" ON "inasistencias"("academia_id", "alumno_id", "fecha");
CREATE INDEX "inasistencias_academia_id_matricula_id_idx" ON "inasistencias"("academia_id", "matricula_id");

-- 4. Trigger: una falta se cubre una sola vez (criterio 22). Solo deja pasar `asistencia_id` y `cubierta_en` de nulos a no nulos; cualquier otro `UPDATE` (otra
-- columna, volver a cubrir, descubrir, o uno que no cambia nada) responde 23514, también al dueño de las tablas. SECURITY INVOKER y sin más valores
-- propios que search_path (criterio 124 de 001). El mensaje no lleva datos.
CREATE FUNCTION public.inasistencias_se_cubre_una_vez() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.asistencia_id IS NOT NULL OR OLD.cubierta_en IS NOT NULL THEN
    RAISE EXCEPTION 'Una falta cubierta no cambia' USING ERRCODE = 'check_violation', CONSTRAINT = 'inasistencias_se_cubre_una_vez';
  END IF;
  IF NEW.asistencia_id IS NULL OR NEW.cubierta_en IS NULL THEN
    RAISE EXCEPTION 'Una falta solo cambia al cubrirla' USING ERRCODE = 'check_violation', CONSTRAINT = 'inasistencias_se_cubre_una_vez';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.academia_id IS DISTINCT FROM OLD.academia_id
     OR NEW.alumno_id IS DISTINCT FROM OLD.alumno_id
     OR NEW.matricula_id IS DISTINCT FROM OLD.matricula_id
     OR NEW.clase_id IS DISTINCT FROM OLD.clase_id
     OR NEW.fecha IS DISTINCT FROM OLD.fecha
     OR NEW.registrada_en IS DISTINCT FROM OLD.registrada_en THEN
    RAISE EXCEPTION 'Una falta solo cambia al cubrirla' USING ERRCODE = 'check_violation', CONSTRAINT = 'inasistencias_se_cubre_una_vez';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.inasistencias_se_cubre_una_vez() FROM PUBLIC;

CREATE TRIGGER "inasistencias_se_cubre_una_vez" BEFORE UPDATE ON "inasistencias"
  FOR EACH ROW EXECUTE FUNCTION public.inasistencias_se_cubre_una_vez();

-- 5. Seguridad a nivel de fila: activada y forzada. Solo cuenta la academia del contexto; la marca de plataforma no abre nada (D-29).
-- Sin política de DELETE: una falta no se borra.
ALTER TABLE "inasistencias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inasistencias" FORCE ROW LEVEL SECURITY;

CREATE POLICY "inasistencias_leer" ON "inasistencias" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "inasistencias_crear" ON "inasistencias" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "inasistencias_cubrir" ON "inasistencias" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual())
  WITH CHECK ("academia_id" = public.app_academia_actual());

-- 6. Privilegios mínimos del rol de la API (criterio 22): `SELECT`, `INSERT` y `UPDATE` solo de las dos columnas de la cobertura. Sin `DELETE`.
GRANT SELECT, INSERT ON "inasistencias" TO "aquagestion_app";
GRANT UPDATE ("asistencia_id", "cubierta_en") ON "inasistencias" TO "aquagestion_app";
