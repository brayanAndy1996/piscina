# Arquitectura de AquaGestión

Resumen técnico de las decisiones D-23 a D-30 de [`decisiones.md`](decisiones.md). Si algo de aquí contradice a
`decisiones.md`, manda `decisiones.md`.

## Vista general

Un solo sistema organizado por módulos, no microservicios. La web y la API se publican en el mismo dominio, así
la cookie de sesión puede ser estricta y no hace falta permitir el acceso desde otros dominios.

```
Navegador (PC de recepción / celular)
        │  mismo dominio:  /       → aplicación React
        │                  /api/*  → API NestJS
        ▼
   API NestJS ── Prisma ──► PostgreSQL (RLS por academia)
        ├── AlmacenArchivos  (disco local → luego S3/R2)
        ├── EnviadorCorreo   (log → luego proveedor)
        └── tareas programadas (faltas, cierre de mes)
```

## Aislamiento entre academias

- Toda tabla del negocio lleva `academia_id`.
- La API toma la academia de la sesión del usuario (el id de la academia va en el token, en la claim `aca`), o del
  nombre corto de la dirección en el ingreso y en las páginas públicas (`/api/a/{academia}/…`; en la web,
  `/a/{academia}/…`; D-27). Ninguna ruta de academia toma la academia de la dirección.
- Cada consulta corre dentro de una transacción que fija la academia (`set_config`), y PostgreSQL la vuelve a
  comprobar con seguridad a nivel de fila (RLS). Un error en una consulta no puede mostrar datos de otra academia.
- El DNI es único dentro de cada academia (D-28). El Superadmin administra las academias, pero no ve sus datos
  internos (D-29).

Lo que construye la historia 001 (migraciones en `backend/prisma/migrations/` y módulo `infraestructura/prisma/`):

- **Dos roles.** El dueño de las tablas (`DATABASE_URL`) corre las migraciones, la semilla y
  `npm run plataforma:superadmin`. La API se conecta con `aquagestion_app` (`DATABASE_URL_APP`): sin superusuario, sin
  `BYPASSRLS`, sin membresías, sin ser dueño de las tablas y solo con los privilegios que cada tabla necesita.
- **RLS forzada.** Las cinco tablas de 001 (`academias`, `superadmins`, `auditoria`, `auditoria_plataforma` y
  `configuraciones`) tienen `ENABLE` y `FORCE ROW LEVEL SECURITY`, también para el dueño. Las políticas leen dos valores
  de la transacción, con las funciones `app_academia_actual()` (`app.academia_id`) y `app_es_plataforma()`
  (`app.plataforma`):
  - `auditoria` y `configuraciones` solo muestran las filas de la academia de la transacción; en contexto de plataforma
    no devuelven ninguna.
  - `superadmins` y `auditoria_plataforma` solo se ven en contexto de plataforma.
  - `academias` la ven la plataforma y la propia academia; solo la plataforma la crea o la modifica.
- **`BaseDatos` es el único punto de acceso.** Expone `conAcademia(academiaId, trabajo)`, `comoPlataforma(trabajo)`,
  `resolverAcademia(nombreCorto)` y `comprobarConexion()`. Cada transacción fija los dos valores de contexto (academia y
  plataforma) con `set_config(…, true)`: solo viven dentro de esa transacción, así que no pasan a la siguiente petición
  que use la misma conexión del pool. Los módulos no usan Prisma directamente; una regla de lint lo impide.
- **Falla cerrada.** `BaseDatos` comprueba una vez por proceso que el rol de la API no tiene atributos ni privilegios que
  permitirían saltarse RLS (superusuario, `BYPASSRLS`, `REPLICATION`, `CREATEROLE`, `CREATEDB`, membresías, `CREATE` o
  `TEMPORARY`, o ser dueño de objetos). Si el rol no es seguro, las operaciones rechazan con `ErrorRolBaseDatosInseguro`
  (500) sin ejecutar nada.
