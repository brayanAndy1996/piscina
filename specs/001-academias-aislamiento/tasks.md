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

Tras la ronda 5 se agregaron los criterios 120 a 129 (sección N de `spec.md`) y las precisiones P-29 y P-30; sus
tareas son T71 a T81, antes del cierre. Los criterios 80, 102 y 107 y la precisión P-28 quedaron complementados o con
la excepción de `cli/` ampliada.

Tras la ronda 6 se agregaron los criterios 130 a 136 (sección O de `spec.md`) y las precisiones P-31 a P-33; sus tareas
son T82 a T91, antes del cierre. Los criterios 9 a 13, 17, 18, 84, 94, 100, 102, 106, 121, 123, 124 y 126 y la precisión
P-26 quedaron ampliados, complementados o con la preparación de su prueba ajustada.

Tras la ronda 7 se agregaron los criterios 137 a 140 (sección P de `spec.md`); sus tareas son T92 a T98.

Tras la ronda 8 se agregaron los criterios 141 a 143 (sección Q de `spec.md`), la precisión P-34 y una precisión de P-31;
sus tareas son T99 a T106, antes del cierre. La definición de "esquemas revisados" (sección O) y los criterios 5, 130, 131 y
137 quedaron ajustados o ampliados.

Tras la ronda 12 se agregaron los criterios 156 a 158 (sección U de `spec.md`), las precisiones P-39 y P-40 y una
precisión de P-38; sus tareas son T130 a T138, antes del cierre. Los criterios 21, 26, 30, 106, 149 y 153 quedaron
ampliados o precisados.

Tras la ronda 15 se agregaron los criterios 165 y 166 (sección X de `spec.md`) y una precisión de P-42; sus tareas son
T155 a T162, antes del cierre. Los criterios 157, 161, 162 y 163 quedaron ampliados o precisados.

Tras la ronda 16 se agregaron los criterios 167 y 168 (sección Y de `spec.md`) y una precisión de P-42; sus tareas son
T163 a T169, antes del cierre. Los criterios 162 y 165 quedaron precisados o ampliados, y se corrigieron los riesgos
aceptados "Errores de la base fuera del alcance de la búsqueda" y "Diagnóstico perdido en errores grandes". La pregunta
técnica R16-1 la resolvió el orquestador antes de T163 (un error con un binario se registra convertido, sin el binario;
criterio 167).

## Pruebas protegidas (en rojo)

- [x] T1 · test-writer · Utilidades de prueba de `backend/test/utilidades/` según el contrato de `spec.md`
      (`aplicacion.ts`, `base-datos.ts`, `academias.ts`, `superadmins.ts`, `comandos.ts`), con la marca de pruebas
      protegidas; y pruebas protegidas de aislamiento: rol de la app, rol inseguro, catálogo, RLS, `resolver_academia`,
      `BaseDatos`, auditoría y la prueba unitaria del entorno (criterios 1 a 5, 9 a 26, 28 a 31, 47)
- [x] T2 · test-writer · Pruebas protegidas del comando del superadmin, la sesión, el bloqueo, el límite por IP, las
      academias de la plataforma y la ruta pública (criterios 32 a 46, 48, 50 a 60)
- [x] T3 · tester · Confirmar que T1 y T2 fallan por falta de la funcionalidad (tablas, rutas o servicios
      inexistentes) y no por errores de sintaxis, importaciones o configuración. Commit del orquestador:
      "Pruebas protegidas (001): aislamiento, superadmin y academias (en rojo)"

## Base de datos y acceso a datos

- [x] T4 · backend · Contratos: `academias.ts`, `plataforma.ts` y `detallesValidacionSchema`, con pruebas unitarias
      de los esquemas, en especial del nombre corto (criterios 49, 66)
- [x] T5 · backend · Entorno: `DATABASE_URL_APP`, `JWT_SECRETO` (y el rechazo del valor de ejemplo en producción),
      `DATABASE_POOL_MAX`; `.env.example`; `scripts/lib/entorno.mjs` (`leerUrlApp`, `urlAppSobre`); `global-setup.ts`
      fija `DATABASE_URL_APP` para las pruebas (criterios 5, 62)
- [x] T6 · backend · Rol `aquagestion_app`: `asegurarRolApp` en `crear-bases.mjs` con sus pruebas de integración;
      paso del hook de sesión con `sentenciaCrearRolApp` y su prueba unitaria; variables en `ci.yml` (criterios 6, 8,
      64). Quién crea el rol (P-11, tras T1–T2, 11/11/2026): en la nube el hook como `postgres`; en Windows
      `db:crear` con el superusuario del contenedor de Docker; en la CI `db:crear` con el usuario del servicio
- [x] T7 · backend · Esquema de Prisma y migración `academias_aislamiento`: comprobación del rol, tablas, `CHECK`,
      índices, funciones, RLS forzada, políticas y privilegios (criterios 1, 2, 7, 9 a 20)
- [x] T8 · backend · `BaseDatos`: `conAcademia`, `comoPlataforma`, `resolverAcademia`, `comprobarConexion`,
      verificación del rol inseguro, errores de academia; `PrismaService` interno; salud con `comprobarConexion`;
      regla de lint de importaciones de Prisma con su prueba (criterios 3, 4, 21 a 28)
- [x] T9 · backend · `ErrorNegocio`, ampliación del filtro de errores y pipe de validación con `detalles`, con
      pruebas unitarias (criterio 66)
- [x] T10 · backend · `AuditoriaService` con `registrarEnAcademia` y `registrarEnPlataforma` (criterios 29 a 31)

## Superadmin y academias

- [x] T11 · backend · Seguridad compartida: `claves.ts` (argon2id y hash ficticio) y `tokens.ts` (JWT HS256 con
      `RELOJ`), cookie `aq_plataforma` (criterios 36, 37, 43)
- [x] T12 · backend · Comando `plataforma:superadmin` (crear y restablecer, validación, auditoría, sin imprimir la
      clave) (criterios 32 a 35, 46)
- [x] T13 · backend · Sesión del superadmin: inicio con bloqueo atómico y función pura de bloqueo con pruebas
      unitarias, límite por IP con `@nestjs/throttler`, guard de sesión, cierre de sesión, registro en el log sin la
      clave (criterios 36 a 46)
- [x] T14 · backend · Academias de la plataforma: crear, listar, suspender y reactivar, con auditoría y manejo de
      carreras; `Cache-Control: no-store` (criterios 32, 48, 50 a 57)
- [x] T15 · backend · Ruta pública `GET /api/a/{nombreCorto}` con un resolvedor reutilizable para rutas públicas
      (criterios 58 a 60)
- [x] T16 · backend · Semilla con las dos academias y el superadmin de desarrollo; `npm run env:completar` con sus
      pruebas; actualización de las pruebas de 000 afectadas (criterios 61, 63, 65)

## Web y E2E

- [x] T17 · frontend · Cliente HTTP con envío y errores tipados; páginas `/plataforma/ingresar` y
      `/plataforma/academias` con crear, suspender, reactivar y cerrar sesión; rutas; pruebas de los estados
      principales (criterios 68, 69, 70)
- [x] T18 · frontend · Prueba E2E de la plataforma y ajustes de `playwright.config.ts` (variables de la app y
      superadmin de prueba) (criterio 71)

## Verificación

- [x] T19 · tester · Las pruebas protegidas de T1 y T2 pasan sin cambios; en la nube: hook de sesión desde cero (rol
      `aquagestion_app` creado), `npm run db:preparar`, migración sin el rol (mensaje del criterio 7, en una base
      temporal y restaurando el rol después) (criterios 7, 8)
- [x] T20 · orquestador · `git diff` desde el commit de T3: ningún commit de implementación tocó las pruebas
      protegidas ni las utilidades marcadas
- [x] T21 · adversarial · Ataque según "Qué ataca el adversarial en AquaGestión": cambio de ids y de nombre corto,
      consultas sin contexto o con otro, conexiones reutilizadas, concurrencia en el bloqueo, la creación y la
      suspensión, tokens falsificados o reutilizados, privilegios del rol. Por cada falla: especificador (criterio
      nuevo con origen "ataque ronda N"), test-writer (prueba protegida en rojo, commit
      "Pruebas protegidas (001), ataque ronda N: … (en rojo)"), backend (corrección), y nueva ronda hasta que no haya
      fallas
- [x] T22 · revisor · Revisión contra la especificación y `CLAUDE.md`: criterios de revisión (28, 62, 64, 65), que
      ningún módulo use Prisma fuera de `BaseDatos`, que ninguna clave o secreto real quede en el repositorio (y que
      ningún secreto de prueba válido en producción esté escrito en él, criterio 91),
      scripts compatibles con Windows
- [x] T23 · tester · Suite completa (`npm test`), `lint`, `typecheck`, `format:check`, `build` y, si hay navegador,
      `npm run e2e`

_(12/11/2026: el ciclo adversarial terminó con la ronda 19 sin fallas (T182). Las siguientes son T22, T23 y T24, en
ese orden.)_

## Ataque adversarial, ronda 1 (11/11/2026)

Fallas F1 a F3, O1, O2 y O4 de la ronda 1; criterios 72 a 79 de `spec.md` (sección J). O3, O5, O6 y los ya
aceptados quedaron en "Riesgos aceptados".

- [x] T26 · test-writer · Pruebas protegidas en rojo de los criterios 72 a 79 (archivos en "Pruebas" del plan,
      sección 13), con la marca de pruebas protegidas, sin mirar la implementación. Commit: "Pruebas protegidas
      (001), ataque ronda 1: contexto, cuerpos, límite, textos y entorno (en rojo)"
- [x] T27 · tester · Confirmar que T26 falla por la razón esperada (contexto residual visible, form aceptado,
      400/413 sin contar, 500 o texto aceptado, `NODE_ENV` o secreto aceptados) y no por errores de las pruebas
- [x] T28 · backend · `BaseDatos` fija los dos valores de contexto en `conAcademia`, `comoPlataforma` y
      `resolverAcademia`; regla de lint del SQL de sesión con su prueba (criterios 72, 73)
- [x] T29 · backend · Middlewares de `/api` en el orden del plan: límite del inicio de sesión antes del lector del
      cuerpo (sin `ThrottlerGuard`), rechazo de cuerpos no JSON y lector JSON propio (criterios 74, 75)
- [x] T30 · backend · `packages/contratos/src/texto.ts` (`sinControles`, `textoVisibleSchema`) con pruebas unitarias;
      uso en `plataforma.ts`, `academias.ts` y el comando del superadmin (criterios 76, 77)
- [x] T31 · frontend · Motivo de suspensión en un campo de una línea; los formularios muestran los errores de texto de
      los esquemas (criterios 76, 77)
- [x] T32 · backend · `NODE_ENV` de lista cerrada en `validarEntorno` y la semilla; reglas de `JWT_SECRETO` en
      producción y lista de secretos públicos con su prueba (criterios 78, 79)
- [x] T33 · orquestador · `git diff` desde el commit de T27: T28 a T32 no tocaron pruebas protegidas
- [x] T34 · adversarial · Ronda 2 sobre todo lo anterior, en especial 72 a 79; si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 2 (11/11/2026)

Fallas F1 a F6, O1, O2, O4, O5 y O6 de la ronda 2; criterios 80 a 91 de `spec.md` (sección K). O3 quedó en
"Riesgos aceptados". Detalle técnico en la sección 14 del plan.

