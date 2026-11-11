# 000 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md), D-25, D-26.

Versiones: se usa la versión estable vigente de cada herramienta al implementar, fijada por `package-lock.json`. Las
notas sobre versiones de este plan son orientativas; si la documentación oficial dice otra cosa, manda la
documentación, y el implementador lo informa.

## Módulos afectados

```
piscina/
├── package.json                  workspaces, engines, scripts de la raíz, devDependencies comunes
├── package-lock.json
├── .npmrc                        engine-strict=true
├── .nvmrc                        22
├── .editorconfig                 LF, UTF-8, 2 espacios
├── .gitattributes                * text=auto eol=lf; binarios
├── .gitignore
├── .prettierrc.json · .prettierignore
├── eslint.config.mjs             configuración plana para todo el monorepo
├── eslint/regla-reloj.mjs        restricción de new Date()/Date.now(), exportada para probarla
├── tsconfig.base.json            strict, noUncheckedIndexedAccess, noImplicitOverride…
├── vitest.config.ts              proyectos: contratos, backend-unit, backend-integracion, frontend, scripts
├── docker-compose.yml
├── .env.example
├── .husky/pre-commit             npx lint-staged
├── .husky/commit-msg             verificar-pruebas-protegidas en modo "preparados"
├── .claude/settings.json         + hooks.SessionStart (combinar, no reemplazar)
├── .claude/hooks/preparar-sesion.mjs
├── .github/workflows/ci.yml
├── .github/pull_request_template.md
├── packages/contratos/
│   ├── package.json · tsconfig.json · tsup.config.ts
│   └── src/index.ts · src/salud.ts · src/error-api.ts (+ *.test.ts)
├── backend/
│   ├── package.json · tsconfig.json · tsconfig.build.json · nest-cli.json · vitest.config.ts
│   ├── prisma.config.ts          (si la versión de Prisma lo usa)
│   ├── prisma/schema.prisma · prisma/migrations/<marca>_inicial/migration.sql · prisma/seed.ts
│   ├── src/main.ts · src/app.module.ts · src/crear-app.ts
│   ├── src/infraestructura/entorno/      validación zod de variables de entorno
│   ├── src/infraestructura/prisma/       PrismaService (módulo global)
│   ├── src/infraestructura/reloj/        Reloj, RELOJ, RelojSistema, RelojFijo, RelojModule (global)
│   ├── src/infraestructura/registro/     configuración de pino (redacción)
│   ├── src/comun/filtros/                filtro global de errores → ErrorApi
│   ├── src/modulos/salud/                salud.module · salud.controller · salud.service
│   └── test/integracion/salud/ · test/utilidades/ (preparación de la base de pruebas)
├── frontend/
│   ├── package.json · tsconfig.json · vite.config.ts · index.html
│   └── src/main.tsx · App.tsx · rutas/ · modulos/inicio/ · api/ · estilos.css
├── e2e/
│   ├── package.json · playwright.config.ts
│   └── pruebas/inicio.spec.ts
├── scripts/
│   ├── package.json
│   ├── crear-bases.mjs · verificar-pruebas-protegidas.mjs · verificar-sin-secretos.mjs
│   ├── lib/ (lectura de .env, git sin shell, detección de marca)
│   └── test/ (*.test.mjs)
└── docs/guia-local-windows.md
```

`backend/src/modulos/configuracion/` queda reservado para la configuración por academia (001/003). Por eso las
variables de entorno van en `infraestructura/entorno/`.

## Diseño

### Raíz y workspaces

- `package.json` raíz privado con `"workspaces": ["packages/contratos", "backend", "frontend", "e2e", "scripts"]`
  (contratos primero), `"engines": { "node": ">=22.12.0 <23" }` y `.npmrc` con `engine-strict=true`. Si npm no
  bloquea la versión de la raíz con `engine-strict`, se agrega un `preinstall` en Node que compara
  `process.versions.node` y termina con un mensaje en español.
