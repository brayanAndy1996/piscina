# 007 · Tareas

Cada tarea indica su rol y los criterios de [`spec.md`](spec.md) que cubre. Las de la 007b llevan **[007b]** y van en
el segundo PR, con la 007a ya unida a `main`.

## 0. Aprobación

- [x] T0.1 · orquestador · Mostrar a Bryan P1 a P14 con sus propuestas y decidir T1 a T16; el especificador pasa las
  respuestas a «Decisiones» y ajusta los criterios marcados «provisional» (todos). Hecho el 24/11/2026: DR-1 a DR-14
  (todas con la propuesta) y DT-1 a DT-16 (aceptadas por el orquestador)
- [x] T0.2 · orquestador · Decidir T17 a T19 de la spec (pruebas protegidas anteriores que no se pueden ajustar solo
  sumando) antes del commit de pruebas protegidas de la 007a; el especificador las pasa a DT-17 a DT-19. Hecho el
  24/11/2026: DT-17 a DT-19, con la propuesta

## 007a · Cobro en recepción y cuenta del alumno

Estado (24/11/2026): pruebas protegidas en rojo (fe9542b), servidor y contratos (ecee212), pantallas (75354ec), ronda
adversarial 1 cerrada (pruebas 544717b, corrección b3230fa), ronda 2 corregida (pruebas e80d5ae) y ronda 3 con dos
fallas del criterio 59, precisado como 59 d (25/11/2026; T54 a T60), cerrada (pruebas 820cd22, corrección 65aa1f0).
La ronda 4 (25/11/2026) quedó sin fallas dentro del modelo de amenaza (criterio 59 e): el ataque adversarial de la 007a
está cerrado. Quedan abiertas la revisión (T27), la verificación completa (T28) y el cierre con la documentación (T29).
La spec y el plan se
alinearon con las desviaciones que aceptó el revisor («Alineación con la revisión de la 007a» en la spec); T24 sigue
abierta hasta que exista la prueba no protegida de la semilla.

### Pruebas protegidas (antes del código)

- [x] T1 · test-writer · Catálogo, privilegios, RLS, llaves (también la diferida), `CHECK`, índices y triggers de `pagos`;
  `CONFIRMADA` y `registrada_por` (criterios 1 a 7)
- [x] T2 · test-writer · Ampliar las pruebas protegidas anteriores de la lista «Pruebas protegidas anteriores que amplía
  la 007a» (spec, «Decisiones»): 001 (listas exactas), 002 (matriz de 26 filas, DT-12), 005 (tablas, privilegios y
  claves del elemento del panel) y 006 (llave de `pago_id` y pago `CONFIRMADO` en la misma transacción que su ingreso,
  dentro de las utilidades), solo sumando y con la línea «Actualizada por la 007» en el encabezado; y los tres
  cambios aprobados por el orquestador que no son solo una suma (DT-17 a DT-19). Lo revisa el orquestador con `git diff` antes del commit (Impacto)
- [x] T3 · test-writer · Permisos y aislamiento de las rutas de la 007a; actor vigente (criterios 8 y 9)
- [x] T4 · test-writer · Total a cobrar, ajuste y ajuste frente a cobro (criterios 10 a 12)
- [x] T5 · test-writer · Cobro en efectivo: correcto, caja, estados, monto, idempotencia, cupo con la reserva que vence,
  interbloqueos (criterios 13 a 19)
- [x] T6 · test-writer · Paso de cliente a alumno, ingreso con DNI y cambio obligatorio, DNI del personal, registro
  técnico sin DNI ni clave, seguimiento confirmado (criterios 20 a 24)
- [x] T7 · test-writer · Aislamiento y permiso del ticket (criterio 26, parte crítica)
- [x] T8 · test-writer · Estados nuevos de la 007a en la vista, el panel, la cancelación, la foto y el envío (criterios 28
  a 32, sin las partes [007b])
- [x] T9 · test-writer · Recepción sin los límites por conexión: middleware, envío con actor, `registrada_por`, foto
  (criterios 33 a 35)
