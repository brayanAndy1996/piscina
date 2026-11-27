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
        └── tareas programadas (faltas desde la 009b; cierre de mes desde la 010b)
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
- **`BaseDatos` es el único punto de acceso.** Expone `conAcademia(academiaId, trabajo, opciones?)`,
  `comoPlataforma(trabajo, opciones?)`, `resolverAcademia(nombreCorto)` y `comprobarConexion()`. Las opciones son
  `OpcionesTransaccion`: el nivel de aislamiento y, desde la 005b, la espera máxima de los bloqueos (ver «Lo que construye
  la historia 005b»). Cada transacción fija los dos valores de contexto (academia y
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
  - **Lo que todavía no usa nada.** Los días por vencer y la prioridad de renovación se guardan y se muestran, pero las
    mensualidades (010) aún no los leen. La tolerancia de tardanza la lee la asistencia desde la 009a (ver «Lo que
    construye la historia 009a»). El teléfono se publica en las páginas públicas (ingreso, inscripción y seguimiento)
    desde la 005a (DR-4 de 003).
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
  especificación está en `specs/005-inscripcion-publica/`. La foto, el panel y la ocupación son de la 005b, más abajo):
  - **Tablas con RLS.** `alumnos`, `apoderados`, `fichas_medicas`, `consentimientos`, `solicitudes_inscripcion`, `matriculas`
    y `matricula_clases`. Cada fila lleva `academia_id`, la RLS está activada y forzada, y las llaves primarias y las
    compuestas hacia las filas padre incluyen `academia_id`. Los datos de salud (Ley 29733) están en `fichas_medicas`, y los
    del apoderado, en `apoderados`. `consentimientos` es la evidencia de los consentimientos (D-07) y solo admite `INSERT`.
  - **Privilegios.** `aquagestion_app` puede leer e insertar en esas tablas, actualizar solo las columnas que cambian (por
    ejemplo, el estado de la solicitud y de la matrícula) y borrar solo en `apoderados` y, desde la 010c, en `matricula_clases` (el cambio de horario quita las clases que salen; ver «Lo que construye la historia 010c»). `alumnos.foto_clave` ya existe,
    la escribe la foto desde la 005b (ver «Lo que construye la historia 005b», más abajo).
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
    (10 por hora) y consulta del seguimiento (10 por minuto). Desde la 005b, la foto tiene su propia regla (10 por hora). Además, una conexión tiene como mucho cinco solicitudes sin
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
    inscritos. Los inscritos se cuentan después de `bloquearClasesParaCupo`. La web los muestra en `/panel/clases` con su
    diálogo de confirmación, desde la 005b (criterio 46).
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
  - **Lo que todavía no trae.** La renovación y el cambio de horario (010). El cobro en efectivo y el paso de cliente a
    alumno llegaron con la 007a, y el pago por Yape o transferencia y su verificación, con la 007b.

- **Lo que construye la historia 005b** (foto de la inscripción y panel de solicitudes; la especificación está en
  `specs/005-inscripcion-publica/`, criterios 34 a 40, 46, 61 a 66 y las partes de la 005b de 28, 33, 43, 44 y 48). No
  tiene migraciones: usa las tablas y los estados que ya creó la 005a.
  - **Foto (`PUT /api/a/{nombreCorto}/solicitudes/foto`).** La imagen va como cuerpo binario, con `Content-Type` `image/jpeg`
    o `image/png`, y el token va en la cabecera `X-Token-Solicitud`, nunca en la dirección. Responde 204 sin cuerpo y con
    `Cache-Control: no-store`. Las comprobaciones van en este orden, y la primera que falla decide:
    1. **Límite por conexión:** 10 subidas por hora, con su propio contador (la regla `foto` de `LIMITES_PUBLICOS`, con la
       clave de conexión, que suma todas las academias). Pasado el límite, 429 `DEMASIADAS_SOLICITUDES` sin leer el cuerpo.
    2. **Tipo y codificación,** antes de leer el cuerpo y de buscar la academia: el tipo de `Content-Type`, sin parámetros,
       debe ser `image/jpeg` o `image/png`, y `Content-Encoding` debe faltar o ser `identity`. Si no, 400 `IMAGEN_NO_VALIDA`.
    3. **Tamaño:** más de 5 242 880 bytes (5 MB) responde 413 `CARGA_EXCESIVA`. Un `Content-Length` mayor se rechaza sin leer
       nada, y sin `Content-Length` el cuerpo deja de leerse al pasar el límite.
    4. **Academia** del nombre corto: 404 `ACADEMIA_NO_ENCONTRADA` o 403 `ACADEMIA_SUSPENDIDA`.
    5. **Token:** sin la cabecera, vacío, repetido, con otra forma, que no existe o que es de otra academia: 404
       `SOLICITUD_NO_ENCONTRADA`, con el mismo cuerpo del seguimiento.
    6. **Solicitud editable,** con la vista completa: 409 `SOLICITUD_NO_EDITABLE` si está vencida o cancelada (también en el
       instante del vencimiento, incluido el tope del fin de mes), si la fila ya no está `PENDIENTE_PAGO` (la solicitud
       anterior de un cliente que volvió) o si el alumno ya no está en `CLIENTE`.
    7. **Imagen:** 400 `IMAGEN_NO_VALIDA` si el cuerpo está vacío, si su firma no es la del tipo declarado (JPEG `FF D8 FF`;
       PNG `89 50 4E 47 0D 0A 1A 0A`), si `sharp` no la puede decodificar (también una imagen cortada), o si sus dimensiones,
       tal como vienen en el archivo, tienen un lado menor de 100 o mayor de 8000 píxeles, o más de 40 megapíxeles. Los
       límites incluyen el borde.

    Los 400 de imagen tienen todos el mismo cuerpo (`{ codigo, mensaje }`, sin `detalles`). Ningún rechazo cambia la foto
    guardada, deja un archivo ni audita. Una foto nueva reemplaza a la anterior, y la vista completa de la solicitud pasa a
    `fotoCargada: true`. Una `PENDIENTE_PAGO` sin vencimiento (pago en verificación, desde la 007) también la acepta. Los
    demás métodos sobre esa dirección responden como una ruta inexistente. Los límites están en
    `packages/contratos/src/fotos.ts` (`FOTO_TIPOS`, `FOTO_TAMANO_MAXIMO`, `FOTO_LADO_MINIMO`, `FOTO_LADO_MAXIMO`,
    `FOTO_PIXELES_MAXIMOS` y `FOTO_LADO_GUARDADO`), y los usan la API y la web.
  - **Recodificación.** La imagen aceptada se vuelve a codificar con `sharp` como JPEG de como mucho 800 píxeles en su lado
    mayor (sin agrandar), con la orientación aplicada y **sin metadatos**: nada de EXIF (ni coordenadas GPS), XMP, ICC ni
    comentarios. Lo que se guarda nunca es el archivo subido.
  - **Transacción de la foto (criterio 37).** Una lectura corta comprueba la solicitud (token y estado), sin bloqueos y sin
    tocar archivos. Después, fuera de toda transacción, se recodifica la imagen y se **guarda primero**, con una clave nueva
    (`academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`): un archivo sin referencia no lo ve nadie, pero una
    referencia a un archivo que no existe, sí. Luego, una transacción toma `alumnos` con `FOR UPDATE` y después
    `solicitudes_inscripcion` con `FOR UPDATE` (el mismo orden que el envío), repite la comprobación de que la solicitud sigue
    editable, lee la clave anterior y guarda la nueva en `alumnos.foto_clave`. **Después de confirmar** se borra el archivo
    anterior. Si la transacción rechaza la subida ella misma (409 o 404), se borra el archivo nuevo y `foto_clave` no cambia.
    Si falla un borrado, queda un aviso en el registro técnico con el tipo del error, y la respuesta sigue siendo 204. La
    subida no escribe en `auditoria`: solo registra un `info` `'Foto de la solicitud guardada'` con la academia.
  - **Confirmación incierta (criterios 61 y 64).** Si la transacción falla con otro error (de la base, de la conexión o del
    `COMMIT`), no se sabe si el `COMMIT` llegó, así que todavía no se borra nada. Se relee `foto_clave` en una transacción
    nueva de la academia que toma `FOR SHARE` sobre la fila del alumno, con una espera máxima de bloqueo de 5 s
    (`FOTO_ESPERA_RELECTURA_MS`). Así espera a que una confirmación en camino termine, y lo que lee después es definitivo.
    Si la clave que hay es la nueva, la foto quedó: 204 y se borra la anterior. Si es otra o es nula, se borra la nueva y la
    respuesta es 500 `ERROR_INTERNO`. Si la relectura falla o la espera se agota (`55P03`), no se borra ningún archivo y la
    respuesta es también 500. En esos casos queda un `warn` `'Confirmación de la foto incierta'`, con la academia y el tipo del
    error. **Invariante:** después de cualquier subida, `foto_clave` es nula o apunta a un archivo que existe. Puede quedar un
    archivo sin referencia (si falla un borrado o la relectura); eso está en «Riesgos aceptados» de la spec.
  - **`BaseDatos`, opción `esperaMaximaDeBloqueoMs`.** `conAcademia(academiaId, trabajo, { esperaMaximaDeBloqueoMs })` fija
    `lock_timeout` con esos milisegundos después de fijar el contexto y antes del trabajo, con `set_config(…, true)`. Es local
    a la transacción, como `SET LOCAL`: la siguiente transacción de la misma conexión vuelve al valor anterior. Admite un entero
    de 1 a 60000; con otro valor lanza `RangeError` sin ejecutar el trabajo. Sin la opción no se fija nada. Se pide así porque
    los módulos no pueden hacer `SET LOCAL` (las reglas de lint lo prohíben). El resto no cambia: 10 s para conseguir una
    conexión y 15 s de duración máxima por transacción.
  - **`AlmacenArchivos` (`infraestructura/almacen-archivos/`).** La interfaz tiene tres operaciones, todas con la academia y
    una clave: `guardar(academiaId, clave, contenido, tipo)`, `leer(academiaId, clave)` y `borrar(academiaId, clave)`. Se
    inyecta con el token `ALMACEN_ARCHIVOS`, como `ENVIADOR_CORREO`. La implementación de disco es `AlmacenArchivosDisco`, con
    `constructor(raiz)`: la API la crea con `ALMACEN_DIRECTORIO`, y las pruebas, con un directorio temporal.
    - **Formato de la clave.** La genera el servidor y nunca viene del cliente. Es `academias/{academiaId}/` seguido de uno o
      más segmentos separados por `/`, cada uno con `^[a-z0-9][a-z0-9_-]*(\.[a-z0-9]+)?$`. `{academiaId}` es el UUID en
      minúsculas que recibe el almacén, y la clave tiene como mucho 255 caracteres ASCII. Quedan fuera `.` y `..`, los
      segmentos vacíos, la barra final, las mayúsculas, los espacios, `%`, `\`, `:`, los bytes nulos y las rutas absolutas.
    - **Rechazos.** Con una clave que no cumple, con un `academiaId` que no es UUID o con una clave de otra academia, las tres
      operaciones devuelven una promesa rechazada, sin crear, leer, cambiar ni borrar nada. También rechazan si la ruta resuelta
      queda fuera de la carpeta de la academia, o si esa carpeta, una carpeta debajo de ella o el propio archivo es un enlace
      simbólico (o una unión de Windows). Los mensajes no llevan la ruta.
    - **Comportamiento.** `guardar` crea las carpetas que falten y escribe primero un archivo temporal en la misma carpeta, para
      renombrarlo después: no quedan archivos a medias con la clave final. `leer` de una clave válida que no existe rechaza;
      `borrar` de una clave válida que no existe resuelve, porque borrar es idempotente.
    - Ninguna ruta sirve ese directorio: `GET /api/almacenamiento/{clave}`, `GET /almacenamiento/{clave}` y `GET /{clave}`
      responden 404.
  - **`ALMACEN_DIRECTORIO` (`infraestructura/entorno/entorno.ts`).** Es la carpeta donde se guardan los archivos. Por defecto,
    `backend/almacenamiento`, que git ignora. Una ruta relativa se toma desde la raíz del repositorio. La resuelve
    `resolverAlmacenDirectorio(valor, { raiz, ruta })`, una función pura que recibe `path.win32` o `path.posix`, así que se
    prueba igual en cualquier sistema. Si el valor no es válido, la API no arranca, y `validarEntorno` nombra la variable sin
    mostrar la ruta. Se rechaza si:
    - tiene un carácter de control (U+0000 a U+001F);
    - (solo con `path.win32`) empieza con dos separadores (los prefijos `\\?\` y `\\.\`, las rutas de red como
      `\\servidor\recurso`, `\??\`), lleva `<`, `>`, `"`, `|`, `?` o `*`, tiene un `:` fuera de la unidad del principio
      (`carpeta\x:datos`, `D:carpeta`), o tiene un segmento que termina en punto o en espacio (`frontend.\public`, que Windows lee
      como `frontend\public`);
    - queda dentro de `frontend/`, `packages/` o `node_modules/` de la raíz, también `frontend/public`. La comparación es por
      segmentos y **no distingue mayúsculas en ningún sistema**. Con `path.win32`, un nombre corto de 8.3 (como `NODE_M~1`)
      coincide con cualquier nombre de esa posición.

    Los nombres cortos no se rechazan por sí solos, porque el directorio temporal de Windows suele tenerlos; un nombre corto
    justo debajo de la raíz (`ALMAC~1`) sí se rechaza, y se escribe el nombre largo. Un enlace, una unión o una unidad creada con
    `subst` que lleve a `frontend/` no se detecta por el texto de la ruta: es un riesgo aceptado, que exige escribir a propósito
    una ruta rara en la configuración.
    - **Nota de hosting: la raíz del repositorio.** `RAIZ_DEL_REPOSITORIO` se calcula desde `__dirname`: son cuatro carpetas hacia
      arriba desde `src/infraestructura/entorno/` (o desde `dist/infraestructura/entorno/`, al compilar a `backend/dist`), es
      decir, la carpeta que contiene `backend/`. Si el hosting copia `dist` a otro lugar, esa cuenta deja de dar la raíz del
      repositorio, y las rutas relativas de `ALMACEN_DIRECTORIO` (y su valor por defecto) caerían en otro sitio. Al elegir el
      hosting (D-21) hay que repasarlo: o se fija `ALMACEN_DIRECTORIO` con una ruta absoluta, o se calcula la raíz de otra forma.
  - **Panel de solicitudes (criterios 38 y 39).** `GET /api/solicitudes?estado=` y `POST /api/solicitudes/{id}/cancelar`, con
    `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')`, es decir, `ADMIN` y `SECRETARIA`. `ENTRENADOR` y `ALUMNO` reciben 403
    `SIN_PERMISO`; sin sesión, 401; y el Superadmin no tiene estas rutas (D-29). La academia sale siempre de la sesión, nunca de
    la dirección ni del cuerpo, así que `?academiaId=` no cambia nada.
    - **Lista.** `estado` puede ser `ACTIVAS` (por defecto), `VENCIDAS`, `CANCELADAS` o `TODAS`, y filtra por el estado visible
      (una `PENDIENTE_PAGO` con la reserva vencida cuenta como `VENCIDA`). Otro valor, uno en minúsculas o el parámetro repetido
      responden 400 `SOLICITUD_INVALIDA` con `detalles.errores[0].campo` igual a `estado`. La lista va de la más nueva a la más
      antigua (`creadaEn` y, a igual fecha, `id`) y trae como mucho 200 después de filtrar. Cada elemento (`solicitudPanelSchema`,
      estricto) tiene `id`, `codigo`, `estado`, `creadaEn`, `reservaVenceEn`, `nombres`, `apellidos`, `dni`, `telefono`,
      `menorDeEdad`, `plan` (`id` y `nombre`), `clases` (día y hora de cada una), `mes`, `clasesTotales` y `monto` (texto con dos
      decimales). No lleva datos médicos, apoderado, consentimientos, foto, IP, token ni su hash, ni fecha de nacimiento. Los
      datos personales son los actuales del alumno, también en sus solicitudes anteriores. La lectura no audita.
    - **Cancelación.** Cuerpo `{ motivo }`, de 3 a 200 caracteres visibles. Todo en una sola transacción y en este orden:
      `bloquearActorVigente`, la solicitud con `FOR UPDATE`, su matrícula con `FOR UPDATE` y las clases de esa matrícula con
      `bloquearClasesParaCupo`, en una sola llamada. No toma `alumnos`, así que no entra en ciclo ni con el envío ni con la foto.
      Una solicitud `PENDIENTE_PAGO` (vencida o no) pasa a `CANCELADA`, y su matrícula `RESERVADA` pasa a `CANCELADA` con
      `reserva_vence_en` nula: el cupo se libera en ese momento. **Es idempotente:** una solicitud ya cancelada responde 200 sin
      escribir ni auditar, así que dos cancelaciones dejan una sola auditoría. Una fila `VENCIDA` (la solicitud anterior de un
      cliente que volvió, criterio 21 b) responde 409 `SOLICITUD_NO_CANCELABLE`. Un id que no es UUID, que no existe o que es de
      otra academia responde 404 `NO_ENCONTRADO`.
    - **Auditoría exacta.** Una sola entrada `SOLICITUD_INSCRIPCION_CANCELADA`, con entidad `solicitud_inscripcion`, `entidadId`
      el id de la solicitud, actor `USUARIO` (quien cancela), `motivo`, la IP, `datosAntes: { estado }` (el estado visible de
      antes: `PENDIENTE_PAGO` o `VENCIDA`) y `datosDespues: { estado: 'CANCELADA' }`. Nada más: ni DNI, nombres, datos médicos ni
      token.
    - **Sin correo y sin tocar la foto** (respuestas B1 y B2, DR-17 y DR-18). La cancelación no envía correo; el cliente ve
      "Cancelada" en su enlace de seguimiento. `alumnos.foto_clave` y el archivo no cambian, porque ninguna historia borra la foto
      de una solicitud cancelada o vencida hasta que exista la política de retención (Ley 29733).
    - **Ocupación (criterio 40).** `GET /api/clases/ocupacion`, con `@Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')` (solo `ADMIN`),
      responde `{ mes, ocupacion: [{ claseId, inscritos, cuposRestantes }] }`, con un elemento por cada clase de la academia,
      activa o no. `inscritos` es `contarInscritos` (la misma cifra de los 409 de DR-5), y `cuposRestantes` es
      `max(0, aforo − ocupación del mes)`, con `contarOcupacion`. No audita ni bloquea.
    - **Web.** `/panel/solicitudes` (solo `ADMIN` y `SECRETARIA`) lista con el filtro, muestra los datos de cada solicitud y
      cancela con un diálogo que pide el motivo (botón "Cancelar" de la tarjeta, en las activas y en las vencidas). El inicio del
      panel tiene "Solicitudes de inscripción" y "Nueva inscripción", que abre en otra pestaña el formulario público de la
      academia. La grilla de `/panel/clases` muestra "inscritos / aforo" con `GET /api/clases/ocupacion`, y los diálogos de DR-5.
      Las claves de las consultas incluyen la identidad de la sesión.
    - **Foto desde recepción (respuesta B5, DR-21).** La secretaria sube la foto en el paso de la foto del formulario público,
      como cualquier cliente. **Cumplida por la 008b:** el panel pone o cambia la foto, con archivo o con la cámara, en el carnet del alumno y en las tarjetas de solicitudes (ver «Lo que construye la historia 008b»).
  - **Servidor de desarrollo de la web (`frontend/vite.config.ts`, criterios 62 y 65).** Por defecto, Vite deja leer por
    `/@fs/` casi todo el repositorio, incluido el almacén. Por eso `server.fs.allow` es una lista cerrada: `frontend/`,
    `packages/contratos/` y el `node_modules/` de la raíz, con `server.fs.strict` en `true`. `server.fs.deny` tiene los valores
    por defecto de Vite 8.3.8 (`.env`, `.env.*`, `*.{crt,pem,key,p12,pfx,cer,der}`, `.npmrc`, `.yarnrc.yml` y `**/.git/**`) más
    `**/node_modules/@aquagestion` y `**/node_modules/@aquagestion/**`. Hace falta porque npm enlaza cada workspace en
    `node_modules/@aquagestion/` (una unión en Windows), y Vite no resuelve esos enlaces al decidir. La web no usa esa ruta: el
    paquete `@aquagestion/contratos` se resuelve a `packages/contratos/`. Como Vite reemplaza su lista de `deny` si la
    configuración trae una, los valores por defecto se copian a mano. **Si se actualiza Vite, hay que revisar esos valores** (en
    `node_modules/vite/dist/node/chunks/node.js`, `server.fs.deny`) y copiarlos de nuevo. Un paquete nuevo del workspace usa el
    ámbito `@aquagestion/`; si no lo usa, su enlace se suma a `deny`.
  - **Pruebas sin almacén de desarrollo (criterio 63).** Ninguna prueba escribe en `backend/almacenamiento`. Las pruebas del
    backend (`vitest.config.mts`) usan `ALMACEN_DIRECTORIO` en `os.tmpdir()/aqua-almacen-{pid}`: `global-setup-almacen.ts` la
    crea antes y la borra al terminar. Las E2E (`e2e/playwright.config.ts`) arrancan la API con
    `os.tmpdir()/aqua-e2e-almacen-{uuid}`, que `e2e/global-teardown.ts` borra. Las dos limpiezas solo borran lo que tiene ese
    prefijo y está dentro de `os.tmpdir()`. La única excepción es la prueba del criterio 62, que crea y borra su propio archivo
    en una carpeta de academia con UUID nuevo.
  - **Registro técnico (criterios 28 y 53).** `x-token-solicitud` y `referer` se redactan en todo el registro de la API
    (`RUTAS_REDACTADAS`, en `infraestructura/registro/opciones-registro.ts`), con un texto fijo. La línea de la petición de la
    foto no lleva cuerpo ni token, y los fallos de la foto se registran solo con el tipo del error.
