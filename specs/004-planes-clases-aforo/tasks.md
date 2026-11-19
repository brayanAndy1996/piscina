# 004 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia en parte crítica:
los criterios 1 a 7, 10, 18, 22, 23 y, desde la ronda 1 adversarial, 32 y 33 (T13a a T13c) llevan pruebas protegidas escritas y confirmadas en rojo antes de implementar (T1
a T4) y ataque adversarial después (T13). Los demás llevan las pruebas que indica cada tarea, escritas por quien
implementa. No se empieza T1 sin la aprobación del responsable (dada el 17/11/2026, T0).

## Aprobación

- [x] T0 · responsable y orquestador · Aprobar la especificación y resolver las preguntas N1 a N8 (Bryan) y T1 a T5
      (orquestador). Si alguna respuesta cambia un valor provisional (N1, N3, N4, N6, N8), el especificador ajusta los
      criterios afectados antes de T1. Si se aprueba T1, el orquestador suma a la nota de la 005 en `specs/backlog.md`
      la ocupación, el último cupo simultáneo y la advertencia de N5.
      **Hecho (17/11/2026):** Bryan aprobó la spec y las propuestas de N1 a N8 ("Estoy de acuerdo con tus
      sugerencias"; DR-1 a DR-8 de 004) y el orquestador las de T1 a T5 (DT-1 a DT-5 de 004). Ningún valor provisional
      cambió, así que ningún criterio cambió. La nota de la 005 en `specs/backlog.md` ya suma la ocupación, la reserva
      de cupos, el último cupo simultáneo con `bloquearClasesParaCupo` y lo de DR-5; la 004 pasó a 🟨.

## Pruebas protegidas (en rojo)

- [x] T1 · test-writer · Utilidad `backend/test/utilidades/planes-clases.ts` (crear planes, clases y entrenadores en
      una academia; escribir filas como dueño de las tablas, también inválidas). Pruebas protegidas de las tablas, el
      catálogo, la llave compuesta, los `CHECK`, RLS y los privilegios de `planes` y `clases`; actualización de las
      pruebas protegidas de 001 que comparan la lista exacta de privilegios (y de `scripts/` si las hay) para sumar las
      de `planes` y `clases`, sin quitar nada (criterios 1 a 4)
- [x] T2 · test-writer · Pruebas protegidas de las seis rutas: permisos por rol, sin sesión, cambio obligatorio,
      academia suspendida y cookie del Superadmin; aislamiento por id, por cuerpo, por parámetro de consulta y por
      `entrenadorId` de otra academia; carrera determinista del actor vigente en `POST /api/planes` y
      `PATCH /api/clases/{id}` (criterios 5 a 7)
- [x] T3 · test-writer · Pruebas protegidas del precio y las clases por mes (unitarias de `montoSchema` y de
      integración con ida y vuelta exacta), del aforo de 20 a 50 al crear y editar, de la espera del `PATCH` tras el
      bloqueo de la clase (casos a, b y c del criterio 22) y de `bloquearClasesParaCupo` (academia, ids ajenos o
      repetidos, lista vacía, órdenes cruzados sin `40P01`) (criterios 10, 18, 22, 23)
- [x] T4 · tester · Confirmar que T1 a T3 fallan por falta de la funcionalidad (tablas, rutas, esquemas o funciones
      inexistentes) y no por sintaxis, importaciones o configuración; y que las pruebas protegidas de 001, 002 y 003
      que no se tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba. Commit
      del orquestador: "Pruebas protegidas (004): planes y clases, aislamiento, permisos y aforo (en rojo)"
- [x] T4a · test-writer · Actualizar la prueba protegida de la semilla de 002 (criterio 45,
      `backend/test/integracion/semilla/semilla-usuarios.test.ts`) para el segundo entrenador del criterio 30: 5
      usuarios en `delfines`, 6 en total, dos `ENTRENADOR` (`10000003` y `10000005`), sin quitar nada de lo que
      comprueba. Commit propio "Pruebas protegidas (004): …", antes de la parte pendiente de T10 (AT-5 de 004)

## Implementación

_T5 a T9: hechas en el commit be7170a (backend). T10: hecha en 46a15fb (el segundo entrenador). T11 (web): hecha en
e31f878. Ajustes técnicos de la implementación en la spec, AT-1 a AT-5 de 004 ("Decisiones")._

- [x] T5 · backend · Contratos `horario.ts`, `dinero.ts`, `planes.ts` y `clases.ts` con pruebas unitarias de sus
      bordes (bloques, fechas reales, montos, arreglos sin repetidos, reglas cruzadas del `POST`) (criterios 8 a 10,
      17, 18) _(campo de los errores de los arreglos con índice: AT-4)_
- [x] T6 · backend · `schema.prisma`, migración `<marca>_planes_clases` (tipo, tablas, `CHECK`, índices, RLS,
      políticas, privilegios), `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` en el mismo
      cambio; `date-fns` y `@date-fns/tz` en el backend (criterios 1 a 4) _(también en
      `scripts/lib/dependencias-backend.mjs`, criterio 127 de 001: AT-3)_
- [x] T7 · backend · `comun/fechas/lima.ts` (`hoyEnLima`) y `comun/dinero` con pruebas unitarias (bordes de Lima, otra
      zona del proceso, montos sin `number`); dominio de planes (`normalizarPlan`, reglas cruzadas, cambios pedidos,
      `estadoDelPlan`) con pruebas unitarias (criterios 10, 12, 14)
- [x] T8 · backend · `PlanesModule`: `GET`, `POST` y `PATCH /api/planes`, con `bloquearActorVigente`, `FOR UPDATE` del
      plan, nombre único con `ON CONFLICT`, auditoría y 409 sin 500 en las carreras; pruebas de integración no
      protegidas de creación, validación, nombre único simultáneo, edición, idempotencia, auditorías encadenadas,
      activar y desactivar, `DELETE` sin ruta y orden de la lista (criterios 8, 9, 11 a 13, 15) _(id del `PATCH`
      validado en el servicio: AT-2)_
- [x] T9 · backend · `ClasesModule` y `cupo.ts` (`bloquearClasesParaCupo`): `GET`, `POST` y `PATCH /api/clases`, con
      entrenador válido, choques del bloque por índices parciales, reactivación, auditoría y 409 sin 500 en las
      carreras; pruebas de integración no protegidas de creación, bloques, entrenador (cuatro casos), choques y
      creaciones simultáneas, edición, lista y entrenador desactivado (criterios 16, 17, 19 a 21, 24, 25) _(entrenador
      bloqueado junto con el actor al crear o reasignar, con su prueba no protegida
      `backend/test/integracion/planes-clases/clases-interbloqueo.test.ts`: AT-1; id del `PATCH` en el servicio: AT-2)_
- [x] T10 · backend · Semilla: segundo entrenador, planes y clases de `delfines`, repetible (criterio 30) _(hecha: planes
      y clases en be7170a; el segundo entrenador (DNI `10000005`) y las dos clases del mismo bloque con entrenadores
      distintos en 46a15fb, después del commit de pruebas protegidas de T4a (a5f797e): AT-5)_
- [x] T11 · frontend · `/panel/planes` y `/panel/clases` (grilla semanal), opciones del inicio, formularios con la base
      de llenado, `fieldset` desactivado al guardar y claves con la identidad de la sesión; `lib/dinero.ts`; pruebas de
      componentes (criterios 26 a 29)
- [ ] T12 · tester · Pruebas protegidas en verde y suite completa

## Ataque

- [x] T13 · adversarial · Atacar los criterios críticos con la spec y el código (sin el razonamiento de quien
      implementó): leer o cambiar planes y clases de otra academia (ids, campos de más, parámetros de consulta,
      `entrenadorId` de otra academia, escrituras directas que se salten RLS o la llave compuesta); roles sin permiso,
      cambio obligatorio pendiente, academia suspendida, administrador desactivado o con la sesión cerrada mientras
      guarda; aforo en los bordes y con JSON raro (`2e1`, `20.0`, `-0`, números enormes, textos); precio con coma
      flotante, ceros, notación científica, espacios y Unicode, y clases por mes en cero; cambios de aforo simultáneos
      y cruzados con una transacción que bloquea la clase; `bloquearClasesParaCupo` con órdenes cruzados; carreras
      entre crear clases, reasignar entrenadores y desactivar entrenadores o administradores (interbloqueos, 500);
      bloques en el borde (la clase de 19:00 a 20:00, `20:00`, horas con segundos) y estado del plan en el cambio de
      día, de mes y con el servidor en otra zona. Por cada falla: el especificador agrega el criterio a `spec.md`,
      test-writer la prueba protegida en rojo, se corrige y se vuelve a atacar, hasta una ronda sin fallas.
      **Ronda 1 adversarial: 3 fallas (32, 33, 34)**, agregadas a la spec ("G. Ronda 1 adversarial"); tareas T13a a
      T13f. **Ronda 2 adversarial: 2 fallas en el 34 (no crítico), ninguna en ruta crítica** (34 a y 34 b); tareas
      T13h a T13j. **Ronda 3 adversarial (de confirmación): sin fallas en ruta crítica ni regresiones; una falla menor
      en 11 + 34 aceptada como riesgo**; tareas T13k a T13m.

### Ronda 1 adversarial

- [x] T13a · test-writer · Pruebas protegidas en rojo del criterio 32: `POST /api/clases` y `PATCH /api/clases/{id}`
      (reactivar y cambiar entrenador) que chocan con una clase C mientras otra transacción confirmada la desactiva o
      reactiva otra entre medio (espera comprobada en `pg_locks`, sin depender de tiempos); siempre 201/200 o 409
      `CLASE_DUPLICADA`/`ENTRENADOR_OCUPADO`, nunca 500, con filas y auditoría coherentes (criterio 32)
- [x] T13b · test-writer · Pruebas protegidas en rojo del criterio 33: `INSERT` y `UPDATE` directos como
      `aquagestion_app` en su academia con `precio = 'NaN'`, los tres arreglos con dos dimensiones y con un `NULL`, y
      `vigencia_inicio`/`vigencia_fin` en `'infinity'` y `'-infinity'`, todos con `23514` exacto (criterio 33)
- [x] T13c · tester · Confirmar que T13a y T13b fallan por la razón esperada (500 en la carrera; la fila se escribe en
      vez de dar `23514`) y no por la prueba; que las demás protegidas siguen como estaban. Commit del orquestador:
      "Pruebas protegidas (004): ronda 1 adversarial, choques de clases e invariantes de planes (en rojo)"
- [x] T13d · backend · Corrección del criterio 32 en `ClasesService`: `INSERT` sin `ON CONFLICT` y 409 por el nombre
      de la restricción después del `ROLLBACK` en `POST` y `PATCH`, sin releer para decidir; la consulta del 20 e solo
      elige entre los dos 409 (plan, sección 9.1). Sin tocar las pruebas protegidas (criterios 20 e, 20 f, 21, 32)
- [x] T13e · backend · Migración `<marca>_planes_clases_invariantes` con los `CHECK` de `NaN`, dimensiones, `NULL` y
      fechas finitas (plan, sección 9.2); comprobar que las pruebas de catálogo de 001 siguen pasando (criterios 4, 33)
- [x] T13f · backend · `normalizarNombrePlan` en `packages/contratos` y `nombrePlanSchema` que normaliza antes de
      validar; prueba no protegida: unitarias de la normalización e integración de los 409 de `POST` y `PATCH` y del
      `PATCH` sin cambios (plan, sección 9.3; criterios 11, 12, 34)
- [x] T13g · tester · Pruebas protegidas en verde (T13a, T13b) y suite completa; después, el orquestador vuelve a
      lanzar el ataque (ronda 2)

### Ronda 2 adversarial

**Ronda 2 adversarial: 2 fallas en el 34 (no crítico), ninguna en ruta crítica**; agregadas a la spec como criterios
34 a y 34 b ("H. Ronda 2 adversarial") y DT-7. Sin pruebas protegidas nuevas (no son de ruta crítica).

- [x] T13h · backend · Corrección en `packages/contratos/src/planes.ts`: `normalizarNombrePlan` quita `Cf` y
      `Default_Ignorable_Code_Point` salvo `Bidi_Control`, pasa `Zs` y U+2800 a espacio, colapsa, recorta y aplica NFC
      al final (plan, sección 10). Prueba no protegida en `planes-nombre-normalizado.test.ts` (invisible entre letra y
      tilde, U+034F, U+2800, selectores de variación y mongoles, bidi y U+2028/U+2029 siguen con error, idempotencia y
      resultado en NFC) e integración de los 409 y del nombre guardado en NFC en `POST` y `PATCH` (criterios 34 a, 34 b)
- [x] T13i · frontend · `frontend/src/modulos/planes/campos.ts` usa `normalizarNombrePlan` en lugar de `trim()` para el
      nombre que envía y para decidir si cambió frente a la base del formulario; prueba no protegida (un nombre con
      invisibles se envía normalizado; un cambio solo de invisibles o de NFD no manda `nombre` en el `PATCH`)
      (criterios 29 y 34 a d)
- [x] T13j · tester · Suite completa (contratos, backend y web), lint y verificación de tipos; después, el orquestador
      decide si relanza el ataque sobre el 34 o pasa a la revisión (T14)

### Ronda 3 adversarial (de confirmación)

**Ronda 3 adversarial: sin fallas en ruta crítica ni regresiones; una falla menor en 11 + 34 aceptada como riesgo**
(spec, "I. Ronda 3 adversarial" y "Riesgos aceptados"; plan, sección 11). Sin pruebas protegidas nuevas.

- [x] T13k · backend · Prueba de integración no protegida del criterio 34 c (mayúsculas acentuadas en `POST` y `PATCH`,
      409 sin escribir ni auditar; falla con una base de `LC_CTYPE` `C` o `POSIX`); ajustar la prueba de contratos de
      U+2028 y U+2029 a los dos casos del 34 b (en medio, error; en los extremos, recortados); AT-6 (aviso en
      `hayClaseDelMismoNivel`) y AT-7 (`diaSemanaSchema` tipado como `DiaSemana`) (criterios 11, 17, 32, 34 b, 34 c)
- [x] T13l · frontend · AT-8: `diaDeLaSemanaEnLima` sin `?? 1` silencioso, con su prueba (criterio 28)
- [x] T13m · tester · Suite completa (contratos, backend y web), lint y verificación de tipos

## Revisión y cierre

- [ ] T14 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T15 · revisor · Comparar con la spec, las reglas de `docs/arquitectura.md` (DT-5 de 002, `@Permiso`, `await` en
      cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles, montos sin `number`, fechas
      en Lima, orden de bloqueos) y las convenciones; verificar la semilla y la documentación (criterios 30 y 31)
- [ ] T16 · tester · Suite completa, lint y verificación de tipos
- [ ] T17 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (tablas, `bloquearClasesParaCupo` y las
      reglas para las historias siguientes de la spec), `README.md` y guía de uso (criterio 31). _Hecha en el árbol de trabajo; el commit lo hace el orquestador y entonces se marca._

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [x] Ataque adversarial sin fallas abiertas
