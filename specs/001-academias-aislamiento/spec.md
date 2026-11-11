# 001 · Academias y aislamiento

- **Historias y requerimientos:** sin HU propias (el documento v1.4 no tiene historias del Superadmin). Cubre
  D-23 (varias academias, `academia_id` y RLS), D-27 (nombre corto), D-29 (Superadmin, y cómo inicia sesión), D-17
  (auditoría y configuración por academia en 001), D-07 (tabla de configuración clave/valor; campos de bloqueo
  aplicados al Superadmin), D-25 (argon2, JWT en cookie `httpOnly` con versión de token, `@nestjs/throttler`), D-21
  (configuración por variables de entorno), D-22 (nombre de la academia) y D-26 (rol de base en la nube y en
  Windows). Requerimientos: RN-22 y RNF-06 (bitácora: quién, cuándo y qué), RNF-03 (contraseñas con argon2 y control
  de acceso), RNF-05 (acceso restringido a datos sensibles), RNF-12 (America/Lima) y la entidad `AUDITORIA` de la
  sección 9. Prepara D-28 (DNI único por academia), que se aplica en 002.
- **Ruta crítica:** sí, casi toda. Es el primer punto de la lista de `CLAUDE.md` (aislamiento entre academias) y toca
  además permisos del Superadmin (D-29) y autenticación. No son críticos: formato del nombre corto, semilla, `.env`,
  guía, formato de errores y web de la plataforma.
- **Estado:** aprobada por el responsable (11/11/2026)

## Objetivo

Dejar AquaGestión listo para atender a varias academias sin que ninguna pueda ver ni tocar los datos de otra: la
tabla de academias con su nombre corto, la seguridad a nivel de fila (RLS) en PostgreSQL con un rol de base de datos
sin privilegios, un único camino de acceso a datos que fija la academia en cada transacción, y las tablas
transversales de auditoría y configuración por academia. También da al dueño de AquaGestión (Superadmin) su ingreso
y una pantalla para crear, suspender y reactivar academias sin ver sus datos internos. Todas las historias
siguientes se construyen sobre este aislamiento.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **A. Rol de la aplicación en PostgreSQL (1 a 5, y 47 en el bloque E):** si la API se conecta con un superusuario o con el dueño de las
  tablas, RLS no filtra nada y un error de consulta mostraría datos de otra academia (D-23).
- **B. Seguridad a nivel de fila (9 a 20):** es la segunda capa de D-23; cada criterio cierra un camino por el que
  una consulta sin filtro, con otra academia o desde la plataforma leería o escribiría datos ajenos.
- **C. Acceso a datos (21 a 26 y 28):** el cliente que fija la academia es el único camino de la API a la base; una
  fuga entre conexiones del pool o entre peticiones simultáneas mezclaría academias.
- **D. Auditoría (29 a 32):** RN-22 y RNF-06; una auditoría que se pueda borrar, escribir en otra academia o perder
  al revertir no sirve como evidencia.
- **E. Superadmin y sesión (33 a 46):** autenticación (contraseñas con argon2, bloqueo, sesión que se puede
  revocar). Una sesión falsificada daría control sobre todas las academias.
- **F. Academias (48 y 50 a 57):** D-29: el Superadmin solo maneja academias y nunca recibe sus datos internos; un
  nombre corto repetido mezclaría las páginas públicas de dos academias; la suspensión debe cortar el acceso.
- **G. Academia por su nombre corto (58 a 60):** entrada pública (D-27); es el punto por el que las páginas públicas
  de 002 y 005 eligen la academia.
- **J. Correcciones del ataque, ronda 1 (72 a 79):**
  - 72 y 73: aislamiento entre academias (D-23, D-29); una conexión del pool con contexto residual daría a una
    academia las filas de todas, o a la plataforma los datos internos de una academia.
  - 74: autenticación y entradas; un formulario simple de otro sitio (sin verificación previa del navegador) podría
    iniciar sesión, crear o suspender academias.
  - 75: autenticación; el límite por IP es la defensa contra la fuerza bruta y no debe tener atajos.
  - 76 y 77: entradas de autenticación y auditoría (RN-22); un 500 ante una entrada, o un nombre o motivo invisible
    o invertido, deja una auditoría ilegible o una página pública engañosa.
  - 78 y 79: autenticación; una cookie sin `Secure` o un secreto de firma público permitirían robar o falsificar la
    sesión del Superadmin.

No son críticos, pero llevan _(prueba obligatoria)_ o la verificación indicada: 6 a 8 (preparación del rol con
scripts; la garantía está en 1 y 4), 27 (opciones de aislamiento), 49 (formato del nombre corto; la unicidad sí es
crítica), 61 a 67 (semilla, `.env`, CI, guía, errores) y 68 a 71 (web y E2E).

## Criterios de aceptación

### A. Rol de la aplicación en PostgreSQL

1. Dadas las migraciones aplicadas en la base de pruebas, cuando se consulta el catálogo, entonces existe el rol
   `aquagestion_app` con `LOGIN`, sin `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE` ni `REPLICATION`; no es
   miembro de ningún otro rol; no es dueño de ninguna tabla, vista, secuencia, tipo ni función del esquema `public`;
   no tiene `CREATE` sobre el esquema `public` ni sobre la base; y no tiene ningún privilegio sobre
   `_prisma_migrations`. _(crítico)_
2. Dado el rol `aquagestion_app`, entonces sus privilegios sobre tablas son exactamente estos, y ningún otro (ni
   `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER` sobre ninguna tabla):
   - `academias`: `SELECT`, `INSERT` y `UPDATE` solo de las columnas `estado`, `motivo_suspension`, `suspendida_en`
     y `actualizada_en`;
   - `superadmins`: `SELECT` y `UPDATE` solo de `intentos_fallidos`, `bloqueado_hasta`, `ultimo_acceso`,
     `version_token` y `actualizado_en`;
   - `auditoria` y `auditoria_plataforma`: `SELECT` e `INSERT`;
   - `configuraciones`: `SELECT`, `INSERT` y `UPDATE`.

   _(crítico)_
3. Dada la API de pruebas, cuando una operación corre dentro de `conAcademia` o de `comoPlataforma`, entonces
   `SELECT current_user` devuelve `aquagestion_app`: la API se conecta con `DATABASE_URL_APP` y nunca con
   `DATABASE_URL`. _(crítico)_
4. **Falla cerrada con un rol inseguro.** Dada la API con `DATABASE_URL_APP` apuntando a un rol superusuario, con
   `BYPASSRLS`, dueño de alguna tabla de `public` o miembro de otro rol (en pruebas: la URL de
   `DATABASE_URL_PRUEBAS`, que es la dueña de las tablas), cuando se llama a `conAcademia`, `comoPlataforma` o
   `resolverAcademia`, entonces rechazan con `ErrorRolBaseDatosInseguro` sin ejecutar el trabajo;
   `POST /api/plataforma/sesion` y `GET /api/a/{nombreCorto}` responden 500 `ERROR_INTERNO`; y el log registra, con
   nivel `error`, un mensaje que nombra `DATABASE_URL_APP` sin la URL ni la contraseña. La comprobación no se hace al
   arrancar: con la base caída la API sigue arrancando (spec 000, criterio 8) y `GET /api/salud` conserva su
   contrato. _(crítico)_
5. Dado el entorno de la API, cuando falta `DATABASE_URL_APP` o no es una URL `postgresql://` o `postgres://`, falta
   `JWT_SECRETO` o tiene menos de 32 caracteres, o `DATABASE_POOL_MAX` (opcional, por defecto 10) no es un entero
   entre 1 y 100, entonces la API no arranca y el mensaje nombra la variable sin mostrar su valor. Con
   `NODE_ENV=production`, además rechaza un `JWT_SECRETO` igual al de `.env.example`. La API ya no lee
   `DATABASE_URL` (la usan solo las migraciones, la semilla y los comandos). _(crítico; prueba unitaria de
   `validarEntorno`)_
6. Dado `DATABASE_URL_APP` con el usuario `aquagestion_app`, cuando se ejecuta `npm run db:crear` con un usuario de
   `DATABASE_URL` que puede crear roles (superusuario o `CREATEROLE`, como en Docker y en la CI), entonces:
   - si el rol no existe, lo crea con `LOGIN`, la contraseña de `DATABASE_URL_APP` y los atributos negativos del
     criterio 1, e informa "Rol creado: aquagestion_app";
   - si existe con atributos seguros, informa que ya existía y no cambia su contraseña;
   - si existe con `SUPERUSER` o `BYPASSRLS`, o falta y no hay permiso para crearlo, termina con código 1 y un
     mensaje que dice qué hacer, sin imprimir contraseñas;
   - si el usuario de `DATABASE_URL_APP` no es `aquagestion_app`, o es el mismo de `DATABASE_URL`, termina con
     código 1.

   Quién crea el rol en cada entorno (nube, Docker y CI): precisión P-11 del contrato.

   _(prueba obligatoria donde el usuario de la base pueda crear roles: CI y Docker; en la nube se omite con aviso)_