- **Lo que construye la historia 006a** (caja del día, D-23; la especificación está en `specs/006-caja/`). Migración
  `20261122120000_caja`, módulo `backend/src/modulos/caja/` y página `/panel/caja`. El historial, el detalle y el PDF del
  cierre son de la 006b (sección «Historial y PDF del cierre (006b)», más abajo), que no tiene migraciones:
  - **Tablas con RLS.** `cajas`, `movimientos_caja` y `cierres_caja`. Cada fila lleva `academia_id`, la RLS está activada y
    forzada, y las políticas de `SELECT` e `INSERT` (y de `UPDATE`, en `cajas` y `cierres_caja`) son de la forma de 001:
    solo se ve y se escribe la academia del contexto. Ninguna tiene política de `DELETE`, y `movimientos_caja` no tiene `UPDATE`: nada se borra y un
    movimiento no cambia (DR-5).
  - **Tipos.** `estado_caja` (`ABIERTA`, `CERRADA`), `tipo_movimiento_caja` (`INGRESO`, `EGRESO`),
    `concepto_movimiento_caja` (`INSCRIPCION`, `MENSUALIDAD`, `CLASE_PARTICULAR`, `EGRESO_MENOR`; la 019 suma el suyo) y
    `metodo_pago` (`EFECTIVO`, `YAPE`, `TRANSFERENCIA`), que la 007 reutiliza en `pagos`.
  - **Una caja por día y una abierta a la vez.** `UNIQUE (academia_id, fecha)` (`cajas_academia_id_fecha_key`, DR-1) y el
    índice único parcial `cajas_una_abierta_por_academia` (`WHERE estado = 'ABIERTA'`). El `CHECK` `cajas_fecha_de_lima`
    exige que la `fecha` sea la de Lima de `abierta_en`.
  - **Invariantes con `CHECK`** (criterio 4), para cualquiera que escriba en la base: `monto_inicial` no negativo y sin
    `NaN`, y montos de movimiento mayores que 0. Un ingreso tiene concepto de cobro, alumno y pago, y no tiene descripción,
    comprobante ni clave. Un egreso es `EGRESO_MENOR` en `EFECTIVO`, con descripción y clave, y sin alumno ni pago. En
    `cierres_caja`: `esperado = inicial + ingresos en efectivo − egresos` (sección 4.3; Yape y transferencia no suman, D-04),
    `diferencia = declarado − esperado`, observación obligatoria si la diferencia no es 0, y la reapertura completa (quién,
    cuándo y motivo) o nula, con `reabierto_en >= cerrado_en`.
  - **Un cierre vigente por caja.** Cada cierre es una fila (D1). El índice único parcial `cierres_caja_un_vigente_por_caja`
    (`WHERE reabierto_en IS NULL`) deja como mucho un cierre sin reabrir por caja. La reapertura solo completa las tres
    columnas de reapertura.
  - **Trigger `movimientos_caja_solo_caja_abierta`** (criterio 6, DT-4). Antes de insertar un movimiento toma la fila de la
    caja con `FOR SHARE` y rechaza con `23514` si la caja que ve no está `ABIERTA`. Si no la ve (no existe, es de otra
    academia o la RLS la oculta), deja pasar la fila, y responden la llave compuesta (`23503`) o la política (`42501`)
    (PP1). Es `SECURITY INVOKER`, con `search_path` fijo, y tiene `REVOKE ALL … FROM PUBLIC`, porque nadie la llama a mano.
  - **Privilegios de `aquagestion_app`** (criterio 2). `cajas`: `SELECT` e `INSERT`, y `UPDATE` solo de `estado` y
    `actualizado_en`. `movimientos_caja`: `SELECT` e `INSERT`. `cierres_caja`: `SELECT` e `INSERT`, y `UPDATE` solo de
    `reabierto_por`, `reabierto_en` y `motivo_reapertura`. Ninguna fecha, ningún monto y quién abrió no cambian.
  - **Permiso `REABRIR_CAJA`** (DT-1): `ADMIN: 'TODO'`. La matriz pasa de 24 a 25 filas (criterio 26 de 002).
    `ABRIR_CERRAR_CAJA` (`ADMIN` y `SECRETARIA`) cubre la consulta de la caja, la apertura, los egresos y el cierre;
    `REABRIR_CAJA`, solo la reapertura.
  - **Módulo `backend/src/modulos/caja/`.** `caja.module.ts`, `cajas.controller.ts` y `cajas.service.ts` (apertura, caja
    actual, egreso, cierre y reapertura). `movimientos.ts`, sin Nest, tiene las tres funciones de la interfaz de los cobros
    (sección «Caja del día (006a)», más abajo) y sus bloqueos internos. `lectura.ts` arma la caja (resumen, movimientos y cierres). En `dominio/`,
    `esperado.ts` (`calcularResumen` y `calcularDiferencia`, con `Decimal`) y `dia.ts` (`esDeOtroDia` y `esCierreTardio`)
    son funciones puras. `index.ts` reexporta las interfaces y `CajaModule`.
  - **Rutas.** `GET /api/cajas/actual` (la caja abierta, o la de hoy, o `null`; sin bloqueos ni auditoría), `POST
    /api/cajas` (apertura), `POST /api/cajas/{id}/egresos`, `POST /api/cajas/{id}/cierre` y `POST
    /api/cajas/{id}/reapertura`, con `REABRIR_CAJA`. Un `{id}` que no es UUID responde 404, como uno que no existe o es de
    otra academia. Los errores de negocio siguen el orden de «Orden de los errores de negocio» de la spec.
  - **Auditoría.** `CAJA_ABIERTA`, `CAJA_EGRESO_REGISTRADO`, `CAJA_CERRADA` y `CAJA_REABIERTA` (con su motivo), y
    `CAJA_INGRESO_REGISTRADO` desde la interfaz. Los montos van como texto con dos decimales, y la IP es nula si no hay. Una
    respuesta 200 de una clave repetida no audita.
  - **Contratos** (`packages/contratos/src/caja.ts` y `dinero.ts`). `montoNoNegativoSchema`, `montoConSignoSchema` (tope
    `9999999999.99` en valor absoluto) y `restarMontos`, que trabaja en céntimos con `bigint`; los esquemas de apertura,
    egreso, cierre y reapertura, y `METODOS_PAGO`. El comprobante del egreso rechaza los caracteres de dirección del texto y
    los separadores, y se guarda `null` si no tiene nada visible (criterio 47).
  - **Web** (`/panel/caja`, en `frontend/src/modulos/caja/`). Cuatro estados: sin caja de hoy (formulario de apertura), caja
    de hoy abierta (egresos y cierre), caja abierta de otro día (solo cierre) y caja de hoy cerrada (resultado del cierre y,
    para el administrador, «Reabrir caja»). El cierre muestra el esperado por método antes de contar, y la diferencia
    mientras se escribe. Cada diálogo guarda su clave de idempotencia, y las consultas llevan la identidad de la sesión.
    Una caja cerrada de un día anterior se muestra como «sin caja de hoy», sin ofrecer reabrirla (desviación del plan).
  - **Semilla.** En `delfines`, una caja cerrada del 2026-11-02, abierta y cerrada por la secretaria de ejemplo (DNI
    `10000002`), con un egreso de S/ 15.50 y un cierre con un sobrante de S/ 0.50 y su observación. Las claves de
    idempotencia son fijas: repetir la semilla no duplica nada. `tiburones` queda sin cajas. `/panel/caja` solo muestra la
    caja de hoy o la abierta, así que esta se ve en el historial (006b).
  - **Lo que todavía no trae.** Los cobros de la 010 y la 016, y el egreso desde caja
    de la 019. Las verificaciones de Yape y transferencia llegaron con la 007b. El historial, el detalle y el PDF del cierre llegaron con la 006b, y la reapertura de un día anterior desde
    la web también.
- **Lo que construye la historia 006b** (historial y PDF del cierre; sin migraciones, con `pdfkit`). Las tres lecturas de
  la caja, con el alcance por rol, los 404 iguales, el PDF por tramos, la cola de generación y la web del historial. Su
  detalle está en «Historial y PDF del cierre (006b)», más abajo.

