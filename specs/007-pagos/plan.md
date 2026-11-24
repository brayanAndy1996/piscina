# 007 · Plan técnico

Plan de la spec [`spec.md`](spec.md). Los números son criterios de esa spec; «de 005», «de 006», etc., los de esas
historias. Lo marcado **[007b]** va en el segundo PR.

## Módulos afectados

- `backend/prisma/migrations/<marca>_estado_solicitud_confirmada/` y `<marca>_pagos/` (007a), y `schema.prisma`. Desde la
  ronda adversarial 1 de la 007a, `<marca>_pagos_movimiento_confirmado/` (criterio 58).
- `backend/src/modulos/auditoria/id-ordenado.ts` (ronda adversarial 1 de la 007a, criterio 59).
- `backend/src/modulos/pagos/` (nuevo):
  - `pagos.module.ts`, `pagos.controller.ts` (ticket; **[007b]** bandeja, comprobante, aprobación y rechazo),
    `cobros.service.ts` (cobro en efectivo y ajuste), **[007b]** `verificacion.service.ts`, **[007b]**
    `comprobante.service.ts` (subida pública) y su controlador público.
  - `confirmacion.ts` (sin Nest): `confirmarPagoEnTransaccion` (criterio 20).
  - `bloqueos.ts` (sin Nest): `bloquearFilasDelCobro(tx, { solicitudId | pagoId })`, que toma el consultivo del DNI y
    las filas en el orden de la regla y devuelve lo bloqueado.
  - `dominio/total.ts` (`totalACobrar`), `dominio/numero-operacion.ts` (reexporta la de contratos) y
    `dominio/estado-pago.ts` (transiciones permitidas, puras).
  - `errores.ts`, `index.ts`.
- `backend/src/modulos/inscripciones/`: `estado-visible.ts` (reglas nuevas, también en SQL), `seguimiento.service.ts`
  (vistas nuevas), `solicitudes.service.ts` (lista con `ajuste` y `pago`, filtro `CONFIRMADAS`, cancelación con pagos),
  `foto.service.ts` (estados nuevos), `inscripciones.service.ts` (sesión de recepción: actor, `registrada_por`, sin el
  límite de 5).
- `backend/src/modulos/academias/proteccion-de-prefijos.ts` y `limite-inicio-sesion.ts`: sesión de recepción
  (criterio 33); **[007b]** regla `comprobante`.
- `backend/src/modulos/autenticacion/sesion-academia.service.ts`: una lectura de la sesión que no lanza (para el
  middleware de `/api/a`).
- `backend/src/modulos/usuarios/usuarios.service.ts`: `crearPersonal` con el consultivo del DNI y la comprobación de
  `alumnos` (DR-1). `crearEnTransaccion` no cambia.
- `backend/src/modulos/caja/head-sin-ruta.ts` **[007b]**: también `/api/pagos`.
- `backend/src/infraestructura/correo/enviador-correo.ts`: plantillas `PAGO_CONFIRMADO` y **[007b]** `PAGO_RECHAZADO`.
- `backend/src/infraestructura/registro/opciones-registro.ts` **[007b]**: `x-pago-datos` en `RUTAS_REDACTADAS`.
- `backend/src/crear-app.ts` **[007b]**: la ruta del comprobante en `noLeerCuerpoEn`, con el lector binario de la foto.
- `packages/contratos/src/`: `pagos.ts` (nuevo), `solicitudes.ts`, `permisos.ts`, **[007b]** `configuracion.ts`.
- `scripts/lib/rol-app.mjs`, `backend/test/utilidades/` (crear pagos como dueño junto con su movimiento).
- `frontend/src/modulos/solicitudes/` (cobro, ajuste, estados), `frontend/src/modulos/pagos/` (ticket; **[007b]**
  bandeja), `frontend/src/modulos/seguimiento/` (estados; **[007b]** formulario del comprobante y datos de pago),
  **[007b]** `frontend/src/modulos/configuracion/` (datos de pago), `frontend/src/modulos/panel/PaginaPanel.tsx`.
- `backend/prisma/seed.ts`, `docs/arquitectura.md`, `README.md`, guía de uso.

## Diseño

### Migraciones (007a)

