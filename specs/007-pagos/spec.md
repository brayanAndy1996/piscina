# 007 · Pagos, verificación y paso de cliente a alumno

- **Historias y requerimientos:** HU-04 (al confirmarse el pago, el cliente pasa a «Alumno activo», con usuario y
  contraseña iguales a su DNI; el carnet es de la 008), HU-07 (pago en efectivo: solo con la caja abierta, entra a la
  caja del día y genera un comprobante interno o ticket imprimible), HU-08 (Yape o transferencia: imagen JPG o PNG de
  hasta 5 MB, número de operación, monto y fecha del comprobante, estado «Pendiente de verificación», aviso si el número
  de operación ya se usó), HU-09 (bandeja de pagos pendientes con la foto ampliable, el monto, el número de operación, el
  cliente y la fecha; aprobar o rechazar con motivo; al rechazar se avisa al cliente; queda quién verificó y cuándo),
  HU-34 y RN-25 (el administrador ajusta el monto con un motivo que queda en auditoría), RN-01 (cliente hasta que su
  primer pago se confirma), RN-02 (usuario y contraseña iniciales iguales al DNI, con cambio obligatorio), RN-03 con D-28
  (DNI único por academia), RN-04 (efectivo al instante; Yape y transferencia con foto y verificación humana), RN-05 (el
  carnet solo con el pago confirmado), RN-17 (ningún cobro con la caja cerrada), RN-22 y RNF-06 (auditoría de pagos y
  verificaciones), RN-27 (sin matrícula de inscripción), RN-28 (un pago pendiente de verificación reserva el cupo sin
  límite; al rechazarse, el cupo se libera), RNF-03 y RNF-04 (argon2 y cambio obligatorio), RNF-05 (Ley 29733), RNF-09
  (límites por archivo), RNF-12 (America/Lima y soles); sección 2.1 («Registrar inscripción y cobro» y «Verificar
  pagos»: administrador y secretaria), 4.1 (proceso de inscripción y pago), 8.4 (nota sobre Yape: verificación humana y
  número de operación sin duplicados), 8.7 (pantallas: pago y subida del comprobante, estado de la solicitud, bandeja de
  verificación, cobros), 8.8 (estados del pago, de la persona y de la matrícula) y 9.1 (`PAGO`). D-03 (orden del cálculo
  del cobro; el precio ya incluye IGV), D-04 (un Yape entra a la caja abierta al verificarlo, con su método; fecha de la
  operación y de verificación por separado), D-05 (nuevo comprobante desde el enlace tras un rechazo, si hay cupo), D-07
  (fecha de operación, caja al verificar, número de operación sin repetir entre pendientes y confirmados), D-08 (sin
  WhatsApp), D-09 (sin SUNAT: ticket interno), D-19 y D-21 (`EnviadorCorreo` y `AlmacenArchivos`), D-23 (todo por
  academia), D-28 y D-29 (el Superadmin no ve pagos). De las specs anteriores: DT-5 de 002 (`bloquearActorVigente`,
  `UsuariosService.crearEnTransaccion`), DR-5 de 004 y «Cupo de una clase», las reglas de la 005a y la 005b («Para la
  007», «Archivos», «Tokens públicos», «Vista de seguimiento», «Destinatarios del enlace»), DR-12, DR-14, DR-16 y DR-20 de
  005, y las reglas de la caja de la 006 («Ningún cobro sin caja abierta», «Orden de bloqueos con la caja», DT-9 de 006).
- **Ruta crítica:** sí. Toca siete puntos de la lista de `CLAUDE.md`: pagos y verificación, caja, aforo y reservas,
  permisos y datos sensibles, autenticación (la contraseña inicial igual al DNI), entradas públicas (subida del
  comprobante) y aislamiento entre academias. La web, el ticket impreso, la semilla y la documentación no son críticos.
- **Estado:** borrador (24/11/2026), pendiente de la aprobación del responsable. Las preguntas de negocio (P1 a P14) y
  las propuestas técnicas para el orquestador (T1 a T16) están en «Preguntas abiertas». Donde un criterio depende de
  una pregunta, lleva el valor provisional de la propuesta, marcado «(provisional, Pn)».
- **División propuesta (P14):** dos entregas desde esta carpeta, las dos de ruta crítica, cada una con sus pruebas
  protegidas, su ataque y su PR (ver «División en 007a y 007b»):
  - **007a · Cobro en recepción y cuenta del alumno** (primero): criterios 1 a 35 y 54 a 57, salvo las partes marcadas
    **[007b]**.
  - **007b · Yape y transferencia** (siguiente PR): criterios 36 a 53, más las partes marcadas **[007b]** de 28 a 32, 51,
    54, 55 y 57.

## Objetivo

Que la academia cobre la inscripción de cada solicitud y que, con el pago confirmado, la persona pase de cliente a
alumno con su cuenta. En recepción, la secretaria cobra en efectivo con la caja del día abierta y entrega un ticket
interno. Desde su enlace de seguimiento, el cliente que paga por Yape o transferencia sube la foto del comprobante con el
número de operación; su cupo queda reservado mientras la secretaria lo revisa en la bandeja, lo aprueba (el dinero entra
a la caja abierta con su método) o lo rechaza con un motivo (el cupo se libera y puede volver a intentarlo). El
administrador puede ajustar el monto antes del pago, con un motivo. Nunca se confirma un pago sin su movimiento de caja,
nunca se cobra dos veces la misma matrícula y nunca se acepta dos veces el mismo número de operación. El carnet es de la
008; las renovaciones, de la 010; los códigos de descuento, de la 015.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Tablas, invariantes y aislamiento en la base (1 a 7):** los pagos son dinero de cada academia (D-23). La base
  impide un pago confirmado sin su movimiento de caja, dos pagos abiertos de la misma matrícula, un número de operación
  repetido y cualquier cambio de un pago ya resuelto, también si la API fallara.
- **Permisos y aislamiento en la API (8 y 9):** solo el administrador y la secretaria cobran y verifican; solo el
  administrador ajusta montos; un id de otra academia se comporta como inexistente.
- **Cálculo del cobro (10 a 12):** el total sale de lo guardado en la matrícula con el orden de D-03 (ajuste y redondeo
  hacia arriba una sola vez), y lo que se cobra es lo que vio quien cobra.
- **Pagos y caja (13 a 19, 45 a 50 y 52):** efectivo confirmado al instante y solo con la caja de hoy abierta; Yape y
  transferencia pendientes hasta que se aprueben o rechacen; la verificación entra a la caja abierta con su método; doble
  clic, reintento, aprobar dos veces, aprobar un rechazado y aprobar y rechazar a la vez no duplican nada.
- **Paso de cliente a alumno y autenticación (20 a 24):** el usuario y su contraseña inicial (el DNI, con argon2 y
  cambio obligatorio) se crean solo con el pago confirmado y en la misma transacción.
- **Aforo y reservas (18, 32, 40 y 44):** el cupo se reserva sin límite mientras el comprobante está en revisión, se
  libera al rechazar y se vuelve a pedir al reintentar; nunca más inscritos que el aforo.
- **Estados nuevos de la solicitud (28 a 32):** la vista de seguimiento sigue la regla de DR-14 de 005 (nombre solo en
  la vigente); la cancelación, la foto y el envío de la 005 respetan los pagos.
- **Recepción y los límites por conexión (33 a 35, DR-20 de 005):** quitar un límite a quien tiene sesión no puede abrir
  una puerta a quien no la tiene.
- **Entrada pública del comprobante (36 a 44):** imagen de hasta 5 MB de un anónimo con el token, sin metadatos,
  número de operación sin duplicados con espacios, ceros o mayúsculas distintas, límites por conexión.
- **Correo después de confirmar (51):** destinatarios de un menor (DR-13 de 005) y respuesta que no espera.

No son críticos, pero llevan _(prueba obligatoria)_: 25 a 27 (ticket), 53 (datos de pago de la academia) y 54 a 56
(web, con pruebas de componentes). El 57 (semilla y documentación) lo verifica el revisor, con una prueba no protegida
de la semilla.

## División en 007a y 007b

Propuesta (P14). Las dos entregas comparten esta spec, `plan.md` y `tasks.md`; los criterios y las tareas de la 007b
llevan la marca **[007b]**. El test-writer de la 007a escribe solo las pruebas protegidas de los criterios críticos de la
007a; las de la 007b se escriben, se confirman en rojo y se atacan en su PR, en archivos nuevos.

| Entrega | Criterios críticos (pruebas protegidas y ataque) | Prueba obligatoria | Revisor |
| --- | --- | --- | --- |
| **007a** · cobro en recepción y cuenta del alumno | 1 a 24, 26 (aislamiento y permiso), 28 a 35 (sin sus partes [007b]) | 25, 26 (contenido), 27, 54 y 56 (partes de la 007a) | 57 (parte de la 007a) |
| **007b** · Yape y transferencia | 36 a 52, más las partes [007b] de 28 a 32 y 51 | 53, 55 y las partes [007b] de 54 y 56 | 57 (parte de la 007b) |

**Cómo se resuelven las dependencias:**

- **La migración de la 007a crea la tabla `pagos` completa** (criterios 1 a 7), con las columnas del Yape y la
  transferencia (número de operación, comprobante, fecha de operación, motivo de rechazo) y sus invariantes. Así la 007b
  no tiene migración y las pruebas de catálogo y privilegios de la 007a no cambian. Las pruebas de la 007a de los
  invariantes de Yape (criterio 4 y 6) escriben las filas como dueño de las tablas.
- **La confirmación** (criterio 20) se construye en la 007a como una función que corre dentro de la transacción de quien
  confirma (`confirmarPagoEnTransaccion`, ver plan). La 007b la reutiliza al aprobar.
- **Los estados visibles nuevos:** la 007a suma `CONFIRMADA` a la solicitud y a la vista de seguimiento; `EN_VERIFICACION`
  y `PAGO_RECHAZADO` llegan con la 007b, que es la que los produce. El esquema compartido suma los tres en la 007a, para
  que no cambie en la 007b (criterio 28).
- **El correo:** la 007a envía el de pago confirmado (criterio 51 a); el de rechazo es de la 007b (criterio 51 b).
- **Datos de pago de la academia (criterio 53) y la bandeja web:** de la 007b.

## Criterios de aceptación

Definiciones (las de la 005 y la 006 siguen valiendo: «ahora», «hoy», «matrícula que ocupa cupo», «ruta pública»,
«ruta de academia», «actor vigente», «caja de hoy»):

- **Pago abierto:** un pago en estado `PENDIENTE_VERIFICACION` o `CONFIRMADO`. **Pago resuelto:** `CONFIRMADO` o
  `RECHAZADO`.
- **Último pago de una matrícula:** el de `registrado_en` más reciente (y, a igual instante, el de mayor `id`).
- **Total a cobrar de una matrícula:** `calcularTotal({ base: baseProporcional(precio_plan, clases_por_mes_plan,
  clases_totales), montoAjustado })` con lo guardado en la matrícula (`matriculas/dominio/cobro.ts`), donde
  `montoAjustado` es `monto_ajustado` si no es nulo. Nunca se lee del plan (HU-19). Sin ajuste es igual a
  `monto_calculado`.
- **Estado visible de una solicitud** (amplía PB2 de 005; la misma regla en la API, en SQL y en la web), en este orden:
  1. si la fila está `VENCIDA`, `CANCELADA` o `CONFIRMADA`, ese;
  2. si su matrícula tiene un pago `PENDIENTE_VERIFICACION`, `EN_VERIFICACION` **[007b]**;
  3. si su matrícula está `CANCELADA` y su último pago está `RECHAZADO`: `PAGO_RECHAZADO` si «hoy» todavía es del mes de
     la matrícula, y `VENCIDA` si ya no **[007b]**;
  4. si su matrícula está `CANCELADA`, `CANCELADA`;
  5. si su matrícula está `RESERVADA` con `reserva_vence_en` anterior o igual a «ahora», `VENCIDA`;
  6. si no, `PENDIENTE_PAGO`.
- **Solicitud activa** (amplía la de 005): una con estado visible `PENDIENTE_PAGO` o `EN_VERIFICACION`. Una
  `PAGO_RECHAZADO` no ocupa cupo y no es activa: el cliente puede volver a inscribirse con su DNI (criterio 21 b de 005).
