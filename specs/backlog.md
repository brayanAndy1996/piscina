# Lista de historias

Orden de desarrollo aprobado por el responsable (D-30). El MVP incluye las Fases 1 y 2 (D-13). Cada historia se
especifica en `specs/NNN-nombre/` antes de programarla; las notas de esta lista son el punto de partida del
especificador, no la especificación.

Estados: ⬜ pendiente · 🟨 en curso · ✅ unida a `main`.

## Fase 1: operación básica

| N.º | Historia | Ruta crítica | Estado |
| --- | --- | --- | --- |
| 000 | Esqueleto | No | ✅ |
| 001 | Academias y aislamiento | Sí | ✅ |
| 002 | Autenticación y roles por academia | Sí | ✅ |
| 003 | Configuración de la academia | En parte | ✅ |
| 004 | Planes y clases con aforo | En parte | ✅ |
| 005a | Inscripción pública, reserva y seguimiento de la solicitud | Sí | ✅ |
| 005b | Foto de la inscripción y panel de solicitudes | Sí | ✅ |
| 006a | Caja del día: apertura, egresos, cierre y reapertura | Sí | ✅ |
| 006b | Historial y PDF del cierre de caja | Sí | ✅ |
| 007a | Cobro en recepción y cuenta del alumno | Sí | ✅ |
| 007b | Yape y transferencia: comprobante y bandeja de verificación | Sí | ✅ |
| 008a | Carnet digital y QR | En parte | ✅ |
| 008b | Foto desde el panel y cámara | En parte | ✅ |
| 009 | Asistencia y faltas | Sí | 🟨 |
| 010 | Mensualidades y renovación | En parte | ⬜ |
| 011 | Panel del alumno y apoderado: asistencia y nivel | Sí | ⬜ |

### Notas

- **000 · Esqueleto.** Monorepo con npm workspaces (`backend/`, `frontend/`, `packages/contratos/`, `e2e/`,
  `scripts/`) según [`docs/arquitectura.md`](../docs/arquitectura.md). NestJS y React que arrancan, Prisma conectado
  a PostgreSQL, Vitest, ESLint, Prettier, `husky` con `lint-staged`. `docker-compose.yml` con PostgreSQL,
  `.env.example`, `.gitattributes`, `.nvmrc` (Node 22). `.claude/hooks/preparar-sesion.mjs` para la nube (D-26).
  GitHub Actions en Linux con PostgreSQL real y en Windows. Script `scripts/verificar-pruebas-protegidas.mjs` en la
  integración continua: falla si un commit que no es de pruebas protegidas modifica un archivo marcado como tal.
  Guía para levantar el sistema en Windows (`docs/guia-local-windows.md`). Sin tablas de negocio (D-17).
- **001 · Academias y aislamiento.** Tabla de academias con nombre corto (D-27), `academia_id` y RLS, cliente de
  Prisma que fija la academia en cada transacción, Superadmin que crea, suspende y reactiva academias
  (D-23, D-29). Tablas transversales: auditoría y configuración por academia. El primer administrador de cada academia
  no es de 001: lo crea 002 (DR-1).
