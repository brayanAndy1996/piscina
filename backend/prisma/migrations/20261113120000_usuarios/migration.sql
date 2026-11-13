-- Historia 002 · Autenticación y roles por academia (D-17, D-23, D-28).
-- Tabla `usuarios` (por academia): el personal y los alumnos. El usuario es el DNI, único dentro de cada academia. RLS activada y
-- forzada, con las políticas de la forma que exige la 001 (criterio 132), y los privilegios mínimos del rol de la API
-- (aquagestion_app): sin cambiar el DNI, el rol, los nombres ni la academia, y sin borrar filas. Prisma no conoce las políticas,
-- los CHECK ni los privilegios: van a mano aquí.

-- 1. Comprobación del rol de la API (como la 001).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipos y tabla.
CREATE TYPE "rol_usuario" AS ENUM ('ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO');

CREATE TYPE "estado_usuario" AS ENUM ('ACTIVO', 'INACTIVO');

CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "dni" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "rol" "rol_usuario" NOT NULL,
    "clave_hash" TEXT NOT NULL,
    "debe_cambiar_clave" BOOLEAN NOT NULL DEFAULT true,
    "estado" "estado_usuario" NOT NULL DEFAULT 'ACTIVO',
    "version_token" INTEGER NOT NULL DEFAULT 0,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMPTZ(3),
    "ultimo_acceso" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id"),
    -- Exactamente 8 dígitos ASCII (DR-10). En PostgreSQL, `$` solo coincide al final del texto (no antes de un salto de línea).
    CONSTRAINT "usuarios_dni_formato" CHECK ("dni" ~ '^[0-9]{8}$'),
    -- Las llaves foráneas compuestas de las historias siguientes apuntan a (academia_id, id).
    CONSTRAINT "usuarios_academia_id_id_key" UNIQUE ("academia_id", "id"),
    -- El DNI es único dentro de cada academia, no en todo el sistema (D-28, RN-03).
    CONSTRAINT "usuarios_academia_id_dni_key" UNIQUE ("academia_id", "dni")
);

CREATE INDEX "usuarios_academia_id_rol_apellidos_nombres_idx" ON "usuarios"("academia_id", "rol", "apellidos", "nombres");

-- Sin borrado en cascada: una academia no se borra, solo se suspende (DR-10 de 001).
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 3. Seguridad a nivel de fila: activada y forzada. Solo cuenta la academia del contexto; la marca de plataforma no abre nada
-- (D-29: el Superadmin no ve los datos internos de una academia). Sin política de DELETE: nadie borra usuarios.
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usuarios" FORCE ROW LEVEL SECURITY;

CREATE POLICY "usuarios_leer" ON "usuarios" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "usuarios_crear" ON "usuarios" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "usuarios_modificar" ON "usuarios" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

-- 4. Privilegios mínimos del rol de la API (criterio 2): leer, crear y cambiar solo la clave, el estado y los contadores.
GRANT SELECT, INSERT ON "usuarios" TO "aquagestion_app";
GRANT UPDATE ("clave_hash", "debe_cambiar_clave", "estado", "version_token", "intentos_fallidos", "bloqueado_hasta", "ultimo_acceso", "actualizado_en")
  ON "usuarios" TO "aquagestion_app";
