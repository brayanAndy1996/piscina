# AquaGestión · Sistema de gestión para academias de natación

Sistema web de gestión para academias de natación en Perú, pensado para varias academias en una misma instalación
(D-23): inscripción en línea, cobros y caja, verificación de pagos por Yape o transferencia, carnet digital con QR,
asistencia, mensualidades, rendimiento de los alumnos y un panel de consulta para alumnos y apoderados.

## Qué está construido

**000 · Esqueleto** está unida a `main` y deja la base técnica:

- **API** (NestJS, en `/api`):
  - `GET /api/salud`: responde 200 si la API y la base de datos responden, y 503 si la base no responde, en menos de
    3 segundos.
  - Errores con un formato común (`NO_ENCONTRADO`, `ERROR_INTERNO`), cabeceras de seguridad con `helmet` y sin CORS,
    porque la web y la API comparten dominio.
  - Registros en JSON, con los valores de cookies y credenciales ocultos. Valida la configuración al arrancar, sin
    mostrar valores.
  - Reloj inyectable (`RELOJ`) para controlar la hora en las pruebas.
- **Web** (React, en `/`): la página de inicio muestra el título "AquaGestión" y el estado del sistema ("Sistema en
  línea", "Sin conexión con la base de datos", entre otros). Las rutas desconocidas muestran "Página no encontrada"
  con un enlace para volver al inicio.
- **Calidad y método:** Vitest, ESLint, Prettier, `husky` con `lint-staged`, verificación de pruebas protegidas y de
  secretos, hook de sesión para la nube (D-26) e integración continua en GitHub Actions: Linux con PostgreSQL real,
  Windows y pruebas protegidas.
- **Pruebas E2E** con Playwright: comprueban que la web abre y muestra "Sistema en línea".

**001 · Academias y aislamiento** está unida a `main`. Trae:

- **Academias:** cada academia tiene un nombre y un nombre corto (de 3 a 30 caracteres, en minúsculas, que no se puede
  cambiar; D-27). La plataforma la crea, la lista, la suspende con un motivo obligatorio y la reactiva. Una academia
  suspendida conserva sus datos.
- **Superadmin:** su cuenta se crea, y su clave se restablece, con `npm run plataforma:superadmin`; no hay registro por
  la web (D-29). Inicia sesión en `/plataforma/ingresar`, con una cookie `httpOnly` de 8 horas. Cinco intentos fallidos
  seguidos bloquean la cuenta 15 minutos, y hay un límite de 10 intentos por minuto desde una misma IP.
- **Aislamiento entre academias:** la API se conecta con el rol `aquagestion_app`, sin superusuario ni `BYPASSRLS`.
  PostgreSQL filtra las tablas por academia con seguridad a nivel de fila (RLS), también para el dueño de las tablas.
  Cada transacción fija la academia o el contexto de plataforma, y si el rol no es seguro, la API no atiende datos.
  Detalles en [`docs/arquitectura.md`](docs/arquitectura.md).
- **Auditoría:** las altas, suspensiones y reactivaciones de academias, y el alta y el restablecimiento del superadmin,
  quedan en la auditoría de la plataforma. Los inicios de sesión van solo al registro técnico. Todavía no hay pantalla
  para verla.
- **Configuración:** la tabla de configuración por academia existe; sus claves y valores por defecto son de la 003.
- **Ruta pública:** `GET /api/a/{nombreCorto}` devuelve el nombre de una academia activa, sin su id ni su estado (desde la 005a, también su teléfono). Responde
  404 si no existe y 403 si está suspendida.
- **Datos de ejemplo:** `npm run db:semilla` (y `npm run db:preparar`) crea, si no existen, las academias `delfines`
  ("Academia de Natación Los Delfines") y `tiburones` ("Club de Natación Tiburones") y el superadmin de desarrollo. Los
  usuarios de ejemplo de cada academia son de la 002.
- **Web:** `/plataforma/ingresar` y `/plataforma/academias`, para crear, suspender y reactivar academias y para cerrar
  sesión. `/plataforma` lleva a la lista.
- **Pruebas E2E de la plataforma:** `e2e/pruebas/plataforma.spec.ts`, con Playwright. El superadmin ingresa, crea,
  suspende y reactiva una academia, y cierra sesión. A 360 px, la plataforma se ve completa, sin desplazamiento
  horizontal.

**002 · Autenticación y roles por academia** está unida a `main` (17/11/2026). Trae:

- **Ingreso por academia:** `/a/{nombreCorto}/ingresar`, con el DNI y la contraseña. La sesión va en la cookie `aq_sesion`
  (`HttpOnly`, `SameSite=Strict`): 12 horas para el personal y 30 días para el alumno. "Cerrar sesión" la cierra en todos
  los dispositivos de esa cuenta.
- **Contraseñas:** la inicial es el DNI, y se cambia al primer ingreso (y después, desde el panel). Tiene de 8 a 128
  caracteres, distintos del DNI y de la actual, y se guarda con argon2. Cinco intentos fallidos seguidos bloquean la cuenta
  15 minutos por defecto (desde la 003, cada academia los configura), y un restablecimiento la desbloquea. El ingreso
  admite 10 peticiones por minuto desde una misma IP (contador
  en memoria de cada instancia).
- **Roles:** administrador, secretaria, entrenador y alumno, con un rol por cuenta (DR-7 de 002). El DNI es único dentro de
  cada academia (D-28). La matriz de permisos está en `packages/contratos/src/permisos.ts`; la API la aplica con un guard, y
  una ruta de academia sin permiso declarado responde 403.
- **Personal:** en `/panel/usuarios`, el administrador lista (también a los inactivos), crea, desactiva, reactiva y
  restablece. En `/panel/restablecer`, el administrador y la secretaria (esta, solo a alumnos) buscan por DNI y restablecen
  la contraseña.
- **Superadmin:** en `/plataforma/academias`, el botón **Administradores** de cada academia muestra sus administradores,
  crea uno y restablece su contraseña. La pregunta N11 sigue abierta: quien crea o restablece un administrador conoce su
  clave inicial, que es su DNI.
- **Auditoría:** crear, desactivar, reactivar y restablecer cuentas, y cambiar la contraseña, quedan en la auditoría de la
  academia. Los inicios de sesión solo van al registro técnico, sin DNI ni claves. Todavía no hay pantalla para verla.
- **Datos de ejemplo:** `npm run db:semilla` crea un usuario por rol en `delfines` y un administrador en `tiburones`, con
  DNIs inventados y la contraseña inicial igual al DNI. Desde la 003, también deja un teléfono de ejemplo en `delfines`.
  Los detalles están en la guía.
- **Pruebas E2E de la autenticación:** `e2e/pruebas/autenticacion.spec.ts`. El superadmin crea una academia y su
  administrador; el administrador cambia su contraseña y crea una secretaria, que también debe cambiarla al entrar.

**003 · Configuración de la academia** está unida a `main`. Trae:

- **Valores de cada academia:** la tolerancia de tardanza, los días para marcar una mensualidad "por vencer", los días de
  prioridad para renovar, los intentos fallidos antes del bloqueo, la duración del bloqueo y el teléfono. Sin valor
  guardado, vale el valor por defecto. Las claves y los rangos están en [`docs/arquitectura.md`](docs/arquitectura.md).
- **Pantalla:** `/panel/configuracion`, con la opción **Configuración** del inicio del panel, solo para el administrador.
  La cabecera del panel muestra el nombre y el teléfono de la academia.
- **Bloqueo del ingreso con valores propios:** los intentos y la duración del bloqueo son de cada academia, y también
  valen para el cambio de contraseña. Un bloqueo que ya está puesto no cambia si se modifican los valores, y el mensaje
  dice cuántos minutos faltan. El bloqueo del superadmin sigue fijo (5 intentos y 15 minutos).
- **API:** `GET` y `PATCH /api/configuracion` (solo el administrador) y `GET /api/mi-academia` (nombre, nombre corto y
  teléfono de la academia de la sesión). Cada cambio guardado queda en la auditoría de la academia.
- **Quién lo usa:** los días por vencer los lee la 010b, y la prioridad de renovación, la 010a y la 010d. La tolerancia de
  tardanza la lee la asistencia desde la 009a. El teléfono se ve en el panel y, desde la 005a, en las páginas públicas.
- **Datos de ejemplo:** la semilla deja un teléfono de ejemplo en `delfines`; `tiburones` queda con los valores por
  defecto.

Todavía no trae los permisos de cada módulo (cada historia aplica su alcance), el alta de las cuentas de alumno (la 007a la crea al confirmar un pago), la pantalla de auditoría (Fase 3), la recuperación de la contraseña por correo (se pide en recepción), el logo ni el cambio del nombre de la academia (DR-2 y DR-5 de 003), ni el cambio del
DNI, del nombre o del rol de una cuenta.

**004 · Planes y clases con aforo** está unida a `main` (19/11/2026).
Trae:

- **Planes** (`/panel/planes`, solo el administrador): nombre único en la academia (no distingue mayúsculas, ni espacios o
  caracteres invisibles que se ven iguales); de 1 a 7 veces por semana; de 1 a 31 clases por mes; duración de 15 a 60
  minutos (60 por defecto, informativa); precio con IGV incluido, de S/ 0.01 a S/ 99,999.99 y con hasta dos decimales; días,
  franjas (bloques de 1 hora) y niveles permitidos; vigencia opcional, y activo o inactivo. El estado (Vigente, Programado,
  Vencido o Inactivo) se calcula con la fecha de Lima. Los planes no se borran: se desactivan.
- **Clases y horarios** (`/panel/clases`): la semana en una grilla de 08:00 a 20:00, en bloques de 1 hora (en el celular, un
  día a la vez). Cada clase tiene nivel (Básico, Intermedio o Avanzado), día, bloque, entrenador y aforo de 20 a 50. Un
  entrenador no tiene dos clases en el mismo bloque, y hay como mucho una clase por nivel en cada bloque: la base lo
  garantiza. Se cambian el entrenador, el aforo y si la clase está activa; el nivel, el día y la hora no se cambian (para
  moverla, se desactiva y se crea otra). Las clases tampoco se borran.
- **Cupo:** todavía no hay inscritos. Esta historia deja el bloqueo común del cupo (`bloquearClasesParaCupo`) y sus reglas
  para las historias siguientes, en [`docs/arquitectura.md`](docs/arquitectura.md).
- **API:** `GET` y `POST /api/planes`, `PATCH /api/planes/{id}`, `GET` y `POST /api/clases` y `PATCH /api/clases/{id}`,
  todas con el permiso `CONFIGURAR_PLANES_HORARIOS_AFORO` (solo el administrador). Cada cambio queda en la auditoría de la
  academia.
- **Datos de ejemplo:** `delfines` tiene un segundo entrenador, dos planes y cinco clases, dos de ellas el lunes a las
  18:00 (la 005a suma tres más). `tiburones` queda sin planes ni clases.
- **Lo que todavía no trae:** el horario del entrenador (012) y los días de cierre (017). Las inscripciones y las reservas llegan con la 005a (abajo).

**005a · Inscripción pública, reserva y seguimiento** está unida a `main` (PR #8, 20/11/2026).
Trae:

- **Formulario público** en `/a/{nombreCorto}/inscripcion`, sin sesión, para el celular y para la PC de recepción. Pasos:
  datos personales, ficha médica, apoderado (solo si la persona es menor de 18 años), plan y horario, y resumen con los
  consentimientos. Solo se ofrecen las clases con cupo del nivel elegido, una por día. El monto es proporcional si entra a
  mitad de mes, con IGV incluido y redondeado hacia arriba al sol entero.
- **Reserva del cupo:** al enviar, la solicitud reserva su lugar con un código (`AQ-` y seis caracteres) y un enlace de
  seguimiento. La reserva vence a las 24 horas o al fin del mes en Lima, lo que ocurra primero. Ninguna clase pasa de su
  aforo, aunque dos personas tomen el último cupo a la vez.
- **Seguimiento:** `/a/{nombreCorto}/solicitud/{token}`, con el enlace, y `/a/{nombreCorto}/solicitud`, con el código y el
  DNI. El enlace lleva un token aleatorio, y la base guarda solo su SHA-256. El correo con el enlace sale después de
  confirmar; en desarrollo, el envío es simulado.
- **Límites por conexión:** lecturas, cotización, envío y consulta tienen su propio límite, y una conexión tiene como mucho
  cinco solicitudes sin pagar. Las IPv6 se agrupan por bloque /64. Detalles en
  [`docs/arquitectura.md`](docs/arquitectura.md).
- **API nueva:** `GET /api/a/{nombreCorto}/inscripcion`, `POST /api/a/{nombreCorto}/inscripcion/cotizacion`,
  `POST /api/a/{nombreCorto}/inscripcion` y `POST /api/a/{nombreCorto}/solicitudes/consulta`. `GET /api/a/{nombreCorto}`
  suma el teléfono. `PATCH /api/clases/{id}` acepta `confirmarAforoMenor` y responde 409 si el aforo baja de los inscritos
  o si se desactiva una clase con inscritos (DR-5 de 004).
- **Teléfono público:** la página de ingreso, la de inscripción y la de seguimiento muestran el teléfono de la academia
  (DR-4 de 003).
- **Datos de ejemplo:** `delfines` suma tres clases de Básico (martes a jueves, a las 18:00) y tres clientes con solicitud
  (`AQ-SM0001`, `AQ-SM0002` y `AQ-SM0003`). `tiburones` queda sin solicitudes.
- **Variables de entorno:** esta historia no agrega ninguna a `.env.example`.
- **Antes de publicar el formulario:** hay que configurar `trust proxy` con el hosting. Hoy no está configurado: detrás de
  un proxy, todos los visitantes contarían como una sola conexión. Ver «Antes de publicar el formulario» en
  [`docs/arquitectura.md`](docs/arquitectura.md).
- **Cómo probarla en tu PC:** con `npm run dev` encendido, abre http://localhost:5173/a/delfines/inscripcion. El paso a paso
  está en la guía, en «Probar la inscripción pública». Las pruebas automáticas corren con `npm test` (necesita PostgreSQL) y
  con `npm run test:unit`.
- **Lo que todavía no trae:** la renovación y el cambio de horario (010). El cobro en efectivo y el paso a alumno llegaron con la 007a, y el pago por Yape o transferencia, con la 007b.

**005b · Foto de la inscripción y panel de solicitudes** está construida y unida a `main`. Trae:

- **Foto opcional en el formulario:** en el paso **Foto (opcional)**, antes del resumen, la persona elige una imagen JPG o PNG
  de hasta 5 MB. Ve una vista previa, y la página avisa antes de subirla si el tipo o el tamaño no sirven. La foto se sube sola
  después de crear la solicitud. Si la subida falla, la solicitud queda creada y el enlace de seguimiento permite subirla de nuevo.
- **La API comprueba la imagen** (que sea un JPEG o un PNG de verdad, que se pueda decodificar, de 100 a 8000 píxeles por lado y
  como mucho 40 megapíxeles) y la guarda como JPEG de como mucho 800 píxeles, **sin metadatos** (sin EXIF ni coordenadas GPS).
  Lo guardado nunca es el archivo subido. Cada conexión puede subir 10 fotos por hora.
- **Seguimiento con foto:** mientras la solicitud sea editable (pendiente de pago y no vencida), el enlace de seguimiento muestra
  "Foto cargada" o permite subir o cambiar la foto. Con la vista reducida no hay control para subirla.
- **Panel de solicitudes** en `/panel/solicitudes`, para `ADMIN` y `SECRETARIA`: lista las solicitudes con el filtro Activas,
  Vencidas, Canceladas o Todas, con los datos de contacto, el plan, los días y las horas, el monto y la fecha límite de la reserva.
  **Cancelar** pide un motivo, libera el cupo y deja su auditoría. La persona no recibe correo, y su foto no se borra.
- **«Nueva inscripción»** en el inicio del panel abre, en otra pestaña, el formulario público de la academia, para inscribir a
  alguien en recepción. Desde recepción, la foto se elige en ese mismo paso.
- **Ocupación:** la grilla de `/panel/clases` muestra "inscritos / aforo", y al bajar el aforo por debajo de los inscritos, o al
  desactivar una clase con inscritos, la web pide confirmación o explica qué hacer (DR-5 de 004).
- **Almacén de archivos (`ALMACEN_DIRECTORIO`):** las fotos se guardan en la carpeta que indica esta variable, que por defecto es
  `backend/almacenamiento` (ignorada por git). Ninguna ruta de la API ni del servidor de desarrollo la sirve. La API no arranca si
  la ruta cae dentro de `frontend/`, `packages/` o `node_modules/`, o si tiene una forma de ruta que Windows no admite. Detalles en
  la guía, en «Dónde se guardan las fotos».
- **Dependencia nueva:** `sharp`, que recodifica las imágenes. Sus binarios de Windows vienen con `npm ci`.
- **Sin migraciones:** la 005b usa las tablas y los estados que ya creó la 005a.
- **Lo que todavía no trae:** agregar la foto después desde el panel y tomarla con la cámara de la PC (008); ver la foto desde la
  web (008, con el carnet); y la política de retención de las fotos de solicitudes no pagadas, que se define antes de producción.

La historia 005 (la 005a y la 005b) está en [`specs/005-inscripcion-publica/`](specs/005-inscripcion-publica/spec.md). Su estado
está en [`specs/backlog.md`](specs/backlog.md).

**006a · Caja del día** está construida y unida a `main`. Trae:

- **Apertura:** la secretaria o el administrador abren la caja del día con su monto inicial, que puede ser cero. Hay una
  caja por día y una abierta a la vez en cada academia. Si la caja de un día anterior sigue abierta, hay que cerrarla
  antes de abrir la de hoy.
- **Egresos:** siempre en efectivo, con una descripción (de 3 a 200 caracteres), un monto y un comprobante opcional (hasta
  60 caracteres, por ejemplo «Boleta B001-123»). No pueden superar el efectivo esperado: el sistema responde 409
  `EFECTIVO_INSUFICIENTE`. Los movimientos no se editan ni se borran.
- **Cierre:** antes de contar, la caja muestra el esperado por método: efectivo, Yape y transferencia (estos dos no suman
  al efectivo). Al declarar el efectivo contado, la diferencia se ve mientras se escribe, y si no cuadra, la observación es
  obligatoria. El cierre guarda una foto de lo calculado y su resultado: cuadra, sobrante o faltante. Un cierre de una caja
  de un día anterior queda marcado como «tardío».
- **Reapertura:** solo el administrador puede reabrir una caja cerrada, con un motivo de 3 a 200 caracteres. Cada cierre
  queda guardado, también los anteriores a la reapertura. No se puede reabrir si hay otra caja abierta.
- **Ningún movimiento en una caja cerrada ni de otro día:** la aplicación lo comprueba con la fecha de Lima, y la base de
  datos rechaza además cualquier movimiento en una caja que no esté abierta (un trigger).
- **Auditoría:** cada apertura, egreso, cierre y reapertura queda en la auditoría de la academia, con quién, cuándo y qué.
  Todavía no hay pantalla para verla.
- **Web:** `/panel/caja`, con la opción **Caja** del inicio del panel, para el administrador y la secretaria. La reapertura
  solo la ve el administrador.
- **API:** `GET /api/cajas/actual`, `POST /api/cajas`, `POST /api/cajas/{id}/egresos`, `POST /api/cajas/{id}/cierre` y
  `POST /api/cajas/{id}/reapertura`. Esta última usa el permiso nuevo `REABRIR_CAJA`, que solo tiene el administrador.
- **Interfaz para los cobros:** `registrarIngresoEnCaja`, `registrarEgresoEnCaja` y `leerCajaAbierta` (en
  `backend/src/modulos/caja/`) son la forma en que la 007, la 016 y la 019 registran dinero en la caja. Los cobros en efectivo ya la usan
  desde la 007a; los de Yape y transferencia llegaron con la 007b. Sus reglas están en [`docs/arquitectura.md`](docs/arquitectura.md).
- **Datos de ejemplo:** `delfines` tiene una caja cerrada del 2 de noviembre de 2026, con un egreso de S/ 15.50 y un
  sobrante de S/ 0.50. `/panel/caja` solo muestra la caja de hoy, así que esa se ve en el historial (`/panel/cajas`, desde
  la 006b). `tiburones` queda sin cajas.
- **Sin paquetes ni variables nuevas.** La migración es `20261122120000_caja`.
- **Lo que todavía no trae:** los cobros de la 010 y la 016, y el egreso desde caja de los
  entrenadores (019). Las verificaciones de Yape y transferencia llegaron con la 007b. El historial y el PDF llegaron con la 006b.
- **Cómo probarla en tu PC:** con `npm run dev` encendido, entra como la secretaria y pulsa **Caja**. El paso a paso está
  en la guía, en «Probar la caja del día».

**006b · Historial y PDF del cierre** está construida, encima de la 006a, y unida a `main`. Trae:

- **Historial:** `/panel/cajas`, con la opción **Historial de caja** del inicio del panel, para el administrador y la
  secretaria. Lista las cajas entre dos fechas. Sin fechas, muestra los últimos 31 días hasta hoy, en la hora de Lima;
  el rango puede ser de como mucho 366 días. Cada caja muestra su estado, quién la abrió, los ingresos por método, los
  egresos y el último cierre (lo declarado, la diferencia y si fue tardío).
- **Alcance:** el administrador ve todas las cajas de la academia. La secretaria ve las que abrió, las que cerró alguna
  vez, la que está abierta y la de hoy. Lo que no le corresponde no aparece en la lista, y un enlace directo responde
  como si la caja no existiera.
- **Detalle:** `/panel/cajas/:id` muestra la caja con sus movimientos y todos sus cierres, cada uno con su reapertura si la
  tuvo. Es de solo lectura. El administrador puede reabrir desde aquí una caja cerrada, con un motivo.
- **PDF del cierre:** un botón **Descargar PDF** por cada cierre. El PDF (A4) trae la academia, la fecha de la caja, los
  movimientos hasta el cierre, los totales, el esperado, lo declarado, la diferencia, la observación y quién cerró. Se
  arma al pedirlo y no se guarda en ningún lado. Solo muestra caracteres latinos: lo demás sale como `?` en el PDF, aunque
  en la pantalla se vea bien.
- **Límites de descarga:** la API arma pocos PDF a la vez (2, con 8 en espera), y cada persona y cada academia tienen un
  cupo chico. Si aparece «Hay muchas descargas de PDF en curso», espera unos segundos y vuelve a pulsar.
- **Dependencia nueva:** `pdfkit` (y `@types/pdfkit` en desarrollo). No hay migración ni variables nuevas, y la semilla no
  cambia.
- **Lo que todavía no trae:** los cobros de la 010 y la 016, el egreso desde caja de los
  entrenadores (019) y la facturación SUNAT (último módulo). Los reportes exportables y el dashboard son de la Fase 3. Las verificaciones de Yape y transferencia llegaron con la 007b.
- **Cómo probarlo en tu PC:** con `npm run dev` encendido, entra como el administrador o la secretaria y pulsa **Historial
  de caja**. El paso a paso está en la guía, en «Probar el historial y el PDF del cierre».

La historia 006 (la 006a y la 006b) está en [`specs/006-caja/`](specs/006-caja/spec.md). Su estado está en
[`specs/backlog.md`](specs/backlog.md).

**007a · Cobro en recepción y cuenta del alumno** está construida. Falta la verificación final (la suite completa, el lint, los tipos y la integración continua en Windows) y el PR para unirse a `main`. Trae:

- **Cobro en efectivo** en `/panel/solicitudes`, con el botón **Cobrar en efectivo**, para el administrador y la secretaria. Exige la caja de hoy abierta: sin ella, la web dice «Abre la caja antes de cobrar» y la API responde 409 `SIN_CAJA_ABIERTA`. El cobro confirma el pago, registra su ingreso en la caja (suma al efectivo esperado), deja al alumno como `ALUMNO_ACTIVO` con su cuenta y la matrícula `VIGENTE`, todo en una sola transacción. Un doble clic no cobra dos veces.
- **Cuenta del alumno:** su usuario y su contraseña inicial son su DNI, y el sistema le pide cambiar la contraseña al entrar. Si el DNI ya es de alguien del personal de la academia, el cobro responde 409 `DNI_DEL_PERSONAL` y no escribe nada.
- **Total a cobrar:** sale de lo guardado en la matrícula, redondeado hacia arriba al sol entero una sola vez. Si el monto cambió mientras la persona cobra, la API responde 409 `MONTO_CAMBIO` y la web muestra el total nuevo.
- **Ajuste del monto** (solo el administrador, con **Ajustar monto**): un monto entero de soles y un motivo. Solo se ajusta antes de cobrar, y queda en la auditoría de la academia.
- **Ticket interno** en `/panel/pagos/{id}/ticket`, para imprimir en papel de 80 mm o A4: número correlativo por academia, sin DNI y con la leyenda «Comprobante interno de pago. No es un comprobante electrónico SUNAT».
- **Seguimiento:** la solicitud confirmada aparece como **Pago confirmado**, con el método, la fecha, el número de ticket y el enlace para ingresar con el DNI. En el panel, el filtro **Confirmadas** la lista.
- **Recepción sin los límites por conexión:** las peticiones con la sesión de la secretaria o del administrador no cuentan en los límites por conexión de la inscripción ni en el de cinco reservas sin pagar. Cada solicitud que inscribe recepción queda registrada con el usuario que la inscribió.
- **Tabla de pagos en la base:** un pago confirmado no se guarda sin su movimiento de caja, y un pago resuelto no cambia. La base ya admite Yape y transferencia; su flujo llegó con la 007b.
- **Correo de pago confirmado** después de confirmar, al alumno y, si es menor, a su apoderado. En desarrollo el correo es simulado.
- **Auditoría:** el cobro, el ajuste y las inscripciones de recepción quedan auditados. Los ids de la auditoría de la academia siguen el orden del instante en que se registraron.
- **Datos de ejemplo:** `delfines` tiene un ajuste de monto de ejemplo en la solicitud `AQ-SM0001`. Los datos de ejemplo no se auditan.
- **Lo que todavía no trae:** el carnet (008); las renovaciones y las mensualidades (010). La facturación SUNAT es el último módulo.
- **Cómo probarlo en tu PC:** con `npm run dev` encendido, entra como la secretaria, abre la caja y pulsa **Solicitudes de inscripción**. El paso a paso está en la guía, en «Probar el cobro en efectivo, el ajuste y el ticket».

**007b · Yape y transferencia** está construida y pasó la suite completa, el E2E, el lint, el formato, los tipos y el build. Falta el PR para unirse a `main` y que pase la integración continua en Windows. Trae:

- **Pagar desde el seguimiento:** cuando la solicitud está en **Pendiente de pago** o en **Pago rechazado**, el enlace de seguimiento muestra **Pagar con Yape o transferencia**, con los datos de pago de la academia y el formulario del comprobante: método, número de operación, monto (igual al total a pagar), fecha de la operación y una imagen JPG o PNG de hasta 5 MB. La consulta con código y DNI solo muestra el estado: el formulario está en el enlace de seguimiento que da la inscripción.
- **Número de operación sin duplicados:** un número ya usado en un pago abierto del mismo método no se acepta otra vez, aunque se escriba con espacios, con ceros al inicio o en minúsculas. La web dice «Ese número de operación ya se registró».
- **Comprobante en revisión:** mientras la academia lo revisa, el seguimiento dice **Comprobante en revisión** y el cupo sigue reservado, sin fecha de vencimiento.
- **Bandeja «Pagos por verificar»** (`/panel/pagos`, para el administrador y la secretaria): los comprobantes pendientes, del más antiguo al más nuevo, con **Ver comprobante**, **Aprobar** y **Rechazar**. Aprobar exige la caja de hoy abierta («Abre la caja antes de aprobar el pago»); confirma el pago, crea la cuenta del alumno si es nuevo, registra el ingreso como Yape o transferencia (no suma al efectivo) y ofrece **Imprimir ticket**. Rechazar pide un motivo de 3 a 200 caracteres, que ve el cliente en su seguimiento y en su correo; libera el cupo y no necesita caja.
- **Datos de pago** en **Configuración** (grupo **Datos de pago**): número y titular del Yape; banco, número de cuenta, CCI y titular de la transferencia. Los que quedan vacíos no se muestran al cliente.
- **Correos:** el de pago rechazado va al alumno y, si es menor, a su apoderado, después de rechazar. En desarrollo el correo es simulado.
- **Datos de ejemplo:** `delfines` tiene un Yape pendiente de verificación para la solicitud `AQ-SM0003` (DNI `20000003`), con un comprobante de ejemplo, y datos de pago de ejemplo.
- **Lo que todavía no trae:** la web no ofrece cancelar ni ajustar una solicitud con pago rechazado, aunque la API lo permite; el carnet (008); las renovaciones y las mensualidades (010).
- **Cómo probarlo en tu PC:** con `npm run dev` encendido, el paso a paso está en la guía, en «Probar el pago con Yape o transferencia».

La historia 007 (la 007a y la 007b) está en [`specs/007-pagos/`](specs/007-pagos/spec.md). Su estado está en
[`specs/backlog.md`](specs/backlog.md).

**008a · Carnet digital y QR** está construida y pasó la suite completa, el E2E, el lint, los tipos, el build y las pruebas protegidas. Falta el PR para unirse a `main` y que pase la integración continua en Windows. Trae:

- **Mi carnet** (`/panel/mi-carnet`, para el alumno): su carnet con la academia, la foto o «Foto pendiente», el nombre, el DNI, el nivel, el plan, el horario, la vigencia y el QR, grande para mostrarlo en la entrada de la piscina. Es de solo lectura, y lo ve también con la matrícula vencida. **Descargar PDF** baja el carnet para imprimirlo.
- **Alumnos y carnets** (`/panel/alumnos`, para el administrador y la secretaria): busca al alumno por su DNI completo (8 dígitos) o por al menos 3 letras de su nombre o apellido, y muestra hasta 20 resultados, con «Foto pendiente» o «Con foto». Cada tarjeta lleva a su carnet (`/panel/alumnos/{id}`), con **Descargar PDF** y **Regenerar QR**.
- **PDF del carnet** (`carnet.pdf`): una hoja A4 con la tarjeta de 85,6 × 54 mm, lista para recortar, y debajo «Datos al» con la fecha. Lleva el DNI completo y el mismo QR de la pantalla. No se guarda: se arma al descargarlo.
- **El QR nace al pagar:** cuando un cliente pasa a alumno (cobro en efectivo, o aprobación de Yape o transferencia), recibe su QR, con 43 caracteres al azar y sin datos de la persona. El contenido del QR es `AQ1:` más ese token. Un cliente sin pago confirmado no tiene QR, y la base no lo acepta.
- **Regenerar QR** (solo el administrador y la secretaria): pide un motivo de 3 a 200 caracteres. El QR anterior deja de valer en la misma operación, y un doble clic no genera dos QR nuevos. La regeneración queda en la auditoría de la academia.
- **Foto pendiente:** un alumno sin foto muestra «Foto pendiente» en la búsqueda y en el carnet. La foto que se subió en la inscripción aparece en el carnet cuando la inscripción está confirmada.
- **Lo que todavía no trae:** agregar o cambiar la foto desde el panel y con la cámara (008b), la lectura del QR en la entrada (009) y la asistencia del alumno en su panel (011). La web del carnet todavía no tiene pruebas E2E (deuda en `specs/backlog.md`).
- **Datos de ejemplo:** la semilla no cambia. El carnet aparece cuando se confirma una solicitud de ejemplo: `AQ-SM0001` (cobro en efectivo) o `AQ-SM0003` (aprobación de su Yape).
- **Cómo probarlo en tu PC:** con `npm run dev` encendido, el paso a paso está en la guía, en «Probar el carnet y el QR».

**008b · Foto desde el panel y cámara** está construida y pasó las pruebas protegidas, el E2E, el lint, los tipos y el build. La suite completa la corre la integración continua del PR, que falta para unirse a `main`. Trae:

- **Foto desde el carnet** (`/panel/alumnos/{id}`, para el administrador y la secretaria): el botón dice **Agregar foto** si el alumno no tiene foto, y **Cambiar foto** si ya tiene una. El diálogo ofrece **Elegir un archivo** (un JPG o un PNG, con su vista previa; si pesa más de 5 MB, la página lo avisa antes de subirlo) o **Usar la cámara**. Con la cámara, **Tomar foto** la congela, **Volver a tomar** la descarta y **Usar esta foto** la guarda.
- **Foto desde una solicitud** (`/panel/solicitudes`): en las tarjetas activas y confirmadas, **Agregar foto** abre el mismo diálogo. Las vencidas y las canceladas no tienen el botón. Por ahora, el botón dice «Agregar foto» aunque la solicitud ya tenga foto (deuda de la 008b).
- **La cámara** necesita el permiso del navegador y un contexto seguro: `localhost` o HTTPS. Al cerrar el diálogo, al cambiar de opción o al salir de la página, la cámara se apaga. Sin permiso o sin cámara, la web dice «No se pudo usar la cámara. Revisa el permiso del navegador o elige un archivo.»
- **Lo que se guarda:** la foto se recodifica como JPEG sin metadatos (EXIF, GPS, XMP y los demás) y se guarda en la carpeta de la academia dentro de `ALMACEN_DIRECTORIO`; la foto anterior se borra después de confirmar. Cada cambio queda en la auditoría de la academia, con quién lo hizo, cuándo y si fue desde el carnet o desde la solicitud.
- **Lo que todavía no trae:** la lectura del QR en la entrada (009) y la asistencia del alumno en su panel (011). Las deudas de la 008b (dos medias, que se resuelven antes de producción; dos bajas, y los menores de la revisión) están en `specs/backlog.md`.
- **Cómo probarlo en tu PC:** con `npm run dev` encendido, el paso a paso está en la guía, en «Probar la foto desde el panel».

La historia 008 (la 008a y la 008b) está en [`specs/008-carnet-qr/`](specs/008-carnet-qr/spec.md). Su estado está en
[`specs/backlog.md`](specs/backlog.md).

**009a · Asistencia por QR y manual** está unida a `main` (PR #18, 26/11/2026). Pasó las pruebas protegidas, el ataque adversarial (una ronda, sin fallas críticas ni altas), la suite completa, el E2E, el lint, el formato, los tipos y el build. Trae:

- **Marcar la asistencia** en `/panel/asistencia`, con la opción **Asistencia** del inicio del panel, para el administrador y la secretaria. **Escanear** lee el QR del carnet con la lectora USB (el campo **Lectora de QR**, que se vacía en cada lectura) o con **Usar la cámara**. **Buscar alumno** busca por DNI o nombre y, en cada resultado, ofrece **Registrar asistencia**.
- **El resultado** ocupa la pantalla. En verde, **Asistencia registrada**, con la foto (o «Foto pendiente»), el nombre, el nivel, la clase de hoy, **Puntual** o **Tarde**, «Llegó a las HH:MM» y «Le quedan X de Y». En rojo, **No puede ingresar** y el motivo, como «No tiene una mensualidad vigente.». En amarillo, **Atención**, con el motivo y el detalle, como «Su clase empieza a las 18:00.» o «Marcó a las 18:05 (Puntual, con el QR).».
- **Las reglas:** la asistencia solo se marca mientras dura la clase del alumno, desde su hora de inicio (incluida) hasta la de fin (excluida), en la hora de Lima. Una por día. Es puntual hasta la tolerancia de la academia (10 minutos por defecto) y tarde después. Cada asistencia descuenta una clase de la mensualidad. Sin mensualidad vigente, sin clases restantes, con el alumno inactivo o con el pago en verificación, no se registra.
- **El QR:** un QR de otra academia, inventado o regenerado responde siempre igual: «El QR no corresponde a ningún alumno de esta academia.».
- **Sin duplicados:** un doble clic o un reintento con la misma clave no registra dos veces. `POST /api/asistencias/qr` y `POST /api/asistencias/manual` responden 201, o 200 con `repetida: true`. La web ignora la misma lectura durante 5 segundos.
- **Auditoría:** el marcado normal no se audita: la fila de la asistencia guarda quién, cuándo y cómo. `HEAD` sobre `/api/asistencias` responde 404.
- **Dependencia nueva:** `html5-qrcode` (2.3.8) en la web, que se carga solo al encender la cámara. Migración `20261125190000_asistencias`.
- **Datos de ejemplo:** la semilla no cambia. Para probarla hace falta una clase en curso (ver la guía).
- **Lo que todavía no trae:** las faltas, el registro posterior y la consulta del mes, que son de la 009b (abajo); la asistencia en el panel del alumno (011); las recuperaciones (018), las clases particulares (016) y la asistencia en otro horario (020). Las dos fallas medias de la ronda 1 del ataque (R1-1 y R1-2) las corrige la 009b, y el resto de la deuda está en `specs/backlog.md`.
- **Cómo probarla en tu PC:** con `npm run dev` encendido, entra como la secretaria y pulsa **Asistencia**. El paso a paso está en la guía, en «Probar la asistencia».

**009b · Faltas, registro posterior y consulta del mes** está unida a `main` (PR #19, 26/11/2026). Pasó las pruebas protegidas, el ataque adversarial (una ronda, sin fallas críticas ni altas), la revisión, el E2E, el lint, los tipos y el build. La suite completa la corre la integración continua del PR sobre la versión final, porque la última corrida local compartió la base con otra. Trae:

- **Faltas.** Al terminar cada clase, el sistema registra la falta de quien no vino, sin descontar clases. Lo hace una tarea programada cada 5 minutos y al encender la API, para las clases de ayer y de hoy, en la hora de Lima. No hay falta si el alumno marcó ese día, si ya no tenía clases o estaba inactivo, o si se inscribió o pagó después de que empezó la clase.
- **Asistencia del mes** (`/panel/alumnos/{id}`, sección **Asistencia**, para el administrador y la secretaria): el mes en curso o el anterior, en **Mes**. Cada día de clase aparece con **Puntual**, **Tarde** o **Falta**, la clase («Clase de 18:00 a 19:00») y la hora de llegada («Llegó a las 18:05», con «· Manual» si se marcó buscando al alumno o «· Posterior» si se registró después). Arriba están los totales: **Puntual**, **Tarde**, **Faltas** y **Clases restantes**.
- **Registrar asistencia posterior** (solo en el mes en curso): el botón abre el diálogo con **Día de la clase** (las faltas del mes, o **Otro día de este mes** con la **Fecha de la clase**), la **Hora de llegada**, dentro de la clase, y el **Motivo**, de 3 a 200 caracteres, que queda en la auditoría. Descuenta una clase y, si había falta, la cubre. Al registrar, dice «Se registró la asistencia del 27/11/2026 a las 18:05 (Puntual).». Un doble clic no registra dos veces.
- **Rechazos.** La API decide, y el diálogo muestra su motivo debajo del campo que falla, o arriba si no es de un campo: «La fecha debe ser de este mes y no puede ser posterior a hoy.», «La clase todavía no terminó: durante la clase se marca con el QR o de forma manual.», «La hora de llegada debe estar dentro de la clase.» o «El alumno ya tiene su asistencia registrada ese día.».
- **Consulta del mes:** `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM`, para el personal de recepción. No trae DNI ni motivos. El entrenador y el alumno reciben 403 por ahora.
- **Dependencias y migraciones:** `@nestjs/schedule` en la API. Migraciones `20261126120000_inasistencias` y `20261126130000_inasistencias_unico_id`. La variable `TAREAS_PROGRAMADAS` (`activas` por defecto; `inactivas` apaga las tareas programadas, la de faltas y, desde la 010b, la del cierre de mes, como en las pruebas).
- **Lo que todavía no trae:** la asistencia en el panel del alumno y del apoderado (011), la del entrenador (012), las recuperaciones (018), la asistencia en otro horario (020) y el día de cierre (017). La deuda de la 009b, con F1 a resolver antes de correr varias instancias, está en `specs/backlog.md`.
- **Cómo probarla en tu PC:** con `npm run dev` encendido, entra como la secretaria, abre un alumno en **Alumnos y carnets** y baja a la sección **Asistencia**. El paso a paso está en la guía, en «Probar la asistencia».

La historia 009 (la 009a y la 009b, unidas a `main`) está en [`specs/009-asistencia/`](specs/009-asistencia/spec.md). Su estado está en
[`specs/backlog.md`](specs/backlog.md).

**010a · Renovación con prioridad** está construida y unida a `main` (26/11/2026, PR #20). Pasó las pruebas protegidas, dos rondas del ataque adversarial (sin fallas críticas ni altas abiertas), la revisión, el E2E, el lint, los tipos y el build. La suite completa, que el tester corrió sobre `8f80c9a`, tuvo una sola falla intermitente por la carga de una prueba (está en la deuda); la integración continua del PR la corre sobre la versión final. Trae:

- **La mensualidad del alumno** (`/panel/alumnos/{id}`, sección **Mensualidad**, para el administrador y la secretaria): el estado del alumno, la mensualidad del mes en curso con su plan y sus clases, y **Renovación**, con los meses que se pueden renovar. Si no hay ninguno, dice «No hay meses por renovar: el alumno ya tiene su mensualidad registrada, pagada o por verificar.».
- **La ventana de prioridad.** En los últimos días del mes (5 por defecto; la configuración de la academia la cambia de 1 a 15), la sección dice, por ejemplo, «La renovación del mes siguiente está abierta del 26/11/2026 al 30/11/2026: el lugar de cada alumno vigente queda apartado para él hasta el día 1.». Quien tiene su mensualidad del mes en curso pagada conserva su lugar en sus clases para el mes siguiente, y el diálogo marca esas clases con **Su horario**. Si una clase no tiene lugar, dice **Llena**.
- **Renovar** (el botón **Renovar**): el diálogo **Renovar la mensualidad** elige el **Mes a renovar**, el plan y las clases, y muestra el monto proporcional. Con **Método de pago** en **Efectivo**, el botón **Cobrar** registra la renovación en la caja abierta de hoy, y «Renovación registrada» ofrece **Imprimir ticket**. Sin caja de hoy abierta, dice «Abre la caja antes de cobrar.». Con **Yape** o **Transferencia bancaria**, recepción sube la foto del comprobante, escribe el **Número de operación**, la **Fecha de la operación** y el **Monto pagado (S/)**, y pulsa **Enviar a verificación**: la renovación queda pendiente hasta que se apruebe.
- **La bandeja** (**Pagos por verificar**): la renovación aparece como «Renovación de diciembre de 2026», sin código de solicitud. Al aprobarla, queda vigente y su ingreso entra a la caja de hoy; al rechazarla, queda cancelada, se libera el cupo y se puede registrar otra renovación del mismo mes. En los dos casos, el alumno recibe un correo, y su apoderado también si es menor de edad, sin credenciales.
- **Reglas de la renovación:** el aforo nunca se pasa, aunque dos personas tomen el último lugar a la vez. Un número de operación no se repite, aunque se escriba con espacios, ceros o mayúsculas distintas. Un alumno inactivo no renueva, y un alumno vencido que paga la mensualidad del mes en curso vuelve a estar activo.
- **Migración:** `20261126140000_renovaciones`, un `CHECK` que impide que una renovación lleve vencimiento de reserva. No hay dependencias ni variables nuevas.
- **Lo que todavía no trae:** el listado de estados y el cierre de mes (010b), el cambio de horario (010c), la inscripción pública al mes siguiente (010d) y los ajustes de monto (015). La deuda de la 010a (menores de la revisión y la prueba intermitente) está en `specs/backlog.md`.
- **Cómo probarla en tu PC:** con `npm run dev` encendido, entra como la secretaria, abre un alumno en **Alumnos y carnets** y baja a **Mensualidad**. El paso a paso está en la guía, en «Probar la renovación de la mensualidad».

**010b · Estados de la mensualidad y cierre de mes** está unida a `main` (PR #21, 27/11/2026). Pasó las pruebas protegidas, una ronda del ataque adversarial (sin fallas críticas ni altas abiertas), la revisión y la suite completa (18530 pasan y 0 fallan). Trae:

- **El estado de cada mensualidad** en la ficha del alumno (sección **Mensualidad**): **Al día**, **Por vencer**, **Pendiente de verificación** o **Vencido**, según las mensualidades pagadas o en verificación.
- **El listado de mensualidades** (`/panel/mensualidades`, para el administrador y la secretaria): filtros por mes, estado, plan, nivel y horario, y totales por estado. Muestra como mucho 500 filas; si hay más, lo avisa.
- **El cierre de mes:** cada 15 minutos, las matrículas `VIGENTE` de un mes anterior pasan a `FINALIZADA`, y los alumnos sin mensualidad vigente del mes en curso pasan a `ALUMNO_VENCIDO`. Cada academia se cierra por su cuenta. No se audita, porque no hay un actor que lo haga; `TAREAS_PROGRAMADAS=inactivas` lo apaga, como las demás tareas programadas.
- **Sin migraciones ni variables nuevas.**
- **Lo que todavía no trae:** nada de la 010b. La deuda de la 010b está en `specs/backlog.md`, en la nota de la 010.

**010c · Cambio de horario** está unida a `main` (PR #22, 27/11/2026). Pasó las pruebas protegidas, una ronda del ataque adversarial (sin fallas críticas ni altas abiertas), la revisión y la suite completa (18817 pasan, 0 fallan y 95 se saltan; el E2E, 6 de 6). Trae:

- **Cambiar horario** (en **Alumnos y carnets**, en la sección **Mensualidad** de cada mensualidad, para el administrador y la secretaria): el diálogo **Cambiar horario** elige las clases del plan de esa mensualidad, pide un motivo de 3 a 200 caracteres y avisa si con el nuevo horario quedan menos clases de las que le faltan por usar. El cambio no cobra nada: el monto y las clases ya usadas no cambian.
- **Las reglas del cambio:** solo la mensualidad del mes en curso o del siguiente, vigente o en verificación. Cada clase nueva necesita cupo, y el aforo nunca se pasa. Desde el cambio, la asistencia y las faltas siguen el horario nuevo: una clase agregada cuenta solo desde ese momento, y una quitada ya no se marca ni genera faltas. Cada cambio queda en la auditoría, con su motivo.
- **Migraciones:** `20261127190000_cambio_horario` y `20261127200000_trigger_matricula_clases_bloqueo`. Un trigger impide cambiar las clases de una matrícula cerrada, también para el dueño de la base de datos. No hay dependencias ni variables nuevas.
- **Lo que todavía no trae:** nada de lo que prometía la 010c. La inscripción pública al mes siguiente es de la 010d (abajo). La deuda de la 010c está en `specs/backlog.md`, en la nota de la 010.
- **Cómo probarlo en tu PC:** con `npm run dev` encendido, abre un alumno con su mensualidad en **Alumnos y carnets** y pulsa **Cambiar horario** en la sección **Mensualidad**. El paso a paso está en la guía, en «Probar el cambio de horario».

**010d · Inscripción pública al mes siguiente** está unida a `main` (28/11/2026, PR #23). Pasó las pruebas protegidas, una ronda del ataque adversarial (sin fallas de ninguna severidad), la revisión (seis menores corregidos) y la suite completa (19 223 pasan, 0 fallan y 95 se saltan; el E2E, 6 de 6). Trae:

- **El mes siguiente en el formulario público** (`/a/{nombreCorto}/inscripcion`, y **Nueva inscripción** de recepción): durante la ventana de renovación, el primer paso **¿Desde cuándo?** ofrece **Este mes, desde hoy** o el mes siguiente completo, desde el día 1. Fuera de la ventana, el formulario es el de siempre.
- **Solo los lugares libres:** quien se inscribe para el mes siguiente toma los lugares que no están apartados para los alumnos que renuevan. El aforo nunca se pasa, aunque varias personas pidan el último lugar a la vez.
- **Reserva y pago:** el cupo queda reservado 24 horas, también si la reserva cruza el día 1. Al aprobar el pago, la persona pasa a alumno de inmediato, con la mensualidad del mes siguiente, que empieza el día 1. Un pago rechazado deja la solicitud en **Pago rechazado** y permite subir otro comprobante, si todavía hay lugar.
- **El mes en el seguimiento, en las solicitudes y en la bandeja:** «Diciembre de 2026, desde el 1/12», cuando el mes todavía no empieza.
- **El cierre de mes** no vence a quien ya pagó el mes siguiente.
- **Sin migraciones, paquetes ni variables nuevas.**
- **Lo que todavía no trae:** nada de la 010. La deuda de la 010d está en `specs/backlog.md`, en la nota de la 010.
- **Cómo probarla en tu PC:** con `npm run dev` encendido, abre http://localhost:5173/a/delfines/inscripcion en los últimos días del mes, o cambia **Días de prioridad para renovar** en **Configuración**. El paso a paso está en la guía, en «Probar la inscripción al mes siguiente». Todavía no está probada en la PC de Windows de Bryan.

La historia 010 (la 010a, la 010b y la 010c, unidas a `main`; y la 010d en [`specs/010d-inscripcion-mes-siguiente/`](specs/010d-inscripcion-mes-siguiente/spec.md), todas unidas a `main`) está en [`specs/010-mensualidades/`](specs/010-mensualidades/spec.md). Su estado está en [`specs/backlog.md`](specs/backlog.md).

## Cómo levantarlo en Windows

La guía paso a paso, escrita para quien no es experto, está en
[`docs/guia-local-windows.md`](docs/guia-local-windows.md).

Requisitos: Git para Windows, Node.js 22 (22.22.3 o más reciente de la rama 22) y Docker Desktop. En PowerShell, dentro
de la carpeta del proyecto:

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d
npm run db:preparar
npm run dev
```

`Copy-Item` y `npm run db:preparar` solo hacen falta la primera vez. Luego abre http://localhost:5173: debe aparecer
**Sistema en línea**.

Si ya tenías el proyecto antes de la historia 001, no vuelvas a copiar `.env.example`: ejecuta `npm ci` y
`npm run env:completar` (agrega las variables nuevas a tu `.env`), y después `npm run db:preparar`. Los pasos completos
están en la guía, en "Después de traer la historia 001".

Si ya tenías la historia 001 y traes la 002, ejecuta `npm ci` y `npm run db:preparar` (aplica las migraciones nuevas y
agrega los usuarios de ejemplo). Los pasos están en la guía, en "Después de traer la historia 002".

Si ya tenías la historia 002 y traes la 003, ejecuta `npm ci` y `npm run db:preparar`: la 003 no tiene migraciones, y la
semilla agrega el teléfono de ejemplo de `delfines`. Los pasos están en la guía, en "Después de traer la historia 003".

Si ya tenías la historia 003 y traes la 004, ejecuta `npm ci` y `npm run db:preparar`: la 004 agrega las tablas de planes y
clases (con sus migraciones), y la semilla suma a `delfines` un segundo entrenador, dos planes y cinco clases de ejemplo.
Los pasos están en la guía, en "Después de traer la historia 004".

Si ya tenías la historia 004 y traes la 005a, ejecuta `npm ci` y `npm run db:preparar`: la 005a agrega las tablas de la inscripción, con sus dos migraciones, y la semilla suma las clases y los clientes de ejemplo. Si `npm run db:preparar` se detiene en «Migrando la base de desarrollo» con el código 23514, tu base es de una versión anterior de esta rama y hay que empezar de cero. Los pasos están en la guía, en "Después de traer la historia 005a".

Si ya tenías la historia 005a y traes la 005b, ejecuta `npm ci`: la 005b agrega `sharp`, que recodifica las fotos, y no tiene
migraciones. Los pasos están en la guía, en "Después de traer la historia 005b".

Si ya tenías la historia 005b y traes la 006a, ejecuta `npm run db:preparar`: la 006a agrega las tablas de la caja, con su
migración, y la semilla suma la caja cerrada de ejemplo de `delfines`. No hay paquetes ni variables nuevas, así que `npm ci`
no hace falta. Los pasos están en la guía, en "Después de traer la historia 006a".

Si ya tenías la historia 006a y traes la 006b, ejecuta `npm ci`: la 006b agrega `pdfkit`, que arma el PDF del cierre. No tiene
migraciones ni variables nuevas, y la semilla no cambia. Los pasos están en la guía, en "Después de traer la historia 006b".

Si ya tenías la historia 006b y traes la 007a, ejecuta `npm run db:preparar`: la 007a agrega la tabla de pagos con sus tres migraciones, y la semilla suma un ajuste de monto de ejemplo en `delfines`. No hay paquetes ni variables nuevas, así que `npm ci` no hace falta. Los pasos están en la guía, en "Después de traer la historia 007a".

Si ya tenías la historia 007a y traes la 007b, ejecuta `npm run db:preparar`: la 007b no tiene migraciones, paquetes ni variables nuevos, y la semilla agrega a `delfines` un Yape pendiente de verificación de ejemplo, sus datos de pago y su comprobante de ejemplo, que se guarda en `ALMACEN_DIRECTORIO`. `npm ci` no hace falta. Los pasos están en la guía, en "Después de traer la historia 007b".

Si ya tenías la historia 007b y traes la 008a, ejecuta `npm ci` y `npm run db:preparar`: la 008a agrega a `alumnos` las columnas del token del QR, con su migración (que da un QR a los alumnos que ya existían), y la dependencia `qrcode`, que `npm ci` instala. La semilla no cambia. Los pasos están en la guía, en "Después de traer la historia 008a".

Si ya tenías la historia 008a y traes la 008b, `git pull` y `npm run dev` bastan: la 008b no tiene migraciones, paquetes ni variables nuevos, y la semilla no cambia. Los pasos están en la guía, en "Después de traer la historia 008b".

## Comandos principales

| Comando                                                                 | Qué hace                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                           | Enciende la API (puerto 3000), la web (puerto 5173) y la compilación de los contratos.                            |
| `npm run build`                                                         | Compila contratos, API y web, en ese orden.                                                                       |
| `npm test`                                                              | Todas las pruebas, incluidas las de integración con PostgreSQL.                                                   |
| `npm run test:unit`                                                     | Las pruebas que no necesitan base de datos.                                                                       |
| `npm run e2e`                                                           | Pruebas E2E con Chromium (la primera vez, `npx playwright install chromium`).                                     |
| `npm run lint`, `npm run typecheck`, `npm run format:check`            | ESLint, tipos de TypeScript y formato con Prettier.                                                               |
| `npm run db:preparar`                                                   | Crea el rol `aquagestion_app` y las bases de desarrollo y de pruebas que falten, aplica las migraciones y la semilla. |
| `npm run db:crear`                                                      | Crea solo el rol `aquagestion_app` y las bases que falten (lo usa `db:preparar`).                                 |
| `npm run db:migrar`, `npm run db:migrar:pruebas`                        | Aplica las migraciones pendientes a la base de desarrollo o a la de pruebas.                                      |
| `npm run db:migracion`                                                  | Crea una migración nueva a partir de un cambio en el esquema de Prisma.                                           |
| `npm run db:semilla`                                                    | Crea las academias de ejemplo, el superadmin de desarrollo, los usuarios de ejemplo, el teléfono de ejemplo de `delfines`, sus planes, clases y clientes con solicitud (con un ajuste de monto de ejemplo), su caja cerrada de ejemplo, un Yape pendiente de verificación y los datos de pago de ejemplo, si no existen.              |
| `npm run env:completar`                                                 | Agrega a `.env` las variables de `.env.example` que falten, sin cambiar las que ya tienes.                        |
| `npm run plataforma:superadmin`                                         | Crea el superadmin de la plataforma o le restablece la clave, con `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y `SUPERADMIN_CLAVE`. |
| `npm run verificar:pruebas-protegidas`, `npm run verificar:sin-secretos` | Verificaciones del método y de seguridad del repositorio.                                                         |

## Cómo funciona

- **Un solo dominio:** la web está en `/` y la API en `/api` (D-25). En desarrollo, Vite reenvía `/api` a la API.
- **Configuración en `.env`:** es una copia de `.env.example`, con valores de desarrollo inventados. No se sube al
  repositorio (D-21).
- **Dos conexiones a la base:** la API se conecta con `DATABASE_URL_APP`, que es el rol `aquagestion_app` y está sujeto
  a la seguridad por academia. Las migraciones, la semilla y los comandos usan `DATABASE_URL`, que es el dueño de las
  tablas.
- **Sesión y datos personales:** la sesión de las academias va en la cookie `aq_sesion`, y la API vuelve a leer en cada
  petición, desde la base, el rol, el estado y el cambio de contraseña pendiente. El DNI se busca con `POST` y nunca va en
  la dirección ni en el registro técnico (002).
- **Mismo sistema en dos lugares:** en la nube, las sesiones de Claude usan un PostgreSQL del contenedor, y un hook
  prepara el entorno al empezar. En la PC del responsable, PostgreSQL corre en Docker (D-18, D-26).
- **Cómo se trabaja:** cada historia tiene su carpeta `specs/NNN-nombre/` (especificación, plan y tareas) y entra al
  proyecto por pull request. Las pruebas protegidas (`// spec: NNN-nombre (pruebas protegidas)`) solo cambian en sus
  propios commits, y la CI lo verifica en cada pull request. Detalles en [`docs/metodologia.md`](docs/metodologia.md).
- **Aforo y choques de clases:** el cupo de cada clase se bloquea con `bloquearClasesParaCupo` antes de contar u escribir, y
  los choques de clases (el mismo entrenador o el mismo nivel en un bloque) los decide la base con índices únicos. Las reglas
  para las historias siguientes están en `docs/arquitectura.md`.
- **Dinero y caja:** los montos son `Decimal` en la base y en el código, y viajan como texto (`"120.00"`). Las
  transacciones de la caja toman primero al usuario que pide, y la caja al final. Las de los cobros (007a) toman antes las
  filas del alumno, la solicitud, la matrícula, los pagos y las clases. Así ningún cobro entra en una caja que se está cerrando. Las reglas están en
  `docs/arquitectura.md`.
- **Pagos y caja:** un pago confirmado tiene siempre su movimiento de caja, y la base no guarda uno sin el otro. La aprobación de un comprobante (007b) toma antes el alumno, la solicitud, la matrícula y el pago, y la caja al final. Los movimientos de caja no se cambian ni se borran, tampoco el dueño de las tablas, salvo con una migración que desactiva su trigger a propósito. Las reglas están en `docs/arquitectura.md`.
- **Archivos:** las fotos y los comprobantes de pago se guardan con `AlmacenArchivos`, en la carpeta de `ALMACEN_DIRECTORIO`, fuera de lo que sirve la web.
  Cada historia que guarda archivos los guarda antes de confirmar la transacción, y borra lo que reemplaza después de confirmar
  (reglas en `docs/arquitectura.md`). Los PDF del cierre de caja (006b) y del carnet (008a) no se guardan: se arman al descargarlos.
- **Varias academias:** cada tabla de negocio lleva `academia_id`, y PostgreSQL filtra por academia con seguridad a nivel
  de fila (D-23). Eso ya está en la 001. Las reglas de fechas, transacciones y errores que siguen las historias nuevas
  están en [`docs/arquitectura.md`](docs/arquitectura.md).

## Estructura

```
piscina/
├── backend/              API en NestJS; backend/prisma/ tiene el esquema y las migraciones
├── frontend/             Web en React, con Vite y Tailwind CSS
├── packages/contratos/   Esquemas zod y tipos que comparten la API y la web
├── e2e/                  Pruebas E2E con Playwright
├── scripts/              Scripts en Node: bases de datos y verificaciones
├── eslint/               Reglas de ESLint del proyecto (uso de RELOJ, acceso a la base y SQL)
├── specs/                Una carpeta por historia, backlog.md y _plantillas/
├── docs/                 Requerimientos, decisiones, metodología, arquitectura y guía de Windows
├── .claude/              Roles de la metodología y hook de sesión para la nube
├── .github/              CI (workflows/ci.yml) y plantilla de pull request
├── .husky/               Hooks de git: pre-commit y commit-msg
├── docker-compose.yml    PostgreSQL 16 para la PC
└── .env.example          Variables de configuración: copiar a .env
```

La arquitectura objetivo (módulos, aislamiento entre academias, archivos y correo) está en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Documentación

- [`docs/Documentacion_Sistema_Academia_Natacion.pdf`](docs/Documentacion_Sistema_Academia_Natacion.pdf): documento de requerimientos v1.4 (fuente de verdad).
- [`docs/requerimientos.md`](docs/requerimientos.md): el mismo contenido en texto, para buscar y consultar rápido.
- [`docs/decisiones.md`](docs/decisiones.md): decisiones tomadas con el cliente y cambios de requerimientos posteriores
  al v1.4. **Cuando contradicen al documento, mandan las decisiones.**
- [`docs/guia-local-windows.md`](docs/guia-local-windows.md): cómo levantar el sistema en Windows, paso a paso, cómo
  entrar a la plataforma, y cómo probar la inscripción pública, la foto, el panel de solicitudes, los planes, las clases, la caja del día, el historial de caja con su PDF, y el cobro en efectivo con su ticket y su ajuste de monto, el pago por Yape o transferencia, el carnet con su QR, la foto desde el panel y con la cámara, y la asistencia con la lectora, la cámara o la búsqueda, la consulta del mes de un alumno y el registro posterior.

## Forma de trabajo

El proyecto se desarrolla con especificación primero (SDD), pruebas primero en la ruta crítica (TDD), pruebas
adversariales y roles separados. Ver [`docs/metodologia.md`](docs/metodologia.md).

- [`CLAUDE.md`](CLAUDE.md): instrucciones del orquestador, ruta crítica, arquitectura y convenciones.
- [`.claude/agents/`](.claude/agents): los roles (especificador, adversarial, backend, frontend, test-writer,
  revisor, tester y documentador).
- [`docs/arquitectura.md`](docs/arquitectura.md): arquitectura, aislamiento entre academias, fechas y horas de Lima, y
  reglas para las historias siguientes.
- [`specs/backlog.md`](specs/backlog.md): la lista ordenada de historias.
- [`specs/`](specs): una carpeta por historia (`spec.md`, `plan.md`, `tasks.md`), a partir de
  `specs/_plantillas/`.

## Stack (ver D-01 y D-10 en `docs/decisiones.md`)

| Capa | Opción |
|---|---|
| Backend | Node.js 22 + TypeScript con NestJS y Prisma |
| Frontend | React + Vite + Tailwind CSS (responsive; la PWA es de la Fase 4) |
| Base de datos | PostgreSQL 16 |
| Archivos | Disco local en desarrollo (`ALMACEN_DIRECTORIO`), detrás de una interfaz `AlmacenArchivos` (desde la 005b); el proveedor se decide con el hosting (D-21) |
| QR, PDF y Excel | `qrcode`, `pdfkit`, `exceljs`; lectura del QR con `html5-qrcode` |
| Tareas | Tareas programadas en el backend (registro de faltas y cierre de mes) |

Las librerías de negocio se agregan con la historia que las usa.

## Fases (ajustadas según `docs/decisiones.md`)

El producto mínimo viable (MVP) incluye las Fases 1 y 2 (D-13).

1. **Operación básica:** usuarios y roles, planes, clases y aforo, inscripción con seguimiento de la solicitud, pagos con
   verificación, carnet QR, asistencia (puntual, tarde, falta), caja, mensualidades, cobro proporcional y panel del
   apoderado con su asistencia.
2. **Gestión académica:** panel del entrenador, rendimiento y nivel por estilo en el panel del apoderado,
   multimedia, clases particulares, descuentos, recuperaciones, días de cierre, pagos a entrenadores y asistencia
   fuera de horario.
3. **Inteligencia del negocio:** reportes exportables, dashboard, asistencia de profesores y auditoría avanzada.
4. **Extras:** PWA, QR dinámico y certificados.
5. **Facturación electrónica SUNAT** (último módulo).

Los "Puntos por aclarar" de la revisión del documento v1.4 y los cambios posteriores quedaron resueltos en
`docs/decisiones.md`, que manda sobre el documento.
