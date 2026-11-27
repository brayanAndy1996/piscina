# 010d · Inscripción pública al mes siguiente

- **Historias y requerimientos:** HU-01 y HU-02 (formulario público, días y horario con cupo, cupos restantes), HU-34 y
  RN-25 (cobro proporcional con tope del plan), RN-01 y HU-04 (cliente hasta que su pago se confirma; cuenta y carnet al
  confirmarlo), RN-11 (aforo), RN-14 y RN-15 (asistencia con la mensualidad del día), RN-28 (el cupo queda reservado
  mientras el pago está pendiente), RN-23 y 8.8 (cierre de mes y estados), sección 4.1 (inscripción) y 4.5 (renovación).
  D-03 (orden del cobro), D-04 (Yape a la caja al verificar), D-05 (seguimiento y nuevo comprobante tras un rechazo),
  D-06 (prioridad al renovar: «las inscripciones nuevas para el mes siguiente solo pueden usar los cupos libres»), D-23,
  D-27, D-31.
- **Decisiones que esta entrega aplica:** DR-10 de la [spec 010](../010-mensualidades/spec.md) (durante la ventana, el
  formulario público ofrece también el mes siguiente completo, con los cupos libres que dejan las reservas de prioridad y
  una reserva de 24 horas); DR-3 de 005 (la inscripción al mes siguiente llega con la 010); DR-1 y DR-12 de 005 (24 horas,
  con tope en el fin del mes **de la matrícula**); DR-2 de 005 (el monto queda fijo al enviar); DR-2 de 007 (Yape en
  revisión al terminar el mes); DR-3, DR-12, DT-3, DT-4, DT-5 y DT-6 de 010; «Reglas para las historias siguientes» de
  010 («Cupo del mes siguiente»).
- **Ruta crítica:** sí. Toca entradas públicas, aforo y reservas, cálculo del cobro, pagos, aislamiento entre academias,
  fechas en America/Lima y la tarea del cierre de mes. Las pantallas no son críticas.
- **Estado:** aprobada por Bryan el 27/11/2026, con la propuesta de las cinco preguntas (P1 a P5, que son DR-1 a DR-5
  de esta spec, en «Resueltas»); el orquestador aceptó DT-1 a DT-13 del plan el mismo día. **En pruebas protegidas.** Se
  especifica en su propia carpeta (DT-1 del plan, decisión del orquestador por D-31: la spec 010 ya tiene 790 líneas).
  T35 de `specs/010-mensualidades/tasks.md` apunta aquí.

## Objetivo

Que una persona nueva pueda inscribirse desde el formulario público para **el mes siguiente completo** durante los últimos
días del mes (la ventana de renovación), sin quitarle el lugar a ningún alumno que todavía puede renovar (D-06): solo
toma los cupos que quedan libres después de las reservas de prioridad. Su lugar queda reservado 24 horas mientras paga,
como en la 005; el pago, la verificación, la caja y el paso a alumno funcionan como siempre (007), y su mensualidad empieza
el día 1.

## Clasificación de ruta crítica

Llevan pruebas protegidas y ataque adversarial los criterios marcados _(crítico)_:

- **Entradas públicas y fechas en Lima (1, 2, 5, 14):** qué meses ofrece el formulario y en qué instante se abre y se
  cierra la ventana; validación estricta de `mes`; límites por conexión.
- **Aforo y reservas (2, 6, 7, 8, 10):** quien se inscribe al mes siguiente nunca toma un lugar apartado para un titular,
  ni pasa del aforo, aunque varias operaciones pidan el último lugar a la vez.
- **Cálculo del cobro (3, 4):** el mes siguiente se cotiza desde el día 1, con tope del plan y redondeo una sola vez
  (D-03); lo que se ve es lo que se guarda.
- **Pagos (9, 10):** el pago de una solicitud del mes siguiente, su rechazo y el nuevo comprobante, sin romper la caja
  ni el aforo.
- **Estado del alumno y asistencia (11, 12):** la tarea del cierre de mes y la asistencia con una mensualidad que todavía
  no empezó.
- **Aislamiento y permisos (13, 15):** D-23 y la inscripción de recepción (criterio 34 de 007).

Llevan _(prueba obligatoria)_, sin ser críticos: 16 (contratos), 17 y 18 (web, con pruebas de componentes). El 19
(documentación) lo verifica el revisor.

## Definiciones

