-- Historia 005a · Inscripción pública, reserva y seguimiento (D-05, D-07, D-17, D-23, D-28; RN-01, RN-03, RN-11, RN-25, RN-27, RN-28).
-- Siete tablas por academia: `alumnos`, `apoderados`, `fichas_medicas`, `consentimientos`, `solicitudes_inscripcion`, `matriculas` y
-- `matricula_clases`, con RLS activada y forzada (políticas de la forma que exige la 001, criterio 132), llaves foráneas compuestas
-- (academia_id, …) -> (academia_id, id) hacia las demás tablas de la academia, los CHECK de las invariantes del cobro, el cupo y el
-- seguimiento (criterio 4) y los privilegios mínimos del rol de la API (aquagestion_app, criterio 2). Incluye también lo que usará la
-- 005b (foto y cancelación): `alumnos.foto_clave` con su privilegio de UPDATE y el estado CANCELADA de solicitudes y matrículas, para
-- que esa entrega no necesite migración. Prisma no conoce las políticas, los CHECK, los índices parciales ni los privilegios: van a
-- mano aquí.

-- 1. Comprobación del rol de la API (como la 001, la 002 y la 004).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipos.
-- El actor `PUBLICO` es el visitante sin cuenta (DT-2 de 005). PostgreSQL no deja usar un valor nuevo de un enumerado en la misma
-- transacción que lo crea: aquí no se usa; solo lo escribe la API.
ALTER TYPE "tipo_actor" ADD VALUE IF NOT EXISTS 'PUBLICO';

-- Sección 8.8 de los requerimientos. La 005 solo escribe `CLIENTE`; la 007 suma las transiciones.
CREATE TYPE "estado_alumno" AS ENUM ('CLIENTE', 'ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO');
-- La 007 suma los estados de la verificación del pago.
CREATE TYPE "estado_solicitud" AS ENUM ('PENDIENTE_PAGO', 'VENCIDA', 'CANCELADA');
CREATE TYPE "estado_matricula" AS ENUM ('RESERVADA', 'VIGENTE', 'FINALIZADA', 'CANCELADA');
-- D-07 (sin WhatsApp, D-08).
CREATE TYPE "tipo_consentimiento" AS ENUM ('DATOS_PERSONALES', 'DESLINDE', 'IMAGEN');
CREATE TYPE "otorgante_consentimiento" AS ENUM ('TITULAR', 'APODERADO');
-- Listas de DR-5 de 005 (N5).
CREATE TYPE "tipo_sangre" AS ENUM (
  'A_POSITIVO', 'A_NEGATIVO', 'B_POSITIVO', 'B_NEGATIVO', 'AB_POSITIVO', 'AB_NEGATIVO', 'O_POSITIVO', 'O_NEGATIVO', 'NO_SABE'
);
CREATE TYPE "grado_colegio" AS ENUM (
  'INICIAL',
  'PRIMARIA_1', 'PRIMARIA_2', 'PRIMARIA_3', 'PRIMARIA_4', 'PRIMARIA_5', 'PRIMARIA_6',
  'SECUNDARIA_1', 'SECUNDARIA_2', 'SECUNDARIA_3', 'SECUNDARIA_4', 'SECUNDARIA_5',
  'NO_ESTUDIA'
);
CREATE TYPE "parentesco" AS ENUM ('PADRE', 'MADRE', 'OTRO_APODERADO');

-- 3. Tablas.
-- La persona que se inscribe (RN-01: es cliente hasta que su primer pago se confirme). El DNI es único por academia (D-28).
CREATE TABLE "alumnos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "dni" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "fecha_nacimiento" DATE NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "direccion" TEXT,
    "grado_colegio" "grado_colegio",
    "nivel" "nivel_natacion" NOT NULL,
    -- La clave del archivo de la foto en `AlmacenArchivos` (005b); nunca el contenido.
    "foto_clave" TEXT,
    "estado" "estado_alumno" NOT NULL DEFAULT 'CLIENTE',
    -- La 007 la llena al crear su cuenta.
    "usuario_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alumnos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "alumnos_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "alumnos_academia_id_dni_key" UNIQUE ("academia_id", "dni"),
    -- Exactamente 8 dígitos ASCII (criterio 4 a). En PostgreSQL, `$` solo coincide al final del texto.
    CONSTRAINT "alumnos_dni_formato" CHECK ("dni" ~ '^[0-9]{8}$'),
    -- `'infinity'` y `'-infinity'` son fechas válidas de PostgreSQL pero no un día (criterio 4 b).
    CONSTRAINT "alumnos_fecha_nacimiento_finita" CHECK (isfinite("fecha_nacimiento"))
);