- [x] T10 · test-writer · Correo `PAGO_CONFIRMADO` después de confirmar, destinatarios y fallos (criterio 51 a)
- [x] T11 · tester · Confirmar que T1 y T3 a T10 fallan por la razón esperada (y que las ampliadas en T2, y las de
  `backend/test/integracion/caja/` que usan sus utilidades sin haber sido editadas, fallan solo por lo que suma la
  007a: la tabla `pagos` que todavía no existe; lista en la spec); commit «Pruebas protegidas (007): 007a, … (en rojo)» (tres dígitos y sin letra en el paréntesis;
  la entrega va después) _(hecho: commit fe9542b)_

### Implementación

- [x] T12 · backend · Migraciones `<marca>_estado_solicitud_confirmada` y `<marca>_pagos`; `schema.prisma`;
  `PRIVILEGIOS_APP`, `rol-app.mjs`, `TABLAS_DESPUES_DE_MIGRAR`; utilidades de pruebas (criterios 1 a 7)
  _(hecho: ecee212)_
- [x] T13 · backend · Contratos: `pagos.ts`, `solicitudes.ts` (estados, vistas, panel, filtro), `permisos.ts`
  (criterios 8, 28 y 29) _(hecho: ecee212. Alineación con la revisión: `montoMostrado` con `montoCotizadoSchema`,
  criterio 16; la respuesta del cobro `{ pago, solicitud }` en `solicitudes.ts`, en curso en el backend)_
- [x] T14 · backend · Módulo `pagos/`: `totalACobrar`, `bloquearFilasDelCobro`, `confirmarPagoEnTransaccion`, errores
  (criterios 10, 19, 20, 21, 25) _(hecho: ecee212. Alineación con la revisión: firmas reales en «Interfaces del
  backend»; `totalACobrar` con `montoCalculado` obligatorio, en curso en el backend; `dominio/estado-pago.ts`
  eliminado por no usarse)_
- [x] T15 · backend · Cobro en efectivo y ajuste del monto, con sus rutas (criterios 11 a 18, 22 a) _(hecho: ecee212)_
- [x] T16 · backend · `crearPersonal` con el consultivo del DNI y la comprobación de alumnos (criterio 22 b y c)
  _(hecho: ecee212)_
- [x] T17 · backend · Estado visible, seguimiento, lista y cancelación del panel, foto y envío con los estados nuevos
  (criterios 24, 28 a 32) _(hecho: ecee212; los valores por defecto de las ramas de la 007b quedan como nota en el
  plan, «Notas para la 007b»)_
- [x] T18 · backend · Sesión de recepción en el middleware de `/api/a` y en el envío (criterios 33 a 35)
  _(hecho: ecee212)_
- [x] T19 · backend · Ticket: número y `GET /api/pagos/{id}/ticket` (criterios 25 y 26) _(hecho: ecee212)_
- [x] T20 · backend · Plantilla y envío del correo `PAGO_CONFIRMADO` (criterio 51 a) _(hecho: ecee212)_
- [x] T21 · frontend · Panel de solicitudes: estados, total, ajuste, «Cobrar en efectivo» con el aviso de la caja,
  «Ajustar monto» (criterio 54, partes de la 007a) _(hecho: 75354ec)_
- [x] T22 · frontend · Página imprimible del ticket y opción en el inicio (criterios 27 y 56, parte del ticket)
  _(hecho: 75354ec)_
- [x] T23 · frontend · Seguimiento de una solicitud confirmada (criterios 24 y 28) _(hecho: 75354ec)_
- [ ] T24 · backend · Semilla: un ajuste de ejemplo, sin auditoría como el resto de los datos de ejemplo, con una prueba
  no protegida de la semilla (criterio 57, parte de la 007a) _(el ajuste está desde ecee212; falta la prueba no
  protegida de la semilla que pidió el revisor)_

### Ataque, revisión y cierre

