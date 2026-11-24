-- Historia 007a · Ronda adversarial 1 (criterio 58; D-04, RN-17, D-23). Ningún movimiento de caja con un pago que no está confirmado, en ningún
-- orden ni contexto. Reescribe las dos funciones de los triggers diferidos de la migración `20261124180100_pagos` (sin editarla):
--   * rechazan con 23514 cuando no ven la fila relacionada (la RLS la esconde, o todavía no existe con `SET CONSTRAINTS … IMMEDIATE`); nunca dan por
--     buena la transacción por no verla;
--   * leen el estado actual de las filas y no el del evento (en un trigger diferido, NEW es la fila del momento del evento);
--   * `pagos` también revisa los pagos que no están confirmados: no pueden tener movimiento;
--   * el trigger de `movimientos_caja` corre también en UPDATE y DELETE y revisa `OLD.pago_id`: el dueño de las tablas no puede romper el
--     invariante por ahí.
-- Mismos nombres, SECURITY INVOKER, search_path fijo y REVOKE ALL … FROM PUBLIC (criterio 124 de la 001). Sin cambios en los roles. Los mensajes no
-- llevan datos.

CREATE OR REPLACE FUNCTION public.pagos_confirmado_con_movimiento() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pago public.pagos%ROWTYPE;
  v_movimiento public.movimientos_caja%ROWTYPE;
BEGIN
  -- El estado actual del pago, no el del evento. Si no se ve (otro contexto de academia), se rechaza.
  SELECT p.* INTO v_pago
    FROM public.pagos p
   WHERE p.academia_id = NEW.academia_id AND p.id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se puede comprobar el pago contra su movimiento de caja' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
  END IF;

  SELECT m.* INTO v_movimiento
    FROM public.movimientos_caja m
   WHERE m.academia_id = v_pago.academia_id AND m.pago_id = v_pago.id;

  IF v_pago.estado <> 'CONFIRMADO' THEN
    -- Un pago pendiente o rechazado no tiene movimiento de caja.
    IF FOUND THEN
      RAISE EXCEPTION 'Un pago que no está confirmado no puede tener movimiento de caja' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
    END IF;
    RETURN NULL;
  END IF;

  IF NOT FOUND
     OR v_movimiento.tipo <> 'INGRESO'
     OR v_movimiento.alumno_id IS DISTINCT FROM v_pago.alumno_id
     OR v_movimiento.metodo <> v_pago.metodo
     OR v_movimiento.monto <> v_pago.monto
     OR v_movimiento.concepto <> v_pago.concepto THEN
    RAISE EXCEPTION 'Un pago confirmado necesita su movimiento de caja' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.pagos_confirmado_con_movimiento() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.movimientos_caja_con_pago_confirmado() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_movimiento public.movimientos_caja%ROWTYPE;
  v_pago public.pagos%ROWTYPE;
  v_otro public.movimientos_caja%ROWTYPE;
BEGIN
  -- 0. Disparo por sentencia (BEFORE UPDATE o DELETE): los movimientos no cambian (DR-5). La RLS no tiene política de UPDATE ni de DELETE sobre
  -- `movimientos_caja`, así que para el dueño de las tablas esas sentencias no alcanzan ninguna fila y el disparo por fila (más abajo) nunca corre.
  -- Este es el que las rechaza, también cuando no tocan ninguna fila (criterio 58 d).
  IF TG_LEVEL = 'STATEMENT' THEN
    RAISE EXCEPTION 'Los movimientos de caja no cambian ni se borran' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
  END IF;

  -- 1. El movimiento que queda (INSERT y UPDATE): con `pago_id`, el pago existe, está confirmado y coincide. Se lee el estado actual de la fila;
  -- si no se ve, se rechaza.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT m.* INTO v_movimiento
      FROM public.movimientos_caja m
     WHERE m.academia_id = NEW.academia_id AND m.id = NEW.id;
    IF NOT FOUND THEN
      IF NEW.pago_id IS NOT NULL THEN
        RAISE EXCEPTION 'No se puede comprobar el movimiento de caja contra su pago' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
      END IF;
    ELSIF v_movimiento.pago_id IS NOT NULL THEN
      SELECT p.* INTO v_pago
        FROM public.pagos p
       WHERE p.academia_id = v_movimiento.academia_id AND p.id = v_movimiento.pago_id;
      -- Un pago que no existe o que no se ve lo rechaza esta función. En el modo diferido, la llave compuesta da antes su 23503.
      IF NOT FOUND
         OR v_pago.estado <> 'CONFIRMADO'
         OR v_movimiento.tipo <> 'INGRESO'
         OR v_movimiento.alumno_id IS DISTINCT FROM v_pago.alumno_id
         OR v_movimiento.metodo <> v_pago.metodo
         OR v_movimiento.monto <> v_pago.monto
         OR v_movimiento.concepto <> v_pago.concepto THEN
        RAISE EXCEPTION 'Un movimiento de caja con pago necesita un pago confirmado igual' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
      END IF;
    END IF;
  END IF;

  -- 2. El pago que el movimiento tenía (UPDATE y DELETE): si sigue confirmado, tiene que seguir teniendo su movimiento igual. El trigger de
  -- `pagos` no se dispara cuando solo cambia el movimiento.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.pago_id IS NOT NULL THEN
    SELECT p.* INTO v_pago
      FROM public.pagos p
     WHERE p.academia_id = OLD.academia_id AND p.id = OLD.pago_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se puede comprobar el movimiento de caja contra su pago' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
    END IF;
    IF v_pago.estado = 'CONFIRMADO' THEN
      SELECT m.* INTO v_otro
        FROM public.movimientos_caja m
       WHERE m.academia_id = v_pago.academia_id AND m.pago_id = v_pago.id;
      IF NOT FOUND
         OR v_otro.tipo <> 'INGRESO'
         OR v_otro.alumno_id IS DISTINCT FROM v_pago.alumno_id
         OR v_otro.metodo <> v_pago.metodo
         OR v_otro.monto <> v_pago.monto
         OR v_otro.concepto <> v_pago.concepto THEN
        RAISE EXCEPTION 'Un pago confirmado necesita su movimiento de caja' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_confirmado_con_movimiento';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.movimientos_caja_con_pago_confirmado() FROM PUBLIC;

-- El trigger de `movimientos_caja` pasa a INSERT, UPDATE y DELETE, con el mismo nombre (CREATE OR REPLACE no sirve para los de restricción).
DROP TRIGGER "pagos_confirmado_con_movimiento" ON "movimientos_caja";
CREATE CONSTRAINT TRIGGER "pagos_confirmado_con_movimiento" AFTER INSERT OR UPDATE OR DELETE ON "movimientos_caja"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_con_pago_confirmado();

-- Disparo por sentencia, con la misma función: rechaza con 23514 todo UPDATE o DELETE sobre `movimientos_caja` (ver el punto 0 de la función). Para
-- el rol de la API, el privilegio (sin UPDATE ni DELETE, 42501) se comprueba antes y no cambia.
CREATE TRIGGER "movimientos_caja_no_cambian" BEFORE UPDATE OR DELETE ON "movimientos_caja"
  FOR EACH STATEMENT EXECUTE FUNCTION public.movimientos_caja_con_pago_confirmado();
