# Rondas adversariales: 011 · Panel del alumno y del apoderado

Registro de los ataques a la ruta crítica de esta historia (D-31). Lo leen el especificador y el adversarial; el resto
de los subagentes trabaja con `spec.md`. Como máximo 3 rondas por entrega. Las fallas críticas o altas se convierten
en criterios de `spec.md`; las medias o bajas quedan como deuda en las notas de la historia en `specs/backlog.md`.

Una sola entrega (011). Lo que se ataca: los criterios críticos 1 a 6, 12, 14 y 15, y cómo se conectan con la 002
(sesión y cambio de clave), la 008 (`/api/mi-carnet`), la 009b (consulta del mes) y la 010b (listado y
`estadoDeMensualidad`). No se vuelven a atacar historias ya unidas a `main`.

## Entrega 011 · Ronda 1

- **Fecha:** 28/11/2026
- **Qué se atacó:** lo nuevo de la 011 en la ruta crítica (criterios 1 a 6, 12, 14 y 15): las rutas `GET /api/mi-panel` y
  `GET /api/mi-panel/asistencias` con variantes, el parámetro `mes`, las sesiones raras, la fuga de datos, la
  reorganización del listado y de la consulta, la coherencia con recepción en Lima (`TZ=Asia/Tokyo`), la solo lectura,
  los alumnos inactivos, vencidos y `CLIENTE`, y el rendimiento.
- **Resultado:** ninguna falla crítica ni alta. Dos bajas pasan a deuda, en la nota de la 011 de `specs/backlog.md`. No
  hubo criterios nuevos.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| B-1 | Baja | «Vence el 31/12» se muestra con la mensualidad del mes en curso en verificación. Si el Yape se rechaza, la familia ya vio esa fecha. | Deuda. Propuesta: mostrar «Pago en verificación». Pregunta para Bryan. |
| B-2 | Baja | El resumen dice «te quedan N» por la matrícula en verificación, y «Mi asistencia» no muestra clases restantes porque `matricula` es `null`. | Deuda. Propuesta: no mostrar restantes mientras la matrícula está en verificación. Pregunta para Bryan. |

- **Sin fallas en:**
  - rutas con variantes (barras, mayúsculas, codificación, métodos `HEAD`, `OPTIONS`, `TRACE`…);
  - el parámetro `mes`;
  - sesiones raras (personal con ficha, rol cambiado, claims manipuladas, cookie de otra academia, dos cookies);
  - fuga de datos;
  - la reorganización del listado y de la consulta;
  - coherencia con recepción en Lima (`TZ=Asia/Tokyo`);
  - solo lectura;
  - alumnos inactivos, vencidos y `CLIENTE`;
  - rendimiento.

## Cierre de la 011

- **Fecha:** 28/11/2026. El ataque se cerró en 1 de 3 rondas, sin fallas críticas ni altas, así que no hubo rondas
  adicionales ni criterios nuevos. Las bajas B-1 y B-2 quedan como deuda.
- **Revisión.** El revisor no encontró fallas importantes. Siete menores se corrigieron en la limpieza de la revisión, en
  `a774f0a` (backend) y en `0e132cc` (web y E2E). Entre ellos, la regla que elige el estado, `actual` y `siguiente`
  (`elegirMensualidades`, que llama a `estadoDeMensualidad`) es ahora compartida en
  `mensualidades/dominio/mensualidad-elegida.ts`, y la usan el listado y el panel.
- **Ajustes a pruebas protegidas.** `a038ab2`, después de la implementación, limpió la prueba de falla cerrada de
  `alumno-de-la-sesion.test.ts`: con FORCE RLS, el `DELETE` de la limpieza no borraba nada. Ahora la limpieza quita la
  cuenta del gemelo con un `UPDATE` y comprueba que el índice único queda como lo encontró. No quita ninguna aserción. En el
  rango de la 011 no cambió ningún archivo de prueba que ya existiera.
- **Suite completa:** 19 444 pasan, 0 fallan y 95 se saltan.
- **E2E:** 7 de 7 en la entrega. Con las tres pruebas del sembrador (`e2e/pruebas/sembrar-panel.spec.ts`), hoy son 10 de 10.
- **Lint, tipos y build:** en verde.
- **Commits.** Pruebas en rojo `1000eec` y su limpieza `a038ab2`; contratos `0596add`; índice único `f45df6a`; lectura
  compartida y asistencia `ab2a318`; módulo del panel `5ca422d`; pruebas no protegidas `17ea28e`; web `5f99dd0`; E2E
  `6871ca3`; limpieza de la revisión `a774f0a` (backend) y `0e132cc` (web y E2E). El commit de cierre es «Cierre (011):
  tareas, ronda, deuda y documentación del panel del alumno».
