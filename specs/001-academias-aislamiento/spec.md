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
- **P. Correcciones del ataque, ronda 7 (137 a 140):**
  - 137: aislamiento (D-23); si la API y `db:crear` deciden distinto sobre el mismo rol, el responsable no puede confiar
    en `db:crear` para saber si la API va a atender, y una corrección propuesta sobre un objeto de extensión rompería la
    extensión del hosting; además, la exclusión de los objetos de extensiones no debe tapar las tablas propias.
  - 138 y 140: aislamiento; las guardas de las políticas y de su ejecución protegen las tablas de todas las historias
    siguientes, y un falso positivo (un disparador legítimo, la subconsulta habitual por rendimiento) empujaría a
    debilitarlas o a saltárselas.
  - 139: aislamiento; un emisor de eventos que conserva el contexto de una transacción deja que otra petición escriba en
    la academia de la primera.
- **Q. Correcciones del ataque, ronda 8 (141 a 143):**
  - 141 y 142: aislamiento (D-23); una tabla o vista propia dentro de un esquema que pertenece a una extensión quedaba
    fuera de la comprobación del rol y de las pruebas de catálogo, y la app leyó filas de dos academias de una tabla sin
    RLS.
  - 143: aislamiento; un parámetro `user`, `host` o `database` en la cadena de consulta de una URL hace que la API se
    conecte con otro rol o a otro servidor que el que `db:crear` revisó, y la comprobación del rol deja de valer como
    garantía.
- **R. Correcciones del ataque, ronda 9 (144 a 148):**
  - 144 y 145: aislamiento (D-23); con una función de contexto marcada `IMMUTABLE`, un plan guardado en una conexión del
    pool conserva la academia con la que se planificó y entrega a otra academia sus filas, sin que ninguna otra prueba lo
    note.
  - 146: aislamiento y auditoría (RN-22); con otra `client_encoding` en la conexión, los nombres y motivos con tildes o
    eñes se guardan alterados (`ÃandÃº`) y la auditoría deja de decir lo que pasó.
  - 147: integridad de lo confirmado; con `synchronous_commit` en `off` un pago o un movimiento de caja que la API dio
    por confirmado (historias siguientes) se pierde en una caída, y `array_nulls` o `transform_null_equals` cambian lo
    que se escribe o qué filas toca una sentencia.
  - 148: aislamiento; si `DATABASE_URL_APP` apunta a otra base u otro servidor, `db:crear` aprueba el rol en una base y
    la API usa otra, y la comprobación de `db:crear` deja de valer como garantía (como en el 143).
- **S. Correcciones del ataque, ronda 10 (149 a 152):**
  - 149 y 150: auditoría (RN-22) y, desde las historias siguientes, pagos, caja y asistencia; una transacción que
    PostgreSQL revirtió se reportaba como confirmada, así que la API respondería "cobrado", "verificado" o "asistencia
    registrada" sin que nada ni su auditoría quedaran escritos.
  - 151: lo mismo por otro camino: un `ROLLBACK` o `COMMIT` escrito dentro de `trabajo` (que el lint del criterio 84
    prohíbe, pero el lint es la segunda capa) deja lo que sigue fuera de la transacción y sin contexto.
  - 152: auditoría (RN-22); una IP con zona IPv6 hacía fallar la operación, y la corrección no puede abrir un camino
    para registrar una operación sin la IP de quien la hizo.
- **T. Correcciones del ataque, ronda 11 (153 a 155):**
  - 153 y 154: auditoría (RN-22) y, desde las historias siguientes, pagos, caja, aforo y asistencia; un `Promise.all` o
    `Promise.allSettled` con una consulta que Prisma corta dejaba sin ejecutar las siguientes y la API respondía éxito
    sin esas escrituras ni su auditoría (por ejemplo, un cobro sin su movimiento de caja).
  - 155: aforo y caja (RN-11, RN-17); la forma de tomar el bloqueo de transacción que sugería la spec falla en Prisma, y
    una historia que la copiara rompería la inscripción o el cobro o, en un lote, cortaría las consultas siguientes
    (criterio 153); el bloqueo es lo que evita la carrera por el último cupo o el doble cobro.
- **U. Correcciones del ataque, ronda 12 (156 a 158):**
  - 156: auditoría (RN-22) y, desde las historias siguientes, pagos, caja, aforo y asistencia; la segunda consulta de una
    cadena sin `await` (`.then(…)` o una función `async` con `void`) se rechazaba sin enviarse y la API respondía éxito sin
    esa escritura, por ejemplo un cobro sin su auditoría o sin su movimiento de caja.
  - 157: disponibilidad de todas las academias a la vez; un rechazo sin manejar terminaba el proceso de la API y cortaba
    las peticiones en curso de todas (cobros y verificaciones incluidos), y cualquiera que encontrara un camino para
    provocarlo podía tumbar la API una y otra vez.
  - 158: auditoría (RN-22) y, desde las historias siguientes, pagos y aforo; una escritura con relaciones anidadas que
    fallaba a medio camino dejaba escrita una parte (por ejemplo, una academia suspendida sin su registro de auditoría) y,
    si `trabajo` atrapaba el error como permite el criterio 153, se confirmaba.
- **V. Correcciones del ataque, ronda 13 (159 a 162):**
  - 159 y 160: auditoría (RN-22) y, desde las historias siguientes, pagos, caja, aforo y asistencia; una función `async`
    lanzada con `void` dentro de `trabajo` cuya consulta fallaba después de que `trabajo` terminó dejaba confirmado lo
    anterior sin la auditoría (por ejemplo, un cobro sin su registro), y la API respondía éxito.
  - 161 y 162: datos sensibles (Ley 29733, RNF-05); el registro técnico de un 500 o de un rechazo sin manejar copiaba el
    mensaje de Prisma con los valores de la consulta (un DNI, y desde las historias siguientes datos médicos o de menores,
    o el token del QR), y cualquiera con acceso a los registros los leía.
- **W. Correcciones del ataque, ronda 14 (163 y 164):**
  - 163: datos sensibles (Ley 29733, RNF-05); un valor rechazado por PostgreSQL o un `Json` mostrado por Prisma con una
    línea que empieza con espacios y `at ` pasaba como marco de la pila, y el registro técnico de un 500 mostraba el DNI o
    la alergia que el criterio 162 debía quitar.
  - 164: auditoría (RN-22) y, desde las historias siguientes, pagos, caja, aforo y asistencia; una función `async` pasada a
    `process.nextTick` no la ve ninguna regla de lint, y si su consulta falla mientras `trabajo` sigue en curso nada marca
    la transacción y se confirma lo anterior sin la auditoría (la misma familia que las rondas 12 y 13).
- **X. Correcciones del ataque, ronda 15 (165 y 166):**
  - 165: datos sensibles (Ley 29733, RNF-05); con el patrón habitual de NestJS que envuelve el error de Prisma en una
    excepción de 5xx, el registro técnico del 500 o del 503 mostraba el DNI y la alergia que el criterio 162 debía quitar, y
    cualquiera con acceso a los registros los leía; y cada historia siguiente (pagos, asistencia, datos médicos) escribirá
    ese patrón.
  - 166: datos sensibles; un `tipo` que no sale de una lista cerrada deja pasar al registro lo que un `name` lleve.
- **Y. Correcciones del ataque, ronda 16 (167 y 168):**
  - 167: disponibilidad de todas las academias a la vez; registrar un 500 cuyo error lleva un archivo, un arreglo o un
    texto grandes (un comprobante de 5 MB, HU-08) bloqueaba el proceso varios segundos y podía tumbarlo por falta de
    memoria, cortando las peticiones en curso de todas las academias (cobros y verificaciones incluidos).
  - 168: datos sensibles (Ley 29733, RNF-05); un error de Prisma guardado como `cause` detrás de un getter heredado, o
    devuelto por una `cause` que es una función, llegaba entero al registro técnico (pino lo lee por su nombre), con el DNI
    o la alergia.

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
   `validarEntorno`)_ _(ampliado por el criterio 143, ataque ronda 8: también rechaza una `DATABASE_URL_APP` con `user`,
   `host`, `hostaddr`, `password`, `port`, `dbname` o `database` en la cadena de consulta)_
6. Dado `DATABASE_URL_APP` con el usuario `aquagestion_app`, cuando se ejecuta `npm run db:crear` con un usuario de
   `DATABASE_URL` que puede crear roles (superusuario o `CREATEROLE`, como en Docker y en la CI), entonces:
   - si el rol no existe, lo crea con `LOGIN`, la contraseña de `DATABASE_URL_APP` y los atributos negativos del
     criterio 1, e informa "Rol creado: aquagestion_app";
   - si existe con atributos seguros, informa que ya existía y no cambia su contraseña;
   - si existe con `SUPERUSER` o `BYPASSRLS`, o falta y no hay permiso para crearlo, termina con código 1 y un
     mensaje que dice qué hacer, sin imprimir contraseñas;
   - si el usuario de `DATABASE_URL_APP` no es `aquagestion_app`, o es el mismo de `DATABASE_URL`, termina con
     código 1.

   _(ampliado por el criterio 148, ataque ronda 9: también termina con código 1 si el servidor, el puerto o la base de
   `DATABASE_URL_APP` no coinciden con los de `DATABASE_URL`)_

   Quién crea el rol en cada entorno (nube, Docker y CI): precisión P-11 del contrato.

   _(prueba obligatoria donde el usuario de la base pueda crear roles: CI y Docker; en la nube se omite con aviso)_
