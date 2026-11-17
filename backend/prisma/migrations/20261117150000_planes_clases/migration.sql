-- Historia 004 · Planes, clases y aforo (D-17, D-23).
-- Tablas `planes` y `clases` (por academia), con RLS activada y forzada, las políticas de la forma que exige la 001 (criterio 132), la
-- llave foránea compuesta de las clases hacia `usuarios (academia_id, id)` (criterio 12 de 001), los CHECK de las invariantes que las
-- historias del cobro y del cupo darán por ciertas (precio, clases por mes, días, franjas, bloques y aforo) y los privilegios mínimos
-- del rol de la API (aquagestion_app): sin borrar filas y, en `clases`, sin cambiar el nivel, el día ni la hora (DR-4 de 004). Prisma no
-- conoce las políticas, los CHECK, los índices parciales ni el de `lower(nombre)`: van a mano aquí.

-- 1. Comprobación del rol de la API (como la 001 y la 002).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipo y tablas.
-- Los niveles los reutilizarán el alumno (005) y las evaluaciones (013).
CREATE TYPE "nivel_natacion" AS ENUM ('BASICO', 'INTERMEDIO', 'AVANZADO');

CREATE TABLE "planes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "veces_por_semana" SMALLINT NOT NULL,
    "clases_por_mes" SMALLINT NOT NULL,
    "duracion_minutos" SMALLINT NOT NULL DEFAULT 60,
    -- El monto final con IGV incluido (D-03): numeric(10,2), nunca coma flotante.
    "precio" DECIMAL(10,2) NOT NULL,
    "dias_permitidos" SMALLINT[] NOT NULL,
    "franjas_permitidas" TIME(0)[] NOT NULL,
    "niveles_aplicables" "nivel_natacion"[] NOT NULL,
    "vigencia_inicio" DATE,
    "vigencia_fin" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planes_pkey" PRIMARY KEY ("id"),
    -- Las llaves foráneas compuestas de las historias siguientes apuntan a (academia_id, id).
    CONSTRAINT "planes_academia_id_id_key" UNIQUE ("academia_id", "id"),
    -- Criterio 4. Los límites de la API (clases por mes hasta 31, duración de 15 a 60, precio hasta 99 999.99, nombre de 3 a 80) no van a
    -- la base (decisión D3): aquí solo lo que el cobro y el cupo dan por cierto.
    CONSTRAINT "planes_precio_positivo" CHECK ("precio" > 0),
    CONSTRAINT "planes_clases_por_mes_positivas" CHECK ("clases_por_mes" >= 1),
    CONSTRAINT "planes_duracion_positiva" CHECK ("duracion_minutos" > 0),
    CONSTRAINT "planes_veces_por_semana_rango" CHECK ("veces_por_semana" BETWEEN 1 AND 7),
    -- `<@` con un arreglo vacío es verdadero: por eso cada arreglo lleva también su `cardinality`. Un NULL dentro de un arreglo no es
    -- igual a ningún valor, así que `<@` también lo rechaza.
    CONSTRAINT "planes_dias_permitidos_validos" CHECK (
      cardinality("dias_permitidos") >= "veces_por_semana"
      AND "dias_permitidos" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    ),
    CONSTRAINT "planes_franjas_permitidas_validas" CHECK (
      cardinality("franjas_permitidas") >= 1
      AND "franjas_permitidas" <@ ARRAY['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']::time(0)[]
    ),
    CONSTRAINT "planes_niveles_aplicables_no_vacios" CHECK (cardinality("niveles_aplicables") >= 1),
    CONSTRAINT "planes_vigencia_ordenada" CHECK (
      "vigencia_inicio" IS NULL OR "vigencia_fin" IS NULL OR "vigencia_fin" >= "vigencia_inicio"
    )
);

