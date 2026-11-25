# 007 · Plan técnico

Plan de la spec [`spec.md`](spec.md). Los números son criterios de esa spec; «de 005», «de 006», etc., los de esas
historias. Lo marcado **[007b]** va en el segundo PR.

## Módulos afectados

- `backend/prisma/migrations/<marca>_estado_solicitud_confirmada/` y `<marca>_pagos/` (007a), y `schema.prisma`. Desde la
  ronda adversarial 1 de la 007a, `<marca>_pagos_movimiento_confirmado/` (criterio 58).
- `backend/src/modulos/auditoria/id-ordenado.ts` (rondas adversariales 1 a 3 de la 007a, criterio 59; endurecimiento
  de la ronda 4, criterio 59 e).
- `backend/src/modulos/pagos/` (nuevo):
  - `pagos.module.ts`, `pagos.controller.ts` (ticket; **[007b]** bandeja, comprobante, aprobación y rechazo),
    `cobros.service.ts` (cobro en efectivo y ajuste), **[007b]** `verificacion.service.ts`, **[007b]**
    `comprobante.service.ts` (subida pública) y su controlador público.
  - `confirmacion.ts` (sin Nest): `confirmarPagoEnTransaccion(tx, usuarios, entrada, ahora)` (criterio 20).
  - `bloqueos.ts` (sin Nest): `leerDniDeLaSolicitud(tx, solicitudId)` (lectura sin bloqueos) y
    `bloquearFilasDelCobro(tx, { solicitudId, alumnoId, dni })`, que con el DNI ya leído toma el consultivo del DNI y
    las filas en el orden de la regla y devuelve lo bloqueado. **[007b]** la variante por `pagoId`.
  - `dominio/total.ts` (`totalACobrar`) y `dominio/numero-operacion.ts` (reexporta la de contratos).
    `dominio/estado-pago.ts` no está en la 007a: se eliminó por no usarse (el trigger `pagos_transiciones` y las
    decisiones de los servicios cubren las transiciones); la 007b lo recrea con su prueba si lo necesita («Notas para
    la 007b»).
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
- `packages/contratos/src/`: `pagos.ts` (nuevo; `cobrarEnEfectivoSchema` con `montoCotizadoSchema`), `solicitudes.ts`
  (también el esquema de la respuesta del cobro, junto a `respuestaSolicitudPanelSchema`), `permisos.ts`, **[007b]**
  `configuracion.ts`.
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

`totalACobrar({ montoCalculado, montoAjustado })`:

- **sin ajuste**, el `monto_calculado` guardado en la matrícula (el valor cotizado al cliente al inscribirse), sin
  recalcular con el plan. En el código pasa por `calcularTotal({ base: baseProporcional(montoCalculado, 1, 1) })`, que
  lo deja igual (la 005 lo guarda ya redondeado al sol entero; uno con céntimos escrito como dueño se redondearía hacia
  arriba);
- **con ajuste**, `calcularTotal` con `montoAjustado` (con ajuste la base no cuenta, así que no hace falta el plan). Con `monto_ajustado` en soles enteros (DR-11), el total es el ajuste; uno con céntimos escrito como dueño se
  redondea hacia arriba (DT-17).

`montoCalculado` es obligatorio en la entrada, para que ningún llamador caiga sin querer en el recálculo. Se usa en el
cobro, la subida del comprobante, la lista del panel (en SQL se lee lo necesario y el total se calcula en TypeScript),
la vista de seguimiento y el ticket.

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Sin ajuste, el total es `monto_calculado` (alineación con la revisión de la 007a) | Recalcular con `baseProporcional` y lo guardado | Es lo que se cotizó al cliente; los dos dan lo mismo por construcción, pero la columna guardada es la fuente única |

### Cobro en efectivo (criterios 13 a 19)

1. **Antes de la transacción:** una lectura corta (`conAcademia`, sin bloqueos) con `leerDniDeLaSolicitud` trae el
   alumno y el DNI de la solicitud (o 404). Se calcula `claveHash = hashearClave(dni)` (argon2, decenas de
   milisegundos) si el alumno es `CLIENTE`. Si el alumno ya tiene cuenta (no debería, por el estado), la confirmación
   no la usa.
