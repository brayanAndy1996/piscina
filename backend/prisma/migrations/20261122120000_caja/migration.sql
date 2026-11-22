-- Historia 006a · Caja del día (D-17, D-23, D-25; HU-25 a HU-27, RN-17, RN-22).
-- Tres tablas por academia: `cajas`, `movimientos_caja` y `cierres_caja`, con RLS activada y forzada (políticas de la forma que exige la
-- 001, criterio 132), llaves foráneas compuestas (academia_id, …) -> (academia_id, id) hacia `usuarios`, `alumnos` y `cajas` (criterio 12
-- de 001), los CHECK de las invariantes del dinero (criterio 4), los índices únicos de una caja abierta, una caja por día, una sola entrada
-- por pago y un solo cierre vigente (criterio 5), el trigger que no deja insertar movimientos en una caja cerrada (criterio 6, PP1) y los
-- privilegios mínimos del rol de la API (aquagestion_app, criterio 2). Los movimientos no cambian y nada se borra. Los montos son
-- `numeric` (nunca coma flotante). Prisma no conoce las políticas, los CHECK, los índices parciales, el trigger ni los privilegios: van a
-- mano aquí.

-- 1. Comprobación del rol de la API (como la 001, la 002, la 004 y la 005).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipos.
-- Sección 8.8 de los requerimientos: la caja se abre, se cierra y el administrador la puede reabrir.
CREATE TYPE "estado_caja" AS ENUM ('ABIERTA', 'CERRADA');
CREATE TYPE "tipo_movimiento_caja" AS ENUM ('INGRESO', 'EGRESO');
-- La 019 suma el concepto del pago a un entrenador desde caja (RN-35).
CREATE TYPE "concepto_movimiento_caja" AS ENUM ('INSCRIPCION', 'MENSUALIDAD', 'CLASE_PARTICULAR', 'EGRESO_MENOR');
-- D-04: un Yape o una transferencia entra a la caja con su método y no suma al efectivo. La 007 lo reutiliza en `pagos`.
CREATE TYPE "metodo_pago" AS ENUM ('EFECTIVO', 'YAPE', 'TRANSFERENCIA');

-- 3. Tablas.
-- La caja del día: una caja abierta a la vez por academia y una por día (DR-1). `fecha` es la de America/Lima de `abierta_en`.
CREATE TABLE "cajas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "estado_caja" NOT NULL DEFAULT 'ABIERTA',
    "monto_inicial" DECIMAL(10,2) NOT NULL,
    "abierta_por" UUID NOT NULL,
    "abierta_en" TIMESTAMPTZ(3) NOT NULL,
    "clave_idempotencia" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cajas_pkey" PRIMARY KEY ("id"),
    -- Las llaves foráneas compuestas de las tablas siguientes apuntan a (academia_id, id).
    CONSTRAINT "cajas_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "cajas_academia_id_clave_idempotencia_key" UNIQUE ("academia_id", "clave_idempotencia"),
    -- Una caja por día (DR-1): el nombre lo traduce la API a CAJA_DEL_DIA_CERRADA.
    CONSTRAINT "cajas_academia_id_fecha_key" UNIQUE ("academia_id", "fecha"),
    -- Criterio 4 a. En `numeric`, `NaN` es mayor que todo número: `>= 0` no lo rechaza, por eso va también `<> 'NaN'`.
    CONSTRAINT "cajas_monto_inicial_valido" CHECK ("monto_inicial" >= 0 AND "monto_inicial" <> 'NaN'),
    -- La fecha de la caja es la de Lima (RNF-12): en UTC ya sería el día siguiente desde las 19:00 de Lima.
    CONSTRAINT "cajas_fecha_de_lima" CHECK ("fecha" = ("abierta_en" AT TIME ZONE 'America/Lima')::date)
);

