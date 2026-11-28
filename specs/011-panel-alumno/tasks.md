# 011 · Tareas

Cada tarea indica su rol y los criterios que cubre. Empiezan con la spec aprobada por Bryan el 28/11/2026 (DR-1 a DR-5) y
DT-1 a DT-16 aceptadas por el orquestador. Los commits de pruebas protegidas dicen «Pruebas protegidas (011): … (en rojo)», y las
pruebas llevan al inicio `// spec: 011-panel-alumno (pruebas protegidas)` (DT-16).

## Aprobación

- [x] T0 · orquestador y responsable · Bryan responde P1 a P5; el orquestador acepta DT-1 a DT-16. **Hecho
  (28/11/2026):** Bryan aprobó la propuesta de las cinco (DR-1 a DR-5 de `spec.md`) y el orquestador aceptó DT-1 a DT-16.

## Pruebas protegidas

- [x] T1 · test-writer · Antes de escribir, comprobar que ninguna prueba protegida fija lo que cambia: la lista de índices
  de `alumnos` (005 y 008), la respuesta del listado de mensualidades (010b) y la consulta del mes (009b). Si alguna lo
  fija, parar y avisar al orquestador. (Impacto en especificaciones anteriores)
  _(Hecha antes de escribir, sin commit propio. En la 011 no cambió ningún archivo de prueba que ya existiera; las pruebas
  de 002 a 010 siguen como estaban.)_
- [x] T2 · test-writer · Modelo: el índice único como app y como dueño (criterio 1).
  _(`1000eec`)_
- [x] T3 · test-writer · Alumno de la sesión y permisos: agregados de la dirección, del cuerpo y de las cabeceras; 404 sin
  alumno; todas las respuestas de acceso y su orden, con la clave restablecida por recepción (criterios 2 y 3).
  _(`1000eec`; limpieza de la prueba de falla cerrada en `a038ab2`: el `DELETE` no borraba por RLS)_
- [x] T4 · test-writer · Aislamiento: hermanos H1 y H2 con el mismo apoderado; la misma persona en A y B (D-28), con RLS y
  con B suspendida; las rutas del personal con el id del hermano siguen en 403 (criterios 4 y 5).
  _(`1000eec`)_
- [x] T5 · test-writer · Contenido: claves exactas del resumen para un adulto y un menor con todos los datos sensibles
  sembrados con textos únicos; ninguno aparece en las dos rutas (criterio 6).
  _(`1000eec`)_
- [x] T6 · test-writer · Asistencia del panel igual, byte a byte, a la de recepción; errores de `mes` (también posterior a
  M y repetido) (criterio 12).
  _(`1000eec`)_
- [x] T7 · test-writer · Solo lectura: 20 lecturas sin cambios en las tablas ni auditoría; otros métodos en `/mi-panel`
  responden 404 (criterio 14).
  _(`1000eec`)_
- [x] T8 · test-writer · Inventario de escrituras con `DiscoveryService`: la lista exacta de manejadores que dejan pasar
  al `ALUMNO`, un mínimo de manejadores encontrados, y cada escritura pedida por el alumno sin 2xx ni cambios
  (criterio 15; DT-13). Si aparece un manejador que deja pasar al alumno y no está en la lista, parar y avisar al
  orquestador.
  _(`1000eec`)_
- [x] T9 · tester · Confirmar que T2 a T8 fallan por la razón esperada; commit «Pruebas protegidas (011): … (en rojo)».
  _(`1000eec`, en rojo)_

## Implementación

- [x] T10 · backend · Contratos: `miPanelSchema`, `mensualidadDelPanelSchema`, `siguienteDelPanelSchema` y
  `edadEnFecha`, con sus pruebas unitarias (criterio 17).
  _(`0596add`)_
- [x] T11 · backend · Migración `<marca>_panel_alumno` y `@@unique` en `schema.prisma` (criterio 1; DT-3).
  _(`f45df6a`; la migración es `20261128100000_panel_alumno`)_