2. **Transacción** (`conAcademia`):
   1. `bloquearActorVigente(tx, actor)` (`FOR SHARE`).
   2. `bloquearFilasDelCobro(tx, { solicitudId, alumnoId, dni })`, con el alumno y el DNI de la lectura corta:
      `pg_advisory_xact_lock(hashtextextended('inscripcion-dni:' || academia || ':' || dni, 0))` → `alumnos` `FOR UPDATE`
      (y se comprueba que su DNI sea el leído; si no, 404) → la solicitud `FOR UPDATE` → su matrícula `FOR UPDATE` → sus
      pagos `FOR UPDATE`. Después, `bloquearClasesParaCupo(tx, claseIds)` en una llamada.
   3. `const ahora = this.reloj.ahora()` **después** de bloquear las clases (DT-10). Toda decisión de la transacción usa
      este instante: estado visible, vigencia de la reserva, cupo, caja del día y `registrado_en`.
   4. Decisiones en el orden del contrato: clave de idempotencia (200 con lo registrado, o 409 `CLAVE_YA_USADA`), estado
      visible, `MONTO_CAMBIO` con `totalACobrar` y cupo. El DNI del personal (`SELECT EXISTS` en `usuarios`, sin
      bloqueo) lo decide `confirmarPagoEnTransaccion` en su primer paso, antes de la caja. El estado visible se calcula con `ahora`: si la reserva de una `PENDIENTE_PAGO` venció mientras el cobro
      esperaba las clases, la solicitud ya es `VENCIDA` y responde 409 `SOLICITUD_NO_COBRABLE` antes de llegar al cupo
      (criterio 18 b). Cupo: con `PENDIENTE_PAGO` la reserva es vigente en `ahora` y no se cuenta (criterio 18 a); solo
      con `PAGO_RECHAZADO` **[007b]** (matrícula `CANCELADA`) se cuenta con `contarOcupacion` sin esta matrícula y debe
      quedar lugar en todas sus clases, o 409 `SIN_CUPO` (criterio 18 c).
   5. Escrituras: `confirmarPagoEnTransaccion(tx, usuarios, { pagoId, alumnoId, matriculaId, solicitudId, concepto:
      'INSCRIPCION', metodo: 'EFECTIVO', monto: total, claveHash, actor, ip, nuevo: { claveIdempotencia } }, ahora)`,
      con un `pagoId` generado en la API. Con `nuevo`, la confirmación inserta el pago ya `CONFIRMADO`.
3. **Después de confirmar:** el correo `PAGO_CONFIRMADO` con `enviarSinEsperar` (criterio 51 a). La respuesta lee el
   elemento del panel con la misma `tx` antes de cerrar.
4. **Errores de unicidad** (dos cobros con claves distintas que llegaran a la vez a pesar del bloqueo de las filas, o
   la clave repetida): el 409 sale del nombre del índice (`pagos_un_abierto_por_matricula` → `SOLICITUD_YA_PAGADA`,
   `pagos_academia_id_clave_idempotencia_key` → se relee en otra transacción para decidir entre 200 y
   `CLAVE_YA_USADA`, como el envío de la 005).

### `confirmarPagoEnTransaccion` (criterio 20)

Firma: `confirmarPagoEnTransaccion(tx, usuarios, entrada, ahora)` (`backend/src/modulos/pagos/confirmacion.ts`).
`usuarios` es `Pick<UsuariosService, 'crearEnTransaccion'>` (`CreadorDeCuentas`), para no depender de Nest. `entrada`
lleva `pagoId`, `alumnoId`, `matriculaId`, `solicitudId`, `concepto`, `metodo`, `monto` (el total a cobrar),
`claveHash`, `actor`, `ip` y, solo si el pago se crea al confirmar (el efectivo), `nuevo: { claveIdempotencia }`. La
firma completa está en la spec («Interfaces del backend»).

Recibe la `tx` con todo ya bloqueado hasta las clases. En orden:

1. Si el alumno es `CLIENTE` sin cuenta: `SELECT EXISTS` de un usuario de la academia con su DNI, sin bloqueo; si lo hay,
   409 `DNI_DEL_PERSONAL` sin escribir (va antes de la caja, como en el orden de errores del contrato).
2. `registrarIngresoEnCaja(tx, { concepto, metodo, monto, alumnoId, pagoId, usuarioId: actor.id, ip }, ahora)`: bloquea
   la caja al final y lanza `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`.
3. `numero_ticket` = `coalesce(max(numero_ticket), 0) + 1` de la academia (seguro con la caja bloqueada: toda
   confirmación pasa por ella; el índice único es el respaldo, DT-13).
4. El pago queda `CONFIRMADO` y completo:
   - **efectivo (con `nuevo`):** `INSERT` del pago ya `CONFIRMADO`, con `verificado_por`, `verificado_en`,
     `numero_ticket` y la clave de idempotencia. Va después del movimiento porque el `CHECK` del criterio 4 exige el
     ticket en un `CONFIRMADO` y el efectivo no puede nacer pendiente (criterio 4 c);
   - **aprobación [007b] (sin `nuevo`):** `UPDATE` del pago pendiente (estado, `verificado_por`, `verificado_en`,
     `numero_ticket`).

   Por eso la llave `movimientos_caja (academia_id, pago_id) → pagos (academia_id, id)` se declara `DEFERRABLE INITIALLY
   DEFERRED`: el movimiento del efectivo apunta a un pago que se inserta un instante después en la misma transacción. La
   llave y el trigger del criterio 5 se comprueban al `COMMIT`; si el pago no llega a existir o no queda `CONFIRMADO`, la
   transacción completa falla.
5. Si el alumno está en `CLIENTE`: `usuarios.crearEnTransaccion(tx, { dni, nombres, apellidos, rol: 'ALUMNO',
   claveHash }, { tipo: 'USUARIO', id: actor.id }, ip)` (su `ON CONFLICT` da `DNI_EN_USO`, que se traduce a
   `DNI_DEL_PERSONAL`) → `UPDATE alumnos SET estado = 'ALUMNO_ACTIVO', usuario_id`.
6. `UPDATE matriculas SET estado = 'VIGENTE', reserva_vence_en = NULL`; `UPDATE solicitudes_inscripcion SET estado =
   'CONFIRMADA'` (si tiene solicitud).
7. Auditoría del pago (`PAGO_REGISTRADO` con `nuevo`, `PAGO_APROBADO` sin él).

Todas las actualizaciones del paso 4 en adelante son de filas que la transacción ya bloqueó: no esperan a nadie aunque
vayan después de la caja (precisión de la regla de la 006, en «Impacto»).

### Ajuste del monto (criterios 11 y 12)