- [x] T25 · adversarial · Ataque de la 007a (criterios críticos de la 007a; foco en caja de otro día, doble clic, último
  cupo con la reserva que vence, DNI del personal, sesión de recepción falsificada o de otra academia, aislamiento)
  _(ronda 1 hecha: dos fallas, criterios 58 y 59; la ronda 2 es T53)_
- [x] T26 · especificador · Criterios nuevos de cada falla, con su origen
      _(ronda 1, 24/11/2026: dos fallas, criterios 58 y 59, y la pregunta técnica T20; ver más abajo)_
- [ ] T27 · revisor · Comparar con la spec y las convenciones; `git diff` de las pruebas protegidas
      _(en curso: el revisor aceptó cinco desviaciones, ya alineadas en la spec y el plan)_
- [ ] T28 · tester · Suite completa, lint y tipos
- [ ] T29 · documentador · `docs/arquitectura.md`, `README.md`, guía de uso, `specs/backlog.md`; commit (criterio 57)

### Ataque adversarial de la 007a, ronda 1 (24/11/2026)

Dos fallas, que se convirtieron en los criterios 58 y 59 de `spec.md`, los dos críticos y de la 007a (diseño y
precisiones de las pruebas en el plan, «Ronda adversarial 1 de la 007a»):

- **Criterio 58 (amplía el 5):** quedaba un `INGRESO` con el `pago_id` de un pago pendiente al `COMMIT`. Pasaba con el
  modo `IMMEDIATE` y con un cambio de `app.academia_id` antes del `COMMIT`, como app y como dueño.
- **Criterio 59:** una fecha no válida dañaba el generador de ids de la auditoría para todo el proceso.

Estas tareas van antes de T27. T20 de la spec (58 d) quedó con su valor provisional, incluido (entró en las pruebas de
T47 y en la migración de T49).

- [x] T47 · test-writer · Escribir las pruebas protegidas en rojo, desde la spec y los contratos públicos, sin mirar la
      implementación y con la marca `// spec: 007-pagos (pruebas protegidas)`:
      - **Criterio 58**, en `backend/test/integracion/pagos/confirmado-con-movimiento-ronda1.test.ts`, como `app` y
        como `propietario`:
        - a: el pago pendiente y su movimiento en los dos órdenes; pendiente, movimiento y paso a `RECHAZADO`; un
          movimiento para un pago pendiente o rechazado ya guardado;
        - b: las dos reproducciones con `IMMEDIATE`, la del nombre del trigger y la de `ALL`;
        - c: `app.academia_id` cambiado a `''` y a B antes del `COMMIT`, con un pago pendiente y con un pago
          `CONFIRMADO` con un movimiento que no coincide;
        - d: como dueño, el `UPDATE` de cada columna y el `DELETE` del movimiento de un pago `CONFIRMADO`;
        - e: los controles.

        En cada caso se comprueba el código y, con otra conexión, que no quedó nada y que lo anterior sigue igual.
      - **Criterio 59**, en `backend/src/modulos/auditoria/id-ordenado.test.ts`: los rechazos de a, la continuidad de b
        (formato, unicidad, orden creciente, desborde del contador, reloj que retrocede) y el máximo de c, con
        `vi.resetModules()` para los casos que necesitan un generador limpio.

      Commit: «Pruebas protegidas (007): 007a, ataque ronda 1: movimiento de caja solo con pago confirmado e ids de la
      auditoría (en rojo)» (criterios 58, 59) _(hecho: commit 544717b)_
- [x] T48 · tester · Confirmar que T47 falla por la razón esperada y no por sintaxis, importaciones ni configuración:
      - **58 b, c y d:** la transacción se confirma sin error y queda el movimiento del pago pendiente; en d, el
        `UPDATE` o el `DELETE` se confirman;
      - **59:** después de `new Date(NaN)` no hay `RangeError` y las ids siguientes no cumplen el formato.

      Los casos de 58 a y los controles de 58 e pueden pasar ya: se confirma que pasan y que no son la razón del rojo.
      Las pruebas protegidas anteriores siguen pasando, en especial `confirmado-con-movimiento.test.ts` y la del
      criterio 3, y `git diff --cached --stat` solo muestra archivos de prueba. El orquestador hace el commit con el
      título de T47 (criterios 58, 59). _(hecho: rojo confirmado por la razón esperada)_
