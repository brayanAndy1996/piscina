# 009 · Tareas

Cada tarea indica su rol y los criterios de aceptación que cubre. Las de la 009b llevan **[009b]** y empiezan con la
009a unida a `main`.

## 009a · Marcado por QR y manual

- [x] T1 · orquestador · Aprobar el cambio de la prueba protegida de la 005 (`privilegios.test.ts`: `clases_usadas` en
  `UPDATE_EXACTO`) y de las de la 001 que comparan `PRIVILEGIOS_APP` (criterio 1; «Impacto en especificaciones
  anteriores»). Aprobado por Bryan el 25/11/2026.
- [x] T2 · test-writer · Pruebas protegidas de la base: tabla, `CHECK`, únicos, llaves, RLS y privilegios, como app y
  como dueño (criterio 1), más el ajuste aprobado en T1 _(hecho: a4bf3f0)_
- [x] T3 · test-writer · Pruebas protegidas del marcado: QR y manual, 404 iguales, QR regenerado, permisos, orden de
  validaciones y alertas, bordes de Lima con `RELOJ` y `TZ=Asia/Tokyo`, ventana, tolerancia, descuento, una por día,
  idempotencia, bloqueos sin `40P01`, claves exactas de la respuesta, aislamiento y token fuera de los registros
  (criterios 2 a 17) _(hecho: 7ea0fec)_
- [x] T4 · tester · Confirmar que T2 y T3 fallan por la razón esperada; commit «Pruebas protegidas (009): 009a, … (en
  rojo)» _(hecho: confirmación del tester, sin commit propio)_
- [x] T5 · backend · Contratos `packages/contratos/src/asistencia.ts`: esquemas de entrada, respuesta, rechazo, códigos
  y alertas (criterios 2, 5, 7 y 15) _(hecho: 0d17da2)_
- [x] T6 · backend · Migración `<marca>_asistencias`, `schema.prisma`, `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs`
  (criterio 1) _(hecho: d43d672)_
- [x] T7 · backend · Dominio puro: `ventana.ts`, `llegada.ts`, `validaciones.ts` con sus pruebas unitarias (criterios 7,
  9, 10 y 20) _(hecho: 394fbc4)_
- [x] T8 · backend · Extraer `leerFoto` del carnet a `alumnos/foto-como-data.ts` sin cambiar el carnet (criterio 15)
  _(hecho: 6b19186)_
- [x] T9 · backend · `MarcadoService` y `AsistenciaController` (`/qr` y `/manual`): transacción, bloqueos, decisión,
  descuento, choques por nombre de restricción, foto después de confirmar; `/asistencias` en `PREFIJOS_SIN_HEAD`
  (criterios 2 a 18) _(hecho: 831e437)_
- [x] T10 · frontend · `/panel/asistencia`: lectora USB, cámara con `html5-qrcode` (import dinámico), buscador,
  resultado verde, rojo y amarillo, anti-rebote y entrada en el inicio del panel; pruebas de componentes (criterios 19
  y 34) _(hecho: eea7ed2 y 4706d52, verificado en el navegador)_
- [x] T11 · adversarial · Ataque de la 009a (hasta 3 rondas, D-31) _(ronda 1, 26/11/2026: sin fallas críticas ni altas.
  R1-1 y R1-2, medias, y R1-3, baja, en la deuda de [`specs/backlog.md`](../backlog.md); ver [`rondas.md`](rondas.md).
  Cierra el ataque de la 009a en 1 de 3 rondas)_
- [x] T12 · revisor y tester (a la vez) · Revisión contra la spec; suite completa, lint y tipos _(hecho, 26/11/2026: el
  revisor no encontró bloqueantes ni importantes. El tester ejecutó la suite completa sobre `eea7ed2`: 17 501 pasan, 0
  fallan y 95 se saltan; E2E 6 de 6; formato, lint, tipos, build y pruebas protegidas en verde. La corrección `4706d52`,
  que solo toca la web, deja el proyecto frontend en 781 de 781)_
