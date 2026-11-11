# 001 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia de ruta crítica:
las pruebas protegidas se escriben y se confirman en rojo antes de implementar (T1 a T3), y el ataque adversarial
corre después de la implementación (T21).

Especificación aprobada por el responsable el 11/11/2026, con las propuestas de todas las preguntas abiertas
(DR-1 a DR-10 en "Decisiones" de `spec.md`); ningún criterio cambió. Se puede empezar por T1.

Tras T1 y T2 se agregaron al contrato las precisiones técnicas P-1 a P-11 ("Precisiones del contrato" en `spec.md`);
el backend las sigue en T5 (P-1), T6 (P-11), T7 (P-3, P-10), T8 (P-9), T10 (P-2), T13 (P-5, P-6, P-7), T14 y T15
(P-4, P-8).

## Pruebas protegidas (en rojo)

- [ ] T1 · test-writer · Utilidades de prueba de `backend/test/utilidades/` según el contrato de `spec.md`
      (`aplicacion.ts`, `base-datos.ts`, `academias.ts`, `superadmins.ts`, `comandos.ts`), con la marca de pruebas
      protegidas; y pruebas protegidas de aislamiento: rol de la app, rol inseguro, catálogo, RLS, `resolver_academia`,
      `BaseDatos`, auditoría y la prueba unitaria del entorno (criterios 1 a 5, 9 a 26, 28 a 31, 47)
- [ ] T2 · test-writer · Pruebas protegidas del comando del superadmin, la sesión, el bloqueo, el límite por IP, las
      academias de la plataforma y la ruta pública (criterios 32 a 46, 48, 50 a 60)
- [ ] T3 · tester · Confirmar que T1 y T2 fallan por falta de la funcionalidad (tablas, rutas o servicios
      inexistentes) y no por errores de sintaxis, importaciones o configuración. Commit del orquestador:
      "Pruebas protegidas (001): aislamiento, superadmin y academias (en rojo)"

## Base de datos y acceso a datos

- [ ] T4 · backend · Contratos: `academias.ts`, `plataforma.ts` y `detallesValidacionSchema`, con pruebas unitarias
      de los esquemas, en especial del nombre corto (criterios 49, 66)
- [ ] T5 · backend · Entorno: `DATABASE_URL_APP`, `JWT_SECRETO` (y el rechazo del valor de ejemplo en producción),
      `DATABASE_POOL_MAX`; `.env.example`; `scripts/lib/entorno.mjs` (`leerUrlApp`, `urlAppSobre`); `global-setup.ts`
      fija `DATABASE_URL_APP` para las pruebas (criterios 5, 62)
- [ ] T6 · backend · Rol `aquagestion_app`: `asegurarRolApp` en `crear-bases.mjs` con sus pruebas de integración;
      paso del hook de sesión con `sentenciaCrearRolApp` y su prueba unitaria; variables en `ci.yml` (criterios 6, 8,
      64). Quién crea el rol (P-11, tras T1–T2, 11/11/2026): en la nube el hook como `postgres`; en Windows
      `db:crear` con el superusuario del contenedor de Docker; en la CI `db:crear` con el usuario del servicio
- [ ] T7 · backend · Esquema de Prisma y migración `academias_aislamiento`: comprobación del rol, tablas, `CHECK`,
      índices, funciones, RLS forzada, políticas y privilegios (criterios 1, 2, 7, 9 a 20)
- [ ] T8 · backend · `BaseDatos`: `conAcademia`, `comoPlataforma`, `resolverAcademia`, `comprobarConexion`,
      verificación del rol inseguro, errores de academia; `PrismaService` interno; salud con `comprobarConexion`;
      regla de lint de importaciones de Prisma con su prueba (criterios 3, 4, 21 a 28)
- [ ] T9 · backend · `ErrorNegocio`, ampliación del filtro de errores y pipe de validación con `detalles`, con
      pruebas unitarias (criterio 66)
- [ ] T10 · backend · `AuditoriaService` con `registrarEnAcademia` y `registrarEnPlataforma` (criterios 29 a 31)

