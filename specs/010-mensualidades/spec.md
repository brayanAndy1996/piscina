# 010 · Mensualidades y renovación

- **Historias y requerimientos:** HU-11 (estados al día, por vencer en los últimos días configurables, vencido y
  pendiente de verificación; filtros por estado, plan, nivel, horario y mes), HU-12 (renovar y elegir el horario del mes
  siguiente con el mismo flujo de pago; prioridad para conservar el horario), HU-03 y RN-08 (el horario no cambia hasta
  fin de mes; solo la secretaria o el administrador lo cambian, con motivo en auditoría y respetando el aforo), RN-11
  (aforo), RN-14 y RN-15 (asistencia con la mensualidad del día), RN-22 (auditoría del cambio de horario y de la
  verificación), RN-23 (las clases no usadas se pierden al cerrar el mes), RN-25 y HU-34 (cobro proporcional), RN-27
  (solo mensualidad), RN-28 (Yape en verificación reserva el cupo), secciones 4.5 (proceso de renovación) y 8.8 (estados
  de la persona y de la matrícula), 2.1 («Registrar inscripción y cobro» y «Modificar el horario de un alumno a mitad de
  mes»: administrador y secretaria). D-03 (orden del cobro), D-04 (Yape a la caja al verificar), D-06 (prioridad al
  renovar), D-14 (el panel del alumno es de solo lectura), D-16 y D-11 (la asistencia, sin cambios), D-23, D-29, D-31.
  De las specs anteriores: DR-3 de 003 (días por vencer y de prioridad, valores aparte), DR-5 de 004 (aforo menor que
  los inscritos), DR-2 y DR-3 de 005 (conteo de clases; N3, que decide esta historia), DR-2, DR-6, DR-7, DR-8 y DR-11
  de 007, DT-12 de 008, DR-3 y DT-14 de 009 (pago en verificación; ocurrencia incluida en la mensualidad).
- **Ruta crítica:** en parte. Aforo y prioridad, cobro y caja, verificación de pagos, aislamiento, permisos, auditoría del
  cambio de horario y la tarea programada del cierre de mes. El listado de estados y las pantallas no son críticos, salvo
  sus permisos y su aislamiento.
- **Estado:** aprobada por Bryan el 26/11/2026; 010a en curso. Bryan aceptó la propuesta de las once preguntas de
  negocio (P1 a P11, que son DR-1 a DR-11 de esta spec, en «Resueltas») y los cambios a pruebas protegidas A1 y A2. El
  orquestador aceptó DT-1 a DT-21 y la partición en 010a, 010b, 010c y 010d el mismo día. La ronda adversarial 1 de la
  010a (26/11/2026) agregó el criterio 44 y ajustó la definición de «Cupo libre» y DT-4 (detalle en `rondas.md`).

## Objetivo

Que la academia sepa en todo momento quién está al día, por vencer, vencido o con un pago por verificar, y que cada
alumno pueda seguir el mes siguiente sin perder su horario: recepción registra la renovación con el pago en efectivo o
con el comprobante de Yape o transferencia, y durante los últimos días del mes el lugar de cada alumno en sus clases
queda apartado para él (D-06). Al terminar el mes, las mensualidades se cierran y las clases no usadas se pierden
(RN-23). Si hace falta, la secretaria o el administrador cambian el horario de un alumno, con motivo y sin pasar del
aforo.

## Clasificación de ruta crítica

Llevan pruebas protegidas y ataque adversarial los criterios marcados _(crítico)_:

- **Cobro, caja y pagos (1, 5 a 8, 12, 14, 15):** el monto sale de D-03 y se redondea una vez; ningún cobro sin caja
  abierta de hoy; un Yape queda en verificación y entra a la caja al aprobarlo; número de operación sin duplicados;
  idempotencia.
- **Aforo y prioridad (3, 9, 10, 13, 35, 36, 39, 44):** nunca más inscritos que el aforo, también con el último cupo
  simultáneo; el lugar de los alumnos vigentes queda apartado durante la ventana (D-06, RN-11).
- **Asistencia (16, 38):** una renovación en verificación no deja marcar; un cambio de horario no descuenta ni registra
  faltas de clases que no eran suyas.
- **Permisos y aislamiento (17, 18, 26, 41):** matriz 2.1, D-14 (el alumno no renueva ni cambia su horario), D-23, D-29.
- **Auditoría (19, 40):** RN-22.
- **Cierre de mes (27 a 29):** tarea programada por academia, sin mezclar academias, en los bordes de America/Lima.
- **Modelo (1, 34):** invariantes en la base, también para el dueño de las tablas.

Llevan _(prueba obligatoria)_, sin ser críticos: 2, 4, 11, 20 a 22, 24, 25, 30 a 32, 37 y 42. Los de documentación
(23, 33, 35, 43) los verifica el revisor.

## División en entregas (D-31)

Tres entregas desde esta carpeta, cada una con sus pruebas protegidas, su ataque (hasta 3 rondas) y su PR. Los
criterios llevan la marca de su entrega. Los commits de pruebas protegidas dicen «Pruebas protegidas (010): 010a, …».

| Entrega | Qué trae | Críticos | Prueba obligatoria | Revisor |
| --- | --- | --- | --- | --- |
| **010a** · renovación con prioridad | oferta, cotización, renovación en efectivo y con comprobante, prioridad, bandeja, aprobación y rechazo | 1, 3, 5 a 10, 12 a 19, 44 | 2, 4, 11, 20, 21, 22 | 23 |
| **010b** · estados y cierre de mes | estado de la mensualidad, listado HU-11, tarea del cierre de mes y estado del alumno | 26 a 29 | 24, 25, 30, 31, 32 | 33 |
| **010c** · cambio de horario | cambio de clases de una matrícula, su efecto en la asistencia y las faltas | 34 a 36, 38 a 41 | 37, 42 | 43 |

Motivo de la división: la renovación (dinero, caja,
prioridad), la tarea del cierre de mes y el cambio de horario (que toca la asistencia de la 009) son tres frentes de
ataque distintos. La inscripción pública al mes siguiente (DR-10) es una cuarta entrega, 010d, después de la 010c;
sus criterios se agregan a esta spec cuando se planifique.

## Definiciones

- **«Ahora» y hoy:** `RELOJ.ahora()` leído **después de tomar los bloqueos** de la transacción (DT-10 de 007, DT-16 de
  009); hoy es `hoyEnLima(ahora)`. Nada depende de la zona del proceso ni de `CURRENT_DATE`.
- **Mes en curso (M) y mes siguiente (M+1):** el mes de Lima de «ahora» y el que le sigue (diciembre → enero del año
  siguiente).
- **Ventana de renovación:** los últimos `diasPrioridadRenovacion` días de M (`leerConfiguracion(tx)`, en la
  transacción de la operación, sin caché): desde las 00:00:00.000 de Lima del día `último − N + 1` hasta las
  23:59:59.999 del último día. Con N = 5: del 26/11 al 30/11; febrero de 2027 con N = 15: del 14/02 al 28/02.
- **Por vencer:** hoy está entre el día `último − diasPorVencer + 1` y el último día de M, ambos incluidos (HU-11:
  «últimos 5 días, configurable»).
- **Mensualidad pagada del mes X:** la matrícula del alumno de X en `VIGENTE` o `FINALIZADA`.
- **Mensualidad en verificación del mes X:** la matrícula del alumno de X en `RESERVADA` con `reserva_vence_en` nula y
  un pago `PENDIENTE_VERIFICACION` (RN-28).
- **Ocupación:** `contarOcupacion` de 005 (una matrícula de X ocupa cupo si está `VIGENTE`, o `RESERVADA` sin vencer),
  contada siempre después de `bloquearClasesParaCupo`.
- **Titular de prioridad en la clase c:** un alumno (no `CLIENTE`) que tiene una matrícula de M `VIGENTE` o en
  verificación que incluye c, y que **no** tiene una matrícula de M+1 que ocupe cupo (DT-3). Una reserva de 24 horas
  sin pago (un cliente de la 005) no da prioridad.
- **Reservas de prioridad de c:** cuántos titulares de prioridad tiene c. Solo cuentan para el mes M+1, y dejan de
  existir solas el día 1, cuando M+1 pasa a ser el mes en curso (D-06: «el día 1 se liberan»). No se guardan.