Se reutilizan, sin copiarlas, las definiciones de la [spec 010](../010-mensualidades/spec.md#definiciones): **«Ahora» y
hoy**, **mes en curso (M) y mes siguiente (M+1)**, **ventana de renovación** (los últimos `diasPrioridadRenovacion` días
de M, leídos con `leerConfiguracion(tx)` en la transacción, sin caché), **ocupación**, **titular de prioridad** (DR-12 de
010), **reservas de prioridad** y **cupo libre**. Además:

- **«Ahora» de las rutas públicas de esta entrega:** el de la 005: `RELOJ.ahora()` tomado una vez al empezar a atender la
  petición, y el mismo instante para todas las decisiones de esa petición (DT-6 del plan).
- **Meses de inscripción:** M siempre; M+1 solo si «ahora» está dentro de la ventana. Ningún otro.
- **Cupo libre para una inscripción nueva en la clase c y el mes X:** quien se inscribe por el formulario es un `CLIENTE`
  y nunca es titular de prioridad (DR-12 de 010). Para X = M, `aforo − ocupación(c, M)` (como la 005); para X = M+1,
  `aforo − ocupación(c, M+1) − reservas(c)`. Puede tomar c si es 1 o más; los cupos que se muestran son ese número
  recortado a 0. Se cuenta con la función común de la 010a (`contarOcupacion`, `contarReservasDePrioridad` y
  `cupoLibre`) después de `bloquearClasesParaCupo` cuando la operación escribe (DT-8 del plan).
- **Cotización del mes siguiente:** la de la renovación de M+1 (criterio 5 y DT-6 de 010; `cotizarRenovacion`): clases
  desde las 00:00:00.000 de Lima del día 1 de M+1, `clasesTotales = min(clasesRestantes, clasesPorMes)`, monto con
  `montoProporcional` y redondeo hacia arriba al sol entero una sola vez (D-03), `esProporcional = clasesRestantes <
  clasesPorMes`, `fechaInicio` el día 1 y `fechaFin` el último día de M+1 (DR-1).
- **Plan disponible para el mes X:** activo, que aplica al nivel elegido y `VIGENTE` en la `fecha_inicio` del mes: hoy
  para M (como la 005) y el día 1 para M+1 (DT-5 de 010).
- **Reserva sin pago de una matrícula del mes X:** el menor entre «ahora» más 24 horas y las 23:59:59.999 de Lima del
  último día de X (DR-1 y DR-12 de 005: «el fin del mes de la matrícula»). Para X = M es `vencimientoDeReserva(ahora)` de
  la 005; para X = M+1 son siempre las 24 horas, aunque crucen el día 1.

## Criterios de aceptación

### A. Qué meses ofrece el formulario

1. **Meses de inscripción.** `GET /api/a/{nombreCorto}/inscripcion/meses` responde 200 con `mesesInscripcionSchema`
   (estricto): `hoy` (`AAAA-MM-DD` de Lima), `meses` y `aperturaMesSiguiente`. `meses` trae siempre M (`{ mes, fechaInicio:
   hoy, inscripcionHasta: último día de M }`) y, si la ventana está abierta, también M+1 (`{ mes, fechaInicio: día 1 de
   M+1, inscripcionHasta: último día de M }`), en orden cronológico. `aperturaMesSiguiente` es el primer día de la
   ventana de M (`AAAA-MM-DD`) mientras la ventana todavía no se abrió, y `null` cuando está abierta. Con `RELOJ` fijo,
   `diasPrioridadRenovacion` = 5 y el proceso en `TZ=Asia/Tokyo`:
   - el 25/11/2026 a las 23:59:59.999 de Lima (`2026-11-26T04:59:59.999Z`): solo `2026-11`, apertura `2026-11-26`;
   - el 26/11 a las 00:00:00.000 (`2026-11-26T05:00:00.000Z`) y el 30/11 a las 23:59:59.999
     (`2026-12-01T04:59:59.999Z`): `2026-11` y `2026-12` (`fechaInicio` `2026-12-01`, `inscripcionHasta` `2026-11-30`),
     apertura `null`;
   - el 1/12 a las 00:00:00.000 (`2026-12-01T05:00:00.000Z`): solo `2026-12`, apertura `2026-12-27`;
   - el 31/12/2026 a las 10:00: `2026-12` y `2027-01` (cambio de año); con N = 15 en enero de 2027, la ventana empieza
     el 17/01; en febrero de 2027 con N = 15, el 14/02.

   Un `PATCH /api/configuracion` de `diasPrioridadRenovacion` confirmado vale para la petición siguiente, sin reiniciar.
   `Cache-Control: no-store`; academia inexistente, 404 `ACADEMIA_NO_ENCONTRADA`, y suspendida, 403
   `ACADEMIA_SUSPENDIDA` (como el criterio 5 de 005). No escribe, no bloquea y no audita. _(crítico)_ (DR-10, D-06,
   RNF-12)
2. **Datos del formulario para un mes.** `GET /api/a/{nombreCorto}/inscripcion` sin `mes`, o con `?mes=` igual a M,
   responde exactamente lo del criterio 6 de 005 (mismas claves; `mes` es M). Con `?mes=` igual a M+1 y la ventana
   abierta, responde el mismo `respuestaFormularioInscripcionSchema` con `mes` igual a M+1, el `hoy` de Lima, los
   `planes` disponibles para M+1 (vigentes el día 1, DT-5 de 010) y las `clases` activas con `cuposRestantes` igual al
   cupo libre para una inscripción nueva en M+1; las que tienen 0 no aparecen. Con un `mes` bien escrito que no es de
   inscripción (M+1 fuera de la ventana, M+2, un mes pasado), 200 con `planes: []` y `clases: []`. Un `mes` que no es
   `AAAA-MM` o que viene repetido: 400 `SOLICITUD_INVALIDA` con el campo `mes`; los demás parámetros se ignoran
   (criterio 7 de 005). Ejemplo, el 27/11/2026 con N = 5: la clase c (sábado 10:00, aforo 20) tiene 16 titulares (su
   matrícula de noviembre `VIGENTE` la incluye), 2 de ellos ya renovaron diciembre en c y un cliente tiene una reserva de
   24 horas de diciembre en c: `?mes=2026-12` muestra c con `cuposRestantes` 3 (`20 − 3 − 14`), y sin `mes` la muestra
   con 4 (`20 − 16`). Una clase cuyos lugares libres de diciembre están todos apartados no aparece con `?mes=2026-12`
   aunque sí aparezca para noviembre. No escribe, no bloquea y no audita. _(crítico)_ (HU-02, D-06, RN-11, DR-10)

### B. Cotización y envío

3. **Cotización del mes siguiente.** `POST /api/a/{nombreCorto}/inscripcion/cotizacion` admite `mes` opcional
   (`{ planId, nivel, claseIds, mes? }`, estricto). Sin `mes`, o con `mes` igual a M, es el criterio 11 de 005. Con M+1
   y la ventana abierta, aplica el plan disponible para M+1 (409 `PLAN_NO_DISPONIBLE`), las reglas de selección del
   criterio 15 b de 005 (409 `SELECCION_NO_VALIDA`) y la cotización del mes siguiente. Con otro mes, 409 `MES_CAMBIO`
   con `detalles.mes` igual a M (DT-4). Ejemplos con `Decimal`: plan de S/ 120.00 y 12 clases, lunes, miércoles y
   viernes, para diciembre de 2026 (13 ocurrencias, tope 12): `clasesTotales` 12, S/ 120, no proporcional,
   `fechaInicio` `2026-12-01`; el 28/01/2027, plan de S/ 100.00 y 13 clases, lunes, miércoles y viernes, para febrero
   de 2027 (12 ocurrencias): `100 × 12 ÷ 13` = 92.31 → S/ 93, proporcional. No escribe, no bloquea y no comprueba el
   cupo. _(crítico)_ (HU-34, RN-25, D-03, DR-1, DR-3 de 010)
4. **Envío para el mes siguiente.** `POST /api/a/{nombreCorto}/inscripcion` con `inscripcion.mes` igual a M+1 y la
   ventana abierta (con la configuración leída en la transacción) hace lo del criterio 16 de 005 con la matrícula de
   M+1: `anio` y `mes` de M+1, `fecha_inicio` el día 1, `fecha_fin` el último día, `clases_totales`, `es_proporcional`,
   `precio_plan`, `clases_por_mes_plan` y `monto_calculado` de la cotización del mes siguiente, y `reserva_vence_en`
   igual a la reserva sin pago de M+1. Responde 201 con la `cotizacion` de M+1 y ese `reservaVenceEn`; la auditoría
   `SOLICITUD_INSCRIPCION_CREADA` lleva `mes` M+1 y el mismo vencimiento, y el correo de seguimiento sale igual
   (criterios 26, 27 y 57 de 005). Con `inscripcion.mes` igual a M, nada cambia respecto de la 005; con cualquier otro
   mes, 409 `MES_CAMBIO` con `detalles.mes` igual a M, en el mismo lugar del orden de la 005 (después de
   `TEXTOS_ACTUALIZADOS` y antes de `PLAN_NO_DISPONIBLE`). Si `montoMostrado` no es el total, 409 `MONTO_CAMBIO` con la
   cotización de M+1 en `detalles.cotizacion`. Ejemplos de vencimiento: enviada el viernes 27/11/2026 a las 10:00 de
   Lima, `2026-11-28T15:00:00.000Z`; el lunes 30/11 a las 22:00 de Lima (`2026-12-01T03:00:00.000Z`),
   `2026-12-02T03:00:00.000Z` (cruza el día 1; no se recorta al fin de noviembre); el 31/12/2026 a las 10:00, la de
   enero de 2027 vence `2027-01-01T15:00:00.000Z`. El `CHECK matriculas_reserva_dentro_del_mes` (criterio 56 de 005) las
   acepta. No crea usuario, carnet ni pago. _(crítico)_ (HU-01, HU-02, RN-28, D-05, DR-10, DR-12 de 005)
5. **Bordes de la ventana en el envío.** Con `RELOJ` fijo, N = 5 y `TZ=Asia/Tokyo`, una cotización y un envío para
   `2026-12`: el 25/11 a las 23:59:59.999 de Lima, 409 `MES_CAMBIO`; el 26/11 a las 00:00:00.000 y el 30/11 a las
   23:59:59.999, 201. Un envío para `2026-12` cotizado el 30/11 a las 23:59:59.999 y procesado el 1/12 a las 00:00:00.000
   se trata como M (criterio 19 de 005): si el monto calculado con «ahora» es el mismo, 201 con la reserva de
   `vencimientoDeReserva(ahora)`; si no, `MONTO_CAMBIO`. `2027-01` el 30/11, 409 `MES_CAMBIO`. Si el administrador baja
   `diasPrioridadRenovacion` y la ventana deja de estar abierta, el envío siguiente para M+1 responde `MES_CAMBIO`; las
   solicitudes de M+1 ya creadas siguen valiendo (criterio 9). Ningún rechazo escribe, audita ni envía correo.
   _(crítico)_ (DR-10, D-06, RNF-12)

### C. Aforo y reservas

6. **Solo los cupos libres (D-06).** Una inscripción nueva para M+1 necesita, en cada clase elegida, cupo libre para una
   inscripción nueva en M+1; si no, 409 `SIN_CUPO` con `detalles.clasesSinCupo` (todas las que no tienen lugar, en el
   orden pedido), sin escribir, auditar ni enviar correo. Con `RELOJ` fijo el 27/11/2026 (N = 5), la caja abierta de hoy
   y la clase c (sábado 10:00, aforo 20) con 18 titulares y nada de diciembre:
   - el cliente K1 se inscribe a c para diciembre a las 10:00 y K2 a las 11:00 (201 y 201); K3 recibe `SIN_CUPO`;
     noviembre de c sigue mostrando 2 cupos (`20 − 18`) en el formulario sin `mes`;
   - el 28/11 a las 10:00, sin pagar, vence la reserva de K1 (no la de K2): K3 se inscribe a c para diciembre (201);
   - los 18 titulares renuevan c para diciembre en efectivo (010a), cada uno con 201, también el último; diciembre queda
     en 20 de 20;
   - el 1/12 a las 00:00:00.000 de Lima ya no hay reservas de prioridad: con otra clase d de aforo 20, 15 titulares de
     noviembre y ninguno renovado, un cliente se inscribe a d para diciembre (ya es M) con `aforo − ocupación(d, dic)`.

   Si el administrador bajó el aforo de c por debajo de los inscritos (DR-5 de 004), el cliente recibe `SIN_CUPO`. La
   ocupación de cada mes nunca pasa del aforo. _(crítico)_ (D-06, RN-11, RN-28, DR-10)
7. **Último cupo simultáneo.** Pruebas deterministas (espera comprobada en `pg_locks`), con `RELOJ` fijo en la ventana:
   - dos envíos públicos para M+1 por el último lugar libre de c: uno 201 y el otro `SIN_CUPO`;
   - un envío público para M+1 y la renovación de M+1 de un alumno sin prioridad (010a) por el último lugar libre: uno
     solo ocupa;
   - un envío público para M+1 y la renovación de un titular de c, con un solo lugar libre más la reserva del titular:
     los dos 201;
   - un envío público para M+1 y un cambio de horario (010c) que lleva una matrícula de M+1 a c, por el último lugar
     libre: uno solo entra;
   - un envío para M y otro para M+1 de la misma clase, con un lugar libre en cada mes: los dos 201;
   - dos envíos para M+1 con `[c1, c2]` y `[c2, c1]` a la vez terminan sin `40P01` ni 500.

   Después de cada prueba, la ocupación de cada mes es como mucho el aforo. _(crítico)_ (RN-11, D-06)
8. **Orden de bloqueos.** El envío para M+1 sigue el orden de la 005 («Orden de bloqueos con alumnos y solicitudes»):
   el actor (solo recepción, criterio 34 de 007) → los consultivos de la conexión y del DNI → las filas del cliente
   (`alumnos`, `solicitudes_inscripcion`, `matriculas`) con `FOR UPDATE` → `bloquearClasesParaCupo` con todas las clases,
   en una sola llamada → la ocupación y las reservas de prioridad → las escrituras. La configuración se lee en la misma
   transacción. Pruebas deterministas sin `40P01`, a la vez que, sobre la misma clase: la renovación de un titular
   (010a), un cambio de horario (010c), el cobro en efectivo de otra solicitud (007a) y la tarea del cierre de mes.
   _(crítico)_ (regla «Cupo de una clase» de 004; «Orden de bloqueos» de 005)

### D. Pago, rechazo y nuevo comprobante

9. **Pago de una solicitud del mes siguiente.** El cobro en efectivo en recepción (007a) y el comprobante público con
   su verificación (007b) funcionan igual que con una solicitud de M: el efectivo exige la caja abierta de hoy y entra a
   ella con concepto `INSCRIPCION`; el comprobante deja la matrícula `RESERVADA` sin vencimiento (RN-28), sin tocar la
   caja, y al aprobarlo entra a la caja abierta del día en que se verifica (D-04), antes o después del día 1. El total
   sale de lo guardado (`totalACobrar`, también con el ajuste del administrador, criterio 11 de 007). Al confirmar: la
   matrícula de M+1 pasa a `VIGENTE`, la solicitud a `CONFIRMADA` y la persona pasa de `CLIENTE` a `ALUMNO_ACTIVO` en
   ese momento, con su usuario, su contraseña inicial igual al DNI con cambio obligatorio y su QR (HU-04, DR-2), sin
   esperar al día 1. No se crea ni se toca ninguna matrícula de M. Un cambio de `diasPrioridadRenovacion` o el paso
   del día 1 no impiden pagar una solicitud de M+1 ya creada. Pruebas: cobro en efectivo el 27/11 (201, ingreso en la
   caja del 27/11, ticket, matrícula de diciembre `VIGENTE`); sin caja abierta, 409 `SIN_CAJA_ABIERTA` sin escribir;
   comprobante el 28/11 y aprobación el 2/12 (el ingreso va a la caja del 2/12). _(crítico)_ (HU-04, HU-07 a HU-09,
   RN-17, RN-28, D-04)
10. **Rechazo y nuevo comprobante (D-05).** El estado visible de una solicitud con la matrícula `CANCELADA` y su último
    pago `RECHAZADO` es `PAGO_RECHAZADO` mientras el mes de hoy (Lima) **no es posterior** al de la matrícula, y
    `VENCIDA` después (amplía `estadoVisible` y `estadoVisibleSql`; con una matrícula de M el resultado no cambia). Al
    subir un nuevo comprobante o cobrar en efectivo después de un rechazo, el cupo se vuelve a pedir (criterios 18 c y 41
    de 007) con el cupo libre para una inscripción nueva en el mes de la matrícula: con las reservas de prioridad si la
    matrícula es de M+1 respecto de «ahora». Con `RELOJ` fijo el 27/11/2026 y c de aforo 20 con 19 titulares: K1 toma el
    lugar libre de diciembre (201), sube su Yape y se lo rechazan; la consulta de seguimiento muestra `PAGO_RECHAZADO`;
    K2 toma el lugar (201); K1 sube otro comprobante: 409 `SIN_CUPO`, sin pago, sin archivo y sin auditoría; el 28/11
    vence la reserva de K2 y K1 sube otro: 201; los 19 titulares renuevan c con 201. Rechazado el 29/11, un
    nuevo comprobante el 2/12 pide `aforo − ocupación(c, dic)`. Una solicitud de diciembre rechazada se muestra
    `VENCIDA` el 1/1/2027 a las 00:00:00.000 de Lima, y no antes. Pruebas unitarias de `estadoVisible` con hoy en M, en
    M+1 y en M+2, también con `TZ=Asia/Tokyo`, y la lista del panel de solicitudes filtrada por `PAGO_RECHAZADO` con una
    solicitud de M+1. _(crítico)_ (D-05, RN-11, RN-28, D-06)

### E. Estado del alumno y asistencia antes del día 1

11. **El cierre de mes no vence a quien ya pagó el mes siguiente (DR-2).** La tarea del cierre de mes (criterio 27 de 010)
    pasa un `ALUMNO_ACTIVO` a `ALUMNO_VENCIDO` solo si no tiene matrícula `VIGENTE` de M **ni de M+1**; el resto de sus
    reglas no cambia. Con `RELOJ` fijo y `TZ=Asia/Tokyo`: un cliente que pagó diciembre el 27/11 queda `ALUMNO_ACTIVO`
    después de las vueltas del 27/11, del 30/11 a las 23:59:59.999 y del 1/12 a las 00:00:00.000. Un `ALUMNO_ACTIVO`
    sin nada de M ni de M+1 sigue pasando a `ALUMNO_VENCIDO`; un `ALUMNO_VENCIDO` que renovó diciembre sigue
    `ALUMNO_VENCIDO` hasta el 1/12 (criterio 28 de 010, sin cambios). Volver a correr la tarea no cambia nada.
    _(crítico)_ (8.8, RN-23, D-23, DR-2)
12. **La asistencia empieza el día 1.** Un alumno cuya única matrícula `VIGENTE` es la de M+1: el marcado por QR o
    manual de una clase de M responde 409 `MENSUALIDAD_NO_VIGENTE` (009), sin descontar; la tarea de faltas no le
    registra faltas en M; el registro posterior de un día de M lo rechaza. El 1/12 marca la clase de ese día (dentro de
    su horario, D-16) y descuenta de la matrícula de diciembre. _(crítico)_ (RN-14, RN-15, D-16, DR-2, criterio 16 de
    010)

### F. Aislamiento, entradas públicas y recepción

13. **Aislamiento entre academias.** Con A y B, el mismo DNI y clases a la misma hora: `/a/{A}/inscripcion/meses` usa
    la configuración de A (A con N = 5 y B con N = 10: el 23/11 solo B ofrece diciembre); las reservas de prioridad y la
    ocupación de M+1 solo cuentan matrículas de A; un plan o una clase de B en la cotización o el envío para M+1 responde
    como inexistente (`PLAN_NO_DISPONIBLE`, `SELECCION_NO_VALIDA`) sin leer ni escribir nada de B; el token de una
    solicitud de M+1 de B no sirve en A; `?academiaId=` no cambia nada. _(crítico)_ (D-23, D-27)
14. **Entradas públicas.** `GET /api/a/{nombreCorto}/inscripcion/meses` cuenta en la regla `lectura` de `LIMITES_PUBLICOS`
    (60 por minuto por clave de conexión, también con `HEAD`, mayúsculas distintas o barra final), y `?mes=` no saca al
    `GET` del formulario de su regla. Las solicitudes de M+1 cuentan en el límite de 5 reservas sin pagar por conexión
    (criterio 25 de 005). Las peticiones de recepción no cuentan (criterio 33 de 007). El registro técnico de estas rutas
    no lleva DNI, nombres, datos médicos, token ni cuerpo (criterio 28 de 005). _(crítico)_ (criterios 25, 28, 33 y 49
    de 005)
15. **Inscripción desde recepción (DR-3).** Un envío para M+1 con la sesión de un `ADMIN` o una `SECRETARIA` de la
    academia (desde «Nueva inscripción», que es el mismo formulario) hace lo mismo que el público, con las reglas del
    criterio 34 de 007 (actor vigente, sin el límite de 5 por conexión, auditoría con actor `USUARIO`), y los mismos
    cupos: tampoco toma un lugar apartado. El cobro en efectivo de esa solicitud exige la caja abierta de hoy (criterio
    9). _(crítico)_ (sección 2.1, criterio 34 de 007, DR-3)

### G. Contratos, web y documentación

16. **Contratos.** En `packages/contratos/src/inscripcion.ts`: `cotizarInscripcionSchema` suma `mes: mesSchema`
    opcional (sigue estricto); `consultaFormularioSchema` (`{ mes?: mesSchema }`) para la consulta del `GET`;
    `mesesInscripcionSchema` (criterio 1). `respuestaFormularioInscripcionSchema`, `enviarInscripcionSchema` y
    `respuestaInscripcionCreadaSchema` no cambian. Pruebas de los esquemas. _(prueba obligatoria)_
17. **Web del formulario.** En `/a/{nombreCorto}/inscripcion` (y en «Nueva inscripción» de recepción, que es el mismo
    formulario): si `meses` trae dos meses, el primer paso pregunta «¿Desde cuándo?» con las dos opciones («Este mes,
    desde hoy» y «{Mes siguiente} completo, desde el 1»), con la fecha límite para elegir el mes siguiente; el plan, las
    clases y los cupos salen de `GET …/inscripcion?mes=` del mes elegido, y la cotización y el envío llevan ese `mes`. El
    resumen y la confirmación dicen el mes y desde qué día empieza. Con un solo mes, el formulario es el de hoy; si la
    cotización responde `SIN_CLASES_EN_EL_MES` y hay `aperturaMesSiguiente`, el aviso dice desde qué fecha se puede
    inscribir para el mes siguiente («Las inscripciones para diciembre se abren el 26/11»), en lugar de «vuelve el día 1»
    (DR-4). Ante `MES_CAMBIO`, vuelve a pedir los meses y la oferta, y pide elegir otra vez. Las claves de las consultas
    llevan el nombre corto y el mes. La web no sugiere inscribirse a los últimos días del mes en curso para ganar
    prioridad (DR-5). _(prueba obligatoria, componentes)_ (HU-01, HU-02, DR-4)
18. **Seguimiento y panel.** La página de seguimiento (`/a/{nombreCorto}/solicitud/{token}`), la lista del panel de
    solicitudes y la bandeja de pagos muestran el mes de la inscripción cuando no es el mes en curso («Diciembre de 2026,
    desde el 1/12»), con lo que ya traen sus contratos. _(prueba obligatoria, componentes)_
19. **Documentación.** `docs/arquitectura.md` («Lo que construye la historia 010d»: meses de inscripción, cupo para
    inscripciones nuevas, vencimiento de la reserva del mes siguiente, estado visible tras un rechazo y la regla del
    cierre), la guía de Windows (cómo probar la ventana con `diasPrioridadRenovacion`) y la nota de la 010 en
    `specs/backlog.md`. _(revisor)_

## Casos límite

- **La reserva de 24 horas de M+1 vence sin pago:** el lugar se libera solo, la solicitud se ve `VENCIDA` y la persona
  puede volver a inscribirse (criterio 21 b de 005) para M o, si la ventana sigue abierta, para M+1, si hay cupo.
- **Reserva hecha el último día de la ventana:** vence a las 24 horas, ya dentro de M+1; desde el día 1 es una reserva
  más del mes en curso y se paga como cualquier otra (criterio 4).
- **Pago después del día 1:** el monto queda fijo al enviar (DR-2 de 005), aunque ya hayan pasado clases de ese mes.
- **Cliente con una solicitud de M activa que quiere M+1:** `DNI_YA_REGISTRADO` hasta que su reserva venza o recepción
  la cancele (una sola solicitud activa por persona, criterio 21 de 005).
- **Exalumno (`ALUMNO_VENCIDO`) que usa el formulario:** `DNI_YA_REGISTRADO`, como hoy; renueva en recepción (010a).
- **Ya pagó M+1 y quiere empezar este mes:** recepción le registra la renovación tardía de M (DR-4 de 010).
- **Clase que no aparece para M+1 pero sí para M:** sus lugares libres de M+1 están apartados para los titulares.
- **Titular que renueva en otras clases:** deja libre su lugar y un cliente lo puede tomar; si después le rechazan el
  Yape, hay más titulares que lugares y entran los primeros (DT-4 y criterio 44 de 010).
- **El administrador baja `diasPrioridadRenovacion` en plena ventana:** M+1 deja de ofrecerse desde la petición
  siguiente; lo ya reservado sigue (criterio 5).
- **Inscripción a M durante la ventana:** se sigue ofreciendo; al pagar, la persona pasa a ser titular para M+1 (regla de
  la 010, que se mantiene: DR-5).
- **Clase de 19:00 a 20:00 del 30/11 y envío a las 19:30:** para M+1 cuentan todas las clases de diciembre desde el día 1;
  para M, la de hoy ya no cuenta (criterio 8 de 005).

## Reglas de negocio aplicables

- **DR-10 de 010:** durante la ventana, el formulario ofrece también el mes siguiente completo, con los cupos libres que
  dejan las reservas de prioridad y una reserva de 24 horas.
- **D-06:** las inscripciones nuevas para el mes siguiente solo usan los cupos libres; el día 1 se liberan los apartados.
- **DR-1 y DR-12 de 005:** 24 horas para pagar, con tope en el fin del mes de la matrícula.
- **D-03, RN-25 y HU-34:** precio con IGV; proporcional sin redondear; redondeo hacia arriba una vez.
- **RN-28, D-04 y D-05:** reserva sin vencimiento mientras se verifica; el Yape entra a la caja al aprobarlo; tras un
  rechazo, nuevo comprobante si hay cupo.
- **RN-01 y HU-04:** cliente hasta que su pago se confirma; al confirmarlo, cuenta y carnet.

## Contrato

**Esquemas** (`packages/contratos/src/inscripcion.ts`, reexportados en el índice): `mesesInscripcionSchema`,
`consultaFormularioSchema` y `mes` opcional en `cotizarInscripcionSchema` (criterio 16).

| Método y ruta | Acceso | Respuesta | Cambio |
| --- | --- | --- | --- |
| `GET /api/a/{nombreCorto}/inscripcion/meses` | público (y recepción) | 200 `mesesInscripcionSchema` | nueva |
| `GET /api/a/{nombreCorto}/inscripcion?mes=` | público | 200 `respuestaFormularioInscripcionSchema` | suma `mes` |
| `POST /api/a/{nombreCorto}/inscripcion/cotizacion` | público | 200 `{ cotizacion }` | suma `mes` |
| `POST /api/a/{nombreCorto}/inscripcion` | público y recepción | 201 solicitud | acepta M+1 |

Sin códigos de error nuevos: se reutilizan `MES_CAMBIO` (con `detalles.mes` igual a M), `PLAN_NO_DISPONIBLE`,
`SELECCION_NO_VALIDA`, `SIN_CLASES_EN_EL_MES`, `SIN_CUPO` (con `detalles.clasesSinCupo`), `MONTO_CAMBIO` y
`SOLICITUD_INVALIDA`. **Permisos:** sin filas nuevas en la matriz. **Auditoría:** la de siempre
(`SOLICITUD_INSCRIPCION_CREADA`, los pagos de la 007). **Correos:** los de la 005 y la 007, sin plantillas nuevas.
**Límites:** `/inscripcion/meses` en la regla `lectura`.

## Cambios al modelo de datos

Ninguno. Sin migración: las matrículas de M+1 ya caben en `matriculas` (el `CHECK matriculas_reserva_dentro_del_mes`
compara con el mes de la matrícula) y las reservas de prioridad se calculan al leer.

## Fuera de alcance

- Mostrar en la grilla de ocupación del administrador (`GET /api/clases/ocupacion`) las reservas de prioridad de M+1.
- Avisos o correos sobre la apertura de la ventana; inscribirse para meses posteriores a M+1.
- Un «mes de prueba» o asistencia antes del día 1.
- Los códigos de descuento (015) en la inscripción al mes siguiente: llegarán con la 015, como en la renovación.
- Cambiar la prioridad de la 010 (DR-5).

## Impacto en especificaciones anteriores

- **005:** el formulario, la cotización y el envío aceptan M+1 (criterios 1 a 5). Sin `mes`, o con M, todo sigue igual:
  las pruebas protegidas de la 005 no cambian. Revisado: `lectura-publica.test.ts` fija las claves del `GET` sin `mes`
  (no cambian) y el `mes` M el 30/11 a las 23:59:59 (sigue siendo M); las pruebas que esperan `MES_CAMBIO` con
  `2026-12` (`envio-monto`, `correo`, `correo-destinatarios-respuestas-ronda1`, `envio-correcto`, `dni-registrado` y
  `orden-409`) corren el 11/11/2026, fuera de la ventana; `reserva-protegido.test.ts` fija `vencimientoDeReserva(ahora)`,
  que no cambia (la de M+1 es una función nueva, DT-7). El test-writer lo vuelve a comprobar (T1).
- **007:** `estadoVisible` y `estadoVisibleSql` (criterio 10) y `exigirCupoDeLaMatricula` (cupo con reservas si la
  matrícula es de M+1). Con matrículas de M o pasadas el resultado es el mismo; las pruebas protegidas no cambian.
- **010b:** la regla del cierre de mes para `ALUMNO_ACTIVO` (criterio 11, DR-2). Ninguna prueba protegida
  de la 010b siembra un `ALUMNO_ACTIVO` con solo una matrícula `VIGENTE` de M+1; el test-writer lo comprueba (T1).
- **010 (T35):** apunta a esta carpeta. La spec 010 no se reescribe.
- **Web de la 005:** `Inscripcion.test.tsx` (no protegida) suma los simulacros de `/meses`.

## Riesgos aceptados

- **Reservas falsas para M+1:** como en la 005, una persona puede reservar hasta 5 lugares por conexión durante 24 horas;
  en M+1 hay menos lugares libres, así que una clase chica puede quedar bloqueada un día. Mitiga: el límite por conexión,
  el vencimiento y la cancelación desde el panel (criterio 39 de 005).
- **Más titulares que lugares:** los casos raros de DT-4 de 010 siguen existiendo; nunca se pasa del aforo.
- **Aprobar el pago de M de un titular no bloquea clases** (DT-3 de 010): un cliente puede tomar a la vez el último
  lugar libre de M+1, y entonces los últimos titulares en renovar no encuentran lugar (criterio 44 de 010).
- **«Ahora» único en la petición pública** (DT-6): una petición que espera bloqueos justo en el cambio de día decide con
  el instante en que llegó; con eso cuenta reservas y ocupación que ya no existen, así que solo puede rechazar de más,
  nunca pasar del aforo.

## Decisiones

Técnicas, propuestas por el especificador y aceptadas por el orquestador el 27/11/2026 tal como se propusieron; el
detalle y la alternativa descartada de cada una están en `plan.md`. Las decisiones del responsable (DR-1 a DR-5) están
en «Resueltas».

DT-1 (carpeta propia), DT-2 (`/inscripcion/meses` y `?mes=` sin cambiar la forma del `GET`), DT-3 (`mes` opcional en la
cotización), DT-4 (`MES_CAMBIO` para un mes que no es de inscripción), DT-5 (`?mes=` no permitido: listas vacías), DT-6
(«ahora» único de la 005), DT-7 (`vencimientoDeReservaDelMes`), DT-8 (una función de cupo para inscripciones nuevas),
DT-9 (estado visible tras un rechazo), DT-10 (regla del cierre), DT-11 (límite `lectura`), DT-12 (sin E2E nueva) y DT-13
(reutilizar el dominio de la 010a).

## Preguntas abiertas

Ninguna. Las cinco preguntas de negocio (P1 a P5) quedaron resueltas: ver «Resueltas».

## Resueltas

Decisiones del responsable. Se conserva cada pregunta, resumida, con lo decidido y la alternativa descartada.

- **DR-1 (pregunta P1). Cuánto paga quien se inscribe al mes siguiente.** DR-10 de 010 dice «el mes siguiente
  completo». **Decidido por Bryan el 27/11/2026 (la propuesta):** la misma regla de la renovación (DR-3 de 010) y de la
  inscripción (DR-2 de 005): las clases del mes desde el día 1, con el tope del plan. Casi siempre es el precio
  completo; solo baja si el plan tiene más clases que las que caben en ese mes (13 clases en un febrero con 12: S/ 93 en
  vez de S/ 100). Alternativa descartada: siempre el precio completo del plan. _(Definición «Cotización del mes
  siguiente»; criterios 3 y 4.)_
- **DR-2 (pregunta P2). Qué pasa al pagar antes del día 1.** **Decidido por Bryan el 27/11/2026 (la propuesta):** al
  confirmarse el pago, la persona pasa a ser alumno en ese momento, con su usuario, su contraseña inicial y su carnet
  (HU-04), y queda `ALUMNO_ACTIVO`; el cierre de mes no la pasa a `ALUMNO_VENCIDO` aunque no tenga mensualidad del mes
  en curso, porque ya pagó la siguiente. La asistencia empieza el día 1 (antes, el marcado responde
  `MENSUALIDAD_NO_VIGENTE`). Alternativas descartadas: (b) que siga como cliente hasta el día 1 y reciba su cuenta y su
  carnet ese día (más complejo y contradice HU-04); (c) dejar que el cierre la marque vencida hasta el día 1 (recepción
  vería «vencido» a un alumno nuevo que ya pagó). _(Criterios 9, 11 y 12; DT-10.)_
- **DR-3 (pregunta P3). La secretaria también inscribe al mes siguiente.** **Decidido por Bryan el 27/11/2026 (la
  propuesta):** sí, desde «Nueva inscripción», que es el mismo formulario, con las mismas reglas y los mismos cupos (no
  toma un lugar apartado); el cobro en efectivo exige la caja abierta de hoy. Alternativa descartada: solo el formulario
  público. _(Criterio 15.)_
- **DR-4 (pregunta P4). Qué ve el cliente fuera de la ventana.** **Decidido por Bryan el 27/11/2026 (la propuesta):** el
  formulario sigue como hoy, solo con el mes en curso; si ya no quedan clases en el mes, el aviso dice desde qué fecha
  puede inscribirse para el mes siguiente («Las inscripciones para diciembre se abren el 26/11»). Alternativa
  descartada: mantener el aviso de la 005 («vuelve el día 1»). _(Criterios 1 y 17.)_
- **DR-5 (pregunta P5). Inscribirse al mes en curso durante la ventana da prioridad.** **Decidido por Bryan el
  27/11/2026 (la propuesta):** se mantiene la regla de la 010: quien se inscribe a los últimos días del mes en curso y
  paga pasa a ser titular y compite por los lugares apartados del mes siguiente; nunca se pasa del aforo y, con más
  titulares que lugares, entran los primeros en renovar (DT-4 y criterio 44 de 010). La web no sugiere ese camino.
  Alternativa descartada: que una inscripción nueva al mes en curso hecha durante la ventana no dé prioridad (cambiaba
  la definición de titular de la 010 y una prueba protegida de la 010a). _(Casos límite, «Fuera de alcance» y criterio
  17.)_
