# 000 · Esqueleto

- **Historias y requerimientos:** sin HU de negocio. Cubre D-01, D-10, D-17, D-18, D-21 (configuración por variables
  de entorno), D-25, D-26 y D-30; RNF-01, RNF-03 (base de seguridad HTTP), RNF-10 y RNF-12 (español, America/Lima).
  Prepara, sin implementarlas, D-19, D-21 (archivos) y D-23.
- **Ruta crítica:** no. Ningún criterio toca dinero, datos de academias ni permisos: la historia no crea tablas de
  negocio ni maneja usuarios. Los criterios de seguridad básica y de verificación de pruebas protegidas llevan
  pruebas obligatorias, pero sin TDD protegido ni ataque adversarial (ver "Clasificación de ruta crítica").
- **Estado:** borrador

## Objetivo

Dejar un monorepo que arranca en la nube y en la PC con Windows del responsable, con la API de NestJS conectada a
PostgreSQL mediante Prisma, la web de React servida en `/` y la API en `/api`, las herramientas de calidad (Vitest,
ESLint, Prettier, `husky`, `lint-staged`) y una integración continua en Linux y Windows. También deja las
salvaguardas del método de trabajo: la preparación automática de cada sesión en la nube (D-26) y la verificación de
que nadie modifica las pruebas protegidas fuera de sus commits. Es la base sobre la que se construyen todas las
historias siguientes.

## Clasificación de ruta crítica

Ningún criterio es de ruta crítica.

- **Verificación de pruebas protegidas (criterios 33 a 42):** protege el método, no una función de negocio de la
  lista de `CLAUDE.md`; un error aquí no cuesta dinero ni filtra datos por sí solo, y lo respaldan la revisión con
  `git diff` del orquestador y el revisor. Lleva pruebas automáticas obligatorias (unitarias y con repositorios git
  temporales).
- **Cabeceras de `helmet`, CORS cerrado, registros sin cookies y archivos prohibidos en git (criterios 5, 12, 13 y
  15):** endurecimiento base sin datos personales todavía; la superficie real (sesión, cookies, datos) llega en 001
  y 002, que sí son críticas y donde el adversarial atacará estas mismas defensas. Llevan pruebas obligatorias.
- **Aislamiento entre academias (RLS):** no se toca aquí; empieza en 001.

En los criterios, _(prueba obligatoria)_ significa que debe existir una prueba automática que lo cubra;
_(verificación manual)_ indica quién y cómo lo comprueba.

## Criterios de aceptación

### A. Monorepo, instalación y repositorio

1. Dado un clon limpio con Node 22 y sin `node_modules`, cuando se ejecuta `npm ci` en la raíz (Linux o Windows),
   entonces termina sin errores, enlaza los workspaces `@aquagestion/backend` (`backend/`), `@aquagestion/frontend`
   (`frontend/`), `@aquagestion/contratos` (`packages/contratos/`), `@aquagestion/e2e` (`e2e/`) y
   `@aquagestion/scripts` (`scripts/`), y deja generado el cliente de Prisma. _(CI en Linux y en Windows)_
2. Dado Node de otra versión mayor (por ejemplo 20 o 24), cuando se ejecuta `npm ci`, entonces falla con un mensaje
   que indica que se requiere Node 22. El `.nvmrc` contiene `22` y el `package.json` raíz declara
   `"engines": { "node": ">=22.12.0 <23" }`. _(verificación manual del tester con otra versión de Node, si está
   disponible; si no, revisión del revisor)_
3. Dado un checkout en Windows con `core.autocrlf=true`, cuando se ejecuta `npm run format:check`, entonces pasa,
   porque `.gitattributes` fija LF (`* text=auto eol=lf`) y marca como binarios PDF, imágenes y fuentes. En el
   repositorio, `git ls-files --eol` no muestra ningún archivo con `i/crlf`. _(CI en Windows)_
4. Dado el repositorio, cuando se ejecuta `git check-ignore` sobre `.env`, `.env.local`, `.env.production`,
   `node_modules/`, `dist/`, `coverage/`, `backend/almacenamiento/`, el cliente de Prisma generado y los reportes de
   Playwright, entonces todos están ignorados, y `.env.example` no lo está. _(verificación del revisor)_
5. Dado que el índice de git contiene, en cualquier carpeta, un archivo `.env` o `.env.<algo>` distinto de
   `.env.example`, o un archivo `*.pem`, `*.key`, `*.p12` o `*.pfx`, cuando se ejecuta
   `npm run verificar:sin-secretos`, entonces termina con código 1 y lista esos archivos; si solo está
   `.env.example`, termina con código 0. _(prueba obligatoria)_
6. Dado `.env.example`, entonces contiene todas las variables que lee el sistema en esta historia, cada una con un
   comentario en español, solo con valores de desarrollo inventados (sin secretos reales) y con valores que funcionan
   tal cual con el `docker-compose.yml` y con el PostgreSQL de la nube. _(verificación del revisor)_