- **Número de operación normalizado:** el texto que escribió la persona, en forma NFKC, sin espacios de ningún tipo ni
  los caracteres `-`, `.`, `/` y `_`, en mayúsculas y sin ceros a la izquierda (si solo tiene ceros, queda `0`). Por
  ejemplo, ` 00012 345 `, `12345`, `0001-2345` y `１２３４５` (dígitos de ancho completo) dan `12345`; `ab-01` da `AB01`.
- **Confirmar un pago:** los efectos del criterio 20, en la misma transacción que deja el pago `CONFIRMADO`.

### A. Tablas, invariantes y aislamiento en la base

1. **Tabla `pagos`.** Dadas las migraciones aplicadas, existe `pagos` con las columnas de «Cambios al modelo de datos»,
   `academia_id`, RLS activada y forzada, políticas de `SELECT`, `INSERT` y `UPDATE` con la forma exacta del criterio 132
   de 001 y sin `DELETE`, y `UNIQUE (academia_id, id)`. Sus referencias son llaves compuestas `(academia_id, …)`: a
   `matriculas` (junto con el alumno, para que el pago y su matrícula sean del mismo alumno), a `alumnos` y a `usuarios`
   (`registrado_por`, `verificado_por`). `movimientos_caja.pago_id` pasa a tener la llave compuesta
   `(academia_id, pago_id) → pagos (academia_id, id)`. Las pruebas de catálogo de 001 siguen pasando y
   `TABLAS_DESPUES_DE_MIGRAR` suma `pagos`. _(crítico)_ (D-17, D-23; criterio 12 de 001; criterio 5 de 006)
2. **Privilegios mínimos.** El rol `aquagestion_app` tiene en `pagos` `SELECT`, `INSERT` y `UPDATE` solo de `estado`,
   `verificado_por`, `verificado_en`, `motivo_rechazo`, `numero_ticket` y `actualizado_en`; sin `DELETE`. Suma `UPDATE`
   de `alumnos.estado` y `alumnos.usuario_id`, y de `matriculas.monto_ajustado` y `matriculas.motivo_ajuste`. No puede
   cambiar el monto, el método, el número de operación, el comprobante, la fecha de operación, la matrícula ni el alumno
   de un pago, ni la `academia_id` de ninguna fila. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se amplían igual y la
   API sigue atendiendo (criterio 102 de 001). _(crítico)_ (D-23, RN-22)
3. **RLS y llaves compuestas.** Con pagos de A y de B, como app: en contexto de A, `SELECT` devuelve solo los de A; un
   `INSERT` con `academia_id` de B o un `UPDATE` que mueve un pago a B fallan con `42501`; en contexto de plataforma o
   sin contexto, 0 filas (D-29). Un pago de A con una matrícula, un alumno o un usuario de B, un pago cuya matrícula es
   de otro alumno, y un movimiento de caja de A con el `pago_id` de un pago de B o de un pago que no existe, fallan con
   `23503` (el último, al confirmar la transacción, porque esa llave es diferida), también como dueño de las tablas.
   _(crítico)_ (D-23, D-29)
4. **Invariantes con `CHECK` e índices únicos.** Un `INSERT` o `UPDATE` directo (como app y como dueño) falla con
   `23514` o `23505`, según el caso:
   - a) `monto` menor o igual que 0, mayor que `100000.00`, `NaN` o con más de dos decimales;
   - b) `concepto` igual a `EGRESO_MENOR`;
   - c) un pago `EFECTIVO` con número de operación, comprobante o fecha de operación, o en un estado que no sea
     `CONFIRMADO`; un pago `YAPE` o `TRANSFERENCIA` sin número de operación (el escrito y el normalizado), sin
     comprobante o sin fecha de operación;
   - d) un número normalizado que no cumple `^(0|[1-9A-Z][0-9A-Z]{0,29})$`, o un número escrito vacío o de más de 40
     caracteres;
   - e) coherencia del estado: `PENDIENTE_VERIFICACION` sin `verificado_por`, `verificado_en`, `motivo_rechazo` ni
     `numero_ticket`; `CONFIRMADO` con `verificado_por`, `verificado_en` y `numero_ticket`, y sin motivo; `RECHAZADO`
     con `verificado_por`, `verificado_en` y un motivo no vacío, y sin `numero_ticket`; `verificado_en` no anterior a
     `registrado_en`;
   - f) dos pagos abiertos de la misma matrícula (`23505`, índice parcial `pagos_un_abierto_por_matricula`);
   - g) dos pagos abiertos de la misma academia y el mismo método con el mismo número normalizado (`23505`, índice
     parcial `pagos_numero_operacion_abierto_key`; provisional P9); un pago `RECHAZADO` no cuenta, y otra academia
     tampoco;
   - h) dos pagos de la academia con la misma `clave_idempotencia` o el mismo `numero_ticket` (`23505`).

   _(crítico)_ (RN-04, D-07, D-03; prevención de duplicados de HU-08)
5. **Ningún pago confirmado sin su movimiento de caja.** Al confirmar la transacción, cada pago `CONFIRMADO` tiene
   exactamente un movimiento de caja `INGRESO` con su `pago_id`, del mismo alumno, método, monto y con el concepto del
   pago; y cada movimiento con `pago_id` apunta a un pago `CONFIRMADO`. Lo garantiza un trigger de restricción diferido
   (`DEFERRABLE INITIALLY DEFERRED`) en `pagos` y en `movimientos_caja`: una transacción, como app o como dueño, que deja
   un pago `CONFIRMADO` sin movimiento, con un movimiento de otro monto o método, o un movimiento con el `pago_id` de un
   pago pendiente o rechazado, falla en el `COMMIT` con `23514` y no queda nada. Dentro de la transacción, el orden de
   las escrituras es libre. _(crítico)_ (D-04, RN-17; «no queda un pago confirmado sin su movimiento» de la 006)
6. **Un pago resuelto no cambia.** Un trigger `BEFORE UPDATE` en `pagos` solo admite pasar de `PENDIENTE_VERIFICACION` a
   `CONFIRMADO` o a `RECHAZADO`, una vez. Falla con `23514`, como app y como dueño: aprobar un `RECHAZADO`, rechazar un
   `CONFIRMADO`, volver a `PENDIENTE_VERIFICACION`, y cambiar cualquier columna de un pago resuelto (también
   `motivo_rechazo`, `verificado_por` o `numero_ticket`). Un `UPDATE` que no cambia nada de un pago resuelto también
   falla. _(crítico)_ (HU-09, RN-22; «aprobar un pago rechazado» de `CLAUDE.md`)
7. **Estado y origen de la solicitud.** El tipo `estado_solicitud` suma `CONFIRMADA`. `solicitudes_inscripcion` suma
   `registrada_por uuid null` con la llave compuesta a `usuarios` (criterio 34), que la app solo escribe al insertar.
   El índice parcial de una solicitud `PENDIENTE_PAGO` por alumno (criterio 4 e de 005) no cambia. Las pruebas de
   catálogo y de privilegios de 005 siguen pasando con estos agregados. _(crítico)_ (D-23; criterio 4 de 005)

### B. Permisos y aislamiento en la API

8. **Permisos.** La matriz suma `AJUSTAR_MONTO_COBRO` con `ADMIN: 'TODO'` (de 25 a 26 filas, criterio 26 de 002).
   Rutas y permisos:
   - cobro en efectivo, ticket y panel de solicitudes: `REGISTRAR_INSCRIPCION_Y_COBRO` (`ADMIN` y `SECRETARIA`);
   - ajuste del monto: `AJUSTAR_MONTO_COBRO` (solo `ADMIN`; la secretaria recibe 403 `SIN_PERMISO`, RN-25);
   - **[007b]** bandeja, comprobante, aprobación y rechazo: `VERIFICAR_PAGOS` (`ADMIN` y `SECRETARIA`).

   `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO` en todas, también con un id inválido; sin sesión, 401; con el cambio
   de contraseña pendiente o la academia suspendida, lo de 002. El Superadmin no tiene estas rutas (D-29).
   _(crítico)_ (sección 2.1, RN-25, D-29)
9. **Aislamiento y actor vigente.** En toda ruta de esta historia con `{id}`, un id que no es UUID, que no existe o que
   es de otra academia responde el mismo 404 `NO_ENCONTRADO`, con el mismo cuerpo y sin escribir ni auditar. La academia
   sale siempre de la sesión: `?academiaId=`, un `academiaId` en el cuerpo (400 por campo de más) o en una cabecera no
   cambian nada. Toda escritura llama a `bloquearActorVigente` como primera sentencia de su transacción; un actor
   desactivado o con la versión de token cambiada responde 401 antes que cualquier 404 o 409, sin escribir.
   _(crítico)_ (D-23, DT-5 de 002, AT-2 de 004)

### C. Total a cobrar y ajuste del administrador

10. **El total sale de la matrícula.** El total a cobrar (definición) se calcula con `calcularTotal` y lo guardado en la
    matrícula, y es un entero de soles. Pruebas: una matrícula de S/ 100 de 12 clases con 5 totales sin ajuste cobra
    S/ 42 (igual a `monto_calculado`); con `monto_ajustado` 35, S/ 35; si después del envío el administrador cambia el
    precio del plan a S/ 200, el total sigue siendo S/ 42 (HU-19); una matrícula de S/ 210 de 12 con 5 cobra S/ 88. El
    monto del pago, el del movimiento de caja, el de la vista de seguimiento, el del panel y el del ticket son ese total.
    Ningún paso usa `number`. _(crítico)_ (D-03, RN-25, HU-34, HU-19)
11. **Ajuste del monto.** `POST /api/solicitudes/{id}/ajuste-monto` con `{ montoAjustado, motivo }`
    (`ajustarMontoSchema`: un monto en soles enteros de `"1"` a `"99999"`, provisional P11; `motivo` con
    `textoVisibleSchema` de 3 a 200 caracteres) responde 200 con `{ solicitud }` (el elemento del panel, criterio 29).
    Guarda `monto_ajustado` y `motivo_ajuste` en la matrícula y registra `MATRICULA_MONTO_AJUSTADO` (entidad
    `matricula`, `entidadId` la matrícula, actor el administrador, `motivo`, `datosAntes: { montoAjustado, total }` y
    `datosDespues: { montoAjustado, total }`, montos como texto con dos decimales). Solo se ajusta una solicitud con
    estado visible `PENDIENTE_PAGO` o `PAGO_RECHAZADO`; en `EN_VERIFICACION`, `CONFIRMADA`, `VENCIDA` o `CANCELADA`
    responde 409 `SOLICITUD_NO_AJUSTABLE` con `detalles: { estado }`, sin escribir. Un nuevo ajuste reemplaza al anterior;
    el mismo monto y el mismo motivo que ya tiene responden 200 sin escribir ni auditar. El ajuste no toca el cupo, la
    reserva ni las clases totales (provisional P11). _(crítico)_ (RN-25, HU-34, RN-22, D-03)
12. **Ajuste y cobro a la vez.** El cobro en efectivo compara el total que vio quien cobra (`montoMostrado`) con el total
    al momento de cobrar (criterio 16). Con un ajuste y un cobro simultáneos sobre la misma solicitud, termina uno de dos
    modos: el cobro primero (201 con el total de antes) y el ajuste responde 409 `SOLICITUD_NO_AJUSTABLE`; o el ajuste
    primero y el cobro responde 409 `MONTO_CAMBIO`. Nunca queda un pago con un monto distinto del total de su matrícula
    al confirmar. Sin `40P01` ni 500. _(crítico)_ (D-03; idempotencia y carreras de `CLAUDE.md`)

### D. Cobro en efectivo en recepción

13. **Cobro correcto.** Dada una solicitud con estado visible `PENDIENTE_PAGO` y la caja de hoy abierta, cuando una
    `SECRETARIA` o un `ADMIN` envía `POST /api/solicitudes/{id}/pago-efectivo` con `{ claveIdempotencia, montoMostrado }`
    (`cobrarEnEfectivoSchema`, estricto), entonces responde 201 con `{ pago, solicitud }` (`pagoSchema` y el elemento del
    panel). En una sola transacción:
    - se crea el pago `CONFIRMADO`, `EFECTIVO`, concepto `INSCRIPCION`, con el total a cobrar, `registrado_por` y
      `verificado_por` iguales al actor, `registrado_en` y `verificado_en` iguales a «ahora» y el siguiente
      `numero_ticket` de la academia (criterio 25);
    - su ingreso entra a la caja de hoy con `registrarIngresoEnCaja` (método `EFECTIVO`, el mismo monto, el alumno y el
      pago), que suma al efectivo esperado del cierre;
    - se confirma el pago (criterio 20);
    - se audita `PAGO_REGISTRADO` (entidad `pago`, actor el usuario, `datosDespues: { matriculaId, metodo, monto,
      concepto, numeroTicket }`, sin DNI), además de `CAJA_INGRESO_REGISTRADO` y `USUARIO_CREADO`.

    _(crítico)_ (HU-07, RN-04, RN-01, D-03; HU-26)
