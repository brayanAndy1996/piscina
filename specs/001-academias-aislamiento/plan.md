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
├── eslint/regla-acceso-base.mjs         nuevo, ataque ronda 2: import(), require, pg y @prisma (criterio 85)
├── .github/workflows/ci.yml             + DATABASE_URL_APP y JWT_SECRETO en Linux (y en el E2E)
├── .claude/hooks/preparar-sesion.mjs    + creación del rol aquagestion_app (criterio 8); ronda 2: atributos (81)
├── scripts/
│   ├── lib/entorno.mjs                  + leerUrlApp(), urlAppSobre(base)
│   ├── lib/rol-app.mjs                  nuevo, ataque ronda 2: consulta y evaluación del rol (criterio 81)
│   ├── crear-bases.mjs                  + asegurarRolApp() (criterio 6); ronda 2: lista completa y TEMPORARY (81, 82)
│   ├── completar-env.mjs                nuevo (criterio 63)
│   └── test/…                           pruebas de lo anterior; actualización de migraciones.test.mjs (criterio 65)
├── packages/contratos/src/
│   ├── academias.ts · plataforma.ts     nuevos (+ *.test.ts)
│   ├── texto.ts                         nuevo, ataque ronda 1: reglas de texto (criterios 76, 77)
│   └── error-api.ts                     + detallesValidacionSchema
├── backend/
│   ├── package.json                     + @node-rs/argon2, @nestjs/jwt (o jsonwebtoken), @nestjs/throttler, cookie-parser
│   ├── prisma/schema.prisma             modelos Academia, Superadmin, Auditoria, AuditoriaPlataforma, Configuracion
│   ├── prisma/migrations/<marca>_academias_aislamiento/migration.sql
│   ├── prisma/migrations/<marca>_endurecer_rol_app/migration.sql   nuevo, ataque ronda 2 (criterio 82)
│   ├── prisma/seed.ts                   academias de ejemplo y superadmin de desarrollo (criterio 61)
│   ├── src/infraestructura/entorno/     + DATABASE_URL_APP, JWT_SECRETO, DATABASE_POOL_MAX (criterio 5)
│   ├── src/infraestructura/prisma/      BaseDatos, PrismaService interno, errores, verificación del rol
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
  ningún método ni getter lo devuelve.
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

## Migraciones

- `backend/prisma/migrations/<marca>_academias_aislamiento/migration.sql`: comprobación del rol, tablas, `CHECK`,
  índices, funciones, RLS forzada, políticas y privilegios (sección 2 del diseño).
- `backend/prisma/migrations/<marca>_endurecer_rol_app/migration.sql` _(ataque ronda 2, criterio 82)_: revoca
  `TEMPORARY` sobre la base a `PUBLIC` y `CREATE`/`TEMPORARY` a `aquagestion_app`, y `CREATE` sobre `public` a
  `PUBLIC`; idempotente. Es una migración nueva para no cambiar la suma de control de la ya aplicada en la nube.
- No toca la migración inicial de 000.
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
  por `academia_id`; las historias con tablas grandes deben crear esos índices.
- **Binarios de `@node-rs/argon2` en Windows:** primera dependencia nativa en uso; la CI de Windows lo detecta.
- **Librería de JWT en CommonJS:** NestJS compila a CommonJS; elegir una librería que se pueda `require` (por ejemplo
  `jsonwebtoken` o `@nestjs/jwt`).
- **Límite por IP:** `req.ip` sin `trust proxy` es la del socket; queda para el hosting.
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
- **Pruebas de concurrencia (criterios 24, 40, 50, 54):** dependen del tamaño del pool y pueden ser lentas en la CI;
  mantener 10 a 50 operaciones y un `testTimeout` holgado.
