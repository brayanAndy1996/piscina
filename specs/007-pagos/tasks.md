# 007 · Tareas

Cada tarea indica su rol y los criterios de [`spec.md`](spec.md) que cubre. Las de la 007b llevan **[007b]** y van en
el segundo PR, con la 007a ya unida a `main`.

## 0. Aprobación

- [x] T0.1 · orquestador · Mostrar a Bryan P1 a P14 con sus propuestas y decidir T1 a T16; el especificador pasa las
  respuestas a «Decisiones» y ajusta los criterios marcados «provisional» (todos). Hecho el 24/11/2026: DR-1 a DR-14
  (todas con la propuesta) y DT-1 a DT-16 (aceptadas por el orquestador)
- [x] T0.2 · orquestador · Decidir T17 a T19 de la spec (pruebas protegidas anteriores que no se pueden ajustar solo
  sumando) antes del commit de pruebas protegidas de la 007a; el especificador las pasa a DT-17 a DT-19. Hecho el
  24/11/2026: DT-17 a DT-19, con la propuesta

## 007a · Cobro en recepción y cuenta del alumno

### Pruebas protegidas (antes del código)

- [ ] T1 · test-writer · Catálogo, privilegios, RLS, llaves (también la diferida), `CHECK`, índices y triggers de `pagos`;
  `CONFIRMADA` y `registrada_por` (criterios 1 a 7)
- [ ] T2 · test-writer · Ampliar las pruebas protegidas anteriores de la lista «Pruebas protegidas anteriores que amplía
  la 007a» (spec, «Decisiones»): 001 (listas exactas), 002 (matriz de 26 filas, DT-12), 005 (tablas, privilegios y
  claves del elemento del panel) y 006 (llave de `pago_id` y pago `CONFIRMADO` en la misma transacción que su ingreso,
  dentro de las utilidades), solo sumando y con la línea «Actualizada por la 007» en el encabezado; y los tres
  cambios aprobados por el orquestador que no son solo una suma (DT-17 a DT-19). Lo revisa el orquestador con `git diff` antes del commit (Impacto)
- [ ] T3 · test-writer · Permisos y aislamiento de las rutas de la 007a; actor vigente (criterios 8 y 9)
- [ ] T4 · test-writer · Total a cobrar, ajuste y ajuste frente a cobro (criterios 10 a 12)
- [ ] T5 · test-writer · Cobro en efectivo: correcto, caja, estados, monto, idempotencia, cupo con la reserva que vence,
  interbloqueos (criterios 13 a 19)
- [ ] T6 · test-writer · Paso de cliente a alumno, ingreso con DNI y cambio obligatorio, DNI del personal, registro
  técnico sin DNI ni clave, seguimiento confirmado (criterios 20 a 24)
- [ ] T7 · test-writer · Aislamiento y permiso del ticket (criterio 26, parte crítica)
- [ ] T8 · test-writer · Estados nuevos de la 007a en la vista, el panel, la cancelación, la foto y el envío (criterios 28
  a 32, sin las partes [007b])
- [ ] T9 · test-writer · Recepción sin los límites por conexión: middleware, envío con actor, `registrada_por`, foto
  (criterios 33 a 35)
- [ ] T10 · test-writer · Correo `PAGO_CONFIRMADO` después de confirmar, destinatarios y fallos (criterio 51 a)
- [ ] T11 · tester · Confirmar que T1 y T3 a T10 fallan por la razón esperada (y que las ampliadas en T2 fallan solo por
  lo que suma la 007a); commit «Pruebas protegidas (007): 007a, … (en rojo)» (tres dígitos y sin letra en el paréntesis;
  la entrega va después)

### Implementación

- [ ] T12 · backend · Migraciones `<marca>_estado_solicitud_confirmada` y `<marca>_pagos`; `schema.prisma`;
  `PRIVILEGIOS_APP`, `rol-app.mjs`, `TABLAS_DESPUES_DE_MIGRAR`; utilidades de pruebas (criterios 1 a 7)
- [ ] T13 · backend · Contratos: `pagos.ts`, `solicitudes.ts` (estados, vistas, panel, filtro), `permisos.ts`
  (criterios 8, 28 y 29)
- [ ] T14 · backend · Módulo `pagos/`: `totalACobrar`, `bloquearFilasDelCobro`, `confirmarPagoEnTransaccion`, errores
  (criterios 10, 19, 20, 21, 25)
- [ ] T15 · backend · Cobro en efectivo y ajuste del monto, con sus rutas (criterios 11 a 18, 22 a)
- [ ] T16 · backend · `crearPersonal` con el consultivo del DNI y la comprobación de alumnos (criterio 22 b y c)
- [ ] T17 · backend · Estado visible, seguimiento, lista y cancelación del panel, foto y envío con los estados nuevos
  (criterios 24, 28 a 32)
