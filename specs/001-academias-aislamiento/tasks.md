# 001 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia de ruta crítica:
las pruebas protegidas se escriben y se confirman en rojo antes de implementar (T1 a T3), y el ataque adversarial
corre después de la implementación (T21).

Especificación aprobada por el responsable el 11/11/2026, con las propuestas de todas las preguntas abiertas
(DR-1 a DR-10 en "Decisiones" de `spec.md`); ningún criterio cambió. Se puede empezar por T1.

Tras T1 y T2 se agregaron al contrato las precisiones técnicas P-1 a P-11 ("Precisiones del contrato" en `spec.md`);
el backend las sigue en T5 (P-1), T6 (P-11), T7 (P-3, P-10), T8 (P-9), T10 (P-2), T13 (P-5, P-6, P-7), T14 y T15
(P-4, P-8).

Tras la ronda 1 del ataque adversarial se agregaron los criterios 72 a 79 (sección J de `spec.md`); sus tareas son
T26 a T34, antes del cierre.

Tras la ronda 2 se agregaron los criterios 80 a 91 (sección K de `spec.md`); sus tareas son T35 a T46, antes del
cierre.

Tras la ronda 3 se agregaron los criterios 92 a 105 (sección L de `spec.md`) y las precisiones P-19 a P-24; sus
tareas son T47 a T58, antes del cierre. Los criterios 73, 83, 84, 85 y la precisión P-15 quedaron con el alcance
ajustado.

Tras la ronda 4 se agregaron los criterios 106 a 119 (sección M de `spec.md`) y las precisiones P-25 a P-28; sus
tareas son T59 a T70, antes del cierre. Los criterios 92, 95, 96, 98, 99 y 100 y las precisiones P-21 y P-24 quedaron
con el alcance ajustado o complementado.

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
      ningún módulo use Prisma fuera de `BaseDatos`, que ninguna clave o secreto real quede en el repositorio (y que
      ningún secreto de prueba válido en producción esté escrito en él, criterio 91),
      scripts compatibles con Windows
- [ ] T23 · tester · Suite completa (`npm test`), `lint`, `typecheck`, `format:check`, `build` y, si hay navegador,
      `npm run e2e`

## Ataque adversarial, ronda 1 (11/11/2026)

Fallas F1 a F3, O1, O2 y O4 de la ronda 1; criterios 72 a 79 de `spec.md` (sección J). O3, O5, O6 y los ya
aceptados quedaron en "Riesgos aceptados".

- [ ] T26 · test-writer · Pruebas protegidas en rojo de los criterios 72 a 79 (archivos en "Pruebas" del plan,
      sección 13), con la marca de pruebas protegidas, sin mirar la implementación. Commit: "Pruebas protegidas
      (001), ataque ronda 1: contexto, cuerpos, límite, textos y entorno (en rojo)"
- [ ] T27 · tester · Confirmar que T26 falla por la razón esperada (contexto residual visible, form aceptado,
      400/413 sin contar, 500 o texto aceptado, `NODE_ENV` o secreto aceptados) y no por errores de las pruebas
- [ ] T28 · backend · `BaseDatos` fija los dos valores de contexto en `conAcademia`, `comoPlataforma` y
      `resolverAcademia`; regla de lint del SQL de sesión con su prueba (criterios 72, 73)
- [ ] T29 · backend · Middlewares de `/api` en el orden del plan: límite del inicio de sesión antes del lector del
      cuerpo (sin `ThrottlerGuard`), rechazo de cuerpos no JSON y lector JSON propio (criterios 74, 75)
- [ ] T30 · backend · `packages/contratos/src/texto.ts` (`sinControles`, `textoVisibleSchema`) con pruebas unitarias;
      uso en `plataforma.ts`, `academias.ts` y el comando del superadmin (criterios 76, 77)
- [ ] T31 · frontend · Motivo de suspensión en un campo de una línea; los formularios muestran los errores de texto de
      los esquemas (criterios 76, 77)
- [ ] T32 · backend · `NODE_ENV` de lista cerrada en `validarEntorno` y la semilla; reglas de `JWT_SECRETO` en
      producción y lista de secretos públicos con su prueba (criterios 78, 79)