- [x] T13 · documentador · `docs/arquitectura.md`, guía de Windows y nota del backlog de la 009a; marcar tareas
  (criterio 21) _(hecho en este commit, «Cierre (009a): tareas, rondas, deuda y documentación de la asistencia»)_

## 009b · Faltas, registro posterior y consulta del mes

- [ ] T14 · test-writer · [009b] Pruebas protegidas de `inasistencias`: llaves, único, `CHECK`, trigger, RLS y
  privilegios (criterio 22)
- [ ] T15 · test-writer · [009b] Pruebas protegidas de la tarea: academias activas y suspendidas, bloqueo consultivo,
  error aislado por academia, a quién se le registra falta, bordes de Lima, ventana de ayer y hoy, idempotencia y
  concurrencia con el registro posterior (criterios 23 a 27)
- [ ] T16 · test-writer · [009b] Pruebas protegidas del registro posterior, su auditoría, sus errores y de la consulta
  del mes (criterios 28 a 31); la clave de un marcado contra la de un registro posterior en los dos sentidos, en serie y
  determinista (criterio 36); el marcado que espera la clase retenida con `FOR UPDATE` y cruza las 19:00, y el cobro
  de otro alumno de la misma clase sin `40P01` (criterio 37)
- [ ] T17 · tester · [009b] Confirmar el rojo de T14 a T16; commit «Pruebas protegidas (009): 009b, … (en rojo)»
- [ ] T18 · backend · [009b] Migración `<marca>_inasistencias` con el trigger; privilegios (criterio 22)
- [ ] T19 · backend · [009b] `@nestjs/schedule` en `backend/package.json` y en `DEPENDENCIAS_BACKEND_PERMITIDAS`;
  `TAREAS_PROGRAMADAS` en el entorno y en `.env.example`; `ScheduleModule` condicionado (criterios 23, 33 y 34)
- [ ] T20 · backend · [009b] `FaltasService` y `FaltasTarea` (criterios 23 a 27 y 33)
- [ ] T21 · backend · [009b] Registro posterior en `MarcadoService` y su ruta, con la auditoría y la falta cubierta
  (criterios 28 a 30); `repetir()` compara también `registro_posterior` en los tres puntos donde se mira la clave
  (criterio 36); las clases de la matrícula con `FOR KEY SHARE` después de la matrícula y antes de leer «ahora», en el
  marcado y en el posterior (criterio 37)
- [ ] T22 · backend · [009b] Consulta del mes `GET /api/alumnos/{id}/asistencias` (criterio 31)
- [ ] T23 · frontend · [009b] Sección «Asistencia» en `/panel/alumnos/{id}` y el diálogo del registro posterior;
  pruebas de componentes (criterio 32)
- [ ] T24 · adversarial · [009b] Ataque de la 009b (hasta 3 rondas, D-31)
- [ ] T25 · revisor y tester (a la vez) · [009b] Revisión; suite completa, lint y tipos
- [ ] T26 · documentador · [009b] `docs/arquitectura.md`, guía de Windows y nota del backlog; marcar tareas
  (criterio 35)

## Solo ruta crítica

- [x] 009a: pruebas escritas por test-writer y confirmadas en rojo _(a4bf3f0 y 7ea0fec; T4)_
- [x] 009a: pruebas en verde tras la implementación _(T12, 26/11/2026: pruebas protegidas en verde sobre `eea7ed2`; la corrección `4706d52` es solo de la web)_
- [x] 009a: ataque adversarial sin fallas críticas ni altas abiertas _(ronda 1, 26/11/2026: R1-1 y R1-2, medias, y R1-3, baja, en la deuda de `specs/backlog.md`; ver [`rondas.md`](rondas.md))_
- [ ] 009b: pruebas escritas por test-writer y confirmadas en rojo
- [ ] 009b: pruebas en verde tras la implementación
- [ ] 009b: ataque adversarial sin fallas críticas ni altas abiertas
