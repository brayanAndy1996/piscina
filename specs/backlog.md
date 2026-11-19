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
| 004 | Planes y clases con aforo | En parte | 🟨 |
| 005 | Inscripción pública y seguimiento de la solicitud | Sí | ⬜ |
| 006 | Caja | Sí | ⬜ |
| 007 | Pagos, verificación y paso de cliente a alumno | Sí | ⬜ |
| 008 | Carnet digital con QR | En parte | ⬜ |
| 009 | Asistencia y faltas | Sí | ⬜ |
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
  - Estado: construida; pendiente de la revisión (T15), de la suite completa (T16) y del PR. Se marca ✅ al unirse a
    `main`. Lo que heredan la 005 y las siguientes está en su nota y en «Planes, clases y cupo (004)» de
    [`docs/arquitectura.md`](../docs/arquitectura.md).
- **005 · Inscripción pública.** Formulario con datos, ficha médica, apoderado y consentimientos (HU-01, RN-20,
  D-07), elección de días y horario con cupo (HU-02), foto opcional (D-20, D-24), código y enlace de seguimiento
  (D-05), cálculo del cobro proporcional (HU-34, RN-25, D-03).
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
- **007 · Pagos y verificación.** Efectivo, Yape y transferencia con comprobante, bandeja de verificación, número de
  operación sin duplicados, caja al verificar (D-04), paso de cliente a alumno con usuario (HU-04, HU-07 a HU-09,
  RN-01, RN-04, RN-28), ticket interno (D-09).
  - Desde 002: la cuenta del alumno se crea con `UsuariosService.crearEnTransaccion`, y cada escritura a pedido de un
    usuario de la academia llama antes a `bloquearActorVigente` (regla DT-5, en `docs/arquitectura.md`).
- **008 · Carnet QR.** Token aleatorio, regeneración que invalida el anterior, carnet en pantalla y en PDF, "Foto
  pendiente" (HU-13, RN-05, RN-06, D-24).
- **009 · Asistencia y faltas.** QR y manual, validaciones, una por día, solo mientras dura la clase, puntual o
  tarde, descuento de clase, registro de faltas por tarea programada (HU-14, HU-15, RN-14 a RN-16, D-08, D-11,
  D-16).
  - Nota de 003: la tolerancia de tardanza (`toleranciaTardanzaMinutos`) la leerá `leerConfiguracion(tx)` dentro de la
    transacción de la asistencia, sin caché (ver "Configuración de la academia (003)" en `docs/arquitectura.md`).
- **010 · Mensualidades.** Estados al día, por vencer, vencido y pendiente (HU-11), renovación con prioridad de
  horario (HU-12, D-06), cierre de mes y clases no usadas (RN-23), cambio de horario por la secretaria (HU-03,
  RN-08).
  - Nota de 003: "por vencer" (`diasPorVencer`) y la prioridad de renovación (`diasPrioridadRenovacion`) los leerá
    `leerConfiguracion(tx)` dentro de la transacción de la operación, sin caché. Son valores aparte: cambiar uno no cambia
    el otro (DR-3 de 003).
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
- **020:** HU-38, RN-30. Lo crítico: aforo y descuento del plan.

## Después del MVP

- **Fase 3:** reportes exportables, dashboard, asistencia de entrenadores (D-02) y auditoría avanzada.
- **Fase 4:** PWA, QR dinámico y certificados.
- **Último módulo:** facturación electrónica SUNAT (D-09), por academia (D-23).
