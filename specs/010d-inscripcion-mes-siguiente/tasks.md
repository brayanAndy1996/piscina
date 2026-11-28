# 010d · Tareas

Cada tarea indica su rol y los criterios que cubre. Empiezan con la 010c unida a `main` y la spec aprobada por Bryan
(P1 a P5). Los commits de pruebas protegidas dicen «Pruebas protegidas (010): 010d, … (en rojo)», y las pruebas llevan al
inicio `// spec: 010-mensualidades (pruebas protegidas)`.

## Aprobación

- [x] T0 · orquestador y responsable · Bryan responde P1 a P5; el orquestador acepta DT-1 a DT-13. **Hecho
  (27/11/2026):** Bryan aprobó la propuesta de las cinco (DR-1 a DR-5 de `spec.md`) y el orquestador aceptó DT-1 a DT-13.

## Pruebas protegidas

- [x] T1 · test-writer · Antes de escribir, comprobar que ninguna prueba protegida existente fija lo que cambia: las del
  criterio 6 de 005 (`lectura-publica.test.ts`, claves sin `mes`), las que esperan `MES_CAMBIO` con `2026-12` (que corran
  fuera de la ventana), `reserva-protegido.test.ts`, las de la 007b con `PAGO_RECHAZADO` y las del cierre de la 010b
  (ninguna con un `ALUMNO_ACTIVO` que solo tiene la matrícula `VIGENTE` de M+1). Si alguna lo fija, parar y avisar al
  orquestador (no se toca sin aprobación). (Impacto en especificaciones anteriores)
  _(Hecha antes de escribir, sin commit propio. Ninguna prueba protegida de 005, 007b ni 010b cambió en la 010d; lo que
  fijaban llevó a DT-2 (claves del `GET` sin `mes`) y DT-4 (`MES_CAMBIO` con `2026-12`) del plan.)_
- [x] T2 · test-writer · Meses, formulario y cotización: `/inscripcion/meses` con `RELOJ`, `TZ=Asia/Tokyo`, N = 5 y 15,
  cambio de año y `PATCH` de la configuración; `GET …/inscripcion?mes=` (M+1 con cupos y reservas, mes no permitido,
  `mes` mal escrito o repetido, sin `mes` igual que antes); cotización de M+1 con los ejemplos de D-03 (criterios 1 a 3)
  _(`ecf26b8`)_
- [x] T3 · test-writer · Envío para M+1 y bordes de la ventana: matrícula, vencimiento de la reserva (también cruzando el
  día 1 y el cambio de año), auditoría, correo, `MES_CAMBIO`, `MONTO_CAMBIO`, plan del día 1 (criterios 4 y 5)
  _(`ecf26b8`)_
- [x] T4 · test-writer · Aforo y concurrencia: solo cupos libres, vencimiento de una reserva, renovación de los titulares,
  el día 1, aforo bajado; los seis escenarios simultáneos con espera en `pg_locks`; orden de bloqueos sin `40P01`
  (criterios 6 a 8)
  _(`ecf26b8`; `75e131a` ajustó la prueba de concurrencia, ver T7)_
- [x] T5 · test-writer · Pago, rechazo y nuevo comprobante: efectivo con y sin caja, Yape aprobado antes y después del día
  1, `estadoVisible` y `estadoVisibleSql` (unitarias y lista del panel), cupo con reservas tras un rechazo (criterios 9 y
  10)
  _(`ecf26b8`)_
- [x] T6 · test-writer · Cierre de mes y asistencia del alumno nuevo antes del día 1; aislamiento entre A y B; límites
  por conexión y registro técnico; inscripción de recepción (criterios 11 a 15)
  _(`ecf26b8`; `75e131a` corrigió las de límites, recepción y registro técnico, ver T7)_
- [x] T7 · tester · Confirmar que T2 a T6 fallan por la razón esperada; commit «Pruebas protegidas (010): 010d, … (en rojo)»
  _(`ecf26b8`, en rojo. `be99194`, marca de la historia 010 para que el verificador proteja estos archivos (DT-15).
  `75e131a`, después de la implementación del backend, corrigió tres pruebas protegidas (límite por conexión, caja del día
  y registro técnico) en cuatro archivos, y una carrera de la prueba del cambio de horario; el registro técnico pasó a
  `mes-siguiente-registro-tecnico.test.ts` con las mismas aserciones.)_

