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
  la respuesta solo lleva el nombre corto, el nombre y el teléfono (este desde la 005a, DR-4 de 003), sin id ni estado. Una
  academia suspendida responde 403.
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
    páginas públicas (ingreso, inscripción y seguimiento) desde la 005a (DR-4 de 003).
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

- **Lo que construye la historia 004** (planes y clases de cada academia, D-23; migraciones `<marca>_planes_clases` y
  `<marca>_planes_clases_invariantes`, y los módulos `planes/` y `clases/`):
  - **Tablas `planes` y `clases` con RLS.** Cada fila lleva `academia_id`. Las dos tienen RLS activada y forzada, con
    políticas de `SELECT`, `INSERT` y `UPDATE` de la forma de 001: solo se ve y se escribe la academia del contexto. No
    hay política ni privilegio de `DELETE`: los planes y las clases se desactivan (`activo`), no se borran (D8 de 004).
  - **Llaves y restricciones.** `UNIQUE (academia_id, id)` en las dos. La llave foránea compuesta
    `clases (academia_id, entrenador_id)` → `usuarios (academia_id, id)` impide que una clase apunte al entrenador de otra
    academia, aunque la API fallara. Que el usuario sea un `ENTRENADOR` `ACTIVO` lo comprueba la API, porque una llave no
    puede hacerlo (D6 de 004).
  - **Choques del bloque, en la base.** Dos índices únicos parciales (`WHERE activo`: las inactivas no cuentan).
    `clases_entrenador_bloque_activo_key` sobre (academia, entrenador, día, hora de inicio) da `ENTRENADOR_OCUPADO`, y
    `clases_nivel_bloque_activo_key` sobre (academia, nivel, día, hora de inicio) da `CLASE_DUPLICADA` (D4 y DR-3 de 004).
    El nombre del plan es único con `planes_academia_id_nombre_minusculas_key` sobre (academia, `lower(nombre)`), contando
    los inactivos (DR-8 de 004).
  - **Invariantes con `CHECK`** (criterios 4 y 33 de 004), para cualquiera que escriba en la base, también el dueño de las
    tablas: `clases.aforo` de 20 a 50; `dia_semana` de 1 a 7; `hora_inicio` un bloque de 08:00 a 19:00 y `hora_fin` una hora
    después; `planes.precio` mayor que 0 y distinto de `NaN`; `clases_por_mes` de 1 en adelante; `veces_por_semana` de 1 a 7;
    `dias_permitidos`, `franjas_permitidas` y `niveles_aplicables` de una sola dimensión que empieza en 1, sin `NULL` y no
    vacíos, con al menos `veces_por_semana` días; y `vigencia_inicio` y `vigencia_fin` finitas, con `vigencia_fin` no
    anterior a `vigencia_inicio`. Prisma no genera los `CHECK`: van a mano en la migración.
  - **Privilegios mínimos.** `aquagestion_app` tiene `SELECT` e `INSERT` en las dos tablas y `UPDATE` solo de las columnas
    que cambian. En `clases` no puede cambiar el nivel, el día ni la hora (DR-4 de 004): para moverla se desactiva y se crea
    otra. Ninguna fila cambia de academia.
  - **Montos.** `precio` es `numeric(10,2)` en la base, `Decimal` en la API y texto en el JSON (`"120.00"`). Ver «Precio y
    clases del mes» en la sección de reglas de más abajo.
  - **Nombre del plan.** `normalizarNombrePlan` (`packages/contratos/src/planes.ts`) se aplica antes de validar, guardar y
    comparar: NFC, espacios Unicode a espacio normal, sin caracteres invisibles (salvo los de control bidireccional, que dan
    400), espacios seguidos colapsados, extremos recortados y NFC al final (criterios 34, 34 a y 34 b de 004). La web usa la
    misma función.
  - **Rutas.** `GET` y `POST /api/planes`, `PATCH /api/planes/{id}`, `GET` y `POST /api/clases` y `PATCH /api/clases/{id}`.
    Todas con `@Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')`, así que solo las usa el administrador (DT-2 y DR-7 de 004). El
    `{id}` de los `PATCH` lo valida el servicio después de `bloquearActorVigente`: un id que no es UUID responde el mismo 404
    que uno inexistente o de otra academia (AT-2 de 004). El Superadmin no tiene estas rutas (D-29).
  - **Bloqueo común del cupo.** `bloquearClasesParaCupo(tx, claseIds)`, en `backend/src/modulos/clases/cupo.ts` (sin Nest;
    reexportada en `clases/index.ts`). Ver «Cupo de una clase» más abajo.
  - **Estado del plan.** `VIGENTE`, `PROGRAMADO`, `VENCIDO` o `INACTIVO`, calculado al leer con `estadoDelPlan` y la fecha de
    Lima de `RELOJ` (`hoyEnLima`, D10 de 004). No se guarda.
  - **Auditoría.** `PLAN_CREADO` y `PLAN_ACTUALIZADO` (entidad `plan`), `CLASE_CREADA` y `CLASE_ACTUALIZADA` (entidad
    `clase`), con `datosAntes` y `datosDespues` solo de los campos que cambiaron (D9 de 004).
  - **Web.** `/panel/planes` y `/panel/clases` (grilla semanal; en el celular, un día a la vez), desde el inicio del panel y
    solo para el administrador. Los formularios validan con los esquemas de `packages/contratos` (`horario.ts`, `dinero.ts`,
    `planes.ts` y `clases.ts`).
  - **Semilla.** En `delfines`: un segundo entrenador de ejemplo (DNI `10000005`), dos planes y cinco clases, dos de ellas el
    lunes a las 18:00 con entrenadores distintos. `tiburones` queda sin planes ni clases. Se puede repetir sin duplicar ni
    pisar lo editado. Un plan de ejemplo se reconoce por su nombre: si se renombra, la siguiente ejecución lo vuelve a crear.