Transacción: actor → `leerDniDeLaSolicitud` (en la misma transacción, sin bloqueo y sin hash: el DNI no cambia) →
`bloquearFilasDelCobro(tx, { solicitudId, alumnoId, dni })` → estado visible con `ahora` → `UPDATE matriculas SET monto_ajustado,
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
- **Aprobación:** lectura corta (el alumno y el DNI leídos desde el pago, y el hash) → transacción: actor → la variante
  de `bloquearFilasDelCobro` por `pagoId` (sin clases; ver «Notas para la 007b») → decisiones (200 si ya `CONFIRMADO`;
  409 si `RECHAZADO`) → `confirmarPagoEnTransaccion(tx, usuarios, { …, metodo: el del pago, monto: el del pago, sin
  nuevo }, ahora)`. El hash se calcula aunque el pago termine en 200 (no se sabe antes); es aceptable.
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
- La respuesta del cobro (`{ pago, solicitud }`) se valida con el esquema de `packages/contratos/src/solicitudes.ts`
  (spec, «Esquemas compartidos»), no con uno propio de la web.

### Semilla (007a, criterio 57)

En `delfines`, un ajuste de monto con motivo en una solicitud de ejemplo, escrito directamente en la matrícula
(`monto_ajustado` y `motivo_ajuste`) sin pasar por la API. No escribe `MATRICULA_MONTO_AJUSTADO` en la auditoría, como
el resto de los datos de ejemplo: la auditoría registra operaciones de personas por la API. Repetir la semilla no lo
duplica ni pisa un ajuste editado. Lo comprueba una prueba no protegida de la semilla (T24).

## Notas para la 007b (de la revisión de la 007a, 24/11/2026)

- **Valores por defecto sin pruebas en el seguimiento.** `backend/src/modulos/inscripciones/seguimiento.service.ts`
  arma las vistas con valores de reserva cuando falta el último pago:
  - en la rama `CONFIRMADA` (líneas 176 y 179): `metodo: fila.pago_metodo ?? 'EFECTIVO'` y
    `numeroTicket: fila.pago_numero_ticket ?? 0`. En la 007a una solicitud `CONFIRMADA` siempre tiene su pago en
    efectivo, así que no se llega al valor por defecto; con la aprobación de la 007b el método puede ser `YAPE` o
    `TRANSFERENCIA`;
  - en la rama `EN_VERIFICACION` (líneas 190 y 192): `metodo: fila.pago_metodo ?? 'YAPE'` y
    `fechaOperacion: fila.pago_fecha_operacion ?? ''`. Es una rama de la 007b, todavía sin pruebas.

  Al implementar la 007b se revisan: ninguna vista debe mostrar un método, una fecha o un ticket inventados.
  Propuesta: que esas ramas solo se alcancen con el pago presente (si falta, error del servidor en lugar de un valor
  por defecto), con pruebas de cada estado.
- **`dominio/estado-pago.ts`.** Se eliminó en la 007a porque nada lo usaba. Si la aprobación y el rechazo de la 007b
  necesitan las transiciones permitidas como función pura, la 007b lo recrea junto con su prueba unitaria.
- **`bloquearFilasDelCobro` por `pagoId`.** La 007a solo tiene la variante por solicitud, que recibe el DNI ya leído. La
  aprobación y el rechazo necesitan una variante por `pagoId` que lea antes, sin bloqueos, el alumno y el DNI desde el
  pago (pago → alumno) y bloquee en el mismo orden (consultivo del DNI → alumno → solicitud, si hay → matrícula →
  pagos).
- **La vista `CONFIRMADA` lee el pago confirmado, no el último pago** (de la ronda adversarial 3 de la 007a,
  25/11/2026). En la 007a la matrícula de una solicitud `CONFIRMADA` tiene un solo pago, así que «último pago» y «pago
  confirmado» coinciden. Con la 007b, una matrícula puede tener un Yape `RECHAZADO` y después el pago `CONFIRMADO`, y
  el «último» se elige por `registrado_en`, que sale del reloj de la instancia que atendió cada petición. Con varias
  instancias de la API y relojes distintos, el rechazado puede quedar con un `registrado_en` posterior al del
  confirmado: si la consulta del seguimiento toma el último pago, la rama `CONFIRMADA` recibe el rechazado (sin
  ticket, otro método) y la vista falla o muestra datos que no son los del cobro. Al implementar la 007b:
  - la rama `CONFIRMADA` del seguimiento (y cualquier otra vista que muestre el método, el monto o el ticket del cobro)
    busca el pago `CONFIRMADO` de la matrícula, que es uno solo (criterio 5 y el índice de un pago abierto por
    matrícula), en lugar del último pago;
  - el «último pago» queda solo para lo que de verdad depende del intento más reciente (`EN_VERIFICACION`,
    `PAGO_RECHAZADO`); si allí también importa el orden entre intentos, desempatar por estado (un pago abierto antes que
    uno rechazado) y no solo por `registrado_en`;
  - una prueba de la 007b con un `RECHAZADO` cuyo `registrado_en` es posterior al del `CONFIRMADO` de la misma
    matrícula comprueba que la vista `CONFIRMADA` muestra el método, el monto y el ticket del confirmado. Va con la
    revisión de los valores por defecto de la primera nota (T38).

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

   **Corrección al implementar T49 (24/11/2026).** Este punto suponía mal: `movimientos_caja` tiene la RLS activada y
   forzada con políticas solo de `SELECT` e `INSERT` (006). Sin política de `UPDATE` ni de `DELETE`, un `UPDATE` o un
   `DELETE` del dueño no alcanza ninguna fila, termina sin error con 0 filas y el trigger por fila nunca corre. 58 d
   quedaba sin cubrir. Lo implementado:
   - un segundo trigger en `movimientos_caja`, `movimientos_caja_no_cambian`, `BEFORE UPDATE OR DELETE FOR EACH
     STATEMENT`, con la misma función `movimientos_caja_con_pago_confirmado()`. Con `TG_LEVEL = 'STATEMENT'` la función
     rechaza de entrada con `23514` (`CONSTRAINT = 'pagos_confirmado_con_movimiento'`). Un trigger por sentencia corre
     aunque la sentencia no alcance ninguna fila, así que el rechazo no depende de la RLS;
   - el rechazo es incondicional: todo `UPDATE` o `DELETE` sobre `movimientos_caja`, con o sin `pago_id`, ingreso o
     egreso. Es coherente con DR-5 de 006 («los movimientos no cambian»). Falla en la sentencia, no al `COMMIT`;
   - el trigger por fila sigue siendo `AFTER INSERT OR UPDATE OR DELETE` y la revisión de `OLD.pago_id` queda como
     defensa en profundidad, por si algún día se agregan políticas de `UPDATE` o `DELETE` o se quita el trigger por
     sentencia;
   - la app sigue recibiendo `42501`: PostgreSQL comprueba el privilegio antes de disparar los triggers;
   - `TRUNCATE` del dueño no se cubre: no dispara triggers de `UPDATE` ni `DELETE` y lo usa la limpieza de las pruebas
     (`limpiarBase` de 001). Es el mismo alcance que en la 006.
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
| Trigger por sentencia `movimientos_caja_no_cambian` (`BEFORE UPDATE OR DELETE FOR EACH STATEMENT`) que rechaza todo `UPDATE` o `DELETE` | Agregar a `movimientos_caja` políticas de RLS de `UPDATE` y `DELETE` para que el trigger por fila alcance las filas | Las pruebas protegidas de la 006 (`caja/tablas.test.ts`, `aislamiento/forma-politicas`) exigen que `movimientos_caja` tenga solo políticas de `SELECT` e `INSERT`; cambiarlas no es solo sumar. Además, una política de `UPDATE` o `DELETE` abriría una vía de escritura que DR-5 de 006 cierra, y el trigger por sentencia corre aunque la RLS no deje ver ninguna fila |
| Rechazo incondicional de `UPDATE` y `DELETE` | Rechazar solo los que rompen el invariante del criterio 5 | Un trigger por sentencia no ve las filas (sin políticas, la sentencia no alcanza ninguna); los movimientos no cambian (DR-5 de 006), así que no hay escritura legítima que se pierda |
| `TRUNCATE` sin trigger | Un trigger `BEFORE TRUNCATE` | Lo usa la limpieza de las pruebas (`limpiarBase` de 001); la app no tiene el privilegio; mismo alcance que la 006 |

**Precisiones de las pruebas (criterio 58):**

- Se prueba como `app` y como `propietario`, con `ejecutarTransaccion` de `backend/test/utilidades/pagos.ts`. Los pagos
  pendientes o rechazados de Yape o transferencia se escriben como dueño cuando la app no puede (criterio 4 c y 6).
- **58 b:** la primera sentencia de la transacción es `SET CONSTRAINTS pagos_confirmado_con_movimiento IMMEDIATE`. La
  prueba acepta el `23514` en el `INSERT` del movimiento o en el `COMMIT`. Con `ALL IMMEDIATE`, acepta `23514` o `23503`.
- **58 c:** el `set_config` va justo antes del `COMMIT`, con `''` y con la academia B. Se comprueba, con otra conexión
  y el contexto de A, que no quedó ni el pago ni el movimiento.
- **58 d:** como dueño, sobre un pago `CONFIRMADO` con su movimiento ya guardados. Cada caso va en su propia transacción.
  Después se comprueba que el pago y su movimiento siguen iguales. El `23514` sale en la sentencia (trigger por
  sentencia); la prueba lo acepta en la sentencia o en el `COMMIT`.
- **58 e:** son controles: tienen que pasar antes y después de la corrección.

### El generador de ids de la auditoría valida antes de tocar su estado (criterio 59)

**La falla.** `Math.max(NaN, ultimoMilisegundo)` da `NaN`, `NaN === ultimoMilisegundo` es falso, el contador vuelve a 0 y
`ultimoMilisegundo` queda en `NaN` para siempre. Desde ahí, todas las ids salen con `NaN` en el texto.

**Diseño:**

1. Validar la entrada antes de leer el estado (la primera comprobación se reemplazó en las rondas 2 y 3: ver «Rondas
   adversariales 2 y 3 de la 007a»):
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

## Rondas adversariales 2 y 3 de la 007a (criterio 59 d)

### Un `Date` se reconoce por su ranura interna, no por `instanceof`

**Las fallas.**

- **Ronda 2 (pruebas e80d5ae):** el punto 1 del diseño de la ronda 1 usaba `fechaHora instanceof Date` y después
  `fechaHora.getTime()`. Un objeto con el prototipo de `Date` sin su valor interno pasaba `instanceof` y su `getTime`
  lanzaba `TypeError`, lanzaba otro error o devolvía lo que quisiera. Se corrigió leyendo el instante con
  `Date.prototype.getTime.call(fechaHora)` dentro de un `try`/`catch`, pero se dejó `instanceof Date` delante, fuera
  del `try`.
- **Ronda 3:** ese `instanceof` que quedó fuera del `try` produce las dos fallas:
  - `instanceof` consulta el prototipo del valor. Con un `Proxy` revocado lanza `TypeError`; con un `Proxy` cuya trampa
    `getPrototypeOf` lanza, propaga el error de la trampa. Ninguno es `RangeError` (criterio 59 a);
  - un `Date` real de otro contexto (`vm.runInNewContext`) tiene otro `Date.prototype`, y uno con el prototipo cambiado
    (`Object.setPrototypeOf(new Date(t), null)`) ya no hereda de `Date.prototype`. Los dos fallan `instanceof Date` y se
    rechazan, aunque tienen la ranura y un instante válido (criterio 59 b y d).

**Diseño (solo `backend/src/modulos/auditoria/id-ordenado.ts`):**

1. Se quita `fechaHora instanceof Date`. La única operación sobre el valor es `getTime.call(fechaHora)`, con el `getTime`
   de `Date.prototype` guardado en una constante del módulo al cargarlo (`const leerInstante = Date.prototype.getTime`),
   dentro del `try`. Si lanza (primitivo, `null`, objeto sin la ranura, `Proxy` de lo que sea, revocado o no), el
   `catch` lanza `RangeError('La fecha de la auditoría no es un Date.')` sin la causa ni la fecha.
   - `Date.prototype.getTime` comprueba la ranura `[[DateValue]]` del valor y no consulta su prototipo ni sus
     propiedades, así que no dispara trampas de un `Proxy` ni un `getTime` propio. Un `Proxy` no tiene la ranura, aunque
     envuelva un `Date`: lanza y se rechaza.
   - La ranura no depende del contexto ni del prototipo: un `Date` de `vm`, con el prototipo cambiado o de una subclase
     da su instante.
2. El resto queda igual: `Number.isSafeInteger(instante)`, el rango `0 … 2 ** 48 - 1`, el estado nuevo en variables
   locales y la asignación al final (criterio 59 a a c).
3. No hace falta `util.types.isDate`: coincide con lo que acepta `getTime.call` y sumarlo sería una segunda decisión
   que podría separarse de la primera. Si se usa, va antes y dentro del mismo `try`, y no reemplaza a `getTime.call`
   (el instante sale de ahí).
4. El comentario de la función y el `@throws` se actualizan: «un valor sin la ranura de fecha», no «un valor que no es
   un `Date`» en el sentido de `instanceof`.

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Solo `Date.prototype.getTime.call` dentro de un `try` | `instanceof Date` dentro del `try` | Corrige el `TypeError` del `Proxy`, pero sigue rechazando los `Date` reales de otro contexto o con el prototipo cambiado (criterio 59 d) |
| `getTime` capturado al cargar el módulo | `Date.prototype.getTime` leído en cada llamada | Endurecimiento, no garantía: evita que un `Date.prototype.getTime` reemplazado más tarde por descuido cambie la decisión, sin costo. El código del mismo proceso que modifica objetos nativos queda fuera del modelo de amenaza (criterio 59 e; ver «Ronda adversarial 4 de la 007a») |
| Sin `util.types.isDate` | `util.types.isDate` y después `getTime.call` | Dos comprobaciones de lo mismo; la de Node no da el instante y no agrega casos |
| Sin `Object.prototype.toString.call(valor) === '[object Date]'` | Esa comprobación | Lee `Symbol.toStringTag` (falsificable y, en un `Proxy`, una trampa `get` que puede lanzar) |

**Precisiones de las pruebas (criterio 59 d):** prueba unitaria protegida nueva,
`backend/src/modulos/auditoria/id-ordenado-ronda3.test.ts`, con la marca `// spec: 007-pagos (pruebas protegidas)` y su
propio `generadorLimpio()` (el mismo `vi.resetModules()` e `import()` dinámico de `id-ordenado.test.ts`). Así el
`git diff` de la ronda no toca el archivo protegido de las rondas 1 y 2. `T0` es `2026-11-24T15:00:00.000Z`. Casos:

- **Lanzan `RangeError`** (con `toThrow(RangeError)`, que no acepta un `TypeError` ni un `Error`), cada uno con una id
  válida antes y varias después, todas con el formato, distintas y crecientes:
  - un `Proxy` revocado (`Proxy.revocable(new Date(T0), {})`, después `revoke()`);
  - un `Proxy` de `new Date(T0)` cuya trampa `getPrototypeOf` lanza un `Error` propio;
  - un `Proxy` de `new Date(T0)` cuyas trampas `get`, `has` y `getOwnPropertyDescriptor` lanzan;
  - un `Proxy` de `new Date(T0)` sin trampas;
  - un `Proxy` de un objeto con el prototipo de `Date` y un `getTime` propio que devuelve `T0`;
  - un `bigint` (`0n`), un símbolo y `true` (con `as unknown as Date`).
- **Devuelven una id válida** con los milisegundos de la ranura (`milisegundosDe(id) === t`), mayor que la anterior:
  - `vm.runInNewContext('new Date(' + T0.getTime() + ')')` (de `node:vm`);
  - `Object.setPrototypeOf(new Date(T0), null)` y `Object.setPrototypeOf(new Date(T0), {})`;
  - una instancia de `class FechaPropia extends Date {}` con `T0`;
  - `new Date(T0)` con un `getTime` propio que devuelve `5`: la id lleva los milisegundos de `T0`, no 5.