1. `<marca>_estado_solicitud_confirmada`: solo `ALTER TYPE estado_solicitud ADD VALUE 'CONFIRMADA'`. Va sola porque
   PostgreSQL no deja usar un valor nuevo de un enum en la transacción que lo crea.
2. `<marca>_pagos`: tipo `estado_pago`; `UNIQUE (academia_id, id, alumno_id)` en `matriculas`; tabla `pagos` con sus
   `CHECK` (criterio 4), índices, RLS y políticas; llave de `movimientos_caja.pago_id`; `registrada_por` en
   `solicitudes_inscripcion`; funciones y triggers; privilegios.
   - **`pagos_transiciones`** (`BEFORE UPDATE`, por fila): si `OLD.estado <> 'PENDIENTE_VERIFICACION'`, rechaza con
     `23514`; si `NEW.estado = 'PENDIENTE_VERIFICACION'`, también (un pendiente solo sale a un estado resuelto).
   - **`pagos_confirmado_con_movimiento`** (trigger de restricción `AFTER INSERT OR UPDATE … DEFERRABLE INITIALLY
     DEFERRED`, por fila) en `pagos` y en `movimientos_caja`. Al confirmar: para un pago `CONFIRMADO`, cuenta los
     movimientos `INGRESO` con su `pago_id` y comprueba que sea uno y que coincidan alumno, método, monto y concepto;
     para un movimiento con `pago_id`, que su pago esté `CONFIRMADO`. Si no, `RAISE … USING ERRCODE = '23514'`. Las dos
     funciones son `SECURITY INVOKER`, con `search_path = pg_catalog, public` y `REVOKE ALL … FROM PUBLIC`; leen bajo la
     RLS de la transacción (el pago y su movimiento son de la misma academia por la llave compuesta).
   - El `CHECK` del número normalizado usa la expresión del criterio 4 d; el del monto, `monto > 0 AND monto <= 100000.00
     AND monto = round(monto, 2) AND monto <> 'NaN'`.
   - Las semillas y utilidades de pruebas que insertan movimientos con `pago_id` crean antes el pago (como dueño) en la
     misma transacción.

### Total a cobrar

`totalACobrar(matricula)` = `calcularTotal({ base: baseProporcional(precioPlan, clasesPorMesPlan, clasesTotales),
montoAjustado })`. Se usa en el cobro, la subida del comprobante, la lista del panel (en SQL se lee lo necesario y el
total se calcula en TypeScript), la vista de seguimiento y el ticket. Con `monto_ajustado` en soles enteros (DR-11), el
total es el ajuste.

### Cobro en efectivo (criterios 13 a 19)

1. **Antes de la transacción:** una lectura corta (`conAcademia`, sin bloqueos) trae el DNI del alumno de la solicitud
   (o 404). Se calcula `claveHash = hashearClave(dni)` (argon2, decenas de milisegundos). Si el alumno ya tiene cuenta
   (no debería, por el estado), la confirmación no la usa.
2. **Transacción** (`conAcademia`):
   1. `bloquearActorVigente(tx, actor)` (`FOR SHARE`).
   2. `bloquearFilasDelCobro`: `pg_advisory_xact_lock(hashtextextended('inscripcion-dni:' || academia || ':' || dni, 0))`
      → `alumnos` `FOR UPDATE` (y se comprueba que su DNI sea el leído; si no, 404) → la solicitud `FOR UPDATE` → su
      matrícula `FOR UPDATE` → sus pagos `FOR UPDATE` → `bloquearClasesParaCupo(tx, claseIds)` en una llamada.
   3. `const ahora = this.reloj.ahora()` **después** de bloquear las clases (DT-10). Toda decisión de la transacción usa
      este instante: estado visible, vigencia de la reserva, cupo, caja del día y `registrado_en`.
   4. Decisiones en el orden del contrato: clave de idempotencia (200 con lo registrado, o 409 `CLAVE_YA_USADA`), estado
      visible, `MONTO_CAMBIO` con `totalACobrar`, cupo y el DNI del personal (`SELECT EXISTS` en `usuarios`, sin
      bloqueo). El estado visible se calcula con `ahora`: si la reserva de una `PENDIENTE_PAGO` venció mientras el cobro
      esperaba las clases, la solicitud ya es `VENCIDA` y responde 409 `SOLICITUD_NO_COBRABLE` antes de llegar al cupo
      (criterio 18 b). Cupo: con `PENDIENTE_PAGO` la reserva es vigente en `ahora` y no se cuenta (criterio 18 a); solo
      con `PAGO_RECHAZADO` **[007b]** (matrícula `CANCELADA`) se cuenta con `contarOcupacion` sin esta matrícula y debe
      quedar lugar en todas sus clases, o 409 `SIN_CUPO` (criterio 18 c).
   5. Escrituras: `INSERT` del pago `CONFIRMADO` (con un `id` generado en la API) → `confirmarPagoEnTransaccion`.
