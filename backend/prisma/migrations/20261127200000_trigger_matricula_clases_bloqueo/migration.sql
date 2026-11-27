-- Historia 010c · Ataque, ronda 1 (F1). El trigger `matricula_clases_solo_matricula_abierta` leía `matriculas.estado` sin bloquear la fila: si otra
-- transacción ya había hecho `UPDATE matriculas SET estado = 'FINALIZADA'` sin confirmar, el `INSERT` o el `DELETE` en `matricula_clases` veía `VIGENTE`
-- y pasaba, y al confirmar las dos quedaba una matrícula `FINALIZADA` con las clases cambiadas. Ahora el `SELECT` toma la fila con `FOR SHARE` (como
-- `movimientos_caja_solo_caja_abierta`): si una transacción cierra la matrícula, el cambio espera y, al confirmarse el cierre, falla con 23514. El rol de
-- la API ya tiene `UPDATE` de columnas de `matriculas`, que es lo que PostgreSQL pide para bloquear filas. Sin ciclos: el cambio de horario ya tiene la
-- matrícula con `FOR UPDATE` (es la suya), y la inscripción y la renovación insertan las clases de una matrícula que crean en la misma transacción.
-- Misma función y mismo trigger: `CREATE OR REPLACE` conserva SECURITY INVOKER, el `search_path` fijo y el `REVOKE ALL … FROM PUBLIC` (se repite por claridad).
-- Reversible a mano: volver a crear la función de `20261127190000_cambio_horario` (sin `FOR SHARE`).
CREATE OR REPLACE FUNCTION public.matricula_clases_solo_matricula_abierta() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_academia uuid;
  v_matricula uuid;
  v_estado public.estado_matricula;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_academia := OLD.academia_id;
    v_matricula := OLD.matricula_id;
  ELSE
    v_academia := NEW.academia_id;
    v_matricula := NEW.matricula_id;
  END IF;

  SELECT m.estado INTO v_estado
    FROM public.matriculas m
   WHERE m.academia_id = v_academia AND m.id = v_matricula
     FOR SHARE;

  IF NOT FOUND OR v_estado NOT IN ('RESERVADA', 'VIGENTE') THEN
    RAISE EXCEPTION 'Las clases de una matrícula cerrada no cambian' USING ERRCODE = 'check_violation', CONSTRAINT = 'matricula_clases_solo_matricula_abierta';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.matricula_clases_solo_matricula_abierta() FROM PUBLIC;