- **Lo que construye la historia 007a** (cobro en recepción y cuenta del alumno; criterios 1 a 35 y 54 a 59 de `specs/007-pagos/spec.md`, en sus partes de la 007a: el criterio 55 y las partes **[007b]** son de la 007b). Migraciones `20261124180000_estado_solicitud_confirmada`, `20261124180100_pagos` y `20261124190000_pagos_movimiento_confirmado` (en `backend/prisma/migrations/`), el módulo `backend/src/modulos/pagos/`, el id ordenado de la auditoría (`backend/src/modulos/auditoria/id-ordenado.ts`) y las pantallas del cobro, del ajuste, del ticket y del seguimiento. La subida del comprobante de Yape o transferencia, la bandeja y el rechazo son de la 007b:
  - **Tabla `pagos` con RLS.** Cada fila lleva `academia_id`. La RLS está activada y forzada, con tres políticas de la forma de 001: `pagos_leer` (`SELECT`), `pagos_crear` (`INSERT`) y `pagos_modificar` (`UPDATE`), todas con `academia_id = app_academia_actual()`. No hay política de `DELETE`: un pago no se borra. La tabla guarda el monto (`numeric(10,2)`), el método, el concepto, el estado (`estado_pago`: `PENDIENTE_VERIFICACION`, `CONFIRMADO` o `RECHAZADO`), el número de operación escrito y normalizado, la fecha de operación y la clave del comprobante (solo Yape y transferencia), quién registró y quién verificó, las fechas de registro y de verificación, el motivo del rechazo, el número de ticket y la clave de idempotencia. Está completa desde la 007a, para que la 007b no tenga migración.
  - **Llaves compuestas.** `(academia_id, alumno_id)` apunta a `alumnos`; `(academia_id, matricula_id, alumno_id)` apunta a `matriculas`, que gana `UNIQUE (academia_id, id, alumno_id)`, así que un pago es del mismo alumno que su matrícula; `registrado_por` y `verificado_por` apuntan a `usuarios`. `solicitudes_inscripcion` gana `registrada_por`, con su llave a `usuarios`. Ninguna fila apunta a otra academia, aunque la API fallara.
  - **Invariantes con `CHECK` e índices únicos** (criterio 4; valen también para el dueño de las tablas). El monto es mayor que 0 y como mucho `100000.00`. Un pago en efectivo nace `CONFIRMADO`, sin datos de operación. Yape y transferencia llevan número de operación, comprobante y fecha de operación. El número normalizado cumple `^(0|[1-9A-Z][0-9A-Z]{0,29})$`. El estado es coherente con su verificación, su motivo y su ticket: un `CONFIRMADO` tiene ticket; un `RECHAZADO`, motivo; un `PENDIENTE_VERIFICACION`, ninguno de los dos. `verificado_en` no es anterior a `registrado_en`. Los índices únicos son `pagos_un_abierto_por_matricula` (un pago abierto, `PENDIENTE_VERIFICACION` o `CONFIRMADO`, por matrícula), `pagos_numero_operacion_abierto_key` (un número normalizado por academia y método entre los pagos abiertos; uno rechazado no cuenta), `pagos_academia_id_clave_idempotencia_key` y `pagos_academia_id_numero_ticket_key` (un ticket por academia).
  - **Relación con `movimientos_caja`** (criterios 3, 5 y 58; D-04, DT-2). La caja de un pago es la de su movimiento: `pagos` no tiene `caja_id`. Un pago `CONFIRMADO` tiene exactamente un movimiento `INGRESO` con su `pago_id`, del mismo alumno, método, monto y concepto, y todo movimiento con `pago_id` apunta a un pago `CONFIRMADO` igual a él. Lo garantizan dos triggers de restricción diferidos con el mismo nombre, `pagos_confirmado_con_movimiento`, uno en `pagos` y otro en `movimientos_caja`. Son `SECURITY INVOKER`, con `search_path` fijo y `REVOKE ALL … FROM PUBLIC`, y cierran por defecto: si no ven la fila relacionada (por otra academia, por la RLS o porque un `SET CONSTRAINTS … IMMEDIATE` la comprueba antes de que exista), rechazan con `23514`. Nunca dan la transacción por buena por no verla. Leen el estado actual de la fila, no el del evento, así que el orden de las escrituras dentro de la transacción no importa.
    - **Llave diferida.** `movimientos_caja (academia_id, pago_id) → pagos (academia_id, id)` es `DEFERRABLE INITIALLY DEFERRED`, porque el pago en efectivo se inserta después de su movimiento, en la misma transacción. Un `pago_id` que no existe se rechaza con `23503` al confirmar (criterio 3).
    - **Los movimientos no cambian ni se borran.** El trigger por sentencia `movimientos_caja_no_cambian` (`BEFORE UPDATE OR DELETE FOR EACH STATEMENT`) rechaza con `23514` todo `UPDATE` o `DELETE` sobre `movimientos_caja`, también el de un egreso o de un movimiento sin pago, y aunque la sentencia no alcance ninguna fila. Tiene que ser por sentencia: la RLS de `movimientos_caja` no tiene políticas de `UPDATE` ni de `DELETE`, así que para el dueño de las tablas un trigger por fila nunca correría. La app recibe antes `42501` por privilegio. `TRUNCATE` no se rechaza: lo usa la limpieza de las pruebas.
    - **Para una migración futura.** Si una migración necesita un `UPDATE` sobre `movimientos_caja`, tiene que desactivar `movimientos_caja_no_cambian` dentro de su propia migración (`ALTER TABLE movimientos_caja DISABLE TRIGGER movimientos_caja_no_cambian`) y volver a activarlo al terminar (`ENABLE TRIGGER`). El dueño de las tablas puede desactivar un trigger; por eso el cambio queda a la vista en la migración y en su revisión, y no en el código de la API.
    - **Transiciones.** El trigger `pagos_transiciones` (`BEFORE UPDATE`, por fila) deja que un pago `PENDIENTE_VERIFICACION` pase a `CONFIRMADO` o a `RECHAZADO` una sola vez. Un pago resuelto no cambia, ni siquiera con un `UPDATE` que no cambia nada, como app o como dueño (`23514`; criterio 6).
  - **Privilegios de `aquagestion_app`** (criterio 2). En `pagos`: `SELECT` e `INSERT`, y `UPDATE` solo de `estado`, `verificado_por`, `verificado_en`, `motivo_rechazo`, `numero_ticket` y `actualizado_en`; sin `DELETE`. Gana además `UPDATE` de `alumnos.estado` y `alumnos.usuario_id` (el paso a `ALUMNO_ACTIVO`) y de `matriculas.monto_ajustado` y `matriculas.motivo_ajuste` (el ajuste). No puede cambiar el monto, el método, el número de operación, el comprobante, la fecha de operación, la matrícula ni el alumno de un pago, ni la `academia_id` de ninguna fila. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se ampliaron igual.
  - **Estado de la solicitud.** `estado_solicitud` suma `CONFIRMADA`, que se guarda en la fila (DT-4). `EN_VERIFICACION` y `PAGO_RECHAZADO` se calculan al leer, con el último pago de la matrícula, y los produce la 007b. `estadoVisible` (en JS) y `estadoVisibleSql` (en SQL) aplican la misma regla. Una solicitud `CONFIRMADA` no es activa, y su matrícula está `VIGENTE`, que ocupa cupo del mes. La vista de seguimiento de `CONFIRMADA` no lleva la foto y muestra el método, el monto, la fecha de confirmación y el número de ticket del pago confirmado (criterio 28). El filtro del panel `CONFIRMADAS` (**Confirmadas**) suma la lista.
  - **Permisos** (DT-12, criterio 8). `AJUSTAR_MONTO_COBRO` con `ADMIN: 'TODO'`: la matriz pasa de 25 a 26 filas (criterio 26 de 002). `REGISTRAR_INSCRIPCION_Y_COBRO` (`ADMIN` y `SECRETARIA`) cubre el cobro en efectivo, el ticket y el panel de solicitudes. El ajuste del monto es solo del administrador (RN-25): la secretaria recibe 403 `SIN_PERMISO`.
  - **Módulo `backend/src/modulos/pagos/`.** `pagos.module.ts`, `pagos.controller.ts` (cobro, ajuste y ticket), `cobros.service.ts` (el cobro en efectivo y el ajuste), `ticket.service.ts` y `errores.ts`. Sin Nest: `confirmacion.ts` (`confirmarPagoEnTransaccion`), `bloqueos.ts` (`leerDniDeLaSolicitud` y `bloquearFilasDelCobro`) y `dominio/total.ts` (`totalACobrar`, pura). `index.ts` reexporta lo que usarán la 007b, la 010 y la 016. `dominio/numero-operacion.ts` reexporta `normalizarNumeroOperacion`, la misma función de `packages/contratos/src/pagos.ts` que usan la API, la web y las pruebas.
  - **Orden de bloqueos del cobro** (criterio 19; «Orden de bloqueos con la caja» de la 006). Cobro y ajuste toman las mismas filas en el mismo orden, así que se ordenan entre sí (criterio 12). Con `bloquearActorVigente` como primera sentencia: (1) `usuarios`, el actor, con `FOR SHARE`; (2) el bloqueo consultivo `inscripcion-dni:` + academia + DNI, el mismo del envío de la 005 y de la creación de personal (DT-16); (3) `alumnos`, con `FOR UPDATE`, comprobando que su DNI sea el leído; (4) `solicitudes_inscripcion`; (5) `matriculas`; (6) `pagos`; (7) las clases, con `bloquearClasesParaCupo` en una sola llamada (solo el cobro, porque el ajuste no mueve cupo), y «ahora» se lee después de bloquearlas (DT-10); (8) la caja, al final, dentro de `confirmarPagoEnTransaccion`. El DNI se lee antes, sin bloquear, porque el bloqueo consultivo lo necesita; por eso el hash argon2 de la contraseña inicial se calcula antes de abrir la transacción (criterio 23). Después de la caja solo se insertan filas o se actualizan las que la transacción ya bloqueó.
  - **Cobro en efectivo** (criterios 13 a 19; `POST /api/solicitudes/{id}/pago-efectivo`, cuerpo `{ claveIdempotencia, montoMostrado }`, con `cobrarEnEfectivoSchema`, estricto). Responde 201 con `{ pago, solicitud }`, o 200 con lo mismo si la clave ya cobró esa solicitud con el mismo monto: un doble clic o un reintento no crea otro pago, otro movimiento, otro usuario ni otra auditoría, aunque la caja esté cerrada. Los errores salen en el orden del contrato: actor (401), solicitud (404), clave (`CLAVE_YA_USADA`), estado (`SOLICITUD_YA_PAGADA`, `PAGO_EN_VERIFICACION`, `SOLICITUD_NO_COBRABLE`), monto (`MONTO_CAMBIO`, con el total), cupo (`SIN_CUPO`, para un pago rechazado, que la 007a no produce), DNI del personal (`DNI_DEL_PERSONAL`) y, al final, la caja (`SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`). Una `PENDIENTE_PAGO` cuya reserva venció mientras el cobro esperaba las clases responde `SOLICITUD_NO_COBRABLE` (estado `VENCIDA`), no `SIN_CUPO`. Si dos cobros chocan a la vez con una restricción única, el cobro se decide otra vez una sola vez con lo que ya confirmó la otra transacción; si sigue el choque, el 409 sale del nombre de la restricción (`SOLICITUD_YA_PAGADA` o `CLAVE_YA_USADA`).
  - **Ajuste del monto** (criterios 11 y 12; `POST /api/solicitudes/{id}/ajuste-monto`, solo `ADMIN`). Cuerpo `{ montoAjustado, motivo }` (`ajustarMontoSchema`): un entero de soles de `"1"` a `"99999"`, sin céntimos, y un motivo de 3 a 200 caracteres. Responde 200 con `{ solicitud }`. Solo se ajusta una solicitud `PENDIENTE_PAGO` (la 007b suma `PAGO_RECHAZADO`); las demás, incluida `CONFIRMADA`, responden 409 `SOLICITUD_NO_AJUSTABLE`. Guarda `monto_ajustado` y `motivo_ajuste` en la matrícula, sin tocar el cupo, la reserva ni las clases totales (DR-11), y audita `MATRICULA_MONTO_AJUSTADO` con `datosAntes` y `datosDespues` de `{ montoAjustado, total }`. El mismo monto con el mismo motivo responde 200 sin escribir ni auditar.
  - **Total a cobrar** (criterio 10; D-03, HU-19). `totalACobrar({ montoCalculado, montoAjustado })` (`dominio/total.ts`) sale de lo guardado en la matrícula. Sin ajuste, es el `monto_calculado` que se cotizó al inscribirse, sin volver a calcularlo con el plan. Con ajuste, es el monto ajustado. `calcularTotal` (`matriculas/dominio/cobro.ts`) lo redondea hacia arriba al sol entero, una sola vez, al final. Todo el camino usa `Decimal`, y el monto del pago, del movimiento de caja, del seguimiento, del panel y del ticket es ese total.
  - **Paso de cliente a alumno** (criterios 20 a 24; HU-04, RN-01, RN-02). Al confirmar el pago, el alumno pasa de `CLIENTE` a `ALUMNO_ACTIVO` con su cuenta: usuario igual a su DNI y contraseña inicial igual a su DNI, con argon2 y el cambio obligatorio en el primer ingreso. La cuenta la crea `UsuariosService.crearEnTransaccion` (rol `ALUMNO`) y se audita `USUARIO_CREADO` con quien confirma. Un cliente sin pago confirmado no tiene cuenta, así que su DNI no entra. Si ya hay un usuario de la academia con ese DNI (personal, DR-1), el cobro responde 409 `DNI_DEL_PERSONAL` y no escribe nada. Del lado del personal, `POST /api/usuarios` (`crearPersonal`) toma el mismo bloqueo consultivo del DNI y responde 409 `DNI_EN_USO` con el DNI de un alumno que no está en `CLIENTE`, o de un cliente con solicitud activa (criterio 22 b).
  - **Ticket interno** (criterios 25 a 27; HU-07, D-09, DR-4). Cada pago `CONFIRMADO` recibe el siguiente `numero_ticket` de su academia (1, 2, 3…) con `coalesce(max(numero_ticket), 0) + 1`, dentro de la caja bloqueada: no hay saltos ni repetidos aunque cobren varias personas a la vez, y el índice único es el respaldo (DT-13). `GET /api/pagos/{id}/ticket` (`REGISTRAR_INSCRIPCION_Y_COBRO`) responde `{ ticket }` (`ticketSchema`, estricto): la academia y su teléfono, el número, la fecha y hora de la confirmación, el alumno (nombres y apellidos, sin DNI), el concepto, el plan, el mes, el método, el número de operación (solo Yape y transferencia), el total, quién cobró y la leyenda fija «Comprobante interno de pago. No es un comprobante electrónico SUNAT» (`LEYENDA_TICKET`). Un pago pendiente o rechazado, de otra academia o con un id que no es UUID responde 404 `NO_ENCONTRADO`. La lectura no escribe ni audita. La página `/panel/pagos/{id}/ticket` lo imprime con estilos para 80 mm y A4 (DT-14): no se genera ningún archivo. `HEAD` sobre `/api/pagos` responde 404 desde la 007b (DT-15).
  - **Recepción sin los límites por conexión** (criterios 33 a 35; DR-20 de 005, DT-11). Una petición pública a `/api/a/{nombreCorto}/…` con límite propio (`LIMITES_PUBLICOS`: lecturas, cotización, envío, consulta y foto) que trae la cookie `aq_sesion` de un `ADMIN` o una `SECRETARIA` activos, sin cambio de contraseña pendiente y de la academia de ese nombre corto, no suma en esos contadores. El middleware (`proteccion-de-prefijos.ts`) lee esa sesión con una variante de `SesionAcademiaService` que no lanza, y la deja en `req.sesionDeRecepcion`. Cualquier otra cookie (ausente, inválida, vencida, de otra versión del token, de otra academia, de un `ENTRENADOR` o un `ALUMNO`, o con el cambio pendiente) cuenta como antes, y ninguna responde 401 ni 403 por la cookie. El envío con esa sesión llama a `bloquearActorVigente` como primera sentencia (401 `NO_AUTENTICADO` si el actor ya no está vigente), no aplica el límite de cinco solicitudes sin pagar, guarda `registrada_por` y audita `SOLICITUD_INSCRIPCION_CREADA` con actor `USUARIO`. Esas solicitudes no cuentan en el límite de reservas de la conexión (el conteo exige `registrada_por IS NULL`). La foto de recepción tampoco cuenta en su regla. El límite del ingreso (002) no cambia.
  - **Ids de la auditoría ordenados** (criterio 59; `backend/src/modulos/auditoria/id-ordenado.ts`). `idDeAuditoriaOrdenado(fechaHora)` da un UUID versión 7: 48 bits con los milisegundos de la fecha de la fila, 12 bits de un contador que no retrocede dentro del proceso y el resto al azar. `insertarEnAuditoriaDeAcademia` lo usa para `auditoria`, así que, leída `ORDER BY fecha_hora, id`, las filas de un mismo milisegundo salen en el orden en que se registraron. `auditoria_plataforma` sigue con `gen_random_uuid()`: es una pregunta técnica abierta para la historia que la lea (spec 007, «Preguntas técnicas para historias futuras»).
    - Una fecha no válida lanza `RangeError` antes de tocar el estado, que no cambia: no es un `Date` con su valor, es `NaN`, es anterior a 1970 o no cabe en 48 bits. La operación falla y su transacción se revierte; las siguientes siguen bien.
    - Un `Date` se reconoce por su ranura interna, leída con `Date.prototype.getTime` capturado al cargar el módulo, y no con `instanceof`. Un `Date` de otro contexto (`vm`), con el prototipo cambiado o de una subclase vale y da su instante. Un `Proxy`, un primitivo o un objeto que solo imita un `Date` se rechazan sin llamar a sus trampas.
    - Modelo de amenaza (criterio 59 e): el código del mismo proceso que modifica objetos nativos de JavaScript queda fuera. El endurecimiento de la ronda 4 lo dificulta, pero no lo garantiza.
  - **Correo después de confirmar** (criterio 51 a; D-08, D-19). Al confirmar un pago, la plantilla `PAGO_CONFIRMADO` se envía con `enviarSinEsperar`, una vez por cada destinatario distinto: el correo del alumno y, si es menor de edad, el de su apoderado. Lleva el nombre de la academia, el código de la solicitud, la dirección de ingreso (`/a/{nombreCorto}/ingresar`) y el aviso de que el usuario y la contraseña inicial son el DNI. No lleva el DNI ni el token. Si la transacción falla o el cobro es un reintento (200), no se envía nada.
  - **Semilla** (criterio 57). En `delfines`, la solicitud `AQ-SM0001` (DNI `20000001`) tiene un ajuste de monto de ejemplo con su motivo: el total es S/ 60.00, frente al `monto_calculado` de S/ 80.00. Se escribe en la matrícula sin pasar por la API, y solo si la matrícula sigue `RESERVADA` y nadie la ha tocado, así que repetir la semilla no lo duplica ni pisa un ajuste del administrador. **No escribe auditoría** (`MATRICULA_MONTO_AJUSTADO`), como el resto de los datos de ejemplo: la auditoría registra lo que hacen las personas por la API. En la 007a no se siembran pagos (el Yape pendiente de ejemplo es de la 007b, más abajo), y `tiburones` queda sin pagos. La prueba no protegida de la semilla está en `backend/test/integracion/semilla/semilla-ajuste-pagos.test.ts`.
  - **Lo que todavía no trae.** El carnet (008); las renovaciones y las mensualidades (010); los descuentos (015); los cobros de clases particulares (016). La facturación SUNAT es el último módulo (D-09).
  - **Riesgos aceptados** (spec 007, «Riesgos aceptados», y plan, «Riesgos»). La contraseña inicial es el DNI (RN-02): quien lo conozca puede entrar antes que el alumno, y lo limitan el cambio obligatorio, el bloqueo por intentos y el restablecimiento por la secretaria. `USUARIO_CREADO` guarda el DNI como usuario, también el de un menor; la auditoría es interna de la academia y el DNI es el usuario (RN-02). El ticket no tiene valor tributario hasta el módulo de facturación (D-09), y la leyenda lo dice. Un correo que no llega no se reintenta, como en la 005: el cliente ve el estado en su enlace. El cobro toma la caja al final, así que la caja serializa los cobros de la academia (riesgo ya aceptado en la 006). El middleware lee la sesión de recepción en las rutas públicas: una consulta más por petición con cookie válida. Un código del mismo proceso que modifica objetos nativos queda fuera del modelo de amenaza del id de la auditoría (criterio 59 e).