- **Rutas públicas.** `GET /api/a/{nombreCorto}` no tiene sesión. Busca la academia con la función `resolver_academia`, y
  la respuesta solo lleva el nombre corto y el nombre, sin id ni estado. Una academia suspendida responde 403.
- **Sesión del superadmin.** Entra con la cookie `aq_plataforma` (`HttpOnly`, `SameSite=Strict`, `Path=/api/plataforma`,
  8 horas). Cambiar su clave sube `version_token`, y las sesiones abiertas dejan de valer.
- **Sesión de las academias (002).** Entra con la cookie `aq_sesion` (`HttpOnly`, `SameSite=Strict`, `Path=/api`, y
  `Secure` con `NODE_ENV=production`): 12 horas para el personal y 30 días para el alumno. Es una por navegador; entrar a
  otra academia la reemplaza (DT-3 de 002). La API de la plataforma no la lee. En cada petición, la sesión se comprueba
  contra la base: el usuario existe en la academia, está `ACTIVO` y su `version_token` es el del token. El rol y el
  cambio de contraseña pendiente salen de esa fila, no del token.
- **Auditoría.** Las altas, suspensiones y reactivaciones de academias, y el alta y el restablecimiento del superadmin,
  quedan en `auditoria_plataforma`. Los cambios dentro de una academia van a `auditoria`. Los inicios de sesión solo van
  al registro técnico (DR-7).
- **Lo que no hace la 001:** los usuarios de las academias, su inicio de sesión y el primer administrador de cada
  academia (lo hace la 002, DR-1 de 002). La configuración con sus claves la define la 003 (DR-8 de 001, abajo).
- **Lo que construye la historia 002** (migración `usuarios` y los módulos `autenticacion/` y `usuarios/`):
  - **Tabla `usuarios` con RLS.** Cada cuenta pertenece a una academia (`academia_id`), y el DNI es único dentro de ella
    (D-28). Un rol por cuenta (DR-7 de 002). Subir `version_token` cierra todas sus sesiones.
  - **Ingreso y sesión.** `POST /api/a/{nombreCorto}/sesion` emite la cookie `aq_sesion`; `GET` y `DELETE /api/sesion` la
    leen y la cierran; `POST /api/sesion/clave` cambia la contraseña. El ingreso admite 10 peticiones por minuto y por IP,
    y la cuenta se bloquea 15 minutos tras 5 fallos seguidos (valores por defecto; desde la 003, cada academia los
    configura).
  - **Permisos.** La matriz compartida y los decoradores: ver "Permisos, sesión y datos personales (002)" más abajo.
  - **Gestión de cuentas.** `UsuariosService` en `/api/usuarios`: listar, crear, desactivar, reactivar, buscar por DNI y
    restablecer, cada operación en su transacción y con su auditoría. El superadmin gestiona los administradores de cada
    academia en `/api/plataforma/academias/{id}/administradores`; lo que hace queda en la auditoría de esa academia.

