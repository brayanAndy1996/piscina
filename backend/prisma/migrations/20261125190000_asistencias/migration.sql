-- Historia 009a · Asistencia por QR y manual (D-07, D-11, D-16, D-23; HU-14, HU-15, RN-14 a RN-16). La tabla `asistencias` con sus tres tipos,
-- llaves compuestas (academia_id, …) (criterio 12 de 001), los únicos (uno por alumno y día salvo las particulares, y la clave de idempotencia por
-- academia), los tres CHECK que valen también para el dueño de las tablas, la seguridad a nivel de fila activada y forzada (políticas de la forma que
-- exige la 001, criterio 132) y los privilegios mínimos del rol de la API (criterio 1): `SELECT` e `INSERT` en `asistencias` (una asistencia no cambia
-- ni se borra) y `UPDATE (clases_usadas)` en `matriculas` (cada asistencia descuenta una clase en la misma transacción). Prisma no conoce el único
-- parcial, los CHECK, las políticas ni los privilegios: van a mano aquí.
-- Reversible a mano: quitar la tabla y los tres tipos, y revocar `UPDATE (clases_usadas)` sobre `matriculas`.

-- 1. Comprobación del rol de la API (como las migraciones anteriores).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipos. `tipo_asistencia` nace con los cuatro valores de D-07 (DT-6): la 009 solo escribe `NORMAL`; la recuperación (018), el otro horario
-- (020) y las particulares (016) no necesitan otra migración de tipo.
CREATE TYPE "metodo_asistencia" AS ENUM ('QR', 'MANUAL');
CREATE TYPE "tipo_asistencia" AS ENUM ('NORMAL', 'RECUPERACION', 'FUERA_HORARIO', 'PARTICULAR');
CREATE TYPE "estado_llegada" AS ENUM ('PUNTUAL', 'TARDE');

-- 3. Tabla.
CREATE TABLE "asistencias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "alumno_id" UUID NOT NULL,
    "matricula_id" UUID NOT NULL,
    -- La clase apunta a `clases` y no a `matricula_clases` (DT-7): que sea de la matrícula lo comprueba la API; así caben las asistencias de
    -- recuperación y en otro horario de 018 y 020.
    "clase_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "llegada_en" TIMESTAMPTZ(3) NOT NULL,
    "registrado_en" TIMESTAMPTZ(3) NOT NULL,
    "metodo" "metodo_asistencia" NOT NULL,
    "tipo" "tipo_asistencia" NOT NULL DEFAULT 'NORMAL',
    "estado_llegada" "estado_llegada" NOT NULL,
    "registrado_por" UUID NOT NULL,
    "registro_posterior" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,
    "clave_idempotencia" UUID NOT NULL,

    CONSTRAINT "asistencias_pkey" PRIMARY KEY ("id"),
    -- Las llaves compuestas de las tablas siguientes (la 009b) apuntan a (academia_id, id) y a (academia_id, id, alumno_id, fecha).
    CONSTRAINT "asistencias_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "asistencias_academia_id_id_alumno_id_fecha_key" UNIQUE ("academia_id", "id", "alumno_id", "fecha"),
    -- Una clave por academia: el 409 y el 200 de un reintento salen del nombre de esta restricción (criterio 13).
    CONSTRAINT "asistencias_academia_id_clave_idempotencia_key" UNIQUE ("academia_id", "clave_idempotencia"),
    -- La fecha es la de Lima de la llegada, nunca la de la zona del servidor ni la de la sesión de la base (criterio 1, RNF-12). 05:00 UTC es la
    -- medianoche de Lima: 2026-12-01 04:59:59.999 UTC todavía es el 30/11.
    CONSTRAINT "asistencias_fecha_de_lima" CHECK ("fecha" = (("llegada_en" AT TIME ZONE 'America/Lima')::date)),
    CONSTRAINT "asistencias_registro_despues" CHECK ("registrado_en" >= "llegada_en"),
    -- Un registro posterior (D-16) es manual y lleva un motivo de 3 a 200 caracteres; una asistencia normal no lleva motivo.
    CONSTRAINT "asistencias_posterior_coherente" CHECK (
      CASE "registro_posterior"
        WHEN true THEN "metodo" = 'MANUAL' AND "motivo" IS NOT NULL AND char_length("motivo") BETWEEN 3 AND 200
        ELSE "motivo" IS NULL
      END
    )
);

-- Sin borrado en cascada: una academia no se borra, solo se suspende (DR-10 de 001).
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Llaves compuestas (criterio 12 de 001 y criterio 1 de 009): nada apunta a una fila de otra academia, y la matrícula es del mismo alumno.
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_academia_id_matricula_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "matricula_id", "alumno_id") REFERENCES "matriculas"("academia_id", "id", "alumno_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_academia_id_clase_id_fkey" FOREIGN KEY ("academia_id", "clase_id") REFERENCES "clases"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "asistencias" ADD CONSTRAINT "asistencias_academia_id_registrado_por_fkey" FOREIGN KEY ("academia_id", "registrado_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4. Índices. El único parcial es RN-16: una asistencia por alumno y día de Lima, salvo las particulares (016). El 409 de un choque sale de
-- su nombre (regla «El 409 de un choque» de 004). Los otros dos sirven a la lectura por matrícula y por fecha.
CREATE UNIQUE INDEX "asistencias_un_dia_key" ON "asistencias"("academia_id", "alumno_id", "fecha") WHERE "tipo" <> 'PARTICULAR';
CREATE INDEX "asistencias_academia_id_matricula_id_idx" ON "asistencias"("academia_id", "matricula_id");
CREATE INDEX "asistencias_academia_id_fecha_idx" ON "asistencias"("academia_id", "fecha");

-- 5. Seguridad a nivel de fila: activada y forzada. Solo cuenta la academia del contexto; la marca de plataforma no abre nada (D-29).
-- Sin política de UPDATE ni de DELETE: una asistencia no cambia ni se borra.
ALTER TABLE "asistencias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asistencias" FORCE ROW LEVEL SECURITY;

CREATE POLICY "asistencias_leer" ON "asistencias" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "asistencias_crear" ON "asistencias" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());

-- 6. Privilegios mínimos del rol de la API (criterio 1). Solo `SELECT` e `INSERT`; el descuento de cada asistencia sube `clases_usadas` de la
-- matrícula (el CHECK de la 005 impide pasar de `clases_totales`).
GRANT SELECT, INSERT ON "asistencias" TO "aquagestion_app";
GRANT UPDATE ("clases_usadas") ON "matriculas" TO "aquagestion_app";