3. **Después de confirmar:** el correo `PAGO_CONFIRMADO` con `enviarSinEsperar` (criterio 51 a). La respuesta lee el
   elemento del panel con la misma `tx` antes de cerrar.
4. **Errores de unicidad** (dos cobros con claves distintas que llegaran a la vez a pesar del bloqueo de las filas, o
   la clave repetida): el 409 sale del nombre del índice (`pagos_un_abierto_por_matricula` → `SOLICITUD_YA_PAGADA`,
   `pagos_academia_id_clave_idempotencia_key` → se relee en otra transacción para decidir entre 200 y
   `CLAVE_YA_USADA`, como el envío de la 005).

### `confirmarPagoEnTransaccion` (criterio 20)

Recibe la `tx` con todo ya bloqueado hasta las clases. En orden:

1. `registrarIngresoEnCaja(tx, { concepto, metodo, monto, alumnoId, pagoId, usuarioId: actor.id, ip }, ahora)`: bloquea
   la caja al final y lanza `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`.
2. `numero_ticket` = `coalesce(max(numero_ticket), 0) + 1` de la academia (seguro con la caja bloqueada: toda
   confirmación pasa por ella; el índice único es el respaldo, DT-13).
3. El pago queda `CONFIRMADO` y completo:
   - **efectivo:** `INSERT` del pago ya `CONFIRMADO`, con `verificado_por`, `verificado_en` y `numero_ticket`. Va después
     del movimiento porque el `CHECK` del criterio 4 exige el ticket en un `CONFIRMADO` y el efectivo no puede nacer
     pendiente (criterio 4 c);
   - **aprobación [007b]:** `UPDATE` del pago pendiente (estado, `verificado_por`, `verificado_en`, `numero_ticket`).

   Por eso la llave `movimientos_caja (academia_id, pago_id) → pagos (academia_id, id)` se declara `DEFERRABLE INITIALLY
   DEFERRED`: el movimiento del efectivo apunta a un pago que se inserta un instante después en la misma transacción. La
   llave y el trigger del criterio 5 se comprueban al `COMMIT`; si el pago no llega a existir o no queda `CONFIRMADO`, la
   transacción completa falla.
4. Si el alumno está en `CLIENTE`: `usuarios.crearEnTransaccion(tx, { dni, nombres, apellidos, rol: 'ALUMNO',
   claveHash }, { tipo: 'USUARIO', id: actor.id }, ip)` (su `ON CONFLICT` da `DNI_EN_USO`, que se traduce a
   `DNI_DEL_PERSONAL`) → `UPDATE alumnos SET estado = 'ALUMNO_ACTIVO', usuario_id`.
5. `UPDATE matriculas SET estado = 'VIGENTE', reserva_vence_en = NULL`; `UPDATE solicitudes_inscripcion SET estado =
   'CONFIRMADA'` (si tiene solicitud).
6. Auditoría del pago (`PAGO_REGISTRADO` o `PAGO_APROBADO`).

Todas las actualizaciones del paso 3 en adelante son de filas que la transacción ya bloqueó: no esperan a nadie aunque
vayan después de la caja (precisión de la regla de la 006, en «Impacto»).

### Ajuste del monto (criterios 11 y 12)

Transacción: actor → `bloquearFilasDelCobro` (sin el hash: el DNI para el consultivo se lee en la misma transacción
antes, sin bloqueo, porque no cambia) → estado visible con `ahora` → `UPDATE matriculas SET monto_ajustado,
motivo_ajuste` → auditoría. No bloquea clases (no mueve cupo). Al tomar las mismas filas que el cobro, ajuste y cobro se
ordenan (criterio 12).