### B. API

7. Dado PostgreSQL encendido y las migraciones aplicadas, cuando se pide `GET /api/salud`, entonces responde 200 con
   `Cache-Control: no-store` y el cuerpo `{ "estado": "ok", "baseDatos": "ok" }`, válido según
   `respuestaSaludSchema` de `@aquagestion/contratos`. _(prueba obligatoria, integración contra PostgreSQL real)_
8. Dado `DATABASE_URL` apuntando a un puerto donde no hay PostgreSQL, cuando la API arranca, entonces arranca igual,
   y `GET /api/salud` responde 503 en menos de 3 segundos con `{ "estado": "error", "baseDatos": "error" }`, sin
   mensaje de error de la base, sin la cadena de conexión y sin nombres de host. _(prueba obligatoria,
   integración)_ Cuando la base vuelve a estar disponible, la siguiente consulta responde 200 sin reiniciar la API.
   _(verificación manual del tester en la nube: apagar y encender el cluster)_
9. Dado que la consulta de salud a la base no termina, cuando se pide `GET /api/salud`, entonces responde 503 a los
   2 segundos como máximo. _(prueba obligatoria, unitaria con un doble que nunca resuelve)_
10. Dada la API escuchando en `PUERTO_API`, cuando se pide una ruta fuera de `/api` (por ejemplo `GET /salud`), una
    ruta inexistente (`GET /api/no-existe`) o un método no definido (`POST /api/salud`), entonces responde 404 con el
    cuerpo `{ "codigo": "NO_ENCONTRADO", "mensaje": "No se encontró el recurso solicitado." }`, válido según
    `errorApiSchema`. _(prueba obligatoria, integración)_
11. Dado un error no controlado dentro de un controlador, cuando se atiende la petición, entonces responde 500 con
    `{ "codigo": "ERROR_INTERNO", "mensaje": "Ocurrió un error inesperado. Intenta de nuevo más tarde." }`, sin la
    traza ni el mensaje original, y el error se registra en el log con nivel `error` y su traza. _(prueba
    obligatoria, unitaria del filtro de errores)_
12. Dada cualquier respuesta de la API, entonces incluye las cabeceras de `helmet` (al menos
    `X-Content-Type-Options: nosniff` y `X-Frame-Options: SAMEORIGIN`), no incluye `X-Powered-By` y no incluye
    `Access-Control-Allow-Origin`, aunque la petición traiga `Origin: https://otro.ejemplo` (CORS deshabilitado: la
    web y la API comparten dominio, D-25). _(prueba obligatoria, integración)_
13. Dada una petición con cabeceras `Cookie` y `Authorization`, cuando la API la registra en el log, entonces los
    valores de `cookie`, `authorization` y `set-cookie` no aparecen (se reemplazan por un texto fijo). Los logs se
    escriben con `pino` en JSON; en desarrollo pueden mostrarse legibles. _(prueba obligatoria)_
14. Dado que falta `DATABASE_URL`, o no es una URL `postgresql://` o `postgres://`, o `PUERTO_API` no es un entero
    entre 1 y 65535, cuando la API arranca, entonces termina con código distinto de 0 y un mensaje en español que
    nombra la variable inválida, sin imprimir el valor de ninguna variable. _(prueba obligatoria, unitaria del
    validador de entorno)_
15. Dado el backend, entonces expone un reloj inyectable: el token `RELOJ` con la interfaz `Reloj { ahora(): Date }`,
    registrado de forma global con la hora del sistema, y una clase `RelojFijo` para pruebas que permite fijar la hora
    y avanzarla. Dado un archivo de `backend/src/` fuera de `backend/src/infraestructura/reloj/`, cuando contiene
    `new Date()` sin argumentos o `Date.now()`, entonces `npm run lint` falla con un mensaje que indica usar
    `RELOJ`. _(prueba obligatoria del reloj y de la regla de lint)_
16. Dada cualquier ejecución de Vitest, en cualquier sistema operativo, entonces las pruebas corren con la zona
    horaria `UTC`, y una prueba lo comprueba (`Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"`). Así,
    cualquier código futuro que dependa de la zona del servidor en vez de America/Lima falla en las pruebas.
    _(prueba obligatoria)_

### C. Base de datos y Prisma

17. Dado `DATABASE_URL` y `DATABASE_URL_PRUEBAS` en `.env` y un servidor PostgreSQL accesible con un usuario que
    puede crear bases, cuando se ejecuta `npm run db:crear`, entonces crea la base de desarrollo y la de pruebas si
    no existen y no toca las que ya existen; ejecutarlo dos veces seguidas no falla. _(prueba obligatoria,
    integración)_
