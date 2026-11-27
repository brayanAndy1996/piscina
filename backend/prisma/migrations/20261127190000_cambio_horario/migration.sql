-- Historia 010c · Cambio de horario (HU-03, RN-08, D-23; criterio 34 de 010). El cambio de horario de una matrícula borra las clases que salen y agrega las
-- que entran en `matricula_clases` (DT-15): esta migración agrega la columna con el instante en que entró cada clase (`agregada_en`, nula en las filas de la
-- inscripción y de la renovación), la política y el privilegio de `DELETE` para el rol de la API (hasta ahora esa tabla solo se leía y se insertaba) y el
-- trigger que impide tocar las clases de una matrícula cerrada, aunque la API fallara y también para el dueño de las tablas (DT-17). Prisma no conoce la
-- política, el privilegio ni el trigger: van a mano aquí.
-- Reversible a mano: DROP TRIGGER "matricula_clases_solo_matricula_abierta" ON "matricula_clases"; DROP FUNCTION public.matricula_clases_solo_matricula_abierta();
-- DROP POLICY "matricula_clases_borrar" ON "matricula_clases"; REVOKE DELETE ON "matricula_clases" FROM "aquagestion_app"; ALTER TABLE "matricula_clases" DROP COLUMN "agregada_en".

-- 1. Comprobación del rol de la API (como las migraciones anteriores).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
  END IF;
END
$$;

-- 2. La columna: el instante («ahora» del cambio) en que la clase entró a la matrícula. Sin valor por defecto: las filas de la inscripción y de la renovación
-- la dejan nula y la regla de la «ocurrencia incluida» (DT-14 de 009) solo suma `agregada_en` cuando no es nula (criterio 38).
ALTER TABLE "matricula_clases" ADD COLUMN "agregada_en" TIMESTAMPTZ(3);

-- 3. Seguridad a nivel de fila: la política de `DELETE`, de la forma que exige la 001 (criterio 132). Solo cuenta la academia del contexto.
CREATE POLICY "matricula_clases_borrar" ON "matricula_clases" FOR DELETE
  USING ("academia_id" = public.app_academia_actual());

-- 4. Privilegio mínimo del rol de la API: `DELETE` (junto a `SELECT` e `INSERT`; sigue sin `UPDATE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER`).
GRANT DELETE ON "matricula_clases" TO "aquagestion_app";

-- 5. Trigger: solo se agregan o se quitan clases de una matrícula `RESERVADA` o `VIGENTE` (criterio 34). Una matrícula `FINALIZADA` o `CANCELADA`, una que no
-- existe o una que la sesión no ve (otra academia) responde 23514: cierra por defecto. Es `BEFORE` para ganar a la llave foránea (23503) y a la política de
-- inserción (42501). El cierre de mes (`UPDATE matriculas SET estado = 'FINALIZADA'`) y la cancelación no tocan `matricula_clases`, así que no pasan por aquí.
-- Se lee el estado actual de la matrícula con la academia de la fila: la API ya la tiene bloqueada (`FOR UPDATE`) cuando cambia el horario. SECURITY INVOKER y
-- sin más valores propios que search_path (criterio 124 de 001). El mensaje no lleva datos.
CREATE FUNCTION public.matricula_clases_solo_matricula_abierta() RETURNS trigger
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
   WHERE m.academia_id = v_academia AND m.id = v_matricula;

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

CREATE TRIGGER "matricula_clases_solo_matricula_abierta" BEFORE INSERT OR DELETE ON "matricula_clases"
  FOR EACH ROW EXECUTE FUNCTION public.matricula_clases_solo_matricula_abierta();
