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

## Ataque adversarial, ronda 5 (11/11/2026)

Fallas F1 a F3 y observaciones O1, O3 y O5 de la ronda 5 (sobre `b5ff3e9`); criterios 120 a 129 de `spec.md` (sección
N) y precisiones P-29 y P-30. O2, O4, O6, O7 y O8 quedaron en "Riesgos aceptados". Detalle técnico en la sección 17 del
plan.

- [ ] T71 · test-writer · Pruebas protegidas en rojo de los criterios 120 a 129 (archivos en "Protegidas del ataque
      ronda 5" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. Comprobar que
      ningún ejemplo que pasa en las protegidas de lint de las rondas 1 a 4 empieza a fallar por el criterio 128 (si
      alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 5: sesión con la clave
      vigente, search_path, cadenas estándar, esquemas del rol, objetos que se saltan RLS, unicidad por academia y
      dependencias (en rojo)" (criterios 120 a 129)
- [ ] T72 · tester · Confirmar que T71 falla por la razón esperada (cookie emitida con la clave anterior, tablas o
      funciones de `trampa` usadas, `standard_conforming_strings` en `off`, esquema propio o con `CREATE` aceptado,
      funciones de detección inexistentes, regla de paquetes y lista negra inexistentes, `scripts/lib/dependencias-backend.mjs`
      inexistente) y no por errores de las pruebas. Las que pasan ya en verde por diseño (124, 125 y 126 sobre las
      migraciones actuales, y la parte de autodetección de esas consultas) se informan como tales. Las que exigen
      superusuario o `CREATE` en la base se confirman en la CI de Linux o en Docker
- [ ] T73 · backend · Sesión: `aceptarIntento` compara `clave_hash` y `version_token` bajo `FOR UPDATE` con los leídos
      al verificar; si cambiaron, 401 sin escribir ni contar el intento (criterio 120)
- [ ] T74 · backend · Primera sentencia de `#fijarContexto` y de `enPlataforma` con `pg_catalog.set_config`,
      `search_path` y `standard_conforming_strings`; excepciones de `cli/` en `regla-sql-sesion.mjs`, también con
      `pg_catalog.` (criterios 121, 122)
- [ ] T75 · backend · Comprobación del rol en una transacción con la primera sentencia y con el catálogo calificado
      con `pg_catalog.` (criterio 121); condiciones de esquemas con `problemasDeEsquemas` en la API (P-29) (criterio 123)
- [ ] T76 · backend · `db:crear`: condiciones de esquemas con `problemasDeEsquemasApp` (P-29), consultas calificadas y
      `search_path` fijo en la conexión del script; confirmar los casos de vistas y vistas materializadas (criterios 123,
      125)
- [ ] T77 · backend · Si las pruebas de catálogo de 124 o 126 fallan con las migraciones actuales, corregir lo que
      señalen (sin editar migraciones aplicadas: una migración nueva) (criterios 124, 126)
- [ ] T78 · backend · `scripts/lib/dependencias-backend.mjs` (P-30) y su llamada en
      `scripts/comprobar-fuentes-protegidas.mjs`; `express` en `backend/package.json` y en la lista (criterio 127)
- [ ] T79 · backend · Reglas de paquetes declarados y de la lista negra en `eslint/regla-acceso-base.mjs`, en el lint
      normal y en el paso protegido (criterios 128, 129)
- [ ] T80 · orquestador · `git diff` desde el commit de T72: T73 a T79 no tocaron pruebas protegidas
- [ ] T81 · adversarial · Ronda 6 sobre todo lo anterior, en especial 120 a 129 (sesión durante un restablecimiento,
      `search_path`, esquemas, objetos del catálogo y dependencias); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 6 (12/11/2026)

Fallas F1 a F3 y observaciones O2 y O4 de la ronda 6 (sobre `84b367b`); criterios 130 a 136 de `spec.md` (sección O) y
precisiones P-31 a P-33. O1, O3 y O4 quedan además como notas en la sección 18 del plan. La ronda no encontró fallas en
las garantías de ejecución de 001.

- [ ] T82 · test-writer · Pruebas protegidas en rojo de los criterios 130 a 136 (archivos en "Protegidas del ataque
      ronda 6" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación, incluidas las
      utilidades `politicas.ts` y `sembradores.ts` (P-33). En el mismo commit: ampliar a los esquemas revisados las pruebas
      de catálogo de los criterios 9, 10, 11, 12, 124 y 126 (criterio 131), y adaptar `backend/test/utilidades/search-path.ts`
      (criterio 121) como dice "Impacto en especificaciones anteriores", ronda 6, sin quitar casos ni cambiar lo que
      comprueban; comprobar que ningún ejemplo de las protegidas de lint de las rondas 1 a 5 cambia de resultado con el
      criterio 136 (si alguno cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 6:
      privilegios en todos los esquemas, catálogo fuera de public, forma y ejecución de las políticas, transacción
      guardada y SQL de sesión (en rojo)" (criterios 121, 130 a 136)
- [ ] T83 · tester · Confirmar que T82 falla por la razón esperada (vista de `reportes` u otro privilegio fuera de
      `public` aceptado, `privilegiosDeMasEnEsquemas` inexistente, `tx` de otra transacción usado sin rechazo, regla de
      la transacción guardada inexistente, `SET CONSTRAINTS` rechazado, `lastval`/`currval` aceptados) y no por errores
      de las pruebas. Las que pasan ya en verde por diseño (131, 132 y 133 sobre las migraciones actuales, sus
      autocomprobaciones y la prueba del criterio 121 adaptada) se informan como tales. Las que exigen crear esquemas,
      superusuario o `SET ROLE aquagestion_app` se confirman en la CI de Linux o en Docker
- [ ] T84 · backend · `FUNCIONES_APP`, `ESQUEMAS_PERMITIDOS` y `privilegiosDeMasEnEsquemas` en `privilegios-app.ts`
      (P-31); consulta de privilegios en los esquemas revisados en `#comprobarRol`, con el log que nombra esquema, objeto
      y privilegio (criterio 130)
- [ ] T85 · backend · Lo mismo en `scripts/lib/rol-app.mjs` y en `problemasDePrivilegios` de `scripts/crear-bases.mjs`,
      con las correcciones `REVOKE … FROM aquagestion_app` o `FROM PUBLIC` (criterio 130)
- [ ] T86 · backend · Envoltorio atado a su contexto con `AsyncLocalStorage`: marca por transacción, comprobación en cada
      llamada y `ejecutar` en `#transaccion` (P-32) (criterio 134)
- [ ] T87 · backend · Regla `eslint/regla-transaccion-guardada.mjs` en el lint normal, con la prohibición de
      `async_hooks` fuera de `infraestructura/` (criterio 135)
- [ ] T88 · backend · `regla-sql-sesion.mjs`: `SET CONSTRAINTS … DEFERRED/IMMEDIATE` como sentencia permitida y `lastval`
      y `currval` en la lista de funciones prohibidas (criterio 136)
- [ ] T89 · backend · Si las pruebas de 131, 132 o 133 señalan algo con las migraciones actuales, corregirlo con una
      migración nueva (sin editar las aplicadas) (criterios 131 a 133)
- [ ] T90 · orquestador · `git diff` desde el commit de T83: T84 a T89 no tocaron pruebas protegidas
- [ ] T91 · adversarial · Ronda 7 sobre todo lo anterior, en especial 130 a 136 (privilegios fuera de `public`, objetos
      de extensiones, forma de las políticas, prueba de ejecución por tabla, transacción usada desde otro contexto y lint
      del SQL); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 7 (12/11/2026)

Fallas F1 a F3 y observación O5 de la ronda 7 (sobre `bb3ff2d`); criterios 137 a 140 de `spec.md` (sección P) y precisión
de P-33 (ronda 7). O1, O2, O4 y O6 quedan como notas en la sección 19 del plan. La ronda no encontró fallas críticas ni
altas.

- [ ] T92 · test-writer · Pruebas protegidas en rojo de los criterios 137 a 140 (archivos en "Protegidas del ataque
      ronda 7" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación. En el mismo commit:
      adaptar `aislamiento/rls-todas-las-tablas.test.ts` al criterio 138 (fila de prueba válida en B, juicio por lo escrito,
      autocomprobación con disparadores, sin quitar casos), `politicas.ts` y `forma-politicas.test.ts` al 140, y
      `sembradores.ts` si algún sembrador no crea una fila nueva por llamada (P-33, ronda 7); comprobar que ningún ejemplo
      de `eslint/regla-transaccion-guardada.test.mjs` cambia de resultado con el 139 (si alguno cambiara, detenerse e
      informar). Commit: "Pruebas protegidas (001), ataque ronda 7: extensiones en db:crear, INSERT en otra academia,
      EventEmitterAsyncResource y subconsulta en las políticas (en rojo)" (criterios 133, 137 a 140)
- [ ] T93 · tester · Confirmar que T92 falla por la razón esperada: `db:crear` informa un privilegio de más sobre un
      objeto de la extensión instalada en `public` (137) y la regla no señala `EventEmitterAsyncResource` ni
      `getBuiltinModule('async_hooks')` (139). Se informan como verdes por diseño: la API con la extensión y los controles
      del 137, la prueba de catálogo del 137, la prueba de ejecución del 133 adaptada al 138 y su autocomprobación, y la
      forma de las políticas con la subconsulta (140), porque cambian solo pruebas. Lo que exige superusuario, instalar
      extensiones o `SET ROLE aquagestion_app` se confirma en la CI de Linux o en Docker
- [ ] T94 · backend · `problemasDePrivilegios` de `scripts/crear-bases.mjs` sin objetos de extensiones en las tres ramas de
      su consulta, conservando el formato de sus mensajes (plan, sección 19) (criterio 137)
- [ ] T95 · backend · `eslint/regla-transaccion-guardada.mjs`: `EventEmitterAsyncResource` en cualquier forma y
      `getBuiltinModule` salvo con un literal que no sea `async_hooks`, fuera de `backend/src/infraestructura/` (criterio
      139)
- [ ] T96 · backend · Si la prueba de catálogo del 137 o las de 138 y 140 señalan algo con las migraciones actuales,
      corregirlo con una migración nueva (sin editar las aplicadas) (criterios 137, 138, 140)
- [ ] T97 · orquestador · `git diff` desde el commit de T92: T94 a T96 no tocaron pruebas protegidas
- [ ] T98 · adversarial · Ronda 8 sobre todo lo anterior, en especial 137 a 140 (API y `db:crear` ante extensiones,
      objetos agregados a una extensión, fila de prueba del `INSERT` con disparadores y restricciones, emisores y recursos
      asíncronos que conservan el contexto, forma de las políticas con subconsulta); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 8 (12/11/2026)

Falla F1 y observación O1 de la ronda 8 (sobre `65a4166`); criterios 141 a 143 de `spec.md` (sección Q), precisión de P-31 y
P-34. O2 y O3 quedan como notas en la sección 20 del plan. La ronda no encontró fallas en las garantías de ejecución de 001.

- [ ] T99 · test-writer · Pruebas protegidas en rojo de los criterios 141 a 143 (archivos en "Protegidas del ataque ronda 8"
      del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: el caso reproducido
      (`pgcrypto` en `public`, `ALTER EXTENSION pgcrypto ADD SCHEMA reportes2`, tabla sin RLS con `GRANT` a la app) en la
      API, en `db:crear` y en el catálogo, sus variantes y el control con un esquema de extensión que solo tiene objetos de
      la extensión (141, 142); y P-34 en los dos archivos, `validarEntorno`, `analizarUrlPostgres`, `db:crear`, el hook, el
      comando y la semilla (143). En el mismo commit: quitar de `esquemasRevisados` (`backend/test/utilidades/catalogo.ts`)
      la exclusión de los esquemas de extensiones (142) y comprobar que ninguna protegida anterior cambia de resultado sobre
      la base de pruebas real ni por el criterio 143 (si alguna cambiara, detenerse e informar). Commit: "Pruebas protegidas
      (001), ataque ronda 8: esquemas de extensiones y parámetros de conexión en la URL (en rojo)" (criterios 141 a 143)
- [ ] T100 · tester · Confirmar que T99 falla por la razón esperada: la API y `db:crear` aceptan la tabla de `reportes2`
      (141), la autocomprobación del catálogo no ve los objetos de `reportes_ext_prueba` hasta el ajuste de
      `esquemasRevisados` (142; con el ajuste en el mismo commit se informa como verde por diseño), y `url-postgres.ts` y
      `parametrosDeConexionProhibidos` no existen o `validarEntorno`, `db:crear`, el hook, el comando y la semilla aceptan
      `?user=` (143). Se informan como verdes por diseño el control del caso 4 del 141 y los casos que pasan del 143. Lo que
      exige instalar extensiones o ser su dueño se confirma en la CI de Linux o en Docker si en la nube se omite
- [ ] T101 · backend · Esquemas revisados sin la exclusión de esquemas de extensiones y tipo compuesto de extensión por su
      `reltype`, en `#comprobarRol` (`base-datos.ts`) y en `problemasDePrivilegiosEnEsquemas` (`scripts/crear-bases.mjs`),
      y en cualquier otra consulta de producción que repita la condición (plan, sección 20) (criterio 141)
- [ ] T102 · backend · `PARAMETROS_DE_CONEXION_PROHIBIDOS` y `parametrosDeConexionProhibidos` en
      `backend/src/infraestructura/entorno/url-postgres.ts` y en `scripts/lib/entorno.mjs` (P-34); llamada en
      `validarEntorno` y en `analizarUrlPostgres` (cubre `db:crear` y el hook) (criterio 143)
- [ ] T103 · backend · La misma comprobación en `backend/src/cli/superadmin.ts` y `backend/prisma/seed.ts` sobre
      `DATABASE_URL`, antes de `crearClienteDelDueno`; opcional, en `scripts/prisma.mjs` (plan, sección 20) (criterio 143)
- [ ] T104 · backend · Si las pruebas de 141 o 142 señalan algo con las migraciones actuales, corregirlo con una migración
      nueva (sin editar las aplicadas) (criterios 141, 142)
- [ ] T105 · orquestador · `git diff` desde el commit de T99: T101 a T104 no tocaron pruebas protegidas
- [ ] T106 · adversarial · Ronda 9 sobre todo lo anterior, en especial 141 a 143 (objetos propios en esquemas de
      extensiones, tipos y otros objetos de extensiones, parámetros de la URL y diferencias entre los lectores de URL); si
      hay fallas, se repite el ciclo

## Ataque adversarial, ronda 9 (12/11/2026)

Fallas F1 (alta) y F2 (media) y observaciones O1 y O2 de la ronda 9 (sobre `532eee4`); criterios 144 a 148 de `spec.md`
(sección R) y precisión P-35. Plan, sección 21.

- [ ] T107 · test-writer · Pruebas protegidas en rojo de los criterios 144 a 148 (archivos en "Protegidas del ataque ronda
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
- [ ] T108 · tester · Confirmar que T107 falla por la razón esperada: el texto con `Ñandú` se guarda alterado y
      `current_setting('client_encoding')` no es `UTF8` (146); `synchronous_commit`, `array_nulls` y
      `transform_null_equals` llegan contaminados (147); la regla de `cli/` rechaza las cuatro llamadas nuevas (146 y
      147); `diferenciasConDesarrollo` no existe y `db:crear` acepta otra base (148). Se informan como verdes por diseño:
      las pruebas de catálogo y de ejecución de 144 y 145 y sus autocomprobaciones (las funciones ya son `STABLE`; la
      autocomprobación debe detectar el caso `IMMUTABLE`), los controles y las pruebas anteriores adaptadas. Lo que exige
      superusuario (la autocomprobación del 145 con `SET LOCAL ROLE` en Docker y la CI) se confirma en la CI de Linux o en
      Docker si en la nube se omite
- [ ] T109 · backend · Primera sentencia de `#transaccion` (`base-datos.ts`) y de `enPlataforma` (`cli/conexion.ts`) con
      `client_encoding`, `synchronous_commit`, `array_nulls` y `transform_null_equals`, y sus comentarios (plan, sección
      21) (criterios 146, 147)
- [ ] T110 · backend · Regla de lint de `cli/`: las cuatro llamadas nuevas a `set_config` en la lista cerrada, con la
      misma comparación que las de los criterios 98, 107, 121 y 122 (criterios 146, 147)
- [ ] T111 · backend · `diferenciasConDesarrollo` en `scripts/lib/entorno.mjs` (P-35); llamada en `crearBases` antes de
      conectarse; función exportada del hook con la lectura y validación de `DATABASE_URL_APP`, usada en el paso 3b; y el
      comentario de `POSTGRES_PUERTO` en `.env.example` (criterio 148)
- [ ] T112 · backend · Si las pruebas de 144 o 145 señalan algo con las migraciones actuales, corregirlo con una migración
      nueva (sin editar las aplicadas) (criterios 144, 145)
- [ ] T113 · orquestador · `git diff` desde el commit de T107: T109 a T112 no tocaron pruebas protegidas
- [ ] T114 · adversarial · Ronda 10 sobre todo lo anterior, en especial 144 a 148 (volatilidad y cuerpo de las funciones de
      contexto, planes guardados y sentencias preparadas en la conexión del pool, funciones auxiliares que leen el
      contexto, codificación y otros parámetros de sesión por cada vía, y diferencias entre `DATABASE_URL_APP` y
      `DATABASE_URL`); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 10 (12/11/2026)

Falla F1 (alta) y observaciones O1 y O2 de la ronda 10 (sobre `e15707c`); criterios 149 a 152 de `spec.md` (sección S) y
precisiones P-36 y P-37. Plan, sección 22 (con la nota O3 ampliada y la nota O1, fecha de negocio en SQL, que no lleva
criterio).

- [ ] T115 · test-writer · Pruebas protegidas en rojo de los criterios 149 a 152 (archivos en "Protegidas del ataque ronda
      10" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: en `conAcademia` y
      `comoPlataforma`, las variantes reintento que atrapa `esViolacionDeUnicidad` tras una escritura, `SELECT 1/0`
      atrapado (con `try`/`catch` y con `.catch`), consulta sin `await` que falla después de que `trabajo` termina (cruda
      y de un modelo) y la ruta de un controlador de prueba que responde 500, con sus controles y la conexión sana después
      (149); las variantes en `enPlataforma` (150); `ROLLBACK` y `COMMIT` escritos dentro de `trabajo` y el control de la
      marca (151); y `ipParaAuditoria` unitaria más la integración con `AcademiasService.crear` y `registrarEnAcademia`
      (152). Comprobar que ninguna protegida anterior cambia de resultado por estas pruebas (si alguna cambiara,
      detenerse e informar). Commit: "Pruebas protegidas (001), ataque ronda 10: transacción abortada reportada como
      éxito e IP con zona en la auditoría (en rojo)" (criterios 149 a 152)
- [ ] T116 · tester · Confirmar que T115 falla por la razón esperada: `conAcademia`, `comoPlataforma` y `enPlataforma`
      resuelven con el valor de `trabajo` en vez de rechazar, y `ErrorTransaccionAbortada` no existe (149 a 151);
      `ipParaAuditoria` no existe y `fe80::1%eth0` hace fallar `crear` con 500 (152). Se informan como verdes por diseño:
      los controles (camino normal, `trabajo` que relanza el error, conexión sana después) y lo escrito antes de un
      `COMMIT` del 151
- [ ] T117 · backend · `ErrorTransaccionAbortada` en `errores.ts` y exportada en `index.ts` (P-36); marca
      `app.transaccion` en la primera sentencia de `#fijarContexto`; `asentar()` en `envoltorio.ts`;
      `comprobarTransaccionViva` y su uso en `#transaccion` de `base-datos.ts` después de `terminar()`, solo en el camino
      bueno; registro técnico sin parámetros ni URL (plan, sección 22) (criterios 149, 151)
- [ ] T118 · backend · `enPlataforma` (`cli/conexion.ts`): la marca en su primera sentencia, ceder un turno y
      `comprobarTransaccionViva` antes de devolver; comentario actualizado (plan, sección 22) (criterios 150, 151)
- [ ] T119 · backend · `ipParaAuditoria` en `backend/src/modulos/auditoria/` (P-37), exportada en su `index`, y usada en
      `insertarEnAuditoriaDeAcademia` e `insertarEnAuditoriaPlataforma` (criterio 152)
- [ ] T120 · backend · Revisar que ningún servicio ni comando de 001 atrape errores de la base dentro de `trabajo` para
      seguir; si hay alguno, pasarlo a `ON CONFLICT DO NOTHING RETURNING` o dejar salir el error (plan, nota O3 ampliada)
      (criterio 149)
- [ ] T121 · orquestador · `git diff` desde el commit de T115: T117 a T120 no tocaron pruebas protegidas
- [ ] T122 · adversarial · Ronda 11 sobre todo lo anterior, en especial 149 a 152 (errores atrapados dentro de
      `trabajo` por cualquier camino, consultas sin `await` crudas y de modelos, `ROLLBACK`, `COMMIT` y `SAVEPOINT`
      escritos, errores en la confirmación, la marca de la transacción, la conexión del pool después de cada caso, e IP
      con zona, mapeadas o inválidas en la auditoría); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 11 (12/11/2026)

Falla F1 (alta) y observaciones O1 y O2 de la ronda 11 (sobre `28ab05c`); criterios 153 a 155 de `spec.md` (sección T),
ampliación de P-36 y precisión P-38. Plan, sección 23. La O2 y `enPlataforma` sin cola van a "Riesgos aceptados".

- [ ] T123 · test-writer · Pruebas protegidas en rojo de los criterios 153 a 155 (archivos en "Protegidas del ataque ronda
      11" del plan, sección 13), con la marca de pruebas protegidas y sin mirar la implementación: los casos 1 a 7 del
      criterio 153 en `conAcademia` y `comoPlataforma` (lista que ignora las inexistentes en tres órdenes; `allSettled`
      con escritura y auditoría; `comoPlataforma` con `Promise.all` y `allSettled`; 20 consultas en orden; error de la
      base en medio; P2025 suelto; `trabajo` que lanza con consultas en la cola), con la conexión sana después; la unitaria
      de `envolver` con una transacción falsa para la cola (153) y para `undefined`, `exigirCompleta` y los resultados
      normales `null`, `0`, `[]`, `{ count: 0 }` (154); y el bloqueo de transacción con `$executeRaw`, `::text` y
      `pg_try_advisory_xact_lock` entre dos transacciones (155). Comprobar que ninguna protegida anterior cambia de
      resultado por estas pruebas (si alguna cambiara, detenerse e informar). Commit: "Pruebas protegidas (001), ataque
      ronda 11: consultas a la vez que Prisma no ejecutó y bloqueo de transacción (en rojo)" (criterios 153 a 155)
- [ ] T124 · tester · Confirmar que T123 falla por la razón esperada: las reproducciones 1 a 3 resuelven sin las
      escrituras ni la auditoría (o con `undefined` en `allSettled`); la unitaria ve la segunda consulta entregada antes de
      que se asiente la primera, y `descartar` y `exigirCompleta` no existen (153, 154). Se informan como verdes por
      diseño: los controles (P2025 suelto, 20 consultas en orden si ya pasan, error de la base en medio, `trabajo` que
      lanza) y el criterio 155 si ya pasa con el código actual (es una guarda de la forma documentada)
- [ ] T125 · backend · Cola serial en `envoltorio.ts` (`enviarSeguida` encadenada, comprobaciones al llamar, `descartar`),
      sin cambiar lo que recibe `trabajo` (promesas nativas sin claves propias) (plan, sección 23) (criterio 153)
- [ ] T126 · backend · Segunda capa: `undefined` rechaza con `ErrorTransaccionAbortada` (motivo `incompleta`) y marca la
      transacción; `exigirCompleta` en `envoltorio.ts`; `motivo` en `ErrorTransaccionAbortada` (`errores.ts`, ampliación de
      P-36); en `#transaccion` de `base-datos.ts`, `descartar()` en el camino del error y `exigirCompleta()` antes de
      `comprobarTransaccionViva`, con el registro técnico que nombra la operación sin argumentos (criterio 154)
- [ ] T127 · backend · Comentario de `enPlataforma` (`cli/conexion.ts`): en comandos y en la semilla no se lanzan consultas
      en paralelo dentro de `enPlataforma`; revisar que `superadmin.ts` y `seed.ts` cumplen (riesgo aceptado, plan,
      sección 23)
- [ ] T128 · orquestador · `git diff` desde el commit de T123: T125 a T127 no tocaron pruebas protegidas
- [ ] T129 · adversarial · Ronda 12 sobre todo lo anterior, en especial 153 a 155 (lotes de Prisma por cualquier camino:
      `Promise.all`, `allSettled`, `map` con `async`, `race`, consultas sin `await`, operaciones de varias sentencias;
      la cola ante rechazos, descartes, tiempos agotados y llamadas desde otro contexto; `undefined` y resultados vacíos
      legítimos; bloqueos de transacción; y que las protegidas anteriores sigan igual); si hay fallas, se repite el ciclo

## Ataque adversarial, ronda 12 (12/11/2026)

Falla F1 (alta), falla F2 (media) y observaciones O1 a O3 de la ronda 12 (sobre `8a63dbc`); criterios 156 a 158 de
`spec.md` (sección U), precisión de P-38 y precisiones P-39 y P-40. Plan, sección 24. O1 y O2 son notas del plan; O3
amplía el riesgo aceptado "Tiempo límite con una operación de varias sentencias a medias".

- [ ] T130 · test-writer · Pruebas protegidas en rojo de los criterios 156 a 158 (archivos en "Protegidas del ataque ronda
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
- [ ] T131 · tester · Confirmar que T130 falla por la razón esperada: las cadenas de los casos 1, 2 y 4 resuelven sin la
      auditoría (o sin la academia) y la unitaria ve rechazada la llamada encadenada durante `asentar()` y
      `exigirCompleta()` sin lanzar tras una llamada tardía (156); `rechazos.ts` no existe (157); en la reproducción, A
      queda suspendida sin auditoría y `puntos-de-guardado.ts` no existe (158). Se informan como verdes por diseño: la
      cadena que falla (caso 3 del 156) si ya rechaza, los controles del 158 (P2025 suelto, error de la base, escrituras
      que van bien), el caso (v) y el (vi) de la unitaria del 156, y la reproducción en `conAcademia` si quedó como guarda
- [ ] T132 · backend · Envoltorio abierto durante `asentar` en `envoltorio.ts`: `asentar()` sin `terminar()` previo,
      espera con `setImmediate` y apagado en el mismo paso; `cerrando`; `exigirActiva` con el nombre de la operación; las
      llamadas tardías y las de otro contexto desde `asentar` marcan `incompleta`; mensajes de error sin cambios (plan,
      sección 24) (criterio 156)
- [ ] T133 · backend · Capa de puntos de guardado en `infraestructura/prisma/puntos-de-guardado.ts` (P-39): punto
      aleatorio por transacción, secuencia de crear, escribir, liberar; comprobación del estado y vuelta al punto solo con
      la transacción sana; marca en `exigirSana` ante cualquier falla de la capa; lecturas y crudo tal cual (plan,
      sección 24) (criterio 158)
- [ ] T134 · backend · `#transaccion` en `base-datos.ts`: `envolver(capa.tx)`; en el error, `descartar()` y `terminar()`;
      en el camino bueno, `asentar()` sin `terminar()` previo, `exigirCompleta()` y `capa.exigirSana()` antes y después de
      `comprobarTransaccionViva`, y `terminar()` en un `finally`; registro técnico sin argumentos (criterios 156, 158)
- [ ] T135 · backend · `crearManejadorDeRechazos` en `backend/src/infraestructura/proceso/rechazos.ts` (P-40) y su
      registro en `main.ts` después de `await app.listen(…)`, con el registro de pino de la app y sin `uncaughtException`
      (criterio 157)
- [ ] T136 · backend · Revisar que ningún servicio de 001 use cadenas sin `await` dentro de `trabajo`, escrituras con
      relaciones anidadas ni actualice `academias` desde `conAcademia`; si hay alguno, corregirlo (plan, sección 24)
      (criterios 156, 158)
- [ ] T137 · orquestador · `git diff` desde el commit de T130: T132 a T136 no tocaron pruebas protegidas
- [ ] T138 · adversarial · Ronda 13 sobre todo lo anterior, en especial 156 a 158 (cadenas sin `await` con microtareas,
      temporizadores, E/S y contextos perdidos; llamadas tardías antes, durante y después de la comprobación; `asentar`
      que no termina; rechazos sin manejar y lo que registran; escrituras de delegados con relaciones anidadas, `upsert`,
      `createMany` y `deleteMany` que fallan a medias; errores de la base dentro de una escritura; sentencias de la capa
      que fallan o llegan tarde; nombre del punto de guardado; y que las protegidas anteriores sigan igual); si hay
      fallas, se repite el ciclo

## Ataque adversarial, ronda 13 (12/11/2026)

Falla F1 (alta), falla F2 (media) y observaciones O1 y O2 de la ronda 13 (sobre `8f29106`); criterios 159 a 162 de
`spec.md` (sección V), P-41, P-42 y precisiones de P-36, P-38 y P-40. Plan, sección 25. La F1 (c) se evaluó y no se
adopta (decisiones de la ronda 13); la O2 amplía el riesgo aceptado "Dos sentencias más por escritura de un delegado".

- [ ] T139 · test-writer · Pruebas protegidas en rojo de los criterios 159 a 162 (archivos en "Protegidas del ataque ronda
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
- [ ] T140 · tester · Confirmar que T139 falla por la razón esperada: el lint no señala `void` ni la función `async` en el
      lugar (159); las reproducciones 1, 2 y 4 resuelven sin la auditoría (o responden 200) y la unitaria ve el error
      original durante `asentar()` sin marca (160); la causa de `ErrorTransaccionAbortada` y el registro del 500 contienen
      `44556677` (161); `registro-de-errores.ts` no existe y los registros del filtro y del manejador muestran los valores
      (162). Se informan como verdes por diseño: los controles del 160 (caso 3 y unitarias (iv) a (vi)), los `Error`
      comunes del 162 y las formas que pasan el lint
- [ ] T141 · backend · Regla de lint de promesas descartadas: `eslint/regla-promesas-descartadas.mjs` (P-41) con la regla
      propia y el bloque con tipos; `eslint.config.mjs` (los dos bloques, después de `aquagestion/typescript`) y
      `eslint.protegido.config.mjs` (la regla propia, y el criterio 159 en el comentario de cabecera); `main.ts` con
      `arrancar().catch(…)` y `process.exit(1)`; `envoltorio.ts` sin `void`; `npm run lint` en verde sin apagar reglas
      (plan, sección 25) (criterio 159)
- [ ] T142 · backend · `registro-de-errores.ts` en `infraestructura/prisma/` (P-42: `CausaLimpia`, `causaLimpia`,
      `esErrorDeBase`, `errorParaRegistro`, `CircunstanciaDeLaCausa`), exportado por `index.ts`; constructor de
      `ErrorTransaccionAbortada` con la causa limpia (precisión de P-36) (plan, sección 25) (criterios 161 y 162)
- [ ] T143 · backend · Envoltorio: desde `asentar()`, el rechazo de una operación entregada marca y rechaza con
      `ErrorTransaccionAbortada` (`rechazo-tras-trabajo`); `incompleta` con operación, circunstancia y error;
      `exigirCompleta` y los caminos de 154 y 156 con `causaLimpia`; `#registrarAbortada` con la causa limpia (plan,
      sección 25) (criterios 160 y 161)
- [ ] T144 · backend · Registro limpio: `FiltroErrores` (las dos ramas 5xx), `crearManejadorDeRechazos` (precisión de
      P-40), `mensajeSeguro` y el error del arranque de `main.ts` con `errorParaRegistro`; confirmar que el `PrismaClient`
      de `BaseDatos` y de `crearClienteDelDueno` no tiene la opción `log` (plan, sección 25) (criterio 162)
- [ ] T145 · backend · Revisar que ningún servicio de 001 tenga promesas descartadas, errores propios que copien el mensaje
      de otro ni registros de errores fuera de `errorParaRegistro` (`rg "\{ err|console\.(error|warn)|registro\.(error|warn)"
      backend/src backend/prisma`); si hay alguno, corregirlo (plan, sección 25) (criterios 159 y 162)
- [ ] T146 · orquestador · `git diff` desde el commit de T139: T141 a T145 no tocaron pruebas protegidas
- [ ] T147 · adversarial · Ronda 14 sobre todo lo anterior, en especial 159 a 162 (formas de descartar promesas que
      escapen a las dos reglas; rechazos de operaciones justo antes, durante y después de `asentar()` y de la comprobación;
      `.catch`, `.then(ok, err)`, `allSettled` y `try`/`catch` en continuaciones; llamadas rechazadas al llamar durante
      `asentar()`; causas y registros con valores por cualquier camino: filtro, manejador, `#registrarAbortada`, comandos,
      semilla, pino-http, el registro de Nest; errores de Prisma no reconocidos por `esErrorDeBase`; getters que lanzan y
      ciclos en `errorParaRegistro`; y que las protegidas anteriores sigan igual); si hay fallas, se repite el ciclo

## Cierre

- [ ] T24 · documentador · `docs/guia-local-windows.md` (criterio 67; desde la ronda 9, que al cambiar el puerto de
      Docker se cambia también en `DATABASE_URL_APP`, criterio 148), `README.md` (qué está construido) y las notas
      de 001 y 002 en `specs/backlog.md`: el primer administrador de cada academia pasa de 001 a 002 (DR-1). Desde la
      ronda 10: la sección "Fechas y horas de negocio (America/Lima)" de `docs/arquitectura.md`, con el texto propuesto
      en el plan, sección 22, nota O1. Desde la ronda 11: las tres viñetas de transacciones del plan, sección 23
      (consultas a la vez, errores atrapados y bloqueos con `$executeRaw`). Desde la ronda 12: las tres viñetas del plan,
      sección 24 (cada paso con `await`, escrituras que fallan sin dejar nada, `academias` y `findMany` con `in`). Desde
      la ronda 13: las tres viñetas del plan, sección 25 (sin promesas descartadas, registros sin mensajes de Prisma,
      cargas masivas con `createMany` o `$executeRaw`)
- [ ] T25 · responsable · En Windows: `git pull`, `npm ci`, `npm run env:completar`, `docker compose up -d`,
      `npm run db:preparar`, `npm run dev`; entrar a `http://localhost:5173/plataforma/ingresar` con el superadmin de
      desarrollo, crear una academia, suspenderla y reactivarla (criterios 62, 63, 67, 69)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
