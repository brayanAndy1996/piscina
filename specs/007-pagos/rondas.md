# Rondas adversariales: 007 · Pagos, verificación y paso de cliente a alumno

Registro de los ataques a la ruta crítica de esta historia (D-31). Lo leen el especificador y el adversarial; el resto
de los subagentes trabaja con `spec.md`. Como máximo 3 rondas por entrega. Las fallas críticas o altas se convierten
en criterios de `spec.md`; las medias o bajas quedan como deuda en las notas de la historia en `specs/backlog.md`.

Las rondas 1 a 4 de la 007a son anteriores a este archivo: están resumidas en el encabezado de `spec.md` (criterios
58 y 59) y en `tasks.md` y `plan.md`, y no se copian aquí.

## Entrega 007b · Ronda 1

- **Fecha:** 25/11/2026
- **Qué se atacó:** lo nuevo de la 007b. La subida del comprobante (orden de comprobaciones, `X-Pago-Datos`,
  normalización del número de operación, idempotencia, reserva y cupo en el instante del vencimiento), la bandeja, ver
  el comprobante, aprobar y rechazar (idempotencia y carreras), el aislamiento entre academias y los permisos, `HEAD` y
  las variantes de ruta en `/api/pagos`, las vistas del seguimiento y los bordes de mes en America/Lima con la zona del
  servidor cambiada.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| R1-1 | alta | Esperado: la subida con la reserva vigente bloquea las clases antes de leer «ahora» y nunca deja más matrículas que el aforo. Obtenido: `PUT /api/a/{nombreCorto}/solicitudes/comprobante` solo llamaba a `bloquearClasesParaCupo` cuando la solicitud volvía de un rechazo. Con la reserva vigente leía «ahora» sin las clases bloqueadas; un envío de la 005 (o un cobro, o el reintento de otra solicitud) en el instante T del vencimiento bloqueaba la clase, no contaba la matrícula (`reserva_vence_en = T`, ya confirmado) y tomaba el último cupo; después la subida confirmaba con `reserva_vence_en = NULL`. Resultado: 21 matrículas que ocupan cupo con aforo 20. Reproducido de forma determinista reteniendo el `INSERT` del comprobante en `pagos_numero_operacion_abierto_key` con otra transacción sin confirmar | criterio 60 de `spec.md` (crítico) |
| R1-2 | baja | `X-Pago-Datos` con bytes de 0x80 a 0xFF (latin1) se acepta: `"¹²³"` responde 201 y se guarda tal cual, aunque los criterios 36 y 37 piden «JSON ASCII» y, si no, 400 | deuda en el backlog |
| R1-3 | baja | Un número de operación con controles que también son espacios (`\t`, `\n`, `\r`, `\v`, `\f`, `\u0085`) se acepta y se guarda con el control. El criterio 38 dice que los controles responden 400, pero la definición de «número normalizado» quita «espacios de ningún tipo»: falta precisar cuál manda | deuda en el backlog |

- **Sin fallas en:**
  - `HEAD` y las variantes de ruta en `/api/pagos`;
  - el aislamiento entre academias en la bandeja, el comprobante, la aprobación, el rechazo y el token;
  - los permisos (`ENTRENADOR` y `ALUMNO` reciben 403);
  - `X-Pago-Datos` mal formado;
  - la normalización del número (ancho completo, Unicode, DR-9);
  - los bordes de mes en America/Lima con la zona del servidor en UTC, Tokio y Kiritimati;
  - aprobar y rechazar, el idempotente y la carrera;
  - la idempotencia de la subida;
  - las vistas del seguimiento;
  - el reintento, el cobro de un `PAGO_RECHAZADO` y el rechazo, que sí bloquean las clases.

## Entrega 007b · Ronda 2

- **Fecha:** 25/11/2026
- **Qué se atacó:** la corrección del criterio 60 frente a todo lo que toma cupo (envío público y de recepción, cobro,
  reintento, rechazo y cancelación), en 144 cruces, sin interbloqueos ni respuestas 500; la aprobación con la caja
  cerrada y reabierta, con el esperado por método en el cierre; el DNI del personal; la bandeja; y la clave de
  idempotencia de la web.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| R2-1 | media | Un cliente con `PAGO_RECHAZADO` que luego se registra como personal (criterio 22 b) puede subir otro comprobante. La matrícula vuelve a ocupar cupo sin fecha de vencimiento, y la aprobación responde 409 `DNI_DEL_PERSONAL` para siempre. La spec no dice qué debe responder la subida en ese caso. | deuda en el backlog; decisión pendiente del responsable (Bryan) sobre la respuesta de la subida |
| R2-2 | baja | El correo `PAGO_RECHAZADO` de un mes ya terminado invita a subir otro comprobante, aunque la solicitud queda `VENCIDA`. Los criterios 51 b y 52 se contradicen. | deuda en el backlog |
| R2-3 | baja | En la web, la `claveIdempotencia` queda fija en `PAGO_RECHAZADO` después de un 200 de reintento: hay que recargar la página para enviar otro comprobante. | deuda en el backlog |

- **Sin fallas en:** todo lo demás de la lista anterior (la corrección del criterio 60 en todos los cruces, la aprobación
  con la caja, el DNI del personal, la bandeja y la clave de idempotencia de la web), salvo las fallas de la tabla.
- **Cierre:** el ataque de la 007b termina en 2 de 3 rondas, sin fallas críticas ni altas. No hace falta una tercera ronda.