- [x] T35 · test-writer · Pruebas protegidas en rojo de los criterios 80 a 90 (archivos en "Protegidas del ataque
      ronda 2" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación; y criterio 91:
      reemplazar en las pruebas los secretos fijos que cumplen el criterio 79 por secretos generados con
      `randomBytes`, empezando por `backend/test/integracion/plataforma/sesion.test.ts`. Commit: "Pruebas protegidas
      (001), ataque ronda 2: rol, temporales, lint, cliente, textos, codificación y comandos (en rojo)"
- [x] T36 · tester · Confirmar que T35 falla por la razón esperada (rol inseguro aceptado, `CREATE TEMP` permitido,
      formas de SQL o importaciones que pasan el lint, cliente accesible, texto en blanco o longitud UTF-16 aceptados,
      415 en lugar de 400, contexto de academia en `enPlataforma`) y no por errores de las pruebas. Las de integración
      de 80 y 81 que se omiten en la nube se confirman en la CI
- [x] T37 · backend · Comprobación completa del rol en `BaseDatos` con la función pura `problemasDelRol` (criterio
      80)
- [x] T38 · backend · `scripts/lib/rol-app.mjs`, `asegurarRolApp`/`crearBases` con la lista completa y la revocación
      de `TEMPORARY`, y el paso del rol del hook de sesión (criterios 81, 82)
- [x] T39 · backend · Migración `<marca>_endurecer_rol_app` (criterio 82)
- [x] T40 · backend · Normalización del SQL y reglas nuevas en `eslint/regla-sql-sesion.mjs` (criterios 83, 84)
- [x] T41 · backend · `eslint/regla-acceso-base.mjs`, `eslint-disable` sin efecto sobre las reglas protegidas y
      `#prisma` en `BaseDatos` (criterios 85, 86)
- [x] T42 · backend · `texto.ts`: visibles sin ignorables ni U+2800 y longitudes por puntos de código; uso en
      `plataforma.ts`, `academias.ts`, `superadmin-datos.ts` y la semilla (criterios 87, 88)
- [x] T43 · backend · Middleware de `Content-Encoding` y traducción de los errores de descompresión (criterio 89)
- [x] T44 · backend · `enPlataforma` fija los dos valores de contexto (criterio 90)
- [x] T45 · orquestador · `git diff` desde el commit de T36: T37 a T44 no tocaron pruebas protegidas
- [x] T46 · adversarial · Ronda 3 sobre todo lo anterior, en especial 80 a 91; si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 3 (11/11/2026)

Fallas F1 a F6 y observaciones O1 a O5 de la ronda 3; criterios 92 a 105 de `spec.md` (sección L) y precisiones
P-19 a P-24. Las claves JSON duplicadas y lo que el rol aún puede hacer en SQL (objetos grandes, conexión a
`postgres`, `pg_terminate_backend`, su propia contraseña) quedaron en "Riesgos aceptados". Detalle técnico en la
sección 15 del plan.

- [x] T47 · test-writer · Pruebas protegidas en rojo de los criterios 92 a 105 (archivos en "Protegidas del ataque
      ronda 3" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. En el mismo
      commit, adaptar las protegidas de lint de las rondas 1 y 2 (`eslint/regla-sql-sesion.test.mjs`,
      `eslint/regla-sql-sesion-ronda2.test.mjs`, `eslint/regla-acceso-base.test.mjs`) al alcance nuevo de los
      criterios 92 y 96, sin quitar ningún texto SQL de los ejemplos; y actualizar la prueba no protegida
      `scripts/test/preparar-sesion.test.mjs` al verificador SCRAM (criterio 104). Commit: "Pruebas protegidas (001),
      ataque ronda 3: lint por plantillas, zona horaria, entorno, envoltorio, cursores, privilegios, SCRAM y UTF-8
      (en rojo)" (criterios 73, 83 a 85, 92 a 105)
- [x] T48 · tester · Confirmar que T47 falla por la razón esperada (SQL fuera de plantillas o `UESCAPE` que pasan el
      lint, falsos positivos que fallan, `eslint-disable` sin efecto en el lint normal, fechas corridas 5 horas,
      `DATABASE_URL` en `process.env`, cliente alcanzable, cursor que sobrevive, `GRANT` o `ALTER ROLE … SET`
      aceptados, contraseña en claro, U+FFFD guardado) y no por errores de las pruebas. Las de integración que crean
      roles (104 y parte de 102 y 103 en `db:crear`) se confirman en la CI
- [x] T49 · backend · Lint: la regla del SQL solo sobre plantillas etiquetadas y la regla de formas; `UESCAPE` en
      `normalizarSql`; sentencias y funciones nuevas prohibidas; excepción de `set_config('TimeZone', 'UTC', true)` en
      `cli/` (criterios 92, 93, 94, 98)
- [x] T50 · backend · Lint: reglas de acceso en todas las extensiones, rutas a `node_modules`, importaciones de `cli/`
      y de los internos de `infraestructura/prisma/`; `eslint.protegido.config.mjs`, script `lint:protegido` dentro de
      `npm run lint`, sin `noInlineConfig`; bloque de `.cts` en `eslint.config.mjs` (criterios 95, 96, 97)
- [x] T51 · backend · `BaseDatos`: cliente creado dentro de la clase sin proveedor de Nest, métodos `#`, prototipo
      congelado, envoltorio de `trabajo` y tipo `ClienteTransaccion` (P-24); `TimeZone` en `UTC` y `CLOSE ALL` en cada
      transacción (criterios 98, 100, 101)
- [x] T52 · backend · `cli/conexion.ts`: `enPlataforma` con `TimeZone` y `CLOSE ALL`; `crearClienteDelDueno(url,
      { max })` (P-23) (criterios 98, 101)
- [x] T53 · backend · `retirarVariablesSensibles` (P-21) y su llamada en `main.ts` (criterio 99)
- [x] T54 · backend · Comprobación de privilegios de más y de valores por defecto del rol en la API
      (`privilegios-app.ts`, `problemasDeConfiguracion`) y en `db:crear` (`scripts/lib/rol-app.mjs`), con
      `PRIVILEGIOS_APP` igual en los dos lados (P-19, P-20) (criterios 102, 103)
- [x] T55 · backend · `verificadorScram` (P-22) en `scripts/lib/rol-app.mjs`; sentencias de `db:crear` y del hook con
      el verificador y rechazo de contraseñas fuera de ASCII imprimible (criterio 104)
- [x] T56 · backend · UTF-8 estricto en el lector JSON y traducción del error de `verify` a 400 en el filtro
      (criterio 105)
- [x] T57 · orquestador · `git diff` desde el commit de T48: T49 a T56 no tocaron pruebas protegidas
- [x] T58 · adversarial · Ronda 4 sobre todo lo anterior, en especial 92 a 105 (el lint nuevo, el envoltorio, la zona
      horaria y la comprobación del rol); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 4 (11/11/2026)

Fallas F1 a F7, falsos positivos y observaciones de la ronda 4 (sobre `066c9af`); criterios 106 a 119 de `spec.md`
(sección M) y precisiones P-25 a P-28. Se reconfirmaron los riesgos aceptados (SQL armado en tiempo de ejecución,
comprobación del rol una vez por proceso, objetos grandes, `pg_terminate_backend`, `ALTER ROLE … PASSWORD` propio,
claves JSON duplicadas y límite por IP en memoria y /128) y se agregaron la nota de proceso sobre el lint y la cadena
`'WITH HOLD'` como limitación. Detalle técnico en la sección 16 del plan.

- [x] T59 · test-writer · Pruebas protegidas en rojo de los criterios 106 a 119 (archivos en "Protegidas del ataque
      ronda 4" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. En el mismo
      commit, adaptar `eslint/regla-sql-plantillas.test.mjs` a los criterios 112 y 114 como dice "Impacto en
      especificaciones anteriores" (importaciones de `sql`, `join` y `Prisma`), sin quitar ejemplos ni cambiar los que
      fallan; y comprobar que ningún ejemplo de las protegidas de lint de las rondas 1 a 3 cambia de resultado con el
      criterio 115 (si alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 4:
      promesas nativas, formato de sesión, fechas inválidas, lint de funciones, exenciones, enlaces, etiquetas, alias,
      punto autorizado y entorno (en rojo)" (criterios 92, 106 a 119)
- [x] T60 · tester · Confirmar que T59 falla por la razón esperada (promesas con `requestTransaction` o fuera de la
      transacción, escritura que sobrevive, `DateStyle` contaminado que anula el bloqueo o da 500, fecha inválida que
      deja entrar, funciones de texto que pasan el lint, `atajo.test.util.ts` exento, enlace que evade, `sql` local u
      objeto falso aceptados, alias de `Prisma` que pasan, punto autorizado inexistente, `UPDATE … SET role` que falla,
      `PgPassword` que queda, `cargarEnvRaiz` o `dotenv` al alcance, archivos bajo `generated/` exentos, `.jsx` sin
      revisar) y no por errores de las pruebas. Las que exigen superusuario o enlaces simbólicos se confirman en la CI
      de Linux o en Docker
- [x] T61 · backend · Envoltorio: funciones `async` que devuelven promesas nativas, marca de transacción activa y
      validación de argumentos de `$queryRaw`/`$executeRaw` con fragmentos y `Sql` de Prisma; tipo `ClienteTransaccion`
      (P-26) (criterios 106, 112)
- [x] T62 · backend · Primera sentencia de `#fijarContexto` y de `enPlataforma` con `DateStyle`, `IntervalStyle`,
      `extra_float_digits` y `bytea_output`; excepción de esas llamadas exactas en `cli/` en `regla-sql-sesion.mjs`
      (criterio 107)
- [x] T63 · backend · Falla cerrada: `estaBloqueado` con fechas inválidas, `fechaDeBase` y su uso en la sesión del
      superadmin y en las academias (P-27) (criterio 108)
- [x] T64 · backend · Punto autorizado en `infraestructura/prisma/`: `Decimal`, `codigoDeErrorDeBase`,
      `esViolacionDeUnicidad`, `sql`, `join`, `vacio` y fragmentos opacos, exportados por el `index` (P-25)
      (criterio 114)
- [x] T65 · backend · Lint del texto del SQL: funciones que ejecutan texto y esquemas ajenos (criterio 109), cláusula
      `SET` tras `UPDATE` (criterio 115) y etiquetas reconocidas por ámbito (criterio 112)
- [x] T66 · backend · Lint de formas: `sql` del punto autorizado por ámbito en módulos y `Prisma.sql` del cliente
      generado en `cli/` como único argumento (criterio 112); `Prisma` en `cli/` solo como acceso con punto a un nombre
      fijo, sin `constructor`, `Reflect`, `Object.*`, desestructuraciones prohibidas ni `require`/`import()`
      (criterio 113)
- [x] T67 · backend · Lint de acceso y archivos: exenciones exactas, `tsconfig.build.json`, prohibición de importar
      pruebas, `realpath`, `.jsx`, `generated/prisma/**`, `cargar-env` y `dotenv` fuera de `main.ts`, `cli/` y
      `entorno/`; `scripts/lib/fuentes-protegidas.mjs` y `scripts/comprobar-fuentes-protegidas.mjs` en `lint:protegido`
      (P-28) (criterios 110, 111, 117, 118, 119)
- [x] T68 · backend · `retirarVariablesSensibles` sin distinguir mayúsculas; `cargarEnvRaiz` fuera del `index` de
      entorno y `main.ts` importándola de su archivo (criterios 116, 117)
- [x] T69 · orquestador · `git diff` desde el commit de T60: T61 a T68 no tocaron pruebas protegidas
- [x] T70 · adversarial · Ronda 5 sobre todo lo anterior, en especial 106 a 119 (promesas del envoltorio, parámetros
      de sesión, punto autorizado y lint); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 5 (11/11/2026)

Fallas F1 a F3 y observaciones O1, O3 y O5 de la ronda 5 (sobre `b5ff3e9`); criterios 120 a 129 de `spec.md` (sección
N) y precisiones P-29 y P-30. O2, O4, O6, O7 y O8 quedaron en "Riesgos aceptados". Detalle técnico en la sección 17 del
plan.

- [x] T71 · test-writer · Pruebas protegidas en rojo de los criterios 120 a 129 (archivos en "Protegidas del ataque
      ronda 5" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. Comprobar que
      ningún ejemplo que pasa en las protegidas de lint de las rondas 1 a 4 empieza a fallar por el criterio 128 (si
      alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 5: sesión con la clave
      vigente, search_path, cadenas estándar, esquemas del rol, objetos que se saltan RLS, unicidad por academia y
      dependencias (en rojo)" (criterios 120 a 129)
- [x] T72 · tester · Confirmar que T71 falla por la razón esperada (cookie emitida con la clave anterior, tablas o
      funciones de `trampa` usadas, `standard_conforming_strings` en `off`, esquema propio o con `CREATE` aceptado,
      funciones de detección inexistentes, regla de paquetes y lista negra inexistentes, `scripts/lib/dependencias-backend.mjs`
      inexistente) y no por errores de las pruebas. Las que pasan ya en verde por diseño (124, 125 y 126 sobre las
      migraciones actuales, y la parte de autodetección de esas consultas) se informan como tales. Las que exigen
      superusuario o `CREATE` en la base se confirman en la CI de Linux o en Docker
- [x] T73 · backend · Sesión: `aceptarIntento` compara `clave_hash` y `version_token` bajo `FOR UPDATE` con los leídos
      al verificar; si cambiaron, 401 sin escribir ni contar el intento (criterio 120)
- [x] T74 · backend · Primera sentencia de `#fijarContexto` y de `enPlataforma` con `pg_catalog.set_config`,
      `search_path` y `standard_conforming_strings`; excepciones de `cli/` en `regla-sql-sesion.mjs`, también con
      `pg_catalog.` (criterios 121, 122)
- [x] T75 · backend · Comprobación del rol en una transacción con la primera sentencia y con el catálogo calificado
      con `pg_catalog.` (criterio 121); condiciones de esquemas con `problemasDeEsquemas` en la API (P-29) (criterio 123)
- [x] T76 · backend · `db:crear`: condiciones de esquemas con `problemasDeEsquemasApp` (P-29), consultas calificadas y
      `search_path` fijo en la conexión del script; confirmar los casos de vistas y vistas materializadas (criterios 123,
      125)
- [x] T77 · backend · Si las pruebas de catálogo de 124 o 126 fallan con las migraciones actuales, corregir lo que
      señalen (sin editar migraciones aplicadas: una migración nueva) (criterios 124, 126)
- [x] T78 · backend · `scripts/lib/dependencias-backend.mjs` (P-30) y su llamada en
      `scripts/comprobar-fuentes-protegidas.mjs`; `express` en `backend/package.json` y en la lista (criterio 127)
- [x] T79 · backend · Reglas de paquetes declarados y de la lista negra en `eslint/regla-acceso-base.mjs`, en el lint
      normal y en el paso protegido (criterios 128, 129)
- [x] T80 · orquestador · `git diff` desde el commit de T72: T73 a T79 no tocaron pruebas protegidas
- [x] T81 · adversarial · Ronda 6 sobre todo lo anterior, en especial 120 a 129 (sesión durante un restablecimiento,
      `search_path`, esquemas, objetos del catálogo y dependencias); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 6 (12/11/2026)

Fallas F1 a F3 y observaciones O2 y O4 de la ronda 6 (sobre `84b367b`); criterios 130 a 136 de `spec.md` (sección O) y
precisiones P-31 a P-33. O1, O3 y O4 quedan además como notas en la sección 18 del plan. La ronda no encontró fallas en
las garantías de ejecución de 001.

- [x] T82 · test-writer · Pruebas protegidas en rojo de los criterios 130 a 136 (archivos en "Protegidas del ataque
      ronda 6" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación, incluidas las
      utilidades `politicas.ts` y `sembradores.ts` (P-33). En el mismo commit: ampliar a los esquemas revisados las pruebas
      de catálogo de los criterios 9, 10, 11, 12, 124 y 126 (criterio 131), y adaptar `backend/test/utilidades/search-path.ts`
      (criterio 121) como dice "Impacto en especificaciones anteriores", ronda 6, sin quitar casos ni cambiar lo que
      comprueban; comprobar que ningún ejemplo de las protegidas de lint de las rondas 1 a 5 cambia de resultado con el
      criterio 136 (si alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 6:
      privilegios en todos los esquemas, catálogo fuera de public, forma y ejecución de las políticas, transacción
      guardada y SQL de sesión (en rojo)" (criterios 121, 130 a 136)
- [x] T83 · tester · Confirmar que T82 falla por la razón esperada (vista de `reportes` u otro privilegio fuera de
      `public` aceptado, `privilegiosDeMasEnEsquemas` inexistente, `tx` de otra transacción usado sin rechazo, regla de
      la transacción guardada inexistente, `SET CONSTRAINTS` rechazado, `lastval`/`currval` aceptados) y no por errores
      de las pruebas. Las que pasan ya en verde por diseño (131, 132 y 133 sobre las migraciones actuales, sus
      autocomprobaciones y la prueba del criterio 121 adaptada) se informan como tales. Las que exigen crear esquemas,
      superusuario o `SET ROLE aquagestion_app` se confirman en la CI de Linux o en Docker
- [x] T84 · backend · `FUNCIONES_APP`, `ESQUEMAS_PERMITIDOS` y `privilegiosDeMasEnEsquemas` en `privilegios-app.ts`
      (P-31); consulta de privilegios en los esquemas revisados en `#comprobarRol`, con el log que nombra esquema, objeto
      y privilegio (criterio 130)
- [x] T85 · backend · Lo mismo en `scripts/lib/rol-app.mjs` y en `problemasDePrivilegios` de `scripts/crear-bases.mjs`,
      con las correcciones `REVOKE … FROM aquagestion_app` o `FROM PUBLIC` (criterio 130)
- [x] T86 · backend · Envoltorio atado a su contexto con `AsyncLocalStorage`: marca por transacción, comprobación en cada
      llamada y `ejecutar` en `#transaccion` (P-32) (criterio 134)
- [x] T87 · backend · Regla `eslint/regla-transaccion-guardada.mjs` en el lint normal, con la prohibición de
      `async_hooks` fuera de `infraestructura/` (criterio 135)
- [x] T88 · backend · `regla-sql-sesion.mjs`: `SET CONSTRAINTS … DEFERRED/IMMEDIATE` como sentencia permitida y `lastval`
      y `currval` en la lista de funciones prohibidas (criterio 136)
- [x] T89 · backend · Si las pruebas de 131, 132 o 133 señalan algo con las migraciones actuales, corregirlo con una
      migración nueva (sin editar las aplicadas) (criterios 131 a 133)
- [x] T90 · orquestador · `git diff` desde el commit de T83: T84 a T89 no tocaron pruebas protegidas
- [x] T91 · adversarial · Ronda 7 sobre todo lo anterior, en especial 130 a 136 (privilegios fuera de `public`, objetos
      de extensiones, forma de las políticas, prueba de ejecución por tabla, transacción usada desde otro contexto y lint
      del SQL); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 7 (12/11/2026)

Fallas F1 a F3 y observación O5 de la ronda 7 (sobre `bb3ff2d`); criterios 137 a 140 de `spec.md` (sección P) y precisión
de P-33 (ronda 7). O1, O2, O4 y O6 quedan como notas en la sección 19 del plan. La ronda no encontró fallas críticas ni
altas.

- [x] T92 · test-writer · Pruebas protegidas en rojo de los criterios 137 a 140 (archivos en "Protegidas del ataque
      ronda 7" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. En el mismo commit:
      adaptar `aislamiento/rls-todas-las-tablas.test.ts` al criterio 138 (fila de prueba válida en B, juicio por lo escrito,
      autocomprobación con disparadores, sin quitar casos), `politicas.ts` y `forma-politicas.test.ts` al 140, y
      `sembradores.ts` si algún sembrador no crea una fila nueva por llamada (P-33, ronda 7); comprobar que ningún ejemplo
      de `eslint/regla-transaccion-guardada.test.mjs` cambia de resultado con el 139 (si alguno cambiara, detenerse e
      informar). Commit: "Pruebas protegidas (001), ataque ronda 7: extensiones en db:crear, INSERT en otra academia,
      EventEmitterAsyncResource y subconsulta en las políticas (en rojo)" (criterios 133, 137 a 140)
- [x] T93 · tester · Confirmar que T92 falla por la razón esperada: `db:crear` informa un privilegio de más sobre un
      objeto de la extensión instalada en `public` (137) y la regla no señala `EventEmitterAsyncResource` ni
      `getBuiltinModule('async_hooks')` (139). Se informan como verdes por diseño: la API con la extensión y los controles
      del 137, la prueba de catálogo del 137, la prueba de ejecución del 133 adaptada al 138 y su autocomprobación, y la
      forma de las políticas con la subconsulta (140), porque cambian solo pruebas. Lo que exige superusuario, instalar
      extensiones o `SET ROLE aquagestion_app` se confirma en la CI de Linux o en Docker
- [x] T94 · backend · `problemasDePrivilegios` de `scripts/crear-bases.mjs` sin objetos de extensiones en las tres ramas de
      su consulta, conservando el formato de sus mensajes (plan, sección 19) (criterio 137)
- [x] T95 · backend · `eslint/regla-transaccion-guardada.mjs`: `EventEmitterAsyncResource` en cualquier forma y
      `getBuiltinModule` salvo con un literal que no sea `async_hooks`, fuera de `backend/src/infraestructura/` (criterio
      139)
- [x] T96 · backend · Si la prueba de catálogo del 137 o las de 138 y 140 señalan algo con las migraciones actuales,
      corregirlo con una migración nueva (sin editar las aplicadas) (criterios 137, 138, 140)
- [x] T97 · orquestador · `git diff` desde el commit de T92: T94 a T96 no tocaron pruebas protegidas
- [x] T98 · adversarial · Ronda 8 sobre todo lo anterior, en especial 137 a 140 (API y `db:crear` ante extensiones,
      objetos agregados a una extensión, fila de prueba del `INSERT` con disparadores y restricciones, emisores y recursos
      asíncronos que conservan el contexto, forma de las políticas con subconsulta); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 8 (12/11/2026)

Falla F1 y observación O1 de la ronda 8 (sobre `65a4166`); criterios 141 a 143 de `spec.md` (sección Q), precisión de P-31 y
P-34. O2 y O3 quedan como notas en la sección 20 del plan. La ronda no encontró fallas en las garantías de ejecución de 001.

- [x] T99 · test-writer · Pruebas protegidas en rojo de los criterios 141 a 143 (archivos en "Protegidas del ataque ronda 8"
      del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: el caso reproducido
      (`pgcrypto` en `public`, `ALTER EXTENSION pgcrypto ADD SCHEMA reportes2`, tabla sin RLS con `GRANT` a la app) en la
      API, en `db:crear` y en el catálogo, sus variantes y el control con un esquema de extensión que solo tiene objetos de
      la extensión (141, 142); y P-34 en los dos archivos, `validarEntorno`, `analizarUrlPostgres`, `db:crear`, el hook, el
      comando y la semilla (143). En el mismo commit: quitar de `esquemasRevisados` (`backend/test/utilidades/catalogo.ts`)
      la exclusión de los esquemas de extensiones (142) y comprobar que ninguna protegida anterior cambia de resultado sobre
      la base de pruebas real ni por el criterio 143 (si alguna cambiara, detenerse e informar). Commit: "Pruebas protegidas
      (001), ataque ronda 8: esquemas de extensiones y parámetros de conexión en la URL (en rojo)" (criterios 141 a 143)
- [x] T100 · tester · Confirmar que T99 falla por la razón esperada: la API y `db:crear` aceptan la tabla de `reportes2`
      (141), la autocomprobación del catálogo no ve los objetos de `reportes_ext_prueba` hasta el ajuste de
      `esquemasRevisados` (142; con el ajuste en el mismo commit se informa como verde por diseño), y `url-postgres.ts` y
      `parametrosDeConexionProhibidos` no existen o `validarEntorno`, `db:crear`, el hook, el comando y la semilla aceptan
      `?user=` (143). Se informan como verdes por diseño el control del caso 4 del 141 y los casos que pasan del 143. Lo que
      exige instalar extensiones o ser su dueño se confirma en la CI de Linux o en Docker si en la nube se omite
- [x] T101 · backend · Esquemas revisados sin la exclusión de esquemas de extensiones y tipo compuesto de extensión por su
      `reltype`, en `#comprobarRol` (`base-datos.ts`) y en `problemasDePrivilegiosEnEsquemas` (`scripts/crear-bases.mjs`),
      y en cualquier otra consulta de producción que repita la condición (plan, sección 20) (criterio 141)
- [x] T102 · backend · `PARAMETROS_DE_CONEXION_PROHIBIDOS` y `parametrosDeConexionProhibidos` en
      `backend/src/infraestructura/entorno/url-postgres.ts` y en `scripts/lib/entorno.mjs` (P-34); llamada en
      `validarEntorno` y en `analizarUrlPostgres` (cubre `db:crear` y el hook) (criterio 143)
- [x] T103 · backend · La misma comprobación en `backend/src/cli/superadmin.ts` y `backend/prisma/seed.ts` sobre
      `DATABASE_URL`, antes de `crearClienteDelDueno`; opcional, en `scripts/prisma.mjs` (plan, sección 20) (criterio 143)
- [x] T104 · backend · Si las pruebas de 141 o 142 señalan algo con las migraciones actuales, corregirlo con una migración
      nueva (sin editar las aplicadas) (criterios 141, 142)
- [x] T105 · orquestador · `git diff` desde el commit de T99: T101 a T104 no tocaron pruebas protegidas
- [x] T106 · adversarial · Ronda 9 sobre todo lo anterior, en especial 141 a 143 (objetos propios en esquemas de
      extensiones, tipos y otros objetos de extensiones, parámetros de la URL y diferencias entre los lectores de URL); si
      hay fallas, se repite el ciclo

## Ataque adversarial, ronda 9 (12/11/2026)

Fallas F1 (alta) y F2 (media) y observaciones O1 y O2 de la ronda 9 (sobre `532eee4`); criterios 144 a 148 de `spec.md`
(sección R) y precisión P-35. Plan, sección 21.

- [x] T107 · test-writer · Pruebas protegidas en rojo de los criterios 144 a 148 (archivos en "Protegidas del ataque ronda
      9" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: catálogo de volatilidad y
      cuerpo de las funciones con su autocomprobación (144); plan guardado con la API en `DATABASE_POOL_MAX=1` y
      autocomprobación con `app_academia_actual()` en `IMMUTABLE` (145); `client_encoding` con la vía (a) en `BaseDatos`,
      en `POST /api/plataforma/academias` y en `enPlataforma` (146); `synchronous_commit`, `array_nulls` y
      `transform_null_equals` con las vías (a) y (b) (147); la regla de `cli/` para las cuatro llamadas nuevas (146 y 147);
      y `diferenciasConDesarrollo`, `db:crear` y la función del hook de P-35 (148). En el mismo commit: adaptar la
      `DATABASE_URL_APP` de las pruebas protegidas anteriores que ejecutan `db:crear`, `db:preparar`, `crearBases` o el paso
      3b del hook al servidor, el puerto y la base de su `DATABASE_URL` ("Impacto en especificaciones anteriores", ronda 9),
      sin cambiar lo que comprueban; comprobar que ningún ejemplo de las protegidas de lint anteriores cambia de resultado
      (si alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 9: volatilidad de las
      funciones de contexto, client_encoding y parámetros de integridad, y DATABASE_URL_APP en db:crear (en rojo)"
      (criterios 144 a 148)
- [x] T108 · tester · Confirmar que T107 falla por la razón esperada: el texto con `Ñandú` se guarda alterado y
      `current_setting('client_encoding')` no es `UTF8` (146); `synchronous_commit`, `array_nulls` y
      `transform_null_equals` llegan contaminados (147); la regla de `cli/` rechaza las cuatro llamadas nuevas (146 y
      147); `diferenciasConDesarrollo` no existe y `db:crear` acepta otra base (148). Se informan como verdes por diseño:
      las pruebas de catálogo y de ejecución de 144 y 145 y sus autocomprobaciones (las funciones ya son `STABLE`; la
      autocomprobación debe detectar el caso `IMMUTABLE`), los controles y las pruebas anteriores adaptadas. Lo que exige
      superusuario (la autocomprobación del 145 con `SET LOCAL ROLE` en Docker y la CI) se confirma en la CI de Linux o en
      Docker si en la nube se omite
- [x] T109 · backend · Primera sentencia de `#transaccion` (`base-datos.ts`) y de `enPlataforma` (`cli/conexion.ts`) con
      `client_encoding`, `synchronous_commit`, `array_nulls` y `transform_null_equals`, y sus comentarios (plan, sección
      21) (criterios 146, 147)
- [x] T110 · backend · Regla de lint de `cli/`: las cuatro llamadas nuevas a `set_config` en la lista cerrada, con la
      misma comparación que las de los criterios 98, 107, 121 y 122 (criterios 146, 147)
- [x] T111 · backend · `diferenciasConDesarrollo` en `scripts/lib/entorno.mjs` (P-35); llamada en `crearBases` antes de
      conectarse; función exportada del hook con la lectura y validación de `DATABASE_URL_APP`, usada en el paso 3b; y el
      comentario de `POSTGRES_PUERTO` en `.env.example` (criterio 148)
- [x] T112 · backend · Si las pruebas de 144 o 145 señalan algo con las migraciones actuales, corregirlo con una migración
      nueva (sin editar las aplicadas) (criterios 144, 145)
- [x] T113 · orquestador · `git diff` desde el commit de T107: T109 a T112 no tocaron pruebas protegidas
- [x] T114 · adversarial · Ronda 10 sobre todo lo anterior, en especial 144 a 148 (volatilidad y cuerpo de las funciones de
      contexto, planes guardados y sentencias preparadas en la conexión del pool, funciones auxiliares que leen el
      contexto, codificación y otros parámetros de sesión por cada vía, y diferencias entre `DATABASE_URL_APP` y
      `DATABASE_URL`); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 10 (12/11/2026)

Falla F1 (alta) y observaciones O1 y O2 de la ronda 10 (sobre `e15707c`); criterios 149 a 152 de `spec.md` (sección S) y
precisiones P-36 y P-37. Plan, sección 22 (con la nota O3 ampliada y la nota O1, fecha de negocio en SQL, que no lleva
criterio).

- [x] T115 · test-writer · Pruebas protegidas en rojo de los criterios 149 a 152 (archivos en "Protegidas del ataque ronda
      10" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: en `conAcademia` y
      `comoPlataforma`, las variantes reintento que atrapa `esViolacionDeUnicidad` tras una escritura, `SELECT 1/0`
      atrapado (con `try`/`catch` y con `.catch`), consulta sin `await` que falla después de que `trabajo` termina (cruda
      y de un modelo) y la ruta de un controlador de prueba que responde 500, con sus controles y la conexión sana después
      (149); las variantes en `enPlataforma` (150); `ROLLBACK` y `COMMIT` escritos dentro de `trabajo` y el control de la
      marca (151); y `ipParaAuditoria` unitaria más la integración con `AcademiasService.crear` y `registrarEnAcademia`
      (152). Comprobar que ninguna protegida anterior cambia de resultado por estas pruebas (si alguna cambiara,
      detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 10: transacción abortada reportada como
      éxito e IP con zona en la auditoría (en rojo)" (criterios 149 a 152)
- [x] T116 · tester · Confirmar que T115 falla por la razón esperada: `conAcademia`, `comoPlataforma` y `enPlataforma`
      resuelven con el valor de `trabajo` en vez de rechazar, y `ErrorTransaccionAbortada` no existe (149 a 151);
      `ipParaAuditoria` no existe y `fe80::1%eth0` hace fallar `crear` con 500 (152). Se informan como verdes por diseño:
      los controles (camino normal, `trabajo` que relanza el error, conexión sana después) y lo escrito antes de un
      `COMMIT` del 151
- [x] T117 · backend · `ErrorTransaccionAbortada` en `errores.ts` y exportada en `index.ts` (P-36); marca
      `app.transaccion` en la primera sentencia de `#fijarContexto`; `asentar()` en `envoltorio.ts`;
      `comprobarTransaccionViva` y su uso en `#transaccion` de `base-datos.ts` después de `terminar()`, solo en el camino
      bueno; registro técnico sin parámetros ni URL (plan, sección 22) (criterios 149, 151)
- [x] T118 · backend · `enPlataforma` (`cli/conexion.ts`): la marca en su primera sentencia, ceder un turno y
      `comprobarTransaccionViva` antes de devolver; comentario actualizado (plan, sección 22) (criterios 150, 151)
- [x] T119 · backend · `ipParaAuditoria` en `backend/src/modulos/auditoria/` (P-37), exportada en su `index`, y usada en
      `insertarEnAuditoriaDeAcademia` e `insertarEnAuditoriaPlataforma` (criterio 152)
- [x] T120 · backend · Revisar que ningún servicio ni comando de 001 atrape errores de la base dentro de `trabajo` para
      seguir; si hay alguno, pasarlo a `ON CONFLICT DO NOTHING RETURNING` o dejar salir el error (plan, nota O3 ampliada)
      (criterio 149)
- [x] T121 · orquestador · `git diff` desde el commit de T115: T117 a T120 no tocaron pruebas protegidas
- [x] T122 · adversarial · Ronda 11 sobre todo lo anterior, en especial 149 a 152 (errores atrapados dentro de
      `trabajo` por cualquier camino, consultas sin `await` crudas y de modelos, `ROLLBACK`, `COMMIT` y `SAVEPOINT`
      escritos, errores en la confirmación, la marca de la transacción, la conexión del pool después de cada caso, e IP
      con zona, mapeadas o inválidas en la auditoría); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 11 (12/11/2026)

Falla F1 (alta) y observaciones O1 y O2 de la ronda 11 (sobre `28ab05c`); criterios 153 a 155 de `spec.md` (sección T),
ampliación de P-36 y precisión P-38. Plan, sección 23. La O2 y `enPlataforma` sin cola van a "Riesgos aceptados".

- [x] T123 · test-writer · Pruebas protegidas en rojo de los criterios 153 a 155 (archivos en "Protegidas del ataque ronda
      11" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: los casos 1 a 7 del
      criterio 153 en `conAcademia` y `comoPlataforma` (lista que ignora las inexistentes en tres órdenes; `allSettled`
      con escritura y auditoría; `comoPlataforma` con `Promise.all` y `allSettled`; 20 consultas en orden; error de la
      base en medio; P2025 suelto; `trabajo` que lanza con consultas en la cola), con la conexión sana después; la unitaria
      de `envolver` con una transacción falsa para la cola (153) y para `undefined`, `exigirCompleta` y los resultados
      normales `null`, `0`, `[]`, `{ count: 0 }` (154); y el bloqueo de transacción con `$executeRaw`, `::text` y
      `pg_try_advisory_xact_lock` entre dos transacciones (155). Comprobar que ninguna protegida anterior cambia de
      resultado por estas pruebas (si alguna cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque
      ronda 11: consultas a la vez que Prisma no ejecutó y bloqueo de transacción (en rojo)" (criterios 153 a 155)
- [x] T124 · tester · Confirmar que T123 falla por la razón esperada: las reproducciones 1 a 3 resuelven sin las
      escrituras ni la auditoría (o con `undefined` en `allSettled`); la unitaria ve la segunda consulta entregada antes de
      que se asiente la primera, y `descartar` y `exigirCompleta` no existen (153, 154). Se informan como verdes por
      diseño: los controles (P2025 suelto, 20 consultas en orden si ya pasan, error de la base en medio, `trabajo` que
      lanza) y el criterio 155 si ya pasa con el código actual (es una guarda de la forma documentada)
- [x] T125 · backend · Cola serial en `envoltorio.ts` (`enviarSeguida` encadenada, comprobaciones al llamar, `descartar`),
      sin cambiar lo que recibe `trabajo` (promesas nativas sin claves propias) (plan, sección 23) (criterio 153)
- [x] T126 · backend · Segunda capa: `undefined` rechaza con `ErrorTransaccionAbortada` (motivo `incompleta`) y marca la
      transacción; `exigirCompleta` en `envoltorio.ts`; `motivo` en `ErrorTransaccionAbortada` (`errores.ts`, ampliación de
      P-36); en `#transaccion` de `base-datos.ts`, `descartar()` en el camino del error y `exigirCompleta()` antes de
      `comprobarTransaccionViva`, con el registro técnico que nombra la operación sin argumentos (criterio 154)
- [x] T127 · backend · Comentario de `enPlataforma` (`cli/conexion.ts`): en comandos y en la semilla no se lanzan consultas
      en paralelo dentro de `enPlataforma`; revisar que `superadmin.ts` y `seed.ts` cumplen (riesgo aceptado, plan,
      sección 23)
- [x] T128 · orquestador · `git diff` desde el commit de T123: T125 a T127 no tocaron pruebas protegidas
- [x] T129 · adversarial · Ronda 12 sobre todo lo anterior, en especial 153 a 155 (lotes de Prisma por cualquier camino:
      `Promise.all`, `allSettled`, `map` con `async`, `race`, consultas sin `await`, operaciones de varias sentencias;
      la cola ante rechazos, descartes, tiempos agotados y llamadas desde otro contexto; `undefined` y resultados vacíos
      legítimos; bloqueos de transacción; y que las protegidas anteriores sigan igual); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 12 (12/11/2026)

Falla F1 (alta), falla F2 (media) y observaciones O1 a O3 de la ronda 12 (sobre `8a63dbc`); criterios 156 a 158 de
`spec.md` (sección U), precisión de P-38 y precisiones P-39 y P-40. Plan, sección 24. O1 y O2 son notas del plan; O3
amplía el riesgo aceptado "Tiempo límite con una operación de varias sentencias a medias".

- [x] T130 · test-writer · Pruebas protegidas en rojo de los criterios 156 a 158 (archivos en "Protegidas del ataque ronda
      12" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: las cadenas sin
      `await` (`.then().catch()` y `void (async () => …)()`) en `conAcademia` y `comoPlataforma`, la cadena que falla y la
      ruta de un controlador de prueba, con `termino === true` en la continuación y la conexión sana después (156); la
      unitaria de `asentar` y de las llamadas tardías con la transacción falsa de P-38, casos (i) a (vi) (156); la
      unitaria de `crearManejadorDeRechazos` (157, P-40); la reproducción de la escritura anidada en `comoPlataforma` (hija
      oculta e inexistente), la de `conAcademia` si alguna forma deja una parte escrita con `8a63dbc`, los controles del
      P2025 suelto, del error de la base dentro de una escritura anidada y de las escrituras que van bien (158); y la
      unitaria de `conPuntosDeGuardado` con una transacción falsa (158, P-39). Comprobar que ninguna protegida anterior
      cambia de resultado por estas pruebas (si alguna cambiara, detenerse e informar). Commit: "Pruebas protegidas (001),
      ataque ronda 12: consultas encadenadas sin await, rechazos sin manejar y escrituras anidadas a medias (en rojo)"
      (criterios 156 a 158)
- [x] T131 · tester · Confirmar que T130 falla por la razón esperada: las cadenas de los casos 1, 2 y 4 resuelven sin la
      auditoría (o sin la academia) y la unitaria ve rechazada la llamada encadenada durante `asentar()` y
      `exigirCompleta()` sin lanzar tras una llamada tardía (156); `rechazos.ts` no existe (157); en la reproducción, A
      queda suspendida sin auditoría y `puntos-de-guardado.ts` no existe (158). Se informan como verdes por diseño: la
      cadena que falla (caso 3 del 156) si ya rechaza, los controles del 158 (P2025 suelto, error de la base, escrituras
      que van bien), el caso (v) y el (vi) de la unitaria del 156, y la reproducción en `conAcademia` si quedó como guarda
- [x] T132 · backend · Envoltorio abierto durante `asentar` en `envoltorio.ts`: `asentar()` sin `terminar()` previo,
      espera con `setImmediate` y apagado en el mismo paso; `cerrando`; `exigirActiva` con el nombre de la operación; las
      llamadas tardías y las de otro contexto desde `asentar` marcan `incompleta`; mensajes de error sin cambios (plan,
      sección 24) (criterio 156)
- [x] T133 · backend · Capa de puntos de guardado en `infraestructura/prisma/puntos-de-guardado.ts` (P-39): punto
      aleatorio por transacción, secuencia de crear, escribir, liberar; comprobación del estado y vuelta al punto solo con
      la transacción sana; marca en `exigirSana` ante cualquier falla de la capa; lecturas y crudo tal cual (plan,
      sección 24) (criterio 158)
- [x] T134 · backend · `#transaccion` en `base-datos.ts`: `envolver(capa.tx)`; en el error, `descartar()` y `terminar()`;
      en el camino bueno, `asentar()` sin `terminar()` previo, `exigirCompleta()` y `capa.exigirSana()` antes y después de
      `comprobarTransaccionViva`, y `terminar()` en un `finally`; registro técnico sin argumentos (criterios 156, 158)
- [x] T135 · backend · `crearManejadorDeRechazos` en `backend/src/infraestructura/proceso/rechazos.ts` (P-40) y su
      registro en `main.ts` después de `await app.listen(…)`, con el registro de pino de la app y sin `uncaughtException`
      (criterio 157)
- [x] T136 · backend · Revisar que ningún servicio de 001 use cadenas sin `await` dentro de `trabajo`, escrituras con
      relaciones anidadas ni actualice `academias` desde `conAcademia`; si hay alguno, corregirlo (plan, sección 24)
      (criterios 156, 158)
- [x] T137 · orquestador · `git diff` desde el commit de T130: T132 a T136 no tocaron pruebas protegidas
- [x] T138 · adversarial · Ronda 13 sobre todo lo anterior, en especial 156 a 158 (cadenas sin `await` con microtareas,
      temporizadores, E/S y contextos perdidos; llamadas tardías antes, durante y después de la comprobación; `asentar`
      que no termina; rechazos sin manejar y lo que registran; escrituras de delegados con relaciones anidadas, `upsert`,
      `createMany` y `deleteMany` que fallan a medias; errores de la base dentro de una escritura; sentencias de la capa
      que fallan o llegan tarde; nombre del punto de guardado; y que las protegidas anteriores sigan igual); si hay
      fallas, se repite el ciclo

## Ataque adversarial, ronda 13 (12/11/2026)

Falla F1 (alta), falla F2 (media) y observaciones O1 y O2 de la ronda 13 (sobre `8f29106`); criterios 159 a 162 de
`spec.md` (sección V), P-41, P-42 y precisiones de P-36, P-38 y P-40. Plan, sección 25. La F1 (c) se evaluó y no se
adopta (decisiones de la ronda 13); la O2 amplía el riesgo aceptado "Dos sentencias más por escritura de un delegado".

- [x] T139 · test-writer · Pruebas protegidas en rojo de los criterios 159 a 162 (archivos en "Protegidas del ataque ronda
      13" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: la configuración de
      lint (formas del ataque y sus variantes que fallan en el lint normal y en el paso protegido, comentarios que no la
      apagan en el paso protegido, formas con `.catch` y `.then(ok, err)` que pasan, pruebas y frontend fuera de alcance)
      (159); los casos 1 a 4 del 160 en `conAcademia` y `comoPlataforma`, con `termino === true` al rechazar y la conexión
      sana después, y la unitaria de `envolver` con la transacción falsa de P-38, casos (i) a (vi) (160); la unitaria del
      constructor de `ErrorTransaccionAbortada` con una causa con forma de error de Prisma y la reproducción de F2 en
      `conAcademia`, `comoPlataforma`, la comprobación de la marca y la ruta de un controlador con el registro capturado
      (161); y `errorParaRegistro` con los errores reales (a), (b) y (c), el `Error` propio con causa de la base, el
      `Error` común sin cambios, las rutas del filtro con el registro capturado, el manejador de P-40 y `mensajeSeguro`
      (162). Comprobar que ninguna protegida anterior cambia de resultado por estas pruebas (si alguna cambiara,
      detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 13: promesas descartadas, rechazos después
      de trabajo y errores de Prisma en el registro (en rojo)" (criterios 159 a 162)
- [x] T140 · tester · Confirmar que T139 falla por la razón esperada: el lint no señala `void` ni la función `async` en el
      lugar (159); las reproducciones 1, 2 y 4 resuelven sin la auditoría (o responden 200) y la unitaria ve el error
      original durante `asentar()` sin marca (160); la causa de `ErrorTransaccionAbortada` y el registro del 500 contienen
      `44556677` (161); `registro-de-errores.ts` no existe y los registros del filtro y del manejador muestran los valores
      (162). Se informan como verdes por diseño: los controles del 160 (caso 3 y unitarias (iv) a (vi)), los `Error`
      comunes del 162 y las formas que pasan el lint
- [x] T141 · backend · Regla de lint de promesas descartadas: `eslint/regla-promesas-descartadas.mjs` (P-41) con la regla
      propia y el bloque con tipos; `eslint.config.mjs` (los dos bloques, después de `aquagestion/typescript`) y
      `eslint.protegido.config.mjs` (la regla propia, y el criterio 159 en el comentario de cabecera); `main.ts` con
      `arrancar().catch(…)` y `process.exit(1)`; `envoltorio.ts` sin `void`; `npm run lint` en verde sin apagar reglas
      (plan, sección 25) (criterio 159)
- [x] T142 · backend · `registro-de-errores.ts` en `infraestructura/prisma/` (P-42: `CausaLimpia`, `causaLimpia`,
      `esErrorDeBase`, `errorParaRegistro`, `CircunstanciaDeLaCausa`), exportado por `index.ts`; constructor de
      `ErrorTransaccionAbortada` con la causa limpia (precisión de P-36) (plan, sección 25) (criterios 161 y 162)
- [x] T143 · backend · Envoltorio: desde `asentar()`, el rechazo de una operación entregada marca y rechaza con
      `ErrorTransaccionAbortada` (`rechazo-tras-trabajo`); `incompleta` con operación, circunstancia y error;
      `exigirCompleta` y los caminos de 154 y 156 con `causaLimpia`; `#registrarAbortada` con la causa limpia (plan,
      sección 25) (criterios 160 y 161)
- [x] T144 · backend · Registro limpio: `FiltroErrores` (las dos ramas 5xx), `crearManejadorDeRechazos` (precisión de
      P-40), `mensajeSeguro` y el error del arranque de `main.ts` con `errorParaRegistro`; confirmar que el `PrismaClient`
      de `BaseDatos` y de `crearClienteDelDueno` no tiene la opción `log` (plan, sección 25) (criterio 162)
- [x] T145 · backend · Revisar que ningún servicio de 001 tenga promesas descartadas, errores propios que copien el mensaje
      de otro ni registros de errores fuera de `errorParaRegistro` (`rg "\{ err|console\.(error|warn)|registro\.(error|warn)"
      backend/src backend/prisma`); si hay alguno, corregirlo (plan, sección 25) (criterios 159 y 162)
- [x] T146 · orquestador · `git diff` desde el commit de T139: T141 a T145 no tocaron pruebas protegidas
- [x] T147 · adversarial · Ronda 14 sobre todo lo anterior, en especial 159 a 162 (formas de descartar promesas que
      escapen a las dos reglas; rechazos de operaciones justo antes, durante y después de `asentar()` y de la comprobación;
      `.catch`, `.then(ok, err)`, `allSettled` y `try`/`catch` en continuaciones; llamadas rechazadas al llamar durante
      `asentar()`; causas y registros con valores por cualquier camino: filtro, manejador, `#registrarAbortada`, comandos,
      semilla, pino-http, el registro de Nest; errores de Prisma no reconocidos por `esErrorDeBase`; getters que lanzan y
      ciclos en `errorParaRegistro`; y que las protegidas anteriores sigan igual); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 14 (12/11/2026)

Falla F1 (media) y observaciones O1 y O2 de la ronda 14 (sobre `623c15b`); criterios 163 y 164 de `spec.md` (sección W),
ampliación de P-41 y precisión de P-42. Plan, sección 26. La O1 no lleva criterio: corrige el riesgo aceptado "Promesa
descartada que escapa al lint" y agrega la nota para el revisor del plan, sección 26.

- [x] T148 · test-writer · Pruebas protegidas en rojo de los criterios 163 y 164 (archivos en "Protegidas del ataque ronda
      14" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: las unitarias (u1) a
      (u6) de `errorParaRegistro` con errores falsos, los errores reales (a), (b) y (c) en `conAcademia` con la
      comprobación previa de que el ataque se reproduce, directos y como `cause` de un `Error` propio, las rutas de un
      controlador de prueba con el registro capturado y el manejador de P-40 con el error (c) (163); y la configuración de
      lint con las formas de temporizadores que fallan y que pasan en el paso protegido (`.ts`, `.js`, `.mjs`, con
      comentarios que no la apagan), los envoltorios de tipos, el lint normal con tipos en `ejemplo.service.ts`, y pruebas
      y frontend fuera de alcance (164). Comprobar que ninguna protegida anterior cambia de resultado por estas pruebas, en
      especial `registro-de-errores.test.ts` y `regla-promesas-descartadas-ronda13.test.mjs` (si alguna cambiara,
      detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 14: pila sin el mensaje y funciones async en
      temporizadores (en rojo)" (criterios 163 y 164)
- [x] T149 · tester · Confirmar que T148 falla por la razón esperada: con `623c15b`, la `pila` de (u1), (u2), (u3), (u6),
      (a), (b) y (c) y el registro de las rutas contienen `44556677` o `penicilina-r14`, y el manejador de P-40 recibe el
      valor (163); `process.nextTick(async …)`, `setImmediate(async …)` y las demás formas de (iii), y las formas con `as
      unknown`, no dan error de la regla propia en ningún paso (164). Se informan como verdes por diseño: (u4) y (u5) si ya
      pasan, las formas que no deben dar error y las pruebas y el frontend fuera de alcance. Una forma de (iii) que en el
      lint normal ya señala `no-misused-promises` sigue en rojo, porque la prueba exige el error de la regla propia
- [x] T150 · backend · `registro-de-errores.ts`: `pila` leída después del encabezado exacto `nombre: mensaje` (o `name`
      con mensaje vacío), con comparación por igualdad y salto de línea después; sin coincidencia o con valores que no son
      cadenas, sin `pila`; `limpio` y la cadena de causas con la misma función; buscar otros lugares que filtren marcos
      (plan, sección 26) (criterio 163)
- [x] T151 · backend · `eslint/regla-promesas-descartadas.mjs`: caso (iii) con `nextTick`, `setImmediate`, `setTimeout`,
      `setInterval` y `queueMicrotask` por nombre de identificador o de propiedad; envoltorios de tipos en (ii) y (iii);
      mensaje y comentario de cabecera con el criterio 164; `npm run lint` en verde sin apagar reglas (si la regla señala
      código actual, corregirlo si es una función `async` pasada de verdad, o detenerse e informar) (plan, sección 26)
      (criterio 164)
- [x] T152 · backend · Revisar que ningún servicio de 001 guarde promesas sin esperarlas dentro de `trabajo` ni pase
      funciones `async` a temporizadores; si hay alguno, corregirlo (plan, sección 26, nota para el revisor) (O1, criterio
      164)
- [x] T153 · orquestador · `git diff` desde el commit de T148: T150 a T152 no tocaron pruebas protegidas
- [x] T154 · adversarial · Ronda 15 sobre todo lo anterior, en especial 163 y 164 (errores con `stack` que no empieza con
      el encabezado, `name` o `message` cambiados, getters, mensajes vacíos, `\r\n`, causas y `AggregateError` anidados,
      errores de Prisma o del adaptador reales que aún muestren valores por cualquier camino del registro; formas de pasar
      funciones `async` a temporizadores u otras funciones que escapen a la regla y a `no-misused-promises`; envoltorios de
      tipos; y que las protegidas anteriores sigan igual); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 15 (12/11/2026)

Falla F1 (media) y observaciones O1 y O2 de la ronda 15 (sobre `6a74044`), más cinco formas de lint no detectadas;
criterios 165 y 166 de `spec.md` (sección X) y precisión de P-42. Plan, sección 27. La O2 es una regla del plan para todas
las historias (sin `money`) y un riesgo aceptado; las formas de lint amplían el riesgo aceptado "Promesa descartada que
escapa al lint". Nota para el orquestador: el criterio 165 conserva el `mensaje` del `Error` que lleva un error de la base
cuando no copia el de la base, en lugar de "nunca `message`", porque cuatro pruebas protegidas de 162 y 163 lo exigen
(spec, "Decisiones técnicas tras el ataque, ronda 15").

- [x] T155 · test-writer · Pruebas protegidas en rojo de los criterios 165 y 166 (archivos en "Protegidas del ataque ronda
      15" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: las unitarias (u1) a
      (u14) de `errorParaRegistro` con las excepciones reales de `@nestjs/common` y el error falso `base`, comprobadas con
      `util.inspect` con `showHidden`, `JSON.stringify` y un `pino` con destino en memoria, con la comprobación previa de
      (u1) (`response` es `base` y `message` lleva el valor); el manejador de P-40 con (u1) y (u4); `mensajeSeguro` con
      (u1), (u4) y la cadena de (u12); el error real de `auditoria.create` en `conAcademia(A, …)` (con la comprobación previa
      de que su mensaje lleva el valor) dentro de (u1), (u2), (u8) y (u10), y las rutas (a1) a (a3) de un controlador de
      prueba con el registro capturado (165); y las unitarias (o1) a (o5) de `errorParaRegistro`, `causaLimpia`, el
      constructor de `ErrorTransaccionAbortada` y `mensajeSeguro` (166). Comprobar que ninguna protegida anterior cambia de
      resultado por estas pruebas, en especial `registro-de-errores.test.ts`, `registro-de-errores-ronda14.test.ts`,
      `registro-sin-datos.test.ts` y `registro-sin-datos-ronda14.test.ts` (si alguna cambiara, detenerse e informar).
      Commit: "Pruebas protegidas (001), ataque ronda 15: errores de la base dentro de excepciones de Nest y tipo de lista
      cerrada (en rojo)" (criterios 165 y 166)
- [x] T156 · tester · Confirmar que T155 falla por la razón esperada: con `6a74044`, en (u1) a (u7), (u9) a (u11) y (u13)
      el resultado de `errorParaRegistro` (la misma excepción, o la copia de hoy con el mensaje de la base) contiene, con
      `showHidden` o por pino, `44556677`, `penicilina-r15` o `invalid input syntax`; (u12) no da `truncado`; el manejador y `mensajeSeguro` con (u1) muestran
      el valor; los registros de las rutas (a1) y (a2) lo contienen (165); (o1), (o2) y (o5) dan el `name` como `tipo`
      (166). Se informan como verdes por diseño: (u8), (u14), la ruta (a3), (o3) y (o4) si ya pasan
- [x] T157 · backend · `registro-de-errores.ts`: `buscarErroresDeLaBase` (propias con `Reflect.ownKeys` y enumerables
      heredadas, topes de 10 niveles, 200 objetos y 100 claves, falla cerrada), `mensajesDeLaBase`, `convertir` con
      `nombreDeClase`, la regla de `mensaje` y la de `pila`, `erroresDeLaBase` sin repetidos y `truncado`; quitar
      `llevaBaseSinLimpiar` y `copiaConCausasLimpias`; `npm run lint` en verde sin apagar reglas (plan, sección 27)
      (criterio 165)
- [x] T158 · backend · `tipoDeBase` con la lista cerrada en `datosSeguros` (forma limpia y `causaLimpia`) y `nombreDeClase`
      para lo que no es de la base (plan, sección 27) (criterio 166)
- [x] T159 · backend · `mensajeSeguro`: con un `Error` convertido, su `mensaje`, o el texto del primer error de la base, o
      `error sin detalles (<tipo>)`; `textoDeErrorDeBase` recibe el objeto limpio (plan, sección 27) (criterio 165)
- [x] T160 · backend · Revisar que ningún servicio de 001 envuelva un error de la base en una excepción de Nest
      (`rg "Exception\((e|err|error)\b" backend/src`) ni use `money` (`rg -i "money" backend/`); si hay alguno,
      corregirlo con un mensaje propio y `{ cause }`; confirmar que `filtro-errores.ts`, `rechazos.ts` y `main.ts` siguen
      llamando a `errorParaRegistro` sin cambios (plan, sección 27) (criterio 165, O2)
- [x] T161 · orquestador · `git diff` desde el commit de T155: T157 a T160 no tocaron pruebas protegidas
- [x] T162 · adversarial · Ronda 16 sobre todo lo anterior, en especial 165 y 166 (errores de la base escondidos en
      cualquier propiedad o forma que pino, `console.error` o `util.inspect` serialicen: excepciones de Nest y de otras
      librerías, objetos anidados, propiedades no enumerables, `Symbol`, heredadas, getters, `Proxy`, ciclos, grafos en el
      borde de los topes; mensajes y pilas de los errores que no son de la base que copien el de la base por otro camino;
      `name` y `constructor` alterados; `mensajeSeguro` en comandos y semilla; errores reales de Prisma o del adaptador con
      un `name` fuera de la lista; y que las protegidas anteriores sigan igual); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 16 (12/11/2026)

Falla F1 (media) y observación O1 (media-baja) de la ronda 16 (sobre `8b503d2`); criterios 167 y 168 de `spec.md` (sección
Y) y precisión de P-42. Plan, sección 28. La pregunta técnica R16-1 (qué se registra de un `Error` que lleva un binario)
quedó resuelta por el orquestador antes de T163 con la propuesta del especificador: se registra convertido, sin el
binario, aunque no lleve errores de la base; el criterio 167, (t1), (t2) y (t11) ya lo reflejan.

- [x] T163 · test-writer · Pruebas protegidas en rojo de los criterios 167 y 168 (archivos en "Protegidas del ataque ronda
      16" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: las unitarias (t1) a
      (t9) de `errorParaRegistro` con `base16`, el límite de 200 ms por llamada medido tras la llamada de calentamiento y
      (t1) con `FiltroErrores` real y límite de 1000 ms; en (t1) y (t2), el resultado convertido y lo registrado sin el
      binario ni su contenido (R16-1); (t10) con `mensajeSeguro`; y (t11), el proceso hijo con
      `--max-old-space-size=256 --import tsx` (167); las unitarias (g1) a (g6) con la comprobación previa de que pino
      muestra el valor con el error original y la función espía sin llamadas; el manejador de P-40 con (g1) y (g3);
      `mensajeSeguro` con (g1) y (g3); el error real de `auditoria.create` en `conAcademia(A, …)` (con la comprobación
      previa de que su mensaje lleva el valor) dentro de (g1) y (g3), y las rutas (a4) y (a5) de un controlador de prueba
      con el registro de la app capturado (168). Comprobar que ninguna protegida anterior cambia de resultado por estas
      pruebas, en especial `registro-de-errores-ronda15.test.ts` ((u12) y (u14)) y `registro-de-errores.test.ts` (si alguna
      cambiara, detenerse e informar; si `tsx` no carga el módulo en el hijo, detenerse e informar). Commit: "Pruebas
      protegidas (001), ataque ronda 16: costo acotado del registro de errores y cause por su nombre (en rojo)"
      (criterios 167 y 168). _(Precisión del orquestador, ronda 16: (t5) con 50 000 claves y (t9) sin el `Proxy` de un
      `Buffer`, como dice ahora el criterio 167.)_
- [x] T164 · tester · Confirmar que T163 falla por la razón esperada: con `8b503d2`, (t1) a (t4), (t7) y el `Proxy` de un
      `Buffer` de (t9) pasan del límite de tiempo; (t1) y (t2) dan `truncado` o el mismo objeto en lugar del objeto
      convertido sin el binario; (t6) da `truncado` sin `mensaje`; (t10) con (t1) empieza con `error sin detalles`; en
      (t11) el hijo termina por falta de memoria (167); (g1) a (g5), el manejador, `mensajeSeguro` con (g3) y los registros de las rutas (a4) y (a5) contienen
      `44556677`, `penicilina-r16` o `invalid input syntax`, o la función espía se llamó (168). Se informan como verdes por
      diseño, si ya pasan: (t5), (t8), las falsas hojas de (t9) sin el `Proxy` de un `Buffer`, (g6) con el
      getter que devuelve `new Error('otra')` y con `errors` función, y `mensajeSeguro` con (g1). Informar las medidas de
      tiempo de cada caso con `8b503d2`. _(Precisión del orquestador, ronda 16: el `Proxy` de un `Buffer` ya no está en
      (t9) ni en la lista de rojos (pasa al riesgo aceptado "Objetos sin `length` con millones de claves"); los rojos por
      tiempo son (t1) a (t4) y (t7). (t5), ahora con 50 000 claves, es verde por diseño; las tres falsas hojas de (t9),
      también si ya pasan.)_
- [x] T165 · backend · `registro-de-errores.ts`: `esHojaBinaria` por la ranura interna (`ArrayBuffer.isView`,
      `types.isAnyArrayBuffer`), `clavesDe` con `length` antes de listar, `Reflect.ownKeys` antes de `for…in` y corte de
      `for…in` al pasar el tope, sin colecciones de más de 101 claves; las hojas no cuentan como visitadas; la búsqueda
      devuelve `conBinarios` y `errorParaRegistro` convierte (sin el binario) el error que lleva alguno aunque no tenga
      errores de la base (R16-1) (plan, sección 28) (criterio 167)
- [x] T166 · backend · `buscarErroresDeLaBase`: `cause` y `errors` leídos por su nombre en cada objeto visitado, fuera
      del tope de claves; `cause` función (listada o por su nombre) es falla cerrada sin llamarla; `errors` función ni se
      llama ni se recorre; `convertir`, `mensaje-seguro.ts`, `filtro-errores.ts`, `rechazos.ts` y `main.ts` sin cambios;
      `npm run lint` en verde sin apagar reglas (plan, sección 28) (criterio 168)
- [x] T167 · backend · Revisar que ningún error de 001 lleve un `Buffer`, una copia de un arreglo o de un `Buffer` en un
      objeto plano, ni una `cause` función; si hay alguno, corregirlo con una clave o un resumen (plan, sección 28, nota
      para el revisor) (criterios 167 y 168)
- [x] T168 · orquestador · `git diff` desde el commit de T163: T165 a T167 no tocaron pruebas protegidas
- [x] T169 · adversarial · Ronda 17 sobre todo lo anterior, en especial 167 y 168 (valores grandes que todavía cuesten
      tiempo o memoria al registrar: objetos con forma de arreglo sin `length`, prototipos con muchas enumerables,
      `Proxy` con trampas costosas, binarios en `vm` o de otro contexto, falsas hojas que escondan un error de la base;
      `cause` y `errors` por getters que alternan, funciones, `Proxy`; errores de la base que pino, pino-http, nestjs-pino,
      `console.error` o `util.inspect` aún muestren por otro nombre o forma; y que las protegidas anteriores sigan igual);
      si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 17 (12/11/2026)

Sin fallas en el núcleo (aislamiento, RLS, Superadmin, auditoría, registro de errores). Falla F1 (media, Windows) y
observaciones O1 (se corrige) y O2 (se difiere) de la ronda 17 (sobre `6e3d69e`); criterios 169 a 171 de `spec.md`
(sección Z), P-43 y P-44. Plan, sección 29. Las preguntas técnicas R17-1 a R17-3 tienen valores provisionales que ya
están en los criterios y no bloquean; si el orquestador decide otra cosa, el especificador ajusta el criterio antes de
T170.

- [x] T170 · test-writer · Pruebas protegidas en rojo de los criterios 169 a 171 (archivos en "Protegidas del ataque ronda
      17" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: `quitarBom`, la
      coherencia del conjunto (a) entre `analizarEnv` y el `dotenv` del backend, `cargarEnv` con (e1) (reproducción con
      `5433` y `\r\n`) y las comprobaciones de `leerUrlsBases`, `leerUrlApp` y `diferenciasConDesarrollo`, la prueba
      estática de `parseEnv` y `.env.example` sin BOM (169); (b1) a (b6) de `completarEnv` y del comando, con la inclusión
      de las claves de `dotenv.parse` en `clavesPosiblesEnv` (170); `entornoParaHijos` y `esPuntoDeEntrada` del hook;
      (p1) a (p5), (r1) a (r5), (r6) y (r7) (171), con los enlaces creados como dice el criterio y las omisiones solo con
      motivo explícito donde el criterio las permite. En el mismo commit, la corrección de
      `backend/test/utilidades/base-pruebas.ts` y `base-datos.ts` (quitar el BOM inicial antes de `parseEnv`) y su prueba
      `lectura-env-ronda17.test.ts`. Comprobar que ninguna protegida anterior cambia de resultado, en especial
      `scripts/test/completar-env.test.mjs` y `scripts/test/entorno*.test.mjs` (si alguna cambiara, o si `parseEnv` y
      `dotenv` difieren en algún texto de (a), detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda
      17: .env con BOM y scripts por enlaces (en rojo)" (criterios 169 a 171)
- [x] T171 · tester · Confirmar que T170 falla por la razón esperada con `6e3d69e`: `quitarBom`, `analizarEnv`,
      `clavesPosiblesEnv` y `scripts/lib/punto-de-entrada.mjs` no existen; `cargarEnv` con (e1) deja `DATABASE_URL` sin
      definir; `entornoParaHijos` no se exporta (169); (b1) agrega `DATABASE_URL` y `dotenv` da `:5432`; (b6) termina con
      0 y cambia el archivo (170); (r1) a (r5) no imprimen nada y terminan con 0, (p2) y (p3) dan falso con la comparación
      de hoy, la prueba estática encuentra `process.argv[1]` en los cinco scripts (171). Los casos que importan funciones
      nuevas fallan al importar: es la razón esperada. Se informan como verdes por diseño, si ya pasan: `.env.example` sin
      BOM, las protegidas anteriores de `completarEnv` que T170 no toca, y `lectura-env-ronda17.test.ts` (las utilidades se
      corrigen en el mismo commit; comprobar con `git show 6e3d69e:backend/test/utilidades/base-datos.ts` y
      `…/base-pruebas.ts` que antes no quitaban el BOM). Informar qué casos se omitieron y con qué motivo
- [x] T172 · backend · `scripts/lib/entorno.mjs`: `quitarBom`, `analizarEnv` y `clavesPosiblesEnv` (P-43), `cargarEnv`
      con `analizarEnv`; `scripts/completar-env.mjs`: `leerBloques` y `completarEnv` con `analizarEnv`, existentes =
      `analizarEnv` ∪ `clavesPosiblesEnv`, `ilegibles` solo si hay, aviso del comando por variable sin su valor,
      `appendFileSync` sin reescribir (bytes, BOM y `\r\n` conservados; salto inicial decidido sin el BOM) y el rechazo de
      un `.env` UTF-16 o con un byte `00` sin escribir (provisional, R17-2); el hook: `entornoParaHijos(raiz, entorno =
      process.env)` exportado y con el BOM quitado (plan, sección 29) (criterios 169 y 170) _(en parte **reemplazada**
      por T178 y T179, ataque ronda 18: `analizarEnv` pasa a `dotenv.parse`, existentes = solo `analizarEnv`, y el hook
      lee con `cargarAnalizadorEnv`)_
- [x] T173 · backend · `scripts/lib/punto-de-entrada.mjs` con `rutasIguales` y `esPuntoDeEntrada` (P-44); los cinco
      scripts (`crear-bases`, `completar-env`, `compilar-contratos-si-falta`, `verificar-pruebas-protegidas`,
      `verificar-sin-secretos`) la usan con `esPuntoDeEntrada(import.meta.url)` y quitan la comparación de hoy y los
      imports que queden sin usar; el hook, su copia exportada, sin importar módulos del repositorio de forma estática
      (criterio 47 de 000); `npm run lint` y `npm run typecheck` en verde (plan, sección 29) (criterio 171)
- [x] T174 · orquestador · `git diff` desde el commit de T170: T172 y T173 no tocaron pruebas protegidas (ni
      `backend/test/utilidades/base-datos.ts`)
- [x] T175 · adversarial · Ronda 18 sobre todo lo anterior, en especial 169 a 171 (otros lectores del `.env` que difieran
      de `dotenv`: `vite` con `loadEnv`, `e2e/playwright.config.ts`, valores con `\r\n`, comillas o `#`, claves repetidas
      y cuál gana en cada lector; `.env` con otras codificaciones; `env:completar` con archivos de solo lectura, enlaces
      o carreras; scripts lanzados por enlaces, uniones, rutas cortas 8.3, mayúsculas distintas en Windows, `npm run`
      desde subcarpetas o los hooks de git; y que las protegidas anteriores sigan igual); si hay fallas, se repite el
      ciclo

## Ataque adversarial, ronda 18 (12/11/2026)

Sin fallas en el núcleo (RLS, rol, Superadmin, registro de errores, punto de entrada). Fallas F1 y F2 (medias, la misma
familia que la F1 de la ronda 17: dos analizadores del `.env`) y observaciones O1 (se corrige) y O2 (riesgo aceptado) de
la ronda 18 (sobre `d8b5cdd`); criterios 172 a 175 de `spec.md` (sección AA) y P-45. Plan, sección 30. Decisión del
orquestador: un solo analizador, `dotenv.parse`. Las preguntas técnicas R18-1 a R18-4 tienen valores provisionales que ya
están en los criterios y no bloquean; si el orquestador decide otra cosa, el especificador ajusta el criterio antes de
T176.

- [x] T176 · test-writer · Pruebas protegidas en rojo de los criterios 172 a 175 (archivos en "Protegidas del ataque ronda
      18" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: la ayuda con los
      conjuntos (d) y (f) y el generador con semilla fija; (s1) a (s6) (172); (c1) a (c6), con `completarEnv` y como
      comando, y la comprobación previa de (c4) (173); (h1) a (h9), con el enlace de (h3) y la omisión solo en Windows
      con motivo (174); (o1) a (o3), con la comprobación previa del ataque en (o2) (175). En el mismo commit:
      - la corrección de `backend/test/utilidades/base-pruebas.ts` y `base-datos.ts` (leer con `dotenv.parse`, sin la
        línea del BOM), con su prueba `lectura-env-ronda18.test.ts` (172, (s3));
      - **ajustes a protegidas de la ronda 17**, cada uno con un comentario que cita el criterio y el motivo, y nada más
        de esos archivos:
        - `scripts/test/entorno-bom-ronda17.test.mjs`: la prueba "el texto parseEnv aparece solo en entorno.mjs, el hook y
          las dos utilidades de prueba" pasa a esperar que ningún archivo del alcance contenga `parseEnv` (`PERMITIDOS =
          []`, con su nombre nuevo); comentarios del encabezado y de la carga de `dotenv` (criterio 172);
        - `backend/test/utilidades/lectura-env-ronda17.test.ts`: el caso "un U+FEFF que no está al principio no se quita
          (solo se quita el inicial)" pasa a esperar `DATABASE_URL` igual a lo que da `dotenv.parse` del mismo texto
          (`postgresql://x:y@127.0.0.1:5433/aquagestion`); encabezado (criterio 172);
        - `scripts/test/completar-env-ronda17.test.mjs`: en (b4), "como comando: termina con 0, nombra la variable
          ilegible sin su valor y deja el archivo igual" con el resultado por texto del criterio 173 (los cuatro que
          `dotenv` lee: archivo igual y sin "Se agregaron"; el del valor entre comillas en varias líneas: "Se agregaron"
          con `DATABASE_URL`, archivo que empieza con los bytes de antes y `DATABASE_URL` de `EJEMPLO_B`), y "si
          DATABASE_URL la lee dotenv y no analizarEnv, el resultado lleva ilegibles" con las expectativas explícitas por
          texto (sin `ilegibles` y `agregadas: []` en los cuatro; `agregadas` e `ilegibles` `['DATABASE_URL']` en el
          quinto); comentarios del encabezado y del conjunto (b). Las pruebas de inclusión en `clavesPosiblesEnv` no se
          tocan;
        - `scripts/test/preparar-sesion-ronda17.test.mjs`: solo el comentario del encabezado (resultado sin cambios).
      Comprobar que ninguna otra protegida cambia de resultado, en especial `scripts/test/entorno*.test.mjs`,
      `scripts/test/completar-env.test.mjs`, `scripts/test/preparar-sesion*.test.mjs`, `scripts/test/rol-app-hook.test.mjs`,
      `backend/test/utilidades/base-pruebas.test.ts`, `eslint/regla-entorno.test.mjs` y las de `cargar-env` (si alguna
      cambiara, o si alguna comprobación previa no reproduce el ataque, detenerse e informar). Commit: "Pruebas protegidas
      (001), ataque ronda 18: un solo analizador del .env (en rojo)" (criterios 172 a 175)
- [x] T177 · tester · Confirmar que T176 falla por la razón esperada con `d8b5cdd`: (s1) en (d1) a (d7) y en parte de
      (f), (s2) y (s3) con `URL_5432` o sin `DATABASE_URL`, (s4) porque `scripts` no declara `dotenv`, (s6) y la prueba
      estática ajustada de la ronda 17 encuentran `parseEnv` (172); (c2) agrega `DATABASE_URL`, (c3) no agrega, (c4)
      escribe y cambia `PUERTO_WEB`, (c5) con algún texto, y los dos casos ajustados de (b4) (173); (h1) a (h3) y (h5) a
      (h9) fallan al importar y (h4) da `URL_5432` o nada (174); (o1) y (o2) fallan al importar y (o3) no encuentra las
      opciones (175). Los casos que importan funciones nuevas fallan al importar: es la razón esperada. Se informan como
      verdes por diseño, si ya pasan: (s5), (c1), (c6), el caso ajustado de `lectura-env-ronda17.test.ts` (las utilidades
      se corrigen en el mismo commit; comprobar con `git show d8b5cdd:backend/test/utilidades/base-pruebas.ts` que antes
      usaban `parseEnv`) y `lectura-env-ronda18.test.ts`. Informar cuántos textos de (f) difieren con `d8b5cdd`, cuántos
      acepta el lector mínimo en (h7) y qué casos se omitieron y con qué motivo. _(Precisión del orquestador (ronda 18),
      tras la comprobación del tester: en (s1), (s2) y (h4) fallaban solo (d1), (d2), (d5) y (d7); (d3), (d4) y (d6) ya
      pasaban con `d8b5cdd`. Ver `spec.md`, criterio 172.)_
- [x] T178 · backend · `scripts/package.json` con `dotenv` (mismo rango que el backend) y `package-lock.json` por
      `npm install`; `scripts/lib/entorno.mjs`: `analizarEnv` = `dotenv.parse` cargado al primer uso con `createRequire`,
      error que nombra `dotenv` y pide `npm ci` si falta, sin `parseEnv`; `scripts/completar-env.mjs`: existentes = solo
      `analizarEnv`, `ilegibles` como parte de `agregadas` con el aviso nuevo, y la comprobación antes de escribir con su
      error (provisional, R18-3) (plan, sección 30) (criterios 172 y 173)
- [x] T179 · backend · `.claude/hooks/preparar-sesion.mjs`: `analizarEnvMinimo`, `cargarAnalizadorEnv`,
      `entornoParaHijos` con el tercer parámetro, `entornoParaInstalar` en el paso de `npm ci`, sin `parseEnv` ni import
      estático de `dotenv`; fuera de la nube sigue sin hacer nada (provisionales R18-1 y R18-2) (plan, sección 30)
      (criterio 174)
- [x] T180 · backend · `backend/src/infraestructura/entorno/opciones-dotenv.ts`; `cargar-env.ts`, `cli/conexion.ts` y
      `prisma.config.ts` con `opcionesDotenv` (o las seis opciones escritas en `prisma.config.ts` si su cargador no admite el
      import); `e2e/playwright.config.ts` con las seis opciones; confirmar que la CLI de Prisma no carga el `.env` por su
      cuenta (o que no pisa lo definido ni toma `DOTENV_*`; si no se puede asegurar, detenerse e informar); `npm run lint` y
      `npm run typecheck` en verde (plan, sección 30) (criterio 175)
- [x] T181 · orquestador · `git diff` desde el commit de T176: T178 a T180 no tocaron pruebas protegidas (ni
      `backend/test/utilidades/base-datos.ts` ni `base-pruebas.ts`)
- [x] T182 · adversarial · Ronda 19 sobre todo lo anterior, en especial 172 a 175 (otra forma de que los scripts, el
      hook, las utilidades de prueba y el backend lean valores distintos: otra copia o versión de `dotenv` resuelta por
      otro camino, `NODE_PATH`, un `dotenv` en una carpeta superior al repositorio, Vite, la CLI de Prisma; el lector
      mínimo del hook aceptando un texto que `dotenv` lee distinto; `env:completar` cambiando la lectura de lo que ya había
      por otra vía que la comprobación no vea (codificación, bytes inválidos, archivo cambiado entre la lectura y la
      escritura); variables `DOTENV_*` o `NODE_OPTIONS` que todavía cambien la carga; y que las protegidas anteriores
      sigan igual); si hay fallas, se repite el ciclo. _(**Hecha**, 12/11/2026, sobre `03fad3c`: **sin fallas
      confirmadas**; ver la sección "Ataque adversarial, ronda 19" abajo.)_

## Ataque adversarial, ronda 19 (12/11/2026)

**Sin fallas confirmadas** (sobre `03fad3c`): termina el ciclo adversarial de 001. No hay criterios, pruebas protegidas
ni código nuevos. Se probó: fuzz de 2 000 000 de textos del lector mínimo del hook frente a `dotenv.parse`, con 0
diferencias (criterio 174); 40 000 textos de `completarEnv`, con la comprobación antes de escribir exacta (173); las
seis opciones fijas de `dotenv.config` en los cuatro cargadores (175); que `@prisma/config` usa su propio `dotenv` con
`dotenv: false`; sondeos de RLS y del rol de la aplicación; relectura de `AcademiasService` y `SesionPlataformaService`.
Dos observaciones quedan como riesgos aceptados, sin tareas: O1 (`createRequire(...)('dotenv')` puede resolver un
`dotenv` de fuera del repositorio antes de `npm ci`) y O2 (Vite lee el `.env` con su propio `dotenv`, solo para
`PUERTO_WEB` y `PUERTO_API`). `spec.md`, sección AB y "Riesgos aceptados"; plan, sección 31.

**Siguen, en este orden:** T22 (revisor), T23 (tester) y T24 (documentador), en "Verificación" y "Cierre"; después,
T25 (responsable, en Windows).

## Cierre

- [x] T24 · documentador · `docs/guia-local-windows.md` (criterio 67; desde la ronda 9, que al cambiar el puerto de
      Docker se cambia también en `DATABASE_URL_APP`, criterio 148), `README.md` (qué está construido) y las notas
      de 001 y 002 en `specs/backlog.md`: el primer administrador de cada academia pasa de 001 a 002 (DR-1). Desde la
      ronda 10: la sección "Fechas y horas de negocio (America/Lima)" de `docs/arquitectura.md`, con el texto propuesto
      en el plan, sección 22, nota O1. Desde la ronda 11: las tres viñetas de transacciones del plan, sección 23
      (consultas a la vez, errores atrapados y bloqueos con `$executeRaw`). Desde la ronda 12: las tres viñetas del plan,
      sección 24 (cada paso con `await`, escrituras que fallan sin dejar nada, `academias` y `findMany` con `in`). Desde
      la ronda 13: las tres viñetas del plan, sección 25 (sin promesas descartadas, registros sin mensajes de Prisma,
      cargas masivas con `createMany` o `$executeRaw`). Desde la ronda 14: las dos viñetas del plan, sección 26 (toda
      promesa esperada dentro de la transacción y nada de funciones `async` en temporizadores; la pila sin el mensaje).
      Desde la ronda 15: las dos viñetas del plan, sección 27 (envolver errores con un mensaje propio y `{ cause }`; sin
      `money`). Desde la ronda 16: la viñeta del plan, sección 28 (un error no lleva el contenido de un archivo ni una
      `cause` función). Desde la ronda 17: en `docs/guia-local-windows.md`, las dos viñetas de "Problemas frecuentes" del
      plan, sección 29 (`.env` en UTF-8 y aviso de `env:completar`; criterio 67 ampliado) y que el repositorio puede estar
      bajo una unión; en `specs/backlog.md`, la nota O2 en la historia 005 (límite de peticiones de
      `GET /api/a/{nombreCorto}`, a decidir con el hosting, D-21; spec, "Notas para historias futuras"). Desde la ronda
      18: en `docs/guia-local-windows.md`, las viñetas propuestas en el plan, sección 30 (reemplazan la del aviso "los
      scripts no la pueden leer" de la ronda 17: línea que no lee nadie, comilla sin cerrar al final, variable repetida
      (vale la última), `npm ci` antes de los comandos, nombres en mayúsculas y sin `DOTENV_*`; criterio 67 precisado)
- [ ] T25 · responsable · En Windows (desde la ronda 18, `npm ci` antes de `env:completar`): `git pull`, `npm ci`, `npm run env:completar`, `docker compose up -d`,
      `npm run db:preparar`, `npm run dev`; entrar a `http://localhost:5173/plataforma/ingresar` con el superadmin de
      desarrollo, crear una academia, suspenderla y reactivarla (criterios 62, 63, 67, 69)

## Pendiente del responsable (Bryan)

Son pasos que hace el responsable del producto, fuera de la sesión de Claude:

- **Prueba en Windows (T25).** Sigue "Después de traer la historia 001" en `docs/guia-local-windows.md`: `git pull`,
  `npm ci`, `npm run env:completar`, `docker compose up -d`, `npm run db:preparar` y `npm run dev`. Luego entra a
  `http://localhost:5173/plataforma/ingresar` con el superadmin de desarrollo, crea una academia, suspéndela y
  reactívala (criterios 62, 63, 67 y 69). Si algún paso no coincide con la guía, dilo antes de aprobar.
- **Proteger `main`.** En GitHub, en la regla de protección de la rama `main`, exige que pasen los tres checks de la CI:
  **Linux**, **Windows** y **Pruebas protegidas**.
- **Secret scanning.** En GitHub, en la configuración de seguridad del repositorio, activa **Secret scanning** y, dentro
  de esa opción, **Push protection**.
- **Decisiones de hosting (D-21).** Se toman con el proveedor de hosting, antes de llevar el sistema a producción:
  - los esquemas que crea el proveedor (por ejemplo, `cron`, `topology` o `tiger`) y, si alguno tiene tablas o funciones
    propias con `USAGE` para `PUBLIC`, si se agrega a "Esquemas permitidos además de `public`" (con una especificación)
    o se revoca ese `USAGE` (spec 001, "Riesgos aceptados");
  - los parámetros que el servidor trae por defecto (por ejemplo, `DateStyle` o `search_path`). La API los fija en cada
    transacción, pero hay que saber cuáles cambia el proveedor;
  - los nombres de las variables de entorno en el proveedor (`DATABASE_URL`, `DATABASE_URL_APP`, `JWT_SECRETO`,
    `NODE_ENV`, `SUPERADMIN_*` y `DATABASE_POOL_MAX`), y quién crea el rol `aquagestion_app`, que tiene nombre fijo;
  - el límite de peticiones y `trust proxy` de la ruta pública `GET /api/a/{nombreCorto}` (nota de 005 en
    `specs/backlog.md`).

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo
- [x] Pruebas en verde tras la implementación
- [x] Ataque adversarial sin fallas abiertas _(ronda 19, 12/11/2026, sobre `03fad3c`: sin fallas confirmadas)_