- [x] T49 · backend · Migración `<marca>_pagos_movimiento_confirmado`: las funciones del trigger rechazan si no ven la
      fila, leen el estado actual, `pagos` revisa también los pagos no confirmados, y el trigger de `movimientos_caja`
      pasa a `AFTER INSERT OR UPDATE OR DELETE`. Mismos nombres, `SECURITY INVOKER`, `search_path` fijo y `REVOKE`. Sin
      editar `<marca>_pagos` (plan, «Ronda adversarial 1 de la 007a») (criterio 58)
      _(hecho en `20261124190000_pagos_movimiento_confirmado`; suma el trigger por sentencia
      `movimientos_caja_no_cambian`, que rechaza todo `UPDATE` o `DELETE` porque la RLS sin políticas de `UPDATE` ni
      `DELETE` dejaba sin correr el trigger por fila; ver la corrección en el plan y la precisión de 58 d)_
- [x] T50 · backend · `idDeAuditoriaOrdenado`: validar la fecha y calcular el estado nuevo en variables locales antes
      de asignarlo; `RangeError` sin la fecha en el mensaje (criterio 59) _(hecho: commit b3230fa, con T49)_
- [x] T51 · tester · Correr en verde las pruebas protegidas de T47 y todas las anteriores, y la suite completa, el lint
      y los tipos (criterios 58, 59) _(ronda 1 cerrada con b3230fa; la verificación completa final de la 007a es T28)_
- [x] T52 · orquestador · Revisar con `git diff` desde el commit de T47 que T49 y T50 no tocaron pruebas protegidas
      _(ronda 1 cerrada con b3230fa)_
- [x] T53 · adversarial · Ronda 2 sobre todo lo de la 007a, en especial los criterios 58 y 59:
      - otras formas de saltarse los triggers diferidos (`SET CONSTRAINTS`, cambios de contexto, `UPDATE` y `DELETE`
        del dueño, varias escrituras sobre la misma fila en una transacción);
      - el generador con fechas límite y llamadas seguidas;
      - lo que no se atacó en la ronda 1.

      Si hay fallas, se repite el ciclo (especificador, test-writer en rojo, corrección) hasta una ronda sin fallas.
      _(ronda 2: falsos `Date` en el id de la auditoría, pruebas protegidas e80d5ae, corregida. Ronda 3: dos fallas
      del criterio 59, ver más abajo, cerrada con 65aa1f0. Ronda 4 (T60): sin fallas dentro del modelo de amenaza)_

### Ataque adversarial de la 007a, ronda 3 (25/11/2026)

Dos fallas de `backend/src/modulos/auditoria/id-ordenado.ts` contra el criterio 59, que la spec precisa como 59 d
(«Qué es un `Date`»), crítico y de la 007a, sin cambios de negocio (diseño y precisiones de las pruebas en el plan,
«Rondas adversariales 2 y 3 de la 007a»):

- un `Proxy` revocado o con una trampa `getPrototypeOf` que lanza hace que `instanceof Date`, fuera del `try`, propague
  un `TypeError` o el error de la trampa en lugar de `RangeError`;
- un `Date` real de otro contexto (`vm.runInNewContext`) o con el prototipo cambiado no pasa `instanceof Date` y se
  rechaza, aunque tiene la ranura de fecha y un instante válido.

Estas tareas van antes de T27.

- [x] T54 · especificador · Precisión 59 d en `spec.md` (origen: ronda adversarial 3 de la 007a), diseño y
      precisiones de las pruebas en el plan; nota para la 007b sobre el pago `CONFIRMADO` en la vista del seguimiento
      (plan, «Notas para la 007b») (criterio 59)
