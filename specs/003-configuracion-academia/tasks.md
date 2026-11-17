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

_T1 a T3: hechas según el historial (commit de0ca51, "Pruebas protegidas (003): aislamiento, permisos, administrador
vigente y bloqueo configurable por academia (en rojo)"; precisiones de los criterios 4, 5 y 13 en 68d34a5)._

- [x] T1 · test-writer · Utilidad `backend/test/utilidades/configuracion.ts` (escribir y leer filas de
      `configuraciones` como dueño de las tablas, con cualquier valor JSON, también inválido) y pruebas protegidas de
      aislamiento, permisos y actor vigente de las rutas nuevas, con la carrera determinista del criterio 56 de 002; y
      actualización de la prueba protegida de la matriz de 002 (`packages/contratos/src/permisos.test.ts`) para sumar
      `CONFIGURAR_ACADEMIA` (23 → 24 filas), sin quitar nada (criterios 4, 5, 11)
- [x] T2 · test-writer · Pruebas protegidas del bloqueo con los valores de cada academia: ingreso y cambio de clave
      con valores distintos en A y B, intentos simultáneos, cambios de valores con cuentas a medias, valores inválidos
      guardados y la secuencia de sentencias del criterio 53 de 002 con filas de configuración en A y en B (criterios
      13 a 17)
- [x] T3 · tester · Confirmar que T1 y T2 fallan por falta de la funcionalidad (rutas, permiso o lectura de la
      configuración inexistentes) y no por sintaxis, importaciones o configuración; y que las pruebas protegidas de 001
      y 002 que no se tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba.
      Commit del orquestador: "Pruebas protegidas (003): configuración de la academia y bloqueo configurable (en rojo)"

## Implementación

_T4 a T9: hechas según el historial (backend en 0768735, "configuración por academia, bloqueo configurable,
mi-academia, auditoría y semilla"; web en dfb7548, "página de configuración, nombre y teléfono en el panel, y mensaje
de bloqueo con los minutos que faltan"). T10 no tiene registro propio en el historial: queda abierta y la cubre T14._

- [x] T4 · backend · Contratos `configuracion.ts` (tabla de claves, esquemas, respuestas) y `CONFIGURAR_ACADEMIA` en
      `permisos.ts`, con pruebas unitarias de los esquemas y sus bordes (criterios 5, 8, 10)
- [x] T5 · backend · Dominio `configuracion/dominio/valores.ts` (valor efectivo, cambios pedidos) con pruebas unitarias
      en los bordes de cada rango y con valores inválidos; `lectura.ts` con `leerConfiguracion(tx)` y su aviso en el
      registro técnico sin el valor (criterios 1 a 3, 6, 9)
- [x] T6 · backend · `ConfiguracionModule`: `GET` y `PATCH /api/configuracion` y `GET /api/mi-academia`, con
      `bloquearActorVigente`, bloqueo de transacción por academia, una sola sentencia de escritura y auditoría
      `CONFIGURACION_ACTUALIZADA`; pruebas de integración no protegidas de valores por defecto, valores guardados,
      validación, idempotencia, teléfono, dos administradores a la vez e identidad (criterios 1 a 12, 20, 21)
- [x] T7 · backend · `SesionAcademiaService`: leer la configuración dentro de `contarFalloEnTransaccion` con
      `reglasBloqueoDe`, mensaje del 423 con los minutos que faltan; `REGLAS_BLOQUEO_SUPERADMIN` sin cambios, con su
      prueba (criterios 13 a 19)
- [x] T8 · backend · Semilla: teléfono de ejemplo inventado en `delfines`, repetible (criterio 25)
- [x] T9 · frontend · `/panel/configuracion`, menú, `useMiAcademia` en `LayoutPanel` y mensaje del 423 de la academia,
      con pruebas de componentes (criterios 19, 22 a 24; el 27 lo agrega la ronda 1 de ataque, T11.3)
- [ ] T10 · tester · Pruebas protegidas en verde y suite completa _(sin registro en el historial; se hace en T14)_

## Ataque

- [x] T11 · adversarial · Atacar los criterios críticos con la spec y el código (sin el razonamiento de quien
      implementó): leer o cambiar la configuración de otra academia (ids, campos de más, parámetros de consulta, sesión
      de otra academia); roles sin permiso, cambio obligatorio pendiente, academia suspendida, administrador desactivado
      o con la sesión cerrada mientras guarda; valores en los bordes, JSON raro (`1e1`, `1e400`, `-0`, números enormes,
      textos, Unicode) y filas inválidas escritas a mano; bloqueo con valores de A y de B, cambios de valores con
      cuentas bloqueadas o a medias, intentos simultáneos; secuencia de sentencias y tiempos del ingreso con y sin
      cuenta. Por cada falla: el especificador agrega el criterio a `spec.md`, test-writer la prueba protegida en rojo,
      se corrige y se vuelve a atacar, hasta una ronda sin fallas

### Ronda 1 (sobre 0768735)

Resultado: una falla en la web (F1, media: el formulario enviaba como cambios valores viejos de la caché) y tres
observaciones (O1 a O3: decimales que JavaScript convierte en entero, controles en los extremos del teléfono, minutos
del primer 423), registradas en la sección G de [`spec.md`](spec.md) como el criterio 27 y como precisiones y riesgos
aceptados. F1 no es crítica (criterio 27 no crítico): lleva prueba obligatoria de componentes del frontend, no prueba
protegida.

- [x] T11.1 · adversarial · Ronda 1 sobre 0768735 (F1, O1 a O3)
- [x] T11.2 · especificador · Criterio 27 (amplía el 23), precisión del caso límite del teléfono y riesgos aceptados
      en `spec.md`; base de llenado en `plan.md` (criterio 27)
- [x] T11.3 · frontend · Corregir `FormularioConfiguracion` con la base de llenado (y la petición fresca al montar,
      `plan.md` sección 7) y sumar a `PaginaConfiguracion.test.tsx` las pruebas de componentes que reproducen el
      escenario de la ronda 1 (`w1.test.tsx` del adversarial) y comprueban los puntos a a e, con el cuerpo exacto del
      `PATCH` (criterio 27)
- [x] T11.4 · orquestador · Revisar con `git diff` que la corrección no tocó pruebas protegidas
- [x] T11.5 · adversarial · Ronda 2 sobre el commit con la corrección (criterios críticos y criterio 27)

### Ronda 2 (sobre 78be4a6)

Resultado: el criterio 27 quedó verificado. Una falla en la web (F2, media: la cabecera del panel mostraba el nombre y
el teléfono de otra academia tras cambiar de sesión en el mismo navegador) y cuatro observaciones (O4: un `GET` viejo
deshacía lo guardado; O5: un error del `GET` en segundo plano borraba las ediciones; O6: lo escrito durante el guardado
se perdía; O7: doble envío en el mismo instante). El orquestador decidió corregir O4 a O6 como criterios del
formulario y dejar O7 como observación. Todo en la sección H de [`spec.md`](spec.md): criterios 28 (amplía el 24) y 29
a 31, no críticos, con prueba obligatoria de componentes (el 28, salvo que el orquestador decida otra cosa en la
pregunta T4).

- [x] T11.6 · especificador · Sección H de `spec.md` (criterios 28 a 31, O7, casos límite, riesgo aceptado, impacto y
      pregunta T4); diseño de la ronda 2 en `plan.md` (sección 7, decisiones y riesgos)
- [x] T11.7 · orquestador · Decidir la pregunta T4 (propuesta: el 28 no es crítico). Si es crítico, test-writer escribe
      su prueba de componentes protegida en rojo antes de T11.8. _Hecho: el orquestador confirmó que no es crítico
      (DT-4 en `spec.md`)._
- [x] T11.8 · frontend · Corregir `useMiAcademia` y `LayoutPanel` (clave con la identidad de la sesión y comprobación
      del `nombreCorto`), `useActualizarConfiguracion` (cancelar los `GET` en curso al empezar y al terminar el
      `PATCH`), `PaginaConfiguracion` (formulario a la vista con aviso si falla un `GET` en segundo plano;
      `<fieldset disabled>` mientras se guarda), según `plan.md` sección 7, y sumar a
      `frontend/src/modulos/configuracion/Configuracion.test.tsx` pruebas de componentes que reproducen `x1.test.tsx`
      (los tres casos de F2 y el caso en que `mi-academia` de B responde) y las pruebas T2 a T4 de `x2.test.tsx`, con el
      cuerpo exacto del `PATCH` en el 29 (criterios 28 a 31)
- [x] T11.9 · orquestador · Revisar con `git diff` que la corrección no tocó pruebas protegidas
- [x] T11.10 · adversarial · Ronda 3 sobre el commit con la corrección (criterios críticos, 27 y 28 a 31)

### Ronda 3 (sobre ab71be2)

Resultado: los criterios 28 a 31 quedaron verificados; las pruebas de la ronda 1 se repitieron contra PostgreSQL real
sin cambios y el cambio de `RutaConSesion` no rompe el criterio 59 de 002. Una falla en la web (F3, media: tras guardar,
el formulario quedaba en "Guardando…" hasta que respondía `GET /api/mi-academia`, porque `onSuccess` devolvía la
promesa de la invalidación) y dos observaciones (O8: se veían a la vez "Configuración guardada." y "Guardando…", se
resuelve con F3; O9: el 403 en un `GET` de fondo lo maneja el `GET /api/sesion` que se vuelve a pedir, no es falla).
Todo en la sección I de [`spec.md`](spec.md): criterio 31 a, precisión del 31, no crítico, con prueba obligatoria de
componentes.

- [x] T11.11 · especificador · Sección I de `spec.md` (criterio 31 a, O8 y O9, precisiones del 31 y de los casos
      límite, clasificación); diseño de la ronda 3 en `plan.md` (sección 7, decisiones y riesgos)
- [x] T11.12 · frontend · Corregir `useActualizarConfiguracion` (`frontend/src/modulos/configuracion/hooks.ts`):
      `onSuccess` lanza la invalidación de `['mi-academia']` sin devolverla ni esperarla, y conserva el
      `cancelQueries` y el orden `alGuardar` → `setQueryData` del criterio 29. Sumar a
      `frontend/src/modulos/configuracion/Configuracion.test.tsx` la prueba de componentes del criterio 31 a: `PATCH`
      que responde 200 con `GET /api/mi-academia` demorado a mano sin responder; los campos y un botón "Usar el valor
      por defecto" quedan activos, Guardar ya no dice "Guardando…", se ve "Configuración guardada." sin "Guardando…" a
      la vez; al responder `mi-academia`, la cabecera muestra el teléfono nuevo. Las pruebas de los criterios 27 a 31
      siguen pasando (criterio 31 a). _Hecho en 6816936; la aserción de la cabecera quedó pendiente (O10, T11.15)._
- [x] T11.13 · orquestador · Revisar con `git diff` que la corrección no tocó pruebas protegidas
- [x] T11.14 · adversarial · Ronda 4 sobre el commit con la corrección (criterios críticos, 27, 28 a 31 y 31 a)

### Ronda 4 (sobre a36b244)

Resultado: **sin fallas; termina el ciclo adversarial.** El criterio 31 a quedó verificado con un `MutationObserver`,
sin estados intermedios; sin regresiones en los criterios 27 a 30 (incluido el 28); la batería del backend se repitió
contra PostgreSQL real con los mismos resultados (aislamiento, permisos, cuerpos, bloqueo por academia con valores
inválidos, concurrencia, doble clic y 300 rondas pareadas del criterio 17). Una observación (O10: la prueba del 31 a no
comprueba que la cabecera muestra el teléfono nuevo cuando responde `mi-academia`; el comportamiento es correcto). Todo
en la sección J de [`spec.md`](spec.md).

- [x] T11.15 · especificador · Sección J de `spec.md` (ronda 4 sin fallas y O10) y estas tareas marcadas
- [x] T11.16 · frontend o revisor · Cerrar O10: en el bloque del criterio 31 de
      `frontend/src/modulos/configuracion/Configuracion.test.tsx`, que `GET /api/mi-academia` responda con el teléfono
      guardado y comprobar que la cabecera lo muestra (criterio 31 a). Solo prueba de componentes, no protegida; no
      pide otra ronda de ataque

## Revisión y cierre

**Siguen:** T10 y T11.16 (los marca el orquestador), T12 (orquestador, `git diff` de las pruebas protegidas) y T14
(tester, suite completa, lint y tipos; cubre T10).

- [x] T12 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [x] T13 · revisor · Comparar con la spec, las reglas de `docs/arquitectura.md` (DT-5 de 002, `@Permiso`/`@SoloSesion`,
      `await` en cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles) y las convenciones.
      _Hecho: aprobado con cambios menores._
- [ ] T14 · tester · Suite completa, lint y verificación de tipos
- [x] T15 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (claves, valores por defecto,
      `leerConfiguracion`, orden de bloqueos y regla para las historias siguientes), `README.md` y guía de uso
      (criterio 26). _Hecho: documentación actualizada en el árbol de trabajo; sin commit, a pedido del orquestador._
- [x] Criterio 26 de `spec.md`: `docs/arquitectura.md`, `README.md` y `docs/guia-local-windows.md` documentan lo construido
      (T15).

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo (de0ca51)
- [ ] Pruebas en verde tras la implementación (se confirma en T14)
- [x] Ataque adversarial sin fallas abiertas (ronda 4 sobre a36b244)