7. Dado un servidor sin el rol `aquagestion_app`, cuando se aplican las migraciones de esta historia, entonces fallan
   con un mensaje que indica ejecutar `npm run db:crear` (orientativo: "Falta el rol aquagestion_app: ejecuta npm run
   db:crear"). _(verificación del tester)_
8. Dada la nube (`CLAUDE_CODE_REMOTE=true`), cuando corre el hook de sesión, entonces en el paso del rol también
   crea `aquagestion_app` (si no existe) con `psql` como el usuario `postgres`, con los atributos del criterio 1 y la
   contraseña de `DATABASE_URL_APP`, antes de `db:crear`; nunca imprime la contraseña; si falta `DATABASE_URL_APP`,
   el paso falla y lo informa. Mantiene las reglas de la spec 000 (criterios 43 a 47). _(prueba unitaria de la
   función que arma la sentencia; verificación del tester en la nube)_ _(ampliado por el criterio 148, ataque ronda 9:
   el paso también falla, sin crear ni consultar el rol, si el servidor, el puerto o la base de `DATABASE_URL_APP` no
   coinciden con los de `DATABASE_URL`)_

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
    transacción. _(crítico)_ _(ampliado por los criterios 149 y 151, ataque ronda 10: "tras confirmar" exige que la
    transacción siga viva y sin abortar al terminar `trabajo`; si no, rechaza con `ErrorTransaccionAbortada`)_
    _(ampliado por los criterios 153 y 154, ataque ronda 11: las consultas de `trabajo` se entregan a Prisma de una en una,
    y una que vuelve con `undefined` hace rechazar con `ErrorTransaccionAbortada`)_ _(ampliado por los criterios 156 y
    158, ataque ronda 12: las consultas encadenadas sin `await` se aceptan hasta que `asentar` termina y una que llega
    tarde hace rechazar; una escritura de un delegado que rechaza no deja nada propio)_
22. Dado que `trabajo` lanza un error, entonces la transacción se revierte por completo (las filas que insertó en
    `auditoria` o `configuraciones` no quedan) y `conAcademia` rechaza con ese mismo error. Lo mismo en
    `comoPlataforma`. _(crítico)_ _(complementado por los criterios 149 y 151, ataque ronda 10: si `trabajo` atrapa un
    error de la base y termina bien, también se rechaza)_
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
    `app.plataforma` igual a `si` y sin `app.academia_id` (vacío o nulo). _(crítico)_ _(ampliado por los criterios
    149 y 151, ataque ronda 10: devuelve el resultado de `trabajo` solo si la transacción se confirma)_ _(ampliado por
    los criterios 153 y 154, ataque ronda 11: consultas de una en una; una que vuelve con `undefined` hace rechazar)_
    _(ampliado por los criterios 156 y 158, ataque ronda 12, como en el 21)_
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
    _(crítico)_ _(ampliado por el criterio 152, ataque ronda 10: la `ip` se guarda normalizada, sin sufijo de zona
    IPv6, y una IP que no es válida hace fallar la operación)_
30. Dada una operación que audita, cuando la transacción se revierte, entonces su registro de auditoría tampoco
    queda; y cuando la inserción de auditoría falla, la operación completa falla. Prueba: con un disparador temporal
    en `auditoria_plataforma` que lanza un error, `POST /api/plataforma/academias` responde 500 y la academia no
    existe. _(crítico)_ _(ampliado por los criterios 153 y 154, ataque ronda 11: tampoco se confirma una operación cuya
    escritura o auditoría, lanzada a la vez con otras, Prisma no llegó a ejecutar)_ _(ampliado por los criterios 156 y
    158, ataque ronda 12: tampoco una a la que le falta la auditoría encadenada sin `await`, ni una escritura que falló a
    medias)_
31. Dada una transacción de `comoPlataforma`, cuando se llama a `auditoria.registrarEnPlataforma(tx, entrada)`,
    entonces se inserta en `auditoria_plataforma` con `fecha_hora` igual a `RELOJ.ahora()`. _(crítico)_ _(ampliado
    por el criterio 152, ataque ronda 10: la `ip`, como en el 29)_
32. Dadas las operaciones de esta historia, entonces quedan en `auditoria_plataforma`, con `entidad` y `entidad_id`
    (el id):
    - `ACADEMIA_CREADA`: actor `SUPERADMIN` y su id; `datos_despues` con `id`, `nombre`, `nombreCorto` y `estado`;
      `ip` de la petición (normalizada por el criterio 152, ataque ronda 10);
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
81. **Rol inseguro: `db:crear` y el hook** _(ataque ronda 2, F1; complementa los criterios 6 y 8)_ _(complementado por
    el criterio 148, ataque ronda 9: lo que `db:crear` revisa es la base a la que apunta `DATABASE_URL_APP`)_. Dado que el rol
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
    `backend/src/cli/conexion.ts`. _(crítico)_ _(ampliado por los criterios 150 y 151, ataque ronda 10: `enPlataforma`
    devuelve el resultado de `trabajo` solo si la transacción se confirma)_
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
    de la regla de lint)_ _(precisado por el criterio 155, ataque ronda 11, O1: que el lint los deje pasar no dice con qué
    función se ejecutan; `pg_advisory_xact_lock` devuelve `void` y se ejecuta con `$executeRaw`, o con `$queryRaw` y
    `::text`; con `$queryRaw` solo, Prisma falla al leer la columna)_
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
    _(crítico; prueba de la configuración de lint y verificación del revisor)_ _(ampliado por el criterio 159, ataque ronda
    13: el paso protegido aplica además la regla sin tipos de promesas descartadas de P-41, que ningún comentario apaga)_
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
     criterio 130, ataque ronda 6: todos los esquemas que no son del sistema, funciones y `USAGE` de esquemas)_
     _(alcance ajustado por el criterio 137, ataque ronda 7: los objetos que pertenecen a una extensión no se cuentan,
     tampoco en `public`, ni en la API ni en `db:crear`)_. Dada la
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
     contexto asíncrono rechaza aunque la transacción siga abierta)_ _(segunda viñeta precisada por el criterio 153, ataque
     ronda 11: la consulta se entrega sin esperar un `then` de quien llama, en el momento de la llamada o, si hay otra sin
     asentar, en cuanto le toca en la cola)_ _(tercera viñeta precisada por el criterio 156, ataque ronda 12: si `trabajo`
     termina bien, el envoltorio sigue aceptando las llamadas de su contexto hasta que `asentar` termina; "cuando `trabajo`
     ya terminó" se lee "cuando el envoltorio ya se apagó": al terminar `asentar` en el camino bueno, o en cuanto `trabajo`
     lanza)_. Dada la API de pruebas, dentro de `trabajo` de `conAcademia` y de
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
     ronda 5: `search_path`, `standard_conforming_strings` y la forma con `pg_catalog.`)_ _(primera sentencia y excepción
     de `cli/` ampliadas por los criterios 146 y 147, ataque ronda 9: `client_encoding`, `synchronous_commit`,
     `array_nulls` y `transform_null_equals`)_. Dado que el adaptador de Prisma interpreta el texto que
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
     especificaciones anteriores", ronda 6)_ _(la lista de llamadas que la regla admite en `cli/` se amplía con las de
     los criterios 146 y 147, ataque ronda 9, que también pasan con `pg_catalog.` delante)_. Dado que el `search_path` de
     la conexión puede venir de
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
     121; **amplía** la excepción de `cli/` del criterio 107)_ _(ampliado por los criterios 146 y 147, ataque ronda 9: la
     misma primera sentencia fija también `client_encoding`, `synchronous_commit`, `array_nulls` y
     `transform_null_equals`)_. Dado que con `standard_conforming_strings = off` una `\`
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
  temporales (`pg_temp_N` y `pg_toast_temp_N`), y salvo los esquemas que pertenecen a una extensión. _(Ajustada por el
  criterio 141, ataque ronda 8: los esquemas que pertenecen a una extensión **sí** son esquemas revisados; solo se excluyen
  los objetos de extensión.)_
- **Objeto de extensión:** el que tiene en `pg_catalog.pg_depend` una fila con `deptype = 'e'` hacia `pg_extension`. No se
  cuenta en ninguna comprobación de esta sección (ver "Riesgos aceptados").

Esta ronda crea una lista de excepciones, **hoy vacía**, que solo una especificación puede ampliar, con la justificación de
cada elemento (como la lista del criterio 10):

- **Esquemas permitidos además de `public`** (criterio 130): ninguno.

130. **Privilegios del rol en todos los esquemas** _(ataque ronda 6, F1 (a) y (c); **amplía** los criterios 102 y 123)_
     _(precisado por el criterio 137, ataque ronda 7: la API y `db:crear` excluyen los objetos de extensiones de la misma
     forma en todas sus comprobaciones de privilegios)_ _(ajustado por el criterio 141, ataque ronda 8: los esquemas que
     pertenecen a una extensión se revisan como cualquier otro; solo se excluyen los objetos de extensión, y un tipo
     compuesto de una extensión no es un objeto propio)_.
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
     126)_ _(ajustado por el criterio 142, ataque ronda 8: también revisan los esquemas que pertenecen a una extensión)_. Dadas las migraciones aplicadas en la base de pruebas, entonces las pruebas de catálogo de los criterios 9, 10,
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
132. **Cada política de una tabla de academia exige su academia** _(ataque ronda 6, F2 (a); complementa el criterio 11)_
     _(precisado por el criterio 140, ataque ronda 7: `academia_id = (SELECT app_academia_actual())` equivale a la
     comparación directa)_.
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
     criterios 13, 17 y 18)_ _(ajustado por el criterio 138, ataque ronda 7: el `INSERT` con la academia de B pasa si falla
     con cualquier error o si no deja escrita ninguna fila de B)_. Dadas las migraciones aplicadas y, en **cada** tabla con `academia_id` que encuentra el catálogo
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
135. **El lint señala una transacción guardada fuera de su `trabajo`** _(ataque ronda 6, F3; complementa el criterio 134)_
     _(ampliado por el criterio 139, ataque ronda 7: `EventEmitterAsyncResource` y `getBuiltinModule` de `async_hooks`)_.
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

### P. Correcciones del ataque adversarial, ronda 7

Criterios agregados tras la ronda 7 del ataque (12/11/2026, sobre el commit `bb3ff2d`). La ronda no encontró fallas críticas
ni altas: las garantías de ejecución de 001 resistieron. Encontró tres fallas medias y una observación, todas en las guardas:
la API y `db:crear` decidían distinto ante una extensión instalada en `public`, la prueba de ejecución de las políticas
rechazaba un disparador legítimo, la de su forma rechazaba la subconsulta habitual por rendimiento, y un
`EventEmitterAsyncResource` creado dentro de `trabajo` conserva su contexto cuando otra petición emite. Son decisiones
técnicas del orquestador, no reglas de negocio nuevas. Donde un criterio ajusta o amplía uno anterior lo dice, y el anterior
queda marcado "(… ataque ronda 7)", sin borrar su texto. Contrato: precisión de P-33 (ronda 7). Todos son _(crítico)_.

137. **La API y `db:crear` deciden lo mismo ante los objetos de extensiones** _(ataque ronda 7, F1; **ajusta el alcance**
     del criterio 102 y precisa el 130; decisión del orquestador)_ _(ajustado por el criterio 141, ataque ronda 8: lo que se
     excluye es el objeto de extensión, nunca el esquema entero; la cuarta viñeta, "deciden lo mismo", vale también con
     esquemas de extensiones)_. Dado que, desde la ronda 6, la API calcula los
     privilegios de la app solo con la consulta del criterio 130, que no cuenta los objetos de extensiones en ningún esquema,
     mientras que `db:crear` sigue usando además la del criterio 102 (`problemasDePrivilegios`), que sí los cuenta en
     `public` (con `CREATE EXTENSION pg_stat_statements SCHEMA public`, que concede `SELECT` a `PUBLIC` sobre sus vistas, la
     API atiende y `db:crear` termina con código 1 proponiendo `REVOKE` sobre una vista de la extensión), entonces:
     - ninguna comprobación de privilegios de la app (criterios 102, 125 y 130), ni en la API ni en `db:crear`, cuenta un
       objeto de extensión (definición de la sección O: fila de `pg_catalog.pg_depend` con `deptype = 'e'` hacia
       `pg_extension`) en ningún esquema, **incluido `public`**: ni la relación ni sus columnas, ni la secuencia, ni la
       función (para `conObjetosPropios` ya no contaban);
     - `db:crear` no nombra esos objetos como problema ni propone `REVOKE` sobre ellos;
     - un privilegio de más sobre un objeto que no es de extensión se sigue rechazando en las dos, en `public` y en los
       demás esquemas, aunque haya extensiones instaladas;
     - para un mismo estado de la base, la API rechaza por privilegios (con `ErrorRolBaseDatosInseguro`, criterio 4) si y
       solo si `db:crear` informa al menos un privilegio de más. Las demás condiciones del rol (criterios 80, 103 y 123) no
       cambian;
     - para que la exclusión no tape las tablas propias (un `ALTER EXTENSION … ADD TABLE auditoria` sacaría la tabla de
       todas las comprobaciones), una prueba de catálogo falla si es objeto de extensión alguna tabla de `PRIVILEGIOS_APP`
       (`public.<tabla>`), alguna función de `FUNCIONES_APP` o alguna relación con columna `academia_id` de cualquier esquema
       que no sea `pg_catalog`, `information_schema`, `pg_toast` ni temporal (también de un esquema de extensión).

     Prueba de integración, con una API nueva por caso y restaurando al final. Preparación: como superusuario,
     `CREATE EXTENSION pg_stat_statements SCHEMA public` (Docker y CI); si no se puede, como dueño, una extensión de confianza
     en `public` (orientativo: `pgcrypto`) más `CREATE VIEW public.vista_de_extension AS SELECT 1 AS x`,
     `GRANT SELECT ON public.vista_de_extension TO PUBLIC` y `ALTER EXTENSION pgcrypto ADD VIEW public.vista_de_extension`;
     si la extensión ya estaba instalada por otro o no se puede instalar ninguna, el caso se omite con aviso (la prueba solo
     quita lo que creó). Entonces:
     1. con la extensión instalada: `conAcademia`, `comoPlataforma` y `resolverAcademia` responden sin rechazar, y la
        comprobación de `db:crear` sobre la base de pruebas (como en las pruebas de los criterios 102 y 130) no informa
        ningún privilegio de más ni ningún texto que nombre un objeto de la extensión o un `REVOKE` sobre él;
     2. control, con la extensión todavía instalada: `CREATE VIEW public.vista_extra AS SELECT 1 AS x` y
        `GRANT SELECT ON public.vista_extra TO PUBLIC`: la API rechaza con `ErrorRolBaseDatosInseguro` (el log nombra
        `vista_extra` y `SELECT`) y `db:crear` termina con código 1 nombrando `vista_extra` y
        `REVOKE SELECT ON vista_extra FROM PUBLIC;` (la forma de la corrección del criterio 102);
     3. control: `GRANT TRUNCATE ON auditoria TO aquagestion_app` con la extensión instalada: las dos rechazan.

     Prueba de catálogo sobre las migraciones aplicadas (pasa hoy) y autocomprobación, como dueño, en una transacción que se
     revierte: con una extensión de confianza creada por la prueba, una tabla `public.tabla_de_extension` con
     `academia_id uuid` agregada con `ALTER EXTENSION … ADD TABLE` aparece en el resultado (si el dueño no puede crear la
     extensión, la autocomprobación se omite con aviso). _(crítico)_
138. **El `INSERT` en otra academia se juzga por lo que escribe, no por el código del error** _(ataque ronda 7, F2;
     **ajusta** la quinta viñeta del criterio 133; decisión del orquestador)_. Dado que un disparador
     `BEFORE INSERT … FOR EACH ROW` legítimo (uno que fuerza `academia_id` al contexto, o que valida y lanza un error) hace
     que el `INSERT` del criterio 133 con la `academia_id` de B termine con otro código (`23505`, `P0001`) o sin error,
     aunque la tabla no deja escribir en otra academia, entonces el paso del `INSERT` del criterio 133 (para cada tabla con
     `academia_id`) queda así:
     - **fila de prueba:** como dueño con el contexto de B, la prueba llama otra vez al sembrador de la tabla para B,
       toma una fila de esa tabla creada por esa llamada (la compara con las que había antes), la guarda (como
       `to_jsonb`) y la borra; así la fila es válida en B (sus llaves foráneas apuntan a filas de B y cumple los `CHECK`) y
       no choca con ninguna restricción única. Si el dueño no puede borrarla (por ejemplo, un disparador que lo impide), la
       prueba usa para esa tabla la forma anterior del criterio 133 (copia de una fila de A con la `academia_id` de B) y
       exige exactamente `42501` (falla cerrada), y lo informa;
     - **intento:** como app, en contexto de A, un `INSERT` de esa fila con todas sus columnas salvo las generadas y las
       `GENERATED ALWAYS`; la transacción del intento termina (se confirma si no hubo error) antes de comprobar;
     - **comprobación:** como dueño con el contexto de B, la prueba lee otra vez las filas de B de la tabla. El paso pasa
       si el `INSERT` falló con `42501` o con cualquier otro error, o si terminó sin error, y en los tres casos ninguna
       fila con la `academia_id` de B que no estaba antes del intento quedó escrita. Falla solo si quedó escrita una fila
       de B; el mensaje nombra la tabla. Un error distinto de `42501` se informa con su código en el registro de la
       prueba (así se ve un error de la propia prueba); la autocomprobación garantiza que el mecanismo detecta;
     - las demás viñetas del criterio 133, la comprobación previa de las filas sembradas y la lista de sembradores no
       cambian (cada sembrador debe crear una fila nueva en cada llamada: precisión de P-33, ronda 7); las filas que el intento haya escrito en A (por un disparador que fuerza la academia) se pueden quedar.

     Por qué la fila de prueba cambia (precisión del especificador sobre la decisión): con la copia de una fila de A, una
     política mal hecha deja pasar la fila y la base la rechaza después por la llave primaria (`23505`) o por la llave
     foránea compuesta hacia un padre de A (`23503`); con "cualquier error pasa" esa política no se detectaría. PostgreSQL
     comprueba el `WITH CHECK` de RLS después de los disparadores `BEFORE` y antes de los `CHECK`, las restricciones únicas y
     las llaves foráneas.

     Nota _(revisión T93 de la ronda 7, 12/11/2026; no cambia el criterio)_: si la fila de prueba de B no se puede insertar
     por un error distinto de `42501` (una restricción, un disparador de validación), el paso pasa siempre que no quede
     escrita ninguna fila nueva de B. Una política mal escrita que solo se haga visible con un `INSERT` que sí se pueda
     completar no se detecta por este paso; la cubre el criterio 132 (ver "Riesgos aceptados").

     Autocomprobación (amplía la del criterio 133, con las mismas condiciones: `SET LOCAL ROLE aquagestion_app`, omitida
     con aviso en la nube), con tablas de ejemplo con `academia_id`, RLS forzada, políticas correctas salvo donde se dice, y
     `SELECT` e `INSERT` para la app:
     - pasan (no se detectan): una tabla con un disparador `BEFORE INSERT … FOR EACH ROW` que pone
       `NEW.academia_id := app_academia_actual()`; otra con el mismo disparador que además pone un `id` nuevo (el `INSERT`
       termina sin error y la fila queda en A); y otra con un disparador que lanza un error (`RAISE EXCEPTION`, `P0001`);
     - se detectan (fallan): la tabla del criterio 133 con `WITH CHECK (academia_id IS NOT NULL)`; la misma con una
       restricción `UNIQUE (academia_id, clave)` y una llave foránea compuesta `(academia_id, padre_id)` hacia una tabla
       padre de ejemplo (la fila de prueba no choca con ninguna de las dos); y una tabla con política mal hecha y un
       disparador `BEFORE INSERT` que no cambia nada.

     _(crítico)_
139. **Ningún emisor que conserve el contexto de una transacción** _(ataque ronda 7, F3; **amplía** el criterio 135)_. Dado
     que los listeners de un `EventEmitterAsyncResource` corren en el contexto asíncrono donde se creó el emisor (si se crea
     dentro del `trabajo` de A, se guarda fuera y otra petición B emite, el listener usa la transacción de A y el envoltorio
     lo acepta, criterio 134: B escribe en A), y que `process.getBuiltinModule` carga `async_hooks` sin importarlo, entonces,
     en el código de `backend/src/` fuera de `backend/src/infraestructura/` (sin las pruebas, criterio 110), `npm run lint`
     (el lint normal, como el criterio 135) falla con:
     - cualquier aparición del nombre `EventEmitterAsyncResource`: como nombre importado o reexportado
       (`import { EventEmitterAsyncResource as E } from 'node:events'`, `export { EventEmitterAsyncResource } from 'events'`),
       como propiedad con punto o calculada con un literal o una plantilla sin marcadores (`events.EventEmitterAsyncResource`,
       `EventEmitter.EventEmitterAsyncResource`, `require('events')['EventEmitterAsyncResource']`,
       `(await import('node:events')).EventEmitterAsyncResource`), como clave de un patrón de desestructuración
       (`const { EventEmitterAsyncResource: E } = events`) o como identificador; venga de `events`, de `node:events` o de
       cualquier otro lado;
     - `getBuiltinModule` (como propiedad de cualquier objeto, con punto o calculada, o desestructurado) salvo en una llamada
       directa `<objeto>.getBuiltinModule('<literal>')` cuyo argumento es un literal de cadena distinto de `async_hooks` y
       de `node:async_hooks`: fallan `process.getBuiltinModule('async_hooks')`, `process.getBuiltinModule('node:async_hooks')`,
       `process.getBuiltinModule(nombre)` (argumento que no es un literal), `const { getBuiltinModule } = process` y
       `const g = process.getBuiltinModule`; pasa `process.getBuiltinModule('node:crypto')`.

     Siguen pasando `import { EventEmitter } from 'node:events'`, `new EventEmitter()` y los eventos emitidos dentro de
     `trabajo` (criterio 134). Dentro de `backend/src/infraestructura/` la regla no cambia. Lo que no se detecta en ejecución
     (un `EventEmitterAsyncResource` obtenido por un nombre armado en tiempo de ejecución) queda en "Riesgos aceptados", con
     la explicación de por qué el envoltorio no puede distinguirlo. Prueba de la regla con la clase `ESLint` y
     `eslint.config.mjs`, como en el criterio 135, con cada forma que falla y las que pasan. _(crítico; prueba de la regla
     de lint)_
140. **La subconsulta escalar de la función cuenta como la comparación** _(ataque ronda 7, O5; **precisa** el criterio 132 y
     P-33)_. Dado que `academia_id = (SELECT app_academia_actual())` es la forma habitual de escribir la política para que
     PostgreSQL evalúe la función una vez por consulta y no por fila, y que su sentido es el mismo que la comparación
     directa, entonces, en la regla de forma del criterio 132:
     - un lado de la comparación puede ser la llamada `app_academia_actual()` o una subconsulta escalar que solo la
       selecciona: `(SELECT app_academia_actual())`, con o sin `public.` delante de la función, con o sin un alias simple
       (`pg_get_expr` la escribe `( SELECT app_academia_actual() AS app_academia_actual)`), con cualquier espaciado y en
       cualquier orden (`(SELECT app_academia_actual()) = academia_id`);
     - la subconsulta no puede tener nada más: ni `FROM`, `WHERE`, `LIMIT`, `UNION`, otra columna ni otra función; y el
       operador sigue siendo `=` (no `IN`, `= ANY` ni `IS NOT DISTINCT FROM`);
     - esta subconsulta no es la "subconsulta" que el criterio 132 excluye como término: lo excluido sigue siendo una
       comparación con `academia_id` que está dentro de una subconsulta (como el `EXISTS` del ejemplo);
     - lo demás del criterio 132 no cambia (conjunción de primer nivel, sin `app_es_plataforma` ni `set_config`, toda
       política permisiva, `USING` y `WITH CHECK` según el comando).

     Autocomprobación del criterio 132 ampliada: no detecta `USING (academia_id = (SELECT app_academia_actual()))`,
     `USING ((SELECT public.app_academia_actual()) = academia_id)`,
     `WITH CHECK (academia_id = (SELECT app_academia_actual() AS a))` ni
     `USING (academia_id = (SELECT app_academia_actual()) AND clave <> 'x')`; y sí detecta
     `USING (academia_id = (SELECT app_academia_actual() FROM academias LIMIT 1))`,
     `USING (academia_id = (SELECT app_academia_actual() WHERE true))`,
     `USING (academia_id IN (SELECT app_academia_actual()))`,
     `USING (academia_id = (SELECT app_academia_actual()) OR app_es_plataforma())` y
     `USING (academia_id = (SELECT app_academia_actual() UNION SELECT app_academia_actual()))`. Más casos unitarios de
     `cumpleFormaDeAcademia` con el texto que devuelve `pg_get_expr` para cada uno. _(crítico)_

### Q. Correcciones del ataque adversarial, ronda 8

Criterios agregados tras la ronda 8 del ataque (12/11/2026, sobre el commit `65a4166`). La ronda no encontró fallas en las
garantías de ejecución de 001. Encontró una falla media en las guardas (un esquema que pertenece a una extensión escondía las
tablas y vistas propias que se crearan dentro) y una observación (parámetros de conexión en la cadena de consulta de la URL).
Son decisiones técnicas del orquestador, no reglas de negocio nuevas. Donde un criterio ajusta o amplía uno anterior lo dice,
y el anterior queda marcado "(… ataque ronda 8)", sin borrar su texto. Contrato nuevo: precisión P-34. Todos son
_(crítico)_.

141. **Los esquemas de extensiones se revisan; solo se excluyen los objetos de extensión** _(ataque ronda 8, F1; **ajusta**
     la definición de "esquemas revisados" de la sección O y los criterios 130 y 137; decisión del orquestador)_. Dado que la
     comprobación del rol en la API (`#comprobarRol`) y en `npm run db:crear` (`problemasDePrivilegiosEnEsquemas` y toda
     consulta que use la definición de esquemas revisados) descartan **entero** todo esquema que pertenece a una extensión, y
     que un esquema puede pertenecer a una extensión y contener objetos propios (`ALTER EXTENSION pgcrypto ADD SCHEMA
     reportes2` hecho por el dueño, o los esquemas que crean extensiones del hosting, como `cron`, `topology` o `tiger`, donde
     después se crea una tabla), de modo que en la ronda 8 la app leyó filas de A y de B de una tabla sin RLS de `reportes2`
     con `SELECT` concedido, sin que la API ni `db:crear` lo notaran, entonces:
     - **esquemas revisados** son todos los de `pg_catalog.pg_namespace` salvo `pg_catalog`, `information_schema`,
       `pg_toast` y los temporales (`pg_temp_N` y `pg_toast_temp_N`); un esquema que pertenece a una extensión **es** un
       esquema revisado (la pertenencia del esquema a una extensión ya no se consulta en ninguna comprobación);
     - lo único que se excluye es el **objeto de extensión** (definición de la sección O): la relación (con sus columnas),
       la secuencia o la función que tiene su propia fila `deptype = 'e'` hacia `pg_extension`. Una relación de tipo
       compuesto (`relkind = 'c'`) cuenta como objeto de extensión si su tipo (`pg_class.reltype`) lo es (PostgreSQL
       registra la pertenencia de un tipo compuesto en `pg_type`, no en `pg_class`); los índices y las tablas TOAST siguen
       sin contar como objetos propios;
     - en un esquema que pertenece a una extensión valen las mismas reglas del criterio 130 que en cualquier otro: un
       privilegio de tabla, de columna o de secuencia sobre una relación propia es de más; `EXECUTE` sobre una función
       propia de un esquema con `USAGE` es de más (salvo `FUNCIONES_APP`, que son de `public`); y `USAGE` sobre el esquema
       se permite si no contiene ninguna relación ni función propia (vacío o con solo objetos de extensión), y se rechaza si
       contiene alguna, aunque la app no tenga privilegios sobre ella (salvo la lista "Esquemas permitidos además de
       `public`", hoy vacía);
     - la API rechaza con `ErrorRolBaseDatosInseguro` como en el criterio 4 (el log nombra el esquema, el objeto y el
       privilegio, nunca la URL ni la contraseña) y `db:crear` termina con código 1 nombrando lo mismo y la corrección
       (`REVOKE SELECT ON reportes2.t FROM aquagestion_app;`, `REVOKE USAGE ON SCHEMA reportes2 FROM aquagestion_app;` o
       `… FROM PUBLIC;`), sin modificar nada; para un mismo estado de la base, las dos deciden lo mismo (criterio 137);
     - con las migraciones de esta historia y nada más, la comprobación pasa.

     Prueba de integración, con una API nueva por caso y restaurando al final, en la API y en `db:crear` (como en las de los
     criterios 130 y 137). Preparación, como dueño no superusuario (así se reprodujo; con superusuario sirve igual): una
     extensión de confianza que el dueño pueda crear y de la que sea dueño (orientativo: `CREATE EXTENSION pgcrypto SCHEMA
     public`); si ya estaba instalada por otro rol o no se puede instalar ninguna, los casos se omiten con aviso (corren en
     Docker y en la CI; la prueba solo quita lo que creó). Entonces:
     1. el ataque: `CREATE SCHEMA reportes2`, `ALTER EXTENSION pgcrypto ADD SCHEMA reportes2`,
        `CREATE TABLE reportes2.t (academia_id uuid, dato text)` sin RLS, con una fila de A y una de B,
        `GRANT USAGE ON SCHEMA reportes2 TO aquagestion_app` y `GRANT SELECT ON reportes2.t TO aquagestion_app`:
        `conAcademia`, `comoPlataforma` y `resolverAcademia` rechazan con `ErrorRolBaseDatosInseguro` (el log nombra
        `reportes2`, `t` y `SELECT`), y `db:crear` sobre la base de pruebas termina con código 1 nombrando `reportes2.t`,
        `SELECT` y un `REVOKE`;
     2. lo mismo con `USAGE` y `SELECT` concedidos a `PUBLIC`: las dos rechazan, y `db:crear` propone `… FROM PUBLIC;`;
     3. `USAGE` sobre `reportes2` con la tabla y sin ningún privilegio sobre ella: las dos rechazan (objetos propios);
     4. control que pasa: `CREATE SCHEMA ext_r8`, `ALTER EXTENSION pgcrypto ADD SCHEMA ext_r8`, una función
        `ext_r8.f()` y un tipo compuesto `ext_r8.par AS (a int)` agregados a la extensión (`ALTER EXTENSION pgcrypto ADD
        FUNCTION ext_r8.f()` y `… ADD TYPE ext_r8.par`), y `GRANT USAGE ON SCHEMA ext_r8 TO aquagestion_app`: la API
        atiende y `db:crear` no informa ningún privilegio de más ni nombra `ext_r8`.

     _(crítico)_
142. **Las pruebas de catálogo revisan los esquemas de extensiones** _(ataque ronda 8, F1; **ajusta** el criterio 131 y,
     por él, los 9, 10, 11, 12, 124, 126, 132, 133 y la prueba de catálogo del 137)_. Dadas las migraciones aplicadas en la
     base de pruebas, entonces la condición de esquemas revisados que usan las pruebas de catálogo
     (`esquemasRevisados` de `backend/test/utilidades/catalogo.ts`, y toda consulta de prueba que la repita) sigue la
     definición del criterio 141: incluye los esquemas que pertenecen a una extensión y solo excluye los objetos de
     extensión (`relacionDeExtension` y `funcionDeExtension`, que no cambian). Así, una tabla sin RLS (criterio 9), una tabla
     sin `academia_id` fuera de la lista del criterio 10, una tabla con `academia_id` con políticas que no cumplen (11 y 132)
     o sin sembrador (133), una vista sin `security_invoker` o una función `SECURITY DEFINER` (124) y una restricción única
     sin `academia_id` (126) se detectan también dentro de un esquema de extensión; las excepciones por nombre siguen
     valiendo solo en `public`.

     Autocomprobación, como dueño, dentro de una transacción que se revierte y con una extensión de confianza de la que el
     dueño sea dueño (si no se puede, se omite con aviso; las consultas sobre la base real corren igual): `CREATE SCHEMA
     reportes_ext_prueba` y `ALTER EXTENSION … ADD SCHEMA reportes_ext_prueba`, y dentro una tabla sin RLS (la detecta la
     consulta del 9), una tabla `reportes_ext_prueba.academias` sin `academia_id` (la del 10), una vista sin
     `security_invoker` (124) y una tabla con `academia_id` y `UNIQUE (numero)` (126); cada una aparece en el resultado de su
     consulta. Control: una tabla sin RLS y sin `academia_id` del mismo esquema agregada a la extensión (`ALTER EXTENSION …
     ADD TABLE`) no aparece en las del 9 ni del 10. _(crítico)_
143. **Ninguna URL de conexión cambia el usuario, el servidor ni la base por su cadena de consulta** _(ataque ronda 8, O1;
     **amplía** el criterio 5 y complementa los criterios 6, 8, 81 y 90; decisión del orquestador)_. Dado que el cliente
     `pg` (con `pg-connection-string`, el que usan la API por `@prisma/adapter-pg`, los comandos y la semilla) toma `user`,
     `host`, `password`, `port` y `database` o `dbname` de la cadena de consulta por encima de la parte principal de la URL,
     mientras que `db:crear` y el hook de sesión leen la parte principal con `new URL` (`analizarUrlPostgres` y
     `leerUrlApp`), de modo que con `DATABASE_URL_APP=postgresql://aquagestion_app:…@h/b?user=otro` `db:crear` comprueba el
     rol `aquagestion_app` mientras la API se conecta como `otro` (o a otro servidor u otra base), entonces:
     - el valor de `DATABASE_URL`, `DATABASE_URL_APP` o `DATABASE_URL_PRUEBAS` es inválido si su cadena de consulta tiene
       algún parámetro cuyo nombre, decodificado como lo decodifica `URLSearchParams` (`%75ser` es `user`) y sin distinguir
       mayúsculas (`USER`, `User`), es `user`, `host`, `hostaddr`, `password`, `port`, `dbname` o `database`: con cualquier
       valor (también vacío, `?user=`), en cualquier posición (`?sslmode=disable&user=x`) y aunque se repita;
     - lo rechazan, con falla cerrada, antes de abrir ninguna conexión y sin modificar nada:
       - la API: `validarEntorno` (criterio 5) lanza `ErrorEntorno` para `DATABASE_URL_APP` y la API no arranca;
       - `npm run db:crear`: termina con código 1 si cualquiera de las tres variables lo cumple;
       - el hook de sesión de la nube: el paso que lee las URL falla y lo informa, sin crear roles con esos valores;
       - `npm run plataforma:superadmin` y la semilla (`npm run db:semilla`): terminan con código 1 sin conectarse ni
         escribir nada;
     - el mensaje nombra la variable y el parámetro (por ejemplo, "DATABASE_URL_APP no puede llevar el parámetro user en la
       cadena de consulta: pon el usuario, la contraseña, el servidor, el puerto y la base en la parte principal de la
       URL"), nunca la URL, el valor del parámetro ni la contraseña;
     - `options` y `sslmode` siguen permitidos (los usan las pruebas de los criterios 72, 90, 98, 107, 121 y 122), y tampoco
       se rechazan los demás parámetros no listados (ver "Riesgos aceptados"); una URL sin cadena de consulta no cambia.

     Funciones que deciden: P-34. Prueba unitaria de `parametrosDeConexionProhibidos` en los dos archivos de P-34, con cada
     nombre de la lista, en mayúsculas y mezcladas, codificado (`%75ser`, `d%61tabase`), con valor vacío, en segunda
     posición y repetido; y los que pasan: sin cadena de consulta, `?options=-c%20TimeZone%3DUTC`, `?sslmode=disable`,
     `?sslmode=require&options=-c%20search_path%3Dx` y `?application_name=x`; y de que `PARAMETROS_DE_CONEXION_PROHIBIDOS`
     es igual en los dos archivos. Prueba unitaria de `validarEntorno` (`DATABASE_URL_APP` con `?user=postgres` y con
     `?password=<valor reconocible>`: `ErrorEntorno` cuyo mensaje nombra `DATABASE_URL_APP` y el parámetro y no contiene el
     valor ni la URL) y de `analizarUrlPostgres`, `leerUrlApp` y `leerUrlsBases` de `scripts/lib/entorno.mjs` con cada una de
     las tres variables. Prueba de integración: `db:crear` con `DATABASE_URL_APP` válida más `?user=<usuario del dueño>`,
     y con `DATABASE_URL_PRUEBAS` más `?host=127.0.0.2`, termina con código 1, nombra la variable y el parámetro y su salida
     no contiene la contraseña ni la URL; el comando y la semilla, ejecutados como proceso con `DATABASE_URL` de pruebas más
     `?user=aquagestion_app`, terminan con código 1 con el mismo tipo de mensaje y, leído como dueño, no crearon ni
     cambiaron ningún superadmin ni academia. Prueba unitaria de la función del hook que lee las URL
     (`scripts/test/preparar-sesion.test.mjs` o un archivo nuevo): con cualquiera de las tres variables así, el paso falla
     nombrando la variable y sin el valor. _(crítico)_

### R. Correcciones del ataque adversarial, ronda 9

Criterios agregados tras la ronda 9 del ataque (12/11/2026, sobre el commit `532eee4`). La ronda encontró una falla alta
(nada fija la volatilidad de las funciones de contexto: marcadas `IMMUTABLE`, un plan guardado mezcla academias en una
conexión del pool con toda la suite en verde), una media (`client_encoding` no se fija por transacción) y dos observaciones
(`synchronous_commit` y la parte principal de `DATABASE_URL_APP` en `db:crear`). Son decisiones técnicas del orquestador, no
reglas de negocio nuevas; la revisión de los demás parámetros de sesión (O2) es del especificador. Donde un criterio amplía
uno anterior lo dice, y el anterior queda marcado "(… ataque ronda 9)", sin borrar su texto. Contrato nuevo: precisión P-35.
Todos son _(crítico)_.

144. **Funciones de contexto `STABLE`, nunca `IMMUTABLE`** _(ataque ronda 9, F1; complementa los criterios 11, 12, 124 y
     132; decisión del orquestador)_. Dado que PostgreSQL calcula una función `IMMUTABLE` al planificar y deja su valor como
     constante en el plan, y que los planes genéricos que se guardan por sesión (los de plpgsql y las sentencias
     preparadas) se reusan en la misma conexión del pool con otra academia (en la ronda 9, con `app_academia_actual()` en
     `IMMUTABLE`, un disparador plpgsql que leía una tabla con RLS en el contexto de A devolvió filas de B a partir de la
     6.ª ejecución, y toda la suite siguió en verde), entonces una prueba de catálogo sobre las migraciones aplicadas en la
     base de pruebas falla, con un mensaje que nombra la función (esquema, nombre y argumentos) y su volatilidad, si:
     - `public.app_academia_actual()` o `public.app_es_plataforma()` no tienen `pg_proc.provolatile = 's'` (`STABLE`; ni
       `IMMUTABLE` ni `VOLATILE`, que impediría usar los índices que empiezan por `academia_id`);
     - alguna función de la que depende una política (fila de `pg_catalog.pg_depend` con
       `classid = 'pg_catalog.pg_policy'::regclass` y `refclassid = 'pg_catalog.pg_proc'::regclass`), de cualquier esquema
       salvo `pg_catalog`, tiene `provolatile = 'i'`;
     - alguna función de `FUNCIONES_APP` (P-31) tiene `provolatile = 'i'` (hoy `resolver_academia` es `VOLATILE` y así
       sigue: fija `app.plataforma`);
     - alguna función de los esquemas revisados (criterio 141) que no sea objeto de extensión y cuyo `prosrc` contenga, sin
       distinguir mayúsculas, `current_setting`, `app_academia_actual` o `app_es_plataforma`, tiene `provolatile = 'i'`
       (cubre una función auxiliar llamada dentro del cuerpo de otra, que `pg_depend` no registra);
     - el cuerpo de las dos funciones no es el esperado: `prolang` es el de `sql`, `prosecdef` es falso, `proconfig` es
       nulo, el tipo de retorno es `uuid` y `boolean` respectivamente, sin argumentos, y `prosrc`, con cada tramo de
       espacios en blanco reducido a un espacio y sin espacios al principio ni al final, es exactamente
       `SELECT CAST(NULLIF(pg_catalog.current_setting('app.academia_id', true), '') AS pg_catalog.uuid)` para
       `app_academia_actual` y `SELECT COALESCE(pg_catalog.current_setting('app.plataforma', true), '') = 'si'` para
       `app_es_plataforma` (el texto de la migración `20261111150000_academias_aislamiento`). Una historia que necesite
       cambiarlas lo hace con una migración nueva y ajusta esta prueba protegida en su commit de pruebas protegidas.

     Con las migraciones actuales pasa. Autocomprobación, como dueño, en una transacción que se revierte (cada caso en su
     `SAVEPOINT`): con `ALTER FUNCTION public.app_academia_actual() IMMUTABLE`, la función aparece por la primera y la
     segunda viñeta; con `ALTER FUNCTION public.app_es_plataforma() VOLATILE`, por la primera; una función de ejemplo
     `public.prueba_r9_auxiliar() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT pg_catalog.current_setting('app.academia_id', true) $$`,
     sin políticas que la usen, aparece por la cuarta; una política de ejemplo sobre una tabla de ejemplo con RLS que usa
     una función `IMMUTABLE` sin `current_setting` en el cuerpo aparece por la segunda; y `CREATE OR REPLACE FUNCTION
     public.app_es_plataforma() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$` aparece por la quinta. _(crítico)_
145. **Un plan guardado en la conexión no lleva la academia de otra transacción** _(ataque ronda 9, F1; complementa los
     criterios 22, 72 y 144)_. Prueba de integración con la API de pruebas en `DATABASE_POOL_MAX=1` (una sola conexión) y
     las academias A y B. Preparación, como dueño, restaurando al final también si la prueba falla: una fila de
     `configuraciones` de A y otra de B con la clave `prueba_r9_semilla`; una función de disparador plpgsql
     `public.prueba_r9_academias_vistas()`, con `EXECUTE` revocado a `PUBLIC` (así la comprobación del rol, criterio 130,
     no la cuenta), que, solo cuando `NEW.clave` empieza por `prueba_r9_`, pone en `NEW.valor` el arreglo `jsonb` ordenado
     de las `academia_id` distintas que ve en `configuraciones` entre las filas cuya clave empieza por `prueba_r9_`; y un
     disparador `BEFORE INSERT … FOR EACH ROW` en `configuraciones` que la ejecuta. Entonces, en 12 transacciones seguidas
     que alternan la academia (A, B, A, B, …), cada una un `conAcademia(X, …)` que inserta en `configuraciones` una fila con
     una clave nueva `prueba_r9_<n>` y lee su `valor` con `RETURNING`:
     - en cada una, `valor` es exactamente el arreglo con la sola academia X, y `current_setting('app.academia_id', true)`
       dentro de `trabajo` es X;
     - el mensaje de falla nombra el número de la ejecución, la academia del contexto y las academias vistas.

     Autocomprobación, como dueño, en una transacción que se revierte: `ALTER FUNCTION public.app_academia_actual()
     IMMUTABLE`, y la función, el disparador y las filas semilla creados dentro de la misma transacción; si el dueño es
     superusuario o tiene `BYPASSRLS` (Docker y CI), `SET LOCAL ROLE aquagestion_app` (si no puede, la autocomprobación se
     omite con aviso); si no (nube), sigue como dueño, que pasa por RLS por el `FORCE`. Luego las mismas 12 inserciones en
     la misma conexión, alternando el contexto con `pg_catalog.set_config('app.academia_id', X, true)`: al menos una
     devuelve en `valor` una academia distinta de la del contexto (el mecanismo detecta). Control, en otra transacción
     revertida y sin el `ALTER`: ninguna lo hace. _(crítico)_
146. **`client_encoding` en `UTF8` en cada transacción** _(ataque ronda 9, F2; **amplía** los criterios 107 y 122 y la
     excepción de `cli/` de los criterios 107 y 121; decisión del orquestador)_. Dado que `@prisma/adapter-pg` y `pg` envían
     y leen el texto siempre en UTF-8, y que con otra `client_encoding` en la sesión PostgreSQL convierte lo que recibe
     como si viniera en esa codificación (en la ronda 9, tras un `set_config('client_encoding', 'LATIN1', false)` dejado en
     la conexión, `Ñandú` se guardó como `ÃandÃº`, y la misma conexión lo leía bien porque la conversión de vuelta lo
     deshacía), entonces:
     - toda transacción de `BaseDatos` (`conAcademia`, `comoPlataforma`, `resolverAcademia` y la de la comprobación del
       rol, criterio 121) y de `enPlataforma` fija `client_encoding` en `UTF8`, local a la transacción
       (`pg_catalog.set_config('client_encoding', 'UTF8', true)`), en la misma primera sentencia de los criterios 98, 107,
       121 y 122, antes de `trabajo`; dentro de `trabajo`, `current_setting('client_encoding')` es `UTF8`;
     - la primera sentencia y sus parámetros tienen solo caracteres ASCII, así que se interpretan igual con cualquier
       `client_encoding` (como el `\` en el criterio 122);
     - en `backend/src/cli/`, la regla del criterio 83 admite además exactamente
       `set_config('client_encoding', 'UTF8', true)`, con o sin `pg_catalog.` y sin distinguir mayúsculas ni en el nombre
       de la variable ni en el valor, igual que las excepciones de los criterios 98, 107, 121 y 122 (`'utf8'` pasa)
       _(precisado: decisión del orquestador tras T107, 12/11/2026; antes decía que `'utf8'` fallaba)_; otro valor
       (`'LATIN1'`, `'SQL_ASCII'`) o un tercer argumento distinto de `true` sigue fallando, y fuera de `cli/` y de
       `infraestructura/prisma/` sigue prohibida toda llamada a `set_config`.

     Prueba de integración con la vía (a) del criterio 107, con la API de pruebas en `DATABASE_POOL_MAX=1`: un
     `conAcademia(A, …)` cuyo `trabajo` ejecuta `set_config('client_encoding', 'LATIN1', false)` y confirma; después, en la
     misma conexión:
     - un `conAcademia(B, …)` inserta en `configuraciones` una fila con `valor` `{"nombre": "Ñandú"}`; dentro de ese
       `trabajo`, `current_setting('client_encoding')` es `UTF8`; leída como dueño con una conexión nueva de `pg`,
       `valor->>'nombre'` es exactamente `Ñandú` y su `octet_length` es 7;
     - `POST /api/plataforma/academias` con el nombre `Academia Ñandú` responde 201 y, leído como dueño con una conexión
       nueva, el nombre guardado en `academias` es exactamente `Academia Ñandú`, y también donde lo guarde su fila de
       `auditoria_plataforma` (por ejemplo, `datos_despues->>'nombre'`), si lo guarda;
     - en los comandos: con `crearClienteDelDueno(<URL del dueño de pruebas>, { max: 1 })`, un `enPlataforma` que deja
       `client_encoding` en `LATIN1` con `set_config(…, false)` y otro que escribe `Ñandú` en una fila de prueba de
       `auditoria_plataforma` (o crea una academia de prueba con ese nombre): dentro del segundo,
       `current_setting('client_encoding')` es `UTF8`, y leído como dueño con una conexión nueva, el texto es exactamente
       `Ñandú`.

     Y la prueba de la regla de lint (como en el criterio 92): en `cli/` pasan la llamada nueva con y sin `pg_catalog.`, y
     también con el valor `'utf8'` _(decisión del orquestador tras T107, 12/11/2026)_; fallan los otros valores
     (`'LATIN1'`, `'SQL_ASCII'`) y `set_config('client_encoding', 'UTF8', false)`. Las vías (b) a (e) del criterio 107 no son
     obligatorias para este parámetro; si se agregan y la conexión no se puede abrir por el propio parámetro, el caso se
     omite con aviso. _(crítico)_
147. **Parámetros que cambian lo que se confirma o lo que se escribe, fijos en cada transacción** _(ataque ronda 9, O2;
     **amplía** los criterios 107 y 122 y la excepción de `cli/` de los criterios 107 y 121; decisión del orquestador
     sobre `synchronous_commit` y del especificador sobre los demás)_. Dado que `synchronous_commit` en `off` (o `local`)
     hace que PostgreSQL responda a la confirmación antes de escribirla en el disco o en el servidor de réplica síncrono
     (una caída del servidor pierde lo que la API ya dio por guardado; en las historias siguientes, un pago o un movimiento
     de caja), que `array_nulls` en `off` hace que el elemento `NULL` de un arreglo escrito como texto se guarde como la
     cadena `'NULL'` y no como un nulo, y que `transform_null_equals` en `on` convierte `x = NULL` en `x IS NULL` (un
     `UPDATE` o `DELETE` con esa condición tocaría filas), y que los tres pueden llegar por `options` en la URL (que el
     criterio 143 permite), por la conexión, por la base, por `ALTER ROLE ALL` o por el servidor, entonces:
     - toda transacción de `BaseDatos` (con la de la comprobación del rol) y de `enPlataforma` fija, local a la transacción
       y en la misma primera sentencia: `synchronous_commit = 'on'`, `array_nulls = 'on'` y `transform_null_equals = 'off'`;
       dentro de `trabajo`, `current_setting` de cada uno da exactamente `on`, `on` y `off`;
     - en `backend/src/cli/`, la regla del criterio 83 admite además exactamente
       `set_config('synchronous_commit', 'on', true)`, `set_config('array_nulls', 'on', true)` y
       `set_config('transform_null_equals', 'off', true)`, como en el criterio 146; otro valor (`'off'`, `'local'`,
       `'remote_apply'` para el primero) o un tercer argumento distinto de `true` sigue fallando;
     - los demás parámetros de sesión revisados no se fijan; cada uno, con su motivo, está en "Riesgos aceptados"
       ("Parámetros de sesión que no se fijan", ronda 9).

     Prueba de integración (como la del criterio 107), con la API de pruebas en `DATABASE_POOL_MAX=1` y una API nueva por
     vía: (a) un `trabajo` anterior en la misma conexión con `set_config('synchronous_commit', 'off', false)`,
     `set_config('array_nulls', 'off', false)` y `set_config('transform_null_equals', 'on', false)`, confirmado; (b)
     `DATABASE_URL_APP` con `options` `-c synchronous_commit=off -c array_nulls=off -c transform_null_equals=on`
     (codificado). En cada vía, dentro de `trabajo` (`conAcademia` y `comoPlataforma`):
     - `current_setting` de los tres da `on`, `on` y `off`;
     - `SELECT ('{a,NULL}'::text[])[2] IS NULL AS es_nulo` devuelve `true`;
     - `SELECT count(*)::int AS n FROM (VALUES (NULL::int)) AS v(x) WHERE x = NULL` devuelve 0.

     En los comandos: con `crearClienteDelDueno` y `max: 1`, la vía (a) en un `enPlataforma` anterior, y con la URL del
     dueño con esas `options`, dentro de `enPlataforma` se cumplen las mismas tres viñetas. Y la prueba de la regla de lint
     (como en el criterio 92): en `cli/` pasan las tres llamadas nuevas con y sin `pg_catalog.`; fallan
     `set_config('synchronous_commit', 'off', true)`, `set_config('array_nulls', 'off', true)`,
     `set_config('transform_null_equals', 'on', true)` y cualquiera de las tres con `false`. _(crítico)_
148. **`DATABASE_URL_APP` apunta al servidor, el puerto y la base de `DATABASE_URL`** _(ataque ronda 9, O1; **amplía** los
     criterios 6 y 8 y complementa el 81 y el 143; decisión del orquestador)_. Dado que `npm run db:crear` (y
     `npm run db:preparar`, que lo usa) y el hook de sesión toman de `DATABASE_URL_APP` solo el usuario y la contraseña,
     mientras que el servidor, el puerto y las bases que revisan salen de `DATABASE_URL` y `DATABASE_URL_PRUEBAS` (si
     `DATABASE_URL_APP` apunta a otra base u otro servidor, `db:crear` aprueba el rol en una base y la API usa otra),
     entonces, con las tres URL válidas (criterios 5 y 143):
     - `db:crear` termina con código 1, antes de abrir ninguna conexión y sin crear ni modificar nada (ni el rol ni las
       bases), si el servidor, el puerto o la base de `DATABASE_URL_APP` no coinciden con los de `DATABASE_URL`;
     - en el hook de sesión, el paso "Rol de la aplicación" falla y lo informa, sin consultar ni crear el rol;
     - se comparan las partes que devuelve `analizarUrlPostgres`: el servidor como texto, sin distinguir mayúsculas y sin
       resolver nombres (`localhost` y `127.0.0.1` son distintos); el puerto como número (sin puerto es 5432, así que
       `h/b` y `h:5432/b` coinciden); y la base exacta, ya decodificada (`aqua%5Fdev` y `aqua_dev` coinciden). No se
       comparan el usuario ni la contraseña (deben ser distintos, criterio 6) ni la cadena de consulta (`options` y
       `sslmode` pueden diferir);
     - el mensaje nombra `DATABASE_URL_APP`, `DATABASE_URL` y cada parte que difiere (servidor, puerto o base), y pide
       corregir `DATABASE_URL_APP`; no contiene la URL ni la contraseña de ninguna de las dos;
     - no se compara con `DATABASE_URL_PRUEBAS`: en las pruebas, la URL de la app se arma con el usuario y la contraseña
       de `DATABASE_URL_APP` y el servidor, el puerto y la base de `DATABASE_URL_PRUEBAS` (contrato, "Roles de PostgreSQL y
       variables de entorno");
     - la API no lo comprueba al arrancar: no recibe `DATABASE_URL` (criterios 5 y 99). En producción no se usa
       `db:crear`; la guía de despliegue lo cubre con el hosting (D-21).

     Función que decide: P-35. Prueba unitaria de `diferenciasConDesarrollo`: servidor distinto; `LOCALHOST` frente a
     `localhost` (coinciden); `localhost` frente a `127.0.0.1` (difieren); sin puerto frente a `:5432` (coinciden); `:5433`
     (difiere); base distinta; base codificada que coincide; las tres a la vez, en el orden servidor, puerto, base; y
     `options` o `sslmode` distintos (coinciden). Prueba de integración de `db:crear` con `DATABASE_URL_APP` con el usuario
     y la contraseña válidos y, por caso, otra base (`/otra_base_r9`), otro puerto y `localhost` en lugar de `127.0.0.1`
     (o al revés, según la URL del caso): código 1; la salida nombra las dos variables y la parte, y no contiene la
     contraseña ni la URL; y, leído como dueño, no se creó ninguna de las bases del caso que no existían. Control: la
     misma parte principal que `DATABASE_URL` más `?sslmode=disable` en `DATABASE_URL_APP` pasa. Prueba unitaria de la
     función del hook que lee y valida la URL de la app, `leerUrlAppParaRol` (P-35): con cada diferencia lanza un error que nombra las dos
     variables y la parte, sin la contraseña, y no ejecuta `psql`. _(crítico)_

### S. Correcciones del ataque adversarial, ronda 10

Criterios agregados tras la ronda 10 del ataque (12/11/2026, sobre el commit `e15707c`). La ronda encontró una falla alta
(una transacción que PostgreSQL revirtió se reportaba como confirmada) y dos observaciones (la fecha de negocio en SQL y la
IP con zona IPv6). Son decisiones técnicas del orquestador y del especificador, no reglas de negocio nuevas. La observación
O1 (fecha de negocio en SQL) no lleva criterio: es una nota para las historias siguientes (plan, sección 22). Donde un
criterio amplía uno anterior lo dice, y el anterior queda marcado "(… ataque ronda 10)", sin borrar su texto. Contrato
nuevo: precisiones P-36 y P-37. Todos son _(crítico)_.

149. **Una transacción abortada nunca se reporta como confirmada en `BaseDatos`** _(ataque ronda 10, F1; **amplía** los
     criterios 21 y 26 y complementa el 22; decisión del orquestador)_ _(ampliado por los criterios 153 y 154, ataque ronda
     11: `asentar` espera también la cola, y una consulta que vuelve con `undefined` hace rechazar)_ _(ampliado por el
     criterio 156, ataque ronda 12: `asentar` espera también las consultas encadenadas que lleguen mientras corre, y una
     llamada que llega cuando el envoltorio ya se apagó hace rechazar)_ _(ampliado por el criterio 160, ataque ronda 13:
     desde `asentar()`, toda operación entregada que rechaza hace rechazar, aunque alguien atrape su rechazo; `cause`
     precisada por el criterio 161: nunca lleva el mensaje de Prisma ni los valores)_. Dado que, si una
     sentencia falla dentro de `trabajo`
     y `trabajo` atrapa el error y termina bien (un reintento que atrapa `esViolacionDeUnicidad`, un `.catch(() =>
     undefined)`, un `try`/`catch` vacío), PostgreSQL deja la transacción abortada; que Prisma 7 envía `COMMIT` y
     PostgreSQL responde con la etiqueta `ROLLBACK` sin error; y que así `conAcademia` y `comoPlataforma` resolvían con el
     valor de `trabajo` aunque todo lo escrito, incluida la auditoría, se había perdido (lo mismo con una consulta enviada
     sin `await` que falla después de que `trabajo` termina), entonces:
     - `conAcademia`, `comoPlataforma` y `resolverAcademia` devuelven el valor de `trabajo` solo si, después de que
       `trabajo` termina bien, de que se asientan (se resuelven o rechazan) todas las consultas que `trabajo` envió por el
       envoltorio, con o sin `await`, y antes de pedir la confirmación, la transacción sigue activa y sin abortar;
     - si quedó abortada, rechazan con `ErrorTransaccionAbortada` (P-36; 500 `ERROR_INTERNO` en la API), Prisma la revierte
       y no queda nada escrito; nunca devuelven el valor de `trabajo`;
     - si `trabajo` lanza un error, nada cambia: rechazan con ese mismo error (criterio 22), no con
       `ErrorTransaccionAbortada`;
     - un error en la propia confirmación (por ejemplo, una falla de serialización con `Serializable`, criterio 27) sigue
       rechazando con ese error, como hoy;
     - el camino normal no cambia: el mismo valor devuelto, las mismas filas escritas y una sola transacción; la
       comprobación es una sentencia más en la misma transacción y conexión, sin valores que vengan de `trabajo`; y siguen
       pasando las pruebas protegidas de las rondas anteriores (promesas nativas sin claves propias, criterio 106; contexto
       asíncrono, 134; tiempos de espera y de duración);
     - el registro técnico del rechazo dice que la transacción quedó abortada por un error de la base que `trabajo` no
       propagó y, si se conoce, el SQLSTATE; nunca los parámetros de las consultas, la URL ni la contraseña.

     Prueba de integración con la API de pruebas, las academias A y B (`crearDatosDeAislamiento`) y `BaseDatos` y
     `AuditoriaService` tomados de la app. En cada variante, `trabajo` primero escribe (en `conAcademia(A, …)`: una fila
     nueva de `configuraciones` con la clave `prueba_r10_<n>` y un registro con `registrarEnAcademia`; en `comoPlataforma`:
     una academia nueva con el nombre corto `prueba-r10-<n>` y un registro con `registrarEnPlataforma`) y después devuelve
     un valor reconocible. Entonces la llamada rechaza con `ErrorTransaccionAbortada` y, leído como dueño con una conexión
     nueva, no existen la fila, la academia ni el registro de auditoría:
     1. **reintento que atrapa la unicidad:** después de escribir, inserta un duplicado sin `ON CONFLICT` (en
        `conAcademia`, una clave de `configuraciones` de A que ya existe; en `comoPlataforma`, una academia con el nombre
        corto de A), atrapa el error con `esViolacionDeUnicidad` y devuelve el valor;
     2. **error atrapado:** `` await tx.cliente.$queryRaw`SELECT 1/0` `` dentro de un `try`/`catch` vacío, y la misma
        consulta con `.catch(() => undefined)`; devuelve el valor;
     3. **consulta sin `await`:** envía sin esperarla, con `.catch(() => undefined)`, una consulta que tarda unos 200 ms y
        luego falla (orientativo: `SELECT 1 / (SELECT 0 FROM pg_catalog.pg_sleep(0.2))`) y devuelve el valor de
        inmediato; la prueba comprueba además que `trabajo` terminó antes de que la consulta fallara; y la misma variante
        con la consulta de un modelo (orientativo: `tx.cliente.configuracion.create(…)` con una clave que ya existe);
     4. **por la API:** un controlador de prueba (opción `controladores` de `crearAppDePruebas`) cuya ruta llama a
        `comoPlataforma` con la variante 1 responde 500 `ERROR_INTERNO` con el formato común de error, y ni la academia ni
        su registro existen.

     Controles: el mismo `trabajo` sin el paso que falla resuelve con el valor y las filas quedan; un `trabajo` que relanza
     el error atrapado rechaza con ese error (`codigoDeErrorDeBase` da `23505` o `22012`), no con
     `ErrorTransaccionAbortada`; y con `DATABASE_POOL_MAX=1`, después de cada variante, un `conAcademia(B, …)` en la misma
     conexión resuelve, lee su propio contexto (criterio 23) y no ve nada de la variante. _(crítico)_
150. **Lo mismo en los comandos y la semilla (`enPlataforma`)** _(ataque ronda 10, F1; **amplía** el criterio 90 y el
     contrato de `enPlataforma`, P-17 y P-23; decisión del orquestador)_. Dada una transacción de
     `enPlataforma(cliente, trabajo)`, entonces devuelve el valor de `trabajo` solo si, después de que `trabajo` termina
     bien y antes de pedir la confirmación, la transacción sigue activa y sin abortar; si no, rechaza con
     `ErrorTransaccionAbortada` (la misma clase de P-36) y no queda nada escrito; si `trabajo` lanza, rechaza con ese
     error, como hoy. El comando y la semilla terminan con código 1 ante ese rechazo, como ante cualquier otro error.
     `trabajo` sigue recibiendo la transacción completa de Prisma (P-24). Prueba de integración con
     `crearClienteDelDueno(<URL del dueño de pruebas>, { max: 1 })`: las variantes 1 a 3 del criterio 149 (sin la del
     modelo en la 3; ver "Riesgos aceptados"), escribiendo una academia nueva con `tx.$executeRaw` y un registro con
     `insertarEnAuditoriaPlataforma`; en la 3, la consulta sin `await` se envía con `` tx.$executeRaw`…`.catch(() =>
     undefined) `` (una `PrismaPromise` sin `then` ni `catch` no se envía). En cada una rechaza con
     `ErrorTransaccionAbortada` y, leído como dueño con una conexión nueva, no queda nada. Controles como en el 149, y
     después de cada variante otro `enPlataforma` con el mismo cliente resuelve. _(crítico)_
151. **Un `ROLLBACK` o un `COMMIT` escritos dentro de `trabajo` tampoco se reportan como éxito** _(ataque ronda 10, F1,
     variante del especificador; complementa los criterios 84, 149 y 150)_. Dado que el lint del criterio 84 prohíbe
     `COMMIT`, `END`, `ROLLBACK`, `ABORT` y `BEGIN` como sentencia fuera de `infraestructura/prisma/`, pero el lint es la
     segunda capa, y que después de un `ROLLBACK` o un `COMMIT` escritos dentro de `trabajo` lo que sigue corre fuera de
     la transacción (cada sentencia se confirma sola, sin los valores de contexto ni los parámetros de la primera
     sentencia) y el `COMMIT` final de Prisma solo produce un aviso, entonces la comprobación de los criterios 149 y 150
     verifica además que sigue abierta la misma transacción que fijó la primera sentencia, con una marca aleatoria por
     transacción que la primera sentencia fija con `set_config(…, true)` (plan, sección 22); si no es la misma, `conAcademia`,
     `comoPlataforma`, `resolverAcademia` y `enPlataforma` rechazan con `ErrorTransaccionAbortada`. Prueba (el `trabajo`
     de la prueba no pasa por el lint): en `conAcademia(A, …)`, `comoPlataforma` y `enPlataforma`, `trabajo` escribe,
     ejecuta `ROLLBACK` con `$executeRaw` y devuelve un valor: rechaza con `ErrorTransaccionAbortada` y no queda nada
     escrito; en `conAcademia(A, …)`, `trabajo` escribe, ejecuta `COMMIT` y devuelve: rechaza con
     `ErrorTransaccionAbortada` (lo escrito antes del `COMMIT` queda confirmado; la prueba no exige lo contrario, ver
     "Riesgos aceptados"). Control de la marca: una variable `app.transaccion` fijada a nivel de sesión por un `trabajo`
     anterior en la misma conexión (`set_config(…, false)`, con `DATABASE_POOL_MAX=1`) no hace pasar la comprobación tras
     un `ROLLBACK`. Después de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, …)` resuelve con su propio
     contexto. _(crítico)_
152. **IP de la auditoría sin zona IPv6; una IP que no se puede guardar hace fallar la operación** _(ataque ronda 10, O2;
     **amplía** los criterios 29, 31 y 32; decisión del especificador, opción (a))_. Dado que Node entrega las direcciones
     IPv6 de enlace local con su zona (`fe80::1%eth0`), que la columna `inet` no admite zonas y que hoy esa IP hace fallar
     la auditoría y la operación con 500, entonces `ipParaAuditoria(ip)` (P-37), que aplican
     `insertarEnAuditoriaDeAcademia` e `insertarEnAuditoriaPlataforma` (y por ellas `registrarEnAcademia`,
     `registrarEnPlataforma`, los comandos y la semilla), da:
     - con `null` o `undefined`: `null`, como hoy (actor `SISTEMA` sin IP, criterio 32);
     - con una IPv4 (`203.0.113.5`) o una IPv6 sin zona, incluida la IPv4 mapeada (`::ffff:203.0.113.5`) y `::1`: el mismo
       texto, sin cambios;
     - con un texto que contiene `%` y cuya parte anterior al primer `%` es una IPv6 válida: esa parte (`fe80::1%eth0` y
       `fe80::1%25eth0` dan `fe80::1`);
     - con cualquier otro texto (vacío, solo espacios, una IP con espacios alrededor, `no-es-ip`, `203.0.113.5%eth0`,
       `%eth0`, `zz::1%eth0`): lanza un error cuyo mensaje no contiene el texto recibido. La operación entera falla (500
       `ERROR_INTERNO` en la API; código 1 en los comandos) y no queda nada escrito, ni la operación ni su auditoría
       (criterio 30). Nunca se guarda `NULL` en lugar de una IP recibida que no se pudo normalizar.

     Si PostgreSQL rechazara una IP que `ipParaAuditoria` aceptó, la operación también falla (como hoy): las dos capas
     fallan cerradas. Prueba unitaria de `ipParaAuditoria` con cada caso de la lista. Prueba de integración: con
     `AcademiasService` de la app, `crear(datos, superadmin, 'fe80::1%eth0')` crea la academia y su registro de
     `auditoria_plataforma` tiene `host(ip) = 'fe80::1'`; en `conAcademia(A, …)`, `registrarEnAcademia` con
     `'::ffff:203.0.113.5'` guarda `host(ip) = '::ffff:203.0.113.5'`; y `crear(datos, superadmin, 'no-es-ip')` rechaza, y
     leído como dueño no existen la academia ni el registro. Las pruebas protegidas anteriores que auditan la IP de
     `supertest` (`::ffff:127.0.0.1` o `127.0.0.1`) no cambian de resultado. _(crítico)_

### T. Correcciones del ataque adversarial, ronda 11

Criterios agregados tras la ronda 11 del ataque (12/11/2026, sobre el commit `28ab05c`). La ronda encontró una falla alta
(consultas lanzadas a la vez que Prisma nunca ejecutó, reportadas como éxito) y dos observaciones (el bloqueo de transacción
con `$queryRaw` y el tiempo límite con operaciones de varias sentencias). Son decisiones técnicas del orquestador y del
especificador, no reglas de negocio nuevas. La observación O1 no lleva criterio de corrección: se corrige el texto que la
sugería (precisión en el criterio 94 y nota en el plan, sección 23) y el criterio 155 fija la forma que sí funciona. La O2
va a "Riesgos aceptados". `enPlataforma` no se envuelve (riesgo aceptado "Consultas lanzadas a la vez dentro de
`enPlataforma`"; decisión técnica en "Decisiones"). Donde un criterio amplía o precisa uno anterior lo dice, y el anterior
queda marcado "(… ataque ronda 11)", sin borrar su texto. Contrato nuevo: precisión P-38 y ampliación de P-36. Todos son
_(crítico)_.

153. **El envoltorio envía las consultas de una en una (cola serial)** _(ataque ronda 11, F1; **amplía** los criterios 21,
     26, 30 y 149; **precisa** la segunda viñeta del 106; decisión del orquestador)_ _(quinta viñeta precisada por el
     criterio 158, ataque ronda 12: la escritura de un delegado que rechaza con un error que no es de la base no deja nada
     propio, así que lo que se confirma es todo lo demás; sexta viñeta ampliada por el criterio 156: `asentar` espera
     también las consultas encadenadas que lleguen mientras corre)_ _(quinta viñeta precisada por el criterio 160, ataque
     ronda 13: atrapar un error que no es de la base y seguir vale para los rechazos que se asientan mientras `trabajo`
     sigue en curso; desde `asentar()`, todo rechazo de una operación entregada hace rechazar la transacción)_. Dado que,
     dentro de una transacción
     interactiva, Prisma 7.10.1 agrupa en un lote las consultas enviadas en el mismo turno (`Promise.all`, `map` con
     funciones `async`, `Promise.allSettled`), las ejecuta en orden y, ante el primer error que no es de la base (P2025 de
     `update` o `delete` sobre una fila que no existe, o el error al leer una columna de tipo `void`), deja de ejecutar el
     resto, cuyas promesas resuelven con `undefined` sin que la consulta llegue a la base; y que así la transacción seguía
     viva, `asentar()` veía todo resuelto, la marca coincidía y `conAcademia` o `comoPlataforma` confirmaban y devolvían
     éxito sin esas escrituras ni su auditoría, entonces:
     - cada función del envoltorio (`$queryRaw`, `$executeRaw` y cada operación de cada delegado) entrega su consulta a
       Prisma solo cuando se asentó (se resolvió o se rechazó) la consulta anterior de la misma transacción, en el orden de
       las llamadas: en una transacción nunca hay más de una consulta del envoltorio entregada a Prisma y sin asentar, así
       que Prisma nunca arma un lote de más de una;
     - si no hay ninguna pendiente, la consulta se entrega en el mismo momento de la llamada; si hay, queda en la cola y
       se entrega en cuanto le toca. En los dos casos, sin esperar un `then` de quien llama (la segunda viñeta del criterio
       106 se lee así; lo demás del 106 no cambia);
     - las comprobaciones de la llamada (envoltorio apagado, otro contexto asíncrono, argumento no admitido; criterios 106,
       112 y 134) se hacen al llamar, como hoy; una llamada rechazada por ellas no entra en la cola ni la detiene;
     - las consultas lanzadas a la vez siguen funcionando, en serie: cada una recibe su propio resultado o su propio error,
       y el error de una (por ejemplo, un P2025) no cambia el resultado de las demás. Si una falla con un error de la base,
       la transacción queda abortada, las siguientes reciben su propio error (`25P02`) y al final rige el criterio 149;
     - el error de una consulta que no viene de la base (P2025; la columna `void`), atrapado por `trabajo`, no aborta la
       transacción en PostgreSQL: si `trabajo` sigue y termina bien, se confirma con todo lo demás, como hoy;
     - `asentar()` (criterio 149) espera también las consultas que siguen en la cola;
     - si `trabajo` lanza, las consultas de la cola que todavía no se entregaron se rechazan sin entregarse, y ninguna se
       entrega después de que la transacción terminó (el criterio 22 no cambia: la llamada rechaza con el error de
       `trabajo`).

     Pruebas de integración con la API de pruebas, las academias A y B (`crearDatosDeAislamiento`) y `BaseDatos` y
     `AuditoriaService` tomados de la app. Lo escrito se lee como dueño con una conexión nueva al terminar cada caso (con
     el código de `28ab05c`, las reproducciones 1 a 3 devolvían éxito sin las escrituras):
     1. **actualizar una lista ignorando las que no existen** (`conAcademia(A, …)`): con dos filas de `configuraciones` de
        A y una lista de tres claves en la que una no existe (en tres órdenes: la inexistente al principio, en medio y al
        final), `trabajo` hace `await Promise.all(lista.map(async (clave) => { try { await
        tx.cliente.configuracion.update({ where: …, data: … }) } catch (error) { /* solo ignora P2025; relanza lo demás */ }
        }))` y después `registrarEnAcademia`; resuelve, las dos filas existentes quedaron actualizadas y el registro de
        auditoría existe (la forma exacta de `where` depende de la llave del modelo; orientativa);
     2. **`allSettled` con escritura y auditoría** (`conAcademia(A, …)`): `await Promise.allSettled([update de una
        configuración que no existe, create de una configuración nueva con la clave prueba_r11_<n>,
        registrarEnAcademia(…)])`; el primero queda `rejected` con P2025 y los otros dos `fulfilled` con un valor distinto de
        `undefined`; resuelve, y la fila nueva y el registro existen;
     3. **en `comoPlataforma`:** lo mismo con un `update` de una academia que no existe (P2025 atrapado), la creación de
        una academia con el nombre corto `prueba-r11-<n>` (orientativo: como `AcademiasService.crear`) y
        `registrarEnPlataforma`, lanzados a la vez con `Promise.all` (con el P2025 atrapado en su función) y con
        `Promise.allSettled`; resuelve, y la academia y su registro existen;
     4. **cada una con lo suyo y en orden:** 20 consultas `$queryRaw` lanzadas a la vez con `Promise.all`, cada una con su
        índice y `pg_catalog.clock_timestamp()`, devuelven cada una su índice, el mismo `pg_backend_pid()` y marcas de
        tiempo crecientes en el orden de las llamadas;
     5. **error de la base en medio:** `Promise.allSettled([create válido, $queryRaw SELECT 1/0, create válido])` atrapado
        por `trabajo`: el primero `fulfilled`, el segundo `rejected` con `22012` y el tercero `rejected` con `25P02`; la
        llamada rechaza con `ErrorTransaccionAbortada` (criterio 149) y no queda nada;
     6. **control, P2025 suelto:** `try { await tx.cliente.configuracion.update(<una que no existe>) } catch {}`, luego una
        escritura y `registrarEnAcademia`: resuelve y las dos filas quedan (como hoy);
     7. **`trabajo` que lanza con consultas en la cola:** envía sin `await` (con `.catch(() => undefined)`) tres `create`
        de `configuraciones` y lanza un error propio: rechaza con ese error y no queda nada;

     y, después de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, …)` resuelve, lee su propio contexto (criterio
     23) y no ve nada del caso. Prueba unitaria del envoltorio con una transacción falsa (P-38): con tres llamadas
     seguidas, la segunda consulta se entrega (se llama a su `then`) solo después de que se asentó la primera, y la tercera
     después de la segunda; con la cola vacía, la consulta se entrega durante la llamada; una llamada rechazada por un
     argumento no admitido no detiene la cola; y tras `descartar()` (P-38), las que seguían en la cola rechazan sin
     entregarse. Siguen pasando sin cambiar de resultado las pruebas protegidas anteriores: promesas nativas (criterio
     106, también las 20 consultas a la vez), contexto asíncrono (134), `asentar` y consultas sin `await` (149 a 151),
     reversión ante un error de `trabajo` (22), la conexión del pool (23), la concurrencia (24) y las de tiempos de espera y
     de duración. Si alguna cambiara, el test-writer o el backend se detienen e informan. _(crítico)_
154. **Una operación que vuelve con `undefined` hace fallar la transacción** _(ataque ronda 11, F1, segunda capa;
     **amplía** los criterios 149 y 153 y P-36; decisión del orquestador)_ _(precisado por el criterio 160, ataque ronda 13:
     "una consulta falsa que rechaza no marca nada" vale antes de `asentar()`; desde `asentar()`, el rechazo de una
     operación entregada marca)_. Dado que Prisma nunca resuelve con `undefined`
     ninguna de las operaciones que expone el envoltorio (`$queryRaw` devuelve un arreglo; `$executeRaw`, un número; las
     de lectura de un registro, el registro o `null`; las de varios, un arreglo o `{ count }`), y que un `undefined` es la
     señal de una consulta que no se ejecutó (criterio 153), entonces, si una función del envoltorio recibe `undefined` de
     Prisma:
     - su promesa rechaza con `ErrorTransaccionAbortada` (P-36, motivo `incompleta`), nunca resuelve con `undefined`;
     - la transacción queda marcada: aunque `trabajo` atrape ese rechazo y termine bien, `conAcademia`, `comoPlataforma` y
       `resolverAcademia` rechazan con `ErrorTransaccionAbortada`, Prisma revierte y no queda nada escrito; la marca se
       revisa después de `asentar()` y antes de confirmar, junto con la comprobación del criterio 149;
     - si `trabajo` lanza, rige el criterio 22 (rechaza con el error de `trabajo`);
     - un `null` (por ejemplo, de `findUnique`), un `0`, un arreglo vacío o `{ count: 0 }` son resultados normales: no
       marcan nada;
     - el registro técnico dice que una consulta de la transacción no llegó a ejecutarse y nombra la operación (por
       ejemplo, `configuracion.update` o `$executeRaw`), nunca sus argumentos, los parámetros ni la URL.

     Prueba unitaria del envoltorio con una transacción falsa (P-38), dentro de `ejecutar`: una operación de un delegado
     y otra de `$executeRaw` cuya consulta falsa resuelve con `undefined` rechazan con `ErrorTransaccionAbortada`, y
     `exigirCompleta()` lanza `ErrorTransaccionAbortada` aunque el rechazo se haya atrapado; con resultados `null`, `0`,
     `[]` y `{ count: 0 }` las promesas resuelven con ese valor y `exigirCompleta()` no lanza; y una consulta falsa que
     rechaza no marca nada (es el error de esa consulta). No hay forma de que Prisma devuelva `undefined` en una consulta
     suelta para probarlo de punta a punta: que `#transaccion` llame a `exigirCompleta()` en el camino bueno lo confirma el
     revisor y lo ataca el adversarial. _(crítico)_
155. **El bloqueo de transacción se toma con `$executeRaw`** _(ataque ronda 11, O1; **precisa** el criterio 94;
     decisión del especificador)_. Dado que `` $queryRaw`SELECT pg_advisory_xact_lock(${clave})` `` falla en Prisma al
     leer la columna de tipo `void` que devuelve la función (y, en un lote, cortaba las consultas siguientes, criterio
     153), entonces la forma que usan el aforo y la caja es `` tx.cliente.$executeRaw`SELECT
     pg_catalog.pg_advisory_xact_lock(${clave}::bigint)` `` (o, con `$queryRaw`, convirtiendo el resultado:
     `` SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)::text AS tomado ``); `pg_try_advisory_xact_lock`, que
     devuelve un `boolean`, sirve con `$queryRaw`. Prueba de integración con `DATABASE_POOL_MAX=2`: en `conAcademia(A, …)`,
     el `$executeRaw` resuelve con un número y `trabajo` sigue (escribe una fila de `configuraciones` que queda); mientras
     esa transacción sigue abierta (una barrera), otra `conAcademia(A, …)` lee `pg_try_advisory_xact_lock` de la misma
     clave con `$queryRaw` y obtiene `false`, y después de que la primera confirma obtiene `true`; y la forma con `::text`
     y `$queryRaw` resuelve con una fila. _(crítico)_

### U. Correcciones del ataque adversarial, ronda 12

Criterios agregados tras la ronda 12 del ataque (12/11/2026, sobre el commit `8a63dbc`). La ronda encontró una falla alta
(la segunda consulta de una cadena sin `await` se perdía después de `terminar()` y la operación respondía éxito), una media
(una escritura con relaciones anidadas que falla a medio camino deja escrita una parte) y tres observaciones. Son
decisiones técnicas del especificador, no reglas de negocio nuevas. Las observaciones O1 (escritura anidada sobre
`academias` desde `conAcademia`) y O2 (la cola quita el agrupado de `findUnique`) no llevan criterio: son notas del plan
(sección 24); la O3 amplía el riesgo aceptado "Tiempo límite con una operación de varias sentencias a medias". Donde un
criterio amplía o precisa uno anterior lo dice, y el anterior queda marcado "(… ataque ronda 12)", sin borrar su texto.
Contrato nuevo: precisiones P-39 y P-40 y precisión de P-38. Todos son _(crítico)_.

156. **El envoltorio acepta las consultas encadenadas hasta que `asentar` termina; una que llega tarde hace rechazar**
     _(ataque ronda 12, F1; **amplía** los criterios 21, 26, 30 y 149; **precisa** la tercera viñeta del 106, la sexta del
     153 y P-38; decisión del especificador sobre el resultado esperado)_ _(precisado por los criterios 159 y 160, ataque
     ronda 13: la forma `void` deja de pasar el lint en `backend/src` fuera de las pruebas; y desde `asentar()`, una
     operación de la cadena que rechaza hace rechazar la transacción aunque un `.catch` la atrape; la "llamada tardía" y
     el "resultado esperado" no cambian para las operaciones que resuelven)_. Dado que `asentar()` solo esperaba las consultas
     que ya estaban en la cola cuando `terminar()` apagaba el envoltorio; que la segunda consulta de una cadena sin `await`
     (`tx.cliente.x.create(…).then(() => auditoria.registrarEnAcademia(…)).catch(…)`, o
     `void (async () => { await …; await … })()`, formas que el lint acepta) se llama cuando la primera se asienta, ya con
     el envoltorio apagado; y que así se rechazaba con "La transacción ya terminó." sin enviarse ni marcar nada, y la
     operación confirmaba y respondía éxito sin esa escritura (por ejemplo, sin la auditoría), entonces:
     - **camino bueno:** cuando `trabajo` termina bien, el envoltorio no se apaga todavía: sigue aceptando las llamadas
       desde el contexto asíncrono de la transacción (criterio 134) y las encola como cualquier otra (criterio 153);
     - `asentar()` termina solo cuando no queda ninguna consulta sin asentar y, después de ceder un turno completo del
       ciclo de eventos (que deja correr las continuaciones pendientes de `then` y de funciones `async`), sigue sin quedar
       ninguna; en ese mismo paso, sin ceder otra vez, apaga el envoltorio. Si llegan consultas nuevas, vuelve a esperar.
       Una cadena que no deja de enviar consultas mantiene la transacción abierta hasta que termina o hasta
       `DURACION_MAXIMA_MS` (rechaza por tiempo, como hoy);
     - **llamada tardía:** desde que `trabajo` terminó bien hasta que la transacción se confirma o se revierte, toda
       llamada al envoltorio que se rechaza sin entregarse porque el envoltorio ya se apagó (desde cualquier contexto) o
       porque viene de otro contexto asíncrono marca la transacción: la llamada rechaza con su `Error` de hoy, y
       `conAcademia`, `comoPlataforma` y `resolverAcademia` rechazan con `ErrorTransaccionAbortada` (P-36, motivo
       `incompleta`), Prisma revierte y no queda nada escrito. La marca se revisa después de `asentar()` y otra vez después
       de la comprobación del criterio 149, justo antes de devolver el valor para que Prisma confirme;
     - **resultado esperado** _(decisión del especificador)_: con una cadena cuyas continuaciones solo esperan consultas del
       envoltorio o promesas que se resuelven sin salir del turno (las dos formas del ataque), **queda todo confirmado**: la
       escritura y su auditoría. Con una cadena que espera algo ajeno a la base (un temporizador, un archivo, un hash), la
       llamada puede llegar después de que el envoltorio se apagó: si llega antes de la última revisión, la operación
       rechaza sin nada escrito; si llega después, ver "Riesgos aceptados" ("Continuación sin `await` que espera algo
       ajeno a la base"). En ningún caso de las dos formas del ataque se responde éxito con la mitad;
     - **mientras `trabajo` corre, nada cambia:** una llamada desde otro contexto rechaza sin marcar la transacción dueña
       (criterio 134), y una rechazada por un argumento no admitido tampoco marca (criterio 153);
     - **camino del error, sin cambios:** si `trabajo` lanza, el envoltorio se apaga y descarta la cola en el acto
       (criterio 153) y rige el criterio 22;
     - el registro técnico dice que una llamada a la transacción llegó después de que el envoltorio se apagó y nombra la
       operación (por ejemplo, `auditoria.create` o `$executeRaw`), nunca sus argumentos, los parámetros ni la URL.

     Pruebas de integración con la API de pruebas, las academias A y B (`crearDatosDeAislamiento`) y `BaseDatos` y
     `AuditoriaService` tomados de la app. En cada caso, `trabajo` pone una variable `termino = true` justo antes de
     devolver un valor reconocible, y la continuación guarda el valor que ve de `termino` (debe ser `true`: prueba que la
     llamada llegó después de que `trabajo` terminó; con el código de `8a63dbc`, los casos 1 y 2 resolvían sin la
     auditoría):
     1. **`.then().catch()`:** en `conAcademia(A, …)`, `tx.cliente.configuracion.create(<clave prueba_r12_<n>>)
        .then(() => auditoria.registrarEnAcademia(tx, …)).catch(() => undefined)` sin `await`, y devuelve; en
        `comoPlataforma`, lo mismo con la creación de una academia con el nombre corto `prueba-r12-<n>` (orientativo:
        `tx.cliente.academia.create`) y `registrarEnPlataforma`. Resuelve con el valor y, leído como dueño con una
        conexión nueva, existen la fila (o la academia) y su registro de auditoría;
     2. **`void` con función `async`:** `void (async () => { await <la misma escritura>; await <el mismo registro>; })()`,
        y devuelve: el mismo resultado que en el 1, en `conAcademia(A, …)` y en `comoPlataforma`;
     3. **cadena que falla:** como el 1, pero la segunda escritura de la cadena es un duplicado (una clave de
        `configuraciones` de A que ya existe; una academia con el nombre corto de A), con `.catch(() => undefined)`:
        rechaza con `ErrorTransaccionAbortada` y no queda nada, tampoco la primera escritura;
     4. **por la API:** un controlador de prueba (opción `controladores` de `crearAppDePruebas`) cuya ruta llama a
        `comoPlataforma` con la forma 2 responde con éxito, y la academia y su registro existen;

     y, después de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, …)` resuelve, lee su propio contexto (criterio
     23) y no ve nada del caso. Prueba unitaria del envoltorio con una transacción falsa (P-38), dentro de `ejecutar`:
     (i) con una consulta entregada y sin asentar, se llama a `asentar()`; desde la continuación de esa consulta se llama a
     otra: se acepta, se entrega cuando la primera se asienta, y `asentar()` no termina hasta que se asienta la segunda;
     (ii) una llamada hecha dentro de un `then` encadenado a una promesa ya resuelta, cuando la cola ya está vacía, también
     se acepta antes de que `asentar()` termine; (iii) después de que `asentar()` terminó, una llamada desde el contexto de
     `ejecutar` y otra desde fuera de él rechazan sin entregarse y `exigirCompleta()` lanza `ErrorTransaccionAbortada`;
     (iv) con `asentar()` en curso, una llamada desde fuera de `ejecutar` rechaza sin entregarse y `exigirCompleta()` lanza;
     (v) antes de llamar a `asentar()`, una llamada desde fuera de `ejecutar` rechaza y `exigirCompleta()` no lanza
     (criterio 134 sin cambios); (vi) tras `descartar()` y `terminar()`, una llamada rechaza sin entregarse (como hoy).
     Siguen pasando sin cambiar de resultado las pruebas protegidas anteriores, en especial las del envoltorio (criterios
     106, 134, 153 y 154, también `envoltorio-cola.test.ts`), las de `asentar` y las consultas sin `await` (149 a 151),
     la reversión ante un error de `trabajo` (22), la conexión del pool (23), la concurrencia (24) y las de tiempos de
     espera y de duración. Si alguna cambiara, el test-writer o el backend se detienen e informan. _(crítico)_
157. **Un rechazo sin manejar en la API se registra y no detiene el proceso** _(ataque ronda 12, F1, forma `void`;
     decisión del especificador)_ _(precisado por los criterios 159 y 162, ataque ronda 13: `main.ts` arranca con
     `arrancar().catch(…)` en lugar de `void arrancar()`, y un error de Prisma o de la base se registra en su forma limpia
     de P-42; un `Error` que no es de la base se sigue registrando como `{ err: <el mismo error> }`)_ _(precisado por el
     criterio 165, ataque ronda 15, F1: un `Error` que no es de la base pero lleva uno en cualquier propiedad, a cualquier
     profundidad, se registra en la forma limpia del 165; sin ninguno, sigue siendo el mismo error)_. Dado que una promesa
     rechazada que nadie maneja (por ejemplo, la de una función
     `async` lanzada con `void` cuya llamada al envoltorio rechaza) hoy termina el proceso de la API (Node 22, modo
     `throw`) y corta las peticiones en curso de todas las academias, entonces:
     - `backend/src/main.ts` registra un manejador de `unhandledRejection` (P-40) **después** de que `app.listen` resuelve;
     - el manejador registra con el registro de pino de la app, en nivel `error`, un mensaje fijo y el error como `{ err }`
       (lo mismo que hace el filtro de errores con un 500); si lo rechazado no es un `Error`, registra solo su tipo
       (`typeof`), nunca su valor;
     - no llama a `process.exit`, no lanza y no cambia `process.exitCode`: el proceso sigue atendiendo;
     - no se registra manejador de `uncaughtException`: una excepción síncrona sin atrapar sigue terminando el proceso;
     - un fallo al arrancar (antes de que `listen` resuelva: entorno inválido, puerto ocupado) sigue terminando el proceso
       con error, como hoy;
     - no oculta ni cambia nada más: la respuesta de cada petición y el resultado de cada transacción los deciden los
       criterios 149, 154, 156 y 158; las pruebas no corren `main.ts`, así que el manejador no tapa un rechazo en ellas.

     Prueba unitaria de la función de P-40 con un registro falso y `process.exit` espiado: con un `Error`, llama una vez a
     `registro.error` con `{ err: <el mismo error> }` y un texto; con una cadena `'dato-secreto-r12'` y con un objeto
     `{ dni: '12345678' }`, el registro tiene el tipo y no contiene ese texto ni ese valor; en ningún caso llama a
     `process.exit` ni lanza. El revisor confirma en `main.ts` que el registro va después de `await app.listen(…)` y que no
     hay manejador de `uncaughtException`. _(crítico)_
158. **Una escritura de un delegado que rechaza no deja escrito nada propio** _(ataque ronda 12, F2; **precisa** la quinta
     viñeta del criterio 153 y **amplía** el 30; decisión del especificador, opción (a) con la capa debajo del
     envoltorio)_ _(precisado por el criterio 161, ataque ronda 13: la causa con la que la capa marca la transacción llega
     a `ErrorTransaccionAbortada` solo en su forma limpia, sin el mensaje de Prisma)_. Dado que, dentro de una transacción interactiva, Prisma 7.10.1 no usa `SAVEPOINT` en las operaciones de
     varias sentencias; que una escritura con relaciones anidadas que falla con un error que no es de la base (P2025,
     P2018, P2014) después de ejecutar parte de sus sentencias deja escrito lo ejecutado sin abortar la transacción; y que
     así, si `trabajo` atrapaba el error como permite el criterio 153, se confirmaba un cambio a medias sin auditoría,
     entonces:
     - cada operación de escritura de un delegado (`create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`,
       `updateManyAndReturn`, `upsert`, `delete` y `deleteMany`), con o sin relaciones anidadas, corre dentro de un punto
       de guardado propio, en la misma conexión y en la misma posición de la cola que la escritura (criterio 153);
     - si la escritura resuelve, el punto de guardado se libera y la operación resuelve con su valor, como hoy;
     - si rechaza y la transacción sigue sana (el error no es de la base), se vuelve al punto de guardado, que deshace todo
       lo que esa operación escribió, se libera, y la operación rechaza con su mismo error (por ejemplo, el P2025). Si
       `trabajo` lo atrapa y termina bien, se confirma todo lo demás y nada de esa operación;
     - si rechaza y la transacción quedó abortada (error de la base), no se vuelve al punto de guardado: la transacción
       sigue abortada como hoy (las consultas siguientes reciben `25P02`) y al final rige el criterio 149
       (`ErrorTransaccionAbortada`, nada escrito). Atrapar un error de la base sigue sin servir para seguir (nota O3 de la
       ronda 10);
     - si el punto de guardado no se puede crear porque la transacción ya estaba abortada, la escritura no se entrega y la
       operación rechaza con ese error (`25P02`), como recibiría hoy;
     - si cualquier otra sentencia del punto de guardado falla (crearlo, liberarlo, volver a él o comprobar el estado de la
       transacción), la operación rechaza y la transacción queda marcada: `conAcademia`, `comoPlataforma` y
       `resolverAcademia` rechazan con `ErrorTransaccionAbortada` y no queda nada escrito;
     - el nombre del punto de guardado es aleatorio por transacción (no se puede adivinar desde otra);
     - no cambian: las lecturas de los delegados, `$queryRaw` y `$executeRaw` (una sentencia cruda es atómica), lo que
       recibe `trabajo` (P-24, P-26 y P-38), el momento en que el envoltorio entrega cada operación a la capa (criterio
       153), el lint (`SAVEPOINT` sigue prohibido fuera de `infraestructura/prisma/`, criterio 84) ni `enPlataforma`;
     - el permiso del criterio 153 de atrapar un P2025 y seguir se mantiene para toda escritura de un delegado, con o sin
       relaciones anidadas: desde este criterio, lo que se confirma nunca incluye una parte de la operación que falló.

     Pruebas de integración con la API de pruebas, las academias A y B (`crearDatosDeAislamiento`) y `BaseDatos` y
     `AuditoriaService` tomados de la app; lo escrito se lee como dueño con una conexión nueva:
     1. **reproducción en `comoPlataforma`:** `trabajo` llama, dentro de un `try`/`catch` que solo ignora un error cuyo
        `codigoDeErrorDeBase` es `null`, a `tx.cliente.academia.update({ where: { id: A }, data: { estado: 'SUSPENDIDA',
        suspendidaEn: <fecha>, motivoSuspension: 'prueba r12', configuraciones: { update: { where: <llave de una
        configuración de A>, data: { valor: … } } } } })`, en dos variantes: una configuración de A que existe (oculta
        para la plataforma por la RLS) y una clave que no existe. Después crea una academia con el nombre corto
        `prueba-r12-<n>` y su registro con `registrarEnPlataforma`, y devuelve. Resuelve; A sigue `ACTIVA`, con
        `suspendida_en` y `motivo_suspension` nulos y `actualizada_en` sin cambio; la configuración de A no cambió; y la
        academia nueva y su registro existen. Con el código de `8a63dbc`, A quedaba suspendida sin auditoría (el
        test-writer confirma el rojo y que la escritura rechaza con un error de Prisma que no es de la base; la forma de
        `where` es orientativa);
     2. **en `conAcademia(A, …)`:** una escritura anidada de un delegado que, con el código de `8a63dbc`, deje escrita una
        parte antes de rechazar con un error que no es de la base (orientativo: `tx.cliente.configuracion.update` de una
        configuración de A con `data: { valor: <nuevo>, academia: { update: { estado: 'SUSPENDIDA' } } }`, que no puede
        actualizar `academias` desde la academia); atrapada, luego una escritura y `registrarEnAcademia`: resuelve, la
        configuración conserva su valor anterior y las otras dos filas existen. Si ninguna forma deja escrita una parte en
        `conAcademia` con el código de `8a63dbc`, el test-writer deja la prueba como guarda (verde por diseño) e informa;
     3. **control, P2025 suelto:** como el caso 6 del criterio 153, y además la escritura que falló no dejó nada;
     4. **control, error de la base dentro de una escritura anidada:** en `comoPlataforma`,
        `tx.cliente.academia.create({ data: { nombre: …, nombreCorto: 'prueba-r12-<n>', configuraciones: { create: [ … ]
        } } })` (la RLS no deja a la plataforma escribir en `configuraciones`) atrapado por `trabajo`, que luego crea otra
        academia y devuelve: rechaza con `ErrorTransaccionAbortada` y no queda ninguna de las dos academias;
     5. **una escritura que va bien no cambia:** `create`, `update` y `delete` de `configuraciones` en `conAcademia(A, …)`
        devuelven lo de hoy y sus filas quedan como hoy; y 20 escrituras lanzadas a la vez con `Promise.all` quedan todas,
        cada una con su resultado;

     y, después de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, …)` resuelve, lee su propio contexto y no ve
     nada del caso. Prueba unitaria de la capa (P-39) con una transacción falsa como la de P-38, que registra cada sentencia
     entregada y la reconoce por su texto (P-39): una escritura que resuelve produce, en orden, crear el punto, la
     escritura y liberarlo; una que rechaza con un error sin SQLSTATE y con la comprobación del estado sana produce crear
     el punto, la escritura, la comprobación, volver al punto y liberarlo, y rechaza con el mismo error; si la
     comprobación rechaza con `25P02`, no se vuelve al punto y `exigirSana()` lanza `ErrorTransaccionAbortada`; si crear
     el punto rechaza, la escritura no se entrega y la operación rechaza con ese error; si liberar, volver al punto o la
     comprobación rechazan con otro error, `exigirSana()` lanza; las lecturas, `$queryRaw` y `$executeRaw` se entregan
     solas, sin sentencias de la capa; ninguna sentencia de la capa sale antes de que se asiente la anterior; y el nombre
     del punto es el mismo dentro de una capa y distinto entre dos capas. Siguen pasando sin cambiar de resultado las
     pruebas protegidas anteriores, en especial 22, 23, 24, 106, 134, 149 a 155 (también el caso 5 del 153: la tercera
     escritura rechaza con `25P02`) y las de tiempos de espera y de duración. Si alguna cambiara, el test-writer o el
     backend se detienen e informan. _(crítico)_

### V. Correcciones del ataque adversarial, ronda 13

Criterios agregados tras la ronda 13 del ataque (12/11/2026, sobre el commit `8f29106`). La ronda encontró una falla alta
(F1: una función `async` lanzada con `void` dentro de `trabajo` cuya consulta falla con un error que no es de la base
después de que `trabajo` terminó; nadie marca la transacción y se confirma lo anterior sin la auditoría), una media (F2: la
causa de `ErrorTransaccionAbortada` lleva el error de Prisma con los valores y el registro del 500 los muestra) y dos
observaciones (O1: el registro técnico copia mensajes de Prisma con datos personales; O2: más de 64 puntos de guardado con
escritura en una transacción desbordan la caché de subtransacciones de PostgreSQL). Son decisiones técnicas del
orquestador (F1 (a), (b) y (c), F2 y O1) y del especificador (forma de la regla de lint, de la causa limpia y del
serializador), no reglas de negocio nuevas. La F1 (c), marcar la transacción ante un `unhandledRejection` emitido en su
contexto asíncrono, se evaluó y no se adopta (ver "Decisiones técnicas tras el ataque, ronda 13" y el riesgo aceptado
"Promesa descartada que escapa al lint"). La O2 no lleva criterio: amplía el riesgo aceptado "Dos sentencias más por
escritura de un delegado" y es una nota del plan (sección 25). Donde un criterio amplía o precisa uno anterior lo dice, y
el anterior queda marcado "(… ataque ronda 13)", sin borrar su texto. Contrato nuevo: P-41 y P-42, y precisiones de P-36,
P-38 y P-40. Todos son _(crítico)_.

159. **Ninguna promesa descartada en `backend/src`: `void` y funciones `async` sin manejar no pasan el lint** _(ataque
     ronda 13, F1 (a); **amplía** el criterio 96; **precisa** el 156 ("formas que el lint acepta") y el 157 (`main.ts`);
     decisión del orquestador, forma de la regla del especificador)_ _(ampliado por el criterio 164, ataque ronda 14, O2:
     la regla propia también falla con una función `async` escrita en el lugar pasada como argumento a `process.nextTick`,
     `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask`, y mira a través de `as`, `satisfies`, `!` y `<T>`;
     y precisado en su última viñeta por la ronda 14, O1: el 160 solo cubre lo que rechaza **después** de que `trabajo`
     terminó; una promesa guardada en una variable y nunca esperada cuya operación rechaza mientras `trabajo` sigue
     esperando otra consulta no la marca nada, ver el riesgo aceptado "Promesa descartada que escapa al lint", corregido)_.
     Dado que una promesa descartada dentro de `trabajo`
     (`void (async () => { await …; await … })()`, una función `async` llamada sin `await`) puede rechazar sin que nadie lo
     vea, también por un error que no sale del envoltorio (por ejemplo, `ipParaAuditoria` que lanza entre dos consultas),
     y que el envoltorio no puede saber que esa función iba a seguir llamando, entonces:
     - **lint normal, con tipos** (`eslint.config.mjs`), en los `.ts` y `.tsx` de `backend/src/` salvo las pruebas
       (`EXENCION_PRUEBAS`, criterio 110) y el cliente generado: `@typescript-eslint/no-floating-promises` en `error` con
       `ignoreVoid: false`, `ignoreIIFE: false` y `checkThenables: true` (P-41). Fallan, entre otras: `void <promesa>`,
       `void (async () => { … })()`, `(async () => { … })();`, una llamada a una función `async` (o que devuelve una
       promesa) como sentencia sin `await`, `promesa.then(ok);` sin manejador de rechazo y `promesa.finally(fn);` sola;
     - **lint normal y paso protegido, sin tipos** (`eslint.config.mjs` y `eslint.protegido.config.mjs`), en
       `ARCHIVOS_DE_CODIGO` salvo las pruebas y el cliente generado: la regla propia
       `aquagestion-promesas/sin-promesas-descartadas` (P-41) falla con (i) todo operador `void`, salvo `void 0`; y (ii) una
       sentencia que es la llamada directa a una función `async` escrita en el lugar (`(async () => { … })();`,
       `(async function () { … })();`) sin `await`. En el paso protegido ningún comentario la apaga (criterio 96);
     - siguen pasando: `await x`, `return x`, `x.then(ok, err)`, `x.catch(fn)`, `x.then(ok).catch(fn)` y `await
       Promise.all([…])` (atrapar equivale a un `try`/`catch`, permitido por el criterio 153; lo que pasa si el rechazo
       llega después de que `trabajo` terminó lo decide el criterio 160);
     - no aplica al frontend, a `backend/test/`, a las pruebas de `backend/src/` ni a `e2e/` (las pruebas reproducen los
       ataques con `void`);
     - el código actual pasa las dos: `main.ts` cambia `void arrancar();` por `arrancar().catch(<fallo al arrancar>)`, que
       escribe el error en la salida de errores (si es de Prisma o de la base, en su forma limpia, criterio 162) y termina
       con `process.exit(1)`: un fallo al arrancar sigue terminando el proceso con error (criterio 157); y en
       `envoltorio.ts`, `void anterior.then(entregar)` pasa a `anterior.then(entregar, nada)` (o una forma equivalente sin
       promesa descartada; `anterior` nunca rechaza). Si `checkThenables: true` señala otro lugar del código actual, el
       backend lo corrige si es una promesa descartada de verdad o se detiene e informa si es un falso positivo;
     - límite (riesgo aceptado "Promesa descartada que escapa al lint"): ninguna de las dos reglas ve una promesa guardada
       en una variable que nadie espera ni una pasada a una función que no la espera, y el paso protegido (sin tipos) no
       ve una función `async` con nombre llamada sin `await`; para lo que rechaza dentro del envoltorio, la garantía en
       ejecución es el criterio 160.

     Prueba de la configuración de lint (con la clase `ESLint`, como las del criterio 96; el archivo con tipos se escribe
     en una carpeta temporal dentro de `backend/src/modulos/` y se borra al terminar, o se usa `lintText` si el servicio
     de proyecto de `typescript-eslint` lo acepta con esa ruta): en `backend/src/modulos/ejemplo/ejemplo.service.ts`, con
     `eslint.config.mjs`, dan error de `@typescript-eslint/no-floating-promises` y de la regla propia la forma exacta del
     ataque (`void (async () => { await tx.cliente.configuracion.update(…); await auditoria.registrarEnAcademia(tx, …);
     })()`), su variante con `const ip = ipParaAuditoria(…)` entre las dos consultas y `void promesa`; dan error de
     `@typescript-eslint/no-floating-promises` `(async () => { … })();`, `hacer();` con `async function hacer()`,
     `promesa.then(() => 1);` y `promesa.finally(() => 1);`; no dan error de ninguna de las dos `await promesa`,
     `promesa.then(ok, err)`, `promesa.catch(fn)`, `promesa.then(ok).catch(fn)` (también dentro de un `trabajo` con
     `await`) ni `void 0`. Con `eslint.protegido.config.mjs` y `allowInlineConfig: false`, en `.ts`, `.js` y `.mjs`: `void
     promesa`, `void (async () => { … })()` y `(async () => { … })();` dan error de la regla propia, también precedidos de
     `// eslint-disable-next-line aquagestion-promesas/sin-promesas-descartadas` y de `/* eslint-disable */`; `void 0` y
     las formas con `.catch` no. Un archivo `*.test.ts` de `backend/src/` con `void (async () => { … })()` no da error de
     ninguna de las dos, y uno de `frontend/src/` con `void promesa` no da error de la regla propia. Y `npm run lint` pasa
     sobre el repositorio (lo confirma el tester). Siguen pasando sin cambiar de resultado las pruebas protegidas del
     criterio 96 (la regla propia no es de `js.configs.recommended` ni de `typescript-eslint`) y las del 157 (proceso
     hijo). _(crítico)_
160. **Desde que `trabajo` terminó, el rechazo de una operación del envoltorio hace fallar la transacción** _(ataque ronda
     13, F1 (b); **amplía** los criterios 149, 154 y 156; **precisa** la quinta viñeta del 153 y P-38; decisión del
     orquestador)_. Dado que, con `trabajo` ya terminado, una operación enviada sin `await` (dentro de una función `async`
     lanzada con `void`, o con `.catch`) que rechaza con un error que no es de la base (un P2025) no aborta la transacción
     en PostgreSQL, que nada la marcaba y que así se confirmaba lo anterior sin lo que venía después (la auditoría), y que
     un `.catch` que solo corre después de que `trabajo` devolvió ya no puede decidir seguir (la operación ya respondió su
     valor), entonces:
     - desde que `#transaccion` llama a `asentar()` (`trabajo` terminó bien) hasta que la transacción se confirma o se
       revierte, toda operación del envoltorio cuya consulta se entregó a la capa de puntos de guardado o a Prisma (en ese
       período o antes, mientras `trabajo` corría) y se asienta en ese período con un rechazo, cualquiera que sea (un error
       de Prisma que no es de la base, como P2025; un error de la base; el de una sentencia de la capa; o `undefined`,
       criterio 154), marca la transacción, y su promesa rechaza con `ErrorTransaccionAbortada` (motivo `incompleta`,
       P-36) con la causa limpia del criterio 161, nunca con el error original;
     - vale aunque quien llamó atrape el rechazo (`.catch`, segundo argumento de `.then`, `try`/`catch` dentro de una
       función `async`, `Promise.allSettled`): `conAcademia`, `comoPlataforma` y `resolverAcademia` rechazan con
       `ErrorTransaccionAbortada`, Prisma revierte y no queda nada escrito. La marca se revisa con `exigirCompleta()` en los
       mismos puntos que la del criterio 156 (después de `asentar()` y otra vez después de la comprobación del 149);
     - **mientras `trabajo` sigue en curso, nada cambia:** una consulta que se asienta con un rechazo antes de que se llame
       a `asentar()` rechaza con su propio error, no marca nada (criterio 154) y, si `trabajo` la atrapa y termina bien
       (y no es un error de la base), se confirma todo lo demás y nada de esa operación (criterios 153 y 158);
     - las llamadas que se rechazan al llamar, sin entregarse, siguen el criterio 156: envoltorio apagado u otro contexto
       marcan desde `asentar()`; un argumento no admitido o una operación que no existe rechazan con su `TypeError` y no
       marcan;
     - una operación que se resuelve con un valor durante `asentar()` resuelve con ese valor (criterio 156: una cadena que
       solo espera consultas del envoltorio y no falla queda toda confirmada);
     - el camino del error no cambia: si `trabajo` lanza, rige el criterio 22 y las consultas de la cola se descartan
       (criterio 153);
     - el registro técnico (`#registrarAbortada`) dice que una operación de la transacción rechazó después de que `trabajo`
       terminó y la nombra (por ejemplo, `configuracion.update`), con el código de Prisma y el SQLSTATE si los hay; nunca
       sus argumentos, los parámetros, la URL ni el mensaje de Prisma (criterio 162).

     Pruebas de integración con la API de pruebas, las academias A y B (`crearDatosDeAislamiento`) y `BaseDatos` y
     `AuditoriaService` tomados de la app. Lo escrito se lee como dueño con una conexión nueva. En cada caso, `trabajo` pone
     `termino = true` justo antes de devolver un valor reconocible, y la operación que falla guarda el valor que ve de
     `termino` al rechazar (debe ser `true`: prueba que rechazó después de que `trabajo` terminó). Para no dejar un rechazo
     sin manejar en Vitest, la prueba guarda el rechazo de la función `async` con `.catch(guardar)` en lugar de `void`
     (en ejecución es lo mismo: el envoltorio no ve quién espera la función). Con el código de `8f29106`, los casos 1 y 2
     resolvían con el valor y sin la auditoría:
     1. **reproducción del ataque** (`conAcademia(A, …)`): `await tx.cliente.configuracion.create(<clave prueba_r13_<n>>)`;
        luego, sin `await`, `(async () => { await tx.cliente.configuracion.update(<una clave de A que no existe>); await
        auditoria.registrarEnAcademia(tx, …); })().catch(guardar)`; y devuelve. Rechaza con `ErrorTransaccionAbortada`; no
        quedan ni la fila creada ni el registro; lo guardado de la función es un `ErrorTransaccionAbortada`. En
        `comoPlataforma`, lo mismo con la creación de una academia con el nombre corto `prueba-r13-<n>`, un
        `tx.cliente.academia.update` de un UUID que no existe y `registrarEnPlataforma`: rechaza y no queda la academia;
     2. **`.catch` sin `await`:** en `conAcademia(A, …)`, una escritura y su registro con `await`, y después, sin `await`,
        `tx.cliente.configuracion.update(<una que no existe>).catch(() => null)`; devuelve. Rechaza con
        `ErrorTransaccionAbortada` y no queda nada; lo mismo con `.then(() => 1, () => null)` y en `comoPlataforma`;
     3. **control, mientras `trabajo` corre (153 sin cambios):** `await tx.cliente.configuracion.update(<una que no
        existe>).catch(() => null)` y `await …then(ok, () => null)` dentro de `trabajo`, luego una escritura y su registro:
        resuelve y quedan las dos filas;
     4. **por la API:** un controlador de prueba (opción `controladores` de `crearAppDePruebas`) cuya ruta llama a
        `comoPlataforma` con la forma del caso 1 responde 500 `ERROR_INTERNO`, y no queda la academia;

     y, después de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, …)` resuelve, lee su propio contexto (criterio
     23) y no ve nada del caso. Prueba unitaria del envoltorio con la transacción falsa de P-38, dentro de `ejecutar`:
     (i) con una operación entregada y sin asentar, se llama a `asentar()` y la consulta falsa rechaza con un `Error` con
     `code: 'P2025'` y un texto centinela: la promesa de la operación rechaza con `ErrorTransaccionAbortada` (no con el
     error original), su texto completo (mensaje, `cause` y pila, con `util.inspect`) no contiene el centinela, y
     `exigirCompleta()` lanza `ErrorTransaccionAbortada`; (ii) lo mismo cuando a la operación se le encadenó un `.catch`
     antes de llamar a `asentar()` y la consulta falsa rechaza después (el `.catch` recibe el `ErrorTransaccionAbortada`);
     (iii) una operación llamada desde la continuación de otra, durante `asentar()`, cuya consulta
     rechaza: lo mismo; (iv) control: un rechazo antes de llamar a `asentar()` llega con su propio error y no marca
     (como en el criterio 154); (v) control: durante `asentar()`, una llamada con un argumento no admitido rechaza con
     `TypeError` y no marca (como en el 156); (vi) control: una operación que resuelve durante `asentar()` resuelve con su
     valor y no marca. Siguen pasando sin cambiar de resultado las pruebas protegidas anteriores, en especial las del
     envoltorio (`envoltorio-cola.test.ts`, `envoltorio-asentar.test.ts`), 149 a 158 (el caso 3 del 156 sigue rechazando
     con `ErrorTransaccionAbortada`), 22, 23, 24, 106 y 134. Si alguna cambiara, el test-writer o el backend se detienen e
     informan. _(crítico)_
161. **La causa de `ErrorTransaccionAbortada` nunca lleva el mensaje de Prisma ni los valores** _(ataque ronda 13, F2;
     **precisa** los criterios 149, 154 y 158 y P-36; decisión del orquestador, forma del especificador)_ _(precisado por el
     criterio 166, ataque ronda 15, O1: "el tipo del error original (de una lista cerrada)" es la lista de P-42 con
     `ErrorDeBase` para cualquier otro error de la base; lo que no es de la base, con el `tipo` del criterio 165)_. Dado que, cuando
     la comprobación de la capa de puntos de guardado da `25P02`, la capa marcaba la transacción con el error de la
     escritura como causa, y que el registro del 500 (`FiltroErrores` con `{ err }` y pino, que serializa la `cause`)
     mostraba el mensaje de Prisma con los valores (`invalid input syntax for type inet: "DNI 44556677"`), entonces:
     - `ErrorTransaccionAbortada` nunca guarda como `cause` un error de Prisma, del adaptador ni de `pg`, ni un objeto que
       lleve su mensaje, su `meta`, su pila o su propia `cause`: su constructor reemplaza la causa que recibe por una
       **causa limpia** (`CausaLimpia`, P-42), un `Error` creado por AquaGestión cuyo mensaje es un texto fijo con, si se
       conocen, el tipo del error original (de una lista cerrada), el código de Prisma, el SQLSTATE y el nombre de la
       operación; con `code` igual al SQLSTATE (así `codigoDeErrorDeBase(error.cause)` lo sigue leyendo) y sin `cause` ni
       `meta`. Si la causa recibida ya es una `CausaLimpia`, la conserva;
     - vale para todos los caminos que la crean: la capa de puntos de guardado (`exigirSana`, criterio 158),
       `comprobarTransaccionViva` (149 a 151), el envoltorio (154, 156 y 160) y `enPlataforma` (150);
     - lo demás de P-36 no cambia: la clase, el estado 500 `ERROR_INTERNO`, el mensaje genérico en la respuesta, `motivo`
       y quiénes la lanzan; la causa de una operación incompleta o tardía sigue nombrando la operación (las protegidas de
       los criterios 154 y 156 buscan ese nombre).

     Prueba unitaria (P-42): `new ErrorTransaccionAbortada({ cause })` con una causa falsa con forma de error de Prisma
     (`name: 'PrismaClientKnownRequestError'`, `code: 'P2007'`, un mensaje y una pila con `DNI 44556677`, y `meta:
     { modelName: 'Auditoria', driverAdapterError: { cause: { originalCode: '22P02', originalMessage: '… "DNI 44556677"'
     } } }`): `util.inspect(error, { depth: null, showHidden: true })` y `JSON.stringify` de las propiedades propias del
     error y de su causa no contienen `44556677`; `error.cause` es una `CausaLimpia`, sin `cause` ni `meta`;
     `codigoDeErrorDeBase(error.cause)` es `'22P02'`; y con una `CausaLimpia` como causa, `error.cause` es esa misma.
     Pruebas de integración con la API de pruebas y las academias A y B: (1) **reproducción** en `conAcademia(A, …)`:
     `try { await tx.cliente.auditoria.create({ data: { …, ip: 'DNI 44556677' } }) } catch {}` y devuelve (orientativo; la
     forma de `data` depende del modelo): rechaza con `ErrorTransaccionAbortada` cuyo texto completo (mensaje, `cause` y
     pilas, con `util.inspect` a toda profundidad) no contiene `44556677`, y `codigoDeErrorDeBase(error.cause)` es `'22P02'`
     o `'25P02'`; en `comoPlataforma`, lo mismo con `tx.cliente.auditoriaPlataforma.create`; (2) **por la comprobación de
     la marca:** `` try { await tx.cliente.$executeRaw`SELECT ${'DNI 44556677'}::inet` } catch {} `` y devuelve: lo mismo;
     (3) **por la API:** un controlador de prueba con el caso (1), con el registro de la app capturado (`destinoRegistro`,
     nivel `info`): responde 500 `ERROR_INTERNO`, ningún registro contiene `44556677` ni `invalid input syntax` y alguno de
     nivel `warn` o `error` dice que la transacción quedó abortada (como en el criterio 149). Con el código de `8f29106`,
     (1) y (3) mostraban el valor. Siguen pasando sin cambiar de resultado las protegidas de los criterios 149 a 158.
     _(crítico)_
162. **El registro técnico de un error de Prisma o de la base no lleva mensajes, valores ni datos** _(ataque ronda 13, O1;
     **precisa** los criterios 149 y 157 y P-40; decisión del orquestador, forma del especificador; RNF-05 y Ley 29733)_
     _(precisado por el criterio 163, ataque ronda 14, F1: "las líneas de marco de la pila" se leen solo **después** de
     quitar del `stack` el encabezado exacto `nombre: mensaje`; si el `stack` no empieza con ese encabezado, o `name`,
     `message` o `stack` no son cadenas o leerlos lanza, no hay `pila`; vale en cada nivel de la cadena de causas)_
     _(**ampliado** por el criterio 165, ataque ronda 15, F1: la segunda viñeta ya no mira solo `cause` y `errors`: los
     errores de la base se buscan en todo el grafo del error (propiedades propias, enumerables o no, y enumerables
     heredadas, con topes y falla cerrada); el `Error` que los lleva se registra con `tipo` de nombre de clase verificado,
     `mensaje` y `pila` solo si no copian el mensaje de la base, `causa`, `errores` y `erroresDeLaBase`, nunca otras
     propiedades; y `mensajeSeguro` resume también ese caso. Y **precisado** por el criterio 166, O1: el `tipo` de un error
     de la base sale de la lista cerrada de P-42, con `ErrorDeBase` para lo demás)_ _(precisado por los criterios 167 y
     168, ataque ronda 16: la búsqueda tiene costo acotado (hojas binarias, falla cerrada por `length`, corte de la
     enumeración) y lee `cause` y `errors` por su nombre en cada objeto visitado; una `cause` función es falla cerrada)_.
     Dado que el filtro de errores (500) y el manejador de rechazos registran el error tal cual, y que los mensajes de
     Prisma pueden llevar los argumentos de la consulta (`PrismaClientValidationError` muestra el `data` completo; un P2007
     o un `22P02` muestran el valor rechazado: un DNI, el token del QR o, desde las historias siguientes, datos médicos),
     entonces:
     - `errorParaRegistro(error)` (P-42) convierte un error en lo que se registra:
       - un **error de Prisma o de la base** (`esErrorDeBase`, P-42) que no sea una `CausaLimpia` se convierte en un objeto
         plano con solo: `tipo` (de una lista cerrada), `codigoPrisma` (si cumple `^P\d{4}$`), `sqlstate` (el de
         `codigoDeErrorDeBase`), `codigoDeSistema` (por ejemplo `ECONNREFUSED`, si cumple `^E[A-Z0-9_]+$`), `modelo` (de
         `meta.modelName`, solo si es uno de los modelos del esquema) y `pila` (solo las líneas de marco de la pila, las que
         empiezan con espacios y `at `). Nunca el mensaje, el `meta` (salvo el modelo), la `cause` sin limpiar, las líneas
         de la pila que no son marcos (Prisma pone ahí el código de la llamada con los argumentos) ni otras propiedades;
       - un `Error` que no es de la base y en cuya cadena de causas (`cause`, hasta 10 niveles y sin seguir ciclos; también
         los `errors` de un `AggregateError`) hay un error de la base sin limpiar se convierte en un objeto plano con su
         `tipo` (el `name`), su `mensaje`, su `pila` y su `causa` convertida de la misma forma;
       - cualquier otro `Error` (incluida una `CausaLimpia` y un `ErrorTransaccionAbortada` del criterio 161) se devuelve
         tal cual: el registro de hoy no cambia (las protegidas del filtro y del criterio 157 esperan el mismo objeto);
       - un valor que no es un `Error` se convierte en `{ tipo: typeof valor }`, nunca su valor (como el criterio 157);
     - la usan: `FiltroErrores` en las dos ramas que registran un 5xx (`{ err: errorParaRegistro(excepcion) }`); el
       manejador de rechazos (P-40: `{ err: errorParaRegistro(motivo) }` para un `Error`; `{ tipo }` para lo demás, como
       hoy); `#registrarAbortada` (que ya registra solo el SQLSTATE y la operación; con el 161 lee la causa limpia); y los
       comandos y la semilla: `mensajeSeguro` (`backend/src/cli/mensaje-seguro.ts`), con un error de la base, devuelve un
       texto armado solo con los campos de `errorParaRegistro` sin la pila (por ejemplo, "error de la base
       (PrismaClientKnownRequestError, P2002, SQLSTATE 23505)"); con cualquier otro error, lo de hoy;
     - ningún otro lugar de `backend/src` registra o imprime un error de la base sin pasar por `errorParaRegistro` (lo
       revisa el revisor: `{ err`, `console.error`, `registro.error`, `registro.warn`), y el `PrismaClient` de `BaseDatos`
       y de `crearClienteDelDueno` no se configura con la opción `log` de errores, avisos ni consultas (hoy no la tiene);
     - no cambia lo que se responde al cliente (500 `ERROR_INTERNO` con el mensaje genérico) ni el nivel de los registros.

     Pruebas. Errores reales, provocados en `conAcademia(A, …)` sin atraparlos (la llamada rechaza con ese error, criterio
     22): (a) un `PrismaClientValidationError` con `tx.cliente.configuracion.create({ data: { clave: 'prueba_r13_<n>',
     valor: {}, dni: '44556677', alergias: 'penicilina-r13' } })` (con un campo que el modelo no tiene; orientativo);
     (b) la escritura de `ip: 'DNI 44556677'` en `auditoria` por el delegado (Prisma la reporta con P2007 o con el SQLSTATE
     `22P02`; la prueba acepta cualquiera de los dos y exige el que corresponda en el resultado); (c)
     `` tx.cliente.$executeRaw`SELECT ${'DNI 44556677'}::inet` `` (`22P02`). Para cada uno: `esErrorDeBase` es verdadero;
     `util.inspect(errorParaRegistro(error), { depth: null })` y su `JSON.stringify` no contienen `44556677`,
     `penicilina-r13`, `alergias` ni `invalid input syntax`, y contienen el `tipo` y el `codigoPrisma` o el `sqlstate`. Un
     `Error` propio con uno de ellos como `cause` da un objeto con su mensaje y la causa limpia; un `Error('boom')` sin
     causa de la base da el mismo objeto. Por la API, con el registro de la app capturado (`destinoRegistro`, nivel
     `info`): un controlador de prueba con una ruta por cada error (a), (b) y (c) responde 500 `ERROR_INTERNO`, hay un
     registro de nivel `error` con el `tipo` y el código, y ningún registro contiene `44556677`, `penicilina-r13` ni
     `invalid input syntax`. Unitaria de `crearManejadorDeRechazos` (P-40) con el error (a): `registro.error` se llama con
     `{ err: X }` y `util.inspect(X, { depth: null })` no contiene `44556677` ni `penicilina-r13`. Unitaria de
     `mensajeSeguro` con un error con forma de error de Prisma (`name: 'PrismaClientKnownRequestError'`, `code: 'P2002'`,
     mensaje con `44556677`): el texto contiene `P2002` y no `44556677`. Con el código de `8f29106`, el registro de la API
     y el del manejador mostraban los valores. Siguen pasando sin cambiar de resultado las protegidas del filtro de errores
     (`filtro-errores.test.ts`), del criterio 157 (unitaria y proceso hijo), de `mensajeSeguro` y de los criterios 35, 46 y
     149. _(crítico)_

### W. Correcciones del ataque adversarial, ronda 14

Criterios agregados tras la ronda 14 del ataque (12/11/2026, sobre el commit `623c15b`). La ronda encontró una falla media
(F1: la `pila` que `errorParaRegistro` conserva de un error de la base se filtraba línea por línea sobre el `stack` completo,
que empieza con `nombre: mensaje`; una línea del mensaje que empieza con espacios y `at ` pasaba como marco y el valor salía
en el registro) y dos observaciones (O1: el riesgo aceptado "Promesa descartada que escapa al lint" describía mal el caso
habitual; O2: una función `async` pasada a `process.nextTick` no la ve ninguna regla de lint). Son decisiones técnicas del
orquestador (F1, O1 y O2) y del especificador (forma del encabezado con mensaje vacío y de la ampliación de la regla), no
reglas de negocio nuevas. La O1 no lleva criterio: corrige el texto del riesgo aceptado (sin mecanismo en ejecución, por las
mismas razones por las que la ronda 13 descartó la F1 (c)) y agrega una nota para el revisor en el plan (sección 26). Donde
un criterio amplía o precisa uno anterior lo dice, y el anterior queda marcado "(… ataque ronda 14)", sin borrar su texto.
Contrato: ampliación de P-41 y precisión de P-42. Todos son _(crítico)_.

163. **La `pila` que se registra de un error de la base empieza después del encabezado `nombre: mensaje`** _(ataque ronda
     14, F1; **precisa** el criterio 162 y P-42; decisión del orquestador, forma del encabezado con mensaje vacío del
     especificador)_ _(precisado por el criterio 165, ataque ronda 15: la misma regla da desde ahora la `pila` de cada `Error`
     que no es de la base dentro del objeto limpio, que además se omite si su `message` o su `stack` contienen el mensaje de
     un error de la base encontrado o si ese mensaje no se puede verificar; la viñeta "no cambia: un `Error` que no es de la
     base se sigue registrando con su `mensaje` y su `pila` completos" vale solo cuando no lleva ningún error de la base en
     su grafo)_. Dado que `errorParaRegistro` tomaba como marcos todas las líneas del `stack` que empiezan con espacios y
     `at `, que el `stack` empieza con `nombre: mensaje`, y que el mensaje puede llevar líneas con esa forma (PostgreSQL
     repite el valor tal cual en `22P02`, `22007`, `22008`, `22003` o un valor de enum inválido; Prisma muestra las claves de
     un `Json` sin comillas en un error de validación), así que el valor salía en `pila` (reproducido con
     `` $queryRaw`SELECT ${'15/03/2010\n    at DNI 44556677 alergia penicilina-r14'}::date` ``, con `configuracion.create`
     con `valor: { 'at nacimiento': '44556677', alergias: 'penicilina-r14' }` y con `auditoria.create` con
     `ip: 'x\n    at 44556677'`), entonces:
     - la `pila` de un error de la base (la rama "error de Prisma o de la base" del criterio 162) se obtiene así: se leen
       `name`, `message` y `stack` sin dejar que un getter lance; el **encabezado** es `` `${name}: ${message}` `` o, si
       `message` es la cadena vacía, `name` solo (así lo escribe V8); si `stack` empieza con ese encabezado exacto
       (comparación de la parte inicial por igualdad de cadenas, con la longitud del encabezado; nunca una expresión
       regular ni un patrón construido con el mensaje) y lo que sigue está vacío o empieza con `\n`, se quita el encabezado
       y **solo en lo que sigue** se conservan las líneas de marco (las que empiezan con espacios y `at `), con el máximo
       de marcos de hoy;
     - si el `stack` no empieza con el encabezado exacto, si lo que sigue al encabezado no empieza con `\n`, si `name`,
       `message` o `stack` no son cadenas, o si leer alguno lanza, se omite `pila` (falla cerrada: se pierde el
       diagnóstico, nunca se muestra el mensaje). Lo demás del objeto limpio (`tipo`, `codigoPrisma`, `sqlstate`,
       `codigoDeSistema`, `modelo`) se sigue registrando;
     - _(precisión del orquestador, ronda 14)_ si el `stack` empieza con el encabezado exacto pero en lo que sigue no queda
       ninguna línea de marco (lo que sigue está vacío o ninguna de sus líneas empieza con espacios y `at `), se omite
       `pila`: el objeto limpio no tiene la propiedad (no es la cadena vacía ni `undefined` explícito que aparezca en
       `JSON.stringify`). Ejemplo, junto a (u1): con `stack` igual al encabezado solo, o al encabezado seguido de
       `'\nalgo sin marcos'`, el resultado no tiene `pila` y conserva `tipo` y `codigoPrisma`;
     - vale igual en cada nivel de la cadena de causas (`cause` y `errors`, hasta 10 niveles): todo error de la base que
       `errorParaRegistro` convierte a su forma limpia, sea el error recibido o una causa de un `Error` propio, obtiene su
       `pila` de esta forma; y en cualquier otro lugar de `backend/src` que conserve marcos de la pila de un error de la base;
     - no cambia: un `Error` que no es de la base se sigue registrando con su `mensaje` y su `pila` completos (criterio 162;
       riesgo aceptado "Mensajes propios que copian el de Prisma"), la `CausaLimpia` (mensaje fijo), `mensajeSeguro` (no usa
       la pila), lo que se responde al cliente y el nivel de los registros.

     Pruebas unitarias (P-42), con errores falsos con forma de error de Prisma (`name: 'PrismaClientKnownRequestError'`,
     `code: 'P2007'`) y un mensaje `'valor inválido\n    at DNI 44556677 alergia penicilina-r14'`: (u1) con `stack` igual al
     encabezado seguido de `\n    at f (/repo/backend/src/f.ts:1:1)\n    at g (/repo/backend/src/g.ts:2:2)`, `pila` es
     exactamente esos dos marcos; (u2) con un `stack` alterado que no empieza con el encabezado (`'Otro: algo\n    at DNI
     44556677 alergia penicilina-r14\n    at f (…)'`), el resultado no tiene `pila`; (u3) con el encabezado seguido de
     `' extra\n    at DNI 44556677'` (no sigue un salto de línea), no tiene `pila`; (u4) con `message` vacío y `stack`
     `'PrismaClientKnownRequestError\n    at f (…)'`, `pila` es ese marco; (u5) con `stack`, `message` o `name` que no son
     cadenas, o con un getter de cualquiera de los tres que lanza: no lanza, no tiene `pila` y conserva `tipo` y
     `codigoPrisma`; (u6) un `Error` propio con el error de (u2) como `cause`, y un `AggregateError` con él en `errors`: la
     causa convertida no tiene `pila` y nada contiene los valores. En todos, `util.inspect(resultado, { depth: null })` y
     `JSON.stringify(resultado)` no contienen `44556677` ni `penicilina-r14`. Pruebas de integración con la API de pruebas y la
     academia A; errores reales provocados en `conAcademia(A, …)` sin atraparlos (la llamada rechaza con ese error,
     criterio 22): (a) `` tx.cliente.$queryRaw`SELECT ${'15/03/2010\n    at DNI 44556677 alergia penicilina-r14'}::date` ``
     (SQLSTATE `22007` o `22008`, según el servidor; la prueba acepta los dos y exige el que corresponda en el resultado);
     (b) `tx.cliente.configuracion.create` con `valor: { 'at nacimiento': '44556677', alergias: 'penicilina-r14' }` y lo
     que haga falta para que Prisma rechace con un `PrismaClientValidationError` que muestre el `valor` (orientativo: un
     campo que el modelo no tiene, como en el caso (a) del criterio 162); (c) `tx.cliente.auditoria.create` con
     `ip: 'x\n    at 44556677'` (P2007 o `22P02`; la prueba acepta cualquiera de los dos). Para cada uno, la prueba
     comprueba primero que el ataque se reproduce (el `stack` del error tiene una línea que empieza con espacios y `at ` y
     contiene `44556677`; si no, el test-writer se detiene e informa) y después: `util.inspect(errorParaRegistro(error),
     { depth: null })` y su `JSON.stringify` no contienen `44556677` ni `penicilina-r14` y contienen el `tipo` (y el
     `codigoPrisma` o el `sqlstate` si el error los tiene); lo mismo con un `Error` propio que lo lleva como `cause`. Por la
     API, con el registro de la app capturado (`destinoRegistro`, nivel `info`): un controlador de prueba con una ruta por
     cada error (a), (b) y (c) responde 500 `ERROR_INTERNO`, hay un registro de nivel `error` con el `tipo`, y ningún
     registro contiene `44556677` ni `penicilina-r14`. Unitaria de `crearManejadorDeRechazos` (P-40) con el error (c):
     `util.inspect` de lo que recibe `registro.error` no contiene `44556677`. Con el código de `623c15b`, (u1), (u2), (u3),
     (u6), (a), (b) y (c) mostraban el valor en `pila`. Siguen pasando sin cambiar de resultado las protegidas de los criterios
     161 y 162 (`registro-de-errores.test.ts`, `registro-sin-datos.test.ts`, `rechazos-ronda13.test.ts`,
     `mensaje-seguro-ronda13.test.ts`; la pila falsa de esas pruebas empieza con el encabezado exacto, así que sigue
     teniendo sus marcos), del filtro de errores y del criterio 157. Si alguna cambiara, el test-writer o el backend se
     detienen e informan. _(crítico)_
164. **Una función `async` pasada a `process.nextTick`, `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask` no
     pasa el lint** _(ataque ronda 14, O2; **amplía** el criterio 159 y P-41; decisión del orquestador, forma del
     especificador)_. Dado que `process.nextTick(async () => { … })` no da error con el lint con tipos (su parámetro es
     `Function`, y `@typescript-eslint/no-misused-promises` no lo revisa), que la regla propia del criterio 159 solo mira
     `void` y la llamada directa, y que una función así lanzada dentro de `trabajo` puede rechazar sin que nadie lo vea (si
     rechaza mientras `trabajo` sigue en curso, nada marca la transacción: riesgo aceptado "Promesa descartada que escapa al
     lint"), entonces:
     - la regla propia `aquagestion-promesas/sin-promesas-descartadas` (sin tipos, en el lint normal y en el paso
       protegido, en `ARCHIVOS_DE_CODIGO` salvo las pruebas y el cliente generado, como en el 159) falla además con
       (iii) toda llamada (`CallExpression`, también dentro de una `ChainExpression` y en cualquier posición, no solo como
       sentencia) a una de esas funciones con al menos un argumento que es una función `async` escrita en el lugar (flecha
       o expresión de función con `async: true`). "Una de esas funciones" es: un identificador llamado `nextTick`,
       `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask` (también importado de `node:timers` o desestructurado
       de `process`), o un acceso a miembro cuya propiedad tiene uno de esos nombres, con punto o con corchetes y una cadena
       literal o una plantilla sin expresiones, cualquiera que sea el objeto (`process.nextTick`, `globalThis.setTimeout`,
       `timers.setImmediate`, `process['nextTick']`, `process?.nextTick`);
     - _(precisión del especificador)_ en (ii) y (iii), la regla mira a través de los envoltorios de tipos de TypeScript
       (`as`, `satisfies`, `!` y `<T>`, también anidados): fallan `setTimeout((async () => { … }) as () => void, 0)` y
       `((async () => { … })() as unknown);` como sentencia. Los paréntesis no forman nodo y ya se ven;
     - _(precisión del orquestador, ronda 14)_ en (iii), lo anterior vale también para el `callee`: antes de reconocer el
       identificador o el acceso a miembro, la regla quita del `callee` los envoltorios de tipos (también anidados) y los
       paréntesis, igual que en (ii). Falla, por ejemplo, `(process.nextTick as typeof process.nextTick)(async () => { … })`,
       y también `(setTimeout as typeof setTimeout)(async () => { … }, 0)` y `process.nextTick!(async () => { … })`;
     - en el paso protegido ningún comentario la apaga (criterio 96);
     - siguen pasando: esas funciones con una función que no es `async` (`process.nextTick(() => { … })`,
       `setTimeout(function () { … }, 0)`, `setImmediate(resolver)`, `queueMicrotask(() => hacer().catch(fn))`), y una
       función `async` pasada a cualquier otra función (`await Promise.all(lista.map(async (x) => …))`; las funciones que
       esperan un retorno `void` ya las revisa `no-misused-promises` con tipos en el lint normal);
     - no aplica al frontend, a `backend/test/`, a las pruebas de `backend/src/` ni a `e2e/` (como el 159);
     - el código actual pasa (el `setImmediate` de `asentar()` recibe una función que no es `async`); si la regla señala
       otro lugar, el backend lo corrige si es una función `async` pasada de verdad, o se detiene e informa;
     - límite (riesgo aceptado "Promesa descartada que escapa al lint"): la regla no ve una función `async` con nombre
       pasada por referencia (`process.nextTick(hacer)` con `async function hacer`), un alias (`const nt =
       process.nextTick; nt(async () => …)`), ni `.call`, `.apply` o `Reflect.apply` sobre esas funciones.

     Prueba de la configuración de lint (con la clase `ESLint`, como las de los criterios 96 y 159). Con
     `eslint.protegido.config.mjs` y `allowInlineConfig: false`, en `.ts`, `.js` y `.mjs` de `backend/src/modulos/ejemplo/`,
     dan error de `aquagestion-promesas/sin-promesas-descartadas`: `process.nextTick(async () => { await x; });`,
     `process.nextTick(async function () { await x; });`, `setImmediate(async () => { … });`,
     `setTimeout(async () => { … }, 0);`, `setInterval(async () => { … }, 10);`, `queueMicrotask(async () => { … });`,
     `globalThis.queueMicrotask(async () => { … });`, `process['nextTick'](async () => { … });`,
     `process?.nextTick(async () => { … });`, `const { nextTick } = process; nextTick(async () => { … });` y
     `const t = setTimeout(async () => { … }, 0);` (la llamada no es una sentencia), también precedidos de
     `// eslint-disable-next-line aquagestion-promesas/sin-promesas-descartadas` y de `/* eslint-disable */`; en `.ts`,
     también `setTimeout((async () => { … }) as () => void, 0);` y `((async () => { … })() as unknown);`. No dan error de la
     regla propia: `process.nextTick(() => { hacer().catch(fn); });`, `setTimeout(function () { return 1; }, 0);`,
     `setImmediate(resolver);`, `queueMicrotask(() => undefined);`, `await Promise.all(lista.map(async (x) => x));` ni
     `otra(async () => 1);`. Con `eslint.config.mjs` (con tipos), en `backend/src/modulos/ejemplo/ejemplo.service.ts`, dan
     error de la regla propia `process.nextTick(async () => { await tx.cliente.configuracion.update(…); await
     auditoria.registrarEnAcademia(tx, …); });` y `setImmediate(async () => { … });`. Un archivo `*.test.ts` de
     `backend/src/` con `process.nextTick(async () => { … })` no da error de la regla propia, y uno de `frontend/src/` con
     `setTimeout(async () => { … }, 0)` tampoco. Y `npm run lint` pasa sobre el repositorio (lo confirma el tester). Con el
     código de `623c15b`, las formas con `process.nextTick` no daban error en ningún paso. Siguen pasando sin cambiar de
     resultado las pruebas protegidas del criterio 159 (`eslint/regla-promesas-descartadas-ronda13.test.mjs`) y del 96 (la
     regla propia mantiene su identificador y no es de `js.configs.recommended` ni de `typescript-eslint`). Si alguna
     cambiara, el test-writer o el backend se detienen e informan. _(crítico)_

### X. Correcciones del ataque adversarial, ronda 15

Criterios agregados tras la ronda 15 del ataque (12/11/2026, sobre el commit `6a74044`). La ronda encontró una falla media
(F1: el patrón habitual de NestJS `catch (error) { throw new InternalServerErrorException(error); }`, y
`new HttpException(error, 503)` y las demás excepciones de 5xx, guarda el error de Prisma entero en `response` de la
excepción y Nest copia su mensaje al `message` de la excepción; `errorParaRegistro` solo buscaba errores de la base en `cause`
y `errors`, devolvía la excepción tal cual y pino serializaba `message`, `stack` y `response` completo, con
`meta.driverAdapterError.cause.originalMessage`) y tres observaciones (O1: el `tipo` de un error de la base no salía de la
lista cerrada que pide P-42; O2: `SELECT '44556677'::money` en `$queryRaw` rechaza con un `Error` común de `decimal.js` con el
valor en el mensaje; y cinco formas de pasar una función `async` a un temporizador o descartarla que ninguna regla de lint
ve). Son decisiones técnicas del orquestador (F1: corrección de fondo con la búsqueda en todo el grafo del error; O1; O2;
las formas de lint) y del especificador (forma de la búsqueda, topes, regla de `mensaje` y `pila` y `tipo` de los errores
que no son de la base), no reglas de negocio nuevas. La O2 no lleva criterio: es una regla del plan para todas las historias
(sección 27) y un riesgo aceptado ("Tipo `money` en consultas"). Las formas de lint no llevan criterio: amplían el riesgo
aceptado "Promesa descartada que escapa al lint". Donde un criterio amplía o precisa uno anterior lo dice, y el anterior
queda marcado "(… ataque ronda 15)", sin borrar su texto. Contrato: precisión de P-42 (firmas sin cambios). Todos son
_(crítico)_.

165. **Un error de la base guardado en cualquier propiedad de otro error no llega al registro** _(ataque ronda 15, F1;
     **amplía** el criterio 162 (su segunda viñeta buscaba solo en `cause` y `errors`); **precisa** el 163 (la `pila` de
     los `Error` que no son de la base dentro del objeto limpio) y el 157; P-42; decisión del orquestador, forma de la
     búsqueda, de los topes y de la regla de `mensaje` del especificador; RNF-05 y Ley 29733)_ _(**precisado** por el
     criterio 167, ataque ronda 16, F1: los topes se aplican sin listar de más: los binarios (`Buffer`, arreglos tipados,
     `DataView`, `ArrayBuffer`, `SharedArrayBuffer`) son hojas, un objeto con `length` numérico mayor que 100 es falla
     cerrada sin listar sus claves, y la enumeración se corta al pasar el tope; y **ampliado** por el criterio 168, O1: en
     cada objeto visitado se leen además `cause` y `errors` por su nombre, también como getters heredados, y una `cause` que
     es una función es falla cerrada sin llamarla)_. Dado que el patrón habitual de
     NestJS `catch (error) { throw new InternalServerErrorException(error); }` (también `new HttpException(error, 503)`,
     `new ServiceUnavailableException(error)` y las demás excepciones de 5xx) deja el error de Prisma entero en `response`
     de la excepción, que Nest copia `response.message` al `message` de la excepción, que `errorParaRegistro` no lo
     reconocía (no es un error de la base, y `cause` y `errors` no lo llevan) y lo devolvía tal cual, y que pino serializa
     `message`, `stack` (con el mensaje en el encabezado) y `response` completo (reproducido por la API: un registro de nivel
     50 con `DNI 44556677 alergia penicilina-r15`; y en unidad, también por el manejador de rechazos), entonces:
     - **búsqueda en todo el grafo:** con un `Error` que no es de la base ni una `CausaLimpia`, `errorParaRegistro` busca
       errores de la base (`esErrorDeBase`, P-42, sin contar las `CausaLimpia`) en todo lo que cuelga de él: el valor de
       cada propiedad propia, enumerable o no, con clave de texto o `Symbol` (las de `Reflect.ownKeys`), y de cada
       propiedad enumerable heredada (las que recorre `for…in`, que son las que serializa pino), cuando ese valor es un
       objeto (`typeof valor === 'object'` y no `null`; también arreglos). Cada valor se lee sin dejar que un getter lance
       (el que lanza se salta). La búsqueda entra en los objetos y en los `Error` que no son de la base, de nivel en nivel;
       no entra en un error de la base (se resume entero) ni en una `CausaLimpia`; un `WeakSet` evita volver a un objeto ya
       visto (ciclos). Se cubren así, entre otros, `response`, `options`, `cause`, `errors`, `meta`, `detalles`, una
       propiedad no enumerable, una con clave `Symbol` y un error de la base anidado en objetos;
     - **topes y falla cerrada:** la búsqueda visita como máximo objetos a 10 niveles del error recibido, 200 objetos en
       total y 100 claves por objeto. Si un tope se agota (queda por visitar un objeto que no es de la base a más de 10
       niveles, o más de 200 objetos, o un objeto tiene más de 100 claves) o si listar las claves de un objeto lanza (por
       ejemplo, un `Proxy`), el resultado es el objeto plano `{ tipo, truncado: true }` (con `tipo` como abajo) y, si la
       búsqueda ya encontró errores de la base, `erroresDeLaBase` con su forma limpia; sin `mensaje`, `pila`, `causa` ni
       `errores`. Ante la duda, se limpia;
     - **si no encuentra ninguno** (y ningún tope se agotó), devuelve el mismo `error`, como hoy (criterio 162): el registro
       de un `Error` común, de una `CausaLimpia` y de un `ErrorTransaccionAbortada` no cambia;
     - **si encuentra alguno,** devuelve un objeto plano nuevo, nunca el error ni una copia de sus propiedades. El error
       recibido y cada `Error` que no es de la base de su cadena de `cause` y `errors` se convierten en un objeto con
       **solo**:
       - `tipo`: su `name`, solo si es igual al `name` de su constructor (`error.constructor.name`, leído sin dejar que un
         getter lance) y cumple `^[A-Za-z][A-Za-z0-9]{0,63}$`; si no, `'Error'` (así, `InternalServerErrorException`,
         `HttpException`, `AggregateError` o `Error`; un `name` asignado a mano no sale);
       - `mensaje`: su `message`, solo si es una cadena, no contiene el mensaje de ninguno de los errores de la base
         encontrados y ninguno de esos mensajes lo contiene a él (comparación de cadenas con `includes`, en los dos
         sentidos). Con el patrón de Nest (`message` igual al de Prisma) no hay `mensaje`; con
         `new InternalServerErrorException('No se pudo', { cause: error })`, sí (`'No se pudo'`);
       - `pila`: la que da la regla del criterio 163 (después del encabezado exacto `nombre: mensaje`, solo las líneas de
         marco), solo si ni su `message` ni su `stack` contienen el mensaje de alguno de los errores de la base encontrados;
       - `causa` (de su `cause`) y `errores` (de su `errors`, si es un arreglo; hasta 10), cada uno convertido así: un error
         de la base, a su forma limpia (criterio 162, con la `pila` del 163 y el `tipo` del 166); una `CausaLimpia`, tal cual;
         un `Error` que no es de la base, con estas mismas reglas (un ciclo en la cadena da `{ tipo: 'truncado' }`);
         cualquier otro valor, `{ tipo: typeof valor }`, nunca su contenido (un objeto plano con datos en `cause` ya no
         sale);
       - y, **solo en el objeto del nivel superior,** `erroresDeLaBase`: la forma limpia de cada error de la base encontrado
         en el grafo que no quedó ya en `causa` o `errores` de algún nivel, en el orden en que se encontraron (hasta 10; si
         hay más, además `truncado: true`).

       Cada error de la base aparece una sola vez en el resultado (si está en `cause` y en `response`, sale en `causa`).
       Nunca salen `message` (salvo como `mensaje`, con la regla anterior), `stack` (salvo como `pila`), `response`,
       `options`, `status`, `meta` ni ninguna otra propiedad;
     - **"el mensaje de un error de la base encontrado"** es su `message` cuando es una cadena no vacía; un `message`
       vacío o `undefined` (por ejemplo, un objeto plano con la forma de la causa del adaptador) no cuenta. Si leer el
       `message` de alguno lanza, o es algo distinto de una cadena o `undefined`, no se puede verificar: ningún `Error` que
       no es de la base del resultado lleva `mensaje` ni `pila` (falla cerrada);
     - **dónde vale:** `errorParaRegistro` es el único punto, así que vale para las dos ramas de `FiltroErrores` que
       registran (`HttpException` de 5xx, que responde con su estado, y cualquier otra excepción, con 500), el manejador de
       rechazos (P-40) y el fallo al arrancar de `main.ts`, que no cambian;
     - **`mensajeSeguro`** (comandos y semilla): con un `Error` que no es de la base y para el que `errorParaRegistro` no
       devuelve el mismo objeto, el texto es el `mensaje` del objeto limpio si lo tiene; si no, el texto "error de la base
       (…)" del criterio 162 armado con el primer error de la base del resultado (en `causa` y `errores`, a lo hondo, y
       luego en `erroresDeLaBase`); y si no hay ninguno (tope agotado), `error sin detalles (<tipo>)`. Con un error de la
       base, con un `Error` sin errores de la base en su grafo y con lo que no es un `Error`, lo de hoy (después, como hoy,
       el reemplazo de secretos, la primera línea y el máximo de 300 caracteres);
     - no cambia: lo que se responde al cliente (`ERROR_INTERNO` con el mensaje genérico, con el estado de la excepción:
       500, 503…), el nivel de los registros, la forma limpia de un error de la base (salvo `tipo`, criterio 166) y el
       resultado de un `Error` común. Un `Error` propio con un error de la base como `cause` sigue dando `{ tipo, mensaje,
       pila, causa }` (lo exigen protegidas de los criterios 162 y 163), salvo que su mensaje copie el de la base; su
       `pila` pasa a ser solo los marcos (la protegida exige solo que sea una cadena).

     Pruebas unitarias (P-42), con las excepciones reales de `@nestjs/common` y un error falso con forma de error de Prisma
     (`base`: `name: 'PrismaClientKnownRequestError'`, `code: 'P2007'`, mensaje `'invalid input syntax for type inet: "DNI
     44556677 alergia penicilina-r15"'`, `stack` con ese encabezado exacto y dos marcos, `meta: { modelName: 'Auditoria',
     driverAdapterError: { cause: { originalCode: '22P02', originalMessage: <el mismo texto> } } }`). En cada caso,
     salvo los controles, el resultado no es el mismo objeto, no lanza, y no contienen `44556677`, `penicilina-r15` ni
     `invalid input syntax`: `util.inspect(resultado, { depth: null, showHidden: true })`, `JSON.stringify(resultado)` ni
     lo que escribe un `pino` con un destino en memoria y sus serializadores por defecto al registrar
     `{ err: resultado }` en nivel `error`; las claves del objeto de nivel superior están entre `tipo`, `mensaje`, `pila`,
     `causa`, `errores`, `erroresDeLaBase` y `truncado`; y, si el caso lleva `base` (salvo la cadena de 30 de (u12), que
     no llega a verlo), hay exactamente un objeto con `tipo: 'PrismaClientKnownRequestError'` y `codigoPrisma: 'P2007'`
     (como `objetosConTipo` de las utilidades de la ronda 14):
     (u1) **reproducción:** `new InternalServerErrorException(base)` (la prueba comprueba antes que `response` es `base` y
     que `message` contiene `44556677`; si no, se detiene e informa): `tipo: 'InternalServerErrorException'`, sin `mensaje`
     ni `pila`, `base` en `erroresDeLaBase`; (u2) `new HttpException(base, 503)` y `new ServiceUnavailableException(base)`:
     lo mismo, con su `tipo`; (u3) **anidado en objetos:** `new InternalServerErrorException({ detalle: { error: base } })`;
     (u4) **propiedad propia cualquiera:** `Object.assign(new Error('Fallo de prueba r15'), { detalle: base })`:
     `mensaje: 'Fallo de prueba r15'` y `pila` con solo líneas de marco; (u5) **no enumerable y con `Symbol`:** `base` en
     una propiedad definida con `Object.defineProperty(…, { value: base, enumerable: false })`, y en otra con clave
     `Symbol('r15')`; (u6) **heredada:** `class ConExtra extends Error {}`, `ConExtra.prototype.extra = base`,
     `new ConExtra('Fallo r15')`; (u7) **ciclo:** `const e = new Error('Fallo r15'); e.detalle = { vuelta: e, error: base }`;
     (u8) **control con `{ cause }`:** `new InternalServerErrorException('No se pudo', { cause: base })`: `mensaje: 'No se
     pudo'`, `causa` con la forma limpia de `base` y sin `erroresDeLaBase` (aunque `options` también lo lleva); (u9) **el
     mismo en dos lugares:** `new InternalServerErrorException(base, { cause: base })`: `base` una sola vez, en `causa`;
     sin `mensaje`; (u10) **intermedio:** `new Error('Fallo r15', { cause: new InternalServerErrorException(base) })`:
     `mensaje: 'Fallo r15'`, `causa` con `tipo: 'InternalServerErrorException'` sin `mensaje` ni `pila`; (u11) **copia
     parcial:** `new Error('invalid input syntax for type inet', { cause: base })` y
     `Object.assign(new Error(<el mensaje de base>), { detalle: base })`: sin `mensaje`; (u12) **topes:** una cadena de 30
     `Error` por `cause` con `base` al final, `Object.assign(new Error('grande r15'), { lista: Array.from({ length: 1000 },
     () => ({})) })` (sin `base`), un árbol de más de 200 objetos con menos de 100 claves cada uno (sin `base`), una propiedad
     cuyo getter devuelve cada vez un objeto nuevo con otro getter igual, y un `Proxy` cuyo `ownKeys` lanza como valor de una
     propiedad (estas dos, no enumerables, para que la serialización de la propia prueba no las recorra): no lanza,
     `truncado: true`, sin `mensaje` ni `pila`; (u13) **mensaje no verificable:**
     `Object.assign(new Error('Fallo r15'), { detalle: <base con un getter de message que lanza> })`: sin `mensaje` ni
     `pila`; (u14) **controles, el mismo objeto (`toBe`):** `new Error('boom')`, `new Error('x', { cause: new Error('y')
     })`, `Object.assign(new Error('x'), { detalle: { a: 1, b: [1, 2] } })`, un `Error` con un ciclo sin `base`,
     `new HttpException('detalle interno', 503)`, un `ErrorNegocio(500, …, { url: 'secreta' })`, una `CausaLimpia` y un
     `ErrorTransaccionAbortada` con `base` como causa. Unitaria de `crearManejadorDeRechazos` (P-40) con (u1) y con (u4):
     `registro.error` recibe `{ err: X }` y `X` cumple lo mismo. Unitaria de `mensajeSeguro`: con (u1), el texto contiene
     `P2007` y ninguno de los tres textos; con (u4), es `Fallo de prueba r15`; con la cadena de 30 de (u12), empieza con
     `error sin detalles`. Pruebas de integración con la API de pruebas y la academia A, con el error real que provoca
     `tx.cliente.auditoria.create` con `ip: 'DNI 44556677 alergia penicilina-r15'` en `conAcademia(A, …)` (P2007 o
     `22P02`; la prueba comprueba antes que su `message` contiene `44556677`; si no, se detiene e informa):
     `errorParaRegistro` con ese error dentro de (u1), (u2), (u8) y (u10) cumple lo mismo (el objeto de la base, una sola
     vez, con el `tipo` del error real y su `codigoPrisma` o su `sqlstate`, el que traiga); y por la API, con el registro de
     la app capturado (`destinoRegistro`, nivel `info`), un controlador de prueba con tres rutas que atrapan el rechazo de
     `conAcademia` y lanzan (a1) `new InternalServerErrorException(error)` (responde 500 `ERROR_INTERNO`), (a2) `new
     HttpException(error, 503)` (responde 503 `ERROR_INTERNO`) y (a3) el control `new InternalServerErrorException('No se
     pudo', { cause: error })` (500): ningún registro contiene `44556677`, `penicilina-r15` ni `invalid input syntax`, y hay
     un registro de nivel `error` cuyo `err.tipo` es el de la excepción y en cuyo `err` hay un objeto con el `tipo` del
     error de Prisma y su `codigoPrisma` o su `sqlstate`. Con el código de `6a74044`, (u1) a (u7), (u9) a (u13), el manejador,
     `mensajeSeguro` con (u1), (a1) y (a2) mostraban el valor. Siguen pasando sin cambiar de resultado las protegidas de los
     criterios 157 y 161 a 163 (`registro-de-errores.test.ts`, `registro-de-errores-ronda14.test.ts`,
     `registro-sin-datos.test.ts`, `registro-sin-datos-ronda14.test.ts`, `rechazos.test.ts`, `rechazos-ronda13.test.ts`,
     `rechazos-ronda14.test.ts`, `rechazos-proceso.test.ts`, `mensaje-seguro.test.ts`, `mensaje-seguro-ronda13.test.ts`) y
     las del filtro de errores. Si alguna cambiara, el test-writer o el backend se detienen e informan. _(crítico)_
166. **El `tipo` de un error de la base sale de una lista cerrada** _(ataque ronda 15, O1; **precisa** los criterios 161 y
     162 y P-42; decisión del orquestador)_. Dado que `datosSeguros` aceptaba como `tipo` cualquier `name` con forma de
     identificador (por ejemplo, `Dni44556677Alergia` con `code: 'P2007'`, o el `'error'` de `pg`), y que P-42 ya pedía una
     lista cerrada, entonces:
     - el `tipo` de la forma limpia de un error de la base (criterio 162), la propiedad `tipo` de una `CausaLimpia` y el
       tipo que aparece en su mensaje (criterio 161) son el `name` del error solo si es, con comparación exacta (sin pasar
       a minúsculas ni recortar), uno de: `PrismaClientKnownRequestError`, `PrismaClientUnknownRequestError`,
       `PrismaClientValidationError`, `PrismaClientInitializationError`, `PrismaClientRustPanicError`,
       `DriverAdapterError`, `DatabaseError` o `CausaLimpia`; si no, `ErrorDeBase` (también con un `name` que empieza por
       `PrismaClient` y no está en la lista, o con un objeto plano);
     - `causaLimpia` con algo que no es un error de la base (un `TypeError` de una llamada, un `Error` común) usa el
       `tipo` de los errores que no son de la base del criterio 165 (el `name` solo si es el de su constructor y cumple el
       patrón; si no, `Error`); sin causa (`undefined` o `null`), como hoy;
     - no cambia lo demás de la forma limpia ni de la `CausaLimpia` (códigos, operación, circunstancia, `code`).

     Pruebas unitarias (P-42): (o1) `Object.assign(new Error('x'), { name: 'Dni44556677Alergia', code: 'P2007' })`:
     `errorParaRegistro` da `tipo: 'ErrorDeBase'` y `codigoPrisma: 'P2007'`; `causaLimpia` da `tipo: 'ErrorDeBase'`;
     `new ErrorTransaccionAbortada({ cause })` y `mensajeSeguro` con ese error; en ninguno de los cuatro, `util.inspect` a
     toda profundidad con `showHidden`, `JSON.stringify` de las propiedades propias ni el texto contienen `44556677`; (o2)
     con `name: 'error'` y `code: '22P02'` (forma de `pg`): `tipo: 'ErrorDeBase'` y `sqlstate: '22P02'`; (o3) con `name:
     'PrismaClientOtraCosa'` y `name: 'prismaclientknownrequesterror'` (con `code: 'P2002'`): `ErrorDeBase`; y un objeto
     plano `{ code: '22P02' }` en `causaLimpia` y como `cause` de un `Error` propio: `ErrorDeBase` (`errorParaRegistro` con
     el objeto plano solo sigue dando `{ tipo: 'object' }`, como hoy); (o4) las cinco clases reales de Prisma y errores con `name` `DriverAdapterError` y `DatabaseError`
     conservan su nombre en `errorParaRegistro` y en `causaLimpia`; (o5) `causaLimpia(new TypeError('x DNI 44556677'))`
     da `tipo: 'TypeError'` sin el valor, y `causaLimpia(Object.assign(new Error('x'), { name: 'Dni44556677' }))` (sin
     código: no es de la base) da `tipo: 'Error'` y su texto no contiene `44556677`. Con el código de `6a74044`, (o1), (o2)
     y (o5) daban el `name` como `tipo`. Siguen pasando sin cambiar de resultado las protegidas de los criterios 161 a 163
     (las que comparan `tipo` con `error.name` lo hacen solo con los `PrismaClient…` reales, que están en la lista). Si
     alguna cambiara (por ejemplo, porque un error real de Prisma 7 tiene un `name` que empieza por `PrismaClient` y no está
     en la lista), el test-writer o el backend se detienen e informan. _(crítico)_

### Y. Correcciones del ataque adversarial, ronda 16

Criterios agregados tras la ronda 16 del ataque (12/11/2026, sobre el commit `8b503d2`). La ronda encontró una falla media
(F1: el tope de 100 claves por objeto del criterio 165 no limitaba el trabajo, porque `clavesDe` juntaba todas las claves
antes de compararlas con el tope; un `Buffer`, un arreglo o un objeto `String` grandes en el grafo de cualquier `Error`
bloqueaban el proceso segundos y podían tumbarlo por falta de memoria) y una observación media-baja (O1: el serializador
de errores de pino lee `cause` por su nombre, también como getter heredado, y si es una función la llama; la búsqueda del
criterio 165 no la veía, y el riesgo aceptado "Errores de la base fuera del alcance de la búsqueda" era mayor de lo
descrito). Son decisiones técnicas del orquestador (F1: hojas binarias, falla cerrada por `length` y corte de la
enumeración; O1: `cause` y `errors` por su nombre y falla cerrada con una `cause` función) y del especificador (cómo se
reconocen las hojas, en qué objetos se leen `cause` y `errors`, `errors` como función, pruebas de tiempo y de memoria), no
reglas de negocio nuevas. Donde un criterio amplía o precisa uno anterior lo dice, y el anterior queda marcado
"(… ataque ronda 16)", sin borrar su texto. Contrato: precisión de P-42 (firmas sin cambios). Queda la pregunta técnica
R16-1 (contenido de un binario en el registro; "Preguntas abiertas"), que conviene decidir antes de escribir las pruebas
(T163). Todos son _(crítico)_.

167. **La búsqueda en el grafo del error tiene un costo acotado, sea cual sea el tamaño de los valores** _(ataque ronda 16,
     F1; **precisa** los topes del criterio 165 y P-42; decisión del orquestador, forma del especificador; disponibilidad de
     todas las academias (criterio 157) y RNF-05)_. Dado que `clavesDe` juntaba todas las claves de un objeto
     (`Reflect.ownKeys`, luego `for…in`, en un `Set`) y solo después las comparaba con el tope de 100, y que un `Buffer`, un
     `Uint8Array`, un arreglo denso o un objeto `String` grandes en el grafo de cualquier `Error`, aunque no lleve ningún
     error de la base, costaban segundos y cientos de MB (reproducido en unidad: `filtro.catch(new
     InternalServerErrorException('…', { cause: Object.assign(new Error('No se pudo subir el comprobante'), { archivo:
     Buffer.alloc(5 * 1024 * 1024) }) }))` bloqueó el event loop 6,9 s y usó 707 MB, y con `--max-old-space-size=256` el
     proceso cayó por falta de memoria; un arreglo de 2 millones de elementos, 1,8 s; un `new String` de 5 millones de
     caracteres, 7,3 s; pino solo, con el mismo error, 95 ms), y que hoy no se alcanza desde la API (cuerpo JSON de 100 KB
     como máximo) pero sí con los comprobantes de hasta 5 MB (HU-08) y `AlmacenArchivos` (D-19), o con librerías que guardan
     el cuerpo o el archivo en el error, entonces, en la búsqueda de `errorParaRegistro` (criterio 165):
     - **hojas binarias:** un valor para el que `ArrayBuffer.isView(valor)` es verdadero (un `Buffer`, cualquier arreglo
       tipado, un `DataView`) o que es un `ArrayBuffer` o un `SharedArrayBuffer` es una **hoja**: no es un error de la base,
       no se leen su `length` ni sus claves, no se entra en él y no cuenta para el tope de objetos. Se reconoce por la ranura
       interna del motor (`ArrayBuffer.isView` y `types.isAnyArrayBuffer` de `node:util`), nunca por `instanceof`, por el
       prototipo ni por `Symbol.toStringTag`: un objeto común con `[Symbol.toStringTag]: 'ArrayBuffer'`, uno creado con
       `Object.create(Uint8Array.prototype)` o un `Proxy` de un `Buffer` no son hojas y se recorren con las reglas de
       siempre. Si en el grafo no hay errores de la base y no se agota ningún tope, el resultado sigue siendo el mismo
       error (criterio 165) _(pendiente de la pregunta abierta R16-1: si se acepta su propuesta, este punto cambia antes de
       escribir las pruebas)_;
     - **objetos con `length` grande:** antes de listar las claves de un objeto que no es una hoja, se lee su `length` (sin
       dejar que un getter lance; el que lanza cuenta como sin `length`). Si es un `number` mayor que el tope de claves
       (100; también `Infinity`), la búsqueda falla cerrada sin listar sus claves: `{ tipo, truncado: true }` y, si ya
       encontró errores de la base, `erroresDeLaBase`, como el criterio 165. Así se cortan un arreglo (denso o disperso),
       un objeto `String` y cualquier objeto con forma de arreglo. Como los demás topes, se comprueba al ir a listar las
       claves de ese objeto, después de revisar todos los valores del objeto que lo contiene (un error de la base en una
       clave hermana se encuentra antes, sea cual sea el orden de las claves);
     - **corte de la enumeración:** para los demás objetos, primero `Reflect.ownKeys`; si da más claves que el tope, falla
       cerrada sin recorrer `for…in`. Si no, `for…in` agrega las enumerables heredadas y se corta en cuanto el número de
       claves distintas pasa del tope, que también es falla cerrada. El código no arma ninguna colección con más claves que
       el tope más una ni lee el valor de ninguna clave de un objeto que pasa del tope. (`Reflect.ownKeys` entrega la lista
       de las claves propias de una vez y `for…in` las junta dentro del motor antes de dar la primera: en JavaScript no hay
       forma de pedirlas por partes. Por eso se mira antes `length` y se deja `for…in` para el final; lo que queda es el
       riesgo aceptado "Objetos sin `length` con millones de claves".)
     - **no cambia:** los topes de 10 niveles, 200 objetos y 100 claves por objeto, cuándo se devuelve el mismo error, la
       forma del objeto convertido (`tipo`, `mensaje`, `pila`, `causa`, `errores`, `erroresDeLaBase`, `truncado`), la falla
       cerrada y `mensajeSeguro` (criterio 165).

     Pruebas unitarias (P-42), con el error falso `base16` (igual que `base` del criterio 165, con `penicilina-r16` en lugar
     de `penicilina-r15`). **Tiempo:** cada caso mide con `performance.now()` una sola llamada a `errorParaRegistro` (o a
     `mensajeSeguro`), después de una llamada de calentamiento con `new Error('calentamiento')` en la misma prueba; la
     construcción del valor grande queda fuera de la medida; el límite es **200 ms** (holgado: las reproducciones tardaban de
     1,8 a 7,3 s). Donde el resultado no es el mismo objeto, no contiene `44556677`, `penicilina-r16` ni `invalid input
     syntax` con `util.inspect` (`depth: null`, `showHidden: true`), `JSON.stringify` ni lo que escribe un `pino` con destino
     en memoria y sus serializadores por defecto al registrar `{ err: resultado }`:
     (t1) **reproducción:** `new InternalServerErrorException('No se pudo procesar el comprobante', { cause:
     Object.assign(new Error('No se pudo subir el comprobante'), { archivo: Buffer.alloc(5 * 1024 * 1024) }) })`: el mismo
     objeto (`toBe`) en menos de 200 ms; y `FiltroErrores` real con esa excepción (como en las pruebas del filtro de
     errores, con un `ArgumentsHost` falso y el registro en memoria) responde 500 `ERROR_INTERNO` y la llamada a `catch`
     termina en menos de **1000 ms** (incluye que pino escriba la excepción); (t2) **otras hojas:**
     `Object.assign(new Error('binarios r16'), { datos: new Uint8Array(5 * 1024 * 1024), crudo: new ArrayBuffer(5 * 1024 *
     1024), vista: new DataView(new ArrayBuffer(5 * 1024 * 1024)), compartido: new SharedArrayBuffer(5 * 1024 * 1024) })`:
     el mismo objeto en menos de 200 ms; (t3) **arreglo grande:** `Object.assign(new Error('lista r16'), { lista: new
     Array(2_000_000).fill(0) })` y con `new Array(2_000_000)` (disperso): `{ tipo: 'Error', truncado: true }` (sin otras
     claves) en menos de 200 ms; (t4) **`String` grande:** `Object.assign(new Error('texto r16'), { texto: new
     String('x'.repeat(5_000_000)) })`: `{ tipo: 'Error', truncado: true }` en menos de 200 ms; (t5) **muchas claves con
     nombre:** `Object.assign(new Error('mapa r16'), { mapa: <objeto plano con 500 000 claves propias `k0` … `k499999`> })`:
     `{ tipo: 'Error', truncado: true }` en menos de 200 ms; (t6) **base junto a un binario:** `Object.assign(new
     Error('Fallo r16'), { archivo: Buffer.alloc(5 * 1024 * 1024), detalle: base16 })`: no es el mismo objeto, `tipo:
     'Error'`, `mensaje: 'Fallo r16'`, sin `truncado`, `base16` exactamente una vez, en `erroresDeLaBase`, con su forma
     limpia (`tipo: 'PrismaClientKnownRequestError'`, `codigoPrisma: 'P2007'`), en menos de 200 ms; (t7) **base junto a un
     arreglo grande:** `Object.assign(new Error('r16'), { lista: new Array(2_000_000).fill(0), detalle: base16 })` (la lista
     antes que la base): `truncado: true`, sin `mensaje` ni `pila`, y `base16` en `erroresDeLaBase` con su forma limpia, en
     menos de 200 ms; (t8) **bordes** (cada valor como propiedad `valor` de un `Error` sin errores de la base): con
     `Array.from({ length: 50 }, () => ({}))` y con un objeto plano de 100 claves propias, el mismo objeto; con `Array.from({ length: 101 }, () => 0)`, con un objeto plano de 101 claves y con `{ length:
     101 }`, `truncado: true`; con `{ length: '5000000', a: 1 }` (no es un `number`), el mismo objeto; (t9) **falsas
     hojas:** `base16` dentro de `{ [Symbol.toStringTag]: 'ArrayBuffer', error: base16 }`, de un objeto creado con
     `Object.create(Uint8Array.prototype)` con la propiedad `error: base16` y de `new Proxy(Object.assign({}, { error: base16
     }), {})`, cada uno como propiedad de un `Error`: no es el mismo objeto y `base16` aparece en su forma limpia; y `new
     Proxy(Buffer.alloc(5 * 1024 * 1024), {})` como propiedad de un `Error`: `truncado: true` en menos de 200 ms (no es una
     hoja y su `length` pasa del tope); (t10) **`mensajeSeguro`:** con el `Error` interior de (t1), es `No se pudo subir el
     comprobante`; con el de (t3), empieza con `error sin detalles`; las dos en menos de 200 ms. **Memoria:** (t11) un
     proceso hijo (`process.execPath` con `--max-old-space-size=256 --import tsx` y un script de prueba en
     `backend/test/utilidades/`, nombre orientativo) ejecuta `errorParaRegistro` con (t1) (solo la excepción), (t3) y (t4)
     y escribe por la salida estándar si cada resultado es el mismo objeto o `truncado`: termina con código 0 y escribe lo
     esperado (si el módulo no carga con `tsx` en el hijo, el test-writer se detiene e informa). Con el código de
     `8b503d2`, (t1) a (t4), (t7) y la parte de `Proxy` de (t9) pasaban del límite de tiempo, (t6) daba `truncado` sin
     `mensaje` y en (t11) el hijo terminaba por falta de memoria; (t5) y (t8) pueden pasar ya (el tester los informa). Siguen
     pasando sin cambiar de resultado las protegidas de los criterios 157 y 161 a 166 (`registro-de-errores.test.ts`,
     `registro-de-errores-ronda14.test.ts`, `registro-de-errores-ronda15.test.ts` —en especial los casos (u12): la lista de
     1000 objetos, el árbol de más de 200, el getter infinito y el `Proxy` cuyo `ownKeys` lanza—,
     `registro-sin-datos*.test.ts`, `rechazos*.test.ts`, `mensaje-seguro*.test.ts`) y las del filtro de errores. Si alguna
     cambiara, el test-writer o el backend se detienen e informan. _(crítico)_
168. **`cause` y `errors` se leen siempre por su nombre, y una `cause` que es una función es falla cerrada** _(ataque ronda
     16, O1; **amplía** el criterio 165 (la búsqueda solo miraba las claves que lista) y **corrige** el riesgo aceptado
     "Errores de la base fuera del alcance de la búsqueda"; decisión del orquestador, forma del especificador; RNF-05 y Ley
     29733)_. Dado que el serializador de errores de pino (`pino-std-serializers`, `getErrorCause`; también el que usan
     pino-http y nestjs-pino) lee `err.cause` por su nombre, y si es una función la llama (estilo VError), agrega el mensaje
     y la pila de la causa al `message` y al `stack` registrados y lee `err.errors` por su nombre; y que la búsqueda del
     criterio 165 solo veía las claves propias y las enumerables heredadas, de modo que `class ErrorDeServicio extends Error
     { #origen; get cause() { return this.#origen; } }` con un error de Prisma, o `Object.assign(new Error('No se pudo
     guardar'), { cause: () => errorDePrisma })`, pasaban por `errorParaRegistro` sin cambios y pino registraba
     `"message":"No se pudo guardar: invalid input syntax for type inet: \"DNI 44556677 …\""`, entonces:
     - en **cada objeto que visita la búsqueda** (el error recibido y cada objeto en el que entra, sea o no un `Error`),
       además de las claves que lista, se leen `cause` y `errors` por su nombre (`Reflect.get`, sin dejar que un getter
       lance; incluye getters y propiedades heredadas, enumerables o no). Su valor se trata como el de cualquier otra clave:
       un error de la base se junta, un objeto se visita (con los topes), uno ya visto se salta, una hoja binaria (criterio
       167) no se recorre. Estas dos lecturas no cuentan para el tope de claves; un getter que lanza se salta, como en las
       demás claves;
     - si el valor de `cause` de un objeto visitado (leído por su nombre o como clave listada) es una **función**, la
       búsqueda falla cerrada: `{ tipo, truncado: true }` y, si ya encontró errores de la base, `erroresDeLaBase`; sin
       `mensaje`, `pila`, `causa` ni `errores`. La función **nunca se llama** (sin llamarla no se sabe qué devuelve, y pino
       sí la llamaría). Vale aunque la función devolviera algo inofensivo;
     - un `errors` que es una función no se llama ni se recorre, y no es falla cerrada (pino no la llama: solo recorre
       `errors` si es un arreglo);
     - **no cambia:** la conversión del criterio 165 (ya lee `cause` y `errors` por su nombre al armar `causa` y `errores`),
       los topes, el resultado de los errores sin errores de la base en su grafo (el mismo objeto) y `mensajeSeguro`, que con
       la falla cerrada da `error sin detalles (<tipo>)`.

     Pruebas unitarias (P-42), con `base16` del criterio 167 y las mismas comprobaciones de `util.inspect`,
     `JSON.stringify` y `pino` con destino en memoria. Donde una clase de prueba necesite un getter o un método `cause` que
     TypeScript no admite sobre la propiedad `cause` de `Error`, se define con `Object.defineProperty` sobre el prototipo
     (no enumerable), y el campo privado puede ser un `WeakMap`; el efecto es el mismo. (g1) **getter heredado:** una clase
     `ErrorDeServicio extends Error` que asigna `this.name = 'ErrorDeServicio'`, guarda el origen en un campo privado y
     define `cause` como getter en su prototipo; `new ErrorDeServicio('No se pudo guardar', base16)`. La prueba comprueba
     antes que el ataque se reproduce (`Reflect.ownKeys(e)` no incluye `'cause'`, `e.cause === base16` y un `pino` con
     destino en memoria que registra `{ err: e }` escribe `44556677`; si no, se detiene e informa). Resultado: no es el
     mismo objeto, `tipo: 'ErrorDeServicio'`, `mensaje: 'No se pudo guardar'` y `causa` con la forma limpia de `base16`;
     (g2) **`errors` heredado:** lo mismo con un getter `errors` en el prototipo que devuelve `[base16]`: `errores` con la
     forma limpia; (g3) **`cause` función propia:** `Object.assign(new Error('No se pudo guardar'), { cause: espia })`, con
     `espia` una función que cuenta sus llamadas y devuelve `base16` (comprobación previa: pino con el error original
     escribe `44556677`): resultado exactamente `{ tipo: 'Error', truncado: true }` y `espia` llamada 0 veces (también
     durante el registro con pino del resultado); (g4) **método `cause` en el prototipo** (estilo VError, devuelve
     `base16`): lo mismo que (g3); (g5) **anidados:** `new InternalServerErrorException('No se pudo', { cause: <(g1)> })`:
     `causa` con `tipo: 'ErrorDeServicio'` y, dentro, `causa` con la forma limpia de `base16`; `new Error('x', { cause:
     <(g3)> })` y `Object.assign(new Error('x'), { detalle: { cause: () => base16 } })` (un objeto que no es un `Error`):
     `truncado: true`, función no llamada; (g6) **controles:** un getter heredado `cause` que devuelve `new Error('otra')`,
     y un `Error` con `errors` función (sin `base16` en el grafo): el mismo objeto (`toBe`) y la función de `errors` no
     llamada; una `cause` función que devolvería `new Error('inofensivo')`: `truncado: true`, no llamada. Unitaria de
     `crearManejadorDeRechazos` (P-40) con (g1) y (g3): `registro.error` recibe `{ err: X }` y `X` cumple lo mismo.
     Unitaria de `mensajeSeguro`: con (g1), `No se pudo guardar`; con (g3), empieza con `error sin detalles`; ninguno
     contiene los tres textos. Pruebas de integración con la API de pruebas y la academia A, con el error real que provoca
     `tx.cliente.auditoria.create` con `ip: 'DNI 44556677 alergia penicilina-r16'` en `conAcademia(A, …)` (comprobación
     previa de que su `message` contiene `44556677`): `errorParaRegistro` con ese error dentro de (g1) y de (g3) cumple lo
     mismo; y por la API, con el registro de la app capturado (`destinoRegistro`, nivel `info`: es el registrador de
     nestjs-pino y pino-http), un controlador de prueba con dos rutas que atrapan el rechazo de `conAcademia` y lanzan (a4)
     `new ErrorDeServicio('No se pudo guardar', error)` y (a5) `Object.assign(new Error('No se pudo guardar'), { cause: ()
     => error })`: las dos responden 500 `ERROR_INTERNO`; ningún registro contiene `44556677`, `penicilina-r16` ni `invalid
     input syntax`; hay un registro de nivel `error` cuyo `err`, en (a4), lleva un objeto con el `tipo` del error de Prisma y
     su `codigoPrisma` o su `sqlstate` y, en (a5), tiene `truncado: true`. Con el código de `8b503d2`, (g1) a (g5), el
     manejador, `mensajeSeguro` con (g3), (a4) y (a5) mostraban el valor o llamaban a la función; (g6) con el getter que
     devuelve `new Error('otra')` y con `errors` función, y `mensajeSeguro` con (g1), pueden pasar ya (el tester los
     informa). Siguen pasando sin cambiar de resultado las protegidas de los criterios 157 y 161 a 166 (las mismas del
     criterio 167; en especial los controles (u14) de la ronda 15 y el error de `registro-de-errores.test.ts` con `cause`
     no enumerable). Si alguna cambiara, el test-writer o el backend se detienen e informan. _(crítico)_

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
- **Hosting con esquemas de extensiones (`cron`, `topology`, `tiger`)** _(ataque ronda 8)_: si solo contienen objetos de
  la extensión, la API atiende aunque la app tenga `USAGE` sobre ellos; si alguien crea una tabla propia dentro (por
  ejemplo, datos cargados después en un esquema de la extensión), la API y `db:crear` la ven y, con `USAGE` o algún
  privilegio para la app, rechazan (criterio 141).
- **URL con parámetros en la cadena de consulta** _(ataque ronda 8)_: `?sslmode=require` y `?options=…` siguen valiendo;
  `?user=…`, `?host=…` o `?database=…` detienen la API, `db:crear`, el hook, el comando y la semilla con un mensaje que
  nombra la variable y el parámetro (criterio 143).
- **Una función de contexto marcada `IMMUTABLE` "por rendimiento"** _(ataque ronda 9)_: la prueba de catálogo del
  criterio 144 falla; la forma recomendada para que la función se evalúe una vez por consulta es la subconsulta
  `(SELECT app_academia_actual())` del criterio 140, no cambiar su volatilidad.
- **Hosting o `ALTER DATABASE` con otra `client_encoding` o con `synchronous_commit = off`** _(ataque ronda 9)_: no
  afecta a la API ni a los comandos (criterios 146 y 147); sí a herramientas externas como `psql`.
- **Puerto de Docker cambiado en el `.env`** _(ataque ronda 9)_: si el responsable cambia el puerto en `DATABASE_URL` y
  no en `DATABASE_URL_APP`, `db:crear` se detiene y dice qué parte corregir (criterio 148), en lugar de dejar la API
  apuntando a otro servidor.
- **Duplicado esperado dentro de una transacción** _(ataque ronda 10)_: atrapar el error de la base y seguir no es
  posible (la transacción queda abortada) y desde el criterio 149 hace rechazar la operación. Un duplicado que se espera
  (idempotencia, nombre corto en uso) se resuelve con `INSERT … ON CONFLICT DO NOTHING RETURNING`, como
  `AcademiasService.crear`; `esViolacionDeUnicidad` sirve fuera de la transacción, sobre el rechazo de `conAcademia` o
  `comoPlataforma`, para responder 409 o reintentar con una transacción nueva (plan, nota O3 ampliada).
- **Superadmin que entra desde la red local por IPv6 de enlace local** _(ataque ronda 10)_: su IP llega con zona
  (`fe80::…%eth0`) y se audita sin ella (criterio 152); en producción, detrás del proxy del hosting, no ocurre.
- **Actualizar una lista en la que algunas filas ya no existen** _(ataque ronda 11)_: con `Promise.all` y el P2025
  atrapado por fila, las que existen se actualizan y las que no se ignoran (criterio 153); antes, las que venían detrás
  de una inexistente se perdían en silencio.
- **Bloqueo de transacción en el aforo y la caja** _(ataque ronda 11)_: con `$executeRaw` (criterio 155); con `$queryRaw`
  sin `::text`, la consulta rechaza aunque PostgreSQL ya haya tomado el bloqueo.
- **Auditoría encadenada sin `await`** _(ataque ronda 12)_: `x.create(…).then(() => registrar…)` o una función `async`
  lanzada con `void` dentro de `trabajo` se completan antes de confirmar (criterio 156); la forma recomendada sigue siendo
  `await` en cada paso. Si la cadena espera algo ajeno a la base, la operación puede rechazar (o, en el peor caso, perder
  esa escritura: riesgo aceptado), así que en las historias siguientes no se usa.
- **Escritura anidada que falla por una hija que no existe o no se ve** _(ataque ronda 12)_: rechaza con su error de
  Prisma y no deja nada propio (criterio 158); `trabajo` puede atraparla y seguir.
- **Actualizar `academias` desde `conAcademia`** _(ataque ronda 12, O1)_: la política de `UPDATE` de `academias` es solo de
  plataforma; desde una academia, la sentencia toca 0 filas sin error y una escritura anidada sobre la academia puede no
  hacer nada sin avisar. No se actualiza `academias` desde `conAcademia` (plan, sección 24).
- **Un `.catch` en una cadena sin `await` que falla después de que `trabajo` terminó** _(ataque ronda 13)_: la operación
  rechaza con `ErrorTransaccionAbortada` y no queda nada (criterio 160). Para ignorar un P2025 y seguir, se atrapa con
  `await` dentro de `trabajo` (criterio 153).
- **Función `async` lanzada con `void` dentro de `trabajo`** _(ataque ronda 13)_: no pasa el lint (criterio 159). Si falla
  dentro del envoltorio después de que `trabajo` terminó, la operación rechaza (160); si falla fuera del envoltorio (una
  función propia que lanza entre dos consultas), solo el lint la detiene (riesgo aceptado "Promesa descartada que escapa
  al lint").
- **Depurar un error de Prisma en desarrollo** _(ataque ronda 13)_: el registro técnico muestra solo el tipo, los códigos,
  el modelo y los marcos de la pila (criterio 162); el mensaje completo se ve al reproducir el caso en una prueba o en la
  consola de desarrollo, no en el registro.
- **Más de 64 escrituras de modelos en una transacción** _(ataque ronda 13, O2)_: cada una abre un punto de guardado;
  pasado ese número, PostgreSQL desborda la caché de subtransacciones y todo el servidor se vuelve más lento mientras la
  transacción sigue abierta. Para cargas masivas: `createMany`, `updateMany` o `deleteMany` (una operación, un punto) o
  `$executeRaw` (plan, sección 25).
- **Un valor con saltos de línea y `at ` en un error de la base** _(ataque ronda 14)_: el registro técnico no lo muestra;
  la `pila` se lee después del encabezado `nombre: mensaje` (criterio 163). Si el `stack` de un error no empieza con ese
  encabezado (una librería que cambia el formato de la pila, un mensaje cambiado después de crear el error), el registro
  sale sin `pila`, con el tipo y los códigos.
- **Promesa guardada en una variable dentro de `trabajo` y nunca esperada** _(ataque ronda 14, O1)_: si su operación
  rechaza mientras `trabajo` sigue esperando otra consulta (lo habitual con la cola serial), nada marca la transacción y se
  confirma lo anterior sin lo que faltaba; solo queda el registro del criterio 157. Lo evita la regla para el equipo (toda
  promesa creada dentro de `trabajo` se espera antes de devolver), que vigila el revisor (riesgo aceptado "Promesa
  descartada que escapa al lint", corregido en la ronda 14).
- **Función `async` pasada a `process.nextTick`, `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask`**
  _(ataque ronda 14, O2)_: no pasa el lint (criterio 164). Para diferir trabajo después de una transacción se espera la
  operación y se hace después, fuera de `trabajo` (los efectos secundarios van después de confirmar).
- **`throw new InternalServerErrorException(error)` con un error de Prisma** _(ataque ronda 15)_: responde 500
  `ERROR_INTERNO` y el registro lleva el tipo de la excepción y la forma limpia del error de Prisma, sin su mensaje ni el de
  la excepción, que es el mismo (criterio 165). Igual con `new HttpException(error, 503)` (responde 503) o con el error
  guardado en cualquier propiedad, también no enumerable o anidado. La forma recomendada sigue siendo un mensaje propio y
  `{ cause: error }`, que conserva el mensaje propio en el registro.
- **Un error con un grafo enorme o que no se deja recorrer** _(ataque ronda 15)_: más de 10 niveles, de 200 objetos o de
  100 claves en un objeto, o un `Proxy` que lanza al listar sus claves: se registra `{ tipo, truncado: true }` y lo que
  se haya encontrado de la base, sin mensaje ni pila (criterio 165, falla cerrada). Se pierde el diagnóstico, nunca se
  muestra un dato. _(Precisado tras la ronda 16, criterio 167: un arreglo, un objeto `String` o cualquier objeto con
  `length` numérico mayor que 100 se corta sin listar sus claves, en milisegundos; los binarios son hojas.)_
- **Un archivo grande dentro de un error** _(ataque ronda 16, F1)_: un `Buffer`, un arreglo tipado, un `DataView`, un
  `ArrayBuffer` o un `SharedArrayBuffer` no se recorren (hojas, criterio 167): registrar el error cuesta lo mismo que sin
  el archivo. Sin errores de la base en el grafo, sale el mismo error (pendiente de la pregunta abierta R16-1). Un arreglo
  de millones de elementos o un `new String` enorme dan `truncado: true` sin recorrerlos.
- **`cause` como getter heredado o como función** _(ataque ronda 16, O1)_: un error de la base detrás de un getter
  `cause` o `errors` del prototipo se encuentra y se limpia; una `cause` que es una función (estilo VError) da `truncado:
  true` y nunca se llama (criterio 168).
- **Un `name` inventado en un error de la base** _(ataque ronda 15, O1)_: se registra como `ErrorDeBase` (criterio 166).
- **`::money` en una consulta** _(ataque ronda 15, O2)_: no se usa (plan, sección 27; riesgo aceptado "Tipo `money` en
  consultas").

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
- Las dos son `LANGUAGE sql STABLE`, sin `SECURITY DEFINER` ni cláusula `SET`, con el cuerpo de la migración; ninguna
  función de la que dependa una política es `IMMUTABLE` (criterio 144) _(ataque ronda 9)_.
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
P-21) _(ataque ronda 3)_, sin distinguir mayúsculas (criterio 116) _(ataque ronda 4)_. Ninguna de las tres URL puede
llevar `user`, `host`, `hostaddr`, `password`, `port`, `dbname` ni `database` en la cadena de consulta (criterio 143, P-34)
_(ataque ronda 8)_. En desarrollo, `DATABASE_URL_APP` apunta al mismo servidor, puerto y base que `DATABASE_URL`; si no,
`db:crear` y el hook se detienen (criterio 148, P-35) _(ataque ronda 9)_.

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
class ErrorTransaccionAbortada /* 500 ERROR_INTERNO; ataque ronda 10, criterios 149 a 151, P-36; ronda 11, criterio 154 */ {}
// Ataque ronda 13 (criterios 161 y 162, P-42): además CausaLimpia, causaLimpia, esErrorDeBase y errorParaRegistro
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
function ipParaAuditoria(ip: string | null | undefined): string | null; // ataque ronda 10, criterio 152, P-37
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

  _(precisión de la ronda 7 del ataque, 12/11/2026; criterios 138 y 140)_
  - **Lado de la función (criterio 140).** En `cumpleFormaDeAcademia`, el lado de la función de la comparación es, quitando
    paréntesis exteriores, `app_academia_actual()` (con o sin `public.`) o una subconsulta escalar
    `( SELECT <función> [AS <alias>] )` donde `<función>` es exactamente esa llamada y `<alias>` es un identificador simple
    (sin comillas, en minúsculas, o entre comillas dobles); espacios libres después de `(` y antes de `)`. Cualquier otra
    palabra dentro de la subconsulta (`FROM`, `WHERE`, `LIMIT`, `UNION`, una coma) hace que el término no cumpla. La
    búsqueda de `app_es_plataforma` y `set_config` sigue sobre toda la expresión.
  - **Sembradores (criterio 138).** La firma `Sembrador` no cambia. Una llamada del sembrador debe crear al menos una fila
    nueva de su tabla para esa academia cada vez que se llama (no reutilizar una fija); la prueba encuentra la fila nueva
    comparando las filas de la academia antes y después de la llamada. Si una llamada no crea ninguna fila nueva, la prueba
    falla nombrando la tabla.

_(contrato de la ronda 8 del ataque, 12/11/2026; criterios 141 a 143)_. No son reglas de negocio nuevas.

- **Precisión de P-31 (criterio 141).** Las firmas no cambian. Cambian las consultas que arman la lista (API y
  `db:crear`): devuelven filas de los esquemas revisados con la definición del criterio 141 (también los que pertenecen a
  una extensión), sin objetos de extensión. `conObjetosPropios` es `true` si el esquema tiene una relación de cualquier
  `relkind` salvo índices (`i`, `I`) y tablas TOAST (`t`), o una función, que no sea objeto de extensión; una relación de
  tipo compuesto (`c`) cuyo `reltype` es objeto de extensión (`pg_depend` con `classid = 'pg_catalog.pg_type'::regclass`
  y `deptype = 'e'`) es objeto de extensión. `privilegiosDeMasEnEsquemas` y sus pruebas unitarias no cambian.
- **P-34. Parámetros de conexión en la cadena de consulta (criterio 143).** `backend/src/infraestructura/entorno/url-postgres.ts`
  y `scripts/lib/entorno.mjs` exportan, con los mismos nombres y el mismo contenido (`scripts/lib/entorno.mjs` sigue
  importando solo módulos `node:*`, porque lo carga el hook):

  ```ts
  const PARAMETROS_DE_CONEXION_PROHIBIDOS: readonly string[];
  // ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database']
  function parametrosDeConexionProhibidos(url: string): string[];
  // nombres de la lista presentes en la cadena de consulta, en minúsculas, sin repetir y en orden de aparición; [] si no hay
  ```

  Lee la cadena de consulta con `new URL(url).searchParams` y compara cada nombre decodificado, pasado a minúsculas, con la
  lista. Si `url` no es una URL que `new URL` acepte, lanza un `TypeError` (quien la llama ya validó el formato; falla
  cerrada). No devuelve ni registra valores. La usan `validarEntorno` (backend), `analizarUrlPostgres` (y por ella
  `leerUrlApp`, `leerUrlsBases`, `db:crear` y el hook), y el comando y la semilla antes de llamar a
  `crearClienteDelDueno`. El texto del mensaje es libre; las pruebas buscan el nombre de la variable y el del parámetro, y
  que no aparezcan el valor, la contraseña ni la URL.
- **P-35. URL de la app sobre la base de desarrollo (criterio 148)** _(ataque ronda 9)_. `scripts/lib/entorno.mjs` exporta
  (sigue importando solo módulos `node:*`):

  ```js
  function diferenciasConDesarrollo(app, desarrollo); // => Array<'servidor' | 'puerto' | 'base'>
  // app y desarrollo: los objetos que devuelve analizarUrlPostgres ({ host, puerto, usuario, clave, base });
  // las partes que difieren, en el orden servidor, puerto, base, sin repetir; [] si coinciden
  ```

  Compara `host` en minúsculas, `puerto` como número y `base` exacta; no mira `usuario`, `clave` ni la cadena de
  consulta. `crearBases` (`scripts/crear-bases.mjs`) la llama después de `leerUrlsBases`, `leerUrlApp` y las
  comprobaciones del usuario (criterio 6), antes de abrir la conexión; con alguna diferencia lanza un `Error` con el
  mensaje del criterio 148. El hook (`.claude/hooks/preparar-sesion.mjs`) exporta la función
  `leerUrlAppParaRol(entorno, desarrollo)` _(nombre fijo, ya no orientativo: decisión del orquestador tras T107,
  12/11/2026)_, con `desarrollo = leerConexion(...).desarrollo`, con lo que hoy hace el paso 3b antes de consultar el rol:
  lee `DATABASE_URL_APP` con `leerUrlApp`, comprueba el usuario (criterio 6) y llama a `diferenciasConDesarrollo` con
  ese `desarrollo`; lanza el error sin ejecutar `psql`, y el paso 3b la usa. El texto del mensaje es libre; las
  pruebas buscan `DATABASE_URL_APP`, `DATABASE_URL` (no solo como parte de `DATABASE_URL_APP`) y la palabra de cada parte
  (`servidor`, `puerto`, `base`), y que no aparezcan la contraseña ni la URL.

_(contrato de la ronda 10 del ataque, 12/11/2026; criterios 149 a 152)_. No son reglas de negocio nuevas.

- **P-36. Transacción abortada (criterios 149 a 151).** `backend/src/infraestructura/prisma/errores.ts` define y
  `backend/src/infraestructura/prisma/index.ts` exporta:

  ```ts
  export class ErrorTransaccionAbortada extends ErrorNegocio {
    constructor(opciones?: { readonly cause?: unknown }); // 500 'ERROR_INTERNO'; name 'ErrorTransaccionAbortada'
  }
  ```

  `BaseDatos` (`conAcademia`, `comoPlataforma` y `resolverAcademia`) y `enPlataforma` (`backend/src/cli/conexion.ts`, que
  la importa de `../infraestructura/prisma`) rechazan con una instancia de esta clase, la misma que importan las pruebas.
  Las firmas de `conAcademia`, `comoPlataforma`, `resolverAcademia`, `enPlataforma` y `crearClienteDelDueno` no cambian.
  `cause`, si se pasa, es el error de la sentencia de comprobación (con su SQLSTATE `25P02`); las pruebas no lo exigen. El
  mensaje es solo para el registro técnico (el filtro responde el mensaje genérico de 500, como con
  `ErrorRolBaseDatosInseguro`).
- **P-37. IP de la auditoría (criterio 152).** `backend/src/modulos/auditoria/index.ts` exporta
  `ipParaAuditoria(ip: string | null | undefined): string | null` (función pura, sin Nest; orientativo:
  `backend/src/modulos/auditoria/ip.ts`, con `isIP` e `isIPv6` de `node:net`). Lanza un `Error` (no un `ErrorNegocio`:
  es un 500) cuyo mensaje no contiene el texto recibido. `EntradaAuditoria.ip` conserva su tipo.

_(contrato de la ronda 11 del ataque, 12/11/2026; criterios 153 a 155)_. No son reglas de negocio nuevas.

- **Ampliación de P-36 (criterio 154).** El constructor admite un campo opcional más, sin cambiar lo que ya existe:

  ```ts
  constructor(opciones?: { readonly cause?: unknown; readonly motivo?: 'abortada' | 'incompleta' });
  // 'abortada' (por defecto): el mensaje de hoy; 'incompleta': una consulta de la transacción no llegó a ejecutarse
  ```

  Sigue siendo 500 `ERROR_INTERNO` con el mensaje genérico en la respuesta; el mensaje propio es solo para el registro
  técnico. Las pruebas comprueban la clase, no el texto ni el motivo.
- **P-38. Cola serial y operaciones incompletas en el envoltorio (criterios 153 y 154).** `envolver(tx)` de
  `backend/src/infraestructura/prisma/envoltorio.ts` (interno de la carpeta; la prueba unitaria lo importa con esa ruta)
  devuelve, además de `cliente`, `terminar`, `ejecutar` (P-32) y `asentar` (criterio 149):

  ```ts
  readonly descartar: () => void;      // rechaza sin entregarlas las consultas que siguen en la cola; las siguientes
                                       // llamadas ya las rechaza terminar() (P-26). La usa #transaccion si trabajo lanza.
  readonly exigirCompleta: () => void; // lanza ErrorTransaccionAbortada (motivo 'incompleta') si alguna operación del
                                       // envoltorio recibió undefined de Prisma; si no, no hace nada.
  ```

  Nombres fijos (los importan las pruebas). `envolver` acepta en las pruebas una transacción falsa: un objeto con
  `$queryRaw`, `$executeRaw` y, por cada modelo que use la prueba, un delegado con las operaciones que use, cada una una
  función que devuelve un objeto con `then` (la prueba registra cuándo se llama a ese `then`, que es cuando se entrega la
  consulta). Las funciones del envoltorio exigen el contexto de `ejecutar` (P-32), así que la prueba las llama dentro de
  `ejecutar`. La firma de `envolver` y el tipo `ClienteTransaccion` (P-24, P-26) no cambian.

_(contrato de la ronda 12 del ataque, 12/11/2026; criterios 156 a 158)_. No son reglas de negocio nuevas.

- **Precisión de P-38 (criterio 156).** Los nombres y las firmas no cambian. Cambia el sentido de dos funciones:
  - `asentar()` puede llamarse sin `terminar()` antes (es lo que hace `#transaccion` en el camino bueno): mientras corre,
    el envoltorio acepta y encola llamadas desde el contexto de `ejecutar`; termina cuando, tras ceder un turno del ciclo
    de eventos, no queda ninguna consulta sin asentar, y en ese momento apaga el envoltorio. Si ya se llamó a
    `terminar()`, solo espera, como hoy. Nunca rechaza;
  - desde que se llama a `asentar()`, toda llamada que se rechaza por el envoltorio apagado o por venir de otro contexto
    marca la transacción, y `exigirCompleta()` lanza `ErrorTransaccionAbortada` (motivo `incompleta`); antes de
    `asentar()`, esas llamadas no marcan nada (como hoy).

  `terminar()` sigue apagando en el acto (camino del error, junto con `descartar()`).
- **P-39. Capa de puntos de guardado (criterio 158).** `backend/src/infraestructura/prisma/puntos-de-guardado.ts` (interno
  de la carpeta; la prueba unitaria lo importa con esa ruta) exporta:

  ```ts
  export function conPuntosDeGuardado(tx: Prisma.TransactionClient): {
    readonly tx: Prisma.TransactionClient; // $queryRaw, $executeRaw y un delegado por modelo con las operaciones de la lista
                                           // del envoltorio; las escrituras, con punto de guardado; lo demás, tal cual
    readonly exigirSana: () => void;       // lanza ErrorTransaccionAbortada si una sentencia de la capa falló o una
                                           // escritura dejó la transacción abortada; si no, no hace nada
  };
  ```

  `#transaccion` de `BaseDatos` pasa a `envolver` el `tx` de la capa (nunca a `trabajo`) y llama a `exigirSana()` junto con
  `exigirCompleta()`. La capa envía sus sentencias con `$executeRaw` y `$queryRaw` de la transacción que recibe, una
  después de otra, y cada operación que expone devuelve un objeto con `then` que inicia la secuencia al llamarse (el
  envoltorio lo llama al entregar). En las pruebas acepta una transacción falsa como la de P-38; la prueba reconoce cada
  sentencia de la capa por el texto SQL del argumento (las partes de la plantilla unidas, o `.sql` si es un
  `Prisma.Sql`), sin espacios al principio: `SAVEPOINT `, `RELEASE SAVEPOINT ` y `ROLLBACK TO SAVEPOINT ` por su
  comienzo, y la comprobación del estado como la sentencia de `$queryRaw` que sigue a una escritura rechazada. El nombre
  del punto cumple `^aq_[0-9a-f]{32}$`.
- **P-40. Rechazos sin manejar (criterio 157).** `backend/src/infraestructura/proceso/rechazos.ts` (ruta y nombre fijos:
  los importa la prueba unitaria) exporta:

  ```ts
  export function crearManejadorDeRechazos(registro: {
    error(datos: object, mensaje: string): void;
  }): (motivo: unknown) => void;
  ```

  El manejador llama a `registro.error({ err: motivo }, <mensaje fijo>)` si `motivo` es un `Error`, y a
  `registro.error({ tipo: typeof motivo }, <mensaje fijo>)` si no; no lanza y no toca `process`. `main.ts` lo registra con
  `process.on('unhandledRejection', …)` después de `await app.listen(…)`, con el registro de pino de la app. El texto del
  mensaje es libre; la prueba no lo fija.

_(contrato de la ronda 13 del ataque, 12/11/2026; criterios 159 a 162)_. No son reglas de negocio nuevas.

- **P-41. Regla de promesas descartadas (criterio 159).** _(Ampliado por el criterio 164, ataque ronda 14: caso (iii) y
  envoltorios de tipos; ver "Ampliación de P-41" en el contrato de la ronda 14.)_ `eslint/regla-promesas-descartadas.mjs`
  (nombre orientativo del archivo) exporta la configuración que agregan `eslint.config.mjs` y `eslint.protegido.config.mjs` (las dos importan el
  mismo bloque, como con `configuracionSqlSesion`, y usan `ARCHIVOS_DE_CODIGO`, `EXENCION_PRUEBAS` y
  `EXENCION_CLIENTE_GENERADO` de `eslint/archivos-de-codigo.mjs`). Nombres fijos (los usan las pruebas):
  - complemento `aquagestion-promesas`, regla `sin-promesas-descartadas` (identificador
    `aquagestion-promesas/sin-promesas-descartadas`), sin información de tipos, en `error`: (i) `UnaryExpression` con
    `operator: 'void'` cuyo argumento no es el literal `0`; (ii) `ExpressionStatement` cuya expresión es una
    `CallExpression` (también dentro de una `ChainExpression`) cuyo `callee` es una `ArrowFunctionExpression` o una
    `FunctionExpression` con `async: true`. El mensaje (texto libre, en español) pide usar `await` o atrapar con
    `.catch`;
  - en el lint normal, solo en `backend/src/**/*.{ts,tsx}` sin las pruebas ni el cliente generado, además
    `'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false, ignoreIIFE: false, checkThenables: true }]`.
    No se agrega al paso protegido (exige información de tipos, que ese paso no usa, y la prueba del criterio 96 rechaza
    reglas de `typescript-eslint` en él).
- **P-42. Errores para el registro (criterios 161 y 162).** _(Precisado por el criterio 163, ataque ronda 14: cómo se
  obtiene `pila`; ver "Precisión de P-42" en el contrato de la ronda 14.)_ _(Precisado por los criterios 165 y 166, ataque
  ronda 15: búsqueda de errores de la base en todo el grafo, forma del objeto de un `Error` que los lleva y `tipo` de la
  lista cerrada; ver "Precisión de P-42" en el contrato de la ronda 15.)_ _(Precisado por los criterios 167 y 168, ataque
  ronda 16: costo acotado de la búsqueda y `cause` y `errors` por su nombre; ver "Precisión de P-42" en el contrato de la
  ronda 16.)_
  `backend/src/infraestructura/prisma/registro-de-errores.ts` (nombre orientativo del archivo) define y `backend/src/infraestructura/prisma/index.ts` exporta (nombres fijos: los
  importan las pruebas):

  ```ts
  export class CausaLimpia extends Error {          // name 'CausaLimpia'; sin cause ni meta
    readonly code?: string;                          // el SQLSTATE, si se conoce (lo lee codigoDeErrorDeBase)
    readonly codigoPrisma?: string;                  // ^P\d{4}$
    readonly operacion?: string;                     // '$queryRaw', '$executeRaw' o '<delegado>.<operación>' del envoltorio
  }
  export type CircunstanciaDeLaCausa = 'sin-resultado' | 'llamada-tardia' | 'rechazo-tras-trabajo';
  export function causaLimpia(error: unknown, operacion?: string, circunstancia?: CircunstanciaDeLaCausa): CausaLimpia;
  // Mensaje: un texto fijo por circunstancia (o uno general) + tipo (lista cerrada), código de Prisma, SQLSTATE y
  // operación, si se conocen. Si `error` ya es una CausaLimpia y no se pasan `operacion` ni `circunstancia`, la devuelve
  // tal cual. Una `operacion` que no cumple ^(\$queryRaw|\$executeRaw|[a-z][A-Za-z0-9]*\.[a-zA-Z]+)$ se descarta.
  export function esErrorDeBase(error: unknown): boolean;
  // Verdadero si: es instancia de PrismaClientKnownRequestError, PrismaClientUnknownRequestError,
  // PrismaClientValidationError, PrismaClientInitializationError o PrismaClientRustPanicError; o su `name` empieza por
  // 'PrismaClient' o es 'DriverAdapterError' o 'DatabaseError'; o codigoDeErrorDeBase(error) no es null; o su `code`
  // cumple ^P\d{4}$. Una CausaLimpia también cuenta (tiene SQLSTATE o código de Prisma).
  export function errorParaRegistro(error: unknown): unknown;
  // Lo que se pasa al registro como `err` (criterio 162): objeto plano limpio, el mismo Error o { tipo: typeof valor }.
  ```

  Lista cerrada de `tipo`: los cinco nombres de las clases de Prisma, `DriverAdapterError`, `DatabaseError`,
  `CausaLimpia` y, para cualquier otro error de la base, `ErrorDeBase`. Las funciones no lanzan con ninguna entrada
  (también objetos con `getter` que lanzan, ciclos o `null`).
- **Precisión de P-36 (criterio 161).** La firma no cambia. El constructor guarda en `cause` la causa limpia:
  `opciones.cause` si ya es una `CausaLimpia`; si no, `causaLimpia(opciones.cause)`. Sin `cause`, como hoy. La frase "`cause`,
  si se pasa, es el error de la sentencia de comprobación" se lee: es la forma limpia de ese error (con su SQLSTATE). Las
  causas de las operaciones incompletas, tardías o rechazadas después de `trabajo` (criterios 154, 156 y 160) son
  `causaLimpia(<error o undefined>, <operación>, 'sin-resultado' | 'llamada-tardia' | 'rechazo-tras-trabajo')`.
- **Precisión de P-38 (criterio 160).** Los nombres y las firmas no cambian. Desde que se llama a `asentar()`, una
  operación entregada que se asienta con un rechazo marca la transacción (`exigirCompleta()` lanza
  `ErrorTransaccionAbortada`, motivo `incompleta`) y su promesa rechaza con `ErrorTransaccionAbortada` con
  `causaLimpia(<el rechazo>, <operación>, 'rechazo-tras-trabajo')`. Antes de `asentar()`, como hoy.
- **Precisión de P-40 (criterio 162).** La firma no cambia. Con un `Error`, el manejador llama a
  `registro.error({ err: errorParaRegistro(motivo) }, <mensaje fijo>)` (que, para un `Error` que no es de la base, es el
  mismo objeto); con lo demás, `{ tipo: typeof motivo }`, como hoy.

_(contrato de la ronda 14 del ataque, 12/11/2026; criterios 163 y 164)_. No son reglas de negocio nuevas.

- **Ampliación de P-41 (criterio 164).** El complemento, la regla, su identificador, los archivos a los que aplica y el
  bloque con tipos no cambian. La regla propia falla además con:
  - (iii) una `CallExpression` (en cualquier posición, también dentro de una `ChainExpression`) cuyo `callee` es un
    `Identifier` con nombre `nextTick`, `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask`, o un
    `MemberExpression` cuya propiedad tiene uno de esos nombres (no computada, o computada con un `Literal` de cadena o un
    `TemplateLiteral` sin expresiones), y con al menos un argumento que, quitando los envoltorios de tipos, es una
    `ArrowFunctionExpression` o una `FunctionExpression` con `async: true`;
  - envoltorios de tipos: `TSAsExpression`, `TSSatisfiesExpression`, `TSNonNullExpression` y `TSTypeAssertion`, también
    anidados, se quitan antes de mirar el argumento de (iii) y, en (ii), la expresión de la sentencia y el `callee`.
  - _(precisión del orquestador, ronda 14; manda el criterio 164)_ en (iii), el `callee` también se lee quitando antes los
    envoltorios de tipos (los mismos cuatro, también anidados) y los paréntesis (que en ESTree no forman nodo), igual que
    en (ii); el `Identifier` o el `MemberExpression` de (iii) se reconoce sobre el resultado. Así,
    `(process.nextTick as typeof process.nextTick)(async () => { … })` falla.

  El mensaje de (iii) es texto libre en español (pide esperar la operación con `await` dentro de `trabajo` o hacer el
  trabajo diferido después de confirmar). La prueba comprueba el identificador de la regla, no el texto ni el
  `messageId`.
- **Precisión de P-42 (criterio 163).** Las firmas no cambian. El campo `pila` del objeto limpio de un error de la base se
  obtiene quitando del `stack` el encabezado exacto (`` `${name}: ${message}` ``, o `name` si `message` es `''`) y
  conservando solo las líneas de marco de lo que sigue, que debe estar vacío o empezar con `\n`; si no se cumple, o si
  `name`, `message` o `stack` no son cadenas o leerlos lanza, el objeto no tiene `pila`. Vale en cada nivel de la cadena de
  causas. _(Precisión del orquestador, ronda 14.)_ Si tras el encabezado no queda ninguna línea de marco, el objeto
  tampoco tiene `pila` (la propiedad se omite; nunca es `''`).

_(contrato de la ronda 15 del ataque, 12/11/2026; criterios 165 y 166)_. No son reglas de negocio nuevas.

- **Precisión de P-42 (criterios 165 y 166).** Los nombres, las firmas y los archivos no cambian (`errorParaRegistro(error:
  unknown): unknown`). Lo que devuelve `errorParaRegistro`:

  ```ts
  // - lo que no es un Error: { tipo: typeof valor }                                  (como hoy)
  // - una CausaLimpia: la misma                                                     (como hoy)
  // - un error de la base: ErrorDeBaseLimpio                                        (como hoy; tipo del criterio 166)
  // - un Error sin errores de la base en su grafo y sin topes agotados: el mismo    (como hoy)
  // - un Error con alguno, o con un tope agotado: ErrorConvertido                   (criterio 165)
  interface ErrorDeBaseLimpio {
    tipo: string;              // lista cerrada (166): los cinco de Prisma, 'DriverAdapterError', 'DatabaseError', 'CausaLimpia' o 'ErrorDeBase'
    codigoPrisma?: string; sqlstate?: string; codigoDeSistema?: string; modelo?: string;
    pila?: string;             // criterio 163
  }
  interface ErrorConvertido {
    tipo: string;              // name, solo si es igual a constructor.name y cumple ^[A-Za-z][A-Za-z0-9]{0,63}$; si no, 'Error'
    mensaje?: string;          // message, solo si no contiene el mensaje de un error de la base encontrado ni este lo contiene
    pila?: string;             // regla del 163; se omite si message o stack contienen el mensaje de un error de la base
    causa?: ErrorConvertido | ErrorDeBaseLimpio | CausaLimpia | { tipo: string };   // de `cause`
    errores?: (ErrorConvertido | ErrorDeBaseLimpio | CausaLimpia | { tipo: string })[]; // de `errors`, hasta 10
    erroresDeLaBase?: ErrorDeBaseLimpio[];  // solo en el nivel superior: los encontrados fuera de causa y errores, hasta 10
    truncado?: true;           // solo en el nivel superior: tope agotado (sin mensaje, pila, causa ni errores) o más de 10
  }
  ```

  Búsqueda: valores de tipo objeto de las propiedades propias (`Reflect.ownKeys`: texto y `Symbol`, enumerables o no) y
  de las enumerables heredadas (`for…in`), leídos sin dejar que un getter lance; entra en objetos y en `Error` que no son
  de la base; no entra en errores de la base ni en `CausaLimpia`; `WeakSet` de vistos. Topes: 10 niveles, 200 objetos y
  100 claves por objeto; agotar uno, o que listar las claves lance, es falla cerrada (`{ tipo, truncado: true,
  erroresDeLaBase? }`). "El mensaje de un error de la base encontrado" es su `message` si es una cadena no vacía; si leerlo
  lanza o no es cadena ni `undefined`, ningún `ErrorConvertido` del resultado lleva `mensaje` ni `pila`. Cada error de la
  base aparece una sola vez (primero en `causa`/`errores`). `causaLimpia(error)` toma su `tipo` igual: lista cerrada para un
  error de la base; para lo demás, el `tipo` de `ErrorConvertido`. `mensajeSeguro` con un `ErrorConvertido`: su `mensaje`;
  si no tiene, "error de la base (…)" del primer `ErrorDeBaseLimpio` (en `causa`/`errores` a lo hondo, luego en
  `erroresDeLaBase`); si no hay, `error sin detalles (<tipo>)`. Ninguna función lanza con ninguna entrada.

_(contrato de la ronda 16 del ataque, 12/11/2026; criterios 167 y 168)_. No son reglas de negocio nuevas.

- **Precisión de P-42 (criterios 167 y 168).** Los nombres, las firmas, los archivos y las formas `ErrorDeBaseLimpio` y
  `ErrorConvertido` no cambian. La búsqueda de `errorParaRegistro`, en cada objeto que visita:
  1. **hoja binaria** (`ArrayBuffer.isView(valor)` o `types.isAnyArrayBuffer(valor)` de `node:util`; nunca `instanceof`,
     prototipo ni `Symbol.toStringTag`): no es un error de la base, no se lee nada de ella, no se entra ni cuenta como
     objeto visitado;
  2. **`length`:** si `Reflect.get(objeto, 'length')` (sin dejar que lance) es un `number` mayor que 100, falla cerrada
     sin listar claves;
  3. **claves:** `Reflect.ownKeys(objeto)`; más de 100, falla cerrada sin `for…in`; si no, `for…in` agrega las
     enumerables heredadas y corta al pasar de 100 claves distintas (falla cerrada); listar o recorrer que lance, falla
     cerrada. No se arma ninguna colección de más de 101 claves;
  4. **`cause` y `errors` por su nombre** (`Reflect.get`, sin dejar que lance; getters y heredadas incluidas), además de
     las claves listadas; no cuentan para el tope de claves;
  5. **`cause` función** (por su nombre o como clave listada): falla cerrada, sin llamarla. Un `errors` función no se
     llama, no se recorre y no es falla cerrada.

  La falla cerrada es la del criterio 165: `{ tipo, truncado: true, erroresDeLaBase? }`. Sin errores de la base en el
  grafo y sin falla cerrada, el mismo error (con hojas binarias incluidas; pendiente de la pregunta abierta R16-1).

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
- **Ronda 7 del ataque (criterios 137 a 140):**
  - `problemasDePrivilegios` de `scripts/crear-bases.mjs` (criterio 102) excluye los objetos de extensiones también en
    `public` (criterio 137). Las pruebas protegidas del criterio 102 en `db:crear` no cambian: ninguno de sus casos usa un
    objeto de extensión. `privilegiosDeMas` (P-20), `privilegiosDeMasEnEsquemas` (P-31) y sus pruebas unitarias no cambian:
    la exclusión está en las consultas;
  - la prueba protegida del criterio 133 (`aislamiento/rls-todas-las-tablas.test.ts`) cambia el paso del `INSERT` como
    dice el criterio 138; la adapta el test-writer en el commit de pruebas protegidas de la ronda 7, sin quitar casos de su
    autocomprobación: la tabla con `WITH CHECK (academia_id IS NOT NULL)` se sigue detectando. Los sembradores de
    `public.auditoria` y `public.configuraciones` ya crean una fila nueva en cada llamada (una clave aleatoria; P-33); si
    alguno no lo hiciera, se ajusta en el mismo commit;
  - `backend/test/utilidades/politicas.ts` (P-33) acepta la subconsulta escalar (criterio 140); los ejemplos de la
    autocomprobación del criterio 132 que se detectaban se siguen detectando, en el mismo commit;
  - la regla del criterio 135 agrega las formas del criterio 139; ningún ejemplo que pasa en
    `eslint/regla-transaccion-guardada.test.mjs` usa `EventEmitterAsyncResource` ni `getBuiltinModule` (si alguno cambiara
    de resultado, el test-writer se detiene e informa);
  - las historias siguientes: un objeto de AquaGestión nunca se agrega a una extensión (criterio 137); una tabla de academia
    puede tener disparadores `BEFORE INSERT` que fuercen o validen la academia (criterio 138) y escribir sus políticas con
    `(SELECT app_academia_actual())` (criterio 140); su sembrador crea una fila nueva en cada llamada; no se usan
    `EventEmitterAsyncResource` ni colas o lotes compartidos entre peticiones dentro de `trabajo` (criterio 139; plan,
    notas O1 y O4 de la ronda 7).
- **Ronda 8 del ataque (criterios 141 a 143):**
  - `esquemasRevisados` de `backend/test/utilidades/catalogo.ts` (protegida) deja de excluir los esquemas de extensiones
    (criterio 142); la cambia el test-writer en el commit de pruebas protegidas de la ronda 8. Lo que las pruebas de los
    criterios 9, 10, 11, 12, 124, 126, 132, 133 y 137 comprueban en `public` y en los demás esquemas no cambia; si alguna
    pasara a fallar sobre la base de pruebas real (un esquema de extensión con objetos propios), el test-writer se detiene e
    informa;
  - las pruebas protegidas de los criterios 130 y 137 no cambian: el control del 130 con `CREATE EXTENSION pgcrypto SCHEMA
    ext_prueba` sigue pasando (el esquema, pertenezca o no a la extensión, solo tiene objetos de la extensión), y ninguno de
    sus casos usa `ALTER EXTENSION … ADD SCHEMA`;
  - `validarEntorno` (criterio 5) y `analizarUrlPostgres` agregan un rechazo; ninguna prueba protegida anterior usa una URL
    con los parámetros de la lista (todas usan `options` o ninguna cadena de consulta), así que ninguna cambia de resultado.
    Si alguna cambiara, el test-writer se detiene e informa;
  - las historias siguientes: un esquema creado por una migración, sea o no de una extensión, cuenta para la comprobación del
    rol y las pruebas de catálogo (criterios 141 y 142); las URL de despliegue llevan usuario, servidor, puerto y base en la
    parte principal (criterio 143); ningún servicio guarda resultados de consultas en propiedades compartidas sin la academia
    como clave (plan, nota O3 de la ronda 8).
- **Ronda 9 del ataque (criterios 144 a 148):**
  - la primera sentencia de `BaseDatos` y de `enPlataforma` fija cuatro parámetros más (criterios 146 y 147). Las pruebas
    protegidas de los criterios 72, 90, 98, 101, 107, 121 y 122 no cambian de resultado: ninguna compara el texto exacto
    de esa sentencia ni usa esos parámetros. Si alguna lo hiciera, el test-writer se detiene e informa;
  - la regla del criterio 83 admite en `cli/` cuatro llamadas más a `set_config`. Si algún ejemplo de las pruebas
    protegidas de lint de las rondas anteriores espera que falle una de esas cuatro llamadas exactas en `cli/`, el
    test-writer se detiene e informa (los demás valores siguen fallando);
  - **criterio 148 y pruebas protegidas anteriores de `db:crear`:** varias pruebas de integración de los scripts
    ejecutan `db:crear` con una `DATABASE_URL` sobre bases temporales y una `DATABASE_URL_APP` sobre `…/aquagestion`
    (por ejemplo, `scripts/test/integracion/rol-app.test.mjs`, `rol-app-ronda2.test.mjs`, `rol-app-ronda3.test.mjs`,
    `rol-app-ronda5.test.mjs`, `rol-app-ronda6.test.mjs`, `rol-app-ronda7.test.mjs`, `rol-app-ronda8.test.mjs`,
    `crear-bases.test.mjs`, `migraciones.test.mjs`, `url-consulta-ronda8.test.mjs` y
    `scripts/test/integracion-aislada/rol-app-config.test.mjs`; la lista la confirma el test-writer buscando toda prueba
    que ejecute `db:crear`, `db:preparar`, `crearBases` o el paso 3b del hook). Con el criterio 148 terminarían con código
    1 por la diferencia de base. El test-writer las adapta en el commit de pruebas protegidas de la ronda 9: la
    `DATABASE_URL_APP` de cada caso lleva el mismo servidor, puerto y base que la `DATABASE_URL` del caso (por ejemplo,
    con `urlAppSobre(<DATABASE_URL del caso>, <URL de la app>)`), sin cambiar el usuario, la contraseña, la cadena de
    consulta ni lo que cada caso comprueba (`db:crear` solo usaba de ella el usuario y la contraseña). Los casos del
    criterio 143 que agregan `?user=` o `?host=` siguen fallando por el 143 (se valida antes). Si alguna prueba cambiara de
    resultado por otra razón, el test-writer se detiene e informa;
  - la API no cambia por el criterio 148, ni `validarEntorno` (criterio 5);
  - las pruebas de los criterios 144 y 145 pasan desde el principio con las migraciones actuales (las dos funciones ya son
    `STABLE`): son guardas contra un cambio futuro, con autocomprobación;
  - las historias siguientes: toda función que use una política, o que lea `current_setting`, `app_academia_actual` o
    `app_es_plataforma`, es `STABLE` o `VOLATILE`, nunca `IMMUTABLE` (criterio 144; por ejemplo, la función de usuario
    actual que llegue con 002); un parámetro de sesión nuevo que cambie lo que se escribe o qué filas toca una sentencia se
    fija en la primera sentencia (criterio 147 y riesgo aceptado "Parámetros de sesión que no se fijan"); la historia que
    cree el primer índice GIN agrega `gin_fuzzy_search_limit = 0` a la primera sentencia; los montos no usan el tipo
    `money` ni `to_char` sin fijar la configuración regional.
- **Ronda 10 del ataque (criterios 149 a 152):**
  - la primera sentencia de `BaseDatos` y de `enPlataforma` fija además `app.transaccion` con una marca aleatoria, y cada
    transacción que termina bien ejecuta una sentencia más antes de confirmar (criterios 149 a 151). Las pruebas
    protegidas de los criterios 72, 90, 98, 101, 106, 107, 121, 122, 134, 146 y 147 no cambian de resultado: ninguna
    compara el texto de la primera sentencia, ni lee `app.transaccion`, ni cuenta las sentencias enviadas por
    `BaseDatos` (la de comprobación no pasa por el envoltorio y se envía después de `terminar()`, así que "una llamada
    después de terminar no envía nada", P-26, sigue siendo cierto para el envoltorio). Si alguna cambiara, el
    test-writer o el backend se detienen e informan;
  - el criterio 22 no cambia: un `trabajo` que lanza sigue rechazando con su propio error;
  - en `cli/`, la regla del criterio 83 ya admite `set_config('app.transaccion', <parámetro>, true)` (primer argumento
    literal que empieza por `app.` y tercero `true`); no hay cambio de lint;
  - la nota O3 de la ronda 6 del plan (idempotencia con `esViolacionDeUnicidad`) queda ampliada: dentro de `trabajo`, el
    duplicado esperado se resuelve con `INSERT … ON CONFLICT DO NOTHING RETURNING`; `esViolacionDeUnicidad` solo fuera de
    la transacción (plan, sección 22). `AcademiasService.crear` ya lo hace así; ningún servicio de 001 atrapa errores de
    la base dentro de `trabajo` (si el backend encuentra alguno, lo cambia a esa forma);
  - `ipParaAuditoria` cambia solo las IP con zona (antes 500, ahora se guardan sin la zona) y los textos inválidos (antes
    500 por PostgreSQL, ahora 500 por la función); las IP de `supertest` y `null` no cambian;
  - las historias siguientes: ningún `trabajo` atrapa un error de la base para seguir (criterio 149); los duplicados
    esperados van con `ON CONFLICT`; la fecha de negocio no sale de `CURRENT_DATE` ni de `now()::date` (la sesión está en
    UTC, criterio 98): se calcula en America/Lima con `@date-fns/tz` y se pasa como parámetro, o con
    `AT TIME ZONE 'America/Lima'` (plan, sección 22, nota O1; el documentador lo agrega a `docs/arquitectura.md`, T24).
- **Ronda 11 del ataque (criterios 153 a 155):**
  - las consultas del envoltorio se entregan a Prisma de una en una (criterio 153). Lo que cambia para quien escribe un
    `trabajo`: nada en la forma de llamar; `Promise.all` y `Promise.allSettled` siguen sirviendo, pero no ganan
    paralelismo (en una transacción tampoco lo había: la conexión ejecuta una sentencia a la vez) y cada consulta recibe
    su propio resultado. Las pruebas protegidas de los criterios 22, 23, 24, 106, 134 y 149 a 151, y las de tiempos de
    espera y de duración, no deberían cambiar de resultado; la de las 20 consultas a la vez del 106 sigue siendo válida
    (mismo `pg_backend_pid()`, mismo contexto). Si alguna cambiara, el test-writer o el backend se detienen e informan;
  - la segunda viñeta del criterio 106 ("se envía al llamar la función") se precisa: se entrega sin esperar un `then`,
    en la llamada o en cuanto le toca en la cola. Ninguna prueba protegida del 106 comprueba el momento exacto de la
    entrega con varias consultas pendientes; si alguna lo hiciera, el test-writer se detiene e informa;
  - P-36 gana el campo opcional `motivo`; quien construye `ErrorTransaccionAbortada` sin él obtiene lo de hoy;
  - `enPlataforma` no cambia (P-24): los comandos y la semilla no lanzan consultas en paralelo dentro de su `trabajo`
    (riesgo aceptado "Consultas lanzadas a la vez dentro de `enPlataforma`"); hoy ni `superadmin.ts` ni `seed.ts` lo hacen;
  - el criterio 94 no cambia de sentido (el lint sigue dejando pasar los bloqueos de transacción); se precisa con qué
    función se ejecutan (criterio 155);
  - las historias siguientes: el aforo y la caja toman el bloqueo de transacción con `$executeRaw` (criterio 155; plan,
    sección 23); un `trabajo` no atrapa un error de la base para seguir (criterio 149), pero sí puede atrapar un P2025 de
    una consulta y seguir (criterio 153).
- **Ronda 12 del ataque (criterios 156 a 158):**
  - en el camino bueno, el envoltorio se apaga al terminar `asentar()` y no al terminar `trabajo` (criterio 156; precisión
    de la tercera viñeta del 106 y de P-38). Las pruebas protegidas del 106 llaman a la función guardada después de que
    `conAcademia` o `comoPlataforma` resolvieron, con el envoltorio ya apagado, así que no cambian de resultado; la
    unitaria de `asentar` del 153 llama a `terminar()` antes y tampoco. Si alguna cambiara, el test-writer o el backend se
    detienen e informan;
  - cada escritura de un delegado cuesta dos sentencias más en la misma transacción (crear y liberar el punto de
    guardado) y, si rechaza sin abortar, tres (criterio 158). Ninguna prueba protegida cuenta las sentencias de una
    escritura de la API; la unitaria de P-38 usa `envolver` sin la capa y no ve esas sentencias. El caso 5 del criterio
    153 sigue dando `25P02` en la tercera escritura (el punto de guardado no se puede crear en una transacción abortada y
    la operación rechaza con ese error);
  - el criterio 22, P-24, P-26, P-36 y el lint no cambian; `enPlataforma` no cambia (los comandos y la semilla no usan
    escrituras de delegados);
  - `main.ts` (de 000) registra el manejador de rechazos sin manejar después de `listen` (criterio 157); el arranque y sus
    errores no cambian;
  - las historias siguientes: cada paso de `trabajo` se espera con `await` (sin cadenas sueltas con `.then` ni `void`);
    una escritura de un delegado que falla con un P2025 se puede atrapar y seguir sin dejar nada a medias; no se actualiza
    `academias` desde `conAcademia`; para leer varias filas por id se usa `findMany` con `in` (plan, sección 24).
- **Ronda 13 del ataque (criterios 159 a 162):**
  - el lint de `backend/src` (sin las pruebas) prohíbe las promesas descartadas (criterio 159): `main.ts` (de 000) pasa de
    `void arrancar()` a `arrancar().catch(…)` con `process.exit(1)`, y `envoltorio.ts` deja de usar `void`. Las pruebas
    protegidas que reproducen ataques con `void` (por ejemplo, el caso 2 del 156 y `backend/test/utilidades/ronda10.ts`)
    están fuera del alcance de las reglas y no cambian. La prueba protegida del criterio 96 sigue pasando: la regla propia
    no es de `js.configs.recommended` ni de `typescript-eslint`. Si alguna protegida de lint anterior cambiara de
    resultado, el test-writer se detiene e informa;
  - desde `asentar()`, una operación entregada que rechaza hace rechazar la transacción (criterio 160). Las protegidas de
    la cola (153 y 154) y de `asentar` (156) que rechazan una consulta lo hacen antes de `asentar()` o al llamar, así que
    no cambian; el caso 3 del 156 y la variante "sin await" del 149 ya esperaban `ErrorTransaccionAbortada`;
  - `ErrorTransaccionAbortada.cause` pasa a ser una `CausaLimpia` (criterio 161); `#registrarAbortada` la lee igual (el
    SQLSTATE con `codigoDeErrorDeBase`, la operación por su mensaje). Las protegidas de 154 y 156 que buscan el nombre de
    la operación en el error lo siguen encontrando;
  - el filtro de errores (de 000, ampliado en 001), el manejador de rechazos (157) y `mensajeSeguro` (comandos y
    semilla) registran los errores de la base limpios (criterio 162); con un `Error` que no es de la base registran lo
    de hoy, así que `filtro-errores.test.ts`, `rechazos.test.ts`, `rechazos-proceso.test.ts` y `mensaje-seguro.test.ts` no
    cambian de resultado;
  - las historias siguientes: dentro de `trabajo`, cada paso con `await` y sin promesas descartadas (el lint lo exige);
    ningún error propio copia el mensaje de otro; los registros técnicos de errores pasan por `errorParaRegistro`; las
    cargas masivas usan `createMany`, `updateMany`, `deleteMany` o `$executeRaw` (plan, sección 25).
- **Ronda 15 del ataque (criterios 165 y 166):**
  - el filtro de errores (de 000, ampliado en 001), el manejador de rechazos y el arranque de `main.ts` no cambian de
    código: `errorParaRegistro` busca ahora errores de la base en todo el grafo del error (criterio 165). Un `Error` sin
    ninguno se sigue registrando igual, así que `filtro-errores.test.ts`, `rechazos.test.ts` y `rechazos-proceso.test.ts`
    no cambian de resultado; un `Error` propio con uno en `cause` sigue llevando su `mensaje`, pero su `pila` pasa a ser
    solo los marcos (las protegidas de 162 y 163 exigen solo que sea una cadena);
  - `mensajeSeguro` resume también un `Error` que lleva un error de la base en cualquier propiedad (criterio 165); con
    errores comunes, lo de hoy (`mensaje-seguro.test.ts` no cambia);
  - el `tipo` de un error de la base y de la `CausaLimpia` sale de la lista cerrada (criterio 166); las protegidas que
    comparan el `tipo` con el `name` lo hacen con errores reales de Prisma, que están en la lista;
  - las historias siguientes: un error se envuelve con un mensaje propio y `{ cause: error }`, no pasando el error ni su
    mensaje como respuesta de una excepción de Nest; no se usa el tipo `money` de PostgreSQL (plan, sección 27).
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
  y las llamadas calificadas con otro esquema. _(Ampliado en la ronda 7: la exclusión vale también en `public`, en la API y
  en `db:crear` por igual, criterio 137. Una vista o tabla de una extensión en `public` con `SELECT` para `PUBLIC`, como las
  de `pg_stat_statements`, queda al alcance de la app; no contiene datos de las academias. `ALTER EXTENSION … ADD`
  convierte un objeto propio en objeto de extensión: es una migración visible en la revisión, y la prueba de catálogo del
  criterio 137 falla si lo hace con una tabla de `PRIVILEGIOS_APP`, una función de `FUNCIONES_APP` o una tabla con
  `academia_id`.)_ _(Acotado en la ronda 8: desde el criterio 141, lo excluido es solo el objeto de extensión; un esquema que
  pertenece a una extensión se revisa entero, así que una tabla propia dentro de él ya no queda fuera. Lo que sigue aceptado:
  una tabla agregada a la extensión con `ALTER EXTENSION … ADD TABLE`, sin `academia_id` y que no esté en `PRIVILEGIOS_APP`,
  queda fuera de las comprobaciones; agregarla es una migración visible en la revisión.)_
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
  contexto: cada comando es un proceso que corre una sola vez. _(Ampliado en la ronda 7, O2: tampoco ve una transacción
  guardada cuyo tipo es una unión (`TransaccionAcademia | null`), un `trabajo` guardado en una variable tipada antes de
  pasarlo a `conAcademia`, ni un delegado guardado (`this.d = tx.cliente.configuraciones`). En todas, la garantía sigue
  siendo el criterio 134.)_
- **Contexto restaurado por un recurso asíncrono** _(ataque ronda 7, F3)_: `EventEmitterAsyncResource`,
  `AsyncResource.bind` y `AsyncLocalStorage.snapshot()` restauran todo el contexto asíncrono del momento en que se crearon,
  con todos los `AsyncLocalStorage` a la vez; si se crean dentro del `trabajo` de A y se ejecutan desde otra petición, el
  envoltorio ve la marca de A y acepta (criterio 134). No hay una forma fiable de detectarlo en ejecución: desde dentro del
  envoltorio, un callback legítimo de `trabajo` (un temporizador, un evento, la continuación de una promesa) y uno
  restaurado desde otra petición tienen el mismo contexto; un segundo almacén también lo restaura el recurso; y vigilar con
  `async_hooks.createHook` los recursos que se ejecutan anidados dentro de otro contexto daría falsos positivos con los
  propios controladores (un pool que entrega una conexión liberada por otra petición ejecuta así el callback de quien
  esperaba) y tiene un costo en todo el proceso. Se acepta con estas mitigaciones: el lint normal prohíbe
  `EventEmitterAsyncResource`, `getBuiltinModule` de `async_hooks` (criterio 139) y toda importación de `async_hooks`
  (criterio 135) fuera de `infraestructura/`; un nombre armado en tiempo de ejecución no lo ve el lint (como el SQL armado,
  riesgo "El lint es una segunda capa"), y lo buscan el revisor y el adversarial.
- **Error de la propia prueba en el `INSERT` con otra academia** _(ataque ronda 7, F2)_: desde el criterio 138, cualquier
  error del intento cuenta como "no escribió en B", así que una fila de prueba mal armada para una tabla (por ejemplo, una
  columna de un tipo que `jsonb_populate_record` no convierte) pasaría sin probar el `WITH CHECK` de esa tabla. Lo acotan la
  fila de prueba válida en B (criterio 138), el registro del código de cada error distinto de `42501`, la autocomprobación
  (que exige detectar las tablas mal hechas con el mismo mecanismo) y la prueba de forma del criterio 132, que no depende de
  la ejecución.
- **Fila de prueba que no se puede insertar en el `INSERT` con otra academia** _(revisión T93 de la ronda 7, 12/11/2026)_:
  en el paso del `INSERT` del criterio 138, si la fila de prueba de B no se puede insertar por un error distinto de `42501`
  (una restricción, un disparador de validación), la prueba pasa siempre que no quede escrita ninguna fila nueva de B. Una
  política mal escrita que solo se haga visible con un `INSERT` que sí se pueda completar no se detecta por este paso; la
  cubre el criterio 132, que rechaza toda política de una tabla con `academia_id` que no tenga la forma exigida.
- **Otros parámetros de la cadena de consulta** _(ataque ronda 8, O1)_: el criterio 143 rechaza solo los que cambian el
  usuario, la contraseña, el servidor, el puerto o la base. Los demás que entiende `pg` (`application_name`,
  `connect_timeout`, `ssl`, `sslcert`, `sslkey`, `sslrootcert`, `replication`, …) siguen permitidos: no cambian a quién ni
  adónde se conecta la API (`replication` exige el atributo `REPLICATION`, que la comprobación del rol rechaza, criterio
  80). `npm run db:migrar` solo (sin `db:crear` ni `db:preparar`) usa la URL del dueño con el lector propio de Prisma y no
  pasa por el criterio 143; corre como dueño y no cambia el rol de la API (plan, sección 20).
- **Forma de las políticas leída como texto** _(ataque ronda 6)_: la prueba del criterio 132 analiza el texto que devuelve
  `pg_get_expr`, no el árbol interno de PostgreSQL. Con `search_path` fijado, un operador o una función de otro esquema
  aparecen calificados y no cumplen; la prueba de ejecución del criterio 133 es la segunda capa.
- **Parámetros de sesión que no se fijan** _(ataque ronda 9, O2)_: la primera sentencia fija los que cambian cómo se
  interpreta o se guarda lo que la API envía y recibe, o si lo confirmado queda en el disco (criterios 98, 107, 121, 122,
  146 y 147). Los demás se dejan como lleguen, por estos motivos:
  - **fallan cerrados** (la operación termina con error, sin escribir nada distinto): `default_transaction_read_only` y
    `transaction_read_only` (toda escritura falla con `25006`; además, un `SELECT` que ya empezó no puede cambiarlos);
    `row_security = off` (PostgreSQL lanza un error en vez de saltarse una política, y el rol con ese valor propio ya lo
    rechaza el criterio 103); `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` e
    `idle_session_timeout` (cortan la operación y la transacción se revierte); `quote_all_identifiers` (solo cambia el
    texto que devuelven las funciones del catálogo; en la comprobación del rol, una diferencia hace rechazar, nunca
    aceptar);
  - **no bajan las garantías:** `default_transaction_isolation` (PostgreSQL no tiene un nivel más débil que `READ
    COMMITTED`: `READ UNCOMMITTED` se comporta igual, y cuando una historia pide otro nivel, Prisma lo fija en la
    transacción con la opción `aislamiento`, criterio 27); `default_transaction_deferrable` (solo afecta a `SERIALIZABLE READ ONLY`);
    `plan_cache_mode`, `enable_*`, `jit` y los de paralelismo (solo eligen el plan; con funciones `STABLE`, criterio 144,
    no cambian el resultado);
  - **no se usan en 001:** `gin_fuzzy_search_limit` (solo con índices GIN; la historia que cree el primero lo fija),
    `lc_monetary` y `lc_numeric` (solo el tipo `money` y `to_char`/`to_number`; los montos son `numeric`, cuya salida no
    depende de la configuración regional), `xmloption` y `xmlbinary` (no hay XML), `timezone_abbreviations` (el adaptador
    envía las fechas sin abreviaturas de zona, y `TimeZone` es `UTC`, criterio 98), `backslash_quote` y
    `escape_string_warning` (con `standard_conforming_strings` en `on`, criterio 122), y los que solo afectan a sentencias
    de definición (`default_tablespace`, `default_table_access_method`, `check_function_bodies`), que la app no puede
    ejecutar;
  - **solo un superusuario los cambia, y para todo el servidor:** `session_replication_role = replica` (apaga los
    disparadores y las llaves foráneas), `fsync`, `full_page_writes`, `zero_damaged_pages`, `ignore_checksum_failure`,
    `wal_level` y parecidos. La app no puede fijarlos (exigen superusuario) y quien puede cambiarlos ya puede desactivar
    la RLS; es una mala configuración del servidor, no una contaminación de la conexión. Se revisa con el hosting (D-21).
- **Volatilidad de funciones llamadas dentro de otras** _(ataque ronda 9, F1)_: `pg_depend` no registra las llamadas que
  hay dentro del cuerpo de una función. El criterio 144 revisa las funciones de las que depende cada política, las de
  `FUNCIONES_APP` y, por el texto, toda función propia cuyo cuerpo mencione `current_setting`, `app_academia_actual` o
  `app_es_plataforma`. Una función `IMMUTABLE` que lea el estado de la sesión por otro camino (por ejemplo, `current_user`)
  no se detecta; no da la academia, y la ven el revisor y el adversarial.
- **Codificación de la base** _(ataque ronda 9, F2)_: `db:crear` no fija ni comprueba la codificación de las bases (en
  Docker, la CI y la nube es `UTF8`). Con `client_encoding` fijo en `UTF8` (criterio 146), en una base `LATIN1` un
  carácter que no existe en `LATIN1` falla con error (`22P05`) en vez de guardarse alterado, así que falla cerrada.
- **`synchronous_commit` en `on` y no en `remote_apply`** _(ataque ronda 9, O2)_: si un hosting configura réplicas
  síncronas con `remote_apply`, la API confirma con `on` (espera a que la réplica tenga la transacción en su disco, no a
  que la aplique). La durabilidad es la misma; lo único que cambia es si una lectura en la réplica, justo después, ve el
  cambio. La API no lee de réplicas. Se revisa con el hosting (D-21).
- **Lo confirmado por un `COMMIT` escrito dentro de `trabajo`** _(ataque ronda 10, criterio 151)_: la operación se
  rechaza con `ErrorTransaccionAbortada`, pero lo escrito antes de ese `COMMIT` ya quedó confirmado y no se puede deshacer
  (lo que sigue corre fuera de la transacción). Lo prohíbe el lint del criterio 84 y lo buscan el revisor y el
  adversarial; el criterio 151 asegura que, al menos, nunca se responde "éxito".
- **Consulta de un modelo sin `await` en `enPlataforma`** _(ataque ronda 10, criterio 150)_: `enPlataforma` entrega la
  transacción completa de Prisma (P-24), sin el envoltorio que registra las consultas enviadas, así que solo puede ceder
  un turno antes de la comprobación (plan, sección 22). Una consulta de un modelo enviada sin `await` justo antes de
  terminar `trabajo` podría llegar a la conexión después de la comprobación; si falla, el comando informaría éxito. Los
  comandos y la semilla los escribe el equipo, no reciben entradas de terceros y no usan consultas sin `await`; lo busca
  el revisor. En la API (criterio 149) no hay este riesgo: el envoltorio espera todas las consultas enviadas.
  _(Ampliado tras la ronda 12.)_ Lo mismo con una consulta encadenada sin `await` (criterio 156) y con una escritura de un
  delegado que falla a medias (criterio 158): `enPlataforma` no tiene la espera de cadenas ni la capa de puntos de
  guardado. Los comandos y la semilla usan SQL crudo con `await` en cada paso y no atrapan errores dentro de `trabajo`.
- **IP vacía o ausente** _(ataque ronda 10, criterio 152)_: si Express no da `req.ip` (el socket ya se cerró), el
  controlador pasa `null` y se audita sin IP, como hasta ahora; quien la provoca corta su propia conexión y no recibe la
  respuesta. Sin `trust proxy` (plan, "Límite por IP"), el cliente no elige el texto de la IP; si el hosting lo activa,
  un texto inválido hace fallar la operación (criterio 152), nunca la deja sin IP.
- **Consultas lanzadas a la vez dentro de `enPlataforma`** _(ataque ronda 11, F1; decisión del especificador)_:
  `enPlataforma` entrega la transacción completa de Prisma (P-24), sin la cola serial del criterio 153. Si un comando o la
  semilla lanzaran varias consultas en el mismo turno (`Promise.all`, `map` con funciones `async`, `Promise.allSettled`)
  y una fallara con un error que no es de la base (P2025, columna `void`), Prisma no ejecutaría las siguientes, sus
  promesas resolverían con `undefined`, la comprobación del criterio 150 vería la transacción viva y el comando informaría
  éxito sin esas escrituras. Se acepta porque: envolverla cambiaría lo que reciben los comandos (P-24) y la forma perezosa
  de la `PrismaPromise` de la que dependen las pruebas protegidas de los criterios 101 y 150 (`Prisma.raw`,
  `Prisma.sql`, "una `PrismaPromise` sin `then` ni `catch` no se envía"), y exigiría envolver el cliente completo con un
  `Proxy` (descartado en la ronda 3) o reescribir los comandos sobre `ClienteTransaccion`; los comandos y la semilla los
  escribe el equipo, corren una sola vez y en serie, no reciben entradas de terceros, y hoy no lanzan consultas a la vez;
  y quien los ejecuta ve el resultado. Regla para el equipo (comentario en `enPlataforma` y plan, sección 23): en comandos
  y en la semilla no se lanzan consultas en paralelo dentro de `enPlataforma`. Lo buscan el revisor y el adversarial.
- **Tiempo límite con una operación de varias sentencias a medias** _(ataque ronda 11, O2)_: algunas operaciones de
  Prisma envían varias sentencias (por ejemplo, una escritura anidada o un `upsert`). Si Prisma cierra la transacción por
  `DURACION_MAXIMA_MS` mientras una de ellas va a medias, las sentencias que faltan pueden llegar a la conexión fuera de la
  transacción. Falla cerrada: fuera de la transacción no están `app.academia_id` ni `app.plataforma` (se fijan con
  `set_config(…, true)`, criterio 72), así que la RLS no deja leer ni escribir filas de ninguna academia ni de la
  plataforma (una inserción falla por la política, una actualización o un borrado tocan 0 filas), y las llaves compuestas
  con `academia_id` impiden enlazar filas de otra academia; la operación ya rechazó por tiempo. La única excepción sería
  una conexión con valores de contexto de sesión puestos por `options` en `DATABASE_URL_APP`, que es una mala
  configuración del `.env` (la API no la pone y el criterio 72 la neutraliza dentro de toda transacción). Con la cola del
  criterio 153 hay a lo sumo una operación en curso por transacción. _(Ampliado tras la ronda 12, O3.)_ Lo mismo cuando
  `trabajo` lanza mientras una operación de varias sentencias, enviada sin `await`, sigue en curso: `descartar()` solo
  detiene las de la cola, Prisma revierte la transacción y las sentencias que faltan de esa operación (y las de su punto
  de guardado, criterio 158) llegan fuera de ella o Prisma las rechaza por la transacción cerrada; fuera de la transacción
  la RLS no deja leer ni escribir nada (comprobado por el adversarial en la ronda 12) y la operación ya rechazó con el
  error de `trabajo`. Con el nombre aleatorio del punto de guardado, una sentencia de la capa que llegara a otra
  transacción en la misma conexión fallaría (el punto no existe) y la abortaría, que falla cerrada (criterio 149).
- **Continuación sin `await` que espera algo ajeno a la base** _(ataque ronda 12, criterio 156)_: si una cadena sin
  `await` dentro de `trabajo` espera un temporizador, un archivo, un hash u otra cosa que no termina en el mismo turno, su
  consulta puede llegar cuando el envoltorio ya se apagó. Si llega antes de la última revisión, la operación rechaza sin
  nada escrito; si llega mientras Prisma confirma o después, la llamada rechaza sin enviarse y la operación ya respondió
  éxito sin esa escritura (con `void`, el rechazo queda registrado por el manejador del criterio 157; con `.catch`, se
  pierde en silencio). No hay forma de saber desde `BaseDatos` que una continuación ajena todavía va a llamar; esperar un
  tiempo fijo antes de confirmar no lo garantiza y retrasa todas las operaciones. Regla para el equipo: cada paso de
  `trabajo` se espera con `await`; nada de cadenas sueltas con `.then` ni `void` dentro de una transacción. Lo buscan el
  revisor y el adversarial.
- **Sentencia cruda ejecutada cuyo resultado Prisma no pudo leer** _(ataque ronda 12, criterio 158)_: `$queryRaw` y
  `$executeRaw` no llevan punto de guardado (una sentencia es atómica y envolver cada lectura triplicaría sus viajes). Si
  una sentencia cruda que escribe (por ejemplo, un `WITH … INSERT … RETURNING` con una columna de tipo `void`) se ejecuta
  entera y Prisma falla al leer el resultado, lo escrito queda y `trabajo` recibe un error que no es de la base; si lo
  atrapa, se confirma la sentencia completa (no una parte). Lo evita la forma del criterio 155 y lo busca el revisor.
- **Dos sentencias más por escritura de un delegado** _(ataque ronda 12, criterio 158)_: crear y liberar el punto de
  guardado agregan dos viajes a la base por escritura (tres más si rechaza sin abortar). Con el volumen de una academia
  no se nota; si una historia escribe muchas filas, usa `createMany` (una sola operación) o `$executeRaw`.
  _(Ampliado tras la ronda 13, O2.)_ Cada punto de guardado en el que se escribe es una subtransacción con su propio
  identificador, y los liberados siguen contando hasta que la transacción termina. Con más de 64 escrituras de modelos
  que escriben dentro de una misma transacción, PostgreSQL desborda la caché de subtransacciones de esa conexión
  (`subxact_overflowed`): mientras la transacción sigue abierta, las demás conexiones del servidor (todas las academias)
  tienen que consultar `pg_subtrans` para armar sus instantáneas y todo se vuelve más lento. Las lecturas y `$queryRaw` o
  `$executeRaw` no abren puntos de guardado, y una escritura que se deshace con `ROLLBACK TO` deja de contar. Se acepta
  porque las operaciones de 001 escriben dos o tres filas por transacción. Regla para el equipo: para cargas masivas
  (importaciones, generación de mensualidades, cierres) se usa `createMany`, `updateMany` o `deleteMany` (una operación,
  un punto de guardado) o `$executeRaw` (ninguno), nunca un bucle de escrituras de un modelo dentro de una transacción. Lo
  vigila el revisor desde la historia 005.
- **Promesa descartada que escapa al lint** _(ataque ronda 13, criterios 159 y 160; **corregido** tras la ronda 14, O1, y
  ampliado con el criterio 164)_: las reglas del criterio 159 no ven una promesa guardada en una variable y nunca esperada
  (`const p = (async () => { … })();`: `@typescript-eslint/no-unused-vars` la señala si `p` no se usa en absoluto, pero no
  si se usa sin esperarla, por ejemplo guardándola en un objeto o pasándola a otra función) ni una pasada a una función
  que no la espera, y el paso protegido (sin tipos) no ve una función `async` con nombre llamada sin `await` (el lint
  normal sí). Desde la ronda 14 (criterio 164), la regla propia sí ve una función `async` escrita en el lugar pasada a
  `process.nextTick`, `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask`; no ve una función `async` con nombre
  pasada por referencia a esas funciones, un alias de ellas ni `.call`, `.apply` o `Reflect.apply`.
  **Qué pasa en ejecución con esa promesa (texto corregido en la ronda 14):** el criterio 160 solo marca la transacción si
  la operación del envoltorio rechaza **después** de que `trabajo` terminó (desde `asentar()`). Con la cola serial, lo
  habitual es lo contrario: la operación de la promesa olvidada se entrega y rechaza mientras `trabajo` sigue esperando su
  consulta siguiente; ese rechazo es "mientras `trabajo` sigue en curso" (criterios 153, 154 y 160: no marca nada), así que
  `trabajo` devuelve, se confirma lo anterior y falta lo que venía después en la función olvidada (por ejemplo, la
  auditoría). Reproducido en la ronda 14: en `conAcademia`, `await configuracion.create(<cobro>)`; `const paso = (async
  () => { await configuracion.update(<no existe>); await auditoria… })()`; `await configuracion.findMany(…)`; `return
  'OK'` → se confirma el cobro sin auditoría y solo queda el registro del criterio 157 (ya limpio por el 162). El 160 la
  cubre solo si la operación rechaza después de que `trabajo` devolvió. Si la función falla **fuera** del envoltorio (por
  ejemplo, `ipParaAuditoria` que lanza entre dos consultas), la consulta siguiente nunca se llama y pasa lo mismo, en
  cualquier momento. _(Texto anterior, que la ronda 14 corrige: "Si esa función falla dentro del envoltorio después de
  que `trabajo` terminó, el criterio 160 hace rechazar la operación; pero si falla **fuera** del envoltorio (…), la
  consulta siguiente nunca se llama, nada marca la transacción y se confirma lo anterior sin lo que faltaba (el rechazo
  queda en el registro por el manejador del criterio 157, ya limpio por el 162)". Era cierto, pero daba a entender que
  el caso dentro del envoltorio quedaba cubierto, y lo habitual es que no.)_ La forma con `.catch` al final de la cadena
  (`x.then(…).catch(fn)`) sigue siendo comportamiento esperado: si el rechazo llega mientras `trabajo` corre, se atrapa y
  se sigue (153); si llega después, la operación rechaza (160). No se agrega un mecanismo en ejecución, por las mismas
  razones por las que la ronda 13 descartó la marca por `unhandledRejection` (F1 (c)). Lo mismo con una llamada con un argumento
  no admitido dentro de una continuación durante `asentar()` (el criterio 156 decide que no marca): es un error de
  programación que falla siempre y lo ven las pruebas de la historia. Se acepta porque el lint cubre las formas
  habituales (`void`, la función escrita en el lugar, la llamada como sentencia) y no hay una forma fiable de saber desde
  `BaseDatos` que una función ajena iba a seguir llamando (la marca por `unhandledRejection` se evaluó y se descartó:
  "Decisiones técnicas tras el ataque, ronda 13"). Regla para el equipo, como en la ronda 12: dentro de `trabajo`, cada
  paso con `await`. Lo buscan el revisor y el adversarial. _(Precisado tras la ronda 14, O1: dentro de `trabajo`, **toda
  promesa creada se espera antes de devolver**, también la guardada en una variable o en un objeto; el revisor lo vigila en
  cada historia, plan, sección 26.)_ _(Ampliado tras la ronda 15: tampoco ven, en el paso protegido, y algunas tampoco en
  el lint normal con tipos, estas formas que el adversarial encontró: `process.nextTick(async function () { … }.bind(this))`
  (la función `async` envuelta en `.bind`), `setTimeout(() => (async () => { … })(), 0)` (la llamada directa dentro del
  cuerpo de una flecha, que no es una sentencia), `(c ? setTimeout : setImmediate)(async () => { … })` (el `callee` es una
  expresión condicional), `(0, process.nextTick)(async () => { … })` (una expresión con coma) y
  `x && (async () => { … })()` (la llamada dentro de una expresión lógica). Son alias o formas hostiles, como las de la
  ronda 14; no se amplía la regla (decisión del orquestador). El revisor las busca junto con las anteriores.)_
- **Encabezado de la pila que no coincide** _(ataque ronda 14, criterio 163)_: si el `stack` de un error de la base no
  empieza con `nombre: mensaje` (una librería que reemplaza `Error.prepareStackTrace` con otro formato, o un `message` que
  alguien cambió después de que se formó la pila), el registro técnico sale sin `pila`. Se acepta: se pierde parte del
  diagnóstico, nunca se muestra un dato. Si el mensaje se acortó después de formada la pila exactamente en un salto de
  línea, las líneas que quedaron del mensaje anterior se leerían como si siguieran al encabezado; es un error de
  programación (nadie cambia el `message` de un error de Prisma en AquaGestión) que el revisor busca junto con "Mensajes
  propios que copian el de Prisma".
- **Mensajes propios que copian el de Prisma** _(ataque ronda 13, criterio 162)_: `errorParaRegistro` limpia los errores de
  Prisma y de la base y los que los llevan como `cause`, pero no puede limpiar un `Error` propio cuyo mensaje se armó con
  el de Prisma (`` new Error(`falló: ${error.message}`) ``). Regla para el equipo: un error propio nunca copia el mensaje de
  otro; se encadena con `{ cause }`. Lo busca el revisor. _(Precisado tras la ronda 15, criterio 165: si el error de la
  base sigue en el grafo del error propio (por `cause`, `response` o cualquier otra propiedad), un mensaje que lo contiene
  o que está contenido en él ya no sale; sigue sin cubrirse la copia sin el error de la base en el grafo
  (`new InternalServerErrorException(error.message)`, `new InternalServerErrorException({ message: error.message })`,
  `` new Error(`falló: ${error.message}`) `` sin `cause`) y la copia de partes no contiguas. Regla para el equipo, desde la
  ronda 15: a una excepción de Nest se le pasa un mensaje propio y `{ cause: error }`, nunca el error ni su mensaje como
  respuesta. El revisor busca `Exception(error`, `Exception(e)`, `Exception(err` y `.message` dentro de un `catch`.)_
- **Errores de la base fuera del alcance de la búsqueda** _(ataque ronda 15, criterio 165)_: la búsqueda de
  `errorParaRegistro` mira las propiedades propias (también no enumerables y con `Symbol`) y las enumerables heredadas, a
  través de objetos y arreglos. No ve un error de la base guardado en el contenido de un `Map`, un `Set` o un `WeakMap`, en
  un campo privado (`#campo`), en una variable de una clausura, en una propiedad de una función, detrás de un getter
  heredado no enumerable ni dentro de un `WeakRef`. pino tampoco serializa esos lugares (recorre las propiedades
  enumerables y `cause`), así que no llegan al registro de la API; sí podría mostrarlos un `console.error` o un
  `util.inspect` con `showHidden` hecho a mano, que la regla del criterio 162 ya prohíbe. Se acepta: son formas que nadie
  usa para guardar un error y que el revisor ve. _(Corregido tras la ronda 16, O1, criterio 168: el riesgo era mayor de lo
  descrito. pino no recorre solo las enumerables: lee `cause` por su nombre (también un getter heredado no enumerable) y,
  si es una función, la llama (estilo VError), y agrega el mensaje y la pila de lo que obtiene al `message` y al `stack`
  registrados; también lee `errors` por su nombre. Así, un error de Prisma detrás de un getter `cause` sobre un campo
  privado, o devuelto por una `cause` función, llegaba entero al registro. Desde la ronda 16, la búsqueda lee `cause` y
  `errors` por su nombre en cada objeto visitado y una `cause` función es falla cerrada sin llamarla. Lo que sigue sin
  verse: el contenido de un `Map`, un `Set` o un `WeakMap`, un campo privado o una clausura **salvo** a través de un
  getter `cause` o `errors`, una propiedad de una función (salvo que esa función sea la `cause`, que es falla cerrada),
  los getters heredados no enumerables con **otro** nombre (pino no los lee), un `WeakRef` y, desde el criterio 167, una
  propiedad con nombre agregada a un `Buffer` o a un arreglo tipado (hojas binarias: pino serializaría las de un arreglo
  tipado que no es `Buffer` y `util.inspect` las de los dos). Se acepta por las mismas razones: formas que nadie usa para
  guardar un error, y el revisor las busca.)_
- **Diagnóstico perdido en errores grandes** _(ataque ronda 15, criterio 165)_: un error cuyo grafo pasa de 10 niveles,
  200 objetos o 100 claves en un objeto (por ejemplo, uno que guarde una petición HTTP entera o un `Buffer`) se registra solo
  con su tipo y `truncado: true`, aunque no lleve ningún dato de la base. Se acepta: falla cerrada; si una historia
  necesita registrar errores así, pide ajustar los topes con una decisión nueva. _(Corregido tras la ronda 16, F1, criterio
  167: el riesgo no era solo de diagnóstico. Hasta la ronda 15, el tope de 100 claves se comparaba después de juntarlas
  todas: con un `Buffer` de 5 MB en el error, registrar un 500 bloqueaba el proceso 6,9 s y usaba 707 MB, y con 256 MB de
  memoria el proceso caía, cortando las peticiones en curso de todas las academias; un arreglo de 2 millones, 1,8 s; un
  `new String` de 5 millones, 7,3 s. Desde la ronda 16 el costo está acotado: los binarios son hojas (el error se registra
  como si no los llevara; pregunta abierta R16-1 sobre su contenido), los arreglos, objetos `String` y objetos con
  `length` mayor que 100 se cortan sin listarlos y la enumeración se corta al pasar el tope. Sigue la pérdida de
  diagnóstico para esos casos y para los grafos de más de 10 niveles o 200 objetos. Lo que queda del costo está en
  "Objetos sin `length` con millones de claves".)_
- **Objetos sin `length` con millones de claves** _(ataque ronda 16, criterio 167)_: `Reflect.ownKeys` entrega todas las
  claves propias de un objeto de una vez y `for…in` las junta dentro del motor antes de dar la primera; en JavaScript no
  hay forma de pedirlas por partes. Un objeto sin `length` con millones de claves propias (por ejemplo, `{ ...buffer }` u
  `Object.assign({}, arreglo)`, que copian los índices como claves) o un prototipo con millones de enumerables, dentro de
  un error, cuesta lo que el motor tarde en listarlas (con millones de índices, segundos) antes de que la búsqueda vea que
  pasan del tope. Se acepta: nadie guarda así un dato en un error; el criterio 167 cubre las formas en que llegan datos
  grandes de verdad (binarios, arreglos y textos). Regla para el equipo: un error no lleva copias de un archivo ni de una
  lista; el revisor busca `...` y `Object.assign({}, …)` de un `Buffer` o arreglo dentro de un error.
- **Contenido de un binario en el registro** _(ataque ronda 16, criterio 167; pendiente de la pregunta abierta R16-1)_:
  con los binarios como hojas, un `Error` sin errores de la base que lleva un archivo en cualquier propiedad se devuelve
  tal cual y pino escribe su contenido (`{"type":"Buffer","data":[…]}`, millones de números en una línea de decenas de
  MB). Si el archivo es un comprobante (HU-08), con nombre, teléfono o DNI de quien pagó, esos datos quedan en el registro
  técnico (Ley 29733). Hasta la ronda 15 ese caso salía como `truncado` (lento, pero sin el contenido). Provisional
  (decisión del orquestador): hoja y mismo error. Regla para el equipo mientras tanto: un error nunca lleva el contenido
  de un archivo; lleva su clave en `AlmacenArchivos` (D-19). Lo busca el revisor desde la historia de comprobantes.
- **Tipo `money` en consultas** _(ataque ronda 15, O2)_: `` $queryRaw`SELECT ${'44556677'}::money` `` rechaza con un
  `Error` común de `decimal.js` (`[DecimalError] Invalid argument: 44,556,677.00`), que no es un error de la base y se
  registraría con el valor. Hoy nada usa `money`. Regla para todas las historias (plan, sección 27): no se usa el tipo
  `money` de PostgreSQL, ni en columnas ni en conversiones; los montos van en `numeric` y `Decimal` (`CLAUDE.md`). Lo
  vigila el revisor (`rg -i "money" backend/`).
- **Argumentos que `trabajo` cambia después de llamar** _(ataque ronda 11, criterio 153)_: una consulta que espera en la
  cola lee sus argumentos cuando le toca; si `trabajo` cambia el objeto que pasó (por ejemplo, `data`) antes de ese
  momento, puede enviarse con el cambio. No cruza academias (el contexto y la RLS son los de la transacción) y es un error de
  programación; lo ve el revisor.
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

### Decisiones técnicas tras el ataque, ronda 7 (12/11/2026)

- **La API y `db:crear` excluyen los objetos de extensiones en todos los esquemas, incluido `public`** (criterio 137;
  decisión del orquestador, alineada con el criterio 130 y su riesgo aceptado). Alternativas descartadas: que la API vuelva
  a contarlos en `public` (rechazaría hostings que instalan `pg_stat_statements` u otras extensiones en `public`, y la API
  no atendería) y dejar la divergencia (`db:crear` propondría `REVOKE` sobre objetos de la extensión, que la dañan, y el
  responsable no sabría qué decide la API). La prueba de catálogo del criterio 137 impide que la exclusión tape las tablas
  propias.
- **El `INSERT` con otra academia se juzga por lo que deja escrito, con una fila de prueba válida en B** (criterio 138;
  decisión del orquestador sobre el resultado, precisión del especificador sobre la fila). Alternativas descartadas: exigir
  `42501` (falso positivo con disparadores legítimos) y "cualquier error pasa" con la copia de una fila de A (una política
  mal hecha quedaría oculta por el `23505` de la llave primaria o el `23503` de una llave foránea compuesta).
- **`EventEmitterAsyncResource` y `getBuiltinModule` de `async_hooks` en el lint normal; sin detección en ejecución**
  (criterio 139). Alternativas descartadas: detectarlo en el envoltorio con `async_hooks.createHook` (falsos positivos con
  los controladores y costo en todo el proceso; riesgo aceptado "Contexto restaurado por un recurso asíncrono") y prohibir
  `events` entero (los eventos emitidos dentro de `trabajo` son legítimos, criterio 134).
- **La subconsulta escalar `(SELECT app_academia_actual())` cuenta como la comparación** (criterio 140). Alternativa
  descartada: exigir la llamada directa (empujaría a peores planes en tablas grandes o a saltarse la prueba).

### Decisiones técnicas tras el ataque, ronda 8 (12/11/2026)

- **Los esquemas de extensiones se revisan; solo se excluyen los objetos de extensión** (criterios 141 y 142; decisión del
  orquestador). Alternativas descartadas: seguir excluyendo el esquema entero (cualquier tabla propia creada dentro, o un
  esquema propio agregado a una extensión, queda fuera de todas las guardas) y agregar los esquemas del hosting a una lista
  fija (depende de cada proveedor y no cubre `ALTER EXTENSION … ADD SCHEMA`).
- **Un tipo compuesto de una extensión cuenta como objeto de extensión por su `reltype`** (criterio 141; precisión del
  especificador). Alternativas descartadas: no contar nunca los tipos compuestos (cambiaría el sentido del criterio 130 para
  los tipos propios) y contarlos como propios (con el criterio 141, el `USAGE` sobre un esquema de una extensión con tipos
  compuestos, como `topology`, se rechazaría sin motivo).
- **Rechazar en la cadena de consulta los parámetros que cambian el usuario, el servidor o la base** (criterio 143;
  decisión del orquestador). Alternativas descartadas: que `db:crear` lea la URL con `pg-connection-string` como la API (es
  una dependencia que el hook no puede cargar sin `node_modules`, y el comando y la API seguirían aceptando una URL ambigua)
  y rechazar toda cadena de consulta (las pruebas y los hostings usan `options` y `sslmode`).

### Decisiones técnicas tras el ataque, ronda 9 (12/11/2026)

- **La volatilidad y el cuerpo de las funciones de contexto se fijan con una prueba de catálogo, más una prueba de
  ejecución con plan guardado** (criterios 144 y 145; decisión del orquestador). Alternativas descartadas: solo la prueba
  de ejecución (depende de cuándo PostgreSQL elige el plan genérico; el catálogo lo dice sin ambigüedad) y marcar las
  funciones `VOLATILE` (correcto, pero PostgreSQL deja de usar los índices que empiezan por `academia_id`). Se revisa
  también, por el texto, toda función propia que lea `current_setting` o las funciones de contexto, porque `pg_depend` no
  registra las llamadas dentro de otra función (precisión del especificador).
- **`client_encoding`, `synchronous_commit`, `array_nulls` y `transform_null_equals` en la primera sentencia** (criterios
  146 y 147; decisión del orquestador para los dos primeros y del especificador para los otros dos). Alternativas
  descartadas: rechazar esos parámetros en `options` (no cubre la conexión, la base, `ALTER ROLE ALL` ni el servidor,
  como en el criterio 107) y fijar todos los parámetros de sesión (muchos no cambian lo que se escribe, fallan cerrados o
  solo los puede fijar un superusuario; riesgo aceptado "Parámetros de sesión que no se fijan").
- **`synchronous_commit = 'on'` fijo** (criterio 147). Alternativa descartada: rechazar solo los valores más débiles que
  `on` y respetar `remote_write` o `remote_apply` (más casos y más código para una diferencia que no es de durabilidad;
  riesgo aceptado "`synchronous_commit` en `on` y no en `remote_apply`").
- **`db:crear` y el hook exigen que `DATABASE_URL_APP` apunte al servidor, el puerto y la base de `DATABASE_URL`,
  comparando el texto del servidor sin resolver nombres** (criterio 148; decisión del orquestador, precisión del
  especificador sobre la comparación). Alternativas descartadas: que `db:crear` revise la base de `DATABASE_URL_APP` en
  lugar de la de `DATABASE_URL` (son dos bases distintas solo por error; mejor detenerse y decirlo) y resolver los
  nombres del servidor (`localhost` y `127.0.0.1` pueden ser servidores distintos en Windows, donde `localhost` puede
  resolverse a `::1`; `.env.example` ya usa `127.0.0.1` en las tres).

### Decisiones técnicas tras el ataque, ronda 10 (12/11/2026)

- **Una sentencia de comprobación en la misma transacción, después de `trabajo` y antes de confirmar** (criterios 149 y
  150; decisión del orquestador, mecanismo del especificador). La sentencia lee una marca aleatoria que la primera
  sentencia fijó con `set_config(…, true)`: falla con `25P02` si la transacción está abortada y devuelve otro valor si un
  `ROLLBACK` o un `COMMIT` escritos la cerraron (criterio 151). Alternativas descartadas: leer la etiqueta del `COMMIT`
  (el adaptador de Prisma la descarta; habría que envolver el pool de `pg` con código propio, que depende de detalles
  internos del adaptador y de un paquete fuera de la lista del criterio 127); registrar en el envoltorio los errores de
  las consultas y rechazar si hubo alguno (no cubre `enPlataforma`, que entrega la transacción completa, ni un
  `ROLLBACK` escrito, y rechazaría transacciones que sí se pueden confirmar); y prohibir por lint todo `catch` dentro de
  `trabajo` (no se puede seguir a través de funciones y alias, y prohibiría atrapar errores que no son de la base).
- **El envoltorio espera las consultas que envió antes de comprobar** (criterio 149). Alternativa descartada: confiar en
  el orden de la cola de la conexión (una consulta de un modelo recorre más pasos dentro de Prisma que una cruda y puede
  llegar después de la comprobación).
- **`ErrorTransaccionAbortada` propio, 500 `ERROR_INTERNO`** (P-36). Alternativa descartada: relanzar el error original
  (`trabajo` ya lo atrapó y puede no conocerse, y en el caso del `ROLLBACK` escrito no hay error original); un 500 es lo
  correcto porque es un error de programación, no de la entrada.
- **IP con zona: se quita la zona; una IP que sigue siendo inválida hace fallar la operación** (criterio 152, opción (a);
  decisión del especificador). RN-22 y RNF-06 piden una auditoría completa (quién, cuándo y qué), y CLAUDE.md la exige
  para toda operación de caja, pagos, horarios y ajustes. Alternativa descartada, opción (b): guardar `NULL` cuando la IP
  no es válida; quien controle el texto de la IP (hoy nadie; mañana, si el hosting activa `trust proxy`, cualquiera con
  `X-Forwarded-For`) podría registrar sus operaciones sin IP y evadir esa parte de la auditoría. Con (a), lo peor que
  logra es que falle su propia operación, sin nada escrito.
- **Los duplicados esperados se resuelven con `ON CONFLICT DO NOTHING RETURNING`** (plan, nota O3 ampliada). Alternativa
  descartada: atrapar `esViolacionDeUnicidad` dentro de `trabajo` y seguir (PostgreSQL deja la transacción abortada; un
  `SAVEPOINT` lo permitiría, pero el lint del criterio 84 lo prohíbe y agregarlo es otra superficie).

### Decisiones técnicas tras el ataque, ronda 11 (12/11/2026)

- **Cola serial en el envoltorio** (criterio 153; decisión del orquestador). Ataca la causa: sin dos consultas pendientes
  a la vez, Prisma no arma lotes y cada consulta recibe su propio resultado o error. No cuesta paralelismo real: una
  transacción usa una sola conexión y PostgreSQL ejecuta una sentencia a la vez. Alternativas descartadas: solo detectar
  el `undefined` (la operación fallaría con 500 aunque el código fuera correcto, como el caso de la lista que ignora las
  inexistentes); prohibir `Promise.all` por lint (no sigue funciones ni alias, y `map` con funciones `async` es un patrón
  común); desactivar los lotes de Prisma (no se conoce una opción documentada para eso en transacciones interactivas, y
  dependería de detalles internos de la versión).
- **Segunda capa: `undefined` = transacción incompleta** (criterio 154; decisión del orquestador). Si una versión futura
  de Prisma arma lotes por otro camino o la cola tiene un error, la operación falla cerrada en lugar de confirmar a
  medias. Alternativa descartada: resolver con `undefined` y dejar que `trabajo` decida (es justo lo que permitió la
  falla).
- **`enPlataforma` no se envuelve** (decisión del especificador). Envolverla rompe P-24 y la forma perezosa de la
  `PrismaPromise` que usan las pruebas protegidas de los comandos, y exige un `Proxy` del cliente completo (descartado en
  la ronda 3). Los comandos y la semilla los escribe el equipo, corren en serie y no reciben entradas de terceros; queda
  como riesgo aceptado con una regla para el equipo. Alternativa descartada: una cola sobre la transacción cruda con un
  `Proxy` que conserve la `PrismaPromise` (más superficie que el riesgo que cubre).
- **Bloqueo de transacción con `$executeRaw`** (criterio 155, O1; decisión del especificador). Alternativa descartada:
  envolver la función de PostgreSQL en una propia que devuelva `boolean` (otra función en `FUNCIONES_APP`, otra
  migración y otra superficie del criterio 144, para lo que resuelve una forma de llamar).

### Decisiones técnicas tras el ataque, ronda 12 (12/11/2026)

- **El envoltorio acepta llamadas hasta que `asentar` termina, y el resultado esperado de una cadena sin `await` es "todo
  confirmado"** (criterio 156; decisión del especificador). Una cadena que solo espera consultas de la transacción es
  código correcto que se puede completar sin ambigüedad, y la operación debe hacer lo que el código dice. Alternativas
  descartadas: rechazar siempre que llegue una llamada después de que `trabajo` terminó (fallaría con 500 un código que
  sí se puede completar, y la regla dependería de cuántos turnos tarda la cadena); y solo marcar la llamada tardía sin
  seguir aceptando (deja como única salida el rechazo, con el mismo problema). La marca de la llamada tardía queda como
  segunda capa para lo que llega después del último turno.
- **Ceder un turno completo del ciclo de eventos (`setImmediate`) antes de apagar** (criterio 156). Alternativa
  descartada: revisar la cola solo tras las microtareas (una función `async` con varios `await` intermedios llama después
  de que `Promise.allSettled` resuelve y se perdería); esperar un tiempo fijo (retrasa todas las operaciones y no
  garantiza nada para lo que espera un temporizador o un archivo).
- **Una llamada rechazada por otro contexto solo marca desde que empieza `asentar`** (criterio 156). Mientras `trabajo`
  corre, el criterio 134 no cambia (y otra petición no puede hacer fallar esta); después, una continuación que perdió el
  contexto asíncrono es la misma falla del ataque y debe fallar cerrada.
- **Manejador de `unhandledRejection` en `main.ts` que registra y no termina el proceso** (criterio 157; decisión del
  especificador). Un rechazo sin manejar en la API es un error de programación dentro de una petición; la integridad la
  dan las transacciones (cada una se confirma entera o se revierte, criterios 149, 154, 156 y 158), y terminar el proceso
  corta las peticiones en curso de todas las academias, incluidos cobros y verificaciones, y deja una forma de tumbar la
  API a quien encuentre cómo provocarlo. Se registra en nivel `error` con el error completo, como un 500, así que no se
  oculta. Alternativas descartadas: dejar el comportamiento de Node (termina el proceso); registrar y terminar
  (la misma caída, con registro); manejar también `uncaughtException` (tras una excepción síncrona el estado del proceso
  no es fiable y Node recomienda terminar). Se registra después de `listen` para que un fallo al arrancar siga terminando
  el proceso.
- **Opción (a), punto de guardado por escritura, en una capa debajo del envoltorio** (criterio 158; decisión del
  especificador). Es viable: la capa emite `SAVEPOINT`, `RELEASE SAVEPOINT` y `ROLLBACK TO SAVEPOINT` con la misma
  transacción de Prisma (la misma conexión), una sentencia después de otra y dentro de la posición de la cola de la
  escritura, en `infraestructura/prisma/`, donde el lint del criterio 84 no aplica. Va debajo del envoltorio y no dentro
  de él porque la prueba protegida de P-38 entrega a `envolver` una transacción falsa y comprueba qué consulta se
  entrega y cuándo: con las sentencias dentro del envoltorio, la primera entregada sería el `SAVEPOINT` y no la
  escritura, y esas pruebas cambiarían de resultado. Alternativas descartadas: la opción (b), marcar la transacción ante
  todo rechazo de una escritura (convertiría en 500 el patrón válido de la lista que ignora las inexistentes, criterio
  153, o exigiría distinguir por los argumentos qué escritura tiene relaciones anidadas, lo que depende de detalles de
  Prisma como el troceo de `createMany`); y el punto de guardado solo en las escrituras con relaciones anidadas (la misma
  dependencia de cómo Prisma reparte cada operación en sentencias).
- **Con un error de la base no se vuelve al punto de guardado** (criterio 158). Antes de volver, la capa comprueba el
  estado con una sentencia: si la transacción está abortada, la deja así. Mantiene sin cambios los criterios 149 y 153
  (un error de la base atrapado hace rechazar la operación; las consultas siguientes reciben `25P02`) y la nota O3 de la
  ronda 10 (los duplicados esperados van con `ON CONFLICT`). Alternativa descartada: decidir por el código del error
  (depende de que Prisma conserve el SQLSTATE en cada caso; la comprobación lo pregunta a PostgreSQL).
- **Nombre aleatorio del punto de guardado por transacción** (criterio 158). Alternativa descartada: un nombre fijo (una
  sentencia de la capa que llegara tarde a otra transacción en la misma conexión podría deshacer una escritura ajena con
  el mismo nombre de punto; con un nombre aleatorio, falla y la otra transacción falla cerrada).
- **El permiso del criterio 153 de atrapar un P2025 se mantiene** para toda escritura de un delegado (criterio 158):
  con el punto de guardado, lo que se confirma nunca incluye una parte de la operación que falló. Alternativa descartada:
  limitarlo a escrituras sin relaciones anidadas (la regla tendría que vivir en el lint o en la revisión, y la capa ya lo
  hace seguro).

### Decisiones técnicas tras el ataque, ronda 13 (12/11/2026)

- **Corrección de fondo en dos capas: lint y ejecución** (criterios 159 y 160; decisión del orquestador). Alternativa
  descartada: corregir caso por caso (la falla es la misma familia que las rondas 11 y 12: una promesa que nadie espera y
  que falla después de que `trabajo` terminó; cada caso cerrado dejaba otra forma abierta).
- **El lint con dos reglas: `no-floating-promises` con tipos en el lint normal y una regla propia sin tipos en los dos
  pasos** (criterio 159; forma del especificador). `no-floating-promises` con `ignoreVoid: false` ve todas las promesas
  descartadas, pero necesita información de tipos, que el paso protegido no usa, y es una regla de `typescript-eslint`, que
  la prueba protegida del criterio 96 no admite en ese paso. La regla propia cubre en el paso protegido (que ningún
  comentario apaga) las dos formas que no necesitan tipos: `void` y la función `async` escrita en el lugar. Alternativas
  descartadas: agregar `no-floating-promises` al paso protegido (cambiaría la prueba protegida del 96 y obligaría a
  analizar con tipos un paso que hoy es rápido y sin tipos); una sola regla sin tipos (no ve una función `async` con
  nombre); `no-restricted-syntax` para la forma sin tipos (en el lint normal ya la usa la regla del reloj sobre los mismos
  archivos, y dos configuraciones de la misma regla se pisan en lugar de sumarse).
- **`void 0` permitido; todo otro `void`, prohibido en `backend/src`** (criterio 159). Sin tipos no se sabe si la
  expresión es una promesa; el código actual solo usa `void` con promesas. Alternativa descartada: prohibir solo `void`
  sobre una llamada (se evade con `void p`).
- **Desde `asentar()`, todo rechazo de una operación entregada marca la transacción, aunque se atrape** (criterio 160;
  decisión del orquestador). Una continuación que corre después de que `trabajo` devolvió ya no puede decidir seguir: la
  operación ya respondió su valor, así que confirmar sería guardar la mitad. Alternativas descartadas: marcar solo los
  rechazos sin manejar (no se puede saber desde el envoltorio si alguien va a atrapar la promesa; un `.catch(() =>
  undefined)` repetiría la falla); y marcar todo rechazo, también mientras `trabajo` corre (rompería el patrón válido de
  la lista que ignora las inexistentes, criterio 153).
- **Las llamadas rechazadas al llamar siguen el criterio 156** (criterio 160). Un argumento no admitido no marca, como
  fija una prueba protegida del 156; es un error de programación que falla siempre (riesgo aceptado "Promesa descartada
  que escapa al lint"). Alternativa descartada: marcarlas también (cambiaría esa prueba protegida).
- **La marca por `unhandledRejection` (F1 (c)) no se adopta** (decisión del especificador por encargo del orquestador).
  Cómo funcionaría: en Node 22, `processPromiseRejections` (`lib/internal/process/promises.js`) emite `unhandledRejection`
  después de restaurar el contexto asíncrono de la promesa rechazada cuando esta tiene identificadores de `async_hooks`,
  así que `AsyncLocalStorage.getStore()` en el manejador probablemente devolvería la marca de la transacción para una
  función `async` creada dentro de `trabajo`. El especificador no lo ejecutó (su rol no ejecuta código), y la decisión no
  depende de ese dato: (1) las promesas que devuelve el envoltorio no llevan esos identificadores (el criterio 106 les
  quita las claves propias), así que esta capa no vería sus rechazos, que ya cubre el 160; (2) depende de un detalle
  interno de Node y de cómo se implementa `AsyncLocalStorage`, que Node 24 cambia (`AsyncContextFrame`): al actualizar la
  versión la capa podría dejar de funcionar sin aviso; (3) necesita un manejador del proceso: registrado por
  `BaseDatos`, taparía en las pruebas y en los comandos los rechazos que hoy terminan el proceso (contradice la última
  viñeta del 157) y cambiaría el comportamiento de Node para todo el proceso; registrado solo en `main.ts`, las pruebas de
  integración no lo cubrirían (corren en el mismo proceso, sin `main.ts`); (4) solo serviría si el rechazo se procesa
  antes de la última revisión, el mismo límite del 156. Queda el lint del 159 para ese caso, con el riesgo aceptado.
  Alternativa descartada: adoptarla como segunda capa con una prueba en proceso hijo.
- **La causa se limpia en el constructor de `ErrorTransaccionAbortada`** (criterio 161; forma del especificador). Un solo
  lugar cubre todos los caminos que la crean (capa, comprobación, envoltorio, `enPlataforma`) y los que se agreguen.
  Alternativas descartadas: limpiar en cada lugar que la crea (se olvida en el siguiente); no guardar causa (se pierde el
  SQLSTATE que `#registrarAbortada` registra y que sirve para diagnosticar).
- **Lista de lo que se registra, no lista de lo que se tapa** (criterio 162; decisión del orquestador, forma del
  especificador). De un error de la base se registran solo tipo, códigos, modelo y marcos de la pila. Alternativas
  descartadas: `redact` de pino (tapa rutas de objetos, no partes de un texto como el mensaje); buscar y tapar valores en
  el mensaje con expresiones regulares (no se puede saber qué partes son datos; falla abierta ante el formato siguiente de
  Prisma); y limpiar solo en el filtro de errores (el manejador de rechazos, `#registrarAbortada` y los comandos también
  registran).
- **`errorParaRegistro` en `infraestructura/prisma/`, exportada por el punto autorizado** (criterio 162). Necesita las
  clases de error del cliente generado, que solo se importan en esa carpeta (criterio 85); el filtro (`comun/`), el
  manejador (`infraestructura/proceso/`) y `cli/` ya pueden importar el punto autorizado. Alternativa descartada:
  `infraestructura/registro/` reconociendo los errores solo por su `name` (se mantiene como respaldo dentro de
  `esErrorDeBase`, pero `instanceof` es la forma principal).
- **Un `Error` que no es de la base se registra igual que hoy** (criterio 162). Lo fijan pruebas protegidas (filtro de
  errores, criterio 157) y tiene la pila que hace falta para depurar. Alternativa descartada: registrar de todo error solo
  el tipo (perdería el diagnóstico de los errores propios, que no llevan datos de la base).

### Decisiones técnicas tras el ataque, ronda 14 (12/11/2026)

- **La `pila` se lee después de quitar el encabezado exacto `nombre: mensaje`, comparado por igualdad** (criterio 163;
  decisión del orquestador). El mensaje es lo único del `stack` que puede llevar datos, y V8 lo escribe al principio; con
  la longitud del encabezado se sabe dónde termina sin interpretar su contenido. Alternativas descartadas: seguir filtrando
  línea por línea con un patrón más estricto para los marcos (por ejemplo, exigir `(archivo:línea:columna)`; un valor
  puede imitar cualquier forma de marco, y PostgreSQL lo repite tal cual); buscar el mensaje dentro del `stack` con una
  expresión regular o con `indexOf` (un mensaje repetido o parcial confundiría el corte); y no registrar nunca la pila de
  un error de la base (se pierde el diagnóstico de dónde ocurrió, que no lleva datos).
- **Si el encabezado no coincide, no hay `pila`** (criterio 163). Falla cerrada: una librería con otro formato de pila o
  un mensaje cambiado quitan el diagnóstico, no muestran el dato. Alternativa descartada: filtrar los marcos de todas
  formas (es la falla de la ronda 14).
- **Con `message` vacío, el encabezado es solo `name`** (criterio 163; precisión del especificador). Así escribe V8 la
  primera línea cuando el mensaje es la cadena vacía, y no hay ningún dato que quitar. Alternativa descartada: exigir
  siempre `nombre: ` (omitiría la pila sin motivo en esos errores).
- **El riesgo aceptado "Promesa descartada que escapa al lint" se corrige y no se agrega un mecanismo en ejecución**
  (O1; decisión del orquestador). La promesa guardada en una variable que rechaza mientras `trabajo` sigue en curso es
  indistinguible, para el envoltorio, del rechazo que `trabajo` atrapa a propósito (criterio 153); marcarla rompería ese
  patrón, y las razones de la ronda 13 contra la marca por `unhandledRejection` siguen valiendo. Alternativas descartadas:
  marcar todo rechazo no esperado por `trabajo` (no se puede saber quién espera una promesa) y una regla de lint que exija
  esperar toda variable que guarda una promesa (necesita seguir el flujo de datos; `no-floating-promises` no lo hace).
  Queda la regla para el equipo, que vigila el revisor.
- **`process.nextTick`, `setImmediate`, `setTimeout`, `setInterval` y `queueMicrotask` con una función `async` escrita en
  el lugar, en la regla propia sin tipos** (criterio 164; decisión del orquestador, forma del especificador). La regla sin
  tipos va en los dos pasos, como el resto de P-41, y cubre también los temporizadores que `no-misused-promises` ya ve con
  tipos, para que el paso protegido no dependa del lint normal. Por nombre de la propiedad, sea cual sea el objeto, para
  cubrir `globalThis`, `timers` y la desestructuración sin seguir alias. Alternativas descartadas: activar
  `no-misused-promises` con más opciones (no revisa un parámetro de tipo `Function`); `no-restricted-syntax` (ya lo usa la
  regla del reloj sobre los mismos archivos y se pisarían, como en la ronda 13); y prohibir esas funciones en
  `backend/src` (el `setImmediate` de `asentar()` y los temporizadores legítimos con funciones que no son `async`).
- **Los envoltorios de tipos (`as`, `satisfies`, `!`, `<T>`) no esconden la función `async`** (criterio 164; precisión del
  especificador). Son la forma más simple de evadir la regla sin tipos (`(async () => { … })() as unknown;`), y
  `no-floating-promises` tampoco ve una promesa convertida a `unknown`. Alternativa descartada: dejarlo para la revisión
  (cuesta unas líneas en la regla).

### Decisiones técnicas tras el ataque, ronda 15 (12/11/2026)

- **Errores de la base buscados en todo el grafo del error** (criterio 165; decisión del orquestador, corrección de fondo).
  Cierra la familia en lugar de agregar `response` a la lista de propiedades que se miran: la siguiente librería o el
  siguiente error propio usará otro nombre. Alternativas descartadas: agregar `response` y `options` a `cause` y `errors`
  (caso por caso); un serializador `err` propio de pino que solo escriba campos permitidos (no cubre `console.error` de
  `main.ts` ni `mensajeSeguro`, y cambiaría lo que se registra de todo `Error` común, que fijan las protegidas del filtro
  y del 157); limpiar solo en el filtro (el manejador de rechazos y el arranque también registran).
- **Propiedades propias, enumerables o no, con `Symbol`, y enumerables heredadas** (criterio 165; forma del
  especificador). Las propias son lo que pidió el orquestador; las heredadas enumerables se agregan porque pino las
  serializa (`for…in`). Alternativa descartada: solo las enumerables propias (dejaría fuera lo que `util.inspect` con
  `showHidden` muestra y lo que hereda un prototipo).
- **Topes de 10 niveles, 200 objetos y 100 claves, con falla cerrada** (criterio 165; forma del especificador). Un getter
  que crea objetos nuevos, un arreglo enorme o un `Proxy` no pueden colgar ni romper el registro de un 500. _(Corregido
  tras la ronda 16, F1, criterio 167: un arreglo enorme sí colgaba el registro, porque el tope de claves se comparaba
  después de juntarlas todas; ver "Decisiones técnicas tras el ataque, ronda 16".)_ Alternativas
  descartadas: sin topes (un grafo infinito cuelga el proceso de todas las academias); devolver el error tal cual al
  agotar un tope (falla abierta: el error de la base podía estar más abajo).
- **El `Error` que lleva un error de la base conserva su `mensaje` si no copia el de la base** (criterio 165; decisión del
  especificador que **se aparta** de la indicación del orquestador "nunca `message`"). Las pruebas protegidas de los
  criterios 162 y 163 exigen que un `Error` propio con un error de la base como `cause` dé su `mensaje`
  (`registro-de-errores.test.ts`, "un Error propio con un error de Prisma como cause…"; `registro-sin-datos.test.ts`, "un
  Error propio con este error como cause…"; `registro-de-errores-ronda14.test.ts`, (u6); y
  `registro-sin-datos-ronda14.test.ts`), y una prueba protegida no se cambia. La regla de inclusión en los dos sentidos
  quita el mensaje en el patrón de Nest (es el mismo de Prisma) y en las copias contiguas, y la `pila` se lee después del
  encabezado exacto (criterio 163), así que el mensaje nunca sale por ella. Alternativas descartadas: nunca `mensaje`
  (cambiaría el resultado de esas cuatro protegidas); comparar línea por línea (las líneas cortas de los mensajes de
  Prisma, como `{` o `}`, quitarían el mensaje de casi todo error propio); no comparar (el patrón de Nest saldría con el
  mensaje de Prisma).
- **`tipo` de un `Error` que no es de la base: su `name` solo si es el de su constructor** (criterio 165; forma del
  especificador). El nombre de una clase está en el código, no en los datos; así se conserva el diagnóstico
  (`InternalServerErrorException`, `AggregateError`) y un `name` asignado a mano no sale. Alternativas descartadas: la lista
  cerrada de los errores de la base (daría `ErrorDeBase` a una excepción de Nest y cambiaría la protegida que espera
  `Error`); una lista cerrada de excepciones de Nest y de AquaGestión (se queda corta con cada historia); el patrón de hoy
  (un `name` cualquiera con forma de identificador pasa).
- **Lista cerrada de `tipo` para los errores de la base** (criterio 166, O1; decisión del orquestador). Cumple P-42.
  Alternativa descartada: el patrón de hoy (es la observación O1).
- **Sin `money` en las consultas** (O2; decisión del orquestador). Es una regla del plan para todas las historias y un
  riesgo aceptado. Alternativas descartadas: tratar `DecimalError` como error de la base (no lo es, y no hay forma de saber
  si su mensaje lleva un valor) y limpiar los mensajes de todo `Error` común (perdería el diagnóstico de todos los
  errores propios, que fijan las protegidas del 157 y del filtro).
- **Las cinco formas de lint de la ronda 15 van al riesgo aceptado** (decisión del orquestador). Son alias o formas
  hostiles (`.bind`, una flecha que devuelve la llamada, un `callee` condicional o con coma, una expresión lógica); seguir
  cada una no tiene fin, y la regla para el equipo y el revisor las cubren.

### Decisiones técnicas tras el ataque, ronda 16 (12/11/2026)

- **Los binarios son hojas** (criterio 167, F1 (a); decisión del orquestador). Un archivo no lleva errores de la base y
  recorrerlo es lo que costaba segundos. Forma del especificador: se reconocen por la ranura interna (`ArrayBuffer.isView`,
  `types.isAnyArrayBuffer`), no por `instanceof`, prototipo ni `Symbol.toStringTag`, que un objeto común puede imitar para
  esconder un error de la base. Alternativas descartadas: recorrerlos (es la falla); falla cerrada ante cualquier binario
  (perdería el diagnóstico de todo error que lleve un archivo). Queda la pregunta R16-1 sobre su contenido.
- **`length` numérico mayor que el tope: falla cerrada sin listar** (criterio 167, F1 (b); decisión del orquestador). Es
  la forma barata de saber que un arreglo o un `String` pasan del tope. Alternativa descartada: contar con
  `Reflect.ownKeys` (es la falla: crea millones de cadenas).
- **Enumeración cortada al pasar el tope** (criterio 167, F1 (c); decisión del orquestador, **precisada** por el
  especificador). La indicación "no se materializa la lista completa" no se puede cumplir para `Reflect.ownKeys`: el motor
  la entrega entera y no hay forma de pedirla por partes (tampoco `for…in`, que la junta por dentro). Se cumple lo que sí
  se puede: mirar `length` antes, no recorrer `for…in` si las propias ya pasan del tope, cortar `for…in` y no armar
  colecciones ni leer valores más allá del tope. Lo que queda es el riesgo aceptado "Objetos sin `length` con millones de
  claves". Alternativa descartada: `Object.keys` o `Object.getOwnPropertyNames` (también entregan la lista entera).
- **Pruebas de tiempo con 200 ms y de memoria en un proceso hijo con 256 MB** (criterio 167; forma del especificador, a
  pedido del orquestador). 200 ms queda lejos de las reproducciones (1,8 a 7,3 s) para no fallar por una CI lenta; la
  memoria se mide como la reproducción (`--max-old-space-size=256`), que es determinista, y no con `heapUsed`, que depende
  del recolector. Alternativas descartadas: límites ajustados (pruebas inestables en Windows); medir `heapUsed`.
- **`cause` y `errors` por su nombre en cada objeto visitado** (criterio 168, O1; decisión del orquestador, alcance del
  especificador). Son las dos propiedades que pino lee por su nombre, en el error y en cada causa y cada error de
  `errors`. Alternativas descartadas: leerlas solo en el error recibido (pino las lee también en cada causa); leer todos
  los getters heredados (pino no lee los demás y se ejecutaría código ajeno sin necesidad).
- **Una `cause` función es falla cerrada y no se llama** (criterio 168, O1; decisión del orquestador). Alternativas
  descartadas: llamarla y buscar en lo que devuelve (ejecuta código ajeno al registrar un error; puede lanzar, colgar,
  tener efectos o devolver otra cosa cuando pino la vuelva a llamar); ignorarla (pino la llama: es la observación O1).
- **Un `errors` función no es falla cerrada** (criterio 168; especificador). pino solo recorre `errors` si es un arreglo
  y nunca lo llama, así que no puede llevar un dato al registro. Alternativa descartada: falla cerrada también (perdería
  diagnóstico sin motivo).

## Preguntas abiertas

Ninguna de negocio. Las 10 preguntas de la versión en borrador quedaron resueltas por el responsable el 11/11/2026 (DR-1 a
DR-10 en "Decisiones"). Las correcciones de las rondas 1 a 16 del ataque son decisiones técnicas y no abren preguntas de
negocio. Queda para el hosting (D-21), sin bloquear: qué esquemas del proveedor, si alguno, entran en "Esquemas
permitidos además de `public`" (riesgo aceptado "Esquemas propios del hosting").

Pregunta técnica para el orquestador (ronda 16), **a decidir antes de T163** porque fija el resultado de pruebas
protegidas:

- **R16-1. ¿Qué se registra de un `Error` sin errores de la base que lleva un binario?** Con la decisión F1 (a), sale el
  mismo error y pino escribe el contenido del archivo (riesgo aceptado "Contenido de un binario en el registro"): un
  comprobante con datos personales en el registro técnico y una línea de decenas de MB. Hasta la ronda 15 ese caso salía
  `truncado` (lento, sin el contenido). **Propuesta:** si la búsqueda encuentra una hoja binaria, `errorParaRegistro`
  devuelve un `ErrorConvertido` (criterio 165: `tipo`, `mensaje`, `pila`, `causa`, `errores`, sin las demás propiedades)
  en vez del mismo error, aunque no haya errores de la base; el costo sigue acotado, se conserva el diagnóstico (mensaje y
  pila) y el archivo no llega al registro. Con la propuesta, (t1) y (t2) del criterio 167 esperan un objeto convertido
  (`mensaje: 'No se pudo procesar el comprobante'` y `causa` con `mensaje: 'No se pudo subir el comprobante'`, sin
  `archivo`) en lugar de `toBe`, y (t10) no cambia. **Valor provisional:** la decisión del orquestador (hoja y mismo
  error), con la regla para el equipo de que un error nunca lleva el contenido de un archivo.