-- Cada ingreso (de un cobro, 007) y cada egreso (menor, en efectivo) de la caja. No cambian ni se borran (DR-5): sin `actualizado_en`.
-- `pago_id` no tiene llave foránea todavía: la agrega la 007 cuando exista `pagos` (D-17).
CREATE TABLE "movimientos_caja" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "caja_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" "tipo_movimiento_caja" NOT NULL,
    "concepto" "concepto_movimiento_caja" NOT NULL,
    "metodo" "metodo_pago" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "descripcion" TEXT,
    "comprobante" TEXT,
    "alumno_id" UUID,
    "pago_id" UUID,
    "registrado_por" UUID NOT NULL,
    "registrado_en" TIMESTAMPTZ(3) NOT NULL,
    "clave_idempotencia" UUID,

    CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "movimientos_caja_academia_id_id_key" UNIQUE ("academia_id", "id"),
    -- El número (1, 2, 3…) se asigna con la caja bloqueada y ordena los movimientos de cada caja (D2).
    CONSTRAINT "movimientos_caja_academia_id_caja_id_numero_key" UNIQUE ("academia_id", "caja_id", "numero"),
    -- Criterio 4 b.
    CONSTRAINT "movimientos_caja_monto_positivo" CHECK ("monto" > 0 AND "monto" <> 'NaN'),
    CONSTRAINT "movimientos_caja_numero_positivo" CHECK ("numero" >= 1),
    -- Un ingreso viene de un cobro: concepto de ingreso, con su alumno y su pago, sin descripción, comprobante ni clave.
    CONSTRAINT "movimientos_caja_ingreso_coherente" CHECK (
      "tipo" <> 'INGRESO' OR (
        "concepto" <> 'EGRESO_MENOR'
        AND "alumno_id" IS NOT NULL AND "pago_id" IS NOT NULL
        AND "descripcion" IS NULL AND "comprobante" IS NULL AND "clave_idempotencia" IS NULL
      )
    ),
    -- Un egreso es menor, en efectivo (DR-3), con su descripción y su clave, sin alumno ni pago.
    CONSTRAINT "movimientos_caja_egreso_coherente" CHECK (
      "tipo" <> 'EGRESO' OR (
        "concepto" = 'EGRESO_MENOR' AND "metodo" = 'EFECTIVO'
        AND "descripcion" IS NOT NULL AND "clave_idempotencia" IS NOT NULL
        AND "alumno_id" IS NULL AND "pago_id" IS NULL
      )
    )
);