18. Dada una base vacía, cuando se ejecuta `npm run db:migrar`, entonces aplica la migración inicial; al repetirlo,
    informa que no hay migraciones pendientes. Después de migrar, el esquema `public` no tiene más tabla que
    `_prisma_migrations` (sin tablas de negocio, D-17). `npm run db:preparar` hace, en orden, `db:crear`, la migración
    de la base de desarrollo, la de la base de pruebas y `db:semilla` (que en esta historia no inserta nada e informa
    "Sin datos de ejemplo todavía."). _(prueba obligatoria, integración)_
19. Dadas las pruebas de integración, cuando `DATABASE_URL_PRUEBAS` falta, es igual a `DATABASE_URL` o el nombre de
    su base no termina en `_pruebas`, entonces no se ejecuta ninguna prueba de integración y la ejecución falla con
    un mensaje claro, sin conectarse a ninguna base. Si la configuración es válida, antes de las pruebas se aplican
    las migraciones a la base de pruebas. _(prueba obligatoria)_
20. Dado Docker en la PC del responsable, cuando se ejecuta `docker compose up -d`, entonces levanta PostgreSQL 16
    publicado solo en `127.0.0.1`, en el puerto `POSTGRES_PUERTO` (5432 por defecto), con un volumen con nombre y
    una verificación de salud; con `.env` copiado de `.env.example` sin cambios, `npm run db:preparar` y
    `npm run dev` funcionan. _(verificación manual del responsable en Windows, siguiendo la guía)_

### D. Contratos y web

21. Dado `@aquagestion/contratos`, entonces exporta `respuestaSaludSchema` y su tipo `RespuestaSalud`, y
    `errorApiSchema` y su tipo `ErrorApi`; el backend y el frontend los importan desde el paquete, sin definiciones
    duplicadas. Cambiar un campo de `respuestaSaludSchema` hace fallar `npm run typecheck` en el backend y en el
    frontend. _(verificación del revisor; las pruebas de 7, 10 y 23 validan contra el esquema)_
22. Dado PostgreSQL encendido y migrado, cuando se ejecuta `npm run dev` en la raíz, entonces arrancan la
    compilación en modo observación de los contratos, la API en `PUERTO_API` (3000 por defecto) y la web en
    `PUERTO_WEB` (5173 por defecto, falla si el puerto está ocupado en lugar de cambiarlo); `http://localhost:5173/`
    muestra la página de inicio y `http://localhost:5173/api/salud` llega a la API por el proxy de Vite. Al pulsar
    Ctrl+C se detienen los tres procesos, en Windows y en Linux. _(verificación manual del tester en la nube y del
    responsable en Windows)_
23. Dada la página `/`, entonces muestra el título "AquaGestión" y el estado del sistema según `GET /api/salud`:
    "Comprobando el sistema…" mientras consulta; "Sistema en línea" con 200; "Sin conexión con la base de datos" con
    503; "No se pudo contactar al servidor" ante un error de red, otro código o una respuesta que no cumple
    `respuestaSaludSchema`. El documento tiene `lang="es"` y el título de pestaña "AquaGestión", y la página se ve
    completa sin desplazamiento horizontal a 360 px de ancho (RNF-01). _(prueba obligatoria de los cuatro estados)_
24. Dada una ruta desconocida de la web (por ejemplo `/xyz`), entonces muestra "Página no encontrada" y un enlace
    "Volver al inicio" que lleva a `/`. _(prueba obligatoria)_
25. Dado `npm run e2e`, entonces Playwright levanta la API y la web contra la base de pruebas, en puertos distintos
    de los de `npm run dev`, abre `/` en Chromium y comprueba que aparece "Sistema en línea". _(CI en Linux)_

### E. Calidad

26. Dado PostgreSQL con la base de pruebas, cuando se ejecuta `npm test` en la raíz, entonces corre las pruebas de
    todos los workspaces, incluidas las de integración contra PostgreSQL real, y pasa. `npm run test:unit` corre
    todas menos las de integración y las E2E, sin necesitar base de datos. En la CI, una prueba marcada con `.only`
    hace fallar la ejecución.
27. Cuando se ejecuta `npm run lint`, entonces ESLint (configuración plana, reglas con tipos de `typescript-eslint` y
    reglas de hooks de React en el frontend) termina sin errores ni advertencias (`--max-warnings 0`).
28. Cuando se ejecuta `npm run typecheck`, entonces pasa en todos los workspaces con TypeScript `strict` y
    `noUncheckedIndexedAccess`.
29. Cuando se ejecuta `npm run format:check`, entonces Prettier no encuentra diferencias. Prettier no formatea
    Markdown (`docs/`, `specs/`, `CLAUDE.md`, `README.md`, `.claude/`), para no reescribir los documentos de negocio.