-- Un apoderado por alumno (D9 de 005). Se borra si la persona vuelve a inscribirse como mayor de edad (criterio 21 b).
CREATE TABLE "apoderados" (
    "alumno_id" UUID NOT NULL,
    "academia_id" UUID NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "parentesco" "parentesco" NOT NULL,
    "correo" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- La llave primaria lleva `academia_id` (criterios 126 y 131 de 001: toda unicidad de una tabla de academia la incluye). Sigue siendo un
    -- apoderado por alumno: `alumno_id` es único dentro de la academia y, por la llave compuesta hacia `alumnos`, en todo el sistema.
    CONSTRAINT "apoderados_pkey" PRIMARY KEY ("academia_id", "alumno_id"),
    CONSTRAINT "apoderados_dni_formato" CHECK ("dni" ~ '^[0-9]{8}$')
);

-- Datos de salud: sensibles (Ley 29733, RN-21). Una ficha por alumno.
CREATE TABLE "fichas_medicas" (
    "alumno_id" UUID NOT NULL,
    "academia_id" UUID NOT NULL,
    "tipo_sangre" "tipo_sangre" NOT NULL,
    "enfermedades" TEXT,
    "alergias" TEXT,
    "medicamentos" TEXT,
    "seguro" TEXT,
    "contacto_emergencia_nombre" TEXT NOT NULL,
    "contacto_emergencia_telefono" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Igual que `apoderados`: una ficha por alumno, con `academia_id` en la llave primaria (criterios 126 y 131 de 001).
    CONSTRAINT "fichas_medicas_pkey" PRIMARY KEY ("academia_id", "alumno_id")
);

-- La solicitud que sigue la persona con su código y su enlace (D-05, D-07). El token no se guarda: solo su SHA-256 (criterio 24).
CREATE TABLE "solicitudes_inscripcion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "alumno_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "clave_idempotencia" UUID NOT NULL,
    "estado" "estado_solicitud" NOT NULL DEFAULT 'PENDIENTE_PAGO',
    "ip_origen" INET,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_inscripcion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "solicitudes_inscripcion_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "solicitudes_inscripcion_academia_id_codigo_key" UNIQUE ("academia_id", "codigo"),
    CONSTRAINT "solicitudes_inscripcion_academia_id_token_hash_key" UNIQUE ("academia_id", "token_hash"),
    CONSTRAINT "solicitudes_inscripcion_academia_id_clave_idempotencia_key" UNIQUE ("academia_id", "clave_idempotencia"),
    -- `AQ-` y 6 caracteres del alfabeto de Crockford en mayúsculas, sin I, L, O ni U (criterio 24).
    CONSTRAINT "solicitudes_inscripcion_codigo_formato" CHECK ("codigo" ~ '^AQ-[0-9A-HJKMNP-TV-Z]{6}$'),
    -- SHA-256: 32 bytes.
    CONSTRAINT "solicitudes_inscripcion_token_hash_largo" CHECK (octet_length("token_hash") = 32)
);

-- Evidencia de los consentimientos (D-07, RNF-05): solo se agrega, nunca se modifica ni se borra.
CREATE TABLE "consentimientos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "alumno_id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "tipo" "tipo_consentimiento" NOT NULL,
    "version" TEXT NOT NULL,
    "aceptado_en" TIMESTAMPTZ(3) NOT NULL,
    "ip" INET,
    "otorgado_por" "otorgante_consentimiento" NOT NULL,
    -- Para `IMAGEN` es lo que eligió la persona; para los otros dos tipos es siempre `true`.
    "aceptado" BOOLEAN NOT NULL,

    CONSTRAINT "consentimientos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consentimientos_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "consentimientos_version_no_vacia" CHECK (length(btrim("version")) > 0),
    CONSTRAINT "consentimientos_obligatorios_aceptados" CHECK ("tipo" = 'IMAGEN' OR "aceptado")
);

