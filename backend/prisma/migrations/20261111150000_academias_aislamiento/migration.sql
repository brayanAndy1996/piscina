-- Historia 001 · Academias y aislamiento (D-23, D-29).
-- Tablas de la plataforma (academias, superadmins, auditoria_plataforma) y por academia (auditoria, configuraciones),
-- funciones de contexto, seguridad a nivel de fila (RLS) activada y forzada, y los privilegios mínimos del rol de la
-- API (aquagestion_app). Prisma no conoce las políticas, los CHECK ni las funciones: se mantienen a mano aquí.

-- 1. Comprobación del rol de la API (criterio 7). Lo crea `npm run db:crear` (en la nube, el hook de sesión).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipos y tablas.
CREATE TYPE "estado_academia" AS ENUM ('ACTIVA', 'SUSPENDIDA');

CREATE TYPE "tipo_actor" AS ENUM ('USUARIO', 'SUPERADMIN', 'SISTEMA');

CREATE TABLE "academias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "nombre_corto" TEXT NOT NULL,
    "estado" "estado_academia" NOT NULL DEFAULT 'ACTIVA',
    "motivo_suspension" TEXT,
    "suspendida_en" TIMESTAMPTZ(3),
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academias_pkey" PRIMARY KEY ("id"),
    -- Formato y largo del nombre corto (criterio 49); la lista de palabras reservadas la valida la API.
    CONSTRAINT "academias_nombre_corto_formato" CHECK (
        "nombre_corto" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND char_length("nombre_corto") BETWEEN 3 AND 30
    ),
    -- Suspendida si y solo si tiene fecha de suspensión.
    CONSTRAINT "academias_suspension_coherente" CHECK (("estado" = 'SUSPENDIDA') = ("suspendida_en" IS NOT NULL))
);

CREATE TABLE "superadmins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clave_hash" TEXT NOT NULL,
    "version_token" INTEGER NOT NULL DEFAULT 0,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMPTZ(3),
    "ultimo_acceso" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "superadmins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "superadmins_correo_minusculas" CHECK ("correo" = lower("correo"))
);

CREATE TABLE "auditoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "fecha_hora" TIMESTAMPTZ(3) NOT NULL,
    "actor_tipo" "tipo_actor" NOT NULL,
    "actor_id" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "datos_antes" JSONB,
    "datos_despues" JSONB,
    "motivo" TEXT,
    "ip" INET,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id"),
    -- Las llaves foráneas compuestas de las historias siguientes apuntan a (academia_id, id): una fila de una
    -- academia no puede referirse a una fila de otra (las llaves foráneas no pasan por RLS).
    CONSTRAINT "auditoria_academia_id_id_key" UNIQUE ("academia_id", "id")
);