- **Cupo libre de c para el alumno A en el mes X** (ajustada por la ronda adversarial 1 de la 010a, criterio 44):
  - X = M: `aforo − ocupación(c, M)`;
  - X = M+1 y A es titular en c: `aforo − ocupación(c, M+1)`. Las reservas no le restan: los titulares de c compiten
    solo entre ellos por los lugares que quedan en M+1, y gana el primero que llega;
  - X = M+1 y A no es titular en c: `aforo − ocupación(c, M+1) − reservas(c)`; no puede tomar un lugar apartado.

  En todos los casos no cuenta la matrícula que A está cambiando (010c). A puede tomar c si el cupo libre es 1 o más. Así
  la ocupación de X nunca pasa del aforo (DT-4). Cuando `ocupación(c, M+1) + reservas(c) ≤ aforo` (el caso normal), un
  titular encuentra lugar con cualquiera de las dos fórmulas; cuando hay más titulares que lugares (un no titular tomó
  un lugar libre antes de que alguien recuperara la prioridad, o el aforo bajó, DR-5), entran los primeros titulares
  hasta llenar el aforo y los últimos reciben `SIN_CUPO`. Los `cuposRestantes` de la oferta (criterio 2) son este cupo
  libre, recortado a 0 si es negativo: para un titular, `aforo − ocupación(c, M+1)`.
- **Renovación:** una matrícula sin solicitud (`solicitud_id` nula) de un alumno que no es `CLIENTE`, para M o M+1, con
  su pago de concepto `MENSUALIDAD`. La registra recepción (DR-1).
- **Meses permitidos:** M (renovación tardía de quien no tiene la de M, DR-4) y, si «ahora» está dentro de la ventana,
  M+1 (DR-2). Si el alumno ya tiene una matrícula de ese mes que ocupa cupo, el registro responde
  `MENSUALIDAD_YA_REGISTRADA` (criterio 8).
- **Cotización de la renovación:** con el plan y las clases elegidas, `clasesTotales = min(clasesRestantes(clases,
  desde), clasesPorMes)`, con `desde` igual a las 00:00 de Lima del día 1 de M+1 (DT-6) o a «ahora» para M (la clase de
  hoy cuenta si todavía no empezó, como en la 005). `montoCalculado = montoProporcional(precio, clasesPorMes,
  clasesTotales)`, el total sale de `calcularTotal` (hacia arriba al sol entero, una vez, D-03) y `esProporcional` es
  `clasesRestantes < clasesPorMes`. `fecha_inicio` es el día 1 de M+1, u hoy para M; `fecha_fin`, el último día del mes.

## Criterios de aceptación

### 010a · Renovación con prioridad

1. **[010a] Modelo.** La migración `<marca>_renovaciones` agrega a `matriculas` el `CHECK
   matriculas_renovacion_sin_vencimiento`: si `solicitud_id` es nula, `reserva_vence_en` es nula (una renovación nunca
   tiene una reserva temporal, DT-2). Sin tablas ni privilegios nuevos: la app ya inserta matrículas sin solicitud,
   `matricula_clases` y pagos, y actualiza `alumnos.estado`. Prueba como app y como dueño: una matrícula sin solicitud
   con `reserva_vence_en` responde 23514. _(crítico)_ (RN-28, DT-2)
2. **[010a] Oferta de la renovación.** `GET /api/alumnos/{id}/renovacion?mes=AAAA-MM` (sin `mes`: M+1 si la ventana está
   abierta y está permitido; si no, M) responde `ofertaRenovacionSchema`: el alumno (`id`, `nombres`, `apellidos`,
   `nivel`, `estado`), `mesesPermitidos` (sin los que ya tienen una matrícula que ocupa cupo), el `mes` pedido, la
   `ventana` (`desde` y `hasta`), la mensualidad actual
   (mes, plan y clases de su matrícula de M, o `null`), los planes que puede elegir para ese mes (activos, vigentes en
   la `fecha_inicio` del mes, DT-5, y que aplican a su nivel) y las clases activas de su nivel con `cuposRestantes`
   (el cupo libre para él, definición, nunca negativo) y `conPrioridad` (es titular en ella). Un `mes` que no está en `mesesPermitidos`
   responde la oferta con `planes` y `clases` vacíos. No bloquea, no escribe ni audita. _(prueba obligatoria)_ (HU-12,
   D-06)
3. **[010a] Mes destino y ventana.** El registro responde 409 `MES_NO_PERMITIDO` con `detalles.mesesPermitidos` si el
   `mes` pedido no es uno de los permitidos, evaluado con «ahora» después de los bloqueos. Con `RELOJ` fijo, N = 5 y el
   proceso en `TZ=Asia/Tokyo`: diciembre de 2026 no se permite el 25/11 a las 23:59:59.999 de Lima y sí el 26/11 a las
   00:00:00.000 y el 30/11 a las 23:59:59.999; el 1/12 a las 00:00:00.000 diciembre ya es M (renovación tardía, con su
   monto proporcional) y enero de 2027 no se permite. Con la mensualidad de diciembre ya pagada o en verificación, pedir
   diciembre responde 409 `MENSUALIDAD_YA_REGISTRADA`. Un `PATCH /api/configuracion` de `diasPrioridadRenovacion`
   confirmado vale para la siguiente operación, sin reiniciar. _(crítico)_ (D-06, DR-2, DR-4)
4. **[010a] Plan y clases.** Las mismas reglas del criterio 15 b de 005 (`validarSeleccion`): exactamente
   `vecesPorSemana` clases, una por día, activas, del nivel actual del alumno, en días y franjas del plan; si no, 409
   `SELECCION_NO_VALIDA` con los errores por campo. Un plan inactivo, que no aplica a su nivel o que no está vigente en
   la `fecha_inicio` del mes destino, 409 `PLAN_NO_DISPONIBLE`. El plan puede ser otro que el del mes en curso.
   _(prueba obligatoria)_ (RN-07, HU-12, 4.5)
5. **[010a] Cotización y monto (D-03).** `POST /api/alumnos/{id}/renovacion/cotizacion` con `{ mes, planId, claseIds }`
   responde `{ cotizacion }` (`cotizacionSchema` de 005) con la definición de «Cotización de la renovación». No bloquea,
   no comprueba el cupo y no escribe (DT-21). Ejemplos: plan de S/ 120.00 y 12 clases, lunes, miércoles y viernes, para
   diciembre de 2026 (13 ocurrencias, tope 12): S/ 120, no proporcional; renovación tardía el jueves 26/11/2026 a las
   10:00 con esas clases a las 18:00 (quedan el viernes 27 y el lunes 30): `120 ÷ 12 × 2` = S/ 20; plan de S/ 100 y 12
   clases con 5 restantes: S/ 42. Sin clases restantes en M: 409 `SIN_CLASES_EN_EL_MES`. Todo con `Decimal`. La
   matrícula guarda `precio_plan`, `clases_por_mes_plan`, `clases_totales`, `monto_calculado` y `es_proporcional`, y el
   pago y la caja usan `totalACobrar` de lo guardado (HU-19). _(crítico)_ (RN-25, HU-34, D-03, DR-3)
6. **[010a] Renovación en efectivo.** `POST /api/alumnos/{id}/renovacion/efectivo` con `renovarEnEfectivoSchema`
   (`{ claveIdempotencia, mes, planId, claseIds, montoMostrado }`, estricto) hace, en una transacción: la matrícula
   (`solicitud_id` nula), sus `matricula_clases` y la confirmación con `confirmarPagoEnTransaccion` (concepto
   `MENSUALIDAD`, método `EFECTIVO`): el ingreso en la caja abierta de hoy, el ticket, la matrícula `VIGENTE` y la
   auditoría `PAGO_REGISTRADO`. No crea cuenta ni cambia el QR. Si la matrícula es de M y el alumno está
   `ALUMNO_VENCIDO`, pasa a `ALUMNO_ACTIVO` en la misma transacción (8.8). Responde 201 con
   `respuestaRenovacionSchema`. Si `montoMostrado` no es el total, 409 `MONTO_CAMBIO` con `detalles.total`. Sin caja
   abierta, 409 `SIN_CAJA_ABIERTA`; con la caja abierta de otro día, 409 `CAJA_DE_OTRO_DIA`; en los dos casos no queda
   nada escrito. _(crítico)_ (HU-07, HU-12, RN-17, D-03)