-- La mensualidad de un alumno en un mes (RN-27: no hay matrícula de inscripción, solo la mensualidad). La reserva de la 005 es una
-- matrícula RESERVADA con vencimiento (D1 de 005). Guarda su propio precio y clases: un cambio del plan no la afecta (HU-19).
CREATE TABLE "matriculas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "alumno_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    -- Las renovaciones de la 010 no tienen solicitud.
    "solicitud_id" UUID,
    "anio" SMALLINT NOT NULL,
    "mes" SMALLINT NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "clases_totales" SMALLINT NOT NULL,
    "clases_usadas" SMALLINT NOT NULL DEFAULT 0,
    "es_proporcional" BOOLEAN NOT NULL,
    -- Montos con IGV incluido (D-03): numeric(10,2), nunca coma flotante.
    "precio_plan" DECIMAL(10,2) NOT NULL,
    "clases_por_mes_plan" SMALLINT NOT NULL,
    "monto_calculado" DECIMAL(10,2) NOT NULL,
    -- Los usa la 007 (ajuste del administrador, HU-34).
    "monto_ajustado" DECIMAL(10,2),
    "motivo_ajuste" TEXT,
    "estado" "estado_matricula" NOT NULL,
    -- Solo en `RESERVADA`: nulo significa "sin vencimiento" (pago en verificación, RN-28).
    "reserva_vence_en" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matriculas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "matriculas_academia_id_id_key" UNIQUE ("academia_id", "id"),
    -- Criterio 4 c. Cuidado con `NaN`: en PostgreSQL es mayor que cualquier número y `'NaN'::numeric > 0` es verdadero.
    CONSTRAINT "matriculas_anio_rango" CHECK ("anio" BETWEEN 2000 AND 9999),
    CONSTRAINT "matriculas_mes_rango" CHECK ("mes" BETWEEN 1 AND 12),
    CONSTRAINT "matriculas_clases_validas" CHECK (
      "clases_por_mes_plan" >= 1
      AND "clases_totales" BETWEEN 1 AND "clases_por_mes_plan"
      AND "clases_usadas" BETWEEN 0 AND "clases_totales"
    ),
    CONSTRAINT "matriculas_montos_validos" CHECK (
      "precio_plan" > 0 AND "precio_plan" <> 'NaN'::numeric
      AND "monto_calculado" > 0 AND "monto_calculado" <> 'NaN'::numeric
      AND ("monto_ajustado" IS NULL OR ("monto_ajustado" >= 0 AND "monto_ajustado" <> 'NaN'::numeric))
    ),
    -- Las fechas son las del mes de `anio` y `mes`. PostgreSQL evalúa los CHECK en orden alfabético y `make_date` falla con `22008` (no con
    -- `23514`) si el mes o el año no existen: el `CASE` fija que solo se llame con valores válidos.
    CONSTRAINT "matriculas_fechas_del_mes" CHECK (
      CASE
        WHEN "anio" BETWEEN 2000 AND 9999 AND "mes" BETWEEN 1 AND 12
          THEN "fecha_inicio" >= make_date("anio"::int, "mes"::int, 1)
            AND "fecha_inicio" <= "fecha_fin"
            AND "fecha_fin" = (make_date("anio"::int, "mes"::int, 1) + interval '1 month' - interval '1 day')::date
        ELSE false
      END
    ),
    CONSTRAINT "matriculas_reserva_coherente" CHECK ("estado" = 'RESERVADA' OR "reserva_vence_en" IS NULL)
);

-- Las clases elegidas de cada matrícula. La ocupación de una clase se cuenta aquí (criterios 6 y 20).
CREATE TABLE "matricula_clases" (
    "academia_id" UUID NOT NULL,
    "matricula_id" UUID NOT NULL,
    "clase_id" UUID NOT NULL,

    -- `academia_id` en la llave primaria (criterios 126 y 131 de 001).
    CONSTRAINT "matricula_clases_pkey" PRIMARY KEY ("academia_id", "matricula_id", "clase_id")
);

