# 001 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md), D-23, D-25, D-26, D-29 y la
spec [`000-esqueleto`](../000-esqueleto/spec.md).

Las versiones y nombres de librerías son orientativos; si la documentación vigente dice otra cosa, manda la
documentación y el implementador lo informa. Lo que no es orientativo es el contrato de `spec.md`.

## Módulos afectados

```
piscina/
├── package.json                         + plataforma:superadmin, env:completar
├── .env.example                         + DATABASE_URL_APP, JWT_SECRETO, SUPERADMIN_*, DATABASE_POOL_MAX (comentada)
├── eslint.config.mjs                    + regla de importaciones de Prisma (criterio 28) y del SQL de sesión (73)
├── eslint/regla-sql-sesion.mjs          nuevo, ataque ronda 1 (criterio 73); ronda 2: normalización (83, 84)
├── eslint/regla-acceso-base.mjs         nuevo, ataque ronda 2: import(), require, pg y @prisma (criterio 85);
│                                        ronda 3: extensiones, node_modules, cli/ e internos de prisma/ (95)
├── eslint.protegido.config.mjs          nuevo, ataque ronda 3: paso con --no-inline-config (criterio 96)
├── .github/workflows/ci.yml             + DATABASE_URL_APP y JWT_SECRETO en Linux (y en el E2E)
├── .claude/hooks/preparar-sesion.mjs    + creación del rol aquagestion_app (criterio 8); ronda 2: atributos (81);
│                                        ronda 17: entornoParaHijos sin BOM y esPuntoDeEntrada propio (169, 171)
├── scripts/
│   ├── lib/entorno.mjs                  + leerUrlApp(), urlAppSobre(base); ronda 8: parámetros de conexión en la
│   │                                    cadena de consulta (criterio 143, P-34); ronda 17: quitarBom, analizarEnv,
│   │                                    clavesPosiblesEnv (criterios 169 y 170, P-43)
│   ├── lib/punto-de-entrada.mjs         nuevo, ataque ronda 17: esPuntoDeEntrada y rutasIguales (criterio 171, P-44);
│   │                                    lo usan crear-bases, completar-env, compilar-contratos-si-falta y verificar-*
│   ├── lib/rol-app.mjs                  nuevo, ataque ronda 2: consulta y evaluación del rol (criterio 81);
│   │                                    ronda 3: privilegios, valores por defecto y verificador SCRAM (102 a 104)
│   ├── lib/dependencias-backend.mjs     nuevo, ataque ronda 5: lista permitida y lista negra (criterios 127 a 129)
│   ├── crear-bases.mjs                  + asegurarRolApp() (criterio 6); ronda 2: lista completa y TEMPORARY (81, 82);
│   │                                    ronda 5: esquemas del rol (123)
│   ├── completar-env.mjs                nuevo (criterio 63); ronda 17: analizarEnv, ilegibles, bytes conservados y
│   │                                    UTF-16 (criterio 170)
│   └── test/…                           pruebas de lo anterior; actualización de migraciones.test.mjs (criterio 65)
├── packages/contratos/src/
│   ├── academias.ts · plataforma.ts     nuevos (+ *.test.ts)
│   ├── texto.ts                         nuevo, ataque ronda 1: reglas de texto (criterios 76, 77)
│   └── error-api.ts                     + detallesValidacionSchema
├── backend/
│   ├── package.json                     + @node-rs/argon2, @nestjs/jwt (o jsonwebtoken), @nestjs/throttler, cookie-parser;
│   │                                    ronda 5: + express (criterio 128)
│   ├── prisma/schema.prisma             modelos Academia, Superadmin, Auditoria, AuditoriaPlataforma, Configuracion
│   ├── prisma/migrations/<marca>_academias_aislamiento/migration.sql
│   ├── prisma/migrations/<marca>_endurecer_rol_app/migration.sql   nuevo, ataque ronda 2 (criterio 82)
│   ├── prisma/seed.ts                   academias de ejemplo y superadmin de desarrollo (criterio 61)
│   ├── src/infraestructura/entorno/     + DATABASE_URL_APP, JWT_SECRETO, DATABASE_POOL_MAX (criterio 5)
│   ├── src/infraestructura/prisma/      BaseDatos, PrismaService interno, errores, verificación del rol;
│   │                                    ronda 3: envoltorio, sin proveedor del cliente, privilegios-app.ts (98 a 103)
│   ├── src/infraestructura/entorno/     ronda 3: retirarVariablesSensibles, llamada desde main.ts (criterio 99);
│   │                                    ronda 8: url-postgres.ts (criterio 143, P-34)
│   ├── src/infraestructura/seguridad/   claves (argon2) y tokens (JWT con RELOJ)
│   ├── src/comun/errores/               ErrorNegocio
│   ├── src/comun/filtros/               filtro: ErrorNegocio y detalles de validación (criterio 66)
│   ├── src/comun/validacion/            pipe de zod con detalles
│   ├── src/modulos/auditoria/           AuditoriaService
│   ├── src/modulos/academias/           academias (plataforma y pública) y sesión del superadmin
│   ├── src/modulos/salud/               usa BaseDatos.comprobarConexion()
│   ├── src/cli/superadmin.ts            comando plataforma:superadmin
│   └── test/
│       ├── utilidades/                  contrato de spec.md (las escribe el test-writer)
│       └── integracion/aislamiento/ · plataforma/ · academias/ · cli/
├── frontend/src/
│   ├── api/cliente.ts                   + envío con método y cuerpo, lectura de ErrorApi
│   ├── rutas/Rutas.tsx                  + /plataforma/*
│   └── modulos/plataforma/              Ingresar, Academias, ruta protegida
├── e2e/pruebas/plataforma.spec.ts       criterio 71
└── docs/guia-local-windows.md           criterio 67 (documentador)
```

## Diseño

### 1. Roles de PostgreSQL

Dos roles por servidor:

| Rol | Atributos | Lo usa |
| --- | --- | --- |
| dueño (`aquagestion`, el de `DATABASE_URL`) | superusuario en Docker y en la CI; `LOGIN CREATEDB` en la nube | migraciones, `db:crear`, semilla, comando del superadmin, utilidades de prueba |
| `aquagestion_app` | `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`, sin membresías | la API |

- **Docker y CI:** `scripts/crear-bases.mjs` agrega `asegurarRolApp(cliente, { usuario, clave })`, exportada para
  probarla. Conectado como el usuario de `DATABASE_URL` a la base `postgres`:
  1. Valida que el usuario de `DATABASE_URL_APP` sea `aquagestion_app` y distinto del de `DATABASE_URL`.
  2. Consulta `pg_roles`. Si existe: si `rolsuper` o `rolbypassrls`, error; si no, informa y sigue (no cambia la
     contraseña).
  3. Si no existe: comprueba `rolsuper` o `rolcreaterole` del usuario actual; si no puede, error con la indicación
     ("créalo con un superusuario: …" o "en la nube, ejecuta node .claude/hooks/preparar-sesion.mjs"). Si puede,
     `CREATE ROLE "aquagestion_app" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
     PASSWORD '<clave escapada>'` con `standard_conforming_strings = on`. La clave nunca aparece en mensajes (reusar
     `ocultarClaves` o equivalente).
  4. Con `CREATEROLE` en PostgreSQL 16, el creador queda con `ADMIN` sobre el rol creado; eso no le da privilegios
     al rol de la app (el criterio 1 mira las membresías **de** `aquagestion_app`, no las que otros tienen sobre él).
- **Nube:** el dueño no tiene `CREATEROLE`. El hook, en el paso 3, después del rol de `DATABASE_URL`, crea
  `aquagestion_app` con `runuser -u postgres -- psql` y la sentencia por la entrada estándar, igual que hoy. Nueva
  función pura `sentenciaCrearRolApp(usuario, clave)` con prueba unitaria. Luego `db:crear` lo encuentra y solo lo
  verifica.
- **Producción (hosting por decidir, D-21):** la guía explica crear los dos roles; queda como riesgo.
- **Resumen por entorno** _(precisión del contrato tras T1–T2, 11/11/2026; P-11 de `spec.md`)_: el dueño de las
  migraciones no siempre puede crear roles (en la nube, `aquagestion` no tiene `CREATEROLE`), así que el rol de la
  app lo crea un usuario con privilegios: en la nube, el hook como `postgres`; en Windows, `db:crear` con el usuario
  del contenedor de Docker (`POSTGRES_USER=aquagestion`, superusuario del contenedor, el mismo de `DATABASE_URL`);
  en la CI, `db:crear` con el usuario del servicio (`POSTGRES_USER`, superusuario). Las pruebas de integración de
  `asegurarRolApp` que crean roles corren solo donde el usuario puede hacerlo (Docker y CI) y se omiten con aviso en
  la nube.

### 2. Migración y RLS

Se crea con `npm run db:migracion -- --create-only --name academias_aislamiento` y se completa a mano. Orden:

1. **Comprobación del rol** (criterio 7):

   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aquagestion_app') THEN
       RAISE EXCEPTION 'Falta el rol aquagestion_app: ejecuta npm run db:crear (o npm run db:preparar).';
     END IF;
   END $$;
   ```

2. **Tipos y tablas** que genera Prisma (enums `estado_academia` y `tipo_actor`, o `text` con `CHECK`, a elección
   del implementador), más los `CHECK` y los índices del modelo de datos de `spec.md`.
3. **Funciones** (todas `SECURITY INVOKER`, con nombres calificados para que un objeto temporal no las desvíe):

   ```sql
   CREATE FUNCTION public.app_academia_actual() RETURNS uuid LANGUAGE sql STABLE AS
     $$ SELECT CAST(NULLIF(pg_catalog.current_setting('app.academia_id', true), '') AS pg_catalog.uuid) $$;

   CREATE FUNCTION public.app_es_plataforma() RETURNS boolean LANGUAGE sql STABLE AS
     $$ SELECT COALESCE(pg_catalog.current_setting('app.plataforma', true), '') = 'si' $$;

   CREATE FUNCTION public.resolver_academia(p_nombre_corto text)
     RETURNS TABLE (id uuid, nombre text, nombre_corto text, estado text)
     LANGUAGE plpgsql VOLATILE SECURITY INVOKER
     SET search_path = pg_catalog, public, pg_temp
   AS $$
   DECLARE
     v_anterior text := COALESCE(pg_catalog.current_setting('app.plataforma', true), '');
   BEGIN
     PERFORM pg_catalog.set_config('app.plataforma', 'si', true);
     BEGIN
       RETURN QUERY
         SELECT a.id, a.nombre, a.nombre_corto, a.estado::text FROM public.academias a
         WHERE a.nombre_corto = p_nombre_corto;
     EXCEPTION WHEN OTHERS THEN
       PERFORM pg_catalog.set_config('app.plataforma', v_anterior, true);
       RAISE;
     END;
     PERFORM pg_catalog.set_config('app.plataforma', v_anterior, true);
     RETURN;
   END $$;
   ```

   _(precisión del contrato tras T1–T2, 11/11/2026; P-10 de `spec.md`)_. En PostgreSQL 16, la cláusula
   `SET app.plataforma = 'si'` de `CREATE FUNCTION` falla cuando el dueño de la migración no es superusuario (la
   nube), así que la marca se activa en tiempo de ejecución con `set_config(…, true)` y se restaura al salir, también
   si la consulta falla. `RETURN QUERY` ejecuta la consulta en ese momento y guarda las filas, por eso la restauración
   posterior no cambia el resultado. Debe ser `VOLATILE` porque llama a `set_config`. La comparación es por igualdad,
   sin `LIKE` (criterio 20). La cláusula `SET search_path` sí funciona sin superusuario (es una variable del sistema).
   El código es orientativo; lo que manda es el comportamiento del criterio 20.
4. **RLS:** `ENABLE` y `FORCE ROW LEVEL SECURITY` en las cinco tablas, y políticas por comando (nombres
   orientativos):

   ```sql
   CREATE POLICY academias_leer ON academias FOR SELECT USING (app_es_plataforma() OR id = app_academia_actual());
   CREATE POLICY academias_crear ON academias FOR INSERT WITH CHECK (app_es_plataforma());
   CREATE POLICY academias_modificar ON academias FOR UPDATE USING (app_es_plataforma()) WITH CHECK (app_es_plataforma());

   CREATE POLICY superadmins_plataforma ON superadmins FOR ALL USING (app_es_plataforma()) WITH CHECK (app_es_plataforma());
   CREATE POLICY auditoria_plataforma_plataforma ON auditoria_plataforma FOR ALL USING (app_es_plataforma()) WITH CHECK (app_es_plataforma());

   CREATE POLICY auditoria_academia ON auditoria FOR ALL
     USING (academia_id = app_academia_actual()) WITH CHECK (academia_id = app_academia_actual());
   CREATE POLICY configuraciones_academia ON configuraciones FOR ALL
     USING (academia_id = app_academia_actual()) WITH CHECK (academia_id = app_academia_actual());
   ```

   Las políticas `FOR ALL` también cubren a `DELETE`, pero el rol de la app no tiene ese privilegio; el dueño (en la
   nube, sujeto a `FORCE`) sí necesita `INSERT` en `superadmins` y `auditoria_plataforma` para el comando y la
   semilla, que fijan el contexto de plataforma.
5. **Privilegios** (criterio 2):

   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM aquagestion_app;
   GRANT USAGE ON SCHEMA public TO aquagestion_app;
   GRANT SELECT, INSERT ON academias TO aquagestion_app;
   GRANT UPDATE (estado, motivo_suspension, suspendida_en, actualizada_en) ON academias TO aquagestion_app;
   GRANT SELECT ON superadmins TO aquagestion_app;
   GRANT UPDATE (intentos_fallidos, bloqueado_hasta, ultimo_acceso, version_token, actualizado_en) ON superadmins TO aquagestion_app;
   GRANT SELECT, INSERT ON auditoria, auditoria_plataforma TO aquagestion_app;
   GRANT SELECT, INSERT, UPDATE ON configuraciones TO aquagestion_app;
   ```

   Sin `ALTER DEFAULT PRIVILEGES`: cada historia concede, en su migración, solo lo que su tabla necesita.

`gen_random_uuid()` es nativa desde PostgreSQL 13. `prisma migrate dev` no conoce las políticas: no las borra ni
las detecta como diferencia; se escriben siempre a mano en el SQL de la migración.

### 3. `BaseDatos` (`backend/src/infraestructura/prisma/`)

- `PrismaService` (interno, no exportado por `index.ts`) crea el `PrismaClient` con
  `new PrismaPg({ connectionString: DATABASE_URL_APP, max: DATABASE_POOL_MAX })` y conexión perezosa.
- `BaseDatos` (exportado) recibe `PrismaService` y expone solo los cuatro métodos del contrato.
- **`conAcademia(academiaId, trabajo, opciones)`:**
  1. Si `academiaId` no es un UUID (expresión regular), lanza `ErrorAcademiaNoEncontrada` sin tocar la base.
  2. `await this.verificarRol()` (abajo).
  3. `prisma.$transaction(async (cliente) => { … }, { isolationLevel, maxWait: 10_000, timeout: 15_000 })`:
     - `` await cliente.$queryRaw`SELECT set_config('app.academia_id', ${academiaId}, true)` ``;
     - `` const filas = await cliente.$queryRaw`SELECT estado FROM academias WHERE id = ${academiaId}::uuid` `` (RLS
       deja ver solo la propia);
     - sin fila → `ErrorAcademiaNoEncontrada`; `SUSPENDIDA` → `ErrorAcademiaSuspendida`;
     - `return trabajo({ academiaId, cliente })`.
- **`comoPlataforma(trabajo, opciones)`:** igual, con `set_config('app.plataforma', 'si', true)` y sin academia.
- **`resolverAcademia(nombreCorto)`:** `verificarRol()` y una transacción corta sin contexto con
  `SELECT * FROM resolver_academia(${nombreCorto})`; devuelve la fila mapeada o `null`. La normalización y el
  formato los valida el controlador antes de llamar.
- **Los dos valores en cada transacción** _(ataque ronda 1, criterio 72)_: la primera sentencia de cada transacción
  fija ambos con `true`, sin importar lo que traiga la conexión (valores de sesión, `options` de la URL o valores por
  defecto del rol o de la base):
  - `conAcademia`: `SELECT set_config('app.plataforma', '', true), set_config('app.academia_id', ${id}, true)`;
  - `comoPlataforma`: `SELECT set_config('app.academia_id', '', true), set_config('app.plataforma', 'si', true)`;
  - `resolverAcademia`: los dos en `''` antes de llamar a `resolver_academia` (la función restaura el valor previo,
    que así es `''`).

  Conviene una sola función interna `fijarContexto(cliente, { academiaId, plataforma })` que siempre escribe los dos,
  para que ninguna variante olvide uno. Una sola sentencia con los dos `set_config` evita un viaje extra a la base.
- **`comprobarConexion()`:** `SELECT 1` sin verificar el rol (salud mantiene el contrato de 000).
- **`verificarRol()`:** una promesa memorizada que ejecuta, como la app:

  ```sql
  SELECT r.rolsuper, r.rolbypassrls,
         EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS es_miembro,
         EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relowner = r.oid) AS es_dueno
  FROM pg_roles r WHERE r.rolname = current_user;
  ```

  Si alguna es verdadera, guarda el rechazo con `ErrorRolBaseDatosInseguro` (no cambia mientras corre la API) y lo
  registra con nivel `error` una vez: "El rol de DATABASE_URL_APP no es seguro: es superusuario, tiene BYPASSRLS,
  es dueño de tablas o es miembro de otro rol. La API no atenderá datos hasta corregirlo." Si falla por conexión,
  borra la memoria para reintentar en la siguiente operación.
- **Errores:** los tres extienden `ErrorNegocio` (los dos de academia con su estado y código;
  `ErrorRolBaseDatosInseguro` con 500 `ERROR_INTERNO`, y el filtro lo registra como error del servidor).
- **Patrón para historias siguientes** (documentarlo en el JSDoc de `BaseDatos`):
  - petición con sesión de academia (002): la academia sale de la sesión → `conAcademia`;
  - página pública (`/a/{nombreCorto}`, 005): `resolverAcademia` → si está activa, `conAcademia(id)`;
  - tarea programada: `comoPlataforma` para listar las academias activas y un `conAcademia` por cada una, nunca una
    sola transacción para todas.
- **Regla de lint (criterio 28):** `no-restricted-imports` con `allowTypeImports: true` para los patrones del
  cliente generado (`**/generated/prisma/**`) y de `PrismaService`, aplicada a `backend/src/**/*.ts` excepto
  `backend/src/infraestructura/prisma/**`, `backend/src/cli/**` y las pruebas. Prueba con la clase `ESLint` y el
  `eslint.config.mjs` real (`eslint/regla-prisma.test.mjs`) _(precisión tras las pruebas de la ronda 1, 11/11/2026:
  antes decía `Linter`, como la regla del reloj de 000)_.
- **Regla de lint del SQL de sesión** _(ataque ronda 1, criterio 73)_: regla propia en `eslint/regla-sql-sesion.mjs`
  (con su `regla-sql-sesion.test.mjs`) que visita `Literal` de texto, `TemplateLiteral` y `TaggedTemplateExpression`;
  en las plantillas une los `quasis` con un marcador (por ejemplo `?`) y aplica, sin distinguir mayúsculas,
  expresiones como:
  - `set_config\s*\([^)]*,\s*false\s*\)`;
  - `\bset\s+(local\s+|session\s+)?app\.`, `\bset\s+session\b`, `\bset\s+role\b`;
  - `\breset\s+(app\.|role\b|all\b)`;
  - fuera de `backend/src/cli/**`, también `set_config\s*\(\s*'app\.`.

  Se aplica a `backend/src/**/*.ts` salvo `backend/src/infraestructura/prisma/**` y las pruebas (`**/*.test.ts`); la
  parte de `set_config('app.` excluye además `backend/src/cli/**`. Las expresiones son orientativas; lo que manda son
  los casos del criterio 73.

  _Precisión tras las pruebas de la ronda 1 (11/11/2026):_ antes de aplicar las expresiones se quitan del texto los
  comentarios SQL (`-- …` hasta el fin de la línea y `/* … */`), y las expresiones admiten espacios y saltos de línea
  alrededor de paréntesis, comas y comillas (`set_config( 'app.academia_id' , $1 , FALSE )`), siempre sin distinguir
  mayúsculas. La prueba (`eslint/regla-sql-sesion.test.mjs`) usa la clase `ESLint` con el `eslint.config.mjs` real.

### 4. Auditoría (`backend/src/modulos/auditoria/`)

- `AuditoriaService` con `registrarEnAcademia(tx, entrada)` y `registrarEnPlataforma(tx, entrada)`. Inserta con
  `tx.cliente` (misma transacción: criterio 30), `academia_id = tx.academiaId` y `fecha_hora = reloj.ahora()`.
- Los tipos `TransaccionAcademia` y `TransaccionPlataforma` son distintos a propósito: TypeScript impide auditar en
  la tabla equivocada.
- Los datos de `datosAntes` y `datosDespues` usan los nombres de campo de la API (camelCase). Nunca se pasan objetos
  completos de `superadmins` (llevarían `clave_hash`): se arma el objeto con los campos permitidos.
- _(precisión del contrato tras T1–T2, 11/11/2026; P-2 de `spec.md`)_: `entidad` es `academia` o `superadmin`, en
  singular; `ip` es `req.ip` de Express tal cual; con actor `SISTEMA`, `actorId` va nulo.
- Catálogo (P-3 de `spec.md`): la llave foránea `academia_id → academias(id)` se declara sin `ON DELETE` (queda
  `NO ACTION`) o con `RESTRICT`, y la restricción `UNIQUE (academia_id, id)` tiene exactamente esas dos columnas.

### 5. Seguridad compartida (`backend/src/infraestructura/seguridad/`)

La reutiliza 002 para los usuarios de academia.

- **`claves.ts`:** `hashearClave(clave)` y `verificarClave(hash, clave)` con `@node-rs/argon2` (argon2id, parámetros
  por defecto de la librería). `HASH_FICTICIO` calculado una vez al arrancar, para verificar contra él cuando el
  correo no existe y que el tiempo de respuesta no lo delate.
- **`tokens.ts`:** firmar y verificar JWT HS256 con `JWT_SECRETO`, lista de algoritmos permitidos `['HS256']` (rechaza
  `none` y otros), y la hora de `RELOJ` (`clockTimestamp` de `jsonwebtoken`, o `iat` y `exp` calculados a mano si se
  usa otra librería).
- **Cookie:** `cookie-parser` (o lectura directa de la cabecera) y una función que arma las opciones de
  `aq_plataforma` (criterio 36) según `NODE_ENV`.

### 6. Sesión del superadmin (`backend/src/modulos/academias/sesion-plataforma.*`)

- **Controlador:** `POST`, `GET` y `DELETE /plataforma/sesion`. `POST` con `@nestjs/throttler`
  (`ThrottlerModule.forRoot` con un límite nombrado, aplicado solo a esta ruta: 10 en 60 000 ms). El 429 pasa por
  el filtro como `DEMASIADAS_SOLICITUDES`.
- **Servicio, `iniciarSesion(correo, clave, ip)`:** todo en `comoPlataforma`:
  1. Busca por correo (ya normalizado por el esquema). Si no existe: `verificarClave(HASH_FICTICIO, clave)` y
     `CREDENCIALES_INVALIDAS`.
  2. Si `bloqueado_hasta > ahora`: 423 sin tocar nada (y sin verificar la clave).
  3. Verifica la clave **fuera** de la transacción si se quiere no retener la conexión durante el hash (argon2 tarda
     decenas de milisegundos); en ese caso, se relee y actualiza en una segunda transacción.
  4. Si falla: actualización atómica (criterio 40), por ejemplo
     `UPDATE superadmins SET intentos_fallidos = CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= $ahora
     THEN 1 ELSE intentos_fallidos + 1 END, bloqueado_hasta = CASE WHEN <nuevo valor> >= 5 THEN $ahora + 15 min ELSE
     NULL END … WHERE id = $id AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= $ahora) RETURNING …`. Si no
     actualiza ninguna fila (otro intento la bloqueó mientras tanto), responde 423. Con 5 o más responde 423; si no,
     401. Al bloquear, el contador queda en el valor que llegó (5) y se reinicia al primer fallo después de vencer.
  5. Si acierta: `intentos_fallidos = 0`, `bloqueado_hasta = NULL`, `ultimo_acceso = ahora`; firma el token con
     `version_token`.
  6. Registra en el log (sin la clave) el resultado: `info` para el éxito, `warn` para fallos y bloqueos.
- **La lógica del bloqueo como función pura** en `modulos/academias/dominio/bloqueo.ts`
  (`evaluarIntentoFallido(estado, ahora, reglas)`), con pruebas unitarias; reglas en una constante
  `REGLAS_BLOQUEO_SUPERADMIN = { maximoIntentos: 5, minutosBloqueo: 15 }` (valores aprobados por el responsable, DR-3 de `spec.md`).
- **Guard `SesionPlataformaGuard`:** lee solo la cookie (ignora `Authorization`), verifica el token, exige
  `tipo === 'plataforma'`, carga el superadmin en `comoPlataforma` y compara `ver` con `version_token`. Deja el
  superadmin en la petición (decorador `@SuperadminActual()`). Se aplica a todo el controlador de academias de la
  plataforma y a `GET /plataforma/sesion`.
- **Sesión exigida en todo el prefijo** _(precisión del contrato tras T1–T2, 11/11/2026; P-7 de `spec.md`)_: además
  del guard de los controladores, un middleware (o guard global) sobre `/api/plataforma` exige la sesión válida en
  cualquier ruta salvo `POST` y `DELETE /api/plataforma/sesion`, incluidas las inexistentes y las que llevan barra
  final, que sin sesión responden 401 `NO_AUTENTICADO` y no 404. Comparte con el guard la verificación del token
  (una sola función).
- **`DELETE`:** si la cookie es válida, `version_token = version_token + 1`; siempre responde 204 y borra la cookie
  con `aq_plataforma=`, `Max-Age=0` y `Path=/api/plataforma` (P-6 de `spec.md`; por ejemplo `res.clearCookie` con
  las mismas opciones de la cookie y `maxAge: 0`, comprobando que la cabecera resultante lleve `Max-Age=0`).
- **Límite** (P-5): 10 peticiones por IP en 60 segundos se atienden; la 11.ª recibe 429.
- **Límite antes de leer el cuerpo** _(ataque ronda 1, criterios 74 y 75)_: el `ThrottlerGuard` corre después del
  lector del cuerpo de Express, así que un JSON mal formado (400) o demasiado grande (413) nunca llega a contarse. El
  límite pasa a un middleware de Express que `instalarProteccionDePrefijos` (o `configurarApp`) instala **antes** del
  lector del cuerpo:
  - reconoce la ruta igual que el router de Express: método `POST` y `req.path` sin distinguir mayúsculas, con o sin
    barra final (la expresión `RUTA_DE_SESION` ya existe); `req.path` no incluye la cadena de consulta, así que
    `/api/plataforma/sesion?x=1` comparte el contador _(precisión tras las pruebas de la ronda 1, 11/11/2026)_;
  - cuenta por `req.ip` con el almacenamiento de `@nestjs/throttler` (`ThrottlerStorage.increment`, con el mismo
    `LIMITE_INICIO_SESION`: 10 en 60 000 ms) o con un almacén propio en memoria, y responde 429
    `DEMASIADAS_SOLICITUDES` por el filtro (como `responderError`) sin llamar a `siguiente()`;
  - se quita el `ThrottlerGuard` del controlador para no contar dos veces.
- **Orden de los middlewares de `/api`** (todos antes de que Nest registre su lector del cuerpo):
  1. `Cache-Control: no-store` (P-8);
  2. límite del inicio de sesión (criterio 75);
  3. sesión del prefijo `/api/plataforma` (P-7): sin sesión, 401 antes de mirar el cuerpo;
  4. tipo de contenido (criterio 74): `POST`, `PUT`, `PATCH` o `DELETE` con cuerpo (`Content-Length` > 0 o
     `Transfer-Encoding`) y un tipo distinto de `application/json` (`charset` ausente o `utf-8`) → 400
     `SOLICITUD_INVALIDA` con `detalles: { errores: [{ campo: '', mensaje }] }`; el tipo y el `charset` se comparan
     sin distinguir mayúsculas y con espacios opcionales alrededor del `;` _(precisión tras las pruebas de la ronda 1)_;
  5. lector JSON (`express.json`, `strict: true`, `limit: '100kb'` explícito, el valor por defecto actual; un cuerpo
     mayor da 413 `CARGA_EXCESIVA` por el filtro) _(precisión tras las pruebas de la ronda 1, 11/11/2026)_.

  Para que Nest no registre su lector `urlencoded`, se crea la aplicación con `bodyParser: false` y se registra solo
  el lector JSON en `configurarApp`, o se registran middlewares con los nombres `jsonParser` y `urlencodedParser`
  antes de `init` (el adaptador de Express omite los suyos si ya hay uno con ese nombre). `crearAppDePruebas` llama
  a `configurarApp`, así que el orden vale igual en las pruebas; confirmar con la versión de Nest instalada y, si
  ninguna opción funciona sin tocar las utilidades protegidas, detenerse e informar.

### 7. Academias (`backend/src/modulos/academias/`)

- **`AcademiasService`** (todo en `comoPlataforma`, con auditoría en la misma transacción):
  - `crear(datos, actor, ip)`: `INSERT`; si Prisma lanza la violación de unicidad (`P2002`) sobre `nombre_corto`,
    `ErrorNegocio(409, 'NOMBRE_CORTO_EN_USO')`. La restricción única resuelve la carrera (criterio 50).
  - `listar()`: `SELECT` con los campos de `AcademiaResumen`, ordenado por `nombre_corto`.
  - `suspender(id, motivo, actor, ip)`: `UPDATE academias SET estado = 'SUSPENDIDA', … WHERE id = $id AND estado =
    'ACTIVA'`; si no afecta filas, distingue con un `SELECT` entre 404 y 409. La condición en el `WHERE` resuelve la
    carrera (criterio 54).
  - `reactivar(id, motivo, actor, ip)`: igual, al revés.
  - El id se valida como UUID en el controlador (pipe); si no lo es, 404 `NO_ENCONTRADO`.
- **`AcademiasPlataformaController`** en `/plataforma/academias` con el guard de sesión.
- **`AcademiaPublicaController`** en `/a/:nombreCorto`: normaliza con `nombreCortoSchema` (sin la lista reservada no
  hace falta: una reservada no existe), si no cumple responde 404 `ACADEMIA_NO_ENCONTRADA`; luego
  `baseDatos.resolverAcademia`; `null` → 404; `SUSPENDIDA` → 403; si no, 200 con `{ nombreCorto, nombre }`.
  Conviene dejar la resolución en un pipe o decorador reutilizable (`AcademiaDeRuta`) para las rutas públicas de 002 y
  005.
- **Mapeo a la respuesta:** fechas con `toISOString()`; las respuestas se validan contra los esquemas estrictos en
  las pruebas, así que el servicio debe devolver exactamente esos campos.

### 8. Validación y errores

- `comun/errores/error-negocio.ts`: `class ErrorNegocio extends HttpException` con `codigo`, `mensaje` y `detalles`.
- `FiltroErrores`: si la excepción es `ErrorNegocio` y el estado es menor que 500, responde su `ErrorApi` tal cual;
  si es 500 o más, `ERROR_INTERNO` y log de error, como hoy.
- `comun/validacion/`: un pipe `ValidarCon(esquema)` que usa `safeParse` y, si falla, lanza
  `ErrorNegocio(400, 'SOLICITUD_INVALIDA', 'La solicitud no es válida.', { errores })` con `campo = path.join('.')`.
- Cuerpos no JSON: Express no los interpreta; el esquema estricto ve `undefined` o `{}` y responde 400.
  _(Ataque ronda 1: no bastaba, porque Nest registra también el lector `urlencoded`. Ahora los rechaza un middleware
  antes de leerlos; ver sección 6, criterio 74.)_
- **Reglas de texto compartidas** _(ataque ronda 1, criterios 76 y 77)_, en `packages/contratos/src/texto.ts`:
  - `sinControles(esquema)`: rechaza `\p{Cc}` y textos con `isWellFormed() === false`, con un mensaje propio; se
    aplica a `correo`, `clave`, `nombre`, `nombreCorto` y `motivo` (después del recorte, si el campo recorta);
  - `textoVisibleSchema({ min, max })`: recorta, aplica `sinControles`, rechaza `\p{Bidi_Control}`, U+2028 y
    U+2029, cuenta los puntos de código de `[\p{L}\p{N}\p{P}\p{S}]` (al menos 3) y comprueba la longitud; lo usan
    `crearAcademiaSchema.nombre`, `suspenderAcademiaSchema.motivo`, `reactivarAcademiaSchema.motivo` y el comando
    para `SUPERADMIN_NOMBRE`.

  Como el pipe valida antes de llamar al servicio, el 500 por el carácter nulo (PostgreSQL 22021) no llega a
  producirse. Expresiones con la bandera `u`; Node 22 admite `\p{Bidi_Control}` e `isWellFormed`. Pruebas unitarias
  en `texto.test.ts` con los ejemplos de los criterios 76 y 77.
- `Cache-Control: no-store` en un middleware de los prefijos `/api/plataforma` y `/api/a`, para que lo lleven también
  las respuestas de error (401, 404, 429, 500…) y las de rutas inexistentes; un decorador `@Header` o un interceptor
  no alcanzan a las respuestas que no pasan por el controlador _(precisión del contrato tras T1–T2, 11/11/2026; P-8
  de `spec.md`)_.
- **Registro técnico con pino** _(P-9 de `spec.md`)_: el `Logger` de Nest se redirige a pino (o se usa `PinoLogger`)
  con el destino que recibe `crearAppDePruebas({ destinoRegistro })`; ningún módulo escribe con `console`. El mensaje
  del rol inseguro (criterio 4) y los de inicio de sesión (criterio 46) pasan por ahí.
- **Ruta pública** _(P-4 de `spec.md`)_: el controlador recorta y pasa a minúsculas el segmento decodificado antes de
  validarlo (`delfines%0A` encuentra `delfines`; `del%0Afines` y `delfines%00` responden 404).

### 9. Comando `plataforma:superadmin` (`backend/src/cli/superadmin.ts`)

- Raíz: `"plataforma:superadmin": "npm run superadmin -w @aquagestion/backend"`; backend: `"superadmin": "tsx
  src/cli/superadmin.ts"`.
- Carga el `.env` de la raíz sin sobrescribir (como `prisma.config.ts`), valida las tres variables con los mismos
  esquemas de contratos (correo) y reglas de longitud, y se conecta con `DATABASE_URL` (dueño) usando su propio
  `PrismaClient` con el adaptador.
- En una transacción con `set_config('app.plataforma', 'si', true)`: busca por correo, crea o restablece, y audita
  (`SUPERADMIN_CREADO` o `SUPERADMIN_CLAVE_RESTABLECIDA`, actor `SISTEMA`). Para auditar reutiliza la misma función de
  inserción que `AuditoriaService` (sin Nest) o inserta directamente con el mismo formato.
- Mensajes: nunca la clave; ante un error de conexión imprime solo el motivo sin la URL (reusar la idea de
  `ocultarClaves`).
- _(Ataque ronda 1, criterios 76 y 77)_: valida `SUPERADMIN_CORREO` y `SUPERADMIN_CLAVE` con `sinControles` y
  `SUPERADMIN_NOMBRE` con `textoVisibleSchema({ min: 3, max: 100 })`, antes de conectarse.

### 10. Semilla (`backend/prisma/seed.ts`)

- Termina con código 1 si `NODE_ENV === 'production'`.
- _(Ataque ronda 1, criterio 78)_: antes, si `NODE_ENV` está definida y no es exactamente `development`, `test` o
  `production`, termina con código 1 y un mensaje que nombra la variable y los valores permitidos. Conviene una
  función compartida `leerNodeEnv(env)` (por ejemplo en `backend/src/infraestructura/entorno/`) que usen
  `validarEntorno` y la semilla.