## Implementación

- [x] T8 · backend · Contratos: `mesesInscripcionSchema`, `consultaFormularioSchema` y `mes` opcional en
  `cotizarInscripcionSchema`, con sus pruebas (criterio 16)
  _(`c82838a`)_
- [x] T9 · backend · `vencimientoDeReservaDelMes` en `matriculas/dominio/reserva.ts` con pruebas unitarias;
  `cuposParaInscripcionNueva` en `matriculas/cupo-para-nuevos.ts` (DT-7, DT-8; criterios 4 y 6)
  _(`700a840`)_
- [x] T10 · backend · `InscripcionesService`: `leerMeses` y su ruta; `leerFormulario` con `?mes=`; `cotizar` y el envío
  con el mes de inscripción; regla `lectura` de `/inscripcion/meses` (criterios 1 a 8, 13 a 15; DT-2 a DT-6, DT-11, DT-13)
  _(`700a840`)_
- [x] T11 · backend · `estadoVisible`, `estadoVisibleSql` y `exigirCupoDeLaMatricula` (criterios 9 y 10; DT-9)
  _(`700a840`)_
- [x] T12 · backend · Regla del cierre de mes para `ALUMNO_ACTIVO` con matrícula `VIGENTE` de M+1 (DR-2)
  (criterios 11 y 12; DT-10)
  _(`700a840`)_
- [x] T13 · frontend · Paso «¿Desde cuándo?», oferta y cotización por mes, resumen y confirmación con el mes, aviso de
  apertura (DR-4), `MES_CAMBIO`; simulacros de `/meses` en `Inscripcion.test.tsx`; pruebas de componentes (criterio 17)
  _(`c8c76db`)_
- [x] T14 · frontend · El mes de la inscripción en el seguimiento, la lista de solicitudes y la bandeja; pruebas de
  componentes (criterio 18)
  _(`c8c76db`)_

## Ataque, revisión y cierre

- [x] T15 · adversarial · Ataque de la 010d (hasta 3 rondas, D-31; registro en `rondas.md`): bordes de la ventana en
  Lima y con otra zona del proceso, último lugar simultáneo entre envíos, renovaciones y cambios de horario, reservas que
  cruzan el día 1, rechazo y nuevo comprobante, cierre de mes, aislamiento entre academias y límites públicos
  _(ronda 1, 28/11/2026, sin fallas de ninguna severidad; el registro está en `rondas.md`)_
- [x] T16 · revisor y tester (a la vez) · Revisión contra la spec (incluidos los ciclos de importación del plan); suite
  completa, lint y tipos. Antes, el orquestador revisa con `git diff` que ningún commit de implementación tocó las
  pruebas protegidas
  _(revisión: sin fallas importantes; seis menores corregidos en `dfe93bc` (backend) y `b081d2f` (web). Suite completa: 19 223
  pasan, 0 fallan y 95 se saltan (privilegios o plataforma; la CI las corre); e2e, 6 de 6; lint, tipos y build en verde)_
- [x] T17 · documentador · `docs/arquitectura.md`, guía de Windows y nota de la 010 en `specs/backlog.md`; marcar estas
  tareas y T35 de `specs/010-mensualidades/tasks.md` (criterio 19)
  _(este commit, el de cierre)_

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo _(`ecf26b8` (en rojo), `be99194` (marca) y `75e131a` (tres
  pruebas protegidas corregidas después de la implementación del backend; ver T7))_
- [x] Pruebas en verde tras la implementación _(`c82838a`, `700a840` y `c8c76db`; limpieza de la revisión en `dfe93bc` y
  `b081d2f`; suite completa de 19 223 pasan, 0 fallan y 95 se saltan; e2e 6 de 6)_
- [x] Ataque adversarial sin fallas críticas ni altas abiertas _(una ronda, 28/11/2026, sin fallas; ver `rondas.md`)_