- **Lo que construye la historia 003** (configuración de cada academia, D-23; sin migración: usa la tabla
  `configuraciones` de 001, con su RLS):
  - **Valores y claves.** Cada academia tiene sus valores, guardados en `configuraciones` (una fila por clave, con el JSON
    del valor). La tabla de claves está en `packages/contratos/src/configuracion.ts` (`CLAVES_CONFIGURACION`) y la leen la
    API y la web. Una clave sin fila, o con un valor que no cumple la tabla, vale lo de por defecto; el valor inválido se
    anota en el registro técnico con la academia y la clave, nunca con el valor. Guardar el valor por defecto de una clave
    sin fila no crea la fila, así que un cambio de ese valor en el código llega a las academias que no tienen fila para
    esa clave.
  - **Rutas.** `GET /api/configuracion` y `PATCH /api/configuracion`, con el permiso `CONFIGURAR_ACADEMIA`. El `PATCH` es
    parcial: escribe solo los campos que cambian, en una sola sentencia, y registra un `CONFIGURACION_ACTUALIZADA`
    (entidad `configuracion`, con `datosAntes` y `datosDespues` de los campos cambiados). Sin cambios, no escribe ni
    audita. `GET /api/mi-academia` (`@SoloSesion`, de cualquier rol) da el nombre, el nombre corto y el teléfono de la
    academia de la sesión (D-22).
  - **Permiso.** `CONFIGURAR_ACADEMIA` está en `packages/contratos/src/permisos.ts`, solo con `ADMIN` (`TODO`). La matriz
    pasa de 23 a 24 filas (criterio 26 de 002, que la 003 amplía).
  - **Bloqueo con los valores de la academia.** `intentosInicioSesion` y `minutosBloqueo` sustituyen a las constantes de
    002 en el ingreso y en el cambio de contraseña (`reglasBloqueoDe`, en `autenticacion/dominio/reglas-bloqueo.ts`). Un
    bloqueo ya puesto no cambia si se modifican los valores, y el 423 dice cuántos minutos faltan.
    `REGLAS_BLOQUEO_SUPERADMIN` (5 intentos y 15 minutos) sigue fijo para el superadmin.
  - **Lo que todavía no usa nada.** La tolerancia de tardanza, los días por vencer y la prioridad de renovación se guardan
    y se muestran, pero la asistencia (009) y las mensualidades (010) aún no los leen. El teléfono se publica en las
    páginas públicas desde la 005 (DR-4 de 003); hoy solo se ve con sesión.
  - **Datos de ejemplo.** La semilla deja un teléfono de ejemplo en `delfines`, con `ON CONFLICT ... DO NOTHING`: no pisa
    un teléfono que la academia haya cambiado. `tiburones` queda con los valores por defecto.

Tabla de claves (valores por defecto y rangos aprobados en DR-1 de 003):

| Campo de la API | Clave en `configuraciones` | Por defecto | Rango |
| --- | --- | --- | --- |
| `toleranciaTardanzaMinutos` | `tolerancia_tardanza_minutos` | 10 | de 0 a 30 minutos |
| `diasPorVencer` | `dias_por_vencer` | 5 | de 1 a 15 días |
| `diasPrioridadRenovacion` | `dias_prioridad_renovacion` | 5 | de 1 a 15 días |
| `intentosInicioSesion` | `intentos_inicio_sesion` | 5 | de 3 a 10 intentos |
| `minutosBloqueo` | `minutos_bloqueo` | 15 | de 5 a 60 minutos |
| `telefono` | `telefono` | sin teléfono (`null`) | de 6 a 20 caracteres: dígitos, espacios, guiones, paréntesis y un `+` al inicio, con al menos 6 dígitos |

## Fechas y horas de negocio (America/Lima)

- Las fechas y horas de negocio (el día de una asistencia o de una caja, el mes de una mensualidad, un vencimiento, si
  una clase ya empezó) se deciden en la zona America/Lima (RNF-12), nunca en la del servidor.
- La conexión de la API con PostgreSQL trabaja en UTC (spec 001, criterio 98). Los instantes (`now()`, columnas
  `timestamptz`) son correctos, pero `CURRENT_DATE`, `now()::date`, `date_trunc('day', now())` y `LOCALTIME` dan el día
  y la hora de UTC: desde las 19:00 de Lima ya es el día siguiente.
- Por eso la fecha de negocio se calcula en el código, con `@date-fns/tz` en `America/Lima` a partir de la hora del reloj
  inyectable (`RELOJ`), y se pasa a la consulta como parámetro. Si tiene que calcularse en SQL, se escribe la zona:
  `(now() AT TIME ZONE 'America/Lima')::date`.
- Las pruebas de estos cálculos deberán fijar la hora con `RELOJ` en los bordes: 18:59 y 19:00 de Lima, fin de mes y
  la clase de 19:00 a 20:00.

## Reglas para las historias siguientes

Estas reglas salen de las rondas del ataque adversarial de la 001 y de la 002. El revisor y el adversarial las comprueban
en cada historia nueva. Los números entre paréntesis son criterios de `specs/001-academias-aislamiento/spec.md`; los de la
002 se citan como «criterio N de 002».