## Superadmin y academias

- [ ] T11 · backend · Seguridad compartida: `claves.ts` (argon2id y hash ficticio) y `tokens.ts` (JWT HS256 con
      `RELOJ`), cookie `aq_plataforma` (criterios 36, 37, 43)
- [ ] T12 · backend · Comando `plataforma:superadmin` (crear y restablecer, validación, auditoría, sin imprimir la
      clave) (criterios 32 a 35, 46)
- [ ] T13 · backend · Sesión del superadmin: inicio con bloqueo atómico y función pura de bloqueo con pruebas
      unitarias, límite por IP con `@nestjs/throttler`, guard de sesión, cierre de sesión, registro en el log sin la
      clave (criterios 36 a 46)
- [ ] T14 · backend · Academias de la plataforma: crear, listar, suspender y reactivar, con auditoría y manejo de
      carreras; `Cache-Control: no-store` (criterios 32, 48, 50 a 57)
- [ ] T15 · backend · Ruta pública `GET /api/a/{nombreCorto}` con un resolvedor reutilizable para rutas públicas
      (criterios 58 a 60)
- [ ] T16 · backend · Semilla con las dos academias y el superadmin de desarrollo; `npm run env:completar` con sus
      pruebas; actualización de las pruebas de 000 afectadas (criterios 61, 63, 65)

## Web y E2E

- [ ] T17 · frontend · Cliente HTTP con envío y errores tipados; páginas `/plataforma/ingresar` y
      `/plataforma/academias` con crear, suspender, reactivar y cerrar sesión; rutas; pruebas de los estados
      principales (criterios 68, 69, 70)
- [ ] T18 · frontend · Prueba E2E de la plataforma y ajustes de `playwright.config.ts` (variables de la app y
      superadmin de prueba) (criterio 71)

## Verificación

- [ ] T19 · tester · Las pruebas protegidas de T1 y T2 pasan sin cambios; en la nube: hook de sesión desde cero (rol
      `aquagestion_app` creado), `npm run db:preparar`, migración sin el rol (mensaje del criterio 7, en una base
      temporal y restaurando el rol después) (criterios 7, 8)
- [ ] T20 · orquestador · `git diff` desde el commit de T3: ningún commit de implementación tocó las pruebas
      protegidas ni las utilidades marcadas
- [ ] T21 · adversarial · Ataque según "Qué ataca el adversarial en AquaGestión": cambio de ids y de nombre corto,
      consultas sin contexto o con otro, conexiones reutilizadas, concurrencia en el bloqueo, la creación y la
      suspensión, tokens falsificados o reutilizados, privilegios del rol. Por cada falla: especificador (criterio
      nuevo con origen "ataque ronda N"), test-writer (prueba protegida en rojo, commit
      "Pruebas protegidas (001), ataque ronda N: … (en rojo)"), backend (corrección), y nueva ronda hasta que no haya
      fallas
- [ ] T22 · revisor · Revisión contra la especificación y `CLAUDE.md`: criterios de revisión (28, 62, 64, 65), que
      ningún módulo use Prisma fuera de `BaseDatos`, que ninguna clave o secreto real quede en el repositorio,
      scripts compatibles con Windows
- [ ] T23 · tester · Suite completa (`npm test`), `lint`, `typecheck`, `format:check`, `build` y, si hay navegador,
      `npm run e2e`

## Cierre

- [ ] T24 · documentador · `docs/guia-local-windows.md` (criterio 67), `README.md` (qué está construido) y las notas
      de 001 y 002 en `specs/backlog.md`: el primer administrador de cada academia pasa de 001 a 002 (DR-1)
- [ ] T25 · responsable · En Windows: `git pull`, `npm ci`, `npm run env:completar`, `docker compose up -d`,
      `npm run db:preparar`, `npm run dev`; entrar a `http://localhost:5173/plataforma/ingresar` con el superadmin de
      desarrollo, crear una academia, suspenderla y reactivarla (criterios 62, 63, 67, 69)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
