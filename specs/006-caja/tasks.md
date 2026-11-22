# 006 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia de ruta crítica,
dividida en dos entregas (DR-10 de la spec), cada una con sus pruebas protegidas, su ataque y su PR:

- **006a · Caja del día** (T1 a T22, y T36 a T42 de la ronda adversarial 1): criterios 1 a 39, 45 y 46 sin el
  historial ni el PDF, y 47 y 48. Se construye primero.
- **006b · Historial y PDF del cierre** (T23 a T35, marca **[006b, siguiente PR]**): criterios 40 a 44 y la parte de 45
  y 46 que les toca. Se empieza con la 006a unida a `main`.

En cada entrega, los criterios críticos (DT-5) llevan pruebas protegidas escritas y confirmadas en rojo antes de
implementar y ataque adversarial después.

## Aprobación

- [x] T0 · responsable y orquestador · Aprobar la especificación y resolver las preguntas P1 a P11 (Bryan) y T1 a T6
      (orquestador). Hecho el 22/11/2026: todas con la propuesta (DR-1 a DR-11 y DT-1 a DT-6 de la spec); ningún valor
      provisional cambió y la división se mantiene. La nota de la 007 (y la de la 019) en `specs/backlog.md` ya remite a
      `registrarIngresoEnCaja` (y a `registrarEgresoEnCaja`) y al orden de bloqueos con la caja.

## 006a · Caja del día

### Pruebas protegidas (en rojo)

- [x] T1 · test-writer · Utilidad `backend/test/utilidades/caja.ts` (crear cajas, movimientos y cierres como dueño de las
      tablas, también inválidos; fijar `RELOJ`; llamar a `registrarIngresoEnCaja` dentro de `conAcademia`). Pruebas
      protegidas de las tablas, el catálogo, las llaves compuestas, los `CHECK`, los índices únicos, el trigger (con la
      espera en `pg_locks`), RLS y los privilegios; actualización de las pruebas protegidas de 001 que comparan la lista
      exacta de privilegios (y de `scripts/` si las hay) y de `TABLAS_DESPUES_DE_MIGRAR`, solo para sumar (criterios 1 a
      6)
- [x] T2 · test-writer · Pruebas protegidas de permisos por rol en las cinco rutas de la 006a (sin sesión, cambio
      obligatorio, academia suspendida, cookie del Superadmin); aislamiento por id, por cuerpo y por parámetro de
      consulta; carrera determinista del actor vigente en apertura, egreso, cierre y reapertura; actualización de la
      prueba protegida de la matriz (criterio 26 de 002) para sumar la fila `REABRIR_CAJA` (de 24 a 25), sin quitar ni
      cambiar nada, en el mismo commit de pruebas protegidas (DT-1) (criterios 7 a 9)
- [x] T3 · test-writer · Pruebas protegidas de la apertura: respuesta y auditoría, monto inicial (aceptados y
      rechazados), fecha de Lima en los bordes con `TZ=Asia/Tokyo` y `TZ=UTC`, una abierta por academia y aperturas
      simultáneas, caja pendiente de otro día, caja del día cerrada, clave repetida y simultánea (criterios 10 a 16)
- [x] T4 · test-writer · Pruebas protegidas de los movimientos: egreso (respuesta, número, auditoría), validación,
      caja cerrada, caja de otro día en los bordes de medianoche, efectivo insuficiente y egresos simultáneos, clave
      repetida, rutas de edición y borrado inexistentes; `registrarIngresoEnCaja` (sin caja, de otro día, pago repetido,
      monto fuera de rango, alumno de otra academia); resumen con los tres métodos; orden de bloqueos con una
      transacción que imita la 007 y con la cancelación de 005b, sin `40P01` (criterios 17 a 26)
- [x] T5 · test-writer · Pruebas unitarias protegidas de `calcularResumen` y `calcularDiferencia` (decimales que en
      coma flotante no cuadran, céntimos, cero) y de `montoNoNegativoSchema`, `montoConSignoSchema` y `restarMontos`
      (criterios 11, 27 y 39 en su parte de contratos); prueba de integración protegida de `GET /api/cajas/actual`
      (criterio 28)