7. **[010a] Renovación con Yape o transferencia.** `PUT /api/alumnos/{id}/renovacion/comprobante`, con la imagen como
   cuerpo binario (`image/jpeg` o `image/png`) y los datos en la cabecera `X-Renovacion-Datos` (JSON ASCII de hasta 2048
   bytes que cumple `datosRenovacionComprobanteSchema`, estricto: `{ claveIdempotencia, mes, planId, claseIds, metodo:
   'YAPE' | 'TRANSFERENCIA', numeroOperacion, monto, fechaOperacion }`). Crea, en una transacción, la matrícula
   `RESERVADA` sin vencimiento, sus clases y el pago `PENDIENTE_VERIFICACION` con `registrado_por` el actor, el número
   escrito y el normalizado, la fecha y la clave del comprobante. No toca la caja (D-04) ni el estado del alumno.
   Responde 201 con `respuestaRenovacionSchema` (`estado: 'EN_VERIFICACION'`). Reglas de la 007b: el orden de las
   comprobaciones antes de leer el cuerpo como el criterio 24 de 008 (sesión, academia, clave pendiente y permiso
   responden 401 o 403 sin leer el cuerpo; después el tipo, 400 `IMAGEN_NO_VALIDA`, y el tamaño, 413
   `CARGA_EXCESIVA`); la cabecera que falta, repetida, de más de 2048 bytes, con bytes fuera de ASCII o que no cumple el
   esquema, 400 `SOLICITUD_INVALIDA`; la imagen, como el criterio 40 de 007 (firma, `sharp`, lados y megapíxeles; 400
   `IMAGEN_NO_VALIDA`), recodificada como JPEG de hasta 2000 píxeles sin metadatos y guardada antes de la transacción con
   la clave `academias/{academiaId}/pagos/{pagoId}/comprobante-{uuid}.jpg`; si la transacción rechaza, se borra el
   archivo; si la confirmación es incierta, se relee `comprobante_clave` con `FOR SHARE` y espera máxima de 5 s antes de
   borrar nada (criterio 61 de 005). `monto` distinto del total: 409 `MONTO_DISTINTO` con `detalles.total`. Número de
   operación de un pago abierto de la academia con el mismo método (normalizado, DR-9 de 007): 409
   `NUMERO_OPERACION_YA_USADO`, también entre una renovación y una solicitud. `fechaOperacion` futura o anterior al
   primer día de la ventana (para M+1) o al día 1 de M (para M): 409 `FECHA_OPERACION_NO_VALIDA` (DR-1). Esta ruta no
   cuenta en `LIMITES_PUBLICOS`. _(crítico)_ (HU-08, HU-12, RN-04, RN-28, D-04)
8. **[010a] Orden de los errores del registro.** En las dos rutas, la primera que falla decide: 401 `NO_AUTENTICADO`
   (actor) → 404 `NO_ENCONTRADO` (id que no es UUID, inexistente, de otra academia o de un `CLIENTE`) → clave
   (criterio 12) → 409 `ALUMNO_INACTIVO` (DT-19) → `MES_NO_PERMITIDO` → `MENSUALIDAD_YA_REGISTRADA` (ya hay una
   matrícula del mes destino que ocupa cupo) → `PLAN_NO_DISPONIBLE` → `SELECCION_NO_VALIDA` → `SIN_CLASES_EN_EL_MES` →
   `SIN_CUPO` (con `detalles.claseIds` de las clases sin lugar) → `MONTO_CAMBIO` o `MONTO_DISTINTO` →
   `FECHA_OPERACION_NO_VALIDA` y `NUMERO_OPERACION_YA_USADO` (solo el comprobante) → la caja (solo el efectivo). En el
   comprobante, los 400 y el 413 del criterio 7 van antes del actor, y la imagen (400 `IMAGEN_NO_VALIDA`) se decide
   después de una lectura corta (actor, alumno y clave) y antes de la transacción de escritura, como en la 008b. Ningún
   rechazo escribe, audita ni deja archivo. _(crítico)_ (HU-12)
9. **[010a] Prioridad (D-06).** Con `RELOJ` fijo en la ventana y una clase c de aforo 20 con 20 matrículas de noviembre
   `VIGENTE`: un alumno que no es titular en c recibe `SIN_CUPO` para c en diciembre; cada titular renueva c con 201,
   también el último; un titular que renueva con otras clases conserva su prioridad solo en las clases que ya tenía y,
   al renovar, deja libre su lugar en las que no eligió. Un titular con la matrícula de noviembre en verificación también
   tiene prioridad; un cliente con una reserva de 24 horas, no. El 1/12 a las 00:00:00.000 de Lima ya no hay reservas:
   con 15 renovados, una renovación tardía de otro alumno toma c. Si el administrador bajó el aforo de c por debajo de
   los inscritos (DR-5 de 004), un titular recibe `SIN_CUPO` cuando diciembre ya está en el nuevo aforo (DR-5). La
   ocupación de cada mes nunca pasa del aforo. _(crítico)_ (D-06, RN-11, HU-12)
10. **[010a] Último cupo simultáneo.** Pruebas deterministas (espera comprobada en `pg_locks`): dos renovaciones de
    alumnos sin prioridad por el último cupo libre de c en diciembre: una 201 y otra 409 `SIN_CUPO`; un titular y un
    alumno sin prioridad con un solo cupo libre más la reserva del titular: los dos 201; una renovación tardía de M y un
    envío de la inscripción pública (005) por el último cupo de c en M: uno solo ocupa; una renovación de `[c1, c2]` y
    otra de `[c2, c1]` a la vez terminan sin `40P01`. Después de cada prueba, la ocupación de cada mes es como mucho el
    aforo. _(crítico)_ (RN-11, D-06)
11. **[010a] Lo que lleva la respuesta.** `respuestaRenovacionSchema` (estricto): `renovacion` (`matriculaId`, `mes`,
    `estado`: `VIGENTE` o `EN_VERIFICACION`, `plan` con `id` y `nombre`, `clases` con `id`, `diaSemana`, `horaInicio` y
    `horaFin`, `fechaInicio`, `fechaFin`, `clasesTotales`, `total` y `conPrioridad`, los ids de las clases en las que
    usó su prioridad), `pago` (`pagoSchema` de 007) y `repetida`. Sin DNI, token, datos médicos, apoderado ni clave del
    archivo. Prueba: las claves exactas del JSON del 201 y del 200 repetido. _(prueba obligatoria)_ (Ley 29733)
12. **[010a] Idempotencia.** La `claveIdempotencia` es la del pago (`pagos_academia_id_clave_idempotencia_key`). Si ya
    creó el pago de una renovación de ese mismo alumno, con la misma ruta y los mismos datos, responde 200 con el mismo
    cuerpo y `repetida: true`, sin otra matrícula, pago, movimiento, ticket, auditoría ni archivo (el nuevo se borra),
    aunque la caja ya esté cerrada. Con otro alumno, otra ruta, otros datos o la clave de un pago de una solicitud: 409
    `CLAVE_YA_USADA`. Dos peticiones a la vez con la misma clave dejan una renovación (una 201 y una 200). Dos
    renovaciones del mismo alumno y mes con claves distintas a la vez: una 201 y otra 409 `MENSUALIDAD_YA_REGISTRADA`
    (por el nombre del índice `matriculas_alumno_mes_ocupa_cupo_key`, después del `ROLLBACK`). _(crítico)_ (`CLAUDE.md`,
    escrituras idempotentes)
13. **[010a] Orden de bloqueos.** En una transacción: `bloquearActorVigente` → el bloqueo consultivo
    `inscripcion-dni:` del alumno → el alumno con `FOR UPDATE` → sus matrículas de M y M+1 con `FOR UPDATE` (ordenadas
    por id) → `bloquearClasesParaCupo` con las clases elegidas, en una sola llamada → «ahora», la configuración, la
    ocupación y las reservas → las escrituras → la caja, al final (solo el efectivo, dentro de
    `confirmarPagoEnTransaccion`). Pruebas deterministas sin `40P01`, a la vez que: el marcado de asistencia del mismo
    alumno (009), la regeneración de su QR y la foto del panel (008), el cobro de una solicitud con la misma clase (007a)
    y la aprobación de otro pago. _(crítico)_ («Orden de bloqueos» de 005a, 006a y 007a)
14. **[010a] Bandeja con renovaciones.** `GET /api/pagos/pendientes` lista también los pagos de renovación, con
    `solicitud: null` y las mismas claves de siempre (DT-10); el orden, el tope de 200 y `mesTerminado` no cambian. La web
    de `/panel/pagos` muestra «Renovación» y el mes en lugar del código de la solicitud. `GET /api/pagos/{id}/comprobante`
    devuelve el de una renovación. _(crítico)_ (HU-09)
15. **[010a] Aprobar y rechazar una renovación.** Con las rutas de la 007b: aprobar exige la caja abierta de hoy, el
    ingreso entra con su método (`YAPE` o `TRANSFERENCIA`, no suma al efectivo, D-04), la matrícula pasa a `VIGENTE`,
    recibe ticket y no se crea cuenta ni cambia el QR; si la matrícula es de M y el alumno está `ALUMNO_VENCIDO`, pasa a
    `ALUMNO_ACTIVO`. Rechazar exige motivo, deja la matrícula `CANCELADA` y libera el cupo; el alumno puede registrar otra
    renovación del mismo mes. Aprobar dos veces responde 200 sin otro movimiento; aprobar un rechazado, 409
    `PAGO_YA_RECHAZADO`. Después de confirmar, se envían las plantillas `RENOVACION_CONFIRMADA` y
    `RENOVACION_RECHAZADA` (con el motivo) al correo del alumno y, si es menor, al de su apoderado, una vez por dirección,
    con la academia, el mes y el plan, sin DNI, token ni credenciales (DR-7); un reintento no envía nada. _(crítico)_
    (HU-09, D-04, RN-28)