- [ ] T18 · backend · Sesión de recepción en el middleware de `/api/a` y en el envío (criterios 33 a 35)
- [ ] T19 · backend · Ticket: número y `GET /api/pagos/{id}/ticket` (criterios 25 y 26)
- [ ] T20 · backend · Plantilla y envío del correo `PAGO_CONFIRMADO` (criterio 51 a)
- [ ] T21 · frontend · Panel de solicitudes: estados, total, ajuste, «Cobrar en efectivo» con el aviso de la caja,
  «Ajustar monto» (criterio 54, partes de la 007a)
- [ ] T22 · frontend · Página imprimible del ticket y opción en el inicio (criterios 27 y 56, parte del ticket)
- [ ] T23 · frontend · Seguimiento de una solicitud confirmada (criterios 24 y 28)
- [ ] T24 · backend · Semilla: un ajuste de ejemplo (criterio 57, parte de la 007a)

### Ataque, revisión y cierre

- [ ] T25 · adversarial · Ataque de la 007a (criterios críticos de la 007a; foco en caja de otro día, doble clic, último
  cupo con la reserva que vence, DNI del personal, sesión de recepción falsificada o de otra academia, aislamiento)
- [ ] T26 · especificador · Criterios nuevos de cada falla, con su origen
- [ ] T27 · revisor · Comparar con la spec y las convenciones; `git diff` de las pruebas protegidas
- [ ] T28 · tester · Suite completa, lint y tipos
- [ ] T29 · documentador · `docs/arquitectura.md`, `README.md`, guía de uso, `specs/backlog.md`; commit (criterio 57)

## 007b · Yape y transferencia **[007b]**

### Pruebas protegidas (antes del código)

- [ ] T30 · test-writer · Subida del comprobante: orden de comprobaciones, datos, número sin duplicados, imagen sin
  metadatos, estados, reintento tras rechazo con cupo, idempotencia, límite y registro técnico, reserva sin límite
  (criterios 36 a 44)
- [ ] T31 · test-writer · Bandeja, comprobante con `HEAD`, aprobar, aprobar dos veces, aprobar y rechazar a la vez,
  rechazar, cupo liberado, mes terminado (criterios 45 a 50 y 52)
- [ ] T32 · test-writer · Partes [007b] de los criterios 15, 18 c, 21, 28 a 32; correo `PAGO_RECHAZADO` (criterio 51 b)
- [ ] T33 · tester · Confirmar en rojo; commit «Pruebas protegidas (007): 007b, … (en rojo)»

### Implementación

- [ ] T34 · backend · Contratos de la 007b (`datosComprobanteSchema`, `pagoPendienteSchema`, `rechazarPagoSchema`,
  constantes) y claves de configuración de los datos de pago (criterios 36, 45, 49 y 53)
- [ ] T35 · backend · Regla `comprobante`, lector binario, `RUTAS_REDACTADAS`, servicio y ruta pública del comprobante
  (criterios 36 a 44)
- [ ] T36 · backend · Bandeja, comprobante y `HEAD` 404 en `/api/pagos` (criterios 45 y 46)
- [ ] T37 · backend · Aprobación con `confirmarPagoEnTransaccion` y rechazo con el cupo y el correo (criterios 47 a 52)
- [ ] T38 · backend · Estados `EN_VERIFICACION` y `PAGO_RECHAZADO` en el seguimiento, el panel, la cancelación, la foto y
  el cobro en efectivo (partes [007b] de 15, 18, 28 a 32)
- [ ] T39 · frontend · Seguimiento: estados, datos de pago y formulario del comprobante (criterios 53 y 55)
- [ ] T40 · frontend · Bandeja `/panel/pagos` y configuración de los datos de pago (criterios 53 y 56)
- [ ] T41 · backend · Semilla: Yape pendiente con comprobante de ejemplo y datos de pago (criterio 57, parte de la 007b)

### Ataque, revisión y cierre

- [ ] T42 · adversarial · Ataque de la 007b (número de operación con espacios, ceros, mayúsculas y ancho completo;
  aprobar dos veces o un rechazado; caja de otro día; `HEAD` y archivos; token y aislamiento; último cupo en el
  reintento; fin de mes)
- [ ] T43 · especificador · Criterios nuevos de cada falla, con su origen
- [ ] T44 · revisor · Comparar con la spec; `git diff` de las pruebas protegidas
- [ ] T45 · tester · Suite completa, lint y tipos
- [ ] T46 · documentador · Documentación y `specs/backlog.md`; commit (criterio 57)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo (007a)
- [ ] Pruebas en verde tras la implementación (007a)
- [ ] Ataque adversarial sin fallas abiertas (007a)
- [ ] Pruebas escritas por test-writer y confirmadas en rojo (007b)
- [ ] Pruebas en verde tras la implementación (007b)
- [ ] Ataque adversarial sin fallas abiertas (007b)
