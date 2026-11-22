# 006 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia de ruta crítica,
dividida en dos entregas (DR-10 de la spec), cada una con sus pruebas protegidas, su ataque y su PR:

- **006a · Caja del día** (T1 a T22, y T36 a T42 de la ronda adversarial 1): criterios 1 a 39, 45 y 46 sin el
  historial ni el PDF, y 47 y 48. Se construye primero.
- **006b · Historial y PDF del cierre** (T23 a T35, marca **[006b, siguiente PR]**, y T43 a T50 de la ronda
  adversarial 1): criterios 40 a 44, 49 y 50, y la parte de 45 y 46 que les toca. Se empieza con la 006a unida a
  `main`.

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
- [x] T42 · adversarial · Ronda 2 sobre todo lo de la 006a, en especial 47 y 48 (Unicode en el comprobante y la
      descripción, la idempotencia con comprobantes normalizados, llamadas directas a las interfaces con entradas mal
      formadas) y las carreras pendientes de PP8; si hay fallas, se repite el ciclo hasta una ronda sin fallas
      _(ronda 2 sobre `88b8d4e`, 22/11/2026: sin fallas; observaciones aceptadas sin cambio de spec, registradas en el
      encabezado de `spec.md`)_

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

Las precisiones PQ1 a PQ15 de la spec (sección I) fijan los formatos, el orden, los 404 y las cabeceras.

- [ ] T23 · test-writer · Pruebas protegidas del historial y el detalle: permisos de las tres rutas con el orden de PQ1
      (sin sesión, cambio obligatorio, academia suspendida, cookie del Superadmin; 403 aunque el id o la consulta sean
      inválidos); alcance con el escenario C1 a C5 de PQ2 (lista filtrada; 404 en el detalle y en el PDF, con el mismo
      cuerpo que otra academia, un id inexistente y uno que no es UUID); `?academiaId=` ignorado; consulta, valores por
      defecto y reglas del rango con los ejemplos de PQ3 (también con `TZ=Asia/Tokyo`); forma exacta, orden y totales de
      cada caja (PQ4); detalle igual a `/actual` para la misma caja (PQ5); `PATCH`, `PUT`, `DELETE` y `POST` que siguen
      en 404 (PQ15); prueba de 001 de `DEPENDENCIAS_BACKEND_PERMITIDAS` que suma `pdfkit` y `@types/pdfkit`, solo para
      sumar (PQ13) (criterios 7 y 8 en su parte de 006b, 23, 40 y 41)
- [ ] T24 · test-writer · Pruebas protegidas del PDF: `numero` inválidos e inexistentes (PQ6), cierres vigentes y
      reabiertos, caja nunca cerrada; cabeceras y cuerpo exactos (PQ7); generador reemplazado con
      `overrideProvider(GENERADOR_PDF_CIERRE)` (PQ8): el cierre y las demás escrituras no lo llaman ni crean archivos,
      falla del generador (promesa rechazada y excepción) con 500 sin cambios, la lectura ya terminó mientras genera
      (`pg_stat_activity`), dos descargas con los mismos bytes, también con `TZ=Asia/Tokyo` (PQ9); utilidad
      `backend/test/utilidades/pdf.ts` para extraer el texto (PQ10) (criterios 42 en su parte crítica y 43)
- [ ] T25 · tester · Confirmar que T23 y T24 fallan por la razón esperada (rutas, esquemas, token o dependencia
      inexistentes) y no por sintaxis, importaciones o configuración; que las pruebas protegidas de 001 a 006a siguen
      pasando; y `git diff --cached --stat` solo con archivos de prueba. Commit del orquestador: "Pruebas protegidas
      (006): 006b, historial y PDF del cierre (en rojo)" (tres dígitos, sin la letra: lo exige
      `scripts/verificar-pruebas-protegidas.mjs`)

### Implementación

- [ ] T26 · backend · `pdfkit` y `@types/pdfkit` en `backend/package.json` y en `DEPENDENCIAS_BACKEND_PERMITIDAS`
      (criterio 127 de 001; DT-3); contratos del historial (`filtroHistorialCajasSchema`, `cajaHistorialSchema`,
      `respuestaHistorialCajasSchema`, `LIMITES_HISTORIAL_CAJAS`) y `formatearSoles` movida a `dinero.ts`, con pruebas
      unitarias no protegidas (PQ3, PQ4, PQ10, PQ13) (criterios 40, 42)