16. **[010a] Asistencia con una renovación en verificación.** Un alumno sin matrícula de M y con su renovación de M en
    verificación recibe 409 `PAGO_EN_VERIFICACION` (roja) al marcar (criterio 7 f de 009, DR-3 de 009); al aprobarla,
    marca y descuenta de esa matrícula. Un alumno que renovó diciembre por Yape el 28/11 sin verificar recibe lo mismo el
    1/12. Una renovación de diciembre no deja marcar en noviembre, y sus clases de diciembre no cuentan en noviembre.
    _(crítico)_ (RN-15, DR-3 de 009)
17. **[010a] Permisos.** Las rutas de la renovación son de `REGISTRAR_INSCRIPCION_Y_COBRO` (`ADMIN` y `SECRETARIA`,
    sección 2.1). `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO` (el alumno no renueva desde su cuenta: D-14 y DR-1); sin
    sesión o con solo la del Superadmin, 401; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`;
    con la academia suspendida, 403 `ACADEMIA_SUSPENDIDA`. Un cuerpo con campos de más (como `academiaId`,
    `montoAjustado` o `alumnoId`) responde 400 `SOLICITUD_INVALIDA`. `HEAD` sobre las rutas nuevas responde 404.
    _(crítico)_ (sección 2.1, D-14, D-29)
18. **[010a] Aislamiento entre academias.** Con A y B con el mismo DNI y clases a la misma hora: el alumno de B con la
    sesión de A responde 404; una clase o un plan de B en la petición responden como inexistentes
    (`SELECCION_NO_VALIDA`, `PLAN_NO_DISPONIBLE`); la ocupación y las reservas de prioridad solo cuentan matrículas de
    la academia de la sesión; la bandeja de A no muestra renovaciones de B; un número de operación de B no choca en A;
    `?academiaId=` no cambia nada. _(crítico)_ (D-23)
19. **[010a] Auditoría de la renovación.** Cada renovación escribe una sola entrada `RENOVACION_REGISTRADA` (entidad
    `matricula`, `entidadId` la matrícula, actor `USUARIO`, IP, `datosDespues: { mes, planId, claseIds, clasesTotales,
    total, metodo, conPrioridad }`), además de `PAGO_REGISTRADO` en el efectivo (007a) y `PAGO_APROBADO` o
    `PAGO_RECHAZADO` al verificar (007b). Sin DNI, nombres ni datos médicos. Un 200 repetido o un rechazo no audita.
    _(crítico)_ (RN-22, DT-18)
20. **[010a] Web de la renovación.** En `/panel/alumnos/{id}`, para `REGISTRAR_INSCRIPCION_Y_COBRO`, la sección
    «Mensualidad» (mes en curso y siguiente) y «Renovar»: elige el mes, el plan y las clases (con los cupos, la marca
    «Su horario» en las de prioridad y el aviso de la ventana), muestra la cotización, y cobra en efectivo (con el enlace
    al ticket) o adjunta el comprobante con número, fecha y monto. Una `claveIdempotencia` nueva por diálogo abierto. Las
    claves de las consultas llevan la identidad de la sesión. _(prueba obligatoria, componentes)_ (HU-12)
21. **[010a] Funciones puras.** `ventanaDeRenovacion(ahora, dias)`, `estaPorVencer(hoy, dias)`,
    `mesesPermitidos(...)` y `cotizarRenovacion(plan, clases, mes, ahora)` (en `backend/src/modulos/mensualidades/
    dominio/`) con pruebas unitarias de los bordes de los criterios 3 y 5, también con `TZ=Asia/Tokyo`, febrero de 28 y 29
    días y el cambio de año. _(prueba obligatoria)_
22. **[010a] Textos de la bandeja.** Los diálogos de aprobar y rechazar dicen «renovación» cuando
    `solicitud` es `null` (deuda de la revisión de la 007b: «el texto del diálogo de aprobar asume siempre un alumno
    nuevo»). _(prueba obligatoria, componentes)_
23. **[010a] Documentación.** `docs/arquitectura.md` («Lo que construye la historia 010a»: renovación, prioridad, orden
    de bloqueos y bandeja), la guía de Windows (cómo probar la ventana con la configuración) y la nota de la 010 en
    `specs/backlog.md`. _(revisor)_

#### Ronda adversarial 1 de la 010a

44. **[010a] Más titulares que lugares en el mes siguiente (ataque ronda 1, R1-1).** Con la definición de «Cupo libre»:
    en M+1, un titular de c toma c si `aforo − ocupación(c, M+1) ≥ 1`, sin restarle las reservas; entre titulares gana
    el primero que llega; quien no es titular sigue necesitando `aforo − ocupación(c, M+1) − reservas(c) ≥ 1`. Pruebas
    deterministas con `RELOJ` fijo en la ventana (27/11/2026, N = 5) y una clase c de los sábados:
    - **a) Renovación tardía.** c de aforo 20 con 19 titulares en noviembre. X, vencido y sin prioridad, renueva
      diciembre en c (201; queda 1 de 20). Y, sin matrícula de noviembre, hace la renovación tardía de noviembre en c
      (201) y pasa a ser titular: hay 20 titulares para 19 lugares. Un alumno sin prioridad recibe `SIN_CUPO` para c en
      diciembre, y en la oferta de diciembre c muestra `cuposRestantes` 19 a un titular y 0 a ese alumno. Los 19
      titulares de antes renuevan c, cada uno con 201; después Y recibe `SIN_CUPO`. Con Y primero, Y entra (201) y el
      último de los otros recibe `SIN_CUPO`.
    - **b) Yape rechazado.** c de aforo 20 con 20 titulares. T0 renueva diciembre por Yape en otras clases, sin c; X,
      sin prioridad, toma c en diciembre (201); se rechaza el Yape de T0 y T0 vuelve a ser titular en c. Un alumno sin
      prioridad recibe `SIN_CUPO`. Los otros 19 titulares renuevan c, cada uno con 201; después T0 recibe `SIN_CUPO`.
    - **c) Aforo bajado (DR-5).** c de aforo 30 con 30 titulares, que el administrador baja a 20 antes de que nadie
      renueve. Un alumno sin prioridad recibe `SIN_CUPO`. Los titulares renuevan c uno tras otro: los primeros 20, con
      201; del 21 al 30, `SIN_CUPO`.
    - **d) Dos titulares a la vez por el último lugar.** Como en c, con 19 titulares ya renovados (diciembre en 19 de
      20): dos de los titulares que faltan renuevan c a la vez (espera comprobada en `pg_locks`); uno 201 y el otro
      `SIN_CUPO`, sin `40P01`.

    En cada caso, diciembre termina con la ocupación de c igual al aforo (20 de 20) y ninguna renovación deja la
    ocupación de un mes por encima del aforo vigente (en el caso c, noviembre conserva sus 30 de antes, DR-5 de 004).
    _(crítico)_ (D-06, RN-11, HU-12, DR-5, DT-4)

### 010b · Estados de la mensualidad y cierre de mes

24. **[010b] Estado de la mensualidad.** `estadoDeMensualidad` (pura) decide, para un alumno y un mes X no posterior a
    M, con hoy y `diasPorVencer`:
    - con mensualidad pagada de X: si X es M y hoy está por vencer, `AL_DIA` si tiene pagada la de M+1,
      `PENDIENTE_VERIFICACION` si la de M+1 está en verificación y `POR_VENCER` si no; en otro caso, `AL_DIA`;
    - sin pagada pero en verificación la de X: `PENDIENTE_VERIFICACION`;
    - sin ninguna de las dos y con la de X−1 pagada: `VENCIDO`.

    Ejemplos con N = 5 en noviembre de 2026: el 25/11 `AL_DIA`; el 26/11 `POR_VENCER`; con diciembre pagado, `AL_DIA`;
    con diciembre en verificación, `PENDIENTE_VERIFICACION`; el 1/12 sin diciembre, `VENCIDO`; el 1/12 con diciembre en
    verificación, `PENDIENTE_VERIFICACION`. Pruebas unitarias, también con `TZ=Asia/Tokyo`. _(prueba obligatoria)_
    (HU-11, 4.5)
25. **[010b] Listado (HU-11).** `GET /api/mensualidades?mes=&estado=&planId=&nivel=&claseId=` (`mes` por defecto M; no
    puede ser posterior a M ni anterior a 2000-01) responde `listadoMensualidadesSchema`: `mes`, `hoy`, `totales` (por
    estado, con los demás filtros aplicados), `alumnos` y `hayMas`. Aparecen los alumnos (no `CLIENTE` ni `INACTIVO`) con
    mensualidad pagada o en verificación en X, o pagada en X−1 (DR-8). Cada fila: `alumnoId`, `nombres`, `apellidos`,
    `nivel`, `estado`, `mensualidad` (la de X o, si está `VENCIDO`, la de X−1: `mes`, `plan` con `id` y `nombre`,
    `clases` con día y horas, `clasesUsadas` y `clasesTotales`) y `siguiente` (solo si X es M: `{ mes, estado: 'PAGADA' |
    'EN_VERIFICACION' }` o `null`). `planId` y `claseId` filtran por la mensualidad de la fila; `nivel`, por el del
    alumno. Orden por apellidos, nombres e id; como mucho 500 filas (DT-14). Sin DNI, datos médicos ni apoderado. Un
    parámetro con otra forma, repetido o fuera de rango: 400 `SOLICITUD_INVALIDA` con el campo. No escribe, no bloquea y
    no audita. _(prueba obligatoria)_ (HU-11)
26. **[010b] Permisos y aislamiento del listado.** `REGISTRAR_INSCRIPCION_Y_COBRO` (DT-9): `ENTRENADOR` y `ALUMNO`, 403;
    sin sesión, 401; las demás respuestas de acceso del criterio 17. Con A y B, el listado de A no trae alumnos,
    matrículas, planes ni clases de B, y un `planId` o `claseId` de B no devuelve nada. `HEAD` responde 404.
    _(crítico)_ (sección 2.1, D-23, Ley 29733)
27. **[010b] Cierre de mes (RN-23).** `CierreDeMesService.cerrar(ahora)` se puede llamar directamente; un `@Cron` de nombre
    `cierre-de-mes` la llama cada 15 minutos y al arrancar, solo con `TAREAS_PROGRAMADAS=activas` (DT-12). Lee las
    academias `ACTIVA` con `comoPlataforma`, cierra esa transacción y procesa cada academia en su propio `conAcademia`,
    una tras otra; la primera sentencia es `pg_try_advisory_xact_lock(hashtextextended('cierre-de-mes:' || academia,
    0))`, y si otra instancia la tiene, se salta esa academia en esta vuelta. En cada academia: toda matrícula `VIGENTE`
    de un mes anterior a M pasa a `FINALIZADA` (sus clases no usadas se pierden: `clases_totales − clases_usadas` queda
    como registro y ya no sirven para marcar); todo alumno `ALUMNO_ACTIVO` sin matrícula `VIGENTE` de M pasa a
    `ALUMNO_VENCIDO`, y todo `ALUMNO_VENCIDO` con matrícula `VIGENTE` de M pasa a `ALUMNO_ACTIVO` (8.8, 4.5). `CLIENTE` e
    `INACTIVO` no cambian. Toma los alumnos afectados con `FOR UPDATE` (ordenados por id), después sus matrículas con
    `FOR UPDATE` (ordenadas por id), vuelve a evaluar y escribe con sentencias de muchas filas, sin bucles de escrituras.
    Un error en una academia se registra con `errorParaRegistro` y sigue con las demás. Cada academia deja un `info`
    `'Cierre de mes'` con la academia y las cantidades, sin alumnos ni DNI. No audita (DT-12). Volver a correrla no
    cambia nada. Una academia suspendida no se procesa. _(crítico)_ (RN-23, 8.8, D-23, D-10)
28. **[010b] Bordes del cierre en Lima.** Con `RELOJ` fijo y `TZ=Asia/Tokyo`: el 30/11/2026 a las 23:59:59.999 de Lima no
    cierra noviembre; el 1/12 a las 00:00:00.000 sí. Un Yape de noviembre aprobado el 3/12 (DR-2 de 007) deja la
    matrícula `VIGENTE` de noviembre, que la vuelta siguiente cierra, y el alumno queda `ALUMNO_VENCIDO` si no tiene
    diciembre. Un alumno que renovó diciembre en la ventana sigue `ALUMNO_ACTIVO`; uno `ALUMNO_VENCIDO` que pagó
    diciembre pasa a `ALUMNO_ACTIVO`. La tarea de faltas (009b) sigue registrando la falta del 30/11 con la matrícula ya
    `FINALIZADA`. _(crítico)_ (RNF-12, RN-23)
29. **[010b] El cierre no mezcla academias y no se interbloquea.** Con A y B: el cierre de A solo escribe filas de A con
    el contexto de A; con B suspendida, solo A; un error forzado en A no impide B; dos llamadas a la vez (dos instancias)
    dejan el mismo resultado sin error. Pruebas deterministas sin `40P01`, sobre el mismo alumno, con: el marcado de
    asistencia, la tarea de faltas, la aprobación de su renovación y el registro de una renovación. Si la aprobación de
    la renovación de M confirma antes, el cierre lo deja `ALUMNO_ACTIVO`; si confirma después, la aprobación lo deja
    `ALUMNO_ACTIVO`. _(crítico)_ (D-23, nota O1 de 001)
30. **[010b] Las dos tareas.** Con `TAREAS_PROGRAMADAS=inactivas` no se programa ninguna; con `activas` hay exactamente
    dos, `cierre-de-mes` y `faltas`, y las dos corren una vez al arrancar (ajusta el criterio 33 de 009, A1, aprobada por Bryan el 26/11/2026).
    _(prueba obligatoria)_
31. **[010b] Estado en el alumno.** En `/panel/alumnos/{id}`, la sección «Mensualidad» muestra el estado de la
    mensualidad (con `estadoDeMensualidad`) y, de la última mensualidad cerrada, «No usó N clases» cuando hay clases
    perdidas (RN-23). _(prueba obligatoria, componentes)_
32. **[010b] Web del listado.** `/panel/mensualidades` (para `REGISTRAR_INSCRIPCION_Y_COBRO`; el inicio del panel suma
    «Mensualidades») con los filtros de HU-11, los totales por estado, el estado con su color y, en cada fila, el enlace
    al alumno para renovar. Las claves de las consultas llevan la identidad de la sesión. _(prueba obligatoria,
    componentes)_ (HU-11)
33. **[010b] Documentación.** `docs/arquitectura.md` («Lo que construye la historia 010b»: estados, listado, tarea del
    cierre y su orden de bloqueos; la línea de tareas programadas de la vista general), `.env.example` y la nota de la
    010 en `specs/backlog.md`. _(revisor)_

### 010c · Cambio de horario

34. **[010c] Modelo.** La migración `<marca>_cambio_horario` agrega `matricula_clases.agregada_en` (`timestamptz(3)`,
    nula: las filas de la inscripción y de la renovación la dejan nula) y la política `matricula_clases_borrar`
    (`DELETE`, de la forma de 001) con el privilegio `DELETE` para `aquagestion_app` (`PRIVILEGIOS_APP` y
    `scripts/lib/rol-app.mjs`). El trigger `matricula_clases_solo_matricula_abierta` (`BEFORE INSERT OR DELETE`, por
    fila, `SECURITY INVOKER`, con `search_path` fijo y `REVOKE ALL … FROM PUBLIC`) rechaza con 23514 una fila cuya
    matrícula no está `RESERVADA` ni `VIGENTE`, y cierra por defecto si no la ve. Prueba como app y como dueño: borrar o
    agregar una clase de una matrícula `FINALIZADA` o `CANCELADA` (23514); como app, borrar una fila de otra academia no
    borra nada (RLS). Ajusta los criterios 1 y 2 de 005 (A2, aprobada por Bryan el 26/11/2026). _(crítico)_ (RN-08, D-23)
35. **[010c] Cambio de horario.** `POST /api/matriculas/{id}/horario` con `cambiarHorarioSchema` (`{ claseIds, motivo }`,
    estricto; motivo de 3 a 200 caracteres visibles), con `@Permiso('MODIFICAR_HORARIO_ALUMNO')`, cambia las clases de
    una matrícula de un alumno (no `CLIENTE`) que es de M o de M+1 y está `VIGENTE` o en verificación; las demás
    (`FINALIZADA`, `CANCELADA`, de otro mes, una reserva de 24 horas) responden 409 `MATRICULA_NO_MODIFICABLE`. Las
    clases nuevas cumplen el criterio 4 con el plan de la matrícula tal como está hoy y el nivel actual del alumno
    (DT-20). Borra las filas de las clases que salen e inserta las que entran con `agregada_en` = «ahora»; las que se
    quedan no cambian. Responde 200 con `{ matricula }` (`id`, `mes`, `clases`, `clasesTotales`, `clasesUsadas` y
    `ocurrenciasRestantes`: las clases del nuevo horario que quedan en el mes desde «ahora»). _(crítico)_ (HU-03, RN-08)
36. **[010c] Cupo en la clase destino.** Cada clase que entra necesita cupo libre para el alumno en el mes de la
    matrícula (definición, con las reservas de prioridad si es M+1); si no, 409 `SIN_CUPO` con `detalles.claseIds`. Las
    clases que se quedan no se vuelven a comprobar. Pruebas deterministas: un cambio y una renovación por el último cupo
    de c, uno solo entra; un cambio y un envío de la inscripción pública (005) por el último cupo de M, uno solo entra;
    dos alumnos que intercambian clases llenas reciben los dos `SIN_CUPO`. La ocupación nunca pasa del aforo.
    _(crítico)_ (HU-03, RN-11)
37. **[010c] El cambio no toca el dinero ni las clases del mes.** `clases_totales`, `clases_usadas`, `monto_calculado`,
    los pagos y la caja no cambian (DR-9). Si las clases pedidas son las que ya tiene, responde 200 sin escribir ni
    auditar (un doble clic no duplica nada, DT-16). _(prueba obligatoria)_ (DR-9)
38. **[010c] Asistencia y faltas después del cambio.** Una ocurrencia de una clase agregada está incluida en la
    mensualidad solo si empieza después de `matriculas.creado_en` y de `agregada_en` (amplía DT-14 de 009). Con `RELOJ`
    fijo, un cambio a las 15:00 de un martes a la clase de ese martes a las 10:00: el marcado de ese día responde
    `CLASE_NO_INCLUIDA`, la tarea de faltas no registra falta por ella y el registro posterior de ese día responde
    `CLASE_NO_INCLUIDA`; la del martes siguiente se marca y descuenta. Una clase quitada ya no se marca
    (`FUERA_DE_HORARIO`) ni genera faltas desde el cambio. Si ya marcó hoy en la clase anterior, la nueva de hoy responde
    `ASISTENCIA_YA_REGISTRADA`. _(crítico)_ (RN-14, RN-16, D-16, D-08)
39. **[010c] Orden de bloqueos.** `bloquearActorVigente` → el alumno con `FOR UPDATE` → la matrícula con `FOR UPDATE` →
    `bloquearClasesParaCupo` con las clases que salen y las que entran, en una sola llamada → «ahora» → escrituras y
    auditoría. Pruebas deterministas sin `40P01`, a la vez que: el marcado del mismo alumno, la tarea de faltas, una
    renovación de otro alumno con la misma clase y el cierre de mes. _(crítico)_ («Cupo de una clase» de 004)
40. **[010c] Auditoría (RN-22, HU-03).** Cada cambio escribe una sola entrada `MATRICULA_HORARIO_CAMBIADO` (entidad
    `matricula`, `entidadId`, actor `USUARIO`, `motivo`, IP, `datosAntes: { claseIds }` y `datosDespues: { claseIds }`),
    sin DNI ni nombres. Un rechazo o un cambio sin diferencias no audita. _(crítico)_ (RN-22)
41. **[010c] Permisos y aislamiento.** `MODIFICAR_HORARIO_ALUMNO` (`ADMIN` y `SECRETARIA`); `ENTRENADOR` y `ALUMNO`, 403
    (HU-03: el alumno no cambia su horario; D-14); las demás respuestas de acceso del criterio 17. Un `{id}` que no es
    UUID, inexistente, de otra academia o de un `CLIENTE`: 404 `NO_ENCONTRADO`; una clase de otra academia,
    `SELECCION_NO_VALIDA`. `HEAD` sobre `/api/matriculas` responde 404. _(crítico)_ (sección 2.1, D-23)
42. **[010c] Web.** En `/panel/alumnos/{id}`, «Cambiar horario» en la mensualidad de M y en la de M+1 (para
    `MODIFICAR_HORARIO_ALUMNO`): elige las clases con sus cupos, pide el motivo y avisa cuando las ocurrencias que
    quedan son menos que las clases restantes. _(prueba obligatoria, componentes)_ (HU-03)
43. **[010c] Documentación.** `docs/arquitectura.md` («Lo que construye la historia 010c» y la regla ampliada de
    «ocurrencia incluida»), la guía de Windows y la nota de la 010 en `specs/backlog.md`. _(revisor)_

## Casos límite

- **Renovar el último día a las 23:59 y confirmar a las 00:00 del día 1:** «ahora» se lee después de los bloqueos; el
  mes pedido ya es M y el monto se recalcula: si cambió, `MONTO_CAMBIO` y la web vuelve a cotizar (criterio 3).
- **Clase de 19:00 a 20:00 el último día del mes:** la mensualidad de ese mes sigue vigente hasta las 23:59:59.999 de
  Lima; el cierre no la toca antes (criterio 28).
- **Titular que renueva en otras clases:** deja libre su lugar en las que no eligió; si después le rechazan el Yape,
  vuelve a ser titular en sus clases. Si mientras tanto alguien sin prioridad tomó ese lugar, hay más titulares que
  lugares: los titulares que renuevan primero entran y el último recibe `SIN_CUPO` (DT-4, criterio 44).
- **Cliente que se inscribe y paga durante la ventana:** es titular desde que paga y compite con los demás titulares por
  los lugares que quedan en el mes siguiente; si no alcanzan, el último titular en renovar se queda sin lugar (DT-4,
  criterio 44).
- **Cambio de horario dentro de la ventana:** la prioridad pasa a las clases nuevas, con la misma regla (DT-4).
- **Mes con más ocurrencias que el plan** (13 lunes, miércoles y viernes para 12 clases): tope del plan, precio
  completo. Una renovación desde el día 1 casi nunca es proporcional, porque cada día de la semana aparece al menos 4
  veces (DR-3).
- **Alumno vencido desde hace meses:** puede renovar el mes en curso (proporcional) o, en la ventana, el siguiente; no
  aparece en el listado del mes en curso (DR-8).
- **Renovación en verificación al terminar su mes:** se puede aprobar (DR-2 de 007); el cierre la finaliza en la vuelta
  siguiente.
- **Aforo reducido por debajo de los inscritos:** en el mes siguiente se aplica el aforo nuevo; entran los primeros
  titulares hasta llenarlo (DR-5, criterio 44).
- **Alumno `INACTIVO`:** no renueva (`ALUMNO_INACTIVO`); ninguna historia lo produce todavía.
- **Intercambio de dos alumnos entre dos clases llenas:** ninguno de los dos cambios entra; se hace con un lugar libre
  intermedio (criterio 36).

## Reglas de negocio aplicables

- **D-06:** en los últimos N días del mes, el lugar de cada alumno vigente en su horario queda apartado para el mes
  siguiente; el resto usa solo los cupos libres; el día 1 se libera lo que nadie renovó.
- **HU-12 y 4.5:** la renovación paga el mes siguiente con el mismo flujo de pago y puede elegir de nuevo días y horario.
- **HU-11:** al día, por vencer (últimos `diasPorVencer` días), vencido y pendiente de verificación.
- **RN-23:** al cerrar el mes, las clases no usadas se pierden (las recuperables son de la 018).
- **HU-03 y RN-08:** el horario no cambia a mitad de mes salvo por la secretaria o el administrador, con motivo en
  auditoría y respetando el aforo.
- **D-03, RN-25 y HU-34:** precio con IGV, proporcional sin redondear y redondeo hacia arriba una vez, al final.
- **D-04, RN-04, RN-17 y RN-28:** el efectivo entra a la caja al cobrarlo; el Yape, al verificarlo; sin caja abierta no
  hay cobro ni verificación.
- **8.8:** `ALUMNO_ACTIVO` → `ALUMNO_VENCIDO` → (renueva) → `ALUMNO_ACTIVO`; la matrícula `VIGENTE` → `FINALIZADA`.

## Contrato

**Esquemas compartidos** (`packages/contratos/src/mensualidades.ts`, reexportados en el índice):

- `ofertaRenovacionSchema`, `cotizarRenovacionSchema` (`{ mes, planId, claseIds }`), `renovarEnEfectivoSchema`,
  `datosRenovacionComprobanteSchema` y `CABECERA_DATOS_RENOVACION = 'X-Renovacion-Datos'` (largo máximo 2048),
  `respuestaRenovacionSchema` (criterios 2, 5, 6, 7 y 11). Reutilizan `mesSchema`, `claseIdsSchema`, `montoSchema`,
  `numeroOperacionSchema`, `cotizacionSchema` y `pagoSchema`.
- `ESTADOS_MENSUALIDAD = ['AL_DIA', 'POR_VENCER', 'VENCIDO', 'PENDIENTE_VERIFICACION']`, `listadoMensualidadesSchema`
  (criterio 25).
- `cambiarHorarioSchema` y `respuestaCambioHorarioSchema` (criterio 35).
- `pagoPendienteSchema` (007b): `solicitud` pasa a `{ id, codigo } | null` (sigue obligatoria).

**Endpoints** (academia siempre de la sesión):

| Método y ruta | Permiso | Respuesta | Entrega |
| --- | --- | --- | --- |
| `GET /api/alumnos/{id}/renovacion?mes=` | `REGISTRAR_INSCRIPCION_Y_COBRO` | 200 oferta | 010a |
| `POST /api/alumnos/{id}/renovacion/cotizacion` | `REGISTRAR_INSCRIPCION_Y_COBRO` | 200 `{ cotizacion }` | 010a |
| `POST /api/alumnos/{id}/renovacion/efectivo` | `REGISTRAR_INSCRIPCION_Y_COBRO` | 201 / 200 renovación | 010a |
| `PUT /api/alumnos/{id}/renovacion/comprobante` | `REGISTRAR_INSCRIPCION_Y_COBRO` | 201 / 200 renovación | 010a |
| `GET /api/pagos/pendientes` (cambia) | `VERIFICAR_PAGOS` | 200, también renovaciones | 010a |
| `GET /api/mensualidades?…` | `REGISTRAR_INSCRIPCION_Y_COBRO` | 200 listado | 010b |
| `POST /api/matriculas/{id}/horario` | `MODIFICAR_HORARIO_ALUMNO` | 200 `{ matricula }` | 010c |

Errores nuevos: 409 `MES_NO_PERMITIDO`, `MENSUALIDAD_YA_REGISTRADA`, `FECHA_OPERACION_NO_VALIDA` y
`MATRICULA_NO_MODIFICABLE`. Se reutilizan `ALUMNO_INACTIVO`, `PLAN_NO_DISPONIBLE`, `SELECCION_NO_VALIDA`,
`SIN_CLASES_EN_EL_MES`, `SIN_CUPO`, `MONTO_CAMBIO`, `MONTO_DISTINTO`, `NUMERO_OPERACION_YA_USADO`, `CLAVE_YA_USADA`,
`SIN_CAJA_ABIERTA`, `CAJA_DE_OTRO_DIA`, `IMAGEN_NO_VALIDA`, `CARGA_EXCESIVA` y los de acceso. `PREFIJOS_SIN_HEAD` suma
`/mensualidades` y `/matriculas`.

**Permisos:** sin filas nuevas en la matriz (DT-9).

**Auditoría:** `RENOVACION_REGISTRADA` (010a) y `MATRICULA_HORARIO_CAMBIADO` (010c). El cierre de mes no audita.

**Correos:** `RENOVACION_CONFIRMADA` y `RENOVACION_RECHAZADA` (DR-7), después de confirmar, con `enviarSinEsperar`.

**Tarea programada:** `cierre-de-mes`, cada 15 minutos y al arrancar (010b).

## Cambios al modelo de datos

- **010a:** `CHECK matriculas_renovacion_sin_vencimiento`. Sin tablas ni privilegios nuevos.
- **010b:** sin migración (usa `UPDATE` de `matriculas.estado` y `alumnos.estado`, que ya existen).
- **010c:** `matricula_clases.agregada_en`, política y privilegio de `DELETE` y el trigger
  `matricula_clases_solo_matricula_abierta`.
- Sin migración de datos.

## Fuera de alcance

- **Renovar desde el panel del alumno** (DR-1, D-14). El panel del alumno con su mensualidad, en solo lectura: 011.
- **Inscripción pública al mes siguiente** (N3 de 005): entrega 010d (DR-10), que se especifica después de la 010c.
- **Ajuste del monto y de las clases en la renovación** (DR-6, DR-11); **códigos de descuento**: 015, que los aplicará
  también a la renovación.
- **Clases recuperables al cerrar el mes** (HU-35) y su agenda: 018. **Días de cierre:** 017.
- **Cambiar el plan a mitad de mes**, cancelar una renovación ya pagada y las devoluciones.
- **Reporte R7 exportable:** Fase 3. **Avisos de «por vencer» por correo:** no los pide ningún documento.
- **Marcar a un alumno como `INACTIVO`:** otra historia.

## Impacto en especificaciones anteriores

- **007b:** `pagoPendienteSchema.solicitud` admite `null` y el `JOIN` de `listarPendientes` pasa a `LEFT JOIN`. Las
  pruebas protegidas de la 007b no cambian (las claves y su obligatoriedad son las mismas). `confirmarPagoEnTransaccion`
  suma el paso a `ALUMNO_ACTIVO` de un `ALUMNO_VENCIDO` con la matrícula de M; `avisos.ts` suma las dos plantillas.
- **009b (A1, aprobada por Bryan el 26/11/2026):** la prueba protegida del criterio 33 de 009 espera `['faltas']`; pasa
  a `['cierre-de-mes', 'faltas']`.
- **009 (010c):** la regla de «ocurrencia incluida» (DT-14 de 009) suma `agregada_en` en el marcado, el registro
  posterior y la tarea de faltas. Las pruebas protegidas de la 009 no cambian (las filas existentes la tienen nula).
- **005 (A2, aprobada por Bryan el 26/11/2026):** los criterios 1 y 2 de 005 (`tablas.test.ts` y `privilegios.test.ts`,
  protegidas) fijan las columnas de `matricula_clases` y esperan 42501 al borrar una fila. La 010c suma `agregada_en` y el
  `DELETE`; hay que ajustar esas dos pruebas, con la nota en la cabecera, como hizo la 009 (DT-18 de 007).
- **008:** sin cambios. La matrícula del carnet (DT-12 de 008) ya elige la vigente de hoy o la más reciente, que con
  una renovación puede ser la del mes siguiente.
- **003:** `diasPorVencer` y `diasPrioridadRenovacion` dejan de estar «sin usar» en `docs/arquitectura.md`.
- **Deuda de la 007b:** el criterio 22 resuelve «el texto del diálogo de aprobar asume siempre un alumno nuevo».

## Riesgos aceptados

- **Prioridad que no siempre alcanza (DT-4):** nunca se pasa del aforo; en carreras poco frecuentes (cliente que paga
  durante la ventana, renovación tardía del mes en curso, rechazo de un Yape a otras clases, cambio de horario en la
  ventana, aforo reducido) una clase puede tener más titulares que lugares, y los últimos titulares en renovar no
  encuentran lugar; los primeros, sí (criterio 44). Mitiga: la web muestra los cupos y la secretaria elige otra clase.
- **Recepción ve el comprobante que le muestra el alumno** (DR-1): la identidad del alumno ya es conocida; el pago igual
  pasa por la bandeja (RN-04).
- **El cierre corre cada 15 minutos:** el estado del alumno cambia hasta 15 minutos después de las 00:00; la asistencia y
  el listado deciden con las fechas, no con esa columna.
- **Falta de una clase quitada** cuyo fin ya pasó y que la tarea aún no registró (hasta 5 minutos): no se registra.
  **Registro posterior de días anteriores al cambio en la clase quitada:** ya no se puede (010c).
- **El listado trae como mucho 500 filas:** con los filtros alcanza para una academia; si no, se agrega paginación.

## Decisiones

Técnicas: DT-1 a DT-21, propuestas por el especificador y aceptadas por el orquestador el 26/11/2026 tal como se
propusieron, junto con la partición en 010a, 010b, 010c y 010d. Las decisiones del responsable (DR-1 a DR-11) y las
aprobaciones A1 y A2 están en «Resueltas».

- **DT-1. Tres entregas (010a, 010b, 010c)** y la 010d, aprobada con DR-10, que se especifica después. Descartado: dos entregas (la 010b
  mezclaría la tarea programada con el cupo del cambio de horario) o una sola (pasaría de 800 líneas y de 3 rondas).
- **DT-2. La renovación se registra y se paga en una sola operación,** sin reserva temporal: efectivo confirmado al
  instante o comprobante en verificación. Descartado: dos pasos como la solicitud (reserva de 24 horas y pago), que
  suma un estado, un vencimiento, una cancelación y otro frente de ataque.
- **DT-3. La matrícula en verificación también da prioridad;** la reserva de 24 horas, no. Así la aprobación no cambia
  las reservas y no necesita bloquear clases.
- **DT-4. Prioridad dentro del aforo** (ajustada por la ronda adversarial 1 de la 010a, R1-1, criterio 44). A quien no
  es titular, el cupo libre del mes siguiente le resta las reservas; al titular, no: compite solo con la ocupación del
  mes siguiente y, entre titulares, gana el primero que llega. Nunca admite a nadie por encima del aforo. Descartado:
  admitir siempre al titular (podría pasar del aforo); fijar los titulares al empezar la ventana (más datos y reglas
  para casos raros); restar las reservas también al titular y sumarle su propio lugar (la fórmula original), que con más
  titulares que lugares deja sin lugar a todos los titulares y no solo a los últimos (R1-1).
- **DT-5. La vigencia del plan se mira en la `fecha_inicio` del mes destino** (un plan de verano de enero se puede
  elegir en la ventana de diciembre). Descartado: hoy (lo impediría).
- **DT-6. El mes siguiente se cotiza con `clasesRestantes` desde las 00:00 del día 1,** la misma función de la 005.
- **DT-7. El registro bloquea solo las clases elegidas.** Contar las reservas de otras clases no hace falta: una cuenta
  vieja solo puede sobrar, nunca faltar, para el aforo.
- **DT-8. Comprobante de recepción con `X-Renovacion-Datos` de hasta 2048 bytes** (lleva el mes, el plan y las clases),
  con la imagen, la recodificación y el almacén de la 007b. Sin límite por conexión: la ruta exige sesión.
- **DT-9. Permisos existentes:** `REGISTRAR_INSCRIPCION_Y_COBRO` para la renovación y el listado («Registrar
  inscripción y cobro»), `MODIFICAR_HORARIO_ALUMNO` para el cambio. Descartado: un permiso nuevo para el listado.
- **DT-10. La bandeja marca la renovación con `solicitud: null`,** sin clave nueva, para no cambiar las pruebas
  protegidas de la 007b.
- **DT-11. El `CHECK` de la renovación sin vencimiento** respalda DT-2 en la base.
- **DT-12. Cierre de mes como tarea cada 15 minutos y al arrancar,** idempotente, con bloqueo consultivo por academia y
  sin auditoría (no hay actor; queda el registro técnico). Descartado: calcular `FINALIZADA` al leer (el carnet muestra
  `alumnos.estado`, que necesita escribirse).
- **DT-13. `alumnos.estado` se mantiene** con el cierre y con la confirmación de una mensualidad de M. La asistencia y
  el listado siguen decidiendo con las matrículas.
- **DT-14. El listado no lleva DNI** (minimización, Ley 29733; el buscador de la 008 lo tiene) y trae como mucho 500
  filas ordenadas por apellidos.
- **DT-15. El cambio de horario borra e inserta filas de `matricula_clases`** y guarda `agregada_en` en las nuevas.
  Descartado: un historial con `quitada_en`, que cambiaría todas las consultas de la 005 a la 009 que leen esa tabla.
- **DT-16. El cambio de horario es idempotente por su contenido** (las mismas clases: 200 sin escribir), sin clave.
- **DT-17. El trigger de `matricula_clases`** impide tocar las clases de una matrícula cerrada aunque la API fallara.
- **DT-18. La renovación audita `RENOVACION_REGISTRADA`** además de la auditoría del pago: deja quién eligió el mes, el
  plan, las clases y la prioridad.
- **DT-19. Un alumno `INACTIVO` no renueva** (409 `ALUMNO_INACTIVO`, el mismo código de la 009).
- **DT-20. El cambio de horario valida con el plan tal como está hoy** y con el nivel actual del alumno.
- **DT-21. La cotización no comprueba el cupo;** lo decide el registro, con las clases bloqueadas (como la 005).

## Preguntas abiertas

Ninguna. Las once preguntas de negocio (P1 a P11) quedaron resueltas: ver «Resueltas».

## Resueltas

Decisiones del responsable. Bryan aprobó la propuesta de cada pregunta el 26/11/2026.

- **DR-1 (pregunta P1). Quién registra la renovación y cómo se paga con Yape.** HU-12 dice «como alumno», pero D-14
  deja el panel del alumno en solo lectura, la matriz 2.1 no le da «Registrar inscripción y cobro» y DR-7 de 007 dejó el
  Yape fuera de recepción porque el cliente tenía su enlace; el alumno no tiene enlace. **Decidido (la propuesta):** la
  registra recepción (secretaria o administrador); con Yape o transferencia, el alumno muestra o envía su comprobante y
  recepción sube la foto con el número, la fecha y el monto; el pago queda en la bandeja hasta aprobarlo (RN-04). La
  fecha de la operación no puede ser futura ni anterior al inicio de la ventana (o al día 1, si renueva el mes en curso).
  Alternativas descartadas: (b) el alumno renueva desde su cuenta (excepción a D-14); (c) un enlace de pago por correo,
  como D-05 (otra entrada pública). _(010a; criterios 6, 7 y 17.)_
- **DR-2 (pregunta P2). Desde cuándo se renueva el mes siguiente.** **Decidido (la propuesta):** solo durante la ventana
  (los últimos `diasPrioridadRenovacion` días, 5 por defecto), que es cuando D-06 aparta los lugares. Alternativa
  descartada: todo el mes, con los lugares apartados todo el mes. _(010a; criterio 3.)_
- **DR-3 (pregunta P3). Cuánto paga la renovación del mes siguiente.** **Decidido (la propuesta):** la misma regla de la
  inscripción (DR-2 de 005): las clases del mes desde el día 1, con el tope del plan; casi siempre es el precio completo,
  salvo un plan con más clases que 4 por día elegido. Alternativa descartada: siempre el precio completo. _(010a;
  criterio 5.)_
- **DR-4 (pregunta P4). Un alumno vencido vuelve a mitad de mes.** **Decidido (la propuesta):** renueva el mes en curso
  pagando la parte proporcional desde ese momento (RN-25), sin prioridad. Alternativa descartada: solo desde el día 1 del
  mes siguiente. _(010a; criterios 3 y 5.)_
- **DR-5 (pregunta P5). Aforo reducido por debajo de los inscritos (DR-5 de 004).** **Decidido (la propuesta):** en el
  mes siguiente vale el aforo nuevo; los últimos titulares en renovar pueden quedarse sin lugar en esa clase. Alternativa
  descartada: todos los titulares conservan su lugar aunque el mes siguiente pase del aforo nuevo. _(010a; criterio 9.)_
- **DR-6 (pregunta P6). Ajuste del monto de una renovación.** **Decidido (la propuesta):** no en la 010; los precios
  especiales y las becas llegan con los códigos de descuento (015), que valdrán también para renovar. Alternativa
  descartada: sí, solo el administrador, con motivo y en la misma operación (como DR-11 de 007). _(010a; criterio 17 y
  «Fuera de alcance».)_
- **DR-7 (pregunta P7). Correos.** **Decidido (la propuesta):** al aprobar y al rechazar una renovación por Yape o
  transferencia (al alumno y, si es menor, al apoderado), sin credenciales; en efectivo no, porque recibe su ticket en el
  acto. Alternativa descartada: solo el rechazo (lo que pide HU-09). _(010a; criterio 15.)_
- **DR-8 (pregunta P8). Quién aparece en el listado de un mes.** **Decidido (la propuesta):** quien tiene la mensualidad
  de ese mes pagada o en verificación, y como «vencido» quien tuvo la del mes anterior y no la de este; los vencidos de
  antes se ven consultando meses anteriores. Alternativa descartada: todos los alumnos que no son `INACTIVO`, con
  «vencido» para siempre. _(010b; criterio 25.)_
- **DR-9 (pregunta P9). Qué cambia con un cambio de horario.** **Decidido (la propuesta):** solo los días y horas dentro
  del mismo plan, desde el momento del cambio, en la mensualidad del mes en curso o en la del siguiente; el monto y las
  clases que le quedan no cambian (si el nuevo horario tiene menos ocurrencias, la pantalla avisa). Alternativas
  descartadas: recalcular las clases del mes; permitir cambiar de plan. _(010c; criterios 35, 37 y 42.)_
- **DR-10 (pregunta P10). Inscripción al mes siguiente (N3 de 005).** **Decidido (la propuesta):** sí, en una entrega
  aparte (010d) después de la 010c: durante la ventana, el formulario público ofrece también el mes siguiente completo,
  con los cupos libres que dejan las reservas de prioridad (D-06) y una reserva de 24 horas. Sus criterios se agregan a
  esta spec cuando se planifique. Alternativa descartada: no; los clientes nuevos se inscriben desde el día 1.
  _(010d.)_
- **DR-11 (pregunta P11). «El administrador puede modificar … las clases» (HU-34; DR-11 de 007).** **Decidido (la
  propuesta):** fuera de la 010; las clases extra de un alumno concreto llegan con las recuperables (018, HU-35).
  Alternativa descartada: el administrador cambia `clases_totales` de una matrícula con motivo y auditoría, en la 010c.
  _(«Fuera de alcance».)_

**Cambios a pruebas protegidas, aprobados por Bryan el 26/11/2026:**

- **A1 (010b).** La prueba del criterio 33 de 009 pasa de `['faltas']` a `['cierre-de-mes', 'faltas']`. _(Criterio 30.)_
- **A2 (010c).** Las pruebas de los criterios 1 y 2 de 005 (`tablas.test.ts` y `privilegios.test.ts`) suman
  `agregada_en` y el `DELETE` en `matricula_clases`, con la nota en la cabecera. _(Criterio 34.)_

## Reglas para las historias siguientes

- **Cupo del mes siguiente:** toda operación que ocupe una clase en M+1 (la 010d, recuperaciones o asistencia en otro
  horario que lleguen a M+1) cuenta la ocupación y las reservas de prioridad con la función común de la 010a, después
  de `bloquearClasesParaCupo`.
- **Clases de una matrícula:** quien lea `matricula_clases` para decidir si una ocurrencia está incluida usa también
  `agregada_en` (criterio 38).
- **Descuentos (015):** se aplican también a la renovación, sobre el monto proporcional y antes del redondeo (D-03).
- **Recuperables (018):** parten de una matrícula `FINALIZADA` y de sus clases no usadas (RN-23, HU-35).
- **Panel del alumno (011):** muestra el estado de la mensualidad con `estadoDeMensualidad`, en solo lectura.
