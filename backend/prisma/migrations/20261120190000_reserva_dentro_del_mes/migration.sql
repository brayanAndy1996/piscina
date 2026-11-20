-- Reserva dentro del mes (spec 005, criterio 56; RN-28, DR-12): una matrícula nunca guarda una reserva que cruce el fin de su mes.
-- `reserva_vence_en` es nula o anterior al primer instante del mes siguiente al de `anio` y `mes` en America/Lima (para noviembre de 2026,
-- anterior a 2026-12-01T05:00:00.000Z). `timestamp AT TIME ZONE 'America/Lima'` da un `timestamptz` que no depende del `TimeZone` de la
-- sesión. El `CASE` evita que `make_date` falle con `22008` (en vez de `23514`) si `anio` o `mes` no existen: de eso se ocupan sus CHECK.
-- Se valida al crearla (sin `NOT VALID`): una base de desarrollo con una reserva de la semilla anterior que cruza el mes debe recrearse.
ALTER TABLE "matriculas"
  ADD CONSTRAINT "matriculas_reserva_dentro_del_mes" CHECK (
    "reserva_vence_en" IS NULL
    OR (
      CASE
        WHEN "anio" BETWEEN 2000 AND 9999 AND "mes" BETWEEN 1 AND 12
          THEN "reserva_vence_en" < ((make_date("anio"::int, "mes"::int, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Lima')
        ELSE false
      END
    )
  );