30. Cuando se ejecuta `npm run build`, entonces compila, en orden, contratos, backend y frontend sin errores.
31. Dado un archivo `.ts` preparado para commit con un error de ESLint que no se corrige solo, cuando se hace el
    commit, entonces `husky` con `lint-staged` lo rechaza; si solo tiene formato incorrecto, Prettier lo corrige y
    el commit sigue. Funciona igual con Git para Windows. _(verificación manual del tester; el responsable lo
    confirma en Windows)_
32. Dado que el responsable o un agente ejecuta los comandos del proyecto en Windows, entonces ningún script de
    `package.json` usa `cp`, `rm`, `mkdir -p`, `export` ni sintaxis exclusiva de bash; las variables de entorno en
    comandos se fijan con `cross-env` o desde Node. _(verificación del revisor; CI en Windows)_

### F. Verificación de pruebas protegidas (`scripts/verificar-pruebas-protegidas.mjs`)

33. **Marca.** Un archivo está protegido en una versión dada si alguna de sus primeras 5 líneas tiene un comentario
    `spec: NNN-nombre (pruebas protegidas)` abierto con `//`, `#`, `/*`, `--` o `<!--`, donde `NNN` son tres dígitos
    y `nombre` tiene solo minúsculas, dígitos y guiones. Una marca en la línea 6 o después no protege. Los archivos
    binarios o inexistentes en esa versión no están protegidos. _(prueba obligatoria)_
34. **Commit de pruebas protegidas.** Es el commit cuyo título (primera línea del mensaje) empieza por
    `Pruebas protegidas (NNN)`, sin distinguir mayúsculas, con `NNN` de tres dígitos; por ejemplo
    `Pruebas protegidas (005): cobro proporcional (en rojo)` o
    `Pruebas protegidas (009), ataque ronda 2: clase de 19:00 (en rojo)`. _(prueba obligatoria)_
35. Dado un rango de commits, cuando un commit que no es de pruebas protegidas agrega, modifica, borra, renombra o
    cambia los permisos de un archivo que está protegido antes o después de ese commit, y ese archivo sigue cambiado
    en la diferencia neta del rango, entonces el script termina con código 1 e informa, por cada violación, el commit
    abreviado, su título, la ruta y la especificación de la marca. Esto incluye quitar la marca o moverla más abajo
    de la línea 5, y agregar la marca a un archivo nuevo o existente. _(prueba obligatoria)_
36. Dado que los únicos cambios a archivos protegidos del rango están en commits de pruebas protegidas, entonces
    termina con código 0 e informa cuántos commits y archivos protegidos revisó. _(prueba obligatoria)_
37. Dado que un commit indebido modificó un archivo protegido y otro commit posterior del mismo rango lo dejó igual
    que al inicio del rango (diferencia neta vacía para ese archivo), entonces no hay violación. Así se corrige un
    error sin reescribir la historia publicada. _(prueba obligatoria)_
38. Dado un commit de merge en el rango, entonces solo cuentan los archivos que el merge deja distintos de todos sus
    padres (resolución de conflictos), no lo que trae de cada rama. _(prueba obligatoria)_
39. Dado un rango vacío, entonces termina con código 0 e informa "Sin commits que revisar."; dada una referencia que
    no existe, termina con código 2 y un mensaje que la nombra. _(prueba obligatoria)_
40. Dadas rutas con espacios, tildes o "ñ", entonces las identifica y las informa correctamente, en Linux y en
    Windows. _(prueba obligatoria, también en la CI de Windows)_
41. Dado un commit en preparación, cuando se ejecuta el hook `commit-msg` de `husky`, entonces aplica las mismas
    reglas a los cambios preparados (marca en `HEAD` o en el índice) con el título del mensaje, y rechaza el commit
    con el mismo informe; si hay un merge en curso, no revisa (lo cubre la CI). _(prueba obligatoria del modo
    "preparados"; verificación manual del hook)_
42. Dada la CI, entonces el script se ejecuta en cada pull request sobre el rango entre la base y la cabeza del PR, y
    en cada push a una rama distinta de `main` sobre el rango desde su merge-base con `origin/main`. _(revisión del
    revisor sobre `ci.yml`)_

### G. Preparación de la sesión en la nube (`.claude/hooks/preparar-sesion.mjs`)

43. Dado que `CLAUDE_CODE_REMOTE` no vale `true` (la PC del responsable, la CI), cuando se ejecuta el hook, entonces
    termina con código 0, sin escribir nada en la salida, sin crear ni modificar archivos y sin ejecutar comandos.
    _(prueba obligatoria: se ejecuta en un directorio temporal y se comprueba que queda igual)_
