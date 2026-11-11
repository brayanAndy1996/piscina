# 000 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia sin ruta crítica:
no hay pruebas protegidas ni ataque adversarial, pero los criterios marcados _(prueba obligatoria)_ deben quedar
cubiertos por pruebas automáticas.

## Base del repositorio

- [ ] T1 · backend · Raíz del monorepo: `package.json` con workspaces, `engines` y scripts; `.npmrc`
      (`engine-strict`), `.nvmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `tsconfig.base.json`, Prettier
      (`.prettierrc.json`, `.prettierignore` sin Markdown) y `package-lock.json` generado desde cero (criterios 1, 2,
      3, 4, 28, 29, 32)
- [ ] T2 · backend · ESLint en configuración plana para todo el monorepo, con `eslint/regla-reloj.mjs` exportada y
      aplicada a `backend/src` (criterios 15, 27)
- [ ] T3 · backend · `packages/contratos`: `respuestaSaludSchema`, `errorApiSchema`, tipos, compilación con `tsup`
      a ESM y CommonJS, y pruebas de los esquemas (criterio 21)

## API y base de datos

- [ ] T4 · backend · NestJS: `crear-app.ts`, `main.ts`, prefijo `/api`, `helmet`, sin CORS, `nestjs-pino` con
      redacción, validación del entorno y filtro global de errores, con sus pruebas unitarias (criterios 10, 11, 12,
      13, 14)
- [ ] T5 · backend · Reloj inyectable (`RELOJ`, `RelojSistema`, `RelojFijo`, `RelojModule`) con pruebas, y prueba
      de la regla de lint con la clase `Linter` (criterio 15)
- [ ] T6 · backend · Prisma: esquema sin modelos, configuración, generación en `postinstall`, migración inicial,
      `PrismaService` con conexión perezosa y `seed.ts` vacío. Si Prisma no genera un cliente usable sin modelos,
      detenerse e informar (riesgo del plan) (criterios 1, 18)
- [ ] T7 · backend · Módulo de salud con límite de 2 s y `Cache-Control: no-store` (criterios 7, 8, 9)
- [ ] T8 · backend · Vitest en la raíz con proyectos, `TZ=UTC`, `pool: 'forks'`, `unplugin-swc` en el backend,
      `globalSetup` de integración con la protección de la base de pruebas y pruebas de integración de salud, 404,
      cabeceras y CORS (criterios 7, 8, 10, 12, 16, 19, 26)
- [ ] T9 · backend · `scripts/` como workspace: `crear-bases.mjs` con pruebas de integración, comandos `db:crear`,
      `db:migrar`, `db:migrar:pruebas`, `db:migracion`, `db:semilla` y `db:preparar`; `docker-compose.yml` y
      `.env.example` (criterios 6, 17, 18, 20)

## Web y E2E

- [ ] T10 · frontend · Vite + React + TypeScript + Tailwind, React Router, TanStack Query, proxy `/api`,
      `strictPort`, página de inicio con los cuatro estados, página no encontrada y sus pruebas (criterios 21, 22,
      23, 24)
- [ ] T11 · frontend · Workspace `e2e/` con Playwright (Chromium), servidores en puertos propios contra la base de
      pruebas y la prueba de humo de inicio (criterio 25)
- [ ] T12 · backend · Comando `dev` de la raíz con `concurrently` (contratos, API y web) y `build` en orden
      (criterios 22, 30)

## Salvaguardas del método

- [ ] T13 · backend · `scripts/verificar-pruebas-protegidas.mjs`: funciones puras, modo rango y modo preparados, con
      pruebas sobre repositorios git temporales (criterios 33 a 41)
- [ ] T14 · backend · `scripts/verificar-sin-secretos.mjs` con pruebas (criterio 5)
- [ ] T15 · backend · `husky` con `lint-staged` (`pre-commit`) y `commit-msg` con la verificación de pruebas
      protegidas (criterios 31, 41)
- [ ] T16 · backend · `.claude/hooks/preparar-sesion.mjs` y su registro en `.claude/settings.json`, combinando con
      `model` y `effortLevel`; prueba automática del caso fuera de la nube (criterios 43 a 48)
- [ ] T17 · backend · `.github/workflows/ci.yml` con los trabajos de Linux, Windows y pruebas protegidas (criterios
      3, 25, 42, 49)

## Verificación

- [ ] T18 · tester · En la nube: `npm ci` en limpio, `npm test`, `npm run test:unit`, `npm run lint`,
      `npm run typecheck`, `npm run format:check`, `npm run build` y, si hay navegadores, `npm run e2e` (criterios
      1, 26 a 30)
- [ ] T19 · tester · En la nube, el hook de sesión: apagar PostgreSQL (`pg_ctlcluster 16 main stop`), mover `.env`
      fuera del proyecto, ejecutar `node .claude/hooks/preparar-sesion.mjs` y comprobar los seis pasos; repetirlo y
      medir que tarde menos de 30 s; forzar un fallo (por ejemplo, un `DATABASE_URL` con un host remoto) y revisar
      el mensaje; al final, restaurar el `.env` original (criterios 44, 45, 46)
- [ ] T20 · tester · En la nube: `npm run dev`, `curl` a `http://localhost:5173/api/salud` y a
      `http://localhost:3000/api/salud`; apagar y encender el cluster y comprobar 503 y luego 200 sin reiniciar la
      API; Ctrl+C detiene todo (criterios 8, 22)
- [ ] T21 · tester · `husky`: un commit de prueba con un error de lint es rechazado; un commit que modifica un
      archivo con la marca y título normal es rechazado por `commit-msg`; deshacer ambos sin dejar rastro en la rama
      (criterios 31, 41)
- [ ] T22 · revisor · Revisión contra la especificación: criterios de revisión (2, 4, 6, 21, 32, 42, 47, 48, 49),
      scripts compatibles con Windows y que nada versionado contenga secretos

## Cierre

- [ ] T23 · documentador · `docs/guia-local-windows.md` (criterio 50)
- [ ] T24 · documentador · `.github/pull_request_template.md` (criterio 51)
- [ ] T25 · documentador · `README.md` (criterio 52) y el ajuste del texto de D-17 en `docs/decisiones.md`, aprobado
      por el responsable el 11/11/2026: la 000 no crea tablas; auditoría y configuración por academia van en 001 y
      usuarios en 002
- [ ] T26 · responsable · En Windows, seguir la guía desde un clon limpio hasta ver "Sistema en línea", y hacer un
      commit de prueba para confirmar los hooks de git (criterios 20, 22, 31, 50)

## Solo ruta crítica

No aplica: la historia no tiene criterios de ruta crítica.

- [ ] ~~Pruebas escritas por test-writer y confirmadas en rojo~~
- [ ] ~~Pruebas en verde tras la implementación~~
- [ ] ~~Ataque adversarial sin fallas abiertas~~
