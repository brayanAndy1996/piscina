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
├── .claude/hooks/preparar-sesion.mjs    + creación del rol aquagestion_app (criterio 8); ronda 2: atributos (81)
├── scripts/
│   ├── lib/entorno.mjs                  + leerUrlApp(), urlAppSobre(base); ronda 8: parámetros de conexión en la
│   │                                    cadena de consulta (criterio 143, P-34)
│   ├── lib/rol-app.mjs                  nuevo, ataque ronda 2: consulta y evaluación del rol (criterio 81);
│   │                                    ronda 3: privilegios, valores por defecto y verificador SCRAM (102 a 104)
│   ├── lib/dependencias-backend.mjs     nuevo, ataque ronda 5: lista permitida y lista negra (criterios 127 a 129)
│   ├── crear-bases.mjs                  + asegurarRolApp() (criterio 6); ronda 2: lista completa y TEMPORARY (81, 82);
│   │                                    ronda 5: esquemas del rol (123)
│   ├── completar-env.mjs                nuevo (criterio 63)
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
- **Pruebas de concurrencia (criterios 24, 40, 50, 54):** dependen del tamaño del pool y pueden ser lentas en la CI;
  mantener 10 a 50 operaciones y un `testTimeout` holgado.