44. Dado la nube (`CLAUDE_CODE_REMOTE=true`), con PostgreSQL apagado y sin `.env`, cuando se ejecuta el hook,
    entonces, en este orden:
    1. crea `.env` copiando `.env.example` (nunca sobrescribe un `.env` existente);
    2. si PostgreSQL no responde en el host y puerto de `DATABASE_URL`, enciende el cluster `16 main` y espera a que
       responda, hasta 30 segundos;
    3. crea, si no existe, el rol de `DATABASE_URL` con su contraseña, `LOGIN` y `CREATEDB`, **sin** superusuario;
    4. si falta `node_modules` o `package-lock.json` cambió desde la última instalación hecha por el hook, ejecuta
       `npm ci`;
    5. ejecuta `npm run db:crear`, genera el cliente de Prisma y aplica las migraciones a la base de desarrollo y a
       la de pruebas;
    6. imprime un resumen breve, una línea por paso.

    Al terminar, `npm test` y `npm run dev` funcionan sin otro paso. _(verificación manual del tester en la nube)_
45. Dado que ya se ejecutó una vez, cuando se ejecuta de nuevo en la misma sesión, entonces no reinstala
    dependencias, no falla y termina en menos de 30 segundos. _(verificación manual del tester)_
46. Dado que un paso falla (por ejemplo, PostgreSQL no enciende o `npm ci` falla), entonces el hook termina con
    código 0 para no bloquear la sesión, y su salida dice qué paso falló, el motivo resumido y el comando para
    reintentar (`node .claude/hooks/preparar-sesion.mjs`); nunca imprime la contraseña de la base. Si el host de
    `DATABASE_URL` no es `localhost` ni `127.0.0.1`, no intenta gestionar PostgreSQL y lo informa.
    _(verificación manual del tester; prueba de que el texto no contiene la contraseña si se separa en una función)_
47. Dado el hook, entonces solo usa módulos incluidos en Node (puede ejecutarse antes de `npm ci`) y ejecuta los
    comandos externos sin pasar por una shell, con los argumentos separados. _(verificación del revisor)_
48. Dado `.claude/settings.json`, entonces conserva `"model": "claude-opus-5-5"` y `"effortLevel": "high"` y agrega el
    hook `SessionStart` que ejecuta `node "$CLAUDE_PROJECT_DIR/.claude/hooks/preparar-sesion.mjs"` al iniciar y al
    reanudar una sesión (no al compactar ni al limpiar), con un tiempo límite de 600 segundos. _(verificación del
    revisor)_

### H. Integración continua (`.github/workflows/ci.yml`)

49. Dado un push a cualquier rama o un pull request hacia `main`, entonces corre la CI con Node tomado de `.nvmrc` y
    caché de npm, con estos trabajos, y cualquier paso que falle deja el check en rojo:
    - **Linux (`ubuntu-latest`) con PostgreSQL 16 real como servicio:** `npm ci`, `verificar:sin-secretos`,
      `format:check`, `lint`, `typecheck`, `db:preparar`, `test`, `build` y `e2e` con Chromium.
    - **Windows (`windows-latest`):** `npm ci`, `format:check`, `typecheck`, `build` y `test:unit` (D-26: detecta un
      `package-lock.json` o un binario que no funcione en Windows).
    - **Pruebas protegidas:** checkout con la historia completa y `verificar:pruebas-protegidas` según el
      criterio 42.

    Una ejecución nueva en la misma rama cancela la anterior. _(revisión del revisor; la primera ejecución en GitHub
    queda verde)_

### I. Documentación

50. Dado `docs/guia-local-windows.md`, entonces explica, para alguien que no es experto y con comandos de PowerShell:
    requisitos (Git para Windows, Node 22 LTS, Docker Desktop), la primera vez (clonar, copiar `.env.example` a
    `.env`, `npm ci`, `docker compose up -d`, `npm run db:preparar`, `npm run dev`, abrir
    `http://localhost:5173` y ver "Sistema en línea"), el día a día (`git pull`, `npm ci`, `docker compose up -d`,
    `npm run db:migrar`, `npm run dev`), cómo correr las pruebas, y problemas comunes: puerto 5432 ocupado
    (`POSTGRES_PUERTO` y `DATABASE_URL`), Docker apagado, versión de Node equivocada y cómo borrar la base de
    desarrollo (`docker compose down -v`, con la advertencia de que borra todo). _(verificación manual del
    responsable)_
51. Dado `.github/pull_request_template.md`, entonces pide: historia y enlace a su `spec.md`; qué cambia; criterios
    cubiertos; si es de ruta crítica, el commit de pruebas protegidas en rojo y las rondas de ataque; cómo probarlo
    en Windows; y una lista de verificación: sin cambios a pruebas protegidas fuera de sus commits, sin secretos ni
    `.env`, migraciones incluidas, guía actualizada si cambió cómo levantar el sistema, y justificación si se tocó la
    configuración de pruebas, los hooks de git, la CI o los scripts de verificación.
52. Dado el `README.md`, entonces indica qué está construido, enlaza la guía de Windows y los comandos principales, y
    deja de mencionar los avisos por WhatsApp (D-08) y la facturación SUNAT como parte de la Fase 1 (D-09), y
    describe el sistema como multiacademia (D-23).