14. **Solo con la caja de hoy abierta.** Sin caja abierta responde 409 `SIN_CAJA_ABIERTA` («Abre la caja antes de
    cobrar»); con la caja abierta de un día anterior, 409 `CAJA_DE_OTRO_DIA` con `detalles: { cajaId, fecha }`; con la caja
    de hoy cerrada, `SIN_CAJA_ABIERTA`. En los tres casos no queda nada: ni pago, ni usuario, ni cambios en el alumno, la
    solicitud o la matrícula, ni auditoría. Con la caja del 30 de noviembre abierta, un cobro a las 23:59:59.999 del 30 en
    Lima se acepta y uno a las 00:00 del 1 de diciembre responde `CAJA_DE_OTRO_DIA`, también con el proceso en
    `TZ=Asia/Tokyo`. _(crítico)_ (RN-17, D-04, DR-2 de 006; «cobrar con la caja de otro día» de `CLAUDE.md`)
15. **Qué solicitudes se cobran.** Se cobra una solicitud con estado visible `PENDIENTE_PAGO` (con la reserva vigente) o
    `PAGO_RECHAZADO` **[007b]** (dentro del mes de su matrícula y con cupo, criterio 18). Las demás responden 409, sin
    escribir: `SOLICITUD_YA_PAGADA` (`CONFIRMADA`), `PAGO_EN_VERIFICACION` (`EN_VERIFICACION`, hay un comprobante en
    revisión: se aprueba o se rechaza primero) y `SOLICITUD_NO_COBRABLE` con `detalles: { estado }` (`VENCIDA` o
    `CANCELADA`; la persona se vuelve a inscribir, provisional P10). _(crítico)_ (RN-28, D-05, DR-1 y DR-12 de 005)
16. **El monto que se ve es el que se cobra.** `montoMostrado` (`montoSchema`) es el total que la web mostró a quien
    cobra. Si no es igual al total a cobrar al momento de cobrar (`"42"` y `"42.00"` son iguales), responde 409
    `MONTO_CAMBIO` con `detalles: { total }`, sin escribir. _(crítico)_ (D-03, HU-34)
17. **Doble clic y reintento.** Con un cobro ya registrado con la clave K, otro con la misma clave para la misma
    solicitud y el mismo `montoMostrado` responde 200 con el mismo `{ pago, solicitud }`, sin otro pago, otro movimiento,
    otro usuario ni otra auditoría, aunque la caja ya esté cerrada o sea de otro día (la clave se mira antes que el estado
    de la solicitud y que la caja). La clave K con otra solicitud, otro monto o de un pago que no es en efectivo responde
    409 `CLAVE_YA_USADA`. Dos cobros simultáneos con la misma clave dejan un pago (uno 201 y el otro 200); dos con claves
    distintas sobre la misma solicitud dejan un pago (uno 201 y el otro 409 `SOLICITUD_YA_PAGADA`) y un solo movimiento.
    _(crítico)_ (regla de idempotencia de `CLAUDE.md`; criterio 22 de 006)
18. **El cupo al cobrar.** El cobro nunca deja una clase con más matrículas que ocupan cupo que su aforo por su culpa:
    - a) con la reserva vigente, el cupo ya es suyo: el cobro se acepta aunque el aforo se haya bajado con confirmación
      por debajo de la ocupación (DR-5 de 004, nadie pierde su lugar);
    - b) si la reserva vence mientras el cobro espera el bloqueo de las clases, se decide con el instante leído después de
      `bloquearClasesParaCupo`: una reserva que una inscripción simultánea ya contó como vencida (y cuyo cupo tomó) no se
      cobra como vigente. Prueba determinista: aforo 20 con 19 ocupados más la solicitud S cuya reserva vence en el
      instante T; un envío de la 005 en T toma el cupo y confirma mientras el cobro de S espera; el cobro responde 409
      `SIN_CUPO` y la ocupación queda en 20. En el orden inverso (el cobro primero), el envío responde 409 `SIN_CUPO`;
    - c) **[007b]** una solicitud `PAGO_RECHAZADO` vuelve a pedir cupo: si alguna clase está llena, 409 `SIN_CUPO` con
      `detalles.clasesSinCupo`; dos cobros o reintentos de solicitudes distintas por el último cupo dejan exactamente uno.

    El cobro llama a `bloquearClasesParaCupo` una sola vez con todas las clases de la matrícula, antes de contar.
    _(crítico)_ (RN-11, RN-28; «Cupo de una clase» de 004)
19. **Sin interbloqueos.** Un cobro en efectivo que corre a la vez que un egreso, un cierre de la caja, la cancelación
    de la misma solicitud (005b), la subida de su foto (005b), un envío del formulario con el mismo DNI (005), un ajuste
    del monto y otro cobro de otra solicitud de la misma clase, termina sin `40P01` ni 500: cada operación responde su
    éxito o su 409. Orden de bloqueos: `usuarios` (actor) → bloqueo consultivo del DNI → `alumnos` → `solicitudes_inscripcion`
    → `matriculas` → `pagos` → `clases` → la caja, al final (regla de la 006). _(crítico)_ («Orden de bloqueos con la caja»
    de la 006; criterio 26 de 006)

### E. Paso de cliente a alumno

20. **Confirmar un pago crea al alumno.** En la transacción que deja el pago `CONFIRMADO` (cobro en efectivo o
    aprobación **[007b]**):
    - a) se crea su cuenta con `UsuariosService.crearEnTransaccion`: rol `ALUMNO`, usuario igual a su DNI, nombres y
      apellidos del alumno, contraseña inicial igual a su DNI con argon2 (calculada antes de abrir la transacción) y
      `debe_cambiar_clave = true`; audita `USUARIO_CREADO` con el actor que confirma;
    - b) el alumno pasa de `CLIENTE` a `ALUMNO_ACTIVO` y `alumnos.usuario_id` apunta a esa cuenta;
    - c) la matrícula pasa de `RESERVADA` a `VIGENTE`, con `reserva_vence_en` nula;
    - d) la solicitud pasa a `CONFIRMADA`.

    Después, con la academia del alumno, `POST /api/a/{nombreCorto}/sesion` con su DNI como usuario y como contraseña
    inicia sesión con el cambio de contraseña obligatorio pendiente (HU-05, criterios de 002), y la secretaria puede
    restablecer su contraseña (`RESTABLECER_CLAVE`, alcance `ALUMNOS`). _(crítico)_ (HU-04, RN-01, RN-02, RNF-03, RNF-04)
21. **Solo con el pago confirmado.** Mientras el pago está `PENDIENTE_VERIFICACION` **[007b]** o después de
    `RECHAZADO` **[007b]**, la persona sigue en `CLIENTE`, sin cuenta (el ingreso con su DNI responde como uno que no
    existe) y sin cambios en su matrícula salvo la reserva. Si la confirmación falla por cualquier motivo (sin caja,
    caja de otro día, DNI del personal, cupo, actor no vigente), no queda nada de ella: ni pago confirmado, ni cuenta, ni
    alumno activo, ni matrícula vigente, ni movimiento, ni auditoría. _(crítico)_ (RN-01, RN-05; D-04)
22. **El DNI del personal (provisional P1).** El personal y los alumnos de una academia no comparten DNI:
    - a) si al confirmar ya hay un usuario de la academia con el DNI del cliente (datos anteriores a esta historia o
      escritos por otra vía), responde 409 `DNI_DEL_PERSONAL` sin escribir nada (criterio 21), y el administrador decide
      con el cliente;
    - b) `POST /api/usuarios` (002) con el DNI de un alumno de la academia que no está en `CLIENTE`, o de un cliente con
      una solicitud activa, responde 409 `DNI_EN_USO` (el mismo cuerpo de 002), sin crear ni auditar. Con el DNI de un
      cliente sin solicitud activa, crea la cuenta como hoy, y ese cliente ya no puede volver a inscribirse (criterio 21 a
      de 005);
    - c) la creación de personal y la confirmación con el mismo DNI, a la vez, terminan con exactamente una de las dos y
      la otra responde su 409; nunca 500 ni `40P01`.

    _(crítico)_ (D-28, RN-03; DR-16 de 005)
23. **El hash fuera de la transacción.** La contraseña inicial se hashea con argon2 antes de abrir la transacción de la
    confirmación, a partir del DNI leído en una lectura corta previa (el DNI de un alumno no cambia: la app no tiene
    `UPDATE` de `alumnos.dni`). El registro técnico nunca lleva el DNI, la contraseña ni su hash. _(crítico)_ (RNF-03;
    criterio 43 de 002)
24. **Seguimiento de una solicitud confirmada.** La consulta del seguimiento (por token o por código y DNI) de una
    solicitud `CONFIRMADA` responde la vista de confirmada (criterio 28) y la página muestra que el pago está confirmado y
    cómo ingresar (`/a/{nombreCorto}/ingresar`, con su DNI). _(crítico)_ (D-05, DR-14 de 005)

### F. Ticket interno

25. **Número del ticket.** Cada pago `CONFIRMADO` recibe al confirmarse el siguiente `numero_ticket` de su academia (1,
    2, 3…), sin saltos ni repetidos aunque se confirmen pagos a la vez (la caja abierta, bloqueada al final, ordena las
    confirmaciones de una academia). Cada academia tiene su propia numeración. Un pago pendiente o rechazado no tiene
    número. _(prueba obligatoria)_ (HU-07, D-09; provisional P4)
26. **Datos del ticket.** `GET /api/pagos/{id}/ticket` (`REGISTRAR_INSCRIPCION_Y_COBRO`) responde 200 con
    `{ ticket }` (`ticketSchema`, estricto): academia (`nombre`, `telefono`), `numero`, `fechaHora` (de la confirmación, en
    ISO), alumno (`nombres` y `apellidos`, sin DNI; provisional P4), concepto (`INSCRIPCION`), plan, mes, método, número de
    operación (solo Yape o transferencia), `monto` (el total, texto con dos decimales), quién cobró o verificó (nombres y
    apellidos) y la `leyenda` fija «Comprobante interno de pago. No es un comprobante electrónico SUNAT» (provisional
    P4). Un pago pendiente o rechazado, de otra academia o inexistente responde 404 `NO_ENCONTRADO`. No escribe ni audita.
    _(crítico en el aislamiento y el permiso; prueba obligatoria en el contenido)_ (HU-07, D-09, D-23)
27. **Ticket imprimible.** Después de un cobro (y desde el panel de solicitudes, para una solicitud `CONFIRMADA`), la
    web abre `/panel/pagos/{id}/ticket`, una página con los datos del criterio 26 y estilos de impresión para papel de
    80 mm y A4 (provisional P4), con el botón «Imprimir». No genera archivos. _(prueba obligatoria)_ (HU-07)

### G. Estados nuevos en el seguimiento, el panel y la 005

28. **Vista de seguimiento con los estados nuevos.** `ESTADOS_SOLICITUD` suma `EN_VERIFICACION`, `PAGO_RECHAZADO` y
    `CONFIRMADA`, y `vistaSolicitudSchema` (unión estricta por estado) suma, todas con las claves de la vista completa de
    005 salvo `reservaVenceEn`:
    - `CONFIRMADA` (007a): sin `fotoCargada`, con `pago: { metodo, monto, confirmadoEn, numeroTicket }`;
    - **[007b]** `EN_VERIFICACION`: con `fotoCargada` y `pago: { metodo, monto, fechaOperacion, enviadoEn }`;
    - **[007b]** `PAGO_RECHAZADO`: con `fotoCargada`, `rechazo: { motivo, rechazadoEn }` (provisional P5) y
      `pagableHasta` (el fin del mes de la matrícula en Lima, ISO).

    Ninguna lleva DNI, apellidos, número de operación, comprobante, quién verificó, ids internos ni el hash del token. La
    regla de DR-14 de 005 sigue: el nombre solo va en la solicitud vigente del cliente; una `VENCIDA` o `CANCELADA`
    muestra la vista reducida. Pruebas por token y por código con DNI, con el mismo cuerpo. _(crítico)_ (D-05, DR-9 y
    DR-14 de 005, RNF-05)