- **Lo que construye la historia 005a** (inscripción pública, reserva del cupo y seguimiento de la solicitud; migraciones
  `<marca>_inscripcion_publica` y `<marca>_reserva_dentro_del_mes`; módulos `matriculas/` e `inscripciones/`; la
  especificación está en `specs/005-inscripcion-publica/`. La foto y el panel de solicitudes son de la 005b):
  - **Tablas con RLS.** `alumnos`, `apoderados`, `fichas_medicas`, `consentimientos`, `solicitudes_inscripcion`, `matriculas`
    y `matricula_clases`. Cada fila lleva `academia_id`, la RLS está activada y forzada, y las llaves primarias y las
    compuestas hacia las filas padre incluyen `academia_id`. Los datos de salud (Ley 29733) están en `fichas_medicas`, y los
    del apoderado, en `apoderados`. `consentimientos` es la evidencia de los consentimientos (D-07) y solo admite `INSERT`.
  - **Privilegios.** `aquagestion_app` puede leer e insertar en esas tablas, actualizar solo las columnas que cambian (por
    ejemplo, el estado de la solicitud y de la matrícula) y borrar solo en `apoderados`. `alumnos.foto_clave` ya existe,
    pero en la 005a nadie la escribe.
  - **Estados.** Una solicitud está `PENDIENTE_PAGO`, `VENCIDA` o `CANCELADA`. Si su reserva ya venció, se muestra como
    `VENCIDA` aunque la fila diga todavía `PENDIENTE_PAGO`. Una matrícula está `RESERVADA`, `VIGENTE`, `FINALIZADA` o
    `CANCELADA`.
  - **Ocupación** (`matriculas/ocupacion.ts`, sin Nest). `contarOcupacion(tx, claseIds, mes, ahora)` cuenta cuántas
    matrículas del mes ocupan cada clase, y `contarInscritos` da la mayor ocupación entre el mes en curso y los siguientes
    (DR-5 de 004). Una matrícula ocupa cupo si está `VIGENTE`, o `RESERVADA` con `reserva_vence_en` nula (pago en
    verificación, desde la 007) o posterior a «ahora». Cuentan sin bloquear: quien llama bloquea antes con
    `bloquearClasesParaCupo`.
  - **Cobro** (`matriculas/dominio/cobro.ts`, funciones puras con `Decimal`). `clasesRestantes` cuenta las clases que quedan
    del mes con la fecha de Lima; `montoProporcional` calcula `precio × clases totales ÷ clases por mes`; el total se
    redondea hacia arriba al sol entero una sola vez, al final. El monto que ve la persona es el que se guarda: si cambió
    desde la cotización, el envío responde 409 `MONTO_CAMBIO`.
  - **Reserva y fin de mes** (`matriculas/dominio/reserva.ts`). `vencimientoDeReserva(ahora)` es lo que ocurra primero entre
    24 horas y las 23:59:59.999 del último día del mes en Lima (DR-1 y DR-12 de 005). La migración
    `<marca>_reserva_dentro_del_mes` agrega el `CHECK matriculas_reserva_dentro_del_mes`: ninguna `reserva_vence_en` puede
    pasar del fin del mes de su matrícula. Por eso una base sembrada con una versión anterior de la rama no migra (ver la
    guía de Windows, «Problemas frecuentes»).
  - **Envío** (`InscripcionesService`, en `inscripciones.service.ts`). Una transacción con este orden: (1) los bloqueos
    consultivos de la conexión y del DNI; (2) las filas del cliente con `FOR UPDATE`; (3) las clases con
    `bloquearClasesParaCupo`, en una sola llamada; (4) las escrituras y la auditoría. Los 409 salen en el orden del
    contrato de 005. La `claveIdempotencia` que manda el formulario hace que un doble clic o un reintento no cree una
    segunda solicitud: responde 409 `SOLICITUD_YA_REGISTRADA`, con el código solo si es de la misma persona.
  - **Código y token** (`inscripciones/dominio/codigos.ts`). El código es `AQ-` y seis caracteres del alfabeto de Crockford.
    El token son 32 bytes aleatorios de `node:crypto` en base64url. Del token **solo se guarda su SHA-256** (`token_hash`):
    aparece en la respuesta 201 y en el correo, y la consulta lo busca por su hash dentro de la academia del nombre corto.
  - **Correo** (`infraestructura/correo/`). La interfaz `EnviadorCorreo` se inyecta con `ENVIADOR_CORREO`. Hoy el adaptador
    es el simulado: solo registra la plantilla y la academia, nunca el destinatario ni el enlace. El proveedor real se elige
    con el hosting (D-19, D-21). El correo sale **después de confirmar** la transacción, con `enviarSinEsperar`: la
    respuesta no espera al proveedor, y un fallo se registra solo con el tipo del error. Hay un envío por cada destinatario
    distinto (la persona y el apoderado).
  - **Seguimiento** (`SeguimientoService`). `POST /api/a/{nombreCorto}/solicitudes/consulta` con `{ token }` o con
    `{ codigo, dni }`. Lo que no existe o no corresponde responde el mismo 404 `SOLICITUD_NO_ENCONTRADA`. Una solicitud
    `PENDIENTE_PAGO` muestra el nombre, el plan, las clases, el monto y la fecha límite; una `VENCIDA` o `CANCELADA` muestra
    la vista reducida, sin nombre ni fecha límite (DR-14 de 005). La web declara `no-referrer` en `frontend/index.html`,
    para que el token no salga hacia otros sitios.
  - **Límites por conexión** (`comun/http/conexion.ts`, `claveDeConexion`). Una IPv4, también escrita como IPv6 mapeada
    (`::ffff:a.b.c.d`), cuenta por su dirección exacta. Cualquier otra IPv6 cuenta por su bloque /64, en forma canónica.
    Las rutas públicas tienen contadores en memoria de cada instancia (`LIMITES_PUBLICOS`, en
    `modulos/academias/limite-inicio-sesion.ts`). Cuentan cada petición antes de leer el cuerpo, también las que fallan:
    lecturas (la academia y el formulario, 60 por minuto, con `HEAD` en el mismo contador), cotización (30 por minuto), envío
    (10 por hora) y consulta del seguimiento (10 por minuto). Además, una conexión tiene como mucho cinco solicitudes sin
    pagar (`LIMITE_RESERVAS_POR_CONEXION`, que se cuentan en la base). El ingreso de 002 no cambia y sigue contando por
    dirección exacta (pregunta R6 abierta). Las IPv6 de un bloque mayor que /64 no quedan cubiertas (pregunta R7).
  - **Antes de publicar el formulario: `trust proxy`** (advertencia de despliegue). Hoy la API no configura `trust proxy`:
    ni `backend/src/main.ts` ni `configurarApp` en `backend/src/crear-app.ts` lo tocan, y Express 5 lo deja en `false` por
    defecto. Así, `req.ip` es la dirección del socket que llega a Node: en la PC es 127.0.0.1, porque la web pasa por Vite.
    Detrás del proxy del hosting, esa dirección sería la del proxy para todos los visitantes: `claveDeConexion(req.ip)`
    contaría a todos como una sola conexión y los límites bloquearían la inscripción a la vez. Con `trust proxy` apagado, la
    API además ignora `X-Forwarded-For`, así que nadie puede elegir su IP con esa cabecera. Antes de publicar, con el
    hosting (D-21), hay que configurar `trust proxy` en `configurarApp`, según el proxy: un número (cuántos proxies hay
    delante) o sus direcciones. No conviene `true`: Express tomaría la primera dirección de `X-Forwarded-For`, que escribe
    el cliente. Las pruebas fijan la IP con `trust proxy` en `loopback` solo en sus utilidades
    (`backend/test/utilidades/inscripciones-ronda1.ts`); la aplicación real no lo cambia.
  - **Aforo con inscritos (DR-5 de 004).** `PATCH /api/clases/{id}` responde 409 `AFORO_MENOR_QUE_INSCRITOS` si el aforo baja
    de los inscritos, salvo con `confirmarAforoMenor: true`, y 409 `CLASE_CON_INSCRITOS` si se desactiva una clase con
    inscritos. Los inscritos se cuentan después de `bloquearClasesParaCupo`. El diálogo de confirmación de la web llega con
    la 005b; hasta entonces, la web muestra estos 409 como cualquier error.
  - **Auditoría.** `SOLICITUD_INSCRIPCION_CREADA`, con actor `PUBLICO` (sin usuario) y entidad `solicitud_inscripcion`. Guarda
    el código, el plan, las clases, el mes, el monto, si es proporcional, si el alumno es menor y la fecha de la reserva,
    pero nunca el DNI, los datos de salud ni el token. `CLASE_ACTUALIZADA` suma `inscritos` y `confirmacion` cuando se
    confirma un aforo menor.
  - **Rutas públicas nuevas.** `GET /api/a/{nombreCorto}/inscripcion`, `POST /api/a/{nombreCorto}/inscripcion/cotizacion`,
    `POST /api/a/{nombreCorto}/inscripcion` (responde 201) y `POST /api/a/{nombreCorto}/solicitudes/consulta`. En la web,
    `/a/{nombreCorto}/inscripcion`, `/a/{nombreCorto}/solicitud` (consulta con código y DNI) y
    `/a/{nombreCorto}/solicitud/{token}` (seguimiento). `GET /api/a/{nombreCorto}` suma `telefono`.
  - **Semilla.** En `delfines`: tres clases de Básico (martes, miércoles y jueves a las 18:00, con el entrenador de DNI
    `10000005`) y tres clientes con solicitud: `AQ-SM0001` (vigente), `AQ-SM0002` (vencida) y `AQ-SM0003` (menor con
    apoderado). Sus reservas vigentes vencen al fin del mes en Lima, los tokens se guardan solo como hash, y repetirla no
    duplica ni pisa lo editado. `tiburones` queda sin solicitudes.
  - **Lo que todavía no trae.** La foto, el panel de solicitudes, la cancelación por la secretaria y la ocupación para el
    administrador (005b); el pago, la verificación y el paso de cliente a alumno (007); la renovación y el cambio de horario
    (010).

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
- Las horas de las clases de la 004 (`hora_inicio` y `hora_fin`) son `time` locales de Lima, sin zona: ver «Horas de las
  clases» en «Planes, clases y cupo (004)», más abajo.

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