-- 4. Llaves foráneas. Sin borrado en cascada: nada de esto se borra (salvo el apoderado, con su propia sentencia) y una academia no se
-- borra, solo se suspende (DR-10 de 001). Toda referencia entre tablas de la academia es compuesta (academia_id, …) -> (academia_id, id):
-- una fila no puede apuntar a otra academia, aunque la API fallara (criterio 12 de 001).
ALTER TABLE "alumnos" ADD CONSTRAINT "alumnos_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "alumnos" ADD CONSTRAINT "alumnos_academia_id_usuario_id_fkey" FOREIGN KEY ("academia_id", "usuario_id") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "apoderados" ADD CONSTRAINT "apoderados_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "apoderados" ADD CONSTRAINT "apoderados_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fichas_medicas" ADD CONSTRAINT "fichas_medicas_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fichas_medicas" ADD CONSTRAINT "fichas_medicas_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "solicitudes_inscripcion" ADD CONSTRAINT "solicitudes_inscripcion_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "solicitudes_inscripcion" ADD CONSTRAINT "solicitudes_inscripcion_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_academia_id_solicitud_id_fkey" FOREIGN KEY ("academia_id", "solicitud_id") REFERENCES "solicitudes_inscripcion"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_academia_id_plan_id_fkey" FOREIGN KEY ("academia_id", "plan_id") REFERENCES "planes"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_academia_id_solicitud_id_fkey" FOREIGN KEY ("academia_id", "solicitud_id") REFERENCES "solicitudes_inscripcion"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "matricula_clases" ADD CONSTRAINT "matricula_clases_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "matricula_clases" ADD CONSTRAINT "matricula_clases_academia_id_matricula_id_fkey" FOREIGN KEY ("academia_id", "matricula_id") REFERENCES "matriculas"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "matricula_clases" ADD CONSTRAINT "matricula_clases_academia_id_clase_id_fkey" FOREIGN KEY ("academia_id", "clase_id") REFERENCES "clases"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5. Índices.
CREATE INDEX "alumnos_academia_id_estado_idx" ON "alumnos"("academia_id", "estado");

-- Una sola solicitud en espera de pago por alumno (criterio 4 e).
CREATE UNIQUE INDEX "solicitudes_inscripcion_alumno_pendiente_key" ON "solicitudes_inscripcion"("academia_id", "alumno_id") WHERE "estado" = 'PENDIENTE_PAGO';
CREATE INDEX "solicitudes_inscripcion_academia_id_alumno_id_idx" ON "solicitudes_inscripcion"("academia_id", "alumno_id");
-- El límite de reservas sin pagar por conexión (criterio 25).
CREATE INDEX "solicitudes_inscripcion_academia_id_ip_origen_estado_idx" ON "solicitudes_inscripcion"("academia_id", "ip_origen", "estado");

CREATE INDEX "consentimientos_academia_id_solicitud_id_idx" ON "consentimientos"("academia_id", "solicitud_id");

-- Una matrícula que ocupa cupo por alumno y mes (criterio 4 d): las canceladas y las finalizadas no cuentan.
CREATE UNIQUE INDEX "matriculas_alumno_mes_ocupa_cupo_key" ON "matriculas"("academia_id", "alumno_id", "anio", "mes") WHERE "estado" IN ('RESERVADA', 'VIGENTE');
CREATE INDEX "matriculas_academia_id_anio_mes_estado_idx" ON "matriculas"("academia_id", "anio", "mes", "estado");
CREATE INDEX "matriculas_academia_id_alumno_id_idx" ON "matriculas"("academia_id", "alumno_id");
CREATE INDEX "matriculas_academia_id_solicitud_id_idx" ON "matriculas"("academia_id", "solicitud_id");

-- Contar la ocupación de una clase (criterios 6, 17 y 41).
CREATE INDEX "matricula_clases_academia_id_clase_id_idx" ON "matricula_clases"("academia_id", "clase_id");