- [x] T55 · test-writer · Escribir la prueba protegida en rojo en
      `backend/src/modulos/auditoria/id-ordenado-ronda3.test.ts`, desde la spec y la firma pública, sin mirar la
      implementación y con la marca `// spec: 007-pagos (pruebas protegidas)`: los `Proxy` (revocado, con
      `getPrototypeOf` que lanza, con `get`, `has` y `getOwnPropertyDescriptor` que lanzan, sin trampas, de un falso
      `Date`) y los primitivos `bigint`, símbolo y booleano lanzan `RangeError`; el `Date` de `vm`, con el prototipo
      cambiado a `null` o a `{}`, de una subclase y con un `getTime` propio devuelven una id válida con los
      milisegundos de la ranura; los de `vm` y prototipo `null` con instante no válido lanzan `RangeError`; en todos,
      ids válidas, distintas y crecientes antes y después (plan, «Precisiones de las pruebas (criterio 59 d)»). Sin
      editar `id-ordenado.test.ts`. Commit: «Pruebas protegidas (007): 007a, ataque ronda 3: un Date se reconoce por su
      ranura y no por instanceof (en rojo)» (criterio 59 a, b y d) _(hecho: commit 820cd22)_
- [x] T56 · tester · Confirmar que T55 falla por la razón esperada y no por sintaxis, importaciones ni configuración:
      - los `Proxy` revocado y con `getPrototypeOf` que lanza dan `TypeError` o el `Error` de la trampa, no
        `RangeError`;
      - el `Date` de `vm` y los de prototipo cambiado lanzan `RangeError` en lugar de devolver una id.

      Los demás casos (otros `Proxy`, primitivos, subclase, `getTime` propio, instantes no válidos) pueden pasar ya: se
      confirma que pasan y que no son la razón del rojo. `id-ordenado.test.ts` (rondas 1 y 2) sigue en verde y `git
      diff --cached --stat` solo muestra el archivo nuevo. El orquestador hace el commit con el título de T55
      _(hecho: rojo confirmado por la razón esperada; commit 820cd22)_
- [x] T57 · backend · `idDeAuditoriaOrdenado`: quitar `instanceof Date`; leer el instante solo con el `getTime` de
      `Date.prototype` capturado al cargar el módulo, con `.call` dentro del `try`, y `RangeError` sin la causa ni la
      fecha si lanza; actualizar el comentario de la función. Sin tocar las pruebas protegidas (criterio 59 d; plan,
      «Rondas adversariales 2 y 3 de la 007a») _(hecho: commit 65aa1f0)_
- [x] T58 · tester · Correr en verde T55, `id-ordenado.test.ts` y todas las pruebas protegidas anteriores, y la suite
      completa, el lint y los tipos (criterio 59) _(hecho con 65aa1f0; la verificación completa final de la 007a es
      T28)_
- [x] T59 · orquestador · Revisar con `git diff` desde el commit de T55 que T57 no tocó pruebas protegidas
      _(hecho con 65aa1f0)_
- [x] T60 · adversarial · Ronda 4 sobre todo lo de la 007a, con foco en el criterio 59 d (otros valores exóticos:
      `Proxy` anidados, `Date` congelados o sellados, subclases con `Symbol.species` o `getTime` sobrescrito,
      `Date.prototype.getTime` reemplazado en el proceso después de cargar el módulo) y en lo que no se atacó en las
      rondas 1 a 3. Si hay fallas, se repite el ciclo hasta una ronda sin fallas
      _(hecho, 25/11/2026: sin fallas dentro del modelo de amenaza; 9105 ids correctas con las entradas de 59 a a d.
      Las dos fallas que exigen modificar objetos nativos del proceso quedaron fuera del modelo de amenaza (criterio
      59 e), con el endurecimiento de T61, sin prueba protegida nueva)_
- [ ] T61 · backend · Endurecimiento de la ronda 4, sin prueba protegida nueva: `Function.prototype.call.bind(
      Date.prototype.getTime)` al cargar el módulo, `Number.isSafeInteger` guardado y la comprobación del rango en
      positivo para que un `NaN` se rechace siempre; comentario «endurecimiento, no garantía». Las pruebas protegidas
      del criterio 59 siguen en verde (criterio 59 e; plan, «Ronda adversarial 4 de la 007a»)

