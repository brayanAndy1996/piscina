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
- **K. Correcciones del ataque, ronda 2 (80 a 91):**
  - 80 a 82: aislamiento entre academias (D-23); un rol con `REPLICATION`, dueño de la base o con tablas temporales
    lee todas las academias, borra la auditoría o tapa una tabla protegida por RLS con otra sin RLS.
  - 83 a 86: aislamiento; un SQL de sesión que escape al lint o un camino al cliente de Prisma fuera de `BaseDatos`
    deja a un módulo fijar otra academia o consultar sin contexto.
  - 87 y 88: entradas de autenticación y auditoría (RN-22), como 76 y 77; un nombre que se ve en blanco o una clave
    más corta de lo permitido debilitan la auditoría y la contraseña del Superadmin.
  - 89: autenticación y entradas, como 74 y 75; un código de error distinto rompe el formato común y el conteo del
    límite.
  - 90: aislamiento; los comandos y la semilla usan el dueño de las tablas, que en la nube pasa por RLS y podría
    heredar el contexto de academia de la conexión.
  - 91: autenticación, como 79; un secreto que está en el repositorio y que producción acepta permitiría falsificar
    sesiones.
- **L. Correcciones del ataque, ronda 3 (92 a 105):**
  - 92 a 97: aislamiento (D-23); un SQL que llega a la base sin pasar por el lint, un comentario que apaga la regla o
    un archivo `.mjs` que nadie revisa dejan a un módulo cambiar de academia o usar el cliente del dueño.
  - 98: aislamiento y auditoría (RN-22, RNF-12); con la zona de la sesión distinta de UTC, la auditoría, el bloqueo y
    la suspensión quedan corridos 5 horas (y desde 006, la asistencia y la caja).
  - 99 y 100: aislamiento; el cliente del dueño o el cliente completo de Prisma al alcance de un módulo se saltan RLS
    o el contexto de la transacción.
  - 101: aislamiento; un cursor que sobrevive en una conexión del pool entrega filas de otra academia.
  - 102 y 103: aislamiento y auditoría; un privilegio de más (`TRUNCATE` de la auditoría) o un valor por defecto del
    rol (`row_security`, `search_path`) deshace las garantías sin que la API lo note.
  - 104: autenticación; la contraseña del rol en claro queda en el log de PostgreSQL.
  - 105: entradas y auditoría (RN-22); un texto con bytes inválidos se guarda alterado.
- **M. Correcciones del ataque, ronda 4 (106 a 119):**
  - 106 y 107: aislamiento (D-23, D-29); una consulta que sale de la transacción corre sin contexto y lee otra academia
    o la clave del Superadmin, y una fecha mal leída anula el bloqueo del Superadmin.
  - 108: autenticación; ante una fecha inválida, el bloqueo debe fallar cerrado, no abrir la cuenta.
  - 109 a 113 y 115: aislamiento; caminos por los que un SQL o el cliente de Prisma escapan al lint (funciones que
    ejecutan texto, archivos exentos, enlaces simbólicos, etiquetas falsas, alias de `Prisma`), y un falso positivo que
    empujaría a saltarse la regla.
  - 114: aislamiento y cálculo del cobro; sin un punto autorizado, las historias de cobros y caja tendrían que usar
    `number` para montos o abrir excepciones en las reglas.
  - 116 a 119: aislamiento; variables del dueño que quedan en el proceso en Windows, un `.env` que un módulo podría
    recargar, archivos sin revisar bajo `generated/` y archivos `.jsx` que `tsx` ejecuta.
- **N. Correcciones del ataque, ronda 5 (120 a 129):**
  - 120: autenticación (D-29); un inicio de sesión con la clave anterior que termina después de un restablecimiento
    recibiría una sesión válida, y restablecer la clave dejaría de cortar el acceso.
  - 121 a 123: aislamiento (D-23); un `search_path` o un esquema con el nombre del rol harían que la API leyera tablas
    falsas (una academia suspendida operando, una clave del atacante aceptada), y una `\` con
    `standard_conforming_strings` en `off` cambiaría el significado del SQL.
  - 124 y 125: aislamiento; una vista sin `security_invoker`, una vista materializada, una función `SECURITY DEFINER` o
    una regla de reescritura creadas por una migración devuelven datos de todas las academias.
  - 126: aislamiento; una restricción única sin `academia_id` revelaría con un 409 que un dato existe en otra academia.
  - 127 a 129: aislamiento; otro cliente de PostgreSQL abriría un pool propio fuera de `BaseDatos`.
- **O. Correcciones del ataque, ronda 6 (130 a 136):**
  - 130 y 131: aislamiento (D-23); una vista, tabla o función en un esquema distinto de `public` con privilegios para la
    app devuelve datos de todas las academias sin que la comprobación del rol ni las pruebas de catálogo lo vean.
  - 132 y 133: aislamiento (D-23, D-29); una política de una tabla de academia con `OR app_es_plataforma()` u otra
    condición que la amplíe da al Superadmin o a cualquier academia los datos de todas, aunque contenga la comparación.
  - 134 y 135: aislamiento; una transacción guardada en un servicio compartido y usada desde otra petición lee y escribe
    en la academia de la primera.
  - 136: aislamiento; `lastval()` y `currval()` devuelven valores de la sesión, que la conexión del pool comparte entre
    academias; y un falso positivo (`SET CONSTRAINTS`) empujaría a saltarse la regla.

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
   activada **y forzada** (`relrowsecurity` y `relforcerowsecurity`). _(crítico)_ _(alcance ampliado por el criterio
   131, ataque ronda 6: todos los esquemas que no son del sistema)_
10. Dado el esquema `public`, entonces las únicas tablas sin columna `academia_id` son `academias`, `superadmins`,
    `auditoria_plataforma` y `_prisma_migrations`. Una tabla nueva sin `academia_id` hace fallar esta prueba hasta
    que una especificación la agregue a la lista. _(crítico)_ _(alcance ampliado por el criterio 131, ataque ronda 6:
    todos los esquemas que no son del sistema; la lista vale solo para `public`)_
11. Dada cualquier tabla con `academia_id`, entonces la columna es `NOT NULL` y de tipo `uuid`, tiene una llave
    foránea a `academias(id)` sin borrado en cascada, y la tabla tiene políticas para cada comando que el rol
    `aquagestion_app` tiene concedido; toda política de esa tabla compara `academia_id` con `app_academia_actual()`
    y ninguna es `USING (true)` ni `WITH CHECK (true)`. _(crítico)_ _(complementado por el criterio 132, ataque ronda 6:
    forma exacta de cada política; y ampliado por el 131: tablas de todos los esquemas que no son del sistema)_
12. Dada cualquier llave foránea de una tabla con `academia_id` hacia otra tabla con `academia_id`, entonces incluye
    `academia_id` en ambos lados; y toda tabla con `academia_id` y columna `id` tiene una restricción `UNIQUE` (o
    llave primaria) sobre `(academia_id, id)`. Así una fila de A no puede apuntar a una fila de B, porque las llaves
    foráneas no pasan por RLS. _(crítico)_ _(alcance ampliado por el criterio 131, ataque ronda 6)_
13. Dados datos, como app y sin contexto, entonces `SELECT` sobre cada tabla de `public` (salvo
    `_prisma_migrations`, sobre la que no tiene permiso) devuelve 0 filas; `INSERT` en `auditoria` y en
    `configuraciones` falla con SQLSTATE `42501`; y `UPDATE` afecta 0 filas. Lo mismo con `app.academia_id` vacío
    (`''`) y con `app.plataforma` vacío o con un valor distinto de `si`. _(crítico)_ _(generalizado a toda tabla con
    `academia_id` por el criterio 133, ataque ronda 6)_
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
    internos (D-29). _(crítico)_ _(generalizado a toda tabla con `academia_id` por el criterio 133, ataque ronda 6)_
18. Dados datos, como app con contexto de plataforma y de A a la vez, entonces las tablas con `academia_id` siguen
    mostrando solo filas de A: la marca de plataforma no amplía el acceso a datos de academias. _(crítico)_
    _(generalizado a toda tabla con `academia_id` por el criterio 133, ataque ronda 6)_
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
73. **Regla de lint contra el contexto de sesión** _(ataque ronda 1, F1)_ _(alcance ajustado por el criterio 92, ataque
    ronda 3)_. Dado el código de `backend/src/` (sin
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

### K. Correcciones del ataque adversarial, ronda 2

Criterios agregados tras la ronda 2 del ataque (11/11/2026). Son decisiones técnicas de seguridad, no reglas de
negocio nuevas, y no cambian el sentido de los criterios 1 a 79: los que amplían uno anterior lo dicen y se suman a
él. Todos son _(crítico)_.

80. **Rol inseguro: la lista completa en la API** _(ataque ronda 2, F1; complementa los criterios 1 y 4)_
    _(complementado por el criterio 123, ataque ronda 5: esquemas propios, con `CREATE` o con el nombre del rol)_. Dada la
    API con `DATABASE_URL_APP` apuntando a un rol que cumple **cualquiera** de estas condiciones, cuando se llama a
    `conAcademia`, `comoPlataforma` o `resolverAcademia`, entonces rechazan con `ErrorRolBaseDatosInseguro` sin
    ejecutar el trabajo, con las mismas respuestas 500 `ERROR_INTERNO` y el mismo registro en el log del criterio 4
    (el mensaje puede nombrar la condición, nunca la URL ni la contraseña):
    - superusuario, `BYPASSRLS`, `REPLICATION`, `CREATEROLE` o `CREATEDB`;
    - miembro de cualquier otro rol, de forma explícita (`pg_auth_members`) o implícita por ser dueño de la base
      (`pg_has_role(current_user, 'pg_database_owner', 'MEMBER')` verdadero);
    - privilegio `CREATE` o `TEMPORARY` sobre la base actual (`has_database_privilege(current_user,
      current_database(), …)`), venga de una concesión al rol o a `PUBLIC`;
    - privilegio `CREATE` sobre el esquema `public`;
    - dueño de cualquier objeto del esquema `public` (tabla, vista, vista materializada, secuencia, índice, tipo,
      función o procedimiento) o del propio esquema.

    Prueba: (a) unitaria de la función que decide con el resultado de la consulta del catálogo, con cada condición
    sola, y con todas falsas (rol seguro); (b) de integración, con un rol creado por la prueba para cada condición
    (`REPLICATION`, `CREATEROLE`, `CREATEDB`, miembro de `pg_read_all_data`, dueño de la base de pruebas sin ser dueño
    de ninguna tabla, con `GRANT CREATE ON DATABASE`, con `GRANT TEMPORARY ON DATABASE`, con `GRANT CREATE ON SCHEMA
    public`), donde el usuario de pruebas pueda crear roles (Docker y CI); en la nube se omite con aviso y sigue
    valiendo el caso del criterio 4. _(crítico)_
81. **Rol inseguro: `db:crear` y el hook** _(ataque ronda 2, F1; complementa los criterios 6 y 8)_. Dado que el rol
    `aquagestion_app` ya existe y cumple alguna condición del criterio 80 (en `db:crear`, evaluadas sobre la base de
    desarrollo y sobre la de pruebas, después de la revocación del criterio 82), cuando se ejecuta `npm run
    db:crear`, entonces termina con código 1, con un mensaje que nombra la condición y cómo corregirla (por ejemplo,
    `ALTER ROLE aquagestion_app NOREPLICATION;`), sin imprimir contraseñas ni modificar el rol. Cuando lo crea, lo
    crea sin ninguna de ellas (criterio 6). Dada la nube, cuando el paso del rol del hook de sesión encuentra
    `aquagestion_app` con superusuario, `BYPASSRLS`, `REPLICATION`, `CREATEROLE` o `CREATEDB`, o miembro de algún rol,
    entonces el paso falla y lo informa, sin imprimir la contraseña; las condiciones que dependen de cada base las
    comprueba `db:crear` a continuación. _(crítico; prueba de integración donde se puedan crear roles, Docker y CI, y
    unitaria de la función del hook que evalúa la fila del rol)_
82. **Sin tablas temporales para la app** _(ataque ronda 2, F4; complementa el criterio 1)_. Dadas las migraciones
    aplicadas (en la base de desarrollo y en la de pruebas), entonces `PUBLIC` no tiene `TEMPORARY` sobre la base y
    `aquagestion_app` tampoco, ni directo ni heredado
    (`has_database_privilege('aquagestion_app', current_database(), 'TEMPORARY')` es falso); y como app, también
    dentro de `conAcademia` y de `comoPlataforma`, `CREATE TEMP TABLE t (a int)`, `CREATE TEMPORARY TABLE superadmins
    (id uuid)` y `SELECT 1 AS a INTO TEMP t` fallan con SQLSTATE `42501`. La revocación la hace una migración nueva
    (no se edita la ya aplicada) y también `db:crear` sobre las bases que crea o encuentra; las dos son idempotentes y
    no quitan `CONNECT`. Si `db:crear` no puede revocar (su usuario no es dueño de la base ni superusuario), termina
    con código 1 y lo explica. _(crítico)_
83. **Regla del SQL de sesión con formas equivalentes** _(ataque ronda 2, F2; complementa el criterio 73)_ _(alcance
    ajustado por los criterios 92 y 98, ataque ronda 3)_. Dado el
    código de `backend/src/` (sin las pruebas), entonces, antes de aplicar las reglas de los criterios 73 y 84, la
    regla normaliza cada texto SQL así: quita los comentarios (como hoy); trata las cadenas `E'…'`, `U&'…'`, `N'…'` y
    las de dólar (`$$…$$`, `$etiqueta$…$etiqueta$`) como `'…'` con su contenido; une las concatenaciones de literales
    (`'ap' || 'p.plataforma'` → `'app.plataforma'`); quita las comillas dobles de los identificadores
    (`"app"."plataforma"` → `app.plataforma`, `"set_config"` → `set_config`, también `U&"…"`); quita los espacios y
    saltos de línea alrededor de `.`; y compara sin distinguir mayúsculas. Con el texto normalizado, `npm run lint`
    falla:
    - fuera de `backend/src/infraestructura/prisma/`, si contiene `SET`, `SET LOCAL` o `SET SESSION` de `app.…`,
      `ROLE` o `SESSION AUTHORIZATION`, o `RESET` de `app.…`, `ROLE`, `SESSION AUTHORIZATION` o `ALL`; por ejemplo
      `SET "app.plataforma" TO 'si'`, `SET LOCAL "app"."plataforma" = 'si'`, `SET app . plataforma = 'si'`,
      `RESET "app.academia_id"`, `SET LOCAL ROLE postgres` o `SET LOCAL SESSION AUTHORIZATION postgres`;
    - fuera de `backend/src/infraestructura/prisma/`, si contiene una llamada a `set_config` (también
      `pg_catalog.set_config` o `"set_config"`, con o sin espacios antes del paréntesis) en la que: el tercer argumento
      no es exactamente la palabra `true` (se rechazan `false`, `'false'`, `'f'`, `'off'`, `'0'`, `false::boolean`,
      `CAST(false AS boolean)`, un parámetro `$1` o un `${…}` de plantilla); el primer argumento no es un literal
      simple `'…'` (un parámetro, un `${…}`, `concat(…)`, `format(…)` o una columna); o el primer literal no empieza
      por `app.` (por ejemplo `'search_path'`, `'role'` o `'session_authorization'`);
    - fuera de `backend/src/infraestructura/prisma/` y de `backend/src/cli/`, si contiene cualquier llamada a
      `set_config`, en cualquiera de esas formas.

    Siguen pasando, por ejemplo, `SELECT current_setting('app.academia_id', true)`, `UPDATE superadmins SET
    intentos_fallidos = 0 WHERE id = $1` y, en `backend/src/cli/`, `SELECT set_config('app.plataforma', 'si', true)`.
    Prueba con la clase `ESLint` y el `eslint.config.mjs` real: un ejemplo que falla por cada forma citada y los que
    pasan. _(crítico; prueba de la regla de lint)_
84. **Más sentencias de sesión y de transacción prohibidas** _(ataque ronda 2, O4 y O5; complementa el criterio 73)_
    _(alcance ajustado por el criterio 92, ataque ronda 3)_ _(alcance ajustado por el criterio 136, ataque ronda 6:
    `SET CONSTRAINTS … { DEFERRED | IMMEDIATE }` pasa)_.
    Dado el código de `backend/src/` (sin las pruebas), fuera de `backend/src/infraestructura/prisma/`, entonces
    `npm run lint` falla si un texto SQL normalizado (criterio 83) contiene:
    - `ALTER ROLE`, `ALTER USER`, `ALTER DATABASE` o `ALTER SYSTEM`;
    - como sentencia (al inicio del texto o después de `;`): `COMMIT`, `END`, `ROLLBACK` (también `ROLLBACK TO`),
      `ABORT`, `SAVEPOINT`, `RELEASE`, `BEGIN` o `START TRANSACTION`;
    - como sentencia, cualquier `SET` o `RESET`, sea de la variable que sea (incluidos `search_path`, `ROLE` y
      `TRANSACTION`);
    - `CREATE TEMP`, `CREATE TEMPORARY`, `CREATE GLOBAL TEMP…`, `CREATE LOCAL TEMP…`, `INTO TEMP` o `INTO TEMPORARY`;
    - `DISCARD`; `UPDATE pg_settings` (también `pg_catalog.pg_settings`); `LISTEN`, `UNLISTEN`, `NOTIFY` o
      `pg_notify(`.

    Siguen pasando `SELECT CASE WHEN a THEN 1 ELSE 0 END FROM t`, `UPDATE academias SET estado = 'ACTIVA' …` y un
    literal de datos como `'commit'` dentro de una consulta. Prueba como en el criterio 83. _(crítico; prueba de la
    regla de lint)_
85. **Ningún otro camino al cliente de la base** _(ataque ronda 2, F3; complementa el criterio 28)_ _(alcance ajustado
    por los criterios 95 y 96, ataque ronda 3)_ _(alcance ajustado por el criterio 113; decisión del orquestador tras la
    ronda 4, 11/11/2026)_. Dado el código de
    `backend/src/` (sin las pruebas), fuera de `backend/src/infraestructura/prisma/` y de `backend/src/cli/`, entonces
    `npm run lint` falla si un archivo llega a un valor de estos módulos: cualquier ruta que contenga
    `generated/prisma`, el archivo de `PrismaService` (`prisma.service`), `pg` (y `pg/…`), `pg-pool`, `@prisma/client`,
    `@prisma/adapter-pg` o cualquier otro `@prisma/…`; por cualquiera de estas vías: `import` de un valor (como hoy),
    `export … from`, `import(…)` dinámico (con cadena o plantilla), `require(…)` o `import x = require(…)`. Además
    falla con `import(…)` o `require(…)` cuyo argumento no es una cadena literal, y con `createRequire` (de `module` o
    `node:module`). Un comentario `eslint-disable` (de línea, de bloque o de archivo, nombre o no reglas) no evita que
    el lint falle por estas reglas ni por las del SQL (criterios 73, 83 y 84). `import type` e `import { type X }`
    siguen permitidos. Prueba con la clase `ESLint` y el `eslint.config.mjs` real, con un ejemplo que falla por cada
    vía y cada módulo (incluidos `import('../generated/prisma/client')`,
    `` import(`../infraestructura/prisma/prisma.service`) ``, `require('pg')` precedido de
    `// eslint-disable-next-line @typescript-eslint/no-require-imports`, `import pg from 'pg'`,
    `import { PrismaPg } from '@prisma/adapter-pg'` e `import { PrismaClient } from '@prisma/client'`) y ejemplos que
    pasan (los tipos, y lo mismo dentro de `infraestructura/prisma/` y `cli/`). _(crítico; prueba de la regla de lint)_

    **Alcance en `cli/` ajustado por el criterio 113** _(decisión del orquestador tras la ronda 4, 11/11/2026)_. "Lo
    mismo dentro de `cli/`" ya no significa que en `cli/` pase cualquier vía. Los dos criterios se contradecían y manda
    el 113, que es posterior y más estricto: en `backend/src/cli/`, el cliente generado (`generated/prisma/*`) y
    `@prisma/…` (`@prisma/client`, `@prisma/client/runtime/*`, `@prisma/adapter-*` y cualquier otro) solo se cargan con
    una importación estática (`import … from '…'`), cuyos nombres sigue el criterio 113, y `Prisma` solo se usa como
    `Prisma.<nombre fijo>` (también con alias o como `G.Prisma.<nombre fijo>`, con las prohibiciones del 92 y del 113).
    Dejan de estar permitidos en `cli/`, y hacen fallar `npm run lint`, por ejemplo:
    - `import('../generated/prisma/client')` y `` import(`../generated/prisma/client`) ``, `import('@prisma/client')`,
      `import('@prisma/client/runtime/library')` e `import('@prisma/adapter-pg')`;
    - `require('../generated/prisma/client')`, `require('@prisma/client')`, `require('@prisma/client/runtime/library')`
      y `require('@prisma/adapter-pg')`;
    - `import G = require('../generated/prisma/client')` e `import P = require('@prisma/client')` (y con cualquier otro
      `@prisma/…`);
    - `import * as Prisma from '../generated/prisma/client'; export const x = Prisma;` (el espacio de nombres exportado
      como valor; criterio 113).

    Siguen pasando en `cli/` las importaciones estáticas que el criterio 113 admite (`import { PrismaClient } from
    '../generated/prisma/client'`, `import { PrismaPg } from '@prisma/adapter-pg'`, `import { Prisma as P } from …` con
    `P.sql`, `import type …`). Para `pg` y `pg-pool` en `cli/` no cambia nada: el 113 no los menciona. Las pruebas del
    criterio 85 que esperaban que esos casos pasaran en `cli/` se ajustan a esta precisión antes de corregir el código:
    los pasan a la lista de los que fallan (o se cubren con la prueba del criterio 113).
86. **`BaseDatos` no entrega el cliente en tiempo de ejecución** _(ataque ronda 2, F3; complementa el criterio 28)_.
    Dada la API de pruebas y `const b = app.get(BaseDatos)`, entonces ni `b['prisma']`, ni ningún valor de
    `Reflect.ownKeys(b)` (propiedades propias, enumerables o no, y símbolos), ni ningún getter de su prototipo, ni las
    propiedades propias de esos valores (un nivel más) es un objeto con alguna de las funciones `$transaction`,
    `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe` o `$connect`. `BaseDatos` guarda el cliente en
    un campo privado real de JavaScript (`#…`), no en una propiedad con `private` de TypeScript. _(crítico)_
87. **Caracteres que se ven en blanco no cuentan como visibles** _(ataque ronda 2, F5; complementa el criterio 77)_.
    Dados `nombre` (crear academia), `motivo` (suspender y reactivar) y `SUPERADMIN_NOMBRE` (comando y semilla),
    entonces, al contar los 3 caracteres visibles del criterio 77, no cuentan los caracteres con la propiedad
    `\p{Default_Ignorable_Code_Point}` (entre ellos U+115F, U+1160, U+3164, U+FFA0, U+180E, U+17B4 y U+17B5) ni U+2800
    (patrón Braille en blanco). Se rechazan con 400 `SOLICITUD_INVALIDA` que nombra el campo (en el comando, código 1),
    sin crear, cambiar ni auditar nada, por ejemplo: `"ㅤㅤㅤ"` (U+3164), `"⠀⠀⠀"` (U+2800), `"ﾠﾠﾠ"` (U+FFA0),
    `"ᅟᅠᅟ"`, `"឴឵឴"`, `"᠎᠎᠎"` y `"abㅤ"` (2 visibles). Se siguen
    aceptando `"Academia Ñandú"`, `"Club 3"` y un nombre en hangul como `"수영 아카데미"`. _(crítico)_
