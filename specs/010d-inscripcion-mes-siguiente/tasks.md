# 010d · Tareas

Cada tarea indica su rol y los criterios que cubre. Empiezan con la 010c unida a `main` y la spec aprobada por Bryan
(P1 a P5). Los commits de pruebas protegidas dicen «Pruebas protegidas (010d): … (en rojo)», y las pruebas llevan al
inicio `// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)`.

## Aprobación

- [ ] T0 · orquestador y responsable · Bryan responde P1 a P5; el orquestador acepta DT-1 a DT-13. Si P2 no es la
  propuesta, el especificador ajusta los criterios 9 y 11 y DT-10 antes de T1.

## Pruebas protegidas

- [ ] T1 · test-writer · Antes de escribir, comprobar que ninguna prueba protegida existente fija lo que cambia: las del
  criterio 6 de 005 (`lectura-publica.test.ts`, claves sin `mes`), las que esperan `MES_CAMBIO` con `2026-12` (que corran
  fuera de la ventana), `reserva-protegido.test.ts`, las de la 007b con `PAGO_RECHAZADO` y las del cierre de la 010b
  (ninguna con un `ALUMNO_ACTIVO` que solo tiene la matrícula `VIGENTE` de M+1). Si alguna lo fija, parar y avisar al
  orquestador (no se toca sin aprobación). (Impacto en especificaciones anteriores)
- [ ] T2 · test-writer · Meses, formulario y cotización: `/inscripcion/meses` con `RELOJ`, `TZ=Asia/Tokyo`, N = 5 y 15,
  cambio de año y `PATCH` de la configuración; `GET …/inscripcion?mes=` (M+1 con cupos y reservas, mes no permitido,
  `mes` mal escrito o repetido, sin `mes` igual que antes); cotización de M+1 con los ejemplos de D-03 (criterios 1 a 3)
- [ ] T3 · test-writer · Envío para M+1 y bordes de la ventana: matrícula, vencimiento de la reserva (también cruzando el
  día 1 y el cambio de año), auditoría, correo, `MES_CAMBIO`, `MONTO_CAMBIO`, plan del día 1 (criterios 4 y 5)
- [ ] T4 · test-writer · Aforo y concurrencia: solo cupos libres, vencimiento de una reserva, renovación de los titulares,
  el día 1, aforo bajado; los seis escenarios simultáneos con espera en `pg_locks`; orden de bloqueos sin `40P01`
  (criterios 6 a 8)
- [ ] T5 · test-writer · Pago, rechazo y nuevo comprobante: efectivo con y sin caja, Yape aprobado antes y después del día
  1, `estadoVisible` y `estadoVisibleSql` (unitarias y lista del panel), cupo con reservas tras un rechazo (criterios 9 y
  10)
- [ ] T6 · test-writer · Cierre de mes y asistencia del alumno nuevo antes del día 1; aislamiento entre A y B; límites
  por conexión y registro técnico; inscripción de recepción (criterios 11 a 15)
- [ ] T7 · tester · Confirmar que T2 a T6 fallan por la razón esperada; commit «Pruebas protegidas (010d): … (en rojo)»

## Implementación

- [ ] T8 · backend · Contratos: `mesesInscripcionSchema`, `consultaFormularioSchema` y `mes` opcional en
  `cotizarInscripcionSchema`, con sus pruebas (criterio 16)
- [ ] T9 · backend · `vencimientoDeReservaDelMes` en `matriculas/dominio/reserva.ts` con pruebas unitarias;
  `cuposParaInscripcionNueva` en `matriculas/cupo-para-nuevos.ts` (DT-7, DT-8; criterios 4 y 6)
- [ ] T10 · backend · `InscripcionesService`: `leerMeses` y su ruta; `leerFormulario` con `?mes=`; `cotizar` y el envío
  con el mes de inscripción; regla `lectura` de `/inscripcion/meses` (criterios 1 a 8, 13 a 15; DT-2 a DT-6, DT-11, DT-13)
- [ ] T11 · backend · `estadoVisible`, `estadoVisibleSql` y `exigirCupoDeLaMatricula` (criterios 9 y 10; DT-9)
- [ ] T12 · backend · Regla del cierre de mes para `ALUMNO_ACTIVO` con matrícula `VIGENTE` de M+1, si P2 es la propuesta
  (criterios 11 y 12; DT-10)
- [ ] T13 · frontend · Paso «¿Desde cuándo?», oferta y cotización por mes, resumen y confirmación con el mes, aviso de
  apertura (P4), `MES_CAMBIO`; simulacros de `/meses` en `Inscripcion.test.tsx`; pruebas de componentes (criterio 17)
- [ ] T14 · frontend · El mes de la inscripción en el seguimiento, la lista de solicitudes y la bandeja; pruebas de
  componentes (criterio 18)

## Ataque, revisión y cierre

- [ ] T15 · adversarial · Ataque de la 010d (hasta 3 rondas, D-31; registro en `rondas.md`): bordes de la ventana en
  Lima y con otra zona del proceso, último lugar simultáneo entre envíos, renovaciones y cambios de horario, reservas que
  cruzan el día 1, rechazo y nuevo comprobante, cierre de mes, aislamiento entre academias y límites públicos
- [ ] T16 · revisor y tester (a la vez) · Revisión contra la spec (incluidos los ciclos de importación del plan); suite
  completa, lint y tipos. Antes, el orquestador revisa con `git diff` que ningún commit de implementación tocó las
  pruebas protegidas
- [ ] T17 · documentador · `docs/arquitectura.md`, guía de Windows y nota de la 010 en `specs/backlog.md`; marcar estas
  tareas y T35 de `specs/010-mensualidades/tasks.md` (criterio 19)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas críticas ni altas abiertas