- Con `DATABASE_URL` (dueño) y contexto de plataforma: crea `delfines` y `tiburones` si no existen (`INSERT … ON
  CONFLICT (nombre_corto) DO NOTHING`), sin auditoría (son datos de ejemplo). Si están las tres variables
  `SUPERADMIN_*`, crea el superadmin si no existe, con la misma función del comando pero sin restablecer.
- Imprime: "Academia de ejemplo creada: delfines" o "La academia de ejemplo ya existía: delfines", y lo mismo para
  el superadmin (con el correo, sin la clave).

### 11. Entorno, `.env` y CI

- `validarEntorno` (criterio 5): `DATABASE_URL_APP`, `JWT_SECRETO`, `DATABASE_POOL_MAX`, `PUERTO_API`, `NODE_ENV`.
  Constante `JWT_SECRETO_DE_EJEMPLO` con el valor de `.env.example`, para rechazarlo en producción. El tipo `Entorno`
  tiene los campos con esos mismos nombres (`DATABASE_POOL_MAX` numérico, 10 por defecto) y pierde `DATABASE_URL`:
  la API ya no la exige ni la devuelve _(precisión del contrato tras T1–T2, 11/11/2026; P-1 de `spec.md`)_.
- _(Ataque ronda 1, criterios 78 y 79)_:
  - `NODE_ENV`: ausente → `undefined` (fuera de producción, como prueba `entorno.test.ts` de 000); definida → debe
    estar en `['development', 'test', 'production']` por igualdad exacta; si no, problema "La variable NODE_ENV debe
    ser development, test o production." (sin el valor). El tipo pasa a `'development' | 'test' | 'production' |
    undefined`.
  - Con `production`, `JWT_SECRETO` además: fuera de `JWT_SECRETOS_PUBLICOS` (el de `.env.example`, el de
    `JWT_SECRETO_PRUEBAS` y el de respaldo de `e2e/playwright.config.ts`, copiados como constantes), sin `\s`, al
    menos 32 puntos de código (`[...secreto].length`) y al menos 10 distintos (`new Set([...secreto]).size`). Un
    solo mensaje que nombra `JWT_SECRETO` y explica la regla, sin el valor.
  - Prueba unitaria que lee `.env.example` y `e2e/playwright.config.ts`, importa `JWT_SECRETO_PRUEBAS` y comprueba
    que los tres están en `JWT_SECRETOS_PUBLICOS`.
- `.env.example` (orientativo):

  ```
  # Conexión de la API: rol sin privilegios, sujeto a la seguridad por academia (RLS). No uses aquí el de DATABASE_URL.
  DATABASE_URL_APP=postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion
  # Conexiones simultáneas de la API a la base (opcional, por defecto 10).
  # DATABASE_POOL_MAX=10
  # Secreto para firmar las sesiones (solo desarrollo: en producción usa uno largo y aleatorio).
  JWT_SECRETO=solo-desarrollo-cambia-este-secreto-de-ejemplo-0001
  # Superadmin de desarrollo (lo crea npm run db:semilla; en producción usa npm run plataforma:superadmin).
  SUPERADMIN_CORREO=superadmin@aquagestion.test
  SUPERADMIN_NOMBRE=Superadmin de desarrollo
  SUPERADMIN_CLAVE=clave-de-desarrollo-123
  ```

- `scripts/completar-env.mjs` (criterio 63): `util.parseEnv` sobre ambos archivos; recorre `.env.example` en orden
  y, para cada variable activa (no comentada) que falte en `.env`, agrega al final su bloque de comentarios y su línea.
  Escribe con `\n`. Prueba en un directorio temporal.
- `scripts/lib/entorno.mjs`: `leerUrlApp(env)` y `urlAppSobre(urlBase, urlApp)` (usuario y contraseña de una, host,
  puerto y base de la otra), usados por `crear-bases.mjs`, `global-setup.ts`, las utilidades de prueba y la
  configuración de Playwright.
- `backend/test/utilidades/global-setup.ts`: además de lo actual, fija `process.env.DATABASE_URL_APP` con
  `urlAppSobre(DATABASE_URL_PRUEBAS, DATABASE_URL_APP)`.
- CI: en `env` del trabajo de Linux, `DATABASE_URL_APP` y `JWT_SECRETO` con los valores de `.env.example`.
- `e2e/playwright.config.ts`: la API recibe `DATABASE_URL_APP` armada sobre la base de pruebas y `JWT_SECRETO`; un
  `globalSetup` de Playwright crea el superadmin de la prueba con el comando (o con la utilidad equivalente) sobre
  la base de pruebas.

### 12. Web de la plataforma (`frontend/src/modulos/plataforma/`)

- `api/cliente.ts`: `enviarJson(metodo, ruta, cuerpo, esquema)` y un error tipado `ErrorDeApi` con el `ErrorApi`
  validado; `fetch` con `credentials: 'same-origin'` (por defecto) y `Content-Type: application/json`.
- Hooks con TanStack Query: `useSesionPlataforma`, `useAcademias`, `useCrearAcademia`, `useSuspenderAcademia`,
  `useReactivarAcademia`, `useCerrarSesion`. Un 401 en cualquiera lleva a `/plataforma/ingresar`.
- Formularios con React Hook Form y los esquemas de contratos (el resolver de zod). shadcn/ui puede entrar aquí si
  el frontend lo prefiere; si no, Tailwind simple.
- Fechas: `Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year:
  'numeric' })`. Las pruebas corren en UTC (spec 000), así que comprueban el cambio de día (por ejemplo,
  `2026-11-12T03:00:00Z` se muestra `11/11/2026`).
- Rutas: `/plataforma` → `/plataforma/academias`; `/plataforma/ingresar`; `/plataforma/academias` protegida.
- _(Ataque ronda 1, criterios 76 y 77)_: los formularios usan los mismos esquemas, así que muestran los errores de
  texto sin ir al servidor. El motivo de suspensión va en un campo de una sola línea (`<input>`, no `<textarea>`),
  porque un salto de línea en medio del texto es un carácter de control (criterio 76).

### 13. Pruebas

- **Protegidas (test-writer), en `backend/test/integracion/`:**
  - `aislamiento/rol-app.test.ts` (1 a 3, 47), `aislamiento/rol-inseguro.test.ts` (4),
    `aislamiento/catalogo.test.ts` (9 a 12), `aislamiento/rls.test.ts` (13 a 19), `aislamiento/resolver.test.ts`
    (20), `aislamiento/base-datos.test.ts` (21 a 26), `aislamiento/auditoria.test.ts` (29 a 31);
  - `plataforma/superadmin-comando.test.ts` (33 a 35, 46), `plataforma/sesion.test.ts` (36 a 39, 42 a 46),
    `plataforma/bloqueo-concurrente.test.ts` (40), `plataforma/limite.test.ts` (41);
  - `academias/plataforma.test.ts` (30, 32, 48, 50 a 57), `academias/publica.test.ts` (58 a 60);
  - `backend/src/infraestructura/entorno/entorno-001.test.ts` (5, unitaria) y la prueba de la regla de lint (28).
- **Protegidas del ataque ronda 1 (test-writer):**
  - `aislamiento/contexto-contaminado.test.ts` (72), con su propia aplicación de `DATABASE_POOL_MAX=1`; la variante
    de `ALTER DATABASE … SET` se omite con aviso si el dueño no puede y se restaura en `afterAll`;
  - `eslint/regla-sql-sesion.test.mjs` (73);
  - `plataforma/tipo-contenido.test.ts` (74) y `plataforma/limite.test.ts` ampliado o `plataforma/limite-cuerpos.test.ts`
    (75);
  - `academias/textos.test.ts` y casos en `plataforma/sesion.test.ts` (76, 77), más casos del comando en
    `plataforma/superadmin-comando.test.ts`;
  - `entorno-001.test.ts` ampliado o `entorno-ronda1.test.ts` (78, 79) y un caso de la semilla con `NODE_ENV`
    inválido (78).
- **No protegidas:** 6 (`scripts/test/integracion/`), 8 (unitaria del hook), 27, 49 (contratos), 61, 63, 66,
  frontend (68 a 70) y E2E (71).
- `limpiarBase()` antes de cada prueba que dependa del contenido; los archivos de integración ya corren sin
  paralelismo (spec 000).
- Las pruebas que usan la hora fijan `RELOJ` con `RelojFijo` (`ajustar`). El límite de `@nestjs/throttler` usa su
  propio reloj: cada prueba crea su aplicación y por eso arranca con el contador en cero.
- **Protegidas del ataque ronda 2 (test-writer)** _(criterios 80 a 91)_:
  - `aislamiento/rol-inseguro-ronda2.test.ts` (80, integración; cada caso se omite con aviso si el usuario de
    pruebas no puede crear roles) y `backend/src/infraestructura/prisma/rol-seguro.test.ts` (80, unitaria de la
    función que decide);
  - `scripts/test/integracion/rol-app-ronda2.test.mjs` (81, se omite con aviso en la nube) y una prueba unitaria de
    la función del hook que evalúa la fila del rol (81);
  - `aislamiento/temporales.test.ts` (82): catálogo y `CREATE TEMP` como app, también dentro de `BaseDatos`;
  - `eslint/regla-sql-sesion-ronda2.test.mjs` (83, 84) y `eslint/regla-acceso-base.test.mjs` (85);
  - `aislamiento/base-datos-privado.test.ts` (86);
  - `packages/contratos/src/texto-ronda2.test.ts` (87, 88) y casos en `academias/textos.test.ts`,
    `plataforma/sesion.test.ts` y `plataforma/superadmin-comando.test.ts` (87, 88), más un caso de la semilla (88);
  - `plataforma/codificacion.test.ts` (89), con cuerpos `gzip`, `deflate`, corruptos, de más de 100 KB
    descomprimidos y codificaciones no admitidas, y su conteo en el límite;
  - `cli/contexto-comandos.test.ts` (90);
  - 91: el test-writer cambia los secretos fijos que cumplen el criterio 79 por secretos generados al ejecutar
    (`randomBytes`), empezando por `plataforma/sesion.test.ts`; lo verifica el revisor.
- **Protegidas del ataque ronda 3 (test-writer)** _(criterios 92 a 105; nombres orientativos)_:
  - `eslint/regla-sql-plantillas.test.mjs` (92), casos de `UESCAPE` en `eslint/normalizar-sql-ronda3.test.mjs` (93),
    `eslint/regla-sql-sesion-ronda3.test.mjs` (94), `eslint/regla-acceso-base-ronda3.test.mjs` (95, 97) y
    `eslint/paso-protegido.test.mjs` (96, 97);
  - adaptación de las protegidas de las rondas 1 y 2 al alcance nuevo (criterios 92 y 96): en
    `regla-sql-sesion.test.mjs`, `regla-sql-sesion-ronda2.test.mjs` y `regla-acceso-base.test.mjs`, las formas
    "cadena" y "plantilla sin etiqueta" dejan de esperarse como error y pasan a ejemplos que pasan (o se quitan de
    `enTodasLasFormas`), los mismos textos SQL se siguen probando como `$queryRaw` y `Prisma.sql`, y los casos de
    `eslint-disable` se prueban con la configuración del paso protegido y `allowInlineConfig: false`;
  - `aislamiento/zona-horaria-sesion.test.ts` y `cli/zona-horaria-comandos.test.ts` (98);
  - `backend/src/infraestructura/entorno/retirar-variables.test.ts` y `integracion/arranque/entorno-proceso.test.ts`
    (99), con un módulo precargado en `backend/test/utilidades/`;
  - `aislamiento/envoltorio.test.ts` (100);
  - `aislamiento/cursores.test.ts` (101) y un caso de `enPlataforma` en `cli/contexto-comandos-ronda3.test.ts`;
  - `aislamiento/privilegios-de-mas.test.ts`, `backend/src/infraestructura/prisma/privilegios-app.test.ts` (102) y
    `aislamiento/configuracion-rol.test.ts` (103);
  - `scripts/test/rol-app-ronda3.test.mjs` (unitarias de P-19, P-20 y P-22) y
    `scripts/test/integracion/rol-app-ronda3.test.mjs` (102 a 104 en `db:crear`; los casos que crean roles se omiten
    con aviso en la nube);
  - `plataforma/utf8.test.ts` (105);
  - no protegida: `scripts/test/preparar-sesion.test.mjs` pasa a esperar el verificador SCRAM (criterio 104).
- **Protegidas del ataque ronda 4 (test-writer)** _(criterios 106 a 119; nombres orientativos)_:
  - `aislamiento/promesas-nativas.test.ts` (106) y `aislamiento/argumentos-envoltorio.test.ts` (112, parte de
    integración);
  - `aislamiento/formato-sesion.test.ts` (107, con las vías que exigen superusuario omitidas con aviso) y un caso de
    `enPlataforma` en `cli/contexto-comandos-ronda4.test.ts`;
  - `backend/src/modulos/academias/dominio/bloqueo-ronda4.test.ts` (108, unitaria) y
    `plataforma/fechas-invalidas.test.ts` (108, con `BaseDatos` reemplazado por un doble);
  - `eslint/regla-sql-funciones-texto.test.mjs` (109), `eslint/regla-exenciones-ronda4.test.mjs` (110, 118 y 119),
    `eslint/enlaces-simbolicos.test.mjs` (111, regla con `realpath`), `eslint/regla-sql-etiqueta-autorizada.test.mjs`
    (112), `eslint/regla-prisma-cli-ronda4.test.mjs` (113), `eslint/regla-sql-clausula-set.test.mjs` (115) y
    `eslint/regla-entorno.test.mjs` (117);
  - `scripts/test/fuentes-protegidas.test.mjs` (111 y 118, unitarias de P-28 con carpetas temporales);
  - `backend/src/infraestructura/prisma/punto-autorizado.test.ts` (114, unitaria) y
    `aislamiento/punto-autorizado.test.ts` (114, integración);
  - `backend/src/infraestructura/entorno/retirar-variables-ronda4.test.ts` (116);
  - adaptación de `eslint/regla-sql-plantillas.test.mjs` a los criterios 112 y 114 ("Impacto en especificaciones
    anteriores" de `spec.md`), en el mismo commit.
- **Protegidas del ataque ronda 5 (test-writer)** _(criterios 120 a 129; nombres orientativos)_:
  - `plataforma/sesion-restablecida.test.ts` (120), con el doble de `BaseDatos` que delega en uno real y ejecuta el
    comando con `ejecutarComando`;
  - `aislamiento/search-path.test.ts` (121, con el esquema `trampa`; las vías que exigen superusuario o `CREATE` en la
    base se omiten con aviso) y casos de `enPlataforma` y del comando en `cli/contexto-comandos-ronda5.test.ts`;
  - `aislamiento/cadenas-estandar.test.ts` (122);
  - `backend/src/infraestructura/prisma/rol-seguro-ronda5.test.ts` (123, unitaria de `problemasDeEsquemas`),
    `aislamiento/esquemas-rol.test.ts` (123, integración), `scripts/test/rol-app-ronda5.test.mjs` (unitaria de
    `problemasDeEsquemasApp`) y `scripts/test/integracion/rol-app-ronda5.test.mjs` (123 y 125 en `db:crear`);
  - `aislamiento/catalogo-objetos.test.ts` (124), `aislamiento/privilegios-vistas.test.ts` (125) y
    `aislamiento/catalogo-unicidad.test.ts` (126);
  - `scripts/test/dependencias-backend.test.mjs` (127, unitarias de P-30 con carpetas temporales);
  - `eslint/regla-paquetes-declarados.test.mjs` (128), `eslint/regla-clientes-de-base.test.mjs` (129) y casos de la
    regla de `cli/` en `eslint/regla-sql-sesion-ronda5.test.mjs` (121 y 122).
- **Protegidas del ataque ronda 6 (test-writer)** _(criterios 130 a 136; nombres orientativos)_:
  - `backend/src/infraestructura/prisma/privilegios-esquemas.test.ts` (130, unitaria de `privilegiosDeMasEnEsquemas` y
    de las listas), `aislamiento/privilegios-esquemas.test.ts` (130, integración; los casos con esquema se omiten con aviso
    si el dueño no puede crearlos), `scripts/test/rol-app-ronda6.test.mjs` (unitaria de P-31 en `rol-app.mjs` y listas
    iguales) y `scripts/test/integracion/rol-app-ronda6.test.mjs` (130 en `db:crear`, casos 1 y 2);
  - ajuste de `aislamiento/catalogo.test.ts`, `aislamiento/catalogo-objetos.test.ts` y
    `aislamiento/catalogo-unicidad.test.ts` a los esquemas revisados, y `aislamiento/catalogo-esquemas.test.ts` (131,
    autocomprobación con `reportes_prueba`);
  - `backend/test/utilidades/politicas.ts` y `sembradores.ts` (P-33), `aislamiento/forma-politicas.test.ts` (132) y
    `aislamiento/rls-todas-las-tablas.test.ts` (133; la autocomprobación de ejecución se omite con aviso donde el dueño no
    pueda `SET ROLE aquagestion_app`);
  - `aislamiento/transaccion-guardada.test.ts` (134);
  - `eslint/regla-transaccion-guardada.test.mjs` (135) y `eslint/regla-sql-sesion-ronda6.test.mjs` (136);
  - adaptación de `backend/test/utilidades/search-path.ts` (criterio 121) como dice "Impacto en especificaciones
    anteriores", ronda 6, en el mismo commit.
- **Protegidas del ataque ronda 7 (test-writer)** _(criterios 137 a 140; nombres orientativos)_:
  - `aislamiento/privilegios-extensiones.test.ts` (137, API: extensión en `public` y controles) y
    `scripts/test/integracion/rol-app-ronda7.test.mjs` (137, `db:crear` con los mismos casos); los casos se omiten con aviso
    si no se puede instalar ninguna extensión;
  - `aislamiento/catalogo-extensiones.test.ts` (137, tablas propias que no son objetos de extensión, con autocomprobación);
  - ajuste de `aislamiento/rls-todas-las-tablas.test.ts` (133 y 138: fila de prueba válida en B, juicio por lo escrito y
    autocomprobación con disparadores) y, si hace falta, de `backend/test/utilidades/sembradores.ts` (P-33, ronda 7);
  - ajuste de `backend/test/utilidades/politicas.ts` y de `aislamiento/forma-politicas.test.ts` (140, con los casos
    unitarios de `cumpleFormaDeAcademia` y la autocomprobación ampliada);
  - `eslint/regla-transaccion-guardada-ronda7.test.mjs` (139).
- **Protegidas del ataque ronda 8 (test-writer)** _(criterios 141 a 143; nombres orientativos)_:
  - `aislamiento/privilegios-esquema-extension.test.ts` (141, API: casos 1 a 4) y
    `scripts/test/integracion/rol-app-ronda8.test.mjs` (141, `db:crear` con los mismos casos); se omiten con aviso si el
    dueño no puede crear una extensión de confianza de la que sea dueño;
  - ajuste de `backend/test/utilidades/catalogo.ts` (`esquemasRevisados` sin la exclusión de esquemas de extensiones) y
    `aislamiento/catalogo-esquema-extension.test.ts` (142, autocomprobación con un esquema agregado a una extensión);
  - `backend/src/infraestructura/entorno/url-postgres.test.ts` y `scripts/test/entorno-ronda8.test.mjs` (143, P-34: la
    función en los dos archivos, la igualdad de las listas, `validarEntorno`, `analizarUrlPostgres`, `leerUrlApp` y
    `leerUrlsBases`); `scripts/test/integracion/url-consulta-ronda8.test.mjs` (143, `db:crear`);
    `backend/src/cli/url-consulta-ronda8.test.ts` o una prueba de integración con proceso (143, comando y semilla); y un
    caso en `scripts/test/preparar-sesion.test.mjs` o en un archivo nuevo (143, hook).
- **Protegidas del ataque ronda 9 (test-writer)** _(criterios 144 a 148; nombres orientativos)_:
  - `aislamiento/catalogo-volatilidad.test.ts` (144, catálogo y autocomprobación) y
    `aislamiento/plan-guardado.test.ts` (145, con la API en `DATABASE_POOL_MAX=1` y autocomprobación con la función en
    `IMMUTABLE`);
  - `aislamiento/codificacion-cliente.test.ts` (146) y `aislamiento/parametros-integridad.test.ts` (147), más los casos de
    `enPlataforma` en `cli/contexto-comandos-ronda9.test.ts`;
  - casos de la regla de `cli/` en `eslint/regla-sql-sesion-ronda9.test.mjs` (146 y 147);
  - `scripts/test/entorno-ronda9.test.mjs` (148, unitaria de `diferenciasConDesarrollo`),
    `scripts/test/integracion/url-app-ronda9.test.mjs` (148, `db:crear`) y `scripts/test/preparar-sesion-ronda9.test.mjs`
    (148, la función del hook de P-35);
  - adaptación de las pruebas protegidas anteriores que ejecutan `db:crear` con una `DATABASE_URL_APP` sobre otra base
    ("Impacto en especificaciones anteriores", ronda 9), en el mismo commit.
- **Protegidas del ataque ronda 10 (test-writer)** _(criterios 149 a 152; nombres orientativos)_:
  - `aislamiento/transaccion-abortada.test.ts` (149: variantes 1 a 3 en `conAcademia` y `comoPlataforma`, la 4 con un
    controlador de prueba, y los controles; 151: `ROLLBACK` y `COMMIT` escritos en `conAcademia` y `comoPlataforma`, y el
    control de la marca);
  - `cli/transaccion-abortada-ronda10.test.ts` (150 y el caso `ROLLBACK` del 151 en `enPlataforma`);
  - `backend/src/modulos/auditoria/ip.test.ts` (152, unitaria de `ipParaAuditoria`) y
    `aislamiento/ip-auditoria.test.ts` (152, integración con `AcademiasService` y `registrarEnAcademia`).
- **Protegidas del ataque ronda 11 (test-writer)** _(criterios 153 a 155; nombres orientativos)_:
  - `aislamiento/consultas-a-la-vez.test.ts` (153: los casos 1 a 7 en `conAcademia` y `comoPlataforma`, con la conexión
    sana después);
  - `backend/src/infraestructura/prisma/envoltorio-cola.test.ts` (153 y 154, unitaria de `envolver` con una transacción
    falsa, P-38);
  - `aislamiento/bloqueo-transaccion.test.ts` (155).
- **Protegidas del ataque ronda 12 (test-writer)** _(criterios 156 a 158; nombres orientativos salvo los de P-39 y P-40)_:
  - `aislamiento/consultas-encadenadas.test.ts` (156: casos 1 a 4 en `conAcademia` y `comoPlataforma`, con la conexión
    sana después);
  - `backend/src/infraestructura/prisma/envoltorio-asentar.test.ts` (156, unitaria de `envolver` con la transacción
    falsa de P-38: casos (i) a (vi));
  - `backend/src/infraestructura/proceso/rechazos.test.ts` (157, unitaria de P-40);
  - `aislamiento/escritura-anidada.test.ts` (158: casos 1 a 5);
  - `backend/src/infraestructura/prisma/puntos-de-guardado.test.ts` (158, unitaria de P-39 con una transacción falsa).
- **Protegidas del ataque ronda 13 (test-writer)** _(criterios 159 a 162; nombres orientativos salvo los de P-41 y P-42)_:
  - `eslint/regla-promesas-descartadas-ronda13.test.mjs` (159: lint normal con tipos y paso protegido sin tipos, formas
    que fallan y que pasan, comentarios que no apagan la regla en el paso protegido, pruebas y frontend fuera de alcance);
  - `aislamiento/rechazos-tras-trabajo.test.ts` (160: casos 1 a 4 en `conAcademia` y `comoPlataforma`, con la conexión
    sana después);
  - `backend/src/infraestructura/prisma/envoltorio-rechazos-ronda13.test.ts` (160, unitaria de `envolver` con la
    transacción falsa de P-38: casos (i) a (vi));
  - `backend/src/infraestructura/prisma/registro-de-errores.test.ts` (161 y 162, unitarias de P-42 y de la causa limpia
    en el constructor de `ErrorTransaccionAbortada`, con errores falsos con forma de error de Prisma);
  - `aislamiento/registro-sin-datos.test.ts` (161 y 162 con errores reales: reproducción de F2 en `conAcademia` y
    `comoPlataforma`, la comprobación de la marca, los errores (a), (b) y (c), y las rutas de un controlador de prueba con
    el registro capturado);
  - `backend/src/infraestructura/proceso/rechazos-ronda13.test.ts` (162, manejador de P-40 con un error de Prisma) y
    `backend/src/cli/mensaje-seguro-ronda13.test.ts` (162, `mensajeSeguro` con un error con forma de error de Prisma).
- **Protegidas del ataque ronda 14 (test-writer)** _(criterios 163 y 164; nombres orientativos)_:
  - `backend/src/infraestructura/prisma/registro-de-errores-ronda14.test.ts` (163, unitarias (u1) a (u6) de
    `errorParaRegistro` con errores falsos: encabezado exacto, `stack` alterado, encabezado sin salto de línea, mensaje
    vacío, valores que no son cadenas y getters que lanzan, cadena de causas y `AggregateError`);
  - `aislamiento/registro-sin-datos-ronda14.test.ts` (163 con errores reales: (a) `$queryRaw` con `::date`, (b)
    `configuracion.create` con un `Json` de claves `at …` y (c) `auditoria.create` con una `ip` con salto de línea; la
    comprobación previa de que el ataque se reproduce, `errorParaRegistro` directo y con un `Error` propio que los lleva
    como `cause`, y una ruta de un controlador de prueba por cada error con el registro capturado);
  - `backend/src/infraestructura/proceso/rechazos-ronda14.test.ts` (163, manejador de P-40 con el error (c));
  - `eslint/regla-promesas-descartadas-ronda14.test.mjs` (164: paso protegido en `.ts`, `.js` y `.mjs` con las formas de
    temporizadores que fallan y que pasan, comentarios que no apagan la regla, envoltorios de tipos; lint normal con tipos
    en `ejemplo.service.ts`; pruebas y frontend fuera de alcance).
- **Protegidas del ataque ronda 15 (test-writer)** _(criterios 165 y 166; nombres orientativos)_:
  - `backend/src/infraestructura/prisma/registro-de-errores-ronda15.test.ts` (165, unitarias (u1) a (u14) de
    `errorParaRegistro` con las excepciones reales de `@nestjs/common` y el error falso `base`, comprobadas con
    `util.inspect` con `showHidden`, `JSON.stringify` y un `pino` con destino en memoria; 166, unitarias (o1) a (o5) de
    `errorParaRegistro`, `causaLimpia` y el constructor de `ErrorTransaccionAbortada`);
  - `backend/src/infraestructura/proceso/rechazos-ronda15.test.ts` (165, manejador de P-40 con (u1) y (u4));
  - `backend/src/cli/mensaje-seguro-ronda15.test.ts` (165 y 166, `mensajeSeguro` con (u1), (u4), la cadena de (u12) y
    (o1));
  - `aislamiento/registro-sin-datos-ronda15.test.ts` (165 con el error real de `auditoria.create`: comprobación previa de
    que el valor está en su mensaje, `errorParaRegistro` dentro de (u1), (u2), (u8) y (u10), y las rutas (a1) a (a3) de un
    controlador de prueba con el registro capturado).
- **Protegidas del ataque ronda 16 (test-writer)** _(criterios 167 y 168; nombres orientativos)_:
  - `backend/src/infraestructura/prisma/registro-de-errores-ronda16.test.ts` (167, unitarias (t1) a (t9) de
    `errorParaRegistro` con límite de 200 ms por llamada, medidas con `performance.now()` tras una llamada de
    calentamiento, y (t1) con `FiltroErrores` real con límite de 1000 ms; (t1) y (t2) comprueban además que el
    resultado y lo registrado no llevan el binario (R16-1); 168, unitarias (g1) a (g6) con la comprobación
    previa de que pino muestra el valor con el error original, la función espía de (g3), (g4) y (g5) sin llamadas, y las
    comprobaciones con `util.inspect` con `showHidden`, `JSON.stringify` y un `pino` con destino en memoria);
  - `backend/src/infraestructura/prisma/registro-de-errores-memoria-ronda16.test.ts` y el script del hijo en
    `backend/test/utilidades/registro-grande-hijo.ts` (167, (t11): `process.execPath` con `--max-old-space-size=256
    --import tsx`, código de salida y resultados por la salida estándar);
  - `backend/src/infraestructura/proceso/rechazos-ronda16.test.ts` (168, manejador de P-40 con (g1) y (g3));
  - `backend/src/cli/mensaje-seguro-ronda16.test.ts` (167, (t10); 168, `mensajeSeguro` con (g1) y (g3));
  - `aislamiento/registro-sin-datos-ronda16.test.ts` (168 con el error real de `auditoria.create`: comprobación previa de
    que el valor está en su mensaje, `errorParaRegistro` dentro de (g1) y (g3), y las rutas (a4) y (a5) de un controlador
    de prueba con el registro de la app capturado).
- **Protegidas del ataque ronda 17 (test-writer)** _(criterios 169 a 171; nombres orientativos salvo los de P-43 y P-44)_:
  - `scripts/test/entorno-bom-ronda17.test.mjs` (169: `quitarBom`; coherencia del conjunto (a) entre `analizarEnv` y
    `dotenv.parse`; `cargarEnv` con (e1) y `leerUrlsBases`, `leerUrlApp` y `diferenciasConDesarrollo`; prueba estática de
    `parseEnv`; `.env.example` sin BOM);
  - `scripts/test/completar-env-ronda17.test.mjs` (170: (b1) a (b6), con `completarEnv` y como comando; (b5) y la
    inclusión de (b4) con `clavesPosiblesEnv`);
  - `scripts/test/preparar-sesion-ronda17.test.mjs` (169: `entornoParaHijos` del hook con (e1); 171: `esPuntoDeEntrada`
    del hook con (p1) a (p5), igual que la de `scripts/lib/`, y la parte del hook de la prueba estática);
  - `scripts/test/punto-de-entrada-ronda17.test.mjs` (171: (p1) a (p5) de `scripts/lib/punto-de-entrada.mjs`, (r1) a (r5),
    (r6) estática y (r7) solo en Windows);
  - `backend/test/utilidades/lectura-env-ronda17.test.ts` (169: `leerEntornoBases` y `leerUrlAppConfigurada` con (e1) y con
    `DATABASE_URL_APP` primera), con la corrección de `backend/test/utilidades/base-pruebas.ts` y
    `backend/test/utilidades/base-datos.ts` (quitar el BOM inicial antes de `parseEnv`) en el mismo commit: son
    utilidades de prueba y `base-datos.ts` está protegida, así que no las puede tocar el backend.

### 14. Correcciones del ataque, ronda 2 (criterios 80 a 91)

- **Comprobación del rol en la API (criterio 80).** `verificarRol()` amplía su consulta (orientativa) y separa la
  decisión en una función pura `problemasDelRol(fila): string[]` en `infraestructura/prisma/rol-seguro.ts` (ruta y
  forma de la fila fijas: precisión P-12 de la spec, tras las pruebas de la ronda 2), con prueba unitaria:

  ```sql
  SELECT r.rolsuper, r.rolbypassrls, r.rolreplication, r.rolcreaterole, r.rolcreatedb,
         EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS es_miembro,
         pg_catalog.pg_has_role(r.oid, 'pg_database_owner', 'MEMBER') AS dueno_de_la_base,
         pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CREATE') AS crea_en_base,
         pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'TEMPORARY') AS temporales,
         pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') AS crea_en_public,
         (EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relowner = r.oid)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proowner = r.oid)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                      WHERE n.nspname = 'public' AND t.typowner = r.oid)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = r.oid))
           AS es_dueno
    FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
  ```

  Cualquier verdadero (o ninguna fila) → `ErrorRolBaseDatosInseguro`, memorizado como hoy. El mensaje del log puede
  listar las condiciones encontradas, nunca la URL.
- **`db:crear` y el hook (criterio 81).** `scripts/lib/rol-app.mjs` (solo importa `node:*` o rutas relativas, para
  que el hook también lo pueda importar) con la lista de atributos prohibidos y la función pura
  `problemasDelRolApp(fila)` que evalúa la fila de `pg_roles` y devuelve los problemas con su corrección
  (`ALTER ROLE aquagestion_app NOREPLICATION;`, `REVOKE … FROM aquagestion_app;`…); forma exacta: precisión P-13.
  `asegurarRolApp`: si el rol existe, comprueba atributos y membresías explícitas; luego `crearBases`, para la base
  de desarrollo y la de pruebas, revoca `TEMPORARY` a `PUBLIC` (criterio 82) y comprueba `pg_database.datdba`,
  `has_database_privilege(…, 'CREATE' | 'TEMPORARY')` y, conectado a cada base, `CREATE` sobre `public` y la
  propiedad de objetos de `public`. El hook consulta con `psql -tA` los cinco atributos y las membresías de
  `aquagestion_app` y falla el paso si alguno está activo.
- **Migración `<marca>_endurecer_rol_app` (criterio 82)**, idempotente (orientativa):

  ```sql
  DO $$ BEGIN
    EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
    EXECUTE pg_catalog.format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM aquagestion_app', pg_catalog.current_database());
  END $$;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  ```

  `CONNECT` sigue llegando por `PUBLIC`. El dueño de la base conserva sus privilegios. `db:crear` ejecuta las mismas
  revocaciones de base desde la conexión a `postgres` (los privilegios de base son del catálogo común).
- **Regla del SQL (criterios 83 y 84).** En `eslint/regla-sql-sesion.mjs`, una función `normalizarSql(texto)` (con
  prueba propia) que, en este orden: quita comentarios; convierte `$etiqueta$…$etiqueta$` y los prefijos `E`, `U&`,
  `N` en `'…'`; une `'a' || 'b'`; quita comillas dobles de identificadores (incluido `U&"…"`); quita espacios
  alrededor de `.`; pasa a minúsculas. Sobre el resultado:
  - `set_config`: se reconoce la llamada (`(pg_catalog\.)?set_config\s*\(`), se separan sus tres argumentos
    respetando paréntesis y comillas, y se exige primer argumento `'app.…'` literal y tercer argumento exactamente
    `true`; fuera de `prisma/` y `cli/`, cualquier llamada es error;
  - sentencias: se parte el texto por `;` (fuera de literales) y se mira el inicio de cada sentencia (`set`,
    `commit`, `end`, `rollback`, `abort`, `savepoint`, `release`, `begin`, `start transaction`), así
    `UPDATE … SET` y `CASE … END` no cuentan; `reset` solo cuenta si la sentencia entera es `reset all`,
    `reset role`, `reset session authorization` o `reset <parámetro>` (P-14), para que un texto natural como
    `"reset de la clave del usuario"` pase; `SET LOCAL statement_timeout` y `set_config('statement_timeout', …)`
    fallan fuera de `prisma/`;
  - en cualquier parte: `alter (role|user|database|system)`, `create (global |local )?temp(orary)?`,
    `into temp(orary)?`, `discard`, `update (pg_catalog\.)?pg_settings`, `(un)?listen`, `notify`, `pg_notify\(`.

  Las expresiones son orientativas; mandan los ejemplos de los criterios.
- **Acceso a la base (criterios 85 y 86).** Regla propia `eslint/regla-acceso-base.mjs` (o `no-restricted-syntax`
  más `no-restricted-imports`) que visita `ImportDeclaration` (valores), `ExportNamedDeclaration`/`ExportAllDeclaration`
  con `source`, `ImportExpression`, `CallExpression` de `require` y `TSImportEqualsDeclaration`, con la lista de
  módulos del criterio 85, y rechaza `import()`/`require()` con argumento no literal y `createRequire`. Para que un
  `eslint-disable` no las apague: `linterOptions.noInlineConfig: true` en un bloque de configuración para los
  archivos de `backend/src/**` donde se aplican las reglas de los criterios 73, 83, 84 y 85 (o un mecanismo
  equivalente que impida que el comentario surta efecto). Un plugin que solo informe del comentario (por ejemplo
  `@eslint-community/eslint-plugin-eslint-comments`) no basta: el error de la regla tiene que seguir apareciendo
  (precisión P-15, tras las pruebas de la ronda 2).
  `BaseDatos`: `readonly #prisma: PrismaService;` asignado en el constructor (no como parámetro con `private`), y
  ningún método ni getter lo devuelve. _(Ronda 3: `noInlineConfig` se reemplaza por un paso de lint aparte con
  `--no-inline-config`, y `PrismaService` deja de ser proveedor; ver la sección 15.)_
- **Textos (criterios 87 y 88)** en `packages/contratos/src/texto.ts`:
  - visibles: `/[\p{L}\p{N}\p{P}\p{S}]/u` y no `/[\p{Default_Ignorable_Code_Point}⠀]/u`;
  - longitud: una ayuda `longitudEnPuntos(min, max)` (`[...t].length`) que reemplaza `.min()`/`.max()` de zod en
    `correo`, `clave`, `nombre`, `motivo` y `nombreCorto`;
  - `backend/src/cli/superadmin-datos.ts` deja de contar con `.length` y valida con esos esquemas; la semilla usa la
    misma validación antes de escribir.
- **`Content-Encoding` (criterio 89).** Nuevo middleware entre el de tipo de contenido (paso 4 de la sección 6) y el
  lector JSON (paso 5): con cuerpo, el valor recortado y en minúsculas debe ser `identity`, `gzip` o `deflate` (un
  solo valor); si no, 400 como en el criterio 74. El lector JSON queda con `inflate: true` y `limit: '100kb'`, que
  `body-parser` aplica a los bytes ya descomprimidos; sus errores de descompresión se traducen a 400 y el de tamaño a
  413 en el filtro. Si la versión instalada de `body-parser` admite `br`, el middleware lo rechaza antes. Precisión
  P-16: 102 400 bytes descomprimidos pasan y 102 401 dan 413; la cabecera presente con valor vacío es 400; sin
  cuerpo (`GET`, `DELETE` sin cuerpo) no se mira la cabecera; los 400 llevan `detalles.errores: [{ campo: '',
  mensaje }]`.
- **Contexto de los comandos (criterio 90).** `enPlataforma` ejecuta
  `SELECT set_config('app.academia_id', '', true), set_config('app.plataforma', 'si', true)` como primera sentencia.
  `crearClienteDelDueno` y `enPlataforma` siguen exportadas de `cli/conexion.ts` con sus firmas actuales (P-17).
- **Secretos de prueba (criterio 91).** Los genera el test-writer con `randomBytes(32).toString('base64url')` al
  cargar el archivo de prueba; el revisor busca literales de 32 o más caracteres sin espacios cerca de `secreto` o
  `JWT_SECRETO` en las pruebas.

### 15. Correcciones del ataque, ronda 3 (criterios 92 a 105)

**Lint (criterios 92 a 97).** El cambio de fondo: el SQL solo puede llegar a la base por plantillas etiquetadas, así
que la regla del SQL deja de visitar cadenas y plantillas sueltas y solo mira esas plantillas.

- `eslint/regla-sql-sesion.mjs`:
  - visita solo `TaggedTemplateExpression` cuya etiqueta es `<expr>.$queryRaw`, `<expr>.$executeRaw`, `Prisma.sql` o
    el identificador `sql`; une los `quasis` con el marcador, como hoy, y aplica `normalizarSql` y las reglas de los
    criterios 73, 83, 84 y 94;
  - en `cli/`, la regla de `set_config` admite, además de `'app.…'` con `true`, exactamente
    `set_config('timezone', 'UTC', true)` con el nombre sin distinguir mayúsculas (criterio 98);
  - patrones nuevos (orientativos, sobre el texto normalizado): sentencias que empiezan por
    `declare|close|fetch|move|prepare|execute|deallocate|do`; en cualquier parte `\bwith\s+hold\b`,
    `\balter\s+default\s+privileges\b` y llamadas
    `(pg_catalog\.)?(lo_\w+|loread|lowrite|pg_(try_)?advisory_(lock|unlock)(_shared|_all)?|pg_terminate_backend|pg_cancel_backend)\s*\(`;
    `pg_advisory_xact_lock` y `pg_try_advisory_xact_lock` no encajan porque llevan `xact_` entre `advisory_` y
    `lock`.
- `normalizarSql` (criterio 93): después de reconocer `U&'…'` o `U&"…"`, mira si sigue (saltando espacios y
  comentarios) la palabra `uescape` y un literal `'x'`; si sigue, decodifica con `x` como escape (`x` + 4 hexadecimales,
  `x+` + 6 hexadecimales, `xx`); si el literal no es un carácter válido (vacío, más de uno, hexadecimal, `+`, `'`, `"`,
  espacio), la regla informa error. Prueba propia de `normalizarSql` con los ejemplos del criterio.
- Regla nueva de formas (criterio 92), en el mismo archivo o en `eslint/regla-sql-formas.mjs`:
  - `MemberExpression` o `Property` (desestructuración) con nombre `$queryRawUnsafe` o `$executeRawUnsafe`, y
    `Literal`/`TemplateLiteral` cuyo texto los contiene → error;
  - `MemberExpression` con nombre `$queryRaw` o `$executeRaw` cuyo padre no es una `TaggedTemplateExpression` (como
    etiqueta) ni una `CallExpression` (como callee) con un solo argumento que sea una plantilla etiquetada con
    `Prisma.sql` o `sql` → error; con corchetes (`computed`) → error;
  - `Prisma.sql` o `sql` como callee de una `CallExpression` → error;
  - `MemberExpression` de valor `Prisma.raw`, `Prisma.Sql`, o `Prisma.join` con más de un argumento; e
    `ImportSpecifier` `raw`, `join` o `Sql` de `generated/prisma` o `@prisma/…` (en `cli/`, donde se pueden importar)
    → error. En TypeScript, `Prisma.Sql` en posición de tipo es `TSQualifiedName`, no `MemberExpression`, así que no
    cuenta.
- `eslint/regla-acceso-base.mjs` (criterio 95):
  - `esModuloProhibido(especificador)`: cambia `\` por `/`; si contiene `node_modules/`, toma lo que sigue al último
    `node_modules/` y lo evalúa como nombre de paquete (`pg`, `pg/…`, `pg-pool`, `@prisma/…`, `.prisma/…`); sigue
    reconociendo `generated/prisma` y `prisma.service` en cualquier parte;
  - resolución de rutas: para un especificador relativo o absoluto (o `file:`), `path.resolve(path.dirname(
    context.filename), especificador)` normalizado con `/`; si cae dentro de `<raíz>/backend/src/cli/` y el archivo
    que importa no está ahí → error; si cae dentro de `<raíz>/backend/src/infraestructura/prisma/` y no es
    `…/prisma`, `…/prisma/index` (con o sin `.ts`/`.js`) y el archivo que importa no está en esa carpeta → error. La
    raíz sale de `context.cwd`. Se aplica a todas las vías del criterio 85 y también a `import type`.
- Archivos (criterios 95 y 97): todas las configuraciones de estas reglas usan
  `files: ['backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}']` e `ignores` de las pruebas (`**/*.test.*`). En
  `eslint.config.mjs`, el bloque de TypeScript sin tipos incluye también `**/*.cts`, para que esos archivos se analicen
  y no fallen por sintaxis.
- Paso protegido (criterio 96):
  - `eslint.protegido.config.mjs` en la raíz (para que las rutas de `files` se resuelvan como las del principal):
    `typescript-eslint` como analizador, sin información de tipos, para todas las extensiones del criterio 95, y solo
    las configuraciones exportadas por `regla-prisma.mjs`, `regla-acceso-base.mjs` y `regla-sql-sesion.mjs`;
  - `package.json`: `"lint": "eslint . --max-warnings 0 && npm run lint:protegido"` y
    `"lint:protegido": "eslint --no-inline-config --config eslint.protegido.config.mjs --max-warnings 0 backend/src"`
    (`&&` funciona en Windows con npm);
  - se quita el bloque `linterOptions: { noInlineConfig: true }` de `configuracionSqlSesion`.
- `backend/tsconfig.build.json` y `tsconfig.base.json` quedan sin `allowJs` (hoy no lo tienen); la prueba lo fija.

**`BaseDatos` (criterios 98, 100 y 101).**

- `fijarContexto` pasa a ser `#fijarContexto` y su sentencia fija tres valores:
  `SELECT set_config('app.plataforma', ${p}, true), set_config('app.academia_id', ${id}, true),
  set_config('TimeZone', 'UTC', true)`; a continuación `` $executeRaw`CLOSE ALL` `` (una sentencia aparte: `CLOSE`
  no se puede combinar con un `SELECT` en el protocolo extendido). El orden deja intacto el criterio 90 ("la primera
  sentencia fija los valores"). Luego, la comprobación de la academia y `trabajo`.
- Cliente sin proveedor: se borra `PrismaService` como proveedor (`PrismaModule.providers = [BaseDatos]`). `BaseDatos`
  recibe `@Inject(ENTORNO) entorno: Entorno` y el registro, y crea el cliente en su constructor
  (`this.#prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) })`), con conexión perezosa
  como hoy, y lo cierra en `onModuleDestroy`. Así `design:paramtypes` es `[Object, PinoLogger]` y ningún token del
  contenedor lleva al cliente. Si se conserva un archivo para crear el cliente, es una función interna, no una clase
  inyectable.
- Métodos privados reales: `#transaccion`, `#fijarContexto`, `#verificarRol`, `#comprobarRol` y el campo
  `#verificacion`. Después de la clase, `Object.freeze(BaseDatos.prototype)` (los decoradores ya corrieron;
  `reflect-metadata` guarda los metadatos aparte, en un `WeakMap`).
- Envoltorio (`infraestructura/prisma/envoltorio.ts`, interno): `envolver(tx)` devuelve un objeto literal congelado
  con `$queryRaw: (...a) => tx.$queryRaw(...a)`, `$executeRaw: (...a) => tx.$executeRaw(...a)` y, por cada valor de
  `Prisma.ModelName` (con la primera letra en minúscula), un objeto congelado con funciones flecha para una lista fija
  de operaciones (`findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`, `create`,
  `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`,
  `deleteMany`, `count`, `aggregate`, `groupBy`) que llaman al delegado de `tx`. Las funciones flecha no tienen
  `prototype` ni propiedades que lleven al cliente. `ClienteTransaccion` pasa a ser el tipo del envoltorio (P-24).
  `#transaccion` entrega a `trabajo` el envoltorio; solo los métodos privados ven `tx`.
- `cli/conexion.ts`: `enPlataforma` agrega `set_config('TimeZone', 'UTC', true)` a su primera sentencia y
  `` CLOSE ALL `` después; `crearClienteDelDueno(url, { max })` pasa `max` a `PrismaPg` (P-23). Los comandos siguen
  recibiendo la transacción completa: corren como el dueño, fuera de la API.

**Entorno de la API (criterio 99).** `retirarVariablesSensibles(env)` en `infraestructura/entorno/` (P-21). En
`main.ts`: cargar el `.env` (como hoy), `validarEntorno(process.env)`, `retirarVariablesSensibles(process.env)` y
después `NestFactory.create`. La prueba de integración arranca `tsx backend/src/main.ts` con `stdio` que incluye
`'ipc'`, `--import` de un módulo de `backend/test/utilidades/` que hace
`process.on('message', () => process.send(Object.keys(process.env)))`, espera a que `GET /api/salud` responda en el
puerto elegido y pide la lista. Funciona en Windows (IPC de Node, sin señales).

**Comprobación del rol (criterios 102 y 103).** `#comprobarRol` hace, además de la consulta de la ronda 2:

```sql
-- Valores por defecto propios (criterio 103)
SELECT (COALESCE(pg_catalog.cardinality(r.rolconfig), 0) > 0
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid)) AS tiene_configuracion
  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;

-- Privilegios efectivos de tabla (criterio 102), orientativo
SELECT c.relname AS tabla, NULL::text AS columna, p.privilegio
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilegio)
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
   AND pg_catalog.has_table_privilege(current_user, c.oid, p.privilegio)
UNION ALL
SELECT c.relname, NULL, p.privilegio
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p(privilegio)
 WHERE n.nspname = 'public' AND c.relkind = 'S'
   AND pg_catalog.has_sequence_privilege(current_user, c.oid, p.privilegio)
UNION ALL
SELECT c.relname, a.attname, p.privilegio
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(privilegio)
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
   AND pg_catalog.has_column_privilege(current_user, c.oid, a.attnum, p.privilegio);
```

Como el rol no es miembro de otro (criterio 80), las funciones `has_*_privilege` dan exactamente lo concedido al rol
o a `PUBLIC`. La decisión está en `problemasDeConfiguracion` y `privilegiosDeMas` (P-19, P-20); el rechazo se memoriza
con el de la ronda 2. En `scripts/lib/rol-app.mjs`, las mismas consultas con `'aquagestion_app'` en lugar de
`current_user` (sobre cada base, conectado como el dueño), `bases` con `pg_database.datname` de las filas de
`pg_db_role_setting`, y los mensajes con `REVOKE … FROM aquagestion_app;` (o `FROM PUBLIC` si
`has_table_privilege('public', …)` también es verdadero) y `ALTER ROLE … RESET ALL;`. `PRIVILEGIOS_APP` se escribe
dos veces (TypeScript para la API, `.mjs` para los scripts, que no pueden importar el backend) y una prueba compara
las dos.

**SCRAM (criterio 104).** En `scripts/lib/rol-app.mjs`:

```js
const salted = pbkdf2Sync(clave, sal, iteraciones, 32, 'sha256');
const clientKey = createHmac('sha256', salted).update('Client Key').digest();
const storedKey = createHash('sha256').update(clientKey).digest();
const serverKey = createHmac('sha256', salted).update('Server Key').digest();
return `SCRAM-SHA-256$${iteraciones}:${sal.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
```

PostgreSQL reconoce un valor con ese formato como verificador y lo guarda tal cual, sin importar
`password_encryption`. Para ASCII imprimible SASLprep no cambia nada; por eso se rechaza lo demás. El hook importa la
función de `scripts/lib/rol-app.mjs` (solo `node:*`, P-13) para el rol del dueño y el de la app.

**UTF-8 (criterio 105).** `express.json({ …, verify: (req, res, buf) => { new TextDecoder('utf-8', { fatal: true
}).decode(buf); } })`: `verify` recibe los bytes ya descomprimidos. `body-parser` convierte el error de `verify` en un
403 (`entity.verify.failed`); el filtro lo traduce a 400 `SOLICITUD_INVALIDA` con `detalles.errores: [{ campo: '',
mensaje }]`. Como el límite del inicio de sesión corre antes del lector (sección 6), el 400 cuenta para él.

### 16. Correcciones del ataque, ronda 4 (criterios 106 a 119)

Principio de esta ronda (nota de proceso en "Riesgos aceptados" de `spec.md`): la garantía está en la base (RLS, rol
sin privilegios, contexto por transacción). Lo que cambia en `BaseDatos` (106 a 108) refuerza esa garantía; lo que
cambia en el lint (109 a 119) cierra caminos que un error del equipo podría abrir, sin pretender ser una barrera contra
código escrito para evadirlo.

**Envoltorio (criterios 106 y 112, P-26).** `infraestructura/prisma/envoltorio.ts`:

- `envolver(tx)` devuelve `{ cliente, terminar }`: `cliente` es el objeto congelado de hoy; `terminar()` pone en `false`
  una variable `activa` del cierre. `#transaccion` hace `try { return await trabajo(cliente) } finally { terminar() }`
  dentro del callback de `$transaction`.
- Cada función del envoltorio es `async`: comprueba `activa` (si no, `throw new Error('La transacción ya terminó.')`),
  valida y traduce los argumentos y hace `return await tx.$queryRaw(...)` (o el delegado). Al ser `async`, lo que recibe
  quien llama es una `Promise` nativa; el `await` interno dispara la `PrismaPromise`, que nunca sale del envoltorio. Ya
  no hay `requestTransaction`, ni API fluida, ni ejecución perezosa.
- Validación de `$queryRaw`/`$executeRaw`:
  - forma de etiqueta: `Array.isArray(partes) && Array.isArray(partes.raw) && partes.length === valores.length + 1`
    y todos los elementos de `partes` y `partes.raw` son cadenas; los valores que son fragmentos (P-25) se cambian por su
    `Sql` con `aSql(fragmento)` (función interna); los demás se pasan tal cual;
  - forma de llamada: exactamente un argumento que es un fragmento (se cambia por su `Sql`) o `instanceof Prisma.Sql`;
  - cualquier otra cosa: `throw new TypeError('Consulta no válida: usa una plantilla etiquetada o sql del punto
    autorizado.')`, antes de tocar `tx`.
- Las operaciones de los delegados no validan sus argumentos (Prisma los valida y los parametriza); solo se vuelven
  `async`.
- Tipo: P-26. Si `Prisma.TransactionClient` deja de ser asignable a `ClienteTransaccion` (por la sobrecarga con
  `Fragmento`), `enPlataforma` tipa su `trabajo` con `Prisma.TransactionClient`, que los comandos ya usan; si eso rompe
  la verificación de tipos de una prueba protegida, el backend se detiene e informa.

**Parámetros de formato (criterio 107).** `#fijarContexto` y `enPlataforma` amplían su primera sentencia:

```sql
SELECT set_config('app.plataforma', ${p}, true), set_config('app.academia_id', ${id}, true),
       set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, MDY', true),
       set_config('IntervalStyle', 'postgres', true), set_config('extra_float_digits', '1', true),
       set_config('bytea_output', 'hex', true)
```

Sigue siendo una sola sentencia y un solo viaje. En `eslint/regla-sql-sesion.mjs`, `esLlamadaPermitida` (solo en
`cli/`) admite además, sobre el texto normalizado (en minúsculas), exactamente `('datestyle', 'iso, mdy', true)`,
`('intervalstyle', 'postgres', true)`, `('extra_float_digits', '1', true)` y `('bytea_output', 'hex', true)`; ojo con
`argumentosDeLlamada`: la coma dentro de `'iso, mdy'` está dentro de una cadena y ya no separa argumentos.
`standard_conforming_strings` y `search_path` no se fijan: el SQL de la API va con parámetros (el primero no cambia su
significado) y el rol no puede crear objetos en ningún esquema (criterios 80 y 82), así que un `search_path` distinto
solo puede romper consultas (500), no desviarlas. _(Reemplazado por los criterios 121 y 122, ataque ronda 5: el rol
podía tener un esquema propio o con su nombre y otro rol podía crear tablas en un esquema que el `search_path` busca
antes; ahora los dos se fijan. Ver sección 17.)_

**Falla cerrada (criterio 108, P-27).**

- `dominio/bloqueo.ts`: `const valida = (f: unknown): f is Date => f instanceof Date && !Number.isNaN(f.getTime())`;
  `estaBloqueado` devuelve `true` si `!valida(ahora)` o si `bloqueadoHasta !== null && !valida(bloqueadoHasta)`.
- `backend/src/comun/fechas/fecha-de-base.ts` (orientativo): `fechaDeBase(valor: unknown): Date` y
  `fechaDeBaseONula(valor: unknown): Date | null`, que lanzan un `Error` interno (el filtro lo traduce a 500
  `ERROR_INTERNO` y lo registra sin datos) si el valor no es un `Date` válido. `sesion-plataforma.service.ts` pasa por
  ahí `bloqueado_hasta` y `ultimo_acceso` antes de decidir; `academias.service.ts`, `creada_en` y `suspendida_en`
  antes de armar la respuesta. El error sale dentro de `trabajo`, así que la transacción se revierte y no se escribe
  nada.

**Punto autorizado (criterio 114, P-25).** Archivo nuevo `infraestructura/prisma/sql-seguro.ts` y
`infraestructura/prisma/errores-base.ts`, exportados por el `index`:

- `const sqlDe = new WeakMap<Fragmento, Prisma.Sql>()`; `crearFragmento(s: Prisma.Sql): Fragmento` hace
  `const f = Object.freeze(Object.create(null)); sqlDe.set(f, s); return f`; `aSql(f)` (interna, la usa el envoltorio)
  devuelve `sqlDe.get(f)` o `undefined`.
- `sql(partes, ...valores)`: valida `partes` como el envoltorio; cada valor: fragmento → su `Sql`; `Date`, `Decimal`
  (`Prisma.Decimal.isDecimal`), `Uint8Array`, primitivo admitido o arreglo de primitivos/`Date`/`Decimal` → tal cual;
  otro → `TypeError`. Devuelve `crearFragmento(Prisma.sql(partes, ...convertidos))`.
- `join(elementos, separador = 'coma')`: `SEPARADORES = { coma: ', ', y: ' AND ', o: ' OR ' }` en un objeto sin
  prototipo; separador fuera de la lista o lista vacía → `TypeError`; elementos convertidos como en `sql`; devuelve
  `crearFragmento(Prisma.join(convertidos, SEPARADORES[separador]))`.
- `vacio = crearFragmento(Prisma.empty)`.
- `Decimal = Prisma.Decimal` (valor) y `type Decimal = Prisma.Decimal`.
- `codigoDeErrorDeBase(error)`: si es `Prisma.PrismaClientKnownRequestError`, busca un SQLSTATE de 5 caracteres en
  `meta` (según la versión: `meta.code`, `meta.driverAdapterError.cause.originalCode` o similar; con `P2002` devuelve
  `'23505'`); si es un error del adaptador con `code`/`originalCode` de 5 caracteres, ese; si no, `null`. La prueba
  unitaria construye los errores con las clases de Prisma; la de integración provoca una duplicada real con
  `$executeRaw` y con un delegado (`create`), para fijar la forma de la versión instalada.
- `esViolacionDeUnicidad(error)`: `codigoDeErrorDeBase(error) === '23505'` o `error.code === 'P2002'`.
- Alternativas para listas, que el plan recomienda en este orden: `= ANY(${ids}::uuid[])` (un parámetro de arreglo; con
  lista vacía no devuelve filas), `IN (${join(ids)})` (un parámetro por elemento; lista vacía es `TypeError`) y
  fragmentos condicionales con `vacio` para filtros opcionales de reportes.

**Lint (criterios 109 a 113, 115 y 117 a 119).**

- `eslint/regla-sql-sesion.mjs`:
  - patrón nuevo en `PATRONES_EN_CUALQUIER_PARTE` (criterio 109), orientativo:
    `(?<![\p{L}\p{N}_$.])(?:[\p{L}_][\p{L}\p{N}_$]*\.)?(?:query_to_xml(?:schema|_and_xmlschema)?|cursor_to_xml(?:schema)?|(?:table|schema|database)_to_xml(?:schema|_and_xmlschema)?|ts_stat|ts_rewrite|dblink\w*|crosstab\w*|connectby|pg_background\w*)\s*\(`
    más `(?<![\p{L}\p{N}_$.])(?!pg_catalog\.|public\.)[\p{L}_][\p{L}\p{N}_$]*\.[\p{L}_][\p{L}\p{N}_$]*\s*\(` para los
    esquemas ajenos. Se aplican sobre el texto normalizado, donde los identificadores ya no tienen comillas (criterio 83)
    y los espacios alrededor de `.` ya se quitaron. Ojo: `t.id)` no encaja (no sigue `(`) y `count(t.id)` tampoco;
  - cláusula `SET` (criterio 115): los cuatro patrones de `set …` dejan `PATRONES_EN_CUALQUIER_PARTE` y se evalúan por
    sentencia (`sentenciasDe`): una coincidencia cuenta salvo que, en esa sentencia, antes de ella y fuera de una cadena,
    aparezca `\bupdate\b`. Para "fuera de una cadena" se usa una copia de la sentencia con el contenido de cada `'…'`
    reemplazado por espacios (mismo largo, mismas posiciones). `^set\b` como sentencia no cambia;
  - `esEtiquetaDeSql` (texto): acepta identificador `sql` (o cualquier alias local de la `sql` del punto autorizado,
    resuelto por ámbito) y cualquier `MemberExpression` cuya propiedad sea `sql`, `$queryRaw` o `$executeRaw`.
- `eslint/regla-sql-formas.mjs`:
  - `esPlantillaDeSql(nodo)` pasa a resolver la etiqueta con `context.sourceCode.getScope(nodo)` y
    `ASTUtils.findVariable` (o recorriendo `scope.references`): en módulos, la variable debe tener una sola definición
    de tipo `ImportBinding` cuyo `ImportDeclaration.source` resuelto sea el punto autorizado e importe `sql`; o la
    etiqueta es `<ns>.sql` con `<ns>` de un `ImportNamespaceSpecifier` del punto autorizado. En `cli/`, además,
    `Prisma.sql` con `Prisma` resuelto a un `ImportBinding` de `generated/prisma` o `@prisma/…` (con alias);
  - `Prisma` en `cli/` (criterio 113): al visitar cada `Identifier` que referencia una variable ligada a `Prisma` (o a
    un namespace de esos módulos, o a su importación por defecto), el padre debe ser un `MemberExpression` no calculado
    del que es el `object` (o una posición de tipo); si no, error. Sobre la cadena de miembros que empieza ahí, error si
    alguna propiedad es `constructor`, `prototype` o `__proto__`, o si la expresión completa es argumento de
    `Reflect.*` u `Object.{getPrototypeOf,getOwnPropertyDescriptor,getOwnPropertyDescriptors,entries,values,keys,assign}`.
    Desestructuración (`VariableDeclarator` con `ObjectPattern` cuyo `init` es `Prisma` o `G.Prisma`): error con
    `sql`, `raw`, `join`, `empty`, `Sql`, clave calculada o `RestElement`. `require`/`import()` de esos módulos en `cli/`:
    error.
- `eslint/regla-acceso-base.mjs`:
  - `resolverRuta(especificador, archivo)`: como hoy, y después `realpathSi(ruta)`: prueba la ruta tal cual, con cada
    extensión de `EXTENSIONES` (ahora con `jsx`) y con `/index.<ext>`; si existe, `fs.realpathSync.native`; si no, la
    léxica. `context.filename` y `context.cwd` también pasan por `realpathSi` (criterio 111);
  - importar un archivo de pruebas desde uno que no lo es (criterio 110): la ruta resuelta (o el especificador, si no se
    resuelve) cumple `/\.test(?:\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))?$/` o cae bajo `<raíz>/backend/test/`;
  - `cargar-env` y `dotenv` (criterio 117): especificador `dotenv` o `dotenv/…`, o ruta resuelta igual a
    `<raíz>/backend/src/infraestructura/entorno/cargar-env(.ts…)`, desde un archivo que no es `backend/src/main.ts`, ni
    de `backend/src/cli/`, ni de `backend/src/infraestructura/entorno/` → error;
  - el punto autorizado (criterio 114) ya pasaba (`…/infraestructura/prisma` e `…/index` están permitidos, criterio 95).
- Archivos y exenciones (criterios 110, 118 y 119): las tres reglas exportan
  `files: ['backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']` y
  `ignores: ['backend/src/generated/prisma/**', 'backend/src/**/*.test.{ts,mts,cts,js,mjs,cjs}']` (más
  `backend/src/infraestructura/prisma/**` donde ya estaba). En `eslint.config.mjs`, el bloque JS pasa a
  `**/*.{js,jsx,mjs,cjs}`, y el bloque de `ignores` globales cambia `backend/src/generated/**` por
  `backend/src/generated/prisma/**`. `eslint.protegido.config.mjs`: lo mismo en `ignores` y en el analizador (con
  `languageOptions.parserOptions.ecmaFeatures.jsx: true` para `.jsx` y `.tsx`).
- `backend/tsconfig.build.json`: `"exclude": ["node_modules", "dist", "test", "**/*.test.ts", "**/*.test.mts",
  "**/*.test.cts"]`.

**Comprobación previa (criterios 111 y 118, P-28).** `scripts/lib/fuentes-protegidas.mjs` y
`scripts/comprobar-fuentes-protegidas.mjs` (solo `node:*`, más `node:child_process` para `git ls-files`, con
`execFileSync('git', [...])`, que funciona en Windows). `package.json`:
`"lint:protegido": "node scripts/comprobar-fuentes-protegidas.mjs && eslint --no-inline-config --config eslint.protegido.config.mjs --max-warnings 0 backend/src"`.
En Windows, `lstat` informa las uniones (`mklink /J`) como enlaces simbólicos, así que también se detectan.

**Entorno (criterios 116 y 117).** `retirarVariablesSensibles`: `const n = nombre.toUpperCase()` y las mismas
comparaciones sobre `n`. `infraestructura/entorno/index.ts` deja de exportar `cargarEnvRaiz`; `main.ts` importa
`./infraestructura/entorno/cargar-env`. Pasar a mayúsculas con `toUpperCase` puede borrar de más algún nombre raro
(`ſ` pasa a `S`), nunca de menos: falla hacia el lado seguro.

### 17. Correcciones del ataque, ronda 5 (criterios 120 a 129)

Mismo principio que en la ronda 4: 120 a 126 refuerzan la garantía de la base (sesión, `search_path`, rol, catálogo);
127 a 129 cierran caminos que un error del equipo podría abrir hacia otro cliente de la base. No hay migraciones nuevas.

**Sesión con la clave vigente (criterio 120).** En `sesion-plataforma.service.ts`:

- `iniciarSesion` pasa a `aceptarIntento(fila.id, ip, { claveHash: fila.clave_hash, versionToken: fila.version_token })`.
- `aceptarIntento` agrega `clave_hash` a su `SELECT … FOR UPDATE` y, después de comprobar que la fila existe y antes de
  cualquier `UPDATE`, devuelve `{ tipo: 'CAMBIADA' }` si `actual.clave_hash !== leida.claveHash` o
  `Number(actual.version_token) !== Number(leida.versionToken)`. Fuera de la transacción: `warn` ("inicio de sesión de
  plataforma rechazado: la clave o las sesiones cambiaron durante la verificación", sin la clave) y
  `throw credencialesInvalidas()`. La comprobación va antes de la del bloqueo: si la clave cambió, el ingreso no vale
  aunque la cuenta esté bloqueada; si no cambió, el bloqueo sigue como hoy (423).
- Se comparan los dos: `plataforma:superadmin` cambia ambos, pero un cambio de clave que en el futuro no suba la versión
  (por ejemplo, desde la web) también debe cortar el ingreso, y un cierre de sesión sube solo la versión.
- `rechazarIntento` no cambia.
- Prueba (orientativo): `ajustar: (b) => b.overrideProvider(BaseDatos).useFactory({ factory: (entorno, registro) =>
  crearDoble(new BaseDatos(entorno, registro)), inject: [ENTORNO, PinoLogger] })`, donde el doble expone los cuatro
  métodos del contrato, delega en el real y, con una marca armada por la prueba, cuenta las llamadas a `comoPlataforma` de
  la petición y ejecuta `ejecutarComando('plataforma:superadmin', …)` (síncrono) antes de la segunda. Si construir el
  `BaseDatos` real dentro del doble no es posible sin tocar utilidades protegidas, el test-writer se detiene e informa.

**Primera sentencia (criterios 121 y 122).** `#fijarContexto` y `enPlataforma` quedan así (una sola sentencia y un solo
viaje, como antes):

```sql
SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true),
       pg_catalog.set_config('standard_conforming_strings', 'on', true),
       pg_catalog.set_config('app.plataforma', ${p}, true), pg_catalog.set_config('app.academia_id', ${id}, true),
       pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true),
       pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true),
       pg_catalog.set_config('bytea_output', 'hex', true)
```

- PostgreSQL resuelve los nombres de funciones al interpretar la sentencia, con el `search_path` que trae la conexión: lo
  que protege es `pg_catalog.`, no el orden de las llamadas. Las siguientes sentencias de la transacción ya se
  interpretan con el `search_path` fijo y con `standard_conforming_strings` en `on`.
- `${p}` e `${id}` van como parámetros: `standard_conforming_strings` no los afecta. La sentencia no tiene `\`.
- `current_setting('search_path')` devuelve `pg_catalog, public, pg_temp`; la prueba compara sin espacios.
- `eslint/regla-sql-sesion.mjs`: `AJUSTES_FIJOS_PERMITIDOS` agrega `'search_path' → 'pg_catalog, public, pg_temp'` y
  `'standard_conforming_strings' → 'on'` (texto normalizado, en minúsculas). Confirmar que una llamada
  `pg_catalog.set_config(…)` llega a `esLlamadaPermitida` con los mismos argumentos que sin el esquema (el patrón ya la
  detecta como llamada, criterio 83) y que la coma dentro de `'pg_catalog, public, pg_temp'` no separa argumentos
  (como con `'iso, mdy'`).
- **Por qué no `public.` en todo el SQL (decisión del criterio 121):** después de la primera sentencia, el `search_path`
  no puede cambiar (lint, criterios 83 y 84), `pg_catalog` va primero (solo un superusuario crea objetos ahí) y `pg_temp`
  va al final (la app no crea temporales, criterio 82). Calificar cada tabla en cada historia no agrega protección y el
  lint no podría exigirlo de forma fiable. Las funciones `app_academia_actual()` y `app_es_plataforma()` (llamadas desde
  las políticas, que guardan referencias ya resueltas) no necesitan su propio `SET search_path`, que además impediría que
  PostgreSQL las incorpore a la consulta (más lento en tablas grandes).

**Comprobación del rol (criterios 121, 123 y 125).**

- `#comprobarRol` corre en `this.#prisma.$transaction(async (tx) => { await this.#fijarContexto(tx, { academiaId: '',
  plataforma: false }); … })`, con `tx` directo (método privado). Califica con `pg_catalog.` lo que hoy va sin calificar:
  `has_table_privilege`, `has_sequence_privilege`, `has_column_privilege` y `unnest`. `current_user` es una palabra
  reservada, no una función que se pueda tapar. Cuesta un viaje más a la base, una vez por proceso.
- Consulta nueva (orientativa) y `problemasDeEsquemas` (P-29) en `rol-seguro.ts`:

  ```sql
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid) AS dueno_de_esquema,
         EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                  WHERE pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')) AS crea_en_esquema,
         EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = r.rolname) AS esquema_con_su_nombre
    FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
  ```

- `scripts/crear-bases.mjs` y `scripts/lib/rol-app.mjs`, por cada base: los nombres de los esquemas propios
  (`nspowner`), los esquemas con `CREATE` (`has_schema_privilege('aquagestion_app', n.oid, 'CREATE')`, y si llega por
  `PUBLIC`: `pg_catalog.aclexplode(n.nspacl)` con `grantee = 0` y `privilege_type = 'CREATE'`) y si existe el esquema
  `aquagestion_app`; luego `problemasDeEsquemasApp`. Las consultas de `db:crear` también califican con `pg_catalog.`, y
  la conexión del script fija `SET search_path = pg_catalog, public, pg_temp` al conectarse (los scripts no pasan por el
  lint).
- 125: la consulta de privilegios ya incluye `relkind` `'v'` y `'m'` en la API y en `db:crear`; se espera que pase sin
  cambios. Si la prueba falla, se corrige la consulta.

**Catálogo (criterios 124 y 126).** Consultas orientativas; las valida la parte de la prueba que crea objetos de
ejemplo en una transacción que se revierte.

- Vistas sin `security_invoker`: `relkind = 'v'` y sin una opción `security_invoker` con valor verdadero en
  `pg_catalog.pg_options_to_table(c.reloptions)` (`true`, `on`, `1` o `yes`, sin distinguir mayúsculas).
- Vistas materializadas y tablas foráneas: `relkind IN ('m', 'f')`.
- Funciones: `pg_proc` de `public` con `prosecdef` y nombre fuera de la lista permitida (vacía); y con algún elemento de
  `proconfig` que no empiece por `search_path=`.
- Reglas: `pg_rewrite` unida a `pg_class` de `public` donde no se cumple `rulename = '_RETURN' AND relkind = 'v'`.
- Tablas: `relkind IN ('r', 'p')`, `relname <> '_prisma_migrations'` y no (`relrowsecurity` y `relforcerowsecurity`).
- Unicidad (126): por cada fila de `pg_index` con `indisunique OR indisexclusion` sobre una tabla de `public` con columna
  `academia_id`, el número de esa columna debe estar entre las primeras `indnkeyatts` posiciones de `indkey`
  (`(indkey::int2[])[0:indnkeyatts - 1]`; las de `INCLUDE` van después y no cuentan). Excepción: `indisprimary`, una sola
  columna clave, que es `id` de tipo `uuid` con `pg_get_expr(adbin, adrelid) = 'gen_random_uuid()'` en `pg_attrdef`.

**Dependencias (criterios 127 a 129).**

- `scripts/lib/dependencias-backend.mjs` (P-30): la lista permitida es la de `backend/package.json` de hoy más
  `express`. `scripts/comprobar-fuentes-protegidas.mjs` llama a `problemasDeDependencias(raiz)`.
- Las reglas de los criterios 128 y 129 van en `eslint/regla-acceso-base.mjs` (mismo identificador de regla, mensajes
  nuevos), para no cambiar la lista de reglas del paso protegido que comprueba la prueba del criterio 96. Reutilizan la
  detección de vías de importación del criterio 85 y la de rutas a `node_modules/` del criterio 95, e importan
  `nombreDePaquete` y `esClienteDeBaseProhibido` de `scripts/lib/dependencias-backend.mjs`. Los paquetes declarados se
  leen una vez por ejecución de `<cwd>/backend/package.json` (con `realpath`, criterio 111). Módulos de Node:
  `node:module` `isBuiltin(especificador)`.
- `backend/package.json`: `express` con el mismo rango mayor que usa `@nestjs/platform-express` (confirmar con
  `npm ls express`), para que npm no instale una segunda copia; se actualiza `package-lock.json`.

**Rodeos de los falsos positivos aceptados (O7 de "Riesgos aceptados").**

```ts
// Un fragmento guardado en una variable: se interpola en una plantilla, no se pasa como argumento.
const consulta = sql`SELECT … FROM auditoria WHERE academia_id = ${tx.academiaId}::uuid`;
const filas = await tx.cliente.$queryRaw`${consulta}`;