7. Dado un servidor sin el rol `aquagestion_app`, cuando se aplican las migraciones de esta historia, entonces fallan
   con un mensaje que indica ejecutar `npm run db:crear` (orientativo: "Falta el rol aquagestion_app: ejecuta npm run
   db:crear"). _(verificación del tester)_
8. Dada la nube (`CLAUDE_CODE_REMOTE=true`), cuando corre el hook de sesión, entonces en el paso del rol también
   crea `aquagestion_app` (si no existe) con `psql` como el usuario `postgres`, con los atributos del criterio 1 y la
   contraseña de `DATABASE_URL_APP`, antes de `db:crear`; nunca imprime la contraseña; si falta `DATABASE_URL_APP`,
   el paso falla y lo informa. Mantiene las reglas de la spec 000 (criterios 43 a 47). _(prueba unitaria de la
   función que arma la sentencia; verificación del tester en la nube)_

### B. Seguridad a nivel de fila (RLS)

En estos criterios, "como app" es una conexión con `aquagestion_app` en una transacción; "contexto de academia A"
es haber ejecutado `set_config('app.academia_id', '<id de A>', true)` en ella; "contexto de plataforma" es
`set_config('app.plataforma', 'si', true)`; "sin contexto" es no haber ejecutado ninguno de los dos. "Hay datos" significa que existen
filas de al menos dos academias, A y B, en `auditoria` y `configuraciones`, al menos un superadmin y al menos una
fila en `auditoria_plataforma`.

_Precisión (precisión tras las pruebas de la ronda 1, 11/11/2026):_ en las pruebas, "hay datos" lo prepara
`crearDatosDeAislamiento()` (utilidades de prueba) sobre una base limpia, y crea **exactamente** 2 academias (A y B),
1 superadmin, 2 filas de A en `auditoria` y 2 en `configuraciones`, 3 filas de B en `auditoria` y 4 en
`configuraciones`, y 2 filas en `auditoria_plataforma`. Los conteos de A y B son distintos a propósito, para que una
unión de las dos se note; las pruebas pueden comparar con esos conteos exactos (por ejemplo, `academias` en contexto
de plataforma devuelve 2 filas y `superadmins`, 1).

9. Dado el esquema `public`, entonces toda tabla salvo `_prisma_migrations` tiene la seguridad a nivel de fila
   activada **y forzada** (`relrowsecurity` y `relforcerowsecurity`). _(crítico)_
10. Dado el esquema `public`, entonces las únicas tablas sin columna `academia_id` son `academias`, `superadmins`,
    `auditoria_plataforma` y `_prisma_migrations`. Una tabla nueva sin `academia_id` hace fallar esta prueba hasta
    que una especificación la agregue a la lista. _(crítico)_
11. Dada cualquier tabla con `academia_id`, entonces la columna es `NOT NULL` y de tipo `uuid`, tiene una llave
    foránea a `academias(id)` sin borrado en cascada, y la tabla tiene políticas para cada comando que el rol
    `aquagestion_app` tiene concedido; toda política de esa tabla compara `academia_id` con `app_academia_actual()`
    y ninguna es `USING (true)` ni `WITH CHECK (true)`. _(crítico)_
12. Dada cualquier llave foránea de una tabla con `academia_id` hacia otra tabla con `academia_id`, entonces incluye
    `academia_id` en ambos lados; y toda tabla con `academia_id` y columna `id` tiene una restricción `UNIQUE` (o
    llave primaria) sobre `(academia_id, id)`. Así una fila de A no puede apuntar a una fila de B, porque las llaves
    foráneas no pasan por RLS. _(crítico)_
13. Dados datos, como app y sin contexto, entonces `SELECT` sobre cada tabla de `public` (salvo
    `_prisma_migrations`, sobre la que no tiene permiso) devuelve 0 filas; `INSERT` en `auditoria` y en
    `configuraciones` falla con SQLSTATE `42501`; y `UPDATE` afecta 0 filas. Lo mismo con `app.academia_id` vacío
    (`''`) y con `app.plataforma` vacío o con un valor distinto de `si`. _(crítico)_
14. Dados datos, como app con `app.academia_id` igual a un texto que no es un UUID (por ejemplo `abc`, `' OR 1=1`)
    o al UUID de una academia que no existe, entonces cada consulta termina en error o devuelve 0 filas, nunca filas
    de alguna academia. _(crítico)_
15. Dados datos, como app en contexto de A, entonces `auditoria` y `configuraciones` devuelven solo filas de A (el
    total coincide con las de A); `academias` devuelve solo la fila de A; `superadmins` y `auditoria_plataforma`
    devuelven 0 filas. _(crítico)_
16. Dados datos, como app en contexto de A, entonces:
    - `INSERT` en `auditoria` o `configuraciones` con `academia_id` de B falla con `42501`;
    - `UPDATE ... WHERE academia_id = '<B>'` en `configuraciones` afecta 0 filas;
    - un `UPDATE` que cambia el `academia_id` de una fila de A a B falla con `42501`;
    - `INSERT` en `academias` falla con `42501` y `UPDATE` de `academias` afecta 0 filas, incluida la de A.

    _(crítico)_
17. Dados datos, como app en contexto de plataforma, entonces `academias` devuelve todas las filas y admite `INSERT`
    y `UPDATE`; `superadmins` y `auditoria_plataforma` devuelven sus filas; `auditoria_plataforma` admite `INSERT`;
    `auditoria` y `configuraciones` devuelven 0 filas y su `INSERT` falla con `42501`. El Superadmin no ve datos
    internos (D-29). _(crítico)_
18. Dados datos, como app con contexto de plataforma y de A a la vez, entonces las tablas con `academia_id` siguen
    mostrando solo filas de A: la marca de plataforma no amplía el acceso a datos de academias. _(crítico)_
19. Dado cualquier contexto, como app, entonces `UPDATE`, `DELETE` y `TRUNCATE` sobre `auditoria` y
    `auditoria_plataforma`, y `DELETE` y `TRUNCATE` sobre `academias`, `superadmins` y `configuraciones`, fallan con
    `42501`. _(crítico)_
20. Dada la función `resolver_academia(p_nombre_corto text)`, como app y sin contexto, entonces devuelve una fila
    `(id, nombre, nombre_corto, estado)` cuando `p_nombre_corto` es exactamente el nombre corto de una academia
    (activa o suspendida), y 0 filas en cualquier otro caso: inexistente, `'%'`, `'_'`, `''`, `NULL`, con mayúsculas
    o con espacios. Después de llamarla, en la misma transacción, `current_setting('app.plataforma', true)` no es
    `si` y `SELECT` sobre `academias` sigue devolviendo 0 filas. _(crítico)_

### C. Acceso a datos desde la API (`BaseDatos`)

21. Dada una academia activa A, cuando se llama a `baseDatos.conAcademia(A.id, trabajo)`, entonces `trabajo` corre
    dentro de una transacción en la que `current_setting('app.academia_id', true)` es el id de A y `app.plataforma`
    no es `si`; recibe `tx.academiaId` igual a ese id; y el resultado de `trabajo` se devuelve tras confirmar la
    transacción. _(crítico)_
22. Dado que `trabajo` lanza un error, entonces la transacción se revierte por completo (las filas que insertó en
    `auditoria` o `configuraciones` no quedan) y `conAcademia` rechaza con ese mismo error. Lo mismo en
    `comoPlataforma`. _(crítico)_
23. Dada la API con `DATABASE_POOL_MAX=1`, cuando termina `conAcademia(A, …)`, bien o con error, entonces un
    `comoPlataforma` posterior lee `current_setting('app.academia_id', true)` vacío o nulo; y cuando termina
    `comoPlataforma`, un `conAcademia(B, …)` posterior lee `app.plataforma` distinto de `si`. Ninguna conexión del
    pool conserva el contexto de una transacción anterior. _(crítico)_
24. Dadas 50 llamadas simultáneas a `conAcademia`, la mitad con A y la mitad con B, cada una leyendo `auditoria` y
    `current_setting('app.academia_id', true)`, entonces cada llamada ve solo filas de su academia y su propio id.
    _(crítico)_
25. Cuando se llama a `conAcademia` con un id que no es un UUID o con el de una academia que no existe, entonces
    rechaza con `ErrorAcademiaNoEncontrada`; con el de una academia suspendida, rechaza con
    `ErrorAcademiaSuspendida`. En ambos casos no ejecuta `trabajo`. Si esos errores llegan al filtro de la API, se
    responden como 404 `ACADEMIA_NO_ENCONTRADA` y 403 `ACADEMIA_SUSPENDIDA`. _(crítico)_
26. Cuando se llama a `baseDatos.comoPlataforma(trabajo)`, entonces `trabajo` corre en una transacción con
    `app.plataforma` igual a `si` y sin `app.academia_id` (vacío o nulo). _(crítico)_
27. Dadas las opciones `{ aislamiento: 'Serializable' }` (o `'RepeatableRead'`, `'ReadCommitted'`), entonces la
    transacción de `conAcademia` y de `comoPlataforma` corre con ese nivel (`SHOW transaction_isolation`). Lo usarán
    el aforo y la caja. _(prueba obligatoria)_
28. Dado el código del backend, entonces los módulos solo llegan a la base a través de `BaseDatos`: `BaseDatos` no
    expone el cliente de Prisma ni sus modelos fuera de `conAcademia`, `comoPlataforma`, `resolverAcademia` y
    `comprobarConexion`; y `npm run lint` falla si un archivo de `backend/src/` fuera de
    `backend/src/infraestructura/prisma/` y de `backend/src/cli/` importa un valor (no un tipo) de
    `generated/prisma` o importa `PrismaService`. _(crítico; prueba de la regla de lint y verificación del revisor)_

### D. Auditoría

29. Dada una transacción de `conAcademia(A, …)`, cuando se llama a `auditoria.registrarEnAcademia(tx, entrada)`,
    entonces se inserta en `auditoria` una fila con `academia_id` igual a `tx.academiaId`, `fecha_hora` igual a
    `RELOJ.ahora()` y los campos de la entrada (`actorTipo`, `actorId`, `accion`, `entidad`, `entidadId`,
    `datosAntes`, `datosDespues`, `motivo`, `ip`). La entrada no tiene campo de academia: no se puede auditar en otra.
    _(crítico)_
30. Dada una operación que audita, cuando la transacción se revierte, entonces su registro de auditoría tampoco
    queda; y cuando la inserción de auditoría falla, la operación completa falla. Prueba: con un disparador temporal
    en `auditoria_plataforma` que lanza un error, `POST /api/plataforma/academias` responde 500 y la academia no
    existe. _(crítico)_
31. Dada una transacción de `comoPlataforma`, cuando se llama a `auditoria.registrarEnPlataforma(tx, entrada)`,
    entonces se inserta en `auditoria_plataforma` con `fecha_hora` igual a `RELOJ.ahora()`. _(crítico)_
32. Dadas las operaciones de esta historia, entonces quedan en `auditoria_plataforma`, con `entidad` y `entidad_id`
    (el id):
    - `ACADEMIA_CREADA`: actor `SUPERADMIN` y su id; `datos_despues` con `id`, `nombre`, `nombreCorto` y `estado`;
      `ip` de la petición;
    - `ACADEMIA_SUSPENDIDA`: `datos_antes` `{ "estado": "ACTIVA" }`, `datos_despues` `{ "estado": "SUSPENDIDA" }`,
      `motivo`, actor e `ip`;
    - `ACADEMIA_REACTIVADA`: lo inverso, con `motivo` si se indicó;
    - `SUPERADMIN_CREADO` y `SUPERADMIN_CLAVE_RESTABLECIDA`: actor `SISTEMA`, sin `ip`; `datos_despues` con `id`,
      `correo` y `nombre`.

    Ningún registro de auditoría contiene la contraseña ni su hash. _(crítico)_

### E. Superadmin: alta por comando y sesión

33. Dadas `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE`, `SUPERADMIN_CLAVE` y `DATABASE_URL` (del entorno o del `.env`;
    las del entorno mandan), cuando se ejecuta `npm run plataforma:superadmin` y no existe un superadmin con ese
    correo (sin espacios en los extremos y en minúsculas), entonces lo crea con `clave_hash` argon2id (empieza por
    `$argon2id$`), `version_token` 0 e `intentos_fallidos` 0; registra `SUPERADMIN_CREADO`; imprime
    "Superadmin creado: <correo>" y termina con código 0. _(crítico)_
34. Dado que ya existe un superadmin con ese correo, cuando se ejecuta el comando, entonces reemplaza el hash y el
    nombre, pone `intentos_fallidos` en 0 y `bloqueado_hasta` en nulo, incrementa `version_token` (las sesiones
    abiertas dejan de valer), registra `SUPERADMIN_CLAVE_RESTABLECIDA`, imprime "Contraseña del superadmin
    restablecida: <correo>" y termina con código 0. _(crítico)_
35. Dado un correo inválido o de más de 254 caracteres, un nombre fuera de 3 a 100 caracteres, una clave de menos de
    12 o más de 128 caracteres, o una variable faltante, cuando se ejecuta el comando, entonces termina con código 1,
    nombra la variable y no crea ni modifica nada. En ningún caso, incluido un error de conexión, la salida estándar
    o de errores contiene la clave. _(crítico)_
36. Dado un superadmin, cuando se envía `POST /api/plataforma/sesion` con `{ correo, clave }` correctos, entonces
    responde 200 con `RespuestaSesionPlataforma` (`{ superadmin: { id, correo, nombre } }`, sin token ni hash) y la
    cabecera `Set-Cookie: aq_plataforma=<token>; HttpOnly; SameSite=Strict; Path=/api/plataforma; Max-Age=28800`,
    con `Secure` cuando `NODE_ENV=production`. Pone `intentos_fallidos` en 0 y `ultimo_acceso` en `RELOJ.ahora()`. El
    correo se acepta con espacios en los extremos y con mayúsculas. _(crítico)_
37. Dada una sesión iniciada, entonces el token es un JWT HS256 firmado con `JWT_SECRETO`, con `sub` (id del
    superadmin), `tipo: "plataforma"`, `ver` (su `version_token`), `iat` y `exp = iat + 28800`, tomados de `RELOJ`.
    _(crítico)_
38. Dada una clave equivocada o un correo que no existe, cuando se intenta iniciar sesión, entonces responde 401
    `CREDENCIALES_INVALIDAS` con el mismo cuerpo en ambos casos y sin `Set-Cookie`. _(crítico)_
39. **Bloqueo.** Dado un superadmin, cuando acumula intentos fallidos consecutivos, entonces los 4 primeros responden
    401 `CREDENCIALES_INVALIDAS` y el 5.º responde 423 `CUENTA_BLOQUEADA` y fija `bloqueado_hasta = ahora + 15 min`.
    Mientras dure el bloqueo, todo intento, incluso con la clave correcta, responde 423 sin emitir cookie ni cambiar
    el contador. Cumplidos los 15 minutos (con `RelojFijo`), la clave correcta entra (200) y deja el contador en 0;
    una clave equivocada vuelve a contar desde 1. Un ingreso correcto antes del 5.º fallo pone el contador en 0.
    _(crítico)_
40. Dados 10 intentos fallidos simultáneos contra el mismo superadmin, entonces cada respuesta es 401 o 423, al
    menos una es 423, la cuenta queda bloqueada y un intento inmediato con la clave correcta responde 423: el
    contador no pierde incrementos. _(crítico)_
41. Dadas más de 10 peticiones `POST /api/plataforma/sesion` en 60 segundos desde la misma IP, entonces de la 11.ª en
    adelante responde 429 `DEMASIADAS_SOLICITUDES`, aunque la clave sea correcta, sin contar como intento fallido.
    _(crítico)_
42. Dado un cuerpo que no es JSON, con campos de más, un correo de más de 254 caracteres o una clave vacía o de más
    de 128 caracteres, cuando se intenta iniciar sesión, entonces responde 400 `SOLICITUD_INVALIDA` sin calcular
    ningún hash ni contar un intento. _(crítico)_
43. Dada una cookie `aq_plataforma` válida, `GET /api/plataforma/sesion` responde 200 con `{ superadmin }`. Responde
    401 `NO_AUTENTICADO` sin cookie, o con un token: de firma alterada; firmado con otro secreto; con `alg: none`;
    vencido según `RELOJ`; con `tipo` distinto de `plataforma`; con `ver` distinto del `version_token` actual; o con
    `sub` de un superadmin que no existe. También responde 401 si el token llega en `Authorization: Bearer` en lugar
    de la cookie. _(crítico)_
44. Dada una sesión válida, cuando se envía `DELETE /api/plataforma/sesion`, entonces responde 204, borra la cookie
    (`aq_plataforma=` con `Max-Age=0` y el mismo `Path`) e incrementa `version_token`: la cookie anterior ya no sirve
    (401). Sin sesión válida también responde 204 y borra la cookie, sin cambiar nada más. _(crítico)_
45. Dada cualquier ruta bajo `/api/plataforma/` distinta de `POST` y `DELETE /api/plataforma/sesion`, cuando se pide
    sin una sesión válida, entonces responde 401 `NO_AUTENTICADO` y no ejecuta nada. _(crítico)_
46. Dados intentos de inicio de sesión correctos y fallidos y ejecuciones del comando del criterio 33, entonces la
    clave no aparece en ningún registro del log, en ningún nivel. _(crítico)_
47. Dada una conexión como app, cuando ejecuta `SET ROLE` hacia el dueño de las tablas (el usuario de
    `DATABASE_URL_PRUEBAS`) o hacia `postgres`, o `SET SESSION AUTHORIZATION`, entonces falla por falta de permisos:
    el rol de la app no puede tomar los privilegios de otro (criterio 1). _(crítico)_

### F. Academias desde la plataforma

48. Dada una sesión de superadmin, cuando envía `POST /api/plataforma/academias` con `{ nombre, nombreCorto }`
    válidos, entonces responde 201 con `RespuestaAcademia` (`{ academia: AcademiaResumen }`), con estado `ACTIVA`,
    `creadaEn` igual a `RELOJ.ahora()`, `suspendidaEn` y `motivoSuspension` nulos; la fila existe en `academias`; se
    registra `ACADEMIA_CREADA` (criterio 32); y no se crea ninguna fila en tablas con `academia_id`. _(crítico)_
49. Dado un `nombreCorto`, entonces se le quitan los espacios de los extremos y se pasa a minúsculas, y después debe
    tener de 3 a 30 caracteres, cumplir `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` y no ser una palabra reservada (lista en
    "Contrato"); el `nombre` se recorta, debe tener de 3 a 100 caracteres y no contener caracteres de control. Si no
    cumple, responde 400 `SOLICITUD_INVALIDA` con `detalles.errores` que nombra el campo. _(prueba obligatoria:
    unitaria del esquema e integración de un caso)_
50. Dado un nombre corto que ya existe (también escrito `Delfines` o ` delfines `), entonces responde 409
    `NOMBRE_CORTO_EN_USO`, sin crear ni auditar nada. Dadas dos creaciones simultáneas con el mismo nombre corto,
    exactamente una responde 201 y la otra 409, y quedan una fila y un registro de auditoría. La base tiene una
    restricción única sobre `nombre_corto`. _(crítico)_
51. Dada una sesión de superadmin, `GET /api/plataforma/academias` responde 200 con `{ academias: AcademiaResumen[] }`
    con todas las academias, activas y suspendidas, ordenadas por `nombreCorto`; cada elemento cumple el esquema
    estricto, sin campos de más: nada de usuarios, alumnos, pagos, caja, configuración ni auditoría. _(crítico)_
52. Dada una academia activa, cuando se envía `POST /api/plataforma/academias/{id}/suspender` con `{ motivo }` (3 a
    500 caracteres tras recortar), entonces responde 200 con la academia en estado `SUSPENDIDA`, `suspendidaEn` igual
    a `RELOJ.ahora()` y `motivoSuspension` igual al motivo, y registra `ACADEMIA_SUSPENDIDA`. Sin motivo válido
    responde 400 `SOLICITUD_INVALIDA`. _(crítico)_
53. Dada una academia suspendida, cuando se envía `POST /api/plataforma/academias/{id}/reactivar` con `{}` o con
    `{ motivo }`, entonces responde 200 con estado `ACTIVA`, `suspendidaEn` y `motivoSuspension` nulos, y registra
    `ACADEMIA_REACTIVADA`. _(crítico)_
54. Suspender una academia ya suspendida responde 409 `ACADEMIA_YA_SUSPENDIDA`; reactivar una activa responde 409
    `ACADEMIA_YA_ACTIVA`; en ambos casos sin cambios ni auditoría. Dadas dos suspensiones simultáneas de la misma
    academia, una responde 200 y la otra 409, y queda un solo registro. _(crítico)_
55. Dado un `{id}` que no es un UUID o que no existe, `suspender` y `reactivar` responden 404 `NO_ENCONTRADO`.
    _(crítico)_
56. Dada una academia suspendida con filas en `auditoria` y `configuraciones`, entonces `conAcademia` la rechaza
    (criterio 25) y `GET /api/a/{nombreCorto}` responde 403 (criterio 60); sus filas siguen en la base (comprobado
    como dueño). Al reactivarla, `conAcademia` y la ruta pública vuelven a funcionar. _(crítico)_
57. No existe forma de borrar una academia: `DELETE /api/plataforma/academias/{id}` responde 404 `NO_ENCONTRADO` y el
    rol de la app no tiene `DELETE` (criterio 19). _(crítico)_

### G. Academia por su nombre corto (páginas públicas)

58. Dada una academia activa, `GET /api/a/{nombreCorto}`, sin sesión, responde 200 con `AcademiaPublica`
    (`{ nombreCorto, nombre }`, esquema estricto: sin id, estado ni motivo) y `Cache-Control: no-store`. El nombre
    corto de la dirección se recorta y se pasa a minúsculas antes de buscarlo (`/api/a/Delfines` encuentra
    `delfines`). _(crítico)_
59. Dado un nombre corto que no existe o con formato inválido (por ejemplo `..`, `%25`, `a`, 31 caracteres, `dеlfines`
    con una "е" cirílica, `delfines%00`), entonces responde 404 `ACADEMIA_NO_ENCONTRADA`, con el mismo cuerpo en todos
    los casos. _(crítico)_
60. Dada una academia suspendida, `GET /api/a/{nombreCorto}` responde 403 `ACADEMIA_SUSPENDIDA` (decisión del
    responsable DR-4). _(crítico)_

### H. Semilla, configuración local, errores y documentación

61. Dado `NODE_ENV` distinto de `production`, cuando se ejecuta `npm run db:semilla`, entonces crea, si no existen,
    las academias activas `delfines` ("Academia de Natación Los Delfines") y `tiburones` ("Club de Natación
    Tiburones"), sin modificar las que ya existen; y, si están definidas `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y
    `SUPERADMIN_CLAVE`, crea ese superadmin si no existe (no restablece su clave). Imprime un resumen sin la clave.
    Repetirla no falla ni duplica. Con `NODE_ENV=production` termina con código 1 sin escribir nada. _(prueba
    obligatoria)_
62. Dado `.env.example`, entonces agrega, con comentarios en español y valores de desarrollo inventados:
    `DATABASE_URL_APP=postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion`, `JWT_SECRETO` (de al
    menos 32 caracteres, marcado como "solo desarrollo"), `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE`,
    `SUPERADMIN_CLAVE` y, comentada, `DATABASE_POOL_MAX`. Con `.env` copiado sin cambios, `npm run db:preparar` y
    `npm run dev` funcionan en Docker y en la nube. _(verificación del revisor)_
63. Dado un `.env` creado antes de esta historia, cuando se ejecuta `npm run env:completar`, entonces agrega al final
    las variables de `.env.example` que falten, con su comentario, sin modificar ni reordenar las existentes, e
    informa los nombres agregados; si no hay `.env`, lo crea copiando `.env.example`; si no falta nada, lo dice.
    Funciona en Windows. _(prueba obligatoria)_
64. Dada la CI, entonces el trabajo de Linux define `DATABASE_URL_APP` y `JWT_SECRETO` (valores de desarrollo
    inventados) y `db:preparar` crea el rol con el superusuario del servicio; la suite completa queda en verde.
    _(verificación del revisor)_
65. Dadas las pruebas de la spec 000 que suponían una base sin tablas y una semilla vacía (`scripts/test/integracion/
    migraciones.test.mjs`) y las que usan `DATABASE_URL` en la API (`crearAppDePruebas`, salud), entonces se
    actualizan a lo que define esta historia, sin debilitar lo que comprueban. _(verificación del revisor)_
66. Dado el filtro de errores, entonces una excepción de negocio con estado, código y mensaje propios
    (`ErrorNegocio`) se responde con ese `ErrorApi`; un error de validación con zod responde 400 `SOLICITUD_INVALIDA`
    con `detalles: { errores: [{ campo, mensaje }] }` (`campo` con puntos para rutas anidadas, `""` para el cuerpo
    entero), según `detallesValidacionSchema`. Los errores 5xx siguen sin detalles. _(prueba obligatoria, unitaria)_
67. Dada `docs/guia-local-windows.md`, entonces explica: después de traer esta historia, `npm run env:completar` y
    `npm run db:preparar` (crea el rol `aquagestion_app`); cómo entrar a `http://localhost:5173/plataforma/ingresar`
    con el superadmin de desarrollo; cómo crear o restablecer un superadmin con `npm run plataforma:superadmin`; y
    los problemas "Falta el rol aquagestion_app", "rol inseguro" y "falta la variable DATABASE_URL_APP".
    _(verificación manual del responsable)_

### I. Web de la plataforma

68. Dada `/plataforma/ingresar`, entonces muestra un formulario de correo y contraseña; con éxito lleva a
    `/plataforma/academias`; muestra "Correo o contraseña incorrectos." (401), "La cuenta está bloqueada por varios
    intentos fallidos. Intenta de nuevo en 15 minutos." (423) y "Hiciste demasiados intentos. Espera un minuto." (429)
    (textos orientativos). No guarda nada de la sesión en `localStorage` ni en `sessionStorage`. _(prueba
    obligatoria)_
69. Dada `/plataforma/academias`, entonces sin sesión (401) lleva a `/plataforma/ingresar`; con sesión muestra la
    lista (nombre, nombre corto, estado y fecha de creación en America/Lima, `dd/MM/yyyy`); "Nueva academia" abre un
    formulario validado con `crearAcademiaSchema` que muestra el error 409 junto al nombre corto; "Suspender" pide el
    motivo y confirmación; "Reactivar" pide confirmación; "Cerrar sesión" vuelve al ingreso. Se ve completa a 360 px.
    _(prueba obligatoria de los estados principales)_
70. Dada la página `/`, entonces no enlaza a la plataforma; `/plataforma` lleva a `/plataforma/academias`.
    _(prueba obligatoria)_
71. Dado `npm run e2e`, entonces una prueba de Playwright crea un superadmin, inicia sesión en
    `/plataforma/ingresar`, crea una academia, la suspende, la reactiva y cierra sesión. _(CI en Linux)_

### J. Correcciones del ataque adversarial, ronda 1

Criterios agregados tras la ronda 1 del ataque (11/11/2026). Son decisiones técnicas de seguridad y validación, no
reglas de negocio nuevas, y no cambian el sentido de los criterios 1 a 71.

72. **Contexto completo en cada transacción, aunque la conexión venga contaminada** _(ataque ronda 1, F1)_. Dada la
    API con `DATABASE_POOL_MAX=1` y datos en A y B, cuando la conexión del pool trae valores **de sesión** de
    `app.plataforma` y `app.academia_id` (por ejemplo, `si` y el id de A), entonces:
    - dentro de `conAcademia(B, …)`, `current_setting('app.academia_id', true)` es el id de B y
      `current_setting('app.plataforma', true)` es `''`; `academias` devuelve solo la fila de B; `auditoria` y
      `configuraciones`, solo filas de B; `superadmins` y `auditoria_plataforma`, 0 filas;
    - dentro de `comoPlataforma`, `app.academia_id` es `''` y `app.plataforma` es `si`; `auditoria` y
      `configuraciones` devuelven 0 filas y su `INSERT` falla con `42501`;
    - en la transacción de `resolverAcademia`, los dos valores son `''` antes de llamar a `resolver_academia`, y el
      resultado es el mismo que con una conexión limpia (criterio 20).

    Se comprueba de dos formas, ambas obligatorias: (a) un `trabajo` anterior, en la misma conexión, ejecuta
    `set_config('app.plataforma', 'si', false)` y `set_config('app.academia_id', '<id de A>', false)` y confirma; (b)
    `DATABASE_URL_APP` lleva `?options=-c app.plataforma=si -c app.academia_id=<id de A>` (codificado en la URL). Si
    el dueño de la base de pruebas puede ejecutar `ALTER DATABASE … SET app.plataforma = 'si'`, se comprueba también
    con ese valor por defecto y se restaura al final; si no puede, esa variante se omite con aviso. El criterio 23
    sigue valiendo tal cual. _(crítico)_

    _Precisión (precisión tras las pruebas de la ronda 1, 11/11/2026):_ la variante con valores por defecto de la base
    (c) fija **ambos** valores, `ALTER DATABASE … SET app.plataforma = 'si'` y `ALTER DATABASE … SET app.academia_id =
    '<id de A>'`, como las formas (a) y (b), y restaura los dos al final (`RESET`).
73. **Regla de lint contra el contexto de sesión** _(ataque ronda 1, F1)_. Dado el código de `backend/src/` (sin
    contar las pruebas: `*.test.ts` y `backend/test/`), entonces `npm run lint` falla si un texto SQL (cadena,
    plantilla o plantilla etiquetada como `` $queryRaw`…` `` o `` Prisma.sql`…` ``; en las plantillas se analiza el
    texto con un marcador en lugar de cada `${…}`), sin distinguir mayúsculas, contiene:
    - fuera de `backend/src/infraestructura/prisma/`: `set_config(` con `false` como último argumento; `SET app.`,
      `SET LOCAL app.` o `SET SESSION`; `SET ROLE`; o `RESET` (de `app.…`, `ROLE` o `ALL`);
    - además, fuera de `backend/src/infraestructura/prisma/` y de `backend/src/cli/`: cualquier `set_config('app.`
      (solo `BaseDatos` fija el contexto de la API; el comando del superadmin fija el suyo con `true`).

    La prueba de la regla usa la clase `ESLint` con el `eslint.config.mjs` real, como la del criterio 28
    (`eslint/regla-prisma.test.mjs`), con un ejemplo que falla y otro que pasa por cada caso. _(crítico; prueba de la
    regla de lint)_

    _Precisiones (precisión tras las pruebas de la ronda 1, 11/11/2026):_
    - la regla tolera espacios (incluidos saltos de línea) y mayúsculas en la forma de la llamada y de las sentencias:
      `set_config( 'app.academia_id' , $1 , FALSE )` o `SET  LOCAL  App.plataforma` cuentan igual que su forma
      compacta en minúsculas;
    - el texto dentro de comentarios SQL (`-- …` hasta el fin de la línea y `/* … */`) no cuenta: un texto SQL cuyo
      único `set_config(…, false)` o `SET ROLE` está comentado pasa la regla; los comentarios de JavaScript tampoco se
      analizan;
    - corrige la discrepancia anterior: decía la clase `Linter`, pero la prueba del criterio 28 usa `ESLint` con la
      configuración real, que es lo que vale para ambas.
74. **Solo cuerpos JSON** _(ataque ronda 1, F2)_. Dada cualquier ruta de `/api` con método `POST`, `PUT`, `PATCH` o
    `DELETE`, cuando la petición trae cuerpo (`Content-Length` mayor que 0 o `Transfer-Encoding`) y su `Content-Type`
    no es `application/json` (el tipo sin distinguir mayúsculas, con `charset=utf-8` opcional), por ejemplo
    `application/x-www-form-urlencoded`, `text/plain`, `multipart/form-data`, `application/json; charset=latin1`,
    `application/vnd.api+json` o ninguno, entonces responde **400 `SOLICITUD_INVALIDA`** con
    `detalles: { errores: [{ campo: "", mensaje }] }` y `Cache-Control: no-store` (P-8), sin interpretar el cuerpo.
    En particular:
    - `POST /api/plataforma/sesion` con un formulario y la clave correcta no emite cookie, no calcula ningún hash y
      no cambia `intentos_fallidos`, `bloqueado_hasta` ni `ultimo_acceso` (sí cuenta para el límite por IP, criterio
      75);
    - `POST /api/plataforma/academias`, `…/suspender` y `…/reactivar` no crean, no cambian ni auditan nada;
    - `DELETE /api/plataforma/sesion` con un cuerpo que no es JSON responde 400 sin cambiar `version_token`; sin
      cuerpo sigue el criterio 44.

    En las rutas de `/api/plataforma` que exigen sesión, una petición sin sesión válida sigue respondiendo 401
    `NO_AUTENTICADO` antes de mirar el cuerpo (P-7). Se elige 400 y no 415 para conservar el código del criterio 42 y
    un solo formato para los errores de entrada. _(crítico)_

    _Precisión (precisión tras las pruebas de la ronda 1, 11/11/2026):_ el tipo `application/json` se reconoce sin
    distinguir mayúsculas (`Application/JSON`), con o sin espacios antes y después del `;`
    (`application/json;charset=utf-8`, `application/json ; charset=utf-8`). El parámetro `charset` es opcional y, si
    está, solo puede ser `utf-8`, también sin distinguir mayúsculas (`charset=UTF-8`); cualquier otro `charset`
    (`latin1`, `utf8`, `utf-16`) o cualquier otro tipo es 400 como arriba.
75. **Toda petición de inicio de sesión cuenta para el límite** _(ataque ronda 1, F3)_. Dadas peticiones
    `POST /api/plataforma/sesion` desde la misma IP en 60 segundos, entonces todas cuentan para el límite del
    criterio 41 sea cual sea su resultado: JSON mal formado (400), cuerpo demasiado grande (413 `CARGA_EXCESIVA`),
    tipo no JSON (400, criterio 74), esquema inválido (400), 401 o 423. También cuentan, y comparten el contador, las
    variantes de la ruta que Express atiende con el mismo controlador (`/api/plataforma/sesion/`,
    `/api/Plataforma/SESION`). La 11.ª y las siguientes reciben 429 `DEMASIADAS_SOLICITUDES` sin leer el cuerpo, aunque
    sean válidas y con la clave correcta, sin contar como intento fallido ni emitir cookie. Prueba: 12 peticiones con
    JSON mal formado (las 10 primeras 400, la 11.ª y la 12.ª 429) y después una válida con la clave correcta: 429.
    Lo mismo mezclando 413, formularios y variantes de la ruta. _(crítico)_

    _Precisiones (precisión tras las pruebas de la ronda 1, 11/11/2026):_
    - el límite de tamaño del cuerpo JSON es de **100 KB** (102 400 bytes, el valor por defecto actual del lector JSON
      de Express); un cuerpo mayor responde 413 `CARGA_EXCESIVA` con el formato de error común, sin interpretarlo;
    - comparten el mismo contador `/api/plataforma/sesion` con barra final (`/api/plataforma/sesion/`), con mayúsculas
      (`/api/Plataforma/SESION`) y con cadena de consulta (`/api/plataforma/sesion?x=1`), y sus combinaciones.
76. **Caracteres de control en las entradas** _(ataque ronda 1, O1)_. Dado cualquier texto de una entrada de la API
    (en esta historia: `correo`, `clave`, `nombre`, `nombreCorto` y `motivo`), cuando contiene, después del recorte que
    ya hace su campo, el carácter nulo `\u0000` u otro carácter de control (`\p{Cc}`: U+0000 a U+001F y U+007F a
    U+009F, incluidos el tabulador y los saltos de línea en medio del texto), entonces responde 400
    `SOLICITUD_INVALIDA` con `detalles.errores` que nombra el campo; nunca 500; sin escribir en la base, calcular un
    hash ni contar un intento. `clave` no se recorta: un control en cualquier posición es 400. El comando del
    criterio 33 aplica la misma regla a `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y `SUPERADMIN_CLAVE` (código 1,
    nombra la variable y no cambia nada, criterio 35). La regla vive en los esquemas compartidos de texto de
    `packages/contratos/`, para que la reutilicen las historias siguientes. _(crítico)_
77. **Textos visibles y sin control bidireccional** _(ataque ronda 1, O2)_. Dados el `nombre` de una academia
    (crear), el `motivo` (suspender y reactivar) y `SUPERADMIN_NOMBRE` (comando), entonces, además de sus reglas de
    longitud (criterios 35, 49 y 52):
    - se rechazan si contienen caracteres de control bidireccional (`\p{Bidi_Control}`: U+061C, U+200E, U+200F,
      U+202A a U+202E y U+2066 a U+2069) o separadores de línea o de párrafo (U+2028, U+2029);
    - deben tener al menos 3 caracteres visibles: letras, números, signos de puntuación o símbolos (`\p{L}`, `\p{N}`,
      `\p{P}`, `\p{S}`). Los espacios (`\p{Zs}`), los caracteres de formato (`\p{Cf}`, como U+200B o U+FEFF) y las
      marcas combinantes (`\p{M}`) no cuentan.

    Además, cualquier texto de entrada de la API (los campos del criterio 76) que contenga un sustituto UTF-16 suelto
    (U+D800 a U+DFFF sin su pareja; `isWellFormed()` falso) se rechaza. Si no se cumple: 400 `SOLICITUD_INVALIDA` con
    `detalles.errores` que nombra el campo, sin crear, cambiar ni auditar nada (en el comando, código 1). Se rechazan,
    por ejemplo, `"​​​​"`, `"a​b"` (2 visibles), `"Delfines‮"`, `"⁦Delfines⁩"`
    y `"Del\uD800fines"`; se aceptan `"Academia Ñandú"` y `"Club 3"`. El valor se guarda tal como llega, después del
    recorte. _(crítico)_

    _Precisión de los criterios 76 y 77 (precisión tras las pruebas de la ronda 1, 11/11/2026):_ "el recorte" de
    `nombre`, `motivo` y `correo` (y de `SUPERADMIN_NOMBRE` y `SUPERADMIN_CORREO` en el comando) es exactamente
    `String.prototype.trim()` de JavaScript, aplicado **antes** de validar longitud, controles y caracteres visibles.
    Por eso un tabulador o un salto de línea en los extremos se quita y no es error, pero U+0085 (NEL), que `trim()` no
    quita, sigue en el texto y se rechaza como carácter de control (`\p{Cc}`) aunque esté en un extremo. `clave` no se
    recorta (criterio 76).
78. **`NODE_ENV` de una lista cerrada** _(ataque ronda 1, O4)_. Dado `NODE_ENV`, entonces, si no está definida, la API
    y la semilla se comportan fuera de producción, como hoy; si está definida (aunque sea vacía), debe ser exactamente
    `development`, `test` o `production`, sin recorte ni cambio de mayúsculas. Con cualquier otro valor (`Production`,
    `PRODUCTION`, `" production"`, `"production "`, `prod`, `""`):
    - la API no arranca: `validarEntorno` lanza `ErrorEntorno` con un mensaje que nombra `NODE_ENV` y los valores
      permitidos, sin mostrar el valor recibido;
    - `npm run db:semilla` termina con código 1 sin escribir nada, con un mensaje equivalente.

    El campo `NODE_ENV` de `Entorno` pasa a ser `'development' | 'test' | 'production' | undefined`. La cookie lleva
    `Secure` (criterio 36) y rigen las reglas de producción (criterios 5 y 79) solo con `production`. _(crítico;
    prueba unitaria de `validarEntorno` e integración de la semilla)_
79. **Secreto de firma robusto en producción** _(ataque ronda 1, O4)_. Dado `NODE_ENV=production`, entonces la API no
    arranca, con un mensaje que nombra `JWT_SECRETO` sin mostrar su valor, si `JWT_SECRETO`:
    - es uno de los secretos públicos del repositorio: el de `.env.example`, `JWT_SECRETO_PRUEBAS` de
      `backend/test/utilidades/aplicacion.ts` o el de respaldo de `e2e/playwright.config.ts`;
    - contiene algún espacio en blanco (`\s`) en cualquier posición;
    - tiene menos de 32 caracteres; o
    - tiene menos de 10 caracteres distintos.

    Los caracteres se cuentan por punto de código. Un secreto de 32 o más caracteres, sin espacios, con 10 o más
    distintos y fuera de la lista se acepta (por ejemplo, 43 caracteres base64url aleatorios). Fuera de producción
    rige solo el criterio 5. La lista de secretos públicos es una constante del backend; una prueba unitaria comprueba
    que contiene los valores actuales de esos tres archivos. _(crítico; prueba unitaria de `validarEntorno`)_

    _Precisión (precisión tras las pruebas de la ronda 1, 11/11/2026):_ esa comprobación es **por efecto**, no por el
    nombre ni la forma de la constante: la prueba lee el secreto de cada uno de los tres archivos donde aparece
    (`JWT_SECRETO` de `.env.example`, `JWT_SECRETO_PRUEBAS` de `backend/test/utilidades/aplicacion.ts` y el de respaldo
    de `e2e/playwright.config.ts`) y comprueba que `validarEntorno`, con `NODE_ENV=production` y ese valor como
    `JWT_SECRETO` (y el resto del entorno válido), lanza `ErrorEntorno`. Así, si alguno de esos archivos cambia su
    secreto sin actualizar la lista, la prueba falla.

## Casos límite

- **Owner que no es superusuario (nube) frente a superusuario (Docker y CI):** en la nube, el dueño de las tablas
  queda sujeto a RLS por el `FORCE`; en Docker y en la CI, el dueño es superusuario y se salta RLS siempre. Por eso
  la API usa un rol aparte (criterios 1 y 3), y los comandos y la semilla, que usan el dueño, fijan el contexto de
  plataforma igual que la API.
- **Volumen de Docker creado con la 000:** no se usan scripts de inicio del contenedor (solo corren con un volumen
  vacío); el rol lo crea `db:crear` (criterio 6).
- **`.env` antiguo sin `DATABASE_URL_APP` ni `JWT_SECRETO`:** la API no arranca y nombra la variable (criterio 5);
  `npm run env:completar` las agrega (criterio 63). El hook de la nube no toca un `.env` existente (spec 000).
- **`current_setting` después de un `set_config` local:** fuera de esa transacción devuelve `''`, no `NULL`;
  `app_academia_actual()` lo trata como "sin academia" (criterio 13).
- **Conexiones reutilizadas del pool:** el contexto es local a la transacción; nunca se usa `SET` de sesión
  (criterio 23). Si aun así una conexión llega con valores de sesión (un error de un módulo, `options` en la URL o
  valores por defecto del rol o de la base), cada transacción fija los dos valores, el suyo y el vacío del otro
  (criterio 72), y el lint impide escribir SQL de sesión (criterio 73) _(ataque ronda 1)_.
- **Formularios y otros tipos de cuerpo:** solo se interpreta JSON; el resto es 400 y, en el inicio de sesión, cuenta
  para el límite por IP (criterios 74 y 75) _(ataque ronda 1)_.
- **Textos con caracteres invisibles, de control o bidireccionales:** 400 (criterios 76 y 77). Los caracteres de
  formato dentro de un texto con al menos 3 visibles (por ejemplo, el unidor de ancho cero de algunos emojis) se
  aceptan _(ataque ronda 1)_.
- **`NODE_ENV` mal escrito (`Production`, con espacios):** la API y la semilla no arrancan (criterio 78)
  _(ataque ronda 1)_.
- **Academia suspendida entre el inicio y el fin de una operación:** `conAcademia` comprueba el estado al empezar;
  una operación ya iniciada termina. Se acepta.
- **Nombre corto con mayúsculas, espacios, letras turcas (`İ`) o cirílicas parecidas:** se normaliza y, si queda algo
  fuera de `a-z`, `0-9` y guion, se rechaza (criterios 49 y 59).
- **Doble clic en "Crear academia":** la segunda petición responde 409 (criterio 50); no se duplica.
- **Restablecer la clave del superadmin con su sesión abierta:** la sesión deja de valer (criterio 34).
- **Cambio de `JWT_SECRETO`:** todas las sesiones dejan de valer. Es la forma de cerrar todas de golpe.
- **Hora del servidor en otra zona:** los tiempos se guardan en `timestamptz`, el vencimiento del token y del bloqueo
  se calculan con `RELOJ`, y la web muestra las fechas en America/Lima.
- **Un superadmin y un usuario de academia en el mismo navegador (desde 002):** la cookie `aq_plataforma` solo se
  envía a `/api/plataforma`, así que nunca llega a las rutas de las academias.
- **Muchas academias:** el listado no se pagina en el MVP (pocas academias, alta manual).

## Reglas de negocio aplicables

- **D-23:** cada academia tiene sus propios datos y nunca ve los de otra; toda tabla del negocio lleva `academia_id`;
  doble capa: la API y RLS.
- **D-27:** cada academia tiene un nombre corto único que va en la dirección de sus páginas públicas (`/a/{nombre}`).
- **D-29:** el Superadmin crea academias y las suspende, y no ve sus datos internos (alumnos, pagos, caja). Sin cobro
  de suscripción en el MVP. Cómo inicia sesión lo define esta especificación (criterios 33 a 47, decisión del
  responsable DR-2).
- **D-17:** la auditoría y la configuración por academia se crean aquí; los usuarios, en 002.
- **D-07:** la configuración es una tabla clave/valor; el bloqueo usa intentos fallidos, `bloqueado_hasta` y
  `ultimo_acceso` (aquí aplicados al Superadmin).
- **RN-22 y RNF-06:** las acciones críticas quedan en auditoría: quién, cuándo y qué.
- **RNF-03:** contraseñas con argon2 y control de acceso por roles.
- **RNF-12:** fechas en America/Lima.
- **Reglas que no se negocian de `CLAUDE.md`:** `academia_id` en toda tabla del negocio; auditoría de las acciones
  críticas; efectos secundarios después de confirmar la transacción (esta historia no tiene ninguno).

## Contrato

### Variables de sesión y funciones de PostgreSQL

- `app.academia_id`: id (UUID en texto) de la academia de la transacción. Se fija solo con
  `set_config('app.academia_id', <id>, true)` (local a la transacción).
- `app.plataforma`: `'si'` en las transacciones de la plataforma. Se fija con `set_config('app.plataforma', 'si',
  true)`.
- `app_academia_actual() returns uuid`: el valor de `app.academia_id`, o `NULL` si falta o está vacío.
- `app_es_plataforma() returns boolean`: `true` solo si `app.plataforma` es exactamente `si`.
- `resolver_academia(p_nombre_corto text) returns table (id uuid, nombre text, nombre_corto text, estado text)`:
  criterio 20. Cómo se implementa: precisión P-10.

### Roles de PostgreSQL y variables de entorno

| Variable | Quién la usa | Rol |
| --- | --- | --- |
| `DATABASE_URL` | migraciones, `db:crear`, semilla, `plataforma:superadmin` | dueño de las tablas (`aquagestion`) |
| `DATABASE_URL_PRUEBAS` | lo mismo, en la base de pruebas | dueño |
| `DATABASE_URL_APP` | la API | `aquagestion_app` (nombre fijo) |
| `DATABASE_POOL_MAX` | la API (opcional, 1 a 100, por defecto 10) | — |
| `JWT_SECRETO` | la API (al menos 32 caracteres; en producción, además, criterio 79) | — |
| `NODE_ENV` | la API y la semilla (ausente, `development`, `test` o `production`; criterio 78) | — |
| `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE`, `SUPERADMIN_CLAVE` | `plataforma:superadmin` y la semilla | — |

En las pruebas, la URL de la app para la base de pruebas se arma con el usuario y la contraseña de
`DATABASE_URL_APP` y el host, el puerto y la base de `DATABASE_URL_PRUEBAS`. Nombres exactos de los campos de
`Entorno` y quién crea el rol `aquagestion_app` en cada entorno: precisiones P-1 y P-11.

### Servicios del backend (contrato para las pruebas)

Exportados desde `backend/src/infraestructura/prisma/index.ts`:

```ts
type ClienteTransaccion = Prisma.TransactionClient; // del cliente generado
interface TransaccionAcademia { readonly academiaId: string; readonly cliente: ClienteTransaccion }
interface TransaccionPlataforma { readonly cliente: ClienteTransaccion }
interface OpcionesTransaccion { readonly aislamiento?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable' }
interface AcademiaResuelta { id: string; nombre: string; nombreCorto: string; estado: 'ACTIVA' | 'SUSPENDIDA' }

class BaseDatos {
  conAcademia<T>(academiaId: string, trabajo: (tx: TransaccionAcademia) => Promise<T>, opciones?: OpcionesTransaccion): Promise<T>;
  comoPlataforma<T>(trabajo: (tx: TransaccionPlataforma) => Promise<T>, opciones?: OpcionesTransaccion): Promise<T>;
  resolverAcademia(nombreCorto: string): Promise<AcademiaResuelta | null>; // sin contexto, usa resolver_academia
  comprobarConexion(): Promise<void>; // SELECT 1, para salud
}
class ErrorAcademiaNoEncontrada /* 404 ACADEMIA_NO_ENCONTRADA */ {}
class ErrorAcademiaSuspendida /* 403 ACADEMIA_SUSPENDIDA */ {}
class ErrorRolBaseDatosInseguro /* 500 ERROR_INTERNO */ {}
```

Exportado desde `backend/src/modulos/auditoria/index.ts`:

```ts
interface EntradaAuditoria {
  actorTipo: 'USUARIO' | 'SUPERADMIN' | 'SISTEMA';
  actorId: string | null;
  accion: string;          // MAYÚSCULAS_CON_GUIONES_BAJOS
  entidad: string;         // por ejemplo 'academia'
  entidadId: string | null;
  datosAntes?: unknown;    // JSON, nombres de campo como en la API
  datosDespues?: unknown;
  motivo?: string | null;
  ip?: string | null;
}
class AuditoriaService {
  registrarEnAcademia(tx: TransaccionAcademia, entrada: EntradaAuditoria): Promise<void>;
  registrarEnPlataforma(tx: TransaccionPlataforma, entrada: EntradaAuditoria): Promise<void>;
}
```

`ErrorNegocio(estado: number, codigo: string, mensaje: string, detalles?: unknown)` vive en
`backend/src/comun/errores/`.

### Endpoints

Todas las respuestas de `/api/plataforma/*` y `/api/a/*` llevan `Cache-Control: no-store`, también las de error
(precisión P-8). Los cuerpos de entrada son JSON y sus esquemas son estrictos (un campo de más es 400). Un cuerpo con
otro `Content-Type` responde 400 `SOLICITUD_INVALIDA` (criterio 74); los textos siguen los criterios 76 y 77
_(ataque ronda 1)_.

| Método y ruta | Sesión | Entrada | Éxito | Errores |
| --- | --- | --- | --- | --- |
| `POST /api/plataforma/sesion` | no | `iniciarSesionPlataformaSchema` | 200 `RespuestaSesionPlataforma` + cookie | 400, 401 `CREDENCIALES_INVALIDAS`, 423 `CUENTA_BLOQUEADA`, 429 |
| `GET /api/plataforma/sesion` | sí | — | 200 `RespuestaSesionPlataforma` | 401 `NO_AUTENTICADO` |
| `DELETE /api/plataforma/sesion` | no | — | 204, borra la cookie | — |
| `GET /api/plataforma/academias` | sí | — | 200 `RespuestaListaAcademias` | 401 |
| `POST /api/plataforma/academias` | sí | `crearAcademiaSchema` | 201 `RespuestaAcademia` | 400, 401, 409 `NOMBRE_CORTO_EN_USO` |
| `POST /api/plataforma/academias/{id}/suspender` | sí | `suspenderAcademiaSchema` | 200 `RespuestaAcademia` | 400, 401, 404 `NO_ENCONTRADO`, 409 `ACADEMIA_YA_SUSPENDIDA` |
| `POST /api/plataforma/academias/{id}/reactivar` | sí | `reactivarAcademiaSchema` | 200 `RespuestaAcademia` | 400, 401, 404, 409 `ACADEMIA_YA_ACTIVA` |
| `GET /api/a/{nombreCorto}` | no | — | 200 `AcademiaPublica` | 404 `ACADEMIA_NO_ENCONTRADA`, 403 `ACADEMIA_SUSPENDIDA` |

Cookie de sesión: `aq_plataforma`, `HttpOnly`, `SameSite=Strict`, `Path=/api/plataforma`, `Max-Age=28800`, `Secure`
con `NODE_ENV=production`. Token: criterio 37. Límite: 10 intentos de inicio de sesión por IP cada 60 segundos
(precisión P-5), contando toda petición, también las de cuerpo ilegible, demasiado grande o no JSON (criterio 75,
ataque ronda 1). Bloqueo: 5 fallos seguidos, 15 minutos. Cookie de borrado: precisión P-6. Rutas sin sesión:
precisión P-7. Normalización de `{nombreCorto}`: precisión P-4.

### Esquemas compartidos (`packages/contratos/src/`)

- `academias.ts`:
  - `PALABRAS_RESERVADAS` (DR-5): `a`, `admin`, `administrador`, `api`, `app`, `aquagestion`,
    `assets`, `ayuda`, `ingresar`, `inscripcion`, `login`, `logout`, `plataforma`, `public`, `publico`, `root`,
    `salir`, `sistema`, `solicitud`, `soporte`, `static`, `superadmin`, `www`.
  - `nombreCortoSchema`: recorta, pasa a minúsculas y valida (criterio 49).
  - `estadoAcademiaSchema`: `'ACTIVA' | 'SUSPENDIDA'`.
  - `crearAcademiaSchema`: `{ nombre, nombreCorto }`.
  - `suspenderAcademiaSchema`: `{ motivo }` (3 a 500 tras recortar). `reactivarAcademiaSchema`: `{ motivo? }` (igual,
    opcional).
  - `academiaResumenSchema` (estricto): `{ id: uuid, nombre, nombreCorto, estado, creadaEn: ISO 8601 UTC,
    suspendidaEn: ISO 8601 UTC | null, motivoSuspension: string | null }`.
  - `respuestaAcademiaSchema`: `{ academia }`. `respuestaListaAcademiasSchema`: `{ academias }`.
  - `academiaPublicaSchema` (estricto): `{ nombreCorto, nombre }`.
- `plataforma.ts`:
  - `iniciarSesionPlataformaSchema`: `{ correo: email recortado y en minúsculas, máx. 254; clave: 1 a 128 }`.
  - `superadminSesionSchema` (estricto): `{ id, correo, nombre }`. `respuestaSesionPlataformaSchema`:
    `{ superadmin }`.
- `error-api.ts`: `detallesValidacionSchema` = `{ errores: Array<{ campo: string; mensaje: string }> }`.

### Códigos de error nuevos

`CREDENCIALES_INVALIDAS` (401), `CUENTA_BLOQUEADA` (423), `ACADEMIA_NO_ENCONTRADA` (404), `ACADEMIA_SUSPENDIDA`
(403), `NOMBRE_CORTO_EN_USO` (409), `ACADEMIA_YA_SUSPENDIDA` (409), `ACADEMIA_YA_ACTIVA` (409). Se mantienen los de
000 (`SOLICITUD_INVALIDA`, `NO_AUTENTICADO`, `NO_ENCONTRADO`, `DEMASIADAS_SOLICITUDES`, `ERROR_INTERNO`). Las pruebas
comprueban el código y el estado, no el texto del mensaje. `CARGA_EXCESIVA` (413) es el que ya devuelve el filtro de
errores para un cuerpo de más de 100 KB (criterio 75; precisión tras las pruebas de la ronda 1, 11/11/2026).

### Comandos de la raíz

- `npm run plataforma:superadmin`: criterios 33 a 35.
- `npm run env:completar`: criterio 63.
- `db:crear` (crea también el rol, criterio 6) y `db:semilla` (criterio 61) cambian.

### Utilidades de prueba (`backend/test/utilidades/`)

Las escribe el test-writer junto con las pruebas protegidas y llevan la misma marca. Firmas:

```ts
// aplicacion.ts
export const JWT_SECRETO_PRUEBAS: string; // 32 o más caracteres
export function crearEntornoDePruebas(variables?: Record<string, string | undefined>): Entorno;
export function crearAppDePruebas(opciones?: {
  variables?: Record<string, string | undefined>; // reemplaza variables (DATABASE_URL_APP, NODE_ENV, DATABASE_POOL_MAX…)
  ajustar?: (b: TestingModuleBuilder) => TestingModuleBuilder; // por ejemplo, RELOJ con RelojFijo
  controladores?: Type<unknown>[];
  nivelRegistro?: string;
  destinoRegistro?: DestinationStream;
}): Promise<NestExpressApplication>;

// base-datos.ts
export function urlPropietarioPruebas(): string; // DATABASE_URL_PRUEBAS
export function urlAppPruebas(): string;         // aquagestion_app sobre la base de pruebas
// Se fijan con set_config(..., true). academiaId se fija tal cual (puede ser un texto inválido, para el criterio 14);
// plataforma: true fija 'si' y un texto fija ese texto (para probar valores distintos de 'si').
export interface Contexto { academiaId?: string; plataforma?: boolean | string }
export function ejecutarComo(rol: 'propietario' | 'app', sql: string, parametros?: unknown[], contexto?: Contexto): Promise<pg.QueryResult>;
export function conClienteComo<T>(rol: 'propietario' | 'app', trabajo: (c: pg.ClientBase) => Promise<T>): Promise<T>;
export function limpiarBase(): Promise<void>; // TRUNCATE de todas las tablas de public salvo _prisma_migrations

// academias.ts
export function crearAcademiaDePrueba(datos?: { nombre?: string; nombreCorto?: string; estado?: 'ACTIVA' | 'SUSPENDIDA' }): Promise<{ id: string; nombre: string; nombreCorto: string }>;

// superadmins.ts
export function crearSuperadminDePrueba(datos?: { correo?: string; nombre?: string; clave?: string }): Promise<{ id: string; correo: string; nombre: string; clave: string }>;
export function iniciarSesionPlataforma(app: INestApplication, credenciales: { correo: string; clave: string }): Promise<string>; // valor para la cabecera Cookie
export function firmarTokenPlataforma(claims: Record<string, unknown>, opciones?: { secreto?: string; algoritmo?: 'HS256' | 'none' }): string;

// datos.ts (precisión tras las pruebas de la ronda 1, 11/11/2026; ver el bloque B)
export interface DatosDeAislamiento {
  A: { id: string; nombre: string; nombreCorto: string };
  B: { id: string; nombre: string; nombreCorto: string };
  superadmin: { id: string; correo: string; nombre: string; clave: string };
  filas: { auditoriaA: number; auditoriaB: number; configuracionesA: number; configuracionesB: number }; // 2, 3, 2 y 4
}
// Después de limpiarBase(): exactamente 2 academias, 1 superadmin, 2 + 2 filas de A, 3 + 4 de B y 2 en auditoria_plataforma.
export function crearDatosDeAislamiento(): Promise<DatosDeAislamiento>;

// comandos.ts
export function ejecutarComando(comando: 'plataforma:superadmin' | 'db:semilla', variables: Record<string, string | undefined>): { estado: number | null; salida: string };
```

`ejecutarComo` con `'propietario'` y un contexto sirve para preparar datos tanto con un dueño superusuario (Docker,
CI) como con uno que no lo es (nube). `ejecutarComo` abre una transacción, fija el contexto si se indica, ejecuta y
confirma; si PostgreSQL responde con error, rechaza con el error de `pg` (con su `code`).

### Eventos

Ninguno.

### Permisos

- Superadmin: solo las rutas de `/api/plataforma/*`. No hay rutas que devuelvan datos internos de una academia.
- Público: `GET /api/a/{nombreCorto}` y `POST`/`DELETE /api/plataforma/sesion`.
- Roles de academia (Admin, Secretaria, Entrenador, Alumno): llegan en 002.

### Precisiones del contrato

_(precisión del contrato tras T1–T2, 11/11/2026)_. Detalles técnicos que el contrato no fijaba y que las pruebas
protegidas de T1 y T2 dan por hechos. No son reglas de negocio nuevas ni cambian el sentido de ningún criterio.

- **P-1. `Entorno` (criterio 5).** El objeto que devuelve `validarEntorno` tiene los campos `DATABASE_URL_APP`
  (`string`), `JWT_SECRETO` (`string`) y `DATABASE_POOL_MAX` (`number`, 10 si la variable no está), además de
  `PUERTO_API` y `NODE_ENV` de la spec 000. La API ya no exige `DATABASE_URL`: si falta, el entorno es válido, y si
  está, `Entorno` no tiene la propiedad `DATABASE_URL`.
- **P-2. Registros de auditoría (criterios 29 a 32).**
  - `entidad` es `academia` en `ACADEMIA_CREADA`, `ACADEMIA_SUSPENDIDA` y `ACADEMIA_REACTIVADA`, y `superadmin` en
    `SUPERADMIN_CREADO` y `SUPERADMIN_CLAVE_RESTABLECIDA`. Se implementa en singular; las pruebas aceptan también el
    plural (`academias`, `superadmins`).
  - `ip` es la IP del cliente tal como la ve Express (`req.ip`); en las pruebas, `127.0.0.1` o `::1`.
  - Con actor `SISTEMA`, `actor_id` no se exige (puede ser nulo). Con actor `SUPERADMIN`, es el id del superadmin.
- **P-3. Catálogo (criterios 11 y 12).** Toda tabla del negocio (con `academia_id`) tiene `academia_id uuid NOT NULL`
  con una llave foránea a `academias(id)` cuya acción de borrado es `NO ACTION` o `RESTRICT` (nunca `CASCADE`,
  `SET NULL` ni `SET DEFAULT`). Toda tabla con `academia_id` y columna `id` tiene una restricción `UNIQUE` o una llave
  primaria con exactamente las columnas `(academia_id, id)`, en ese orden, ni más ni menos. Las tablas sin columna
  `id` (por ejemplo `configuraciones`, con PK `(academia_id, clave)`) no necesitan esa restricción.
- **P-4. `GET /api/a/{nombreCorto}` (criterios 58 y 59).** El segmento ya decodificado se recorta (`trim`, que quita
  espacios, tabuladores y saltos de línea de los extremos) y se pasa a minúsculas antes de validarlo y buscarlo. Por
  eso `delfines%0A` (salto de línea al final) encuentra `delfines`, mientras que `del%0Afines` (salto de línea en
  medio) no cumple el formato y responde 404 `ACADEMIA_NO_ENCONTRADA`. `delfines%00` sigue respondiendo 404: el
  carácter nulo no es un espacio y no se recorta.
- **P-5. Límite por IP (criterio 41).** Dentro de una ventana de 60 segundos, las 10 primeras peticiones
  `POST /api/plataforma/sesion` de una IP se atienden (con la respuesta que corresponda: 200, 400, 401 o 423) y la
  11.ª, y las siguientes, reciben 429 `DEMASIADAS_SOLICITUDES`.
- **P-6. Cierre de sesión (criterio 44).** La cabecera `Set-Cookie` de borrado es `aq_plataforma=` con `Max-Age=0` y
  `Path=/api/plataforma` (puede llevar además `Expires` en el pasado, `HttpOnly`, `SameSite=Strict` y, en
  producción, `Secure`).
- **P-7. Rutas bajo `/api/plataforma/` (criterio 45).** La exigencia de sesión se aplica a todo el prefijo con un
  guard o middleware general, no por controlador: cualquier ruta bajo `/api/plataforma/` que no sea `POST` o `DELETE
  /api/plataforma/sesion`, incluidas las que no existen (`/api/plataforma/no-existe`) y las que llevan barra final
  (`/api/plataforma/academias/`), responde 401 `NO_AUTENTICADO` sin una sesión válida. Con sesión válida, una ruta
  inexistente responde 404 `NO_ENCONTRADO`.
- **P-8. `Cache-Control: no-store`.** Lo llevan todas las respuestas bajo `/api/plataforma` y `/api/a`, también las de
  error (400, 401, 403, 404, 409, 423, 429 y 500) y las de rutas inexistentes. Se fija en un middleware de esos
  prefijos, no solo en los controladores.
- **P-9. Registro técnico (criterios 4 y 46).** Todo lo que la API escribe en el log pasa por pino: el `Logger` de
  Nest redirigido a pino (o `PinoLogger`), con el destino de `crearAppDePruebas({ destinoRegistro })`. Nada se
  escribe con `console`. Así las pruebas leen el mensaje del rol inseguro y comprueban que la clave no aparece.
- **P-10. `resolver_academia` (criterio 20).** En PostgreSQL 16, `CREATE FUNCTION … SET app.plataforma = 'si'`
  falla cuando el dueño de la migración no es superusuario (la nube). Por eso la función es `LANGUAGE plpgsql`,
  `VOLATILE` y `SECURITY INVOKER`, con `SET search_path = pg_catalog, public, pg_temp`, y en tiempo de ejecución:
  guarda `current_setting('app.plataforma', true)`, ejecuta `set_config('app.plataforma', 'si', true)`, hace la
  consulta por igualdad, restaura el valor guardado con `set_config('app.plataforma', <anterior o ''>, true)` y
  devuelve las filas. Si la consulta falla, también restaura antes de propagar el error. El resultado observable es
  el del criterio 20.
- **P-11. Quién crea el rol `aquagestion_app` (criterios 6, 8 y 64).** Crear roles exige `CREATEROLE` o ser
  superusuario. El dueño de las migraciones en la nube (`aquagestion`) no tiene `CREATEROLE`, así que el rol de la
  app lo crea siempre un usuario con privilegios de cada entorno:
  - **nube:** el hook de sesión, conectado como el usuario de sistema `postgres` (igual que ya crea `aquagestion`);
    después `db:crear` solo lo encuentra y lo verifica;
  - **Windows con Docker:** `db:crear`, conectado con el usuario del contenedor (`POSTGRES_USER`, que es su
    superusuario y coincide con el de `DATABASE_URL`);
  - **CI:** `db:crear`, con el usuario del servicio de PostgreSQL (`POSTGRES_USER`, superusuario).

  Si el usuario de `DATABASE_URL` no puede crear roles y el rol no existe, `db:crear` termina con código 1 y dice
  cómo crearlo (criterio 6).

## Cambios al modelo de datos

Una migración `<marca>_academias_aislamiento`. Identificadores `uuid` generados por PostgreSQL
(`gen_random_uuid()`). Tiempos en `timestamptz`.

- **`academias`** (plataforma, sin `academia_id`): `id` PK; `nombre text not null`; `nombre_corto text not null
  unique` con `CHECK` de formato y longitud (criterio 49, sin la lista reservada); `estado` (`ACTIVA`, `SUSPENDIDA`;
  por defecto `ACTIVA`); `motivo_suspension text null`; `suspendida_en timestamptz null`; `creada_en`,
  `actualizada_en`. `CHECK`: `estado = 'SUSPENDIDA'` si y solo si `suspendida_en` no es nulo.
- **`superadmins`** (plataforma): `id` PK; `correo text not null unique` (guardado en minúsculas, con `CHECK`
  `correo = lower(correo)`); `nombre`; `clave_hash`; `version_token integer not null default 0`;
  `intentos_fallidos integer not null default 0`; `bloqueado_hasta timestamptz null`; `ultimo_acceso timestamptz
  null`; `creado_en`, `actualizado_en`.
- **`auditoria`** (por academia): `id` PK; `academia_id uuid not null` → `academias(id)`; `fecha_hora timestamptz
  not null`; `actor_tipo` (`USUARIO`, `SUPERADMIN`, `SISTEMA`); `actor_id uuid null` (sin llave foránea: la tabla
  de usuarios llega en 002); `accion text not null`; `entidad text not null`; `entidad_id text null`;
  `datos_antes jsonb null`; `datos_despues jsonb null`; `motivo text null`; `ip inet null`. `UNIQUE (academia_id,
  id)`; índice `(academia_id, fecha_hora desc)`. Ajusta la entidad `AUDITORIA` de la sección 9 (`usuario_id` pasa a
  `actor_tipo` + `actor_id`; se agrega `motivo`, que piden D-03 y D-16).
- **`auditoria_plataforma`** (plataforma): las mismas columnas sin `academia_id`; índice `(fecha_hora desc)`.
- **`configuraciones`** (por academia): `academia_id uuid not null` → `academias(id)`; `clave text not null` con
  `CHECK` `^[a-z][a-z0-9_]{0,63}$`; `valor jsonb not null`; `actualizado_en`. PK `(academia_id, clave)`. Sin claves
  en esta historia (DR-8).
- **Funciones** `app_academia_actual()`, `app_es_plataforma()` y `resolver_academia(text)` (esta última en
  `plpgsql`, precisión P-10).
- **RLS** activada y forzada en las cinco tablas, con estas políticas:
  - `academias`: leer si es plataforma o `id = app_academia_actual()`; crear y modificar solo en plataforma.
  - `superadmins` y `auditoria_plataforma`: solo en plataforma.
  - `auditoria` y `configuraciones`: `academia_id = app_academia_actual()`, al leer y al escribir.
- **Privilegios** de `aquagestion_app`: criterio 2.

## Fuera de alcance

- **Usuarios de academia, su inicio de sesión (`/a/{academia}/ingresar`), roles y matriz de permisos:** 002.
- **Primer administrador de cada academia:** 002 (DR-1).
- **Claves y valores de configuración y su pantalla:** 003.
- **Leer la auditoría desde una pantalla:** Fase 3 ("auditoría avanzada"); en 001 solo se escribe.
- **Cambiar la contraseña del superadmin desde la web, recuperar la contraseña por correo y más de un rol de
  plataforma:** el comando del criterio 34 cubre el restablecimiento.
- **Borrar academias o cambiar su nombre corto:** DR-10 y DR-5.
- **Cobro de suscripción a las academias:** fuera del MVP (D-29).
- **Limitador global de peticiones y `trust proxy`:** se deciden con el hosting (D-21) y con las entradas públicas
  de 005; aquí solo se limita el inicio de sesión.
- **Subdominios por academia:** D-27 los deja para más adelante.
- **Tareas programadas:** no hay ninguna en 001; el patrón para recorrerlas por academia está en el plan.

## Impacto en especificaciones anteriores

- **000, criterio 14 y `validarEntorno`:** la API exige `DATABASE_URL_APP` y `JWT_SECRETO` en lugar de
  `DATABASE_URL` (criterio 5).
- **000, criterios 17 y 44:** `db:crear` y el hook de la nube también crean el rol `aquagestion_app` (criterios 6 y
  8).
- **000, criterio 18:** deja de valer "el esquema `public` no tiene más tabla que `_prisma_migrations`" y la semilla
  ya no informa "Sin datos de ejemplo todavía."; sus pruebas se actualizan (criterio 65).
- **000, criterios 6, 49 y 50:** `.env.example`, la CI y la guía de Windows se amplían (criterios 62, 64 y 67).
- **000, `PrismaService`:** pasa a ser interno de `infraestructura/prisma/`; salud usa `BaseDatos.comprobarConexion()`
  y conserva su contrato (criterios 7 a 9 de 000).
- **000, filtro de errores y `errorApiSchema`:** se agregan `ErrorNegocio` y el formato de `detalles` (criterio 66),
  que 000 dejaba para 002.
- **000, `crearAppDePruebas`:** la opción `databaseUrl` se reemplaza por `variables` (contrato de utilidades).
- **002:** usa el aislamiento de 001 para `usuarios` (con `academia_id`, RLS y las convenciones de los criterios 10 a
  12); reutiliza argon2, el JWT con versión, la cookie, el bloqueo, el limitador y `resolverAcademia`; obtiene la
  academia de la sesión y llama a `conAcademia`, que rechaza academias suspendidas. Crea también el primer administrador
  (DR-1). Si el Superadmin necesita operar sobre una academia suspendida, 002 agrega esa
  opción a `conAcademia`.
- **003:** define las claves de `configuraciones`; si la identidad visible de la academia (D-22) sale de la
  configuración, `GET /api/a/{nombreCorto}` puede tomar el nombre de ahí.
- **Siguientes historias:** toda tabla nueva lleva `academia_id`, RLS forzada, políticas con
  `app_academia_actual()`, `UNIQUE (academia_id, id)`, llaves foráneas compuestas y los privilegios mínimos para
  `aquagestion_app`, concedidos en su migración (criterios 9 a 12, que fallan si no).
- **`specs/backlog.md`:** por DR-1, la nota de 001 pierde "y su primer administrador" y la de 002 lo gana (lo hace el
  documentador, T24).

## Riesgos aceptados

- **Nombre fijo del rol en las migraciones (`aquagestion_app`):** el hosting tendrá que crear un rol con ese nombre.
  Se acepta por simplicidad; la guía lo documenta y la migración falla con un mensaje claro si falta.
- **RLS no protege de un error dentro de la academia correcta:** si el código toma el id de academia de la petición
  en lugar de la sesión, RLS no lo detecta. Lo mitigan las reglas de 002 (la academia sale de la sesión o del nombre
  corto), el revisor y el adversarial.
- **Saber si existe un correo de superadmin:** el 423 solo aparece en un correo que existe. Se acepta porque exige
  adivinar el correo y está limitado por IP; el Superadmin necesita saber que está bloqueado. Confirmado en el ataque
  ronda 1.
- **Revelar que una academia está suspendida** en su página pública (403 en lugar de 404): aceptado por el responsable (DR-4).
  Confirmado en el ataque ronda 1.
- **Bloqueo provocado por terceros** _(ataque ronda 1)_: quien conozca el correo del Superadmin puede bloquear su
  cuenta 15 minutos con 5 intentos fallidos (criterio 39), limitado por IP (criterio 41). Se acepta: el bloqueo es
  temporal y el comando del criterio 34 lo levanta al instante.
- **Una sesión abierta sigue valiendo si la cuenta se bloquea** _(ataque ronda 1)_: el bloqueo impide nuevos
  ingresos, no cierra sesiones ya emitidas. Para cortarlas, el comando del criterio 34 incrementa `version_token`;
  cambiar `JWT_SECRETO` las corta todas.
- **O3. Signo Kelvin en el nombre corto** _(ataque ronda 1)_: `K` (U+212A) se convierte en `k` con `toLowerCase`, así
  que `/api/a/…K…` lleva a la misma academia que `…k…`. No permite suplantar a otra academia ni crear un nombre
  corto distinto (el resultado cumple el formato y la unicidad se comprueba sobre el valor normalizado).
- **O5. Diferencia de tiempo entre correo existente e inexistente** _(ataque ronda 1)_: de 3 a 5 ms, pese al hash
  ficticio. Revela lo mismo que el 423 ya aceptado y está limitada por IP.
- **O6. Estadísticas de PostgreSQL** _(ataque ronda 1)_: `pg_stat_user_tables` (y vistas parecidas) muestran al rol
  de la app el total de filas por tabla, de todas las academias, sin contenido. Se acepta: no revela datos de
  ninguna academia ni a qué academia pertenecen las filas, y la API no expone esas vistas.
- **La regla de lint del criterio 73 solo ve texto literal** _(ataque ronda 1)_: un SQL armado por concatenación o
  pasado en una variable a `$executeRawUnsafe` no lo detecta. La garantía está en el criterio 72 (cada transacción
  fija los dos valores) y el revisor busca ese patrón.
- **`NODE_ENV` ausente en producción** _(ataque ronda 1)_: sin la variable, la API se comporta fuera de producción
  (cookie sin `Secure`, semilla permitida), como define la spec 000. Un valor mal escrito ya no pasa (criterio 78);
  que la variable exista en el servidor lo cubre la guía de despliegue, con el hosting (D-21).
- **Límite por IP detrás de un proxy:** sin `trust proxy`, todas las peticiones pueden parecer de la misma IP. Se
  decide con el hosting (D-21).
- **Clave de ejemplo del superadmin en `.env.example`:** es pública y solo sirve en desarrollo; la semilla no corre
  en producción y el comando del criterio 34 la reemplaza.
- **Cookie sin `Secure` fuera de producción:** necesario para `http://localhost`; en producción va con `Secure`
  (RNF-03: HTTPS obligatorio).

## Decisiones

### Decisiones del responsable (11/11/2026)

Bryan aprobó la especificación y aceptó la propuesta de cada pregunta abierta. Se citan como DR-N.

- **DR-1. Primer administrador de cada academia:** lo crea 002, junto con los usuarios y su inicio de sesión; 001 no
  lo crea. El backlog se ajusta (T24).
- **DR-2. Ingreso del Superadmin (D-29):** con correo y contraseña en `/plataforma/ingresar`, una página aparte de
  las academias. La cuenta se crea, y la contraseña olvidada se restablece, con `npm run plataforma:superadmin`, que
  solo puede ejecutar quien administra el servidor; no hay registro por la web. Como él elige su contraseña, no se le
  obliga a cambiarla en el primer ingreso (criterios 33 a 47).
- **DR-3. Valores de seguridad del Superadmin:** contraseña de 12 caracteres como mínimo; 5 intentos fallidos
  seguidos lo bloquean 15 minutos; la sesión dura 8 horas; como máximo 10 intentos por minuto desde una misma IP.
  Los de los usuarios de las academias se configuran en 002 y 003 (D-07) (criterios 35, 36, 39 y 41).
- **DR-4. Suspender una academia:** se corta todo: sus usuarios no pueden entrar y sus sesiones dejan de valer (desde
  002), sus páginas públicas muestran "Academia no disponible por el momento" y las tareas automáticas la saltan; los
  datos se conservan; el Superadmin puede reactivarla; el motivo es obligatorio y queda en auditoría. La página
  pública dice "no disponible" (403, revela que existe) y no "no existe" (criterios 25, 52 a 56 y 60).
- **DR-5. Nombre corto:** de 3 a 30 caracteres; solo letras minúsculas sin tildes ni ñ, números y guiones; empieza con
  letra; no puede ser una palabra reservada (lista en "Contrato"); se guarda en minúsculas aunque se escriba en
  mayúsculas; **no se puede cambiar** después de crear la academia, porque rompería los enlaces ya enviados
  (criterios 2, 49 y 50).
- **DR-6. Datos al crear una academia:** solo el nombre y el nombre corto. Teléfono, logo y colores van en la
  configuración (003, D-22); el RUC, con la facturación (D-09) (criterio 48).
- **DR-7. Auditoría en 001:** se auditan la creación, suspensión y reactivación de academias, y el alta y
  restablecimiento del Superadmin; los inicios de sesión van solo al log técnico. En 001 nadie ve la auditoría por
  pantalla; más adelante el administrador de cada academia verá la de su academia (Fase 3) y el Superadmin, la de la
  plataforma (criterio 32).
- **DR-8. Configuración en 001:** ninguna clave; 001 solo crea la tabla y 003 define las claves y sus valores por
  defecto (tolerancia de 10 minutos, 5 días "por vencer", días de prioridad, intentos y bloqueo).
- **DR-9. Datos de ejemplo:** dos academias inventadas, "Academia de Natación Los Delfines" (`delfines`) y "Club de
  Natación Tiburones" (`tiburones`), y un Superadmin de desarrollo con una contraseña de ejemplo pública que solo
  funciona en desarrollo y en la nube (criterios 61 y 62).
- **DR-10. Eliminar academias:** no en el MVP; solo suspenderlas. Borrarlas implicaría decidir qué pasa con pagos,
  comprobantes y datos personales (Ley 29733) (criterios 19 y 57).

### Decisiones de diseño

- **Un rol de PostgreSQL propio para la API (`aquagestion_app`), sin privilegios, más `FORCE ROW LEVEL SECURITY`.**
  Alternativas descartadas: `SET ROLE` en cada transacción (si se olvida, la consulta corre como dueño y ve todo:
  falla abierta) y solo `FORCE` con el dueño (en Docker el dueño es superusuario y se salta RLS igual).
- **Contexto local a la transacción con `set_config(..., true)` y una función `app_academia_actual()` que convierte
  vacío en nulo.** Alternativa descartada: `SET` de sesión (se queda en la conexión del pool).
- **Un solo camino a la base (`BaseDatos`)** con `conAcademia` y `comoPlataforma`, más una regla de lint.
  Alternativa descartada: extender el cliente de Prisma para que cada consulta abra su transacción (oculta cuándo se
  fija la academia y complica las transacciones de varias consultas).
- **El Superadmin y su auditoría en tablas propias, sin `academia_id`.** Alternativa descartada: `usuarios` con un rol
  `SUPERADMIN` y `academia_id` nulo (mezclaría la plataforma con las academias en la misma política).
- **Cookie de plataforma separada, limitada a `/api/plataforma`.** Alternativa descartada: una sola cookie para todos
  (el Superadmin llevaría su sesión a las rutas de las academias).
- **La comprobación del rol inseguro se hace en la primera operación, no al arrancar,** para no romper el criterio 8
  de 000.
- **`resolver_academia` como función que activa `app.plataforma = 'si'` solo durante la función.** Alternativas
  descartadas: dejar leer `academias` sin contexto (listaría todas) o `SECURITY DEFINER` (con `FORCE`, el dueño
  también queda sujeto a las políticas). Se activa con `set_config` en tiempo de ejecución y se restaura al salir,
  no con la cláusula `SET` de `CREATE FUNCTION`, que PostgreSQL 16 rechaza para un dueño que no es superusuario
  (precisión P-10, tras T1–T2, 11/11/2026).
- **Privilegios por columna** en `academias` y `superadmins`: la API no puede cambiar el nombre corto, el correo ni
  la contraseña del superadmin.

### Decisiones técnicas tras el ataque, ronda 1 (11/11/2026)

- **Cada transacción fija los dos valores de contexto** (criterio 72): `conAcademia` pone `app.plataforma` en `''` y
  `comoPlataforma` pone `app.academia_id` en `''`, con `set_config(…, true)`. Alternativa descartada: rechazar en
  `validarEntorno` una URL con `options` (no cubre un `set_config(…, false)` de un módulo ni los valores por defecto
  del rol o de la base).
- **400 `SOLICITUD_INVALIDA` para un cuerpo que no es JSON** (criterio 74). Alternativa descartada: 415 (el criterio
  42 ya fija 400 para un cuerpo que no es JSON, y la web trata igual todos los errores de entrada).
- **El límite de inicio de sesión cuenta antes de leer el cuerpo** (criterio 75). Alternativa descartada: el
  `ThrottlerGuard` en el controlador (corre después del lector del cuerpo, así que los 400 y 413 de Express no
  cuentan).
- **`NODE_ENV` de una lista cerrada exacta, sin normalizar** (criterio 78). Alternativa descartada: recortar y pasar a
  minúsculas (aceptaría en silencio un valor mal escrito; mejor detenerse y que se corrija).
- **Reglas de texto con propiedades Unicode** (`\p{Cc}`, `\p{Bidi_Control}`, `\p{L}`…) en esquemas compartidos
  (criterios 76 y 77). Alternativa descartada: una lista de caracteres permitidos (rechazaría nombres legítimos con
  tildes, ñ o de otros alfabetos).

## Preguntas abiertas

Ninguna. Las 10 preguntas de la versión en borrador quedaron resueltas por el responsable el 11/11/2026 (DR-1 a DR-10
en "Decisiones").