### Estado visible y vistas (criterios 28 a 32)

`estadoVisible(datos, ahora)` suma a `DatosDelEstado` el estado del último pago y si hay uno pendiente, y el mes de la
matrícula (para `PAGO_RECHAZADO` frente a `VENCIDA`); `estadoVisibleSql` usa un `LEFT JOIN LATERAL` al último pago. La
consulta del seguimiento y la lista del panel leen el último pago en la misma consulta. La regla de la vista completa
(DR-14 de 005) sigue igual: la vigente del cliente es la única con estado visible distinto de `VENCIDA` y `CANCELADA`.

La cancelación (005b) bloquea los pagos de la matrícula después de la matrícula (orden de la regla) y responde los 409
nuevos antes de escribir. La foto suma los estados aceptados. El envío (005) ya cuenta como activa una matrícula con
`reserva_vence_en` nula; con `PAGO_RECHAZADO` la matrícula está `CANCELADA`, así que no es activa sin cambiar
`comprobarPersona`.

### Recepción y los límites (criterios 33 a 35)

- En el middleware de `/api/a`, antes de contar una regla de `LIMITES_PUBLICOS`: si la petición trae la cookie
  `aq_sesion`, se lee la sesión con una variante de `SesionAcademiaService` que devuelve `null` en vez de lanzar
  (firma del JWT, usuario activo, versión de token, academia activa, sin cambio pendiente). Si el rol es `ADMIN` o
  `SECRETARIA` y el nombre corto de la dirección es el de su academia (comparado con el nombre corto que la sesión ya
  lee de la academia, sin otra consulta), la petición no cuenta y se marca en `req` (`req.sesionDeRecepcion`). Si no, se
  cuenta como siempre. Una cookie con firma inválida no llega a la base.
- `InscripcionesService.enviar` recibe la sesión de recepción opcional: con ella, `bloquearActorVigente` como primera
  sentencia, sin el paso 6 (límite de 5), con `registrada_por` y con actor `USUARIO` en la auditoría.
  `reservasActivasDeLaConexion` excluye las solicitudes con `registrada_por` no nulo.
- La foto (005b) solo cambia el conteo del middleware.

### **[007b]** Subida del comprobante (criterios 36 a 44)

Se copia el esqueleto de `FotoService` (lector binario, orden de comprobaciones, guardar antes, borrar después,
relectura con `FOR SHARE` y `esperaMaximaDeBloqueoMs` si la confirmación es incierta):

1. Middleware: regla `comprobante` (10 por hora), tipo, codificación y tamaño.
2. Academia, `X-Pago-Datos` (`JSON.parse` de hasta 1024 bytes y `datosComprobanteSchema`), token (hash), lectura corta
   del estado y de la clave de idempotencia, imagen con `sharp` (recodificación a 2000 px, sin metadatos).
3. `AlmacenArchivos.guardar` con la clave `academias/{a}/pagos/{pagoId}/comprobante-{uuid}.jpg` (el `pagoId` se genera
   en la API antes).
4. Transacción: consultivo del DNI → alumno → solicitud → matrícula → pagos → (si es `PAGO_RECHAZADO`)
   `bloquearClasesParaCupo` y cupo → decisiones en el orden del criterio 37 (paso 10) → `INSERT` del pago pendiente →
   `UPDATE matriculas SET estado = 'RESERVADA', reserva_vence_en = NULL` → auditoría. Sin caja.
5. Si la transacción rechaza, se borra el archivo nuevo. Si el `INSERT` choca con `pagos_numero_operacion_abierto_key`,
   409 `NUMERO_OPERACION_YA_USADO` por el nombre del índice.

### **[007b]** Bandeja, comprobante, aprobación y rechazo (criterios 45 a 52)

- **Bandeja:** una consulta con `JOIN` a la matrícula, la solicitud y el alumno; `mesTerminado` con `hoyEnLima`.
- **Comprobante:** lectura corta del pago (método y clave) → `AlmacenArchivos.leer` fuera de la transacción → respuesta
  con las cabeceras del criterio 46.