- **Con un instante no válido se rechazan igual:** `vm.runInNewContext('new Date(NaN)')` y
  `Object.setPrototypeOf(new Date(-1), null)` lanzan `RangeError`, y la id siguiente es válida y mayor que la anterior.
- **Los datos de la prueba son lo que dicen ser:** antes de cada caso de «devuelven una id válida», la prueba confirma
  con `util.types.isDate(valor)` que el valor es un `Date` según 59 d; en los de «lanzan», que no lo es. Los valores
  con trampas que lanzan se crean dentro de cada caso y no se pasan a los nombres de las pruebas ni a los mensajes de
  `expect` (imprimirlos dispararía las trampas).

**Estado:** pruebas protegidas 820cd22 (en rojo), corrección 65aa1f0.

## Ronda adversarial 4 de la 007a (criterio 59 e)

**Resultado (25/11/2026): cerrada sin fallas dentro del modelo de amenaza.** Con todas las entradas de 59 a a d no hubo
fallas (9105 ids correctas). Solo encontró dos fallas que exigen que código del mismo proceso modifique objetos nativos
después de cargar el módulo:

1. redefinir `Date.prototype.getTime.call` o `Function.prototype.call` hace que cualquier valor pase como `Date`;
2. reemplazar `Number.isSafeInteger` deja pasar `NaN` y daña el estado del generador.