29. **El panel de solicitudes con los pagos.** La lista y la respuesta de la cancelación (005b) muestran el estado
    visible de la definición, y cada elemento (`solicitudPanelSchema`) suma `ajuste` (`{ montoCalculado, motivo }` o
    `null`) y `pago` (el último pago de la matrícula: `{ id, metodo, estado, monto, registradoEn, verificadoEn,
    numeroOperacion, fechaOperacion, motivoRechazo, numeroTicket }` o `null`). `monto` es el total a cobrar. El filtro
    `ACTIVAS` muestra `PENDIENTE_PAGO`, `EN_VERIFICACION` y `PAGO_RECHAZADO`, y suma el filtro `CONFIRMADAS`.
    _(crítico)_ (HU-09, RN-21: sin datos médicos; criterio 38 de 005)
30. **Cancelar con pagos.** `POST /api/solicitudes/{id}/cancelar` (005b): con estado visible `EN_VERIFICACION`
    **[007b]** responde 409 `SOLICITUD_CON_PAGO_PENDIENTE` sin escribir (primero se aprueba o se rechaza el comprobante, provisional P12); con
    `PAGO_RECHAZADO` **[007b]** cancela como una `PENDIENTE_PAGO` (la matrícula ya está `CANCELADA`); con `CONFIRMADA`, 409
    `SOLICITUD_NO_CANCELABLE`. Bloquea además los pagos de la matrícula, después de la matrícula y antes de las clases.
    _(crítico)_ (RN-28; criterio 39 de 005)
31. **La foto con los estados nuevos.** La subida de la foto (005b) acepta una solicitud con estado visible
    `EN_VERIFICACION` o `PAGO_RECHAZADO` (los dos **[007b]**; sigue siendo la vigente del cliente) y responde 409
    `SOLICITUD_NO_EDITABLE` con `CONFIRMADA` (el alumno ya no está en `CLIENTE`; la foto de un alumno es de la 008).
    _(crítico)_ (criterio 34 de 005; DR-21 de 005)
32. **El envío de la 005 con los estados nuevos.** Con el DNI de un cliente cuya solicitud está `EN_VERIFICACION`
    **[007b]**, el envío responde 409 `DNI_YA_REGISTRADO` (es activa); con una `PAGO_RECHAZADO` **[007b]**, se acepta como
    el criterio 21 b de 005 (la anterior pasa a `VENCIDA`); con un alumno `ALUMNO_ACTIVO`, `DNI_YA_REGISTRADO` como hasta
    ahora. Una matrícula con un comprobante en revisión (`RESERVADA` con `reserva_vence_en` nula) ocupa cupo hasta que se
    resuelve (RN-28) y cuenta en el límite de reservas por conexión de su solicitud (criterio 25 de 005).
    _(crítico)_ (RN-28, RN-03, DR-14 de 005)

### H. Recepción sin los límites por conexión (DR-20 de 005)

33. **Las peticiones de recepción no cuentan.** Una petición a una ruta pública de `/api/a/{nombreCorto}/…` con límite
    propio (`LIMITES_PUBLICOS`: lecturas, cotización, envío, consulta y foto) que trae una cookie `aq_sesion` válida de un
    `ADMIN` o una `SECRETARIA` activos, sin cambio de contraseña pendiente, de la academia de ese nombre corto, no suma en
    esos contadores ni recibe 429 por ellos. Cualquier otra (sin cookie, con una cookie inválida, vencida o de una versión
    de token anterior, de otra academia, de un `ENTRENADOR` o un `ALUMNO`, o con el cambio pendiente) cuenta como hasta
    ahora y nunca responde 401 ni 403 por la cookie. El límite del ingreso (002) no cambia. Pruebas: con 10 envíos por
    hora agotados desde una conexión, la secretaria con su sesión envía el 11 (201) desde la misma conexión, y un anónimo
    desde ella sigue recibiendo 429; la cookie de la secretaria de A en una ruta de B cuenta. _(crítico)_ (DR-20 de 005;
    criterios 25 y 33 de 005)
34. **La inscripción de recepción.** Un envío del formulario con esa sesión:
    - a) llama a `bloquearActorVigente` como primera sentencia de su transacción (si el actor ya no está vigente, 401
      `NO_AUTENTICADO` sin escribir) y luego sigue el orden de la 005;
    - b) no aplica el límite de 5 solicitudes sin pagar por conexión (criterio 25 de 005), y su solicitud guarda
      `registrada_por` (el actor) y no cuenta en el límite de la conexión desde la que se envió;
    - c) audita `SOLICITUD_INSCRIPCION_CREADA` con actor `USUARIO` (quien inscribe) en lugar de `PUBLICO`.

    Todo lo demás de la 005 (validación, cupo, DNI, idempotencia, correo, respuesta) es igual. _(crítico)_ (DR-20 de 005,
    DT-5 de 002, RN-22)
35. **La foto de recepción.** Una subida de la foto con esa sesión no cuenta en la regla `foto`; todo lo demás del
    criterio 34 de 005 es igual. _(crítico)_ (DR-20 de 005)

### I. Comprobante de Yape o transferencia **[007b]**

36. **Subida del comprobante.** `PUT /api/a/{nombreCorto}/solicitudes/comprobante` con la imagen como cuerpo binario
    (`image/jpeg` o `image/png`), el token en `X-Token-Solicitud` y los datos del pago en `X-Pago-Datos` (un JSON ASCII de
    hasta 1024 bytes que cumple `datosComprobanteSchema`, estricto: `{ claveIdempotencia, metodo: 'YAPE' |
    'TRANSFERENCIA', numeroOperacion, monto, fechaOperacion }`) responde 201 con `{ solicitud }` (la vista
    `EN_VERIFICACION`, criterio 28) y `Cache-Control: no-store`. En una transacción: el pago `PENDIENTE_VERIFICACION` con
    el total a cobrar, el número escrito (recortado) y el normalizado, la fecha de operación, la clave del comprobante,
    `registrado_por` nulo y `ip_origen`; la matrícula queda `RESERVADA` con `reserva_vence_en` nula (sin límite,
    RN-28); y se audita `PAGO_COMPROBANTE_REGISTRADO` (actor `PUBLICO`, `datosDespues: { matriculaId, metodo, monto,
    numeroOperacionNormalizado, fechaOperacion }`, sin DNI ni token). La persona sigue en `CLIENTE` (criterio 21).
    _(crítico)_ (HU-08, RN-04, RN-28, D-04, D-07)
37. **Orden de las comprobaciones.** Como la foto (criterio 34 de 005), la primera que falla decide:
    1. límite por conexión: regla `comprobante`, 10 por hora (provisional, como la foto), con su propio contador y la
       clave de conexión; 429 `DEMASIADAS_SOLICITUDES` sin leer el cuerpo;
    2. tipo y codificación (400 `IMAGEN_NO_VALIDA`), antes de leer el cuerpo;
    3. tamaño: más de 5 242 880 bytes, 413 `CARGA_EXCESIVA`;
    4. academia: 404 `ACADEMIA_NO_ENCONTRADA` o 403 `ACADEMIA_SUSPENDIDA`;
    5. `X-Pago-Datos`: falta, no es JSON, pasa de 1024 bytes o no cumple el esquema: 400 `SOLICITUD_INVALIDA` con
       `detalles.errores[].campo` (`numeroOperacion`, `monto`…);
    6. token: el 404 `SOLICITUD_NO_ENCONTRADA` del seguimiento;
    7. clave de idempotencia (criterio 41);
    8. estado visible de la solicitud (criterio 40);
    9. imagen (400 `IMAGEN_NO_VALIDA`, criterio 39);
    10. dentro de la transacción, con las filas bloqueadas: estado otra vez, 409 `MONTO_DISTINTO`, 409
        `NUMERO_OPERACION_YA_USADO` y 409 `SIN_CUPO` (reintento).

    Ningún rechazo deja un pago, un archivo ni una auditoría. _(crítico)_ (HU-08, RNF-09; criterio 34 de 005)
38. **Datos del comprobante (provisional P6).** `numeroOperacion`: texto de 1 a 40 caracteres que, normalizado, cumple
    `^[0-9A-Z]{1,30}$` (otros caracteres, como letras con tilde, controles o caracteres de dirección, responden 400).
    `monto`: `montoSchema`; si no es igual al total a cobrar, 409 `MONTO_DISTINTO` con `detalles: { total }` (no hay pagos
    parciales ni de más). `fechaOperacion`: una fecha real `AAAA-MM-DD`, no posterior a hoy en Lima ni anterior al día en
    Lima en que se creó la solicitud; si no, 400 en ese campo. _(crítico)_ (HU-08, D-07, RNF-12)
39. **Número de operación sin duplicados.** Con un pago abierto de la academia con el número normalizado N y el mismo
    método (provisional P9), una subida con un número que se normaliza a N responde 409 `NUMERO_OPERACION_YA_USADO` sin
    escribir. Pruebas con `12345`, ` 12 345 `, `00012345`, `0001-2345`, `1.2345`, `１２３４５` y, para letras, `ab12` frente
    a `AB12`. Un número de un pago `RECHAZADO` se puede volver a usar (D-07); el de otra academia no cuenta. Dos subidas
    simultáneas con el mismo número para solicitudes distintas: exactamente una responde 201 y la otra 409
    `NUMERO_OPERACION_YA_USADO` (el código sale del nombre del índice violado, nunca 500). _(crítico)_ (HU-08, D-07, sección
    8.4; «el mismo número de operación con espacios, ceros o mayúsculas distintas» de `CLAUDE.md`)
40. **Imagen del comprobante.** Las mismas comprobaciones de la foto (criterio 34 g de 005 y `fotos.ts`: firma del tipo
    declarado, decodificable con `sharp`, lados de 100 a 8000 píxeles y hasta 40 megapíxeles). La imagen aceptada se
    vuelve a codificar como JPEG de como mucho 2000 píxeles en su lado mayor (provisional T8), con la orientación aplicada
    y sin metadatos (EXIF, GPS, XMP, ICC, comentarios), y se guarda en `AlmacenArchivos` con una clave del servidor
    (`academias/{academiaId}/pagos/{pagoId}/comprobante-{uuid}.jpg`) antes de la transacción. Si la transacción rechaza la
    subida, el archivo nuevo se borra; si la confirmación es incierta, se aplica el proceso de los criterios 61 y 64 de
    005 sobre la fila del pago. Ningún rechazo ni ningún pago resuelto borra un comprobante ya guardado (es evidencia).
    _(crítico)_ (HU-08, RNF-09; criterios 35 a 37, 61 y 64 de 005; regla «Archivos»)
41. **Estados en los que se sube.** Se acepta con estado visible `PENDIENTE_PAGO` (reserva vigente) o `PAGO_RECHAZADO`
    (D-05). Responde 409, sin escribir: `SOLICITUD_NO_EDITABLE` (`VENCIDA` o `CANCELADA`, también en el instante del
    vencimiento y después del fin del mes de la matrícula), `PAGO_EN_VERIFICACION` (ya hay uno en revisión) y
    `SOLICITUD_YA_PAGADA` (`CONFIRMADA`). Con `PAGO_RECHAZADO`, la matrícula vuelve de `CANCELADA` a `RESERVADA` con
    `reserva_vence_en` nula solo si todas sus clases tienen cupo (después de `bloquearClasesParaCupo`); si no, 409
    `SIN_CUPO` con `detalles.clasesSinCupo` y la solicitud sigue `PAGO_RECHAZADO`. Es la única transición de una matrícula
    desde `CANCELADA`, y solo con un último pago `RECHAZADO`. _(crítico)_ (D-05, RN-28, RN-11)
42. **Reintento con la misma clave.** Una subida con la `claveIdempotencia` de un pago ya creado para la misma
    solicitud, con los mismos datos, responde 200 con la vista actual, sin otro pago ni auditoría, y borra el archivo
    nuevo; con otra solicitud u otros datos, 409 `CLAVE_YA_USADA`. Dos subidas simultáneas con la misma clave dejan un
    pago. _(crítico)_ (idempotencia de `CLAUDE.md`)
43. **Límites y registro técnico.** La regla `comprobante` cuenta `PUT /api/a/{nombreCorto}/solicitudes/comprobante`
    (con mayúsculas distintas o barra final) por clave de conexión, sumando todas las academias, con su propio contador
    (agotarla no afecta a las demás ni al revés). Las cabeceras `X-Token-Solicitud` y `X-Pago-Datos` se redactan en todo
    el registro técnico; ninguna línea lleva el token, el DNI, el número de operación, el monto declarado ni el contenido
    de la imagen. _(crítico)_ (criterios 28, 33, 53 y 59 de 005)