### Escrituras de usuarios de la academia (002, DT-5)

- Toda transacción que escribe a pedido de un usuario de la academia llama a `bloquearActorVigente`
  (`backend/src/modulos/autenticacion/actor-vigente.ts`) dentro de su `conAcademia`, como primera sentencia: antes de leer
  o escribir otra cosa. Alcanza a los cobros, la verificación de pagos, la caja, la asistencia, `crearEnTransaccion` de la
  007 y también a las escrituras que solo tocan la propia fila de quien pide, como un contador o una marca (criterios 56,
  57 y 60 de 002).
- Recibe `{ id, versionToken }` de la sesión de la petición (`SesionVerificada.versionToken`, que entrega
  `@SesionActual()`; `actorDeSesion(sesion)`, del mismo archivo, arma ese actor), y las opciones `registro` e `ip` para el
  registro técnico, que nunca lleva el DNI. Si la función
  lanza el 401 `NO_AUTENTICADO`, la transacción aborta y no se escribe nada. Ese 401 tiene prioridad sobre cualquier 404 o
  409 que la misma transacción fuera a devolver.
- Con dos filas de `usuarios` (quien pide y la persona a la que afecta, por ejemplo al desactivar o restablecer), se pasa
  `objetivoId`: una sola sentencia bloquea las dos filas con `ORDER BY id FOR UPDATE`, y todas las transacciones las toman
  en ese orden. No se bloquean por separado: dos administradores que se desactivan entre sí se esperarían en cruz y
  PostgreSQL abortaría uno con `40P01` (criterio 57 de 002).
- Con `exclusivo: true` la fila de quien pide se bloquea con `FOR UPDATE`, cuando la misma transacción va a escribir esa
  fila (por ejemplo, el contador de un fallo de la clave). Sin `exclusivo`, la fila se bloquea con `FOR SHARE`, que deja
  hacer varias escrituras a la vez al mismo usuario; con `FOR SHARE` seguido de un `UPDATE`, dos peticiones de la misma
  sesión se interbloquearían.
- `permitirCambioPendiente: true` solo en `POST /api/sesion/clave`, que es la ruta que resuelve el cambio obligatorio. En
  cualquier otra ruta, la función exige `debe_cambiar_clave = false`.
- El Superadmin no pasa por esta función (no es una fila de `usuarios`). Sus rutas de plataforma verifican la sesión solo
  al empezar la petición, sin revalidarla dentro de la transacción (AR3-4 de 002), y lo que hacen en una academia se audita
  en la de la academia. Además, conoce la clave inicial de los administradores que crea o restablece (pregunta N11 de 002:
  valor provisional (a), riesgo aceptado, pendiente de Bryan). Si una historia agrega cambios a su cuenta, esto se revisa.

### Permisos, sesión y datos personales (002)

- La sesión se exige a toda ruta de `/api` que no sea `/api/salud`, `/api/plataforma/…` ni `/api/a/…`, con un middleware
  de todo el prefijo que corre antes del lector del cuerpo. La excepción es `DELETE /api/sesion`: no exige sesión ni lee
  el cuerpo y siempre responde 204 (criterios 17 y 54). La sesión sale solo de la cookie `aq_sesion`, nunca de una
  cabecera `Authorization`.
- Cada manejador de una ruta de academia declara `@Permiso('PERMISO')`, con un permiso de la matriz, o `@SoloSesion()`,
  si basta con tener sesión (por ejemplo, para cambiar la propia contraseña). Una ruta de academia sin ninguno de los dos
  responde 403 `SIN_PERMISO` a todos los roles (falla cerrada). `@Permiso` con un permiso que no existe en la matriz falla
  al arrancar la aplicación.
- Quien pide se toma con `@UsuarioActual()` (el `UsuarioAutenticado`: id, academia, rol, nombres, apellidos y
  `debeCambiarClave`). Si el servicio necesita también la versión del token, `@SesionActual()` entrega la
  `SesionVerificada`. El rol y el cambio obligatorio salen de la base en cada petición, no del token.