- **Lo que construye la historia 007b** (Yape y transferencia; criterios 36 a 53 de `specs/007-pagos/spec.md`, las partes [007b] de los criterios 11, 15, 18, 21 y 28 a 32, y el criterio 60, que añadió la ronda 1 del ataque). Sin migraciones: todo cabe en la tabla `pagos` de la 007a.
  - **Subida pública del comprobante** (`comprobante.controller.ts` y `comprobante.service.ts`). `PUT /api/a/{nombreCorto}/solicitudes/comprobante`, sin sesión: el token de la solicitud va en la cabecera `X-Token-Solicitud`, nunca en la dirección; los datos del pago, en `X-Pago-Datos` (JSON); la imagen, como cuerpo binario. `recodificarImagen` (con `sharp`) la vuelve a codificar sin metadatos antes de guardarla con `AlmacenArchivos`. Con un comprobante la reserva no vence (`reserva_vence_en = NULL`), y la subida bloquea siempre las clases de la matrícula antes de decidir (criterio 60).
  - **Bandeja y comprobante** (criterios 45 y 46). `GET /api/pagos/pendientes` (`listarPendientes`, en `verificacion.service.ts`) lista los pagos `PENDIENTE_VERIFICACION` del más antiguo al más nuevo, como mucho 200 (`TOPE_DE_LA_BANDEJA`). `GET /api/pagos/{id}/comprobante` devuelve la imagen de un pago de Yape o transferencia. `HEAD` sobre `/api/pagos` responde 404 (`PREFIJOS_SIN_HEAD`, en `caja/head-sin-ruta.ts`).
  - **Aprobar y rechazar** (criterios 47 a 52; `POST /api/pagos/{id}/aprobacion` y `POST /api/pagos/{id}/rechazo`, en `verificacion.service.ts`). Aprobar llama a `confirmarPagoEnTransaccion` con el método real del pago: el ingreso entra a la caja abierta de hoy y no suma al efectivo (D-04). Audita `PAGO_APROBADO`. Rechazar libera el cupo, audita `PAGO_RECHAZADO` y no necesita caja. Los bloqueos son los de `bloquearFilasDelPago` (`bloqueos.ts`), que parte del DNI leído desde el pago con `leerDatosDelPago`; en la aprobación, la caja va al final.
  - **Correos** (criterio 51 a y b; `avisos.ts`). `avisarPagoConfirmado` y `avisarPagoRechazado` se envían después de confirmar la transacción, una vez por cada destinatario (el alumno y, si es menor, su apoderado), sin DNI ni token.
  - **Datos de pago** (criterio 53). Seis claves de configuración de la academia: `yape_numero`, `yape_titular`, `transferencia_banco`, `transferencia_cuenta`, `transferencia_cci` y `transferencia_titular` (`packages/contratos/src/configuracion.ts`). El seguimiento solo muestra los que tienen valor.
  - **Estados** (criterios 28 a 32). `EN_VERIFICACION` y `PAGO_RECHAZADO` en el seguimiento, el panel, la cancelación, la foto, el cobro en efectivo y el ajuste del monto, que solo admite `PENDIENTE_PAGO` y `PAGO_RECHAZADO`.
  - **Lo que todavía no trae.** La web no ofrece cancelar ni ajustar una solicitud con `PAGO_RECHAZADO`, aunque la API lo permite. El resto de la deuda de la 007b está en `specs/backlog.md`, en la nota de la 007.