- **Aprobación:** lectura corta (DNI y hash) → transacción: actor → `bloquearFilasDelCobro({ pagoId })` (sin clases) →
  decisiones (200 si ya `CONFIRMADO`; 409 si `RECHAZADO`) → `confirmarPagoEnTransaccion`. El hash se calcula aunque el
  pago termine en 200 (no se sabe antes); es aceptable.
- **Rechazo:** transacción: actor → filas → `bloquearClasesParaCupo` → `UPDATE pagos` (`RECHAZADO`) → `UPDATE
  matriculas` (`CANCELADA`, `reserva_vence_en = NULL`) → auditoría → después de confirmar, el correo `PAGO_RECHAZADO`.
- **`HEAD`:** `instalarHeadSinRutasDeCaja` pasa a recibir una lista de prefijos (`/api/cajas`, `/api/pagos`).

### Web

- `/panel/solicitudes`: diálogos «Cobrar en efectivo» (usa `GET /api/cajas/actual` para el aviso) y «Ajustar monto»;
  la tarjeta muestra el estado, el total, el ajuste y el último pago. Al cobrar, «Imprimir ticket» abre
  `/panel/pagos/{id}/ticket`.
- `/panel/pagos/{id}/ticket`: página con `@media print` para 80 mm y A4.
- **[007b]** `/panel/pagos`: bandeja con visor de imagen (pedida con `pedirArchivo` y URL de objeto liberada al
  desmontar), diálogos de aprobar y rechazar con su clave en el estado del diálogo.
- **[007b]** Seguimiento: formulario del comprobante (reutiliza `CampoFoto` para elegir y previsualizar), estados
  nuevos y datos de pago.

## Decisiones

Aceptadas por el orquestador el 24/11/2026 (DT-1 a DT-16 de la spec), con la spec aprobada por Bryan (DR-1 a DR-14).

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Tabla `pagos` completa en la 007a (DT-1) | Una migración por entrega | Las pruebas de catálogo y privilegios no cambian dos veces |
| La caja del pago es la de su movimiento, con trigger diferido (DT-2) | `pagos.caja_id` | Una sola fuente; el invariante «confirmado ⇔ movimiento» lo cuida la base |
| Llave `movimientos_caja.pago_id` diferida | Inmediata | El efectivo nace `CONFIRMADO` y completo después de registrar su movimiento |
| Trigger de transiciones (DT-3) | Solo el servicio | Ataque «aprobar un rechazado» también por escrituras directas |
| `CONFIRMADA` en la fila; `EN_VERIFICACION` y `PAGO_RECHAZADO` calculados (DT-4) | Tres estados en la fila | Un hecho, una fuente; el índice de la 005 sigue valiendo |
| Rechazo: matrícula `CANCELADA`; reintento a `RESERVADA` (DT-5) | `RESERVADA` vencida | El `CHECK` del fin de mes de la 005 y el estado visible de 005b |
| Comprobante en una petición binaria con `X-Pago-Datos` (DT-6) | Dos pasos, multipart o base64 | Atómica, reutiliza el lector y el orden de la foto |
| Recodificar a 2000 px sin metadatos (DT-7, DT-8) | Original u 800 px | Privacidad (GPS) y legibilidad |
| Escrito y normalizado del número (DT-9) | Solo normalizado | Evidencia de lo que escribió el cliente |
| «Ahora» del cobro después de bloquear las clases (DT-10); el perdedor de la carrera responde `SOLICITUD_NO_COBRABLE` | «Ahora» del inicio de la petición | Sin él, una reserva que vence durante el cobro deja la clase con uno de más |
| Sesión de recepción verificada en el middleware (DT-11) | Rutas del panel aparte | Un solo formulario y un solo servicio; el anónimo no cambia |
| `AJUSTAR_MONTO_COBRO` (DT-12) | Reusar un permiso de configuración | La matriz dice qué hace cada permiso |
| Ticket numerado con la caja bloqueada (DT-13) | Secuencia de PostgreSQL | La numeración es por academia |
| Ticket como página imprimible (DT-14) | PDF con `pdfkit` | Sin cola ni archivos (DR-4) |
| `HEAD` 404 en `/api/pagos` (DT-15) | `HEAD` con el manejador del `GET` | No leer archivos para no enviarlos (DT-9 de 006) |
| Consultivo del DNI en la confirmación y en la creación de personal (DT-16) | Solo el índice único | Ordena las dos sin esperar al final de una transacción larga |