### Planes, clases y cupo (004)

Salen de la historia 004 y de sus tres rondas del ataque adversarial (criterios 22, 23, 31 y 32 de 004). El texto completo
está en `specs/004-planes-clases-aforo/spec.md`, sección «Reglas para las historias siguientes».

- **Cupo de una clase.** Toda operación que ocupa, libera o mueve cupos (inscripción y su reserva, renovación,
  recuperación, cambio de horario, asistencia en otro horario) y todo cambio del aforo o del estado de una clase llama a
  `bloquearClasesParaCupo(tx, ids)` con todas las clases que toca, en una sola llamada, después de `bloquearActorVigente`
  (si hay actor) y antes de contar la ocupación o escribir. Así dos operaciones sobre el último cupo se ordenan, y ninguna
  cuenta con un aforo viejo. Nunca se bloquea una clase y después una fila de `usuarios` con `FOR UPDATE` o `FOR SHARE`.
  - Es una sola sentencia `… ORDER BY id FOR UPDATE` sobre las clases de `tx.academiaId`. Devuelve `id`, `nivel`,
    `diaSemana`, `horaInicio`, `horaFin`, `aforo`, `activo` y `entrenadorId` de cada clase que existe en la academia. Los
    ids de otra academia, los que no existen, los repetidos y los que no son UUID no devuelven nada de más ni fallan; con
    una lista sin ids válidos no ejecuta ninguna sentencia.
  - Dos transacciones que piden `[c1, c2]` y `[c2, c1]` a la vez terminan las dos, sin `40P01` (criterio 23 de 004).