CREATE TABLE "clases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "nivel" "nivel_natacion" NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    -- Horas locales de Lima, sin zona (spec 004, "Horas de las clases").
    "hora_inicio" TIME(0) NOT NULL,
    "hora_fin" TIME(0) NOT NULL,
    "entrenador_id" UUID NOT NULL,
    "aforo" SMALLINT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clases_academia_id_id_key" UNIQUE ("academia_id", "id"),
    -- Criterio 4 (RN-09, RN-11): bloques de 1 hora de 08:00 a 20:00 y aforo de 20 a 50.
    CONSTRAINT "clases_aforo_rango" CHECK ("aforo" BETWEEN 20 AND 50),
    CONSTRAINT "clases_dia_semana_rango" CHECK ("dia_semana" BETWEEN 1 AND 7),
    CONSTRAINT "clases_hora_inicio_bloque" CHECK (
      "hora_inicio" = ANY (ARRAY['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']::time(0)[])
    ),
    CONSTRAINT "clases_hora_fin_una_hora_despues" CHECK ("hora_fin" = "hora_inicio" + interval '1 hour')
);

-- Sin borrado en cascada: una academia no se borra, solo se suspende (DR-10 de 001).
ALTER TABLE "planes" ADD CONSTRAINT "planes_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "clases" ADD CONSTRAINT "clases_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Una clase no puede apuntar al entrenador de otra academia, aunque la API fallara (criterio 12 de 001). Que el usuario sea un
-- ENTRENADOR activo lo comprueba la API: una llave no puede hacerlo.
ALTER TABLE "clases" ADD CONSTRAINT "clases_academia_id_entrenador_id_fkey" FOREIGN KEY ("academia_id", "entrenador_id") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 3. Índices.
-- El nombre del plan es único en la academia, sin distinguir mayúsculas y contando los inactivos (DR-8 de 004).
CREATE UNIQUE INDEX "planes_academia_id_nombre_minusculas_key" ON "planes"("academia_id", lower("nombre"));

CREATE INDEX "clases_academia_id_dia_semana_hora_inicio_idx" ON "clases"("academia_id", "dia_semana", "hora_inicio");

-- Los choques del bloque los decide la base (decisión D4): un entrenador no tiene dos clases activas en el mismo día y bloque (HU-17), y
-- hay como mucho una clase activa por nivel en cada bloque (DR-3 de 004, RN-10). Las clases inactivas no cuentan.
CREATE UNIQUE INDEX "clases_entrenador_bloque_activo_key" ON "clases"("academia_id", "entrenador_id", "dia_semana", "hora_inicio") WHERE "activo";
CREATE UNIQUE INDEX "clases_nivel_bloque_activo_key" ON "clases"("academia_id", "nivel", "dia_semana", "hora_inicio") WHERE "activo";

-- 4. Seguridad a nivel de fila: activada y forzada. Solo cuenta la academia del contexto; la marca de plataforma no abre nada (D-29).
-- Sin política de DELETE: los planes y las clases no se borran, se desactivan.
ALTER TABLE "planes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "planes_leer" ON "planes" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "planes_crear" ON "planes" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "planes_modificar" ON "planes" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "clases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clases" FORCE ROW LEVEL SECURITY;

CREATE POLICY "clases_leer" ON "clases" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "clases_crear" ON "clases" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "clases_modificar" ON "clases" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

-- 5. Privilegios mínimos del rol de la API (criterio 2). Ninguna tabla se borra ni se vacía. En `clases`, el nivel, el día y la hora no
-- se cambian (decisión D7); en ninguna tabla se cambia la academia.
GRANT SELECT, INSERT ON "planes" TO "aquagestion_app";
GRANT UPDATE ("nombre", "veces_por_semana", "clases_por_mes", "duracion_minutos", "precio", "dias_permitidos", "franjas_permitidas", "niveles_aplicables", "vigencia_inicio", "vigencia_fin", "activo", "actualizado_en")
  ON "planes" TO "aquagestion_app";

GRANT SELECT, INSERT ON "clases" TO "aquagestion_app";
GRANT UPDATE ("entrenador_id", "aforo", "activo", "actualizado_en")
  ON "clases" TO "aquagestion_app";