- Un solo `.env` en la raíz, leído por el backend, Prisma, Vite, Playwright y los scripts. Se carga con `dotenv` sin
  sobrescribir (las variables ya definidas, como las de la CI, mandan). Vite usa `envDir` apuntando a la raíz.
- Herramientas multiplataforma en los scripts: `concurrently` para `dev`, `cross-env` para variables, y Node para
  copiar o borrar archivos (`rimraf` o `fs.rm` si hiciera falta).
- Scripts de la raíz (orientativo):
  - `dev`: `concurrently` con contratos (`tsup --watch`), backend (`nest start --watch`) y frontend (`vite`), con
    nombres y colores, y `--kill-others-on-fail`.
  - `build`: contratos → backend → frontend (`npm run build -w …` en orden).
  - `test`: `vitest run` con todos los proyectos. `test:unit`: `vitest run --project` excluyendo
    `backend-integracion`.
  - `e2e`: `npm run test -w @aquagestion/e2e`.
  - `lint`: `eslint . --max-warnings 0`. `typecheck`: `tsc --noEmit` por workspace (`npm run typecheck --workspaces`).
  - `format` / `format:check`: Prettier.
  - `db:crear`, `db:migrar` (`prisma migrate deploy` sobre `DATABASE_URL`), `db:migrar:pruebas` (lo mismo con
    `DATABASE_URL_PRUEBAS`, usando `cross-env` o un script en Node), `db:migracion` (`prisma migrate dev`),
    `db:semilla`, `db:preparar`.
  - `verificar:pruebas-protegidas`, `verificar:sin-secretos`.
  - `prepare`: `husky`.
- Contratos antes que todo: `dev`, `test`, `typecheck` y `build` compilan contratos primero (por ejemplo con un
  `pre<script>` o encadenando), para que en un clon recién instalado funcionen sin pasos extra.

### Contratos (`packages/contratos`)

- zod (versión estable vigente). `respuestaSaludSchema`, `errorApiSchema` y sus tipos con `z.infer`.
- Compilación con `tsup` a ESM y CommonJS, con tipos, y `exports` con condiciones `import` y `require`. El backend
  (NestJS en CommonJS) usa la salida CommonJS; Vite y Vitest, la ESM.
- Pruebas unitarias mínimas de los esquemas (acepta lo válido, rechaza lo inválido).

### Backend

- **Arranque (`main.ts` y `crear-app.ts`):** `crear-app.ts` arma la aplicación (para reutilizarla en las pruebas de
  integración con `supertest`): `setGlobalPrefix('api')`, `helmet()`, sin `enableCors`, `disable('x-powered-by')`
  si `helmet` no lo quitara, logger de `nestjs-pino`, filtro global de errores y `enableShutdownHooks()`. `main.ts`
  valida el entorno, crea la app y escucha en `PUERTO_API`.
- **Rutas fuera de `/api`:** con el prefijo global, Nest responde 404 a todo lo demás; el filtro lo convierte en
  `ErrorApi` `NO_ENCONTRADO`.
- **Filtro de errores (`comun/filtros/`):** `HttpException` 404 → `NO_ENCONTRADO`; otras `HttpException` → código
  derivado del estado (por ejemplo `SOLICITUD_INVALIDA` para 400), manteniendo el estado; cualquier otra excepción →
  500 `ERROR_INTERNO`, registrando el error completo en el log y sin exponerlo. Pruebas unitarias del filtro.
- **Entorno (`infraestructura/entorno/`):** esquema zod de `DATABASE_URL` (protocolo `postgresql:` o `postgres:`),
  `PUERTO_API` (entero 1–65535, por defecto 3000) y `NODE_ENV`. Ante un error, imprime solo el nombre de la variable
  y el motivo ("falta", "no es una URL de PostgreSQL") y termina con `process.exit(1)`. Función pura
  `validarEntorno(env)` con pruebas unitarias; `main.ts` la usa.