// ORDER BY elegido por el usuario: un mapa cerrado de fragmentos; la clave la valida antes un esquema zod (z.enum).
const ORDEN = Object.freeze({ reciente: sql`ORDER BY fecha_hora DESC`, accion: sql`ORDER BY accion, fecha_hora DESC` });
const filas2 = await tx.cliente.$queryRaw`SELECT … FROM auditoria ${ORDEN[orden]}`;
```

### 18. Correcciones del ataque, ronda 6 (criterios 130 a 136)

La ronda 6 no encontró fallas en las garantías de ejecución de 001. Lo que corrige son guardas para las historias
siguientes: 130 y 131 llevan la comprobación del rol y las pruebas de catálogo a todos los esquemas; 132 y 133 fijan la
forma de las políticas y la prueban en ejecución sobre toda tabla de academia; 134 y 135 impiden usar una transacción
fuera de su `trabajo`; 136 ajusta el lint del SQL. No hay migraciones nuevas.

**Esquemas revisados (criterios 130 y 131).** Fragmentos SQL comunes (orientativos), para la API, `db:crear` y las pruebas:

```sql
-- esquemas revisados
n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(toast_)?temp_'
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                   WHERE d.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass AND d.objid = n.oid
                     AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e')
-- objeto de extensión (relación; para funciones, classid = pg_proc y objid = p.oid)
EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
         WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid = c.oid
           AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e')