- **002 · Autenticación y roles.** Inicio de sesión por academia (`/a/{academia}/ingresar`), roles Admin,
  Secretaria, Entrenador y Alumno, DNI único por academia (D-28), contraseña inicial igual al DNI con cambio
  obligatorio, bloqueo por intentos, restablecimiento por la secretaria, matriz de permisos (RN-02, RN-03, HU-05,
  RNF-03, RNF-04). Incluye el primer administrador de cada academia, con sus usuarios y su inicio de sesión (DR-1; la
  001 no lo crea).
  - Estado: ✅ unida a `main` (17/11/2026), con la revisión (T18) y la suite completa, con lint y tipos (T19), hechas.
  - Hosting (D-21), cuando se elija: volver a medir los tiempos del criterio 53 en el hosting real y en Docker Desktop en
    Windows, con 300 rondas pareadas entre un DNI con cuenta y uno sin cuenta, y los umbrales del criterio (diferencia de
    medianas menor que 2 ms; como mucho el 25 % de las muestras sobre el percentil 90). Si no se cumplen, decide el
    orquestador entre igualar la escritura y aceptarlo (T17.19; riesgo "Commit con escritura frente a commit vacío").
  - Hosting (D-21), revisión de DT-1: hoy no hay `trust proxy`, así que detrás de un proxy `req.ip` sería el del proxy y
    el límite de 10 por minuto contaría a todos juntos. El contador del límite por IP vive en la memoria de cada instancia
    (PO-6): con varias instancias, el límite efectivo es 10 por instancia. Y las IPv6 se agrupan por `/64` (hoy cuentan
    por dirección exacta).
  - Hosting (D-21), aviso de la 005 (DT-9 de 005): configurar `trust proxy` con el hosting **antes de publicar el
    formulario de inscripción**. Sin eso, detrás del proxy todas las peticiones llegan con la misma IP, y los límites
    por IP de la inscripción pública (criterio 33 de 005: lecturas, cotización, envío, consulta y foto) y el de 5
    solicitudes sin pagar por conexión (criterio 25 de 005) bloquearían a todos a la vez.
  - **Pendiente antes de producción, desde la 006b (DT-14 de 006): un límite general de peticiones por usuario o por
    academia en toda la API con sesión.** Hoy las rutas con sesión no tienen un límite general de peticiones; solo el
    PDF del cierre de caja tiene los suyos (criterios 49 y 52 de 006). Medido en la ronda adversarial 2 de la 006b, con
    una caja de 20 000 movimientos:
    - el detalle de la caja tarda unos 245 ms y responde de 7 a 11,8 MB, y `/api/cajas/actual` tarda unos 180 ms;
    - con 10 detalles a la vez, un egreso de otra academia tarda unos 2 s; con 30 a la vez, unos 5,8 s.

    Se decide junto con `trust proxy` y el hosting (D-21). Con varias instancias, los contadores en memoria de cada
    proceso (PO-6) no bastan.
  - DT-4: `DELETE /api/plataforma/sesion` con un cuerpo que no es JSON responde 400 y no cierra (criterio 74 de 001),
    mientras que `DELETE /api/sesion` cierra con cualquier cuerpo (criterio 54 de 002). Alinearlos cambia pruebas
    protegidas de la 001: va en una historia propia.
  - N11 y AR3-4: quien crea o restablece un administrador conoce su clave inicial (su DNI). Decidido (a) por Bryan el
    17/11/2026 (DR-11 de 002): riesgo explícito, registrado en la auditoría de la academia con actor `SUPERADMIN`; la
    opción (b), avisar a los demás administradores cuando exista el panel de auditoría (Fase 3), queda como mejora
    futura, no decidida. El Superadmin tampoco vuelve a comprobar su sesión dentro de la transacción que crea o
    restablece un administrador. Si una historia le agrega cambios de cuenta, conviene darle la regla del criterio 56
    (bloquear y comprobar su fila de `superadmins`), teniendo en cuenta que esa fila es de la plataforma y la escritura
    corre en `conAcademia`.
  - Regla para las historias siguientes (DT-5): toda escritura a pedido de un usuario de la academia llama a
    `bloquearActorVigente` dentro de su transacción. Ver "Escrituras de usuarios de la academia" en
    [`docs/arquitectura.md`](../docs/arquitectura.md).
- **003 · Configuración.** Tolerancia de tardanza (D-11), días "por vencer", días de prioridad al renovar (D-06),
  intentos de inicio de sesión, identidad de la academia (D-22).