El orquestador decidió que ese código está fuera del modelo de amenaza del criterio 59 (59 e): ya podría reemplazar el
propio módulo. No hay criterio protegido nuevo ni prueba protegida nueva.

**Endurecimiento (solo `backend/src/modulos/auditoria/id-ordenado.ts`, sin prueba protegida):**

- `const leerInstante = Function.prototype.call.bind(Date.prototype.getTime)` al cargar el módulo, y la lectura del
  instante como `leerInstante(fechaHora)` dentro del `try`: un `call` redefinido más tarde ya no interviene;
- `Number.isSafeInteger` (y `Math.max`) guardados en constantes del módulo al cargarlo;
- la comprobación del rango escrita en positivo, `if (!(esEnteroSeguro(t) && t >= 0 && t <= 2 ** 48 - 1)) throw …`:
  un `NaN` no cumple ninguna comparación y se rechaza aunque `esEnteroSeguro` mienta;
- el comentario del módulo dice que es endurecimiento, no una defensa, y que el código que modifica objetos nativos
  está fuera del modelo de amenaza.

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Fuera del modelo de amenaza, con endurecimiento barato | Defender el módulo de objetos nativos modificados (copias congeladas, `Reflect.apply` guardado, `Object.freeze` de los prototipos al arrancar) | Siempre queda otro nativo que reemplazar (`Buffer`, `randomBytes`, el propio módulo en la caché de `require`); congelar prototipos globales puede romper dependencias |