```

**Comprobación del rol (criterio 130).**

- `#comprobarRol` agrega, en la misma transacción (con la primera sentencia, criterio 121), una consulta que devuelve las
  filas de `PrivilegioEnEsquema` (P-31) con `UNION ALL`:
  - relaciones `r, p, v, m, f` de los esquemas revisados, sin objetos de extensiones: privilegios de tabla
    (`has_table_privilege`) y de columna (`has_column_privilege`), como hoy pero con `n.nspname` en la fila;
  - secuencias `S`: `has_sequence_privilege` con `USAGE`, `SELECT` y `UPDATE`;
  - funciones (`pg_proc`, sin objetos de extensiones) de `public` y de los esquemas revisados con
    `has_schema_privilege(current_user, n.oid, 'USAGE')`: `has_function_privilege(current_user, p.oid, 'EXECUTE')`, con
    `pg_get_function_identity_arguments(p.oid)` como `argumentos`;
  - esquemas revisados: `has_schema_privilege(current_user, n.oid, 'USAGE')`, con `conObjetosPropios` =
    existe una relación (cualquier `relkind`) o una función del esquema que no es objeto de extensión.
- Todo calificado con `pg_catalog.` (criterio 121); `current_user` no se puede tapar.
- `problemas.push(...privilegiosDeMasEnEsquemas(filas))`. Para no repetir mensajes, la consulta del criterio 102 sobre
  `public` puede quedarse (sus pruebas la usan) y el registro técnico une los textos sin duplicados; o `#comprobarRol`
  puede dejar de llamar a `privilegiosDeMas` si `privilegiosDeMasEnEsquemas` aplica la misma regla en `public` (P-31). Lo
  decide el backend; las pruebas solo miran el rechazo y lo que nombra el log.
- El log del rechazo nombra esquema, objeto, columna y privilegio (texto de P-31), sin la URL ni la contraseña.
- `scripts/crear-bases.mjs`: `problemasDePrivilegios` agrega la misma consulta con `'aquagestion_app'` en lugar de
  `current_user` y llama a `privilegiosDeMasEnEsquemas` de `scripts/lib/rol-app.mjs`. Para la corrección `FROM PUBLIC`,
  mira si el privilegio llega por `PUBLIC` con `pg_catalog.aclexplode(relacl | attacl | proacl | nspacl)` y `grantee = 0`,
  como en el criterio 123. La conexión del script ya fija `search_path` (ronda 5).
- `FUNCIONES_APP` y `ESQUEMAS_PERMITIDOS` se escriben en los dos archivos con el mismo contenido; la prueba los compara.

**Pruebas de catálogo en todos los esquemas (criterio 131).** En `catalogo.test.ts`, `catalogo-objetos.test.ts` y
`catalogo-unicidad.test.ts`, cada `n.nspname = 'public'` pasa al fragmento de esquemas revisados y se agrega la exclusión
de objetos de extensiones; las listas y excepciones se comparan como `esquema.nombre` (`public._prisma_migrations`). Las
funciones de ayuda devuelven `esquema.tabla` y usan `pg_catalog.quote_ident` al armar `regclass`.

**Forma de las políticas (criterio 132).**

- Consulta (orientativa), como dueño, en una transacción con `SET LOCAL search_path = pg_catalog, public`:

  ```sql
  SELECT n.nspname AS esquema, c.relname AS tabla, p.polname AS nombre, p.polcmd AS comando, p.polpermissive AS permisiva,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS usando,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS comprobando
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE <esquemas revisados> AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                                          WHERE a.attrelid = c.oid AND a.attname = 'academia_id'
                                            AND a.attnum > 0 AND NOT a.attisdropped)
  ```

- `pg_get_expr` escribe la comparación como `(academia_id = app_academia_actual())` y una conjunción como
  `((academia_id = app_academia_actual()) AND (clave <> 'x'::text))`. `terminosDeConjuncion` (P-33) recorre el texto
  con un contador de paréntesis que ignora lo que está entre comillas simples y dobles, quita los paréntesis que encierran
  toda la expresión, corta en ` AND ` de profundidad 0 y repite con cada término que, sin sus paréntesis exteriores, es a
  su vez una conjunción. Con `search_path` fijo, el `=` de `uuid` sale sin calificar y uno de otro esquema sale como
  `OPERATOR(otro.=)`.
- `polcmd`: `r` (SELECT), `a` (INSERT), `w` (UPDATE), `d` (DELETE), `*` (ALL). Las de `INSERT` no tienen `USING`.

**Prueba de ejecución sobre toda tabla de academia (criterio 133).**

- Descubre las tablas con `academia_id` (relkind `r` y `p`) en los esquemas revisados. Para una partición, sirve el
  sembrador de su tabla padre (la fila cae en la partición); la prueba consulta cada tabla y cada partición.
- `SEMBRADORES_POR_TABLA` (P-33) hoy: `public.auditoria` (una fila con `actor_tipo = 'SISTEMA'`) y
  `public.configuraciones` (una clave aleatoria que cumple el `CHECK`, `valor = '{}'`). Cada sembrador usa
  `ejecutarComo('propietario', …, { academiaId })`.
- La copia para el `INSERT` con B: como dueño, `SELECT pg_catalog.to_jsonb(t) FROM <tabla> t WHERE academia_id = A LIMIT 1`;
  se cambia `academia_id`; como app en contexto de A, `INSERT INTO <tabla> (<columnas>) SELECT <columnas> FROM
  pg_catalog.jsonb_populate_record(NULL::<tabla>, $1)`, con las columnas de `pg_attribute` sin `attgenerated <> ''` ni
  `attidentity = 'a'`. PostgreSQL comprueba el `WITH CHECK` antes que las restricciones únicas, así que el resultado
  esperado es `42501` aunque la fila choque con la llave primaria.
- Autocomprobación: la misma función de comprobación recibe un ejecutor; en la autocomprobación, el ejecutor corre dentro de
  la transacción del dueño con `SAVEPOINT`, `SET LOCAL ROLE aquagestion_app`, `set_config(…, true)` del contexto, la consulta
  y `ROLLBACK TO SAVEPOINT` (que deshace el `SET LOCAL ROLE`). Si `SET ROLE` falla con `42501` (la nube), se omite con aviso.

**Envoltorio atado al contexto (criterio 134).**

- En `envoltorio.ts`: `const almacen = new AsyncLocalStorage<object>()` del módulo. `envolver(tx)` crea `const marca =
  Object.freeze({})`; `exigirActiva` pasa a comprobar `activa && almacen.getStore() === marca`, con un mensaje distinto
  para cada caso (orientativo: "La transacción ya terminó." y "Esta transacción pertenece a otra operación: pásala como
  parámetro dentro de trabajo, no la guardes."). Se agrega `ejecutar: (fn) => almacen.run(marca, fn)`.
- En `#transaccion`: `return await ejecutar(() => trabajo(cliente))`, y la consulta de `estado` de `conAcademia` también
  corre dentro (hoy está dentro del `trabajo` interno que recibe `#transaccion`, así que basta con envolver esa función).
- `AsyncLocalStorage` propaga el contexto por promesas, temporizadores y `EventEmitter` creados dentro de `fn`; no por un
  objeto creado fuera que guarda callbacks y los llama después desde otro contexto (por ejemplo, un `DataLoader` compartido):
  esas estructuras se crean dentro de `trabajo`.
- Costo: una búsqueda en el almacén por llamada; despreciable frente al viaje a la base.

**Regla de lint de la transacción guardada (criterio 135).** `eslint/regla-transaccion-guardada.mjs`, en el bloque de
`backend/src` de `eslint.config.mjs` (no en `eslint.protegido.config.mjs`). Usa `context.sourceCode.getScope(nodo)` para
resolver el identificador del valor: si su definición es un `Parameter` cuyo nodo función es el argumento `trabajo` de una
llamada `X.conAcademia(_, f)` o `X.comoPlataforma(f)`, o un identificador con `typeAnnotation` cuyo nombre (o la parte
derecha de un nombre calificado) es uno de los tres tipos, informa. El destino se acepta si su raíz (siguiendo `.object`)
es `ThisExpression`, o un identificador cuya variable está en el ámbito `module` o `global`. La prohibición de `async_hooks`
se puede reutilizar de la detección de vías de importación del criterio 85.

**Lint del SQL (criterio 136).** En `eslint/regla-sql-sesion.mjs`, antes de rechazar un `SET` como sentencia, se acepta
el tramo si coincide (sin distinguir mayúsculas, sobre el texto normalizado) con algo como
`^set\s+constraints\s+(all|<ident>(\s*,\s*<ident>)*)\s+(deferred|immediate)$`, con `<ident>` =
`(public\s*\.\s*)?([a-z_][a-z0-9_$]*|"([^"]|"")+")`; el marcador de `${…}` no es un `<ident>`. `lastval` y `currval` se
agregan a la lista de funciones prohibidas del criterio 94 (la misma detección de llamadas, con o sin `pg_catalog.`).

**Notas para las historias siguientes (sin criterio propio; ataque ronda 6).**

- **O1. No anidar transacciones.** Una tarea programada o un proceso que recorre academias primero lista con
  `comoPlataforma`, cierra esa transacción, y después llama a `conAcademia` por cada academia, una tras otra o con un
  límite de concurrencia menor que `DATABASE_POOL_MAX`. Nunca `conAcademia` dentro del `trabajo` de otra transacción: ocupa
  dos conexiones, con `DATABASE_POOL_MAX` pequeño puede bloquearse esperando una conexión libre, y el criterio 134 rechaza
  usar la transacción exterior dentro de la interior.
- **O3. Identificadores e idempotencia.** El `id` de cada fila lo genera la base (`gen_random_uuid()`, criterio 126);
  el cliente nunca lo envía. Las claves de idempotencia que manda el cliente (doble clic o reintento en cobros,
  verificación y asistencia; `CLAUDE.md`) van en una columna propia con `UNIQUE (academia_id, clave)`, y el duplicado se
  detecta con `esViolacionDeUnicidad` (criterio 114). Así una clave repetida en otra academia no choca ni revela nada.
  _(Ampliada por la ronda 10 del ataque, criterio 149: dentro de `trabajo`, el duplicado esperado se resuelve con
  `INSERT … ON CONFLICT DO NOTHING RETURNING`, no atrapando el error; `esViolacionDeUnicidad` sirve fuera de la
  transacción. Detalle en la sección 22.)_
- **O4. Valores de sesión.** `lastval()` y `currval()` devuelven el último valor obtenido **en la sesión**, que la
  conexión del pool comparte entre academias: se usa `INSERT … RETURNING` (el lint los prohíbe desde el criterio 136).

### 19. Correcciones del ataque, ronda 7 (criterios 137 a 140)

La ronda 7 no encontró fallas críticas ni altas. Lo que corrige: 137 alinea `db:crear` con la API ante los objetos de
extensiones; 138 y 140 quitan dos falsos positivos de las pruebas de las políticas sin abrir huecos; 139 amplía la regla de
lint del criterio 135. No hay migraciones nuevas. Lo único que cambia en código de producción es `scripts/crear-bases.mjs` y
la regla de lint; 138 y 140 cambian solo pruebas protegidas y sus utilidades.

**`db:crear` sin objetos de extensiones en `public` (criterio 137).**

- En `problemasDePrivilegios` (`scripts/crear-bases.mjs`), las tres ramas de la consulta (tabla, secuencia y columna)
  agregan la condición "no es objeto de extensión" sobre `c.oid` con el fragmento de la sección 18
  (`NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND
  d.objid = c.oid AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e')`). Las columnas
  de una relación de extensión quedan fuera por la misma condición sobre la relación.
- `problemasDePrivilegiosEnEsquemas` ya los excluye (sección 18). La API no cambia: su consulta única (criterio 130) ya
  los excluye en todo esquema.
- Alternativa considerada y descartada: que `db:crear` deje de llamar a `problemasDePrivilegios` y use solo la consulta
  del criterio 130 para `public`, como la API. Se descarta por ahora porque cambia el formato de los mensajes que esperan
  las protegidas del criterio 102 en `db:crear` (`REVOKE TRUNCATE ON auditoria FROM aquagestion_app;`, sin esquema). Si el
  backend prefiere unificar, debe conservar esos mensajes.
- Prueba de catálogo (criterio 137, orientativa):

  ```sql
  SELECT n.nspname, c.relname
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_(toast_)?temp_'
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                  WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid = c.oid
                    AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e')
     AND (EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'academia_id'
                   AND a.attnum > 0 AND NOT a.attisdropped)
          OR (n.nspname = 'public' AND c.relname = ANY ($1::text[])))   -- tablas de PRIVILEGIOS_APP
  ```

  más la misma idea sobre `pg_proc` con `FUNCIONES_APP` (nombre y `pg_get_function_identity_arguments`). Aquí no se
  excluyen los esquemas de extensiones: justo se buscan los objetos de extensión.
- Instalación en la prueba de integración: comprobar antes en `pg_extension` si la extensión ya existe (si existe, no se
  toca y se prueba con la otra vía o se omite); `pg_stat_statements` se puede crear sin estar en
  `shared_preload_libraries` (solo falla al consultar sus vistas, que la prueba no consulta). Para la vía de confianza,
  `ALTER EXTENSION … ADD VIEW` exige ser dueño de la extensión y de la vista: las crea el mismo dueño. Al restaurar:
  `ALTER EXTENSION … DROP VIEW`, `DROP VIEW` y `DROP EXTENSION` solo de lo creado.

**Fila de prueba válida en B (criterio 138).**

- Función de ayuda en `rls-todas-las-tablas.test.ts` (orientativa): `filasDeAcademia(tabla, academiaId)` lee como dueño con
  el contexto de esa academia `SELECT pg_catalog.to_jsonb(t)::text FROM <tabla> t WHERE academia_id = $1` y devuelve un
  conjunto de textos. La fila nueva es la diferencia entre el conjunto después y antes de llamar al sembrador.
- Borrado: como dueño con el contexto de B, `DELETE FROM <tabla> t WHERE pg_catalog.to_jsonb(t) = $1::jsonb` (o por la
  llave primaria, si la tabla la tiene: más simple y exacto). Si falla, se usa la forma anterior con `42501` exacto y se
  informa.
- Intento: como app en contexto de A (`ejecutarComo('app', …, { academiaId: A })`), `INSERT INTO <tabla> (<columnas>)
  SELECT <columnas> FROM pg_catalog.jsonb_populate_record(NULL::<tabla>, $1)`, con las columnas como en la sección 18 (sin
  `attgenerated <> ''` ni `attidentity = 'a'`). La llave primaria (`id`) va en la fila: como se borró, no choca.
- Comprobación: `filasDeAcademia(tabla, B)` otra vez; falla si hay algún texto que no estaba en el conjunto tomado
  después del borrado. Para leer B en la nube, el dueño necesita el contexto de B (pasa por RLS por el `FORCE`).
- Autocomprobación: dentro de la transacción del dueño que se revierte, el borrado y el intento van en un `SAVEPOINT`
  propio; el intento con `SET LOCAL ROLE aquagestion_app` y el contexto de A; si termina sin error, `RESET ROLE` y la
  lectura de B como dueño antes de `ROLLBACK TO SAVEPOINT` (que deshace el intento y el cambio de rol). La tabla padre de
  ejemplo y la llave foránea compuesta se crean en la misma transacción.

**Regla de lint (criterio 139).** En `eslint/regla-transaccion-guardada.mjs`, para archivos fuera de
`backend/src/infraestructura/`:

- `Identifier`, `ImportSpecifier.imported`, `ExportSpecifier.local/exported`, `MemberExpression.property` (con punto, o
  calculada con `Literal` o `TemplateLiteral` sin expresiones) y la clave de un `Property` dentro de un `ObjectPattern`: si
  el nombre es `EventEmitterAsyncResource`, informar. No hace falta saber de qué módulo viene: el nombre basta.
- `getBuiltinModule`: se informa toda aparición del nombre (propiedad, clave de patrón, identificador) salvo cuando el
  nodo es el `callee.property` de una `CallExpression` cuyo primer argumento es un `Literal` de cadena (o una plantilla sin
  expresiones) distinto de `async_hooks` y `node:async_hooks`.
- Mensaje orientativo: "No uses EventEmitterAsyncResource ni cargues async_hooks fuera de infraestructura/: conservan el
  contexto de una transacción y otra petición podría usarla (criterios 134 y 139)."

**Notas para las historias siguientes (sin criterio propio; ataque ronda 7).**

- **O1. Un objeto por transacción no se guarda en `this`.** Un repositorio o una unidad de trabajo creada dentro de
  `trabajo` que guarda `tx` en `this` (`new RepositorioPagos(tx)` con `this.tx = tx` en el constructor) hace fallar la regla
  del criterio 135, aunque el objeto viva solo dentro de esa transacción. El patrón recomendado: repositorios sin estado,
  con `tx` como parámetro de cada función (`this.pagos.registrar(tx, datos)`), como `registrarEnAcademia(tx, entrada)` de la
  auditoría. No se abre una excepción en la regla.
- **O2. Formas que la regla 135 no ve.** Uniones de tipos (`TransaccionAcademia | null`), un `trabajo` guardado en una
  variable tipada antes de pasarlo, y un delegado guardado (`this.d = tx.cliente.configuraciones`). Están en "Riesgos
  aceptados" de la especificación (transacciones guardadas que el lint no sigue): las cubre el criterio 134 en ejecución.
- **O4. Sin colas ni lotes compartidos entre peticiones dentro de `trabajo`.** Una cola o un lote que vive fuera de
  `trabajo` (un campo del servicio, una variable del módulo) y que se vacía con un temporizador programado dentro del
  `trabajo` de A procesaría con la transacción de A lo que agregó B (el temporizador hereda el contexto de A, criterio
  134, y el envoltorio acepta). Las colas y los lotes se crean dentro de `trabajo` y se vacían antes de que termine; lo que
  deba procesarse después va a una tarea con su propia transacción por academia (nota O1 de la ronda 6).
- **O6. `pg_notify` sigue prohibido.** Es coherente con el criterio 84 (`LISTEN`, `UNLISTEN`, `NOTIFY` y `pg_notify(`
  fallan el lint fuera de `infraestructura/prisma/`): una notificación sale de la transacción y la recibe cualquier
  conexión, de cualquier academia. Si una historia necesita avisos entre procesos, lo decide su especificación.

### 20. Correcciones del ataque, ronda 8 (criterios 141 a 143)

La ronda 8 no encontró fallas en las garantías de ejecución de 001. Lo que corrige: 141 y 142 dejan de excluir enteros los
esquemas que pertenecen a una extensión (solo se excluyen sus objetos), en la API, en `db:crear` y en las pruebas de
catálogo; 143 rechaza las URL cuya cadena de consulta cambia el usuario, el servidor o la base. No hay migraciones nuevas.

**Esquemas revisados con esquemas de extensiones (criterio 141).**

- El fragmento "esquemas revisados" de la sección 18 pierde el `NOT EXISTS (… classid = 'pg_catalog.pg_namespace' …)`:

  ```sql
  n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_(toast_)?temp_'
  ```

  Se cambia en el CTE `esquemas` de `#comprobarRol` (`backend/src/infraestructura/prisma/base-datos.ts`) y de
  `problemasDePrivilegiosEnEsquemas` (`scripts/crear-bases.mjs`). Hay que buscar cualquier otra consulta de producción que
  repita la condición (por ejemplo, con `grep "pg_namespace'::pg_catalog.regclass"`): `problemasDeEsquemas` (criterio 123) hoy
  no la usa (revisa todos los esquemas), y debe seguir así.
- Objeto de extensión para el CTE `relaciones`: se mantiene la condición sobre `c.oid` y se agrega, para los tipos
  compuestos, la del tipo:

  ```sql
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
               WHERE d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e'
                 AND ((d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid = c.oid)
                      OR (c.relkind = 'c' AND d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                          AND d.objid = c.reltype)))
  ```

  El CTE `funciones` no cambia. `conObjetosPropios` sigue igual (`relkind NOT IN ('i', 'I', 't')` o una función).
- Los índices de una tabla de la extensión no tienen fila `deptype = 'e'` propia (dependen de la tabla), pero ya no cuentan
  para `conObjetosPropios` y no tienen privilegios de tabla. Las secuencias que crea el guion de una extensión sí la tienen.
- `privilegiosDeMasEnEsquemas`, `FUNCIONES_APP` y `ESQUEMAS_PERMITIDOS` no cambian. Las correcciones de `db:crear` salen como
  hoy (`correccionDePrivilegioEnEsquema`), con el esquema delante (`reportes2.t`).
- `problemasDePrivilegios` (criterio 102, solo `public`) no cambia.

**Pruebas de integración del criterio 141.**

- Preparación con la utilidad de `backend/test/utilidades/extensiones.ts` (ronda 7) o una parecida: comprobar en
  `pg_extension` si `pgcrypto` ya existe; si existe y su dueño no es el de la prueba, omitir con aviso (`ALTER EXTENSION …
  ADD` exige ser dueño de la extensión y del objeto). Si no existe, crearla en `public` y quitarla al final.
- Restauración: `ALTER EXTENSION pgcrypto DROP TABLE …`, `… DROP FUNCTION …`, `… DROP TYPE …` y `… DROP SCHEMA …` de lo que
  se agregó, y luego `DROP SCHEMA … CASCADE` (un esquema miembro de una extensión no se puede borrar sin quitarlo antes) y
  `DROP EXTENSION` solo si la creó la prueba. Los `GRANT` a la app o a `PUBLIC` se van con los objetos.
- La autocomprobación del criterio 142 va dentro de una transacción que se revierte: `ALTER EXTENSION … ADD SCHEMA` es
  transaccional.

**Pruebas de catálogo (criterio 142).** En `backend/test/utilidades/catalogo.ts`, `esquemasRevisados` queda con las dos
primeras condiciones; `relacionDeExtension` y `funcionDeExtension` no cambian. Las consultas de los criterios 9, 10, 11, 12,
124, 126, 132 y 133 ya usan esa función, así que no se tocan. Si alguna prueba repite la condición en su propio SQL, se
ajusta igual.

**URL sin parámetros de conexión en la consulta (criterio 143).**

- `parametrosDeConexionProhibidos(url)` (P-34): `new URL(url)`, recorrer `searchParams.keys()` (ya decodificadas), pasar a
  minúsculas, filtrar las de la lista y quitar repetidos. Sin dependencias.
- Backend: `backend/src/infraestructura/entorno/url-postgres.ts`; `validarEntorno` la llama después de `esUrlPostgres` y
  agrega un problema por variable con los nombres de los parámetros. `superadmin.ts` y `seed.ts` la llaman sobre
  `DATABASE_URL` justo después de `leerVariable` y antes de `crearClienteDelDueno`; con algún parámetro, `console.error` y
  código 1 ("No se hizo ningún cambio. …"). No se pone dentro de `crearClienteDelDueno` para no cambiar las utilidades de
  prueba que la usan con `options`.
- Scripts: en `analizarUrlPostgres` de `scripts/lib/entorno.mjs`, después de validar el protocolo; así quedan cubiertos
  `leerUrlApp`, `leerUrlsBases`, `crearBases` (`db:crear`), `scripts/preparar-bases.mjs` y el hook
  (`.claude/hooks/preparar-sesion.mjs`, que carga ese archivo con `import()`). El mensaje no usa `valor`.
- Recomendado, sin criterio propio: la misma comprobación en `scripts/prisma.mjs` sobre `DATABASE_URL` (o
  `DATABASE_URL_PRUEBAS` con `--pruebas`) antes de llamar a Prisma, para que `npm run db:migrar` solo también la aplique
  (riesgo aceptado "Otros parámetros de la cadena de consulta"). Si se hace, no puede cambiar el resultado de las pruebas
  existentes de `scripts/prisma.mjs`.
- `urlAppSobre` (scripts y pruebas) conserva los parámetros de la URL base (`DATABASE_URL_PRUEBAS`); como esa URL ya se
  valida, la URL armada no puede traer los prohibidos.

**Notas para las historias siguientes (sin criterio propio; ataque ronda 8).**

- **O3. Sin cachés compartidas entre academias en los servicios.** Un servicio de Nest es una sola instancia para todas las
  peticiones. Guardar el resultado (o la promesa) de una consulta en una propiedad del servicio o en una variable del módulo
  (`this.cargando ??= tx.cliente.configuracion.findMany(…)`, `this.planes = await …`) hace que la petición de otra academia
  reciba los datos de la primera sin usar su propia transacción: RLS no lo ve (la consulta se hizo con la academia
  correcta) y el criterio 134 tampoco (no se usa la transacción de otro contexto, se usa su resultado). Regla: los servicios
  no guardan resultados de consultas en propiedades ni en variables del módulo; si una historia necesita caché, la clave
  incluye la `academia_id` de la sesión (por ejemplo, `Map<academiaId, …>`), se invalida en la escritura y lo decide su
  especificación. Desde la historia 003 (configuración por academia) el revisor y el adversarial lo buscan.
- **O2. Repositorio por transacción.** Ya está en la nota O1 de la ronda 7: repositorios sin estado, con `tx` como
  parámetro.

### 21. Correcciones del ataque, ronda 9 (criterios 144 a 148)

La ronda 9 encontró una falla alta: nada impedía marcar `IMMUTABLE` las funciones de contexto, y con eso un plan guardado
en una conexión del pool mezcla academias sin que falle ninguna prueba. Lo que corrige: 144 y 145 son guardas (catálogo y
ejecución) que pasan desde el principio, porque las dos funciones ya son `STABLE`; 146 y 147 agregan cuatro parámetros a la
primera sentencia; 148 agrega una comprobación a `db:crear` y al hook. No hay migraciones nuevas. El código de producción que
cambia: `base-datos.ts`, `cli/conexion.ts`, la regla de lint de `cli/`, `scripts/lib/entorno.mjs`, `scripts/crear-bases.mjs`,
el hook y el comentario de `.env.example`.

**Volatilidad en el catálogo (criterio 144).** En `backend/test/utilidades/catalogo.ts` o en la propia prueba (orientativo):

```sql
-- funciones de las que depende una política, fuera de pg_catalog, que son IMMUTABLE
SELECT DISTINCT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos, p.provolatile
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE d.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
   AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   AND n.nspname <> 'pg_catalog'
   AND p.provolatile = 'i';

-- funciones propias que leen el contexto, IMMUTABLE (cuarta viñeta)
SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS argumentos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE <esquemasRevisados> AND NOT <funcionDeExtension>
   AND p.provolatile = 'i'
   AND p.prosrc ~* '(current_setting|app_academia_actual|app_es_plataforma)';
```

- Los operadores (`=` sobre `uuid`) quedan como dependencias hacia `pg_operator`, no hacia `pg_proc`, y son de `pg_catalog`:
  no entran.
- Cuerpo: comparar en TypeScript `prosrc.replace(/\s+/g, ' ').trim()` con el texto exacto del criterio, más `prolang` (por
  `pg_language.lanname = 'sql'`), `prosecdef`, `proconfig IS NULL`, `prorettype::regtype::text` (`uuid`, `boolean`) y
  `pronargs = 0`. El texto esperado se escribe en la prueba, no se lee de la migración.
- Autocomprobación: todo dentro de una transacción del dueño que se revierte, con un `SAVEPOINT` por caso y
  `ROLLBACK TO SAVEPOINT` después de consultar. `ALTER FUNCTION` exige ser el dueño de la función (lo es el dueño de las
  migraciones, también en la nube). La política de ejemplo: tabla `prueba_r9_tabla (academia_id uuid)` con RLS, función
  `prueba_r9_inmutable() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::uuid $$` y
  `CREATE POLICY … USING (academia_id = prueba_r9_inmutable())`.

**Plan guardado (criterio 145).**

- Función de disparador (orientativa):

  ```sql
  CREATE FUNCTION public.prueba_r9_academias_vistas() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.clave LIKE 'prueba\_r9\_%' THEN
      NEW.valor := COALESCE((SELECT pg_catalog.jsonb_agg(DISTINCT c.academia_id ORDER BY c.academia_id)
                               FROM public.configuraciones c WHERE c.clave LIKE 'prueba\_r9\_%'), '[]'::jsonb);
    END IF;
    RETURN NEW;
  END $$;
  REVOKE EXECUTE ON FUNCTION public.prueba_r9_academias_vistas() FROM PUBLIC;
  CREATE TRIGGER prueba_r9_academias_vistas BEFORE INSERT ON public.configuraciones
    FOR EACH ROW EXECUTE FUNCTION public.prueba_r9_academias_vistas();
  ```

  PostgreSQL no comprueba `EXECUTE` al disparar (solo al crear el disparador), así que la app la ejecuta sin tenerlo, y
  la comprobación del rol (criterio 130) no la ve (si al escribir la prueba resultara que sí lo exige, el test-writer se
  detiene e informa antes de conceder nada a la app). Las claves cumplen el `CHECK` de `configuraciones`
  (`^[a-z][a-z0-9_]{0,63}$`).
- La consulta del disparador no tiene parámetros, así que plpgsql usa un plan genérico desde la primera ejecución; si
  tuviera parámetros, lo elige desde la 6.ª. Las 12 ejecuciones alternadas cubren los dos casos.
- La API de pruebas: una nueva, con `DATABASE_POOL_MAX=1`; `conAcademia` desde `app.get(BaseDatos)`, con
  `tx.cliente.$queryRaw` para el `INSERT … RETURNING valor`. Restauración en `finally`: `DROP TRIGGER`, `DROP FUNCTION` y
  borrar las filas `prueba_r9_%` como dueño con el contexto de cada academia (en la nube, el dueño pasa por RLS).
- Las pruebas de integración del backend corren en serie (`fileParallelism: false`), pero las de los scripts pueden correr
  a la vez: por eso la función va con `EXECUTE` revocado (un `db:crear` de otra prueba no la cuenta) y el disparador solo
  actúa sobre las claves `prueba_r9_`.
- Autocomprobación: en la transacción del dueño, la detección de "dueño superusuario o con `BYPASSRLS`" se hace con
  `SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user`. `SET LOCAL ROLE` exige ser
  miembro del rol o superusuario: en Docker y la CI el dueño es superusuario.

**Primera sentencia (criterios 146 y 147).** En `#transaccion` de `base-datos.ts` (y en la comprobación del rol, que usa
la misma) y en `enPlataforma` de `cli/conexion.ts`, se agregan a la sentencia actual:

```sql
pg_catalog.set_config('client_encoding', 'UTF8', true),
pg_catalog.set_config('synchronous_commit', 'on', true),
pg_catalog.set_config('array_nulls', 'on', true),
pg_catalog.set_config('transform_null_equals', 'off', true)
```

- `client_encoding` cambia la conversión desde el mensaje siguiente; la propia primera sentencia es ASCII. Al terminar la
  transacción, la sesión vuelve al valor anterior y PostgreSQL envía un `ParameterStatus`; `pg` no cambia su
  decodificación por eso (siempre UTF-8), y la transacción siguiente lo fija otra vez antes de enviar texto. Si
  PostgreSQL 16 o el adaptador rechazaran el cambio local de `client_encoding`, el backend se detiene e informa.
- `synchronous_commit` se puede fijar por transacción (es su uso normal); vale para la confirmación de esa transacción.
- Regla de lint de `cli/` (`eslint/regla-sql-sesion.mjs` o donde estén las llamadas admitidas de los criterios 98, 107,
  121 y 122): agregar los cuatro pares nombre/valor a la lista cerrada, con la misma comparación (nombre sin distinguir
  mayúsculas, valor exacto, tercer argumento `true`, con o sin `pg_catalog.`).
- Actualizar el comentario de `enPlataforma` y el de `#transaccion` con los parámetros nuevos.

**`DATABASE_URL_APP` sobre la base de desarrollo (criterio 148).**

- `diferenciasConDesarrollo(app, desarrollo)` en `scripts/lib/entorno.mjs` (P-35): tres comparaciones, sin dependencias.
- `crearBases`: después de las dos comprobaciones del usuario y de la validación de nombres de base, antes de
  `new pg.Client`. Mensaje orientativo: "DATABASE_URL_APP debe apuntar al mismo servidor, puerto y base que DATABASE_URL
  (difieren: base). Corrige DATABASE_URL_APP en el .env: la API usaría otra base que la que revisa db:crear."
- Hook: extraer de la rama 3b a la función exportada `leerUrlAppParaRol(entorno, desarrollo)` (P-35; nombre fijo por
  decisión del orquestador tras T107, 12/11/2026; `desarrollo = leerConexion(...).desarrollo`) la lectura de `DATABASE_URL_APP`, las dos comprobaciones del
  usuario y la nueva; la rama la llama dentro de su `try` y, con error, `mal('Rol de la aplicación', …)` como hoy.
- `.env.example`: el comentario de `POSTGRES_PUERTO` pasa a decir "cambia también el puerto en DATABASE_URL,
  DATABASE_URL_PRUEBAS y DATABASE_URL_APP". `env:completar` no cambia los `.env` existentes; la guía local (T24) lo
  menciona.

### 22. Correcciones del ataque, ronda 10 (criterios 149 a 152)

La ronda 10 encontró una falla alta: si una sentencia falla dentro de `trabajo` y `trabajo` atrapa el error, PostgreSQL deja
la transacción abortada, el `COMMIT` de Prisma recibe la etiqueta `ROLLBACK` sin error, y `conAcademia`, `comoPlataforma` y
`enPlataforma` devolvían el valor de `trabajo` como si todo se hubiera guardado. Lo que corrige: 149 a 151 agregan una
comprobación al final de cada transacción; 152 normaliza la IP de la auditoría. No hay migraciones nuevas. El código de
producción que cambia: `base-datos.ts`, `envoltorio.ts`, `errores.ts` e `index.ts` de `infraestructura/prisma/`,
`cli/conexion.ts`, y `insercion.ts` e `index.ts` de `modulos/auditoria/` más el archivo nuevo de la IP.

**Marca de la transacción (criterio 151).** La primera sentencia (`#fijarContexto` en `base-datos.ts` y la de
`enPlataforma`) agrega `pg_catalog.set_config('app.transaccion', ${marca}, true)`, con `marca = randomUUID()` de
`node:crypto` por transacción (texto ASCII, como pide el criterio 146). `#fijarContexto` recibe la marca en `contexto`;
`#comprobarRol` también la fija (no hace falta que la compruebe: su trabajo no atrapa errores).

**Comprobación (criterios 149 y 150).** Orientativo, en `#transaccion`:

```ts
return this.#prisma.$transaction(async (tx) => {
  const marca = randomUUID();
  await this.#fijarContexto(tx, { ...contexto, marca });
  const { cliente, terminar, ejecutar, asentar } = envolver(tx);
  let resultado: T;
  try {
    resultado = await ejecutar(() => trabajo(cliente));
  } finally {
    terminar();
  }
  await asentar();                      // solo en el camino bueno: espera las consultas enviadas sin await
  await comprobarTransaccionViva(tx, marca);
  return resultado;
}, { … });
```

- `comprobarTransaccionViva(tx, marca)` (interna de `infraestructura/prisma/`, la usan `base-datos.ts` y `cli/conexion.ts`;
  se puede exportar desde el `index` o desde un archivo que `cli/` importe): ejecuta
  `` SELECT pg_catalog.current_setting('app.transaccion', true) AS marca `` con el cliente crudo de la transacción (no con
  el envoltorio, que ya está apagado). Si la consulta rechaza con `codigoDeErrorDeBase(error) === '25P02'`, lanza
  `new ErrorTransaccionAbortada({ cause: error })`; si rechaza con otro error (conexión perdida, tiempo agotado), lo
  relanza tal cual; si la marca leída no es exactamente `marca` (nula, vacía u otra), lanza `ErrorTransaccionAbortada`. Al
  lanzar dentro del callback, Prisma envía `ROLLBACK` (sobre una transacción ya cerrada, PostgreSQL solo avisa) y
  `$transaction` rechaza con ese error.
- La comprobación va **fuera** de `ejecutar` y después de `terminar()`: no pasa por el envoltorio, así que la prueba de
  P-26 ("una llamada después de terminar no envía nada") sigue valiendo para el envoltorio.
- Si `trabajo` lanza, no se ejecuta ni `asentar` ni la comprobación: el error sale tal cual (criterio 22).
- Un error en el `COMMIT` mismo (serialización, restricción diferida) lo sigue lanzando Prisma, como hoy.
- Registro técnico: `BaseDatos` registra con `this.registro.error` (o `warn`) un mensaje fijo, por ejemplo "La transacción
  quedó abortada por un error de la base que el trabajo atrapó y no propagó; no se confirmó nada.", más el SQLSTATE de
  `cause` si lo hay; nunca el mensaje completo del error de Prisma (puede llevar valores) ni la URL.

**`asentar` en el envoltorio (criterio 149).** `envolver(tx)` agrega a lo que devuelve (interno, orientativo)
`asentar(): Promise<void>`. `enviar` guarda cada promesa interna en un `Set` privado y la quita al asentarse; `asentar`
espera `Promise.allSettled` de las que haya (como `terminar()` ya corrió, no entran nuevas). Notas:

- Lo que se guarda es una promesa derivada (`p.then(nada, nada)`) o la propia promesa interna, nunca la que se devuelve
  a `trabajo`: la promesa devuelta sigue sin claves propias (criterio 106).
- Al quedar manejada por el seguimiento, una consulta sin `await` que falla ya no produce un `unhandledRejection` en el
  proceso (hoy podría terminarlo); el fallo se informa por el rechazo de la transacción, que es más útil.
- Si una consulta enviada sin `await` tarda más que `DURACION_MAXIMA_MS`, Prisma corta la transacción por tiempo y
  rechaza, como hoy.

**`enPlataforma` (criterio 150).** La misma marca en su primera sentencia y, después de `trabajo`, ceder un turno
(`await new Promise((r) => setImmediate(r))`) para que las consultas enviadas sin `await` lleguen a la cola de la conexión,
y `comprobarTransaccionViva(tx, marca)`. No se envuelve `tx` (P-24): el riesgo que queda está en "Riesgos aceptados"
("Consulta de un modelo sin `await` en `enPlataforma`"). `ErrorTransaccionAbortada` se importa de
`../infraestructura/prisma` (como `cerrarCursores`). El comando y la semilla ya terminan con código 1 ante un error de
`enPlataforma`; no cambian.

**Lint.** En `cli/`, `pg_catalog.set_config('app.transaccion', ${marca}, true)` ya pasa la regla del criterio 83 (primer
argumento literal `app.…`, tercero `true`). `infraestructura/prisma/` está fuera de esas reglas. Si alguna prueba de lint
protegida dijera lo contrario, el backend se detiene e informa.

**IP de la auditoría (criterio 152).** `backend/src/modulos/auditoria/ip.ts` (orientativo):

```ts
import { isIP, isIPv6 } from 'node:net';
export function ipParaAuditoria(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  const corte = ip.indexOf('%');
  const sinZona = corte === -1 ? ip : ip.slice(0, corte);
  const valida = corte === -1 ? isIP(sinZona) !== 0 : isIPv6(sinZona);
  if (!valida) throw new Error('La IP de la petición no es válida para la auditoría.');
  return sinZona;
}
```

`isIP` rechaza los espacios alrededor y el texto vacío. `insertarEnAuditoriaDeAcademia` e `insertarEnAuditoriaPlataforma`
pasan `ipParaAuditoria(entrada.ip)` en lugar de `entrada.ip ?? null`; la conversión ocurre antes de enviar el `INSERT`, así
que el error sale de `trabajo` y la transacción se revierte (criterio 30). El `index` de `auditoria` la exporta. `node:net`
es un módulo de Node y no cuenta para las listas de dependencias (criterios 127 a 129).

**Notas para las historias siguientes (sin criterio propio; ataque ronda 10).**

- **O3 (ampliada). Duplicados esperados dentro de una transacción.** Atrapar un error de la base dentro de `trabajo` y
  seguir no es posible: PostgreSQL deja la transacción abortada, y desde el criterio 149 la operación se rechaza con
  `ErrorTransaccionAbortada`. Un duplicado que se espera (clave de idempotencia de un cobro, una verificación o una
  asistencia; un nombre corto en uso) se resuelve con `INSERT … ON CONFLICT (…) DO NOTHING RETURNING …` y se mira si
  volvió una fila, como `AcademiasService.crear`; para devolver el resultado del primer intento, se lee la fila existente
  en la misma transacción (`SELECT … WHERE academia_id = … AND clave = …`). `esViolacionDeUnicidad` sirve **fuera** de
  la transacción, sobre el rechazo de `conAcademia` o `comoPlataforma`, para responder 409 o reintentar con una
  transacción nueva. Lo mismo para cualquier otro error de la base: o se evita con la forma de la sentencia, o se deja
  salir de `trabajo`.
- **O1. Fecha de negocio en SQL.** La sesión de la API, de los comandos y de la semilla está en UTC (criterio 98).
  `now()` y los `timestamptz` son instantes correctos, pero `CURRENT_DATE`, `now()::date`, `date_trunc('day', now())`,
  `LOCALTIME` o `extract(hour from now())` dan el día y la hora de UTC: después de las 19:00 de Lima ya es el día
  siguiente, y el último día del mes después de las 19:00 ya es el mes siguiente. En las historias de asistencia, caja y
  mensualidades, la fecha de negocio se calcula en el código con `@date-fns/tz` en `America/Lima` a partir de
  `RELOJ.ahora()` y se pasa como parámetro (`${fecha}::date`), o, si tiene que ser en SQL, con
  `(… AT TIME ZONE 'America/Lima')`. El revisor y el adversarial lo buscan. Texto propuesto para `docs/arquitectura.md`
  (lo agrega el documentador en el cierre, T24), como sección nueva después de "Varias academias":

  > ## Fechas y horas de negocio (America/Lima)
  >
  > - Las fechas y horas de negocio (el día de una asistencia o de una caja, el mes de una mensualidad, un vencimiento,
  >   si una clase ya empezó) se deciden en la zona America/Lima (RNF-12), nunca en la del servidor.
  > - La conexión de la API con PostgreSQL trabaja en UTC (spec 001, criterio 98). Los instantes (`now()`, columnas
  >   `timestamptz`) son correctos, pero `CURRENT_DATE`, `now()::date`, `date_trunc('day', now())` y `LOCALTIME` dan el
  >   día y la hora de UTC: desde las 19:00 de Lima ya es el día siguiente.
  > - Por eso la fecha de negocio se calcula en el código, con `@date-fns/tz` en `America/Lima` a partir de la hora del
  >   reloj inyectable (`RELOJ`), y se pasa a la consulta como parámetro. Si tiene que calcularse en SQL, se escribe la
  >   zona: `(now() AT TIME ZONE 'America/Lima')::date`.
  > - Las pruebas de estos cálculos fijan la hora con `RELOJ` en los bordes: 18:59 y 19:00 de Lima, fin de mes y la
  >   clase de 19:00 a 20:00.

### 23. Correcciones del ataque, ronda 11 (criterios 153 a 155)

La ronda 11 encontró una falla alta: dentro de una transacción interactiva, Prisma 7.10.1 agrupa en un lote las consultas
enviadas en el mismo turno y, ante el primer error que no es de la base (P2025, columna `void`), deja de ejecutar las
siguientes, cuyas promesas resuelven con `undefined`; la transacción sigue viva y se confirmaba sin esas escrituras. Lo que
corrige: 153 pone una cola serial en el envoltorio; 154 agrega una segunda capa que convierte un `undefined` en
`ErrorTransaccionAbortada`; 155 fija la forma de tomar el bloqueo de transacción (O1). La O2 va a riesgos aceptados. No hay
migraciones nuevas. El código de producción que cambia: `envoltorio.ts`, `base-datos.ts` y `errores.ts` de
`infraestructura/prisma/`, y el comentario de `enPlataforma` en `cli/conexion.ts`.

**Cola serial (criterio 153).** En `envolver(tx)`, `enviarSeguida` deja de entregar la consulta en el acto: la encadena
detrás de la última pendiente. Orientativo:

```ts
const pendientes = new Set<Promise<void>>();
let ultima: Promise<void> | null = null;   // asentamiento de la última consulta encolada
let descartada = false;
let incompleta: string | null = null;       // nombre de la primera operación que volvió con undefined (criterio 154)

const enviarSeguida = <T>(crear: () => PromiseLike<T>, operacion: string): Promise<T> => {
  const anterior = ultima;
  const promesa = new Promise<T>((resolver, rechazar) => {
    const entregar = (): void => {
      if (descartada) { rechazar(new Error('La transacción ya terminó.')); return; }
      try {
        crear().then((valor) => {
          if (valor === undefined) {
            incompleta ??= operacion;
            rechazar(new ErrorTransaccionAbortada({ motivo: 'incompleta' }));
            return;
          }
          resolver(valor);
        }, rechazar);
      } catch (error) { rechazar(error); }
    };
    if (anterior === null) entregar();       // cola vacía: se entrega durante la llamada (criterio 106)
    else void anterior.then(entregar);       // si no, en cuanto se asienta la anterior
  });
  const asentada: Promise<void> = promesa.then(nada, nada).then(() => {
    pendientes.delete(asentada);
    if (ultima === asentada) ultima = null;
  });
  pendientes.add(asentada);
  ultima = asentada;
  return promesa;
};
```

- `crear` es la función que hoy se pasa directa (`() => tx[metodo](primero, ...convertidos)` o
  `() => funcion.apply(real, argumentos)`). Las comprobaciones de la llamada (`exigirActiva`, la forma de los argumentos,
  que la operación exista) siguen antes de encolar, dentro de `siempreUnaPromesa`: una llamada rechazada no toca `ultima`.
  Los valores de los fragmentos (`aSql`) se convierten al llamar, como hoy.
- Lo que recibe `trabajo` sigue pasando por `siempreUnaPromesa` y `sinMarcasDeContexto` (criterio 106): promesa nativa
  sin claves propias. `asentada` se guarda solo en el conjunto (criterio 149).
- `entregar` corre en la continuación de la anterior, fuera del contexto de `ejecutar`; no importa, porque el contexto se
  comprobó al llamar (criterio 134) y la consulta va por `tx`, que ya está atada a la transacción.
- No hay espera circular: la cola solo espera el asentamiento interno de la consulta anterior, que no depende de código de
  `trabajo`. Si una consulta no termina, Prisma corta la transacción por `DURACION_MAXIMA_MS` y las que siguen en la cola
  rechazan con el error de Prisma (transacción cerrada), sin llegar a la base.
- `asentar()` no cambia: como cada consulta encolada ya está en `pendientes`, espera también la cola.
- `descartar()` (P-38): pone `descartada = true`. `#transaccion` la llama en el camino del error, junto con `terminar()`:

  ```ts
  try {
    resultado = await ejecutar(() => trabajo(cliente));
  } catch (error) {
    descartar();
    throw error;
  } finally {
    terminar();
  }
  await asentar();
  try {
    exigirCompleta();                       // criterio 154
    await comprobarTransaccionViva(tx, marca);
  } catch (error) {
    if (error instanceof ErrorTransaccionAbortada) this.#registrarAbortada(error);
    throw error;
  }
  return resultado;
  ```

  Las consultas descartadas rechazan; como su promesa interna ya tiene el manejador de `asentada`, no producen
  `unhandledRejection`.

**Segunda capa (criterio 154).** `exigirCompleta()` lanza `new ErrorTransaccionAbortada({ motivo: 'incompleta', cause })`
si `incompleta !== null`, con `cause` un `Error` cuyo mensaje es "Operación sin resultado: " más el nombre guardado (solo el
nombre de la operación, `modelo.operacion` o `$queryRaw`/`$executeRaw`; nunca argumentos). `#registrarAbortada` registra el mensaje del error y,
para el motivo `incompleta`, el nombre de la operación en lugar del SQLSTATE. Ninguna de las operaciones expuestas (la lista
`OPERACIONES`, `$queryRaw`, `$executeRaw`) devuelve `undefined` en Prisma 7; si una historia agrega una operación que sí
pudiera devolverlo, se revisa esta regla.

**`ErrorTransaccionAbortada` (ampliación de P-36).** En `errores.ts`, el constructor toma `motivo` (por defecto
`'abortada'`) y elige el mensaje: el de hoy, o "Una consulta de la transacción no llegó a ejecutarse; no se confirmó
nada." para `'incompleta'`. Sigue siendo 500 `ERROR_INTERNO`.

**`enPlataforma` no se envuelve (riesgo aceptado).** Motivo: P-24 y las pruebas protegidas de los comandos dependen de la
transacción completa de Prisma y de la `PrismaPromise` perezosa (`Prisma.raw`, `Prisma.sql`, una consulta sin `then` que no
se envía); una cola sobre ella exigiría un `Proxy` del cliente (descartado en la ronda 3) o reescribir los comandos sobre
`ClienteTransaccion`. El backend agrega al comentario de `enPlataforma` la regla: **en comandos y en la semilla no se
lanzan consultas en paralelo dentro de `enPlataforma`** (nada de `Promise.all`, `Promise.allSettled` ni `map` con
funciones `async` sobre `tx`); se encadenan con `await`. Hoy `superadmin.ts` y `seed.ts` cumplen.

**Notas para las historias siguientes (sin criterio propio salvo el 155; ataque ronda 11).**

- **O1. Bloqueos de transacción en el aforo y la caja.** `pg_advisory_xact_lock` devuelve `void`, y `$queryRaw` falla al
  leer esa columna (la sentencia ya se ejecutó en PostgreSQL y el bloqueo quedó tomado, pero la consulta rechaza). Se usa:

  ```ts
  await tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)`;
  // o, si hace falta $queryRaw:
  await tx.cliente.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)::text AS tomado`;
  // la variante que no espera devuelve boolean y sirve con $queryRaw:
  const [{ tomado }] = await tx.cliente.$queryRaw<{ tomado: boolean }[]>`
    SELECT pg_catalog.pg_try_advisory_xact_lock(${clave}::bigint) AS tomado`;
  ```

  La clave sale de la academia y del recurso (por ejemplo, del id del horario o de la caja) y la decide la historia; el
  bloqueo se libera solo al terminar la transacción. Los bloqueos de sesión siguen prohibidos por el lint (criterio 94).
  Además, con la cola del criterio 153, el bloqueo se toma antes que las consultas que se llamen después.