## Casos límite

- `localhost` en Windows puede resolverse primero a `::1`, mientras Docker publica en `127.0.0.1`: `.env.example` y el
  proxy de Vite usan `127.0.0.1`.
- El puerto 5432 ocupado por un PostgreSQL instalado en Windows: `POSTGRES_PUERTO` en `.env` cambia el puerto
  publicado, y la guía explica que hay que cambiar también `DATABASE_URL` y `DATABASE_URL_PRUEBAS`.
- La base no responde (puerto cerrado) o se cuelga: la API arranca igual; salud responde 503 en menos de 3 segundos.
- `.env` ya existe en la nube con otros valores: el hook no lo toca y trabaja con esos valores.
- `.env` define un host remoto: el hook no gestiona PostgreSQL y lo dice.
- `npm ci` se interrumpe a medias en la nube: la siguiente ejecución del hook reinstala, porque la huella de
  `package-lock.json` solo se guarda al terminar bien.
- Contraseña de la base con comillas o caracteres especiales: el hook crea el rol sin romper la sentencia SQL;
  nombres de usuario o de base que no cumplan `^[a-z_][a-z0-9_]*$` hacen fallar el paso con un mensaje claro.
- Pruebas de integración con la base de desarrollo por error: se niegan a correr (criterio 19).
- Un implementador edita una prueba protegida por accidente: el hook `commit-msg` lo rechaza; si llegó a la rama, se
  revierte en un commit nuevo y la CI vuelve a verde (criterio 37), sin `--force`.
- Un commit de pruebas protegidas con el título mal escrito: el hook `commit-msg` lo rechaza antes de crearse.
- Unión de un PR con "Squash and merge": la verificación no corre en los push a `main` (criterio 42), así que no
  queda en rojo; ver la pregunta abierta 2.
- Checkout en Windows con `core.autocrlf=true`: `.gitattributes` manda.
- Ruta de proyecto con espacios en Windows: los comandos usan rutas entre comillas o argumentos separados.

## Reglas de negocio aplicables

No hay reglas de negocio. Se aplican las reglas que no se negocian de `CLAUDE.md` que tocan a esta historia:

- Configuración local en `.env`, nunca editando archivos versionados (D-21, D-26).
- Scripts multiplataforma, sin comandos de Unix (D-26).
- Fechas y horas de negocio en America/Lima sin depender de la zona del servidor (RNF-12): aquí solo se fuerza `UTC`
  en las pruebas (criterio 16) y se da el reloj inyectable (criterio 15).
- Repositorio público: sin credenciales, certificados, `.env` ni datos reales (criterios 5 y 6).
- Toda tabla de negocio lleva `academia_id` (D-23): no aplica todavía, porque no se crean tablas de negocio.

## Contrato

- **Endpoints:**
  - `GET /api/salud`, público, sin autenticación.
    - 200: `RespuestaSalud` = `{ estado: "ok", baseDatos: "ok" }`.
    - 503: `RespuestaSalud` = `{ estado: "error", baseDatos: "error" }`.
    - Siempre con `Cache-Control: no-store`.
    - Esquema: `respuestaSaludSchema` = objeto con `estado` y `baseDatos`, ambos `"ok" | "error"`.
- **Formato de error de la API** (lo usarán todas las historias): `ErrorApi` = `{ codigo: string, mensaje: string,
  detalles?: unknown }`, esquema `errorApiSchema`. `codigo` en MAYÚSCULAS con guiones bajos, `mensaje` en español
  para mostrar al usuario. En esta historia: `NO_ENCONTRADO` (404) y `ERROR_INTERNO` (500). El contenido de
  `detalles` lo define la primera historia con validación de entradas (002).
- **Variables de entorno** (todas en `.env.example`):
  - `DATABASE_URL`: base de desarrollo. Ejemplo `postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion`.
  - `DATABASE_URL_PRUEBAS`: base de pruebas; su nombre debe terminar en `_pruebas`. Ejemplo
    `postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion_pruebas`.
  - `PUERTO_API` (3000) y `PUERTO_WEB` (5173).
  - `POSTGRES_PUERTO` (5432): puerto publicado por `docker compose`.
  - `NODE_ENV`, opcional.
- **Reloj:** token `RELOJ`, interfaz `Reloj { ahora(): Date }`, clases `RelojSistema` y `RelojFijo` (esta última con
  métodos para fijar y avanzar la hora), en `backend/src/infraestructura/reloj/`.
- **Comandos de la raíz:** `dev`, `build`, `test`, `test:unit`, `e2e`, `lint`, `typecheck`, `format`,
  `format:check`, `db:crear`, `db:migrar`, `db:migrar:pruebas`, `db:migracion` (crear una migración nueva),
  `db:semilla`, `db:preparar`,
  `verificar:pruebas-protegidas` y `verificar:sin-secretos`.