- **Registro (`infraestructura/registro/`):** `nestjs-pino` con `redact` para `req.headers.cookie`,
  `req.headers.authorization` y `res.headers["set-cookie"]`; `pino-pretty` solo en desarrollo; nivel `silent` en
  pruebas salvo en la prueba de redacción, que captura la salida con un destino en memoria.
- **Prisma:**
  - `schema.prisma` sin modelos, `datasource db { provider = "postgresql" }`.
  - Si la versión vigente es Prisma 7: `prisma.config.ts` con `import "dotenv/config"` apuntando al `.env` de la
    raíz, generador `prisma-client` con `moduleFormat = "cjs"` y salida en `backend/src/generated/prisma/`
    (ignorada por git y por ESLint), y el adaptador `@prisma/adapter-pg`. Con Prisma 6, el generador clásico
    `prisma-client-js` y la URL en el esquema.
  - El cliente se genera en el `postinstall` del workspace `backend`, así `npm ci` lo deja listo.
  - `PrismaService` (módulo global) extiende el cliente; no conecta en `onModuleInit` (conexión perezosa, para que la
    API arranque con la base caída) y desconecta en `onModuleDestroy`. 001 lo ampliará para fijar la academia.
  - Migración inicial `<marca>_inicial/migration.sql` creada con `prisma migrate dev --create-only --name inicial`,
    con solo un comentario: `-- Migración inicial: sin tablas (D-17, spec 000).` Si Prisma rechaza un archivo sin
    sentencias, se usa `SELECT 1;`.
  - `seed.ts` que solo imprime "Sin datos de ejemplo todavía." (`db:semilla` lo ejecuta con `tsx`).
- **Salud (`modulos/salud/`):** `SaludService.comprobar()` ejecuta `SELECT 1` con `$queryRaw` y una carrera contra un
  temporizador de 2 s (`Promise.race`, limpiando el temporizador). El controlador responde 200 o 503 según el
  resultado, con `Cache-Control: no-store`, y tipa la respuesta con `RespuestaSalud`. Prueba unitaria con un doble de
  Prisma que nunca resuelve, usando temporizadores falsos de Vitest.
- **Reloj (`infraestructura/reloj/`):** `export const RELOJ = Symbol('RELOJ')`; `interface Reloj { ahora(): Date }`;
  `RelojSistema` (`new Date()`); `RelojFijo` con `constructor(inicial: Date)`, `fijar(fecha)` y
  `avanzar(milisegundos)`, que devuelve copias para que nadie mute la hora interna. `RelojModule` global que provee
  `RELOJ` con `RelojSistema`. Las pruebas lo reemplazan con `overrideProvider(RELOJ).useValue(new RelojFijo(…))`.
- **Regla del reloj en ESLint:** `eslint/regla-reloj.mjs` exporta la configuración de `no-restricted-syntax` con dos
  selectores (`NewExpression[callee.name='Date'][arguments.length=0]` y
  `CallExpression[callee.object.name='Date'][callee.property.name='now']`) y el mensaje "Usa el reloj inyectable
  (RELOJ) en lugar de la hora del sistema." Se aplica a `backend/src/**/*.ts` excepto `backend/src/infraestructura/reloj/**`
  y `*.test.ts`. Se prueba con la clase `Linter` de ESLint y esa configuración, sin información de tipos.

### Pruebas (Vitest)

- `vitest.config.ts` en la raíz con `test.projects` (o el mecanismo vigente de Vitest para varios proyectos):
  - `contratos`, `scripts` y `backend-unit` (`backend/src/**/*.test.ts`) en Node.
  - `backend-integracion` (`backend/test/integracion/**/*.test.ts`) con `globalSetup` que valida
    `DATABASE_URL_PRUEBAS` (criterio 19), aplica `prisma migrate deploy` sobre ella y fija `DATABASE_URL` con su
    valor para el proceso de pruebas. Se ejecuta sin paralelismo entre archivos (una sola base).
  - `frontend` con `jsdom` y Testing Library.