- [ ] T27 · backend · `historial.service.ts`, rutas `GET /api/cajas` y `GET /api/cajas/{id}` con el alcance de PQ2
      (DR-9 y DR-13), la consulta cruda y los valores por defecto de PQ3 y una sola consulta para la lista (criterios 40,
      41)
- [ ] T28 · backend · `pdf/cierre-pdf.ts` (`generarPdfCierre`, `GeneradorPdfCierre`, `GENERADOR_PDF_CIERRE`),
      `pdf/texto-pdf.ts` (`textoParaPdf`) y la ruta del PDF (lectura en su transacción, generación fuera, cabeceras de
      PQ7); pruebas no protegidas del contenido de PQ10 extrayendo el texto y unitarias de `textoParaPdf` con los
      ejemplos de PQ11 (criterios 42, 43)
- [ ] T29 · frontend · `/panel/cajas` y `/panel/cajas/:id`, y la opción "Historial de caja": lista con filtro y rango
      aplicado, detalle de solo lectura, descarga del PDF, reapertura para el `ADMIN` con el texto de un día anterior,
      claves de consulta con la identidad; pruebas de componentes (PQ12) (criterio 44)
- [ ] T30 · tester · Pruebas protegidas en verde y suite completa

### Ataque

- [ ] T31 · adversarial · Atacar los criterios críticos de la 006b: cajas, cierres y PDF de otra academia o fuera del
      alcance de la secretaria (ids, números de cierre, mayúsculas, parámetros repetidos), rangos de fechas extremos, y
      textos raros en el PDF (PQ11). Por cada falla, el mismo ciclo que T18; el commit de cada ronda empieza también por
      "Pruebas protegidas (006): 006b, …".
      _(ronda 1 sobre `838e88c`: dos fallas, criterios 49 y 50; ver más abajo)_

### Ataque adversarial de la 006b, ronda 1 (22/11/2026, sobre `838e88c`)

Hubo dos fallas, que se convirtieron en los criterios 49 y 50 de `spec.md`, los dos críticos:

- **Criterio 49:** el PDF de una caja con muchos movimientos bloqueaba el bucle de eventos, y un egreso de otra academia
  respondía 500.
- **Criterio 50:** `HEAD` sobre la ruta del PDF respondía 200 y llamaba al generador.

Según DT-7, no hay tope de movimientos por caja. El límite por persona del criterio 49 c es DT-8, y `HEAD` da 404 solo
en las rutas de la caja según DT-9.

- [ ] T43 · test-writer · Escribir las pruebas protegidas en rojo, desde la spec y los contratos públicos, sin mirar la
      implementación y con la marca de pruebas protegidas.
      - **Criterio 49 a.** Integración con el generador real:
        - una caja de A con 5 000 movimientos creados como dueño, en una sola sentencia para que la preparación no
          tarde;
        - una descarga de calentamiento de un cierre pequeño;
        - `monitorEventLoopDelay` con resolución de 10 ms;
        - tres descargas simultáneas, dos del `ADMIN` de A y una de la `SECRETARIA` que abrió la caja;
        - el egreso de la `SECRETARIA` de B, enviado 300 ms después.

        Se comprueba:
        - el egreso responde 201 en menos de 1 000 ms, con su fila y su auditoría;
        - las descargas y el egreso se cruzaron;
        - las tres descargas responden 200 con los mismos bytes, y el texto contiene los movimientos 1 y 5000;
        - el `max` del bucle es de 200 ms o menos.

        La prueba lleva un tiempo límite amplio, por ejemplo 120 s.
      - **Criterio 49 b.** Con el generador retenido:
        - diez descargas de cinco personas de A y de B, dos cada una;
        - el generador nunca tiene más de dos llamadas en curso;
        - mientras esperan, no hay conexiones `idle in transaction`;
        - la 11.ª descarga, de una sexta persona, responde 429 `DEMASIADAS_SOLICITUDES` (JSON, `no-store`, sin
          `Content-Disposition`), sin llamar al generador ni escribir;
        - con la cola llena, `numero` `0` responde 404, no 429;
        - al soltar el generador, hay diez 200 y diez llamadas;
        - el lugar se libera después de 12 descargas en 500 y 12 en 404.
      - **Criterio 49 c.**
        - La tercera descarga simultánea de la misma persona responde 429.
        - Las descargas de otras personas siguen.
        - Cuando terminan sus dos descargas, la misma persona vuelve a descargar con 200.
      - **Criterio 50.** `HEAD` sobre las cuatro rutas:
        - con las sesiones de los cuatro roles;
        - con ids y números que existen, que no existen y que no son válidos;
        - con parámetros de consulta, barra final y mayúsculas.

        Se comprueba:
        - responde 404 con `application/json` y `no-store`, sin `Content-Disposition` y sin cuerpo;
        - el generador espía no recibe llamadas;
        - las filas y la auditoría no cambian;
        - sin sesión, responde lo mismo que `PATCH`;
        - control: el `GET` de las cuatro rutas sigue respondiendo.

      Commit: "Pruebas protegidas (006): 006b, ataque ronda 1: PDF sin detener la API y HEAD en las rutas de la caja (en
      rojo)" (criterios 49, 50)