- **004 · Planes y clases.** Planes (HU-19, RN-07) y clases por nivel, día, hora y entrenador, con aforo de 20 a 50
  (HU-17, RN-09 a RN-11). Lo crítico: el aforo.
  - Estado: unida a `main` el 19/11/2026 (PR #7), tras tres rondas adversariales. Lo que heredan la 005 y las siguientes está en su nota y en «Planes, clases y cupo (004)» de
    [`docs/arquitectura.md`](../docs/arquitectura.md).
- **005 · Inscripción pública.** Formulario con datos, ficha médica, apoderado y consentimientos (HU-01, RN-20,
  D-07), elección de días y horario con cupo (HU-02), foto opcional (D-20, D-24), código y enlace de seguimiento
  (D-05), cálculo del cobro proporcional (HU-34, RN-25, D-03).
  - Estado: spec aprobada por Bryan el 20/11/2026 (DR-1 a DR-11 y DT-1 a DT-9 de 005), en
    [`specs/005-inscripcion-publica/`](005-inscripcion-publica/spec.md). Por DR-11 se entrega en dos PR desde esa misma
    carpeta, los dos de ruta crítica:
    - **005a · inscripción, reserva y seguimiento** (primero): criterios 1 a 33, 41 a 45, 47 y 48 (tablas, oferta,
      cálculo del cobro, envío con el último cupo, seguimiento, límites por IP, teléfono público, aforo con inscritos de
      DR-5 de 004, web pública).
    - **005b · foto y panel de solicitudes** (siguiente PR, con la 005a unida): criterios 34 a 40 y 46 (`AlmacenArchivos`,
      `sharp` y la foto; lista, cancelación y ocupación en el panel), más la foto en 28, 33, 43 y 44 y su parte de 48.
  - Estado: la 005a se unió a `main` el 20/11/2026 (PR #8), tras dos rondas adversariales; la 005b, el 22/11/2026 (PR #10), tras tres rondas. La historia 005 queda completa.
  - Antes de publicar el formulario: `trust proxy` con el hosting (DT-9 de 005; aviso en las notas de hosting de la 002).
  - Hosting (D-21), pregunta R7 de 005 (ronda 2 del ataque de la 005a, no bloquea): la agrupación de IPv6 por /64 no
    frena a quien controla un /56 o un /48 (con un /56, hasta 256 × 5 reservas sin pagar a la vez). Propuesta: un
    segundo límite, más alto, por /56 o /48, decidido junto a `trust proxy`. Detalle en "Preguntas abiertas" de la spec.
  - Respuestas de Bryan a la ronda 1 de la 005a (20/11/2026, DR-12 a DR-16 de 005; criterios 54 a 60): la reserva vence
    a las 24 horas o al fin del mes en Lima, lo que ocurra primero; el enlace de seguimiento llega también al correo del
    apoderado; la vista de una solicitud vencida, cancelada o que ya no es la vigente no muestra el nombre; los límites
    por conexión agrupan las IPv6 por /64. La pregunta del DNI del personal pasó a la 007 (DR-16 de 005).
  - Respuestas de Bryan al repaso de la 005b (21/11/2026, DR-17 a DR-21 de 005, todas con la propuesta): al cancelar una
    solicitud no se envía correo (el cliente ve «Cancelada» en su enlace); la foto de una solicitud cancelada o vencida
    se conserva; en el reenvío con el mismo DNI (criterio 21 b) la foto se conserva; la exclusión de recepción de los
    límites por conexión pasa a la 007 y la foto desde el panel con la cámara de la PC, a la 008 (notas de esas
    historias).
  - **Pendiente antes de producción: política de retención y borrado de datos de solicitudes no pagadas (Ley 29733,
    DR-18 de 005, antes B2).** Las solicitudes vencidas o canceladas conservan los datos personales, la ficha médica, el
    apoderado y la foto (que puede ser de un menor), sin plazo. Hay que definir con el responsable cuánto tiempo se
    guardan y cómo se borran (incluido el archivo de la foto en `AlmacenArchivos`) antes de salir a producción. Mientras
    tanto, nada se borra (riesgos «Datos de solicitudes que nunca se pagaron» y «Fotos de solicitudes que nunca se
    pagaron» de la spec 005).
  - Nota de 001 (ataque ronda 17, O2): `GET /api/a/{nombreCorto}` es pública y no tiene límite de peticiones. Cada
    petición abre una transacción corta (`resolverAcademia`), y con el pool de 10 conexiones una avalancha anónima puede
    demorar o hacer fallar las peticiones de todas las academias. Se decide con el hosting (D-21: proxy, CDN o límites
    del proveedor, y `trust proxy` para que `req.ip` sea la del cliente) y con esta historia, que es la que pone la ruta
    en uso: límite por IP en la ruta pública (como el del inicio de sesión), caché corta de la respuesta, o las dos.
  - Nota de 003 (DR-4 de 003): el teléfono de la academia (`telefono`, D-22) se publica en las páginas públicas (ingreso,
    inscripción y seguimiento) desde esta historia, con la `tx` de la ruta pública y sin caché. La 003 solo lo muestra con
    sesión.
  - Nota de 004 (DT-1 de 004): la 004 deja el aforo de 20 a 50, el bloqueo común `bloquearClasesParaCupo(tx, ids)` y la
    regla "Cupo de una clase" de `docs/arquitectura.md`, pero no cuenta inscritos. Esta historia cuenta la ocupación de
    cada clase y reserva los cupos mientras el pago está pendiente (RN-28), siempre dentro de ese bloqueo (todas las
    clases que toca en una sola llamada, después de `bloquearActorVigente` si hay actor y antes de contar o escribir), y
    trae las pruebas protegidas de "nunca más inscritos que el aforo, aunque dos personas tomen el último cupo a la vez"
    usando `bloquearClasesParaCupo`. También construye lo decidido en DR-5 de 004: bajar el aforo por debajo de los
    inscritos se permite con una confirmación explícita (nadie pierde su lugar y no entran inscripciones nuevas hasta que
    haya cupo), y no se puede desactivar una clase con inscritos hasta moverlos. Además, aplica la vigencia del plan (DR-2
    de 004) y los días, franjas y niveles permitidos al ofrecer planes y clases. El estado del plan (`VIGENTE`,
    `PROGRAMADO`, `VENCIDO`, `INACTIVO`) se calcula al leer con `estadoDelPlan` y `hoyEnLima(RELOJ.ahora())`, no se guarda
    (D10 de 004); la 005 decide con él qué planes ofrece (criterio 14 de 004 y «Casos límite»).
  - Lecciones de la 004 para esta historia (AT-1 y criterio 32 de 004; `docs/arquitectura.md`, «Planes, clases y cupo (004)»):
    - Si la transacción toca una fila de `usuarios` además de la del actor (por ejemplo, la de un entrenador que se
      asigna), se pasa como `objetivoId` a `bloquearActorVigente` en una sola sentencia ordenada por id, antes de bloquear
      cualquier fila de otra tabla. Así no se interbloquea con la desactivación de 002 (en la 004 fue un `40P01` que
      terminaba en 500).
    - El 409 de un choque con un índice único sale del nombre de la restricción violada (`restriccionDeUnicidadViolada`),
      después del `ROLLBACK` y sin releer las filas. No se usa `ON CONFLICT DO NOTHING` cuando el choque puede dar dos
      códigos: oculta cuál índice chocó.
    - Cualquier índice sobre `lower()` exige una base con `LC_CTYPE` UTF-8 (criterio 34 c de 004).
- **006 · Caja.** Apertura, movimientos, egresos, cierre con esperado por método y diferencia, reapertura por el
  administrador, PDF del cierre (HU-25 a HU-27, RN-17).
  - Estado: spec aprobada por Bryan el 22/11/2026 (DR-1 a DR-11 y DT-1 a DT-6 de 006, todas con la propuesta), en
    [`specs/006-caja/`](006-caja/spec.md). Por DR-10 se entrega en dos PR desde esa misma carpeta, los dos de ruta
    crítica:
    - **006a · caja del día** (unida a main el 22/11/2026, [PR #11](https://github.com/brayanAndy1996/piscina/pull/11)): criterios 1 a 39, y 45 y 46 sin el historial ni el PDF (tablas, aislamiento,
      permisos con `REABRIR_CAJA`, apertura, egresos, cierre, reapertura, la interfaz para la 007 y la pantalla
      `/panel/caja`).
    - **006b · historial y PDF del cierre** (unida a main el 24/11/2026, [PR #12](https://github.com/brayanAndy1996/piscina/pull/12)): criterios 40 a 44, más su parte de 45 y 46
      (historial con el alcance de la secretaria, detalle, PDF bajo pedido con `pdfkit`). Sin migración.
  - Lo decidido: una caja abierta a la vez por academia y una por día (DR-1); la caja de un día anterior no admite
    movimientos y se cierra, contando el efectivo y con la marca «tardío», antes de abrir la de hoy (DR-2); el egreso es
    siempre en efectivo, sin superar el efectivo de la caja (DR-3, DR-4); los movimientos no se anulan (DR-5); no hay
    ingresos manuales (DR-11).
  - Pendiente antes de producción (DT-14 de 006): el límite general de peticiones por usuario o por academia en la API,
    anotado en las notas de hosting de la 002. Las lecturas de una caja con decenas de miles de movimientos quedan como
    riesgo aceptado de la 006b.
- **007 · Pagos y verificación.** Efectivo, Yape y transferencia con comprobante, bandeja de verificación, número de
  operación sin duplicados, caja al verificar (D-04), paso de cliente a alumno con usuario (HU-04, HU-07 a HU-09,
  RN-01, RN-04, RN-28), ticket interno (D-09).
  - Estado: spec aprobada por Bryan el 24/11/2026 (DR-1 a DR-14 de 007, todas con la propuesta; DT-1 a DT-16 de 007,
    aceptadas por el orquestador), en [`specs/007-pagos/`](007-pagos/spec.md). Por DR-14 se entrega en dos PR desde esa
    misma carpeta, los dos de ruta crítica:
    - **007a · cobro en recepción y cuenta del alumno** (unida a main el 25/11/2026, [PR #13](https://github.com/brayanAndy1996/piscina/pull/13), tras cuatro rondas adversariales): criterios 1 a 35 y 54 a 57 sin las partes [007b]
      (tabla `pagos` completa con sus invariantes, cobro en efectivo con la caja de hoy, ajuste del monto por el
      administrador, paso de cliente a alumno con su cuenta, ticket imprimible, estado `CONFIRMADA`, recepción sin los
      límites por conexión, correo de pago confirmado).
    - **007b · Yape y transferencia** (unida a main el 25/11/2026, [PR #15](https://github.com/brayanAndy1996/piscina/pull/15): dos rondas adversariales, criterio 60 nuevo; con la 007a unida; método de la D-31): criterios 36 a 53, más las partes [007b]
      (subida del comprobante desde el enlace, número de operación sin duplicados, bandeja, aprobación y rechazo, datos
      de pago en la configuración, correo de pago rechazado). Sin migración.
    - **Deuda de la 007b** (las rondas 1 y 2 del ataque y la revisión; las medias y las bajas no abren ronda, D-31):
      - R1-2 y R1-3 (ronda 1, bajas): `X-Pago-Datos` acepta bytes de 0x80 a 0xFF (latin1), por ejemplo `"¹²³"`, que responde 201 y se guarda tal cual, aunque los criterios 36 y 37 piden JSON ASCII; un número de operación con controles que son espacios (`\t`, `\n`, `\r`, `\v`, `\f`, `\u0085`) se acepta y se guarda con el control, y el criterio 38 dice que los controles responden 400.
      - R2-1 (media, decisión pendiente de Bryan): un cliente `PAGO_RECHAZADO` que luego se registra como personal (criterio 22 b) puede subir otro comprobante. La matrícula vuelve a ocupar cupo sin vencimiento y la aprobación responde 409 `DNI_DEL_PERSONAL` para siempre. La spec no dice qué debe responder la subida.
      - R2-2 (baja): el correo `PAGO_RECHAZADO` de un mes ya terminado invita a subir otro comprobante, aunque la solicitud queda `VENCIDA` (los criterios 51 b y 52 se contradicen).
      - R2-3 (baja): en la web, la `claveIdempotencia` queda fija en `PAGO_RECHAZADO` después de un 200 de reintento; hay que recargar la página para enviar otro comprobante.
      - De la revisión (menores):
        - la web no ofrece cancelar ni ajustar una `PAGO_RECHAZADO`, aunque la API lo permite;
        - duplicación entre `comprobante.service.ts` y `foto.service.ts` (relectura incierta, `esRechazoDeLaTransaccion`, `borrarSinFallar`);
        - rama muerta `normalizarNumeroOperacion(...) === null` en `comprobante.service.ts`;
        - el nombre `instalarHeadSinRutasDeCaja` está desactualizado;
        - el texto del diálogo de aprobar asume siempre un alumno nuevo;
        - el archivo de la semilla se guarda antes del `INSERT … ON CONFLICT DO NOTHING`.
    - **Tamaño (D-31):** `specs/007-pagos/spec.md` tiene 1 487 líneas, más de las ~800 de la D-31. Venía de la 007a y no se reescribe en esta entrega.
  - Lo decidido: el personal y los alumnos no comparten DNI (DR-1); un comprobante en revisión al terminar el mes se
    puede aprobar (DR-2); el DNI físico se revisa en la primera visita, riesgo aceptado (DR-3); el ticket es una página
    imprimible, sin DNI, con la frase de que no es un comprobante SUNAT (DR-4); el rechazo libera el cupo y se puede
    reintentar, mostrando el motivo (DR-5); monto exacto, sin pagos parciales (DR-6); en recepción solo efectivo (DR-7);
    correos de pago confirmado y rechazado (DR-8); número de operación único dentro del mismo método (DR-9); con la
    reserva vencida, se vuelve a inscribir (DR-10); ajuste solo del administrador, en soles enteros desde S/ 1 y con
    motivo (DR-11); para cancelar, primero se rechaza el comprobante (DR-12); datos de pago en la configuración (DR-13).
  - Desde 002: la cuenta del alumno se crea con `UsuariosService.crearEnTransaccion`, y cada escritura a pedido de un
    usuario de la academia llama antes a `bloquearActorVigente` (regla DT-5, en `docs/arquitectura.md`).
  - Preguntas abiertas que llegan de la 005 (para el especificador de la 007, a consultar con el responsable; resueltas
    el 24/11/2026 con DR-1, DR-2 y DR-3 de 007):
    - **DNI del personal igual al de un cliente (DR-16 de 005, antes R5).** La 005 rechaza la inscripción con el DNI de
      alguien del personal (criterio 21 a de 005). ¿Una persona del personal (por ejemplo, un entrenador) puede
      inscribirse como alumna en su academia? Y al revés: si el administrador crea un usuario del personal con el DNI
      de un cliente con solicitud en curso, ¿se permite? Si se permite, la 007 no podría crear la cuenta del alumno,
      porque el DNI es único en `usuarios` (D-28). Mientras no se decida, la 005 rechaza la inscripción y la creación de
      personal de la 002 no cambia.
    - **Comprobante en verificación al terminar el mes (DR-12 de 005).** "Nunca queda una reserva vigente de un mes ya
      cerrado", pero con un comprobante subido la reserva no vence (`reserva_vence_en = NULL`, RN-28). ¿Qué pasa con un
      Yape o una transferencia que sigue sin revisar cuando termina el mes de su matrícula? La base solo garantiza el
      tope cuando hay fecha de vencimiento (criterio 56 de 005).
    - **Identidad en los pagos que no pasan por recepción (DR-14 de 005).** Se aceptó que un tercero pueda reemplazar los
      datos de un cliente con la solicitud vencida porque la identidad se comprueba en recepción con el DNI físico al
      pagar. Con Yape o transferencia, ¿cuándo se comprueba el DNI físico antes de crear el usuario y el carnet?
  - Desde 005 (DR-13 y DR-14 de 005): si la 007 vuelve a enviar el enlace de seguimiento, va al alumno y al apoderado
    como en la 005; y sus estados nuevos de la solicitud muestran el nombre solo en la solicitud vigente del cliente
    (regla "Vista de seguimiento" de la spec 005).
  - **Desde 005b (DR-20 de 005, antes B4), antes de publicar el formulario:** las inscripciones y las fotos enviadas con
    una sesión válida de `ADMIN` o `SECRETARIA` de esa misma academia dejan de contar en los límites por conexión de la
    inscripción pública (criterio 25 de 005, 5 solicitudes sin pagar por conexión, y criterio 33, límites por hora y por
    minuto, también el de la foto). Hoy "Nueva inscripción" usa el formulario público desde la PC de recepción y comparte
    esos límites, así que en un día de muchas inscripciones recepción queda bloqueada. Va como criterio nuevo con su
    prueba protegida, junto con el cobro en recepción. En la 005b los límites quedan como están.
  - Desde 005a: las reglas para la 007 (comprobante con reserva sin límite, rechazo que cancela la matrícula y libera el cupo,
    confirmación que crea al alumno, y `calcularTotal` con lo guardado en la matrícula) están en «Inscripción pública, reserva
    y seguimiento (005a)» de [`docs/arquitectura.md`](../docs/arquitectura.md).
  - **Desde 006a (criterios 24 a 26 y «Reglas para las historias siguientes» de la spec 006):** todo cobro en efectivo y
    toda verificación de Yape o transferencia registra su ingreso con `registrarIngresoEnCaja(tx, ingreso, ahora)`
    (`backend/src/modulos/caja/`), dentro de su propia transacción y antes de confirmar, con el método real (un Yape entra
    como `YAPE` y no suma al efectivo, D-04) y el total ya calculado y redondeado (la caja no cambia montos, D-03). Si lanza
    409 `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`, la transacción completa del cobro se revierte: no queda un pago
    confirmado sin su movimiento. Un pago entra una sola vez (`pago_id` único; si se repite, devuelve `repetido: true`).
    Orden de bloqueos: `bloquearActorVigente` → filas del cliente (`alumnos`, `solicitudes_inscripcion`, `matriculas`,
    `pagos`) → `bloquearClasesParaCupo` → **la caja, al final**. La 007 le pone la llave foránea a
    `movimientos_caja.pago_id` cuando cree `pagos`, reutiliza el tipo `metodo_pago` y puede usar `leerCajaAbierta` para
    avisar "Abre la caja antes de cobrar" sin decidir con ella. La caja de un día anterior no admite cobros (DR-2 de 006).
- **008 · Carnet QR.** Token aleatorio, regeneración que invalida el anterior, carnet en pantalla y en PDF, "Foto
  pendiente" (HU-13, RN-05, RN-06, D-24).
  - Estado: spec aprobada por Bryan el 25/11/2026 (DR-1 a DR-5 y DT-1 a DT-13 de 008), en
    [`specs/008-carnet-qr/`](008-carnet-qr/spec.md). Dos entregas: 008a (criterios 1 a 21), unida a main el 25/11/2026, [PR #16](https://github.com/brayanAndy1996/piscina/pull/16), tras una ronda adversarial sin críticas ni altas; 008b (22 a 29), unida a main el 25/11/2026, [PR #17](https://github.com/brayanAndy1996/piscina/pull/17), tras una ronda adversarial sin críticas ni altas.
  - **Deuda de la 008a** (las medias y las bajas no abren ronda, D-31; el detalle de la ronda 1 está en [`rondas.md`](008-carnet-qr/rondas.md)):
    - **R1-1** (ronda 1, baja): un cuerpo mal formado responde 400 o 413 en lugar de 403 al rol cuya celda de `VER_CARNET` tiene otro alcance: un `ALUMNO` en `POST /api/alumnos/buscar` y en `GET /api/alumnos/{id}/carnet[/pdf]` con cuerpo, y la secretaria o el administrador en `GET /api/mi-carnet[/pdf]` con cuerpo. `PermisosGuard` lanza el error de cuerpo guardado antes de `exigirAlcanceDelCarnet`. No da acceso a nada.
    - **REV-1** (de la revisión, menor): las pruebas unitarias `backend/src/modulos/alumnos/pdf/carnet-pdf.test.ts` y `backend/src/modulos/alumnos/dominio/token-qr.test.ts` cubren parte de los criterios críticos 12 y 3 sin la marca de pruebas protegidas; la cobertura crítica está en la integración protegida.
    - **REV-2** (de la revisión, menor): imports profundos. `carnet-pdf.ts` importa `../../caja/pdf/texto-pdf` en lugar de `caja/index.ts`, y `pagos/confirmacion.ts` importa `../alumnos/dominio/token-qr` en lugar de `../alumnos`. Antes de cambiarlos, revisar que no se forme un ciclo.
    - **REV-3** (de la revisión, menor): `carnet.service.ts` tiene dos consultas casi iguales (`leerConFecha`).
    - **REV-4** (de la revisión, menor): la regeneración lee el carnet en otra transacción, así que con otra regeneración simultánea devuelve el QR más reciente (coherente con «vale el último»).
    - **REV-5** (de la revisión, menor): el PDF corta con «...» y no con «…», porque `textoParaPdf` no admite la elipsis Unicode.
    - **REV-6** (de la revisión, menor): el comentario de la cabecera de `carnet-pdf.ts` no menciona `CreationDate`.
    - **REV-7** (de la revisión, menor): `useDescargarPdfDelCarnet` duplica `useDescargarPdfDelCierre`.
    - **TES-1** (del tester): ninguna prueba E2E cubre el carnet.
    - **TES-2** (del tester): el chunk JS del frontend pesa 1 038 kB y Vite avisa por pasar de 500 kB.
  - **Desde 005b (DR-21 de 005, antes B5):** agregar la foto después desde el panel (a una solicitud o un alumno ya
    registrado, sin el token de seguimiento) y tomarla con la cámara de la PC de recepción. En la 005b la foto solo se
    sube en el paso del formulario (también cuando la secretaria abre "Nueva inscripción", eligiendo un archivo) o desde
    el enlace de seguimiento. Debe usar el mismo proceso de los criterios 35 a 37 de 005: recodificación sin metadatos,
    `AlmacenArchivos` con clave del servidor y borrado de la anterior después de confirmar. **Cumplido por la 008b** (criterios 22 a 28 de `specs/008-carnet-qr/spec.md`).
  - **Deuda de la 008b** (ronda 1, 25/11/2026; las medias y las bajas no abren ronda, D-31; el detalle está en [`rondas.md`](008-carnet-qr/rondas.md)):
    - **R1-1** (media): un cuerpo troceado que nunca termina no recibe el 413 mientras el cliente sigue enviando, porque `express.raw` hace `dump` antes de `next(err)`. También pasa en la foto pública y en el comprobante, que no piden sesión; viene de la 005b. **A resolver antes de producción (límite en el proxy o `requestTimeout`).**
    - **R1-2** (media): los rechazos 401 y 403 (sin sesión, cambio de clave pendiente, academia suspendida) no cierran la conexión, y el servidor sigue recibiendo el cuerpo. **A resolver antes de producción (límite en el proxy o `requestTimeout`).**
    - **R1-3** (baja): con `Expect: 100-continue`, Node envía «100 Continue» antes del 401 o el 403.
    - **R1-4** (baja): en la web, con StrictMode en desarrollo y los permisos resueltos en orden inverso, la cámara puede quedar encendida en `CapturaCamara.tsx`.
    - **Menores de la revisión** (T23):
      - la línea que lee el tipo de la imagen (`tipoDeMedio(...) === 'image/png' ? 'image/png' : 'image/jpeg'`) está repetida en 4 controladores: `alumnos`, `seguimiento`, `solicitudes` y `pagos/comprobante`;
      - `FotoAlumnoService` y `FotoPanelService` repiten la preparación de la subida;
      - `comun/http/cuerpo-imagen.ts` importa un tipo de `modulos/autenticacion`;
      - la cámara sigue encendida durante la subida;
      - el JPEG de la cámara no pasa por la validación de 5 MB de la web;
      - el título del diálogo («Agregar foto» o «Cambiar foto») cambia mientras el botón dice «Guardando…»;
      - la tarjeta de solicitud siempre dice «Agregar foto», porque la lista no trae `fotoCargada`.
- **009 · Asistencia y faltas.** QR y manual, validaciones, una por día, solo mientras dura la clase, puntual o
  tarde, descuento de clase, registro de faltas por tarea programada (HU-14, HU-15, RN-14 a RN-16, D-08, D-11,
  D-16).
  - Estado: spec aprobada por Bryan el 25/11/2026 (DR-1 a DR-6 y el privilegio `UPDATE (clases_usadas)`; DT-1 a DT-21), en
    [`specs/009-asistencia/`](009-asistencia/spec.md). Dos entregas: 009a (marcado por QR y manual, criterios 1 a 21; unida a
    main el 26/11/2026, [PR #18](https://github.com/brayanAndy1996/piscina/pull/18), tras una ronda adversarial sin críticas ni altas; ver [`rondas.md`](009-asistencia/rondas.md)) y
    009b (faltas, registro posterior y consulta del mes, criterios 22 a 37; en curso).
  - **Para la 009b** (ronda 1 de la 009a, 26/11/2026; se corrigen en la 009b con su prueba protegida):
    - **R1-1** (media): si la clave la usó un registro posterior del mismo alumno, el marcado responde 200 en lugar de 409
      `CLAVE_YA_USADA` (criterio 13).
    - **R1-2** (media): el `INSERT` espera `FOR KEY SHARE` sobre la clase después de leer «ahora»; si la espera cruza el fin
      de la clase, se registra con la hora de antes (criterio 14 y DT-16).
  - **Deuda de la 009a** (ronda 1, 26/11/2026; las medias y las bajas no abren ronda, D-31; el detalle está en
    [`rondas.md`](009-asistencia/rondas.md)):
    - **R1-3** (baja): el 200 repetido recalcula las clases en lugar de repetir el cuerpo del 201.
    - **Menores de la revisión** (T12):
      - el 409 `ASISTENCIA_YA_REGISTRADA` del segundo choque de unicidad sale sin `detalles` (`marcado.service.ts:133`);
      - la redacción «empieza a las» o «fue de» depende del reloj del equipo (mejor un momento desde la API);
      - `marcar.variables` de la mutación de la web conserva el contenido del QR;
      - el formato de `schema.prisma` en el modelo `Matricula` no pasa `prisma format`;
      - `diaIsoEnLima` está duplicado entre `asistencia/dominio/ventana.ts` y `matriculas/dominio/cobro.ts`;
      - el `SELECT` repetido en `lectura.ts`;
      - el comentario de `alumnos/index.ts`.
    - **Del tester** (T12): confirmar que la integración continua ejecuta sin saltar las pruebas de roles, RLS y privilegios
      (95 se saltaron en el contenedor).
  - Nota de 003: la tolerancia de tardanza (`toleranciaTardanzaMinutos`) la lee `leerConfiguracion(tx)` dentro de la
    transacción del marcado, sin caché, desde la 009a (ver "Configuración de la academia (003)" en `docs/arquitectura.md`).
- **010 · Mensualidades.** Estados al día, por vencer, vencido y pendiente (HU-11), renovación con prioridad de
  horario (HU-12, D-06), cierre de mes y clases no usadas (RN-23), cambio de horario por la secretaria (HU-03,
  RN-08).
  - Nota de 003: "por vencer" (`diasPorVencer`) y la prioridad de renovación (`diasPrioridadRenovacion`) los leerá
    `leerConfiguracion(tx)` dentro de la transacción de la operación, sin caché. Son valores aparte: cambiar uno no cambia
    el otro (DR-3 de 003).
  - Desde 005a: el cupo de una renovación o de un cambio de horario se cuenta con `contarOcupacion` (una matrícula de ese mes
    ocupa cupo si está `VIGENTE`, o `RESERVADA` sin vencer), después de `bloquearClasesParaCupo` (regla «Cupo de una clase»
    de 004). Las renovaciones no tienen `solicitud_id`. La inscripción para el mes siguiente y la prioridad de renovación
    (D-06) siguen en la pregunta N3 de la spec 005, que decide esta historia.
  - Nota de 007b: la bandeja de pagos (`GET /api/pagos/pendientes`, en `verificacion.service.ts`) hace un `JOIN` interno con
    `solicitudes_inscripcion`, así que los pagos de renovación, que no tienen solicitud, no aparecerían en `/panel/pagos`.
    La 010 tendrá que cambiarlo al llevar esos pagos a la bandeja.
- **011 · Panel del alumno y apoderado.** Datos, plan, horario, clases restantes, vencimiento, asistencia día por
  día con hora (puntual, tarde, falta), nivel actual; solo lectura salvo el cambio de contraseña (HU-06, D-08, D-14).

## Fase 2: gestión académica

| N.º | Historia | Ruta crítica | Estado |
| --- | --- | --- | --- |
| 012 | Panel del entrenador y ficha del alumno | En parte | ⬜ |
| 013 | Evaluaciones, nivel por estilo y cambio de nivel | En parte | ⬜ |
| 014 | Multimedia por alumno y mes | En parte | ⬜ |
| 015 | Códigos de descuento | Sí | ⬜ |
| 016 | Clases particulares | En parte | ⬜ |
| 017 | Días de cierre y recuperación | En parte | ⬜ |
| 018 | Clases recuperables y agenda de recuperación | En parte | ⬜ |
| 019 | Pagos a entrenadores | En parte | ⬜ |
| 020 | Asistencia autorizada en otro horario | En parte | ⬜ |

### Notas

- **012:** HU-18, HU-20, RN-18, RN-21. Lo crítico: el entrenador solo ve a sus alumnos.
- **013:** HU-21, D-12, D-15; el progreso por estilo y la evolución se agregan al panel del apoderado (D-13).
- **014:** HU-22, RN-19; consentimiento de imagen. Lo crítico: quién ve cada archivo.
- **015:** HU-10, RN-12; se aplica sobre el monto proporcional (D-03).
- **016:** HU-23, HU-24, RN-13. Lo crítico: el cobro.
- **017:** HU-41, RN-33.
- **018:** HU-35, HU-36, RN-23, RN-24. Lo crítico: aforo y descuento de clases recuperables.
- **019:** HU-39, RN-31, RN-35, D-02. Lo crítico: el egreso de caja.
  - Desde 006a: el pago a un entrenador "desde caja" es un egreso de la caja abierta del día con `registrarEgresoEnCaja`
    (criterios 19 a 22 de 006: no entra a una caja cerrada ni de otro día, no supera el efectivo, idempotente con clave),
    con la caja bloqueada al final (orden de bloqueos de la spec 006). La 019 suma su concepto al tipo
    `concepto_movimiento_caja` en su migración y ajusta el `CHECK` de los egresos de `movimientos_caja`, que hoy solo
    admite `EGRESO_MENOR`.
- **020:** HU-38, RN-30. Lo crítico: aforo y descuento del plan.

## Después del MVP

- **Fase 3:** reportes exportables, dashboard, asistencia de entrenadores (D-02) y auditoría avanzada.
- **Fase 4:** PWA, QR dinámico y certificados.
- **Último módulo:** facturación electrónica SUNAT (D-09), por academia (D-23).

## Pendiente técnico

- **Integración continua: límite del trabajo de Linux.** En esta rama, el trabajo de Linux de `.github/workflows/ci.yml`
  pasa de 60 a 90 minutos (`timeout-minutes: 90`), aprobado por Bryan el 25/11/2026. En el PR #13 la suite tardó 51 de
  los 60 minutos. En este entorno la suite tardó 40 minutos. Queda pendiente repartir la integración en trabajos paralelos
  (D-31), en su propio PR: ese es el arreglo de fondo, y los 90 minutos son provisionales.
- **Pruebas de integración: una base por proceso.** Las pruebas de integración comparten una sola base de datos y chocan si dos procesos corren a la vez. En la revisión de la 008b, 10 pruebas de `verificacion-aprobar-007b.test.ts` fallaron en la suite completa por eso; repetido solo, ese archivo pasa 26 de 26. Conviene una base por proceso.