- **Decoradores de NestJS en Vitest:** esbuild no emite `emitDecoratorMetadata`; el backend usa `unplugin-swc` en su
  configuración de Vitest para que la inyección de dependencias funcione.
- **Zona `UTC`:** `process.env.TZ = 'UTC'` en la configuración, antes de crear los trabajadores, y `pool: 'forks'`
  para que cada proceso arranque con esa zona en Windows y en Linux. Una prueba por proyecto de Node lo comprueba
  (criterio 16).
- `allowOnly` falso en la CI (es el valor por defecto con `CI=true`).
- Prueba de integración de salud 503: crea la app con `DATABASE_URL` hacia `127.0.0.1` en un puerto cerrado (se
  obtiene uno libre abriendo y cerrando un servidor en el puerto 0).

### Frontend

- Vite + React + TypeScript; Tailwind CSS (en la versión 4, con `@tailwindcss/vite` y `@import "tailwindcss"`).
- React Router con dos rutas: `/` (Inicio) y `*` (Página no encontrada).
- TanStack Query: `QueryClient` en `main.tsx`; `api/cliente.ts` con un `pedirJson(ruta, esquema)` que hace `fetch`
  a `/api…` y valida con zod; `useSalud()` en `modulos/inicio/`. Un 503 con cuerpo válido se trata como estado
  "sin base", no como error de red. Sin reintentos automáticos para salud (para que las pruebas sean deterministas).
- `vite.config.ts`: `server.port = PUERTO_WEB`, `strictPort: true`, `server.proxy['/api'] =
  http://127.0.0.1:${PUERTO_API}`; `envDir` a la raíz.
- `index.html` con `lang="es"` y `<title>AquaGestión</title>`; diseño simple con Tailwind, centrado, que cabe en
  360 px.
- Pruebas: los cuatro estados de la página (simulando `fetch`) y la página no encontrada.

### E2E (`e2e/`)

- `@playwright/test` con solo Chromium. `webServer` con dos procesos: la API (`npm run start -w
  @aquagestion/backend` tras el build, o `nest start`) con `DATABASE_URL` = `DATABASE_URL_PRUEBAS` y `PUERTO_API`
  3100, y la web (`vite`) con `PUERTO_WEB` 5180 y proxy a 3100. Las variables se pasan con `env` del `webServer`,
  sin sintaxis de shell.
- `launchOptions.executablePath` solo si `CHROMIUM_EJECUTABLE` está definida y no vacía (en la nube); en Windows y en
  la CI no se define y se usa el Chromium que instala Playwright (revisión T22, 11/11/2026; criterio 6).
- `pruebas/inicio.spec.ts`: abre `/` y espera "Sistema en línea".
- `npm test` de la raíz no incluye E2E; se ejecutan con `npm run e2e`.

### Base de datos local

- `docker-compose.yml`: servicio `postgres` con imagen `postgres:16`, `POSTGRES_USER`, `POSTGRES_PASSWORD` y
  `POSTGRES_DB` = `aquagestion` (valores de desarrollo inventados), puerto
  `"127.0.0.1:${POSTGRES_PUERTO:-5432}:5432"`, volumen con nombre `aquagestion-datos`, `healthcheck` con
  `pg_isready` y `restart: unless-stopped`. `docker compose` lee `POSTGRES_PUERTO` del `.env` de la raíz.
- `scripts/crear-bases.mjs`: lee `DATABASE_URL` y `DATABASE_URL_PRUEBAS`, se conecta con `pg` a la base `postgres`
  del mismo servidor con las credenciales de `DATABASE_URL`, consulta `pg_database` y ejecuta `CREATE DATABASE`
  (nombre validado con `^[a-z_][a-z0-9_]*$` y entre comillas dobles) solo para las que faltan. Informa qué creó y qué
  ya existía. No borra nada.