- **Precio y clases del mes.** Los montos son `Decimal`, nunca `number`. En el JSON viajan como texto (`"120.00"`);
  `montoSchema` (`packages/contratos/src/dinero.ts`) los valida (hasta dos decimales, mayor que 0 y como mucho `"99999.99"`,
  sin recortar); la API los convierte con `aDecimal` (`backend/src/comun/dinero`) y la base los guarda en `numeric(10,2)`.
  No se usa `Number(…)`, `parseFloat` ni `+precio` sobre un monto: la coma flotante rompe el cobro (criterio 10 de 004). Una
  matrícula (005, 007, 010) guardará su propio monto (`monto_calculado`) y sus clases totales (`clases_totales`) al crearse,
  y nunca los volverá a leer del plan: así un cambio de precio vale solo para inscripciones y renovaciones nuevas (HU-19).
  `clases_por_mes` es el divisor del cobro proporcional (RN-25); por eso la base lo exige de 1 en adelante. El precio es el
  monto final con IGV (D-03): ningún cálculo le suma ni le resta nada.
- **Horas de las clases.** `hora_inicio` y `hora_fin` son horas locales de Lima sin zona (`time(0)`). Para saber si una clase
  ya empezó, se compone la fecha de Lima (`hoyEnLima`, de `backend/src/comun/fechas`) con esa hora en America/Lima (con
  `@date-fns/tz`), nunca con la zona del servidor. Se leen con `to_char(hora, 'HH24:MI')`, no con `::text`, que
  puede dar `08:00:00`.
