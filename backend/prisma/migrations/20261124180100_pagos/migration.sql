-- Historia 007a · Pagos (D-04, D-07, D-23, D-25; HU-04, HU-07 a HU-09, RN-01, RN-04, RN-17, RN-22, RN-28). La tabla `pagos` completa (con las
-- columnas del Yape y la transferencia, que usa la 007b), con RLS activada y forzada (políticas de la forma que exige la 001, criterio 132),
-- llaves compuestas (academia_id, …) (criterio 12 de 001), los CHECK de las invariantes (criterio 4), los índices únicos (criterio 4 f a h), el
-- trigger de transiciones (criterio 6), el trigger diferido «pago confirmado ⇔ su movimiento de caja» (criterio 5), la llave de
-- `movimientos_caja.pago_id` (diferida) y los privilegios mínimos del rol de la API (criterio 2). Los montos son `numeric`. Prisma no conoce las
-- políticas, los CHECK, los índices parciales, los triggers ni los privilegios: van a mano aquí.
-- Requiere la migración anterior (`CONFIRMADA` en `estado_solicitud`).

-- 1. Comprobación del rol de la API (como la 001, la 002, la 004, la 005 y la 006).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. Tipo. Reutiliza `metodo_pago` y `concepto_movimiento_caja` de la 006 (sección 8.8 de los requerimientos).
CREATE TYPE "estado_pago" AS ENUM ('PENDIENTE_VERIFICACION', 'CONFIRMADO', 'RECHAZADO');

-- 3. La matrícula y el pago son del mismo alumno: la llave del pago apunta a (academia_id, id, alumno_id).
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_academia_id_id_alumno_id_key" UNIQUE ("academia_id", "id", "alumno_id");

-- 4. Quién inscribió a la persona desde recepción (criterio 34). La app solo lo escribe al insertar (INSERT de la tabla entera, sin UPDATE).
ALTER TABLE "solicitudes_inscripcion" ADD COLUMN "registrada_por" UUID;
ALTER TABLE "solicitudes_inscripcion" ADD CONSTRAINT "solicitudes_inscripcion_academia_id_registrada_por_fkey"
  FOREIGN KEY ("academia_id", "registrada_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5. Tabla.
CREATE TABLE "pagos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academia_id" UUID NOT NULL,
    "alumno_id" UUID NOT NULL,
    "matricula_id" UUID NOT NULL,
    "concepto" "concepto_movimiento_caja" NOT NULL,
    "metodo" "metodo_pago" NOT NULL,
    "estado" "estado_pago" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    -- Lo que escribió la persona (recortado) y su forma normalizada (D-07, DT-9): el segundo es el que no se repite.
    "numero_operacion" TEXT,
    "numero_operacion_normalizado" TEXT,
    "fecha_operacion" DATE,
    -- Clave del archivo en `AlmacenArchivos` (D-19), nunca el contenido.
    "comprobante_clave" TEXT,
    "ip_origen" INET,
    "registrado_por" UUID,
    "verificado_por" UUID,
    "registrado_en" TIMESTAMPTZ(3) NOT NULL,
    "verificado_en" TIMESTAMPTZ(3),
    "motivo_rechazo" TEXT,
    "numero_ticket" INTEGER,
    "clave_idempotencia" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id"),
    -- Las llaves compuestas de las tablas siguientes apuntan a (academia_id, id).
    CONSTRAINT "pagos_academia_id_id_key" UNIQUE ("academia_id", "id"),
    CONSTRAINT "pagos_academia_id_clave_idempotencia_key" UNIQUE ("academia_id", "clave_idempotencia"),
    -- Un número de ticket por academia (criterio 4 h y 25). Los nulos (pendientes y rechazados) no chocan.
    CONSTRAINT "pagos_academia_id_numero_ticket_key" UNIQUE ("academia_id", "numero_ticket"),
    -- Criterio 4 a. En `numeric`, `NaN` es mayor que todo número: `<= 100000` ya lo rechaza, pero se dice aparte.
    CONSTRAINT "pagos_monto_valido" CHECK ("monto" > 0 AND "monto" <= 100000.00 AND "monto" = round("monto", 2) AND "monto" <> 'NaN'),
    -- Criterio 4 b: un egreso menor no es un pago.
    CONSTRAINT "pagos_concepto_de_ingreso" CHECK ("concepto" <> 'EGRESO_MENOR'),
    -- Criterio 4 c: el efectivo nace confirmado y sin datos de operación; Yape y transferencia llevan los cuatro.
    CONSTRAINT "pagos_datos_del_metodo" CHECK (
      CASE "metodo"
        WHEN 'EFECTIVO' THEN
          "estado" = 'CONFIRMADO' AND "numero_operacion" IS NULL AND "numero_operacion_normalizado" IS NULL
          AND "comprobante_clave" IS NULL AND "fecha_operacion" IS NULL
        ELSE
          "numero_operacion" IS NOT NULL AND "numero_operacion_normalizado" IS NOT NULL
          AND "comprobante_clave" IS NOT NULL AND "fecha_operacion" IS NOT NULL
      END
    ),
    -- Criterio 4 d.
    CONSTRAINT "pagos_numero_operacion_formato" CHECK (
      ("numero_operacion_normalizado" IS NULL OR "numero_operacion_normalizado" ~ '^(0|[1-9A-Z][0-9A-Z]{0,29})$')
      AND ("numero_operacion" IS NULL OR char_length("numero_operacion") BETWEEN 1 AND 40)
    ),
    -- Criterio 4 e: la coherencia del estado.
    CONSTRAINT "pagos_estado_coherente" CHECK (
      CASE "estado"
        WHEN 'PENDIENTE_VERIFICACION' THEN
          "verificado_por" IS NULL AND "verificado_en" IS NULL AND "motivo_rechazo" IS NULL AND "numero_ticket" IS NULL
        WHEN 'CONFIRMADO' THEN
          "verificado_por" IS NOT NULL AND "verificado_en" IS NOT NULL AND "numero_ticket" IS NOT NULL AND "motivo_rechazo" IS NULL
        ELSE
          "verificado_por" IS NOT NULL AND "verificado_en" IS NOT NULL AND "numero_ticket" IS NULL
          AND "motivo_rechazo" IS NOT NULL AND length(btrim("motivo_rechazo")) > 0
      END
    ),
    CONSTRAINT "pagos_verificado_despues_de_registrado" CHECK ("verificado_en" IS NULL OR "verificado_en" >= "registrado_en"),
    CONSTRAINT "pagos_numero_ticket_positivo" CHECK ("numero_ticket" IS NULL OR "numero_ticket" >= 1)
);