- [x] T12 · backend · `mensualidades/lectura-de-estado.ts` sacada del listado, sin cambiar su respuesta; correr las
  pruebas del listado por archivo (DT-4).
  _(`ab2a318`)_
- [x] T13 · backend · `ConsultaDeAsistenciaService.delMesDelUsuario` sobre `leerDelMes`; correr las pruebas de la
  consulta del mes por archivo (criterio 12; DT-5).
  _(`ab2a318`)_
- [x] T14 · backend · Módulo `panel-alumno`: controlador, alcance `PROPIO`, servicio del resumen,
  `dominio/mensualidad-del-panel.ts` con pruebas unitarias, `no-store` y `/mi-panel` en `PREFIJOS_SIN_HEAD`
  (criterios 2 a 16; DT-1, DT-2, DT-6 a DT-9, DT-12).
  _(`5ca422d`)_
- [x] T15 · backend · Pruebas de integración no protegidas: ejemplos en Lima con `TZ=Asia/Tokyo` (criterios 7, 9 y 13),
  el mismo estado que el listado (criterio 10), los meses de asistencia (criterio 11), cabeceras, `HEAD` y registro
  técnico (criterio 16).
  _(`17ea28e`)_
- [x] T16 · frontend · `ListaDeAsistencia` compartida con la ficha de recepción (DT-10); `PanelDelAlumno` y
  `MiAsistencia` en `/panel` con los textos de cada estado, sin reloj del navegador, con claves de la sesión, y sus pruebas
  de componentes (criterios 18 y 19; DT-7, DT-11).
  _(`5f99dd0`)_
- [x] T17 · frontend · E2E del alumno: ingreso con el DNI, cambio obligatorio, panel con su asistencia, sin el hermano,
  cierre de sesión (criterio 20).
  _(`6871ca3`; el sembrador por SQL está en `e2e/utilidades/sembrar-panel.ts`, DT-21)_

## Ataque, revisión y cierre

- [x] T18 · adversarial · Ataque de la 011 (hasta 3 rondas, D-31; registro en `rondas.md`): ids, parámetros, cuerpos y
  cabeceras para ver a otro alumno o a otra academia; hermanos con el mismo apoderado; la misma persona en dos academias;
  sesiones vencidas, restablecidas o con cambio pendiente; el personal y el entrenador en las rutas del panel; datos
  sensibles en el cuerpo, los registros y las cabeceras; escrituras de la cuenta del alumno; bordes de Lima del mes y de la
  edad.
  _(Una ronda, sin fallas críticas ni altas. El registro está en `rondas.md`, en el commit de cierre.)_
- [x] T19 · revisor y tester (a la vez) · Revisión contra la spec y estas convenciones (incluidos los ciclos de
  importación de DT-9); suite completa, lint y tipos. Antes, el orquestador revisa con `git diff` que ningún commit de
  implementación tocó las pruebas protegidas.
  _(Limpieza de la revisión en `a774f0a` (backend) y `0e132cc` (web y E2E). Resultados en `rondas.md`.)_
- [x] T20 · documentador · `docs/arquitectura.md`, la guía de Windows y la nota de la 011 en `specs/backlog.md`; marcar
  estas tareas (criterio 21).
  _(En el commit de cierre, «Cierre (011)».)_

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo _(`1000eec` (en rojo) y `a038ab2` (limpieza de la prueba de
  falla cerrada))_
- [x] Pruebas en verde tras la implementación _(`0596add`, `f45df6a`, `ab2a318`, `5ca422d`, `17ea28e`, `5f99dd0` y
  `6871ca3`; limpieza de la revisión en `a774f0a` y `0e132cc`; suite completa de 19 444 pasan, 0 fallan y 95 se saltan)_
- [x] Ataque adversarial sin fallas críticas ni altas abiertas _(una ronda, 28/11/2026, sin fallas críticas ni altas; ver
  `rondas.md`)_