- **El 409 de un choque lo decide el nombre de la restricción.** Un `INSERT` o un `UPDATE` que choca con un índice único
  falla con `23505` y la transacción se revierte. El código sale del nombre de la restricción violada del error de la base
  (`restriccionDeUnicidadViolada`, en `backend/src/infraestructura/prisma/errores-base.ts`), nunca del texto del mensaje,
  después del `ROLLBACK` y sin releer las filas: otra transacción pudo cambiarlas entre medio (criterio 32 de 004). Una
  consulta posterior solo sirve para afinar entre dos 409 (criterio 20 e de 004); si falla, responde `ENTRENADOR_OCUPADO`,
  nunca un 500. Si un choque puede dar dos códigos, no se usa `ON CONFLICT DO NOTHING`: oculta cuál índice chocó, y la
  consulta posterior puede no encontrar nada (así llegó el 500 de la ronda 1). Cuando el choque solo puede dar un 409, vale el patrón de
  «Transacciones» de más arriba: `INSERT … ON CONFLICT DO NOTHING RETURNING` y mirar si volvió una fila (así lo hace el
  nombre único de los planes).
- **Entrenador bloqueado junto con el actor (AT-1 de 004).** `POST /api/clases` y `PATCH /api/clases/{id}` con
  `entrenadorId` llaman a `bloquearActorVigente` con `objetivoId` igual al entrenador: una sola sentencia bloquea las dos
  filas de `usuarios`, ordenadas por id como la desactivación de 002, antes de cualquier fila de `clases`. Sin eso, el
  administrador que crea una clase con el entrenador E mientras lo desactiva se interbloquea (`40P01`, un 500). El `PATCH`
  sin `entrenadorId` bloquea solo al actor (`FOR SHARE`). Excepción: reactivar una clase con el mismo entrenador lee su rol y
  su estado sin bloqueo, porque no cambia `entrenador_id` (D11 de 004).
- **Requisito de entorno: `LC_CTYPE` UTF-8.** El índice sobre `lower(nombre)` depende del locale de la base. Con `C` o
  `POSIX`, `lower('Ó')` no cambia y «NATACIÓN» y «natación» no chocarían (criterio 34 c de 004). Las bases tienen que tener
  un `LC_CTYPE` UTF-8 (`C.UTF-8` o `en_US.utf8`). La prueba `planes-nombre-letras-acentuadas.test.ts` lo detecta.
  `npm run db:crear` no fija el locale: las bases heredan el del servidor, así que no se crean a mano con `C` ni `POSIX`.

### Inscripción pública, reserva y seguimiento (005a)