- La matriz de permisos está en `packages/contratos/src/permisos.ts` (`MATRIZ_PERMISOS` y `puede(rol, permiso)`) y la
  comparten la API y la web. El guard decide solo si el rol pasa; el alcance de cada celda (`SUS_ALUMNOS`, `PROPIO`…) lo
  aplica el servicio de la historia. Una celda vacía significa «no».
- Un DNI u otro dato personal se busca con `POST` y el dato en el cuerpo, validado con su esquema zod, y nunca en la
  dirección: una dirección queda en los registros de acceso del proxy del hosting y en el historial del navegador.
  Ejemplo: `POST /api/usuarios/buscar-por-dni` con `{ dni }` (criterios 34 y 43 de 002). La búsqueda no escribe ni audita
  nada.

### Transacciones

- Dentro de una transacción, cada paso se espera con `await`. No se dejan cadenas sueltas con `.then` ni con `void`
  (criterio 156). Toda promesa que se crea dentro se espera antes de devolver, también la que se guarda en una variable.
- No se pasan funciones `async` a `process.nextTick`, `setImmediate`, `setTimeout`, `setInterval` ni `queueMicrotask`.
  Lo que sea diferido va después de confirmar (criterio 164).
- Dentro de una transacción de la API, las consultas que se lanzan a la vez (`Promise.all`) se ejecutan de una en una, y
  cada una recibe su propio resultado o su propio error (criterio 153). En los comandos y en la semilla (`enPlataforma` y
  `enAcademia`) no se lanzan consultas en paralelo: se encadenan con `await`.
- Un error de la base que se atrapa dentro de la transacción la deja abortada, y la operación falla (criterio 149). Un
  P2025 atrapado por una consulta no la aborta, y una escritura de un modelo que falla no deja nada escrito, aunque tenga
  relaciones anidadas (criterio 158).
- Los duplicados que se esperan se resuelven con `INSERT … ON CONFLICT DO NOTHING RETURNING`, y se mira si volvió una
  fila, como en `AcademiasService.crear`.