- **Consultas a la vez dentro de `trabajo`.** Siguen permitidas en la API (`conAcademia`, `comoPlataforma`): corren en
  serie y cada una recibe lo suyo. Un P2025 atrapado por consulta es válido (no aborta la transacción); un error de la base
  atrapado no (criterio 149). No se cambian los argumentos de una consulta después de llamarla.

Texto propuesto para `docs/arquitectura.md` (lo agrega el documentador en el cierre, T24), al final de la sección "Varias
academias" o en una nueva "Transacciones":

> - Dentro de una transacción de la API, las consultas que se lanzan a la vez (`Promise.all`) se ejecutan de una en una y
>   cada una recibe su propio resultado o error (spec 001, criterio 153). En los comandos y en la semilla
>   (`enPlataforma`) no se lanzan consultas a la vez: se encadenan con `await`.
> - Un error de la base atrapado dentro de la transacción la deja abortada y la operación falla (criterio 149); los
>   duplicados esperados van con `ON CONFLICT DO NOTHING RETURNING`.
> - Los bloqueos de transacción (`pg_advisory_xact_lock`) se toman con `$executeRaw` (criterio 155).

### 24. Correcciones del ataque, ronda 12 (criterios 156 a 158)

La ronda 12 encontró una falla alta (F1: la segunda consulta de una cadena sin `await` llegaba con el envoltorio apagado,
se rechazaba sin enviarse y la operación confirmaba sin ella) y una media (F2: una escritura con relaciones anidadas que
falla a medio camino deja escrita una parte que se confirma si `trabajo` atrapa el error). Lo que corrige: 156 mantiene
el envoltorio abierto mientras `asentar` espera y marca las llamadas tardías; 157 registra los rechazos sin manejar sin
terminar la API; 158 pone cada escritura de un delegado dentro de un punto de guardado. No hay migraciones nuevas. El
código de producción que cambia: `envoltorio.ts` y `base-datos.ts` de `infraestructura/prisma/`, el archivo nuevo
`puntos-de-guardado.ts` en esa carpeta, el archivo nuevo `infraestructura/proceso/rechazos.ts` y `main.ts`.

**Envoltorio abierto durante `asentar` (criterio 156).** En `envolver(tx)` (orientativo):

```ts
let cerrando = false;                       // desde que se llama a asentar(): las llamadas rechazadas marcan
const marcarTardia = (operacion: string): void => {
  if (cerrando) incompleta ??= `${operacion} (llegó después de que el envoltorio se apagó)`;
};
const exigirActiva = (operacion: string): void => {
  if (!activa) { marcarTardia(operacion); throw new Error('La transacción ya terminó.'); }
  if (almacen.getStore() !== marca) { marcarTardia(operacion); throw new Error('Esta transacción pertenece a otra operación: …'); }
};
// …
asentar: async (): Promise<void> => {
  cerrando = true;
  for (;;) {
    while (pendientes.size > 0) await Promise.allSettled([...pendientes]);
    await new Promise<void>((seguir) => setImmediate(seguir)); // deja correr las continuaciones encadenadas
    if (pendientes.size === 0) { activa = false; return; }    // mismo paso síncrono: no entra nada entre medio
  }
},
```

- `exigirActiva` recibe el nombre de la operación (`$queryRaw`, `$executeRaw` o `modelo.operacion`), que `crudo` y los
  delegados ya conocen. Los mensajes de los dos errores no cambian.
- `exigirCompleta()` usa la misma `incompleta` (criterio 154), así que una llamada tardía lanza `ErrorTransaccionAbortada`
  con motivo `incompleta` y la causa "Operación sin resultado: …" o el texto de la llamada tardía (solo el nombre de la
  operación; nunca argumentos). `#registrarAbortada` no cambia.
- `setImmediate` es global en Node; corre fuera del contexto de `ejecutar`, que da igual (la cola ya comprobó el contexto
  al llamar).
- En `#transaccion` de `base-datos.ts` (orientativo):

  ```ts
  const capa = conPuntosDeGuardado(tx);                                  // criterio 158
  const { cliente, terminar, ejecutar, asentar, descartar, exigirCompleta } = envolver(capa.tx);
  let resultado: T;
  try {
    resultado = await ejecutar(() => trabajo(cliente));
  } catch (error) {
    descartar();
    terminar();                                                          // camino del error: apagado en el acto
    throw error;
  }
  try {
    await asentar();                                                     // acepta las encadenadas; al final apaga
    const revisar = (): void => { exigirCompleta(); capa.exigirSana(); };
    try {
      revisar();
      await comprobarTransaccionViva(tx, marca);                         // con el tx crudo, como hoy
      revisar();                                                         // llamadas tardías durante la comprobación
    } catch (error) {
      if (error instanceof ErrorTransaccionAbortada) this.#registrarAbortada(error);
      throw error;
    }
    return resultado;
  } finally {
    terminar();                                                          // por si algo lanzó antes de que asentar apagara
  }
  ```

  `comprobarTransaccionViva` sigue usando el `tx` crudo (no la capa ni el envoltorio).
- Lo que llega después de que `#transaccion` devolvió (mientras Prisma envía el `COMMIT` o después) rechaza sin enviarse
  y ya no cambia el resultado: riesgo aceptado "Continuación sin `await` que espera algo ajeno a la base".

**Manejador de rechazos (criterio 157).** `backend/src/infraestructura/proceso/rechazos.ts` (P-40), sin dependencias:

```ts
export function crearManejadorDeRechazos(registro: { error(datos: object, mensaje: string): void }) {
  return (motivo: unknown): void => {
    const datos = motivo instanceof Error ? { err: motivo } : { tipo: typeof motivo };
    registro.error(datos, 'Promesa rechazada sin manejar; el proceso sigue atendiendo.');
  };
}
```

En `main.ts`, después de `await app.listen(entorno.PUERTO_API)`: obtener el registro de pino de la app (el `Logger` de
`nestjs-pino` que `crearApp` ya usa con `app.get(Logger)`, o un `PinoLogger` resuelto del contenedor; el backend elige el
que acepte `(objeto, mensaje)` y lo adapta si hace falta) y `process.on('unhandledRejection', crearManejadorDeRechazos(…))`.
Sin `uncaughtException`. `void arrancar()` no cambia: un fallo antes de `listen` sigue siendo un rechazo sin manejar
cuando todavía no hay manejador, y Node termina el proceso como hoy. _(Cambiado tras la ronda 13, criterio 159: `void`
deja de pasar el lint; `main.ts` usa `arrancar().catch(…)` con `process.exit(1)`, sección 25.)_ El manejador vale para todo el proceso (también
para tareas programadas de historias siguientes), no para las pruebas (no cargan `main.ts`).

**Capa de puntos de guardado (criterio 158).** `backend/src/infraestructura/prisma/puntos-de-guardado.ts` (P-39),
orientativo:

```ts
const ESCRITURAS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
  'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);

export function conPuntosDeGuardado(tx: Prisma.TransactionClient) {
  const nombre = `aq_${randomUUID().replaceAll('-', '')}`;
  if (!/^aq_[0-9a-f]{32}$/.test(nombre)) throw new Error('Nombre de punto de guardado inválido.');
  const punto = Prisma.raw(nombre);                     // identificador, no parámetro; generado aquí y validado
  let fallo: unknown = null;                            // primera causa para exigirSana()
  const marcar = (causa: unknown): void => { fallo ??= causa ?? new Error('Punto de guardado'); };

  const conPunto = (escribir: () => PromiseLike<unknown>) => async (): Promise<unknown> => {
    try {
      await tx.$executeRaw`SAVEPOINT ${punto}`;
    } catch (error) {
      marcar(error);
      throw error;                                      // abortada de antes: 25P02, sin entregar la escritura
    }
    let valor: unknown;
    try {
      valor = await escribir();
    } catch (errorDeEscritura) {
      let abortada = false;
      try {
        await tx.$queryRaw`SELECT 1 AS sana`;           // comprobación del estado
      } catch (errorDeComprobacion) {
        abortada = true;
        marcar(codigoDeErrorDeBase(errorDeComprobacion) === '25P02' ? errorDeEscritura : errorDeComprobacion);
      }
      if (!abortada) {
        try {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT ${punto}`;
          await tx.$executeRaw`RELEASE SAVEPOINT ${punto}`;
        } catch (error) { marcar(error); }
      }
      throw errorDeEscritura;                           // el mismo error que hoy
    }
    try {
      await tx.$executeRaw`RELEASE SAVEPOINT ${punto}`;
    } catch (error) { marcar(error); throw error; }
    return valor;
  };
  // tx de la capa: $queryRaw y $executeRaw tal cual (atados a tx); por cada modelo, las operaciones de lectura tal cual y
  // las de ESCRITURAS como (...args) => ({ then: (ok, mal) => conPunto(() => real[op](...args))().then(ok, mal) })
  return { tx: capa, exigirSana: () => { if (fallo !== null) throw new ErrorTransaccionAbortada({ cause: fallo }); } };
}
```

- **Mismo turno de la cola:** el envoltorio llama al `then` del objeto de la capa al entregar (criterio 153) y la promesa
  que recibe se asienta solo cuando termina toda la secuencia; la consulta siguiente de la cola espera a la liberación o
  a la vuelta al punto. Nunca hay dos sentencias pendientes a la vez en la transacción.
- **Misma conexión y orden:** todas las sentencias van por el mismo `tx` de Prisma y cada una espera a la anterior.
- **El objeto con `then`** no es una `PrismaPromise` ni la expone; nunca llega a `trabajo` (el envoltorio la convierte en
  promesa nativa, criterio 106). La escritura real (`real[op](...args)`) se crea dentro de `conPunto`, después del
  `SAVEPOINT`: la `PrismaPromise` es perezosa y no sale antes. Los argumentos se pasan tal cual (riesgo aceptado
  "Argumentos que `trabajo` cambia después de llamar").
- **Formas de las lecturas y del crudo:** `capa.$queryRaw = (...a) => tx.$queryRaw(...a)` (igual `$executeRaw`) y, para
  las lecturas, `(...a) => real[op](...a)`, de modo que el envoltorio recibe la `PrismaPromise` como hoy (P-38: la
  unitaria del envoltorio no usa la capa).
- **`Prisma.raw` aquí:** el nombre lo genera la capa y se valida con la expresión antes de usarlo; nunca sale de una
  entrada. `infraestructura/prisma/` es la carpeta autorizada (criterios 113 y 114 no aplican aquí). Si el backend
  prefiere no usar `Prisma.raw`, puede usar `$executeRawUnsafe` con el mismo nombre validado; las dos formas son
  equivalentes para las pruebas.
- **Por qué la comprobación antes de volver al punto:** `ROLLBACK TO SAVEPOINT` también saca a la transacción del estado
  abortado; si se ejecutara tras un error de la base, la transacción seguiría como si nada y el criterio 149 dejaría de
  ver el error atrapado. Con la comprobación, un error de la base deja la transacción como hoy.
- **Tiempo agotado:** si Prisma cerró la transacción, las sentencias de la capa rechazan por la transacción cerrada; la
  capa marca y la operación ya está fallando.
- **`exigirSana` y `ErrorTransaccionAbortada`:** motivo `abortada` (por defecto); `#registrarAbortada` registra el SQLSTATE
  de la causa si lo hay, como hoy.
- **Lint:** `SAVEPOINT`, `RELEASE` y `ROLLBACK TO` están en `infraestructura/prisma/`, fuera de la regla del criterio 84.
  Si alguna regla protegida lo prohibiera también ahí, el backend se detiene e informa.

**Revisión de 001 (T136).** Se espera que ningún servicio de 001 use cadenas sin `await` dentro de `trabajo`, escrituras
con relaciones anidadas ni actualice `academias` desde `conAcademia`; si el backend encuentra alguna, la pasa a `await`
paso a paso o a una escritura simple desde `comoPlataforma`.

**Notas para las historias siguientes (sin criterio propio; ataque ronda 12).**

- **O1. No actualizar `academias` desde `conAcademia`.** La política de `UPDATE` de `academias` es solo de plataforma:
  desde una academia, `UPDATE academias …` toca 0 filas sin error, y una escritura anidada sobre la relación `academia`
  (por ejemplo, `configuracion.update({ data: { academia: { update: … } } })`) puede no hacer nada sin que Prisma lo
  compruebe. Los cambios de la academia (estado, y desde 003 los de su configuración visible) se hacen desde
  `comoPlataforma` o desde las tablas propias de la academia, nunca con una escritura anidada hacia `academias`.
- **O2. La cola quita el agrupado de `findUnique`.** Prisma agrupa en una sola consulta los `findUnique` lanzados en el
  mismo turno; con la cola serial (criterio 153) cada uno va por separado. Para leer una lista por id se usa
  `findMany({ where: { id: { in: ids } } })` (con `academiaId` en el `where` cuando la llave es compuesta), no
  `Promise.all(ids.map((id) => findUnique(…)))`.
- **Cadenas sin `await`.** Dentro de `trabajo`, cada paso se espera con `await`. Una cadena sin `await` que solo espera
  consultas de la transacción se completa (criterio 156), pero una que espera algo ajeno puede perder su escritura
  (riesgo aceptado).

Texto propuesto para `docs/arquitectura.md` (lo agrega el documentador en el cierre, T24), a continuación de las viñetas
de la ronda 11:

> - Dentro de una transacción, cada paso se espera con `await`; no se dejan cadenas sueltas con `.then` ni `void` (spec
>   001, criterio 156).
> - Una escritura de un modelo que falla (por ejemplo, con P2025) no deja nada escrito, aunque tenga relaciones anidadas
>   (criterio 158); se puede atrapar y seguir. Un error de la base, en cambio, hace fallar la operación (criterio 149).
> - Desde una academia no se actualiza la tabla `academias`; para leer varias filas por id se usa `findMany` con `in`.

### 25. Correcciones del ataque, ronda 13 (criterios 159 a 162)

La ronda 13 encontró una falla alta (F1: una función `async` lanzada con `void` cuya consulta falla con un P2025 después
de que `trabajo` terminó; nada marca la transacción y se confirma lo anterior sin la auditoría; variante: la función falla
fuera del envoltorio), una media (F2: la causa de `ErrorTransaccionAbortada` lleva el error de Prisma con los valores) y
dos observaciones (O1: los registros técnicos copian mensajes de Prisma con datos; O2: desborde de la caché de
subtransacciones). Lo que corrige: 159 prohíbe las promesas descartadas por lint; 160 hace fallar la transacción ante
todo rechazo de una operación del envoltorio desde `asentar()`; 161 limpia la causa en el constructor; 162 limpia todo
registro técnico de un error de la base. No hay migraciones nuevas.

Código de producción que cambia: `eslint.config.mjs`, `eslint.protegido.config.mjs` y el archivo nuevo
`eslint/regla-promesas-descartadas.mjs`; `backend/src/main.ts`; en `infraestructura/prisma/`, `envoltorio.ts`,
`errores.ts`, `base-datos.ts` (`#registrarAbortada`), `index.ts` y el archivo nuevo `registro-de-errores.ts`;
`comun/filtros/filtro-errores.ts`; `infraestructura/proceso/rechazos.ts`; y `cli/mensaje-seguro.ts`.
`puntos-de-guardado.ts`, `transaccion-viva.ts` y `cli/conexion.ts` no cambian: la causa se limpia en el constructor.

**Regla de lint (criterio 159, P-41).** `eslint/regla-promesas-descartadas.mjs` (orientativo):

```js
import { ARCHIVOS_DE_CODIGO, EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS } from './archivos-de-codigo.mjs';

const esAsyncEnElLugar = (nodo) =>
  (nodo.type === 'ArrowFunctionExpression' || nodo.type === 'FunctionExpression') && nodo.async === true;

const sinPromesasDescartadas = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      void: 'No descartes promesas con void en backend/src: usa await o atrapa el rechazo con .catch (spec 001, criterio 159).',
      enElLugar: 'Una función async escrita en el lugar se espera con await o se atrapa con .catch (spec 001, criterio 159).',
    },
  },
  create: (context) => ({
    UnaryExpression(nodo) {
      if (nodo.operator !== 'void') return;
      if (nodo.argument.type === 'Literal' && nodo.argument.value === 0) return;
      context.report({ node: nodo, messageId: 'void' });
    },
    ExpressionStatement(nodo) {
      const expresion = nodo.expression.type === 'ChainExpression' ? nodo.expression.expression : nodo.expression;
      if (expresion.type === 'CallExpression' && esAsyncEnElLugar(expresion.callee)) {
        context.report({ node: nodo, messageId: 'enElLugar' });
      }
    },
  }),
};

export const pluginPromesas = { rules: { 'sin-promesas-descartadas': sinPromesasDescartadas } };

/** Los dos pasos (normal y protegido): sin información de tipos. */
export const configuracionPromesasDescartadas = {
  name: 'aquagestion/promesas-descartadas',
  files: ARCHIVOS_DE_CODIGO,
  ignores: [EXENCION_PRUEBAS, EXENCION_CLIENTE_GENERADO],
  plugins: { 'aquagestion-promesas': pluginPromesas },
  rules: { 'aquagestion-promesas/sin-promesas-descartadas': 'error' },
};

/** Solo el lint normal: con información de tipos (el bloque `aquagestion/typescript` ya activa el analizador con tipos). */
export const configuracionPromesasConTipos = {
  name: 'aquagestion/promesas-con-tipos',
  files: ['backend/src/**/*.{ts,tsx}'],
  ignores: [EXENCION_PRUEBAS, EXENCION_CLIENTE_GENERADO],
  rules: {
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false, ignoreIIFE: false, checkThenables: true }],
  },
};
```

- `eslint.config.mjs` agrega los dos bloques **después** de `aquagestion/typescript` (para que las opciones reemplacen las
  de `recommendedTypeChecked` en `backend/src`); `eslint.protegido.config.mjs` agrega solo
  `configuracionPromesasDescartadas`, después de `...configuracionSqlSesion`. El comentario de cabecera del paso protegido
  nombra también el criterio 159.