-- Cada cierre de una caja (D1): la foto de lo calculado al cerrar. Solo cambia para registrar su reapertura; así el primer cierre no se
-- pierde cuando el administrador reabre la caja y vuelve a cerrarla (el siguiente cierre lleva el número 2).
CREATE TABLE "cierres_caja" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "caja_id" UUID NOT NULL,
    "numero" SMALLINT NOT NULL,
    "movimientos_hasta" INTEGER NOT NULL,
    -- Las sumas de un día caben de sobra en numeric(12,2).
    "monto_inicial" DECIMAL(12,2) NOT NULL,
    "ingresos_efectivo" DECIMAL(12,2) NOT NULL,
    "ingresos_yape" DECIMAL(12,2) NOT NULL,
    "ingresos_transferencia" DECIMAL(12,2) NOT NULL,
    "egresos_efectivo" DECIMAL(12,2) NOT NULL,
    "esperado_efectivo" DECIMAL(12,2) NOT NULL,
    "monto_declarado" DECIMAL(12,2) NOT NULL,
    "diferencia" DECIMAL(12,2) NOT NULL,
    "observacion" TEXT,
    "tardio" BOOLEAN NOT NULL,
    "cerrado_por" UUID NOT NULL,
    "cerrado_en" TIMESTAMPTZ(3) NOT NULL,
    "clave_idempotencia" UUID NOT NULL,
    "reabierto_por" UUID,
    "reabierto_en" TIMESTAMPTZ(3),
    "motivo_reapertura" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cierres_caja_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cierres_caja_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "cierres_caja_academia_id_caja_id_numero_key" UNIQUE ("academia_id", "caja_id", "numero"),
    CONSTRAINT "cierres_caja_academia_id_clave_idempotencia_key" UNIQUE ("academia_id", "clave_idempotencia"),
    -- Criterio 4 c. Ningún monto es `NaN` (con `NaN` en una de las columnas, las cuentas "cuadran" porque `NaN = NaN` en `numeric`).
    CONSTRAINT "cierres_caja_montos_finitos" CHECK (
      "monto_inicial" <> 'NaN' AND "ingresos_efectivo" <> 'NaN' AND "ingresos_yape" <> 'NaN' AND "ingresos_transferencia" <> 'NaN'
      AND "egresos_efectivo" <> 'NaN' AND "esperado_efectivo" <> 'NaN' AND "monto_declarado" <> 'NaN' AND "diferencia" <> 'NaN'
    ),
    CONSTRAINT "cierres_caja_montos_no_negativos" CHECK (
      "monto_inicial" >= 0 AND "ingresos_efectivo" >= 0 AND "ingresos_yape" >= 0 AND "ingresos_transferencia" >= 0
      AND "egresos_efectivo" >= 0 AND "monto_declarado" >= 0
    ),
    -- Sección 4.3: esperado = inicial + ingresos en efectivo - egresos. Yape y transferencia no suman al efectivo (D-04).
    CONSTRAINT "cierres_caja_esperado_cuadra" CHECK ("esperado_efectivo" = "monto_inicial" + "ingresos_efectivo" - "egresos_efectivo"),
    CONSTRAINT "cierres_caja_diferencia_cuadra" CHECK ("diferencia" = "monto_declarado" - "esperado_efectivo"),
    -- Si no cuadra, se registra la diferencia con su observación (sección 4.3).
    CONSTRAINT "cierres_caja_diferencia_con_observacion" CHECK ("diferencia" = 0 OR "observacion" IS NOT NULL),
    CONSTRAINT "cierres_caja_numero_positivo" CHECK ("numero" >= 1),
    CONSTRAINT "cierres_caja_movimientos_hasta_valido" CHECK ("movimientos_hasta" >= 0),
    -- La reapertura se registra completa (quién, cuándo y el motivo, sección 11.4) o no se registra.
    CONSTRAINT "cierres_caja_reapertura_completa" CHECK (
      ("reabierto_por" IS NULL AND "reabierto_en" IS NULL AND "motivo_reapertura" IS NULL)
      OR ("reabierto_por" IS NOT NULL AND "reabierto_en" IS NOT NULL AND "motivo_reapertura" IS NOT NULL)
    ),
    CONSTRAINT "cierres_caja_reapertura_posterior" CHECK ("reabierto_en" IS NULL OR "reabierto_en" >= "cerrado_en")
);