CREATE TABLE "auditoria_plataforma" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fecha_hora" TIMESTAMPTZ(3) NOT NULL,
    "actor_tipo" "tipo_actor" NOT NULL,
    "actor_id" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "datos_antes" JSONB,
    "datos_despues" JSONB,
    "motivo" TEXT,
    "ip" INET,

    CONSTRAINT "auditoria_plataforma_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "configuraciones" (
    "academia_id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuraciones_pkey" PRIMARY KEY ("academia_id","clave"),
    CONSTRAINT "configuraciones_clave_formato" CHECK ("clave" ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- Índices.
CREATE UNIQUE INDEX "academias_nombre_corto_key" ON "academias"("nombre_corto");

CREATE UNIQUE INDEX "superadmins_correo_key" ON "superadmins"("correo");

CREATE INDEX "auditoria_academia_id_fecha_hora_idx" ON "auditoria"("academia_id", "fecha_hora" DESC);

CREATE INDEX "auditoria_plataforma_fecha_hora_idx" ON "auditoria_plataforma"("fecha_hora" DESC);

-- Llaves foráneas a academias(id): sin borrado en cascada (una academia no se borra, solo se suspende; DR-10).
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "configuraciones" ADD CONSTRAINT "configuraciones_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 3. Funciones de contexto. Todas SECURITY INVOKER y con nombres calificados, para que un objeto temporal no las desvíe.
-- El contexto lo fija la API con set_config(..., true) (local a la transacción): app.academia_id y app.plataforma.

-- Academia de la transacción, o NULL si falta o está vacía (tras un set_config local el valor queda en '', no en NULL).
CREATE FUNCTION public.app_academia_actual() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CAST(NULLIF(pg_catalog.current_setting('app.academia_id', true), '') AS pg_catalog.uuid) $$;

-- true solo si app.plataforma es exactamente 'si'.
CREATE FUNCTION public.app_es_plataforma() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(pg_catalog.current_setting('app.plataforma', true), '') = 'si' $$;

-- Única forma de encontrar una academia sin contexto (criterio 20). Busca por igualdad exacta (sin LIKE). Activa
-- la marca de plataforma con set_config solo mientras consulta y la restaura al salir, también si la consulta falla
-- (la cláusula SET app.plataforma de CREATE FUNCTION exige ser superusuario en PostgreSQL 16).
CREATE FUNCTION public.resolver_academia(p_nombre_corto text)
  RETURNS TABLE (id uuid, nombre text, nombre_corto text, estado text)
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_anterior text := COALESCE(pg_catalog.current_setting('app.plataforma', true), '');
BEGIN
  PERFORM pg_catalog.set_config('app.plataforma', 'si', true);
  BEGIN
    RETURN QUERY
      SELECT a.id, a.nombre, a.nombre_corto, a.estado::text
        FROM public.academias a
       WHERE a.nombre_corto = p_nombre_corto;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('app.plataforma', v_anterior, true);
    RAISE;
  END;
  PERFORM pg_catalog.set_config('app.plataforma', v_anterior, true);
  RETURN;
END
$$;

-- 4. Seguridad a nivel de fila: activada y forzada (también para el dueño de las tablas) en las cinco tablas.
ALTER TABLE "academias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academias" FORCE ROW LEVEL SECURITY;
ALTER TABLE "superadmins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "superadmins" FORCE ROW LEVEL SECURITY;
ALTER TABLE "auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auditoria" FORCE ROW LEVEL SECURITY;
ALTER TABLE "auditoria_plataforma" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auditoria_plataforma" FORCE ROW LEVEL SECURITY;
ALTER TABLE "configuraciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configuraciones" FORCE ROW LEVEL SECURITY;

-- Academias: se leen en la plataforma o la propia; se crean y modifican solo en la plataforma.
CREATE POLICY "academias_leer" ON "academias" FOR SELECT
  USING (public.app_es_plataforma() OR "id" = public.app_academia_actual());
CREATE POLICY "academias_crear" ON "academias" FOR INSERT
  WITH CHECK (public.app_es_plataforma());
CREATE POLICY "academias_modificar" ON "academias" FOR UPDATE
  USING (public.app_es_plataforma()) WITH CHECK (public.app_es_plataforma());

-- Superadmins y su auditoría: solo en la plataforma.
CREATE POLICY "superadmins_plataforma" ON "superadmins" FOR ALL
  USING (public.app_es_plataforma()) WITH CHECK (public.app_es_plataforma());
CREATE POLICY "auditoria_plataforma_plataforma" ON "auditoria_plataforma" FOR ALL
  USING (public.app_es_plataforma()) WITH CHECK (public.app_es_plataforma());

-- Tablas por academia: la marca de plataforma no abre nada; solo cuenta la academia del contexto.
CREATE POLICY "auditoria_academia" ON "auditoria" FOR ALL
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "configuraciones_academia" ON "configuraciones" FOR ALL
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

-- 5. Privilegios mínimos del rol de la API (criterio 2). Sin ALTER DEFAULT PRIVILEGES: cada historia concede, en su
-- migración, solo lo que sus tablas necesitan.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "aquagestion_app";
GRANT USAGE ON SCHEMA public TO "aquagestion_app";

GRANT SELECT, INSERT ON "academias" TO "aquagestion_app";
GRANT UPDATE ("estado", "motivo_suspension", "suspendida_en", "actualizada_en") ON "academias" TO "aquagestion_app";

GRANT SELECT ON "superadmins" TO "aquagestion_app";
GRANT UPDATE ("intentos_fallidos", "bloqueado_hasta", "ultimo_acceso", "version_token", "actualizado_en")
  ON "superadmins" TO "aquagestion_app";

GRANT SELECT, INSERT ON "auditoria", "auditoria_plataforma" TO "aquagestion_app";

GRANT SELECT, INSERT, UPDATE ON "configuraciones" TO "aquagestion_app";
