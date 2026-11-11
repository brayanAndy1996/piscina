-- Historia 001 · Ataque ronda 2 (criterio 82). Sin tablas temporales para la API.
-- Una tabla temporal con el nombre de una tabla del negocio (por ejemplo `superadmins`) tapa a la verdadera durante la
-- sesión, porque el esquema temporal va primero en el `search_path`. Por defecto PostgreSQL concede TEMPORARY a PUBLIC
-- sobre la base: se revoca a PUBLIC y al rol de la API, sin quitar CONNECT. Idempotente. El dueño de la base conserva
-- sus privilegios. `npm run db:crear` hace las mismas revocaciones en las bases que crea o encuentra.
DO $$
BEGIN
  EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
    EXECUTE pg_catalog.format(
      'REVOKE CREATE, TEMPORARY ON DATABASE %I FROM aquagestion_app', pg_catalog.current_database()
    );
  END IF;
END
$$;

-- Nadie crea objetos en `public` por herencia de PUBLIC (ya es así por defecto desde PostgreSQL 15).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