88. **Longitudes por puntos de código en todas partes** _(ataque ronda 2, F6; complementa los criterios 35, 42, 49 y
    52)_. Dados los límites de longitud de esta historia (`correo` hasta 254; `clave` de 1 a 128 al iniciar sesión y
    de 12 a 128 en el comando y la semilla; `nombre` de 3 a 100; `motivo` de 3 a 500; `nombreCorto` de 3 a 30),
    entonces la API, la web (con los esquemas compartidos), el comando y la semilla los cuentan por puntos de código
    (`[...texto].length`), no por unidades UTF-16 (`.length`), después del recorte que corresponda. Por ejemplo:
    - una clave de 6 emojis (12 unidades UTF-16) hace terminar el comando con código 1 nombrando `SUPERADMIN_CLAVE`;
    - una clave de 128 emojis la acepta el comando y con ella se inicia sesión (200); con 129 emojis, el comando
      termina con código 1 y el inicio de sesión responde 400 sin contar un intento;
    - un nombre de 51 emojis se acepta en el comando (`SUPERADMIN_NOMBRE`) y en la API (`nombre` de una academia); uno
      de 101 emojis se rechaza en los dos.

    La semilla valida `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y `SUPERADMIN_CLAVE` con las mismas reglas que el
    comando antes de escribir; si no cumplen, termina con código 1, nombra la variable y no escribe nada. _(crítico)_
89. **`Content-Encoding` no admitido** _(ataque ronda 2, O2; complementa los criterios 74 y 75)_. Dada cualquier ruta
    de `/api` con método `POST`, `PUT`, `PATCH` o `DELETE` y cuerpo (como en el criterio 74), entonces se admiten sin
    `Content-Encoding` o con un único valor `identity`, `gzip` o `deflate` (sin distinguir mayúsculas, con espacios en
    los extremos). Cualquier otro valor (`br`, `zstd`, `compress`, `x-gzip`, una lista como `gzip, identity`, o vacío)
    responde **400 `SOLICITUD_INVALIDA`** con `detalles: { errores: [{ campo: "", mensaje }] }` y `Cache-Control:
    no-store`, sin interpretar el cuerpo; ninguna respuesta de `/api` es 415. Un cuerpo `gzip` o `deflate` corrupto
    responde 400 `SOLICITUD_INVALIDA`; el límite de 100 KB del criterio 75 se aplica al cuerpo **descomprimido**: uno
    que, descomprimido, pasa de 102 400 bytes responde 413 `CARGA_EXCESIVA` aunque comprimido sea pequeño. En
    `POST /api/plataforma/sesion`, todas estas respuestas cuentan para el límite por IP (criterio 75) y no calculan
    ningún hash ni cuentan un intento; un JSON válido comprimido con `gzip` se atiende como sin comprimir. En las rutas
    que exigen sesión, sin sesión válida sigue respondiendo 401 antes de mirar el cuerpo (P-7). _(crítico)_
90. **Contexto completo también en los comandos y la semilla** _(ataque ronda 2, O6; complementa el criterio 72)_.
    Dada una transacción de plataforma abierta por un comando o por la semilla (`enPlataforma` de
    `backend/src/cli/conexion.ts`, o la que la reemplace), entonces su primera sentencia fija los dos valores con
    `set_config(…, true)`: `app.academia_id` en `''` y `app.plataforma` en `si`. Prueba: con
    `crearClienteDelDueno(url)` sobre la base de pruebas y la URL del dueño con
    `?options=-c app.academia_id=<id de A> -c app.plataforma=no` (codificado), dentro de `enPlataforma`
    `current_setting('app.academia_id', true)` es `''` y `current_setting('app.plataforma', true)` es `si`; y, si el
    dueño no es superusuario (la nube), `auditoria` y `configuraciones` devuelven 0 filas. Toda transacción de
    academia que agregue un comando en el futuro fija también los dos valores. Contrato para la prueba:
    `crearClienteDelDueno(url: string): PrismaClient` y `enPlataforma(cliente, trabajo)` exportados de
    `backend/src/cli/conexion.ts`. _(crítico)_
91. **Ningún secreto de prueba válido en producción queda en el repositorio** _(ataque ronda 2, O1; complementa el
    criterio 79)_. Dadas las pruebas del repositorio (`backend/test/`, `**/*.test.ts`, `**/*.test.mjs`, `e2e/`),
    entonces todo secreto de firma que cumpla las reglas de producción del criterio 79 (fuera de la lista de secretos
    públicos, 32 o más puntos de código, sin espacios y con 10 o más distintos), se use como `JWT_SECRETO` o para
    firmar un token (por ejemplo, la opción `secreto` de `firmarTokenPlataforma`), se genera al ejecutar (por ejemplo,
    `randomBytes(32).toString('base64url')`) y no está escrito en el repositorio. Los secretos fijos que quedan son
    los de la lista del criterio 79 o los que producción rechaza. Lo aplica el test-writer (por ejemplo, en
    `backend/test/integracion/plataforma/sesion.test.ts`). _(crítico; verificación del revisor)_

### L. Correcciones del ataque adversarial, ronda 3

Criterios agregados tras la ronda 3 del ataque (11/11/2026). Son decisiones técnicas de seguridad, no reglas de
negocio nuevas. Los criterios 92 a 97 cambian el diseño de las reglas de lint: analizar como SQL **todo** literal de
`backend/src` bloqueaba código legítimo (`stream.on('end')`, `'Set-Cookie'`, textos de interfaz) y aun así se evadía
(`U&"…" UESCAPE`, una expresión regular pasada a `$queryRawUnsafe`). Ahora el SQL solo puede llegar a la base en
plantillas etiquetadas, y solo ese texto se analiza. Donde un criterio reemplaza el alcance de uno anterior lo dice, y
el anterior queda marcado "(alcance ajustado por el criterio N, ataque ronda 3)", sin borrar su texto. Contratos
nuevos: precisiones P-19 a P-24. Todos son _(crítico)_.

92. **El SQL solo llega a la base en plantillas etiquetadas** _(ataque ronda 3, O1, F1 y F4; **reemplaza el alcance**
    de los criterios 73, 83 y 84 en cuanto a qué texto se analiza)_ _(alcance ajustado por los criterios 110 y 112,
    ataque ronda 4: qué archivos de prueba se eximen y qué `sql` y `Prisma.sql` se aceptan como argumento)_. Dado el
    código de `backend/src/` (sin las pruebas:
    `*.test.*` y `backend/test/`), fuera de `backend/src/infraestructura/prisma/` (también en `backend/src/cli/`),
    entonces `npm run lint` falla si:
    - se nombra `$queryRawUnsafe` o `$executeRawUnsafe` de cualquier forma: acceso con punto, acceso con corchetes y un
      literal (`cliente['$executeRawUnsafe']`), desestructuración (`const { $queryRawUnsafe } = cliente`) o una cadena o
      plantilla cuyo texto contiene alguno de esos dos nombres;
    - `$queryRaw` o `$executeRaw` se usan de otra forma que como etiqueta directa de una plantilla
      (`` cliente.$queryRaw`…` ``) o como llamada cuyo único argumento es una plantilla etiquetada con `Prisma.sql` o
      `sql` (`` cliente.$queryRaw(Prisma.sql`…`) ``); por ejemplo: guardados en una variable
      (`const q = cliente.$queryRaw`), con corchetes, desestructurados, con `.call`, `.apply` o `.bind`, o llamados con
      una variable, una cadena, un arreglo o el resultado de otra función;
    - `Prisma.sql` o `sql` se llaman como función (`Prisma.sql(['…'])`) en lugar de usarse como etiqueta;
    - se usa como valor `Prisma.raw`, `Prisma.Sql` (por ejemplo `new Prisma.Sql(['…'], [])`) o `Prisma.join` con más de
      un argumento (su separador entra como SQL), o las funciones `raw` y `join` o la clase `Sql` importadas de
      `generated/prisma` o de `@prisma/…`, con cualquier alias. `Prisma.Sql` como tipo sigue permitido.

    Las reglas del SQL de sesión (criterios 73, 83, 84, 93 y 94) se aplican **solo** al texto de las plantillas
    etiquetadas con `$queryRaw`, `$executeRaw`, `Prisma.sql` o `sql` (con un marcador en lugar de cada `${…}`, como
    hasta ahora); ya no a cadenas, plantillas sin etiqueta, expresiones regulares ni plantillas con otra etiqueta
    (`String.raw`). Pasan el lint en un módulo, por ejemplo: `stream.on('end', …)`,
    `signal.addEventListener('abort', …)`, `res.setHeader('Set-Cookie', …)`, `const evento = 'release'`,
    `const accion = 'commit'`, `throw new Error('No se pudo hacer reset de la clave')`, `'Haz commit de los cambios'`,
    `/SET ROLE/i` y `` String.raw`SET ROLE x` ``. Fallan, por ejemplo: `` tx.cliente.$queryRaw`SET LOCAL ROLE postgres` ``,
    `tx.cliente.$queryRawUnsafe(/SET ROLE postgres/.source)`, `tx.cliente.$executeRaw(consulta)`,
    `` const q = tx.cliente.$queryRaw; await q`SELECT 1` `` y, en `cli/`, `cliente.$executeRaw(Prisma.raw('RESET ALL'))`
    y `Prisma.join(ids, '; RESET ALL; ')`. Siguen pasando `` tx.cliente.$queryRaw`SELECT … WHERE id = ${id}::uuid` `` y,
    en `cli/`, `` cliente.$queryRaw(Prisma.sql`SELECT 1`) ``. Prueba con la clase `ESLint`, con `eslint.config.mjs` y con
    la configuración del paso protegido (criterio 96): un ejemplo que falla por cada forma y los que pasan.
    _(crítico; prueba de la regla de lint)_
93. **`UESCAPE` en la normalización** _(ataque ronda 3, F1 y F4; complementa el criterio 83)_. Dado el texto de una
    plantilla analizada (criterio 92), entonces la normalización del criterio 83 decodifica también `U&"…" UESCAPE 'x'`
    y `U&'…' UESCAPE 'x'` con el carácter de escape `x` en lugar de `\` (`x0041`, `x+000041` y `xx` para el propio
    carácter), sin distinguir mayúsculas en `UESCAPE` y con espacios, saltos de línea o comentarios SQL entre la cadena,
    `UESCAPE` y su literal. Así fallan, por ejemplo, `` SELECT U&"set!005fconfig" UESCAPE '!'('app.plataforma', 'si', false) ``,
    `` SELECT U&"pg#005fterminate#005fbackend" UESCAPE '#'(1) `` y
    `` SET U&"app!002eplataforma" /* x */ uescape '!' TO 'si' ``. Un `UESCAPE` cuyo literal no es un solo carácter
    válido para PostgreSQL (vacío, de más de un carácter, un dígito hexadecimal, `+`, `'`, `"` o un espacio) hace fallar
    el lint. _(crítico; prueba de la regla de lint y de `normalizarSql`)_
94. **Cursores, sentencias preparadas, objetos grandes y bloqueos de sesión** _(ataque ronda 3, F6 y O2; complementa
    el criterio 84)_ _(complementado por el criterio 136, ataque ronda 6: `lastval` y `currval`)_. Dado el texto normalizado de una plantilla analizada (criterio 92), fuera de
    `backend/src/infraestructura/prisma/` (también en `cli/`), entonces `npm run lint` falla si contiene:
    - como sentencia (al inicio del texto o después de `;`): `DECLARE`, `CLOSE`, `FETCH`, `MOVE`, `PREPARE`, `EXECUTE`,
      `DEALLOCATE` o `DO`;
    - en cualquier parte: `WITH HOLD`; `ALTER DEFAULT PRIVILEGES` (además de `ALTER ROLE`, `ALTER USER`,
      `ALTER DATABASE` y `ALTER SYSTEM`, que ya estaban); o una llamada, con o sin `pg_catalog.` y con o sin espacios
      antes del paréntesis, a una función de objetos grandes (`lo_…(`, `loread(`, `lowrite(`), a `pg_advisory_lock`,
      `pg_advisory_lock_shared`, `pg_try_advisory_lock`, `pg_try_advisory_lock_shared`, `pg_advisory_unlock`,
      `pg_advisory_unlock_shared` o `pg_advisory_unlock_all` (bloqueos de sesión), o a `pg_terminate_backend` o
      `pg_cancel_backend`.

    Siguen pasando `` SELECT pg_advisory_xact_lock(${clave}) `` y `` SELECT pg_try_advisory_xact_lock(${clave}) `` (los
    bloqueos de transacción, que el aforo y la caja podrán usar), `SELECT … WHERE accion = 'FETCH'`,
    `UPDATE t SET estado = 'CLOSE' WHERE …` y `SELECT move FROM t`. Prueba como en el criterio 92. _(crítico; prueba
    de la regla de lint)_
95. **Reglas de acceso en todas las extensiones, rutas a `node_modules`, `cli/` e internos de
    `infraestructura/prisma/`** _(ataque ronda 3, F2 y O1; **reemplaza el alcance** de archivos y de módulos del
    criterio 85 y complementa el 28)_ _(alcance ajustado por los criterios 110, 111, 118 y 119, ataque ronda 4:
    exenciones exactas, rutas reales, `generated/prisma/` y `.jsx`)_. Dado el código de `backend/src/` (sin las pruebas),
    entonces:
    - las reglas de los criterios 28 y 85 y las del SQL (73, 83, 84 y 92 a 94) se aplican a los archivos
      `backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}`, no solo a `.ts`;
    - un especificador de módulo que, con `\` cambiada por `/`, contiene `node_modules/` seguido de un paquete
      prohibido del criterio 85 (`pg`, `pg/…`, `pg-pool`, `@prisma/…`) o de `.prisma/…` cuenta como ese paquete,
      también como ruta absoluta o URL `file:`; por ejemplo `require('../../node_modules/pg')`,
      `import('../../../node_modules/@prisma/client/index.js')` o
      `import('file:///srv/app/node_modules/pg-pool/index.js')`;
    - fuera de `backend/src/cli/`, el lint falla con cualquier importación (de valor o de tipo, por cualquiera de las
      vías del criterio 85) de un archivo de `backend/src/cli/`, con la ruta resuelta respecto del archivo que importa;
      por ejemplo `import { crearClienteDelDueno } from '../../cli/conexion'` o `require('../cli/conexion.js')`;
    - fuera de `backend/src/infraestructura/prisma/` (también en `cli/`), el lint falla con cualquier importación de un
      archivo de esa carpeta que no sea su `index` (se aceptan `…/infraestructura/prisma` y
      `…/infraestructura/prisma/index`, con o sin extensión); por ejemplo `…/infraestructura/prisma/prisma.service`,
      `…/base-datos` o `…/tipos`.

    Siguen pasando, en un módulo, `import { BaseDatos } from '../../infraestructura/prisma'` e
    `import type { ClienteTransaccion } from '../infraestructura/prisma/index'`; y en `cli/`,
    `import { PrismaPg } from '@prisma/adapter-pg'` e `import { PrismaClient } from '../generated/prisma/client'`.
    Prueba con la clase `ESLint`: un ejemplo que falla por cada extensión y por cada vía, y los que pasan. _(crítico;
    prueba de la regla de lint)_
96. **Un paso de lint que ningún comentario apaga** _(ataque ronda 3, O1; **reemplaza** la precisión P-15 y la frase
    del criterio 85 sobre `eslint-disable`)_ _(alcance ajustado por los criterios 111 y 118, ataque ronda 4: el paso
    protegido comprueba además enlaces simbólicos y `generated/` antes de ESLint)_. Dado el repositorio, entonces:
    - `eslint.config.mjs` ya no fija `linterOptions.noInlineConfig` para `backend/src`: en el lint normal, un comentario
      `eslint-disable` vuelve a apagar la regla que nombra;
    - hay una configuración aparte para el paso protegido (por ejemplo `eslint.protegido.config.mjs` en la raíz) con
      solo el analizador de TypeScript y las reglas de los criterios 28, 73, 83, 84, 85 y 92 a 95, sobre los archivos
      del criterio 95, y ninguna otra regla;
    - `npm run lint` ejecuta `eslint . --max-warnings 0` y además ese paso con `--no-inline-config` sobre
      `backend/src` (por ejemplo `eslint --no-inline-config --config eslint.protegido.config.mjs --max-warnings 0
      backend/src`), y falla si falla cualquiera de los dos; la integración continua (Linux y Windows) lo ejecuta con
      `npm run lint`.

    Prueba: con la clase `ESLint`, la configuración del paso protegido y `allowInlineConfig: false`, un módulo con
    `require('pg')` o con `` tx.cliente.$queryRaw`SET ROLE postgres` ``, precedidos de `// eslint-disable-next-line`,
    de `/* eslint-disable */` o de `/* eslint … off */` (con y sin nombre de regla), sigue dando error; con
    `eslint.config.mjs`, un `// eslint-disable-next-line @typescript-eslint/no-explicit-any` en un archivo de
    `backend/src` apaga esa regla; y el script `lint` de `package.json` incluye el paso con `--no-inline-config`.
    _(crítico; prueba de la configuración de lint y verificación del revisor)_
97. **Solo se compila lo que el lint revisa** _(ataque ronda 3, O1; complementa el criterio 95)_. Dados
    `backend/tsconfig.build.json` y los `tsconfig` de los que hereda, entonces ninguno activa `allowJs`, así que la
    compilación del backend solo toma `.ts`, `.tsx`, `.mts` y `.cts`; y como `tsx` (comandos y desarrollo) también
    ejecuta `.js`, `.mjs` y `.cjs`, las reglas cubren todas esas extensiones (criterio 95). Prueba: lee los `tsconfig`
    y comprueba que ninguno tiene `allowJs: true`; y un archivo `.mjs` y otro `.cts` de `backend/src/modulos/` con
    `import pg from 'pg'` hacen fallar el paso protegido. _(crítico; prueba de configuración)_
98. **Zona horaria de la sesión fija en UTC** _(ataque ronda 3, F3; complementa los criterios 72 y 90)_ _(alcance
    ajustado por el criterio 107, ataque ronda 4: la primera sentencia fija también los parámetros de formato y la
    excepción de `cli/` los admite)_. Dado que
    `@prisma/adapter-pg` envía las fechas sin desfase y descarta el desfase al leerlas, entonces toda transacción de
    `BaseDatos` (`conAcademia`, `comoPlataforma` y `resolverAcademia`) y de `enPlataforma` (comandos y semilla) fija
    `TimeZone` en `UTC`, local a la transacción, en la misma primera sentencia que fija el contexto, antes de
    `trabajo`; dentro de `trabajo`, `current_setting('TimeZone')` es `UTC`. Con la API de pruebas en
    `DATABASE_POOL_MAX=1`, un `RelojFijo` en un instante que en America/Lima cae en otro día (por ejemplo
    `2026-11-12T03:30:00.000Z`) y cada una de estas condiciones: (a) un `trabajo` anterior, en la misma conexión,
    ejecutó `set_config('TimeZone', 'America/Lima', false)` y confirmó; (b) `DATABASE_URL_APP` lleva
    `?options=-c TimeZone=Pacific/Kiritimati` (codificado); (c) la base de pruebas tiene
    `ALTER DATABASE … SET TimeZone = 'America/Lima'` (si el dueño puede; si no, se omite con aviso; se restaura con
    `RESET`); entonces:
    - `creada_en` (crear academia), `suspendida_en` (suspender), `fecha_hora` de `auditoria_plataforma` y de
      `auditoria`, `ultimo_acceso` (inicio de sesión correcto) y `bloqueado_hasta` (5.º fallo: el instante más 15
      minutos), leídos como dueño con `pg` (que respeta el desfase), coinciden al milisegundo con el instante de
      `RELOJ`;
    - la API los devuelve sin desfase: `creadaEn` y `suspendidaEn` son el instante de `RELOJ` en ISO 8601 UTC; y el
      bloqueo dura exactamente 15 minutos (a los 14:59 sigue en 423 y a los 15:00 la clave correcta entra);
    - un valor que pone la base (`SELECT now()` con `tx.cliente.$queryRaw`, o una columna con valor por defecto `now()`)
      llega como un `Date` a menos de 5 segundos del instante real.

    En los comandos: con `crearClienteDelDueno` y la URL del dueño con `?options=-c TimeZone=Pacific/Kiritimati`,
    dentro de `enPlataforma` `current_setting('TimeZone')` es `UTC` y `SELECT now()` llega a menos de 5 segundos del
    instante real; y `npm run plataforma:superadmin` con esa URL deja la `fecha_hora` de `SUPERADMIN_CREADO` a menos de
    5 segundos del instante real (leída como dueño con `pg`). Un rol de la app con `TimeZone` propio
    (`ALTER ROLE … SET`) no llega a esto: lo rechaza el criterio 103. Para que `enPlataforma` lo fije, en
    `backend/src/cli/` la regla del criterio 83 admite además exactamente `set_config('TimeZone', 'UTC', true)` (sin
    distinguir mayúsculas en el nombre de la variable); fuera de `cli/` y de `infraestructura/prisma/` sigue prohibida
    toda llamada a `set_config`. _(crítico)_
99. **La API no guarda en su entorno las conexiones del dueño** _(ataque ronda 3, F2; complementa los criterios 5 y
    95)_ _(alcance ajustado por los criterios 116 y 117, ataque ronda 4: sin distinguir mayúsculas, y sin `.env` al
    alcance de los módulos)_. Dada la API arrancada con su punto de entrada real (`backend/src/main.ts`), con `DATABASE_URL`,
    `DATABASE_URL_PRUEBAS`, `PGUSER`, `PGPASSWORD` y `SUPERADMIN_CLAVE` definidas en el entorno o en el `.env`, entonces,
    cuando ya atiende (`GET /api/salud` responde), `process.env` no tiene ninguna variable cuyo nombre empiece por
    `DATABASE_URL` salvo `DATABASE_URL_APP`, ninguna que empiece por `PG` (las que `pg` toma como valores por defecto
    de conexión) ni `SUPERADMIN_CLAVE`; `DATABASE_URL_APP`, `JWT_SECRETO` y las demás siguen. Las retira
    `retirarVariablesSensibles(env)` (precisión P-21), que `main.ts` llama con `process.env` después de
    `validarEntorno` y antes de crear la aplicación; no lo hacen `configurarApp` ni `crearAppDePruebas`, para no quitarle
    las variables al proceso de las pruebas. La parte estática (que ningún módulo importe `cli/`) es el criterio 95.
    Prueba: unitaria de la función (quita exactamente esas variables de un objeto y deja las demás) y de integración que
    arranca la API real como proceso hijo (con `tsx`) con un módulo de prueba precargado (`--import`) que, al recibir un
    mensaje por IPC, responde con los nombres de las variables de `process.env`. _(crítico)_
100. **`trabajo` recibe un envoltorio, no el cliente** _(ataque ronda 3, F5; complementa los criterios 28 y 86)_
     _(complementado por los criterios 106, 112 y 114, ataque ronda 4: lo que devuelve el envoltorio son promesas nativas,
     y solo acepta plantillas, fragmentos del punto autorizado o `Sql` de Prisma)_ _(complementado por el criterio 134,
     ataque ronda 6: el envoltorio solo responde dentro del contexto asíncrono de su `trabajo`)_. Dada la API de pruebas, entonces:
     - dentro de `trabajo` de `conAcademia` y de `comoPlataforma`, `tx.cliente` es un objeto armado por `BaseDatos`
       (envoltorio) que solo tiene `$queryRaw`, `$executeRaw` y un objeto por cada modelo de Prisma con sus operaciones
       (`findMany`, `create`, …); `$queryRaw` y `$executeRaw` funcionan como etiqueta de plantilla y con `Prisma.sql`, y
       todo corre en la misma transacción;
     - `tx.cliente.$parent`, `tx.cliente._originalClient`, `.$transaction`, `.$queryRawUnsafe`, `.$executeRawUnsafe`,
       `.$connect`, `.$disconnect`, `.$on` y `.$extends` son `undefined`;
     - recorriendo `tx`, `tx.cliente`, sus propiedades propias y las propiedades propias de cada una (con
       `Reflect.ownKeys`: enumerables o no, y símbolos; los getters se leen), ningún valor es un objeto o función con
       alguna de las propiedades `$transaction`, `$queryRawUnsafe`, `$executeRawUnsafe`, `$connect`, `$disconnect`,
       `$on`, `$extends`, `$parent` o `_originalClient`; ninguna clave empieza por `_`; y el prototipo de cada objeto
       recorrido es `Object.prototype`, `Function.prototype` o `null`;
     - el cliente de Prisma (`PrismaService` o como se llame) no es un proveedor de Nest: recorriendo todos los módulos
       del contenedor (`app.get(ModulesContainer)`, sus `providers` y la `instance` de cada uno) y los `providers` de
       los metadatos de cada módulo (`Reflect.getMetadata('providers', …)`, incluido `PrismaModule`), ni la instancia,
       ni `app.get(token, { strict: false })`, ni `moduleRef.get(token, { strict: false })` es, para ningún token, un
       objeto con las funciones `$transaction` o `$queryRawUnsafe`, ni uno que las tenga en una propiedad propia (un
       nivel); y `Reflect.getMetadata('design:paramtypes', BaseDatos)` no contiene una clase cuyo prototipo tenga
       `$transaction`;
     - los métodos de `BaseDatos` que usan el cliente sin envoltorio son privados reales (`#…`); `BaseDatos.prototype`
       está congelado (`Object.isFrozen`) y sus claves propias son solo `constructor`, `conAcademia`,
       `comoPlataforma`, `resolverAcademia`, `comprobarConexion` y, si existe, `onModuleDestroy`.

     Tipo del envoltorio: precisión P-24. _(crítico)_
101. **Ningún cursor sobrevive entre transacciones** _(ataque ronda 3, F6; complementa los criterios 23 y 72)_. Dada
     la API de pruebas con `DATABASE_POOL_MAX=1` y datos en A y B, cuando un `trabajo` de `conAcademia(A, …)` declara
     cursores que sobreviven a la transacción (`DECLARE c CURSOR WITH HOLD FOR SELECT * FROM auditoria` y otro sobre
     `configuraciones`) y confirma, entonces en el siguiente `conAcademia(B, …)` y en un `comoPlataforma` posterior, al
     empezar `trabajo`, no queda ningún cursor: `SELECT count(*) FROM pg_cursors` es 0 y `FETCH ALL FROM c` falla con
     SQLSTATE `34000`, sin devolver filas de A. Cada transacción de `BaseDatos` (también la de `resolverAcademia`,
     antes de llamar a `resolver_academia`; esta, por revisión) ejecuta `CLOSE ALL` después de fijar el contexto y
     antes de `trabajo`. Lo mismo en `enPlataforma`: un cursor `WITH HOLD` declarado en una transacción no existe en la
     siguiente del mismo cliente (con `crearClienteDelDueno(url, { max: 1 })`, precisión P-23). El lint prohíbe
     declarar cursores en el código (criterio 94). _(crítico)_
