-- Historia 008a · Carnet digital y QR (criterio 1; RN-05, RN-06, D-23). El QR del carnet lleva un token aleatorio guardado en `alumnos`:
--   * `qr_token` (32 bytes al azar en base64url sin relleno, 43 caracteres), `qr_generado_en` y `qr_clave_idempotencia` (la clave de la
--     última regeneración, para que un doble clic no deje inservible el carnet recién impreso);
--   * índice único por academia y tres CHECK que valen también para el dueño de las tablas: formato, fecha junto con el token y ningún
--     `CLIENTE` con token (RN-05: sin pago confirmado no hay QR);
--   * un token para cada alumno que ya no está en `CLIENTE` (DT-3);
--   * `UPDATE` de las tres columnas para `aquagestion_app`, y nada más.
-- Reversible a mano: quitar los CHECK, el índice y las tres columnas.

ALTER TABLE "alumnos" ADD COLUMN "qr_token" text;
ALTER TABLE "alumnos" ADD COLUMN "qr_generado_en" timestamptz(3);
ALTER TABLE "alumnos" ADD COLUMN "qr_clave_idempotencia" uuid;

-- Relleno de los alumnos que ya existen. La migración corre como dueño de las tablas y `alumnos` tiene la seguridad a nivel de fila forzada:
-- sin contexto, el UPDATE no vería ninguna fila y no daría error. Por eso se lee la lista de academias con la marca de plataforma y se
-- actualiza academia por academia con su contexto, y se restauran los dos valores al terminar (todo local a la transacción). El token son
-- 32 bytes de dos `gen_random_uuid()` (244 bits al azar, sin depender de `pgcrypto`): `encode(…, 'base64')` de 32 bytes da 44 caracteres,
-- el último `=`, que se quita; `+` y `/` pasan a `-` y `_`.
DO $relleno$
DECLARE
  v_academia_anterior text := COALESCE(pg_catalog.current_setting('app.academia_id', true), '');
  v_plataforma_anterior text := COALESCE(pg_catalog.current_setting('app.plataforma', true), '');
  v_academias uuid[];
  v_academia uuid;
BEGIN
  PERFORM pg_catalog.set_config('app.plataforma', 'si', true);
  SELECT COALESCE(pg_catalog.array_agg(a.id), ARRAY[]::uuid[]) INTO v_academias FROM public.academias a;
  PERFORM pg_catalog.set_config('app.plataforma', '', true);

  FOREACH v_academia IN ARRAY v_academias LOOP
    PERFORM pg_catalog.set_config('app.academia_id', v_academia::text, true);
    UPDATE public.alumnos
       SET qr_token = pg_catalog.translate(
                        pg_catalog.rtrim(
                          pg_catalog.encode(
                            pg_catalog.decode(
                              pg_catalog.replace(gen_random_uuid()::text, '-', '') || pg_catalog.replace(gen_random_uuid()::text, '-', ''),
                              'hex'),
                            'base64'),
                          '='),
                        '+/', '-_'),
           qr_generado_en = pg_catalog.now()
     WHERE academia_id = v_academia AND estado <> 'CLIENTE' AND qr_token IS NULL;
  END LOOP;

  PERFORM pg_catalog.set_config('app.academia_id', v_academia_anterior, true);
  PERFORM pg_catalog.set_config('app.plataforma', v_plataforma_anterior, true);
END
$relleno$;

CREATE UNIQUE INDEX "alumnos_academia_id_qr_token_key" ON "alumnos"("academia_id", "qr_token");

ALTER TABLE "alumnos" ADD CONSTRAINT "alumnos_qr_formato" CHECK ("qr_token" IS NULL OR "qr_token" ~ '^[A-Za-z0-9_-]{43}$');
ALTER TABLE "alumnos" ADD CONSTRAINT "alumnos_qr_con_fecha" CHECK (("qr_token" IS NULL) = ("qr_generado_en" IS NULL));
ALTER TABLE "alumnos" ADD CONSTRAINT "alumnos_cliente_sin_qr" CHECK ("estado" <> 'CLIENTE' OR "qr_token" IS NULL);

GRANT UPDATE ("qr_token", "qr_generado_en", "qr_clave_idempotencia") ON "alumnos" TO "aquagestion_app";