## Preguntas técnicas para historias futuras (no la 007)

- **Orden de `auditoria_plataforma` en el mismo milisegundo.** `insertarEnAuditoriaPlataforma`
  (`backend/src/modulos/auditoria/insercion.ts`) usa `gen_random_uuid()` como id, a diferencia de
  `insertarEnAuditoriaDeAcademia`, que usa `idDeAuditoriaOrdenado`. Si `auditoria_plataforma` se lee `ORDER BY
  fecha_hora, id`, las filas del mismo milisegundo (o con el reloj fijo de las pruebas) quedan en orden aleatorio y no
  en el orden en que se registraron. Propuesta: cuando una historia lea o muestre esa bitácora (por ejemplo, la del
  Superadmin), usar también `idDeAuditoriaOrdenado` en `insertarEnAuditoriaPlataforma` y decidir si las filas ya
  guardadas necesitan algo (con UUID v4 no se puede recuperar su orden dentro del milisegundo). No cambia la 007: la
  007 solo escribe en `auditoria`.

## Migraciones

- `<marca>_estado_solicitud_confirmada` (007a): un valor de enum, sin datos.
- `<marca>_pagos` (007a): tabla, tipo, índices, `CHECK`, triggers, RLS, privilegios, llave de
  `movimientos_caja.pago_id` (diferida) y `registrada_por`. Las bases de desarrollo no tienen movimientos con `pago_id`
  (la semilla de la 006 solo tiene un egreso), así que la llave se agrega sin limpiar datos. Si alguna base de
  desarrollo tuviera ingresos de pruebas manuales, la migración fallaría: se documenta en la guía de Windows
  («Problemas frecuentes»: rehacer la base de desarrollo).
- `<marca>_pagos_movimiento_confirmado` (007a, ronda adversarial 1, criterio 58;
  `20261124190000_pagos_movimiento_confirmado`): solo funciones, el trigger por fila de `movimientos_caja` y el
  trigger por sentencia `movimientos_caja_no_cambian`. Sin datos. Si una base de desarrollo tuviera un movimiento que rompe el invariante, la migración
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
- **Objetos nativos modificados en el proceso:** fuera del modelo de amenaza del id de la auditoría (criterio 59 e). El
  endurecimiento de la ronda 4 lo dificulta, pero no es una garantía.