102. **Ningún privilegio de tabla de más** _(ataque ronda 3, O3; complementa los criterios 2, 80 y 81)_
     _(complementado por el criterio 125, ataque ronda 5: casos de vista y vista materializada)_ _(alcance ampliado por el
     criterio 130, ataque ronda 6: todos los esquemas que no son del sistema, funciones y `USAGE` de esquemas)_. Dada la
     comprobación del rol (en la API, la del criterio 80; en `npm run db:crear`, sobre la base de desarrollo y la de
     pruebas), entonces calcula los privilegios efectivos de `aquagestion_app` (concedidos al rol o a `PUBLIC`) sobre
     cada tabla, tabla particionada, vista, vista materializada, tabla foránea y secuencia del esquema `public`: a
     nivel de tabla (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` y `TRIGGER`; en las secuencias,
     `USAGE`, `SELECT` y `UPDATE`) y a nivel de columna (`SELECT`, `INSERT`, `UPDATE` y `REFERENCES`); y los compara
     con la lista permitida del criterio 2 (`PRIVILEGIOS_APP`, precisión P-20). Un privilegio de columna se permite si
     está permitido para la tabla entera o para esa columna. Cualquier privilegio de más hace que la API rechace con
     `ErrorRolBaseDatosInseguro` como en el criterio 4 (el log nombra la tabla y el privilegio) y que `db:crear`
     termine con código 1 con un mensaje que nombra la tabla, el privilegio y la corrección
     (`REVOKE TRUNCATE ON auditoria FROM aquagestion_app;`, o `FROM PUBLIC` si viene de ahí), sin modificar nada. Un
     privilegio que falta no lo rechaza esta comprobación (lo prueba el criterio 2). Con las migraciones de esta
     historia y nada más, la comprobación pasa. Prueba de integración (el dueño de las tablas puede conceder, también
     en la nube), con una API nueva por caso y restaurando al final: `GRANT TRUNCATE ON auditoria`,
     `GRANT DELETE ON configuraciones`, `GRANT UPDATE ON auditoria_plataforma`, `GRANT UPDATE ON academias` (toda la
     tabla), `GRANT UPDATE (nombre_corto) ON academias`, `GRANT UPDATE (clave_hash) ON superadmins`,
     `GRANT REFERENCES ON superadmins`, `GRANT TRIGGER ON auditoria`, `GRANT SELECT ON _prisma_migrations` y
     `GRANT UPDATE ON auditoria TO PUBLIC`, todos a `aquagestion_app` salvo el último; en cada caso `conAcademia`,
     `comoPlataforma` y `resolverAcademia` rechazan. En `db:crear`, al menos los casos de `TRUNCATE` y de `PUBLIC`.
     Prueba unitaria de `privilegiosDeMas` y prueba de que la lista de la API y la de `scripts/lib/rol-app.mjs` son
     iguales. Toda historia que agregue una tabla amplía `PRIVILEGIOS_APP` en su especificación, como la lista del
     criterio 10. _(crítico)_
103. **El rol de la app sin valores por defecto propios** _(ataque ronda 3, O2; complementa los criterios 80 y 81)_.
     Dada la comprobación del rol (API y `db:crear`), entonces rechaza el rol si tiene valores por defecto propios:
     `pg_roles.rolconfig` no vacío (`ALTER ROLE aquagestion_app SET …`) o alguna fila de `pg_db_role_setting` con
     `setrole` igual a su oid, en cualquier base (`ALTER ROLE aquagestion_app IN DATABASE … SET …`). La API rechaza con
     `ErrorRolBaseDatosInseguro` (criterio 4); `db:crear` termina con código 1, nombra la condición y la corrección
     (`ALTER ROLE aquagestion_app RESET ALL;` o `ALTER ROLE aquagestion_app IN DATABASE <base> RESET ALL;`) y no cambia
     nada. Los valores por defecto de la base para todos los roles (`ALTER DATABASE … SET`, `setrole = 0`) no cuentan:
     los neutraliza cada transacción (criterios 72 y 98). Prueba de integración, conectado **como la app** (el propio
     rol puede fijarse valores: ese es el ataque), con una API nueva por caso: `ALTER ROLE aquagestion_app SET
     statement_timeout = '1min'`, `… SET row_security = off`, `… SET search_path = pg_temp, public` y
     `ALTER ROLE aquagestion_app IN DATABASE <base de pruebas> SET TimeZone = 'America/Lima'` (si el servidor no lo
     permite, ese caso se omite con aviso); se restaura con `RESET ALL` al final. Prueba unitaria de las funciones que
     deciden (precisión P-19). _(crítico)_
104. **La contraseña de los roles nunca viaja en claro** _(ataque ronda 3, O4; complementa los criterios 6, 8 y 81)_.
     Dadas las sentencias que fijan una contraseña en `npm run db:crear` y en el hook de sesión (el `CREATE ROLE` de
     `aquagestion_app` y, en la nube, el del dueño `aquagestion`), entonces la contraseña se envía como verificador
     SCRAM-SHA-256 calculado en el cliente con `node:crypto`
     (`PASSWORD 'SCRAM-SHA-256$4096:<sal>$<StoredKey>:<ServerKey>'`, con sal aleatoria de 16 bytes y los tres valores
     en base64, según RFC 5802 y RFC 7677), nunca en claro: el texto de la sentencia no contiene la contraseña, ni
     escapada ni codificada como en la URL. Si la contraseña tiene caracteres fuera de ASCII imprimible (U+0020 a
     U+007E), `db:crear` termina con código 1 y el paso del hook falla, nombrando la variable (`DATABASE_URL_APP` o
     `DATABASE_URL`) sin mostrar la contraseña: PostgreSQL normaliza con SASLprep y el verificador podría no coincidir.
     Prueba: unitaria de `verificadorScram` (precisión P-22; formato y valores recalculados en la prueba con las
     fórmulas de RFC 5802) y de las funciones que arman las sentencias (contienen `SCRAM-SHA-256$4096:` y no la
     contraseña, también con una que tiene comillas, `$$` y `\`); de integración donde se puedan crear roles (Docker y
     CI): tras `db:crear`, `pg_authid.rolpassword` del rol empieza por `SCRAM-SHA-256$` y la app se conecta con su
     contraseña; en la nube, verificación del tester tras el hook. _(crítico)_
105. **Cuerpos con UTF-8 inválido** _(ataque ronda 3, O5; complementa los criterios 42, 74 y 76)_. Dada cualquier ruta
     de `/api` con cuerpo JSON (criterio 74), cuando el cuerpo, ya descomprimido (criterio 89), no es UTF-8 válido (por
     ejemplo, contiene `0xFF`, `0xC3 0x28`, una secuencia demasiado larga como `0xC0 0xAF`, un sustituto codificado
     como `0xED 0xA0 0x80` o una secuencia cortada al final como `0xE2 0x82`, dentro o fuera de una cadena JSON),
     entonces responde 400 `SOLICITUD_INVALIDA` con `detalles: { errores: [{ campo: "", mensaje }] }` y
     `Cache-Control: no-store`, sin interpretar el cuerpo ni escribir nada: nunca guarda U+FFFD en su lugar. En
     `POST /api/plataforma/sesion` cuenta para el límite por IP (criterio 75) y no calcula ningún hash ni cuenta un
     intento; en `POST /api/plataforma/academias`, `…/suspender` y `…/reactivar` no crea, no cambia ni audita nada. Un
     cuerpo UTF-8 válido que trae U+FFFD escrito por el cliente sigue las reglas de texto de siempre. _(crítico)_

### M. Correcciones del ataque adversarial, ronda 4

Criterios agregados tras la ronda 4 del ataque (11/11/2026, sobre el commit `066c9af`). Son decisiones técnicas de
seguridad, no reglas de negocio nuevas. Donde un criterio ajusta el alcance de uno anterior lo dice, y el anterior queda
marcado "(alcance ajustado por el criterio N, ataque ronda 4)", sin borrar su texto. Contratos nuevos: precisiones P-25 a
P-28. Todos son _(crítico)_.

106. **El envoltorio solo entrega promesas nativas que corren dentro de la transacción** _(ataque ronda 4, F1;
     complementa los criterios 21, 72 y 100)_ _(complementado por el criterio 134, ataque ronda 6: una llamada desde otro
     contexto asíncrono rechaza aunque la transacción siga abierta)_. Dada la API de pruebas, dentro de `trabajo` de `conAcademia` y de
     `comoPlataforma`, entonces:
     - todo lo que devuelven `tx.cliente.$queryRaw`, `tx.cliente.$executeRaw` y cada operación de cada delegado
       (`findMany`, `create`, … la lista del plan) es una promesa nativa: `Object.getPrototypeOf(p) === Promise.prototype`,
       `Reflect.ownKeys(p)` está vacío, `p.requestTransaction` es `undefined`, `p.then`, `p.catch` y `p.finally` son los de
       `Promise.prototype`, y no hay ninguna otra propiedad que lleve al motor de Prisma (tampoco la API fluida de
       relaciones, `findUnique(…).relacion()`);
     - la consulta se envía al llamar la función (no espera a un `then`) y corre en la conexión y en la transacción de
       `trabajo`, con su contexto (criterios 72, 98, 101 y 107);
     - una función del envoltorio guardada y llamada cuando `trabajo` ya terminó (con éxito o con error) rechaza sin
       enviar nada a la base.

     Prueba de integración con `DATABASE_POOL_MAX=2` (para que haya otra conexión en el pool), `DATABASE_URL_APP` con
     `options` contaminadas (`-c app.academia_id=<id de A> -c app.plataforma=si -c TimeZone=Pacific/Kiritimati`,
     codificadas) y los datos de `crearDatosDeAislamiento`. Dentro de `conAcademia(B, …)`, la primera consulta toma
     `pg_backend_pid()`; después, por `$queryRaw`, por `$executeRaw` (una escritura que guarda `pg_backend_pid()` y
     `current_setting('app.academia_id')` en una fila de `configuraciones` de B, leída después) y por un delegado de
     lectura y otro de escritura, y también en 20 consultas lanzadas a la vez con `Promise.all`, la consulta ve el mismo
     `pg_backend_pid()`, `app.academia_id` igual a B y solo filas de B. Cada valor devuelto cumple la primera viñeta (el
     camino del ataque, `p.requestTransaction({ kind: 'batch', … })`, no existe). Si `trabajo` escribe por cada forma y
     luego lanza un error, ninguna de esas filas queda (leído como dueño con `pg`). En `comoPlataforma`, una función
     guardada de `$queryRaw` llamada después de terminar, con `SELECT clave_hash FROM superadmins` o con una lectura de
     `auditoria` de A, rechaza y no devuelve filas; y un `$executeRaw` guardado y llamado después no escribe nada.
     _(crítico)_
107. **Parámetros de formato fijos en cada transacción** _(ataque ronda 4, F2; complementa los criterios 72, 90 y 98;
     **amplía** la excepción de `cli/` del criterio 98)_ _(excepción de `cli/` ampliada por los criterios 121 y 122, ataque
     ronda 5: `search_path`, `standard_conforming_strings` y la forma con `pg_catalog.`)_. Dado que el adaptador de Prisma interpreta el texto que
     devuelve PostgreSQL y que ese texto depende de la sesión, entonces toda transacción de `BaseDatos` (`conAcademia`,
     `comoPlataforma` y `resolverAcademia`) y de `enPlataforma` fija, local a la transacción (`set_config(…, true)`) y en
     la misma primera sentencia que fija el contexto y `TimeZone` (criterio 98), antes de `trabajo`:
     `DateStyle = 'ISO, MDY'`, `IntervalStyle = 'postgres'`, `extra_float_digits = '1'` (el valor por defecto de
     PostgreSQL 12 o posterior, con el que el adaptador lee los `float8` sin pérdida) y `bytea_output = 'hex'`. Dentro de
     `trabajo`, `current_setting` de cada uno da exactamente esos valores. Con la API de pruebas en `DATABASE_POOL_MAX=1`,
     un `RelojFijo` y cada una de estas vías de contaminación de los cuatro parámetros (por ejemplo `DateStyle` en
     `SQL, DMY` o `German`, `IntervalStyle` en `iso_8601`, `extra_float_digits` en `-15` y `bytea_output` en `escape`):
     (a) un `trabajo` anterior en la misma conexión que ejecutó `set_config(…, false)` y confirmó; (b) `options` en
     `DATABASE_URL_APP`; (c) `ALTER DATABASE <base de pruebas> SET …` (si el dueño puede; si no, se omite con aviso);
     (d) `ALTER ROLE ALL SET …` y `ALTER ROLE ALL IN DATABASE <base de pruebas> SET …` (exigen superusuario: en la nube se
     omiten con aviso; corren en Docker y en la CI); (e) el archivo de configuración del servidor, simulado con
     `ALTER SYSTEM SET …` y `SELECT pg_reload_conf()` (solo superusuario; si no, se omite con aviso); cada vía se
     restaura al final (`RESET`, `ALTER SYSTEM RESET` y recarga), también si la prueba falla; entonces:
     - el 5.º intento fallido bloquea y, durante el bloqueo, la clave correcta responde 423 `CUENTA_BLOQUEADA` (no 200);
       a los 15 minutos de `RELOJ`, entra;
     - `GET /api/plataforma/academias` responde 200 con `creadaEn` y `suspendidaEn` iguales a los instantes guardados
       (criterio 98), no 500;
     - dentro de `trabajo`, `SELECT now()`, `0.1::float8` y `'\x0102'::bytea` por `tx.cliente.$queryRaw` llegan como un
       `Date` válido a menos de 5 segundos del instante real, `0.1` y los bytes `01 02`.

     Un rol de la app con estos parámetros propios (`ALTER ROLE aquagestion_app SET …`) no llega a esto: lo rechaza el
     criterio 103. En `backend/src/cli/`, la regla del criterio 83 admite además exactamente
     `set_config('DateStyle', 'ISO, MDY', true)`, `set_config('IntervalStyle', 'postgres', true)`,
     `set_config('extra_float_digits', '1', true)` y `set_config('bytea_output', 'hex', true)` (sin distinguir
     mayúsculas, como en el criterio 98); cualquier otro valor o un tercer argumento distinto de `true` sigue fallando, y
     fuera de `cli/` y de `infraestructura/prisma/` sigue prohibida toda llamada a `set_config`. _(crítico)_
108. **Una fecha inválida leída de la base falla cerrada** _(ataque ronda 4, F2; complementa los criterios 39 y 98)_.
     Dado que una fecha de la base puede llegar inválida (`Invalid Date`) si algo escapa al criterio 107, entonces:
     - la función pura del bloqueo (`estaBloqueado`, precisión P-27) considera **bloqueada** la cuenta si
       `bloqueadoHasta` no es nulo y no es un `Date` válido (incluido `new Date(NaN)`), o si `ahora` no es válido; y
       `evaluarIntentoFallido` con ese estado devuelve `YA_BLOQUEADA` sin cambiar nada;
     - en `POST /api/plataforma/sesion`, si `bloqueado_hasta` (o cualquier fecha de la fila del superadmin) llega
       inválida, el inicio de sesión no se autoriza: responde 500 `ERROR_INTERNO` con el formato común, sin `Set-Cookie`,
       sin token, sin datos del superadmin, y sin poner a cero `intentos_fallidos` ni `bloqueado_hasta` ni escribir
       `ultimo_acceso`; el log técnico registra el motivo sin la clave;
     - toda respuesta que lleva una fecha leída de la base (`creadaEn`, `suspendidaEn`) responde 500 `ERROR_INTERNO` sin
       datos si esa fecha es inválida, en vez de un 200 con `null`, `"Invalid Date"` o una fecha cualquiera.

     Prueba unitaria de `estaBloqueado` y `evaluarIntentoFallido` con `new Date(NaN)` y con `ahora` inválido; y de
     integración con la API de pruebas y `BaseDatos` reemplazado (`ajustar`) por un doble cuyo `trabajo` recibe un
     cliente falso que devuelve la fila del superadmin con `bloqueado_hasta: new Date(NaN)` (clave correcta: 500 sin
     cookie y el doble no recibió ninguna escritura) y la de una academia con `creada_en: new Date(NaN)` (listado: 500
     sin `academias` en el cuerpo). _(crítico)_
109. **Ninguna función que ejecute SQL dado como texto** _(ataque ronda 4, F3; complementa los criterios 84 y 94)_. Dado
     el texto normalizado de una plantilla analizada (criterio 92), fuera de `backend/src/infraestructura/prisma/`
     (también en `cli/`), entonces `npm run lint` falla si contiene una llamada, con o sin `pg_catalog.` u otro esquema
     delante, sin distinguir mayúsculas, con o sin comillas dobles o `U&"…"` en el nombre (criterio 93) y con o sin
     espacios antes del paréntesis, a una función que ejecuta o lee SQL o tablas a partir de un texto o un nombre:
     - del núcleo de PostgreSQL 16: `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `cursor_to_xml`,
       `cursor_to_xmlschema`, `table_to_xml`, `table_to_xmlschema`, `table_to_xml_and_xmlschema`, `schema_to_xml`,
       `schema_to_xmlschema`, `schema_to_xml_and_xmlschema`, `database_to_xml`, `database_to_xmlschema`,
       `database_to_xml_and_xmlschema`, `ts_stat` y `ts_rewrite` (su forma de dos argumentos ejecuta una consulta dada
       como texto; se prohíben todas sus formas);
     - de extensiones que podrían instalarse: todo nombre que empiece por `dblink` (`dblink`, `dblink_exec`,
       `dblink_open`, `dblink_send_query`, …), `crosstab…` y `connectby` (`tablefunc`), `pg_background…`, y cualquier
       función del esquema `cron` (`cron.schedule`, …);
     - y, en general, toda llamada calificada con un esquema que no sea `pg_catalog` ni `public` (`otro.funcion(`), para
       que una extensión nueva no abra otro camino sin que se revise. Como el lint no distingue una llamada de
       `INSERT INTO otro.tabla (…)`, esa forma también falla: AquaGestión solo usa el esquema `public`.

     Fallan, por ejemplo, `` SELECT query_to_xml('SELECT set_config(''app.plataforma'', ''si'', false)', true, false, '') ``,
     `` SELECT pg_catalog.Query_To_Xml (${q}, true, false, '') ``, `` SELECT "query_to_xml"('SELECT 1', true, false, '') ``,
     `` SELECT ts_stat('SELECT …') ``, `` SELECT * FROM dblink_exec('…') `` y `` SELECT cron.schedule('…') ``. Siguen
     pasando `SELECT xpath('/a', ${xml})`, `SELECT to_tsvector(${texto})`, `SELECT pg_catalog.now()`,
     `SELECT public.app_academia_actual()`, `SELECT a.query_to_xml FROM t a` (una columna, sin paréntesis) y
     `SELECT count(t.id) FROM t`. Prueba como en el criterio 92. _(crítico; prueba de la regla de lint)_
110. **Solo las pruebas quedan fuera de las reglas, y nadie las importa** _(ataque ronda 4, F4; **ajusta el alcance** de
     los criterios 92 y 95 y de los `ignores` de las reglas de los criterios 28, 73, 83 a 85 y 92 a 95)_ _(precisado por
     decisión del orquestador tras la ronda 4, 11/11/2026: nombres con `.test.` que no son pruebas)_. Dado el código de
     `backend/src/`, entonces:
     - las reglas de esos criterios y del paso protegido (criterio 96) eximen solo los archivos cuyo nombre termina
       exactamente en `.test.ts`, `.test.mts`, `.test.cts`, `.test.js`, `.test.mjs` o `.test.cjs`, y los de `backend/test/`
       (que de todos modos está fuera de `backend/src/**`); un archivo como `atajo.test.util.ts`, `x.test.d.ts` o
       `x.test.tsx` ya no está exento;
     - `backend/tsconfig.build.json` excluye exactamente esos mismos patrones (`**/*.test.ts`, `**/*.test.mts`,
       `**/*.test.cts`; los `.js`, `.mjs` y `.cjs` ya no se compilan, criterio 97) y `test`, y no excluye nada más bajo
       `src` que pueda llevar código;
     - un archivo de `backend/src/` que no es prueba no puede importar (por cualquiera de las vías del criterio 85, también
       `import type`) un archivo de pruebas: un especificador cuya ruta resuelta, con o sin extensión, termina en
       `.test`, `.test.<extensión>` de la lista del criterio 95 (más `.jsx`, criterio 119), o cae dentro de `backend/test/`.

     Prueba: con la configuración del paso protegido, `backend/src/modulos/ejemplo/atajo.test.util.ts` con
     `import pg from 'pg'` falla; `ejemplo.service.ts` con `import { x } from './atajo.test'`,
     `require('./ejemplo.service.test.ts')` o `import('../../../test/utilidades/base-datos')` falla; un
     `ejemplo.service.test.ts` sigue exento; y la prueba lee `tsconfig.build.json` y comprueba su `exclude`.
     _(crítico; prueba de la regla de lint y de configuración)_

     **Precisión: nombres con `.test.` que no son pruebas** _(decisión del orquestador tras la ronda 4, 11/11/2026)_. Que
     un archivo como `x.test.util.ts` o `x.test.d.ts` "ya no esté exento" no basta: en `cli/` `import pg from 'pg'` está
     permitido, así que ese archivo no daría error y se compilaría pareciendo una prueba. Por eso, dentro de
     `backend/src/` y de `packages/contratos/src/`, **es un error del paso protegido** (criterio 96; `npm run
     lint:protegido`, dentro de `npm run lint`) cualquier archivo cuyo nombre contenga `.test.` y no termine
     exactamente en `.test.ts`, `.test.mts`, `.test.cts`, `.test.js`, `.test.mjs` o `.test.cjs`, en cualquier carpeta y
     sea cual sea su contenido. El paso termina con código 1 con un mensaje que nombra la ruta y pide renombrar el archivo
     (quitar `.test.` del nombre o, si es una prueba, dejarlo como `*.test.<extensión>`). La comprobación no depende de
     que ESLint revise ese tipo de archivo (también cuentan `x.test.d.ts`, `x.test.tsx`, `x.test.jsx` o `x.test.json`).

     Prueba adicional: con la configuración del paso protegido, `backend/src/cli/atajo.test.util.ts` con
     `import pg from 'pg'` falla con el mensaje de renombrar; también fallan `backend/src/cli/x.test.d.ts`,
     `backend/src/modulos/ejemplo/x.test.tsx` y `packages/contratos/src/x.test.util.ts`, aunque estén vacíos; siguen
     pasando `backend/src/cli/ejemplo.test.ts` y `packages/contratos/src/esquemas.test.ts`. _(crítico)_
111. **Sin enlaces simbólicos en el código revisado** _(ataque ronda 4, F5; complementa los criterios 95 y 96)_. Dado el
     repositorio, entonces:
     - el paso protegido (`npm run lint:protegido`, dentro de `npm run lint`) falla con código 1, nombrando la ruta, si
       hay algún enlace simbólico (o unión de Windows) en cualquier nivel dentro de `backend/src/` o de
       `packages/contratos/src/`, sea a un archivo o a una carpeta; lo comprueba un script de Node antes de ESLint
       (precisión P-28), que recorre sin seguir enlaces;
     - las reglas de acceso (criterios 85 y 95, y la del criterio 110) resuelven con `fs.realpathSync` la ruta del archivo
       que se revisa, la raíz (`context.cwd`) y la ruta importada cuando el archivo existe (probando las extensiones del
       criterio 95 y `.jsx`, y `index.<extensión>` si es una carpeta); si no existe, usan la resolución léxica de hoy. Así,
       una importación que pasa por un enlace fuera de `backend/src/` que apunta a `backend/src/cli/` o a un interno de
       `infraestructura/prisma/` falla como si se escribiera la ruta real.

     Prueba: unitaria del script con una carpeta temporal (un enlace a carpeta y otro a archivo, en el primer nivel y
     anidados: los encuentra todos; sin enlaces: lista vacía); y de la regla con una carpeta temporal como `cwd`, con
     `backend/src/cli/conexion.ts` y un enlace `backend/enlace → backend/src/cli`, donde un módulo con
     `import { crearClienteDelDueno } from '../../../enlace/conexion'` falla. Si el sistema no permite crear enlaces (Windows
     sin modo de desarrollador: `EPERM`), esos casos se omiten con aviso; corren en Linux. _(crítico)_
112. **La etiqueta del SQL es la autorizada, también en tiempo de ejecución** _(ataque ronda 4, F6; **ajusta el
     alcance** del criterio 92 en cuanto a qué `sql` y qué `Prisma.sql` se aceptan)_. Dado el código de `backend/src/`
     fuera de `infraestructura/prisma/` y de las pruebas, entonces:
     - `$queryRaw` y `$executeRaw` llamados con un argumento (no como etiqueta) solo aceptan, como ese único argumento,
       una plantilla etiquetada con:
       - en los módulos: la función `sql` importada del punto autorizado (criterio 114; `…/infraestructura/prisma` o
         `…/infraestructura/prisma/index`), con su nombre, con alias (`import { sql as s }`) o como `<espacio>.sql` de un
         `import * as <espacio>` de ese punto; la regla lo decide por el ámbito (`scope`) de ESLint, no por el nombre, así
         que una `sql` declarada en el archivo (`const sql = (…) => ({ text: '…' })`), un parámetro llamado `sql` o una
         `sql` importada de otro sitio no se aceptan;
       - en `cli/`: `Prisma.sql`, con `Prisma` importado del cliente generado (criterio 113), o la `sql` del punto
         autorizado;
       cualquier otro argumento (un objeto, una llamada, una variable, otra etiqueta) hace fallar el lint;
     - la regla del texto del SQL (criterios 73, 83, 84, 93, 94 y 109) sigue analizando toda plantilla cuya etiqueta sea
       un identificador `sql` (venga de donde venga), una propiedad `.sql`, `.$queryRaw` o `.$executeRaw`, o un alias de
       `sql` del punto autorizado: analizar de más no abre caminos;
     - en tiempo de ejecución, `tx.cliente.$queryRaw` y `tx.cliente.$executeRaw` (precisión P-26) aceptan solo: (a) la forma
       de etiqueta, con un arreglo de cadenas con su `raw` (también arreglo de cadenas) de un elemento más que los
       valores; o (b) un único argumento que sea un fragmento del punto autorizado o un `Sql` creado por Prisma
       (`instanceof` de la clase de Prisma; lo usan las pruebas del criterio 100). Cualquier otro argumento, por ejemplo
       `{ text: 'SET ROLE postgres', values: [] }`, `{ sql: '…', values: [] }`, `{ strings: ['…'], values: [] }`, una
       cadena, o dos argumentos sin ser etiqueta, rechaza con `TypeError` sin enviar nada a la base.

     Fallan en un módulo, por ejemplo: `` const sql = (s) => ({ text: s[0] }); cliente.$queryRaw(sql`SET ROLE postgres`) ``,
     `` cliente.$executeRaw(Prisma.sql`SELECT 1`) `` (en un módulo no hay `Prisma` de valor), `cliente.$queryRaw(consulta)` y
     `` cliente.$queryRaw(otra`SELECT 1`) ``. Pasan, en un módulo,
     `` import { sql } from '../../infraestructura/prisma'; … cliente.$executeRaw(sql`SELECT 1`) `` y la plantilla
     etiquetada directa; y en `cli/`, `` import { Prisma } from '../generated/prisma/client'; … cliente.$queryRaw(Prisma.sql`SELECT 1`) ``.
     Prueba de la regla como en el criterio 92, y de integración: dentro de `conAcademia`, cada objeto falso de la lista
     (uno de ellos con un `INSERT` en `configuraciones`) rechaza con `TypeError`, y aunque `trabajo` capture el error y
     termine bien, no queda ninguna fila (leído como dueño). _(crítico; prueba de la regla de lint y de integración)_
113. **`Prisma` en `cli/` solo como acceso con punto a un nombre fijo** _(ataque ronda 4, F7; complementa los criterios
     92 y 95)_. Dado el código de `backend/src/cli/`, entonces las reglas siguen los alias y los espacios de nombres del
     cliente generado y de `@prisma/…` (`import { Prisma as P }`, `import * as G` y `G.Prisma`, la importación por
     defecto) y `npm run lint` falla si:
     - `Prisma` (o un alias, o `G.Prisma`), o el espacio de nombres `G`, se usa como valor de otra forma que como objeto
       de un acceso con punto a un nombre fijo: asignado (`const P = Prisma`, `x.p = Prisma`), pasado como argumento
       (`Reflect.get(Prisma, 'raw')`, `Object.getOwnPropertyDescriptor(Prisma, 'raw')`, `f(G)`), propagado (`...Prisma`),
       devuelto, exportado como valor o con acceso calculado (`Prisma[x]`, `Prisma['raw']`, `G['Prisma']`);
     - se desestructura de `Prisma` o de `G.Prisma` alguno de `sql`, `raw`, `join`, `empty` o `Sql` (con o sin alias:
       `const { sql: s } = Prisma`), con una clave calculada o con un resto (`...resto`);
     - una expresión que empieza por `Prisma` (o un alias) o por `G` accede, en cualquier punto de la cadena, a
       `constructor`, `prototype` o `__proto__` (`Prisma.empty.constructor`, `` Prisma.sql`x`.constructor ``), o se pasa a
       `Reflect.*`, `Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor(s)`, `Object.entries`, `Object.values`,
       `Object.keys` u `Object.assign`;
     - el cliente generado o `@prisma/…` se cargan con `require(…)` o `import(…)` en lugar de un `import` estático (que
       es lo que las reglas siguen).

     Se mantienen las prohibiciones del criterio 92 sobre `Prisma.raw`, `Prisma.Sql` como valor, `Prisma.join` con
     separador y `Prisma.sql` como función, también con los alias. Pasan, en `cli/`,
     `import { PrismaClient } from '../generated/prisma/client'`, `new PrismaClient(…)`,
     `` import { Prisma as P } from '../generated/prisma/client'; … cliente.$queryRaw(P.sql`SELECT 1`) `` y
     `import type { Prisma } from '../generated/prisma/client'`. Prueba como en el criterio 92, un ejemplo que falla por
     cada forma del ataque (`import { Prisma as P }` con `P.raw`, `import * as G` con `G.Prisma.raw`, `const P = Prisma`,
     `const { sql: s } = Prisma`, `Prisma.empty.constructor`, `Reflect.get(Prisma, 'raw')`) y los que pasan. _(crítico;
     prueba de la regla de lint)_

     _(Decisión del orquestador tras la ronda 4, 11/11/2026.)_ Ante la contradicción con el criterio 85 (que dejaba pasar
     en `cli/` las vías dinámicas y `require` hacia el cliente generado y `@prisma/…`), **manda este criterio**: en `cli/`
     solo se admiten las importaciones estáticas del cliente generado y de `@prisma/…` y el uso `Prisma.<nombre fijo>`.
     La lista de casos que dejan de pasar está en el criterio 85.

     **Precisión: cargas que no se pueden seguir** _(decisión del orquestador tras la ronda 4, 11/11/2026)_. "Importación
     estática" incluye `import * as G` y la importación por defecto, con las restricciones de este criterio. Además, como
     las reglas no pueden saber qué carga una ruta calculada, en `backend/src/cli/` `npm run lint` también falla con:
     - `import(…)` cuyo argumento no es una cadena literal (una variable, una concatenación o una plantilla con
       `${…}`), por ejemplo `import(ruta)` o `` import(`../generated/${x}/client`) ``;
     - `require(…)` cuyo argumento no es una cadena literal, por ejemplo `require(ruta)` o `require('../' + x)`;
     - `createRequire`, importado de `module` o de `node:module` (con nombre, con alias, como `<espacio>.createRequire`
       de un `import * as` o de la importación por defecto) o usado de cualquier forma, y la función que devuelve, por
       ejemplo `createRequire(import.meta.url)('../generated/prisma/client')` o `const r = createRequire(__filename); r('pg')`.

     Prueba como en el criterio 92: un ejemplo que falla en `cli/` por cada forma (`import(ruta)`, `require(ruta)`,
     `import { createRequire } from 'node:module'`, `import { createRequire as c } from 'module'`,
     `import * as m from 'node:module'` con `m.createRequire(…)`), y siguen pasando en `cli/` `import pg from 'pg'` y
     `import * as G from '../generated/prisma/client'` con `` G.Prisma.sql`SELECT 1` ``. _(crítico; prueba de la regla de
     lint)_
114. **Un punto autorizado para montos, errores de la base y fragmentos de SQL** _(ataque ronda 4, falsos positivos
     para las historias siguientes; complementa los criterios 85, 92 y 112)_. Dado
     `backend/src/infraestructura/prisma/index.ts`, entonces exporta (precisión P-25):
     - `Decimal` (la clase de decimales de Prisma, valor y tipo) para los montos (convención de `CLAUDE.md`: nunca
       `number`);
     - `codigoDeErrorDeBase(error)`, que devuelve el SQLSTATE de cinco caracteres de un error de la base (de Prisma o del
       adaptador, también de `$queryRaw`) o `null`, y `esViolacionDeUnicidad(error)`, verdadero con el código `P2002` de
       Prisma o con el SQLSTATE `23505`;
     - `sql`, `join` y `vacio` para componer fragmentos: `sql` es una etiqueta que solo acepta, como valores, primitivos
       (`string`, `number`, `bigint`, `boolean`, `null`), `Date`, `Decimal`, `Uint8Array`, arreglos de esos valores y
       fragmentos creados por el propio punto autorizado, y rechaza con `TypeError` cualquier otro valor (también un `Sql`
       de Prisma); `join(elementos, separador?)` une valores o fragmentos con un separador de una lista cerrada (`'coma'`,
       `'y'`, `'o'`, que se traducen a `, `, ` AND ` y ` OR `; por defecto `'coma'`) y rechaza cualquier otro; `vacio` es
       el fragmento vacío. No existe ni se exporta un equivalente de `raw` ni de `Prisma.join` con separador libre;
     - los fragmentos son opacos: un objeto congelado sin prototipo (`Object.getPrototypeOf(f) === null`), sin claves
       propias (`Reflect.ownKeys(f)` vacío) y sin ningún camino a `Sql`, a `raw` ni al cliente; el envoltorio (criterio
       112) los reconoce y los convierte en el `Sql` de Prisma solo al enviar la consulta, tanto como único argumento como
       interpolados en una plantilla de `$queryRaw`/`$executeRaw` o dentro de otro fragmento;
     - las reglas de lint reconocen estas importaciones en los módulos: importar `Decimal`, `codigoDeErrorDeBase`,
       `esViolacionDeUnicidad`, `sql`, `join` y `vacio` del punto autorizado pasa el paso protegido.

     Pasan en un módulo, por ejemplo: `` tx.cliente.$queryRaw`SELECT … WHERE id = ANY(${ids}::uuid[])` `` (la forma
     recomendada para listas), `` const filtro = desde ? sql`AND fecha_hora >= ${desde}` : vacio; tx.cliente.$queryRaw`SELECT … WHERE academia_id = ${id}::uuid ${filtro}` ``,
     `` sql`SELECT … WHERE id IN (${join(ids)})` ``, `new Decimal('10.50')` y
     `if (esViolacionDeUnicidad(error)) throw new ErrorNegocio(409, …)`. Prueba unitaria (sin base) de `sql`, `join` y
     `vacio` (valores rechazados, separador fuera de la lista, opacidad) y de los detectores con errores construidos de
     Prisma y del adaptador; de integración: un fragmento con un valor y otro con `join` dentro de `conAcademia` devuelven
     las filas esperadas con los valores como parámetros (un valor `'x''; SET ROLE postgres; --'` se guarda tal cual y no
     cambia el rol), una inserción duplicada en `configuraciones` da `esViolacionDeUnicidad` verdadero y
     `codigoDeErrorDeBase` `'23505'`; y de la regla: esas importaciones pasan. _(crítico)_
115. **`SET` como cláusula no es `SET` de sesión** _(ataque ronda 4, falsos positivos; complementa los criterios 73 y
     84)_. Dado el texto normalizado de una plantilla analizada, entonces las formas `SET [LOCAL|SESSION] ROLE`,
     `SET SESSION`, `SET [LOCAL|SESSION] SESSION AUTHORIZATION` y `SET [LOCAL|SESSION] app.` que se buscan en cualquier
     parte del texto (criterios 73 y 84) no cuentan cuando, en la misma sentencia (sin un `;` en medio), las precede la
     palabra `update` fuera de una cadena: son la cláusula `SET` de un `UPDATE`, de un `ON CONFLICT DO UPDATE` o de un
     `MERGE … UPDATE`, que asigna columnas. `SET` al inicio de una sentencia sigue fallando siempre (criterio 84). Pasan,
     por ejemplo, `` UPDATE usuarios SET role = ${r} WHERE id = ${id}::uuid ``,
     `` UPDATE t SET session = ${s} WHERE … `` e `` INSERT … ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role ``; siguen
     fallando `` SET ROLE postgres ``, `` SELECT 1; SET ROLE postgres `` y `` UPDATE t SET x = 1; SET SESSION AUTHORIZATION postgres ``.
     Una palabra prohibida dentro de una cadena SQL (`` SELECT … WHERE motivo = 'WITH HOLD' ``) sigue haciendo fallar el
     lint: es una limitación aceptada ("Riesgos aceptados"); el valor va como parámetro (`${'WITH HOLD'}`). Ningún ejemplo
     de las pruebas protegidas de las rondas 1 a 3 cambia de resultado; si alguno cambiara, el test-writer se detiene e
     informa. _(crítico; prueba de la regla de lint)_
116. **Variables sensibles sin distinguir mayúsculas** _(ataque ronda 4, observación; **ajusta el alcance** del criterio
     99 y de la precisión P-21)_. Dado que en Windows `process.env` no distingue mayúsculas (`PgPassword` y `PGPASSWORD`
     son la misma variable), entonces `retirarVariablesSensibles(env)` compara los nombres pasados a mayúsculas: borra toda
     clave cuyo nombre en mayúsculas empieza por `DATABASE_URL` salvo la que en mayúsculas es exactamente
     `DATABASE_URL_APP`, toda la que en mayúsculas empieza por `PG` y la que en mayúsculas es `SUPERADMIN_CLAVE`. Prueba
     unitaria: quita `PgPassword`, `pguser`, `Database_Url`, `database_url_pruebas` y `Superadmin_Clave`; deja
     `Database_Url_App`, `jwt_secreto` y las de la lista del criterio 99. _(crítico)_
117. **La carga del `.env` no está al alcance de los módulos** _(ataque ronda 4, observación; complementa el criterio
     99)_. Dado el código de `backend/src/`, entonces `cargarEnvRaiz` no se exporta en el `index` de
     `infraestructura/entorno/` (`main.ts` la importa de su archivo), y `npm run lint` (también el paso protegido) falla si
     un archivo que no es `backend/src/main.ts`, ni está en `backend/src/cli/` o en `infraestructura/entorno/`, ni es una
     prueba, importa `…/infraestructura/entorno/cargar-env` o el paquete `dotenv` (`dotenv`, `dotenv/config`, por
     cualquiera de las vías del criterio 85). Prueba: la regla con un módulo que importa cada uno (falla) y con
     `main.ts` y un archivo de `cli/` (pasan); y el `index` cargado no tiene `cargarEnvRaiz`. _(crítico)_
118. **Solo el cliente generado queda fuera de las reglas** _(ataque ronda 4, observación; **ajusta el alcance** de los
     `ignores` de los criterios 92 a 96)_. Dado el repositorio, entonces la exención `backend/src/generated/**` de las
     reglas y del paso protegido pasa a ser `backend/src/generated/prisma/**`; y el paso protegido falla con código 1,
     nombrando la ruta, si `git ls-files -- backend/src/generated` lista algún archivo (toda esa carpeta está en
     `.gitignore` y la crea `prisma generate`) o si dentro de `backend/src/generated/` hay algo que no sea la carpeta
     `prisma/`. Si `git` no está disponible, el paso falla con el motivo. Prueba: unitaria de la función del script con
     carpetas temporales y de que un archivo `backend/src/generated/otra/x.ts` con `import pg from 'pg'` falla con la
     configuración del paso protegido. _(crítico)_
119. **También `.jsx`** _(ataque ronda 4, observación; **ajusta el alcance** de los criterios 95 y 97)_. Dado que `tsx`
     ejecuta también archivos `.jsx`, entonces las reglas de los criterios 28, 73, 83 a 85, 92 a 95, 109, 110, 112, 113
     y 117, el analizador del paso protegido y el bloque de JavaScript de `eslint.config.mjs` cubren
     `backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`, y la resolución de rutas de las reglas prueba también `.jsx`.
     Prueba: un `.jsx` de `backend/src/modulos/` con `import pg from 'pg'` y otro con
     `` tx.cliente.$queryRaw`SET ROLE postgres` `` hacen fallar el paso protegido. _(crítico)_

### N. Correcciones del ataque adversarial, ronda 5

Criterios agregados tras la ronda 5 del ataque (11/11/2026, sobre el commit `b5ff3e9`). Son decisiones técnicas de
seguridad, no reglas de negocio nuevas. Donde un criterio complementa o amplía uno anterior lo dice, y el anterior queda
marcado "(… ataque ronda 5)", sin borrar su texto. Contratos nuevos: precisiones P-29 y P-30. Todos son _(crítico)_.

Esta ronda crea dos listas de excepciones, **hoy vacías**, que solo una especificación puede ampliar, con la
justificación de cada elemento (como la lista del criterio 10):

- **Funciones `SECURITY DEFINER` permitidas** (criterio 124): ninguna.
- **Unicidad sin `academia_id` permitida** (criterio 126): ninguna.

120. **La sesión solo se emite para la clave que sigue vigente** _(ataque ronda 5, F1; complementa los criterios 34, 36,
     39 y 40)_. Dado que la clave se verifica fuera de la transacción que acepta el ingreso (el hash tarda decenas de
     milisegundos; plan, sección 6), cuando se envía `POST /api/plataforma/sesion` con la clave correcta, entonces:
     - la transacción que acepta el ingreso (la que pone `intentos_fallidos` en 0 y escribe `ultimo_acceso`) relee la fila
       del superadmin bajo su bloqueo (`SELECT … FOR UPDATE`) y comprueba que `clave_hash` y `version_token` son
       exactamente los que se leyeron para verificar la clave; el token se firma con esa `version_token`;
     - si cualquiera de los dos cambió (por ejemplo, porque `npm run plataforma:superadmin` restableció la clave, o porque
       un `DELETE /api/plataforma/sesion` cerró las sesiones, mientras se calculaba el hash), responde 401
       `CREDENCIALES_INVALIDAS` con el mismo cuerpo del criterio 38, sin `Set-Cookie`, sin token y sin escribir nada en la
       fila (ni `intentos_fallidos`, ni `bloqueado_hasta`, ni `ultimo_acceso`, ni `actualizado_en`): no cuenta como intento
       fallido. El log técnico lo registra con nivel `warn`, sin la clave;
     - el camino de la clave equivocada no cambia (criterios 39 y 40);
     - una implementación que verifica la clave dentro de la misma transacción que bloqueó la fila desde la lectura también
       cumple el criterio.

     Garantía observable: ninguna cookie emitida a partir de la clave anterior a un restablecimiento sirve después de él
     (`GET /api/plataforma/sesion` responde 401).

     Prueba de integración determinista: un superadmin con clave K1 y la API de pruebas con `BaseDatos` reemplazado
     (`ajustar`) por un doble que delega en un `BaseDatos` real y que, durante una petición de inicio de sesión, justo
     antes de la **segunda** llamada a `comoPlataforma` (es decir, después de la que leyó la fila y de calcular el hash),
     ejecuta el comando real `npm run plataforma:superadmin` (`ejecutarComando`) con el mismo correo y la clave K2.
     Entonces, con K1: 401 `CREDENCIALES_INVALIDAS` sin `Set-Cookie`; leída como dueño con `pg`, la fila tiene
     `intentos_fallidos` 0, `ultimo_acceso` igual al de antes (nulo si nunca entró) y la `version_token` que dejó el
     comando; después, K2 entra (200) y K1 responde 401 (como cualquier clave equivocada). Si la implementación no hace
     una segunda llamada, el doble ejecuta el comando después de la respuesta, y la prueba exige que, si fue 200, esa
     cookie responda 401 en `GET /api/plataforma/sesion` tras el comando. Variante: en lugar del comando, el doble sube
     `version_token` como dueño (`UPDATE superadmins SET version_token = version_token + 1`); con K1, que sigue siendo la
     clave, responde 401 y no escribe nada. Sin intercalar nada, K1 entra (200), como hoy. Además, sin pausas: 8 inicios
     de sesión con K1 a la vez (menos que el límite por IP del criterio 41), en paralelo con el comando que cambia a K2;
     cuando todo termina, toda cookie obtenida responde 401 en `GET /api/plataforma/sesion`. _(crítico)_
121. **`search_path` fijo en cada transacción** _(ataque ronda 5, F2 (a) y (c); complementa los criterios 72, 98 y 107;
     **amplía** la excepción de `cli/` del criterio 107)_ _(la preparación de su prueba se ajusta por el criterio 130,
     ataque ronda 6: el esquema `trampa` se crea después de la primera comprobación del rol; ver "Impacto en
     especificaciones anteriores", ronda 6)_. Dado que el `search_path` de la conexión puede venir de
     `options` en la URL, de `ALTER DATABASE … SET`, de `ALTER ROLE ALL … SET` o del servidor, y que el valor por defecto
     (`"$user", public`) busca primero un esquema con el nombre del rol, entonces:
     - toda transacción de `BaseDatos` (`conAcademia`, `comoPlataforma` y `resolverAcademia`) y de `enPlataforma` fija
       `search_path` en `pg_catalog, public, pg_temp`, local a la transacción, en la misma primera sentencia que fija el
       contexto y los parámetros de los criterios 98 y 107, antes de `trabajo`; dentro de `trabajo`,
       `current_setting('search_path')` es ese valor (comparado sin espacios);
     - esa primera sentencia llama a cada función calificada con `pg_catalog.` (`pg_catalog.set_config(…)`), porque
       PostgreSQL la interpreta con el `search_path` que trae la conexión, antes de fijarlo; `CLOSE ALL` sigue después
       (criterio 101);
     - las consultas de la comprobación del rol (criterios 4, 80, 102, 103 y 123) corren dentro de una transacción que
       empieza con esa misma primera sentencia, sin contexto, y califican con `pg_catalog.` toda función y tabla del
       catálogo que usan (hoy `has_table_privilege`, `has_sequence_privilege`, `has_column_privilege` y `unnest` van sin
       calificar);
     - **decisión sobre calificar con `public.` (F2 (c)):** el SQL que corre después de la primera sentencia (las
       consultas de `BaseDatos`, la llamada a `resolver_academia`, los servicios de 001 y los de las historias
       siguientes) **no** necesita calificar con `public.` las tablas y funciones propias. El `search_path` queda fijo
       para toda la transacción (el lint impide cambiarlo: criterios 83 y 84); `pg_catalog` va primero y solo un
       superusuario crea objetos ahí; `pg_temp` va al final y la app no puede crear temporales (criterio 82); y los
       delegados de Prisma ya califican con `"public"`. Calificar sí es necesario en lo que se interpreta **antes** de
       fijar el `search_path` (la primera sentencia y la comprobación del rol, viñetas anteriores). `resolver_academia`
       conserva su cláusula `SET search_path = pg_catalog, public, pg_temp` y sus nombres calificados (plan, sección 2);
     - en `backend/src/cli/`, la regla del criterio 83 admite además exactamente
       `set_config('search_path', 'pg_catalog, public, pg_temp', true)` (sin distinguir mayúsculas, como en el criterio
       98), y todas las llamadas que admite en `cli/` (criterios 90, 98, 107, 121 y 122) pasan también con `pg_catalog.`
       delante; cualquier otro valor o un tercer argumento distinto de `true` sigue fallando, y fuera de `cli/` y de
       `infraestructura/prisma/` sigue prohibida toda llamada a `set_config`.

     Prueba de integración (como la del criterio 107), con la API de pruebas en `DATABASE_POOL_MAX=1` y una API nueva por
     vía. El dueño crea un esquema `trampa` (si no puede crear esquemas en la base de pruebas, la prueba se omite con
     aviso), del que la app no es dueña ni tiene `CREATE`, con `GRANT USAGE ON SCHEMA trampa TO aquagestion_app`; dentro,
     tablas `trampa.academias` y `trampa.superadmins` con las mismas columnas y filas falsas (la academia A, suspendida en
     `public`, como `ACTIVA`; el correo del superadmin con el hash de una clave del atacante), con `SELECT` concedido a la
     app; y funciones `trampa.set_config(text, text, boolean)` (devuelve su segundo argumento sin fijar nada) y
     `trampa.has_table_privilege(name, oid, text)` (devuelve `false`). Vías de contaminación de `search_path` a
     `trampa, pg_catalog, public` y a `"$user", trampa, pg_catalog, public`: (a) un `trabajo` anterior en la misma conexión
     con `set_config('search_path', …, false)`; (b) `options` en `DATABASE_URL_APP`; (c) `ALTER DATABASE <base de
     pruebas> SET search_path …` (si el dueño puede; si no, se omite con aviso); (d) `ALTER ROLE ALL [IN DATABASE …] SET
     search_path …` (solo superusuario: se omite con aviso en la nube). Todo se restaura al final, también si la prueba
     falla. Entonces:
     - dentro de `trabajo`, `current_setting('search_path')` es el fijo y, en `conAcademia(B, …)`,
       `current_setting('app.academia_id', true)` es el id de B (no se usó la `set_config` falsa);
     - `conAcademia(A, …)` rechaza con `ErrorAcademiaSuspendida` y `GET /api/a/{nombre corto de A}` responde 403;
     - `POST /api/plataforma/sesion` con la clave del atacante responde 401 y con la real, 200;
     - con las vías (b) y (c) y además `GRANT TRUNCATE ON auditoria TO aquagestion_app`, una API nueva rechaza con
       `ErrorRolBaseDatosInseguro` (no se usó la `has_table_privilege` falsa);
     - en los comandos, con la URL del dueño con esas `options`, dentro de `enPlataforma` `current_setting('search_path')`
       es el fijo, y `npm run plataforma:superadmin` crea el superadmin en `public.superadmins` y no en
       `trampa.superadmins` (leídos como dueño con `pg`).

     Y la prueba de la regla de lint (como en el criterio 92): en `cli/` pasan la llamada nueva y las de los criterios 98
     y 107 con `pg_catalog.` delante; fallan `set_config('search_path', 'trampa, public', true)` y
     `set_config('search_path', 'pg_catalog, public, pg_temp', false)`. _(crítico)_
122. **`standard_conforming_strings` en `on` en cada transacción** _(ataque ronda 5, O3; complementa los criterios 107 y
     121; **amplía** la excepción de `cli/` del criterio 107)_. Dado que con `standard_conforming_strings = off` una `\`
     dentro de un literal SQL cambia de significado, y que el valor puede llegar por las mismas vías que los parámetros
     del criterio 107, entonces toda transacción de `BaseDatos` y de `enPlataforma` fija `standard_conforming_strings` en
     `on`, local a la transacción, en la misma primera sentencia (criterio 121); dentro de `trabajo`,
     `current_setting('standard_conforming_strings')` es `on`. La primera sentencia no contiene `\`, así que se interpreta
     igual con cualquier valor. En `backend/src/cli/`, la regla del criterio 83 admite además exactamente
     `set_config('standard_conforming_strings', 'on', true)`, con o sin `pg_catalog.`; `'off'` sigue fallando. Prueba como
     la del criterio 107, con las vías (a) a (e) en `off` (las que exigen superusuario se omiten con aviso en la nube):
     dentro de `trabajo` y de `enPlataforma` el parámetro es `on`, y una consulta cuyo texto SQL es
     `SELECT length('a\b') AS n` (una sola barra invertida en el texto que llega a PostgreSQL) devuelve 3. _(crítico)_
123. **Ningún esquema propio, con `CREATE` o con el nombre del rol** _(ataque ronda 5, F2 (b); complementa los criterios
     80, 81 y 103)_ _(ampliado por el criterio 130, ataque ronda 6: `USAGE` sobre un esquema que contiene objetos que no son
     de extensiones sí se rechaza; sobre uno vacío o con solo objetos de extensiones sigue sin rechazarse)_. Dada la comprobación del rol (en la API, la del criterio 80; en `npm run db:crear`, sobre la base de
     desarrollo y la de pruebas), entonces también rechaza el rol si:
     - es dueño de **cualquier** esquema de la base (`pg_namespace.nspowner`), no solo de `public`;
     - tiene `CREATE` sobre cualquier esquema de la base (`has_schema_privilege(…, 'CREATE')`), concedido al rol o a
       `PUBLIC`, incluidos los del sistema (ninguno lo concede por defecto, así que no hace falta exceptuarlos);
     - existe en la base un esquema con su nombre (`aquagestion_app`), sea de quien sea: el `search_path` por defecto
       (`"$user", public`) lo buscaría antes que `public`.

     La API rechaza con `ErrorRolBaseDatosInseguro` como en el criterio 4 (el log nombra la condición y el esquema, nunca
     la URL ni la contraseña); `db:crear` termina con código 1 con un mensaje que nombra el esquema, la condición y la
     corrección (`REVOKE CREATE ON SCHEMA <esquema> FROM aquagestion_app;` o `… FROM PUBLIC;`,
     `ALTER SCHEMA <esquema> OWNER TO <dueño>;`, o renombrar o eliminar el esquema `aquagestion_app`), sin modificar
     nada. `USAGE` sobre otros esquemas no se rechaza (lo neutraliza el criterio 121; ver "Riesgos aceptados"). Con las
     migraciones de esta historia y nada más, la comprobación pasa. Funciones que deciden: P-29, separadas de las de P-12,
     P-13 y P-19, cuyas pruebas no cambian. Prueba unitaria de esas funciones (cada condición sola, y todas falsas) y de
     integración, con una API nueva por caso y restaurando al final: el dueño crea `trampa` y concede
     `GRANT CREATE ON SCHEMA trampa TO aquagestion_app` (un caso) o `… TO PUBLIC` (otro); el dueño crea un esquema
     `aquagestion_app` sin conceder nada; y, solo con superusuario (Docker y CI; en la nube se omiten con aviso),
     `CREATE SCHEMA aquagestion_app AUTHORIZATION aquagestion_app` y `CREATE SCHEMA otro AUTHORIZATION aquagestion_app`.
     En cada caso `conAcademia`, `comoPlataforma` y `resolverAcademia` rechazan; en `db:crear`, al menos los casos de
     `CREATE` concedido a la app y a `PUBLIC` y el del esquema con su nombre. _(crítico)_
124. **Ningún objeto que se salte RLS** _(ataque ronda 5, F3; complementa los criterios 9 y 11)_ _(alcance ampliado por
     el criterio 131, ataque ronda 6: todos los esquemas que no son del sistema)_. Dadas las migraciones
     aplicadas en la base de pruebas, cuando se consulta el catálogo, entonces la prueba falla si en el esquema `public`
     hay:
     - una vista (`relkind = 'v'`) sin `security_invoker = true` en sus opciones (`reloptions`);
     - una vista materializada (`'m'`) o una tabla foránea (`'f'`), sean como sean: no pasan por RLS;
     - una función o procedimiento con `SECURITY DEFINER` (`pg_proc.prosecdef`), salvo los de la lista "Funciones
       `SECURITY DEFINER` permitidas" (hoy vacía; `app_academia_actual`, `app_es_plataforma` y `resolver_academia` son
       `SECURITY INVOKER`);
     - una función o procedimiento con valores propios (`proconfig`) que fijen algo distinto de `search_path` (por
       ejemplo `SET row_security = off`);
     - una regla de reescritura (`pg_rewrite`) que no sea la `_RETURN` de una vista: las reglas se ejecutan con los
       permisos del dueño de la tabla, que en Docker y en la CI es superusuario;
     - una tabla o partición (`'r'` o `'p'`, incluidas las particiones, `relispartition`) distinta de `_prisma_migrations`
       sin RLS activada y forzada (criterio 9).

     La prueba comprueba también que sus consultas detectan cada caso: como dueño, dentro de una transacción que se
     revierte al final, crea una vista sin `security_invoker` (detectada) y otra con `security_invoker = true` (no
     detectada), una vista materializada, una función `SECURITY DEFINER`, una función `SECURITY INVOKER` con
     `SET row_security = off`, una regla `DO INSTEAD NOTHING` sobre `configuraciones` y una tabla particionada con RLS
     forzada cuya partición no la tiene; cada una aparece en el resultado de su consulta. Una historia que necesite una
     excepción la agrega a la lista, con su justificación, en su especificación. _(crítico)_
125. **Privilegios sobre vistas y vistas materializadas** _(ataque ronda 5, F3; complementa el criterio 102)_. Dado que la
     comprobación del rol ya calcula los privilegios sobre vistas y vistas materializadas de `public` (criterio 102),
     entonces la prueba lo fija con dos casos más, como los del criterio 102 (una API nueva por caso y restaurando al
     final): `CREATE MATERIALIZED VIEW public.mv_prueba AS SELECT id, nombre FROM academias` con
     `GRANT SELECT ON mv_prueba TO aquagestion_app`, y `CREATE VIEW public.v_prueba WITH (security_invoker = true) AS
     SELECT id FROM academias` con `GRANT SELECT ON v_prueba TO aquagestion_app`. En cada caso `conAcademia`,
     `comoPlataforma` y `resolverAcademia` rechazan con `ErrorRolBaseDatosInseguro`, y `db:crear` termina con código 1
     nombrando el objeto y el privilegio, sin modificar nada. Ninguna historia concede privilegios sobre una vista
     materializada (no pasa por RLS; criterio 124). _(crítico)_
126. **Unicidad siempre dentro de la academia** _(ataque ronda 5, O5; complementa los criterios 11 y 12)_ _(alcance
     ampliado por el criterio 131, ataque ronda 6: todos los esquemas que no son del sistema)_. Dado que una
     restricción única global en una tabla de academia respondería 409 ante un valor que existe en otra academia (por
     ejemplo, un `numero_operacion` de pagos, RN-28) y revelaría así datos de esa academia, entonces, en el esquema
     `public`, toda llave primaria, restricción `UNIQUE`, índice único (también parcial) y restricción de exclusión de una
     tabla con columna `academia_id` tiene `academia_id` entre sus columnas clave (no basta en `INCLUDE` ni dentro de una
     expresión), con dos excepciones: la llave primaria formada solo por `id`, de tipo `uuid` y con valor por defecto
     `gen_random_uuid()`; y las de la lista "Unicidad sin `academia_id` permitida" (hoy vacía). Prueba de catálogo que,
     además, como dueño dentro de una transacción que se revierte, comprueba que detecta una tabla de ejemplo con
     `numero_operacion text UNIQUE`, otra con `CREATE UNIQUE INDEX … (numero_operacion) INCLUDE (academia_id)`, otra con
     llave primaria `(numero)` de texto y otra con llave primaria `id uuid` sin valor por defecto, y que no detecta
     `UNIQUE (academia_id, numero_operacion)`. Las historias siguientes declaran así sus restricciones únicas (por
     ejemplo, el DNI único por academia de D-28). _(crítico)_
127. **Dependencias del backend de una lista permitida** _(ataque ronda 5, O1; complementa los criterios 85 y 96)_. Dado
     el repositorio, entonces:
     - `scripts/lib/dependencias-backend.mjs` (P-30) tiene la lista versionada de los paquetes que `backend/package.json`
       puede declarar (`DEPENDENCIAS_BACKEND_PERMITIDAS`), con las dependencias de hoy más `express` (criterio 128);
     - el paso protegido (`npm run lint:protegido`, dentro de `npm run lint`; la comprobación previa de P-28) termina con
       código 1 si `backend/package.json` declara, en `dependencies`, `devDependencies`, `optionalDependencies`,
       `peerDependencies`, `bundleDependencies` o `bundledDependencies`, un paquete que no está en la lista, nombrando el
       paquete y el archivo de la lista. Agregar una dependencia al backend exige agregarla a la lista en el mismo cambio,
       donde la ve la revisión;
     - la lista no contiene ningún paquete de la lista negra del criterio 129.

     Prueba unitaria de las funciones de P-30: con una carpeta temporal, un paquete fuera de la lista en cada sección se
     informa y uno de la lista no; el `backend/package.json` real cumple; y la lista permitida y la lista negra no
     comparten ningún paquete. _(crítico)_
128. **El backend solo importa paquetes que declara** _(ataque ronda 5, O1; complementa los criterios 85, 95 y 127)_.
     Dado que npm sube a `node_modules` de la raíz los paquetes de todos los espacios de trabajo, un paquete declarado en el
     `package.json` de la raíz, de `frontend/`, de `e2e/` o de `scripts/` (o una dependencia de otro paquete) se puede
     importar desde `backend/src/` sin pasar por la lista del criterio 127. Por eso, dado el código de `backend/src/` (sin
     las pruebas, criterio 110), `npm run lint` (también el paso protegido) falla si un archivo importa un valor, por
     cualquiera de las vías del criterio 85 (también `import 'x'` y `export … from`), con un especificador que no es
     relativo ni absoluto (criterio 95) y que no es un módulo de Node (`node:…` o un nombre de `module.builtinModules`) ni
     un paquete declarado en `backend/package.json` (en cualquier sección). El nombre del paquete es `@ámbito/nombre` o
     `nombre`, sin la subruta. Así fallan también los alias (`#…`, `~/…`, `@/…`) mientras no se declaren (riesgo O2).
     `import type` e `import { type X }` siguen permitidos. Pasan, por ejemplo, `import { Injectable } from
     '@nestjs/common'`, `import { randomBytes } from 'node:crypto'`, `import { readFileSync } from 'fs'` y
     `import { z } from 'zod'`; fallan `import postgres from 'postgres'`, `import x from 'pg-protocol'` (dependencia de
     `pg`, no declarada), `require('knex')` e `import { y } from '#interno'`. Consecuencia: `backend/package.json` declara
     `express`, que hoy se importa como valor sin estar declarado (llega como dependencia de `@nestjs/platform-express`).
     Prueba de la regla como en el criterio 92. _(crítico; prueba de la regla de lint)_

     Precisiones _(decisión del orquestador tras la ronda 5, 12/11/2026)_:
     - **Alcance:** la regla se aplica a todo `backend/src/` (sin las pruebas, criterio 110), sin excepciones de carpeta:
       también a `backend/src/infraestructura/prisma/`, a `backend/src/cli/` y a `backend/src/main.ts`. Las exenciones de
       esas carpetas en otros criterios (por ejemplo, el 129) no alcanzan a esta regla.
     - **Falla cerrada:** si `backend/package.json` no existe, no se puede leer o no se puede analizar como JSON, la regla
       no deja pasar nada: reporta en cada archivo revisado un error que dice que no encuentra o no puede leer
       `backend/package.json`. La prueba de la regla agrega estos tres casos (falta, ilegible y JSON inválido), cada uno
       con un archivo que, con un `backend/package.json` válido, pasaría.
     - **Ejemplos de otras reglas:** las pruebas protegidas de rondas anteriores que usan paquetes no declarados en
       `backend/package.json` (`pg-pool`, `@prisma/adapter-neon`, `sql-template-tag`) como ejemplos para probar
       exenciones de otras reglas se ejecutan en repositorios temporales cuyo `backend/package.json` los declara; lo que
       comprueban no cambia (ver "Impacto en especificaciones anteriores", ronda 5).
129. **Lista negra de clientes de base** _(ataque ronda 5, O1; complementa los criterios 85 y 95)_. Dado el código de
     `backend/src/` (sin las pruebas), fuera de `backend/src/infraestructura/prisma/` y de `backend/src/cli/`, entonces
     `npm run lint` (también el paso protegido) falla si un archivo importa, de valor o de tipo, por cualquiera de las vías
     del criterio 85 y también como ruta a `node_modules/` (criterio 95), un paquete de la lista negra de clientes de base
     (`CLIENTES_DE_BASE_PROHIBIDOS`, P-30), con o sin subruta: `postgres`; `knex`; `kysely` y `kysely-…`; `slonik`,
     `slonik-…` y `@slonik/…`; `@neondatabase/…`; `@vercel/postgres` y `@vercel/postgres-…`; todo nombre que empiece por
     `mysql` (`mysql`, `mysql2`); `sequelize` y `sequelize-…`; `typeorm` y `@typeorm/…`; `drizzle-orm` (también
     `drizzle-orm/node-postgres` y las demás subrutas) y `drizzle-…`; `pg-promise`; `pg-native`; `@databases/…`;
     `@mikro-orm/…`; y `@electric-sql/pglite`. Es una segunda capa sobre el criterio 128, por si alguno llega a
     declararse. Prueba de la regla como en el criterio 92: un ejemplo que falla por cada entrada de la lista (con
     `import`; y para `postgres` y `@neondatabase/serverless`, también con `require`, `import()`, `import type` y la ruta a
     `node_modules/`), y `import { Injectable } from '@nestjs/common'` pasa. _(crítico; prueba de la regla de lint)_

### O. Correcciones del ataque adversarial, ronda 6

Criterios agregados tras la ronda 6 del ataque (12/11/2026, sobre el commit `84b367b`). La ronda no encontró fallas nuevas
en las garantías de ejecución de 001; las tres fallas están en las guardas que protegen a las historias siguientes: la
comprobación del rol y las pruebas de catálogo solo miraban `public`, la prueba de las políticas aceptaba expresiones que
amplían el acceso, y una transacción guardada en un servicio se podía usar desde otra petición. Son decisiones técnicas de
seguridad, no reglas de negocio nuevas. Donde un criterio amplía o ajusta uno anterior lo dice, y el anterior queda marcado
"(… ataque ronda 6)", sin borrar su texto. Contratos nuevos: precisiones P-31 a P-33. Todos son _(crítico)_.

Definiciones de esta sección:

- **Esquemas revisados:** todos los de `pg_catalog.pg_namespace` salvo `pg_catalog`, `information_schema`, `pg_toast` y los
  temporales (`pg_temp_N` y `pg_toast_temp_N`), y salvo los esquemas que pertenecen a una extensión.
- **Objeto de extensión:** el que tiene en `pg_catalog.pg_depend` una fila con `deptype = 'e'` hacia `pg_extension`. No se
  cuenta en ninguna comprobación de esta sección (ver "Riesgos aceptados").

Esta ronda crea una lista de excepciones, **hoy vacía**, que solo una especificación puede ampliar, con la justificación de
cada elemento (como la lista del criterio 10):

- **Esquemas permitidos además de `public`** (criterio 130): ninguno.

130. **Privilegios del rol en todos los esquemas** _(ataque ronda 6, F1 (a) y (c); **amplía** los criterios 102 y 123)_.
     Dada la comprobación del rol (en la API, la del criterio 80; en `npm run db:crear`, sobre la base de desarrollo y la de
     pruebas), entonces, además de lo que ya comprueba:
     - calcula los privilegios efectivos de `aquagestion_app` (concedidos al rol, heredados o a `PUBLIC`, con las funciones
       `has_*_privilege` sobre `current_user` en la API y sobre `'aquagestion_app'` en `db:crear`, calificadas con
       `pg_catalog.` como pide el criterio 121) en todos los esquemas revisados, sin contar los objetos de extensiones:
       - de tabla y de columna sobre tablas, tablas particionadas, vistas, vistas materializadas y tablas foráneas, y de
         secuencia, como el criterio 102;
       - `EXECUTE` sobre funciones y procedimientos (`pg_proc`, cualquier `prokind`) de `public` y de todo esquema revisado
         sobre el que la app tiene `USAGE`;
       - `USAGE` sobre cada esquema revisado;
     - y los compara con lo permitido (P-31):
       - tabla, columna o secuencia: solo lo de `PRIVILEGIOS_APP` (criterio 2), que se refiere a objetos de `public`;
         cualquier privilegio sobre un objeto de otro esquema es de más, tenga o no la app `USAGE` sobre ese esquema;
       - `EXECUTE`: solo las funciones de `FUNCIONES_APP`, todas de `public` e identificadas por nombre y argumentos
         (`pg_get_function_identity_arguments`): `app_academia_actual()`, `app_es_plataforma()` y
         `resolver_academia(p_nombre_corto text)`; cualquier otra es de más, también una función nueva de `public` con el
         `EXECUTE` que PostgreSQL concede a `PUBLIC` por defecto;
       - `USAGE`: sobre `public`; sobre otro esquema revisado, solo si no contiene ninguna relación (`pg_class`) ni función
         (`pg_proc`) que no sea de una extensión, o si está en la lista "Esquemas permitidos además de `public`" (hoy
         vacía). Un esquema vacío, o con solo objetos de extensiones, no se rechaza (sigue valiendo el control del criterio
         123); uno con una tabla, vista, secuencia o función propia sí, aunque la app no tenga privilegios sobre ellas (F1
         (c): mientras no haya una lista aprobada);
     - ser dueño de un objeto de otro esquema da todos sus privilegios, así que esta comparación también lo rechaza.

     Cualquier privilegio de más hace que la API rechace con `ErrorRolBaseDatosInseguro` como en el criterio 4 (el log nombra
     el esquema, el objeto, la columna si la hay y el privilegio, nunca la URL ni la contraseña) y que `db:crear` termine con
     código 1 con un mensaje que nombra lo mismo y la corrección (`REVOKE SELECT ON reportes.auditoria_todas FROM
     aquagestion_app;` o `… FROM PUBLIC;` si viene de ahí, `REVOKE EXECUTE ON FUNCTION <esquema>.<nombre>(<argumentos>) FROM
     PUBLIC;`, `REVOKE USAGE ON SCHEMA <esquema> FROM aquagestion_app;` o `… FROM PUBLIC;`), sin modificar nada. Con las
     migraciones de esta historia y nada más, la comprobación pasa. Toda historia que agregue una función a `public` la
     agrega a `FUNCIONES_APP` en su especificación, o revoca en su migración el `EXECUTE` de `PUBLIC`.

     Prueba unitaria de `privilegiosDeMasEnEsquemas` (P-31): cada regla sola, las tres funciones permitidas, `USAGE` sobre un
     esquema vacío y sobre uno con objetos propios, y un valor desconocido (falla cerrada); y de que `FUNCIONES_APP` y
     `ESQUEMAS_PERMITIDOS` de la API y de `scripts/lib/rol-app.mjs` son iguales. Prueba de integración, con una API nueva
     por caso y restaurando al final (si el dueño de la base de pruebas no puede crear esquemas, los casos con esquema se
     omiten con aviso; corren en Docker y en la CI); en cada caso `conAcademia`, `comoPlataforma` y `resolverAcademia`
     rechazan con `ErrorRolBaseDatosInseguro`:
     1. el ataque: `CREATE SCHEMA reportes`, `GRANT USAGE ON SCHEMA reportes TO aquagestion_app`,
        `CREATE VIEW reportes.auditoria_todas AS SELECT * FROM public.auditoria` y
        `GRANT SELECT ON reportes.auditoria_todas TO aquagestion_app`;
     2. lo mismo con `USAGE` y `SELECT` concedidos a `PUBLIC`;
     3. una tabla `reportes.t` con `GRANT SELECT (id) ON reportes.t TO aquagestion_app`, sin `USAGE` sobre `reportes`;
     4. una secuencia `reportes.s` con `GRANT USAGE ON SEQUENCE reportes.s TO aquagestion_app`;
     5. una función `reportes.f()` (con el `EXECUTE` por defecto) y `USAGE` sobre `reportes`;
     6. una función nueva `public.funcion_extra()` con el `EXECUTE` por defecto;
     7. `USAGE` sobre `reportes`, que contiene una tabla sin ningún privilegio para la app.

     Controles que pasan: el caso 6 después de `REVOKE EXECUTE ON FUNCTION public.funcion_extra() FROM PUBLIC`; `reportes`
     con una función y sin `USAGE` para la app ni para `PUBLIC`; `USAGE` sobre un esquema vacío (criterio 123); y, si el
     dueño puede instalar una extensión de confianza (por ejemplo `CREATE EXTENSION pgcrypto SCHEMA ext_prueba` con
     `GRANT USAGE ON SCHEMA ext_prueba TO aquagestion_app`), ese esquema (si no puede, se omite con aviso). En `db:crear`, al
     menos los casos 1 y 2. _(crítico)_
131. **Pruebas de catálogo en todos los esquemas** _(ataque ronda 6, F1 (b); **amplía** los criterios 9, 10, 11, 12, 124 y
     126)_. Dadas las migraciones aplicadas en la base de pruebas, entonces las pruebas de catálogo de los criterios 9, 10,
     11, 12, 124 y 126 (y la del 132) revisan las relaciones, funciones, reglas, índices, restricciones y políticas de todos
     los esquemas revisados (sin los objetos de extensiones), no solo de `public`:
     - las excepciones por nombre (`_prisma_migrations` del criterio 9 y la lista del criterio 10) valen solo en `public`
       (`public._prisma_migrations`, `public.academias`, …): una tabla con ese nombre en otro esquema no tiene excepción;
     - "tabla con `academia_id`" en los criterios 11, 12, 126, 132 y 133 es una tabla de cualquiera de esos esquemas;
     - las listas de excepciones de los criterios 124 y 126 (hoy vacías) se escriben con el esquema (`public.nombre`).

     Autocomprobación: como dueño, dentro de una transacción que se revierte, crea el esquema `reportes_prueba` con una tabla
     sin RLS (la detecta la consulta del criterio 9), una tabla `reportes_prueba.academias` sin `academia_id` (la detecta la
     del 10: la excepción no vale fuera de `public`), una vista sin `security_invoker` y una función `SECURITY DEFINER` (124),
     y una tabla con `academia_id` y `UNIQUE (numero)` (126); cada una aparece en el resultado de su consulta. Si el dueño no
     puede crear esquemas, la autocomprobación se omite con aviso; las consultas sobre la base real corren igual. _(crítico)_
132. **Cada política de una tabla de academia exige su academia** _(ataque ronda 6, F2 (a); complementa el criterio 11)_.
     Dado que la prueba del criterio 11 acepta cualquier expresión que contenga la comparación (por ejemplo
     `academia_id = app_academia_actual() OR app_es_plataforma()`, `… OR <cualquier cosa>` o
     `EXISTS (SELECT 1 FROM auditoria a WHERE a.academia_id = app_academia_actual())`, que no depende de la fila), entonces,
     en toda tabla con `academia_id` (criterio 131), para cada política, permisiva o restrictiva, y para cada una de sus
     expresiones (`USING` y `WITH CHECK`, las que tenga):
     - la expresión es exactamente la comparación `academia_id = app_academia_actual()`, en cualquier orden
       (`app_academia_actual() = academia_id`), con o sin `public.` delante de la función y con o sin paréntesis, o una
       conjunción (`AND`) en la que esa comparación es uno de los términos de primer nivel (una conjunción anidada,
       `a AND (b AND c)`, cuenta como de primer nivel; un término dentro de `OR`, `NOT`, `CASE`, `EXISTS` o una subconsulta,
       no);
     - ninguna expresión menciona `app_es_plataforma` ni `set_config`, en ningún término;
     - toda política permisiva adicional cumple lo mismo (las permisivas se combinan con `OR`: una sola que no cumpla amplía
       el acceso), y las de `INSERT` tienen `WITH CHECK` y las de `SELECT`, `UPDATE`, `DELETE` y `ALL`, `USING` (criterio 11).

     La prueba lee las expresiones como dueño, con `pg_catalog.pg_get_expr(polqual, polrelid)` y
     `pg_catalog.pg_get_expr(polwithcheck, polrelid)` de `pg_catalog.pg_policy`, dentro de una transacción con `search_path`
     fijado en `pg_catalog, public` (así un operador `=` o una función `app_academia_actual` de otro esquema aparecen
     calificados y no cumplen). Autocomprobación, como dueño, en una transacción que se revierte, con tablas de ejemplo con
     `academia_id` (como las de 001: `uuid NOT NULL`, llave foránea a `academias` y RLS forzada): detecta
     `USING (academia_id = app_academia_actual() OR app_es_plataforma())`, `USING ((academia_id = app_academia_actual()) OR
     true)`, el `EXISTS` del ejemplo, `WITH CHECK (academia_id = app_academia_actual() OR app_es_plataforma())` con un
     `USING` correcto, una segunda política permisiva `USING (academia_id IS NOT NULL)` junto a una correcta, una restrictiva
     `USING (app_es_plataforma())` y `USING (academia_id = app_academia_actual() AND pg_catalog.set_config('app.academia_id',
     '', true) IS NOT NULL)`; y no detecta `USING (academia_id = app_academia_actual())`,
     `USING (app_academia_actual() = academia_id)`, `USING (public.app_academia_actual() = academia_id)`,
     `USING (academia_id = app_academia_actual() AND clave <> 'x')` ni
     `USING (clave <> 'x' AND (academia_id = app_academia_actual() AND valor IS NOT NULL))`. Las políticas de las tablas sin
     `academia_id` (`academias`, `superadmins` y `auditoria_plataforma`) no cambian. Lector de las expresiones: P-33.
     _(crítico)_
133. **Ninguna tabla de academia se ve fuera de su academia, en ejecución** _(ataque ronda 6, F2 (b); **generaliza** los
     criterios 13, 17 y 18)_. Dadas las migraciones aplicadas y, en **cada** tabla con `academia_id` que encuentra el catálogo
     (criterio 131; no una lista fija), al menos una fila de A y una de B creadas por la prueba con el sembrador de esa tabla
     (P-33; si una tabla no tiene sembrador, la prueba falla nombrándola, como la lista del criterio 10), entonces, como app:
     - sin contexto, y con `app.academia_id` vacío: `SELECT` devuelve 0 filas;
     - en contexto de plataforma: 0 filas;
     - en contexto de plataforma y de A a la vez: solo filas de A;
     - en contexto de B: ninguna fila de A (todas las que devuelve son de B);
     - en contexto de A, un `INSERT` de una copia de una fila de A con el `academia_id` de B (sin las columnas generadas ni
       las `GENERATED ALWAYS`) falla con `42501`;
     - si la app no tiene `SELECT` sobre la tabla, el `SELECT` puede fallar con `42501` en lugar de devolver 0 filas.

     Antes, como dueño con el contexto de cada academia, la prueba confirma que las filas sembradas existen (no vale pasar
     en vacío). Autocomprobación con tablas trampa en una transacción que se revierte, como dueño que toma el rol de la app con
     `SET LOCAL ROLE aquagestion_app` (exige superusuario o ser miembro del rol: Docker y CI; en la nube se omite con aviso),
     cada una con `academia_id`, RLS forzada y `SELECT` e `INSERT` para la app: una con la política
     `academia_id = app_academia_actual() OR app_es_plataforma()` (la detecta el contexto de plataforma), otra con una
     política correcta más una permisiva `FOR SELECT USING (true)` (la detecta la consulta sin contexto) y otra con `USING`
     correcto y `WITH CHECK (academia_id IS NOT NULL)` (la detecta el `INSERT` con B). Con las tablas de 001 (`auditoria` y
     `configuraciones`) la prueba pasa. _(crítico)_
134. **El envoltorio solo responde en el contexto de su `trabajo`** _(ataque ronda 6, F3; complementa los criterios 100 y
     106)_. Dado que un servicio de Nest es una sola instancia para todas las peticiones, y que guardar `tx` en un campo
     (`this.tx = tx`) deja que una petición simultánea use la transacción de otra academia mientras sigue abierta, entonces:
     - `BaseDatos` ejecuta todo lo que usa el envoltorio de una transacción (la comprobación de la academia de
       `conAcademia` y `trabajo`) dentro de un contexto asíncrono propio de esa transacción (`AsyncLocalStorage.run` con una
       marca única por transacción; P-32);
     - cada función del envoltorio (`$queryRaw`, `$executeRaw` y cada operación de cada delegado) comprueba, al llamarse y
       antes de enviar nada, que el contexto asíncrono actual es el de su transacción; si no (una llamada desde otra
       petición, desde otra transacción, también una anidada, o desde fuera de toda transacción), devuelve una promesa
       rechazada con un `Error` y no envía nada a la base, aunque la transacción siga abierta;
     - dentro de `trabajo` siguen funcionando las formas normales de concurrencia, porque heredan el contexto:
       `Promise.all`, funciones `async` llamadas desde `trabajo`, `setTimeout`, `setImmediate`, `queueMicrotask` y eventos
       emitidos desde `trabajo` (las pruebas de los criterios 24 y 106 siguen pasando);
     - lo de los criterios 106 y 112 no cambia: después de terminar `trabajo` rechaza con un `Error`, y con argumentos no
       admitidos, con `TypeError`.

     Prueba de integración con `DATABASE_POOL_MAX=2`, los datos de `crearDatosDeAislamiento` y un servicio de prueba (una
     instancia de una clase con un campo), cuyo método `primera` llama a `conAcademia(A, …)`, guarda `tx` en `this.tx`, avisa
     y espera una barrera; y cuyo método `segunda`, llamado a la vez, dentro de `conAcademia(B, …)` y después del aviso (con la
     transacción de A todavía abierta), usa `this.tx.cliente` con `$queryRaw` (lectura de `auditoria`), `$executeRaw` (un
     `INSERT` en `configuraciones` con una clave nueva), un delegado de lectura y otro de escritura; y lo mismo desde
     `comoPlataforma` y desde el cuerpo de la prueba, fuera de toda transacción. Entonces cada llamada rechaza con un
     `Error` y no devuelve filas; cuando las dos transacciones terminan, las filas que esas llamadas intentaron escribir no
     existen (leído como dueño con `pg`); y la transacción de A termina bien, con sus propias consultas dentro de `trabajo`
     funcionando. Además, dentro de `conAcademia(A, …)` con un `conAcademia(B, …)` anidado (el plan pide no anidar, nota
     O1), usar el `tx` de A dentro del `trabajo` de B rechaza. _(crítico)_
135. **El lint señala una transacción guardada fuera de su `trabajo`** _(ataque ronda 6, F3; complementa el criterio 134)_.
     Dado el código de `backend/src/` (sin las pruebas, criterio 110), entonces `npm run lint` (el lint normal,
     `eslint.config.mjs`; no el paso protegido) falla con una regla propia (orientativo:
     `aquagestion/sin-transaccion-guardada`) si se asigna (`=`, `??=`, `||=` o `&&=`) a una propiedad de `this` (`this.x`,
     `this.#x`, `this.a.b`, `this[x]`), o a una variable declarada en el nivel del módulo o a una propiedad de ella, un valor
     que, quitando paréntesis, `as`, `satisfies` y `!`, es:
     - un identificador que ESLint resuelve (por ámbito) a un parámetro, o a una propiedad desestructurada de un parámetro,
       de una función pasada como `trabajo` a `<algo>.conAcademia(id, trabajo)` o a `<algo>.comoPlataforma(trabajo)`;
     - un identificador declarado con una anotación de tipo `TransaccionAcademia`, `TransaccionPlataforma` o
       `ClienteTransaccion` (también calificada, `X.TransaccionAcademia`);
     - o un acceso `.cliente` sobre uno de esos.

     Además, fuera de `backend/src/infraestructura/`, la regla falla con cualquier importación de `async_hooks` o
     `node:async_hooks` (por cualquiera de las vías del criterio 85): `AsyncLocalStorage.snapshot()` o `AsyncResource.bind`
     guardados dentro de `trabajo` y ejecutados desde otra petición llevarían el contexto de la transacción. Pasan, por
     ejemplo: `const t = tx` dentro de `trabajo`, `this.auditoria.registrarEnAcademia(tx, entrada)`,
     `this.cliente = clienteHttp` en un constructor y `this.total = filas.length`. Fallan: `this.tx = tx`, `this.#tx = tx`,
     `this.cliente = tx.cliente`, `this.estado.tx = tx`, `transaccionGuardada = tx` (variable del módulo),
     `this.tx = tx as TransaccionAcademia`, `this.c = cliente` con `async ({ cliente }) => …` pasado a `comoPlataforma`,
     `this.t = transaccion` con `transaccion: TransaccionPlataforma` como parámetro de un método, e
     `import { AsyncLocalStorage } from 'node:async_hooks'` en un módulo. Las copias por alias (`const t = tx; this.x = t`),
     `Object.assign(this, { tx })` y una transacción guardada dentro de un arreglo o de una función no se siguen: la garantía
     es el criterio 134 ("Riesgos aceptados"). Prueba de la regla con la clase `ESLint` y `eslint.config.mjs`, como en el
     criterio 92. _(crítico; prueba de la regla de lint y verificación del revisor)_
136. **`SET CONSTRAINTS` pasa; `lastval` y `currval` no** _(ataque ronda 6, O2 y O4; **ajusta el alcance** del criterio 84 y
     complementa el 94)_. Dado el texto normalizado de una plantilla analizada (criterios 83 y 92), fuera de
     `backend/src/infraestructura/prisma/` (también en `cli/`), entonces:
     - una sentencia (el texto completo o un tramo entre `;`) que es exactamente `SET CONSTRAINTS <lista> DEFERRED` o
       `SET CONSTRAINTS <lista> IMMEDIATE`, donde `<lista>` es `ALL` o uno o más nombres separados por comas (identificadores
       simples o entre comillas dobles, con o sin `public.` delante), ya no hace fallar el lint: es local a la transacción y
       no toca el contexto. Cualquier otra forma de `SET` como sentencia sigue fallando (criterio 84), también
       `SET CONSTRAINTS ${nombre} DEFERRED` (un marcador en lugar de un nombre), `SET CONSTRAINTS ALL` sin `DEFERRED` ni
       `IMMEDIATE`, y la sentencia que sigue a un `;` (`SET CONSTRAINTS ALL DEFERRED; SET ROLE postgres` falla por la
       segunda);
     - falla una llamada a `lastval` o a `currval`, con o sin `pg_catalog.`, con o sin comillas dobles o `U&"…"` en el nombre
       (criterio 93) y con o sin espacios antes del paréntesis: devuelven el último valor de una secuencia en la **sesión**,
       y la conexión del pool pasa de una academia a otra (se usa `RETURNING`; plan, nota O4).

     Pasan, por ejemplo, `SET CONSTRAINTS ALL DEFERRED`, `set constraints "pagos_caja_fk", public.otra_fk immediate`,
     `SELECT nextval('x_id_seq')`, `SELECT t.currval FROM t` (una columna, sin paréntesis) e `INSERT … RETURNING id`; fallan
     `SELECT lastval()`, `SELECT pg_catalog.currval('x_id_seq')`, `SELECT "currval" ('x')` y los de la viñeta anterior.
     Ningún ejemplo de las pruebas protegidas de las rondas 1 a 5 cambia de resultado (ninguno usa `SET CONSTRAINTS`,
     `lastval` ni `currval`); si alguno cambiara, el test-writer se detiene e informa. Prueba de la regla como en el
     criterio 92. _(crítico; prueba de la regla de lint)_

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
- **Rol de la app con `REPLICATION`, dueño de la base o con tablas temporales:** la API no atiende datos y
  `db:crear` se detiene (criterios 80 y 81); `TEMPORARY` se revoca a `PUBLIC` (criterio 82) _(ataque ronda 2)_.
- **Cuerpos comprimidos:** se admiten `gzip` y `deflate`; el límite de 100 KB vale para el cuerpo descomprimido;
  cualquier otra codificación es 400 (criterio 89) _(ataque ronda 2)_.
- **Textos de relleno (hangul de relleno, Braille en blanco) y emojis:** no cuentan como visibles (criterio 87); las
  longitudes se cuentan por puntos de código en la API, la web, el comando y la semilla (criterio 88)
  _(ataque ronda 2)_.
- **Base, URL o sesión con otra zona horaria (`TimeZone`):** cada transacción fija `UTC`; un rol con `TimeZone` propio
  se rechaza (criterios 98 y 103) _(ataque ronda 3)_.
- **Estado de sesión que sobrevive en el pool (cursores `WITH HOLD`):** cada transacción ejecuta `CLOSE ALL` y el lint
  prohíbe los cursores (criterios 94 y 101) _(ataque ronda 3)_.
- **Un `GRANT` o un `ALTER ROLE … SET` hechos a mano sobre el rol de la app:** la API no atiende datos y `db:crear` se
  detiene, con la corrección (criterios 102 y 103) _(ataque ronda 3)_.
- **Cuerpo con bytes que no son UTF-8:** 400, sin guardar U+FFFD (criterio 105) _(ataque ronda 3)_.
- **Código legítimo con palabras de SQL (`'end'`, `'commit'`, `'Set-Cookie'`, "reset de la clave"):** pasa el lint,
  porque solo se analiza el texto de las plantillas que llegan a la base (criterio 92) _(ataque ronda 3)_.
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
- **Una consulta lanzada sin `await` dentro de `trabajo`** _(ataque ronda 4)_: con promesas nativas se envía al
  llamarla (criterio 106). Si `trabajo` termina antes de que responda, la consulta corre dentro de la transacción (en
  la misma conexión, antes del cierre) o falla; nunca corre fuera de ella. Quien la lanzó sin esperar no ve su error:
  el revisor busca promesas sin `await` dentro de `trabajo`.
- **Base de datos con otro `DateStyle` (por ejemplo, un hosting con `SQL, DMY`)** _(ataque ronda 4)_: no afecta a la
  API ni a los comandos (criterio 107); sí a herramientas externas como `psql`, que no son parte del sistema.
- **Lista vacía en un filtro** _(ataque ronda 4)_: `join([])` lanza `TypeError` (P-25); quien filtra por una lista que
  puede venir vacía usa `= ANY(${lista}::uuid[])`, que con un arreglo vacío no devuelve filas.
- **Restablecer la clave mientras alguien inicia sesión con la anterior** _(ataque ronda 5)_: si el restablecimiento
  confirma antes de que se acepte el ingreso, responde 401 sin contar el intento; si confirma después, la sesión emitida
  ya no vale porque el comando sube `version_token` (criterios 34 y 120).
- **Hosting con otro `search_path` o con un esquema con el nombre del rol** _(ataque ronda 5)_: el `search_path` no
  afecta a la API ni a los comandos (criterio 121); un esquema `aquagestion_app`, uno propio del rol o uno donde pueda
  crear detienen la API y `db:crear` (criterio 123).
- **Una migración que crea una vista, una función o una restricción única** _(ataque ronda 5)_: la vista va con
  `security_invoker = true`, la función como `SECURITY INVOKER` y la restricción con `academia_id`; si no, fallan las
  pruebas de catálogo (criterios 124 y 126).
- **Una dependencia nueva en el backend** _(ataque ronda 5)_: se agrega a `backend/package.json` y a la lista permitida
  en el mismo cambio (criterio 127); un paquete que solo está en otro espacio de trabajo no se puede importar desde
  `backend/src` (criterio 128).

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
`Entorno` y quién crea el rol `aquagestion_app` en cada entorno: precisiones P-1 y P-11. Al arrancar, la API borra de
`process.env` las variables `DATABASE_URL*` (salvo `DATABASE_URL_APP`), las `PG*` y `SUPERADMIN_CLAVE` (criterio 99,
P-21) _(ataque ronda 3)_, sin distinguir mayúsculas (criterio 116) _(ataque ronda 4)_.

### Servicios del backend (contrato para las pruebas)

Exportados desde `backend/src/infraestructura/prisma/index.ts`:

```ts
type ClienteTransaccion = Prisma.TransactionClient; // del cliente generado (ataque ronda 3: el envoltorio, P-24; ronda 4: P-26)
// Ataque ronda 4: además Decimal, codigoDeErrorDeBase, esViolacionDeUnicidad, sql, join, vacio y Fragmento (P-25)
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
_(ataque ronda 1)_. `Content-Encoding` admitido: ninguno, `identity`, `gzip` o `deflate`; cualquier otro es 400, y el
límite de 100 KB se aplica al cuerpo descomprimido (criterio 89). Las longitudes de los textos se cuentan por puntos
de código (criterio 88) _(ataque ronda 2)_. Detalles de `Content-Encoding` y de las longitudes del correo: precisiones
P-16 y P-18 _(precisión tras las pruebas de la ronda 2, 11/11/2026)_. Un cuerpo que no es UTF-8 válido es 400
`SOLICITUD_INVALIDA` (criterio 105) _(ataque ronda 3)_.

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

_(precisión tras las pruebas de la ronda 2, 11/11/2026)_. Detalles técnicos que el contrato no fijaba y que las
pruebas protegidas de la ronda 2 dan por hechos. No son reglas de negocio nuevas ni cambian el sentido de ningún
criterio.

- **P-12. Función pura del rol en la API (criterio 80).** `backend/src/infraestructura/prisma/rol-seguro.ts` exporta:

  ```ts
  interface FilaRol {
    rolsuper: boolean; rolbypassrls: boolean; rolreplication: boolean; rolcreaterole: boolean; rolcreatedb: boolean;
    es_miembro: boolean; dueno_de_la_base: boolean; crea_en_base: boolean; temporales: boolean;
    crea_en_public: boolean; es_dueno: boolean;
  }
  export function problemasDelRol(fila: FilaRol): string[];
  ```

  Con todos los campos en `false` (rol seguro) devuelve `[]`. Con cualquier campo en `true` devuelve al menos un
  problema; con dos campos en `true`, al menos dos textos distintos. Las pruebas no fijan el texto de cada problema.
  La API rechaza con `ErrorRolBaseDatosInseguro` si la lista no está vacía (o si la consulta no devuelve fila).
- **P-13. Función pura del rol para `db:crear` y el hook (criterio 81).** `scripts/lib/rol-app.mjs` solo importa
  módulos `node:*` o rutas relativas (el hook lo carga sin `node_modules`) y exporta:

  ```js
  // fila: { rolname: string, rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb, es_miembro: boolean }
  export function problemasDelRolApp(fila) /* : string[] */;
  ```

  Con todos los booleanos en `false` devuelve `[]`. Por cada atributo activo devuelve un problema que contiene el
  nombre del atributo (`SUPERUSER`, `BYPASSRLS`, `REPLICATION`, `CREATEROLE` o `CREATEDB`) y su corrección exacta
  `ALTER ROLE aquagestion_app NO<ATRIBUTO>;` (por ejemplo, `ALTER ROLE aquagestion_app NOCREATEDB;`). Con
  `es_miembro` en `true`, un problema con una corrección de la forma `REVOKE … FROM aquagestion_app` (el rol del que
  es miembro puede ir como marcador). Los mensajes de `db:crear` sobre las condiciones que dependen de cada base
  nombran la condición (`CREATE` sobre la base o sobre `public`, `TEMPORARY`, dueño o propietario de la base o de
  objetos de `public`); las pruebas buscan esas palabras, no el texto exacto.
- **P-14. `RESET` solo como sentencia (criterios 83 y 84).** La regla del SQL reconoce `RESET` solo cuando una
  sentencia (el texto normalizado completo, o un tramo entre `;`) es exactamente `RESET ALL`, `RESET ROLE`,
  `RESET SESSION AUTHORIZATION` o `RESET <parámetro>` (un identificador, con puntos si los tiene), sin más palabras.
  Un texto natural como `"reset de la clave del usuario"` no es esa sentencia y pasa el lint. Fuera de
  `backend/src/infraestructura/prisma/` (también en `backend/src/cli/`), `SET LOCAL statement_timeout = …` (criterio
  84, cualquier `SET` como sentencia) y `set_config('statement_timeout', …)` (criterio 83, primer literal que no empieza
  por `app.`) hacen fallar el lint; por eso no figuran entre los ejemplos que pasan de
  `eslint/regla-sql-sesion.test.mjs`.
- **P-15. Comentarios `eslint-disable` sin efecto (criterios 73, 83, 84 y 85)** _(alcance ajustado por el criterio
  96, ataque ronda 3)_. En los archivos donde se aplican estas
  reglas, ningún comentario de configuración en línea (`eslint-disable`, `eslint-disable-line`,
  `eslint-disable-next-line`, `/* eslint-disable */` de archivo, con o sin nombres de reglas, ni `/* eslint … off */`)
  puede apagarlas: se configura `linterOptions.noInlineConfig: true` (o un mecanismo equivalente que impida que el
  comentario surta efecto) para esos archivos. No basta con un plugin que informe del comentario: la prueba exige que
  el error de la regla siga apareciendo con el comentario presente.
- **P-16. `Content-Encoding` (criterio 89).**
  - Límite exacto: un cuerpo que descomprimido mide 102 400 bytes se acepta; uno de 102 401 bytes responde 413
    `CARGA_EXCESIVA`.
  - `Content-Encoding:` con valor vacío (o solo espacios) es una cabecera presente con valor vacío y responde 400; solo
    la ausencia de la cabecera equivale a "sin `Content-Encoding`".
  - Las peticiones sin cuerpo, como `GET` o un `DELETE /api/plataforma/sesion` sin cuerpo, no miran `Content-Encoding`
    y responden como sin ella (por ejemplo, 204 al cerrar sesión con `Content-Encoding: br`).
  - Toda respuesta 400 de este criterio (valor no admitido o cuerpo comprimido corrupto) lleva
    `detalles: { errores: [{ campo: '', mensaje }] }`, con `mensaje` no vacío.
- **P-17. Conexión de los comandos (criterio 90).** `backend/src/cli/conexion.ts` exporta, como ya hace:

  ```ts
  export function crearClienteDelDueno(url: string): PrismaClient;
  export function enPlataforma<T>(cliente: PrismaClient, trabajo: (tx: ClienteTransaccion) => Promise<T>): Promise<T>;
  ```

  Las pruebas del criterio 90 las importan directamente.
- **P-18. Correo por puntos de código (criterio 88).** `z.email` no admite emojis, así que el límite de `correo` se
  prueba con direcciones ASCII válidas: 254 caracteres se aceptan y 255 se rechazan, como los demás límites del
  criterio 88 (400 en la API; código 1 nombrando `SUPERADMIN_CORREO` en el comando y la semilla). En ASCII, puntos
  de código y unidades UTF-16 coinciden; la regla de contar por puntos de código no cambia.

_(contrato de la ronda 3 del ataque, 11/11/2026)_. Firmas que las pruebas protegidas de los criterios 92 a 105 dan por
hechas. No son reglas de negocio nuevas.

- **P-19. Valores por defecto del rol (criterio 103).** Funciones nuevas y separadas, para no cambiar las de P-12 y
  P-13 (sus pruebas pasan filas sin campos nuevos):
  - `backend/src/infraestructura/prisma/rol-seguro.ts` exporta
    `problemasDeConfiguracion(fila: { readonly tiene_configuracion: boolean }): string[]` (`[]` con `false`; un
    problema con `true` o con cualquier valor distinto de `false`);
  - `scripts/lib/rol-app.mjs` exporta `problemasDeConfiguracionApp({ rolconfig, bases })`, con `rolconfig: string[] |
    null` (de `pg_roles`) y `bases: string[]` (nombres de las bases con filas de `pg_db_role_setting` para el rol):
    `[]` si `rolconfig` es nulo o vacío y `bases` está vacía; si no, un problema con
    `ALTER ROLE aquagestion_app RESET ALL;` y uno por base con `ALTER ROLE aquagestion_app IN DATABASE <base> RESET
    ALL;`.
- **P-20. Privilegios permitidos (criterio 102).** `backend/src/infraestructura/prisma/privilegios-app.ts` y
  `scripts/lib/rol-app.mjs` exportan, con los mismos nombres y el mismo contenido:

  ```ts
  interface PrivilegioApp { readonly tabla: string; readonly columna: string | null; readonly privilegio: string }
  const PRIVILEGIOS_APP: readonly PrivilegioApp[]; // criterio 2; columna null = toda la tabla; privilegio en mayúsculas
  function privilegiosDeMas(efectivos: readonly PrivilegioApp[]): string[]; // [] si todo está permitido
  ```

  Un efectivo `(t, null, p)` se permite si `(t, null, p)` está en la lista; uno `(t, c, p)`, si está `(t, null, p)` o
  `(t, c, p)`. Por cada efectivo no permitido devuelve un texto que contiene la tabla, el privilegio y, si es de
  columna, la columna.
- **P-21. Variables que la API retira (criterio 99).** `backend/src/infraestructura/entorno/` (exportado por su
  `index`) exporta `retirarVariablesSensibles(env: Record<string, string | undefined>): void`, que borra del objeto
  recibido toda clave que empiece por `DATABASE_URL` salvo `DATABASE_URL_APP`, toda clave que empiece por `PG` y
  `SUPERADMIN_CLAVE`, y no toca las demás. _(Alcance ajustado por el criterio 116, ataque ronda 4: los nombres se
  comparan pasados a mayúsculas. El `index` ya no exporta `cargarEnvRaiz`, criterio 117.)_
- **P-22. Verificador SCRAM (criterio 104).** `scripts/lib/rol-app.mjs` (solo `node:*`) exporta
  `verificadorScram(clave: string, opciones?: { sal?: Buffer; iteraciones?: number }): string`, que devuelve
  `SCRAM-SHA-256$<iteraciones>:<sal en base64>$<StoredKey en base64>:<ServerKey en base64>` (por defecto 4096
  iteraciones y 16 bytes de sal aleatoria) y lanza un error que no contiene la clave si esta tiene caracteres fuera de
  U+0020 a U+007E. Las funciones que arman las sentencias (`sentenciaCrearRolApp` del hook y la de `crear-bases.mjs`, y
  la del rol del dueño en el hook) lo usan.
- **P-23. Cliente del dueño con tamaño de pool (criterio 101).** `backend/src/cli/conexion.ts` exporta
  `crearClienteDelDueno(url: string, opciones?: { max?: number }): PrismaClient`; sin `opciones` se comporta como
  hoy (P-17).
- **P-24. Tipo del envoltorio (criterio 100).** `ClienteTransaccion` (exportado por
  `backend/src/infraestructura/prisma/index.ts`) pasa a ser el tipo del envoltorio: solo `$queryRaw`, `$executeRaw` y
  los delegados de los modelos (orientativo:
  `Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | Uncapitalize<Prisma.ModelName>>`). `TransaccionAcademia`
  y `TransaccionPlataforma` no cambian de forma. `enPlataforma` (P-17) sigue entregando la transacción completa de
  Prisma a los comandos, que es asignable a ese tipo. _(Alcance ajustado por P-26, ataque ronda 4: lo que devuelven los
  métodos son promesas nativas y `$queryRaw`/`$executeRaw` aceptan también un fragmento del punto autorizado.)_

_(contrato de la ronda 4 del ataque, 11/11/2026)_. Firmas que las pruebas protegidas de los criterios 106 a 119 dan por
hechas. No son reglas de negocio nuevas.

- **P-25. Punto autorizado (criterios 112 y 114).** `backend/src/infraestructura/prisma/index.ts` exporta, además de lo
  que ya exporta:

  ```ts
  export const Decimal: typeof Prisma.Decimal;            // la clase de decimales de Prisma (decimal.js)
  export type Decimal = Prisma.Decimal;
  export function codigoDeErrorDeBase(error: unknown): string | null; // SQLSTATE de 5 caracteres o null
  export function esViolacionDeUnicidad(error: unknown): boolean;     // P2002 de Prisma o SQLSTATE 23505
  declare const marcaFragmento: unique symbol;
  export interface Fragmento { readonly [marcaFragmento]: true }      // opaco: sin prototipo ni claves propias
  type Simple = string | number | bigint | boolean | null | Date | Decimal;
  export type ValorSql = Simple | Uint8Array | readonly Simple[];
  export function sql(partes: TemplateStringsArray, ...valores: readonly (ValorSql | Fragmento)[]): Fragmento;
  export function join(elementos: readonly (ValorSql | Fragmento)[], separador?: 'coma' | 'y' | 'o'): Fragmento;
  export const vacio: Fragmento;
  ```

  `sql` lanza `TypeError` si `partes` no es un arreglo de cadenas con `raw` (arreglo de cadenas del mismo largo) y un
  elemento más que `valores`, o si un valor no es de los tipos indicados (un `Sql` de Prisma, un objeto cualquiera, una
  función o `undefined`). `join` lanza `TypeError` con una lista vacía, con un separador fuera de la lista o con un
  elemento no admitido. Los nombres exactos `sql`, `join`, `vacio`, `Decimal`, `codigoDeErrorDeBase` y
  `esViolacionDeUnicidad` son los que importan las pruebas.
- **P-26. Envoltorio en tiempo de ejecución (criterios 106 y 112).** `ClienteTransaccion` (P-24) queda, orientativo:

  ```ts
  interface ClienteTransaccion {
    $queryRaw<T = unknown>(partes: TemplateStringsArray, ...valores: unknown[]): Promise<T>;
    $queryRaw<T = unknown>(consulta: Fragmento | Prisma.Sql): Promise<T>;
    $executeRaw(partes: TemplateStringsArray, ...valores: unknown[]): Promise<number>;
    $executeRaw(consulta: Fragmento | Prisma.Sql): Promise<number>;
    // y un delegado por modelo con las operaciones de la lista, que devuelven Promise<…> (no PrismaPromise)
  }
  ```

  En la forma de etiqueta, los valores que son fragmentos se reemplazan por su `Sql` y los demás se pasan tal cual como
  parámetros. Un argumento no admitido rechaza con `TypeError`; una llamada después de terminar `trabajo` rechaza con un
  `Error` (las pruebas no fijan el texto). En los dos casos no se envía nada a la base. _(Complementado por P-32, ataque
  ronda 6: una llamada desde otro contexto asíncrono también rechaza con un `Error`, sin enviar nada.)_
- **P-27. Fechas inválidas (criterio 108).** `estaBloqueado(estado, ahora)` y `evaluarIntentoFallido(estado, ahora,
  reglas?)` de `backend/src/modulos/academias/dominio/bloqueo.ts` conservan su firma; con `bloqueadoHasta` no nulo e
  inválido (`Number.isNaN(fecha.getTime())`, o un valor que no es `Date`), o con `ahora` inválido, `estaBloqueado`
  devuelve `true`. Las fechas que la API lee de la base para decidir o responder pasan por una función que lanza un
  error interno (500 `ERROR_INTERNO`) si no son un `Date` válido (orientativo: `fechaDeBase(valor)` en
  `backend/src/comun/`).
- **P-28. Comprobación previa del paso protegido (criterios 111 y 118).** `scripts/lib/fuentes-protegidas.mjs` (solo
  `node:*`) exporta `enlacesSimbolicos(raices: string[]): string[]` (rutas de los enlaces encontrados bajo cada raíz,
  recorriendo con `lstat` sin seguir enlaces; una raíz que no existe no es error) y
  `entradasAjenasEnGenerated(carpeta: string): string[]` (las entradas de `backend/src/generated/` que no son la carpeta
  `prisma`). `scripts/comprobar-fuentes-protegidas.mjs` las aplica a `backend/src` y `packages/contratos/src`, consulta
  `git ls-files -- backend/src/generated` y termina con código 1 nombrando cada ruta si encuentra algo. El script
  `lint:protegido` lo ejecuta antes de ESLint. _(Complementado por P-30, ataque ronda 5: también comprueba las
  dependencias del backend.)_

_(contrato de la ronda 5 del ataque, 11/11/2026)_. Firmas que las pruebas protegidas de los criterios 120 a 129 dan por
hechas. No son reglas de negocio nuevas.

- **P-29. Esquemas del rol (criterio 123).** Funciones nuevas y separadas, para no cambiar las de P-12, P-13 y P-19:
  - `backend/src/infraestructura/prisma/rol-seguro.ts` exporta
    `problemasDeEsquemas(fila: { readonly dueno_de_esquema: boolean; readonly crea_en_esquema: boolean; readonly
    esquema_con_su_nombre: boolean }): string[]`: un problema por cada campo distinto de `false` (falla cerrada, como
    `problemasDelRol`), `[]` si los tres son `false`;
  - `scripts/lib/rol-app.mjs` exporta `problemasDeEsquemasApp({ esquemasPropios, esquemasConCreate, esquemaConSuNombre })`,
    con `esquemasPropios: string[]` (esquemas de los que el rol es dueño), `esquemasConCreate: { esquema: string;
    dePublic: boolean }[]` (`dePublic` verdadero si el privilegio llega por `PUBLIC`) y `esquemaConSuNombre: boolean`:
    `[]` si no hay nada; si no, un problema por esquema y condición que contiene el nombre del esquema y la corrección
    (`REVOKE CREATE ON SCHEMA <esquema> FROM aquagestion_app;` o `… FROM PUBLIC;`; `ALTER SCHEMA <esquema> OWNER TO …;`;
    renombrar o eliminar el esquema `aquagestion_app`).
- **P-30. Dependencias del backend (criterios 127 a 129).** `scripts/lib/dependencias-backend.mjs` (solo `node:*`)
  exporta:

  ```ts
  const DEPENDENCIAS_BACKEND_PERMITIDAS: readonly string[];   // criterio 127
  const SECCIONES_DE_DEPENDENCIAS: readonly string[];          // dependencies, devDependencies, optionalDependencies,
                                                               // peerDependencies, bundleDependencies, bundledDependencies
  function dependenciasNoPermitidas(paquete: unknown, permitidas?: readonly string[]): string[]; // nombres fuera de la lista
  function problemasDeDependencias(raiz: string): string[];   // lee <raiz>/backend/package.json; [] si cumple
  function nombreDePaquete(especificador: string): string | null; // null si es relativo, absoluto, file: o de Node
  const CLIENTES_DE_BASE_PROHIBIDOS: readonly (string | RegExp)[]; // criterio 129 (forma orientativa)
  function esClienteDeBaseProhibido(nombreOEspecificador: string): boolean;
  ```

  `bundleDependencies` y `bundledDependencies` se leen si son un arreglo. `nombreDePaquete('@nestjs/common/x')` es
  `@nestjs/common`, `nombreDePaquete('pg/lib/x')` es `pg` y `nombreDePaquete('#interno')` es `#interno`.
  `scripts/comprobar-fuentes-protegidas.mjs` llama a `problemasDeDependencias` con la raíz del repositorio y termina con
  código 1 si devuelve algo. Las reglas de lint de los criterios 128 y 129 usan `nombreDePaquete` y
  `esClienteDeBaseProhibido` de este archivo.

_(contrato de la ronda 6 del ataque, 12/11/2026)_. Firmas que las pruebas protegidas de los criterios 130 a 136 dan por
hechas. No son reglas de negocio nuevas.

- **P-31. Privilegios en todos los esquemas (criterio 130).** Funciones y listas nuevas y separadas, para no cambiar las de
  P-12, P-13, P-19, P-20 y P-29 ni sus pruebas. `backend/src/infraestructura/prisma/privilegios-app.ts` y
  `scripts/lib/rol-app.mjs` exportan, con los mismos nombres y el mismo contenido:

  ```ts
  interface FuncionApp { readonly esquema: 'public'; readonly nombre: string; readonly argumentos: string }
  const FUNCIONES_APP: readonly FuncionApp[];
  // [{ public, app_academia_actual, '' }, { public, app_es_plataforma, '' }, { public, resolver_academia, 'p_nombre_corto text' }]
  const ESQUEMAS_PERMITIDOS: readonly string[]; // "Esquemas permitidos además de public": hoy []
  interface PrivilegioEnEsquema {
    readonly esquema: string;                       // nspname
    readonly tipo: 'esquema' | 'tabla' | 'columna' | 'secuencia' | 'funcion';
    readonly objeto: string | null;                 // null si tipo = 'esquema'
    readonly columna: string | null;                // solo si tipo = 'columna'
    readonly argumentos: string | null;             // solo si tipo = 'funcion' (pg_get_function_identity_arguments)
    readonly privilegio: string;                    // en mayúsculas: SELECT, USAGE, EXECUTE, …
    readonly conObjetosPropios?: boolean;           // solo si tipo = 'esquema': tiene relaciones o funciones que no son de extensiones
  }
  function privilegiosDeMasEnEsquemas(efectivos: readonly PrivilegioEnEsquema[]): string[]; // [] si todo está permitido
  ```

  Reglas: `tabla`, `columna` y `secuencia` de `public` se permiten como en `privilegiosDeMas` (P-20) y de cualquier otro
  esquema nunca; `funcion` se permite solo con `EXECUTE` y `(esquema, objeto, argumentos)` en `FUNCIONES_APP`; `esquema`
  se permite con `USAGE` sobre `public`, o sobre otro esquema si `conObjetosPropios` es exactamente `false` o el esquema
  está en `ESQUEMAS_PERMITIDOS`; cualquier otro privilegio de esquema (también `CREATE`, que además rechaza el criterio
  123), un `tipo` desconocido o un campo que falta se informan (falla cerrada). Cada texto devuelto contiene el esquema, el
  objeto si lo hay, la columna si la hay y el privilegio. Las consultas que arman la lista (API y `db:crear`) solo
  devuelven filas de los esquemas revisados, sin objetos de extensiones, y filas `funcion` de `public` y de los esquemas
  sobre los que la app tiene `USAGE` (criterio 130).
- **P-32. Envoltorio atado a su contexto asíncrono (criterio 134).** `envolver(tx)` (interno de
  `backend/src/infraestructura/prisma/`) crea una marca única y devuelve, además de `cliente` y `terminar`, una función
  `ejecutar<T>(fn: () => Promise<T>): Promise<T>` que corre `fn` dentro de `almacen.run(marca, fn)`, con un
  `AsyncLocalStorage` privado del módulo. Cada función del envoltorio rechaza con un `Error` (las pruebas no fijan el texto),
  sin enviar nada, si `almacen.getStore() !== marca` al llamarse. `#transaccion` de `BaseDatos` llama a `trabajo` (y
  `conAcademia`, a su comprobación de la academia) dentro de `ejecutar`. Los nombres internos son orientativos; lo que fijan
  las pruebas es el comportamiento del criterio 134 a través de `conAcademia` y `comoPlataforma`.
- **P-33. Utilidades de prueba de las políticas y de los sembradores (criterios 132 y 133).** En `backend/test/utilidades/`
  (las escribe el test-writer con las pruebas protegidas):

  ```ts
  // politicas.ts
  export function terminosDeConjuncion(expresion: string): string[];           // conjunción de primer nivel, aplanada
  export function cumpleFormaDeAcademia(expresion: string): boolean;            // regla del criterio 132
  // sembradores.ts
  export type Sembrador = (academiaId: string) => Promise<void>;                // inserta al menos una fila de esa academia
  export const SEMBRADORES_POR_TABLA: Readonly<Record<string, Sembrador>>;    // clave: 'esquema.tabla'
  // hoy: 'public.auditoria' y 'public.configuraciones'; cada historia agrega los de sus tablas
  ```

  `terminosDeConjuncion` quita los paréntesis exteriores que encierran toda la expresión, separa por `AND` de primer nivel
  (fuera de paréntesis y de cadenas) y aplana los términos que son a su vez una conjunción entre paréntesis.
  `cumpleFormaDeAcademia` es verdadera si algún término, sin paréntesis exteriores y quitando `public.` delante de
  `app_academia_actual`, es `academia_id = app_academia_actual()` o `app_academia_actual() = academia_id`, y la expresión
  no contiene `app_es_plataforma` ni `set_config`. _(revisión T83 de la ronda 6, 12/11/2026)_ Si la expresión tiene un
  `OR` de primer nivel (fuera de paréntesis y de cadenas), no es una conjunción y no cumple; `OR` tiene menos precedencia
  que `AND`. Los identificadores distinguen mayúsculas: sin comillas, solo en minúsculas; con comillas, exactamente
  `"public"`, `"app_academia_actual"` y `"academia_id"`. Un sembrador corre como dueño con el contexto de esa academia (sirve con
  un dueño superusuario o no) y crea, si las necesita, las filas padre de la misma academia.

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
- **Ronda 3 del ataque (criterios 92 a 105):**
  - las pruebas protegidas de las reglas de lint de las rondas 1 y 2 (`eslint/regla-sql-sesion.test.mjs`,
    `eslint/regla-sql-sesion-ronda2.test.mjs`, `eslint/regla-acceso-base.test.mjs` y las de P-15) esperan que una
    cadena o una plantilla sin etiqueta con SQL de sesión falle, y que un `eslint-disable` no tenga efecto con
    `eslint.config.mjs`; las adapta el test-writer al alcance nuevo (criterios 92 y 96), en un commit de pruebas
    protegidas, sin quitar ningún ejemplo de SQL: los que eran cadenas pasan a plantillas etiquetadas;
  - `scripts/test/preparar-sesion.test.mjs` (spec 000, criterio 44, y criterio 8) espera la contraseña en claro en el
    `CREATE ROLE`; pasa a esperar el verificador (criterio 104). El hook de la spec 000 crea el rol del dueño con el
    verificador;
  - `PrismaService` deja de ser un proveedor de Nest y `ClienteTransaccion` pasa a ser el envoltorio (criterio 100,
    P-24); los módulos solo usaban `$queryRaw` y `$executeRaw`, que siguen;
  - las historias siguientes: cada tabla nueva amplía `PRIVILEGIOS_APP` (criterio 102), y el SQL de los módulos se
    escribe solo en plantillas etiquetadas (criterio 92).
- **Ronda 4 del ataque (criterios 106 a 119):**
  - en `eslint/regla-sql-plantillas.test.mjs` (criterio 92), los ejemplos que pasan
    `` cliente.$queryRaw(Prisma.sql`SELECT 1`) `` y `` cliente.$executeRaw(sql`SELECT 1`) `` en un módulo usan `Prisma` y
    `sql` sin importarlos; con el criterio 112 pasan a importar `sql` del punto autorizado (en un módulo no hay `Prisma`
    de valor, así que el primero se escribe con `sql`), y el de `cli/` agrega `import { Prisma } from
    '../generated/prisma/client'`; `Prisma.join(ids)` en un módulo pasa a `join(ids)` del punto autorizado. Lo adapta el
    test-writer en el commit de pruebas protegidas de la ronda 4, sin quitar ejemplos ni cambiar los que fallan;
  - las protegidas que eximen `**/*.test.*` o `backend/src/generated/**` siguen valiendo con los patrones exactos de los
    criterios 110 y 118 (los ejemplos usan `*.service.test.ts` y el cliente generado);
  - `cargarEnvRaiz` sale del `index` de `infraestructura/entorno/` (criterio 117); `main.ts` la importa de su archivo;
  - el envoltorio deja de devolver `PrismaPromise`: se pierde la API fluida de relaciones y una consulta se envía al
    llamarla aunque no se espere (criterio 106);
  - las historias siguientes: los montos usan el `Decimal` del punto autorizado, la operación duplicada se detecta con
    `esViolacionDeUnicidad` y los filtros de reportes se componen con `sql`, `join` y `vacio` o con
    `= ANY(${lista}::<tipo>[])` (criterio 114).
- **Ronda 5 del ataque (criterios 120 a 129):**
  - el plan (sección 16) decía que `standard_conforming_strings` y `search_path` no se fijaban; desde los criterios 121 y
    122 se fijan en la primera sentencia, que pasa a llamar a `pg_catalog.set_config`. La excepción de `cli/` de los
    criterios 98 y 107 se amplía (criterio 107 marcado);
  - la comprobación del rol (criterios 80, 102 y 103) corre dentro de una transacción con la primera sentencia y con el
    catálogo calificado (criterio 121), y agrega las condiciones de esquemas con una función nueva (criterio 123, P-29);
    las funciones de P-12, P-13 y P-19 y sus pruebas no cambian;
  - la comprobación previa del paso protegido (P-28) agrega las dependencias del backend (criterio 127, P-30);
    `backend/package.json` declara `express` (criterio 128);
  - las reglas de los criterios 128 y 129 se agregan al paso protegido sin cambiar la lista de reglas que comprueba la
    prueba del criterio 96 (plan, sección 17). Si algún ejemplo que pasa en las protegidas de lint de las rondas 1 a 4
    importa un paquete no declarado en `backend/package.json` y empieza a fallar por el criterio 128, el test-writer se
    detiene e informa;
  - _(decisión del orquestador tras la ronda 5, 12/11/2026)_ las pruebas protegidas de rondas anteriores que usan
    `pg-pool`, `@prisma/adapter-neon` o `sql-template-tag` (no declarados en `backend/package.json`) como ejemplos para
    probar exenciones de otras reglas pasan a ejecutarse en repositorios temporales cuyo `backend/package.json` declara
    esos paquetes. Lo que comprueban no cambia: mismos ejemplos, mismas reglas y mismo resultado esperado; solo cambia el
    repositorio donde corren, para que el criterio 128 no los haga fallar por una razón ajena a la prueba;
  - las historias siguientes: toda restricción única de una tabla de academia incluye `academia_id` (criterio 126); las
    vistas van con `security_invoker = true`, sin vistas materializadas, funciones `SECURITY DEFINER` ni reglas
    (criterio 124); una dependencia nueva del backend se agrega a la lista permitida (criterio 127); el SQL de los módulos
    no necesita calificar con `public.` (criterio 121).
- **Ronda 6 del ataque (criterios 130 a 136):**
  - la prueba del criterio 121 (`backend/test/utilidades/search-path.ts`, que usan `aislamiento/search-path.test.ts` e
    `integracion-aislada/search-path-servidor.test.ts`) crea el esquema `trampa`, con `USAGE` y `SELECT` para la app, antes
    de crear la API; con el criterio 130 esa API rechazaría todo con `ErrorRolBaseDatosInseguro` y los casos funcionales
    fallarían por una razón ajena a lo que comprueban. El test-writer la adapta en el commit de pruebas protegidas de la
    ronda 6, sin quitar casos ni cambiar lo que comprueban: en los casos funcionales, la API se crea y pasa su primera
    comprobación del rol (por ejemplo, con un `comoPlataforma` vacío; en la vía (a), con el `trabajo` que contamina) antes de
    crear `trampa`. Así el criterio 121 se prueba como segunda capa, en el escenario del riesgo aceptado "comprobación del
    rol una vez por proceso" (un esquema creado con la API ya en marcha). En el caso con `GRANT TRUNCATE ON auditoria`, que
    sigue creando la API con `trampa` presente, la prueba exige además que el log del rechazo nombre `auditoria` y
    `TRUNCATE` (con la `has_table_privilege` falsa de `trampa` no aparecerían), porque `trampa` sola ya causa el rechazo.
    `cli/contexto-comandos-ronda5.test.ts` no cambia (los comandos no comprueban el rol);
  - el control del criterio 123 ("`USAGE` sobre otro esquema, sin `CREATE` y sin ser su dueño, no se rechaza") sigue
    valiendo: su esquema está vacío;
  - las pruebas de catálogo de los criterios 9, 10, 11, 12, 124 y 126 pasan de `n.nspname = 'public'` a los esquemas
    revisados (criterio 131), en el mismo commit de pruebas protegidas; lo que comprueban en `public` no cambia;
  - `privilegiosDeMas` (P-20), `problemasDelRol` (P-12) y `problemasDeEsquemas` (P-29) y sus pruebas no cambian; la
    comprobación agrega `privilegiosDeMasEnEsquemas` (P-31);
  - las historias siguientes: una función nueva en `public` se agrega a `FUNCIONES_APP` o revoca el `EXECUTE` de `PUBLIC`
    (criterio 130); toda tabla con `academia_id` agrega su sembrador a `SEMBRADORES_POR_TABLA` en sus pruebas protegidas
    (criterio 133); sus políticas son exactamente la comparación o una conjunción con ella (criterio 132); ningún servicio
    guarda `tx` fuera de `trabajo` (criterios 134 y 135); no se anidan transacciones, los `id` los genera la base y no se
    usan `lastval` ni `currval` (plan, notas O1, O3 y O4).
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
- **O3. Límite por IP en memoria y por dirección IPv6 completa** _(ataque ronda 2)_: el límite del criterio 41 cuenta
  por dirección IPv6 completa (/128), así que quien tenga un bloque IPv6 puede repartir intentos entre muchas
  direcciones; además vive en memoria de cada instancia: se reinicia al reiniciar la API y no se comparte entre
  instancias. Se acepta porque lo acota el bloqueo de la cuenta tras 5 fallos (criterio 39), que está en la base y
  vale para todas las IP e instancias. Se revisa con el hosting (D-21), junto con `trust proxy`. _(Reconfirmado en la
  ronda 4.)_
- **La regla de lint del SQL sigue siendo por texto** _(ataque ronda 2)_: aun con la normalización del criterio 83,
  no ve SQL armado en tiempo de ejecución ni sentencias dentro de un `EXECUTE` anidado en un bloque `DO`. La garantía
  sigue en el criterio 72 (cada transacción fija los dos valores), en el rol sin privilegios (criterios 1, 80 y 82) y
  en el revisor. Desde la ronda 3, `DO` y `EXECUTE` como sentencia también hacen fallar el lint (criterio 94).
- **Claves JSON duplicadas** _(ataque ronda 3, O5)_: en un cuerpo como `{"correo":"a@x.pe","correo":"b@x.pe"}` gana
  la última, como en `JSON.parse`. Se acepta: el esquema valida el valor que queda y no hay una segunda lectura del
  cuerpo que vea la otra. _(Reconfirmado en la ronda 4.)_
- **Lo que el rol de la app todavía puede hacer en SQL** _(ataque ronda 3, O2)_: crear y leer objetos grandes
  (`lo_create`, `lo_from_bytea`), conectarse a la base `postgres` (por el `CONNECT` de `PUBLIC`), terminar o cancelar
  conexiones de su mismo rol (`pg_terminate_backend`) y cambiar su propia contraseña (`ALTER ROLE … PASSWORD`).
  Ninguno da datos de una academia; impedirlos exige un superusuario sobre objetos del sistema que no son de
  AquaGestión. Lo cubren el lint (criterios 84 y 94), que la API no tiene otro camino a la base (criterios 95, 99 y
  100) y el revisor. _(Reconfirmado en la ronda 4: objetos grandes, `pg_terminate_backend` y `ALTER ROLE … PASSWORD`
  sobre el propio rol.)_
- **SQL armado en tiempo de ejecución** _(ataque ronda 3)_: el lint ve formas escritas en el código (criterio 92). Un
  módulo que llama a `$queryRaw` con un arreglo que imita una plantilla, o que llega a un método con una clave
  calculada, puede ejecutar cualquier sentencia dentro de su propia transacción. En la API el envoltorio no tiene los
  métodos `Unsafe` (criterio 100); lo demás lo cubren el rol sin privilegios, el contexto por transacción (criterios
  72, 98 y 101), el revisor y el adversarial. _(Reconfirmado en la ronda 4: un arreglo con `raw` que imita una
  plantilla también lo aceptan el envoltorio y la `sql` del punto autorizado, porque JavaScript no distingue una
  plantilla real de una imitada; desde la ronda 4, todo eso corre siempre dentro de la transacción con su contexto,
  criterios 106 y 107.)_
- **Comprobación del rol una vez por proceso** _(ataque ronda 3)_: un `GRANT` o un `ALTER ROLE … SET` hechos con la
  API ya en marcha no se detectan hasta reiniciarla (criterios 4, 80, 102 y 103). Se acepta: la comprobación cuesta
  varias consultas al catálogo y esos cambios los hace un administrador del servidor; `db:crear` también los detecta.
  _(Reconfirmado en la ronda 4.)_
- **El lint es una segunda capa, no una barrera contra código malicioso** _(nota de proceso, ataque ronda 4)_: la
  protección principal del aislamiento está en la base: RLS forzada, un rol sin privilegios que se comprueba
  (criterios 1 a 4, 80, 102 y 103) y el contexto fijado en cada transacción (criterios 72, 98, 101, 106 y 107). Las
  reglas de lint (criterios 28, 73, 83 a 85, 92 a 97, 109 a 113 y 115 a 119) son una segunda capa sobre código escrito
  por el equipo: atrapan errores y atajos, no a quien quiera evadirlas a propósito. Su límite está en el SQL armado en
  tiempo de ejecución (riesgo anterior). Por eso, cuando el adversarial encuentre otra forma de evadir el lint sin
  romper una garantía de la base, se valora si basta con documentarla aquí en lugar de agregar otra regla.
- **Palabras prohibidas dentro de una cadena SQL** _(ataque ronda 4)_: la regla del texto analiza también el contenido
  de las cadenas (`'…'` y las de dólar), así que `` SELECT … WHERE motivo = 'WITH HOLD' `` o una cadena con
  `pg_advisory_lock(` hacen fallar el lint aunque no se ejecuten. Se acepta: no analizar las cadenas dejaría pasar los
  cuerpos de `DO` o de funciones; el valor va como parámetro (`${'WITH HOLD'}`), que es lo correcto de todos modos
  (criterio 115).
- **Sin API fluida de relaciones** _(ataque ronda 4)_: como el envoltorio devuelve promesas nativas (criterio 106),
  `tx.cliente.modelo.findUnique(…).relacion()` no existe; se usa `include` o `select`. El tipo puede seguir mostrándola
  si el de Prisma la incluye; el revisor la busca.
- **Pruebas que no corren en todas partes** _(ataque ronda 4)_: los enlaces simbólicos en Windows sin modo de
  desarrollador (criterio 111) y la contaminación de `DateStyle` por `ALTER ROLE ALL` o `ALTER SYSTEM` sin superusuario
  (criterio 107, en la nube) se omiten con aviso; corren en la CI de Linux o en Docker.
- **O2. Alias de rutas** _(ataque ronda 5)_: las reglas de acceso (criterios 95, 110 y 117) resuelven solo rutas
  relativas y absolutas; un alias de `tsconfig` (`paths`) o de `package.json` (`imports`) que apuntara a `cli/` o a un
  interno de `infraestructura/prisma/` no se resolvería. Se acepta: hoy no hay alias, agregar uno es un cambio de
  configuración visible en la revisión, y el criterio 128 hace fallar todo especificador que no sea relativo, de Node o
  de un paquete declarado, así que un alias falla mientras no se actualicen las reglas. Si se agrega uno, esa misma
  historia actualiza las reglas para resolverlo.
- **O4. Variables del hosting y código que corre antes de retirarlas** _(ataque ronda 5)_: `retirarVariablesSensibles`
  (criterios 99 y 116) conoce `DATABASE_URL*`, `PG*` y `SUPERADMIN_CLAVE`, pero no los nombres que inyectan algunos
  proveedores (`DIRECT_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `HEROKU_POSTGRESQL_*`); en Linux,
  `/proc/self/environ` conserva el entorno inicial aunque se borre de `process.env`; y el código de nivel de módulo se
  ejecuta al importarse, antes de que `main.ts` las retire. Se revisa con el hosting (D-21): la guía de despliegue no le
  da a la API las variables del dueño.
- **O6. Promesas sin `await`** _(ataque ronda 5)_: una consulta lanzada sin esperar dentro de `trabajo` (caso límite de
  la ronda 4) la atrapa `@typescript-eslint/no-floating-promises` del lint normal (`recommendedTypeChecked`). No está en
  el paso protegido, así que un `eslint-disable` la apaga a la vista del revisor.
- **O7. Falsos positivos leves del lint** _(ataque ronda 5)_: un fragmento guardado en una variable y pasado como único
  argumento (`tx.cliente.$queryRaw(consulta)`) y un `ORDER BY` elegido en tiempo de ejecución fallan el lint (criterios
  92 y 112). Rodeos en el plan (sección 17): interpolar el fragmento en una plantilla (`` tx.cliente.$queryRaw`${consulta}` ``)
  y elegir el orden de un mapa cerrado de fragmentos de `sql`.
- **O8. Extensión en mayúsculas en Windows** _(ataque ronda 5)_: los patrones de `files` de ESLint distinguen mayúsculas,
  así que un archivo `x.TS` de `backend/src` no se revisaría y en Windows `tsx` podría ejecutarlo. Se acepta: nadie del
  equipo nombra así los archivos y la revisión lo ve.
- **Ingreso correcto rechazado durante un cierre de sesión** _(ataque ronda 5)_: si otra sesión del superadmin se cierra
  (sube `version_token`) mientras se calcula el hash de un ingreso correcto, ese ingreso responde 401 (criterio 120) y hay
  que repetirlo. Se acepta: es raro y no deja entrar a nadie.
- **`USAGE` de la app sobre otros esquemas** _(ataque ronda 5)_: la comprobación del rol no lo rechaza (criterio 123),
  porque algunos hostings crean esquemas de extensiones con `USAGE` para `PUBLIC`. Lo neutraliza el `search_path` fijo
  (criterio 121), y el lint rechaza las llamadas calificadas con otro esquema (criterio 109); un `SELECT … FROM
  otro.tabla` escrito a propósito en un módulo no lo detecta el lint y lo ve el revisor. _(Acotado en la ronda 6: desde el
  criterio 130, `USAGE` sobre un esquema con objetos propios sí se rechaza, y cualquier privilegio sobre un objeto de otro
  esquema también; lo que queda aceptado es `USAGE` sobre un esquema vacío o con solo objetos de extensiones.)_
- **Objetos de extensiones fuera de las comprobaciones** _(ataque ronda 6)_: la comprobación del rol y las pruebas de
  catálogo no cuentan los objetos que pertenecen a una extensión (criterios 130 y 131), porque los hostings instalan
  extensiones con `EXECUTE` para `PUBLIC` y rechazarlas daría falsos positivos. Instalar una extensión es una migración que
  se ve en la revisión, y el lint rechaza las funciones que ejecutan texto o conectan a otra base (`dblink…`, criterio 109)
  y las llamadas calificadas con otro esquema.
- **Esquemas propios del hosting** _(ataque ronda 6)_: si el hosting crea un esquema con tablas o funciones propias y da
  `USAGE` a `PUBLIC`, la comprobación del rol rechaza (falla cerrada, criterio 130) y la API no atiende datos. Se resuelve
  con el hosting (D-21): una especificación agrega ese esquema a "Esquemas permitidos además de `public`", con su
  justificación, o se revoca el `USAGE`.
- **`EXECUTE` en esquemas sin `USAGE`** _(ataque ronda 6)_: la comprobación no cuenta el `EXECUTE` sobre funciones de un
  esquema en el que la app no tiene `USAGE` (criterio 130): PostgreSQL no deja nombrarlas, y PostgreSQL concede ese
  `EXECUTE` a `PUBLIC` por defecto (contarlo rechazaría esquemas del hosting que la app no puede usar). Las tablas, columnas
  y secuencias sí se cuentan en todo esquema, porque no tienen privilegios por defecto.
- **Transacciones guardadas que el lint no sigue** _(ataque ronda 6)_: la regla del criterio 135 no sigue copias por alias
  (`const t = tx; this.x = t`), `Object.assign(this, { tx })` ni una transacción guardada en un arreglo o en una función.
  La garantía es el criterio 134: desde otro contexto asíncrono el envoltorio rechaza. Un módulo que capture a propósito el
  contexto (`AsyncLocalStorage.snapshot()` o `AsyncResource.bind`) lo evitaría; por eso el criterio 135 prohíbe importar
  `async_hooks` fuera de `infraestructura/`, y el revisor lo busca. `enPlataforma` (comandos y semilla) no se ata a un
  contexto: cada comando es un proceso que corre una sola vez.
- **Forma de las políticas leída como texto** _(ataque ronda 6)_: la prueba del criterio 132 analiza el texto que devuelve
  `pg_get_expr`, no el árbol interno de PostgreSQL. Con `search_path` fijado, un operador o una función de otro esquema
  aparecen calificados y no cumplen; la prueba de ejecución del criterio 133 es la segunda capa.
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

### Decisiones técnicas tras el ataque, ronda 2 (11/11/2026)

- **El rol inseguro se rechaza con una lista completa, en la API, en `db:crear` y en el hook** (criterios 80 y 81),
  sin corregirlo solo. Alternativa descartada: que `db:crear` ejecute `ALTER ROLE … NOREPLICATION …` por su cuenta
  (escondería una configuración mal hecha del servidor y exige privilegios que el dueño no tiene en la nube).
- **`TEMPORARY` se revoca a `PUBLIC`** en una migración nueva y en `db:crear` (criterio 82). Alternativas descartadas:
  revocarlo solo a `aquagestion_app` (el privilegio le llega por `PUBLIC`) o quitar `pg_temp` del `search_path` (las
  consultas de Prisma no califican el esquema y `pg_temp` se busca primero si no está explícito).
- **La regla del SQL normaliza y exige formas cerradas** (criterios 83 y 84): tercer argumento de `set_config`
  exactamente `true`, primer argumento literal que empieza por `app.`, y toda sentencia `SET` o `RESET` fuera de
  `infraestructura/prisma/`. Alternativa descartada: un analizador completo de SQL (dependencia pesada; la garantía
  real sigue siendo el criterio 72).
- **El cliente de Prisma en un campo privado `#…`** (criterio 86). Alternativa descartada: `private` de TypeScript
  (solo existe al compilar; en ejecución es una propiedad pública).
- **Los caracteres ignorables por defecto y U+2800 no cuentan como visibles** (criterio 87). Alternativa descartada:
  una lista de caracteres sueltos (se queda corta ante el siguiente que se vea en blanco).
- **Longitudes por puntos de código** (criterio 88). Alternativa descartada: unidades UTF-16 (`.length`), que hacían
  que el comando y la API aceptaran claves y nombres distintos.
- **`Content-Encoding`: ninguno, `identity`, `gzip` o `deflate`; el resto 400** (criterio 89). Alternativas
  descartadas: 415 (mismo motivo que el criterio 74) y admitir `br` (ningún cliente de AquaGestión comprime los
  cuerpos de las peticiones; menos superficie).

### Decisiones técnicas tras el ataque, ronda 3 (11/11/2026)

- **El SQL solo en plantillas etiquetadas, y solo ese texto se analiza** (criterios 92 a 94). Alternativas
  descartadas: seguir analizando todo literal (bloquea `'end'`, `'commit'`, `'Set-Cookie'` y textos de interfaz, y aun
  así se evade con una expresión regular pasada a `$queryRawUnsafe`) y un analizador completo de SQL (dependencia
  pesada).
- **Un paso de lint aparte con `--no-inline-config`** (criterio 96). Alternativa descartada: `noInlineConfig` en todo
  `backend/src` (apaga también los `eslint-disable` legítimos de otras reglas).
- **Reglas sobre todas las extensiones que el backend puede ejecutar** (criterios 95 y 97). Alternativa descartada:
  solo prohibir archivos `.js` en `backend/src` (`tsx` los ejecuta igual si alguien los agrega).
- **`TimeZone` en `UTC` en cada transacción, con `set_config(…, true)`** (criterio 98). Alternativas descartadas:
  `options` en el cliente de `pg` (la URL las reemplaza) y un `SET` al abrir cada conexión (un `RESET ALL` o un
  `set_config(…, false)` posterior lo deshace en el pool).
- **La API borra de `process.env` las variables de conexión del dueño al arrancar** (criterio 99). Alternativa
  descartada: no cargar el `.env` en la API (el entorno real del servidor o de la CI también las trae).
- **Un envoltorio por transacción y el cliente creado dentro de `BaseDatos`, sin proveedor de Nest** (criterio 100).
  Alternativas descartadas: entregar `Prisma.TransactionClient` (lleva a `$parent` y `_originalClient`) y un
  `Proxy` sobre el cliente (difícil de probar que no deja pasar nada).
- **`CLOSE ALL` en cada transacción** (criterio 101). Alternativa descartada: `DISCARD ALL` (también borra las
  sentencias preparadas del adaptador y no se puede usar dentro de una transacción).
- **Comparar los privilegios efectivos con una lista** (criterio 102). Alternativa descartada: buscar solo los
  privilegios peligrosos conocidos (`TRUNCATE`, `DELETE`); una lista de lo permitido falla cerrada ante lo que no se
  previó.
- **Rechazar un rol con valores por defecto propios, sin corregirlo** (criterio 103), como en la ronda 2. Alternativa
  descartada: que `db:crear` ejecute `ALTER ROLE … RESET ALL` (escondería una configuración hecha por alguien).
- **Verificador SCRAM calculado en el cliente** (criterio 104). Alternativa descartada: apagar el registro de
  sentencias con `SET log_statement = 'none'` antes del `CREATE ROLE` (no cubre el mensaje de error de una sentencia
  fallida, que es donde aparecía la contraseña).
- **UTF-8 estricto en el lector JSON** (criterio 105). Alternativa descartada: aceptar y reemplazar por U+FFFD (el texto
  guardado no es el que el cliente creyó enviar, y la auditoría queda alterada).

### Decisiones técnicas tras el ataque, ronda 4 (11/11/2026)

- **Funciones `async` en el envoltorio y una marca de transacción activa** (criterio 106). Alternativas descartadas:
  quitar `requestTransaction` de cada `PrismaPromise` o envolverla en un `Proxy` (Prisma puede agregar otra propiedad
  interna en cualquier versión; una promesa nativa es una lista cerrada).
- **Fijar `DateStyle`, `IntervalStyle`, `extra_float_digits` y `bytea_output` en cada transacción** (criterio 107),
  como `TimeZone`. Alternativas descartadas: rechazar `options` en `DATABASE_URL_APP` (no cubre la base, `ALTER ROLE
  ALL` ni el archivo del servidor) y leer cada fecha como texto con `::text` en cada consulta (se olvida en algún
  módulo).
- **Falla cerrada ante una fecha inválida** (criterio 108). Alternativa descartada: tratarla como nula (abre la cuenta
  bloqueada).
- **Una lista de funciones prohibidas más todo esquema que no sea `pg_catalog` ni `public`** (criterio 109).
  Alternativa descartada: analizar como SQL el contenido de las cadenas pasadas a esas funciones (se evade armando la
  cadena con `chr()`, `format()` o una columna).
- **Exenciones con nombre exacto y prohibición de importar pruebas** (criterio 110). Alternativa descartada: solo
  excluir del build `**/*.test.*` (`tsx` ejecutaría igual el archivo exento en desarrollo y en los comandos).
- **Rechazar enlaces simbólicos y resolver con `realpath`** (criterio 111). Alternativa descartada: que ESLint siga los
  enlaces (no tiene esa opción y los patrones de `files` son léxicos).
- **La etiqueta `sql` se reconoce por su declaración (ámbito de ESLint), no por el nombre** (criterio 112), y el
  envoltorio valida el argumento. Alternativa descartada: prohibir declarar algo llamado `sql` (se evade con otro
  nombre en una función intermedia).
- **`Prisma` en `cli/` solo como acceso con punto a un nombre fijo** (criterio 113). Alternativa descartada: seguir una
  por una las formas de alias (siempre queda una más: `Reflect`, `Object.*`, `.constructor`).
- **Punto autorizado con fragmentos opacos** (criterio 114). Alternativas descartadas: dejar que los módulos importen
  `Prisma` (llega a `raw` y a `Sql`) y reexportar `Prisma.sql`, `Prisma.join` y `Prisma.empty` tal cual (desde un `Sql`,
  `.constructor` lleva a la clase y a un SQL arbitrario).
- **`SET` después de `UPDATE` en la misma sentencia es una cláusula** (criterio 115). Alternativa descartada: dejarlo
  como limitación (una columna `role` o `session` obligaría a renombrarla o a apagar la regla). La cadena `'WITH HOLD'`
  sí queda como limitación aceptada.
- **Comparar los nombres de variables en mayúsculas** (criterio 116). Alternativa descartada: distinguir mayúsculas
  (en Windows `PgPassword` es `PGPASSWORD`).
- **`cargarEnvRaiz` fuera del `index` y `dotenv` prohibido en los módulos** (criterio 117). Alternativa descartada: solo
  quitarla del `index` (un módulo importaría el archivo o `dotenv` directamente).
- **Comprobar `generated/` con `git ls-files` y el disco** (criterio 118). Alternativa descartada: solo acotar la
  exención (un archivo agregado con `git add -f` bajo `generated/prisma/` seguiría exento).

### Decisiones técnicas del orquestador tras la ronda 4 (11/11/2026)

- **Entre los criterios 85 y 113, manda el 113** (posterior y más estricto). En `cli/`, el cliente generado y
  `@prisma/…` solo se cargan con importaciones estáticas y `Prisma` solo se usa como `Prisma.<nombre fijo>`; `import(…)`,
  `require(…)`, `import x = require(…)` y el espacio de nombres usado como valor dejan de pasar (detalle en el criterio
  85). Alternativa descartada: mantener las excepciones del 85 en `cli/` (una carga dinámica o con `require` es justo lo
  que las reglas del 113 no pueden seguir, y abriría de nuevo `Prisma.raw`). "Importación estática" incluye
  `import * as G` y la importación por defecto, con las restricciones del 113; en `cli/` también fallan `import(…)` y
  `require(…)` con un argumento que no es literal, y `createRequire` (precisión del criterio 113).
- **Todo nombre con `.test.` que no sea exactamente `*.test.{ts,mts,cts,js,mjs,cjs}` es un error del paso protegido**
  en `backend/src/` y `packages/contratos/src/` (precisión del criterio 110). Alternativa descartada: solo quitarles la
  exención (en `cli/` un `x.test.util.ts` con `import pg from 'pg'` no daría error y se compilaría pareciendo una
  prueba).

### Decisiones técnicas tras el ataque, ronda 5 (11/11/2026)

- **Comparar `clave_hash` y `version_token` bajo el bloqueo de la fila antes de emitir la sesión** (criterio 120).
  Alternativas descartadas: calcular el hash dentro de la transacción con la fila bloqueada (retiene una conexión del
  pool decenas de milisegundos por intento y serializa los intentos, lo que facilita agotar el pool) y firmar con la
  versión releída (emitiría una sesión para una clave que ya no existe).
- **`search_path` fijo en `pg_catalog, public, pg_temp` en cada transacción, y `pg_catalog.` en lo que se interpreta
  antes de fijarlo** (criterio 121). Alternativas descartadas: calificar con `public.` todo el SQL de los módulos (carga
  para todas las historias, el lint no puede comprobarlo de forma fiable y, con el `search_path` fijo, no agrega
  protección) y fijar solo `public` (equivale para las funciones, pero deja `pg_temp` primero para las tablas; al final
  protege si `TEMPORARY` volviera a concederse).
- **`standard_conforming_strings` en `on` por transacción** (criterio 122), como los parámetros del criterio 107.
  Alternativa descartada: prohibir `\` en las plantillas por lint (falsos positivos en expresiones regulares de
  PostgreSQL, y no cubre la base ni el servidor).
- **Rechazar esquemas propios, con `CREATE` o con el nombre del rol** (criterio 123). Alternativa descartada: rechazar
  también `USAGE` sobre otros esquemas (falsos positivos en hostings con esquemas de extensiones; el criterio 121 ya lo
  neutraliza).
- **Pruebas de catálogo con listas de excepciones hoy vacías** (criterios 124 y 126). Alternativa descartada: revisar
  cada migración a mano (se olvida; la prueba falla sola en la historia que agrega el objeto).
- **Lista permitida de dependencias, solo paquetes declarados y lista negra de clientes** (criterios 127 a 129).
  Alternativas descartadas: solo la lista negra (siempre aparece un cliente nuevo) y solo la lista de `backend/package.json`
  (un paquete declarado en otro espacio de trabajo llega igual a `node_modules` de la raíz).
- **El criterio 128 cubre todo `backend/src/`, incluidos `infraestructura/prisma/`, `cli/` y `main.ts`, y falla cerrado
  si `backend/package.json` falta o no se puede leer o analizar** _(decisión del orquestador tras la ronda 5,
  12/11/2026)_. Las protegidas anteriores que usaban `pg-pool`, `@prisma/adapter-neon` o `sql-template-tag` como
  ejemplos corren en repositorios temporales que los declaran, sin cambiar lo que comprueban. Alternativas descartadas:
  eximir `infraestructura/prisma/` y `cli/` como en el criterio 129 (son justo las carpetas que hablan con la base y
  donde un paquete no declarado haría más daño); dejar pasar todo si falta `backend/package.json` (un archivo borrado o
  dañado desactivaría la regla en silencio); y declarar esos paquetes en el `backend/package.json` real para que las
  pruebas sigan en el repositorio (agregaría dependencias que el backend no usa y ampliaría la lista del criterio 127).

### Decisiones técnicas tras el ataque, ronda 6 (12/11/2026)

- **Comparar los privilegios de la app en todos los esquemas, sin los objetos de extensiones** (criterio 130).
  Alternativas descartadas: seguir mirando solo `public` (la vista de `reportes` devuelve todas las academias sin que nada
  lo note) y contar también los objetos de extensiones (falsos positivos con las extensiones que instala el hosting).
- **`EXECUTE` solo en `public` y en los esquemas con `USAGE`; tablas, columnas y secuencias en todos** (criterio 130).
  Alternativa descartada: contar `EXECUTE` en todo esquema (PostgreSQL lo concede a `PUBLIC` por defecto, y sin `USAGE` la
  función no se puede nombrar: solo daría falsos positivos).
- **`USAGE` sobre otro esquema se rechaza si contiene objetos propios, con una lista de permitidos hoy vacía** (criterio
  130, F1 (c)). Alternativas descartadas: rechazar todo `USAGE` (la ronda 5 lo descartó por los esquemas de extensiones del
  hosting) y aceptarlo siempre (un esquema propio con objetos accesibles quedaría fuera de las pruebas de RLS).
- **Funciones y listas nuevas (P-31) en lugar de cambiar `privilegiosDeMas`** (criterio 130), como en las rondas 3 y 5.
  Alternativa descartada: agregar el esquema a `PrivilegioApp` (cambia el contrato de P-20 y sus pruebas protegidas).
- **Forma exacta de cada política, leída con `pg_get_expr` y `search_path` fijo** (criterio 132). Alternativas
  descartadas: la expresión regular "contiene la comparación" de hoy (acepta `OR`) y analizar el árbol interno
  (`polqual` como `pg_node_tree`, formato no documentado que cambia entre versiones).
- **Prueba de ejecución que descubre las tablas en el catálogo y usa sembradores explícitos** (criterio 133).
  Alternativas descartadas: una lista fija de tablas (las de historias nuevas quedarían sin probar) y un generador
  automático de filas (no puede cumplir `CHECK`, llaves foráneas compuestas ni reglas de cada tabla de forma fiable).
- **Envoltorio atado con `AsyncLocalStorage` al contexto de su `trabajo`** (criterio 134). Alternativas descartadas: solo
  la regla de lint (no ve alias ni otras formas de guardar `tx`) y atarlo a la petición HTTP (las tareas programadas no
  tienen petición, y dos transacciones de la misma petición también deben quedar separadas).
- **La regla del criterio 135 en el lint normal, no en el paso protegido.** Alternativa descartada: el paso protegido
  (cambiaría la lista de reglas que comprueba la prueba del criterio 96, y la garantía ya está en el 134).
- **`SET CONSTRAINTS … { DEFERRED | IMMEDIATE }` permitido como sentencia exacta** (criterio 136). Alternativa
  descartada: una función en `infraestructura/prisma/` para diferir restricciones (más superficie para algo que es local a
  la transacción y no toca el contexto).
- **`lastval` y `currval` prohibidos en el lint** (criterio 136). Alternativa descartada: solo una nota en el plan (la
  regla cuesta una entrada en la lista de funciones prohibidas).

## Preguntas abiertas

Ninguna. Las 10 preguntas de la versión en borrador quedaron resueltas por el responsable el 11/11/2026 (DR-1 a DR-10
en "Decisiones"). Las correcciones de las rondas 1 a 6 del ataque son decisiones técnicas y no abren preguntas de
negocio. Queda para el hosting (D-21), sin bloquear: qué esquemas del proveedor, si alguno, entran en "Esquemas
permitidos además de `public`" (riesgo aceptado "Esquemas propios del hosting").