-- Sin borrado en cascada: una academia no se borra, solo se suspende (DR-10 de 001).
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_academia_id_fkey" FOREIGN KEY ("academia_id") REFERENCES "academias"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Llaves compuestas (criterio 12 de 001 y criterio 1 de 007): nada apunta a una fila de otra academia, y la matrícula es del mismo alumno.
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_academia_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "alumno_id") REFERENCES "alumnos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_academia_id_matricula_id_alumno_id_fkey" FOREIGN KEY ("academia_id", "matricula_id", "alumno_id") REFERENCES "matriculas"("academia_id", "id", "alumno_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_academia_id_registrado_por_fkey" FOREIGN KEY ("academia_id", "registrado_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_academia_id_verificado_por_fkey" FOREIGN KEY ("academia_id", "verificado_por") REFERENCES "usuarios"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 6. Índices (criterio 4 f y g, y la bandeja). Los nombres los traduce la API a su 409 (regla «El 409 de un choque» de 004).
-- Un solo pago abierto (pendiente o confirmado) por matrícula; uno rechazado no cuenta (D-05).
CREATE UNIQUE INDEX "pagos_un_abierto_por_matricula" ON "pagos"("academia_id", "matricula_id") WHERE "estado" IN ('PENDIENTE_VERIFICACION', 'CONFIRMADO');
-- Un número de operación (normalizado) por academia y método entre los pagos abiertos (DR-9, D-07).
CREATE UNIQUE INDEX "pagos_numero_operacion_abierto_key" ON "pagos"("academia_id", "metodo", "numero_operacion_normalizado")
  WHERE "estado" IN ('PENDIENTE_VERIFICACION', 'CONFIRMADO') AND "numero_operacion_normalizado" IS NOT NULL;
CREATE INDEX "pagos_academia_id_estado_registrado_en_idx" ON "pagos"("academia_id", "estado", "registrado_en");

-- 7. Trigger de transiciones (criterio 6): un pago pendiente se resuelve una vez (a `CONFIRMADO` o a `RECHAZADO`) y uno resuelto no cambia
-- nunca, tampoco con un UPDATE que no cambia nada ni para el dueño de las tablas. SECURITY INVOKER y sin más valores propios que
-- search_path (criterio 124 de 001). El mensaje no lleva datos.
CREATE FUNCTION public.pagos_transiciones() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.estado <> 'PENDIENTE_VERIFICACION' THEN
    RAISE EXCEPTION 'Un pago resuelto no cambia' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_transiciones';
  END IF;
  IF NEW.estado = 'PENDIENTE_VERIFICACION' THEN
    RAISE EXCEPTION 'Un pago pendiente solo pasa a confirmado o a rechazado' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_transiciones';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.pagos_transiciones() FROM PUBLIC;

CREATE TRIGGER "pagos_transiciones" BEFORE UPDATE ON "pagos"
  FOR EACH ROW EXECUTE FUNCTION public.pagos_transiciones();

-- 8. Triggers de restricción diferidos (criterio 5): al confirmar la transacción, cada pago `CONFIRMADO` tiene exactamente un movimiento de
-- caja con su `pago_id` (del mismo alumno, método, monto y concepto) y cada movimiento con `pago_id` apunta a un pago `CONFIRMADO`. El orden
-- de las escrituras dentro de la transacción es libre. Leen bajo la RLS de la transacción: el pago y su movimiento son de la misma academia
-- (llave compuesta). SECURITY INVOKER; los mensajes no llevan datos.
CREATE FUNCTION public.pagos_confirmado_con_movimiento() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_movimiento public.movimientos_caja%ROWTYPE;
BEGIN
  IF NEW.estado <> 'CONFIRMADO' THEN
    RETURN NULL;
  END IF;
  SELECT m.* INTO v_movimiento
    FROM public.movimientos_caja m
   WHERE m.academia_id = NEW.academia_id AND m.pago_id = NEW.id;
  IF NOT FOUND
     OR v_movimiento.tipo <> 'INGRESO'
     OR v_movimiento.alumno_id IS DISTINCT FROM NEW.alumno_id
     OR v_movimiento.metodo <> NEW.metodo
     OR v_movimiento.monto <> NEW.monto
     OR v_movimiento.concepto <> NEW.concepto THEN
    RAISE EXCEPTION 'Un pago confirmado necesita su movimiento de caja' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.pagos_confirmado_con_movimiento() FROM PUBLIC;

CREATE FUNCTION public.movimientos_caja_con_pago_confirmado() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pago public.pagos%ROWTYPE;
BEGIN
  IF NEW.pago_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.* INTO v_pago
    FROM public.pagos p
   WHERE p.academia_id = NEW.academia_id AND p.id = NEW.pago_id;
  -- Un pago que no existe (o de otra academia) lo rechaza la llave compuesta, con 23503.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_pago.estado <> 'CONFIRMADO'
     OR NEW.tipo <> 'INGRESO'
     OR NEW.alumno_id IS DISTINCT FROM v_pago.alumno_id
     OR NEW.metodo <> v_pago.metodo
     OR NEW.monto <> v_pago.monto
     OR NEW.concepto <> v_pago.concepto THEN
    RAISE EXCEPTION 'Un movimiento de caja con pago necesita un pago confirmado igual' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.movimientos_caja_con_pago_confirmado() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "pagos_confirmado_con_movimiento" AFTER INSERT OR UPDATE ON "pagos"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pagos_confirmado_con_movimiento();
CREATE CONSTRAINT TRIGGER "pagos_confirmado_con_movimiento" AFTER INSERT ON "movimientos_caja"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_con_pago_confirmado();

-- 9. Llave de `movimientos_caja.pago_id` (la 006 la dejó sin llave): diferida porque el pago en efectivo se inserta completo después de su
-- movimiento, en la misma transacción. Falla en el COMMIT si el pago no llega a existir (o es de otra academia).
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_academia_id_pago_id_fkey" FOREIGN KEY ("academia_id", "pago_id")
  REFERENCES "pagos"("academia_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- 10. Seguridad a nivel de fila: activada y forzada. Solo cuenta la academia del contexto; la marca de plataforma no abre nada (D-29).
-- Sin política de DELETE: nada se borra.
ALTER TABLE "pagos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pagos" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pagos_leer" ON "pagos" FOR SELECT
  USING ("academia_id" = public.app_academia_actual());
CREATE POLICY "pagos_crear" ON "pagos" FOR INSERT
  WITH CHECK ("academia_id" = public.app_academia_actual());
CREATE POLICY "pagos_modificar" ON "pagos" FOR UPDATE
  USING ("academia_id" = public.app_academia_actual()) WITH CHECK ("academia_id" = public.app_academia_actual());

-- 11. Privilegios mínimos del rol de la API (criterio 2). Un pago solo cambia al resolverse: estado, quién y cuándo, el motivo y el ticket.
-- No cambian el monto, el método, el número de operación, el comprobante, la fecha de operación, la matrícula ni el alumno. La confirmación
-- pasa al alumno de `CLIENTE` a `ALUMNO_ACTIVO` y le asigna su cuenta; el ajuste del administrador cambia el monto ajustado y su motivo.
GRANT SELECT, INSERT ON "pagos" TO "aquagestion_app";
GRANT UPDATE ("estado", "verificado_por", "verificado_en", "motivo_rechazo", "numero_ticket", "actualizado_en") ON "pagos" TO "aquagestion_app";
GRANT UPDATE ("estado", "usuario_id") ON "alumnos" TO "aquagestion_app";
GRANT UPDATE ("monto_ajustado", "motivo_ajuste") ON "matriculas" TO "aquagestion_app";