## Precisiones de las pruebas (test-writer, 24/11/2026)

Decisiones técnicas tomadas al escribir las pruebas protegidas de la 007a. No cambian reglas de negocio.

- **Criterio 4 a:** se prueba con `monto` 0, negativo, `100000.01`, un millón y `NaN`. «Más de dos decimales» no es
  observable en la base: `numeric(10,2)` redondea al guardar, así que no hay prueba de ese caso en la base.
- **Criterio 1:** la prueba no fija la acción `ON DELETE` de la llave `movimientos_caja (academia_id, pago_id) → pagos
  (academia_id, id)`; solo exige que sea `DEFERRABLE INITIALLY DEFERRED`. La app no tiene `DELETE` en `pagos`.
- **Criterio 13, auditoría `PAGO_REGISTRADO`:** la prueba no exige `ip` en la fila de auditoría.
- **Criterio 18 b:** la prueba acepta 409 `SOLICITUD_NO_COBRABLE` o `SIN_CUPO`; según el orden de errores, la
  implementación responde `SOLICITUD_NO_COBRABLE` (ver «Cobro en efectivo», paso 4).
- **Pruebas de la 006 que fallan sin editarse:** las de `backend/test/integracion/caja/` que usan las utilidades
  ampliadas quedan en rojo hasta la migración de `pagos` (lista en la spec, «Pruebas protegidas anteriores que amplía
  la 007a»).

## Ronda adversarial 1 de la 007a (criterios 58 y 59)

### El trigger del criterio 5 no da por buena una transacción por no ver la fila (criterio 58)

**La falla.** `movimientos_caja_con_pago_confirmado` devolvía `NULL` cuando su `SELECT` no encontraba el pago, y
dejaba la decisión a la llave diferida `movimientos_caja_academia_id_pago_id_fkey`. Pero la llave no ve lo mismo:

- las comprobaciones de las llaves foráneas de PostgreSQL no pasan por la RLS;
- con `SET CONSTRAINTS pagos_confirmado_con_movimiento IMMEDIATE`, el trigger corre antes de que exista el pago y la
  llave, que sigue diferida, lo encuentra al `COMMIT`.

Además, `pagos_confirmado_con_movimiento` salía con `NEW.estado <> 'CONFIRMADO'`, así que nadie revisaba un pago
pendiente con movimiento.

**Diseño (migración nueva `<marca>_pagos_movimiento_confirmado`):**

1. **Comprobación cerrada por defecto.** Las dos funciones rechazan con `23514` (`CONSTRAINT =
   'pagos_confirmado_con_movimiento'`) cuando no encuentran la fila relacionada. Nunca devuelven `NULL` por no verla.
   Esto cubre el modo `IMMEDIATE` (criterio 58 b) y el cambio del contexto de la academia (58 c), porque con otro
   contexto la RLS esconde la fila.
2. **Leen el estado actual, no el de la fila del evento.** En un trigger diferido, `NEW` es la fila del momento del
   evento. Cada función vuelve a leer, por `id`, la fila que disparó el trigger y la relacionada:
   - si la fila del evento ya no existe (un `DELETE` posterior en la misma transacción), no hay nada que comprobar desde
     ella;
   - si existe, se comprueba con sus valores actuales.

   Así, el orden de las escrituras no importa (58 a) y el resultado es el mismo con cualquier secuencia que termine
   igual.
3. **`pagos`:** `AFTER INSERT OR UPDATE`, como ahora:
   - con el pago `CONFIRMADO`, exige exactamente un movimiento `INGRESO` igual (criterio 5);
   - con otro estado, exige que no haya ningún movimiento con su `pago_id` (58).

   Si la RLS esconde el movimiento, la segunda comprobación no lo ve, pero el trigger del movimiento rechaza por el
   punto 1. El invariante lo cubren los dos triggers juntos.