- `.env.example` (orientativo):

  ```
  # Base de datos de desarrollo (Docker en la PC, PostgreSQL del contenedor en la nube)
  DATABASE_URL=postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion
  # Base de pruebas: su nombre debe terminar en _pruebas
  DATABASE_URL_PRUEBAS=postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion_pruebas
  # Puerto que publica docker compose en tu PC (cámbialo si 5432 está ocupado, y también en las dos URL)
  POSTGRES_PUERTO=5432
  # Puertos de desarrollo
  PUERTO_API=3000
  PUERTO_WEB=5173
  # Ruta de un Chromium ya instalado para las E2E (solo en la nube; la agrega el hook de sesión)
  # CHROMIUM_EJECUTABLE=/opt/pw-browsers/chromium
  ```

  (revisión T22, 11/11/2026: `CHROMIUM_EJECUTABLE` comentada, criterio 6.)

### Verificación de pruebas protegidas (`scripts/verificar-pruebas-protegidas.mjs`)

- Solo módulos de Node. `git` se ejecuta con `child_process.spawnSync('git', [...args])`, sin shell, con salidas
  separadas por NUL (`-z`) para rutas con espacios o "ñ", y `--no-renames` (un renombre cuenta como borrado más
  alta).
- Funciones puras exportadas y probadas por separado: `tieneMarcaProtegida(contenido)` (criterio 33) y
  `esCommitDePruebasProtegidas(titulo)` (criterio 34). Expresiones orientativas:
  - marca: `^\s*(\/\/|#|\/\*|--|<!--)\s*spec:\s*(\d{3}-[a-z0-9-]+)\s*\(pruebas protegidas\)` sobre cada una de las
    5 primeras líneas;
  - título: `/^pruebas protegidas \(\d{3}\)/i`.
- **Modo rango** (`--desde <ref> --hasta <ref>`; por defecto `--desde` = merge-base con `origin/main` y
  `--hasta` = `HEAD`; si `--desde` es el hash de ceros de GitHub, se usa el merge-base):
  1. Valida las referencias (`git rev-parse --verify`); si alguna no existe, código 2.
  2. Diferencia neta: archivos cambiados entre `merge-base(desde, hasta)` y `hasta`.
  3. Recorre `git rev-list --reverse desde..hasta`. Para cada commit sin merge: archivos cambiados respecto de su
     padre (`git diff-tree -r -z --no-renames --name-only`). Para cada merge: `git diff-tree -r -z --cc
     --name-only` (solo lo que difiere de todos los padres).
  4. Para cada archivo cambiado que está en la diferencia neta, si el commit no es de pruebas protegidas, lee la
     versión del padre (o del primer padre en un merge) y la del commit (`git cat-file -p <commit>:<ruta>`, tolerando
     que no exista) y, si alguna tiene la marca, registra la violación.
  5. Informe y código de salida (criterios 35 a 39).
- **Modo preparados** (`--preparados --mensaje <archivo>`), para el hook `commit-msg`: si existe `MERGE_HEAD`,
  termina en 0. Lee el título del archivo de mensaje (ignorando comentarios `#`), toma los cambios preparados
  (`git diff --cached -z --no-renames --name-only`) y compara la versión de `HEAD` (`git cat-file -p HEAD:<ruta>`) con
  la del índice (`git cat-file -p :<ruta>`). En un repositorio sin commits, solo mira el índice.
- Pruebas: cada prueba crea un repositorio git temporal en `os.tmpdir()` (con `user.name` y `user.email` fijados
  por `-c`), hace commits con mensajes y archivos concretos y ejecuta el script como proceso hijo. Cubren los
  criterios 33 a 41, incluidas rutas con espacios y "ñ", merges, reversiones y el modo preparados. Corren en la CI
  de Linux y de Windows.