- [ ] T33 · orquestador · `git diff` desde el commit de T27: T28 a T32 no tocaron pruebas protegidas
- [ ] T34 · adversarial · Ronda 2 sobre todo lo anterior, en especial 72 a 79; si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 2 (11/11/2026)

Fallas F1 a F6, O1, O2, O4, O5 y O6 de la ronda 2; criterios 80 a 91 de `spec.md` (sección K). O3 quedó en
"Riesgos aceptados". Detalle técnico en la sección 14 del plan.

- [ ] T35 · test-writer · Pruebas protegidas en rojo de los criterios 80 a 90 (archivos en "Protegidas del ataque
      ronda 2" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación; y criterio 91:
      reemplazar en las pruebas los secretos fijos que cumplen el criterio 79 por secretos generados con
      `randomBytes`, empezando por `backend/test/integracion/plataforma/sesion.test.ts`. Commit: "Pruebas protegidas
      (001), ataque ronda 2: rol, temporales, lint, cliente, textos, codificación y comandos (en rojo)"
- [ ] T36 · tester · Confirmar que T35 falla por la razón esperada (rol inseguro aceptado, `CREATE TEMP` permitido,
      formas de SQL o importaciones que pasan el lint, cliente accesible, texto en blanco o longitud UTF-16 aceptados,
      415 en lugar de 400, contexto de academia en `enPlataforma`) y no por errores de las pruebas. Las de integración
      de 80 y 81 que se omiten en la nube se confirman en la CI
- [ ] T37 · backend · Comprobación completa del rol en `BaseDatos` con la función pura `problemasDelRol` (criterio
      80)
- [ ] T38 · backend · `scripts/lib/rol-app.mjs`, `asegurarRolApp`/`crearBases` con la lista completa y la revocación
      de `TEMPORARY`, y el paso del rol del hook de sesión (criterios 81, 82)
- [ ] T39 · backend · Migración `<marca>_endurecer_rol_app` (criterio 82)
- [ ] T40 · backend · Normalización del SQL y reglas nuevas en `eslint/regla-sql-sesion.mjs` (criterios 83, 84)
- [ ] T41 · backend · `eslint/regla-acceso-base.mjs`, `eslint-disable` sin efecto sobre las reglas protegidas y
      `#prisma` en `BaseDatos` (criterios 85, 86)
- [ ] T42 · backend · `texto.ts`: visibles sin ignorables ni U+2800 y longitudes por puntos de código; uso en
      `plataforma.ts`, `academias.ts`, `superadmin-datos.ts` y la semilla (criterios 87, 88)
- [ ] T43 · backend · Middleware de `Content-Encoding` y traducción de los errores de descompresión (criterio 89)
- [ ] T44 · backend · `enPlataforma` fija los dos valores de contexto (criterio 90)
- [ ] T45 · orquestador · `git diff` desde el commit de T36: T37 a T44 no tocaron pruebas protegidas
- [ ] T46 · adversarial · Ronda 3 sobre todo lo anterior, en especial 80 a 91; si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 3 (11/11/2026)

Fallas F1 a F6 y observaciones O1 a O5 de la ronda 3; criterios 92 a 105 de `spec.md` (sección L) y precisiones
P-19 a P-24. Las claves JSON duplicadas y lo que el rol aún puede hacer en SQL (objetos grandes, conexión a
`postgres`, `pg_terminate_backend`, su propia contraseña) quedaron en "Riesgos aceptados". Detalle técnico en la
sección 15 del plan.

- [ ] T47 · test-writer · Pruebas protegidas en rojo de los criterios 92 a 105 (archivos en "Protegidas del ataque
      ronda 3" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. En el mismo
      commit, adaptar las protegidas de lint de las rondas 1 y 2 (`eslint/regla-sql-sesion.test.mjs`,
      `eslint/regla-sql-sesion-ronda2.test.mjs`, `eslint/regla-acceso-base.test.mjs`) al alcance nuevo de los
      criterios 92 y 96, sin quitar ningún texto SQL de los ejemplos; y actualizar la prueba no protegida
      `scripts/test/preparar-sesion.test.mjs` al verificador SCRAM (criterio 104). Commit: "Pruebas protegidas (001),
      ataque ronda 3: lint por plantillas, zona horaria, entorno, envoltorio, cursores, privilegios, SCRAM y UTF-8
      (en rojo)" (criterios 73, 83 a 85, 92 a 105)
- [ ] T48 · tester · Confirmar que T47 falla por la razón esperada (SQL fuera de plantillas o `UESCAPE` que pasan el
      lint, falsos positivos que fallan, `eslint-disable` sin efecto en el lint normal, fechas corridas 5 horas,
      `DATABASE_URL` en `process.env`, cliente alcanzable, cursor que sobrevive, `GRANT` o `ALTER ROLE … SET`
      aceptados, contraseña en claro, U+FFFD guardado) y no por errores de las pruebas. Las de integración que crean
      roles (104 y parte de 102 y 103 en `db:crear`) se confirman en la CI
- [ ] T49 · backend · Lint: la regla del SQL solo sobre plantillas etiquetadas y la regla de formas; `UESCAPE` en
      `normalizarSql`; sentencias y funciones nuevas prohibidas; excepción de `set_config('TimeZone', 'UTC', true)` en
      `cli/` (criterios 92, 93, 94, 98)
- [ ] T50 · backend · Lint: reglas de acceso en todas las extensiones, rutas a `node_modules`, importaciones de `cli/`
      y de los internos de `infraestructura/prisma/`; `eslint.protegido.config.mjs`, script `lint:protegido` dentro de
      `npm run lint`, sin `noInlineConfig`; bloque de `.cts` en `eslint.config.mjs` (criterios 95, 96, 97)
- [ ] T51 · backend · `BaseDatos`: cliente creado dentro de la clase sin proveedor de Nest, métodos `#`, prototipo
      congelado, envoltorio de `trabajo` y tipo `ClienteTransaccion` (P-24); `TimeZone` en `UTC` y `CLOSE ALL` en cada
      transacción (criterios 98, 100, 101)
- [ ] T52 · backend · `cli/conexion.ts`: `enPlataforma` con `TimeZone` y `CLOSE ALL`; `crearClienteDelDueno(url,
      { max })` (P-23) (criterios 98, 101)
- [ ] T53 · backend · `retirarVariablesSensibles` (P-21) y su llamada en `main.ts` (criterio 99)
- [ ] T54 · backend · Comprobación de privilegios de más y de valores por defecto del rol en la API
      (`privilegios-app.ts`, `problemasDeConfiguracion`) y en `db:crear` (`scripts/lib/rol-app.mjs`), con
      `PRIVILEGIOS_APP` igual en los dos lados (P-19, P-20) (criterios 102, 103)
- [ ] T55 · backend · `verificadorScram` (P-22) en `scripts/lib/rol-app.mjs`; sentencias de `db:crear` y del hook con
      el verificador y rechazo de contraseñas fuera de ASCII imprimible (criterio 104)
- [ ] T56 · backend · UTF-8 estricto en el lector JSON y traducción del error de `verify` a 400 en el filtro
      (criterio 105)
- [ ] T57 · orquestador · `git diff` desde el commit de T48: T49 a T56 no tocaron pruebas protegidas
- [ ] T58 · adversarial · Ronda 4 sobre todo lo anterior, en especial 92 a 105 (el lint nuevo, el envoltorio, la zona
      horaria y la comprobación del rol); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 4 (11/11/2026)

Fallas F1 a F7, falsos positivos y observaciones de la ronda 4 (sobre `066c9af`); criterios 106 a 119 de `spec.md`
(sección M) y precisiones P-25 a P-28. Se reconfirmaron los riesgos aceptados (SQL armado en tiempo de ejecución,
comprobación del rol una vez por proceso, objetos grandes, `pg_terminate_backend`, `ALTER ROLE … PASSWORD` propio,
claves JSON duplicadas y límite por IP en memoria y /128) y se agregaron la nota de proceso sobre el lint y la cadena
`'WITH HOLD'` como limitación. Detalle técnico en la sección 16 del plan.

- [ ] T59 · test-writer · Pruebas protegidas en rojo de los criterios 106 a 119 (archivos en "Protegidas del ataque
      ronda 4" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. En el mismo
      commit, adaptar `eslint/regla-sql-plantillas.test.mjs` a los criterios 112 y 114 como dice "Impacto en
      especificaciones anteriores" (importaciones de `sql`, `join` y `Prisma`), sin quitar ejemplos ni cambiar los que
      fallan; y comprobar que ningún ejemplo de las protegidas de lint de las rondas 1 a 3 cambia de resultado con el
      criterio 115 (si alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 4:
      promesas nativas, formato de sesión, fechas inválidas, lint de funciones, exenciones, enlaces, etiquetas, alias,
      punto autorizado y entorno (en rojo)" (criterios 92, 106 a 119)
- [ ] T60 · tester · Confirmar que T59 falla por la razón esperada (promesas con `requestTransaction` o fuera de la
      transacción, escritura que sobrevive, `DateStyle` contaminado que anula el bloqueo o da 500, fecha inválida que
      deja entrar, funciones de texto que pasan el lint, `atajo.test.util.ts` exento, enlace que evade, `sql` local u
      objeto falso aceptados, alias de `Prisma` que pasan, punto autorizado inexistente, `UPDATE … SET role` que falla,
      `PgPassword` que queda, `cargarEnvRaiz` o `dotenv` al alcance, archivos bajo `generated/` exentos, `.jsx` sin
      revisar) y no por errores de las pruebas. Las que exigen superusuario o enlaces simbólicos se confirman en la CI
      de Linux o en Docker
- [ ] T61 · backend · Envoltorio: funciones `async` que devuelven promesas nativas, marca de transacción activa y
      validación de argumentos de `$queryRaw`/`$executeRaw` con fragmentos y `Sql` de Prisma; tipo `ClienteTransaccion`
      (P-26) (criterios 106, 112)
- [ ] T62 · backend · Primera sentencia de `#fijarContexto` y de `enPlataforma` con `DateStyle`, `IntervalStyle`,
      `extra_float_digits` y `bytea_output`; excepción de esas llamadas exactas en `cli/` en `regla-sql-sesion.mjs`
      (criterio 107)
- [ ] T63 · backend · Falla cerrada: `estaBloqueado` con fechas inválidas, `fechaDeBase` y su uso en la sesión del
      superadmin y en las academias (P-27) (criterio 108)
- [ ] T64 · backend · Punto autorizado en `infraestructura/prisma/`: `Decimal`, `codigoDeErrorDeBase`,
      `esViolacionDeUnicidad`, `sql`, `join`, `vacio` y fragmentos opacos, exportados por el `index` (P-25)
      (criterio 114)
- [ ] T65 · backend · Lint del texto del SQL: funciones que ejecutan texto y esquemas ajenos (criterio 109), cláusula
      `SET` tras `UPDATE` (criterio 115) y etiquetas reconocidas por ámbito (criterio 112)
- [ ] T66 · backend · Lint de formas: `sql` del punto autorizado por ámbito en módulos y `Prisma.sql` del cliente
      generado en `cli/` como único argumento (criterio 112); `Prisma` en `cli/` solo como acceso con punto a un nombre
      fijo, sin `constructor`, `Reflect`, `Object.*`, desestructuraciones prohibidas ni `require`/`import()`
      (criterio 113)
- [ ] T67 · backend · Lint de acceso y archivos: exenciones exactas, `tsconfig.build.json`, prohibición de importar
      pruebas, `realpath`, `.jsx`, `generated/prisma/**`, `cargar-env` y `dotenv` fuera de `main.ts`, `cli/` y
      `entorno/`; `scripts/lib/fuentes-protegidas.mjs` y `scripts/comprobar-fuentes-protegidas.mjs` en `lint:protegido`
      (P-28) (criterios 110, 111, 117, 118, 119)
- [ ] T68 · backend · `retirarVariablesSensibles` sin distinguir mayúsculas; `cargarEnvRaiz` fuera del `index` de
      entorno y `main.ts` importándola de su archivo (criterios 116, 117)
- [ ] T69 · orquestador · `git diff` desde el commit de T60: T61 a T68 no tocaron pruebas protegidas
- [ ] T70 · adversarial · Ronda 5 sobre todo lo anterior, en especial 106 a 119 (promesas del envoltorio, parámetros
      de sesión, punto autorizado y lint); si hay fallas, se repite el ciclo

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