-- 6. Seguridad a nivel de fila: activada y forzada en las siete tablas. Solo cuenta la academia del contexto; la marca de plataforma no
-- abre nada (D-29). Sin política de DELETE salvo en `apoderados`.
ALTER TABLE "alumnos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alumnos" FORCE ROW LEVEL SECURITY;
CREATE POLICY "alumnos_leer" ON "alumnos" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "alumnos_crear" ON "alumnos" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "alumnos_modificar" ON "alumnos" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "apoderados" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apoderados" FORCE ROW LEVEL SECURITY;
CREATE POLICY "apoderados_leer" ON "apoderados" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "apoderados_crear" ON "apoderados" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "apoderados_modificar" ON "apoderados" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "apoderados_borrar" ON "apoderados" FOR DELETE
  USING ("academia_id" = public.app_academia_actual());

ALTER TABLE "fichas_medicas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fichas_medicas" FORCE ROW LEVEL SECURITY;
CREATE POLICY "fichas_medicas_leer" ON "fichas_medicas" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "fichas_medicas_crear" ON "fichas_medicas" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "fichas_medicas_modificar" ON "fichas_medicas" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "consentimientos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consentimientos" FORCE ROW LEVEL SECURITY;
CREATE POLICY "consentimientos_leer" ON "consentimientos" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "consentimientos_crear" ON "consentimientos" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "consentimientos_modificar" ON "consentimientos" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "solicitudes_inscripcion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solicitudes_inscripcion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "solicitudes_inscripcion_leer" ON "solicitudes_inscripcion" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "solicitudes_inscripcion_crear" ON "solicitudes_inscripcion" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "solicitudes_inscripcion_modificar" ON "solicitudes_inscripcion" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "matriculas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matriculas" FORCE ROW LEVEL SECURITY;
CREATE POLICY "matriculas_leer" ON "matriculas" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "matriculas_crear" ON "matriculas" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "matriculas_modificar" ON "matriculas" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "matricula_clases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matricula_clases" FORCE ROW LEVEL SECURITY;
CREATE POLICY "matricula_clases_leer" ON "matricula_clases" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "matricula_clases_crear" ON "matricula_clases" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "matricula_clases_modificar" ON "matricula_clases" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

-- 7. Privilegios mínimos del rol de la API (criterio 2). SELECT e INSERT en las siete; UPDATE solo de las columnas que cambian; DELETE
-- solo en `apoderados`. Nunca se cambia la academia, el DNI de un alumno, el código ni el token de una solicitud, ni los montos y las
-- clases de una matrícula; los consentimientos son evidencia (solo se agregan). Ni `creado_en` de `apoderados` ni de `fichas_medicas`
-- (P4). La 007 y la 010 amplían lo que necesiten en sus propias migraciones.
GRANT SELECT, INSERT ON "alumnos" TO "aquagestion_app";
GRANT UPDATE ("nombres", "apellidos", "fecha_nacimiento", "telefono", "correo", "direccion", "grado_colegio", "nivel", "foto_clave", "actualizado_en")
  ON "alumnos" TO "aquagestion_app";

GRANT SELECT, INSERT, DELETE ON "apoderados" TO "aquagestion_app";
GRANT UPDATE ("nombres", "apellidos", "dni", "telefono", "parentesco", "correo", "actualizado_en")
  ON "apoderados" TO "aquagestion_app";

GRANT SELECT, INSERT ON "fichas_medicas" TO "aquagestion_app";
GRANT UPDATE ("tipo_sangre", "enfermedades", "alergias", "medicamentos", "seguro", "contacto_emergencia_nombre", "contacto_emergencia_telefono", "actualizado_en")
  ON "fichas_medicas" TO "aquagestion_app";

GRANT SELECT, INSERT ON "consentimientos" TO "aquagestion_app";

GRANT SELECT, INSERT ON "solicitudes_inscripcion" TO "aquagestion_app";
GRANT UPDATE ("estado", "actualizado_en") ON "solicitudes_inscripcion" TO "aquagestion_app";

GRANT SELECT, INSERT ON "matriculas" TO "aquagestion_app";
GRANT UPDATE ("estado", "reserva_vence_en", "actualizado_en") ON "matriculas" TO "aquagestion_app";

GRANT SELECT, INSERT ON "matricula_clases" TO "aquagestion_app";