Salen de la sección «Reglas para las historias siguientes» de `specs/005-inscripcion-publica/spec.md` (criterio 48). La regla
«Archivos» es de la 005b y todavía no está aquí.

- **Orden de bloqueos.** Si la transacción tiene actor, primero `usuarios`, con `bloquearActorVigente`. El envío público no
  tiene actor: sus bloqueos consultivos van primero, el de la conexión (`'inscripcion-ip:' || academia || ':' ||
  claveDeConexion(ip)`, criterio 60) y después el del DNI (`'inscripcion-dni:' || academia || ':' || dni`), con
  `pg_advisory_xact_lock(hashtextextended(…, 0))`. Luego vienen las filas de `alumnos`, `solicitudes_inscripcion` y
  `matriculas` (`FOR UPDATE`), las clases (`bloquearClasesParaCupo`, en una sola llamada) y las escrituras. Nunca al revés.
  Las lecturas de `usuarios` sin bloqueo no cuentan.
- **Ocupación.** Se cuenta con `contarOcupacion` o `contarInscritos` después de `bloquearClasesParaCupo` y con «ahora» de
  `RELOJ`. Una matrícula ocupa cupo si está `VIGENTE`, o `RESERVADA` con `reserva_vence_en` nula o posterior a «ahora».
- **Reservas y fin de mes (DR-12).** Una reserva sin pago vence con `vencimientoDeReserva` (24 horas o el fin del mes en Lima,
  lo que ocurra primero). La base no acepta una `reserva_vence_en` posterior al fin del mes de su matrícula (criterio 56).
  Nunca queda una reserva vigente de un mes ya cerrado.
- **Para la 007.** Al registrar un comprobante, la matrícula queda `RESERVADA` con `reserva_vence_en = NULL` (sin límite,
  RN-28); si la reserva ya había vencido, antes vuelve a pedir cupo (como D-05 tras un rechazo). Con DR-12, la 007 debe
  decidir con el responsable qué pasa con un comprobante que sigue en verificación cuando termina el mes de su matrícula
  (pregunta anotada en `specs/backlog.md`). Al rechazar, la matrícula pasa a `CANCELADA` y el cupo se libera. Al confirmar,
  queda `VIGENTE`: el alumno pasa de `CLIENTE` a `ALUMNO_ACTIVO` y se crea su usuario (HU-04). El total sale de
  `calcularTotal` con lo guardado en la matrícula (`precio_plan`, `clases_por_mes_plan`, `clases_totales`), nunca del plan
  (HU-19).
- **Tokens públicos.** Un token que da acceso sin sesión se genera con 32 bytes criptográficos, se guarda solo su SHA-256, se
  busca dentro de la academia del nombre corto y viaja en el cuerpo o en una cabecera, nunca en la dirección de la API. Toda
  cabecera que lo lleve (o que lleve una dirección de la web que lo contenga, como `Referer`) se redacta en el registro
  técnico (criterio 53).
- **Límites de `GET`.** Toda regla de límite por IP para `GET` vale también para `HEAD`, con el mismo contador (criterio 49).
- **Límites por conexión (DR-15).** Toda regla nueva de límite por IP o por conexión cuenta con `claveDeConexion`: IPv4 exacta
  (también la mapeada a IPv6) e IPv6 por bloque /64 (criterios 59 y 60).
- **Vista de seguimiento (DR-14).** El nombre solo aparece en la solicitud vigente del cliente, si no está `VENCIDA` ni
  `CANCELADA`. Si la 007 permite más de una solicitud no vencida ni cancelada por alumno, el nombre va solo en la más
  reciente, y sus estados nuevos deciden con esa misma regla si muestran la vista completa o la reducida (criterio 58).
- **Destinatarios del enlace (DR-13).** El enlace va al correo del alumno y al del apoderado, una vez por dirección distinta
  (criterio 57). Si la 007 vuelve a enviarlo (por ejemplo, tras un rechazo, D-05), usa los mismos destinatarios.
- **Proveedores externos.** Un aviso después de confirmar que llama a un proveedor externo, como el correo, no retiene la
  respuesta (criterio 51). El fallo de un proveedor externo se registra solo con el tipo del error, nunca con su mensaje ni
  sus propiedades, que pueden llevar datos personales (criterio 52).

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
│       ├── planes/ · clases/ · matriculas/ · inscripciones/   (004 y 005a; matriculas/ no tiene controlador)
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