- [x] T6 · test-writer · Pruebas protegidas del cierre: respuesta, foto del resumen y auditoría; observación
      obligatoria con diferencia; `CAJA_CAMBIO`; cierre tardío y apertura posterior; carreras deterministas del cierre
      con un egreso y con `registrarIngresoEnCaja` en los dos órdenes; doble clic y cierres simultáneos (criterios 29 a
      34)
- [x] T7 · test-writer · Pruebas protegidas de la reapertura: respuesta, cierre marcado, auditoría con motivo, segundo
      cierre; ya abierta, otra caja abierta, reapertura y apertura simultáneas, caja de un día anterior, otra academia
      (criterios 35 y 36)
- [x] T8 · tester · Confirmar que T1 a T7 fallan por falta de la funcionalidad (tablas, rutas, esquemas o funciones
      inexistentes) y no por sintaxis, importaciones o configuración; y que las pruebas protegidas de 001 a 005 que no se
      tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba. Commit del
      orquestador: "Pruebas protegidas (006a): caja del día, movimientos, cierre y reapertura (en rojo)"

### Implementación

- [x] T9 · backend · Contratos: `dinero.ts` (`montoNoNegativoSchema`, `montoConSignoSchema`, `restarMontos`), `caja.ts`
      y `permisos.ts` (`REABRIR_CAJA`), con pruebas unitarias no protegidas de sus bordes (criterios 7, 11, 18, 30, 35,
      39)
- [x] T10 · backend · `schema.prisma` y migración `<marca>_caja` (tipos, tablas, `CHECK`, índices, llaves compuestas,
      trigger, RLS, políticas y privilegios); `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR`
      en el mismo cambio (criterios 1 a 6)
- [x] T11 · backend · Dominio puro: `dominio/esperado.ts` y `dominio/dia.ts` (`esDeOtroDia`, `esCierreTardio`), con
      pruebas unitarias no protegidas de los bordes de Lima y de otra zona del proceso (criterios 12, 20, 27, 32)
- [x] T12 · backend · `movimientos.ts` (`registrarIngresoEnCaja`, `registrarEgresoEnCaja`, `leerCajaAbierta`, resumen y
      número) y `lectura.ts` (criterios 17 a 25, 28)
- [x] T13 · backend · `CajaModule`: controlador y servicio de apertura, caja actual, egreso, cierre y reapertura, con
      `bloquearActorVigente`, el bloqueo consultivo, `FOR UPDATE` de la caja, el orden de errores del contrato, 409 por
      el nombre de la restricción después del `ROLLBACK` y auditoría (criterios 7 a 36)
- [x] T14 · backend · Semilla: caja cerrada de ejemplo en `delfines` con fecha fija, repetible (criterio 45)
- [x] T15 · frontend · `/panel/caja` y la opción "Caja" del inicio: los cuatro estados, apertura, egreso, cierre con la
      diferencia en vivo y la observación, reapertura para el `ADMIN`, claves de idempotencia por diálogo, campos
      desactivados al guardar, mensajes de los 409 y claves de consulta con la identidad de la sesión; pruebas de
      componentes (criterios 37 a 39)
- [x] T16 · frontend · Prueba E2E `e2e/pruebas/caja.spec.ts`: abrir, egreso, cerrar con faltante y observación (criterio
      38)
- [x] T17 · tester · Pruebas protegidas en verde y suite completa

### Ataque

- [x] T18 · adversarial · Atacar los criterios críticos de la 006a con la spec y el código (sin el razonamiento de quien
      implementó): leer o mover la caja de otra academia (ids, campos de más, parámetros, escrituras directas que se
      salten RLS, las llaves o el trigger); roles sin permiso, Superadmin, cambio obligatorio, academia suspendida, cuenta
      desactivada mientras guarda; montos con coma flotante, ceros, signos, notación científica, espacios y Unicode;
      fechas en el borde de las 19:00 y de la medianoche de Lima, fin de mes y de año, proceso en otra zona; aperturas,
      reaperturas, egresos, cierres e ingresos simultáneos sobre la misma caja; doble clic y reintentos con la misma
      clave y con otra; egresos en la caja de otro día; interbloqueos con la cancelación de solicitudes y con una
      transacción que imita la 007; cobro con la caja cerrada o de otro día. Por cada falla: el especificador agrega el
      criterio a `spec.md`, test-writer la prueba protegida en rojo, se corrige y se vuelve a atacar, hasta una ronda sin
      fallas.
      _(ronda 1 sobre `deb9ee4`: sin fallas de los criterios escritos; ver más abajo)_