-- Sin borrado en cascada: una academia no se borra, solo se suspende (DR-10 de 001).
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Llaves foráneas compuestas (criterio 12 de 001): nada apunta a una fila de otra academia, aunque la API fallara. Que quien abre o cierra
-- sea del personal lo comprueba la API (una llave no puede hacerlo).
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_academia_id_abierta_por_fkey" FOREIGN KEY ("academia_id", "abierta_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_academia_id_caja_id_fkey" FOREIGN KEY ("academia_id", "caja_id") REFERENCES "cajas"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_academia_id_registrado_por_fkey" FOREIGN KEY ("academia_id", "registrado_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_academia_id_caja_id_fkey" FOREIGN KEY ("academia_id", "caja_id") REFERENCES "cajas"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_academia_id_cerrado_por_fkey" FOREIGN KEY ("academia_id", "cerrado_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_academia_id_reabierto_por_fkey" FOREIGN KEY ("academia_id", "reabierto_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4. Índices únicos parciales (criterio 5). Los nombres los traduce la API a su 409 (regla «El 409 de un choque» de 004).
-- Una sola caja abierta por academia (RN-17, DR-1).
CREATE UNIQUE INDEX "cajas_una_abierta_por_academia" ON "cajas"("academia_id") WHERE "estado" = 'ABIERTA';
-- Un pago entra una sola vez a la caja.
CREATE UNIQUE INDEX "movimientos_caja_academia_id_pago_id_key" ON "movimientos_caja"("academia_id", "pago_id") WHERE "pago_id" IS NOT NULL;
-- La clave de idempotencia de un egreso (los ingresos usan el pago).
CREATE UNIQUE INDEX "movimientos_caja_academia_id_clave_idempotencia_key" ON "movimientos_caja"("academia_id", "clave_idempotencia") WHERE "clave_idempotencia" IS NOT NULL;
-- Un solo cierre vigente (sin reapertura) por caja.
CREATE UNIQUE INDEX "cierres_caja_un_vigente_por_caja" ON "cierres_caja"("academia_id", "caja_id") WHERE "reabierto_en" IS NULL;

-- 5. Trigger: ningún movimiento en una caja cerrada, también en la base (criterio 6, DT-4). Toma la fila de la caja con FOR SHARE: si una
-- transacción la está cerrando (UPDATE sin confirmar), el INSERT espera y, al confirmarse el cierre, falla. Rechaza solo si VE la caja y
-- no está ABIERTA (PP1): un `BEFORE INSERT` corre antes que la llave foránea y que el WITH CHECK de la RLS; si no ve la caja (no existe,
-- es de otra academia o la RLS la oculta), deja pasar la fila y deciden la llave compuesta (23503) o la política (42501). No comprueba el
-- día: eso lo decide la API con el reloj. SECURITY INVOKER y sin más valores propios que search_path (criterio 124 de 001).
CREATE FUNCTION public.movimientos_caja_solo_caja_abierta() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_estado public.estado_caja;
BEGIN
  SELECT c.estado INTO v_estado
    FROM public.cajas c
   WHERE c.academia_id = NEW.academia_id AND c.id = NEW.caja_id
     FOR SHARE;
  IF v_estado IS NOT NULL AND v_estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'La caja no está abierta' USING ERRCODE = 'check_violation', CONSTRAINT = 'movimientos_caja_solo_caja_abierta';
  END IF;
  RETURN NEW;
END
$$;

-- Nadie la llama a mano: solo la dispara el trigger, que no comprueba EXECUTE al disparar. Sin esto, la app (y cualquiera) tendría EXECUTE
-- por PUBLIC y el criterio 130 de 001 (privilegios en todos los esquemas) la contaría como privilegio de más.
REVOKE ALL ON FUNCTION public.movimientos_caja_solo_caja_abierta() FROM PUBLIC;

CREATE TRIGGER "movimientos_caja_solo_caja_abierta" BEFORE INSERT ON "movimientos_caja"
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_solo_caja_abierta();

-- 6. Seguridad a nivel de fila: activada y forzada. Solo cuenta la academia del contexto; la marca de plataforma no abre nada (D-29).
-- Sin política de DELETE: nada se borra. `movimientos_caja` tampoco tiene política de UPDATE: los movimientos no cambian (DR-5).
ALTER TABLE "cajas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cajas" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cajas_leer" ON "cajas" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "cajas_crear" ON "cajas" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "cajas_modificar" ON "cajas" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "movimientos_caja" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "movimientos_caja" FORCE ROW LEVEL SECURITY;

CREATE POLICY "movimientos_caja_leer" ON "movimientos_caja" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "movimientos_caja_crear" ON "movimientos_caja" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());

ALTER TABLE "cierres_caja" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cierres_caja" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cierres_caja_leer" ON "cierres_caja" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "cierres_caja_crear" ON "cierres_caja" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "cierres_caja_modificar" ON "cierres_caja" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

-- 7. Privilegios mínimos del rol de la API (criterio 2). Nada se borra ni se vacía. En `cajas` solo cambian el estado (la apertura y el cierre
-- de la caja, y la reapertura) y `actualizado_en`: no la fecha, el monto inicial, quién abrió ni la academia. Los movimientos no cambian
-- (sin UPDATE). En `cierres_caja` solo se registra la reapertura: ningún monto de un cierre cambia. El UPDATE de `cajas.estado` también
-- es lo que permite el `FOR SHARE` del trigger (PostgreSQL pide algún privilegio de UPDATE para bloquear filas).
GRANT SELECT, INSERT ON "cajas" TO "aquagestion_app";
GRANT UPDATE ("estado", "actualizado_en") ON "cajas" TO "aquagestion_app";

GRANT SELECT, INSERT ON "movimientos_caja" TO "aquagestion_app";

GRANT SELECT, INSERT ON "cierres_caja" TO "aquagestion_app";
GRANT UPDATE ("reabierto_por", "reabierto_en", "motivo_reapertura") ON "cierres_caja" TO "aquagestion_app";