4. **`movimientos_caja`:** `AFTER INSERT OR UPDATE OR DELETE`, diferido y con el mismo nombre (58 d):
   - con `NEW.pago_id` no nulo, el pago tiene que existir, estar `CONFIRMADO` y coincidir;
   - en `UPDATE` y `DELETE` con `OLD.pago_id` no nulo, si ese pago sigue existiendo y está `CONFIRMADO`, tiene que
     seguir teniendo exactamente un movimiento `INGRESO` igual.

   El de `pagos` no se dispara cuando solo cambia el movimiento, así que esta segunda comprobación va aquí.
5. **Contexto de la academia, opcional como defensa extra.** Cada función puede comparar la `academia_id` de la fila con
   `app_academia_actual()` y rechazar con `23514` si no coincide o no hay contexto. El punto 1 ya basta para los casos de
   la ronda. Si se agrega, las utilidades de pruebas que escriben como dueño ya fijan `app.academia_id`.
6. **Lo que no cambia:**
   - las dos funciones siguen `SECURITY INVOKER`, con `search_path = pg_catalog, public` y `REVOKE ALL … FROM PUBLIC`
     (criterio 124 de 001);
   - se reemplazan con `CREATE OR REPLACE FUNCTION` y los mismos nombres, para que las listas de funciones de las
     pruebas de catálogo de 001 no cambien;
   - el trigger de `movimientos_caja` se borra y se vuelve a crear con el mismo nombre (`CREATE OR REPLACE TRIGGER` no
     sirve para triggers de restricción).
7. **El `23503` del criterio 3 se mantiene.** En el modo diferido, al `COMMIT`, PostgreSQL dispara los triggers de un
   mismo evento en el orden de sus nombres. La llave (`RI_ConstraintTrigger_…`) va antes que
   `pagos_confirmado_con_movimiento`, así que un `pago_id` que no existe sigue dando `23503`. La prueba protegida del
   criterio 3 no cambia y tiene que seguir pasando.

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Migración nueva con `CREATE OR REPLACE` | Editar `<marca>_pagos` | La migración puede estar aplicada en bases de desarrollo; Prisma detecta el cambio de su suma y obliga a rehacer la base |
| Rechazar cuando no se ve la fila | Leer sin RLS (`SECURITY DEFINER` o `row_security`) | Las tablas tienen la RLS forzada y la 001 no admite funciones `SECURITY DEFINER` nuevas; cerrar por defecto basta y no abre lecturas entre academias |
| Trigger de `movimientos_caja` también en `UPDATE` y `DELETE` | Solo `INSERT` | El dueño puede romper el invariante del criterio 5 por ahí (T20 de la spec, provisional) |

**Precisiones de las pruebas (criterio 58):**

- Se prueba como `app` y como `propietario`, con `ejecutarTransaccion` de `backend/test/utilidades/pagos.ts`. Los pagos
  pendientes o rechazados de Yape o transferencia se escriben como dueño cuando la app no puede (criterio 4 c y 6).
- **58 b:** la primera sentencia de la transacción es `SET CONSTRAINTS pagos_confirmado_con_movimiento IMMEDIATE`. La
  prueba acepta el `23514` en el `INSERT` del movimiento o en el `COMMIT`. Con `ALL IMMEDIATE`, acepta `23514` o `23503`.
- **58 c:** el `set_config` va justo antes del `COMMIT`, con `''` y con la academia B. Se comprueba, con otra conexión
  y el contexto de A, que no quedó ni el pago ni el movimiento.
- **58 d:** como dueño, sobre un pago `CONFIRMADO` con su movimiento ya guardados. Cada caso va en su propia transacción.
  Después se comprueba que el pago y su movimiento siguen iguales.
- **58 e:** son controles: tienen que pasar antes y después de la corrección.

### El generador de ids de la auditoría valida antes de tocar su estado (criterio 59)

**La falla.** `Math.max(NaN, ultimoMilisegundo)` da `NaN`, `NaN === ultimoMilisegundo` es falso, el contador vuelve a 0 y
`ultimoMilisegundo` queda en `NaN` para siempre. Desde ahí, todas las ids salen con `NaN` en el texto.

**Diseño:**

1. Validar la entrada antes de leer el estado:
   - `fechaHora instanceof Date`;
   - `Number.isFinite(t)`, con `t = fechaHora.getTime()`;
   - `t >= 0` y `t <= 2 ** 48 - 1`.

   Si no se cumple, `throw new RangeError(…)`. El mensaje no lleva la fecha.
