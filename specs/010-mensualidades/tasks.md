# 010 · Tareas

Cada tarea indica su rol y los criterios de aceptación que cubre. Las de la 010b empiezan con la 010a unida a `main`, y
las de la 010c, con la 010b unida.

## Aprobación

- [x] T0 · orquestador y responsable · Aprobar la spec, responder P1 a P11 (Bryan), aceptar DT-1 a DT-21 (orquestador) y
  aprobar A1 y A2 (Bryan). **Hecho (26/11/2026):** Bryan aprobó la spec, las propuestas de P1 a P11 (DR-1 a DR-11) y
  A1 y A2; el orquestador aceptó DT-1 a DT-21 y la partición en 010a, 010b, 010c y 010d. Por DR-10, el orquestador
  anota la 010d en `specs/backlog.md`.

## 010a · Renovación con prioridad

- [x] T1 · test-writer · Pruebas protegidas del modelo (`CHECK matriculas_renovacion_sin_vencimiento`, como app y como
  dueño) (criterio 1) _(`a232b10`)_
- [x] T2 · test-writer · Pruebas protegidas del registro: mes y ventana con `RELOJ` y `TZ=Asia/Tokyo`, monto y redondeo,
  efectivo con caja abierta, cerrada y de otro día, comprobante (orden de comprobaciones, cabecera, imagen, monto,
  número de operación, fecha, archivo borrado o conservado), orden de los errores, idempotencia y choques por nombre de
  restricción (criterios 3, 5 a 8 y 12) _(`a232b10`)_
- [x] T3 · test-writer · Pruebas protegidas de prioridad y concurrencia: titulares y no titulares, día 1, aforo reducido,
  último cupo simultáneo, `[c1, c2]` y `[c2, c1]`, orden de bloqueos sin `40P01` (criterios 9, 10 y 13) _(`a232b10`)_
- [x] T4 · test-writer · Pruebas protegidas de bandeja, aprobación, rechazo, correos, estado del alumno, asistencia con
  la renovación en verificación, permisos, aislamiento y auditoría (criterios 14 a 19) _(`a232b10`)_
- [x] T5 · tester · Confirmar que T1 a T4 fallan por la razón esperada; commit «Pruebas protegidas (010): 010a, … (en
  rojo)» _(`a232b10`; con los ajustes `afb2a10`, fixtures de la 005 por el CHECK, y `1f4e1be`, dos pruebas de la renovación)_
- [x] T6 · backend · Contratos `packages/contratos/src/mensualidades.ts` y `solicitud` nula en `pagoPendienteSchema`
  (criterios 2, 5 a 7, 11 y 14) _(`2daeb29`)_
- [x] T7 · backend · Migración `<marca>_renovaciones` y `schema.prisma` (criterio 1) _(`62f0014`, con la migración
  `20261126140000_renovaciones`)_
- [x] T8 · backend · Dominio puro: `ventana.ts`, `cotizacion.ts` y `cupo.ts`, con sus pruebas unitarias (criterios 3, 5,
  9 y 21) _(`783197c`)_
- [x] T9 · backend · `contarReservasDePrioridad` en `matriculas/ocupacion.ts` (criterio 9) _(`783197c`)_
- [x] T10 · backend · Módulo `mensualidades/`: oferta, cotización y renovación en efectivo; paso a `ALUMNO_ACTIVO` en
  `confirmarPagoEnTransaccion`; `PREFIJOS_SIN_HEAD` (criterios 2 a 6, 8 a 13, 17 a 19) _(`50d8779`)_
- [x] T11 · backend · Renovación con comprobante, reutilizando el lector binario, la recodificación y la relectura
  (criterios 7, 8 y 12) _(`50d8779`)_
- [x] T12 · backend · Bandeja con `LEFT JOIN`, avisos de renovación al aprobar y al rechazar (criterios 14 y 15)
  _(`eb258c2`)_
- [x] T13 · frontend · Sección «Mensualidad» y diálogo «Renovar» en `/panel/alumnos/{id}`; textos de la bandeja;
  pruebas de componentes (criterios 20 y 22) _(`c7021eb`)_