- La prueba protegida del criterio 96 compara las reglas activas del paso protegido con las de `js.configs.recommended` y
  `typescript-eslint`: la regla propia no está en esas listas, así que no la cambia. `no-floating-promises` no va al paso
  protegido por eso y porque exige tipos.
- `no-misused-promises` (ya activa por `recommendedTypeChecked`) sigue cubriendo una función `async` pasada donde se
  espera una que devuelve `void` (por ejemplo, `forEach(async …)`). _(Precisado tras la ronda 14, O2: no cubre
  `process.nextTick`, cuyo parámetro es `Function`; lo cubre la regla propia desde el criterio 164, sección 26.)_
- **Código actual que cambia para pasar:**
  - `backend/src/main.ts`:

    ```ts
    arrancar().catch((error: unknown) => {
      // Criterio 157: un fallo al arrancar sigue terminando el proceso con error (antes lo hacía Node con el rechazo sin manejar).
      console.error('No se pudo arrancar la API.', errorParaRegistro(error)); // criterio 162: un error de la base, limpio
      process.exit(1);
    });
    ```

    `errorParaRegistro` se importa del punto autorizado (`./infraestructura/prisma`). El manejador de
    `unhandledRejection` sigue registrándose después de `listen` y sin `uncaughtException`.
  - `envoltorio.ts`: `else void anterior.then(entregar);` pasa a `else anterior.then(entregar, nada);` (`anterior` es
    una promesa derivada que nunca rechaza; el segundo argumento la deja manejada para la regla).
- Si `checkThenables: true` o `ignoreVoid: false` señalan otro lugar, el backend lo corrige si es una promesa descartada
  de verdad; si es un falso positivo (un objeto con `then` que no es una promesa), se detiene e informa antes de apagar
  nada.

**Rechazo de una operación durante `asentar` (criterio 160).** En `envolver(tx)` (orientativo), la primera operación que
marca guarda su circunstancia y su error para la causa limpia:

```ts
let incompleta: { operacion: string; circunstancia: CircunstanciaDeLaCausa; error?: unknown } | null = null;
// criterio 154: valor === undefined → incompleta ??= { operacion, circunstancia: 'sin-resultado' }
// criterio 156: marcarTardia → incompleta ??= { operacion, circunstancia: 'llamada-tardia' } (solo si cerrando)
crear().then(
  (valor) => { /* como hoy (154) */ },
  (error: unknown) => {
    if (cerrando) {
      // Criterio 160: trabajo ya devolvió su valor; nadie puede decidir seguir. Marca y rechaza sin el error original.
      incompleta ??= { operacion, circunstancia: 'rechazo-tras-trabajo', error };
      rechazar(new ErrorTransaccionAbortada({
        motivo: 'incompleta',
        cause: causaLimpia(error, operacion, 'rechazo-tras-trabajo'),
      }));
      return;
    }
    rechazar(error); // mientras trabajo corre: su propio error, sin marcar (153, 154)
  },
);
// exigirCompleta: si incompleta !== null, lanza new ErrorTransaccionAbortada({ motivo: 'incompleta',
//   cause: causaLimpia(incompleta.error, incompleta.operacion, incompleta.circunstancia) })
```

- `cerrando` es el mismo indicador del criterio 156: lo pone `asentar()` al empezar. `#transaccion` llama a `asentar()`
  en el mismo paso en que recibe el valor de `trabajo` (`await ejecutar(…)` y enseguida `await asentar()`), así que no
  hay ventana: con la cola serial hay a lo sumo una consulta entregada y su rechazo llega desde la E/S, nunca entre esas
  dos líneas.
- El rechazo de la consulta de la capa ya incluye la vuelta al punto de guardado (criterio 158): cuando la promesa de la
  capa rechaza, la secuencia terminó; la marca solo cambia lo que recibe quien llamó y lo que decide `#transaccion`.
- Las llamadas rechazadas al llamar (`exigirActiva`, argumento no admitido, operación inexistente) no pasan por aquí y
  no cambian (criterio 156).
- `#registrarAbortada` (`base-datos.ts`) registra, para el motivo `incompleta`, `error.mensaje` y el mensaje de la causa
  limpia (que ya nombra la operación y la circunstancia, con los códigos); para `abortada`, el SQLSTATE de
  `codigoDeErrorDeBase(error.cause)`, como hoy.

**Causa limpia (criterio 161, precisión de P-36).** En `errores.ts`:

```ts
constructor(opciones?: { readonly motivo?: MotivoTransaccionAbortada; readonly cause?: unknown }) {
  // …
  if (opciones?.cause !== undefined) {
    this.cause = opciones.cause instanceof CausaLimpia ? opciones.cause : causaLimpia(opciones.cause);
  }
}
```

`errores.ts` importa `CausaLimpia` y `causaLimpia` de `registro-de-errores.ts`, que no importa `errores.ts` (sin ciclo).
La capa de puntos de guardado, `comprobarTransaccionViva` y `enPlataforma` siguen pasando el error que tienen; el
constructor lo limpia.

**Errores para el registro (criterio 162, P-42).** `backend/src/infraestructura/prisma/registro-de-errores.ts`
(orientativo):

```ts
import { Prisma } from '../../generated/prisma/client';
import { codigoDeErrorDeBase } from './errores-base';

const CLASES = [Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError, Prisma.PrismaClientInitializationError, Prisma.PrismaClientRustPanicError];
const NOMBRES = new Set(['PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientValidationError',
  'PrismaClientInitializationError', 'PrismaClientRustPanicError', 'DriverAdapterError', 'DatabaseError', 'CausaLimpia']);
const MODELOS = new Set<string>(Object.values(Prisma.ModelName));
const CODIGO_PRISMA = /^P\d{4}$/;
const CODIGO_DE_SISTEMA = /^E[A-Z0-9_]+$/;
const OPERACION = /^(\$queryRaw|\$executeRaw|[a-z][A-Za-z0-9]*\.[a-zA-Z]+)$/;

/** Lee una propiedad sin dejar que un getter lance. */
const leer = (valor: unknown, clave: string): unknown => { try { return (valor as Record<string, unknown>)?.[clave]; } catch { return undefined; } };

export class CausaLimpia extends Error { /* name 'CausaLimpia'; code, codigoPrisma, operacion; sin cause ni meta */ }

export function esErrorDeBase(error: unknown): boolean { /* P-42 */ }
export function causaLimpia(error: unknown, operacion?: string, circunstancia?: CircunstanciaDeLaCausa): CausaLimpia {
  /* tipo de NOMBRES o 'ErrorDeBase' (o el tipo de la causa limpia recibida), códigos, operación validada; mensaje fijo */
}
export function errorParaRegistro(error: unknown): unknown {
  if (!(error instanceof Error)) return { tipo: typeof error };
  if (error instanceof CausaLimpia) return error;
  if (esErrorDeBase(error)) return limpio(error);           // { tipo, codigoPrisma?, sqlstate?, codigoDeSistema?, modelo?, pila? }
  if (!llevaBaseSinLimpiar(error)) return error;            // cadena de `cause` (10 niveles, sin ciclos) y `errors`
  return copiaConCausasLimpias(error);                      // { tipo: name, mensaje, pila, causa?, errores? }
}
```

- `pila` de un error de la base: solo las líneas que cumplen `/^\s+at\s/` (los marcos). Prisma pone en las primeras
  líneas el mensaje y un fragmento del código de la llamada con los argumentos; esas líneas nunca salen. _(Precisado tras
  la ronda 14, criterio 163: el filtro se aplica solo después de quitar el encabezado exacto `nombre: mensaje`; un mensaje
  con líneas `    at …` pasaba como marco. Ver sección 26.)_
- `codigoDeSistema`: de `code` del error o de su `cause` directa (por ejemplo, `ECONNREFUSED` del adaptador), solo si
  cumple el patrón.
- `modelo`: de `meta.modelName` solo si está en `Prisma.ModelName`.
- Nada de esto lanza: cada lectura va por `leer` y la recursión tiene límite de profundidad y un `WeakSet` de vistos.
- _(Cambiado tras la ronda 15, criterios 165 y 166: `llevaBaseSinLimpiar` y `copiaConCausasLimpias` se reemplazan por la
  búsqueda en todo el grafo y la conversión de la sección 27; `tipo` de un error de la base, de la lista cerrada.)_
- `index.ts` exporta `CausaLimpia`, `causaLimpia`, `esErrorDeBase`, `errorParaRegistro` y el tipo
  `CircunstanciaDeLaCausa`.

**Dónde se usa.**

- `comun/filtros/filtro-errores.ts`: en las dos ramas que registran un 5xx, `this.registro.error({ err:
  errorParaRegistro(excepcion) }, …)`, importada de `../../infraestructura/prisma`. Para un `Error` que no es de la base
  es el mismo objeto (la protegida `filtro-errores.test.ts` sigue pasando).
- `infraestructura/proceso/rechazos.ts`: `motivo instanceof Error ? { err: errorParaRegistro(motivo) } : { tipo: typeof
  motivo }` (precisión de P-40).
- `base-datos.ts`, `#registrarAbortada`: ya registra solo el SQLSTATE y la operación; con la causa limpia, el texto de la
  causa es seguro por construcción.
- `cli/mensaje-seguro.ts`: al principio, si `esErrorDeBase(error)` y no es una `CausaLimpia`, devuelve
  `` `error de la base (${partes.join(', ')})` `` con `tipo`, `codigoPrisma`, `SQLSTATE <sqlstate>` y `codigoDeSistema`
  (los que haya) de `errorParaRegistro`, sin la pila; si no, lo de hoy (la protegida `mensaje-seguro.test.ts` usa errores
  comunes y no cambia). La usan `cli/superadmin.ts` y `prisma/seed.ts`, que no cambian.
- Revisión: `rg "\{ err|console\.(error|warn)|registro\.(error|warn)" backend/src backend/prisma` y que el `PrismaClient`
  de `BaseDatos` y de `crearClienteDelDueno` no tenga la opción `log`.

**Desborde de la caché de subtransacciones (O2, sin criterio).** PostgreSQL guarda en la memoria compartida de cada
conexión hasta 64 identificadores de subtransacción (`PGPROC_MAX_CACHED_SUBXIDS`); una subtransacción recibe identificador
cuando escribe, y los puntos de guardado liberados siguen ahí hasta que la transacción termina. Con más de 64 escrituras
de modelos que escriben dentro de una transacción, la conexión queda con `subxact_overflowed` y, mientras la transacción
siga abierta, toda instantánea de cualquier conexión del servidor consulta `pg_subtrans` (más lento para todas las
academias). Regla para las historias siguientes, que el revisor vigila desde la 005: nada de bucles de escrituras de un
modelo dentro de una transacción; las cargas masivas van con `createMany`, `updateMany` o `deleteMany` (una operación,
un punto de guardado) o con `$executeRaw` (ninguno). Riesgo aceptado ampliado: "Dos sentencias más por escritura de un
delegado".

**Revisión de 001.** Se espera que ningún servicio de 001 tenga promesas descartadas (el lint lo dirá), ni errores propios
que copien el mensaje de otro, ni registros de errores que no pasen por `errorParaRegistro`.

Texto propuesto para `docs/arquitectura.md` (lo agrega el documentador en el cierre, T24), a continuación de las viñetas
de la ronda 12:

> - En `backend/src` no se descartan promesas: ni `void` ni funciones `async` sin `await` (lo exige el lint, spec 001,
>   criterio 159). Un rechazo que llega después de que `trabajo` terminó hace fallar la operación (criterio 160).
> - Los registros técnicos de un error de la base llevan solo el tipo y los códigos, nunca el mensaje de Prisma (puede
>   llevar datos personales, Ley 29733); se registran con `errorParaRegistro` (criterio 162). Un error propio nunca copia
>   el mensaje de otro: se encadena con `{ cause }`.
> - Para escribir muchas filas en una transacción se usa `createMany`, `updateMany`, `deleteMany` o `$executeRaw`, no un
>   bucle de escrituras (más de 64 desbordan la caché de subtransacciones de PostgreSQL).

### 26. Correcciones del ataque, ronda 14 (criterios 163 y 164)