2. Calcular el milisegundo y el contador nuevos en variables locales, incluido el desborde del contador al milisegundo
   siguiente. Si ese milisegundo pasa de `2 ** 48 - 1`, `RangeError` (criterio 59 c).
3. Solo entonces asignar `ultimoMilisegundo` y `contador`, y armar el texto.
4. `insercion.ts` no cambia: el `RangeError` sale antes de ejecutar el `INSERT` y revierte la transacción de quien
   audita.

**Precisiones de las pruebas (criterio 59):** prueba unitaria protegida en
`backend/src/modulos/auditoria/id-ordenado.test.ts`, junto a `ip.test.ts`. El estado es del módulo, así que cada caso que
necesite un generador limpio lo importa de nuevo con `vi.resetModules()` y un `import()` dinámico. La comparación «mayor
como texto» es la de `<` entre cadenas: las ids tienen hexadecimales en minúscula y ancho fijo. Casos:

- `new Date(NaN)`, `new Date(-1)`, `new Date(2 ** 48)`, `'2026-11-24'` y `0` (estos dos, con
  `as unknown as Date`);
- una id válida antes y varias después de cada rechazo;
- 5000 llamadas con la misma fecha;
- una fecha anterior a la última;
- en un módulo recién importado, 4097 llamadas con `new Date(2 ** 48 - 1)`: las 4096 primeras devuelven ids válidas
  y crecientes, y la 4097.ª lanza `RangeError`. Una llamada más, con esa fecha o con una anterior, vuelve a lanzar:
  el estado quedó en el máximo y no hay un id mayor que dar (criterio 59 c). Este caso va en su propio módulo
  importado, para no afectar a los demás.

## Migraciones

- `<marca>_estado_solicitud_confirmada` (007a): un valor de enum, sin datos.
- `<marca>_pagos` (007a): tabla, tipo, índices, `CHECK`, triggers, RLS, privilegios, llave de
  `movimientos_caja.pago_id` (diferida) y `registrada_por`. Las bases de desarrollo no tienen movimientos con `pago_id`
  (la semilla de la 006 solo tiene un egreso), así que la llave se agrega sin limpiar datos. Si alguna base de
  desarrollo tuviera ingresos de pruebas manuales, la migración fallaría: se documenta en la guía de Windows
  («Problemas frecuentes»: rehacer la base de desarrollo).
- `<marca>_pagos_movimiento_confirmado` (007a, ronda adversarial 1, criterio 58): solo funciones y el trigger de
  `movimientos_caja`. Sin datos. Si una base de desarrollo tuviera un movimiento que rompe el invariante, la migración
  no falla: el trigger solo revisa escrituras nuevas.
- **[007b]** sin migración.

## Riesgos

- **Trigger diferido y RLS:** el trigger corre al `COMMIT` con el contexto de la transacción (`set_config(…, true)` sigue
  vigente hasta el final). Se prueba como app y como dueño (criterio 5). La ronda adversarial 1 mostró que ese contexto
  se puede cambiar antes del `COMMIT` y que el modo se puede pasar a `IMMEDIATE`. Por eso las funciones rechazan cuando
  no ven la fila relacionada (criterio 58).
- **Pruebas protegidas anteriores:** la tabla nueva, los privilegios, la llave y el trigger de `pago_id` y las claves
  nuevas del panel rompen pruebas de 001, 002, 005 y 006. Se amplían solo sumando en el commit de pruebas protegidas de
  la 007a, según la lista de la spec («Decisiones», «Pruebas protegidas anteriores que amplía la 007a»), con la
  aprobación del orquestador. Tres casos no son solo una suma; el orquestador los aprobó como DT-17 a DT-19 de la spec.
- **Hash antes de saber si hace falta:** la aprobación de un pago ya confirmado calcula un argon2 de más; no cambia el
  resultado.
- **Duración de la transacción del cobro:** toma el consultivo, cinco tablas, las clases y la caja; la caja serializa los
  cobros de la academia (riesgo ya aceptado en la 006).
- **El middleware lee la sesión en las rutas públicas:** una consulta más por petición con cookie válida. Con cookie
  inválida no toca la base.
