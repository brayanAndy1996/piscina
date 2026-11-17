# 003 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia en parte crítica:
los criterios 4, 5, 11 y 13 a 17 llevan pruebas protegidas escritas y confirmadas en rojo antes de implementar (T1 a
T3) y ataque adversarial después (T11). Los demás llevan las pruebas que indica cada tarea, escritas por quien
implementa. No se empieza T1 sin la aprobación del responsable.

## Aprobación

- [x] T0 · responsable y orquestador · Aprobar la especificación y resolver las preguntas N1 a N7 (Bryan) y T1 a T3
      (orquestador); si T2 se aprueba, el orquestador cambia la columna "Ruta crítica" de la 003 en `specs/backlog.md`
      a "En parte" (todos los criterios). _Hecho el 17/11/2026: Bryan aprobó la spec y todas las propuestas (DR-1 a
      DR-7); el orquestador aprobó T1 a T3 (DT-1 a DT-3); el backlog marca la 003 "En parte" y 🟨._

## Pruebas protegidas (en rojo)

- [ ] T1 · test-writer · Utilidad `backend/test/utilidades/configuracion.ts` (escribir y leer filas de
      `configuraciones` como dueño de las tablas, con cualquier valor JSON, también inválido) y pruebas protegidas de
      aislamiento, permisos y actor vigente de las rutas nuevas, con la carrera determinista del criterio 56 de 002; y
      actualización de la prueba protegida de la matriz de 002 (`packages/contratos/src/permisos.test.ts`) para sumar
      `CONFIGURAR_ACADEMIA` (23 → 24 filas), sin quitar nada (criterios 4, 5, 11)
- [ ] T2 · test-writer · Pruebas protegidas del bloqueo con los valores de cada academia: ingreso y cambio de clave
      con valores distintos en A y B, intentos simultáneos, cambios de valores con cuentas a medias, valores inválidos
      guardados y la secuencia de sentencias del criterio 53 de 002 con filas de configuración en A y en B (criterios
      13 a 17)
- [ ] T3 · tester · Confirmar que T1 y T2 fallan por falta de la funcionalidad (rutas, permiso o lectura de la
      configuración inexistentes) y no por sintaxis, importaciones o configuración; y que las pruebas protegidas de 001
      y 002 que no se tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba.
      Commit del orquestador: "Pruebas protegidas (003): configuración de la academia y bloqueo configurable (en rojo)"

## Implementación

- [ ] T4 · backend · Contratos `configuracion.ts` (tabla de claves, esquemas, respuestas) y `CONFIGURAR_ACADEMIA` en
      `permisos.ts`, con pruebas unitarias de los esquemas y sus bordes (criterios 5, 8, 10)
- [ ] T5 · backend · Dominio `configuracion/dominio/valores.ts` (valor efectivo, cambios pedidos) con pruebas unitarias
      en los bordes de cada rango y con valores inválidos; `lectura.ts` con `leerConfiguracion(tx)` y su aviso en el
      registro técnico sin el valor (criterios 1 a 3, 6, 9)
- [ ] T6 · backend · `ConfiguracionModule`: `GET` y `PATCH /api/configuracion` y `GET /api/mi-academia`, con
      `bloquearActorVigente`, bloqueo de transacción por academia, una sola sentencia de escritura y auditoría
      `CONFIGURACION_ACTUALIZADA`; pruebas de integración no protegidas de valores por defecto, valores guardados,
      validación, idempotencia, teléfono, dos administradores a la vez e identidad (criterios 1 a 12, 20, 21)
- [ ] T7 · backend · `SesionAcademiaService`: leer la configuración dentro de `contarFalloEnTransaccion` con
      `reglasBloqueoDe`, mensaje del 423 con los minutos que faltan; `REGLAS_BLOQUEO_SUPERADMIN` sin cambios, con su
      prueba (criterios 13 a 19)
- [ ] T8 · backend · Semilla: teléfono de ejemplo inventado en `delfines`, repetible (criterio 25)
- [ ] T9 · frontend · `/panel/configuracion`, menú, `useMiAcademia` en `LayoutPanel` y mensaje del 423 de la academia,
      con pruebas de componentes (criterios 19, 22 a 24)
- [ ] T10 · tester · Pruebas protegidas en verde y suite completa

## Ataque

- [ ] T11 · adversarial · Atacar los criterios críticos con la spec y el código (sin el razonamiento de quien
      implementó): leer o cambiar la configuración de otra academia (ids, campos de más, parámetros de consulta, sesión
      de otra academia); roles sin permiso, cambio obligatorio pendiente, academia suspendida, administrador desactivado
      o con la sesión cerrada mientras guarda; valores en los bordes, JSON raro (`1e1`, `1e400`, `-0`, números enormes,
      textos, Unicode) y filas inválidas escritas a mano; bloqueo con valores de A y de B, cambios de valores con
      cuentas bloqueadas o a medias, intentos simultáneos; secuencia de sentencias y tiempos del ingreso con y sin
      cuenta. Por cada falla: el especificador agrega el criterio a `spec.md`, test-writer la prueba protegida en rojo,
      se corrige y se vuelve a atacar, hasta una ronda sin fallas

## Revisión y cierre

- [ ] T12 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T13 · revisor · Comparar con la spec, las reglas de `docs/arquitectura.md` (DT-5 de 002, `@Permiso`/`@SoloSesion`,
      `await` en cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles) y las convenciones
- [ ] T14 · tester · Suite completa, lint y verificación de tipos
- [ ] T15 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (claves, valores por defecto,
      `leerConfiguracion`, orden de bloqueos y regla para las historias siguientes), `README.md` y guía de uso
      (criterio 26)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