- **Marca de pruebas protegidas y título de sus commits:** criterios 33 y 34. Convención para el orquestador: las
  pruebas nuevas que nacen de un ataque adversarial también se confirman en un commit propio con título
  `Pruebas protegidas (NNN), ataque ronda N: … (en rojo)`, separado de la corrección.
- **Eventos:** ninguno.
- **Permisos:** ninguno; no hay usuarios todavía.

## Cambios al modelo de datos

- Ninguna tabla de negocio ni transversal (ver la pregunta abierta 1).
- `backend/prisma/schema.prisma` solo con el `datasource` de PostgreSQL y el generador del cliente, sin modelos.
- Una migración inicial `backend/prisma/migrations/<marca>_inicial/` sin sentencias de tablas, para que
  `migrate deploy` funcione desde el primer día. Prisma crea su tabla `_prisma_migrations`.

## Fuera de alcance

- **Tablas de academias, usuarios, auditoría y configuración:** academias, auditoría y configuración por academia en
  001 (necesitan `academia_id` y la tabla de academias); usuarios en 002. Ver la pregunta abierta 1.
- **RLS, cliente de Prisma que fija la academia y rol de base de datos sin privilegios para la aplicación:** 001.
- **Autenticación, cookies, `@nestjs/throttler`, validación de entradas con zod y generación de OpenAPI:** 002, la
  primera historia con entradas; así el limitador, la validación y la documentación se diseñan con un caso real.
- **`AlmacenArchivos` y `EnviadorCorreo` (D-19, D-21):** 005, su primer uso (comprobantes, foto y enlace de
  seguimiento). Se diseñan junto con los límites de las entradas públicas (JPG o PNG de hasta 5 MB), que son de ruta
  crítica, para no fijar ahora una interfaz que luego haya que cambiar.
- **Utilidades de dinero (`Decimal`, redondeo hacia arriba) y de fechas en America/Lima (`@date-fns/tz`):** en la
  primera historia que las usa (004 para precios y horarios, 005 para el cálculo del cobro, que es crítico y lleva
  pruebas protegidas). Crearlas ahora obligaría a adivinar su forma sin casos reales. Esta historia sí deja el reloj
  inyectable y las pruebas en `UTC`, porque las pruebas protegidas de 002 en adelante necesitan controlar la hora
  desde el contrato público.
- **Dependencias con binarios aún sin uso (`sharp`, `@node-rs/argon2`) y librerías de negocio (`qrcode`, `pdfkit`,
  `exceljs`, `@nestjs/schedule`, `html5-qrcode`, React Hook Form, shadcn/ui):** se instalan con la historia que las
  usa; el trabajo de Windows de la CI las cubrirá desde ese momento.
- **Datos de ejemplo:** el comando `db:semilla` existe pero no inserta nada; las dos academias de ejemplo llegan con
  001.
- **Servir la web compilada en producción en el mismo dominio que la API:** se decide con el hosting (D-21). En
  desarrollo lo resuelve el proxy de Vite.
- **Escáner de secretos por contenido:** fuera; ver la pregunta abierta 3 (función de GitHub).

## Impacto en especificaciones anteriores

- Es la primera especificación; no cambia nada construido.
- Para las siguientes:
  - **001:** el usuario de `docker compose` es superusuario de PostgreSQL, y los superusuarios se saltan RLS. 001
    debe conectar la aplicación con un rol sin privilegios especiales (en la nube el hook ya crea uno sin
    superusuario) o fijar otro rol dentro de cada transacción. 001 también agrega los datos de ejemplo a
    `db:semilla` y actualiza la guía de Windows.
  - **002:** usa `RELOJ` y `RelojFijo` para el bloqueo por intentos, el formato `ErrorApi` (y define `detalles`),
    agrega el limitador, la validación con zod y OpenAPI.
  - **Todas:** el orquestador confirma las pruebas protegidas en commits con el título del criterio 34, incluidas
    las que nacen de un ataque.
- **`docs/decisiones.md`:** si el responsable aprueba la propuesta de la pregunta abierta 1, hay que ajustar el texto
  de D-17 (lo hace el orquestador o el documentador, no esta especificación).

## Riesgos aceptados

- **El título del commit se puede falsificar.** Cualquiera puede escribir "Pruebas protegidas (…)" en un commit de
  implementación. Se acepta porque el script es una alarma contra errores, no un control de acceso; lo respaldan la
  revisión con `git diff` del orquestador (paso 7 del flujo) y el revisor.
- **Las propias salvaguardas se pueden desactivar** editando el script de verificación, los hooks de git, la CI o la
  configuración de Vitest (por ejemplo, excluyendo archivos de prueba). Lo mitiga la plantilla de PR, que pide
  justificar esos cambios, y el revisor, que debe señalarlos siempre.