### Ataque adversarial, ronda 1 (22/11/2026, sobre `deb9ee4`)

Sin fallas de los criterios escritos. El orquestador convirtió dos observaciones en los criterios 47 (comprobante del
egreso) y 48 (las interfaces validan sus entradas) de `spec.md`, críticos, y dejó la nota de la fila del alumno para la
007 en "Reglas para las historias siguientes" (sin criterio ni tarea de código).

- [x] T36 · test-writer · Pruebas protegidas en rojo, desde la spec y los contratos públicos, sin mirar la
      implementación, con la marca de pruebas protegidas:
      - criterio 47: unitarias de `registrarEgresoSchema` (los 400 en `comprobante` por dirección del texto y
        separadores en medio, también `{U+202E}` solo; el recorte de U+2028 en los bordes; la normalización a `null` de
        los comprobantes sin visibles; `B{U+200B}1` y `"1"` se conservan) e integración de la ruta (400 sin escribir ni
        auditar; `movimiento.comprobante` y `datosDespues.comprobante` en `null`; idempotencia: 200 entre comprobantes
        que se guardan `null`, 409 `CLAVE_YA_USADA` frente a uno visible en los dos órdenes, 400 con la clave ya usada y
        un comprobante inválido);
      - criterio 48: integración de `registrarEgresoEnCaja` y `registrarIngresoEnCaja` dentro de `conAcademia` con la
        caja de hoy abierta, con las entradas del 48 d: `RangeError` (no `ErrorNegocio` ni error de Prisma) y sin
        cambios en `movimientos_caja` ni en `auditoria`; recorte, comprobante `null` y `repetido: true` del 48 b; `cajaId`
        que no es UUID, 404 `NO_ENCONTRADO`.

      Commit: "Pruebas protegidas (006a), ataque ronda 1: comprobante del egreso e interfaces de la caja (en rojo)"
      (criterios 47, 48)
      _(commit `bb258df`)_
- [x] T37 · tester · Confirmar que T36 falla por la razón esperada (comprobante con dirección del texto aceptado,
      comprobante invisible guardado como texto, inserción o error de Prisma en lugar de `RangeError`, descripción sin
      recortar) y no por sintaxis, importaciones o configuración; que las pruebas protegidas anteriores siguen pasando; y
      `git diff --cached --stat` solo con archivos de prueba (criterios 47, 48)