44. **La reserva mientras se revisa.** Una matrícula con un comprobante en revisión ocupa su cupo sin límite de tiempo
    dentro de su mes (`contarOcupacion`, `contarInscritos`, cupos del formulario y criterio 17 de 005), también después
    de las 24 horas y en el último segundo del mes. En el mes siguiente no ocupa cupo (la ocupación es por mes) y su
    solicitud sigue `EN_VERIFICACION` hasta que se resuelve (criterio 52). _(crítico)_ (RN-28, DR-12 de 005)

### J. Bandeja de verificación **[007b]**

45. **Bandeja.** `GET /api/pagos/pendientes` (`VERIFICAR_PAGOS`) responde 200 con `{ pagos }`: los pagos
    `PENDIENTE_VERIFICACION` de la academia, del más antiguo al más nuevo, como mucho 200, cada uno (`pagoPendienteSchema`,
    estricto) con `id`, `metodo`, `monto`, `numeroOperacion` (el escrito), `fechaOperacion`, `enviadoEn`, `solicitud`
    (`id` y `codigo`), `cliente` (`nombres`, `apellidos`, `dni`), `mes` de la matrícula y `mesTerminado` (si «hoy» ya
    no es de ese mes, criterio 52). Sin datos médicos, apoderado, token ni la clave del archivo. No bloquea, no escribe y
    no audita. _(crítico)_ (HU-09, RN-21, D-23)