- **El hook de sesión ejecuta código del repositorio automáticamente** al abrir una sesión, y el repositorio es
  público. Solo actúa en la nube y no hace nada en la PC; el responsable revisa todo PR que toque `.claude/`.
- **Diferencias entre el PostgreSQL de la nube y el de Docker** (por ejemplo, la intercalación y el orden de textos
  con tildes o "ñ"). Se acepta por D-26; las historias que ordenen nombres deben fijar la intercalación de forma
  explícita.
- **Navegadores de Playwright en la nube:** puede que no se puedan descargar. Las E2E son obligatorias en la CI de
  Linux; en la nube se ejecutan si es posible.

## Decisiones

- **Ninguna tabla en 000** (propuesta, pendiente de confirmar en la pregunta abierta 1). Alternativa descartada:
  crear usuarios, auditoría y configuración aquí, como dice D-17. Motivo: todas son tablas por academia (D-23) y
  necesitan la tabla de academias y RLS de 001; crearlas antes obligaría a cambiarlas enseguida.
- **Endpoint de salud que consulta la base** como prueba de que Prisma está conectado. Alternativa descartada: solo
  `prisma migrate` sin endpoint. Motivo: el endpoint se prueba en integración, sirve a la web y al hosting.
- **La API arranca aunque la base esté caída.** Alternativa descartada: conectar al iniciar y abortar. Motivo: el
  estado se ve en salud y la API se recupera sola.
- **Reloj inyectable y pruebas en `UTC` aquí; dinero, fechas de Lima, archivos y correo después.** Motivo: el reloj
  lo necesitan las pruebas protegidas de 002 desde el contrato; lo demás se diseña mejor con su primer caso real.
- **`helmet` y CORS cerrado aquí; el limitador en 002.** Motivo: son una línea y no dependen del negocio; los
  límites del limitador sí dependen de la autenticación y de las entradas públicas.
- **Verificación de pruebas protegidas por diferencia neta del rango.** Alternativa descartada: fallar ante cualquier
  commit indebido aunque se haya revertido. Motivo: sin `--force`, una rama con un error quedaría en rojo para
  siempre.
- **Agregar la marca en un commit que no es de pruebas protegidas también es violación.** Motivo: solo el
  test-writer crea pruebas protegidas; si no, un implementador podría presentar sus propias pruebas como protegidas.
- **La verificación no corre en los push a `main`**, solo en PR y ramas. Motivo: funciona con cualquier forma de
  unir los PR.
- **`scripts/` es un workspace** (`@aquagestion/scripts`), como dice la nota del backlog, porque `db:crear` necesita
  el paquete `pg` y sus pruebas corren con Vitest.
- **Prettier no formatea Markdown.** Motivo: reescribiría las tablas de `docs/decisiones.md` y de los requerimientos.
- **Página de inicio provisional** con el nombre "AquaGestión" y el estado del sistema; la reemplazan historias
  posteriores (ver la pregunta abierta 4).

## Preguntas abiertas

1. **¿Qué tablas crea la 000?** D-17 dice que la 000 crea "lo transversal (usuarios, auditoría y configuración)",
   pero la nota de la 000 en el backlog (aprobado en D-30) dice "sin tablas de negocio", la de la 001 pone ahí la
   auditoría y la configuración por academia, y la de la 002, los usuarios.
   **Propuesta:** la 000 no crea ninguna tabla (solo Prisma conectado, una migración inicial vacía y el endpoint de
   salud); auditoría y configuración van en 001 y usuarios en 002, porque todas llevan `academia_id` (D-23) y
   dependen de la tabla de academias. Ajustar el texto de D-17 para que diga eso.
   **Valor provisional:** ninguna tabla (no bloquea el avance).
2. **¿Cómo vas a unir los PR en GitHub?** "Create a merge commit" conserva los commits de pruebas protegidas (el
   rastro del TDD); "Squash and merge" los junta en uno solo.
   **Propuesta:** "Create a merge commit". La verificación funciona con cualquiera de las dos, porque no corre en los
   push a `main`.
3. **Configuración del repositorio en GitHub** (la haces tú, no el código):
   **Propuesta:** después de unir la 000, proteger `main` exigiendo los tres checks de la CI (Linux, Windows y
   pruebas protegidas) y activar "Secret scanning" con "Push protection", que es gratis en repositorios públicos y
   cubre los secretos dentro de los archivos, cosa que `verificar:sin-secretos` no hace.
4. **¿Qué muestra la página raíz `/`?** El sistema es para varias academias (D-23) y cada una tendrá sus páginas en
   `/a/{academia}/…` (D-27); la raíz no pertenece a ninguna.
   **Propuesta:** por ahora, el nombre "AquaGestión" y el estado del sistema. Qué va en la raíz más adelante (por
   ejemplo, el ingreso del Superadmin) se decide en 001.