- Los bloqueos de transacción (`pg_advisory_xact_lock`) se toman con `$executeRaw`, por ejemplo
  `` await tx.cliente.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(${clave}::bigint)` `` (criterio 155).
- No se actualiza la tabla `academias` desde `conAcademia`: los cambios de una academia se hacen desde `comoPlataforma`,
  y nunca con una escritura anidada hacia `academias`.
- Para leer varias filas por id se usa `findMany({ where: { id: { in: ids } } })`, no
  `Promise.all(ids.map((id) => findUnique(…)))`: con la cola serial de la API, cada `findUnique` va por separado, y
  `findMany` con `in` es una sola consulta.

### Escrituras y errores

- Para escribir muchas filas en una transacción se usan `createMany`, `updateMany`, `deleteMany` o `$executeRaw`, no un
  bucle de escrituras de un modelo. PostgreSQL guarda hasta 64 identificadores de subtransacción por conexión: con más de
  64 escrituras de modelos en una transacción, la conexión desborda esa caché y el servidor se vuelve más lento para
  todas las academias mientras la transacción siga abierta.
- No se usa el tipo `money` de PostgreSQL: los montos van en `numeric` y en `Decimal`, en la base y en el código.
- Un error que se pasa a una excepción de Nest lleva un mensaje propio y `{ cause: error }`, por ejemplo
  `new InternalServerErrorException('No se pudo …', { cause: error })`. Nunca se pasa el error de Prisma ni su mensaje,
  y un error propio no copia el mensaje de otro (criterio 165).

### Errores y registros

- En `backend/src` no se descartan promesas: ni `void` ni funciones `async` sin `await`. Lo exige el lint (criterio 159).
  Un rechazo que llega después de que `trabajo` terminó hace fallar la operación (criterio 160).
- El registro técnico de un error de la base lleva solo el tipo y los códigos, nunca el mensaje de Prisma, que puede
  llevar datos personales (Ley 29733). Se registra con `errorParaRegistro` (criterio 162), y de la pila solo se conservan
  los marcos que siguen al encabezado `nombre: mensaje` (criterio 163).
- Un error nunca lleva el contenido de un archivo, ni un binario, ni una copia de él, ni un `Proxy` de un binario: se
  guarda la clave del archivo en `AlmacenArchivos` (D-19). La `cause` de un error es un valor, nunca una función
  (criterios 167 y 168).
- El registro técnico de las cuentas y de la sesión nunca lleva el DNI, la clave, la clave nueva, la actual, el token ni el
  cuerpo de la petición, en ningún nivel (criterio 43 de 002). Tampoco lo lleva la línea de la petición de `pino-http`.

### Datos, fechas y cachés

- Las fechas de negocio se calculan en America/Lima, con `@date-fns/tz` o con `AT TIME ZONE 'America/Lima'`, como dice la
  sección anterior.
- Los servicios no guardan resultados de consultas en propiedades ni en variables del módulo: otra academia recibiría
  datos que no son suyos, sin pasar por su propia transacción. Si una historia necesita caché, la clave incluye la
  `academia_id` (por ejemplo, `Map<academiaId, …>`), se invalida al escribir y lo decide su especificación.

### Configuración de la academia (003)

- **Leer la configuración en la transacción de la operación.** `leerConfiguracion(tx, { registro? })`
  (`backend/src/modulos/configuracion/lectura.ts`, reexportada en `configuracion/index.ts`) devuelve los seis valores
  efectivos de `tx.academiaId` con una sola consulta dentro de la transacción de quien llama. No tiene caché: cada
  operación la lee con su propia `tx`, y un cambio confirmado se ve en la siguiente. Es una función sin Nest, como
  `insertarEnAuditoriaDeAcademia`, para que cualquier módulo la use sin depender del módulo de configuración. Las
  historias 009 (tolerancia) y 010 (días por vencer y prioridad) la usarán con la `tx` de su operación.
- **Importarla desde `configuracion/lectura`.** `autenticacion` la importa de ese archivo y no del índice del módulo: el
  módulo de configuración usa los decoradores y `bloquearActorVigente` de `autenticacion`, así que importar desde el
  índice crearía un ciclo entre los dos.
- **Orden de bloqueos del `PATCH`.** Primero la fila de quien pide, con `bloquearActorVigente` (`FOR SHARE`); después el
  bloqueo de la academia, con `pg_advisory_xact_lock(hashtextextended('configuracion:' || academiaId))`. Así los cambios
  de una misma academia se ordenan y su auditoría queda encadenada. Ninguna escritura futura debe tomar el bloqueo de la
  academia y luego filas de `usuarios`: dos transacciones se esperarían en cruz.
- **El conteo de fallos no bloquea `configuraciones`.** La lectura de la configuración dentro del conteo de fallos (en el
  ingreso y en el cambio de contraseña) es un `SELECT` sin bloqueo: no toma el bloqueo de la academia ni espera al
  `PATCH` (criterio 17 de 003).
- **La cabecera de la web lleva la identidad de la sesión.** La clave de `useMiAcademia` incluye el `nombreCorto` de la
  academia y el `id` del usuario (`['mi-academia', nombreCorto, id]`). Así, la respuesta de otra academia o de otra
  persona no se reutiliza al cambiar de sesión en el mismo navegador (criterio 28 de 003). Una consulta nueva con datos
  de la academia que muestre el panel sigue la misma regla.

## Estructura de carpetas

```
piscina/
├── .claude/
│   ├── agents/                   Roles de la metodología
│   ├── hooks/preparar-sesion.mjs Prepara cada sesión en la nube
│   └── settings.json
├── .github/
│   ├── workflows/ci.yml          Revisión automática: Linux con PostgreSQL real + Windows
│   └── pull_request_template.md
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/           Incluyen las políticas RLS por academia
│   │   └── seed.ts               Datos inventados: 2 academias de ejemplo y sus usuarios
│   ├── src/
│   │   ├── main.ts · app.module.ts
│   │   ├── comun/                Guards de rol, decorador de academia, filtros de error, dinero y fechas en Lima
│   │   ├── infraestructura/
│   │   │   ├── prisma/           Cliente que fija la academia en cada transacción (RLS)
│   │   │   ├── almacen-archivos/ Interfaz + disco local
│   │   │   ├── correo/           Interfaz + envío simulado (solo log)
│   │   │   └── reloj/            Hora actual inyectable, para probar bordes de horario
│   │   └── modulos/
│   │       ├── academias/        Alta de academias, Superadmin
│   │       ├── autenticacion/ · usuarios/ · auditoria/ · configuracion/
│   │       └── <modulo>/         Un módulo por área (planes, clases, caja, pagos, asistencia…)
│   │           ├── <modulo>.module.ts · .controller.ts · .service.ts
│   │           └── dominio/      Cálculos puros + sus pruebas unitarias (*.test.ts)
│   ├── test/
│   │   ├── integracion/<modulo>/ Pruebas contra PostgreSQL real
│   │   └── utilidades/           Crear academias y datos de prueba, limpiar la base
│   └── almacenamiento/           Archivos subidos en desarrollo (ignorado por git)
├── frontend/
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── rutas/                Rutas públicas, rutas por rol y protección por sesión
│       ├── modulos/<modulo>/     Páginas, componentes y hooks de cada área
│       ├── componentes/ui/       shadcn/ui
│       ├── componentes/          Compartidos: diseño, tablas, formularios
│       ├── api/                  Cliente HTTP + TanStack Query
│       └── lib/                  Formato de soles, fechas y horas de Lima
├── packages/contratos/src/       Esquemas zod y tipos, uno por módulo
├── e2e/                          Playwright: flujos críticos completos
├── scripts/                      En Node: verificar pruebas protegidas, crear bases, etc.
├── specs/
│   ├── _plantillas/
│   ├── backlog.md                Lista ordenada de historias
│   └── NNN-nombre/               spec.md · plan.md · tasks.md
├── docs/                         Requerimientos, decisiones, metodología, arquitectura, guía local para Windows
├── docker-compose.yml            Solo PostgreSQL, para la PC del responsable
├── .env.example                  Sin secretos
├── .gitattributes                Finales de línea LF
├── .nvmrc                        Node 22 LTS
├── package.json                  Workspaces y comandos comunes
├── CLAUDE.md
└── README.md
```

Las pruebas unitarias del dominio van junto al código; las de integración, en `backend/test/`, porque necesitan la
base de datos.

## Desarrollo en la nube y pruebas en Windows (D-26)

|               | Nube (sesiones de Claude)                                            | PC del responsable (Windows)         |
| ------------- | -------------------------------------------------------------------- | ------------------------------------ |
| PostgreSQL    | El instalado en el contenedor (no hay Docker)                        | `docker compose up -d`               |
| Configuración | `.env` con `DATABASE_URL` (dueño) y `DATABASE_URL_APP` (la API)      | El mismo `.env`, con sus valores     |
| Al empezar    | `preparar-sesion.mjs`: enciende PostgreSQL, crea el rol `aquagestion_app` y las bases de desarrollo y de pruebas, instala dependencias y aplica migraciones | `git pull` → `npm ci` → `npm run env:completar` si cambió `.env.example` → `npm run db:migrar` (o `db:preparar`, si la historia crea un rol o una base) → `npm run dev` |

- Node 22 LTS en la nube, en la integración continua y en la PC (`.nvmrc` y `engines`).
- `.gitattributes` fija LF para que Windows no altere los archivos.
- La integración continua también instala y compila en Windows, porque Prisma, `sharp` y `@node-rs/argon2` traen
  binarios distintos por sistema operativo.
- `preparar-sesion.mjs` solo actúa en la nube; en la PC no hace nada.