### `scripts/verificar-sin-secretos.mjs`

- `git ls-files -z`; falla si algún nombre de archivo (no la ruta completa) cumple `^\.env(\..+)?$` salvo
  `.env.example`, o termina en `.pem`, `.key`, `.p12` o `.pfx`. Prueba con un repositorio temporal.

### Hooks de git

- `husky` (v9: `"prepare": "husky"`). `.husky/pre-commit`: `npx lint-staged`. `.husky/commit-msg`:
  `node scripts/verificar-pruebas-protegidas.mjs --preparados --mensaje "$1"`.
- `.husky/pre-commit` compila `@aquagestion/contratos` si falta `packages/contratos/dist`, antes de `lint-staged`,
  porque las reglas de ESLint con tipos resuelven los tipos del paquete compilado (revisión T22, 11/11/2026;
  criterio 31).
- En la nube, el `npm ci` del hook de sesión ejecuta `prepare`, así que los hooks de git quedan activos allí; es lo
  buscado (revisión T22, 11/11/2026; criterios 31 y 44).
- `lint-staged`: `*.{ts,tsx,js,mjs,cjs}` → `eslint --fix --max-warnings 0` y `prettier --write`;
  `*.{json,yml,yaml,css,html}` → `prettier --write`. Sin Markdown.
- En la CI, `husky` no debe romper `npm ci` (en v9 no instala hooks fuera de un repositorio git y se puede desactivar
  con `HUSKY=0`).

### Hook de sesión (`.claude/hooks/preparar-sesion.mjs`)

- Solo módulos de Node (`node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:net`, `node:util`).
  Raíz del proyecto: `CLAUDE_PROJECT_DIR` o, si falta, dos carpetas arriba del archivo.
- Sin `import` estáticos de módulos del repositorio. Si reutiliza `scripts/lib/entorno.mjs` (análisis de
  `DATABASE_URL` y validación de nombres), lo carga con `await import()` dentro de un `try/catch` después de
  comprobar `CLAUDE_CODE_REMOTE`; si falla, lo informa como fallo del paso y sigue hasta terminar en 0 (revisión T22,
  11/11/2026; criterio 47).
- Primera línea de lógica: si `process.env.CLAUDE_CODE_REMOTE !== 'true'`, `process.exit(0)` sin salida.
- Pasos (criterio 44), cada uno en un `try` propio que registra "✓ paso" o "✗ paso: motivo" y corta los siguientes
  si dependen de él:
  1. `.env`: si no existe, `fs.copyFileSync('.env.example', '.env', fs.constants.COPYFILE_EXCL)`. Lee las variables
     con `util.parseEnv` (Node 22) sin modificar `process.env` global más allá de lo necesario para los hijos.
     Si existe `/opt/pw-browsers/chromium`: agrega `CHROMIUM_EJECUTABLE=/opt/pw-browsers/chromium` al `.env` solo si
     el hook acaba de crearlo y no la contiene, y, si existe `CLAUDE_ENV_FILE`, agrega
     `export CHROMIUM_EJECUTABLE=/opt/pw-browsers/chromium` a ese archivo si no está (revisión T22, 11/11/2026;
     criterio 44).
  2. PostgreSQL: si el host de `DATABASE_URL` no es `localhost` ni `127.0.0.1`, lo informa y salta los pasos 2, 3,
     la creación de bases y las migraciones (solo instala dependencias y genera el cliente de Prisma); la línea final
     del resumen lo dice en lugar de "Sesión preparada." (revisión T22, 11/11/2026; criterio 46). Si no, comprueba
     con un `net.connect` al puerto (o `pg_isready`); si no responde,
     `spawnSync('pg_ctlcluster', ['16', 'main', 'start'])` y reintenta cada segundo hasta 30 s.
  3. Rol: valida usuario y bases con `^[a-z_][a-z0-9_]*$`; como root ejecuta `runuser -u postgres -- psql -v
     ON_ERROR_STOP=1 -d postgres` con los argumentos separados (sin root, `sudo -n -u postgres psql …`; si el
     proceso ya es `postgres`, `psql` directo), pasando la sentencia por la entrada estándar: un bloque
     `DO` que crea el rol con `LOGIN CREATEDB NOSUPERUSER PASSWORD '<contraseña con comillas simples duplicadas>'`
     si no existe. La contraseña nunca va en los argumentos ni en la salida. No se usa `su postgres -c` (interpreta
     una cadena con shell): si `runuser` no existe, el paso falla e informa el motivo (revisión T22, 11/11/2026;
     criterio 47).
  4. Dependencias: huella `sha256` de `package-lock.json` comparada con `node_modules/.preparar-sesion.sha256`; si
     falta `node_modules` o la huella cambió, `npm ci` y, solo si termina bien, se guarda la huella.
  5. `npm run db:crear`, `npx prisma generate` (en el workspace backend), `npm run db:migrar` y
     `npm run db:migrar:pruebas`.
  6. Resumen final, una línea por paso, más "Sesión preparada.", la variante para host remoto (criterio 46) o
     "Preparación incompleta: reintenta con node .claude/hooks/preparar-sesion.mjs".