- [x] T14 · adversarial · Ataque de la 010a (hasta 3 rondas, D-31; registro en `rondas.md`) _(cerrado en 2 de 3 rondas,
  26/11/2026)_
  - [x] Ronda 1 (26/11/2026): R1-1, alta, pasa a ser el criterio 44. Ajustes de pruebas protegidas en `8f80c9a`.
  - [x] T36 · test-writer · Prueba protegida en rojo de la ronda 1: más titulares que lugares en el mes siguiente, con
    los casos a (renovación tardía), b (Yape rechazado), c (aforo bajado), d (dos titulares a la vez por el último lugar),
    la oferta de un titular y de un no titular, y la ocupación final sin pasar del aforo; el tester confirma el rojo y
    se hace el commit «Pruebas protegidas (010): 010a, ronda 1 … (en rojo)» (criterio 44) _(`f83439f`)_
  - [x] T37 · backend · Corrección de R1-1: en `mensualidades/dominio/cupo.ts`, `cupoLibre` sin restar las reservas al
    titular en el mes siguiente (`aforo − ocupación`) y con `aforo − ocupación − reservas` para el no titular; la oferta
    (`cuposRestantes` en `renovacion.service.ts`) y el registro (`nucleo.ts`) la usan sin cambios de firma; se actualizan
    las pruebas unitarias de `cupo.test.ts` que fijan la fórmula original y el comentario de `cupo.ts` (criterios 2, 9 y
    44) _(`a018732`)_
  - [x] Ronda 2 (26/11/2026): R2-1, media; Bryan decidió cambiar la regla (DR-12) y pasa a ser el criterio 45.
  - [x] T38 · test-writer · Prueba protegida en rojo de la ronda 2: la matrícula de M en verificación no da prioridad,
    con los casos a (Y no es titular: oferta con `conPrioridad: false` y `cuposRestantes` 0, `SIN_CUPO` sin escribir
    nada, rechazo del Yape y los 18 titulares con 201), b (al aprobar el pago de M, Y es titular: oferta con 18, 201 y
    los primeros 17 titulares con 201 y el último `SIN_CUPO`) y c (una renovación de M+1 en verificación ocupa cupo y
    deja de contar como reserva), con la ocupación de noviembre y diciembre sin pasar del aforo. Si Bryan aprueba A3
    (P12), en el mismo commit reescribe el caso del criterio 9 «titular en verificación» de `renovacion-prioridad.test.ts`
    con la regla nueva, con la nota en la cabecera, y corrige los comentarios que citan la regla anterior (cabecera de
    ese archivo y `sembrarTitulares` en `escenario-renovacion.ts`). El tester confirma el rojo y se hace el commit
    «Pruebas protegidas (010): 010a, ronda 2 … (en rojo)» (criterios 9 y 45) _(`c98f159`, con el ajuste A3 del criterio 9)_
  - [x] T39 · backend · Corrección de R2-1: en `mensualidades/lectura.ts`, `clasesDeLaTitularidad` toma solo la
    matrícula de M `VIGENTE` (sin la `RESERVADA` sin vencimiento), y en `matriculas/ocupacion.ts`,
    `contarReservasDePrioridad` usa la misma condición; se actualizan sus comentarios (D-06, DT-3, DR-12). Sin cambios de
    firma en la oferta ni en el registro (criterios 2, 9 y 45) _(`a87d940`)_
- [x] T15 · revisor y tester (a la vez) · Revisión contra la spec; suite completa, lint y tipos _(sobre `8f80c9a`: sin
  bloqueantes; 18 335 pasan, 1 falla intermitente, en la deuda, y 95 se saltan; E2E 6 de 6; la suite final sobre el HEAD
  la corre la CI del PR)_
- [x] T16 · documentador · `docs/arquitectura.md`, guía de Windows y nota del backlog de la 010a; marcar tareas
  (criterio 23) _(este commit, el de cierre)_

## 010b · Estados de la mensualidad y cierre de mes