- [ ] T44 · tester · Confirmar que T43 falla por la razón esperada y no por sintaxis, importaciones, configuración ni el
      tiempo límite de Vitest. Las razones esperadas son:
      - **49 a:** el egreso de B tarda más de 1 000 ms o responde 500, y el retraso del bucle pasa de 200 ms;
      - **49 b y c:** el generador recibe más de dos llamadas a la vez y no hay 429;
      - **50:** `HEAD` responde 200, lleva `Content-Disposition` o llama al generador.

      Confirmar también que las pruebas protegidas anteriores siguen pasando y que `git diff --cached --stat` solo
      muestra archivos de prueba. El orquestador hace el commit con el título de T43: tres dígitos y sin letra, como
      exige `scripts/verificar-pruebas-protegidas.mjs` (criterios 49, 50).
- [ ] T45 · backend · El PDF sin bloquear el bucle de eventos (criterio 49 a y d), con la técnica que se elija (plan
      2.12):
      - `generarPdfCierre`, `GeneradorPdfCierre` y `GENERADOR_PDF_CIERRE` quedan como en PQ8;
      - los bytes no cambian;
      - si se usa un worker, funciona bajo Vitest y en el build CommonJS, también en Windows;
      - las pruebas de `cierre-pdf.test.ts` siguen pasando.
- [ ] T46 · backend · La cola de generación y el límite por persona (criterio 49 b y c): `ColaPdfCierre` y
      `LIMITES_PDF_CIERRE`, el turno antes de la lectura, la liberación en `finally` y el 429 por el filtro de errores.
      Poner al día los comentarios de `HistorialService` y de `CajasController`.
- [ ] T47 · backend · `HEAD` responde 404 en las rutas de la caja (criterio 50), con un middleware antes de las rutas
      de Nest (plan 2.12). Poner al día el comentario de PQ15 en `CajasController`.
- [ ] T48 · tester · Correr en verde las pruebas protegidas (T43 y todas las anteriores, incluidas las de PQ9 y PQ15) y
      la suite completa. Correr la prueba del 49 a al menos cinco veces seguidas para descartar que sea inestable
      (criterios 49, 50).
- [ ] T49 · orquestador · Revisar con `git diff` desde el commit de T43 que T45 a T47 no tocaron pruebas protegidas.
- [ ] T50 · adversarial · Ronda 2 sobre todo lo de la 006b, en especial los criterios 49 y 50:
      - cajas con muchos movimientos;
      - descargas simultáneas de varias academias y de una misma persona;
      - cola llena;
      - clientes que cortan la conexión mientras esperan o mientras se genera;
      - `HEAD` y otros métodos sobre las rutas de la caja, con variantes de la dirección.

      Si hay fallas, se repite el ciclo hasta una ronda sin fallas.

### Revisión y cierre

- [ ] T32 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T33 · revisor · Comparar con la spec y las convenciones; verificar la parte de 006b de los criterios 45 y 46
- [ ] T34 · tester · Suite completa, lint y verificación de tipos
- [ ] T35 · documentador · Commit, tareas marcadas, documentación del historial y del PDF; en la guía de uso, filtrar
      "Desde 01/11/2026" para ver la caja de ejemplo (PQ14) (criterios 45 y 46)

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo (006a)
- [x] Pruebas en verde tras la implementación (006a)
- [x] Ataque adversarial sin fallas abiertas (006a) _(ronda 2 sobre `88b8d4e` sin fallas, T42)_
- [ ] Pruebas escritas por test-writer y confirmadas en rojo (006b)
- [ ] Pruebas en verde tras la implementación (006b)
- [ ] Ataque adversarial sin fallas abiertas (006b)