- Siempre termina con código 0. En Windows, `spawnSync` de `npm` necesitaría `npm.cmd`, pero el hook nunca llega a
  esos pasos fuera de la nube.
- `.claude/settings.json` (combinar con lo existente):

  ```json
  {
    "model": "claude-opus-5-5",
    "effortLevel": "high",
    "hooks": {
      "SessionStart": [
        {
          "matcher": "startup|resume",
          "hooks": [
            {
              "type": "command",
              "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/preparar-sesion.mjs\"",
              "timeout": 600
            }
          ]
        }
      ]
    }
  }
  ```

  El implementador confirma en la documentación de Claude Code la sintaxis del `matcher` de `SessionStart`.
- Prueba automática del criterio 43: ejecutar el hook con `CLAUDE_CODE_REMOTE` ausente y con `CLAUDE_PROJECT_DIR`
  apuntando a un directorio temporal con un `.env.example`, y comprobar código 0, salida vacía y que no aparece
  `.env`. Vive en `scripts/test/`.

### Integración continua (`.github/workflows/ci.yml`)

- `on: push` (todas las ramas) y `pull_request` hacia `main`; `concurrency` por rama con `cancel-in-progress`.
- `actions/setup-node` con `node-version-file: .nvmrc` y `cache: npm`.
- **linux:** servicio `postgres:16` con usuario, contraseña y base `aquagestion`, `options` con `pg_isready`, puerto
  5432. Variables `DATABASE_URL` y `DATABASE_URL_PRUEBAS` en `env` del trabajo (sin `.env`). Pasos: `npm ci`,
  `npm run verificar:sin-secretos`, `format:check`, `lint`, `typecheck`, `db:preparar`, `npm test`, `build`,
  `npx playwright install --with-deps chromium`, `npm run e2e`, y subir el reporte de Playwright si falla.
- **windows:** `npm ci`, `format:check`, `typecheck`, `build`, `test:unit`. El paso de checkout deja el
  `core.autocrlf` del runner, para comprobar que `.gitattributes` funciona.
- **pruebas-protegidas:** `actions/checkout` con `fetch-depth: 0`; en `pull_request`, `--desde
  ${{ github.event.pull_request.base.sha }} --hasta ${{ github.event.pull_request.head.sha }}`; en `push` a una rama
  distinta de `main`, `git fetch origin main` y el valor por defecto. Se salta en push a `main`.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Ninguna tabla; migración inicial vacía | Usuarios, auditoría y configuración en 000 (D-17) | Llevan `academia_id` y dependen de 001 (decisión del responsable, 11/11/2026) |