- [ ] T17 · test-writer · Pruebas protegidas del cierre: academias activas y suspendidas, bloqueo consultivo, error
  aislado, matrículas y estado del alumno, bordes de Lima, Yape aprobado tarde, faltas con la matrícula finalizada,
  concurrencia sin `40P01` (criterios 27 a 29)
- [ ] T18 · test-writer · Pruebas protegidas de permisos y aislamiento del listado (criterio 26); ajuste aprobado (A1)
  de la prueba del criterio 33 de 009 (criterio 30)
- [ ] T19 · tester · Confirmar el rojo de T17 y T18; commit «Pruebas protegidas (010): 010b, … (en rojo)»
- [ ] T20 · backend · `estado.ts` con sus pruebas unitarias; listado `GET /api/mensualidades` (criterios 24 a 26)
- [ ] T21 · backend · `CierreDeMesService` y `CierreDeMesTarea` en el módulo condicionado por `TAREAS_PROGRAMADAS`
  (criterios 27 a 30)
- [ ] T22 · frontend · `/panel/mensualidades` y el estado en `/panel/alumnos/{id}`; pruebas de componentes (criterios 31
  y 32)
- [ ] T23 · adversarial · Ataque de la 010b (hasta 3 rondas)
- [ ] T24 · revisor y tester (a la vez) · Revisión; suite completa, lint y tipos
- [ ] T25 · documentador · `docs/arquitectura.md`, `.env.example` y nota del backlog; marcar tareas (criterio 33)

## 010c · Cambio de horario

- [ ] T26 · test-writer · Pruebas protegidas del modelo (`agregada_en`, política y privilegio de `DELETE`, trigger) y
  ajuste aprobado (A2) de las pruebas de los criterios 1 y 2 de 005 (criterio 34)
- [ ] T27 · test-writer · Pruebas protegidas del cambio: matrículas que se pueden cambiar, cupo y último cupo,
  asistencia y faltas después del cambio con `RELOJ`, orden de bloqueos, auditoría, permisos y aislamiento (criterios 35,
  36 y 38 a 41)
- [ ] T28 · tester · Confirmar el rojo de T26 y T27; commit «Pruebas protegidas (010): 010c, … (en rojo)»
- [ ] T29 · backend · Migración `<marca>_cambio_horario`, `schema.prisma`, `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs`
  (criterio 34)
- [ ] T30 · backend · `HorarioService` y su ruta; `agregada_en` en el marcado, el registro posterior y la tarea de faltas
  (criterios 35 a 41)
- [ ] T31 · frontend · «Cambiar horario» en `/panel/alumnos/{id}`; pruebas de componentes (criterio 42)
- [ ] T32 · adversarial · Ataque de la 010c (hasta 3 rondas)
- [ ] T33 · revisor y tester (a la vez) · Revisión; suite completa, lint y tipos
- [ ] T34 · documentador · `docs/arquitectura.md`, guía de Windows y nota del backlog; marcar tareas (criterio 43)

## Solo ruta crítica

- [x] 010a: pruebas escritas por test-writer y confirmadas en rojo _(`a232b10`, `f83439f` y `c98f159`)_
- [x] 010a: pruebas en verde tras la implementación _(sobre `8f80c9a`, en T15: la única falla fue
  `asistencia/idempotencia.test.ts`, intermitente por la carga y en la deuda; la suite final sobre el HEAD la corre la CI
  del PR)_
- [x] 010a: ataque adversarial sin fallas críticas ni altas abiertas _(dos rondas, 26/11/2026: R1-1 en el criterio 44 y
  R2-1 en el 45)_
- [ ] 010b: pruebas escritas por test-writer y confirmadas en rojo
- [ ] 010b: pruebas en verde tras la implementación
- [ ] 010b: ataque adversarial sin fallas críticas ni altas abiertas
- [ ] 010c: pruebas escritas por test-writer y confirmadas en rojo
- [ ] 010c: pruebas en verde tras la implementación
- [ ] 010c: ataque adversarial sin fallas críticas ni altas abiertas

## 010d · Inscripción pública al mes siguiente (DR-10)

- [ ] T35 · especificador · Agregar a `spec.md` los criterios de la 010d, con la 010c unida, y sus tareas a este archivo