La ronda 14 encontró una falla media (F1: la `pila` de un error de la base se filtraba sobre el `stack` completo y un
mensaje con líneas `    at …` pasaba como marco) y dos observaciones (O1: el riesgo aceptado "Promesa descartada que
escapa al lint" describía mal el caso habitual; O2: `process.nextTick(async …)` escapa a las dos reglas de lint). Lo que
corrige: 163 lee la pila después del encabezado; 164 amplía la regla propia. La O1 corrige el riesgo aceptado y agrega la
nota para el revisor de abajo. No hay migraciones nuevas.

Código de producción que cambia: `backend/src/infraestructura/prisma/registro-de-errores.ts` (`soloMarcos` y quien la
llama) y `eslint/regla-promesas-descartadas.mjs` (y su comentario de cabecera). `eslint.config.mjs` y
`eslint.protegido.config.mjs` no cambian: importan el mismo bloque.

**Pila después del encabezado (criterio 163, precisión de P-42).** En `registro-de-errores.ts` (orientativo):

```ts
/** Los marcos de la pila de `error`, leídos solo después del encabezado exacto `nombre: mensaje` (criterio 163). */
const marcosDespuesDelEncabezado = (error: unknown): string | undefined => {
  const nombre = leerSeguro(error, 'name');
  const mensaje = leerSeguro(error, 'message');
  const pila = leerSeguro(error, 'stack');
  if (typeof nombre !== 'string' || typeof mensaje !== 'string' || typeof pila !== 'string') return undefined;
  const encabezado = mensaje === '' ? nombre : `${nombre}: ${mensaje}`;
  if (pila.length < encabezado.length || pila.slice(0, encabezado.length) !== encabezado) return undefined;
  const resto = pila.slice(encabezado.length);
  if (resto !== '' && !resto.startsWith('\n')) return undefined;
  const marcos = resto
    .split('\n')
    .filter((linea) => MARCO_DE_PILA.test(linea))
    .slice(0, MARCOS_MAXIMOS);
  return marcos.length === 0 ? undefined : marcos.join('\n');
};
```

- `limpio(error)` usa `marcosDespuesDelEncabezado(error)` en lugar de `soloMarcos(leerSeguro(error, 'stack'))`; `soloMarcos`
  desaparece (o queda solo como el filtro de líneas aplicado a `resto`). `leerSeguro` ya atrapa los getters que lanzan.
- `copiaConCausasLimpias` no cambia: para cada causa que es un error de la base llama a `limpio`, así que la corrección vale
  en cada nivel. La `pila` de un `Error` que no es de la base sigue completa (criterio 162).
- Buscar con `rg "MARCO_DE_PILA|soloMarcos|\.stack" backend/src` cualquier otro lugar que filtre marcos de un error de la
  base; si lo hay, usa la misma función.
- Nada de esto lanza: `slice` y `startsWith` sobre cadenas ya comprobadas.

**Regla propia con temporizadores (criterio 164, ampliación de P-41).** En `eslint/regla-promesas-descartadas.mjs`
(orientativo):

```js
const ENVOLTORIOS_DE_TIPOS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);
const sinEnvoltorios = (nodo) => {
  let actual = nodo;
  while (actual && ENVOLTORIOS_DE_TIPOS.has(actual.type)) actual = actual.expression;
  return actual;
};
const DIFERIDORES = new Set(['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask']);
const nombreDeLaFuncion = (callee) => {
  const c = sinEnvoltorios(callee);
  if (c.type === 'Identifier') return c.name;
  if (c.type !== 'MemberExpression') return null;
  if (!c.computed && c.property.type === 'Identifier') return c.property.name;
  if (c.property.type === 'Literal' && typeof c.property.value === 'string') return c.property.value;
  if (c.property.type === 'TemplateLiteral' && c.property.expressions.length === 0) return c.property.quasis[0].value.cooked;
  return null;
};
// create(context):
//   ExpressionStatement: como hoy, pero con sinEnvoltorios sobre la expresión (y sobre la de la ChainExpression) y sobre el callee.
//   CallExpression(nodo) {
//     if (!DIFERIDORES.has(nombreDeLaFuncion(nodo.callee))) return;
//     if (nodo.arguments.some((a) => esAsyncEnElLugar(sinEnvoltorios(a)))) context.report({ node: nodo, messageId: 'diferida' });
//   }
```

- La `CallExpression` dentro de una `ChainExpression` (`process?.nextTick(…)`) la visita ESLint igual; el `callee` es un
  `MemberExpression` con `optional: true`.
- _(Precisión del orquestador, ronda 14.)_ `nombreDeLaFuncion` quita los envoltorios de tipos del `callee` antes de
  reconocer el `Identifier` o el `MemberExpression` (los paréntesis no forman nodo en ESTree), igual que en (ii):
  `(process.nextTick as typeof process.nextTick)(async () => { … })` falla (criterio 164 y ampliación de P-41).
- Un argumento `SpreadElement` no es una función: no cuenta.
- El mensaje `diferida` (texto libre): "No pases funciones async a nextTick, setImmediate, setTimeout, setInterval ni
  queueMicrotask en backend/src: espera la operación con await o hazla después de confirmar (spec 001, criterio 164)."
- El comentario de cabecera del archivo nombra el criterio 164 y el caso (iii).
- La prueba protegida del criterio 96 no cambia de resultado: la regla mantiene su identificador.

**Nota para el revisor (O1, cada historia).** Dentro de `trabajo` (el callback de `conAcademia`, `comoPlataforma` o
`enPlataforma`), **toda promesa creada se espera antes de devolver**: también la que se guarda en una variable, en un
objeto o en un arreglo, o se pasa a otra función. El lint no lo ve si la variable se usa sin esperarla, y el envoltorio
no la marca si rechaza mientras `trabajo` sigue en curso (riesgo aceptado "Promesa descartada que escapa al lint",
corregido en la ronda 14). Buscar en el diff de cada historia: `const … = (async`, `const … = this.…(` o
`const … = tx.cliente.` sin `await`, y que cada una de esas variables tenga su `await` (o `await Promise.all([...])`)
antes del `return` de `trabajo`. La forma con `.catch` al final de una cadena es comportamiento esperado (criterios 153
y 160), pero dentro de `trabajo` se prefiere `await`.

**Revisión de 001.** Se espera que ningún servicio de 001 pase funciones `async` a temporizadores ni guarde promesas sin
esperarlas (hoy no hay ninguno).

Texto propuesto para `docs/arquitectura.md` (lo agrega el documentador en el cierre, T24), a continuación de las viñetas
de la ronda 13:

> - Dentro de una transacción, toda promesa que se crea se espera antes de devolver, también la guardada en una variable;
>   y no se pasan funciones `async` a `process.nextTick`, `setImmediate`, `setTimeout`, `setInterval` ni
>   `queueMicrotask` (spec 001, criterio 164). Lo diferido va después de confirmar.
> - El registro técnico de un error de la base conserva solo los marcos que siguen al encabezado `nombre: mensaje`
>   (criterio 163).

### 27. Correcciones del ataque, ronda 15 (criterios 165 y 166)

La ronda 15 encontró una falla media (F1: `throw new InternalServerErrorException(error)` y las demás excepciones de 5xx de
Nest guardan el error de Prisma en `response` y copian su mensaje a `message`; `errorParaRegistro` las devolvía tal cual) y
tres observaciones (O1: `tipo` sin lista cerrada; O2: `::money` rechaza con un `Error` común con el valor; y cinco formas de
lint que escapan a las reglas). Lo que corrige: 165 busca errores de la base en todo el grafo del error y registra el que
los lleva en una forma limpia; 166 cierra la lista de `tipo`. La O2 es una regla para todas las historias (abajo) y las
formas de lint amplían el riesgo aceptado "Promesa descartada que escapa al lint". No hay migraciones nuevas.

Código de producción que cambia: `backend/src/infraestructura/prisma/registro-de-errores.ts` (búsqueda, conversión y
`tipo`) y `backend/src/cli/mensaje-seguro.ts`. `filtro-errores.ts`, `rechazos.ts` y `main.ts` no cambian: ya llaman a
`errorParaRegistro`. `index.ts` no exporta nada nuevo.

**Búsqueda en el grafo (criterio 165, precisión de P-42).** En `registro-de-errores.ts` (orientativo):

```ts
const PROFUNDIDAD_MAXIMA = 10;
const OBJETOS_MAXIMOS = 200;
const CLAVES_MAXIMAS = 100;
const DE_LA_BASE_MAXIMOS = 10;

/** Lee `objeto[clave]` (texto o Symbol) sin dejar que un getter lance. */
const leerClave = (objeto: object, clave: PropertyKey): unknown => {
  try { return Reflect.get(objeto, clave); } catch { return undefined; }
};

/** Propias (texto y Symbol, enumerables o no) y enumerables heredadas. Lanza si el objeto no deja listarlas (un Proxy). */
function clavesDe(objeto: object): PropertyKey[] {
  const claves = new Set<PropertyKey>(Reflect.ownKeys(objeto));
  // eslint-disable-next-line guard-for-in -- se buscan también las heredadas enumerables: pino las serializa
  for (const clave in objeto) claves.add(clave);
  return [...claves];
}

interface Busqueda { readonly deLaBase: readonly object[]; readonly agotada: boolean }

/** Recorre el grafo de `raiz` por niveles y junta los errores de la base (sin entrar en ellos ni en las CausaLimpia). */
function buscarErroresDeLaBase(raiz: object): Busqueda {
  const vistos = new WeakSet<object>([raiz]);
  const deLaBase: object[] = [];
  let pendientes: object[] = [raiz];
  let visitados = 1;
  for (let nivel = 0; pendientes.length > 0; nivel++) {
    const siguientes: object[] = [];
    for (const objeto of pendientes) {
      let claves: PropertyKey[];
      try { claves = clavesDe(objeto); } catch { return { deLaBase, agotada: true }; }
      if (claves.length > CLAVES_MAXIMAS) return { deLaBase, agotada: true };
      for (const clave of claves) {
        const valor = leerClave(objeto, clave);
        if (!esObjeto(valor) || vistos.has(valor)) continue;
        vistos.add(valor);
        if (valor instanceof CausaLimpia) continue;
        if (esErrorDeBase(valor)) { deLaBase.push(valor); continue; }
        if (nivel + 1 > PROFUNDIDAD_MAXIMA || ++visitados > OBJETOS_MAXIMOS) return { deLaBase, agotada: true };
        siguientes.push(valor);
      }
    }
    pendientes = siguientes;
  }
  return { deLaBase, agotada: false };
}
```

- _(Reemplazados `clavesDe` y el bucle de búsqueda por los de la sección 28, ataque ronda 16, criterios 167 y 168: este
  `clavesDe` junta todas las claves antes de comparar con el tope (F1), y la búsqueda no lee `cause` ni `errors` por su
  nombre (O1).)_
- `esObjeto` es el de hoy (`typeof 'object'` y no `null`): las funciones no se recorren (riesgo aceptado "Errores de la
  base fuera del alcance de la búsqueda"). _(Precisado tras la ronda 16, criterio 168: sigue sin recorrerse ninguna
  función, pero una `cause` que es una función es falla cerrada; sección 28.)_
- La regla `guard-for-in` puede no estar activa; si no lo está, el comentario sobra. Si el lint señala `for…in` por otra
  regla, se usa la forma equivalente con `Object.getPrototypeOf` y `Object.keys` en cada prototipo (sin `Object.prototype`).

**Mensajes de la base (criterio 165).**

```ts
interface MensajesDeLaBase { readonly textos: readonly string[]; readonly verificables: boolean }

function mensajesDeLaBase(deLaBase: readonly object[]): MensajesDeLaBase {
  const textos: string[] = [];
  let verificables = true;
  for (const error of deLaBase) {
    let mensaje: unknown;
    try { mensaje = Reflect.get(error, 'message'); } catch { verificables = false; continue; }
    if (typeof mensaje === 'string') { if (mensaje !== '') textos.push(mensaje); }
    else if (mensaje !== undefined) verificables = false;
  }
  return { textos, verificables };
}

/** Para `mensaje`: inclusión en los dos sentidos (criterio 165). */
const copia = (texto: string, de: MensajesDeLaBase): boolean =>
  !de.verificables || de.textos.some((m) => texto.includes(m) || m.includes(texto));
```

**Conversión (criterio 165).**

```ts
/** `name` solo si es el de su constructor y tiene forma de identificador (criterio 165). */
function nombreDeClase(error: unknown): string {
  const nombre = leerSeguro(error, 'name');
  const deLaClase = leerSeguro(leerSeguro(error, 'constructor'), 'name');
  return typeof nombre === 'string' && nombre === deLaClase && NOMBRE_DE_TIPO.test(nombre) ? nombre : 'Error';
}

interface Contexto { readonly mensajes: MensajesDeLaBase; readonly colocados: Set<object>; readonly enCadena: WeakSet<object> }

function convertir(valor: unknown, nivel: number, contexto: Contexto): unknown {
  if (!esObjeto(valor)) return { tipo: typeof valor };
  if (valor instanceof CausaLimpia) return valor;
  if (esErrorDeBase(valor)) { contexto.colocados.add(valor); return limpio(valor); }
  if (!(valor instanceof Error)) return { tipo: typeof valor };
  if (nivel > PROFUNDIDAD_MAXIMA || contexto.enCadena.has(valor)) return { tipo: 'truncado' };
  contexto.enCadena.add(valor);
  const mensaje = leerSeguro(valor, 'message');
  const pila = pilaSinEncabezado(valor);                    // criterio 163
  const pilaStack = leerSeguro(valor, 'stack');
  const conservaMensaje = typeof mensaje === 'string' && !copia(mensaje, contexto.mensajes);
  const { textos, verificables } = contexto.mensajes;
  const conservaPila =                                       // criterio 165: solo "contiene", en un sentido
    pila !== undefined && verificables && typeof mensaje === 'string' && typeof pilaStack === 'string' &&
    !textos.some((m) => mensaje.includes(m) || pilaStack.includes(m));
  const causa = leerSeguro(valor, 'cause');
  const varios = leerSeguro(valor, 'errors');
  return {
    tipo: nombreDeClase(valor),
    ...(conservaMensaje ? { mensaje } : {}),
    ...(conservaPila ? { pila } : {}),
    ...(causa === undefined ? {} : { causa: convertir(causa, nivel + 1, contexto) }),
    ...(Array.isArray(varios)
      ? { errores: (varios as unknown[]).slice(0, NIVELES_MAXIMOS).map((e) => convertir(e, nivel + 1, contexto)) }
      : {}),
  };
}

export function errorParaRegistro(error: unknown): unknown {
  try {
    if (!(error instanceof Error)) return { tipo: typeof error };
    if (error instanceof CausaLimpia) return error;
    if (esErrorDeBase(error)) return limpio(error);
    const { deLaBase, agotada } = buscarErroresDeLaBase(error);
    if (deLaBase.length === 0 && !agotada) return error;    // como hoy
    const resto = (colocados: Set<object>) => deLaBase.filter((e) => !colocados.has(e));
    if (agotada) {
      const encontrados = deLaBase.slice(0, DE_LA_BASE_MAXIMOS).map(limpio);
      return { tipo: nombreDeClase(error), truncado: true, ...(encontrados.length > 0 ? { erroresDeLaBase: encontrados } : {}) };
    }
    const contexto: Contexto = { mensajes: mensajesDeLaBase(deLaBase), colocados: new Set(), enCadena: new WeakSet() };
    const convertido = convertir(error, 0, contexto) as Record<string, unknown>;
    const otros = resto(contexto.colocados);
    return {
      ...convertido,
      ...(otros.length > 0 ? { erroresDeLaBase: otros.slice(0, DE_LA_BASE_MAXIMOS).map(limpio) } : {}),
      ...(otros.length > DE_LA_BASE_MAXIMOS ? { truncado: true } : {}),
    };
  } catch {
    return { tipo: 'Error' };
  }
}
```

- `copiaConCausasLimpias` y `llevaBaseSinLimpiar` desaparecen (los reemplazan `convertir` y `buscarErroresDeLaBase`);
  `hijosDe` también, si no queda otro uso.
- La conversión de la cadena vuelve a leer `cause` y `errors`: si un getter devuelve otra cosa la segunda vez, lo que
  aparece se convierte con las mismas reglas (un error de la base nuevo sale en su forma limpia, aunque no estuviera en
  `textos`; su mensaje no se compara: es un getter hostil). Lo nota el adversarial si importa.
- `limpio(error)` es el de hoy, con `tipo` del criterio 166.
- La búsqueda cuesta un recorrido acotado del error solo cuando se registra (500, rechazo sin manejar, arranque, comandos):
  no está en el camino de las peticiones que terminan bien. _(Corregido tras la ronda 16, F1: no estaba acotado; las claves
  se juntaban todas antes de comparar con el tope. Sección 28, criterio 167.)_

**`tipo` de la lista cerrada (criterio 166).**

```ts
const TIPOS_DE_BASE: ReadonlySet<string> = new Set([
  'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientValidationError',
  'PrismaClientInitializationError', 'PrismaClientRustPanicError', 'DriverAdapterError', 'DatabaseError', 'CausaLimpia',
]);
const tipoDeBase = (error: unknown): string => {
  const nombre = leerSeguro(error, 'name');
  return typeof nombre === 'string' && TIPOS_DE_BASE.has(nombre) ? nombre : 'ErrorDeBase';
};
// datosSeguros(error): tipo = esErrorDeBase(error) ? tipoDeBase(error) : nombreDeClase(error)
```

- `NOMBRES_DE_BASE` (el conjunto de `esErrorDeBase`) puede ser el mismo conjunto; `esErrorDeBase` no cambia (sigue
  aceptando los nombres que empiezan por `PrismaClient`).
- `causaLimpia` toma `tipo` de `datosSeguros`, así que el mensaje y la propiedad `tipo` de la `CausaLimpia` siguen la
  lista. Con una `CausaLimpia` recibida, su `tipo` ya está en la lista.

**`mensajeSeguro` (criterio 165).** En `cli/mensaje-seguro.ts` (orientativo):

```ts
function primeroDeLaBase(valor: unknown, vistos = new Set<unknown>()): Record<string, unknown> | undefined {
  // recorre causa y errores a lo hondo y luego erroresDeLaBase; devuelve el primer objeto con tipo y sin `mensaje`
  // que vino de `limpio` (tiene codigoPrisma, sqlstate o codigoDeSistema, o su tipo está en la lista cerrada)
}

export function mensajeSeguro(error: unknown, secretos: readonly (string | undefined)[]): string {
  let texto: string;
  if (esErrorDeBase(error) && !(error instanceof CausaLimpia)) texto = textoDeErrorDeBase(errorParaRegistro(error));
  else if (error instanceof Error) {
    const registrado = errorParaRegistro(error);
    if (registrado === error) texto = error.message;
    else {
      const r = registrado as Record<string, unknown>;
      const base = primeroDeLaBase(r);
      texto = typeof r['mensaje'] === 'string' ? r['mensaje']
        : base !== undefined ? textoDeErrorDeBase(base)
        : `error sin detalles (${String(r['tipo'])})`;
    }
  } else texto = String(error);
  // … reemplazo de secretos, primera línea y 300 caracteres, como hoy
}
```

`textoDeErrorDeBase` pasa a recibir el objeto limpio (hoy llama a `errorParaRegistro` dentro).

**Regla para todas las historias: sin `money` (O2).** No se usa el tipo `money` de PostgreSQL, ni en columnas ni en
conversiones (`::money`): sus errores llegan como `[DecimalError]` de `decimal.js`, un `Error` común que no es de la base y
cuyo mensaje lleva el valor. Los montos van en `numeric` y `Decimal` (`CLAUDE.md`). El revisor lo busca en cada historia
(`rg -i "money" backend/`). Riesgo aceptado "Tipo `money` en consultas".

**Nota para el revisor (cada historia, ronda 15).** Además de lo de la ronda 13 ("Mensajes propios que copian el de
Prisma"): a una excepción de Nest se le pasa un mensaje propio y `{ cause: error }`, nunca el error ni su mensaje como
respuesta (`rg "Exception\((e|err|error)\b" backend/src`, y `.message` dentro de un `catch`). Y las cinco formas de lint de
la ronda 15 (`async function(){}.bind(…)` pasada a un temporizador, `setTimeout(() => (async () => …)(), 0)`, un `callee`
condicional o con coma y `x && (async () => …)()`): el riesgo aceptado "Promesa descartada que escapa al lint".

**Revisión de 001.** Se espera que ningún servicio de 001 envuelva un error de la base en una excepción de Nest ni use
`money` (hoy no hay ninguno); si el revisor encuentra uno, se corrige con un mensaje propio y `{ cause }`.

Texto propuesto para `docs/arquitectura.md` (lo agrega el documentador en el cierre, T24), a continuación de las viñetas
de la ronda 14:

> - Un error se envuelve con un mensaje propio y `{ cause: error }`: `new InternalServerErrorException('No se pudo …',
>   { cause: error })`, no `new InternalServerErrorException(error)`. El registro técnico limpia igual el error de la base
>   en cualquier propiedad (spec 001, criterio 165), pero solo con `{ cause }` se conserva el mensaje propio.
> - No se usa el tipo `money` de PostgreSQL: los montos van en `numeric` y `Decimal`.

### 28. Correcciones del ataque, ronda 16 (criterios 167 y 168)

La ronda 16 (sobre `8b503d2`) encontró una falla media (F1: `clavesDe` junta todas las claves de un objeto antes de
comparar con el tope de 100; un `Buffer` de 5 MB en el grafo de un error bloqueó el event loop 6,9 s y usó 707 MB, y con
256 MB el proceso cayó) y una observación media-baja (O1: pino lee `cause` por su nombre, también como getter heredado, y
la llama si es una función; la búsqueda no la veía). Lo que corrige: 167 acota el costo de la búsqueda (hojas binarias,
falla cerrada por `length`, corte de la enumeración); 168 lee `cause` y `errors` por su nombre en cada objeto visitado y
trata una `cause` función como falla cerrada. No hay migraciones nuevas. La pregunta técnica R16-1 la resolvió el
orquestador antes de T163 aceptando la propuesta: un error con un binario en su grafo se registra convertido, sin el
binario, aunque no lleve errores de la base (abajo, "Binario en el grafo").

Código de producción que cambia: solo `backend/src/infraestructura/prisma/registro-de-errores.ts` (`clavesDe`,
`buscarErroresDeLaBase` y la condición del final de `errorParaRegistro`). `convertir`, `mensajesDeLaBase`, `limpio`,
`mensaje-seguro.ts`, `filtro-errores.ts`, `rechazos.ts`, `main.ts` e `index.ts` no cambian.

**Hojas, `length` y claves (criterio 167).** Orientativo:

```ts
import { types } from 'node:util';

/** Binarios por la ranura interna del motor; nunca por instanceof, prototipo ni Symbol.toStringTag (criterio 167). */
const esHojaBinaria = (valor: object): boolean => ArrayBuffer.isView(valor) || types.isAnyArrayBuffer(valor);

/**
 * Las claves de `objeto` (propias, texto y Symbol, enumerables o no, y enumerables heredadas), o `undefined` si pasan del
 * tope o no se dejan listar (falla cerrada). Nunca junta más de CLAVES_MAXIMAS + 1 claves ni recorre `for…in` de más.
 */
function clavesDe(objeto: object): PropertyKey[] | undefined {
  const largo = leerClave(objeto, 'length');
  if (typeof largo === 'number' && largo > CLAVES_MAXIMAS) return undefined;   // arreglos, String, con forma de arreglo
  let propias: PropertyKey[];
  try { propias = Reflect.ownKeys(objeto); } catch { return undefined; }
  if (propias.length > CLAVES_MAXIMAS) return undefined;                        // sin recorrer for…in
  const claves = new Set<PropertyKey>(propias);
  try {
    for (const clave in objeto) {
      claves.add(clave);
      if (claves.size > CLAVES_MAXIMAS) return undefined;                       // corte
    }
  } catch { return undefined; }
  return [...claves];
}
```

- `leerClave` es el de hoy (`Reflect.get` sin dejar que un getter lance). Con un `Proxy` sin trampa `get`, `length` es
  el del destino; con una trampa que lanza, `undefined` (sigue con las claves, que pueden lanzar: falla cerrada).
  _(Precisión del orquestador, ronda 16: la primera frase es **falsa** para los arreglos tipados. Sin trampa `get`,
  `Reflect.get` llama al getter `TypedArray.prototype.length` con el `Proxy` como receptor, y ese getter exige la ranura
  interna: lanza `TypeError: Method get TypedArray.prototype.length called on incompatible receiver`, así que `leerClave`
  da `undefined`. Para un destino con `length` como propiedad de datos (un arreglo, un objeto plano), sí se lee el del
  destino.)_
- Un `Proxy` de un `Buffer` no es una hoja (`ArrayBuffer.isView` da falso) y su `length` pasa del tope: falla cerrada sin
  listar (caso (t9)). _(Precisión del orquestador, ronda 16: no es así. Leer su `length` lanza (punto anterior), se toma
  como sin `length` y `Reflect.ownKeys` entrega sus 5 M de índices (≈7 s); sin leer el destino de un `Proxy` no hay API
  pública para tratarlo como hoja. El caso sale de (t9) y va al riesgo aceptado "Objetos sin `length` con millones de
  claves" de la spec; `clavesDe` no cambia por él.)_
- `Object.create(Uint8Array.prototype)`: no es una hoja; leer su `length` lanza (el getter del prototipo exige la ranura)
  y se toma como sin `length`; se recorre normal (caso (t9)).
- `types.isAnyArrayBuffer` es de `node:util/types` (también `require('node:util').types`); funciona entre contextos de
  `vm`, a diferencia de `instanceof`.

**`cause` y `errors` por su nombre; `cause` función (criterio 168).** El bucle de `buscarErroresDeLaBase` (orientativo):

```ts
for (const objeto of pendientes) {
  const claves = clavesDe(objeto);
  if (claves === undefined) return { deLaBase, agotada: true };
  const valores: unknown[] = [];
  for (const clave of claves) {
    const valor = leerClave(objeto, clave);
    if (clave === 'cause' && typeof valor === 'function') return { deLaBase, agotada: true };
    valores.push(valor);
  }
  const causa = leerClave(objeto, 'cause');                 // por su nombre: getters y heredadas incluidas
  if (typeof causa === 'function') return { deLaBase, agotada: true };   // nunca se llama
  valores.push(causa, leerClave(objeto, 'errors'));          // `errors` función: no es objeto, no se recorre
  for (const valor of valores) {
    if (!esObjeto(valor) || vistos.has(valor)) continue;
    vistos.add(valor);
    if (esHojaBinaria(valor)) { conBinarios = true; continue; }   // criterio 167: no cuenta como visitado; R16-1
    if (valor instanceof CausaLimpia) continue;
    if (esErrorDeBase(valor)) { deLaBase.push(valor); continue; }
    visitados += 1;
    if (nivel + 1 > PROFUNDIDAD_MAXIMA || visitados > OBJETOS_MAXIMOS) return { deLaBase, agotada: true };
    siguientes.push(valor);
  }
}
```

- La raíz (el error recibido) pasa por el mismo bucle: su `length`, sus claves, su `cause` por nombre. Si la raíz misma
  fuera una hoja binaria no llegaría aquí (no es un `Error`).
- `cause` y `errors` leídos por su nombre no cuentan para el tope de claves (son dos lecturas fijas por objeto). Si ya
  estaban entre las claves listadas, el `WeakSet` de vistos evita procesar dos veces el mismo valor; un getter que devuelve
  otro objeto en la segunda lectura lo agrega como uno más (con los topes).
- La comprobación de la función se hace sobre las dos lecturas (la listada y la por nombre): un getter hostil que alterne
  no la esquiva en ninguna.
- `convertir` no cambia: ya lee `cause` y `errors` con `leerSeguro`, que incluye getters heredados. Con una `cause`
  función nunca se llega a convertir (la búsqueda falló cerrada antes).
- `esErrorDeBase` y `datosSeguros` leen `cause` sin llamarla (ya era así); no cambian.

**Binario en el grafo (criterio 167, R16-1).** `Busqueda` gana `conBinarios: boolean` (verdadero si la búsqueda saltó
al menos una hoja binaria; se devuelve también en las salidas por falla cerrada, donde no cambia nada). El final de
`errorParaRegistro` (orientativo):

```ts
const { deLaBase, agotada, conBinarios } = buscarErroresDeLaBase(error);
if (deLaBase.length === 0 && !agotada && !conBinarios) return error;   // sin nada que quitar: el mismo, como hoy
if (agotada) { /* falla cerrada, como hoy */ }
const contexto: Contexto = { mensajes: mensajesDeLaBase(deLaBase), colocados: new Set(), enCadena: new WeakSet() };
// … convertir y erroresDeLaBase, como hoy (sin errores de la base: textos vacíos y verificables, así que `mensaje` y
// `pila` se conservan con sus reglas, y no hay `erroresDeLaBase`)
```

- `convertir` no cambia: nunca copia propiedades que no sean `cause` o `errors`, así que el binario no puede salir; un
  binario que es directamente la `cause` o un elemento de `errors` sale como `{ tipo: 'object' }` (no es un `Error`).
- `mensajeSeguro` no cambia: con el objeto convertido usa su `mensaje` ((t10) con el error interior de (t1) da
  `No se pudo subir el comprobante`).
- Las protegidas anteriores no tienen binarios en el grafo de un error (revisado: ninguna usa `Buffer` ni arreglos
  tipados con `errorParaRegistro`), así que su resultado no cambia.

**Pruebas de tiempo y memoria (criterio 167).** En la prueba, cada caso hace `errorParaRegistro(new
Error('calentamiento'))`, construye el valor grande, toma `performance.now()`, llama una vez y vuelve a tomar el tiempo;
el límite es 200 ms (1000 ms para `FiltroErrores` con pino en (t1)). El hijo de (t11) importa
`backend/src/infraestructura/prisma/index.ts` con `tsx` (ya es dependencia del backend: lo usa `superadmin`), imprime
una línea JSON por caso (`{ caso, mismo: boolean, truncado: boolean, conMensaje: boolean }`) y la prueba la compara
((t1): `mismo: false`, `truncado: false`, `conMensaje: true`; (t3) y (t4): `truncado: true`); `timeout` del hijo de 60 s.
Para "sin el binario", la prueba recorre el resultado (objetos y arreglos, con un conjunto de vistos) y comprueba que
ningún valor cumple `ArrayBuffer.isView` ni `types.isAnyArrayBuffer`.
Las pruebas no dependen de la zona horaria ni del sistema operativo.

**Revisión de 001.** Se espera que ningún error de 001 lleve un `Buffer`, una copia de un arreglo grande ni una `cause`
función (hoy no hay ninguno); si el revisor encuentra uno, se corrige guardando una clave o un resumen.

**Nota para el revisor (cada historia, ronda 16).** Un error nunca lleva el contenido de un archivo (se guarda la clave
de `AlmacenArchivos`, D-19), ni una copia de un `Buffer` o de un arreglo en un objeto plano (`{ ...buffer }`,
`Object.assign({}, lista)`), ni una `cause` que sea una función (riesgos aceptados "Contenido de un binario en el
registro" y "Objetos sin `length` con millones de claves"). Desde R16-1 el registro ya no escribe un binario, pero la regla
sigue: tampoco el contenido de un archivo como texto (por ejemplo, en base64), que sí saldría.

Texto propuesto para `docs/arquitectura.md` (lo agrega el documentador en el cierre, T24), a continuación de las viñetas
de la ronda 15:

> - Un error no lleva el contenido de un archivo ni copias de listas grandes: se guarda la clave del archivo en
>   `AlmacenArchivos`. La `cause` de un error es un valor, nunca una función.

### 29. Correcciones del ataque, ronda 17 (criterios 169 a 171)

La ronda 17 (sobre `6e3d69e`) no encontró fallas en el núcleo (aislamiento, RLS, Superadmin, auditoría, registro de
errores). Encontró una falla media en Windows (F1: un `.env` guardado con BOM lo leen distinto los scripts, con `parseEnv`,
y el backend, con `dotenv`; `env:completar` cambiaba en silencio la `DATABASE_URL` efectiva) y dos observaciones (O1: los
scripts lanzados por una ruta con un enlace o una unión no hacen nada y salen con 0; O2: `GET /api/a/{nombreCorto}` sin
límite de peticiones, que se difiere). Lo que corrige: 169, una sola regla de lectura del `.env` sin el BOM inicial; 170,
`env:completar` no agrega lo que `dotenv` ya lee, avisa de lo que los scripts no pueden leer, conserva el archivo y no
escribe en un `.env` UTF-16 (provisional, R17-2); 171, el punto de entrada se decide con rutas reales. No hay migraciones
nuevas ni cambios en `backend/src`, `packages/` ni `frontend/`.

Código que cambia: `scripts/lib/entorno.mjs`, `scripts/completar-env.mjs`, `scripts/lib/punto-de-entrada.mjs` (nuevo),
`scripts/crear-bases.mjs`, `scripts/compilar-contratos-si-falta.mjs`, `scripts/verificar-pruebas-protegidas.mjs`,
`scripts/verificar-sin-secretos.mjs` y `.claude/hooks/preparar-sesion.mjs` (backend, T172 y T173); y
`backend/test/utilidades/base-pruebas.ts` y `base-datos.ts` (test-writer, T170, en el commit de pruebas protegidas).

**Lectura del `.env` (criterio 169, P-43).** Orientativo:

```js
// scripts/lib/entorno.mjs
const BOM = '﻿';
export const quitarBom = (texto) => (texto.startsWith(BOM) ? texto.slice(1) : texto);
export const analizarEnv = (texto) => parseEnv(quitarBom(texto));

export function cargarEnv(env = process.env, raiz = raizProyecto) {
  const ruta = path.join(raiz, '.env');
  if (!fs.existsSync(ruta)) return;
  for (const [clave, valor] of Object.entries(analizarEnv(fs.readFileSync(ruta, 'utf8')))) {
    if (env[clave] === undefined) env[clave] = valor;
  }
}

const SEPARADOR_DE_LINEAS = /\r\n|[\n\r  ]/;
const LINEA_CON_CLAVE = /^\s*(?:export\s+)?([\w.-]+)\s*[=:]/;   // \s de JavaScript: incluye U+FEFF y U+00A0
export function clavesPosiblesEnv(texto) {
  const claves = new Set();
  for (const linea of String(texto).split(SEPARADOR_DE_LINEAS)) {
    const coincidencia = LINEA_CON_CLAVE.exec(linea);
    if (coincidencia) claves.add(coincidencia[1]);
  }
  return claves;
}
```

- `fs.readFileSync(ruta, 'utf8')` no quita el BOM (Node lo conserva como U+FEFF); por eso hace falta `quitarBom`.
- En el hook, `entornoParaHijos(raiz, entorno = process.env)` hace lo mismo con su propia línea
  (`texto.startsWith('﻿') ? texto.slice(1) : texto`) y se exporta para la prueba. Los demás usos de
  `entornoParaHijos(raiz)` del hook no cambian.
- `base-pruebas.ts` y `base-datos.ts`: la misma línea antes de `parseEnv` (no importan `scripts/lib/`, que es `.mjs` sin
  tipos).
- `clavesPosiblesEnv` es a propósito más amplia que `dotenv`: una línea dentro de un valor entre comillas de varias líneas
  también cuenta. Un falso positivo solo hace que `env:completar` no agregue esa variable y avise; nunca cambia cuál es la
  efectiva.
- La prueba de coherencia carga `dotenv` del backend con `createRequire(path.join(raiz, 'backend', 'package.json'))`
  (el workspace `scripts` no lo declara; no se agrega como dependencia).

**`env:completar` (criterio 170).** Orientativo:

```js
export function completarEnv(raiz = raizProyecto) {
  // … .env.example y creación, como hoy (leerBloques usa analizarEnv)
  const bytes = fs.readFileSync(rutaEnv);
  if (pareceUtf16(bytes)) throw new Error(MENSAJE_UTF16);          // FF FE, FE FF o un byte 00 (R17-2)
  const actual = bytes.toString('utf8');
  const leidas = new Set(Object.keys(analizarEnv(actual)));
  const posibles = clavesPosiblesEnv(actual);
  const bloques = leerBloques(ejemplo);
  const ilegibles = bloques.filter((b) => !leidas.has(b.nombre) && posibles.has(b.nombre)).map((b) => b.nombre);
  const faltantes = bloques.filter((b) => !leidas.has(b.nombre) && !posibles.has(b.nombre));
  const conAviso = ilegibles.length > 0 ? { ilegibles } : {};
  if (faltantes.length === 0) return { accion: 'sin-cambios', agregadas: [], ...conAviso };
  const sinBom = quitarBom(actual);
  let agregado = sinBom !== '' && !sinBom.endsWith('\n') ? '\n' : '';
  // … bloques como hoy
  fs.appendFileSync(rutaEnv, agregado);                             // nunca reescribe lo que había
  return { accion: 'completado', agregadas: faltantes.map((b) => b.nombre), ...conAviso };
}
```

- El comando imprime, después de lo de hoy, una línea por variable de `ilegibles` (sin su valor). El código de salida
  sigue siendo 0: no es un error del comando, es un aviso.
- `fs.appendFileSync` no toca los bytes anteriores, así que el BOM y los `\r\n` se conservan y no se escribe un segundo BOM.
- `pareceUtf16`: `bytes[0] === 0xff && bytes[1] === 0xfe`, o `0xfe, 0xff`, o `bytes.includes(0)`. Un `.env` UTF-8 válido no
  tiene bytes `00`.

**Punto de entrada (criterio 171, P-44).** Orientativo:

```js
// scripts/lib/punto-de-entrada.mjs
export const rutasIguales = (a, b, plataforma = process.platform) =>
  plataforma === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function esPuntoDeEntrada(urlDelModulo, argv1 = process.argv[1], opciones = {}) {
  const { plataforma = process.platform, realpath = fs.realpathSync } = opciones;
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try {
    const delModulo = realpath(fileURLToPath(urlDelModulo));   // lanza si no es una URL file:
    const delArgumento = realpath(path.resolve(argv1));
    return rutasIguales(delModulo, delArgumento, plataforma);
  } catch {
    return false;
  }
}

// en cada script
if (esPuntoDeEntrada(import.meta.url)) { … }
```

- Node resuelve el punto de entrada con su `realpathSync` (salvo `--preserve-symlinks-main`); comparar las dos rutas
  reales funciona con y sin esa opción.
- `fs.realpathSync` (no `.native`): es la que usa el cargador de Node. Si en la CI de Windows (r7) muestra una diferencia
  con una unión (por ejemplo, la letra de la unidad), el backend se detiene e informa con las dos rutas.
- En el hook, la misma función copiada (con `import fs from 'node:fs'`, que ya importa) y exportada; la línea
  `const esEjecucionDirecta = …` pasa a `if (esPuntoDeEntrada(import.meta.url)) { await principal(); process.exit(0); }`.
- `crear-bases.mjs` deja `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`; los otros cuatro dejan
  `import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href`. Los imports que queden sin usar
  (`pathToFileURL`, `fileURLToPath`) se quitan.

**Pruebas como comando (criterio 171).** El enlace se crea en `fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-r17-'))`
apuntando a la raíz real del repositorio, y se borra en `afterAll` con `fs.rmSync(enlace)` sobre el enlace (no
`recursive`, para no borrar el destino; en Windows, `fs.rmdirSync` sobre la unión). (r2) pasa `env: { ...process.env,
DATABASE_URL: '', DATABASE_URL_PRUEBAS: '', DATABASE_URL_APP: '' }`: `cargarEnv` no sobrescribe lo definido y
`leerUrlsBases` lanza antes de conectar. (r5) puede tardar lo que tarde `npm` en fallar en una carpeta sin
`package.json`; `timeout` de 60 s.

**Nota O2 (no lleva criterio en 001).** `GET /api/a/{nombreCorto}` es pública y sin límite de peticiones; cada petición
abre una transacción corta (`resolverAcademia`) y, con el pool de 10 conexiones y `maxWait` de 10 s, una avalancha
anónima puede ocupar el pool y demorar o hacer fallar las peticiones de todas las academias. Se decide con el hosting
(D-21: límites del proxy o del proveedor, `trust proxy`) y con la historia 005 (páginas públicas), que es la que usa la
ruta: límite por IP antes del controlador (como el del criterio 75), caché corta de la respuesta, o las dos. Va a
"Notas para historias futuras" de la spec y, en el cierre, a la nota de 005 en `specs/backlog.md` (T24).

**Revisión de 001.** Ningún script de `scripts/` ni el hook vuelven a comparar `process.argv[1]` a mano ni a llamar a
`parseEnv` por su cuenta (lo exigen las pruebas estáticas de 169 y 171).

Texto propuesto para `docs/guia-local-windows.md` (lo agrega el documentador en el cierre, T24), en "Problemas
frecuentes":

> - **`env:completar` dice que tu `.env` no está en UTF-8.** PowerShell 5.1 guarda en UTF-16 con `>` y con `Out-File` sin
>   `-Encoding`. Ábrelo en VS Code y elige "Guardar con codificación" → "UTF-8", o usa
>   `Set-Content -Encoding UTF8`. Con o sin BOM se lee igual.
> - **`env:completar` avisa que "los scripts no la pueden leer".** Esa línea tiene algo invisible al principio (por
>   ejemplo, un espacio duro copiado de una página) o usa `:` en lugar de `=`. Escríbela de nuevo a mano como
>   `NOMBRE=valor`.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Rol `aquagestion_app` aparte, sin privilegios, y `FORCE RLS` en todas las tablas | `SET ROLE` por transacción con la conexión del dueño; solo `FORCE` con el dueño | `SET ROLE` olvidado = consulta como dueño (falla abierta); en Docker el dueño es superusuario y se salta `FORCE` |
| Nombre fijo del rol en las migraciones | Rol configurable o `ALTER DEFAULT PRIVILEGES` | Las migraciones no leen variables de entorno; los privilegios por defecto concederían de más a tablas futuras |
| `DATABASE_URL` sigue siendo del dueño y se agrega `DATABASE_URL_APP` | `DATABASE_URL` para la API y `DATABASE_URL_MIGRACIONES` para el dueño | Menos cambios en scripts, hook, CI y guía ya construidos |
| `set_config(…, true)` dentro de `$transaction` interactiva | `SET` de sesión; extensión de Prisma que envuelve cada consulta | Lo local a la transacción no se filtra por el pool; la extensión ocultaría el límite de la transacción |
| `app_academia_actual()` con `NULLIF(…, '')` | Convertir directamente `current_setting(…)::uuid` | Tras un `set_config` local, el valor queda en `''` y la conversión fallaría con error en vez de devolver 0 filas |
| Marca `app.plataforma` que solo abre las tablas de plataforma | Un rol de base distinto para la plataforma | Un solo rol y un solo pool; las tablas de academia ignoran la marca (criterio 18) |
| `resolver_academia` en `plpgsql` que activa `app.plataforma` con `set_config` y lo restaura al salir (P-10, tras T1–T2) | Leer `academias` sin contexto; `SECURITY DEFINER`; cláusula `SET app.plataforma` de `CREATE FUNCTION` | No permite listar academias; con `FORCE`, el dueño también pasa por las políticas; PostgreSQL 16 rechaza la cláusula `SET` con una variable propia si el dueño no es superusuario |
| Sesión y `Cache-Control` en un middleware de prefijo (P-7, P-8) | Solo guard y `@Header` por controlador | Las rutas inexistentes y las respuestas de error no pasan por el controlador |
| Comprobación del rol en la primera operación, memorizada | Comprobar al arrancar | La API debe arrancar con la base caída (000, criterio 8) |
| Superadmins y su auditoría en tablas propias | `usuarios` con rol `SUPERADMIN` y `academia_id` nulo | Las políticas de academia quedan simples y sin excepciones |
| Cookie `aq_plataforma` con `Path=/api/plataforma` | Una cookie para todos | La sesión de plataforma nunca llega a las rutas de academia |
| Vencimiento del token y del bloqueo con `RELOJ` | La hora del sistema dentro de la librería | Las pruebas protegidas fijan la hora (000, criterio 15) |
| Privilegios por columna en `academias` y `superadmins` | Privilegios por tabla | La API no puede cambiar el nombre corto ni la clave del superadmin aunque tenga un error |
| UUID generados por PostgreSQL | Enteros autoincrementales | No se pueden recorrer ni adivinar con facilidad; no hay secuencias que conceder |
| Superadmin creado por comando | Registro por la web o en una migración | Nadie de fuera puede crear un superadmin; ninguna clave queda en el repositorio salvo la de desarrollo |
| `env:completar` para el `.env` | Pedir al responsable copiar líneas a mano | Cada historia agrega variables; copiar a mano en Windows es propenso a errores |
| Cada transacción fija los dos valores de contexto (ataque ronda 1, criterio 72) | Rechazar `options` en `DATABASE_URL_APP` | No cubre un `set_config(…, false)` de un módulo ni los valores por defecto del rol o de la base |
| 400 `SOLICITUD_INVALIDA` para cuerpos no JSON (criterio 74) | 415 | El criterio 42 ya fija 400; un solo formato de error de entrada |
| Límite de inicio de sesión en un middleware antes del lector del cuerpo (criterio 75) | `ThrottlerGuard` en el controlador | El guard corre después del lector: los 400 y 413 de Express no cuentan |
| `NODE_ENV` de una lista cerrada exacta (criterio 78) | Recortar y pasar a minúsculas | Un valor mal escrito debe detener el arranque, no aceptarse en silencio |
| Reglas de texto con propiedades Unicode en contratos (criterios 76 y 77) | Lista de caracteres permitidos | Rechazaría nombres con tildes, ñ u otros alfabetos |
| Rechazar el rol inseguro con la lista completa en la API, `db:crear` y el hook (ataque ronda 2, criterios 80 y 81) | Corregir el rol con `ALTER ROLE` desde `db:crear` | Escondería un servidor mal configurado y exige privilegios que el dueño no tiene en la nube |
| Revocar `TEMPORARY` a `PUBLIC` en una migración nueva y en `db:crear` (criterio 82) | Revocarlo solo a `aquagestion_app`; editar la migración ya aplicada | El privilegio llega por `PUBLIC`; editar una migración aplicada rompe su suma de control |
| Normalizar el SQL y exigir formas cerradas en el lint (criterios 83 y 84) | Analizador completo de SQL | Dependencia pesada; la garantía real es el criterio 72 |
| Cliente en un campo `#prisma` (criterio 86) | `private` de TypeScript | En ejecución sería una propiedad pública |
| `\p{Default_Ignorable_Code_Point}` y U+2800 fuera de los visibles (criterio 87) | Lista de caracteres sueltos | Se queda corta ante el siguiente carácter en blanco |
| Longitudes por puntos de código (criterio 88) | `.length` (UTF-16) | El comando y la API aceptaban textos distintos |
| `Content-Encoding` `identity`, `gzip` o `deflate`; el resto 400 (criterio 89) | 415; admitir `br` | Un solo formato de error de entrada; ningún cliente comprime cuerpos |
| SQL solo en plantillas etiquetadas; el lint analiza solo esas (ataque ronda 3, criterios 92 a 94) | Analizar todo literal de `backend/src` | Bloqueaba código legítimo (`'end'`, `'Set-Cookie'`) y aun así se evadía con `$queryRawUnsafe` |
| Paso de lint aparte con `--no-inline-config` (criterio 96) | `noInlineConfig` en todo `backend/src` | Apagaba los `eslint-disable` legítimos de otras reglas |
| `TimeZone = 'UTC'` con `set_config(…, true)` en cada transacción (criterio 98) | `options` del cliente de `pg`; `SET` al conectar | La URL reemplaza las `options`; un `SET` de conexión se deshace con `RESET ALL` en el pool |
| `retirarVariablesSensibles` en `main.ts` (criterio 99) | En `configurarApp` | Las pruebas corren la API en su mismo proceso y perderían `DATABASE_URL_PRUEBAS` |
| Envoltorio por transacción y cliente creado dentro de `BaseDatos` (criterio 100) | Entregar `Prisma.TransactionClient`; un `Proxy` | `$parent` y `_originalClient` llevan al cliente; un `Proxy` es difícil de probar exhaustivamente |
| `CLOSE ALL` en cada transacción (criterio 101) | `DISCARD ALL` | No se puede dentro de una transacción y borraría las sentencias preparadas del adaptador |
| Lista de privilegios permitidos (criterio 102) | Buscar solo privilegios peligrosos | La lista falla cerrada ante lo no previsto |
| Verificador SCRAM calculado en el cliente (criterio 104) | `SET log_statement = 'none'` | No cubre el mensaje de error de una sentencia fallida |
| UTF-8 estricto con `verify` del lector JSON (criterio 105) | Reemplazar por U+FFFD | El texto guardado no sería el enviado |
| Funciones `async` en el envoltorio y marca de transacción activa (ataque ronda 4, criterio 106) | Quitar `requestTransaction` de la `PrismaPromise`; un `Proxy` | Prisma puede agregar otra propiedad interna; una promesa nativa es una lista cerrada |
| `DateStyle`, `IntervalStyle`, `extra_float_digits` y `bytea_output` por transacción (criterio 107) | Rechazar `options` en la URL; leer las fechas con `::text` | No cubre la base, `ALTER ROLE ALL` ni el archivo del servidor; `::text` se olvida en algún módulo |
| Fecha inválida = bloqueado y 500 (criterio 108) | Tratarla como nula | Abre una cuenta bloqueada |
| Lista de funciones que ejecutan texto más esquemas ajenos (criterio 109) | Analizar el contenido de las cadenas como SQL | Se evade con `chr()`, `format()` o una columna |
| Exenciones con nombre exacto y sin importar pruebas (criterio 110) | Solo excluir del build | `tsx` ejecuta el archivo exento igual |
| Rechazar enlaces simbólicos y resolver con `realpath` (criterio 111) | Que ESLint siga los enlaces | No tiene la opción; `files` es léxico |
| `sql` reconocida por su declaración (ámbito) y validación en el envoltorio (criterio 112) | Prohibir declarar `sql` | Se evade con otro nombre en una función intermedia |
| `Prisma` en `cli/` solo como `Prisma.<nombre fijo>` (criterio 113) | Seguir cada forma de alias | Siempre queda una más (`Reflect`, `Object.*`, `.constructor`) |
| Punto autorizado con fragmentos opacos (criterio 114) | Importar `Prisma` en módulos; reexportar `Prisma.sql`/`join`/`empty` | `raw` y `.constructor` llevan a SQL arbitrario |
| `SET` tras `UPDATE` en la misma sentencia es cláusula (criterio 115) | Documentarlo como limitación | Obligaría a renombrar columnas o apagar la regla |
| Nombres de variables en mayúsculas (criterio 116) | Distinguir mayúsculas | En Windows `PgPassword` es `PGPASSWORD` |
| `cargarEnvRaiz` fuera del `index` y `dotenv` prohibido (criterio 117) | Solo quitarla del `index` | Un módulo importaría el archivo o `dotenv` |
| `git ls-files` y disco en `generated/` (criterio 118) | Solo acotar la exención | Un archivo forzado con `git add -f` seguiría exento |
| Comparar `clave_hash` y `version_token` bajo `FOR UPDATE` antes de emitir la sesión (ataque ronda 5, criterio 120) | Calcular el hash con la fila bloqueada; firmar con la versión releída | Retiene una conexión por intento y serializa; emitiría sesión para una clave que ya no existe |
| `search_path` fijo `pg_catalog, public, pg_temp` y `pg_catalog.` en la primera sentencia y en la comprobación del rol (criterio 121) | Calificar con `public.` todo el SQL; fijar solo `public` | Carga para todas las historias sin protección extra; `pg_temp` quedaría primero para las tablas |
| `standard_conforming_strings = on` por transacción (criterio 122) | Prohibir `\` en las plantillas | Falsos positivos y no cubre la base ni el servidor |
| Rechazar esquemas propios, con `CREATE` o con el nombre del rol (criterio 123) | Rechazar también `USAGE` en otros esquemas | Falsos positivos en hostings con esquemas de extensiones; lo neutraliza el criterio 121 |
| Pruebas de catálogo con listas de excepciones vacías (criterios 124 y 126) | Revisar cada migración a mano | Se olvida; la prueba falla sola |
| Lista permitida, solo paquetes declarados y lista negra (criterios 127 a 129) | Solo lista negra; solo la lista del backend | Siempre aparece un cliente nuevo; los paquetes de otros espacios de trabajo llegan a `node_modules` de la raíz |
| Privilegios de la app en todos los esquemas revisados, sin objetos de extensiones (ataque ronda 6, criterio 130) | Solo `public`; contar también las extensiones | Una vista en otro esquema devolvía todas las academias; las extensiones del hosting darían falsos positivos |
| `EXECUTE` solo en `public` y en esquemas con `USAGE` (criterio 130) | `EXECUTE` en todo esquema | PostgreSQL lo concede a `PUBLIC` por defecto y sin `USAGE` no se puede llamar |
| `USAGE` sobre otro esquema rechazado si tiene objetos propios, con lista permitida vacía (criterio 130) | Rechazar todo `USAGE`; aceptarlo siempre | Esquemas de extensiones del hosting; un esquema propio accesible quedaría sin probar |
| P-31 nuevo en lugar de cambiar `privilegiosDeMas` (criterio 130) | Agregar el esquema a `PrivilegioApp` | Cambiaría P-20 y sus pruebas protegidas |
| Forma exacta de las políticas con `pg_get_expr` y `search_path` fijo (criterio 132) | "Contiene la comparación"; analizar `polqual` como `pg_node_tree` | Lo primero acepta `OR`; lo segundo es un formato interno no documentado |
| Prueba de ejecución que descubre las tablas y usa sembradores explícitos (criterio 133) | Lista fija de tablas; generador automático de filas | Las tablas nuevas quedarían sin probar; un generador no cumple `CHECK` ni llaves compuestas |
| Envoltorio atado con `AsyncLocalStorage` (criterio 134) | Solo lint; atarlo a la petición HTTP | El lint no ve alias; las tareas programadas no tienen petición |
| Regla de la transacción guardada en el lint normal (criterio 135) | En el paso protegido | Cambiaría la lista de reglas del criterio 96; la garantía está en el 134 |
| `SET CONSTRAINTS … DEFERRED/IMMEDIATE` permitido; `lastval`/`currval` prohibidos (criterio 136) | Función en `infraestructura/prisma/`; solo una nota | Es local a la transacción; prohibir los valores de sesión cuesta una entrada en la lista |
| `db:crear` excluye los objetos de extensiones también en `public`, como la API (ataque ronda 7, criterio 137) | Que la API vuelva a contarlos en `public`; unificar en una sola consulta ya | Los hostings instalan extensiones en `public`; unificar cambiaría los mensajes que esperan las protegidas del criterio 102 |
| Prueba de catálogo: ninguna tabla o función propia es objeto de extensión (criterio 137) | Confiar solo en la revisión | `ALTER EXTENSION … ADD` sacaría una tabla de todas las comprobaciones |
| Fila de prueba válida en B (sembrada y borrada) y juicio por lo escrito (criterio 138) | Exigir `42501`; copiar una fila de A y aceptar cualquier error | Falso positivo con disparadores; la copia de A ocultaría una política mal hecha tras un `23505` o `23503` |
| `EventEmitterAsyncResource` y `getBuiltinModule` de `async_hooks` en el lint normal (criterio 139) | Detección en el envoltorio con `createHook`; prohibir `events` | Falsos positivos con los controladores y costo global; los eventos dentro de `trabajo` son legítimos |
| Subconsulta escalar de `app_academia_actual()` aceptada (criterio 140) | Solo la llamada directa | Es la forma recomendada por rendimiento y significa lo mismo |
| Esquemas de extensiones revisados; solo se excluyen los objetos de extensión (ataque ronda 8, criterios 141 y 142) | Excluir el esquema entero; lista fija de esquemas del hosting | Una tabla propia dentro del esquema quedaba fuera de todas las guardas; la lista depende del proveedor y no cubre `ALTER EXTENSION … ADD SCHEMA` |
| Tipo compuesto de extensión reconocido por su `reltype` (criterio 141) | No contar nunca los tipos compuestos; contarlos como propios | Cambiaría el sentido del criterio 130; rechazaría sin motivo esquemas como `topology` |
| Rechazar `user`, `host`, `hostaddr`, `password`, `port`, `dbname` y `database` en la cadena de consulta (criterio 143) | Leer la URL con `pg-connection-string` en `db:crear`; rechazar toda cadena de consulta | El hook no carga `node_modules` y la URL seguiría siendo ambigua; `options` y `sslmode` son necesarios |
| Volatilidad y cuerpo de las funciones de contexto en una prueba de catálogo, más una de ejecución (ataque ronda 9, criterios 144 y 145) | Solo la prueba de ejecución; marcarlas `VOLATILE` | Cuándo se usa el plan genérico depende de PostgreSQL; `VOLATILE` impide usar los índices por `academia_id` |
| Funciones propias que leen el contexto revisadas por el texto de su cuerpo (criterio 144) | Solo `pg_depend` desde las políticas | `pg_depend` no registra las llamadas dentro de otra función |
| `client_encoding`, `synchronous_commit`, `array_nulls` y `transform_null_equals` en la primera sentencia (criterios 146 y 147) | Rechazarlos en `options`; fijar todos los parámetros de sesión | No cubre la conexión, la base ni el servidor; muchos fallan cerrados o exigen superusuario |
| `synchronous_commit = 'on'` fijo (criterio 147) | Aceptar `remote_write` y `remote_apply` | Más código para una diferencia que no es de durabilidad |
| `db:crear` y el hook comparan servidor, puerto y base de `DATABASE_URL_APP` con `DATABASE_URL`, sin resolver nombres (criterio 148) | Revisar la base de `DATABASE_URL_APP`; resolver `localhost` | Dos bases distintas son un error del `.env`; en Windows `localhost` puede ser `::1` |
| Sentencia de comprobación con marca aleatoria `app.transaccion` antes de confirmar (ataque ronda 10, criterios 149 a 151) | Leer la etiqueta del `COMMIT`; registrar errores en el envoltorio; prohibir `catch` por lint | El adaptador descarta la etiqueta; el envoltorio no cubre `enPlataforma` ni un `ROLLBACK` escrito; el lint no sigue funciones ni alias |
| El envoltorio espera sus consultas enviadas antes de comprobar (criterio 149) | Confiar en el orden de la cola de la conexión | Una consulta de un modelo recorre más pasos en Prisma y puede llegar después |
| `ErrorTransaccionAbortada`, 500 (P-36) | Relanzar el error original | `trabajo` ya lo atrapó; con un `ROLLBACK` escrito no hay error original |
| IP sin zona; inválida = la operación falla (criterio 152, opción a) | Guardar `NULL` si no es válida (opción b) | RN-22: con (b), quien controle el texto de la IP registraría operaciones sin IP |
| Duplicados esperados con `ON CONFLICT DO NOTHING RETURNING` (nota O3 ampliada) | Atrapar `esViolacionDeUnicidad` dentro de `trabajo`; `SAVEPOINT` | La transacción queda abortada; `SAVEPOINT` está prohibido por el criterio 84 |
| Cola serial en el envoltorio (ataque ronda 11, criterio 153) | Solo detectar el `undefined`; prohibir `Promise.all` por lint; desactivar los lotes de Prisma | Lo primero rompe código correcto; el lint no sigue funciones; no se conoce una opción documentada y dependería de internos |
| `undefined` de Prisma = `ErrorTransaccionAbortada` (criterio 154) | Resolver con `undefined` y dejar decidir a `trabajo` | Es lo que permitió la falla; segunda capa si la cola falla o Prisma cambia |
| `enPlataforma` sin cola; regla para el equipo (ronda 11) | Envolver la transacción cruda con un `Proxy` | Rompe P-24 y la `PrismaPromise` perezosa de las pruebas de comandos; comandos del equipo, en serie |
| Bloqueo de transacción con `$executeRaw` (criterio 155) | Función propia que devuelva `boolean` | Otra función en `FUNCIONES_APP`, otra migración y otra superficie del criterio 144 |
| El envoltorio acepta llamadas hasta que `asentar` termina; resultado esperado "todo confirmado" (ataque ronda 12, criterio 156) | Rechazar toda llamada posterior a `trabajo`; solo marcarla | Haría fallar con 500 código que se puede completar; la marca queda como segunda capa |
| Ceder un turno con `setImmediate` antes de apagar (criterio 156) | Revisar solo tras las microtareas; esperar un tiempo fijo | Una función `async` con varios `await` llamaría tarde; un tiempo fijo retrasa todo y no garantiza nada |
| Llamada de otro contexto marca solo desde `asentar` (criterio 156) | Marcar siempre; no marcar nunca | Siempre: otra petición podría hacer fallar esta y cambiaría el 134; nunca: una continuación sin contexto repetiría la falla |
| `unhandledRejection` registra y no termina, registrado tras `listen` (criterio 157) | Comportamiento de Node; registrar y terminar; manejar `uncaughtException` | Una caída corta las peticiones de todas las academias; tras una excepción síncrona el proceso no es fiable |
| Punto de guardado por escritura en una capa debajo del envoltorio (criterio 158, opción a) | Dentro del envoltorio; opción (b) marcar ante todo rechazo; solo en escrituras anidadas | Cambiaría las protegidas de P-38; (b) rompe la lista que ignora las inexistentes; clasificar depende de cómo Prisma reparte cada operación |
| Comprobar el estado antes de volver al punto (criterio 158) | Decidir por el código del error | `ROLLBACK TO` saca del estado abortado y ocultaría el error al 149; el SQLSTATE no siempre viaja en el error de Prisma |
| Nombre aleatorio del punto por transacción (criterio 158) | Nombre fijo | Una sentencia tardía en otra transacción podría deshacer una escritura ajena |
| Promesas descartadas prohibidas por lint: `no-floating-promises` con tipos en el normal y regla propia sin tipos en los dos pasos (ataque ronda 13, criterio 159) | `no-floating-promises` en el paso protegido; una sola regla sin tipos; `no-restricted-syntax` | Exige tipos y la protegida del 96 no admite reglas de `typescript-eslint` ahí; sin tipos no se ve una función `async` con nombre; `no-restricted-syntax` ya lo usa la regla del reloj y se pisarían |
| Desde `asentar()`, todo rechazo de una operación entregada marca la transacción aunque se atrape (criterio 160) | Marcar solo los rechazos sin manejar; marcar también mientras `trabajo` corre | No se sabe si alguien atrapará la promesa; rompería la lista que ignora las inexistentes (153) |
| Sin marca por `unhandledRejection` (F1 (c)) | Segunda capa con `AsyncLocalStorage.getStore()` en el manejador | Las promesas del envoltorio no llevan contexto (106); depende de internos de Node que cambian en Node 24; el manejador del proceso taparía rechazos en pruebas y comandos o no lo cubrirían las pruebas |
| Causa limpia en el constructor de `ErrorTransaccionAbortada` (criterio 161) | Limpiar en cada lugar que la crea; no guardar causa | Se olvida en el siguiente; se perdería el SQLSTATE para diagnosticar |
| Lista de lo que se registra de un error de la base, en `errorParaRegistro` (criterio 162) | `redact` de pino; tapar valores con expresiones regulares; limpiar solo en el filtro | `redact` no tapa partes de un texto; las expresiones fallan abiertas; el manejador, `#registrarAbortada` y los comandos también registran |
| `pila` leída después del encabezado exacto `nombre: mensaje`, comparado por igualdad; sin coincidencia, sin `pila` (ataque ronda 14, criterio 163) | Patrón más estricto para los marcos; buscar el mensaje con una expresión o `indexOf`; no registrar nunca la pila | Un valor imita cualquier forma de marco; un mensaje repetido o parcial confunde el corte; se perdería dónde ocurrió el error, que no lleva datos |
| Con `message` vacío, el encabezado es solo `name` (criterio 163) | Exigir siempre `nombre: ` | Así lo escribe V8; omitiría la pila sin motivo |
| Riesgo "Promesa descartada que escapa al lint" corregido, sin mecanismo en ejecución; nota para el revisor (O1) | Marcar todo rechazo no esperado por `trabajo`; regla de lint que siga las variables con promesas | Indistinguible del rechazo atrapado a propósito (153); exige seguir el flujo de datos; valen las razones de la ronda 13 contra F1 (c) |
| Funciones `async` en el lugar pasadas a `nextTick`, `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask`, en la regla propia, por nombre de la propiedad (criterio 164) | Más opciones de `no-misused-promises`; `no-restricted-syntax`; prohibir esas funciones | No revisa parámetros `Function`; se pisaría con la regla del reloj; `asentar()` y los temporizadores legítimos las usan |
| La regla mira a través de `as`, `satisfies`, `!` y `<T>` (criterio 164) | Dejarlo a la revisión | Es la evasión más simple de una regla sin tipos y cuesta unas líneas |
| Errores de la base buscados en todo el grafo del error: propias (enumerables o no, con `Symbol`) y enumerables heredadas (ataque ronda 15, criterio 165) | Agregar `response` y `options` a `cause` y `errors`; serializador `err` propio de pino; limpiar solo en el filtro | Caso por caso, la siguiente librería usa otro nombre; pino no cubre `console.error` ni `mensajeSeguro` y cambiaría el registro de todo `Error` común; el manejador y el arranque también registran |
| Topes de 10 niveles, 200 objetos y 100 claves con falla cerrada (criterio 165; aplicados sin listar de más desde la ronda 16, criterio 167) | Sin topes; devolver el error tal cual al agotarlos | Un getter que crea objetos o un arreglo enorme colgarían el registro; el error de la base podía estar más abajo |
| `mensaje` del `Error` que lleva uno de la base solo si no copia su mensaje, por inclusión en los dos sentidos (criterio 165) | Nunca `mensaje` (indicación del orquestador); comparar por líneas | Cambiaría el resultado de cuatro protegidas de 162 y 163; las líneas cortas de Prisma (`{`, `}`) quitarían casi todo mensaje propio |
| `pila` de esos errores con la regla del 163, omitida si `message` o `stack` contienen el mensaje de la base (criterio 165) | La pila completa; nunca pila | El encabezado lleva el mensaje de Prisma en el patrón de Nest; se perdería dónde se lanzó la excepción |
| `tipo` de un `Error` que no es de la base: `name` igual al de su constructor (criterio 165) | Lista cerrada de la base; lista de excepciones de Nest y propias; el patrón de hoy | Daría `ErrorDeBase` a una excepción de Nest y cambiaría una protegida; se queda corta con cada historia; un `name` asignado a mano pasaría |
| `tipo` de un error de la base de la lista cerrada de P-42, con `ErrorDeBase` para lo demás (criterio 166) | El patrón de hoy | Es la observación O1: un `name` con datos llegaba al registro |
| Sin `money` en las consultas, como regla del plan (O2) | `DecimalError` como error de la base; limpiar todo `Error` común | No es de la base y no se sabe si lleva un valor; perdería el diagnóstico de los errores propios |
| Formas de lint de la ronda 15 al riesgo aceptado (decisión del orquestador) | Ampliar otra vez la regla propia | Alias y formas hostiles sin fin; las cubren la regla para el equipo y el revisor |
| Binarios como hojas, reconocidos por la ranura interna (`ArrayBuffer.isView`, `types.isAnyArrayBuffer`) (ataque ronda 16, criterio 167) | Recorrerlos; falla cerrada ante cualquier binario; reconocerlos con `instanceof` o `Symbol.toStringTag` | Es la falla; perdería el diagnóstico de todo error con un archivo; un objeto común puede imitar el prototipo o la etiqueta para esconder un error de la base |
| Un error con un binario en su grafo se registra convertido (`tipo`, `mensaje`, `pila`, `causa`, `errores`), sin el binario, aunque no lleve errores de la base (R16-1, decisión del orquestador sobre la propuesta del especificador; criterio 167) | Devolver el mismo error; falla cerrada `truncado` | pino escribiría el archivo entero (un comprobante con datos personales, en una línea de decenas de MB); se perderían el mensaje y la pila sin necesidad |
| `length` numérico mayor que 100: falla cerrada sin listar (criterio 167) | Contar con `Reflect.ownKeys` | Crea millones de cadenas: es la falla |
| `Reflect.ownKeys` antes de `for…in`, y `for…in` cortado al pasar el tope (criterio 167; precisión del especificador a "no materializar") | `Object.keys` u `Object.getOwnPropertyNames`; materializar y comparar | También entregan la lista entera; en JavaScript no hay enumeración por partes de las claves propias |
| Límite de 200 ms por llamada y memoria en un hijo con `--max-old-space-size=256` (criterio 167) | Límites ajustados; medir `heapUsed` | Pruebas inestables en una CI lenta o en Windows; el recolector hace no determinista la medida |
| `cause` y `errors` por su nombre en cada objeto visitado (ataque ronda 16, criterio 168) | Solo en el error recibido; todos los getters heredados | pino las lee en cada causa y en cada error de `errors`; pino no lee los demás getters y se ejecutaría código ajeno sin necesidad |
| `cause` función: falla cerrada sin llamarla (criterio 168) | Llamarla y buscar en el resultado; ignorarla | Ejecuta código ajeno al registrar (puede lanzar, colgar, tener efectos o devolver otra cosa a pino); pino la llama |
| `errors` función: ni se llama ni es falla cerrada (criterio 168) | Falla cerrada también | pino no la llama ni la serializa; se perdería diagnóstico sin motivo |
| Quitar el BOM inicial antes de `parseEnv` con una sola función (`analizarEnv`) en todos los lectores de `scripts/`, copiada en el hook y en dos utilidades de prueba (ataque ronda 17, criterio 169) | Usar `dotenv` en los scripts; quitar todos los espacios Unicode al principio de cada línea | El hook corre antes de `npm ci` y no puede cargar `node_modules`; reimplementar `dotenv` a medias |
| `env:completar` da por existente lo que lee `analizarEnv` o lo que `clavesPosiblesEnv` encuentra, y avisa de lo segundo (criterio 170; R17-1 provisional) | Copiar el analizador de `dotenv`; confiar solo en `analizarEnv` | `dotenv` 18 trae dos analizadores internos y cambia con cada versión; cualquier otra diferencia repetiría la falla |
| Solo agregar al final con `appendFileSync` (criterio 170) | Reescribir el archivo normalizado | Cambiaría bytes del usuario (BOM, `\r\n`) y el mensaje "no se modificaron" dejaría de ser cierto |
| `.env` UTF-16: `env:completar` no escribe y termina con 1 (criterio 170, provisional R17-2) | Convertirlo a UTF-8 en el lugar; no detectarlo | Cambia el archivo sin preguntar; agregar UTF-8 a un UTF-16 lo deja ilegible para todos |
| Punto de entrada con `fs.realpathSync` de los dos lados y una ayuda común, copiada en el hook (ataque ronda 17, criterio 171) | `import.meta.main`; `--preserve-symlinks-main` en cada comando; comparar solo el nombre | No está en todas las versiones de Node 22 admitidas; no cubre los hooks de git ni el uso a mano; un script importado con el mismo nombre se ejecutaría |
| `realpath` inyectable en `esPuntoDeEntrada` (criterio 171) | Probar la comparación de Windows solo en la CI de Windows | La regla sin mayúsculas se prueba en cualquier sistema; la CI de Windows confirma con una unión real |
| O2 diferida: sin límite en `GET /api/a/{nombreCorto}` en 001 (ronda 17, decisión del orquestador) | Agregar ya un límite por IP | Depende del hosting (`trust proxy`, límites del proveedor) y de cómo la use la historia 005 |

## Migraciones

- `backend/prisma/migrations/<marca>_academias_aislamiento/migration.sql`: comprobación del rol, tablas, `CHECK`,
  índices, funciones, RLS forzada, políticas y privilegios (sección 2 del diseño).
- `backend/prisma/migrations/<marca>_endurecer_rol_app/migration.sql` _(ataque ronda 2, criterio 82)_: revoca
  `TEMPORARY` sobre la base a `PUBLIC` y `CREATE`/`TEMPORARY` a `aquagestion_app`, y `CREATE` sobre `public` a
  `PUBLIC`; idempotente. Es una migración nueva para no cambiar la suma de control de la ya aplicada en la nube.
- No toca la migración inicial de 000.
- Ronda 3: sin migraciones nuevas. Los privilegios (criterio 102) y los valores por defecto del rol (103) se comprueban;
  no se cambian.
- Ronda 4: sin migraciones nuevas. Los parámetros de formato (criterio 107) se fijan por transacción, no en la base.
- Ronda 5: sin migraciones nuevas. `search_path` y `standard_conforming_strings` se fijan por transacción (criterios 121
  y 122); los esquemas del rol se comprueban, no se cambian (123); las pruebas de catálogo (124 y 126) pasan con las
  migraciones actuales.
- Ronda 6: sin migraciones nuevas. Con las migraciones actuales, los privilegios de la app en todos los esquemas (criterio
  130), las pruebas de catálogo ampliadas (131) y la forma y ejecución de las políticas de `auditoria` y `configuraciones`
  (132 y 133) ya cumplen; si alguna prueba señalara algo, se corrige con una migración nueva.
- Ronda 7: sin migraciones nuevas. Ninguna tabla ni función de las migraciones es objeto de extensión (criterio 137), y
  las políticas de `auditoria` y `configuraciones` cumplen los criterios 138 y 140.
- Ronda 8: sin migraciones nuevas. Las migraciones no crean esquemas ni agregan nada a extensiones, así que la comprobación
  del rol y las pruebas de catálogo con los esquemas de extensiones (criterios 141 y 142) pasan sobre la base de pruebas; la
  validación de las URL (143) es de código.
- Ronda 9: sin migraciones nuevas. `app_academia_actual()` y `app_es_plataforma()` ya son `STABLE` y `resolver_academia`
  es `VOLATILE` (criterio 144); los parámetros de los criterios 146 y 147 se fijan por transacción, y el 148 es de los
  scripts. Si una prueba del 144 señalara algo, se corrige con una migración nueva.
- Ronda 10: sin migraciones nuevas. `app.transaccion` es una variable propia que se fija por transacción, y la IP se
  normaliza en el código; la columna `ip` sigue siendo `inet`.
- Ronda 11: sin migraciones nuevas. La cola y la segunda capa son del envoltorio; el bloqueo del criterio 155 usa funciones
  de PostgreSQL que ya existen.
- Ronda 12: sin migraciones nuevas. Los puntos de guardado son sentencias de la transacción, y el manejador de rechazos es
  del proceso.
- Ronda 13: sin migraciones nuevas. El lint, la marca del envoltorio, la causa limpia y el serializador de errores son
  de código.
- Ronda 14: sin migraciones nuevas. La lectura de la pila y la ampliación de la regla de lint son de código.
- Ronda 15: sin migraciones nuevas. La búsqueda en el grafo, la lista cerrada de `tipo` y `mensajeSeguro` son de código;
  la regla de no usar `money` no toca ninguna tabla (ninguna lo usa).
- Ronda 16: sin migraciones nuevas. El costo acotado de la búsqueda y `cause` y `errors` por su nombre son de código.
- Ronda 17: sin migraciones nuevas. La lectura del `.env` y el punto de entrada son de los scripts y del hook.
- Para el responsable: `npm run db:preparar` crea el rol y aplica la migración; si solo ejecuta `npm run db:migrar`
  sin el rol, la migración falla con el mensaje del criterio 7 y no deja nada a medias (Prisma la marca como fallida:
  la guía explica `npx prisma migrate resolve` o, en desarrollo, `docker compose down -v`).

## Riesgos

- **Transacciones interactivas de Prisma 7 con `@prisma/adapter-pg`:** confirmar que `$transaction(async …)`
  acepta `isolationLevel`, `maxWait` y `timeout` con el adaptador y que `$queryRaw` dentro usa la misma conexión. Si
  no, el implementador se detiene e informa.
- **`resolver_academia` sin la cláusula `SET`** _(actualizado tras T1–T2, 11/11/2026)_: se confirmó que en
  PostgreSQL 16 `CREATE FUNCTION … SET app.plataforma = 'si'` falla si el dueño no es superusuario; se reemplaza por
  `set_config` en tiempo de ejecución con restauración (diseño, sección 2). Riesgo que queda: que la restauración se
  omita en algún camino de salida y la marca de plataforma siga activa en la transacción. Lo cubre el criterio 20
  (después de llamarla, `app.plataforma` no es `si` y `academias` devuelve 0 filas) y la función restaura también en
  el bloque de excepción. Además, `resolverAcademia` corre en su propia transacción corta, que termina enseguida.
- **Migración fallida a medias en una base del responsable:** ver "Migraciones".
- **`CREATEROLE` en la nube** _(precisado tras T1–T2, 11/11/2026)_: el dueño (`aquagestion`) no lo tiene; el rol
  `aquagestion_app` lo crea el hook como `postgres`. En Windows lo crea `db:crear` con el superusuario del contenedor
  de Docker y en la CI, con el usuario del servicio (diseño, sección 1). Si `runuser` no está en la nube, el paso
  falla con el motivo (spec 000).
- **Rendimiento de las políticas:** `app_academia_actual()` es `STABLE` y la comparación usa los índices que empiezan
  por `academia_id`; las historias con tablas grandes deben crear esos índices. Marcarla `IMMUTABLE` para ganar
  rendimiento mezcla academias (ataque ronda 9): lo impide el criterio 144; se usa la subconsulta del criterio 140.
- **`client_encoding` local a la transacción** _(ataque ronda 9)_: se espera que PostgreSQL 16 lo acepte con
  `set_config(…, true)` y que `pg` ignore el `ParameterStatus`; si no, el backend se detiene e informa (sección 21).
- **Pruebas protegidas anteriores de `db:crear`** _(ataque ronda 9)_: el criterio 148 obliga a adaptar su
  `DATABASE_URL_APP`; lo hace el test-writer en el commit de pruebas protegidas, sin cambiar lo que comprueban.
- **Binarios de `@node-rs/argon2` en Windows:** primera dependencia nativa en uso; la CI de Windows lo detecta.
- **Librería de JWT en CommonJS:** NestJS compila a CommonJS; elegir una librería que se pueda `require` (por ejemplo
  `jsonwebtoken` o `@nestjs/jwt`).
- **Límite por IP:** `req.ip` sin `trust proxy` es la del socket; queda para el hosting. _(Ataque ronda 17, O2: también
  queda para el hosting y la historia 005 el límite de `GET /api/a/{nombreCorto}`, sección 29.)_
- **Lector del cuerpo de Nest** _(ataque ronda 1)_: el orden de los middlewares del criterio 75 depende de cómo la
  versión instalada de Nest registra su lector (`bodyParser: false` o nombres `jsonParser`/`urlencodedParser`). Si
  no se puede lograr sin cambiar las utilidades protegidas, el backend se detiene e informa.
- **Lint por texto** _(ataque ronda 1)_: la regla del criterio 73 no ve SQL concatenado ni pasado en variables; la
  garantía real es el criterio 72.
- **Pruebas de roles en la nube** _(ataque ronda 2)_: el usuario de pruebas de la nube no puede crear roles, así que
  las pruebas de integración de los criterios 80 y 81 se omiten con aviso ahí y corren en la CI (y en Docker); la
  unitaria de la función que decide corre en todas partes. El tester confirma el rojo de la integración en la CI.
- **Revocar `TEMPORARY` en bases ajenas** _(ataque ronda 2)_: si la base del hosting la crea otro usuario, la
  migración y `db:crear` fallan con un mensaje claro; la guía de despliegue lo documenta (D-21).
- **`eslint-disable` que no apaga reglas** _(ataque ronda 2)_: `noInlineConfig` apaga también los `eslint-disable`
  legítimos de esos archivos; si molesta, se usa el plugin de comentarios con la lista de reglas protegidas.
  _(Resuelto en la ronda 3 con el paso aparte del criterio 96.)_
- **Rutas de la configuración aparte** _(ataque ronda 3)_: con `--config`, la base de las rutas de `files` depende de
  la versión de ESLint; por eso el archivo va en la raíz. Si con la versión instalada no coincide, fijar `basePath` o
  detenerse e informar.
- **Métodos `#` y prototipo congelado con Nest** _(ataque ronda 3)_: confirmar que el `target` de TypeScript emite
  métodos privados nativos (ES2022 o posterior) y que Nest no escribe en el prototipo de `BaseDatos` al crear la
  instancia. Si no, detenerse e informar.
- **`CLOSE ALL` con el adaptador** _(ataque ronda 3)_: confirmar que `` $executeRaw`CLOSE ALL` `` corre en la
  conexión de la transacción interactiva. Cuesta un viaje más a la base por transacción; se acepta.
- **Lectura de `pg_db_role_setting` como la app** _(ataque ronda 3)_: es un catálogo legible por todos en PostgreSQL
  16; si en algún servidor no lo es, la comprobación falla cerrada (sin fila = rol inseguro) y el backend lo informa.
- **PostgreSQL 17 o posterior** _(ataque ronda 3)_: agrega el privilegio `MAINTAIN`; la lista del criterio 102 se
  amplía cuando se cambie de versión (hoy es la 16).
- **Prueba de arranque en proceso hijo** _(ataque ronda 3, criterio 99)_: depende de `tsx` y de un puerto libre; si es
  lenta en la CI de Windows, se marca para correr solo en Linux con aviso.
- **Forma de los errores de Prisma 7 con el adaptador** _(ataque ronda 4, criterio 114)_: dónde viaja el SQLSTATE de
  una violación de unicidad (`P2002` con `meta`, o un error del adaptador dentro de `$queryRaw`) depende de la versión.
  La prueba de integración fija la forma real; si no se encuentra el código, el backend se detiene e informa en vez de
  adivinar.
- **`ALTER SYSTEM` en las pruebas** _(ataque ronda 4, criterio 107)_: cambia el servidor entero mientras dura la
  prueba; los archivos de integración ya corren sin paralelismo, y la prueba restaura con `ALTER SYSTEM RESET` y
  `pg_reload_conf()` en un `finally` y en `afterAll`. Si en la CI de Windows el contenedor no lo permite, se omite con
  aviso.
- **Ámbito de ESLint con `typescript-eslint` sin tipos** _(ataque ronda 4, criterios 112 y 113)_: `getScope` y
  `findVariable` funcionan con el analizador de TypeScript sin información de tipos; confirmar que una importación
  `import type` no se cuenta como valor (su definición es `ImportBinding` con `importKind: 'type'`).
- **Tipo de `ClienteTransaccion`** _(ataque ronda 4)_: la sobrecarga con `Fragmento` y las promesas nativas pueden
  romper la asignación desde `Prisma.TransactionClient` en `enPlataforma` (sección 16). Si toca una prueba protegida, el
  backend se detiene e informa.
- **Esquemas en la base de pruebas de la nube** _(ataque ronda 5, criterios 121 y 123)_: las pruebas necesitan que el
  dueño cree esquemas (`CREATE` sobre la base); si no puede, se omiten con aviso y corren en Docker y en la CI. Los casos
  con `AUTHORIZATION aquagestion_app` exigen superusuario.
- **Doble de `BaseDatos` para el criterio 120** _(ataque ronda 5)_: construir el `BaseDatos` real dentro del doble
  depende de cómo Nest entrega `ENTORNO` y `PinoLogger`; si no se logra sin tocar utilidades protegidas, el test-writer
  se detiene e informa.
- **Hosting con `CREATE` sobre esquemas de extensiones para `PUBLIC`** _(ataque ronda 5, criterio 123)_: la API no
  atendería datos y `db:crear` se detendría con la corrección (`REVOKE CREATE ON SCHEMA … FROM PUBLIC`). Se revisa con el
  hosting (D-21).
- **`express` declarado en el backend** _(ataque ronda 5, criterio 128)_: si el rango no coincide con el de
  `@nestjs/platform-express`, npm instala dos copias y los tipos o los middlewares pueden no coincidir; confirmar con
  `npm ls express` en la nube y en la CI de Windows.
- **`AsyncLocalStorage` con Prisma y Nest** _(ataque ronda 6, criterio 134)_: confirmar que el contexto se conserva a
  través de `$transaction(async …)` del adaptador y de `nestjs-pino` (que usa su propio almacén), y que la prueba del
  criterio 106 con 20 consultas en `Promise.all` sigue pasando. Si alguna protegida anterior falla por el contexto, el
  backend se detiene e informa.
- **`SET LOCAL ROLE` en la autocomprobación del criterio 133** _(ataque ronda 6)_: exige que el dueño sea superusuario o
  miembro de `aquagestion_app`; en la nube se omite con aviso y corre en Docker y en la CI.
- **Texto de `pg_get_expr` entre versiones** _(ataque ronda 6, criterio 132)_: la forma de los paréntesis puede variar
  entre versiones mayores de PostgreSQL; la autocomprobación con los ejemplos lo detecta al cambiar de versión (hoy la 16).
- **Comportamiento de Prisma 7 ante una transacción abortada** _(ataque ronda 10)_: el diseño supone que una sentencia
  sobre una transacción abortada rechaza con un error cuyo SQLSTATE `codigoDeErrorDeBase` reconoce (`25P02`) y que, al
  lanzar dentro del callback, Prisma revierte y rechaza con ese error aunque PostgreSQL ya haya cerrado la transacción (caso
  del `ROLLBACK` escrito). Si el SQLSTATE no llega o Prisma se comporta distinto, el backend se detiene e informa en vez de
  adivinar (la marca sigue detectando el caso: falla cerrada).
- **Una sentencia más por transacción** _(ataque ronda 10)_: cuesta un viaje a la base en cada operación que termina bien
  (como `CLOSE ALL`, criterio 101); se acepta. Si alguna prueba protegida anterior con tiempos ajustados (criterios 24, 106
  o 134) cambiara de resultado, el backend se detiene e informa.
- **Lotes de Prisma** _(ataque ronda 11)_: el diseño supone que Prisma solo agrupa consultas pendientes a la vez en la
  misma transacción, y que con una sola pendiente el lote es de una (criterio 153). La prueba unitaria de la cola no
  depende de Prisma y las de integración reproducen los tres casos del ataque; si con la cola alguna reproducción sigue
  perdiendo escrituras, el backend se detiene e informa (la segunda capa, criterio 154, hace fallar cerrado mientras tanto).
- **Cola serial y tiempos** _(ataque ronda 11)_: entregar de una en una agrega un salto de microtareas por consulta y quita el
  lote de Prisma (que dentro de la transacción ya ejecutaba las consultas una tras otra). Si una prueba protegida anterior con tiempos ajustados (criterios 24, 106, 134, 149) cambiara de
  resultado, el backend se detiene e informa.
- **Puntos de guardado con el adaptador de Prisma 7** _(ataque ronda 12, criterio 158)_: el diseño supone que
  `SAVEPOINT`, `RELEASE SAVEPOINT` y `ROLLBACK TO SAVEPOINT` corren con `$executeRaw` en la conexión de la transacción
  interactiva, que Prisma 7.10.1 no emite sus propios puntos de guardado en esas operaciones y que, al rechazar una
  escritura con un error que no es de la base, no le quedan sentencias pendientes de esa operación. La reproducción del
  caso 1 lo comprueba; si no se cumple, el backend se detiene e informa (no pasa a la opción b sin una decisión nueva).
- **Turno extra en cada transacción** _(ataque ronda 12, criterio 156)_: `asentar` cede al menos un `setImmediate` antes
  de confirmar (fracciones de milisegundo). Si una prueba protegida anterior con tiempos ajustados cambiara de
  resultado, el backend se detiene e informa.
- **Manejador de rechazos y el registro de pino** _(ataque ronda 12, criterio 157)_: el `err` de un error de Prisma puede
  llevar en su mensaje parte de los argumentos (como hoy en el filtro de errores para un 500). Si la configuración de
  pino del proyecto redacta campos, el manejador usa la misma; si no, se revisa con la historia que agregue datos
  personales (002). _(Resuelto en la ronda 13: criterio 162, `errorParaRegistro`.)_
- **`no-floating-promises` con `checkThenables`** _(ataque ronda 13, criterio 159)_: puede señalar objetos con `then` que
  no son promesas o lugares del código actual que hoy pasan. El backend corrige las promesas descartadas de verdad y se
  detiene e informa ante un falso positivo, sin apagar la regla. El lint con tipos de `backend/src` ya corre hoy
  (`recommendedTypeChecked`), así que no agrega tiempo apreciable.
- **Forma de los errores de Prisma 7 en el registro** _(ataque ronda 13, criterio 162)_: el diseño supone que los
  errores de Prisma son instancias de las cinco clases del cliente generado (o llevan su `name`), que el del adaptador se
  llama `DriverAdapterError` y que `meta.modelName` es el nombre del modelo. Las pruebas usan errores reales; si alguno no
  se reconoce como error de la base, el backend lo agrega a `esErrorDeBase` (falla cerrada: mientras tanto, la prueba
  muestra el valor y queda en rojo).
- **Rechazos de la API en las pruebas de Vitest** _(ataque ronda 13, criterio 160)_: la reproducción con `void` dejaría un
  rechazo sin manejar que Vitest informa como error de la corrida; por eso la prueba atrapa la función con `.catch`, que en
  ejecución es lo mismo para el envoltorio.
- **Encabezado de la pila de los errores reales de Prisma** _(ataque ronda 14, criterio 163)_: el diseño supone que el
  `stack` de los errores de Prisma 7 y del adaptador empieza con `nombre: mensaje` tal como se leen al registrar (V8 forma
  la primera línea al leer `stack` por primera vez). Si algún error real no coincide, sale sin `pila`: las pruebas de
  seguridad siguen pasando (no exigen `pila` en los errores reales), pero se pierde el diagnóstico. El backend lo informa
  si lo nota en las pruebas de integración (por ejemplo, que (a), (b) o (c) salen sin `pila`); no se relaja la comparación
  sin una decisión nueva.
- **Valores que PostgreSQL no repite** _(ataque ronda 14, criterio 163)_: las reproducciones (a) y (c) dependen de que
  PostgreSQL 16 repita el valor rechazado en el mensaje y de que Prisma lo copie al `stack`. La prueba lo comprueba antes
  (si no se reproduce, el test-writer se detiene e informa, en vez de dejar una prueba que pasa sin probar nada).
- **Forma de las excepciones de Nest 12** _(ataque ronda 15, criterio 165)_: el diseño y las reproducciones suponen que
  `new InternalServerErrorException(objeto)` y `new HttpException(objeto, 503)` guardan el objeto tal cual en `response` y
  copian `response.message` a `message` (`HttpException.createBody` e `initMessage`). La prueba lo comprueba antes en (u1);
  si la versión instalada se comporta distinto, el test-writer se detiene e informa en vez de dejar una prueba que pasa
  sin probar nada.
- **Nombres reales de Prisma 7 fuera de la lista** _(ataque ronda 15, criterio 166)_: si algún error real de Prisma o del
  adaptador tiene un `name` que no está en la lista cerrada (por ejemplo, otra clase `PrismaClient…`), su `tipo` pasa a
  `ErrorDeBase` y las protegidas de 162 y 163 que comparan `tipo` con `name` en los `PrismaClient…` reales fallarían. El
  backend se detiene e informa; ampliar la lista es una decisión nueva.
- **`for…in` y el lint** _(ataque ronda 15, criterio 165)_: recorrer las enumerables heredadas puede chocar con
  `guard-for-in` o con reglas de `typescript-eslint` sobre `for…in`; si pasa, se usa la forma equivalente con
  `Object.getPrototypeOf` y `Object.keys` por prototipo, sin apagar la regla.
- **Costo de la búsqueda en el registro** _(ataque ronda 15, criterio 165)_: hasta 200 objetos y 100 claves por objeto en
  cada registro de un 5xx o de un rechazo sin manejar; despreciable frente a la petición que falló, y no corre en las que
  terminan bien. Si una prueba protegida con tiempos ajustados cambiara de resultado, el backend se detiene e informa.
  _(Corregido tras la ronda 16, F1, criterio 167: no era así; el tope se comparaba después de juntar todas las claves, y
  un `Buffer` de 5 MB costaba 6,9 s y 707 MB. Desde la sección 28, el trabajo por objeto es de 101 claves como máximo,
  salvo lo que el motor tarde en entregar `Reflect.ownKeys` de un objeto sin `length` con muchas claves (riesgo aceptado
  "Objetos sin `length` con millones de claves" de la spec).)_
- **Tiempos de las pruebas en la CI** _(ataque ronda 16, criterio 167)_: el límite de 200 ms por llamada supone que
  `Reflect.ownKeys` de un objeto de 500 000 claves con nombre ((t5)) y la lectura de `length` tardan bastante menos. Si en
  la CI de Windows algún caso pasa del límite con el código corregido, el backend se detiene e informa con las medidas; no
  se sube el límite ni se achica el caso sin una decisión nueva. _(Precisión del orquestador, ronda 16: esa decisión ya
  se tomó para (t5). `Reflect.ownKeys` cuesta ≈0,5 µs por clave: 500 000 claves, ≈245 ms, más que el límite con
  cualquier código; (t5) pasa a 50 000 claves (≈25 ms) y el tamaño mayor queda en el riesgo aceptado "Objetos sin
  `length` con millones de claves".)_
- **`tsx` en el proceso hijo** _(ataque ronda 16, criterio 167)_: (t11) supone que `registro-de-errores.ts` y el cliente
  generado de Prisma cargan con `--import tsx` en Node 22, como `superadmin`. Si no cargan, el test-writer se detiene e
  informa (alternativa: compilar con `tsc` como `rechazos-proceso.test.ts`, más lento).
- **Clases de prueba con `cause` como getter o método** _(ataque ronda 16, criterio 168)_: TypeScript rechaza sobrescribir
  la propiedad `cause` de `Error` con un accessor o un método (TS2610/TS2425); la prueba los define con
  `Object.defineProperty` sobre el prototipo, que es lo que haría el código compilado. No es una diferencia de
  comportamiento.
- **`parseEnv` y `dotenv` con `\r\n` y comillas** _(ataque ronda 17, criterio 169)_: la coherencia del conjunto (a) supone
  que, sin el BOM, `parseEnv` de Node 22 y `dotenv` 18 dan las mismas claves y los mismos valores con `\r\n`, comillas,
  `export` y comentarios. Si alguno difiere, el test-writer se detiene e informa; no se cambia el conjunto sin una
  decisión nueva.
- **Uniones y enlaces en la CI de Windows** _(ataque ronda 17, criterio 171)_: `fs.symlinkSync(…, 'junction')` no pide
  permisos de administrador, pero el enlace a un archivo de (p3) sí; si la CI no puede crearlos, esos casos se omiten
  allí con el motivo (criterio 171). Si el `realpathSync` de una unión no coincide con la ruta que Node da a
  `import.meta.url` (por ejemplo, por la letra de la unidad), el backend se detiene e informa.
- **(r5) depende de `npm`** _(ataque ronda 17, criterio 171)_: el script intenta compilar en una carpeta sin
  `package.json` y solo se mira que lo anuncie; si `npm` no está en el `PATH` del hijo, el mensaje sale igual (se imprime
  antes de lanzarlo).
- **Pruebas de concurrencia (criterios 24, 40, 50, 54):** dependen del tamaño del pool y pueden ser lentas en la CI;
  mantener 10 a 50 operaciones y un `testTimeout` holgado.