| Salud con `SELECT 1` y límite de 2 s | Conectar al arrancar y abortar si falla | La API se recupera sola y el estado se ve en salud |
| Contratos compilados con `tsup` a ESM y CommonJS | Solo ESM confiando en `require(esm)`; importar el código fuente con alias de rutas | NestJS compila a CommonJS; la salida doble evita depender de comportamientos recientes de Node y TypeScript |
| Un solo `.env` en la raíz | Un `.env` por workspace | Un solo lugar para el responsable; `docker compose` lo lee también |
| `127.0.0.1` en lugar de `localhost` | `localhost` | En Windows, `localhost` puede ir a `::1` y Docker publica en IPv4 |
| Docker publicado solo en `127.0.0.1` | Publicar en todas las interfaces | La contraseña de desarrollo es débil; no debe verse desde la red local |
| `DATABASE_URL_PRUEBAS` con nombre terminado en `_pruebas` | Derivar la base de pruebas de `DATABASE_URL` | Explícito y verificable; evita borrar la base de desarrollo |
| `unplugin-swc` en Vitest del backend | `ts-jest` / Jest | El proyecto usa Vitest en todo el repositorio |
| Pruebas con `TZ=UTC` | Pruebas con la zona del sistema | Hace visible cualquier dependencia de la zona del servidor |
| Reloj inyectable + regla de lint | Solo la convención escrita | La regla evita el error antes de que exista código de horarios |
| Verificación por diferencia neta del rango | Cualquier commit indebido es violación permanente | Sin `--force`, una rama quedaría en rojo para siempre |
| Revisión también en `commit-msg` | Solo en la CI | Detecta el error antes de crear el commit, cuando corregirlo es gratis |
| Hook de sesión que siempre termina en 0 | Terminar con error | Un error no debe impedir trabajar; la salida explica qué reintentar |
| Rol de la nube sin superusuario | Usar `postgres` | Los superusuarios se saltan RLS; deja el camino listo para 001 |
| `scripts/` como workspace | Dependencias en la raíz | Así lo pide la nota del backlog; aísla `pg` y sus pruebas |
| Prettier sin Markdown | Formatear todo | Reescribiría las tablas de los documentos de negocio |

## Migraciones

- `backend/prisma/migrations/<marca>_inicial/migration.sql`: solo un comentario (o `SELECT 1;`). No crea tablas.
- `migration_lock.toml` con `provider = "postgresql"`.

## Riesgos

- **Prisma sin modelos.** Puede que la versión vigente de Prisma no genere el cliente, o lo genere inutilizable,
  cuando el esquema no tiene modelos. Si ocurre, el implementador se detiene y lo informa al orquestador; no agrega
  una tabla ni cambia el endpoint de salud por su cuenta. Opciones para decidir entonces: consultar con `pg`
  directamente en salud hasta 001, o adelantar la tabla de academias de 001.
- **`package-lock.json` incompleto para Windows.** npm puede omitir dependencias opcionales de otras plataformas
  (binarios de esbuild, Rollup, Tailwind/lightningcss) si el lock se genera sobre un `node_modules` existente.
  Generarlo desde cero (sin `node_modules` ni lock previo). La CI de Windows lo detecta.
- **`matcher` y variables del hook en Windows.** Si el responsable abre Claude Code en su PC, el comando del hook
  depende de que `$CLAUDE_PROJECT_DIR` se expanda; si no, el hook falla al iniciar pero no bloquea nada. La guía
  indica cómo reconocerlo.
- **Tiempo de la CI.** Playwright con Chromium y el trabajo de Windows alargan la CI; se acepta por D-26.
- **Navegadores de Playwright en la nube:** si no se pueden descargar, el tester informa que las E2E solo se
  verificaron en la CI.
- **NestJS con `nest start --watch`** no reinicia cuando cambian los contratos compilados; en esta historia el impacto
  es mínimo. Si molesta, se ajusta en una historia posterior.