- **Lo que construye la historia 008a** (carnet digital y QR; criterios 1 a 21 de `specs/008-carnet-qr/spec.md`, en la entrega 008a). Migración `20261125180000_carnet_qr` (en `backend/prisma/migrations/`), el módulo `backend/src/modulos/alumnos/`, el contenido del QR en `packages/contratos/src/carnet.ts` y las pantallas de `frontend/src/modulos/carnet/` y `frontend/src/modulos/alumnos/`. No hay tabla nueva: el token vive en `alumnos`.
  - **Columnas del token** (criterio 1). `alumnos.qr_token` (`text`: 43 caracteres de base64url, es decir, 32 bytes al azar), `alumnos.qr_generado_en` (`timestamptz(3)`) y `alumnos.qr_clave_idempotencia` (`uuid`, la clave de la última regeneración). Tres `CHECK` valen también para el dueño de las tablas: `alumnos_qr_formato` (el token tiene exactamente esa forma), `alumnos_qr_con_fecha` (el token y su fecha están los dos o ninguno) y `alumnos_cliente_sin_qr` (un `CLIENTE` no tiene token, RN-05). El índice único `alumnos_academia_id_qr_token_key`, sobre `(academia_id, qr_token)`, hace que el token sea único dentro de cada academia.
  - **Relleno y privilegios.** La migración da un token a cada alumno que ya existía y no es `CLIENTE` (DT-3), academia por academia y con su contexto, para que la RLS no deje filas sin tocar. `aquagestion_app` solo tiene `UPDATE` de las tres columnas: `PRIVILEGIOS_APP` (`backend/src/infraestructura/prisma/privilegios-app.ts`) y `scripts/lib/rol-app.mjs` lo reflejan, y sus pruebas lo comprueban.
  - **Generación al confirmar** (criterios 2 y 3). El token nace en el paso 5 de `confirmarPagoEnTransaccion` (`backend/src/modulos/pagos/confirmacion.ts`), cuando un `CLIENTE` pasa a alumno: con el cobro en efectivo o con la aprobación de Yape o transferencia, en la misma transacción que el pago y su ingreso de caja. Lo da `nuevoTokenQr()` (`alumnos/dominio/token-qr.ts`, `randomBytes(32)` en base64url). Una renovación no lo toca, y un cliente sin pago confirmado no tiene QR.
  - **Contenido del QR** (criterio 3). El texto del QR es `AQ1:` más el token, 47 caracteres: `PREFIJO_QR` (`'AQ1:'`), `contenidoQr(token)`, `tokenDelContenidoQr(texto)`, que devuelve el token solo si el texto tiene exactamente esa forma y `null` si no, y `PATRON_TOKEN_QR`. `OPCIONES_QR` (corrección M, margen 4) las usan la web (`QrDelCarnet`) y el PDF, para que el mismo texto dé el mismo QR (DT-5). **La 009 leerá el QR con `tokenDelContenidoQr` y buscará por `(academia_id, qr_token)` en la academia de la sesión**, nunca en la de la dirección.
  - **Rutas y permisos** (criterios 4 a 6, 13, 16 y 18). `GET /api/alumnos/{id}/carnet`, `GET /api/alumnos/{id}/carnet/pdf` y `POST /api/alumnos/buscar`: `VER_CARNET` con alcance `TODO` (administrador y secretaria). `GET /api/mi-carnet` y `GET /api/mi-carnet/pdf`: `VER_CARNET` con alcance `PROPIO` (alumno), sin ningún id, porque la academia y la persona salen de la sesión. `POST /api/alumnos/{id}/carnet/qr`: `REGISTRAR_INSCRIPCION_Y_COBRO` (administrador y secretaria). `exigirAlcanceDelCarnet` (`alumnos/alcance.ts`) exige que la celda sea la de la ruta antes de cualquier lectura. Un id que no es UUID, que no existe, que es de otra academia o que es de un `CLIENTE` responde el mismo 404 `NO_ENCONTRADO`. `PREFIJOS_SIN_HEAD` (`caja/head-sin-ruta.ts`) suma `/alumnos` y `/mi-carnet` a `/cajas` y `/pagos`, así que `HEAD` responde 404 ahí.
  - **Carnet y PDF** (criterios 4 a 12; `alumnos/carnet.service.ts` y `alumnos/pdf/carnet-pdf.ts`). `leer` es una lectura en una transacción sin bloqueos: trae al alumno (nunca un `CLIENTE`), el nombre de la academia, sus matrículas `VIGENTE` y `FINALIZADA` con su plan y sus clases, y el QR. La foto se lee del almacén **después** de cerrar la transacción (DT-6); si no se puede leer, el carnet sale sin foto y el registro guarda un aviso con el tipo del error (DT-13). La respuesta pasa por `carnetSchema`, que es estricto. El PDF (`pdfkit`) es una hoja A4 con la tarjeta de 85,6 × 54 mm y el QR de `qrcode` con `OPCIONES_QR`. Se arma en memoria al descargarlo y no se guarda. Sus metadatos son el título y la fecha de creación, sin nombres, DNI ni token.
  - **Regeneración** (criterios 13 a 15; `CarnetService.regenerar`). En una transacción: `bloquearActorVigente`, la fila del alumno con `FOR UPDATE`, un token nuevo distinto del anterior, la clave en `qr_clave_idempotencia` y la auditoría `CARNET_QR_REGENERADO`, con el motivo (de 3 a 200 caracteres), la fecha del QR antes y después, y la IP. Con la misma clave que la última regeneración no escribe ni audita: responde 200 con el carnet tal como está, así que un doble clic no inutiliza el carnet recién impreso (DT-7). El carnet de la respuesta se lee después de confirmar. No hay correo.
  - **Búsqueda** (criterio 16; `POST /api/alumnos/buscar`, `alumnos/busqueda.service.ts`). El texto va en el cuerpo, nunca en la dirección. Con exactamente 8 dígitos busca ese DNI; si no, busca el texto dentro de «nombres apellidos» y de «apellidos nombres», sin distinguir mayúsculas, con `%`, `_` y `\` como texto (`escaparParaLike`). Devuelve como mucho 20 alumnos y `hayMas`. Solo busca alumnos, no `CLIENTE`, y no registra el texto buscado ni audita.
  - **El token fuera de la auditoría, los registros y las direcciones** (criterio 17). La auditoría de la regeneración guarda solo la fecha del QR anterior y la de la nueva; el token no aparece en ninguna dirección ni en el registro técnico.
  - **Lo que todavía no trae.** La lectura del QR en la entrada (009) y la asistencia del alumno en su panel (011). La foto desde el panel y con la cámara la trae la 008b (abajo). La deuda de la 008a está en `specs/backlog.md`, en la nota de la 008.

- **Lo que construye la historia 008b** (foto desde el panel y cámara; criterios 22 a 29 de `specs/008-carnet-qr/spec.md`, en la entrega 008b). Sin migraciones ni dependencias nuevas. Las dos rutas están en `backend/src/modulos/alumnos/foto-alumno.service.ts` y `backend/src/modulos/inscripciones/foto-panel.service.ts`; la función común, en `backend/src/modulos/inscripciones/foto-del-alumno.ts`; el lector binario, en `backend/src/comun/http/cuerpo-imagen.ts`, y las pantallas, en `frontend/src/modulos/foto/`.
  - **Las dos rutas** (criterios 22 y 23). `PUT /api/alumnos/{id}/foto` y `PUT /api/solicitudes/{id}/foto`, con `REGISTRAR_INSCRIPCION_Y_COBRO` (administrador y secretaria), cuerpo binario `image/jpeg` o `image/png`, 204 sin cuerpo y `Cache-Control: no-store` (el middleware de las rutas de academia). La del alumno vale para cualquier alumno de la academia que no sea `CLIENTE`, en cualquier estado. La de la solicitud guarda la foto del alumno de la solicitud si la solicitud admite foto como la pública (`PENDIENTE_PAGO`, `EN_VERIFICACION` o `PAGO_RECHAZADO`) o si está `CONFIRMADA` y el alumno ya no es `CLIENTE`; `VENCIDA` y `CANCELADA` responden 409 `SOLICITUD_NO_EDITABLE`. Una solicitud vieja sin matrícula responde 409 y no 404: la lectura previa usa `LEFT JOIN LATERAL` a la matrícula (DT-17). Un `{id}` que no es UUID o es de otra academia responde 404 `NO_ENCONTRADO`.
  - **El orden de las comprobaciones** (criterio 24). La sesión, la academia activa, el cambio de contraseña pendiente y el permiso responden 401 o 403 sin leer el cuerpo: lo hacen el middleware de acceso de academia y el lector binario, que solo lee el cuerpo si la sesión tiene `REGISTRAR_INSCRIPCION_Y_COBRO`. Después, el lector decide el tipo y la codificación (400 `IMAGEN_NO_VALIDA`) y el tamaño (413 `CARGA_EXCESIVA`, por `Content-Length` o al pasar el límite de 5 MB). El servicio sigue con el actor vigente (401), el alumno o la solicitud (404 `NO_ENCONTRADO`), el 409 de la solicitud y la imagen (400). Estas rutas no cuentan en `LIMITES_PUBLICOS`, y el lector JSON no las toca.
  - **La función común** (criterios 25 y 26; DT-10 y DT-16). `reemplazarFotoDelAlumno` la usan la ruta pública y las dos del panel. Primero, una transacción corta comprueba el actor y el alumno o la solicitud, sin tocar archivos. Después, fuera de transacción, la imagen se recodifica como JPEG sin metadatos (`recodificarImagen`) y se guarda con la clave `academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`. En la transacción de escritura, `confirmar(tx)` bloquea, lee «ahora» después de los bloqueos y devuelve la clave anterior; luego se guardan `foto_clave` y `actualizado_en`, y se audita. Después de confirmar se borra el archivo anterior. Un rechazo propio de la transacción (401, 404 o 409) borra el archivo nuevo; ante una confirmación incierta se relee `foto_clave` con `FOR SHARE`, con espera máxima de 5 s, antes de borrar nada (criterios 61 y 64 de 005). Un borrado que falla deja un `warn` y la respuesta sigue siendo 204.
  - **Orden de bloqueos** (criterio 26 c; DT-14). La foto de la solicitud toma `alumnos` y después `solicitudes_inscripcion`. La cancelación de la 005b (`SolicitudesService.cancelar`) toma ahora también `alumnos` antes que la solicitud: `bloquearActorVigente`, `alumnos`, `solicitudes_inscripcion`, `matriculas`, `pagos` y `clases`. Así, una subida a una solicitud que se cancela a la vez responde 409 y no deja archivo nuevo.
  - **Auditoría** (criterio 27; DT-15). Cada subida correcta del panel audita una sola entrada `ALUMNO_FOTO_ACTUALIZADA` (entidad `alumno`, con `datosAntes: { tieneFoto }` y `datosDespues: { tieneFoto: true, origen }`), con `origen` `PANEL_ALUMNO` o `PANEL_SOLICITUD`. `origen` va en `datosDespues` porque la tabla `auditoria` no tiene esa columna. Nunca guarda la imagen, la clave ni el DNI. La foto pública sigue sin auditarse (criterio 37 de 005).
  - **Las pantallas** (criterio 28; DT-11). `DialogoFoto` está en el carnet del alumno (`/panel/alumnos/{id}`, «Cambiar foto» o «Agregar foto») y en las tarjetas de solicitudes activas y confirmadas (`/panel/solicitudes`, «Agregar foto»). Ofrece «Elegir un archivo» (`CampoFoto`) o «Usar la cámara» (`CapturaCamara`, con `getUserMedia` y `canvas` y un JPEG de calidad 0,9; «Tomar foto», «Volver a tomar» y «Usar esta foto»). La cámara se apaga al cerrar el diálogo, al cambiar de opción y al desmontarse. Sin permiso, sin cámara o fuera de `localhost` o HTTPS avisa y deja la opción del archivo.
  - **Lo que todavía no trae.** La deuda de la 008b está en `specs/backlog.md`: R1-1 y R1-2, medias y a resolver antes de producción; R1-3 y R1-4, bajas, y los menores de la revisión. La lectura del QR en la entrada (009) y la asistencia del alumno en su panel (011) siguen pendientes.

- **Lo que construye la historia 009a** (marcado por QR y manual; criterios 1 a 21 de `specs/009-asistencia/spec.md`, en la entrega 009a). Migración `20261125190000_asistencias` (en `backend/prisma/migrations/`), el módulo `backend/src/modulos/asistencia/`, los contratos de `packages/contratos/src/asistencia.ts`, la pantalla de `frontend/src/modulos/asistencia/` y la función `leerFotoComoData`, que el carnet tenía dentro de su servicio y ahora está en `backend/src/modulos/alumnos/foto-como-data.ts` sin cambiar lo que muestra el carnet. La web suma la dependencia `html5-qrcode`, que se carga solo al encender la cámara.
  - **Tabla `asistencias` con RLS.** Cada fila lleva `academia_id`. La RLS está activada y forzada, con dos políticas de la forma de 001: `asistencias_leer` (`SELECT`) y `asistencias_crear` (`INSERT`), ambas con `academia_id = app_academia_actual()`. No hay política de `UPDATE` ni de `DELETE`: una asistencia no cambia ni se borra. Los tipos son `metodo_asistencia` (`QR`, `MANUAL`), `tipo_asistencia` (`NORMAL`, `RECUPERACION`, `FUERA_HORARIO`, `PARTICULAR`; la 009a solo escribe `NORMAL`, DT-6) y `estado_llegada` (`PUNTUAL`, `TARDE`).
  - **Invariantes en la base** (criterio 1; valen también para el dueño de las tablas). `CHECK`: `asistencias_fecha_de_lima` (la `fecha` es la de Lima de `llegada_en`), `asistencias_registro_despues` (`registrado_en` no es anterior a `llegada_en`) y `asistencias_posterior_coherente` (un registro posterior de la 009b es manual y lleva motivo de 3 a 200 caracteres; una asistencia normal no lleva motivo). Únicos: `asistencias_un_dia_key` (un alumno por día de Lima, salvo las particulares; RN-16), `asistencias_academia_id_clave_idempotencia_key` (una clave por academia), y `(academia_id, id)` y `(academia_id, id, alumno_id, fecha)`, para las llaves de la 009b. Las llaves compuestas hacen que la matrícula sea del mismo alumno y que la clase sea de la misma academia.
  - **Privilegios de `aquagestion_app`** (criterio 1). `SELECT` e `INSERT` en `asistencias`, sin `UPDATE` ni `DELETE`, y `UPDATE (clases_usadas)` en `matriculas`, porque cada asistencia descuenta una clase en su misma transacción. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se ampliaron igual.
  - **Ventana y puntualidad** (criterios 9, 10 y 20; D-16, D-11, DT-3). `ventanaDeLaClase` (`backend/src/modulos/asistencia/dominio/ventana.ts`) devuelve `[inicio, fin)` en America/Lima: la clase de 18:00 a 19:00 admite 18:59:59.999 y no 19:00:00.000. `estadoDeLlegada` (`dominio/llegada.ts`) trunca la llegada al minuto y la compara con el inicio más la tolerancia de la academia: con 10 minutos, 18:10:59.999 es `PUNTUAL` y 18:11:00.000 es `TARDE`. La tolerancia la lee `leerConfiguracion(tx)` dentro de la transacción, sin caché.
  - **Orden de validaciones** (criterio 7). `decidirMarcado` (`dominio/validaciones.ts`, pura) decide con la primera que falla: alumno inactivo (`ALUMNO_INACTIVO`, roja); ya marcó hoy (`ASISTENCIA_YA_REGISTRADA`, amarilla); pago en verificación (`PAGO_EN_VERIFICACION`, roja); sin matrícula del día (`MENSUALIDAD_NO_VIGENTE`, roja); sin clases restantes (`SIN_CLASES_RESTANTES`, roja); sin clase hoy o fuera de la ventana (`FUERA_DE_HORARIO`, amarilla); y ocurrencia no incluida en la mensualidad (`CLASE_NO_INCLUIDA`, amarilla: la clase empezó antes de crear la matrícula, DT-14). Antes van, dentro de la transacción, el actor vigente (401), el QR o el alumno (404) y la clave ya usada (200, o 409 `CLAVE_YA_USADA`). Cada rechazo es un 409 con `detalles` que cumplen `rechazoAsistenciaSchema`; no escribe ni audita.
  - **Transacción y orden de bloqueos** (criterio 14). `MarcadoService.marcar` hace una transacción de la academia (`conAcademia`), en este orden: (1) `bloquearActorVigente`; (2) el alumno con `FOR SHARE`, por token (solo `tokenDelContenidoQr` y `(academia_id, qr_token)`, DT-4) o por id; (3) la clave ya usada; (4) la matrícula del día con `FOR UPDATE` (DT-5), buscada con un «ahora» provisional, y con ella tomada, la clave se vuelve a mirar (DT-17); (5) «ahora» después de todos los bloqueos (DT-16), la tolerancia, la asistencia de hoy, el pago en verificación, la clase del día y `decidirMarcado`; (6) si registra, el `INSERT` de la asistencia y el `UPDATE` de `clases_usadas`. No hay `FOR UPDATE` sobre `clases`, porque la asistencia no mueve cupo; el `INSERT` sí toma el bloqueo de llave foránea sobre la clase, y ahí está la falla R1-2 de la ronda 1, que se corrige en la 009b. La foto se lee después de cerrar la transacción (DT-11).
  - **Choques** (criterios 12 y 13). Un choque de `asistencias_un_dia_key` o de la clave se reconoce por el nombre de la restricción, después del `ROLLBACK`, y se vuelve a decidir con lo que ya se confirmó: hasta 2 intentos (DT-17). Una clave usada por otro alumno responde 409 `CLAVE_YA_USADA`; la misma clave del mismo alumno responde 200 con `repetida: true`.
  - **Rutas** (criterios 2, 5, 6 y 18). `POST /api/asistencias/qr` (`registrarAsistenciaQrSchema`) y `POST /api/asistencias/manual` (`registrarAsistenciaManualSchema`), con `REGISTRAR_ASISTENCIA` (administrador y secretaria), responden 201 con `resultadoAsistenciaSchema`, o 200 con el mismo cuerpo y `repetida: true`. El token y el contenido del QR nunca van en la dirección. `HEAD` sobre `/api/asistencias` responde 404: `PREFIJOS_SIN_HEAD` (`caja/head-sin-ruta.ts`) suma `/asistencias`.
  - **Respuesta** (criterios 15 y 17). `resultadoAsistenciaSchema` y `rechazoAsistenciaSchema` son estrictos y no llevan DNI, token, contenido del QR, fecha de nacimiento, datos médicos, apoderado ni `foto_clave`. La foto va como `data:image/jpeg;base64,…`, o como `null` si no se puede leer.
  - **Lo que todavía no trae.** El registro de faltas, el registro posterior y la consulta del mes (009b); la asistencia en el panel del alumno (011); las recuperaciones (018), las clases particulares (016) y la asistencia en otro horario (020). La deuda de la 009a está en `specs/backlog.md`.

- **Lo que construye la historia 009b** (faltas, registro posterior y consulta del mes; criterios 22 a 37 de `specs/009-asistencia/spec.md`, en la entrega 009b). Migraciones `20261126120000_inasistencias` y `20261126130000_inasistencias_unico_id` (en `backend/prisma/migrations/`); el servicio y la tarea de faltas, `FaltasService` y `FaltasTarea`, en `backend/src/modulos/asistencia/` (con `TareasAsistenciaModule`); el registro posterior en `MarcadoService`; la consulta del mes en `consulta.service.ts` y `consulta.controller.ts`; la dependencia `@nestjs/schedule`; y, en la web, la sección «Asistencia» y el diálogo del registro posterior, en `frontend/src/modulos/alumnos/` (`AsistenciaDelMes.tsx` y `DialogoAsistenciaPosterior.tsx`).
  - **Tabla `inasistencias`, con su trigger y su RLS** (criterio 22; DT-8). Una fila por falta: el alumno, la matrícula, la clase, la fecha, `registrada_en` y, cuando un registro posterior la cubre, `asistencia_id` y `cubierta_en`. Las llaves compuestas con `academia_id` apuntan a `alumnos`, `matriculas`, `clases` y `asistencias (academia_id, id, alumno_id, fecha)`: una falta solo la cubre una asistencia del mismo alumno y del mismo día. Únicos: `inasistencias_una_por_clase_key`, sobre `(academia_id, alumno_id, clase_id, fecha)`, y `inasistencias_academia_id_id_key`, sobre `(academia_id, id)`, que va en la migración aparte `20261126130000_inasistencias_unico_id` porque la primera ya estaba aplicada. El `CHECK inasistencias_cubierta_coherente` exige que `asistencia_id` y `cubierta_en` sean nulos a la vez o no nulos a la vez. El trigger `inasistencias_se_cubre_una_vez` (`BEFORE UPDATE`, por fila) deja pasar solo la cobertura, de nulos a no nulos: cualquier otro `UPDATE`, también uno que no cambia nada, responde 23514, y eso vale también para el dueño de las tablas. La RLS está activada y forzada, con `inasistencias_leer`, `inasistencias_crear` e `inasistencias_cubrir`, y sin `DELETE`: el rol de la API tiene `SELECT`, `INSERT` y `UPDATE (asistencia_id, cubierta_en)`.
  - **La tarea de faltas** (criterios 23 a 27 y 33; DR-1, DR-4, DT-9). `FaltasTarea` llama a `FaltasService.registrarFaltas` cada 5 minutos (`0 */5 * * * *`) y una vez al arrancar, sin que el arranque espere a la tarea. Una vuelta lee las academias `ACTIVA` con `comoPlataforma` y cierra esa transacción; una suspendida no se procesa. Después hay un `conAcademia` por academia, una tras otra. Cada una empieza con `pg_try_advisory_xact_lock('faltas:' || academia)`: si otra instancia la tiene, la academia se salta en esa vuelta y no se espera. La ventana son ayer y hoy en America/Lima, y una ocurrencia cuenta cuando su fin ya pasó (al terminar la clase, sin espera). Hay una falta por cada alumno con matrícula `VIGENTE` o `FINALIZADA` del mes, con la clase ese día, incluida en la mensualidad (empieza después de crear la matrícula) y que no empieza antes de confirmarse su pago, sin asistencia ese día (salvo las particulares), con clases restantes y no `INACTIVO`. La falta no descuenta clases. Volver a correr la vuelta no crea nada (`ON CONFLICT ON CONSTRAINT inasistencias_una_por_clase_key DO NOTHING`). Un error en una academia se registra sin datos de alumnos, y la vuelta sigue con las demás. Cada academia procesada deja un `info` «Faltas registradas» con su id y la cantidad, después de confirmar su transacción.
  - **Orden de bloqueos de la tarea** (criterio 27). Primero, las filas de los alumnos candidatos con `FOR KEY SHARE`, ordenadas por id; después, sus matrículas con `FOR UPDATE`, ordenadas por id; y el `INSERT`, que evalúa otra vez las condiciones con lo ya confirmado. Así, un registro posterior y la tarea sobre el mismo alumno y día terminan sin falta o con la falta cubierta, en cualquier orden. Con una sola instancia no hay excepciones; con relojes desfasados entre varias, queda la falla F1 de la deuda de la 009b (`specs/backlog.md`).
  - **`TAREAS_PROGRAMADAS`** (criterio 33; DT-28 y DT-30). `activas` (por defecto) o `inactivas`; otro valor impide arrancar la API (`validarEntorno`). `AppModule` carga `ScheduleModule.forRoot()` y `TareasAsistenciaModule` solo con `activas`; con `inactivas` no hay ningún `CronJob`. Las pruebas de integración llaman a `registrarFaltas` con un instante fijo, y la API de la E2E corre con `inactivas`. La línea está comentada en `.env.example`.
  - **Registro posterior y su auditoría** (criterios 28 a 30 y 36; D-16, DR-2). `POST /api/asistencias/posterior`, con `REGISTRAR_ASISTENCIA` y el cuerpo `registrarAsistenciaPosteriorSchema` (estricto), usa el caso de uso del marcado con la fecha D en lugar de hoy. `decidirPosterior` (`dominio/validaciones.ts`) decide con la primera validación que falla, en este orden: fecha del mes en curso y no posterior a hoy (`FECHA_NO_PERMITIDA`); alumno inactivo; asistencia ya registrada ese día; matrícula de ese día (`MENSUALIDAD_NO_VIGENTE`); clases restantes; clase ese día (`FUERA_DE_HORARIO`); clase terminada (`CLASE_NO_TERMINADA`); hora de llegada dentro de `[inicio, fin)` (`HORA_FUERA_DE_LA_CLASE`); y clase incluida en la mensualidad (`CLASE_NO_INCLUIDA`). Los tres códigos nuevos son de alerta `AMARILLA` (DT-23). Si registra, inserta la asistencia con `metodo` `MANUAL` y `registro_posterior` `true`, descuenta una clase y, si hay falta de esa clase y fecha, la cubre en la misma transacción. Responde 201 con `registroPosterior: true`; con la misma clave del mismo alumno y tipo, 200 con `repetida: true`, y con otro alumno o tipo, 409 `CLAVE_YA_USADA`. Cada 201 escribe `ASISTENCIA_POSTERIOR_REGISTRADA` en la auditoría, con quién, cuándo, el motivo, la IP y los datos de la asistencia, sin DNI, nombres ni datos médicos; un reintento y un rechazo no auditan. El marcado normal y las faltas no se auditan (DT-10).
  - **Consulta del mes** (criterio 31). `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM`, con `VER_REPORTES_ASISTENCIA` y alcance `TODO` (administrador y secretaria). El entrenador (`SUS_CLASES`) y el alumno (`PROPIO`) reciben 403 `SIN_PERMISO`, porque sus vistas son de la 012 y la 011. Sin `mes`, es el mes en curso de Lima; un `mes` con otra forma o fuera de 2000-01 a 9999-12 responde 400. Responde `asistenciaDelMesSchema`: la matrícula del mes (`VIGENTE` o `FINALIZADA`, o `null`) y los registros por fecha, con las asistencias (y si cubren una falta) y las faltas sin cubrir. Sin DNI ni motivo; no escribe, no bloquea y no audita.
  - **Orden de bloqueos del marcado y del registro posterior con clases `FOR KEY SHARE`** (criterios 14 y 37; DT-16, DT-17 y DT-22). Entre la matrícula y «ahora», el marcado y el registro posterior toman, en este orden: (1) el actor; (2) el alumno con `FOR SHARE`; (3) la clave ya usada; (4) la matrícula del día con `FOR UPDATE` y, con ella tomada, la clave otra vez; (5) las clases de esa matrícula con `FOR KEY SHARE`, en una sola sentencia sobre `clases` ordenada por id (`bloquearClasesDeLaMatricula`); (6) en el posterior, la falta del día con `FOR UPDATE`; (7) «ahora», leído después de todos los bloqueos. Nunca se bloquea `clases` con `FOR UPDATE` ni con `FOR SHARE`: un cobro que la tiene (`bloquearClasesParaCupo`) hace esperar al marcado, y si la espera cruza el fin de la clase, responde 409 `FUERA_DE_HORARIO` sin escribir. Sin matrícula del día no se bloquea ninguna clase. Es la corrección de R1-2 de la ronda 1 de la 009a.
  - **Web** (criterio 32). La sección «Asistencia» de `/panel/alumnos/{id}` muestra el mes en curso o el anterior. El botón «Registrar asistencia posterior» aparece solo a quien tiene `REGISTRAR_ASISTENCIA` y solo en el mes en curso. El diálogo manda una `claveIdempotencia` nueva cada vez que se abre y valida con el mismo esquema que la API; las reglas las decide la API, y la web solo muestra sus rechazos.
  - **Lo que todavía no trae.** La asistencia en el panel del alumno y del apoderado (011) y la del entrenador (012); las recuperaciones (018), las clases particulares (016), la asistencia en otro horario (020) y el día de cierre (017). La deuda de la 009b está en `specs/backlog.md`.

- **Lo que construye la historia 010a** (renovación con prioridad; criterios 1 a 23, 44 y 45 de `specs/010-mensualidades/spec.md`, en la entrega 010a). Migración `20261126140000_renovaciones` (en `backend/prisma/migrations/`), que solo agrega un `CHECK`; el módulo `backend/src/modulos/mensualidades/`; los contratos de `packages/contratos/src/mensualidades.ts`; el `solicitud: null` de la bandeja de pagos, y las pantallas de `frontend/src/modulos/mensualidades/`. Sin tablas, privilegios, dependencias ni variables nuevas.
  - **El `CHECK` de la migración** (criterio 1; DT-2, DT-11). `matriculas_renovacion_sin_vencimiento`: `solicitud_id IS NOT NULL OR reserva_vence_en IS NULL`. Una matrícula sin solicitud (una renovación) nunca lleva reserva temporal, y la regla vale también para el dueño de las tablas. La app ya inserta matrículas sin solicitud, así que la restricción no pide nada más.
  - **Ventana y meses** (criterio 3; DR-2, DR-4). `ventanaDeRenovacion` (`mensualidades/dominio/ventana.ts`, pura y en America/Lima) da los últimos `diasPrioridadRenovacion` días del mes en curso (5 por defecto; de 1 a 15, en la configuración). `mesesPermitidos` da el mes en curso (la renovación tardía, DR-4) y, dentro de la ventana, el mes siguiente. El «ahora» se lee después de los bloqueos.
  - **Reservas de prioridad, calculadas al leer** (criterio 9; D-06, DT-3, DT-4). `contarReservasDePrioridad` (`matriculas/ocupacion.ts`) cuenta, por clase, los titulares: alumnos que no son `CLIENTE`, con una matrícula `VIGENTE` del mes en curso que incluye la clase y sin matrícula del mes siguiente que ocupe cupo. No se guardan: el día 1 dejan de existir solas. `clasesDeLaTitularidad` (`mensualidades/lectura.ts`) usa la misma condición (DR-12).
  - **Regla del cupo libre** (criterios 44 y 45; ataques de las rondas 1 y 2). `cupoLibre` (`mensualidades/dominio/cupo.ts`): en el mes en curso, `aforo − ocupación`; en el mes siguiente, un titular tiene `aforo − ocupación` (las reservas no le restan: compite solo con los demás titulares, y gana el primero que llega), y quien no es titular tiene `aforo − ocupación − reservas`. Nunca se pasa del aforo. Una matrícula de M en verificación no da prioridad; una renovación de M+1 en verificación sí ocupa cupo en M+1, y su alumno deja de ser titular.
  - **Un solo núcleo para el registro** (criterios 8, 12 y 13; DT-22). `nucleo.ts` sirve al efectivo y al comprobante. Orden de bloqueos: `bloquearActorVigente`, el bloqueo consultivo del DNI, el alumno con `FOR UPDATE`, sus matrículas con `FOR UPDATE` (todas, DT-22), `bloquearClasesParaCupo` con las clases elegidas, «ahora», las escrituras y, al final, la caja. Las decisiones siguen el orden del criterio 8. Audita `RENOVACION_REGISTRADA` además del pago (DT-18). Responde 201 o, con la misma clave y el mismo pedido, 200 con la renovación ya registrada.
  - **Renovación en efectivo** (criterios 3 a 6; `POST /api/alumnos/{id}/renovacion/efectivo`, con `REGISTRAR_INSCRIPCION_Y_COBRO`). Cobra en la caja abierta de hoy (`SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA` si no la hay), con el monto de la cotización de la API (`POST .../renovacion/cotizacion`), y da el ticket. Si el alumno está `ALUMNO_VENCIDO` y la matrícula es del mes en curso, pasa a `ALUMNO_ACTIVO` en la misma transacción, dentro de `confirmarPagoEnTransaccion` (DT-27).
  - **Renovación con comprobante** (criterios 7, 8 y 12; `PUT /api/alumnos/{id}/renovacion/comprobante`). El comprobante de Yape o transferencia va en la cabecera `X-Renovacion-Datos` (DT-8), y la imagen, como cuerpo binario, con el lector de `comun/http/cuerpo-imagen.ts` y `recodificarImagen`. La imagen se guarda antes de la transacción; si esta rechaza, el archivo nuevo se borra, y un comprobante guardado nunca se borra después (es evidencia). Ante una confirmación incierta se relee el pago por su id (criterios 61 y 64 de 005). La transacción deja la matrícula `RESERVADA` sin vencimiento, sus clases y el pago `PENDIENTE_VERIFICACION`; no toca la caja ni el estado del alumno hasta que se aprueba.
  - **Oferta** (criterio 2; `GET /api/alumnos/{id}/renovacion`, con `REGISTRAR_INSCRIPCION_Y_COBRO`, DT-9). Trae la mensualidad del mes en curso, los meses permitidos con su ventana y, por clase, `cuposRestantes` (nunca negativo) y `conPrioridad`. No escribe. La web solo muestra lo que dice la oferta, salvo tres decisiones de fecha que usan el reloj del navegador (deuda, abajo).
  - **Bandeja y correos** (criterios 14 y 15; DT-10). `listarPendientes` (`pagos/verificacion.service.ts`) hace un `LEFT JOIN` con las solicitudes: una renovación sale con `solicitud: null` y la web la muestra como «Renovación de diciembre de 2026». Al aprobar o rechazar, se envían `RENOVACION_CONFIRMADA` o `RENOVACION_RECHAZADA` (`pagos/avisos.ts`) al alumno y, si es menor, a su apoderado, después de confirmar y una vez por dirección (DR-7). En efectivo no hay correo: el alumno recibe su ticket.
  - **Lo que todavía no trae.** El cambio de horario (010c), la inscripción pública al mes siguiente (010d, DR-10) y los descuentos o ajustes del monto (015; DR-6). El listado de estados y el cierre de mes los cumple la 010b (ver «Lo que construye la historia 010b»). La web todavía usa el reloj del navegador para decidir si el mes es «siguiente», los límites de fecha del comprobante y el texto «se abre el…»; eso debe salir de la oferta de la API. La deuda de la 010a está en `specs/backlog.md`, en la nota de la 010.

- **Lo que construye la historia 010b** (estados de la mensualidad, listado y cierre de mes; criterios 24 a 33 de `specs/010-mensualidades/spec.md`, en la entrega 010b). Sin migraciones, tablas, privilegios, dependencias ni variables nuevas: `TAREAS_PROGRAMADAS` ya existía desde la 009b. El módulo `backend/src/modulos/mensualidades/` suma `dominio/estado.ts`, `listado.controller.ts` y `listado.service.ts`, `cierre-de-mes.service.ts`, `cierre-de-mes.tarea.ts` y `tareas-mensualidades.module.ts`; los contratos están en `packages/contratos/src/mensualidades.ts`, y en la web, `frontend/src/modulos/mensualidades/` tiene `PaginaMensualidades.tsx` (la página de `/panel/mensualidades`) y `SeccionMensualidad.tsx` (la sección «Mensualidad» de la ficha).
  - **Estado de la mensualidad** (criterio 24; `dominio/estado.ts`, función pura). `estadoDeMensualidad` decide, para un alumno y un mes X no posterior a M, `AL_DIA`, `POR_VENCER`, `PENDIENTE_VERIFICACION` o `VENCIDO`, o `null` si el alumno no tiene estado en X y no aparece en el listado. Con la de X pagada: si X es M y hoy está por vencer, `AL_DIA` si la de M+1 está pagada, `PENDIENTE_VERIFICACION` si está en verificación y `POR_VENCER` si no; en otro caso, `AL_DIA`. Sin la de X pagada, pero con la de X en verificación, `PENDIENTE_VERIFICACION`; sin ninguna de las dos y con la de X−1 pagada, `VENCIDO`. Recibe `hoy` ya en Lima.
  - **Listado** (criterios 25 y 26; `GET /api/mensualidades` con `REGISTRAR_INSCRIPCION_Y_COBRO`, que tienen el administrador y la secretaria; DT-9). Una sola lectura de la academia de la sesión, sin bloqueos, sin escribir y sin auditar: las matrículas pagadas o en verificación de X−1, X y, si X es el mes en curso, X+1, de los alumnos que no son `CLIENTE` ni `INACTIVO`. `mes` es M por defecto y no puede ser posterior a M. El filtro `alumnoId` (DT-31, el que usa la ficha) va en la misma consulta SQL; `estado`, `planId`, `nivel` y `claseId` se aplican después; `totales` cuentan por estado con los demás filtros. Como mucho 500 filas (`MAXIMO_DE_FILAS_DEL_LISTADO`); si había más, `hayMas` es `true` (DT-37). La consulta es estricta: un parámetro desconocido, repetido o fuera de rango responde 400 `SOLICITUD_INVALIDA` con el campo (DT-36; `listado.controller.ts` la arma con `URLSearchParams`). Un `alumnoId` de otra academia o inexistente responde 200 con la lista vacía. Sin DNI, datos médicos ni apoderado. El orden de las comprobaciones es el de la 002: sesión, academia activa, cambio de clave obligatorio, permiso, parámetros y listado. `HEAD` responde 404 (`/mensualidades` está en `PREFIJOS_SIN_HEAD`).
  - **La tarea del cierre de mes** (criterios 27 a 30; RN-23, DT-12, DT-32 a DT-35). `CierreDeMesTarea` llama a `CierreDeMesService.cerrar()` cada 15 minutos (`0 */15 * * * *`, nombre `cierre-de-mes`) y una vez al arrancar, sin que el arranque espere a la vuelta. Una bandera en memoria salta una vuelta si la anterior sigue en el mismo proceso; entre instancias lo ordena el bloqueo de cada academia. Vive en `TareasMensualidadesModule`, que `AppModule` carga junto con `ScheduleModule.forRoot()` solo con `TAREAS_PROGRAMADAS=activas`; con `inactivas` no hay ningún `CronJob` de esta tarea. `CierreDeMesService` está en `MensualidadesModule`, que siempre se carga: las pruebas lo llaman directamente, con un instante fijo.
  - **Orden de bloqueos y vuelta por academia** (criterios 27 y 29). Primero, la lista de academias `ACTIVA` con `comoPlataforma`, en una transacción que se cierra. Después, un `conAcademia` por academia, una tras otra; cada una empieza con `pg_try_advisory_xact_lock(hashtextextended('cierre-de-mes:' || academia, 0))`: si otra instancia la tiene, la academia se salta en esa vuelta y no se espera. Luego, sin bloquear, se eligen los alumnos afectados (los que tienen una matrícula `VIGENTE` de un mes anterior a M, y los que cambiarían de estado); con `FOR UPDATE` y por id, esos alumnos; con `FOR UPDATE` y por id, sus matrículas `VIGENTE`; y dos sentencias de muchas filas, limitadas a los alumnos bloqueados, que vuelven a evaluar la condición con el «ahora» leído después de los bloqueos (DT-33 y DT-35). Es el mismo orden alumno → matrícula del marcado, de las faltas, del cobro y de la renovación, así que no hay ciclos. Una academia suspendida no se procesa, tampoco si se suspende entre la lista y su turno. Un error en una academia se registra con `errorParaRegistro`, sin datos de alumnos, y las demás siguen.
  - **Efectos del cierre** (criterios 27 y 28; RN-23). Toda matrícula `VIGENTE` de un mes anterior a M pasa a `FINALIZADA`, conservando `clases_totales` y `clases_usadas`: lo no usado queda como registro y ya no sirve para marcar. Todo alumno `ALUMNO_ACTIVO` sin matrícula `VIGENTE` de M pasa a `ALUMNO_VENCIDO`, y todo `ALUMNO_VENCIDO` con ella pasa a `ALUMNO_ACTIVO`; `CLIENTE` e `INACTIVO` no cambian. Cada academia procesada deja un `info` «Cierre de mes» con su id y las cantidades, sin alumnos ni DNI, después de confirmar su transacción. No audita (no hay actor, DT-12), y volver a correrla no cambia nada.
  - **Web** (criterios 31 y 32). `/panel/mensualidades` es para `REGISTRAR_INSCRIPCION_Y_COBRO` (`RequierePermiso`): filtros de HU-11 (mes, estado, plan, nivel y horario), totales por estado, cada estado con su color, el aviso de `hayMas` y, en cada fila, el enlace a la ficha del alumno; el inicio del panel suma «Mensualidades». Las claves de TanStack Query llevan la academia y el usuario de la sesión. En la ficha, la sección «Mensualidad» pide `GET /api/mensualidades?alumnoId=…` y muestra el estado que dice la API (la web no lo calcula), y «No usó N clases» de la mensualidad del mes anterior (criterio 31; la deuda de la 010b tiene los detalles).
  - **Lo que todavía no trae.** El cambio de horario (010c) y la inscripción pública al mes siguiente (010d, DR-10). La deuda de la 010b está en `specs/backlog.md`, en la nota de la 010.

- **Lo que construye la historia 010c** (cambio de horario y su lectura; criterios 34 a 43 y 46 de `specs/010-mensualidades/spec.md`, en la entrega 010c). Migraciones `20261127190000_cambio_horario` y `20261127200000_trigger_matricula_clases_bloqueo` (en `backend/prisma/migrations/`). En `backend/src/modulos/mensualidades/` van `horario.service.ts` (el cambio y la lectura), `horario.controller.ts` y `horario-alumno.controller.ts`, `cupo-del-horario.ts` y `dominio/horario.ts`; los contratos `cambiarHorarioSchema` y `horarioDelAlumnoSchema` están en `packages/contratos/src/mensualidades.ts`, y la pantalla, en `frontend/src/modulos/mensualidades/` (`DialogoCambiarHorario.tsx`, que abre `SeccionMensualidad.tsx`).
  - **Rutas y permisos** (criterios 35, 41 y 46). `POST /api/matriculas/{id}/horario` cambia las clases de una matrícula, y `GET /api/alumnos/{id}/horario` trae lo que la pantalla necesita para hacerlo. Las dos son de `MODIFICAR_HORARIO_ALUMNO` (administrador y secretaria): el entrenador y el alumno reciben 403. Un `{id}` que no es UUID, que no existe, que es de otra academia o que es de un `CLIENTE` responde 404 `NO_ENCONTRADO`. `HEAD` responde 404 en estas rutas, porque `/matriculas` y `/alumnos` están en `PREFIJOS_SIN_HEAD`.
  - **El cambio** (criterios 35 a 37, 39 y 40; `HorarioService.cambiar`). `cambiarHorarioSchema` (`{ claseIds, motivo }`, estricto, con el motivo de 3 a 200 caracteres visibles) cambia solo una matrícula de M o de M+1 que esté `VIGENTE` o en verificación; las demás responden 409 `MATRICULA_NO_MODIFICABLE`. Las clases nuevas deben cumplir el plan tal como está hoy y el nivel actual del alumno (DT-20). Cada clase que entra necesita cupo, y si no, 409 `SIN_CUPO` con `detalles.claseIds`; las que se quedan no se vuelven a comprobar. El orden de bloqueos es el del criterio 39: `bloquearActorVigente`, el alumno con `FOR UPDATE`, la matrícula con `FOR UPDATE`, `bloquearClasesParaCupo` con las clases que salen y las que entran, «ahora» y las escrituras. Borra las filas de las clases que salen e inserta las que entran con `agregada_en` = «ahora»; no toca `clases_totales`, `clases_usadas`, `monto_calculado`, los pagos ni la caja. Si las clases pedidas son las que ya tiene, responde 200 sin escribir ni auditar (DT-16). Cada cambio escribe una entrada `MATRICULA_HORARIO_CAMBIADO`, con el motivo, la IP y las clases antes y después, sin DNI ni nombres.
  - **Cupo compartido** (criterios 36 y 46; `cuposDelHorario`, en `mensualidades/cupo-del-horario.ts`). El cambio y la lectura usan la misma cuenta (`contarOcupacion`, `contarReservasDePrioridad`, `clasesDeLaTitularidad` y `cupoLibre`), sin contar la matrícula que se cambia: en las clases que ya tiene, su propio lugar se resta de la ocupación. El cambio exige 1 o más; la lectura muestra 0 como mínimo. Así, lo que muestra la pantalla y lo que decide el cambio no pueden divergir.
  - **Lectura del horario** (criterio 46; DT-38; `HorarioService.leer`). `GET /api/alumnos/{id}/horario` responde `horarioDelAlumnoSchema` (estricto): el nivel del alumno y, por mes, sus matrículas que el cambio deja cambiar, con el plan tal como está hoy, las clases actuales, `clasesDelPlan` (las clases activas del nivel en los días y franjas del plan), `cuposRestantes` y `conPrioridad`. No escribe ni audita, y no trae datos de otros alumnos, DNI, datos médicos ni apoderado.
  - **Ocurrencia incluida** (criterio 38; amplía DT-14 de 009). `ocurrenciaIncluida` (`asistencia/dominio/validaciones.ts`) recibe `agregadaEn`: una clase agregada cuenta desde ese instante, de forma estricta (un cambio a las 10:00:00.000 deja fuera la ocurrencia de las 10:00). La aplican el marcado (que responde `CLASE_NO_INCLUIDA`) y el registro posterior, y la tarea de faltas la escribe en su SQL (`mc.agregada_en IS NULL OR … > mc.agregada_en`, en `asistencia/faltas.service.ts`). Una clase quitada ya no se marca (`FUERA_DE_HORARIO`) ni genera faltas desde el cambio. Regla para las historias siguientes: quien lea `matricula_clases` para decidir si una ocurrencia está incluida usa también `agregada_en`.
  - **Trigger y matrícula cerrada** (criterio 34; DT-15 y DT-17). La migración `20261127190000_cambio_horario` agrega `matricula_clases.agregada_en` (`timestamptz(3)`, nula en la inscripción y en la renovación), la política `matricula_clases_borrar` (`DELETE` de la academia de la sesión) y el privilegio `DELETE` para `aquagestion_app`, que también suman `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs`. El trigger `matricula_clases_solo_matricula_abierta`, `BEFORE INSERT OR DELETE` por fila, `SECURITY INVOKER` y con `search_path` fijo, rechaza con 23514 (`check_violation`, con ese nombre de restricción) cualquier fila cuya matrícula no esté `RESERVADA` ni `VIGENTE`, o que la sesión no vea por ser de otra academia, también para el dueño de las tablas. La migración `20261127200000_trigger_matricula_clases_bloqueo` lee la matrícula con `FOR SHARE` (corrección de F1, ronda 1): si otra transacción la está cerrando, el cambio espera y, al confirmarse el cierre, falla con 23514.
  - **Web** (criterio 42; `frontend/src/modulos/mensualidades/`). En la sección «Mensualidad» de `/panel/alumnos/{id}`, cada matrícula que devuelve la lectura tiene **Cambiar horario**, para quien tiene `MODIFICAR_HORARIO_ALUMNO`. `DialogoCambiarHorario.tsx` toma de esa lectura las matrículas, sus clases y sus cupos, deja elegir entre las `clasesDelPlan`, pide el motivo y avisa cuando las ocurrencias que quedan son menos que las clases restantes. Las clases que ya no están en el plan aparecen en «Ya no disponibles» y solo se pueden quitar. Un `SIN_CUPO` marca las clases «Sin cupo» y las quita de la selección. La web no calcula cupos: los muestra y la API decide.
  - **Lo que todavía no trae.** La inscripción pública al mes siguiente (010d, DR-10). La deuda de la 010c está en `specs/backlog.md`, en la nota de la 010.

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
  historias 009a (tolerancia, que ya la usa en el marcado) y 010 (días por vencer y prioridad) la usarán con la `tx` de su operación.
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

Salen de la sección «Reglas para las historias siguientes» de `specs/005-inscripcion-publica/spec.md` (criterio 48). Las
reglas que agregó la 005b («Archivos», «Para la 008» y «Fotos de solicitudes no pagadas») están al final de esta sección.

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
  (HU-19). Antes de publicar el formulario, las inscripciones y las fotos que envían `ADMIN` o `SECRETARIA` con su sesión
  dejarán de contar en los límites por conexión (criterios 25 y 33; respuesta B4, DR-20). Ese criterio lo cumple la 007a
  (ver «Lo que construye la historia 007a»).
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
- **Archivos (005b; criterios 35 a 37 y 61 a 66).** Toda historia que guarda archivos (comprobantes de la 007, multimedia de
  la 014, certificados) usa `AlmacenArchivos`, con una clave que genera el servidor bajo `academias/{academiaId}/…` y nunca
  con un nombre que venga del cliente. Procesa el archivo y lo guarda **antes** de la transacción; la transacción toma las
  filas en el orden de bloqueos (el alumno antes que su solicitud); y **después de confirmar** borra lo que reemplazó. Un
  archivo solo se borra cuando es seguro que nadie lo referencia: si la transacción que guarda la referencia falla sin que se
  sepa si se confirmó, se relee la referencia en otra transacción antes de borrar nada (criterio 61). Esa relectura toma el
  bloqueo de la fila que guarda la referencia (`FOR SHARE`, con espera máxima, criterio 64), para esperar a que la transacción
  original termine; si la espera se agota, no borra nada. Las imágenes que suben las personas se recodifican sin metadatos
  (criterio 35). El almacén nunca vive dentro de lo que sirve la web (`frontend/`, `packages/`, `node_modules/`), y el servidor
  de desarrollo de la web solo sirve esas carpetas, nunca a través de los enlaces de los workspaces en
  `node_modules/@aquagestion/` (criterios 62 y 65). Todo paquete nuevo del workspace usa el ámbito `@aquagestion/`, o su enlace
  se suma a `server.fs.deny`. `ALMACEN_DIRECTORIO` se resuelve con `resolverAlmacenDirectorio` (criterio 66), y una variable de
  ruta nueva que deba quedar fuera de algo aplica las mismas reglas, también las de las formas de ruta de Windows. Las pruebas
  usan un almacén temporal, nunca el de desarrollo (criterio 63). Las claves que arma el servidor no usan nombres reservados de
  Windows (`con`, `nul`, `aux`, `prn`, `com1` a `com9`, `lpt1` a `lpt9`, con o sin extensión) como segmento: hoy todos son fijos,
  UUID o empiezan con un prefijo fijo (`foto-`).
- **Para la 008 (respuesta B5, DR-21).** Agregar la foto desde el panel a una solicitud o a un alumno ya registrado, y tomarla
  con la cámara de la PC, con el mismo proceso de los criterios 35 a 37: recodificación sin metadatos, `AlmacenArchivos`,
  transacción y borrado de la anterior después de confirmar. **Cumplida por la 008b** (ver «Lo que construye la historia 008b»).
- **Fotos de solicitudes no pagadas (respuesta B2, DR-18).** Ninguna historia borra la foto de una solicitud cancelada o vencida
  hasta que exista la política de retención (Ley 29733), que se define antes de producción. Cuando exista, la foto se trata
  como los demás datos de esas personas.

### Caja del día (006a)

Salen de la sección «Reglas para las historias siguientes» de `specs/006-caja/spec.md` (criterio 46), con la nota de la
ronda adversarial 1 sobre la fila del alumno. Valen también las reglas generales de este documento: `bloquearActorVigente`
como primera sentencia, `@Permiso` en cada manejador, `await` en cada paso, sin caché, `errorParaRegistro` y el 409 por el
nombre de la restricción. Las interfaces están en `backend/src/modulos/caja/movimientos.ts`, reexportadas en `caja/index.ts`.

- **Ningún cobro sin caja abierta (007, 016 y 019).** Todo cobro en efectivo y toda verificación de Yape o transferencia
  llama a `registrarIngresoEnCaja(tx, ingreso, ahora)` dentro de su propia transacción, antes de confirmar. Si lanza
  `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA` (un `ErrorNegocio` 409), quien llama lo deja subir y `conAcademia` revierte la
  transacción completa: no queda un pago confirmado sin su movimiento. Una caja de otro día, aunque siga abierta, tampoco
  admite cobros (DR-2). Un pago entra una sola vez: `pagoId` es único en la academia, y una segunda llamada con el mismo
  devuelve el movimiento anterior con `repetido: true`, sin insertar ni auditar. La 007a creó `pagos` y la llave foránea de
  `movimientos_caja.pago_id` (ver «Pagos y cobro en recepción (007a)», más abajo). El egreso desde caja de la 019 llama a
  `registrarEgresoEnCaja`. `leerCajaAbierta` sirve para avisar «abre la caja antes de cobrar» sin decidir con él.
- **Orden de bloqueos con la caja.** En toda transacción que registre un ingreso o un egreso, en este orden, y la caja
  siempre al final:
  1. `usuarios`: `bloquearActorVigente` como primera sentencia (DT-5 de 002).
  2. Los bloqueos consultivos que necesite la operación.
  3. La fila del alumno o cliente del cobro, con `FOR UPDATE` (o el modo que use la operación). Va aunque el cobro no
     cambie esa fila, y también en la verificación de un Yape o una transferencia.
  4. Las filas de `pagos`, `solicitudes_inscripcion` y `matriculas` que toque la operación.
  5. Las clases, con `bloquearClasesParaCupo` en una sola llamada.
  6. La caja: `registrarIngresoEnCaja` y `registrarEgresoEnCaja` la bloquean con `FOR UPDATE`. Después solo se insertan
     filas y auditoría.

  Ninguna transacción bloquea la caja y luego otra fila del negocio. La apertura y la reapertura toman antes el bloqueo
  consultivo `'caja:' || academia_id`, después del actor y antes de la fila de la caja; los cobros y los egresos no lo
  toman. Motivo de la fila del alumno: el `INSERT` de un ingreso toma un `FOR KEY SHARE` implícito sobre la fila del alumno
  (llave compuesta) y sobre `usuarios` (`registrado_por`), con la caja ya bloqueada. Si otra transacción tiene la fila del
  alumno con `FOR UPDATE` y espera la caja, las dos se esperan entre sí, y PostgreSQL aborta una con `40P01`. Por eso la
  fila del alumno se bloquea antes, de forma explícita (nota de la ronda adversarial 1).
- **`usuarioId` es el actor ya bloqueado.** `registrarIngresoEnCaja` y `registrarEgresoEnCaja` reciben `usuarioId` y lo
  guardan en `registrado_por`. Ese `INSERT` toma un `FOR KEY SHARE` sobre la fila de `usuarios`, que no espera a nadie,
  porque `usuarioId` es el actor que `bloquearActorVigente` ya bloqueó en la misma transacción. Quien llama pasa el actor de
  la sesión y nunca a otra persona (criterio 48 e).
- **Las interfaces validan sus entradas y lanzan `RangeError` antes de tocar la base** (criterio 48). Son la puerta por la
  que la 007, la 016 y la 019 escriben dinero.
  - `registrarIngresoEnCaja` lanza `RangeError` si `alumnoId`, `pagoId` o `usuarioId` no tienen forma de UUID, o si
    `concepto` o `metodo` no están en su lista (`CONCEPTOS_MOVIMIENTO` sin `EGRESO_MENOR`, y `METODOS_PAGO`). El monto se
    comprueba después de bloquear la caja y de buscar el `pagoId` (criterio 24): sin caja abierta, un monto inválido da
    `SIN_CAJA_ABIERTA`. Si el monto no es válido, lanza `RangeError` sin escribir.
  - `registrarEgresoEnCaja` valida la descripción, el comprobante, la clave de idempotencia, el `usuarioId` y el monto con
    las reglas de la ruta, y trabaja con los valores normalizados: la descripción recortada y el comprobante, o `null`.
  - `leerCajaAbierta` no recibe datos de quien llama. No valida nada y no lanza `RangeError`.
  - El mensaje del `RangeError` no lleva el valor, para que no llegue a los registros. No es un `ErrorNegocio`: quien llama
    no lo convierte en un 409.
- **El día es el de Lima.** La caja de hoy se decide con `hoyEnLima(RELOJ.ahora())`, nunca con `CURRENT_DATE`. Una caja de
  otro día, o con fecha futura, no admite movimientos (`esDeOtroDia`).
- **El ingreso guarda el método real y el monto total.** Un Yape entra como `YAPE` y no suma al efectivo esperado (D-04).
  La caja no redondea ni suma IGV: entra el total ya calculado (D-03).

### Historial y PDF del cierre (006b)

Salen de `specs/006-caja/spec.md`: los criterios 40 a 57, las precisiones PQ1 a PQ15 y las decisiones DR-9, DR-13 y DT-7 a
DT-20. Los números de criterio de esta sección son los de esa spec. La 006b no tiene migraciones: lee lo que la 006a ya
guarda. Vale lo de la 006a (`bloquearActorVigente` como primera sentencia en las escrituras, `await` en cada paso, sin caché,
`errorParaRegistro` y las fechas de Lima con `RELOJ`).

- **Rutas y alcance (criterios 7 y 40; PQ1 y PQ2).** `GET /api/cajas?desde=&hasta=` (la lista), `GET /api/cajas/{id}` (el
  detalle) y `GET /api/cajas/{id}/cierres/{numero}/pdf` (el PDF) exigen `VER_REPORTES_FINANCIEROS`. El orden de las
  comprobaciones es el de 002: sesión, academia activa, cambio obligatorio y permiso; después, la consulta o la operación.
  El alcance sale de `MATRIZ_PERMISOS.VER_REPORTES_FINANCIEROS[rol]` y no del nombre del rol (`HistorialService`):
  - `TODO` (el administrador) ve todas las cajas de la academia.
  - `SU_CAJA` (la secretaria) ve una caja si la abrió ella, si alguna vez la cerró (vigente o reabierta), si está abierta
    ahora o si es la de hoy en America/Lima (DR-9 y DR-13).
  - Cualquier otro valor no ve nada.
  - `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO`, también con un id o un número inválidos. El Superadmin no tiene estas
    rutas (D-29).
- **Los 404 son iguales (criterios 8 y 41; PQ1 y PQ6).** Un id que no es UUID, uno que no existe, uno de otra academia y uno
  fuera del alcance de la secretaria responden el mismo `NO_ENCONTRADO`, con el mismo cuerpo. En el PDF, también un
  `numero` que no es un entero de 1 a 32767 o que no es de esa caja. Nunca hay 400 ni 403 por el id o el número. La lista
  ignora `?academiaId=` y cualquier parámetro que no sea `desde` o `hasta`. Las tres lecturas no llaman a
  `bloquearActorVigente`, no bloquean filas, no escriben y no auditan.
- **La lista (criterio 40; PQ3 y PQ4).** `desde` y `hasta` se leen tal como llegaron (helper `comun/http/parametro-crudo.ts`,
  más abajo): un valor repetido, con corchetes o vacío responde 400 en ese campo. Sin parámetros son los últimos 31 días
  hasta hoy en Lima. El rango es de como mucho 366 días, y `desde` no puede ser posterior a `hasta`. La respuesta es
  `{ desde, hasta, cajas }`, de la fecha más reciente a la más antigua, en una sola consulta SQL (una sola foto de la base).
  Los totales son las sumas actuales de los movimientos, y `ultimoCierre` es el cierre de mayor número, o `null`. No hay
  paginación: el rango acota la lista a 366 cajas.
- **El PDF (criterios 42 y 43; PQ6 a PQ11).** `pdfkit`, en A4 y con Helvetica. Las cabeceras son las de PQ7:
  `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="cierre-caja-AAAA-MM-DD-N.pdf"` y
  `Cache-Control: no-store`. El documento trae la academia, la fecha de la caja, «Cierre N» (y «Cierre tardío», si lo es), la
  apertura, los movimientos hasta `movimientosHasta`, los totales, el esperado, lo declarado, la diferencia con su resultado,
  la observación, quién cerró y, si hubo, la reapertura. Nunca muestra un DNI.
  - **Fuera de la escritura (criterio 43).** Nada se guarda en el disco ni en la base (DT-2). El servicio lee en una transacción
    corta que solo lee y la termina; el PDF se arma después, así que ninguna conexión queda ocupada mientras se dibuja. Si el
    generador falla, responde 500 `ERROR_INTERNO` y no cambia nada.
  - **Determinista (PQ9 d).** `info.CreationDate` es `cerradoEn`, no la hora de la descarga, y `pdfkit` calcula el `/ID` con
    los datos que recibe en el constructor. Las horas salen en America/Lima. Dos descargas del mismo cierre dan los mismos
    bytes, también con el proceso en `TZ=Asia/Tokyo`. Los bytes cambian solo si el cierre se reabre o si cambia un nombre
    (PQ10 muestra los nombres de hoy).
  - **Por tramos (criterio 49 a).** `generarPdfCierre` (`backend/src/modulos/caja/pdf/cierre-pdf.ts`) dibuja en el hilo
    principal, pero en tramos de unos 5 ms medidos con `performance.now()`. Entre tramos cede el bucle con
    `setImmediate`, así que las demás peticiones avanzan mientras se arma un PDF grande. Las llamadas a `pdfkit` son las
    mismas y en el mismo orden, así que los bytes no cambian. No hay `worker_thread`: no toca el build ni el cargador de
    las pruebas.
  - **Texto (PQ11).** Todo texto que sale de los datos pasa por `textoParaPdf` (`pdf/texto-pdf.ts`): se normaliza a NFC y lo
    que no esté entre U+0020 y U+007E, ni entre U+00A0 y U+00FF, se escribe como `?`. El texto va codificado, nunca como
    operadores del PDF.
  - **Generador inyectable (PQ8).** `GENERADOR_PDF_CIERRE` es el token de Nest que `CajaModule` provee con
    `{ generar: generarPdfCierre }`. Las pruebas lo reemplazan con `overrideProvider(GENERADOR_PDF_CIERRE)`. El generador
    recibe `(datos, senal?)`, y uno de un solo parámetro sigue siendo válido. `caja/index.ts` lo reexporta.
  - **Dependencia (DT-3).** `pdfkit` está en `backend/package.json` (y `@types/pdfkit` en las de desarrollo) y en
    `DEPENDENCIAS_BACKEND_PERMITIDAS`. Es JavaScript puro, sin binarios por sistema operativo, así que la instalación en
    Windows no cambia.
- **Cola de generación (criterios 49 b y c, 52; DT-8 y DT-11).** `ColaPdfCierre` (`pdf/cola-pdf.ts`) es una sola instancia
  por proceso de la API, con `LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8, porPersona: 2, porAcademia: 4 }`:
  - como mucho 2 PDF se generan a la vez en todo el proceso, contando todas las academias, y como mucho 8 descargas esperan
    su turno, en orden de llegada;
  - como mucho 2 por persona (`sesion.usuario.id`, no la academia ni la IP) y 4 por academia (`sesion.usuario.academiaId`),
    en curso o en espera;
  - si algún límite se alcanza, responde 429 `DEMASIADAS_SOLICITUDES` con el mensaje de siempre, en JSON, con `no-store` y sin
    `Content-Disposition`. No llama al generador, no escribe y no audita. Los tres 429 son iguales: no dicen qué límite se
    alcanzó;
  - el orden es persona, academia y lugar en la cola. Antes, la forma del id y la del `numero` responden 404 sin tocar la
    cola;
  - cada descarga libera su lugar al terminar, con 200, 404, 500 o abandonada.
  - Los límites son por proceso: con varias instancias de la API, cada una tiene los suyos. Riesgo aceptado: con 4 por
    academia y 10 lugares, si tres o más academias saturan la cola a la vez, otra puede recibir 429.
- **Descargas abandonadas (criterios 51 y 55; DT-10, DT-15, DT-18 y DT-20).** Cortar es que el cliente cierre la conexión
  antes de que la respuesta termine. La conexión de una descarga se da por cerrada si la respuesta se cerró sin terminar
  (`destroyed`, o `closed` sin `writableFinished`), si el socket de la petición está destruido, o si el socket ya leyó el FIN
  del cliente o ya no admite escritura (`readableEnded` o `!writable`). La última condición existe porque Node llama a
  `socket.end()` al leer el FIN, antes de destruir el socket. Con `httpAllowHalfOpen = false`, una descarga viva nunca está en
  ese estado (`conexionCerrada` en `cajas.controller.ts`).
  - **Señal.** El controlador crea un `AbortController` y lo activa con el `close` de la respuesta o con el del socket. El del
    socket avisa también a una petición en pipelining, cuya respuesta todavía no tiene socket. Los oyentes se quitan en un
    `finally`, porque en una conexión keep-alive el socket atiende otras peticiones. La señal llega al turno y al generador.
    Si el cliente corta mientras espera, la descarga sale de la fila y libera su lugar y sus cupos. Si corta mientras se
    genera, el generador deja de dibujar y rechaza con `AbortError`.
  - **Antes del controlador (criterio 55 b).** Lo primero del manejador, antes de la forma del id y de pedir turno, es mirar si
    la conexión ya se cerró. Si es así, la descarga termina sin ocupar nada. Los oyentes se instalan en el mismo paso
    síncrono, sin `await` en medio, para que un corte no se pierda.
  - **Antes de escribir (criterios 55 g y 55 h).** Justo antes del 200, y en el camino del error, se vuelve a mirar la
    conexión además de la señal, sin `await` entre la comprobación y la escritura. Si está cerrada, no se escribe nada, ni
    siquiera un JSON de error, y el error no llega al filtro global. Se registra una línea `info` si el error viene del corte,
    o el error del manejador si no viene de él.
  - **Sin efectos.** Una descarga abandonada no escribe, no audita y no se registra como un 500. Lo que se responde antes de
    llegar al manejador (sesión, academia suspendida, cambio obligatorio y permiso) no cambia.
- **La sesión después de la espera (criterio 53; DT-12).** Al obtener el turno y antes de leer, `HistorialService.pdf` llama
  a `volverAVerificar`. El controlador la enlaza con `SesionAcademiaService.volverAVerificar`, con el permiso
  `VER_REPORTES_FINANCIEROS`. Hace lo mismo que una petición nueva con
  la misma cookie y con los mismos errores: sesión (token, usuario activo y `version_token`), academia activa, cambio
  obligatorio y permiso del rol vigente. Es una lectura: no usa `bloquearActorVigente` ni `FOR SHARE`, no escribe y no audita.
  La descarga usa la sesión recién leída, así que el alcance y el nombre de la academia son los vigentes. Si la comprobación
  falla, la descarga libera su lugar sin leer ni generar. Un cambio posterior a esa comprobación, mientras se lee o se genera,
  no detiene la descarga (riesgo aceptado).
- **`HEAD` no existe en las rutas de la caja (criterio 50; PQ15; DT-9).** Express atiende un `HEAD` con el manejador del
  `GET`. `instalarHeadSinRutasDeCaja` (`caja/head-sin-ruta.ts`) lo intercepta con un middleware de Express, instalado en
  `configurarApp` (`crear-app.ts`) después de la protección de las rutas de academia y antes de las rutas de Nest. Un `HEAD`
  sobre `/api/cajas` y lo que cuelga de ella (con o sin barra final, sin distinguir mayúsculas) responde 404
  `NO_ENCONTRADO` para cualquier rol, sin llamar al servicio, a la base, al generador ni a la auditoría. Sin sesión, con el
  cambio de contraseña pendiente o con la academia suspendida, responde lo mismo que `PATCH`. No es `@Head()` en el
  controlador porque pasaría por el guard de permisos, y el `ENTRENADOR` recibiría 403.
  - **Para la 007 (DT-9).** `HEAD` responde 404 solo en las rutas de la caja. En las demás rutas `GET` (002 a 005) sigue
    llamando al manejador del `GET`. Si la 007 arma archivos (comprobantes o tickets), su revisión adversarial debe mirar
    `HEAD` en esas rutas.
- **Helper `comun/http/parametro-crudo.ts`.** `parametroCrudo(solicitud, nombre)` devuelve el parámetro de la consulta tal como
  llegó: `undefined` si no vino, el texto si vino una vez (también vacío), y un arreglo si se repite o se escribe con
  corchetes. Así un valor repetido no pasa un esquema de texto y responde 400 en ese campo. Lo usan la lista de cajas (006b)
  y el filtro de estado de las solicitudes (005b).
- **Web (criterios 44 y 54 a 57; PQ12; DT-13, DT-16, DT-17 y DT-19).** `/panel/cajas` (la lista, con los campos «Desde» y
  «Hasta») y `/panel/cajas/:id` (el detalle) van dentro de `RequierePermiso` con `VER_REPORTES_FINANCIEROS`. La opción
  «Historial de caja» del inicio usa `puede(rol, 'VER_REPORTES_FINANCIEROS')`. El detalle reutiliza `ResumenCaja`,
  `ListaMovimientos` y `ResultadoDelCierre` en solo lectura. «Reabrir caja» aparece solo en las cajas cerradas y solo para
  quien tiene `REABRIR_CAJA`.
  - **Registro de descargas en curso** (`frontend/src/lib/descargas-en-curso.ts`). Cada descarga tiene su propio
    `AbortController`, que se registra al pulsar «Descargar PDF» (no al empezar su mutación, que sin conexión queda en pausa).
    `pedirArchivo` acepta una señal opcional. Al terminar, con éxito o sin él, la descarga se quita del registro.
  - **Cuándo se cancela.** `cancelarDescargasEnCurso()` corre en `onMutate` de `useCerrarSesionAcademia`: se cancela al pulsar
    «Cerrar sesión», también sin conexión. Además se cancela cuando la sesión cambia de identidad o se pierde
    (`useVigilanteDeLaSesion` observa `GET /api/sesion`), cuando la página del detalle se desmonta (a la lista, a otra ruta o
    con «atrás») y cuando cambia la caja: `DetalleCaja` monta el contenido con `key={id}`, así que el cambio de id desmonta la
    descarga anterior.
  - **Comprobación final.** Antes de entregar el archivo, la web comprueba que la descarga no se canceló, que no se está
    cerrando la sesión y que la identidad sigue siendo la de la página. Si algo no cuadra, no crea la URL de objeto, no hace
    `click` y no muestra ningún mensaje.
  - **Sin descargas mientras se cierra la sesión (criterio 57 e).** «Se está cerrando la sesión» dura desde que se pulsa
    «Cerrar sesión» hasta que su mutación termina, con éxito o con error (`CLAVE_CERRAR_SESION`, con `useIsMutating` y
    `cliente.isMutating`). Mientras tanto, «Descargar PDF» está desactivado, y ninguna descarga nueva se pide ni se entrega.
    Si el cierre de sesión falla, la sesión sigue abierta y el botón vuelve a estar habilitado.
  - **Errores.** Con 404, «No se encontró el cierre»; con 429, «Hay muchas descargas de PDF en curso. Espera un momento e
    inténtalo de nuevo.»; con 500 u otro error, «No se pudo generar el PDF. Inténtalo de nuevo.»; con 401, el flujo de
    sesión perdida de 002. Una descarga cancelada no muestra ningún mensaje propio.
  - **Consultas y almacenamiento.** Las claves de consulta llevan la identidad de la sesión: la del historial es
    `['cajas-historial', nombreCorto, usuarioId, desde, hasta]` y la del detalle, `['caja', nombreCorto, usuarioId, id]`.
    Nada se guarda en el almacenamiento local.
- **Riesgos aceptados.** Están en la sección «Riesgos aceptados» de la spec: las lecturas de cajas enormes (DT-14; el límite
  general de peticiones por usuario o por academia queda pendiente antes de producción, anotado en `specs/backlog.md`), los
  límites del PDF por proceso, la fuente estándar (solo Latin-1), los nombres de hoy en el PDF y el cierre de sesión en
  otra pestaña.

### Pagos y cobro en recepción (007a)

Salen de la sección «Reglas para las historias siguientes» de `specs/007-pagos/spec.md`. Valen las reglas generales de este documento: `bloquearActorVigente` como primera sentencia, `@Permiso` en cada manejador, `await` en cada paso, sin caché, `errorParaRegistro` y el 409 por el nombre de la restricción.

- **Confirmar un pago (010, 016).** Todo pago se confirma con `confirmarPagoEnTransaccion`, dentro de la transacción que lo deja `CONFIRMADO`: registra el ingreso en la caja abierta de hoy, numera el ticket y, si es el primer pago del alumno, crea su cuenta y le da el token de su QR (008a). Nadie escribe un pago confirmado a mano, y la base no lo acepta sin su movimiento (criterio 5). Quien llama toma antes los bloqueos del cobro (en «Lo que construye la historia 007a», más arriba) y decide los 409 que van antes de la caja.
- **Orden de bloqueos.** `usuarios` (actor) → consultivo `inscripcion-dni:` → `alumnos` → `solicitudes_inscripcion` → `matriculas` → `pagos` → `clases` (si mueve cupo) → la caja, al final. Después de la caja solo se insertan filas o se actualizan las que la transacción ya bloqueó. Ninguna transacción bloquea la caja y luego otra fila del negocio.
- **Movimientos de caja.** `movimientos_caja` no cambia ni se borra (trigger `movimientos_caja_no_cambian`). Una migración que necesite cambiarlos desactiva ese trigger dentro de la migración y lo vuelve a activar al final. No es una vía para el código de la API.
- **Un pago resuelto no cambia** (criterio 6): una corrección es otra operación, con su auditoría.
- **Un pago abierto por matrícula** y **un número de operación por academia y método entre los pagos abiertos** los garantiza la base; el 409 sale del nombre del índice. El número se compara normalizado con `normalizarNumeroOperacion`.
- **El total sale de la matrícula** con `totalACobrar` (D-03, HU-19); nunca del plan. Cobro y ajuste toman las mismas filas en el mismo orden (criterio 12).
- **Auditoría.** Las filas de `auditoria` se insertan con `insertarEnAuditoriaDeAcademia`, que usa `idDeAuditoriaOrdenado`. Una fecha no válida lanza `RangeError`: la operación falla sin escribir y su transacción se revierte.
- **Correos.** Se envían después de confirmar, con `enviarSinEsperar`: no retienen la respuesta, y nunca llevan el DNI ni el token.
- **Recepción** (DT-11). Una ruta pública que acepta la sesión de recepción la toma de `req.sesionDeRecepcion`, que verifica el middleware. El id del actor nunca sale de la dirección ni del cuerpo.

## Estructura de carpetas

```
piscina/
├── .claude/
│   ├── agents/                   Roles de la metodología
│   ├── hooks/preparar-sesion.mjs Prepara cada sesión en la nube
│   └── settings.json
├── .github/
│   ├── workflows/ci.yml          Revisión automática: Linux con PostgreSQL real, integración en 4 trabajos, Windows y pruebas protegidas
│   └── pull_request_template.md
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/           Incluyen las políticas RLS por academia
│   │   └── seed.ts               Datos inventados: 2 academias de ejemplo, sus usuarios, planes, clases, solicitudes (una con un ajuste de monto) y la caja cerrada de `delfines`
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
│   │       ├── planes/ · clases/ · matriculas/ · inscripciones/ · caja/ · pagos/ · alumnos/ · asistencia/   (004, 005a, 005b, 006a, 006b, 007a, 007b, 008a, 008b y 009a; matriculas/ no tiene controlador; caja/ tiene el historial, el detalle y el PDF de la 006b, en `pdf/`)
│   │       └── <modulo>/         Un módulo por área (planes, clases, caja, pagos, asistencia…)
│   │           ├── <modulo>.module.ts · .controller.ts · .service.ts
│   │           └── dominio/      Cálculos puros + sus pruebas unitarias (*.test.ts)
│   ├── test/
│   │   ├── integracion/<modulo>/ Pruebas contra PostgreSQL real
│   │   └── utilidades/           Crear academias y datos de prueba, limpiar la base
│   └── almacenamiento/           Fotos subidas en desarrollo: la carpeta por defecto de `ALMACEN_DIRECTORIO` (ignorado por git)
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
- La integración continua (`.github/workflows/ci.yml`) tiene cuatro trabajos de integración del backend, `integracion (1/4)`
  a `(4/4)`, en paralelo y con `--shard` de Vitest (D-31). Cada uno tiene su propio PostgreSQL, así que no comparten base.
  `linux` corre el resto de los proyectos de Vitest, el formato, el lint, los tipos, la compilación y el E2E; `windows`,
  el formato, los tipos, la compilación y las pruebas unitarias; `pruebas-protegidas` verifica el rango de cada PR.