## 007b · Yape y transferencia **[007b]**

### Pruebas protegidas (antes del código)

- [ ] T30 · test-writer · Subida del comprobante: orden de comprobaciones, datos, número sin duplicados, imagen sin
  metadatos, estados, reintento tras rechazo con cupo, idempotencia, límite y registro técnico, reserva sin límite
  (criterios 36 a 44)
- [ ] T31 · test-writer · Bandeja, comprobante con `HEAD`, aprobar, aprobar dos veces, aprobar y rechazar a la vez,
  rechazar, cupo liberado, mes terminado (criterios 45 a 50 y 52)
- [ ] T32 · test-writer · Partes [007b] de los criterios 11, 15, 18 c, 21, 28 a 32; correo `PAGO_RECHAZADO` (criterio 51 b)
- [ ] T33 · tester · Confirmar en rojo; commit «Pruebas protegidas (007): 007b, … (en rojo)»

### Implementación

- [ ] T34 · backend · Contratos de la 007b (`datosComprobanteSchema`, `pagoPendienteSchema`, `rechazarPagoSchema`,
  constantes) y claves de configuración de los datos de pago (criterios 36, 45, 49 y 53)
- [ ] T35 · backend · Regla `comprobante`, lector binario, `RUTAS_REDACTADAS`, servicio y ruta pública del comprobante
  (criterios 36 a 44)
- [ ] T36 · backend · Bandeja, comprobante y `HEAD` 404 en `/api/pagos` (criterios 45 y 46)
- [ ] T37 · backend · Aprobación con `confirmarPagoEnTransaccion` (sin `nuevo`) y la variante de `bloquearFilasDelCobro`
  por `pagoId`, que lee el DNI desde el pago; rechazo con el cupo y el correo (criterios 47 a 52; plan, «Notas para la
  007b»). Si hacen falta las transiciones como función pura, recrear `dominio/estado-pago.ts` con su prueba
- [ ] T38 · backend · Estados `EN_VERIFICACION` y `PAGO_RECHAZADO` en el seguimiento, el panel, la cancelación, la foto y
  el cobro en efectivo y el ajuste del monto (partes [007b] de 11, 15, 18, 28 a 32). Revisar los valores por defecto de
  `seguimiento.service.ts` (líneas 176, 179, 190 y 192; plan, «Notas para la 007b»)
- [ ] T39 · frontend · Seguimiento: estados, datos de pago y formulario del comprobante (criterios 53 y 55)
- [ ] T40 · frontend · Bandeja `/panel/pagos` y configuración de los datos de pago (criterios 53 y 56)
- [ ] T41 · backend · Semilla: Yape pendiente con comprobante de ejemplo y datos de pago (criterio 57, parte de la 007b)

### Ataque, revisión y cierre

- [ ] T42 · adversarial · Ataque de la 007b (número de operación con espacios, ceros, mayúsculas y ancho completo;
  aprobar dos veces o un rechazado; caja de otro día; `HEAD` y archivos; token y aislamiento; último cupo en el
  reintento; fin de mes)
- [ ] T43 · especificador · Criterios nuevos de cada falla, con su origen
- [ ] T44 · revisor · Comparar con la spec; `git diff` de las pruebas protegidas
- [ ] T45 · tester · Suite completa, lint y tipos
- [ ] T46 · documentador · Documentación y `specs/backlog.md`; commit (criterio 57)

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo (007a) _(fe9542b; rondas: 544717b, e80d5ae y 820cd22)_
- [x] Pruebas en verde tras la implementación (007a) _(ronda 3 en verde con 65aa1f0; la verificación completa final
  es T28)_
- [x] Ataque adversarial sin fallas abiertas (007a) _(ronda 4, 25/11/2026: sin fallas dentro del modelo de amenaza,
  criterio 59 e)_
- [ ] Pruebas escritas por test-writer y confirmadas en rojo (007b)
- [ ] Pruebas en verde tras la implementación (007b)
- [ ] Ataque adversarial sin fallas abiertas (007b)
