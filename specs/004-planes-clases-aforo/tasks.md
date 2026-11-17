# 004 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia en parte crítica:
los criterios 1 a 7, 10, 18, 22 y 23 llevan pruebas protegidas escritas y confirmadas en rojo antes de implementar (T1
a T4) y ataque adversarial después (T13). Los demás llevan las pruebas que indica cada tarea, escritas por quien
implementa. No se empieza T1 sin la aprobación del responsable.

## Aprobación

- [ ] T0 · responsable y orquestador · Aprobar la especificación y resolver las preguntas N1 a N8 (Bryan) y T1 a T5
      (orquestador). Si alguna respuesta cambia un valor provisional (N1, N3, N4, N6, N8), el especificador ajusta los
      criterios afectados antes de T1. Si se aprueba T1, el orquestador suma a la nota de la 005 en `specs/backlog.md`
      la ocupación, el último cupo simultáneo y la advertencia de N5.

## Pruebas protegidas (en rojo)

- [ ] T1 · test-writer · Utilidad `backend/test/utilidades/planes-clases.ts` (crear planes, clases y entrenadores en
      una academia; escribir filas como dueño de las tablas, también inválidas). Pruebas protegidas de las tablas, el
      catálogo, la llave compuesta, los `CHECK`, RLS y los privilegios de `planes` y `clases`; actualización de las
      pruebas protegidas de 001 que comparan la lista exacta de privilegios (y de `scripts/` si las hay) para sumar las
      de `planes` y `clases`, sin quitar nada (criterios 1 a 4)
- [ ] T2 · test-writer · Pruebas protegidas de las seis rutas: permisos por rol, sin sesión, cambio obligatorio,
      academia suspendida y cookie del Superadmin; aislamiento por id, por cuerpo, por parámetro de consulta y por
      `entrenadorId` de otra academia; carrera determinista del actor vigente en `POST /api/planes` y
      `PATCH /api/clases/{id}` (criterios 5 a 7)
- [ ] T3 · test-writer · Pruebas protegidas del precio y las clases por mes (unitarias de `montoSchema` y de
      integración con ida y vuelta exacta), del aforo de 20 a 50 al crear y editar, de la espera del `PATCH` tras el
      bloqueo de la clase (casos a, b y c del criterio 22) y de `bloquearClasesParaCupo` (academia, ids ajenos o
      repetidos, lista vacía, órdenes cruzados sin `40P01`) (criterios 10, 18, 22, 23)
- [ ] T4 · tester · Confirmar que T1 a T3 fallan por falta de la funcionalidad (tablas, rutas, esquemas o funciones
      inexistentes) y no por sintaxis, importaciones o configuración; y que las pruebas protegidas de 001, 002 y 003
      que no se tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba. Commit
      del orquestador: "Pruebas protegidas (004): planes y clases, aislamiento, permisos y aforo (en rojo)"

## Implementación

- [ ] T5 · backend · Contratos `horario.ts`, `dinero.ts`, `planes.ts` y `clases.ts` con pruebas unitarias de sus
      bordes (bloques, fechas reales, montos, arreglos sin repetidos, reglas cruzadas del `POST`) (criterios 8 a 10,
      17, 18)
- [ ] T6 · backend · `schema.prisma`, migración `<marca>_planes_clases` (tipo, tablas, `CHECK`, índices, RLS,
      políticas, privilegios), `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` en el mismo
      cambio; `date-fns` y `@date-fns/tz` en el backend (criterios 1 a 4)
- [ ] T7 · backend · `comun/fechas/lima.ts` (`hoyEnLima`) y `comun/dinero` con pruebas unitarias (bordes de Lima, otra
      zona del proceso, montos sin `number`); dominio de planes (`normalizarPlan`, reglas cruzadas, cambios pedidos,
      `estadoDelPlan`) con pruebas unitarias (criterios 10, 12, 14)
- [ ] T8 · backend · `PlanesModule`: `GET`, `POST` y `PATCH /api/planes`, con `bloquearActorVigente`, `FOR UPDATE` del
      plan, nombre único con `ON CONFLICT`, auditoría y 409 sin 500 en las carreras; pruebas de integración no
      protegidas de creación, validación, nombre único simultáneo, edición, idempotencia, auditorías encadenadas,
      activar y desactivar, `DELETE` sin ruta y orden de la lista (criterios 8, 9, 11 a 13, 15)
- [ ] T9 · backend · `ClasesModule` y `cupo.ts` (`bloquearClasesParaCupo`): `GET`, `POST` y `PATCH /api/clases`, con
      entrenador válido, choques del bloque por índices parciales, reactivación, auditoría y 409 sin 500 en las
      carreras; pruebas de integración no protegidas de creación, bloques, entrenador (cuatro casos), choques y
      creaciones simultáneas, edición, lista y entrenador desactivado (criterios 16, 17, 19 a 21, 24, 25)
- [ ] T10 · backend · Semilla: segundo entrenador, planes y clases de `delfines`, repetible (criterio 30)
- [ ] T11 · frontend · `/panel/planes` y `/panel/clases` (grilla semanal), opciones del inicio, formularios con la base
      de llenado, `fieldset` desactivado al guardar y claves con la identidad de la sesión; `lib/dinero.ts`; pruebas de
      componentes (criterios 26 a 29)
- [ ] T12 · tester · Pruebas protegidas en verde y suite completa

## Ataque

- [ ] T13 · adversarial · Atacar los criterios críticos con la spec y el código (sin el razonamiento de quien
      implementó): leer o cambiar planes y clases de otra academia (ids, campos de más, parámetros de consulta,
      `entrenadorId` de otra academia, escrituras directas que se salten RLS o la llave compuesta); roles sin permiso,
      cambio obligatorio pendiente, academia suspendida, administrador desactivado o con la sesión cerrada mientras
      guarda; aforo en los bordes y con JSON raro (`2e1`, `20.0`, `-0`, números enormes, textos); precio con coma
      flotante, ceros, notación científica, espacios y Unicode, y clases por mes en cero; cambios de aforo simultáneos
      y cruzados con una transacción que bloquea la clase; `bloquearClasesParaCupo` con órdenes cruzados; carreras
      entre crear clases, reasignar entrenadores y desactivar entrenadores o administradores (interbloqueos, 500);
      bloques en el borde (la clase de 19:00 a 20:00, `20:00`, horas con segundos) y estado del plan en el cambio de
      día, de mes y con el servidor en otra zona. Por cada falla: el especificador agrega el criterio a `spec.md`,
      test-writer la prueba protegida en rojo, se corrige y se vuelve a atacar, hasta una ronda sin fallas

## Revisión y cierre

- [ ] T14 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T15 · revisor · Comparar con la spec, las reglas de `docs/arquitectura.md` (DT-5 de 002, `@Permiso`, `await` en
      cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles, montos sin `number`, fechas
      en Lima, orden de bloqueos) y las convenciones; verificar la semilla y la documentación (criterios 30 y 31)
- [ ] T16 · tester · Suite completa, lint y verificación de tipos
- [ ] T17 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (tablas, `bloquearClasesParaCupo` y las
      reglas para las historias siguientes de la spec), `README.md` y guía de uso (criterio 31)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