- [x] T38 · backend · Contratos: el comprobante de `registrarEgresoSchema` rechaza dirección del texto y separadores y
      normaliza a `null` lo que no tiene visibles, reutilizando la regla de `texto.ts` sin copiarla (plan 2.3, "Ronda
      adversarial 1"); pruebas unitarias no protegidas de los bordes (criterio 47)
      _(commit `88b8d4e`; `packages/contratos/src/texto-bidi.test.ts` es una prueba unitaria nueva, sin marca de protegida)_
- [x] T39 · backend · `movimientos.ts`: `registrarEgresoEnCaja` valida con los esquemas de la ruta y trabaja con los
      valores normalizados (inserción, auditoría y comparación de la clave); `registrarIngresoEnCaja` comprueba la forma
      de ids, concepto y método antes de tocar la base; `RangeError` sin escribir; comentarios de la interfaz al día
      (criterio 48)
      _(commit `88b8d4e`)_
- [x] T40 · tester · Pruebas protegidas en verde (T36 y todas las anteriores) y suite completa (criterios 47, 48)
- [x] T41 · orquestador · `git diff` desde el commit de T36: T38 y T39 no tocaron pruebas protegidas
      _(verificado: `88b8d4e` no toca ninguna prueba protegida, y ningún commit de implementación de la 006a toca una)_
- [ ] T42 · adversarial · Ronda 2 sobre todo lo de la 006a, en especial 47 y 48 (Unicode en el comprobante y la
      descripción, la idempotencia con comprobantes normalizados, llamadas directas a las interfaces con entradas mal
      formadas) y las carreras pendientes de PP8; si hay fallas, se repite el ciclo hasta una ronda sin fallas
      _(sin marcar: no hay registro de la ronda 2 en `spec.md` ni en los commits)_

### Revisión y cierre

- [x] T19 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
      _(verificado en este commit: las pruebas protegidas de la 006 solo cambian en `6a2f004`, `deb9ee4` y `bb258df`)_
- [x] T20 · revisor · Comparar con la spec, las reglas de `docs/arquitectura.md` (DT-5 de 002, `@Permiso`, `await` en
      cada paso, sin caché, errores con `errorParaRegistro`, montos sin `number`, fechas en Lima con `RELOJ`, orden de
      bloqueos, 409 por el nombre de la restricción) y las convenciones; verificar la semilla y la documentación
      (criterios 45 y 46, sin el historial ni el PDF)
      _(hecha; sus correcciones están en `8913284` y `ebf031c`)_
- [x] T21 · tester · Suite completa, lint y verificación de tipos
- [x] T22 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (tablas, permiso, interfaz para la 007 y la
      019 con la validación de entradas del criterio 48, reglas para las historias siguientes con la nota de la ronda
      adversarial 1 sobre la fila del alumno y `registrado_por`), `README.md` y guía de uso de la caja del día; notas de
      la 007 y la 019 en `specs/backlog.md` (criterio 46)
      _(hecha en este commit. Las notas de la 007 y la 019 ya estaban en `specs/backlog.md` desde T0; el ✅ de la 006a
      lo pone el orquestador al unirla)_

## 006b · Historial y PDF del cierre [006b, siguiente PR]

### Pruebas protegidas (en rojo)

- [ ] T23 · test-writer · Pruebas protegidas del historial y el detalle: permisos de las tres rutas, alcance de la
      `SECRETARIA` (cajas que abrió, que cerró y la abierta; las demás, 404 en el detalle y el PDF), otra academia,
      rango de fechas y su validación (criterios 7 y 8 en su parte de 006b, 40 y 41)
- [ ] T24 · test-writer · Pruebas protegidas del PDF: cabeceras, alcance y 404 por caja, por número y por alcance;
      generación fuera de la transacción (el cierre no crea archivos; una falla de `pdfkit` simulada da 500 sin cambiar
      nada; dos descargas iguales) (criterios 42 en su parte crítica y 43)
- [ ] T25 · tester · Confirmar que T23 y T24 fallan por la razón esperada. Commit del orquestador: "Pruebas protegidas
      (006b): historial y PDF del cierre (en rojo)"

### Implementación

- [ ] T26 · backend · `pdfkit` y `@types/pdfkit` en `backend/package.json` y en `DEPENDENCIAS_BACKEND_PERMITIDAS`
      (criterio 127 de 001; DT-3); contratos del historial (criterios 40, 42)
- [ ] T27 · backend · `historial.service.ts`, rutas `GET /api/cajas` y `GET /api/cajas/{id}` con el alcance `SU_CAJA`
      (DR-9) (criterios 40, 41)
- [ ] T28 · backend · `pdf/cierre-pdf.ts` y la ruta del PDF; prueba no protegida del contenido extrayendo el texto
      (criterios 42, 43)
- [ ] T29 · frontend · `/panel/cajas` y la opción "Historial de caja": lista con filtro, detalle, descarga del PDF y
      reapertura para el `ADMIN`; pruebas de componentes (criterio 44)
- [ ] T30 · tester · Pruebas protegidas en verde y suite completa

### Ataque, revisión y cierre

- [ ] T31 · adversarial · Atacar los criterios críticos de la 006b: cajas, cierres y PDF de otra academia o fuera del
      alcance de la secretaria (ids, números de cierre, mayúsculas, parámetros repetidos), rangos de fechas extremos, y
      textos raros en el PDF. Por cada falla, el mismo ciclo que T18.
- [ ] T32 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T33 · revisor · Comparar con la spec y las convenciones; verificar la parte de 006b de los criterios 45 y 46
- [ ] T34 · tester · Suite completa, lint y verificación de tipos
- [ ] T35 · documentador · Commit, tareas marcadas, documentación del historial y del PDF (criterio 46)

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo (006a)
- [x] Pruebas en verde tras la implementación (006a)
- [ ] Ataque adversarial sin fallas abiertas (006a) _(pendiente de T42)_
- [ ] Pruebas escritas por test-writer y confirmadas en rojo (006b)
- [ ] Pruebas en verde tras la implementación (006b)
- [ ] Ataque adversarial sin fallas abiertas (006b)