46. **Ver el comprobante.** `GET /api/pagos/{id}/comprobante` (`VERIFICAR_PAGOS`) responde 200 con la imagen guardada
    (`Content-Type: image/jpeg`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Disposition:
    inline`), para un pago Yape o transferencia en cualquier estado. Un pago en efectivo, inexistente, de otra academia o
    con un id inválido responde 404 `NO_ENCONTRADO`. `HEAD` sobre `/api/pagos` y lo que cuelga de ella responde 404 para
    cualquier rol, sin llamar al servicio ni al almacén (DT-9 de 006). Si el archivo falta en el almacén, 500 sin datos del
    archivo. No audita. _(crítico)_ (HU-09, D-23; DT-9 de 006)
47. **Aprobar.** `POST /api/pagos/{id}/aprobacion` (cuerpo `{}` estricto) con un pago `PENDIENTE_VERIFICACION` y la caja de
    hoy abierta responde 200 con `{ pago }`: el pago pasa a `CONFIRMADO` con `verificado_por` (el actor), `verificado_en`
    («ahora», distinto de la `fecha_operacion`, D-04) y su `numero_ticket`; su ingreso entra a la caja abierta con
    `registrarIngresoEnCaja` con su método real (`YAPE` o `TRANSFERENCIA`), que no suma al efectivo esperado; se confirma
    el pago (criterio 20); y se audita `PAGO_APROBADO` (entidad `pago`, `datosAntes: { estado }`, `datosDespues:
    { estado, numeroTicket }`). Sin caja abierta, 409 `SIN_CAJA_ABIERTA`; con la de otro día, `CAJA_DE_OTRO_DIA`; sin
    escribir nada. _(crítico)_ (HU-09, D-04, RN-17, HU-04)
48. **Aprobar dos veces, aprobar un rechazado.** Aprobar un pago ya `CONFIRMADO` responde 200 con el mismo pago, sin otro
    movimiento, usuario ni auditoría (aunque la caja ya esté cerrada). Aprobar uno `RECHAZADO` responde 409
    `PAGO_YA_RECHAZADO`. Dos aprobaciones simultáneas dejan un movimiento, una cuenta y una auditoría (las dos 200); una
    aprobación y un rechazo simultáneos dejan exactamente uno de los dos (200 y 409 `PAGO_YA_CONFIRMADO` o
    `PAGO_YA_RECHAZADO`). Sin `40P01` ni 500. _(crítico)_ («aprobar dos veces» y «aprobar un pago rechazado» de `CLAUDE.md`)
49. **Rechazar.** `POST /api/pagos/{id}/rechazo` con `{ motivo }` (`textoVisibleSchema`, de 3 a 200) sobre un pago
    `PENDIENTE_VERIFICACION` responde 200 con `{ pago }`: el pago pasa a `RECHAZADO` con `verificado_por`, `verificado_en`
    y el motivo; la matrícula pasa a `CANCELADA` con `reserva_vence_en` nula y el cupo se libera (después de
    `bloquearClasesParaCupo`); la solicitud sigue `PENDIENTE_PAGO` en la fila y se ve `PAGO_RECHAZADO`; la persona sigue en
    `CLIENTE`; se audita `PAGO_RECHAZADO` con `motivo`. No exige caja. Rechazar uno `CONFIRMADO` responde 409
    `PAGO_YA_CONFIRMADO`; rechazar uno ya `RECHAZADO` responde 200 con el pago como está, sin escribir ni auditar.
    _(crítico)_ (HU-09, RN-28, D-05)
50. **El cupo liberado se puede tomar.** Con una clase llena que incluye una matrícula con comprobante en revisión,
    después del rechazo un envío de la 005 por esa clase responde 201; y un reintento del cliente rechazado (criterio 41)
    responde 409 `SIN_CUPO`. Un rechazo y un envío simultáneos por esa clase terminan sin superar el aforo.
    _(crítico)_ (RN-28, RN-11)
51. **Correos después de confirmar.** Con `EnviadorCorreo` y `enviarSinEsperar`, después de confirmar la transacción,
    una vez por cada destinatario distinto entre el correo del alumno y, si es menor, el de su apoderado (DR-13 de 005),
    con los datos actuales del alumno (provisional P8):
    - a) al confirmar un pago (efectivo o aprobación): plantilla `PAGO_CONFIRMADO`, con el nombre de la academia, el
      código, la dirección de ingreso (`/a/{nombreCorto}/ingresar`) y el aviso de que el usuario y la contraseña inicial
      son su DNI y que debe cambiarla al entrar;
    - b) **[007b]** al rechazar: plantilla `PAGO_RECHAZADO`, con el código, el motivo y la indicación de entrar con su
      enlace o con el código y su DNI para subir otro comprobante. No lleva el enlace (el token no se guarda).

    Ningún correo lleva el DNI ni el token. Si la transacción falla o es un reintento (200), no se envía nada. La
    respuesta no espera al correo, y un fallo se registra solo con el tipo del error (criterios 51 y 52 de 005).
    _(crítico)_ (HU-09, D-08, D-19, DR-13 de 005)
52. **Comprobante en revisión cuando termina el mes (provisional P2).** Un pago cuya matrícula es de un mes que ya
    terminó en Lima se puede aprobar: entra a la caja abierta de hoy, la matrícula pasa a `VIGENTE` en su mes y la persona
    a `ALUMNO_ACTIVO` (las clases no usadas se tratan con RN-23 y la 018; el mes siguiente se paga con la renovación de la
    010). La bandeja lo marca con `mesTerminado: true` y la web lo destaca. También se puede rechazar; en ese caso la
    solicitud se ve `VENCIDA` (no se puede reintentar en un mes cerrado). Pruebas con `RELOJ` el 1 de diciembre a las 00:00
    de Lima con un pago de noviembre. _(crítico)_ (DR-12 de 005, D-04)
53. **Datos de pago de la academia (provisional P13).** La configuración (003) suma `yapeNumero` (celular de 9 dígitos),
    `yapeTitular`, `transferenciaBanco`, `transferenciaCuenta`, `transferenciaCci` y `transferenciaTitular`, todos
    opcionales, con `CONFIGURAR_ACADEMIA`. La consulta del seguimiento los devuelve en `academia.datosDePago` (solo los
    que tienen valor) cuando la solicitud está `PENDIENTE_PAGO` o `PAGO_RECHAZADO`, y la página los muestra junto al
    formulario del comprobante. _(prueba obligatoria)_ (HU-08; D-22)

### K. Web

54. **Panel de solicitudes.** En `/panel/solicitudes` cada tarjeta muestra el estado visible, el total y, si lo hay, el
    ajuste y el último pago. Con `REGISTRAR_INSCRIPCION_Y_COBRO`, «Cobrar en efectivo» (en `PENDIENTE_PAGO` y, **[007b]**,
    en `PAGO_RECHAZADO`) abre un diálogo con el total; si `GET /api/cajas/actual` no trae la caja de hoy abierta, avisa
    «Abre la caja antes de cobrar» con un enlace a `/panel/caja` y no permite confirmar. El diálogo guarda su clave de
    idempotencia (un doble clic no cobra dos veces) y, al terminar, ofrece «Imprimir ticket». Con `AJUSTAR_MONTO_COBRO`,
    «Ajustar monto» pide el monto y el motivo. Los 409 se muestran con su mensaje y la tarjeta se refresca. Las claves de
    consulta llevan la identidad de la sesión. _(prueba obligatoria)_ (HU-07, HU-34)
55. **Seguimiento y comprobante [007b].** La página de seguimiento muestra cada estado nuevo; en `PENDIENTE_PAGO` y
    `PAGO_RECHAZADO`, los datos de pago de la academia y el formulario «Pagar con Yape o transferencia» (método, número de
    operación, monto con el total ya escrito, fecha de la operación e imagen, desde la cámara o la galería), con su clave
    de idempotencia; en `PAGO_RECHAZADO`, el motivo; en `CONFIRMADA`, cómo ingresar. _(prueba obligatoria)_ (HU-08, D-05)
56. **Bandeja [007b] y ticket.** `/panel/pagos` (con `VERIFICAR_PAGOS`) lista los pendientes con la imagen ampliable, el
    monto, el número de operación, el cliente, la fecha de la operación y la del envío, y destaca `mesTerminado`.
    «Aprobar» confirma con un diálogo y avisa si no hay caja abierta; «Rechazar» pide el motivo y avisa que el cliente lo
    verá. La imagen se pide con la sesión y se muestra con una URL de objeto que se libera al cerrar. La página del ticket
    (criterio 27) es de la 007a. Las opciones del inicio usan `puede(rol, …)`. _(prueba obligatoria)_ (HU-09)

### L. Semilla y documentación

57. **Semilla y documentación.** En `delfines`, la semilla suma (sin duplicar ni pisar lo editado al repetirla): **(007a)**
    un ajuste de monto con motivo en una solicitud de ejemplo; **[007b]** un pago Yape pendiente de verificación con un
    comprobante de ejemplo inventado (una imagen generada, sin datos reales) y los datos de pago de ejemplo de la
    academia. No se siembran pagos confirmados (exigirían un movimiento en una caja abierta). `tiburones` queda sin pagos.
    `docs/arquitectura.md` documenta las tablas, las reglas para las historias siguientes, las rutas y los riesgos; el
    `README.md` y la guía de uso, el cobro, la bandeja y el ajuste. _(revisor)_

## Casos límite

- **Cobro a las 23:59:59.999 del último día con la caja de ese día:** se acepta; a las 00:00 del día siguiente responde
  `CAJA_DE_OTRO_DIA` (criterio 14).
- **Cobro de una solicitud cuya reserva vence mientras se cobra:** se decide con el instante leído después de bloquear
  las clases (criterio 18 b).
- **Doble clic en «Cobrar»:** un solo pago, un movimiento y una cuenta (criterio 17).
- **El administrador ajusta el monto mientras la secretaria tiene el diálogo abierto:** 409 `MONTO_CAMBIO`; la web
  refresca el total (criterios 12 y 16).
- **Cliente con el DNI de un entrenador creado antes de esta historia:** 409 `DNI_DEL_PERSONAL` al cobrar o aprobar
  (criterio 22 a).
- **Alumno que intenta entrar antes de pagar:** su DNI no tiene cuenta; responde como un usuario inexistente (criterio
  21).
- **[007b] Yape con el número escrito con espacios o con ceros adelante:** se normaliza y choca con el ya registrado
  (criterio 39).
- **[007b] El mismo número en un Yape y en una transferencia:** con la propuesta P9 no choca (el método es parte del
  índice).
- **[007b] Comprobante con un monto distinto del total:** 409 `MONTO_DISTINTO` con el total (criterio 38).
- **[007b] Comprobante rechazado por foto ilegible, con el mismo número de operación:** se acepta otra vez (el rechazado
  no cuenta, criterio 39), si todavía hay cupo (criterio 41).
- **[007b] Rechazo el 30 de noviembre y reintento el 1 de diciembre:** la solicitud se ve `VENCIDA`; 409
  `SOLICITUD_NO_EDITABLE`; la persona se vuelve a inscribir para diciembre (criterios 41 y 52).
- **[007b] Yape subido el 29 y revisado el 1 del mes siguiente:** se puede aprobar con `mesTerminado` (criterio 52).
- **[007b] Secretaria que aprueba sin abrir la caja:** 409 `SIN_CAJA_ABIERTA`; nada cambia (criterio 47).
- **[007b] Aprobar y rechazar a la vez:** gana uno (criterio 48).
- **[007b] Cancelar una solicitud con un Yape en revisión:** 409 `SOLICITUD_CON_PAGO_PENDIENTE` (criterio 30).
- **[007b] Cliente con un pago rechazado que llena de nuevo el formulario:** se acepta (criterio 32); el enlace anterior
  pasa a la vista reducida.
- **[007b] Comprobante con coordenadas GPS en el EXIF:** se guarda sin metadatos (criterio 40).
- **[007b] Comprobante de 5 242 880 bytes:** pasa al resto de las comprobaciones; un byte más, 413.
- **[007b] Un comprobante en revisión ocupa el cupo de noviembre; el 1 de diciembre no ocupa el de diciembre**
  (criterio 44), pero el cliente sigue sin poder inscribirse de nuevo hasta que se resuelva (criterio 32).
- **Inscripción desde recepción con muchas solicitudes seguidas:** no cuentan en los límites por conexión (criterios 33
  y 34); los clientes que usan el wifi de la academia sí cuentan entre ellos.
- **Secretaria desactivada mientras inscribe desde recepción:** 401 sin escribir (criterio 34 a).

## Reglas de negocio aplicables

- **RN-01 y HU-04:** cliente hasta que su primer pago se confirma; con el pago confirmado, «Alumno activo» con usuario y
  contraseña iguales a su DNI.
- **RN-02, HU-05, RNF-03 y RNF-04:** contraseña inicial igual al DNI, con argon2 y cambio obligatorio en el primer
  ingreso.
- **RN-03 y D-28:** DNI único por academia, también entre el personal y los alumnos (P1).
- **RN-04, HU-07 a HU-09:** efectivo confirmado al instante; Yape y transferencia con foto, número de operación, monto y
  fecha, pendientes hasta que la secretaria los apruebe o los rechace con motivo; quién verificó y cuándo.
- **RN-05:** el carnet solo con el pago confirmado (lo genera la 008).
- **RN-17, D-04 y DR-2 de 006:** ningún cobro ni verificación sin la caja de hoy abierta; un Yape entra a la caja abierta
  al verificarlo, con su método, y no suma al efectivo esperado.
- **RN-22 y RNF-06:** auditoría de cobros, verificaciones, rechazos y ajustes.
- **RN-25, HU-34 y D-03:** el total sale de la matrícula; el ajuste del administrador reemplaza al monto calculado, con
  motivo; redondeo hacia arriba al sol entero, una vez.
- **RN-27:** solo la mensualidad.
- **RN-28 y D-05:** el comprobante en revisión reserva el cupo sin límite; el rechazo lo libera; se puede reintentar
  desde el enlace si hay cupo.
- **D-07:** fecha de operación, caja al verificar (el movimiento) y número de operación sin repetir entre pendientes y
  confirmados.
- **D-08 y D-19:** avisos por correo (simulado), nunca por WhatsApp.
- **D-09:** ticket interno, sin SUNAT.
- **D-23 y D-29:** todo por academia; el Superadmin no ve pagos.
- **Reglas de `docs/arquitectura.md`:** `bloquearActorVigente` primero; orden de bloqueos con la caja al final;
  `bloquearClasesParaCupo` antes de contar; `registrarIngresoEnCaja` con el actor; montos `Decimal`; fechas de Lima con
  `RELOJ`; 409 por el nombre de la restricción; archivos con `AlmacenArchivos` y recodificados; tokens solo en cabeceras o
  en el cuerpo; correo después de confirmar y sin esperar; sin caché en los servicios.

## Contrato

### Rutas

Mismas reglas que 001 a 006: `Cache-Control: no-store`, cuerpos JSON con esquemas estrictos (salvo el comprobante, que
es binario), y el orden de 002 en las rutas del panel (sesión → academia activa → cambio obligatorio → permiso → cuerpo
→ operación). El `{id}` lo valida el servicio después de `bloquearActorVigente` (AT-2 de 004).

| Método y ruta | Permiso | Entrada | Éxito | Errores |
| --- | --- | --- | --- | --- |
| `POST /api/solicitudes/{id}/pago-efectivo` | `REGISTRAR_INSCRIPCION_Y_COBRO` | `cobrarEnEfectivoSchema` | 201 (200 si es un reintento) `{ pago, solicitud }` | 400, 401, 403, 404, 409 (ver orden) |
| `POST /api/solicitudes/{id}/ajuste-monto` | `AJUSTAR_MONTO_COBRO` | `ajustarMontoSchema` | 200 `{ solicitud }` | 400, 401, 403, 404, 409 `SOLICITUD_NO_AJUSTABLE` |
| `GET /api/pagos/{id}/ticket` | `REGISTRAR_INSCRIPCION_Y_COBRO` | — | 200 `{ ticket }` | 401, 403, 404 |
| `GET /api/solicitudes?estado=` (de 005b) | `REGISTRAR_INSCRIPCION_Y_COBRO` | suma `CONFIRMADAS` | 200 (elementos con `ajuste` y `pago`) | los de 005b |
| `POST /api/solicitudes/{id}/cancelar` (de 005b) | `REGISTRAR_INSCRIPCION_Y_COBRO` | — | los de 005b | suma 409 `SOLICITUD_CON_PAGO_PENDIENTE` |
| `POST /api/usuarios` (de 002) | `GESTIONAR_USUARIOS` | — | los de 002 | 409 `DNI_EN_USO` también con el DNI de un alumno (P1) |
| Rutas públicas de 005 con límite | pública (sesión opcional de recepción) | — | las de 005 | las de 005 (criterios 33 a 35) |
| **[007b]** `PUT /api/a/{nombreCorto}/solicitudes/comprobante` | pública, `X-Token-Solicitud` y `X-Pago-Datos` | JPEG o PNG hasta 5 242 880 bytes | 201 (200 si es un reintento) `{ solicitud }` | en el orden del criterio 37 |
| **[007b]** `GET /api/pagos/pendientes` | `VERIFICAR_PAGOS` | — | 200 `{ pagos }` | 401, 403 |
| **[007b]** `GET /api/pagos/{id}/comprobante` | `VERIFICAR_PAGOS` | — | 200 `image/jpeg` | 401, 403, 404, 500 |
| **[007b]** `POST /api/pagos/{id}/aprobacion` | `VERIFICAR_PAGOS` | `{}` | 200 `{ pago }` | 400, 401, 403, 404, 409 (ver orden) |
| **[007b]** `POST /api/pagos/{id}/rechazo` | `VERIFICAR_PAGOS` | `rechazarPagoSchema` | 200 `{ pago }` | 400, 401, 403, 404, 409 `PAGO_YA_CONFIRMADO` |

**Orden de los errores del cobro en efectivo** (después del 400 del esquema): 401 (actor) → 404 → la clave
(`CLAVE_YA_USADA`, o 200 si es el mismo cobro) → `SOLICITUD_YA_PAGADA` → `PAGO_EN_VERIFICACION` → `SOLICITUD_NO_COBRABLE`
→ `MONTO_CAMBIO` → `SIN_CUPO` (con las clases bloqueadas) → `DNI_DEL_PERSONAL` → `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`
(la caja, al final).

**Orden de los errores de la aprobación:** 401 → 404 → 200 si ya está `CONFIRMADO` → `PAGO_YA_RECHAZADO` →
`DNI_DEL_PERSONAL` → `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`.

### Esquemas compartidos (`packages/contratos/src/`)

- `pagos.ts` (nuevo): `ESTADOS_PAGO`, `numeroOperacionSchema` y `normalizarNumeroOperacion` (función pura que usan la API,
  la web y las pruebas), `cobrarEnEfectivoSchema` (`{ claveIdempotencia, montoMostrado }`), `ajustarMontoSchema`
  (`{ montoAjustado, motivo }`), `pagoSchema` (`{ id, estado, metodo, concepto, monto, registradoEn, verificadoEn,
  numeroOperacion, fechaOperacion, motivoRechazo, numeroTicket }`), `ticketSchema`, **[007b]** `datosComprobanteSchema`,
  `CABECERA_DATOS_PAGO = 'X-Pago-Datos'`, `pagoPendienteSchema`, `rechazarPagoSchema` (`{ motivo }`) y
  `COMPROBANTE_LADO_GUARDADO = 2000`.
- `solicitudes.ts`: `ESTADOS_SOLICITUD` y `vistaSolicitudSchema` suman los estados del criterio 28;
  `solicitudPanelSchema` suma `ajuste` y `pago`; `FILTROS_ESTADO_SOLICITUDES` suma `CONFIRMADAS`.
- `permisos.ts`: `AJUSTAR_MONTO_COBRO`.
- **[007b]** `configuracion.ts`: las claves de los datos de pago (criterio 53); `academiaPublica` del seguimiento suma
  `datosDePago`.

### Interfaces del backend (para las historias siguientes)

```ts
// backend/src/modulos/pagos/confirmacion.ts (sin Nest; reexportada en pagos/index.ts). La 007b (aprobación), la 010
// (renovación) y la 016 (clase particular) la reutilizan para confirmar un pago dentro de su transacción.
// Precondiciones: quien llama ya llamó a bloquearActorVigente, tomó el bloqueo consultivo del DNI, bloqueó el alumno, la
// solicitud, la matrícula y el pago (en ese orden) y, si mueve cupo, las clases. Registra el ingreso en caja (bloquea la
// caja al final), asigna el número de ticket, deja el pago CONFIRMADO y, si el alumno es CLIENTE, crea su cuenta con
// crearEnTransaccion y lo pasa a ALUMNO_ACTIVO. Lanza ErrorNegocio 409 SIN_CAJA_ABIERTA, CAJA_DE_OTRO_DIA o
// DNI_DEL_PERSONAL (la transacción completa se revierte).
function confirmarPagoEnTransaccion(tx: TransaccionAcademia, entrada: {
  pagoId: string; alumnoId: string; matriculaId: string; solicitudId: string | null;
  claveHash: string | null;          // la del DNI, calculada antes de la transacción; null si el alumno ya tiene cuenta
  actor: { id: string };            // el actor ya bloqueado
  ip: string | null;
}, ahora: Date): Promise<{ numeroTicket: number; usuarioCreado: boolean }>;

// backend/src/modulos/pagos/dominio/numero-operacion.ts (pura; la misma de packages/contratos).
function normalizarNumeroOperacion(escrito: string): string | null; // null si no cumple ^[0-9A-Z]{1,30}$ tras normalizar

// backend/src/modulos/pagos/dominio/total.ts (pura).
function totalACobrar(matricula: { precioPlan: Decimal; clasesPorMesPlan: number; clasesTotales: number;
  montoAjustado: Decimal | null }): Decimal; // calcularTotal con baseProporcional; entero de soles
```

### Auditoría

Entidad `pago`, actor `USUARIO` (o `PUBLICO` en la subida del comprobante), montos como texto con dos decimales, sin
DNI, token ni datos de salud:

- `PAGO_REGISTRADO` (efectivo, criterio 13), **[007b]** `PAGO_COMPROBANTE_REGISTRADO` (criterio 36), **[007b]**
  `PAGO_APROBADO` (criterio 47) y **[007b]** `PAGO_RECHAZADO` (criterio 49, con `motivo`).
- `MATRICULA_MONTO_AJUSTADO` (entidad `matricula`, con `motivo`, criterio 11).
- Se suman las de otras historias en la misma transacción: `CAJA_INGRESO_REGISTRADO` (006) y `USUARIO_CREADO` (002, que
  guarda el DNI como usuario: ver «Riesgos aceptados»).
- `SOLICITUD_INSCRIPCION_CREADA` con actor `USUARIO` cuando inscribe recepción (criterio 34).
- Las lecturas, el ticket, el comprobante y las respuestas 200 de un reintento no auditan.

### Códigos de error nuevos

`SOLICITUD_YA_PAGADA`, `PAGO_EN_VERIFICACION`, `SOLICITUD_NO_COBRABLE`, `SOLICITUD_NO_AJUSTABLE`,
`SOLICITUD_CON_PAGO_PENDIENTE`, `DNI_DEL_PERSONAL`, `MONTO_DISTINTO`, `NUMERO_OPERACION_YA_USADO`, `PAGO_YA_CONFIRMADO`
y `PAGO_YA_RECHAZADO` (409). Se reutilizan `SOLICITUD_INVALIDA`, `NO_ENCONTRADO`, `MONTO_CAMBIO`, `SIN_CUPO`,
`CLAVE_YA_USADA`, `SIN_CAJA_ABIERTA`, `CAJA_DE_OTRO_DIA`, `DNI_EN_USO`, `SOLICITUD_NO_EDITABLE`,
`SOLICITUD_NO_CANCELABLE`, `SOLICITUD_NO_ENCONTRADA`, `IMAGEN_NO_VALIDA`, `CARGA_EXCESIVA`, `DEMASIADAS_SOLICITUDES` y los
de sesión, academia y permisos.

### Eventos

Ninguno. Los correos son efectos después de confirmar (criterio 51).

## Cambios al modelo de datos

Dos migraciones en la 007a; la 007b no tiene (salvo que la implementación necesite algo más, que se agrega aquí antes
de tocar el código).

- **`<marca>_estado_solicitud_confirmada`:** `ALTER TYPE estado_solicitud ADD VALUE 'CONFIRMADA'`, sola (un valor
  nuevo de un enum no se puede usar en la misma transacción que lo crea).
- **`<marca>_pagos`:**
  - Tipo `estado_pago` (`PENDIENTE_VERIFICACION`, `CONFIRMADO`, `RECHAZADO`; sección 8.8). Reutiliza `metodo_pago` y
    `concepto_movimiento_caja` de la 006.
  - **`pagos`:** `id uuid` PK; `academia_id` → `academias`; `alumno_id` y `matricula_id` con la llave compuesta
    `(academia_id, matricula_id, alumno_id) → matriculas (academia_id, id, alumno_id)` (con un `UNIQUE` nuevo en
    `matriculas` sobre esas tres columnas) y `(academia_id, alumno_id) → alumnos`; `concepto concepto_movimiento_caja`;
    `metodo metodo_pago`; `estado estado_pago`; `monto numeric(10,2)`; `numero_operacion text null`;
    `numero_operacion_normalizado text null`; `fecha_operacion date null`; `comprobante_clave text null`;
    `ip_origen inet null`; `registrado_por uuid null` y `verificado_por uuid null` (llaves compuestas a `usuarios`);
    `registrado_en timestamptz(3)`; `verificado_en timestamptz(3) null`; `motivo_rechazo text null`;
    `numero_ticket integer null`; `clave_idempotencia uuid`; `creado_en`, `actualizado_en`.
  - Índices: `UNIQUE (academia_id, id)`; `UNIQUE (academia_id, clave_idempotencia)`; `UNIQUE (academia_id,
    numero_ticket)`; `pagos_un_abierto_por_matricula` sobre `(academia_id, matricula_id) WHERE estado IN
    ('PENDIENTE_VERIFICACION', 'CONFIRMADO')`; `pagos_numero_operacion_abierto_key` sobre `(academia_id, metodo,
    numero_operacion_normalizado) WHERE estado IN ('PENDIENTE_VERIFICACION', 'CONFIRMADO') AND
    numero_operacion_normalizado IS NOT NULL` (provisional P9); `(academia_id, estado, registrado_en)` para la bandeja.
  - `CHECK` del criterio 4; trigger `pagos_transiciones` (criterio 6); trigger de restricción diferido
    `pagos_confirmado_con_movimiento` en `pagos` y en `movimientos_caja` (criterio 5). Las funciones son `SECURITY
    INVOKER`, con `search_path` fijo y `REVOKE ALL … FROM PUBLIC`.
  - RLS activada y forzada con políticas de `SELECT`, `INSERT` y `UPDATE` de la forma del criterio 132 de 001.
  - `movimientos_caja`: llave compuesta `(academia_id, pago_id) → pagos (academia_id, id)`, `DEFERRABLE INITIALLY
    DEFERRED` (antes sin llave; diferida porque el pago en efectivo se inserta completo después de su movimiento, ver
    plan).
  - `solicitudes_inscripcion`: `registrada_por uuid null` con llave compuesta a `usuarios` (solo `INSERT`).
  - Privilegios del criterio 2. `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` se amplían en
    el mismo cambio.
- **[007b]** Sin migración: la configuración es clave y valor (003); las claves nuevas del criterio 53 van en
  `CLAVES_CONFIGURACION`.

## Fuera de alcance

- **Carnet digital y QR:** 008 (RN-05). La 007 deja al alumno `ALUMNO_ACTIVO` con su cuenta; la 008 genera el carnet.
- **Renovaciones y mensualidades, y su cobro:** 010 (reutiliza `confirmarPagoEnTransaccion` con concepto `MENSUALIDAD`).
- **Códigos de descuento:** 015 (el total ya admite el descuento, criterio 10 de 005).
- **Cobro de clases particulares:** 016.
- **Ajuste de las clases totales de la matrícula (HU-34, «o las clases»):** fuera, provisional P11.
- **Facturación SUNAT:** último módulo (D-09).
- **Anular o devolver un pago confirmado, pagos parciales y pagos de más:** no (DR-5 de 006; P6).
- **Yape o transferencia registrados por la secretaria en recepción:** según P7 (provisional: fuera).
- **Panel del alumno:** 011. Después de entrar y cambiar su contraseña, el alumno ve el inicio genérico de la 002.
- **Reportes R1, R2 y R8:** Fase 3.
- **Retención y borrado de los comprobantes y de los datos de solicitudes no pagadas (Ley 29733):** pendiente antes de
  producción, como en la 005 (DR-18 de 005).
- **Volver a enviar el enlace de seguimiento:** no se puede (solo se guarda el hash del token).

## Impacto en especificaciones anteriores

- **001, catálogo y privilegios:** `TABLAS_DESPUES_DE_MIGRAR`, `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` suman `pagos`
  y las columnas nuevas de `UPDATE`; las funciones de los triggers son `SECURITY INVOKER` (sin excepción en
  `FUNCIONES_SECURITY_DEFINER_PERMITIDAS`). Las pruebas protegidas que comparan listas exactas las actualiza el
  test-writer, solo para sumar, en el commit de pruebas protegidas de la 007a.
- **002, criterio 26 (matriz):** suma `AJUSTAR_MONTO_COBRO` (de 25 a 26 filas), solo para sumar la fila.
- **002, `POST /api/usuarios`:** con P1, responde 409 `DNI_EN_USO` también con el DNI de un alumno o de un cliente con
  solicitud activa, y toma el bloqueo consultivo del DNI después del actor. `crearEnTransaccion` no cambia.
- **005, estado visible (PB2) y vistas:** `estadoVisible` y `estadoVisibleSql` suman las reglas de la definición, y
  `vistaSolicitudSchema`, `solicitudPanelSchema` y los filtros suman lo del criterio 28 y 29. Las pruebas protegidas de
  la 005 que fijan las claves exactas de un elemento del panel (`panel-solicitudes-lista.test.ts`) las actualiza el
  test-writer solo para sumar `ajuste` y `pago`, con la aprobación del orquestador; las de la vista de seguimiento no
  cambian (sus estados no cambian de forma).
- **005, cancelación, foto y envío:** criterios 30 a 32 y 34. El envío suma la sesión opcional de recepción
  (`registrada_por`, actor `USUARIO`, sin el límite de 5).
- **005, middleware de `/api/a` (`proteccion-de-prefijos.ts`):** la sesión de recepción no cuenta en `LIMITES_PUBLICOS`
  (criterio 33); **[007b]** suma la regla `comprobante` y `LimitePublico` ya admite `PUT`. `crear-app.ts` suma la ruta del
  comprobante a `noLeerCuerpoEn` **[007b]**. `RUTAS_REDACTADAS` suma `req.headers["x-pago-datos"]` **[007b]**; la prueba
  no protegida `opciones-registro.test.ts` pasa de 5 a 6 en el mismo cambio.
- **005, panel:** el `monto` del elemento pasa a ser el total a cobrar (igual al de antes cuando no hay ajuste).
- **006, `movimientos_caja.pago_id`:** gana su llave foránea (criterio 1). Las pruebas de la 006 que llaman a
  `registrarIngresoEnCaja` con un `pagoId` inventado (criterios 24, 25, 26 y 48) dejarían de pasar: el test-writer las
  ajusta en el commit de pruebas protegidas de la 007a, solo para crear antes el pago de ese `pagoId` (como dueño de las
  tablas, con la transacción que también inserta el movimiento, por el criterio 5), sin cambiar lo que comprueban. Lo
  aprueba el orquestador antes del commit.
- **006, regla «Después de la caja solo se insertan filas y auditoría»:** se precisa: después de la caja también se
  actualizan filas que la misma transacción ya bloqueó (el pago, el alumno, la solicitud y la matrícula), porque no
  esperan a nadie.
- **006, `HEAD`:** el middleware de `instalarHeadSinRutasDeCaja` se amplía a `/api/pagos` **[007b]** (DT-9 de 006).
- **003 [007b]:** `CLAVES_CONFIGURACION`, `GET` y `PATCH /api/configuracion` suman las claves del criterio 53. Si una
  prueba protegida de 003 fija las claves exactas, el test-writer la actualiza solo para sumar.
- **Correo:** `PlantillaDeCorreo` suma `PAGO_CONFIRMADO` y **[007b]** `PAGO_RECHAZADO`.
- **`docs/arquitectura.md`:** secciones nuevas (criterio 57).

## Reglas para las historias siguientes

- **Confirmar un pago (010, 016).** Todo pago se confirma con `confirmarPagoEnTransaccion`, dentro de la transacción que
  lo deja `CONFIRMADO`: registra el ingreso en la caja abierta de hoy, numera el ticket y, si es el primer pago, crea la
  cuenta del alumno. La base no acepta un pago confirmado sin su movimiento (criterio 5).
- **Orden de bloqueos de un cobro.** `usuarios` (actor) → bloqueo consultivo `'inscripcion-dni:' || academia || ':' ||
  dni` → `alumnos` → `solicitudes_inscripcion` → `matriculas` → `pagos` → `clases` (si mueve cupo) → la caja. Después
  de la caja solo se insertan filas y se actualizan las ya bloqueadas.
- **Un pago abierto por matrícula** y **un número de operación por academia y método entre los pagos abiertos**: lo
  garantiza la base; el 409 sale del nombre del índice.
- **El número de operación se compara normalizado** con `normalizarNumeroOperacion`.
- **Un pago resuelto no cambia** (criterio 6): una corrección es otra operación, con su auditoría.
- **El total a cobrar sale de la matrícula** con `totalACobrar` (D-03); nunca del plan.

## Riesgos aceptados

- **Contraseña inicial conocida (RN-02):** quien sepa el DNI de un alumno nuevo puede entrar antes que él y cambiar la
  contraseña. Es la regla del documento; lo mitigan el cambio obligatorio, el bloqueo por intentos y el restablecimiento
  por la secretaria (002).
- **El DNI en la auditoría de la cuenta:** `USUARIO_CREADO` (002) guarda el DNI como usuario, también el de un menor. La
  auditoría es interna de la academia y el DNI es el usuario (RN-02); no se cambia la función de 002.
- **Identidad sin pasar por recepción (P3):** con Yape o transferencia, la cuenta se crea sin ver el DNI físico.
- **[007b] Comprobantes falsos o editados:** la verificación es humana (sección 8.4); el sistema solo impide repetir el
  número de operación.
- **[007b] Archivos sin referencia:** como la foto de la 005b (un archivo guardado cuya transacción falló o cuya
  confirmación quedó incierta). Una limpieza periódica queda para cuando haya proveedor de archivos.
- **[007b] Saber si un número de operación ya se usó:** el 409 de HU-08 lo revela a quien tiene un token válido; lo
  limitan el token y el límite por conexión.
- **Correo que no llega:** sin reintento, como en la 005; el cliente ve el estado en su enlace.
- **Ticket sin valor tributario:** hasta el módulo de facturación (D-09); la leyenda lo dice (P4).

## Decisiones

Ninguna todavía: las preguntas de negocio y las propuestas técnicas esperan la aprobación (sección siguiente).

## Preguntas abiertas

### De negocio, para el responsable (P1 a P14)

Cada una lleva la propuesta y su valor provisional, que es el que usan los criterios mientras no haya respuesta.

- **P1. DNI del personal igual al de un cliente (DR-16 de 005).** Una cuenta tiene un solo rol, y el DNI es único por
  academia, así que una persona no puede ser a la vez entrenador y alumno en la misma academia. _Propuesta:_ el personal y
  los alumnos no comparten DNI. Al crear personal con el DNI de un alumno o de un cliente con solicitud en curso, se
  rechaza; si al cobrar ya hay un miembro del personal con ese DNI (datos de antes), se rechaza el cobro y el
  administrador lo resuelve con la persona. _Alternativas:_ (b) permitir que el personal también sea alumno, con varios
  roles por cuenta (cambia la 002 y los permisos; es una historia aparte); (c) no revisar al crear personal y solo
  rechazar al cobrar (el problema aparece tarde, con el cliente en recepción).
- **P2. Yape en revisión cuando termina el mes (DR-12 de 005).** _Propuesta:_ se puede aprobar igual: el dinero llegó y
  la demora fue de la academia. El pago entra a la caja del día en que se revisa, el alumno queda activo y su inscripción
  es del mes en que pagó; el mes siguiente lo paga con la renovación. La bandeja marca estos pagos para revisarlos
  primero. _Alternativas:_ (b) no permitir aprobarlo: se rechaza y la devolución se hace fuera del sistema; (c) pasarlo
  al mes nuevo con un nuevo cálculo del monto (más complejo y con diferencias de dinero).
- **P3. Identidad en los pagos que no pasan por recepción (DR-14 de 005).** Con Yape, nadie ve el DNI físico antes de
  crear la cuenta. _Propuesta:_ se acepta el riesgo en esta historia; el DNI físico se revisa la primera vez que la
  persona va a la academia (al entregarle el carnet o en su primera clase), y la 008 o la 009 pueden sumar una marca
  «DNI comprobado». _Alternativas:_ (b) aprobar el Yape pero crear la cuenta recién cuando la persona muestre su DNI en
  recepción (contradice «se crea automáticamente» de HU-04); (c) pedir una foto del DNI al subir el comprobante (más
  datos personales que cuidar).
- **P4. Ticket interno (D-09).** _Propuesta:_ una página imprimible, en papel de 80 mm (ticketera) o A4, con el nombre y
  el teléfono de la academia, un número correlativo por academia, fecha y hora, nombres y apellidos del alumno (sin DNI),
  plan y mes, método, número de operación si es Yape o transferencia, monto, quién cobró y la frase «Comprobante interno
  de pago. No es un comprobante electrónico SUNAT». El cliente que pagó por Yape ve el número del ticket en su enlace,
  pero no lo imprime desde ahí. _Alternativas:_ (b) un PDF descargable; (c) mostrar el DNI completo o parcial; (d)
  ¿confirmar con el contador la frase y si conviene entregar este papel?
- **P5. Rechazo y nuevo intento (D-05).** _Propuesta:_ al rechazar, el cupo se libera en ese momento; el cliente ve el
  motivo en su enlace y por correo, y puede subir otro comprobante (o pagar en efectivo) las veces que necesite mientras
  sea el mismo mes y haya cupo. La secretaria escribe el motivo sabiendo que el cliente lo leerá. _Alternativas:_ (b)
  guardar el cupo unas horas después del rechazo para que pueda corregir (contradice «al rechazarse, el cupo se libera»
  de RN-28); (c) no mostrar el motivo al cliente (solo «rechazado, llama a la academia»).
- **P6. Monto y datos del comprobante.** _Propuesta:_ no hay pagos parciales ni de más: el monto del comprobante debe ser
  igual al total; si no, el sistema avisa antes de enviar. La fecha de la operación no puede ser futura ni anterior al
  día de la inscripción. _Alternativas:_ (b) aceptar cualquier monto y que la secretaria decida al revisar; (c) aceptar
  pagos parciales con saldo pendiente (cambia el cobro, la caja y el estado del alumno).
- **P7. Yape o transferencia en recepción.** Un cliente en el mostrador paga con Yape al celular de la academia.
  _Propuesta:_ en esta historia, recepción solo cobra en efectivo; quien paga con Yape lo hace desde su enlace (también
  en el mostrador, con su celular). _Alternativas:_ (b) la secretaria registra el Yape en el panel con el número de
  operación, después de verlo en el celular de la academia, y queda confirmado al instante, sin foto (iría en la 007b);
  (c) lo mismo, pero con la foto, y se aprueba en la bandeja.
- **P8. Correos.** _Propuesta:_ dos avisos por correo (si hay correo), al alumno y al apoderado: «pago confirmado», con
  cómo ingresar (usuario y contraseña inicial, su DNI, con el aviso de cambiarla), y «pago rechazado», con el motivo. No
  se avisa al recibir el comprobante (lo ve en su enlace). _Alternativas:_ (b) también un correo al recibir el
  comprobante; (c) solo el de rechazo, que es el que pide HU-09.
- **P9. ¿El número de operación se compara también entre Yape y transferencia?** _Propuesta:_ no: no se repite dentro
  del mismo método (un número de Yape y el de un banco pueden coincidir sin ser el mismo pago). Los espacios, guiones,
  puntos, mayúsculas y ceros a la izquierda no cuentan. _Alternativa:_ (b) un número no se repite en ningún método (más
  estricto; un pago real podría quedar bloqueado y solo se resolvería con otro número).
- **P10. ¿Se puede pagar una solicitud vencida?** _Propuesta:_ no: se vuelve a llenar el formulario (en recepción, con
  «Nueva inscripción»; con el mismo DNI se acepta), y el monto se calcula de nuevo con las clases que quedan.
  _Alternativa:_ (b) un botón «renovar la reserva» que vuelve a pedir cupo y recalcula el monto sin llenar todo otra vez.
- **P11. Ajuste del monto (RN-25, HU-34).** _Propuesta:_ solo el administrador, antes de que haya un pago (pendiente de
  pago o tras un rechazo), en soles enteros de S/ 1 en adelante (el total igual se redondea al sol), con motivo. No se
  puede dejar en S/ 0: las becas llegan con los códigos de descuento (015). En esta historia solo se ajusta el monto; el
  ajuste de las clases del mes («o las clases» de HU-34) va con la asistencia o las mensualidades (009 o 010).
  _Alternativas:_ (b) permitir céntimos; (c) permitir S/ 0 (sin cobro ni movimiento de caja); (d) ajustar también las
  clases en esta historia.
- **P12. ¿Se puede cancelar una solicitud con un Yape en revisión?** _Propuesta:_ no: primero se rechaza el comprobante
  (con su motivo) y después se cancela. _Alternativa:_ (b) cancelar rechaza el comprobante automáticamente.
- **P13. ¿Dónde ve el cliente a qué número yapear o a qué cuenta transferir?** No está en los documentos. _Propuesta:_ el
  administrador los escribe en la configuración de su academia (número de Yape y titular; banco, cuenta, CCI y titular),
  y el enlace de seguimiento los muestra junto al formulario del comprobante. _Alternativa:_ (b) la secretaria los
  comparte por teléfono.
- **P14. ¿Dividimos la historia?** Es grande: tablas, cobro, cuenta del alumno, ticket, ajuste, límites de recepción,
  comprobante, bandeja, aprobación y rechazo. _Propuesta:_ dos entregas, las dos de ruta crítica: **007a · cobro en
  recepción y cuenta del alumno** (primero) y **007b · Yape y transferencia** (después), como dice «División en 007a y
  007b». _Alternativas:_ (b) una sola entrega; (c) tres, separando la subida del comprobante (007b) de la bandeja (007c).

**Resuelto por los documentos, sin pregunta:** quién verifica (el administrador y la secretaria, sección 2.1) y con qué
caja (la abierta de hoy, D-04 y DR-2 de 006); la verificación es humana (sección 8.4).

### Técnicas, para el orquestador (T1 a T16)

- **T1. La tabla `pagos` completa en la 007a,** con las columnas del Yape, para que la 007b no tenga migración.
  _Alternativa:_ cada entrega su migración (cambian dos veces las pruebas de catálogo).
- **T2. La caja del pago sale de su movimiento** (`movimientos_caja.pago_id`, único y con llave), sin `caja_id` en
  `pagos`, y un trigger de restricción diferido garantiza «confirmado ⇔ un movimiento» (criterio 5). _Alternativa:_
  `pagos.caja_id` (dos fuentes que pueden no coincidir; un `CHECK` no puede verlo, porque el movimiento se inserta
  después del pago).
- **T3. Trigger de transiciones** (criterio 6) además de la lógica del servicio. _Alternativa:_ solo el servicio.
- **T4. Un solo estado nuevo en la fila de la solicitud (`CONFIRMADA`);** `EN_VERIFICACION` y `PAGO_RECHAZADO` se calculan
  con el pago. Mantiene «una solicitud abierta por alumno» con el índice de la 005. _Alternativa:_ guardar los tres en
  la fila (dos fuentes del mismo hecho y un índice más complejo).
- **T5. Rechazo: la matrícula pasa a `CANCELADA`; el reintento la vuelve a `RESERVADA`** (la única salida de
  `CANCELADA`, solo con un último pago rechazado). Conserva el monto y las clases de la matrícula (DR-2 de 005).
  _Alternativa:_ dejarla `RESERVADA` con el vencimiento en «ahora» (choca con el `CHECK` del fin de mes cuando el rechazo
  es del mes siguiente).
- **T6. Subida en una sola petición binaria con los datos en la cabecera `X-Pago-Datos`** (JSON ASCII de hasta 1 KB,
  validado con zod), con el mismo lector y orden de la foto. _Alternativas:_ dos pasos (datos y luego imagen: un pago sin
  foto o un archivo sin pago entre medio), `multipart/form-data` (descartado en DT-1 de 005) o base64 en el JSON (límite
  de 100 KB del cuerpo y un 33 % más).
- **T7. Comprobante recodificado** como JPEG sin metadatos, con la orientación aplicada. _Alternativa:_ guardar el archivo
  original (con GPS y otros metadatos).
- **T8. 2000 píxeles en el lado mayor** del comprobante guardado, para que se lean los números. _Alternativa:_ los 800 de
  la foto (ilegible en capturas largas).
- **T9. Número de operación: se guardan el escrito y el normalizado,** con un índice único parcial sobre el normalizado y
  el 409 por el nombre del índice. _Alternativa:_ guardar solo el normalizado (se pierde lo que escribió el cliente).
- **T10. El cobro en efectivo decide la vigencia de la reserva con el instante leído después de
  `bloquearClasesParaCupo`** (criterio 18 b). Con el instante del inicio de la petición, un envío que ya contó la reserva
  como vencida y el cobro que la cuenta como vigente dejarían la clase con uno de más. _Alternativa:_ exigir siempre cupo
  libre sin contarse (rechazaría cobros válidos cuando el aforo se bajó con confirmación, DR-5 de 004).
- **T11. Recepción en las rutas públicas:** el middleware de `/api/a` verifica la cookie `aq_sesion` (con
  `SesionAcademiaService`, sin escribir) solo si viene y antes de contar; si es de `ADMIN` o `SECRETARIA` de la academia
  del nombre corto, no cuenta. El envío pasa la sesión al servicio. _Alternativa:_ rutas del panel separadas para
  inscribir (`/api/recepcion/…`), que duplican la cotización, el envío y la foto, y la web pública.
- **T12. Permiso nuevo `AJUSTAR_MONTO_COBRO`** (solo `ADMIN`). _Alternativa:_ usar `CONFIGURAR_PLANES_HORARIOS_AFORO`
  (mezcla configuración con cobro).
- **T13. Número de ticket asignado con la caja bloqueada** (la caja serializa las confirmaciones de una academia), con un
  índice único de respaldo. _Alternativas:_ una secuencia de PostgreSQL (no es por academia) o «fecha de caja y número
  del movimiento» (no es un correlativo).
- **T14. Ticket como JSON y página imprimible de la web,** sin PDF (provisional P4). _Alternativa:_ PDF con `pdfkit`, con
  la cola y los cuidados de la 006b.
- **T15. `HEAD` en `/api/pagos` responde 404** con el mismo middleware de la caja (DT-9 de 006). _Alternativa:_ dejar que
  `HEAD` llame al manejador del `GET` (leería el archivo del almacén para no enviarlo).
- **T16. La confirmación toma el bloqueo consultivo del DNI** (el mismo del envío de la 005) después del actor, y la
  creación de personal también (P1), para que las dos se ordenen. _Alternativa:_ confiar solo en el índice único de
  `usuarios` (el 409 llegaría después de registrar el ingreso en la caja, con la transacción ya larga).
