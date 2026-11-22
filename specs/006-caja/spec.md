# 006 · Caja

- **Historias y requerimientos:** HU-25 (abrir la caja del día con un monto inicial), HU-26 (cada cobro entra solo a la
  caja con su concepto, método, monto, alumno y usuario; egresos menores con concepto, monto y comprobante opcional),
  HU-27 (cierre declarando el efectivo contado; esperado por método de pago: efectivo, Yape y transferencia; diferencia,
  sobrante o faltante, con su observación; PDF del cierre; el administrador ve y reabre un cierre, con auditoría), RN-17
  (la caja se abre antes de registrar cobros y se cierra al final del día; una caja cerrada no admite movimientos), RN-22
  y RNF-06 (toda operación de caja queda en auditoría: quién, cuándo y qué), RNF-12 (America/Lima, soles); sección 2.1
  ("Abrir y cerrar caja": administrador y secretaria; "Ver reportes financieros": administrador todo, secretaria "parcial,
  su caja"), 4.3 (proceso de caja diaria: esperado = inicial + ingresos en efectivo − egresos; si no cuadra, se registra la
  diferencia con observación; Yape y transferencia se registran en la caja pero no suman al efectivo físico), 8.7
  (pantallas de la secretaria: caja, apertura, movimientos y cierre), 8.8 (Caja: `ABIERTA` → `CERRADA`; el administrador
  puede reabrirla), 9.1 (`CAJA`, `MOVIMIENTO_CAJA`) y 11.4 (excepciones del administrador con motivo y auditoría); D-03
  (los montos son finales, con IGV; la caja no suma ni resta nada), D-04 (un Yape o una transferencia entra a la caja
  abierta en el momento de verificarlo, con su método, y no suma al efectivo esperado), D-09 (sin SUNAT; el ticket es de
  la 007), D-10 (`pdfkit` para el cierre de caja), D-17 (cada historia crea sus tablas), D-23 (todo es por academia),
  D-25 (`Decimal` y `numeric`), D-29 (el Superadmin no ve la caja). De las specs anteriores: regla DT-5 de 002
  (`bloquearActorVigente`), «Cupo de una clase» de 004 y el orden de bloqueos de la 005a. Prepara HU-07 a HU-09 y D-04
  (007: el cobro y la verificación registran su ingreso con la interfaz de esta historia) y RN-35 y HU-39 (019: el pago a
  un entrenador "desde caja" es un egreso de la caja abierta).
- **Ruta crítica:** sí. Es el punto "Caja" de la lista de `CLAUDE.md` (apertura, ingresos y egresos, cierre con esperado
  por método y diferencia, reapertura solo por el administrador, ningún cobro con la caja cerrada) y toca además el
  aislamiento entre academias, los permisos (datos financieros) y la auditoría. La web, la semilla y la documentación no
  son críticas.
- **Estado:** aprobada por el responsable (22/11/2026), con la propuesta de cada pregunta de negocio (P1 a P11, que son
  DR-1 a DR-11 de esta spec) y con las técnicas aprobadas por el orquestador tal como se propusieron (T1 a T6, que son DT-1
  a DT-6), en "Decisiones". Los valores que el borrador llamaba "provisionales" quedan como definitivos; ningún criterio
  cambió de intención. Al escribir las pruebas protegidas de la 006a se agregaron las precisiones PP1 a PP8 (en
  "Decisiones"), sin cambios de negocio, y la pregunta P12, que no bloquea.
- **Ronda adversarial 1 de la 006a (22/11/2026, sobre `deb9ee4`):** sin fallas de los criterios escritos. El orquestador
  convirtió dos observaciones técnicas en los criterios 47 (el comprobante del egreso, con las reglas de texto de la
  descripción) y 48 (las interfaces `registrarEgresoEnCaja` y `registrarIngresoEnCaja` validan sus entradas), los dos
  críticos y de la 006a, sin cambios de negocio, y dejó una nota para la 007 en "Reglas para las historias siguientes"
  (orden de bloqueos con la fila del alumno), sin criterio propio.
- **Ronda adversarial 2 de la 006a (22/11/2026, sobre `88b8d4e`):** sin fallas; no agrega ni cambia criterios. Atacó los
  criterios 47 y 48 (unos 90 textos por la ruta y por las interfaces, el orden de validación y la idempotencia con
  textos normalizados), las carreras (un cobro que imita la 007 en vuelo frente a un egreso; 40 rondas de 10
  operaciones simultáneas de apertura, egreso, cierre, reapertura e ingresos, sin 500 ni interbloqueos y con las
  invariantes de una sola caja abierta, nada después de `movimientos_hasta`, el esperado igual a la suma y el efectivo
  nunca negativo), la web (permisos, montos sin coma flotante, doble clic, reintento tras `CAJA_CAMBIO`, sin
  almacenamiento local y caché por usuario) y el aislamiento. Observaciones aceptadas sin cambio de spec: la hora de la
  operación es la de llegada (el reloj se lee antes de esperar el bloqueo de la caja, coherente porque el bloqueo impide
  los cruces); NFC y NFD se comparan como textos distintos; los límites de longitud se cuentan por puntos de código;
  `ip` no se valida en las interfaces (quien llama pasa `req.ip`); los topes extremos de `smallint` en
  `cierres_caja.numero` y del número de movimientos no son realistas; cada diálogo de egreso genera su propia clave
  (criterio 38). **Ataque adversarial de la 006a cerrado sin fallas abiertas.**
- **Repaso de la 006b antes de sus pruebas protegidas (22/11/2026, sobre `095d153`, con la 006a unida a `main`):** el
  especificador revisó los criterios 40 a 44 (y la parte de la 006b de 7, 8, 45 y 46) contra lo construido en la 006a y
  agregó las precisiones PQ1 a PQ15 (al final de la sección I), técnicas y sin cambios de negocio, y la pregunta P13
  (la caja de hoy en el alcance de la secretaria), que el responsable contestó el 22/11/2026 con la propuesta (DR-13).
  Cambia la forma de la respuesta de la lista (`{ desde, hasta, cajas }`, PQ3) y fija que
  `?academiaId=` se ignora (PQ1).
- **Ronda adversarial 1 de la 006b (22/11/2026, sobre `838e88c`):** dos fallas, que el orquestador convirtió en los
  criterios 49 y 50, críticos y de la 006b:
  - **Criterio 49:** el PDF de una caja con muchos movimientos bloqueaba el bucle de eventos de la API.
    `generarPdfCierre` dibujaba el documento de una vez en el hilo principal, a unos 0,65 ms por movimiento. Una caja de
    20 000 egresos de S/ 0.01 se arma por la API en unos 5 minutos, y su PDF congelaba el proceso unos 13 s. Con tres
    descargas a la vez, un egreso de otra academia respondía 500 `ERROR_INTERNO`.
  - **Criterio 50:** `HEAD` sobre la ruta del PDF respondía 200 con `Content-Disposition` y llamaba al generador, en
    contra de PQ15.

  El orquestador decidió que la falla 1 es técnica (DT-7): no hay tope de movimientos por caja, porque eso sería una
  regla de negocio. Lo que se acota es cuánto bloquea cada PDF y cuántos se generan a la vez. Hay una observación
  aceptada sin criterio: `pdfkit` dibuja U+00AD (guion blando, que PQ11 deja pasar) como un guion, y muchos descuadran
  la tabla. Es cosmético. Cambiarlo exigiría cambiar PQ11 y una prueba protegida (`pdf-texto.test.ts`, que espera que
  U+00AD quede).
- **División (DR-10):** dos entregas desde esta misma carpeta, las dos de ruta crítica, cada una con sus pruebas
  protegidas, su ataque y su PR, como DR-11 de 005 (ver "División en 006a y 006b"):
  - **006a · Caja del día** (se construye primero): criterios 1 a 39, 45 y 46, salvo las partes de 45 y 46 que tratan
    del historial y del PDF, más 47 y 48 (ronda adversarial 1).
  - **006b · Historial y PDF del cierre** (siguiente PR, con la 006a unida a `main`): criterios 40 a 44, más esas
    partes, más 49 y 50 (ronda adversarial 1 de la 006b).

## Objetivo

Que la recepción de cada academia lleve su caja en el sistema y no en papel (problema P5: "la caja no está cuadrada,
faltantes no detectados"). La secretaria o el administrador abre la caja del día con el efectivo inicial, registra los
egresos menores, y al final del día cuenta el efectivo y lo declara: el sistema calcula el esperado por método de pago y
la diferencia, que queda registrada con su observación. El administrador puede reabrir un cierre, con motivo y
auditoría, y ver el historial y el PDF de cada cierre. Ningún movimiento entra a una caja cerrada ni a la de otro día,
aunque llegue a la vez que el cierre. Los cobros todavía no existen (007): esta historia deja la interfaz con la que la
007 registra cada ingreso dentro de la transacción del cobro o de la verificación.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Aislamiento en la base y en la API (1 a 6, 8):** la caja es dinero y datos internos de cada academia (D-23). Una caja,
  un movimiento o un cierre de B no se ve ni se toca desde A, ni cambiando un id ni escribiendo directo en la base; la
  base exige además las invariantes del dinero (sumas, diferencia, observación) y que ningún movimiento entre a una caja
  cerrada.
- **Permisos y actor vigente (7, 9):** solo el administrador y la secretaria abren, cierran y registran egresos; solo el
  administrador reabre (sección 2.1, HU-27); el Superadmin no ve la caja (D-29); una cuenta desactivada con una petición en
  curso no mueve dinero (DT-5 de 002).
- **Apertura (10 a 16):** una sola caja abierta por academia, la fecha de la caja en America/Lima, la caja de otro día
  sin cerrar y el doble clic (RN-17, D-04).
- **Movimientos (17 a 26, 47 y 48):** ningún movimiento con la caja cerrada ni en la de otro día (RN-17), egresos con
  motivo e idempotentes, montos sin coma flotante, movimientos inmutables, y la interfaz que usará la 007 para que "ningún
  cobro con la caja cerrada" sea cierto también cuando el cobro y el cierre llegan a la vez. El 47 y el 48 (ronda
  adversarial 1) son críticos porque los textos del egreso quedan en la auditoría de caja (RN-22) y en el PDF del cierre,
  donde un carácter de dirección del texto puede disfrazar lo que se lee, y porque la interfaz es la puerta por la que la
  007 y la 019 escriben dinero en la caja: una entrada mal formada no puede guardarse ni terminar en un 500 crudo.
- **Esperado y cierre (27 a 34):** el esperado por método (Yape y transferencia no suman al efectivo, D-04 y 4.3), la
  diferencia y la observación, el cierre de una caja de otro día, el cierre que se cruza con un movimiento y el doble
  clic.
- **Reapertura (35, 36):** solo el administrador, con motivo y auditoría, sin dejar nunca dos cajas abiertas.
- **006b, historial y PDF (40 a 43):** quién ve qué caja (la secretaria, "su caja"; sección 2.1) y el PDF, que se
  genera con datos ya confirmados y fuera de toda transacción de escritura.
- **006b, ronda adversarial 1 (49 y 50):** el 49 es crítico porque la instalación atiende a varias academias (D-23). Un
  PDF que congela el proceso deja sin atender, o con un 500, los egresos y cobros de todas: es la caja de las demás la
  que deja de funcionar. El 50 es crítico porque una ruta que no está en el contrato armaba el PDF entero y lo
  anunciaba con `Content-Disposition`, en contra del criterio 23 y de PQ15. Además, era una segunda puerta al costo del
  criterio 49.

No son críticos, pero llevan _(prueba obligatoria)_: 37 a 39 (web de la caja del día, con pruebas de componentes y una
E2E) y 44 (web del historial). Los 45 y 46 (semilla y documentación) los verifica el revisor. _(DT-5.)_

## División en 006a y 006b

Decidida en DR-10, como DR-11 de 005. Las dos entregas comparten esta spec, `plan.md` y `tasks.md`; lo de la 006b
lleva la marca **[006b, siguiente PR]**. La 007 solo necesita la 006a.

| Entrega | Criterios críticos (pruebas protegidas y ataque) | Prueba obligatoria | Revisor |
| --- | --- | --- | --- |
| **006a** · caja del día | 1 a 36, 47 y 48 | 37, 38 y 39 | 45 y 46 (sin el historial ni el PDF) |
| **006b** · historial y PDF | 40 a 43, 49 y 50 | 44 | parte de 45 y 46 |

**Dependencias resueltas:**

- **La migración de la 006a crea las tres tablas completas** (criterios 1 a 6), incluidas las columnas que solo lee la
  006b (`cierres_caja.movimientos_hasta`, la reapertura en `cierres_caja`). La 006b no tiene migración.
- **`VER_REPORTES_FINANCIEROS` ya existe en la matriz** (`SECRETARIA: 'SU_CAJA'`): la 006b no cambia la matriz.
  `REABRIR_CAJA` (DT-1) entra con la 006a.
- **La reapertura en la web:** en la 006a, el administrador reabre desde `/panel/caja` la caja del día ya cerrada. Reabrir
  una caja de un día anterior desde la web llega con el historial (006b); la API la admite desde la 006a (criterio 36).
- **`pdfkit`** entra con la 006b (impacto en el criterio 127 de 001, DT-3).

## Criterios de aceptación

En estos criterios, "ruta de academia", "sesión válida" y "actor vigente" son los de la spec 002; A y B son dos academias
activas; "hoy" es la fecha de America/Lima de `RELOJ.ahora()` (`hoyEnLima`), nunca la del servidor ni la de la base.
"Caja de otro día" es una caja cuya `fecha` es anterior a hoy. Los montos viajan como texto con dos decimales (`"120.00"`)
y se calculan con `Decimal` (criterio 10 de 004). Cada criterio cita entre paréntesis la decisión del responsable
(DR-n) o del orquestador (DT-n) que fija sus valores.

### A. Tablas, aislamiento e invariantes en la base

1. **Tablas nuevas.** Dadas las migraciones aplicadas, entonces existen `cajas`, `movimientos_caja` y `cierres_caja` con
   las columnas de "Cambios al modelo de datos", con RLS activada y forzada, políticas de `SELECT`, `INSERT` y `UPDATE`
   (en `movimientos_caja`, solo `SELECT` e `INSERT`) que comparan `academia_id` con `app_academia_actual()` con la forma
   exacta del criterio 132 de 001, sin política ni privilegio de `DELETE`, `UNIQUE (academia_id, id)` en las tres y las
   llaves foráneas compuestas hacia `usuarios`, `alumnos` y `cajas` de ese apartado. Todas las pruebas de catálogo de 001
   (criterios 9 a 13, 17, 18, 124 a 126, 131 a 133 y 142) siguen pasando, y `TABLAS_DESPUES_DE_MIGRAR` suma las tres.
   _(crítico)_ (D-17, D-23)
2. **Privilegios mínimos.** El rol `aquagestion_app` tiene exactamente: en `cajas`, `SELECT`, `INSERT` y `UPDATE` de
   `estado` y `actualizado_en`; en `movimientos_caja`, `SELECT` e `INSERT` (sin `UPDATE`: los movimientos no cambian); en
   `cierres_caja`, `SELECT`, `INSERT` y `UPDATE` de `reabierto_por`, `reabierto_en` y `motivo_reapertura`. No puede cambiar
   la fecha, el monto inicial, quién abrió ni la `academia_id` de una caja, ni ningún monto de un cierre. `PRIVILEGIOS_APP`
   y `scripts/lib/rol-app.mjs` se amplían igual, y la API sigue atendiendo (criterio 102 de 001). _(crítico)_ (D-23,
   RN-22)
3. **RLS y llaves compuestas.** Dadas cajas, movimientos y cierres en A y en B, como app: en contexto de A, `SELECT`
   devuelve solo filas de A; un `INSERT` con `academia_id` de B y un `UPDATE` que mueve una fila de A a B fallan con
   `42501`; en contexto de plataforma o sin contexto, devuelven 0 filas y el `INSERT` falla. Aunque quien escriba sea el
   dueño de las tablas, un movimiento o un cierre de A con la `caja_id` de una caja de B, un movimiento de A con el
   `alumno_id` de un alumno de B, y una caja, un movimiento o un cierre de A con un usuario de B (`abierta_por`,
   `registrado_por`, `cerrado_por`, `reabierto_por`) fallan con `23503`. _(crítico)_ (D-23, D-29)
4. **Invariantes con `CHECK`.** Dado un `INSERT` o `UPDATE` directo (como app y como dueño), entonces falla con `23514`:
   - a) `cajas`: `monto_inicial` negativo o `NaN`; `fecha` distinta de la fecha de America/Lima de `abierta_en`
     (`(abierta_en AT TIME ZONE 'America/Lima')::date`).
   - b) `movimientos_caja`: `monto` menor o igual que 0 o `NaN`; `numero` menor que 1; un `INGRESO` con concepto
     `EGRESO_MENOR`, sin `alumno_id` o sin `pago_id`, o con `descripcion`, `comprobante` o `clave_idempotencia`; un
     `EGRESO` con un concepto distinto de `EGRESO_MENOR`, con un método distinto de `EFECTIVO`, sin `descripcion` o sin
     `clave_idempotencia`, o con `alumno_id` o `pago_id`.
   - c) `cierres_caja`: cualquier monto `NaN`; `monto_inicial`, los ingresos, los egresos o `monto_declarado` negativos;
     `esperado_efectivo` distinto de `monto_inicial + ingresos_efectivo − egresos_efectivo`; `diferencia` distinta de
     `monto_declarado − esperado_efectivo`; `diferencia` distinta de 0 sin `observacion`; `numero` menor que 1;
     `movimientos_hasta` negativo; `reabierto_por`, `reabierto_en` y `motivo_reapertura` no todos nulos o todos llenos;
     `reabierto_en` anterior a `cerrado_en`.

   Los `INSERT` se prueban como app y como dueño; los `UPDATE`, como dueño, porque la app casi no tiene `UPDATE`
   (criterio 2; PP4).

   _(crítico)_ (RN-17, HU-27, sección 4.3, RNF-12)
5. **Índices únicos.** Dado un `INSERT` o `UPDATE` directo, entonces falla con `23505`: una segunda caja `ABIERTA` en la
   misma academia (`cajas_una_abierta_por_academia`, índice único parcial); una segunda caja con la misma `fecha` en la
   misma academia (`cajas_academia_id_fecha_key`, una caja por día, DR-1); la misma `clave_idempotencia` en dos cajas,
   dos egresos o dos cierres de la academia; dos movimientos con el mismo `numero` en una caja; dos movimientos con el
   mismo `pago_id` en la academia (un pago entra una sola vez a la caja); dos cierres con el mismo `numero` en una caja; y
   dos cierres vigentes (sin `reabierto_en`) en una caja. En B, los mismos valores se aceptan. _(crítico)_ (RN-17, D-04)
6. **Ningún movimiento en una caja cerrada, también en la base.** Un trigger `BEFORE INSERT` en `movimientos_caja` toma la
   fila de su caja con `FOR SHARE` y rechaza el movimiento con `23514` y la restricción
   `movimientos_caja_solo_caja_abierta` si ve la caja y no está `ABIERTA`. Si no la ve (no existe, es de otra academia o
   la RLS la oculta), deja pasar la fila y deciden la llave compuesta (`23503`) o la RLS (`42501`) del criterio 3 (PP1).
   Pruebas, como app y como dueño:
   - a) un `INSERT` directo en una caja `CERRADA` falla;
   - b) una transacción de la prueba cierra la caja (`UPDATE … SET estado = 'CERRADA'`) sin confirmar; otra inserta un
     movimiento directo, que queda esperando (se comprueba en `pg_locks`); la prueba confirma; entonces el `INSERT` falla
     con `23514`.

   La función del trigger es `SECURITY INVOKER`, sin valores propios distintos de `search_path` (criterio 124 de 001). No
   comprueba el día: eso lo decide la API con `RELOJ` (criterio 20). _(crítico)_ (RN-17)

### B. Permisos, aislamiento en la API y actor vigente

7. **Permisos.** Dadas sesiones válidas de cada rol de A:
   - `GET /api/cajas/actual`, `POST /api/cajas`, `POST /api/cajas/{id}/egresos` y `POST /api/cajas/{id}/cierre` (permiso
     `ABRIR_CERRAR_CAJA`) responden a `ADMIN` y `SECRETARIA`, y 403 `SIN_PERMISO` a `ENTRENADOR` y `ALUMNO`;
   - `POST /api/cajas/{id}/reapertura` (permiso nuevo `REABRIR_CAJA`, solo `ADMIN: 'TODO'`, DT-1) responde al
     `ADMIN` y 403 `SIN_PERMISO` a `SECRETARIA`, `ENTRENADOR` y `ALUMNO`;
   - **[006b]** `GET /api/cajas`, `GET /api/cajas/{id}` y `GET /api/cajas/{id}/cierres/{numero}/pdf` (permiso
     `VER_REPORTES_FINANCIEROS`) responden a `ADMIN` y `SECRETARIA` (con el alcance del criterio 40), y 403 `SIN_PERMISO` a
     `ENTRENADOR` y `ALUMNO`, aunque el id, el número o la consulta sean inválidos (PQ1).

   Ningún 403 escribe ni audita. Sin sesión, 401 `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403
   `CAMBIO_DE_CLAVE_OBLIGATORIO`; con A suspendida, 403 `ACADEMIA_SUSPENDIDA`, en el orden de comprobaciones de 002. La
   cookie del Superadmin (`aq_plataforma`) responde 401 y el Superadmin no tiene rutas de caja (D-29). La matriz pasa de 24
   a 25 filas con `REABRIR_CAJA`. _(crítico)_ (sección 2.1, HU-27, D-29)
8. **Aislamiento en la API.** Dadas cajas en A y en B, cuando un `ADMIN` o una `SECRETARIA` de A usa las rutas, entonces:
   `GET /api/cajas/actual` nunca devuelve la caja de B, aunque A no tenga caja y B tenga una abierta; un `POST` de egreso,
   cierre o reapertura sobre el id de una caja de B responde 404 `NO_ENCONTRADO`, con el mismo cuerpo que un id que no
   existe y que uno que no es UUID; un cuerpo con `academiaId`, `cajaId`, `fecha`, `abiertaPor` o cualquier campo que no
   sea del contrato responde 400 sin escribir; un parámetro `?academiaId=<id de B>` se ignora o responde 400, pero nunca
   muestra ni escribe datos de B. Abrir la caja en A no cuenta la caja abierta de B (criterio 13). Las filas y la auditoría
   de B no cambian. **[006b]** Lo mismo en la lista, el detalle y el PDF: la lista ignora `?academiaId=` y cualquier
   parámetro que no sea `desde` o `hasta` (responde la lista de A, PQ3); el detalle y el PDF de una caja de B responden el
   404 de PQ1. _(crítico)_ (D-23)
9. **Quien pide sigue vigente dentro de la transacción.** La apertura, el egreso, el cierre y la reapertura llaman a
   `bloquearActorVigente` como primera sentencia de su `conAcademia` (regla DT-5 de 002). Prueba de carrera determinista,
   como la del criterio 7 de 004: la prueba desactiva a la `SECRETARIA` X (`estado = 'INACTIVO'`, `version_token + 1`) en una
   transacción sin confirmar; X envía una apertura, un egreso y un cierre válidos, que pasan el middleware y quedan
   esperando; la prueba confirma. Entonces los tres responden 401 `NO_AUTENTICADO`, sin crear ni cambiar filas ni auditar.
   Lo mismo con el `ADMIN` que reabre, y si solo sube `version_token`. _(crítico)_ (DT-5 de 002)

### C. Apertura (HU-25)

10. **Abrir la caja.** Dado que A no tiene caja abierta ni caja de hoy, cuando una `SECRETARIA` o un `ADMIN` envía
    `POST /api/cajas` con `{ claveIdempotencia, montoInicial }`, entonces responde 201 con `{ caja }` (`cajaSchema`):
    `estado: 'ABIERTA'`, `fecha` igual a hoy, `montoInicial` con dos decimales, `abiertaPor` (id, nombres y apellidos de
    quien abrió, sin DNI), `abiertaEn`, `deOtroDia: false`, sin movimientos ni cierres, y el resumen con el esperado en
    efectivo igual al monto inicial y en Yape y transferencia en `"0.00"`. Registra `CAJA_ABIERTA` (entidad `caja`,
    `entidadId` el id, actor `USUARIO`, IP) con `datosDespues: { fecha, montoInicial }`. La fecha nunca viene del cliente.
    _(crítico)_ (HU-25, RN-17, RN-22)
11. **Monto inicial.** `montoInicial` es un texto de `montoNoNegativoSchema`: de `"0"` a `"99999.99"`, con hasta dos
    decimales (se acepta cero, DR-6). `"0"`, `"0.00"`, `"150"`, `"150.5"` y `"99999.99"` se aceptan,
    se guardan en `numeric(10,2)` sin pasar por coma flotante y se devuelven como `"0.00"`, `"150.00"`, `"150.50"` y
    `"99999.99"`. Responden 400 `SOLICITUD_INVALIDA` (campo `montoInicial`) sin escribir ni auditar: un número JSON (`150`),
    `"-1"`, `"-0"`, `"150.505"`, `"1e2"`, `"150,50"`, `" 150"`, `"100000"`, `""`, `null` y la clave ausente.
    `claveIdempotencia` es un UUID; si falta o no lo es, 400 en `claveIdempotencia`. _(crítico)_ (HU-25)
12. **La fecha de la caja es la de Lima.** Con `RELOJ` fijo y el proceso en `TZ=Asia/Tokyo` y en `TZ=UTC`:
    - a) abrir a las `2026-11-30T23:59:00Z` (18:59 del 30 en Lima) y a las `2026-12-01T00:30:00Z` (19:30 del 30 en Lima)
      da `fecha` `2026-11-30` en los dos casos (en UTC ya sería el 1 de diciembre);
    - b) abrir a las `2026-12-01T04:59:59.999Z` (23:59:59.999 del 30 en Lima) da `2026-11-30`, y a las
      `2026-12-01T05:00:00Z` (00:00 del 1 de diciembre en Lima) da `2026-12-01`;
    - c) lo mismo en el cambio de año (`2026-12-31` a `2027-01-01`).

    Lo exige también la base (criterio 4 a). _(crítico)_ (RNF-12; "Fechas y horas de negocio" de `docs/arquitectura.md`)
13. **Una sola caja abierta por academia.** Dada una caja abierta de hoy en A, cuando alguien de A envía otra apertura con
    otra clave, entonces responde 409 `CAJA_YA_ABIERTA` con `detalles: { cajaId, fecha }`, sin escribir ni auditar. Dadas
    dos aperturas simultáneas en A (dos personas, claves distintas), exactamente una responde 201 y la otra 409
    `CAJA_YA_ABIERTA` (nunca 500 ni `40P01`), y queda una fila y un `CAJA_ABIERTA`. Una caja abierta en B no impide abrir
    en A. _(crítico)_ (RN-17, D-04: "la caja que esté abierta")
14. **La caja de otro día sin cerrar.** Dada una caja de A abierta el día anterior (o antes) y nunca cerrada, cuando
    alguien de A intenta abrir la de hoy, entonces responde 409 `CAJA_PENDIENTE_DE_CIERRE` con `detalles: { cajaId, fecha }`
    (la fecha de la caja pendiente), sin escribir ni auditar: primero hay que cerrarla (criterio 32). No se cierra sola ni
    se abre otra encima (DR-2). _(crítico)_ (RN-17)
15. **Una caja por día.** Dada la caja de hoy de A ya cerrada, cuando alguien de A intenta abrir otra, entonces responde
    409 `CAJA_DEL_DIA_CERRADA` con `detalles: { cajaId, fecha }`, sin escribir ni auditar: para seguir cobrando hoy, el
    administrador reabre la caja del día (criterio 35). (DR-1: una caja abierta a la vez por academia y una por día.)
    _(crítico)_ (HU-25: "la caja del día"; RN-17)
16. **Doble clic en la apertura.** Dada una apertura que ya creó la caja C con la clave K, cuando llega otra con la misma
    clave K y el mismo monto (doble clic o reintento), entonces responde 200 con `{ caja }` de C tal como está ahora, sin
    crear otra caja ni auditar otra vez, aunque C ya tenga movimientos o esté cerrada. Montos equivalentes (`"120"` y
    `"120.00"`) cuentan como el mismo monto (PP6 d). Con la clave K y otro monto, 409
    `CLAVE_YA_USADA` sin escribir. Dos envíos simultáneos con la misma clave dejan una sola caja y un solo `CAJA_ABIERTA`;
    uno responde 201 y el otro 200. Una clave de B no choca con una de A. _(crítico)_ (regla de idempotencia de
    `CLAUDE.md`)

### D. Egresos e ingresos (HU-26)

17. **Registrar un egreso.** Dada la caja abierta de hoy C de A, cuando una `SECRETARIA` o un `ADMIN` envía
    `POST /api/cajas/{C}/egresos` con `{ claveIdempotencia, descripcion, monto, comprobante? }`, entonces responde 201 con
    `{ movimiento, caja }`: el movimiento tiene `tipo: 'EGRESO'`, `concepto: 'EGRESO_MENOR'`, `metodo: 'EFECTIVO'`
    (DR-3: el egreso es siempre en efectivo), el monto con dos decimales, la `descripcion` y el `comprobante` (o `null`), `numero` (el
    siguiente de la caja: 1, 2, 3…), `registradoPor` y `registradoEn`; la caja trae el resumen ya con el egreso (el
    esperado en efectivo baja en el monto). Registra `CAJA_EGRESO_REGISTRADO` (entidad `movimiento_caja`, `entidadId` el id
    del movimiento) con `datosDespues: { cajaId, numero, descripcion, monto, comprobante }`. _(crítico)_ (HU-26, RN-22)
18. **Validación del egreso.** Responden 400 `SOLICITUD_INVALIDA` sin escribir ni auditar, con el campo: `descripcion`
    recortada de menos de 3 o más de 200 caracteres, con controles o con menos de 3 visibles (`textoVisibleSchema`);
    `monto` que no cumple `montoSchema` (`"0"`, `"0.00"`, `"-5"`, `"5.555"`, `5`, `"1e2"`, `" 5"`, `"100000"`, `null`);
    `comprobante` recortado de más de 60 caracteres o con controles (vacío o solo espacios cuenta como ausente y se guarda
    `null`; DR-3); `claveIdempotencia` que no es UUID; cualquier campo de más (`metodo`, `concepto`,
    `tipo`, `alumnoId`). El `comprobante` rechaza además los caracteres de dirección del texto y los separadores, y uno
    sin ningún carácter visible cuenta como ausente (criterio 47, ronda adversarial 1). _(crítico)_ (HU-26)
19. **Ningún movimiento con la caja cerrada (RN-17).** Dada la caja C de A cerrada, cuando alguien envía un egreso a C con
    una clave nueva, entonces responde 409 `CAJA_CERRADA` sin escribir ni auditar. Si el administrador la reabre (criterio
    35), el egreso se acepta. _(crítico)_ (RN-17)
20. **La caja de otro día no admite movimientos.** Dada la caja C de A abierta el 30 de noviembre en Lima y nunca cerrada:
    - a) un egreso a C a las `2026-12-01T00:30:00Z` (19:30 del 30 en Lima) se acepta;
    - b) un egreso a C a las `2026-12-01T05:00:00Z` (00:00 del 1 de diciembre en Lima) responde 409 `CAJA_DE_OTRO_DIA`
      con `detalles: { cajaId, fecha }`, sin escribir ni auditar; a las `2026-12-01T04:59:59.999Z`, se acepta;
    - c) lo mismo con el proceso en `TZ=Asia/Tokyo` y en el cambio de mes y de año;
    - d) la interfaz de la 007 (criterio 24) responde igual: con la caja del 30 abierta, a las 00:00 del 1 en Lima lanza
      `CAJA_DE_OTRO_DIA`, con los mismos `detalles: { cajaId, fecha }` que la ruta (PP6 b), y no inserta.

    Lo único que admite una caja de otro día es su cierre (criterio 32; DR-2). _(crítico)_ (RN-17; "cobrar con la caja de
    otro día" de `CLAUDE.md`)
21. **Un egreso no deja el efectivo en negativo.** Dado que el esperado en efectivo de C es S/ 50.00, un egreso de
    `"50.00"` se acepta (queda en `"0.00"`) y uno de `"50.01"` responde 409 `EFECTIVO_INSUFICIENTE` con
    `detalles: { disponible: "50.00" }`, sin escribir ni auditar. Dos egresos simultáneos de `"30.00"` con S/ 50.00: uno
    responde 201 y el otro 409 `EFECTIVO_INSUFICIENTE`; nunca quedan los dos. No hay otro tope para los egresos (DR-4).
    La parte simultánea no tiene prueba protegida propia todavía (PP8). _(crítico)_ (sección 4.3)
22. **Doble clic en el egreso.** Dado un egreso ya registrado en C con la clave K, cuando llega otro con la misma clave y
    los mismos `descripcion`, `monto` y `comprobante` (después de recortar y normalizar el monto: `"20"` y `"20.00"` son el
    mismo), entonces responde 200 con el mismo `{ movimiento, caja }` (la caja como está ahora), sin otra fila ni otra
    auditoría, aunque C ya esté cerrada o sea de otro día (la clave se mira antes que el estado de la caja). Con la clave K
    y otros datos, o con la clave K de un egreso de otra caja, 409 `CLAVE_YA_USADA` sin escribir. Dos envíos simultáneos
    con la misma clave dejan una sola fila y una sola auditoría; uno responde 201 y el otro 200 (sin prueba protegida
    propia todavía: PP8). _(crítico)_ (regla de idempotencia de `CLAUDE.md`)
23. **Los movimientos no se editan ni se borran.** No hay ruta para cambiar o borrar un movimiento ni un cierre:
    `PATCH` y `DELETE` sobre `/api/cajas/{id}/egresos/{movimientoId}`, `/api/cajas/{id}` y `/api/movimientos-caja/{id}`
    responden 404 sin tocar nada; y la base no da a la app ni `UPDATE` ni `DELETE` de `movimientos_caja` (criterio 2). Un
    egreso equivocado se explica en la observación del cierre (DR-5: los movimientos no se anulan). _(crítico)_ (RN-22)
24. **Interfaz para la 007: el ingreso de un cobro.** `registrarIngresoEnCaja(tx, ingreso, ahora)` (sin Nest, en
    `backend/src/modulos/caja/movimientos.ts`, reexportada en `caja/index.ts`; firma en "Contrato") corre dentro de la
    transacción de quien llama, que ya llamó a `bloquearActorVigente`. En este orden (el `RangeError` del monto se
    comprueba en c, después de a y b, y antes de insertar: PP7):
    - a) bloquea la caja abierta de `tx.academiaId` con `FOR UPDATE`; si no hay, lanza 409 `SIN_CAJA_ABIERTA` (mensaje:
      "Abre la caja antes de cobrar"); si es de otro día según `ahora` en Lima, 409 `CAJA_DE_OTRO_DIA` (criterio 20 d);
    - b) si ya hay un movimiento con ese `pagoId` en la academia, lo devuelve con `repetido: true`, sin insertar ni
      auditar (un pago entra una sola vez a la caja; criterio 5);
    - c) si no, inserta un `INGRESO` con `concepto` (`INSCRIPCION`, `MENSUALIDAD` o `CLASE_PARTICULAR`), `metodo`
      (`EFECTIVO`, `YAPE` o `TRANSFERENCIA`), `monto` (`Decimal` mayor que 0 y como mucho `100000.00`, con hasta dos
      decimales; si no, lanza un `RangeError` sin escribir), `alumnoId`, `pagoId`, `usuarioId` y el siguiente `numero`, y
      registra `CAJA_INGRESO_REGISTRADO` (entidad `movimiento_caja`) con `datosDespues: { cajaId, numero, concepto, metodo,
      monto, alumnoId, pagoId }` y la `ip` recibida (nula si es `null`; PP6 a).

    Un `alumnoId` de otra academia o que no existe hace fallar la transacción (`23503`, llave compuesta) y no queda nada.
    Pruebas de integración que llaman a la función dentro de `conAcademia`, con el reloj fijo (la 007 todavía no existe).
    _(crítico)_ (HU-26, HU-07, D-04, RN-17)
25. **Yape y transferencia entran a la caja, pero no al efectivo.** Dada la caja C con monto inicial S/ 100.00, después de
    registrar con la interfaz un ingreso `EFECTIVO` de S/ 42.00, uno `YAPE` de S/ 88.00 y uno `TRANSFERENCIA` de
    S/ 120.00, y un egreso de S/ 15.50, entonces el resumen de C es: ingresos `{ efectivo: "42.00", yape: "88.00",
    transferencia: "120.00" }`, egresos `{ efectivo: "15.50" }` y esperado `{ efectivo: "126.50", yape: "88.00",
    transferencia: "120.00" }`. _(crítico)_ (D-04, sección 4.3, HU-27)
26. **Orden de bloqueos con los cobros.** La caja se bloquea al final: una transacción de cobro (007) toma, en este orden,
    `usuarios` (`bloquearActorVigente`), sus filas del cliente, las clases (`bloquearClasesParaCupo`) y por último la caja
    (`registrarIngresoEnCaja`). Ninguna transacción de esta historia bloquea filas de `alumnos`, `solicitudes_inscripcion`,
    `matriculas` ni `clases`. Prueba de integración: una transacción que imita la 007 (actor, `bloquearClasesParaCupo` de
    una clase, `registrarIngresoEnCaja`) corre a la vez que un egreso, un cierre y la cancelación de una solicitud de 005b
    sobre esa clase; todas terminan, nunca con `40P01` ni 500. _(crítico)_ (regla "aforo y caja en transacciones sin
    carreras" de `CLAUDE.md`; «Cupo de una clase» de 004)

    _Nota de la ronda adversarial 1 (sin cambio de criterio):_ "ninguna transacción de esta historia bloquea filas de
    `alumnos`" se refiere a los bloqueos explícitos. El `INSERT` de un ingreso en `movimientos_caja` toma además, por la
    llave compuesta `(academia_id, alumno_id)`, un `FOR KEY SHARE` implícito sobre la fila del alumno, con la caja ya
    bloqueada (y otro sobre `usuarios` por `registrado_por`). Por eso la regla "Orden de bloqueos con la caja" exige a
    la 007 bloquear antes la fila del alumno o cliente ("Reglas para las historias siguientes").
47. **El comprobante del egreso, con las reglas de texto de la descripción.** _(Ronda adversarial 1; amplía el criterio
    18.)_ El `comprobante` de `POST /api/cajas/{C}/egresos` se trata en este orden:
    - a) **Recorte:** se recorta igual que la descripción (el `trim` de `textoVisibleSchema`, que también quita U+2028 y
      U+2029 de los bordes).
    - b) **Rechazo:** responde 400 `SOLICITUD_INVALIDA` con el campo `comprobante`, sin escribir ni auditar, si el texto
      recortado tiene controles o sustitutos sueltos (como hoy), más de 60 caracteres (como hoy), o los mismos caracteres
      que rechaza la descripción (`BIDI_O_SEPARADORES` de `packages/contratos/src/texto.ts`): de dirección del texto
      (`\p{Bidi_Control}`: U+061C, U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069) y separadores de línea o de párrafo
      (U+2028, U+2029). En los ejemplos de este criterio y del 48, `{U+XXXX}` es ese carácter. Responden 400:
      `B001{U+202E}321`, `{U+202E}B001`, `{U+2066}B001{U+2069}`, `B001{U+200F}`, `B001{U+2028}123`,
      `B001{U+2029}123`, y también `{U+202E}` solo: el rechazo va antes que la normalización de c. En cambio,
      `{U+2028}` solo y `B001{U+2028}` pierden el separador en el recorte (quedan `""` y `"B001"`), como en la
      descripción.
    - c) **Sin nada visible es como vacío:** si el texto recortado que pasó b no tiene ningún carácter visible según
      `contarVisibles` (`packages/contratos/src/texto.ts`: los de `Default_Ignorable_Code_Point`, U+2800 y las marcas
      combinantes no cuentan), cuenta como ausente y se guarda `null`, igual que `""`, solo espacios, `null` o la clave
      ausente (criterio 18, DR-3). Se guardan `null`: `{U+200B}` (espacio de ancho cero), `{U+3164}` (relleno hangul,
      se ve en blanco), `{U+2800}`, `{U+00AD}`, `{U+0301}` (marca combinante sola) y `{U+200B}{U+3164}` con un espacio
      antes y otro después. Con al menos un carácter visible, se guarda el texto recortado tal como llega, invisibles incluidos
      (`B{U+200B}1` se guarda así), sin exigir un mínimo de visibles: un comprobante de un carácter (`"1"`) es válido.
    - d) **Respuesta y auditoría:** en los casos de c, `movimiento.comprobante` y `datosDespues.comprobante` de
      `CAJA_EGRESO_REGISTRADO` son `null`.
    - e) **Idempotencia (criterio 22):** la clave repetida se compara con el comprobante ya normalizado. Un egreso
      registrado con la clave K y cualquiera de los comprobantes que se guardan `null` (`""`, `"   "`, `null`, ausente,
      `{U+200B}`, `{U+3164}`), y un reintento con la clave K, la misma descripción, el mismo monto y cualquier otro de
      ellos, responden 200 con el mismo movimiento, sin otra fila ni otra auditoría. Con la clave K y un comprobante
      visible (`"B001"`) frente a uno de esos, en cualquier orden, 409 `CLAVE_YA_USADA` sin escribir. Un reintento con la
      clave K y un comprobante que cae en b responde 400, aunque la clave ya exista (el esquema va antes que la clave,
      PP6 g).

    La base no comprueba estas reglas de texto (son del contrato, como las de la descripción); la interfaz las aplica
    también (criterio 48). _(crítico)_ (HU-26, DR-3, RN-22; reglas de texto de los criterios 76, 77 y 87 de 001)
48. **Las interfaces de la caja validan sus entradas.** _(Ronda adversarial 1; amplía el criterio 24 y el contrato de
    `registrarEgresoEnCaja`.)_ Las funciones de `backend/src/modulos/caja/movimientos.ts` que usarán la 007 y la 019 no
    confían en que quien llama haya validado:
    - a) **`registrarEgresoEnCaja(tx, egreso, ahora)`** aplica las mismas reglas que la ruta (`registrarEgresoSchema`),
      recorte incluido: `descripcion` como el criterio 18 (recortada, de 3 a 200 caracteres, sin controles ni sustitutos
      sueltos, sin caracteres de dirección del texto ni separadores, con al menos 3 visibles); `comprobante` (`string` o
      `null`) como los criterios 18 y 47; `claveIdempotencia`, un UUID con la misma regla que la ruta (`z.uuid()` del
      contrato); `usuarioId`, con forma de UUID (`PATRON_UUID`); y el monto como ya lo hace (mayor que 0, con hasta dos
      decimales y que quepa en `numeric(10,2)`). Si una entrada no cumple, lanza `RangeError` antes de tocar la base
      (antes de bloquear la caja y de buscar la clave), sin insertar movimiento ni auditoría. Un `cajaId` que no es UUID
      sigue respondiendo como hoy: 404 `NO_ENCONTRADO`, igual que uno que no existe (como la ruta, AT-2 de 004).
    - b) **Se guarda lo normalizado:** la descripción recortada y el comprobante recortado o `null` son los que se
      insertan, se auditan (`datosDespues`) y se comparan con el egreso previo de la misma clave (criterio 22). Un egreso
      con `"  Compra de útiles  "` se guarda como `"Compra de útiles"`, y otro con la misma clave, `"Compra de útiles"`,
      el mismo monto y el mismo comprobante devuelve `repetido: true`; un comprobante `"   "` o `{U+200B}` se guarda
      `null` y equivale a `null`.
    - c) **`registrarIngresoEnCaja(tx, ingreso, ahora)`** no recibe textos libres ni clave de idempotencia; comprueba la
      forma de lo que recibe: `alumnoId`, `pagoId` y `usuarioId` con forma de UUID, `concepto` uno de `INSCRIPCION`,
      `MENSUALIDAD` o `CLASE_PARTICULAR`, y `metodo` uno de `EFECTIVO`, `YAPE` o `TRANSFERENCIA`. Si no, lanza
      `RangeError` antes de tocar la base (el `pagoId` se usa en la consulta del paso b del criterio 24, así que su forma
      se comprueba antes), sin insertar ni auditar. El monto sigue el orden de PP7 (paso c del criterio 24). Un
      `alumnoId` con forma de UUID que es de otra academia o no existe sigue fallando con `23503` (criterio 24).
    - d) **Pruebas** de integración que llaman a cada función dentro de `conAcademia`, con el reloj fijo y la caja de hoy
      abierta (para que el `RangeError` no se confunda con `SIN_CAJA_ABIERTA` ni con el 404). En el egreso:
      `descripcion` `""`, `"  "`, `"ab"`, de 201 caracteres, con `"\n"` en medio, con U+202E, con U+2028 en medio y
      `{U+200B}{U+200B}{U+200B}`; `comprobante` con U+202E, con U+2028 en medio, de 61 caracteres y con `"\t"` en medio;
      `claveIdempotencia` `"no-es-uuid"` y `""`; `usuarioId` `"x"`. En el ingreso: `alumnoId`, `pagoId` y `usuarioId`
      `"x"`, `concepto` `'EGRESO_MENOR'` y `'OTRO'`, `metodo` `'TARJETA'`. Cada llamada lanza `RangeError` (no
      `ErrorNegocio` ni un error de Prisma o de PostgreSQL), y después las filas de `movimientos_caja` y de `auditoria`
      de la academia no cambiaron. Además, el caso b (recorte y `repetido: true`) y un comprobante `"   "` y otro
      `{U+3164}` que se guardan `null`.
    - e) **Responsabilidad de quien llama:** la interfaz no comprueba el rol ni el permiso de `usuarioId`, ni que sea el
      actor de la sesión. Quien llama ya pasó `@Permiso`, llamó a `bloquearActorVigente` en la misma transacción y pasa
      como `usuarioId` a ese actor (la 007, con su permiso de cobrar o verificar; la 019, con el de pagar a entrenadores).
      Un `usuarioId` con forma de UUID que no es de la academia falla con `23503` (llave compuesta, criterio 3). Desde la
      ruta de egresos nunca se llega al `RangeError`, porque `registrarEgresoSchema` responde 400 antes; un `RangeError`
      que llegue a la capa HTTP es un error de programación de quien llama (500), no una respuesta de negocio.

    _(crítico)_ (HU-26, RN-17, RN-22; reglas de texto compartidas de los criterios 76 y 77 de 001)

### E. Esperado y caja del día

27. **Cálculo del esperado y la diferencia (dominio puro).** `calcularResumen` y `calcularDiferencia`
    (`backend/src/modulos/caja/dominio/esperado.ts`, con `Decimal`, sin base de datos) cumplen, con pruebas unitarias:
    esperado en efectivo = monto inicial + ingresos en efectivo − egresos; esperado en Yape = ingresos por Yape; esperado
    en transferencia = ingresos por transferencia; diferencia = declarado − esperado en efectivo; resultado `CUADRA` si es
    0, `SOBRANTE` si es mayor y `FALTANTE` si es menor. Casos: `0.10 + 0.20` da exactamente `0.30`; mil ingresos de
    `0.01` dan `10.00`; un declarado de `"126.49"` frente a `"126.50"` da `"-0.01"` y `FALTANTE`; `"0"` frente a `"0.00"`
    da `CUADRA`. Ningún paso usa `number`, `Number(…)`, `parseFloat` ni `+monto` (lo comprueba la revisión y una prueba
    que pasa montos que en coma flotante no cuadran). Firmas y forma de comparar en PP2. _(crítico)_ (HU-27, sección 4.3,
    D-03)
28. **La caja del día.** `GET /api/cajas/actual` responde 200 con `{ caja }`: la caja `ABIERTA` de la academia (de hoy o
    de otro día, con `deOtroDia`); si no hay, la caja de hoy ya cerrada; si tampoco, `null`. La caja trae `resumen`
    (ingresos, egresos y esperado por método, como el criterio 25, y `ultimoMovimiento`: el mayor `numero`, o 0),
    `movimientos` ordenados por `numero` (cada uno con `alumno` como `{ id, nombres, apellidos }` o `null`, nunca el DNI) y
    `cierres` ordenados por `numero` (criterio 29). No bloquea, no escribe y no audita. Con la caja abierta, el esperado
    en efectivo se muestra antes de declarar (DR-7, como dice HU-27; sin arqueo ciego). _(crítico)_ (HU-26, HU-27)

### F. Cierre (HU-27)

29. **Cerrar la caja.** Dada la caja abierta C de A, cuando una `SECRETARIA` o un `ADMIN` envía
    `POST /api/cajas/{C}/cierre` con `{ claveIdempotencia, montoDeclarado, ultimoMovimientoVisto, observacion? }`,
    entonces, en una sola transacción, calcula el resumen con los movimientos de C (después de bloquearla), crea el cierre
    número 1 (o el siguiente, si C se reabrió) con la foto de lo calculado (`montoInicial`, ingresos por método, egresos,
    esperado por método, `montoDeclarado`, `diferencia` con signo, `resultado`, `observacion`, `tardio`,
    `movimientosHasta`, `cerradoPor`, `cerradoEn`), pasa C a `CERRADA` y responde 200 con `{ caja }` (con el cierre en
    `cierres`). Registra `CAJA_CERRADA` (entidad `caja`) con `datosDespues: { numeroCierre, esperado, montoDeclarado,
    diferencia, resultado, observacion, tardio }`, con `esperado` como `{ efectivo, yape, transferencia }` (PP5). Cualquier `SECRETARIA` o `ADMIN` de A puede cerrar la caja, aunque la
    haya abierto otra persona. _(crítico)_ (HU-27, RN-17, RN-22)
30. **Declarado y observación.** `montoDeclarado` usa `montoNoNegativoSchema` (`"0"` se acepta: la caja puede quedar sin
    efectivo); `ultimoMovimientoVisto` es un entero de 0 a 1 000 000; `observacion` es opcional, con `textoVisibleSchema`
    de 3 a 500 caracteres. Si la diferencia calculada no es 0 y no hay observación, responde 400 `SOLICITUD_INVALIDA` con
    `detalles.errores[0].campo` igual a `observacion` y el mensaje "Explica la diferencia (sobrante o faltante)", sin
    escribir ni auditar; con diferencia 0, la observación se acepta y se guarda, o queda `null`. Una observación vacía o
    de solo espacios no cuenta como ausente: responde 400 en `observacion` por el esquema, con cualquier diferencia (PP6
    c). Los demás casos de 400 son los del criterio 11 en `montoDeclarado`. _(crítico)_ (HU-27, sección 4.3: "se registra la diferencia con
    observación")
31. **El cierre se hace sobre lo que se vio.** Si `ultimoMovimientoVisto` no es igual al `ultimoMovimiento` de C dentro de
    la transacción (entró un egreso o un cobro después de que la persona cargó la pantalla), responde 409 `CAJA_CAMBIO` con
    `detalles: { ultimoMovimiento }`, sin escribir ni auditar; la web vuelve a cargar la caja y la persona revisa su conteo.
    _(crítico)_ (HU-27; decisión de diseño D3 y DT-6)
32. **Cierre de una caja de otro día.** Dada la caja C abierta el 30 de noviembre y nunca cerrada, cuando alguien de A la
    cierra el 1 de diciembre, entonces se acepta como cualquier cierre, con `tardio: true` (la fecha de Lima de
    `cerradoEn` es posterior a la de C); después, la apertura de la caja del 1 de diciembre responde 201. Un cierre el
    mismo día en Lima (también a las 19:30, que en UTC ya es el día siguiente) tiene `tardio: false`. La cierra la
    `SECRETARIA` o el `ADMIN`, contando el efectivo (DR-2). _(crítico)_ (RN-17, RNF-12)
33. **Un movimiento contra el cierre.** Pruebas deterministas, sin depender de tiempos (espera comprobada en `pg_locks` o
    `pg_stat_activity`):
    - a) **el cierre primero:** una transacción de la prueba bloquea C (`SELECT … FOR UPDATE`) sin confirmar; se envía un
      cierre válido por la API, que queda esperando; después, un egreso a C, que también espera; la prueba libera.
      Entonces el cierre responde 200 y el egreso 409 `CAJA_CERRADA`, sin fila ni auditoría;
    - b) **el egreso primero:** igual, pero primero el egreso y después el cierre (con el `ultimoMovimientoVisto` de
      antes del egreso). Entonces el egreso responde 201 y el cierre 409 `CAJA_CAMBIO` (su `ultimoMovimientoVisto` ya no
      es el último), sin cierre ni auditoría;
    - c) lo mismo que a) y b) con `registrarIngresoEnCaja` (en una transacción que imita la 007) en lugar del egreso: si
      el cierre va primero, la interfaz lanza 409 `SIN_CAJA_ABIERTA` y la transacción completa del cobro se revierte; si el
      cobro va primero, el cierre responde `CAJA_CAMBIO`;
    - d) en ningún caso hay 500 ni `40P01`; nunca queda un movimiento en una caja `CERRADA` ni con `numero` mayor que el
      `movimientosHasta` del cierre vigente; y el esperado guardado en el cierre es igual a la suma de los movimientos
      con `numero` hasta `movimientosHasta`.

    _(crítico)_ (RN-17: "una caja cerrada no admite movimientos"; "ningún cobro con la caja cerrada" de `CLAUDE.md`)
34. **Doble clic en el cierre.** Dado el cierre de C hecho con la clave K, cuando llega otro con la misma clave y el mismo
    `montoDeclarado`, entonces responde 200 con `{ caja }` (como está ahora), sin otro cierre ni otra auditoría. Con la
    clave K y otro monto, 409 `CLAVE_YA_USADA`. Con otra clave sobre C ya cerrada, 409 `CAJA_CERRADA`. Dos cierres
    simultáneos de C con claves distintas: uno responde 200 y el otro 409 `CAJA_CERRADA`; queda un cierre vigente y un
    `CAJA_CERRADA`. Montos equivalentes cuentan como el mismo; dos envíos simultáneos con la misma clave responden 200 los
    dos; y un reintento con la clave K que llega después de una reapertura responde 200 con C abierta, sin volver a
    cerrarla (PP6 d, e y f). _(crítico)_ (regla de idempotencia de `CLAUDE.md`)

### G. Reapertura (HU-27)

35. **Reabrir un cierre.** Dada la caja C de A cerrada, cuando un `ADMIN` envía `POST /api/cajas/{C}/reapertura` con
    `{ motivo }` (`textoVisibleSchema` de 3 a 200 caracteres; si no cumple, 400 en `motivo`), entonces, en una sola
    transacción, el cierre vigente de C guarda `reabiertoPor`, `reabiertoEn` y `motivoReapertura`, C pasa a `ABIERTA` y
    responde 200 con `{ caja }`. Registra `CAJA_REABIERTA` (entidad `caja`) con `motivo`, `datosAntes: { estado:
    'CERRADA', numeroCierre, montoDeclarado, diferencia }` y `datosDespues: { estado: 'ABIERTA' }`. Si es la caja de hoy,
    vuelve a admitir egresos y cobros; al cerrarla otra vez se crea el cierre número 2, y el número 1 sigue en `cierres`
    con su reapertura. _(crítico)_ (HU-27, sección 8.8, sección 11.4: motivo y auditoría)
36. **Reglas de la reapertura.**
    - a) Si C ya está `ABIERTA`, responde 200 con `{ caja }` sin escribir ni auditar (doble clic: dos reaperturas dejan una
      sola auditoría).
    - b) Si otra caja de A está abierta, responde 409 `HAY_OTRA_CAJA_ABIERTA` con `detalles: { cajaId, fecha }`, sin
      escribir ni auditar. Una reapertura y una apertura simultáneas nunca dejan dos cajas abiertas: una responde 200 o 201
      y la otra 409 (`HAY_OTRA_CAJA_ABIERTA`, `CAJA_YA_ABIERTA`, `CAJA_PENDIENTE_DE_CIERRE` o `CAJA_DEL_DIA_CERRADA`), nunca
      500.
    - c) Se puede reabrir la caja de un día anterior; queda abierta como caja de otro día: no admite movimientos (criterio
      20) y solo se puede volver a cerrar, con `tardio: true` (DR-8).
    - d) Un `ADMIN` de B sobre una caja de A, un id que no existe o que no es UUID: 404 `NO_ENCONTRADO`, el mismo cuerpo.

    _(crítico)_ (HU-27, RN-17)

### H. Web de la caja del día (006a)

37. **Menú y rutas.** Dado un `ADMIN` o una `SECRETARIA`, el inicio del panel muestra "Caja" (según
    `puede(rol, 'ABRIR_CERRAR_CAJA')`), que lleva a `/panel/caja`; a los demás roles no se les muestra y la página responde
    con el mensaje de "sin permiso" de 002 (`RequierePermiso`). _(prueba obligatoria, de componentes)_
38. **Página de la caja.** `/panel/caja` muestra, según `GET /api/cajas/actual`:
    - a) **sin caja:** el formulario "Abrir caja" con el monto inicial (ayuda: "el efectivo con el que empiezas el día");
    - b) **caja abierta de hoy:** la fecha, quién la abrió y a qué hora (Lima), el monto inicial, el resumen por método
      (con la aclaración de que Yape y transferencia no suman al efectivo), la lista de movimientos (hora, concepto o
      descripción, método, alumno y monto) y los botones "Registrar egreso" y "Cerrar caja";
    - c) **caja abierta de otro día:** un aviso ("La caja del {fecha} sigue abierta. Ciérrala antes de abrir la de hoy")
      con el botón "Cerrar caja" y sin "Registrar egreso";
    - d) **caja de hoy cerrada:** el resultado del cierre (esperado, declarado, diferencia como "Sobrante", "Faltante" o
      "Cuadra", observación) y, para el `ADMIN`, "Reabrir caja" con un diálogo que pide el motivo.

    El diálogo de cierre muestra el esperado por método, pide el efectivo contado, muestra la diferencia mientras se
    escribe y exige la observación si no es 0. Cada formulario genera su `claveIdempotencia` al abrirse y la reutiliza en
    los reintentos; mientras guarda, sus campos y el botón quedan desactivados. Los 409 se muestran con su mensaje
    (`CAJA_CAMBIO` vuelve a cargar la caja y avisa "Entró un movimiento nuevo: revisa el conteo"; `EFECTIVO_INSUFICIENTE`
    muestra el disponible). Las claves de las consultas incluyen la identidad de la sesión (criterio 28 de 003). Además,
    una prueba E2E de Playwright: abrir con S/ 100, registrar un egreso de S/ 15.50, cerrar con S/ 80 (faltante de S/ 4.50)
    con observación y ver el resultado. _(prueba obligatoria, de componentes y E2E)_
39. **Montos en la web sin coma flotante.** La diferencia en vivo y el resumen se calculan con una función pura compartida
    (`restarMontos`, en `packages/contratos/src/dinero.ts`) que trabaja en céntimos enteros (`bigint`) sobre el texto, sin
    `Number` ni `parseFloat`; `"126.50"` menos `"126.49"` da `"0.01"` y al revés `"-0.01"`; siempre con dos decimales y
    nunca `"-0.00"` (entradas y salida en PP3). Los montos se muestran con
    `formatearSoles` (`S/ 1,200.00`), los negativos como `-S/ 4.50` o con la palabra "Faltante". _(prueba obligatoria)_

### I. Historial y PDF del cierre **[006b, siguiente PR]**

40. **Historial de cajas.** `GET /api/cajas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` responde 200 con `{ desde, hasta, cajas }`
    (el rango aplicado y las cajas, PQ3), de la fecha más reciente a la más antigua, con `id`, `fecha`, `estado`,
    `deOtroDia`, `montoInicial`, `abiertaPor`, `totalIngresos` (por método), `totalEgresos` y `ultimoCierre` (número,
    declarado, diferencia, resultado, `tardio`, quién y cuándo) o `null` (forma exacta en PQ4). Sin parámetros, los últimos
    31 días hasta hoy en Lima; el rango es de como mucho 366 días y `desde` no puede ser posterior a `hasta` (si no, 400 con
    el campo; reglas exactas en PQ3). **Alcance:** el `ADMIN` ve todas las cajas de A; la `SECRETARIA` ("parcial, su
    caja", sección 2.1) ve solo las cajas que abrió, las que cerró alguna vez y la caja abierta (DR-9), más la caja de hoy
    (DR-13; reglas exactas en PQ2). No bloquea, no escribe y no audita. _(crítico)_ (sección 2.1, HU-27, D-23)
41. **Detalle de una caja.** `GET /api/cajas/{id}` responde 200 con `{ caja }` (`cajaSchema`, como el criterio 28), con
    todos sus cierres y sus reaperturas (quién, cuándo y el motivo; PQ5). Una caja de B, un id que no existe o que no es
    UUID, y una caja fuera del alcance de la `SECRETARIA` (criterio 40) responden el mismo 404 `NO_ENCONTRADO` (PQ1).
    _(crítico)_ (HU-27: "el administrador puede ver … un cierre"; D-23)
42. **PDF del cierre.** `GET /api/cajas/{id}/cierres/{numero}/pdf` responde 200 con `Content-Type: application/pdf`,
    `Content-Disposition: attachment; filename="cierre-caja-AAAA-MM-DD-N.pdf"` y `Cache-Control: no-store` (cabeceras
    exactas en PQ7). El PDF (`pdfkit`, A4) lleva: el nombre de la academia (D-22), la fecha de la caja, "Cierre N" y, si es
    un cierre tardío, "Cierre tardío"; la apertura (quién, hora de Lima, monto inicial); los movimientos con `numero` hasta
    `movimientosHasta` (hora de Lima, tipo, concepto o descripción, método, nombre del alumno o comprobante, monto; nunca
    el DNI); los totales por método; el esperado, el declarado, la diferencia ("Sobrante", "Faltante" o "Cuadra") y la
    observación; quién cerró y a qué hora; y, si ese cierre se reabrió, quién, cuándo y el motivo (textos y formatos en
    PQ10). Los caracteres que la fuente estándar no puede mostrar se reemplazan por `?` (regla exacta en PQ11). Mismo
    alcance y mismo 404 que el criterio 41; un `numero` que no existe o que no es un entero de 1 en adelante, 404 (PQ6).
    Tiene PDF cualquier cierre de la caja, vigente o reabierto (PQ6). El contenido se comprueba extrayendo el texto del
    PDF. _(crítico el alcance y el 404; prueba obligatoria el contenido)_ (HU-27: "se genera un PDF del cierre"; D-10)
43. **El PDF se genera fuera de la escritura.** El PDF se arma bajo pedido con lo que ya está confirmado: el cierre y sus
    movimientos no cambian (criterios 2 y 23), así que dos descargas del mismo cierre dan el mismo contenido (con la fecha
    de creación del PDF igual a `cerradoEn`; mientras no se reabra ese cierre ni cambien los nombres, los mismos bytes:
    PQ9). El cierre (`POST …/cierre`) no genera ni guarda ningún PDF ni archivo, y una falla al generar el PDF (por
    ejemplo, `pdfkit` que lanza) responde 500 `ERROR_INTERNO` en la descarga sin cambiar la caja ni el cierre. La lectura de
    los datos usa su propia transacción corta, que solo lee, y el PDF se arma después de terminarla (generador inyectable
    en PQ8; pruebas en PQ9). _(crítico)_ (regla "los efectos secundarios ocurren después de confirmar" de `CLAUDE.md`)
44. **Web del historial.** `/panel/cajas` ("Historial de caja" en el inicio, con `puede(rol, 'VER_REPORTES_FINANCIEROS')`)
    lista las cajas con el filtro de fechas, abre el detalle con sus movimientos y cierres, descarga el PDF de cada cierre
    y, para el `ADMIN`, ofrece "Reabrir" en las cajas cerradas (diálogo con el motivo; los 409 de la reapertura con su
    mensaje). Detalle de las pantallas en PQ12. _(prueba obligatoria, de componentes)_
49. **El PDF no detiene la API de las demás academias.** _(Ronda adversarial 1 de la 006b; amplía el criterio 43.)_
    La instalación atiende a varias academias (D-23), así que generar un PDF no puede dejar la API sin atender a nadie.
    No hay tope de movimientos por caja ni por PDF, porque sería una regla de negocio (DT-7). Se acota cuánto bloquea
    cada PDF y cuántos se generan a la vez.
    - a) **Sin bloquear el bucle de eventos.** Dado un cierre de una caja de A con 5 000 movimientos
      (`movimientosHasta: 5000`, creados como dueño de las tablas), con el generador real:
      - **Preparación:** la prueba descarga una vez el PDF de un cierre pequeño, para que la primera carga de `pdfkit` y
        de la fuente no cuente.
      - **Medición:** activa `monitorEventLoopDelay` de `node:perf_hooks` (resolución de 10 ms) y lanza a la vez tres
        descargas del PDF de ese cierre: dos del `ADMIN` de A y una de la `SECRETARIA` de A que abrió la caja.
      - **Escritura de otra academia:** 300 ms después, envía un egreso válido a la caja abierta de hoy de B, con la
        sesión de una `SECRETARIA` de B.

      Entonces:
      - el egreso de B responde 201 en menos de 1 000 ms desde que se envió, con su fila y su auditoría;
      - al menos una de las tres descargas responde después que el egreso. Esto prueba que se cruzaron: si no se
        cruzan, la prueba falla en lugar de pasar sin medir;
      - las tres descargas responden 200 con el mismo cuerpo (`Buffer.equals`; criterio 43 y PQ9 d). Es un PDF válido
        (PQ7) y su texto (utilidad de PQ10) contiene los movimientos 1 y 5000;
      - desde que se lanzan las descargas hasta la última respuesta, el retraso máximo del bucle (`max` del
        histograma) es como mucho 200 ms.
    - b) **Pocas generaciones a la vez y una espera acotada.** En cada proceso de la API, contando todas las
      academias:
      - **Límites:** como mucho 2 PDF se generan a la vez. Se cuentan las llamadas en curso a
        `GENERADOR_PDF_CIERRE.generar`, también con el generador de las pruebas. Como mucho 8 descargas más esperan su
        turno, en orden de llegada. Los valores son la constante `LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8 }`
        del backend.
      - **Cola llena:** una descarga que llega con 2 en curso y 8 esperando responde enseguida 429
        `DEMASIADAS_SOLICITUDES`. Lleva el cuerpo y el mensaje que ya tiene el filtro de errores ("Hiciste demasiadas
        solicitudes. Espera un momento e intenta de nuevo."), en JSON, con `Cache-Control: no-store` y sin
        `Content-Disposition`. No llama al generador, no escribe y no audita.
      - **Orden de comprobaciones de la ruta:**
        1. sesión, academia activa, cambio obligatorio y permiso (PQ1);
        2. forma del id y del `numero` (el 404 de PQ1 y PQ6, sin tocar la base ni la cola);
        3. límite por persona (c);
        4. lugar en la cola: 429 si está llena;
        5. espera del turno;
        6. lectura en su transacción corta: 404 si la caja o el cierre no existen o están fuera del alcance;
        7. generación y respuesta.

        Con la cola llena, un cierre con un `numero` de forma válida que no existe responde 429, no 404. Eso no revela
        nada, porque el 429 no depende de la caja.
      - **Sin transacción en la espera:** la lectura empieza recién con el turno, así que una descarga que espera no
        tiene ninguna transacción abierta. La condición de PQ9 c vale también durante la espera.
      - **Toda descarga libera su lugar** al terminar, con 200, 404 o 500.
      - **Ámbito:** los límites son por proceso, como los contadores de `@nestjs/throttler` (PO-6). Con varias
        instancias de la API, cada una tiene los suyos.

      Pruebas:
      - Con un generador que la prueba retiene (como PQ9 c), cinco personas con permiso de A y de B lanzan diez
        descargas válidas, dos cada una.
      - Cuando el generador tiene dos llamadas en curso y pasaron al menos 500 ms, el generador sigue con dos llamadas.
        Nunca tiene más de dos a la vez en toda la prueba.
      - Mientras tanto, ninguna conexión del rol de la app está `idle in transaction`.
      - Una 11.ª descarga, de una sexta persona, responde 429.
      - Una descarga de la sexta persona con `numero` `0` responde el 404 de PQ6, no 429.
      - Al soltar el generador, las diez responden 200 y el generador recibió diez llamadas.
      - Aparte, después de 12 descargas seguidas que terminan en 500 (generador que rechaza) y 12 que terminan en 404
        (`numero` válido que no existe), una descarga válida responde 200.
    - c) **Como mucho dos por persona.** Una persona (`sesion.usuario.id`, no la academia ni la IP) tiene como mucho 2
      descargas de PDF en curso o esperando turno. La tercera simultánea responde el 429 de b, aunque la cola tenga
      lugar, y no llama al generador. Así una sola persona no llena la cola de todas las academias, y un doble clic
      (dos descargas) sigue funcionando. Prueba, con el generador retenido:
      - el `ADMIN` de A lanza dos descargas y una tercera, que responde 429;
      - a la vez, la `SECRETARIA` de A y el `ADMIN` de B descargan, y responden 200 al soltar el generador;
      - cuando terminan las dos del `ADMIN` de A, una nueva descarga suya responde 200.
    - d) **Lo demás no cambia.**
      - El PDF sigue siendo determinista: los mismos bytes, también con el proceso en `TZ=Asia/Tokyo` (criterio 43 y
        PQ9 d).
      - `generarPdfCierre(datos): Promise<Buffer>`, `GeneradorPdfCierre` y `GENERADOR_PDF_CIERRE` siguen como en PQ8:
        el generador es inyectable y se reemplaza con `overrideProvider`.
      - La lectura termina antes de generar (PQ9 c).
      - Una falla al generar sigue respondiendo 500 `ERROR_INTERNO` sin cambios en la base (PQ9 b).
      - El contenido sigue siendo el de PQ10 y PQ11.

      Quien implementa elige la técnica: un `worker_thread` o generar por tramos cediendo el bucle (plan 2.12).

    _(crítico)_ (D-23; criterio 43; regla "los efectos secundarios ocurren después de confirmar" de `CLAUDE.md`)
50. **`HEAD` no existe en las rutas de la caja.** _(Ronda adversarial 1 de la 006b; amplía el criterio 23 y PQ15.)_
    Express atiende un `HEAD` con el manejador del `GET` de la misma dirección. En la caja no:
    - **Rutas:** `HEAD` sobre `/api/cajas/{id}/cierres/{numero}/pdf`, `/api/cajas`, `/api/cajas/actual` y
      `/api/cajas/{id}`.
    - **Respuesta:** 404 `NO_ENCONTRADO`, igual que `PATCH` sobre esas direcciones (PQ15).
    - **Casos:**
      - con la sesión válida de cualquier rol. También el `ENTRENADOR` y el `ALUMNO`, que en el `GET` reciben 403: para
        `HEAD` la ruta no existe, como para `PATCH`;
      - con un id o un `numero` que existen, que no existen o que no son válidos;
      - con parámetros de consulta, con barra final y con mayúsculas en la dirección (`/api/Cajas/…`), porque el
        enrutador no distingue mayúsculas.
    - **Cabeceras:** las del JSON de error de siempre (`Content-Type: application/json`, `Cache-Control: no-store`) y
      ninguna del PDF (`Content-Disposition`). No hay cuerpo, porque un `HEAD` nunca lo tiene.
    - **Sin efectos:** no llama al generador del PDF (se comprueba con el generador espía de PQ9 a), no escribe y no
      audita.
    - **Sin sesión, con el cambio de contraseña pendiente o con la academia suspendida:** responde lo mismo que `PATCH`
      en esa dirección.
    - **El `GET` de las cuatro rutas no cambia.**

    _(crítico)_ (D-23; criterio 23; PQ15)

#### Precisiones de la 006b (PQ1 a PQ15)

Repaso del especificador antes de las pruebas protegidas de la 006b (22/11/2026, sobre `095d153`), contra lo construido en
la 006a. Son técnicas: no cambian ninguna regla de negocio aprobada. La única que dependía del responsable es la caja
de hoy en el alcance de la secretaria (PQ2 d), decidida en DR-13 (pregunta P13). Se citan como "PQn".

- **PQ1 · Orden de comprobaciones, 403 y 404 (criterios 7, 8, 41 y 42).** Las tres rutas siguen el orden de 002: sesión
  (401 `NO_AUTENTICADO`) → academia activa (403 `ACADEMIA_SUSPENDIDA`) → cambio obligatorio (403
  `CAMBIO_DE_CLAVE_OBLIGATORIO`) → permiso (403 `SIN_PERMISO`) → consulta (solo la lista, PQ3) → operación. Por eso
  `ENTRENADOR` y `ALUMNO` reciben 403 aunque el id, el número o la consulta sean inválidos. En el detalle y en el PDF,
  todo lo que no se puede mostrar responde **el mismo 404 `NO_ENCONTRADO`** (el mismo cuerpo JSON, comparado entero): un
  id que no es UUID, uno que no existe, uno de otra academia y uno fuera del alcance de la `SECRETARIA` (PQ2); en el PDF,
  además, un `numero` inválido o que no existe en esa caja (PQ6). Nunca 400 ni 403 por el id o el número: una caja fuera
  del alcance no se distingue de una que no existe. Un UUID en mayúsculas es la misma caja (200, como en la 006a). Las
  tres lecturas no llaman a `bloquearActorVigente` (como `GET /api/cajas/actual` y la lista de la 005b), no bloquean
  filas, no escriben y no auditan. Los parámetros de consulta de más se ignoran en las tres; `?academiaId=<id de B>`
  nunca cambia de academia (cierra el "se ignora o responde 400" del criterio 8: se ignora).
- **PQ2 · Alcance (criterio 40 y DR-9).** El servicio lee el alcance de la matriz
  (`MATRIZ_PERMISOS.VER_REPORTES_FINANCIEROS[rol]`), no compara el nombre del rol: `TODO` ve todas las cajas de la
  academia; `SU_CAJA` ve una caja si se cumple al menos una de estas condiciones, evaluadas en cada petición:
  - a) `cajas.abierta_por` es ella;
  - b) algún cierre de esa caja, vigente o ya reabierto, tiene `cerrado_por` igual a ella ("las que cerró alguna vez");
  - c) la caja está `ABIERTA` ahora (de hoy o de otro día);
  - d) **(DR-13)** la `fecha` de la caja es hoy en Lima (`hoyEnLima(RELOJ.ahora())`), aunque la hayan abierto y
    cerrado otras personas. Motivo: la misma caja ya la ve en `/panel/caja` (criterio 28).

  Cualquier otro alcance, o ninguno, no ve nada (falla cerrada; con la matriz de hoy no ocurre, porque el guard ya
  rechazó). Dentro de una caja que puede ver, ve todo: sus movimientos (los haya registrado quien sea), todos sus
  cierres y reaperturas y el PDF de cada cierre. El alcance se aplica igual en la lista (filtra), en el detalle y en el
  PDF (404). Una caja sale del alcance cuando deja de cumplir todas las condiciones (por ejemplo, la cierra otra persona
  y ya no es de hoy). **Escenario de las pruebas** (cajas creadas como dueño, en días anteriores a hoy, en A, con
  `SECRETARIA` S1 y S2):
  - C1: la abrió y la cerró S1 → la ven S1 y el `ADMIN`; S2, 404;
  - C2: la abrió S2 y la cerró el `ADMIN` → S2 sí; S1, 404;
  - C3: la abrió el `ADMIN`, S1 hizo el cierre 1, el `ADMIN` la reabrió e hizo el cierre 2 → S1 sí (cerró alguna vez),
    también el PDF del cierre 2; S2, 404;
  - C4: la abrió S2 y sigue abierta (de otro día) → la ven S1 y S2;
  - C5 (DR-13): la de hoy, cerrada, que abrió S2 y cerró el `ADMIN` → la ven S1 y S2;
  - el `ADMIN` ve las cinco; una caja de B no la ve nadie de A.
- **PQ3 · Consulta y rango de la lista (criterio 40).**
  - **Lectura de la consulta:** solo `desde` y `hasta`, cada uno con `fechaSchema` (una fecha `AAAA-MM-DD` que existe).
    Como `?estado=` en la 005b (`estadoCrudo` de `solicitudes.controller.ts`), la API lee la consulta tal como llegó: un
    parámetro repetido (`?desde=…&desde=…`) o con corchetes (`desde[]=…`, `desde[x]=…`) es un 400 en ese campo. Un valor
    vacío (`?desde=`) es un 400 en ese campo (no cuenta como ausente). Los demás parámetros se ignoran.
  - **Valores por defecto,** con "hoy" de `RELOJ` en Lima: sin `hasta`, `hasta` es hoy; sin `desde`, `desde` es `hasta`
    menos 30 días (31 días contando los dos extremos), sin bajar de `0001-01-01`.
  - **Reglas del rango,** después de aplicar los valores por defecto y solo si los dos valores tienen formato válido:
    `desde` posterior a `hasta` → 400 en `desde` ("La fecha inicial no puede ser posterior a la final."); más de 366 días
    contando los dos extremos (`hasta − desde > 365`) → 400 en `desde` ("El rango puede ser de como mucho 366 días.").
    Los errores de formato van primero, uno por campo, en el orden `desde`, `hasta`. Todo 400 es `SOLICITUD_INVALIDA` con
    `detalles.errores[0].campo`, sin escribir. Las cuentas son en días de calendario, sin zona horaria: el resultado no
    cambia con el proceso en `TZ=Asia/Tokyo`.
  - **Ejemplos** con hoy `2026-11-11`: sin parámetros → `2026-10-12` a `2026-11-11`; `desde=2025-11-11&hasta=2026-11-11`
    (366 días) → 200; `desde=2025-11-10&hasta=2026-11-11` → 400 en `desde`; `desde=2024-02-29&hasta=2025-02-28` (366 días,
    año bisiesto) → 200; solo `desde=2026-11-12` → 400 en `desde` (`hasta` es hoy); solo `desde=2025-11-10` → 400 en
    `desde`; solo `hasta=2099-12-31` → `2099-12-01` a `2099-12-31`, 200 con `cajas: []`; solo `hasta=0001-01-15` →
    `0001-01-01` a `0001-01-15`; `desde=2026-02-30` → 400 en `desde`; `desde=2026-11-01T00:00` → 400 en `desde`.
  - **Respuesta:** `{ desde, hasta, cajas }`, con el rango aplicado (después de los valores por defecto), para que la web
    lo muestre.
- **PQ4 · Cada caja de la lista (`cajaHistorialSchema`, estricto; criterio 40).** Exactamente: `id`, `fecha`, `estado`,
  `deOtroDia`, `montoInicial`, `abiertaPor` (`personaCajaSchema`), `totalIngresos` (`{ efectivo, yape, transferencia }`),
  `totalEgresos` (`{ efectivo }`) y `ultimoCierre`. Reglas:
  - las cajas con `fecha` entre `desde` y `hasta`, los dos incluidos, dentro del alcance (PQ2); una caja abierta con
    fecha fuera del rango no aparece (se ve en `/panel/caja`);
  - orden por `fecha` descendente; no hay empates (una caja por día y academia, DR-1, `cajas_academia_id_fecha_key`), así
    que el "por id a igual fecha" del borrador no aplica;
  - **sin paginación:** el rango de como mucho 366 días acota la lista a 366 cajas;
  - los totales son las sumas de todos los movimientos de la caja en este momento (como `resumen` del criterio 28), no la
    foto del último cierre;
  - `ultimoCierre` es el cierre de mayor `numero` (vigente o reabierto) con exactamente `{ numero, montoDeclarado,
    diferencia, resultado, tardio, cerradoPor, cerradoEn }`, o `null` si la caja nunca se cerró. Una caja `ABIERTA` con
    `ultimoCierre` es una caja reabierta;
  - `deOtroDia` es `esDeOtroDia(fecha, ahora)` sin mirar el estado, igual que en `cajaSchema` (desviación aceptada de la
    006a, plan sección 6): toda caja de un día anterior lo tiene en `true`, también las cerradas;
  - los montos sin signo con `montoDeLecturaSchema`, la diferencia con `montoConSignoSchema`, `resultado` con
    `resultadoCierreSchema`, `cerradoEn` en ISO; las personas sin DNI;
  - la lista sale de una sola consulta SQL (una sola foto de la base: los totales y el último cierre no se mezclan con un
    movimiento que entre a mitad de la lectura).
- **PQ5 · Detalle (criterio 41).** `GET /api/cajas/{id}` responde `{ caja }` armado con `leerCaja` de `lectura.ts`, la
  misma función de `GET /api/cajas/actual`: para la caja que devuelve `/actual`, las dos respuestas son iguales (se
  comparan enteras con el reloj fijo). Trae todos los movimientos de la caja por `numero` (también los posteriores al
  último cierre, si se reabrió) y todos los cierres por `numero` ascendente, cada uno con `reapertura` o `null`; el
  vigente es el último y solo si la caja está `CERRADA`.
- **PQ6 · Qué cierres tienen PDF y el `numero` de la ruta (criterio 42).** Tiene PDF cualquier cierre de una caja que se
  puede ver: el vigente y los reabiertos, aunque la caja esté abierta otra vez. Una caja que nunca se cerró no tiene
  ninguno (404). El `numero` vale solo si cumple `^[1-9][0-9]{0,4}$` y es como mucho 32767 (`smallint`); si no, 404 sin
  consultar la base. Responden 404: `0`, `-1`, `01`, `+1`, `1.0`, `1e0`, ` 1` (`%201`), `32768`, `99999999999999999999`,
  `uno`, y un número válido que no es de un cierre de esa caja. Nunca 500.
- **PQ7 · Cabeceras y cuerpo del PDF (criterio 42).** 200 con `Content-Type` exactamente `application/pdf` (sin
  `charset`), `Content-Disposition` exactamente `attachment; filename="cierre-caja-<fecha de la caja>-<numero>.pdf"` (por
  ejemplo `cierre-caja-2026-11-02-1.pdf`; el número sin ceros a la izquierda; el nombre no lleva ningún texto de un
  usuario), `Cache-Control: no-store` (ya lo pone el middleware de las rutas de academia) y `Content-Length` igual al
  tamaño del cuerpo. El cuerpo empieza con `%PDF-` y termina con `%%EOF` (con o sin salto de línea final). Las respuestas
  de error (401, 403, 404 y 500) son el JSON de error de siempre, con `Cache-Control: no-store` y sin
  `Content-Disposition`.
- **PQ8 · El generador del PDF, inyectable (criterio 43).** `backend/src/modulos/caja/pdf/cierre-pdf.ts` exporta
  `generarPdfCierre(datos: DatosPdfCierre): Promise<Buffer>` (con `pdfkit`, sin base de datos), la interfaz
  `GeneradorPdfCierre { generar(datos: DatosPdfCierre): Promise<Buffer> }` y el token de Nest `GENERADOR_PDF_CIERRE`, que
  `CajaModule` provee con `{ generar: generarPdfCierre }`; `caja/index.ts` los reexporta. El servicio lee los datos en un
  `conAcademia` que solo lee, sale de él y recién entonces llama a `generar`; con el `Buffer` completo, responde. Las
  pruebas reemplazan el generador con `overrideProvider(GENERADOR_PDF_CIERRE)`. "Solo lectura" quiere decir que la
  transacción solo lee; no se exige `SET TRANSACTION READ ONLY`.
- **PQ9 · Pruebas de "fuera de la escritura" (criterio 43).**
  - a) Con un generador espía: un `POST …/cierre` (y una apertura, un egreso y una reapertura) no lo llama ni una vez,
    y en `ALMACEN_DIRECTORIO` no aparece ningún archivo nuevo.
  - b) Con un generador que rechaza su promesa, y con otro que lanza al llamarlo: la descarga responde 500
    `ERROR_INTERNO` (JSON, sin `Content-Disposition`); las filas de `cajas`, `movimientos_caja`, `cierres_caja` y
    `auditoria` de la academia quedan iguales; con el generador real de nuevo, la misma descarga responde 200.
  - c) Con un generador que la prueba retiene (una promesa que la prueba resuelve después): mientras `generar` está en
    curso, ninguna conexión del rol de la app a la base de pruebas está `idle in transaction`
    (`pg_stat_activity.state LIKE 'idle in transaction%'`, filtrado por `datname = current_database()` y el `usename`
    del rol de la app): la lectura ya terminó. Después la prueba deja seguir al generador real y la descarga responde 200.
  - d) Dos descargas seguidas del mismo cierre devuelven los mismos bytes (`Buffer.equals`), también con el proceso en
    `TZ=Asia/Tokyo` (como el criterio 12). `info.CreationDate` es `cerradoEn`; si `pdfkit` agrega algo que cambie entre
    ejecuciones (como el `/ID` del final), se fija a partir de los datos del cierre. El contenido cambia solo si ese
    cierre se reabre (aparece la reapertura) o si cambia un nombre (PQ10).
- **PQ10 · Contenido mínimo verificable del PDF (criterio 42, prueba obligatoria, no protegida).** Formatos: fechas
  `dd/MM/aaaa`; horas `HH:mm` (24 horas) en America/Lima; montos `S/ 1,200.00` (coma de miles, punto decimal), con la
  función de texto `formatearSoles`, que pasa de `frontend/src/lib/dinero.ts` a `packages/contratos/src/dinero.ts` (la
  web la reexporta; sin `Number` ni `parseFloat`). Textos que la prueba busca:
  - el nombre de la academia (`sesion.academia.nombre`, de `academias.nombre`, D-22), "Cierre de caja", "Caja del
    dd/MM/aaaa", "Cierre N" y, si `tardio`, "Cierre tardío";
  - "Abierta por {nombres} {apellidos} a las HH:mm" y "Monto inicial: S/ …";
  - cada movimiento de `numero` 1 a `movimientosHasta` del cierre (los de toda la caja, no solo los posteriores al
    cierre anterior, como la foto del criterio 33 d), en orden: el número, la hora, "Ingreso" o "Egreso", el concepto
    ("Inscripción", "Mensualidad", "Clase particular") o la descripción del egreso, el método ("Efectivo", "Yape",
    "Transferencia"), el nombre del alumno (ingreso) o el comprobante ("Sin comprobante" si es `null`) y el monto;
  - "Ingresos en efectivo", "Ingresos por Yape", "Ingresos por transferencia", "Egresos", "Esperado en efectivo",
    "Declarado" y "Diferencia", con los montos de la fila del cierre (la foto, no una suma nueva). La diferencia se
    escribe con signo y resultado: "-S/ 4.50 (Faltante)", "S/ 0.30 (Sobrante)", "S/ 0.00 (Cuadra)" (el `-` va delante
    de `formatearSoles` del valor sin signo, como en la web del criterio 39);
  - "Observación: …" si hay; "Cerrado por {nombres} {apellidos} el dd/MM/aaaa a las HH:mm";
  - si ese cierre se reabrió: "Reabierto por {nombres} {apellidos} el dd/MM/aaaa a las HH:mm" y "Motivo: …";
  - nunca un DNI: la prueba comprueba que no aparecen los DNI del alumno ni de los usuarios;
  - una caja de las 19:30 en Lima (00:30 del día siguiente en UTC) muestra su fecha de Lima y "19:30".

  Los nombres son los de hoy de cada persona (como la pantalla); los montos y la observación son los del cierre, que no
  cambian. `info.Title` es `Cierre de caja AAAA-MM-DD N`, sin textos de usuarios. **Extracción del texto en las pruebas:**
  una utilidad de prueba (`backend/test/utilidades/pdf.ts`), sin dependencias nuevas, que descomprime los flujos
  `FlateDecode` con `node:zlib`, lee las cadenas de `Tj` y `TJ` (literales y hexadecimales) y las pasa de WinAnsi a
  Unicode. Las pruebas usan textos cortos (que no se parten en dos líneas) y buscan cada dato como subcadena.
- **PQ11 · Caracteres que la fuente no puede mostrar (criterio 42).** Todo texto que sale de los datos (nombre de la
  academia, nombres, descripción, comprobante, observación y motivo) pasa por una función pura, `textoParaPdf`, antes de
  escribirse: primero se normaliza a NFC; después, cada punto de código que no esté entre U+0020 y U+007E ni entre U+00A0
  y U+00FF se reemplaza por un `?` (uno por punto de código: un emoji, aunque en UTF-16 sean dos unidades, es un solo
  `?`; un sustituto suelto, también). Ejemplos: `Piña` y `Ñandú` quedan igual; `e` + U+0301 queda `é` (NFC); `😀`, `Ω`
  y `’` (comilla curva) salen `?` cada uno; `B{U+200B}1` sale `B?1`; U+00A0 y U+00AD están en el rango y quedan; un
  tabulador o un salto de línea escritos directo en la base salen `?`. La base no cambia: solo el PDF. Por los criterios
  18, 47 y 30, la API ya no deja guardar controles, caracteres de dirección del texto ni separadores en los textos del
  egreso, la observación y el motivo; esta función es la segunda capa y cubre también los nombres y las filas escritas
  directo en la base. Con `pdfkit`, el texto se escribe codificado (nunca como operadores del PDF), así que ningún texto
  puede cambiar la estructura del documento.
- **PQ12 · Web del historial (criterio 44).**
  - **Rutas:** `/panel/cajas` (lista, `PaginaHistorialCajas.tsx`) y `/panel/cajas/:id` (detalle, `DetalleCaja.tsx`), las
    dos dentro de `RequierePermiso` con `VER_REPORTES_FINANCIEROS`; la opción "Historial de caja" del inicio usa
    `puede(rol, 'VER_REPORTES_FINANCIEROS')`. A `ENTRENADOR` y `ALUMNO` no se les muestra y la página responde con el
    mensaje de "sin permiso" de 002.
  - **Lista:** dos campos de fecha ("Desde" y "Hasta"), vacíos al entrar (la API aplica sus valores por defecto); la
    página muestra el rango aplicado que devuelve la API. Antes de pedir, valida con `filtroHistorialCajasSchema` y
    muestra el error en su campo sin llamar a la API. Cada fila: fecha, estado ("Abierta", "Abierta de otro día" o
    "Cerrada"), quién abrió, monto inicial, ingresos por método, egresos y, si hay último cierre, declarado, diferencia
    ("Sobrante", "Faltante" o "Cuadra") y "Tardío"; lleva al detalle. Sin cajas: "No hay cajas en estas fechas".
  - **Detalle:** reutiliza los componentes de `/panel/caja` (`ResumenCaja`, `ListaMovimientos`, `ResultadoDelCierre`)
    en modo de solo lectura: muestra cada cierre (de 1 en adelante) con su reapertura (quién, cuándo y el motivo) y un
    botón "Descargar PDF" por cierre. No ofrece egresos ni cierre; si la caja está abierta y la persona tiene
    `ABRIR_CERRAR_CAJA`, un enlace "Ir a la caja del día" (`/panel/caja`).
  - **Descarga:** antes confirma la sesión (`useConfirmarSesion`, como las escrituras); pide el PDF con `fetch` (misma
    cookie) y, con 200 y `application/pdf`, lo entrega al navegador como archivo `cierre-caja-<fecha>-<numero>.pdf` con
    una URL de objeto que se revoca al terminar. Con 404, "No se encontró el cierre"; con 500 u otro error, "No se pudo
    generar el PDF. Inténtalo de nuevo."; con 401, el flujo de sesión perdida de 002. Nada se guarda en el
    almacenamiento local.
  - **Reabrir:** solo con `puede(rol, 'REABRIR_CAJA')` y en una caja `CERRADA`, con `DialogoReapertura`. Si la caja no es
    de hoy en Lima, el diálogo no dice "volverá a admitir egresos y cobros", sino "Es la caja de un día anterior: solo
    podrás volver a contar el efectivo y cerrarla" (DR-8, criterio 36 c). Con éxito, el detalle muestra la caja que
    devuelve la API y se invalidan la lista y `caja-actual`; los 409 con su mensaje de `mensajes.ts`.
  - **Consultas:** claves con la identidad de la sesión (criterio 28 de 003): `['cajas-historial', nombreCorto,
    usuarioId, desde, hasta]` y `['caja', nombreCorto, usuarioId, id]`.
  - `/panel/caja` no cambia: su estado "caja cerrada de un día anterior" sigue sin "Reabrir" (desviación aceptada de la
    006a); esa reapertura se hace desde el detalle del historial.
- **PQ13 · Nombres reales y lo que quedó desfasado.** En `packages/contratos/src/caja.ts`: `filtroHistorialCajasSchema`
  (objeto `{ desde?, hasta? }` con `fechaSchema` y, si vienen los dos, las reglas del rango de PQ3, con los mismos
  campos y mensajes), `cajaHistorialSchema`, `respuestaHistorialCajasSchema = { desde: fechaSchema, hasta: fechaSchema,
  cajas }`, la constante `LIMITES_HISTORIAL_CAJAS = { diasPorDefecto: 31, diasMaximos: 366 }` y sus tipos
  (`FiltroHistorialCajas`, `CajaHistorial`, `RespuestaHistorialCajas`); reutilizan `montoDeLecturaSchema`,
  `montoConSignoSchema`, `personaCajaSchema`, `resultadoCierreSchema`, `estadoCajaSchema` y `fechaSchema`. En el backend:
  `historial.service.ts` usa `leerCaja`, `noEncontrado()` de `errores.ts`, `esDeOtroDia` y `calcularDiferencia`; las tres
  rutas van en `CajasController`, con `actual` declarada antes de `:id` (ya lo está). `pdfkit` y `@types/pdfkit` se suman
  a `DEPENDENCIAS_BACKEND_PERMITIDAS`; la prueba protegida de 001 (`scripts/test/dependencias-backend.test.mjs`) suma un
  caso "solo para sumar", como hizo la 005b con `sharp`, en el commit de pruebas protegidas de la 006b.
- **PQ14 · Semilla y guía (criterios 45 y 46).** La caja de ejemplo de `delfines` (`2026-11-02`, la abrió y la cerró la
  secretaria de ejemplo) la ven en el historial el administrador y esa secretaria. Como el rango por defecto son los
  últimos 31 días, a partir del 3 de diciembre de 2026 queda fuera: la guía de uso indica filtrar "Desde 01/11/2026" para
  verla y descargar su PDF. La semilla no cambia.
- **PQ15 · Rutas que siguen sin existir (criterio 23).** Con `GET /api/cajas/{id}` y la ruta del PDF agregadas, `PATCH`,
  `PUT`, `DELETE` y `POST` sobre `/api/cajas/{id}`, y cualquier método que no sea `GET` sobre
  `/api/cajas/{id}/cierres/{numero}/pdf`, siguen respondiendo 404 sin tocar nada. Desde la ronda adversarial 1 de la
  006b, eso incluye `HEAD` sobre las cuatro rutas de lectura de la caja (criterio 50).

### J. Semilla y documentación

45. **Semilla.** En `delfines`, una caja de ejemplo cerrada en una fecha fija pasada (`2026-11-02`), abierta y cerrada
    por la secretaria de ejemplo, con un egreso y un cierre con un sobrante pequeño y su observación; ninguna caja
    abierta. `tiburones` queda sin cajas. Se puede ejecutar dos veces sin duplicar ni fallar (claves de idempotencia
    fijas). **[006b]** El historial y el PDF de esa caja se ven en la guía de uso. _(verificación del revisor)_
46. **Documentación.** `docs/arquitectura.md` documenta las tablas, el permiso nuevo, la interfaz
    `registrarIngresoEnCaja` (y `registrarEgresoEnCaja`, `leerCajaAbierta`) y las "Reglas para las historias siguientes"
    de esta spec; el `README.md` y la guía de uso explican la caja del día y **[006b]** el historial y el PDF; la nota de
    la 007 y la de la 019 en `specs/backlog.md` remiten a esas reglas. _(verificación del revisor)_

## Casos límite

- **Clase de 19:00 a 20:00 y cierre a las 20:30:** en Lima es el mismo día, aunque en UTC ya sea el siguiente; la caja
  no es "de otro día" y el cierre no es tardío (criterios 20 a y 32).
- **Medianoche en Lima con la caja abierta:** desde las 00:00 la caja pasa a ser de otro día: no admite egresos ni cobros
  y solo se cierra; después se abre la del día nuevo (criterios 14, 20 y 32). Perú no tiene horario de verano.
- **Servidor en otra zona o base en UTC:** la fecha de la caja sale de `hoyEnLima(RELOJ.ahora())`, y la base la vuelve a
  exigir con `AT TIME ZONE 'America/Lima'` (criterios 4 a y 12).
- **Monto inicial en cero:** se acepta (DR-6); el esperado en efectivo empieza en `"0.00"`.
- **Egreso igual al efectivo disponible:** se acepta y el esperado queda en `"0.00"`; un céntimo más, 409 (DR-4).
- **Caja sin movimientos:** se cierra igual; el esperado es el monto inicial; `ultimoMovimientoVisto` es 0.
- **Declarado en cero con esperado mayor:** faltante igual a todo el esperado, con observación obligatoria.
- **Diferencia de un céntimo:** cuenta como diferencia (`"0.01"` o `"-0.01"`) y exige observación.
- **Caja que se reabre dos veces:** quedan los cierres 1, 2 y 3; solo el último está vigente; los anteriores muestran su
  reapertura (criterio 35).
- **Caja abierta por una secretaria que luego se desactiva:** la caja sigue abierta y cualquier otra secretaria o el
  administrador la opera y la cierra; los nombres de quien abrió se siguen mostrando.
- **Academia suspendida con la caja abierta:** nadie de la academia la ve mientras esté suspendida (403); al reactivarse,
  si cambió el día, es una caja de otro día y se cierra antes de abrir la nueva.
- **Doble clic en "Cerrar caja" con un monto distinto en el segundo clic:** el segundo responde 409 `CLAVE_YA_USADA` y el
  cierre guardado es el primero (criterio 34).
- **Reintento de un egreso después de que alguien cerró la caja:** con la misma clave responde 200 con el egreso ya
  registrado (no 409), porque la clave se mira antes que el estado (criterio 22).
- **Un cobro de la 007 cuando la caja de hoy ya se cerró:** `registrarIngresoEnCaja` lanza `SIN_CAJA_ABIERTA` y el cobro
  completo se revierte; la secretaria pide al administrador que reabra (criterio 15).
- **Un Yape verificado al día siguiente de enviado:** entra a la caja abierta en el momento de verificarlo, no a la del
  día del comprobante (D-04); guardar las dos fechas es de la 007.
- **Ids en mayúsculas:** un UUID en mayúsculas en la dirección se trata igual que en minúsculas (como AT-2 de 004).
- **Descripción del egreso con emojis o letras de otros alfabetos:** se guarda tal cual; en el PDF de la 006b, lo que la
  fuente estándar no puede mostrar sale como `?` (criterio 42).
- **Comprobante que parece vacío** (`{U+3164}`, que se ve en blanco, o `{U+200B}`, un espacio de ancho cero): se guarda `null`, como el vacío; uno con un
  carácter que invierte la dirección del texto responde 400 (criterio 47, ronda adversarial 1).
- **Caja con miles de movimientos (006b):** no hay tope. Su PDF tarda más en generarse, pero no detiene la API de nadie,
  y las descargas de más esperan turno o reciben 429 (criterio 49).

## Reglas de negocio aplicables

- **HU-25:** la secretaria abre la caja del día con un monto inicial.
- **HU-26:** cada cobro se registra solo en la caja; cada ingreso guarda concepto (inscripción, mensualidad o
  particular), método de pago, monto, alumno y usuario. Los egresos menores guardan concepto, monto y comprobante
  opcional.
- **HU-27:** el cierre declara el efectivo contado; el sistema muestra el esperado por método (efectivo, Yape,
  transferencia), registra la diferencia (sobrante o faltante) con su observación y genera un PDF; el administrador puede
  ver y reabrir un cierre, con auditoría.
- **RN-17:** la caja se abre antes de registrar cobros y se cierra al final del día; una caja cerrada no admite
  movimientos.
- **Sección 4.3:** esperado = inicial + ingresos en efectivo − egresos; si no cuadra, se registra la diferencia con
  observación; Yape y transferencia se registran en la caja, pero no suman al efectivo físico.
- **D-04:** un Yape o una transferencia entra a la caja abierta en el momento de verificarlo, con su método; verificar
  exige la caja abierta (lo aplica la 007 con la interfaz del criterio 24).
- **Sección 8.8:** Caja `ABIERTA` → `CERRADA`; el administrador puede reabrirla.
- **Sección 2.1:** abrir y cerrar caja, administrador y secretaria; reportes financieros, administrador todo y secretaria
  "parcial (su caja)".
- **RN-22, RNF-06 y 11.4:** toda operación de caja queda en auditoría (quién, cuándo y qué); las excepciones del
  administrador llevan motivo.
- **D-03:** los montos son finales; la caja no suma ni resta IGV. **D-09:** sin comprobante SUNAT.
- **D-23 y D-29:** todo es por academia; el Superadmin no ve la caja.
- **RN-35 y HU-39 (019):** un pago a un entrenador "desde caja" es un egreso de la caja abierta del día (usará
  `registrarEgresoEnCaja`).
- **Reglas para las historias siguientes de `docs/arquitectura.md`:** `bloquearActorVigente` como primera sentencia;
  `@Permiso` en cada manejador; cada paso con `await`; montos en `numeric` y `Decimal`; fechas en America/Lima con
  `RELOJ`; el 409 de un choque por el nombre de la restricción; sin caché en los servicios; errores de la base con
  `errorParaRegistro`.

## Contrato

### Rutas

Mismas reglas que 002 a 005: `Cache-Control: no-store` en toda respuesta, cuerpos JSON con esquemas estrictos, reglas de
cuerpos de 001 y orden de comprobaciones sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación. El
`{id}` de las escrituras lo valida el servicio después de `bloquearActorVigente` (como AT-2 de 004): un id que no es UUID
responde el mismo 404 que uno inexistente o de otra academia. `GET /api/cajas/actual` se declara antes que
`GET /api/cajas/{id}`.

| Método y ruta | Permiso | Entrada | Éxito | Errores |
| --- | --- | --- | --- | --- |
| `GET /api/cajas/actual` | `ABRIR_CERRAR_CAJA` | — | 200 `RespuestaCajaActual` | 401, 403 |
| `POST /api/cajas` | `ABRIR_CERRAR_CAJA` | `abrirCajaSchema` | 201 `RespuestaCaja`; 200 si repite la clave | 400, 401, 403, 409 `CLAVE_YA_USADA`, `CAJA_YA_ABIERTA`, `CAJA_PENDIENTE_DE_CIERRE`, `CAJA_DEL_DIA_CERRADA` |
| `POST /api/cajas/{id}/egresos` | `ABRIR_CERRAR_CAJA` | `registrarEgresoSchema` | 201 `RespuestaEgreso`; 200 si repite la clave | 400, 401, 403, 404, 409 `CLAVE_YA_USADA`, `CAJA_CERRADA`, `CAJA_DE_OTRO_DIA`, `EFECTIVO_INSUFICIENTE` |
| `POST /api/cajas/{id}/cierre` | `ABRIR_CERRAR_CAJA` | `cerrarCajaSchema` | 200 `RespuestaCaja` | 400, 401, 403, 404, 409 `CLAVE_YA_USADA`, `CAJA_CERRADA`, `CAJA_CAMBIO` |
| `POST /api/cajas/{id}/reapertura` | `REABRIR_CAJA` | `reabrirCajaSchema` | 200 `RespuestaCaja` | 400, 401, 403, 404, 409 `HAY_OTRA_CAJA_ABIERTA` |
| **[006b]** `GET /api/cajas` | `VER_REPORTES_FINANCIEROS` | `desde`, `hasta` en la consulta (`filtroHistorialCajasSchema`, PQ3) | 200 `RespuestaHistorialCajas` (`{ desde, hasta, cajas }`) | 400 (`desde`, `hasta`), 401, 403 |
| **[006b]** `GET /api/cajas/{id}` | `VER_REPORTES_FINANCIEROS` | — | 200 `RespuestaCaja` | 401, 403, 404 (PQ1) |
| **[006b]** `GET /api/cajas/{id}/cierres/{numero}/pdf` | `VER_REPORTES_FINANCIEROS` | — | 200 `application/pdf` (PQ7) | 401, 403, 404 (PQ1, PQ6), 429 `DEMASIADAS_SOLICITUDES` (criterio 49 b y c), 500 (PQ9) |

**[006b]** `HEAD` sobre las cuatro rutas `GET` de la caja responde 404 (criterio 50).

**Orden de los errores de negocio** (después del 400 del esquema y del 401 del criterio 9):

- Apertura: `CLAVE_YA_USADA` (o el 200 de la clave repetida) → `CAJA_YA_ABIERTA` → `CAJA_PENDIENTE_DE_CIERRE` →
  `CAJA_DEL_DIA_CERRADA`.
- Egreso: 404 → `CLAVE_YA_USADA` (o el 200 de la clave repetida) → `CAJA_CERRADA` → `CAJA_DE_OTRO_DIA` →
  `EFECTIVO_INSUFICIENTE`.
- Cierre: 404 → `CLAVE_YA_USADA` (o el 200 de la clave repetida) → `CAJA_CERRADA` → `CAJA_CAMBIO` → 400 `observacion`.
- Reapertura: 404 → 200 si ya está abierta → `HAY_OTRA_CAJA_ABIERTA`.

El 400 del esquema va siempre antes que el 404 por el id y que cualquier 200 de una clave repetida o de una caja ya
abierta: un cuerpo inválido sobre un id que no existe responde 400, y una reapertura con un `motivo` inválido sobre una
caja ya abierta también (PP6 g).

### Esquemas compartidos (`packages/contratos/src/`)

- `dinero.ts` suma `montoNoNegativoSchema` (como `montoSchema`, pero acepta `"0"` y `"0.00"`; rechaza `"-0"`),
  `montoConSignoSchema` (para leer respuestas: `-?` seguido de un monto con exactamente dos decimales; la diferencia;
  tope y `"-0.00"` en PP3) y `restarMontos(a, b)` (criterio 39 y PP3). `montoSchema`, `MONTO_MAXIMO` y
  `montoCotizadoSchema` no cambian.
- `caja.ts` _(nuevo)_, todos estrictos:
  - `METODOS_PAGO` (`EFECTIVO`, `YAPE`, `TRANSFERENCIA`) y `metodoPagoSchema` (los reutiliza la 007 para los pagos);
    `CONCEPTOS_MOVIMIENTO` (`INSCRIPCION`, `MENSUALIDAD`, `CLASE_PARTICULAR`, `EGRESO_MENOR`); `estadoCajaSchema`
    (`ABIERTA`, `CERRADA`); `resultadoCierreSchema` (`CUADRA`, `SOBRANTE`, `FALTANTE`).
  - `abrirCajaSchema = { claveIdempotencia: uuid, montoInicial: montoNoNegativoSchema }`.
  - `registrarEgresoSchema = { claveIdempotencia, descripcion: textoVisibleSchema(3 a 200), monto: montoSchema,
    comprobante?: texto recortado de hasta 60, sin controles, sin caracteres de dirección del texto ni separadores,
    vacío o sin ningún carácter visible → null, o null }` (criterio 47, ronda adversarial 1).
  - `cerrarCajaSchema = { claveIdempotencia, montoDeclarado: montoNoNegativoSchema, ultimoMovimientoVisto: entero de 0 a
    1 000 000, observacion?: textoVisibleSchema(3 a 500) o null }`.
  - `reabrirCajaSchema = { motivo: textoVisibleSchema(3 a 200) }`.
  - `personaCajaSchema = { id, nombres, apellidos }` (sin DNI).
  - `movimientoCajaSchema = { id, numero, tipo, concepto, metodo, monto, descripcion, comprobante, alumno:
    personaCajaSchema | null, registradoPor: personaCajaSchema, registradoEn }`.
  - `resumenCajaSchema = { ingresos: { efectivo, yape, transferencia }, egresos: { efectivo }, esperado: { efectivo, yape,
    transferencia }, ultimoMovimiento }`.
  - `cierreCajaSchema = { numero, cerradoPor, cerradoEn, montoInicial, ingresos, egresos, esperado, montoDeclarado,
    diferencia: montoConSignoSchema, resultado, observacion, tardio, movimientosHasta, reapertura: { reabiertaPor,
    reabiertaEn, motivo } | null }`.
  - `cajaSchema = { id, fecha, estado, deOtroDia, montoInicial, abiertaPor, abiertaEn, resumen, movimientos, cierres }`.
  - `respuestaCajaSchema = { caja }`, `respuestaCajaActualSchema = { caja: cajaSchema | null }`,
    `respuestaEgresoSchema = { movimiento, caja }`.
  - **[006b]** `filtroHistorialCajasSchema` (`desde` y `hasta` opcionales con `fechaSchema`; un parámetro repetido es
    400; reglas del rango en PQ3), `cajaHistorialSchema` (criterio 40, PQ4), `respuestaHistorialCajasSchema = { desde,
    hasta, cajas }` y `LIMITES_HISTORIAL_CAJAS` (PQ13).
- `dinero.ts` **[006b]** recibe `formatearSoles` desde `frontend/src/lib/dinero.ts` (la usan la web y el PDF, PQ10).
- `permisos.ts`: suma `REABRIR_CAJA: { ADMIN: 'TODO' }` (DT-1).

### Interfaces del backend (para las historias siguientes)

```ts
// backend/src/modulos/caja/movimientos.ts (sin Nest; reexportadas en caja/index.ts). Quien llama ya llamó a
// bloquearActorVigente en la misma tx y bloqueó antes sus demás filas (orden de bloqueos: la caja va al final).
type MetodoPago = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';
type ConceptoIngreso = 'INSCRIPCION' | 'MENSUALIDAD' | 'CLASE_PARTICULAR';

interface IngresoEnCaja {
  readonly concepto: ConceptoIngreso;
  readonly metodo: MetodoPago;
  readonly monto: Decimal;     // > 0 y <= 100000.00, hasta dos decimales; si no, RangeError sin escribir
  readonly alumnoId: string;   // alumno (o cliente) de tx.academiaId; llave compuesta
  readonly pagoId: string;     // la 007 le pone la llave foránea a `pagos`; único en la academia
  readonly usuarioId: string;  // quien cobra o verifica (el actor ya bloqueado)
  readonly ip: string | null;  // para la auditoría
}

interface MovimientoRegistrado {
  readonly id: string;
  readonly cajaId: string;
  readonly numero: number;
  readonly registradoEn: Date;
  readonly repetido: boolean;  // true si ese pagoId ya tenía su movimiento (no se insertó ni se auditó)
}

// Bloquea la caja abierta (FOR UPDATE), comprueba el día con `ahora` en Lima, inserta y audita CAJA_INGRESO_REGISTRADO.
// Lanza ErrorNegocio 409 SIN_CAJA_ABIERTA o CAJA_DE_OTRO_DIA (la transacción de quien llama debe revertirse).
// Antes de tocar la base, RangeError si alumnoId, pagoId o usuarioId no tienen forma de UUID o si concepto o metodo no
// son de su lista (criterio 48 c); el RangeError del monto, en el paso c del criterio 24 (PP7).
function registrarIngresoEnCaja(tx: TransaccionAcademia, ingreso: IngresoEnCaja, ahora: Date): Promise<MovimientoRegistrado>;

// La usa la ruta de egresos de esta historia y la usará la 019 (pago a un entrenador desde caja, RN-35), que sumará su
// concepto al tipo `concepto_movimiento_caja` en su migración. Bloquea la caja `cajaId` (FOR UPDATE) y aplica los
// criterios 19 a 22. Lanza ErrorNegocio 404 NO_ENCONTRADO, 409 CLAVE_YA_USADA, CAJA_CERRADA, CAJA_DE_OTRO_DIA o
// EFECTIVO_INSUFICIENTE. Antes de tocar la base valida descripcion, comprobante, claveIdempotencia, usuarioId y monto
// con las reglas de la ruta (criterios 18, 47 y 48 a) y lanza RangeError sin escribir; inserta, audita y compara la
// clave con la descripción recortada y el comprobante recortado o null (criterio 48 b). No comprueba el rol de
// usuarioId: es el actor que quien llama ya autorizó y bloqueó (criterio 48 e).
function registrarEgresoEnCaja(
  tx: TransaccionAcademia,
  egreso: { cajaId: string; claveIdempotencia: string; descripcion: string; monto: Decimal; comprobante: string | null;
            usuarioId: string; ip: string | null },
  ahora: Date,
): Promise<MovimientoRegistrado>;

// Lectura sin bloqueo, para que la 007 avise antes de empezar ("abre la caja") sin decidir con ella.
function leerCajaAbierta(tx: TransaccionAcademia, ahora: Date): Promise<{ id: string; fecha: string; deOtroDia: boolean } | null>;
```

### Auditoría

Entidades `caja` y `movimiento_caja`, actor `USUARIO` con su id e IP (nula si no hay IP, PP6 a), montos como texto con
dos decimales (el `esperado` de `CAJA_CERRADA`, como objeto por método, PP5):

- `CAJA_ABIERTA` (criterio 10), `CAJA_CERRADA` (criterio 29) y `CAJA_REABIERTA` (criterio 35, con `motivo`), entidad
  `caja`.
- `CAJA_EGRESO_REGISTRADO` (criterio 17) y `CAJA_INGRESO_REGISTRADO` (criterio 24), entidad `movimiento_caja`.
- Las lecturas, el historial y el PDF no auditan. Las respuestas 200 de una clave repetida no auditan.

### Códigos de error nuevos

`CAJA_YA_ABIERTA`, `CAJA_PENDIENTE_DE_CIERRE`, `CAJA_DEL_DIA_CERRADA`, `CAJA_CERRADA`, `CAJA_DE_OTRO_DIA`,
`SIN_CAJA_ABIERTA` (solo de la interfaz), `EFECTIVO_INSUFICIENTE`, `CAJA_CAMBIO`, `CLAVE_YA_USADA` y
`HAY_OTRA_CAJA_ABIERTA` (409). Se reutilizan `SOLICITUD_INVALIDA`, `NO_ENCONTRADO`, `ERROR_INTERNO` y los de sesión,
academia y permisos. **[006b]** También se reutiliza `DEMASIADAS_SOLICITUDES`, el 429 del filtro de errores, en el PDF
(criterio 49).

### Eventos

Ninguno. El PDF se arma bajo pedido (criterio 43), no es un efecto de la escritura.

## Cambios al modelo de datos

Una migración `<marca>_caja` (006a). Ajusta `CAJA` y `MOVIMIENTO_CAJA` de la sección 9.1: se agregan `academia_id`
(D-23), las claves de idempotencia, el número de cada movimiento y la tabla `cierres_caja`, que guarda cada cierre (y
su reapertura) en lugar de los campos de cierre de `CAJA`, para no perder un cierre al reabrir (decisión D1).
`referencia_pago_id` pasa a `pago_id`, `usuario` a `registrado_por` y `fecha_hora` a `registrado_en`.

- **Tipos:** `estado_caja` (`ABIERTA`, `CERRADA`); `tipo_movimiento_caja` (`INGRESO`, `EGRESO`);
  `concepto_movimiento_caja` (`INSCRIPCION`, `MENSUALIDAD`, `CLASE_PARTICULAR`, `EGRESO_MENOR`; la 019 suma el suyo);
  `metodo_pago` (`EFECTIVO`, `YAPE`, `TRANSFERENCIA`; lo reutiliza la 007 en `pagos`).
- **`cajas`:** `id uuid` PK; `academia_id uuid not null` → `academias(id)` (`RESTRICT`); `fecha date not null`;
  `estado estado_caja not null default 'ABIERTA'`; `monto_inicial numeric(10,2) not null` (≥ 0, no `NaN`);
  `abierta_por uuid not null` con `FOREIGN KEY (academia_id, abierta_por) REFERENCES usuarios (academia_id, id)`;
  `abierta_en timestamptz(3) not null`; `clave_idempotencia uuid not null`; `creado_en`, `actualizado_en`.
  `UNIQUE (academia_id, id)`; `UNIQUE (academia_id, clave_idempotencia)`; `UNIQUE (academia_id, fecha)`
  (`cajas_academia_id_fecha_key`, DR-1); índice único parcial `cajas_una_abierta_por_academia` sobre
  `(academia_id) WHERE estado = 'ABIERTA'`; `CHECK` de `monto_inicial` y de `fecha = (abierta_en AT TIME ZONE
  'America/Lima')::date`.
- **`movimientos_caja`:** `id uuid` PK; `academia_id`; `caja_id uuid not null` con `FOREIGN KEY (academia_id, caja_id)
  REFERENCES cajas (academia_id, id)`; `numero integer not null` (≥ 1); `tipo`, `concepto`, `metodo`;
  `monto numeric(10,2) not null` (> 0, no `NaN`); `descripcion text null`; `comprobante text null`;
  `alumno_id uuid null` con llave compuesta a `alumnos (academia_id, id)`; `pago_id uuid null` (sin llave foránea: la
  agrega la 007 cuando exista `pagos`); `registrado_por uuid not null` con llave compuesta a `usuarios`;
  `registrado_en timestamptz(3) not null`; `clave_idempotencia uuid null`. `UNIQUE (academia_id, id)`;
  `UNIQUE (academia_id, caja_id, numero)`; índices únicos parciales `(academia_id, pago_id) WHERE pago_id IS NOT NULL` y
  `(academia_id, clave_idempotencia) WHERE clave_idempotencia IS NOT NULL`; `CHECK` de coherencia del criterio 4 b. Sin
  `actualizado_en`: no cambia. Trigger `movimientos_caja_solo_caja_abierta` (criterio 6).
- **`cierres_caja`:** `id uuid` PK; `academia_id`; `caja_id` (llave compuesta a `cajas`); `numero smallint not null`
  (≥ 1); `movimientos_hasta integer not null` (≥ 0); `monto_inicial`, `ingresos_efectivo`, `ingresos_yape`,
  `ingresos_transferencia`, `egresos_efectivo`, `esperado_efectivo`, `monto_declarado` y `diferencia`, todos
  `numeric(12,2) not null` (las sumas de un día caben de sobra); `observacion text null`; `tardio boolean not null`;
  `cerrado_por` (llave compuesta a `usuarios`); `cerrado_en timestamptz(3) not null`; `clave_idempotencia uuid not null`;
  `reabierto_por uuid null` (llave compuesta a `usuarios`); `reabierto_en timestamptz(3) null`;
  `motivo_reapertura text null`; `creado_en`. `UNIQUE (academia_id, id)`; `UNIQUE (academia_id, caja_id, numero)`;
  `UNIQUE (academia_id, clave_idempotencia)`; índice único parcial `cierres_caja_un_vigente_por_caja` sobre
  `(academia_id, caja_id) WHERE reabierto_en IS NULL`; `CHECK` del criterio 4 c.
- **RLS** activada y forzada en las tres, con políticas de la forma exacta del criterio 132 de 001: `SELECT`, `INSERT` y
  `UPDATE` en `cajas` y `cierres_caja`; `SELECT` e `INSERT` en `movimientos_caja`. Sin `DELETE`.
- **Privilegios** de `aquagestion_app`: criterio 2. `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y
  `TABLAS_DESPUES_DE_MIGRAR` se amplían en el mismo cambio.
- **Prisma:** los `CHECK`, los índices parciales, las políticas, los privilegios y el trigger van a mano en la migración.
- **[006b] Sin migración.**

## Fuera de alcance

- **Cobros, pagos, verificación de Yape y transferencia, ticket interno y el paso de cliente a alumno:** 007. La 007 llama
  a `registrarIngresoEnCaja` dentro de su transacción; guarda en `pagos` la fecha de la operación y la de verificación
  (D-04, D-07) y le pone la llave foránea a `movimientos_caja.pago_id`.
- **Ingresos manuales** que no vienen de un cobro (venta de gorros, donaciones…): no; todo ingreso nace de un cobro
  (HU-26, DR-11).
- **Pago a entrenadores desde caja (RN-35, HU-39):** 019, con `registrarEgresoEnCaja`.
- **Anular o corregir movimientos:** no (DR-5).
- **Foto del comprobante de un egreso:** no; el comprobante es un texto opcional (DR-3).
- **Turnos (varias cajas en el mismo día):** no; una caja por día (DR-1).
- **Arqueo ciego:** no; el esperado se muestra antes de contar (DR-7).
- **Conteo por billetes y monedas, arqueos parciales durante el día, varias monedas:** no están en los documentos.
- **Cierre automático de la caja a medianoche:** no (DR-2).
- **Reportes R1 a R3 exportables a Excel y el dashboard:** Fase 3. La 006b solo da el historial y el PDF de cada cierre.
- **Facturación SUNAT:** último módulo (D-09).

## Impacto en especificaciones anteriores

- **001, criterio 2 y `PRIVILEGIOS_APP` (criterio 102):** la lista exacta suma los privilegios de las tres tablas
  (criterio 2). Las pruebas protegidas que comparan la lista exacta las actualiza el test-writer en el commit de pruebas
  protegidas de la 006a, solo para sumar; `scripts/lib/rol-app.mjs` se amplía igual.
- **001, catálogo (criterios 124 y 131):** la función del trigger es `SECURITY INVOKER` y sin valores propios: no hace falta
  ninguna excepción en `FUNCIONES_SECURITY_DEFINER_PERMITIDAS`.
- **001, criterio 127 (dependencias del backend), [006b]:** `pdfkit` (y `@types/pdfkit` en las de desarrollo) se suman a
  `DEPENDENCIAS_BACKEND_PERMITIDAS` en el mismo cambio (DT-3). Ya estaba en el stack (D-10, D-25).
- **002, criterio 26 (matriz):** suma `REABRIR_CAJA` con `ADMIN: 'TODO'` (de 24 a 25 filas), como hizo la 003 con
  `CONFIGURAR_ACADEMIA`. La prueba protegida la actualiza el test-writer solo para sumar la fila, en el commit de pruebas
  protegidas de la 006a (DT-1).
- **003 y 004:** ninguno.
- **005:** ninguno. La caja no bloquea filas del cliente ni clases (criterio 26).
- **Web de 002:** el inicio del panel suma "Caja" (006a) e "Historial de caja" (006b).
- **Rutas de academia de 002, [006b]:** `HEAD` sobre las rutas de la caja responde 404 (criterio 50). Las demás rutas
  no cambian (DT-9).
- **`docs/arquitectura.md`:** nuevas "Reglas para las historias siguientes" (criterio 46).

## Reglas para las historias siguientes

Para documentar en `docs/arquitectura.md` (criterio 46):

- **Ningún cobro sin la caja abierta (007, 016, 019).** Todo cobro en efectivo y toda verificación de Yape o
  transferencia registra su ingreso con `registrarIngresoEnCaja` dentro de su propia transacción, antes de confirmar. Si
  lanza `SIN_CAJA_ABIERTA` o `CAJA_DE_OTRO_DIA`, la transacción completa se revierte: no queda un pago confirmado sin su
  movimiento. Un pago entra una sola vez a la caja (`pago_id` único). Un egreso desde caja (019) usa
  `registrarEgresoEnCaja`.
- **Orden de bloqueos con la caja.** `usuarios` (`bloquearActorVigente`) → bloqueos consultivos de la operación → filas
  del cliente (`alumnos`, `solicitudes_inscripcion`, `matriculas`, `pagos`) → clases (`bloquearClasesParaCupo`) → **la
  caja, al final**. Después de la caja solo se insertan filas y auditoría. Ninguna transacción bloquea la caja y después
  otra fila del negocio. La apertura y la reapertura toman el bloqueo consultivo `'caja:' || academia_id` después del
  actor y antes de la fila de la caja.
  - **La fila del alumno, siempre antes de la caja (nota de la ronda adversarial 1, para la 007 y la 016).** El `INSERT`
    de un ingreso en `movimientos_caja` toma, por la llave compuesta `(academia_id, alumno_id)`, un `FOR KEY SHARE`
    implícito sobre la fila de `alumnos`, y lo toma con la caja ya bloqueada. Si otra transacción tiene esa fila con
    `FOR UPDATE` (o la borra o cambia su llave) y espera la caja, las dos se esperan entre sí (`40P01`). Por eso, toda
    transacción que registre un ingreso bloquea antes, de forma explícita, la fila del alumno o cliente del cobro (con el
    modo que use la operación, `FOR UPDATE` si la va a cambiar), y la bloquea antes de las clases
    (`bloquearClasesParaCupo`), como la inscripción de la 005, y antes de la caja. Sin excepción: aunque el cobro no
    cambie la fila del alumno, y también en la verificación de un Yape o una transferencia.
  - **`registrado_por` es el actor ya bloqueado.** El mismo `INSERT` toma un `FOR KEY SHARE` sobre la fila de `usuarios`
    de `usuarioId`. Como `usuarioId` es el actor que `bloquearActorVigente` ya bloqueó en la misma transacción (criterio
    48 e), no espera a nadie. Quien llama no pasa como `usuarioId` a otra persona.
- **El día es el de Lima.** Toda decisión sobre "la caja de hoy" usa `hoyEnLima(RELOJ.ahora())`, nunca `CURRENT_DATE`.
- **El ingreso guarda el método real.** Un Yape entra como `YAPE` y una transferencia como `TRANSFERENCIA` (D-04): no suman
  al efectivo esperado.
- **La caja no cambia montos.** El monto que entra es el total ya calculado y redondeado del cobro (D-03); la caja no
  redondea ni suma IGV.

## Riesgos aceptados

- **La caja abierta es una fila que serializa los cobros de una academia:** cada cobro y cada egreso la bloquean un
  instante. Para el volumen de una recepción (decenas de cobros al día) no se nota; es lo que garantiza que ningún cobro
  entre a una caja que se está cerrando.
- **El esperado se ve antes de contar** (DR-7): la persona que cierra podría escribir el esperado sin contar. Lo
  mitigan la auditoría y el PDF con quién cerró. El arqueo ciego queda como mejora futura, no decidida; la API no
  cambiaría (D3).
- **Una caja por día** (DR-1): si alguien cierra por error a mediodía, nadie cobra hasta que el administrador reabra.
- **Movimientos inmutables** (DR-5): un egreso mal registrado no se corrige; se explica en la observación del cierre y
  queda la diferencia.
- **Egresos sin tope propio** (DR-4): el único límite es el efectivo de la caja; un egreso grande se acepta si hay
  efectivo. Lo mitigan la auditoría (`CAJA_EGRESO_REGISTRADO` con quién y cuánto) y el cierre.
- **La coherencia entre el estado de la caja y su cierre vigente** (una caja `CERRADA` tiene un cierre vigente y una
  `ABIERTA` ninguno) la garantiza el servicio dentro de la transacción y la comprueban las pruebas; la base solo exige un
  vigente como mucho.
- **Fuente estándar del PDF (006b):** solo los caracteres de Latin-1; lo demás sale como `?` en el PDF (en la pantalla se
  ve bien), también las comillas curvas de los teclados de celular (PQ11).
- **El PDF muestra los nombres de hoy (006b, PQ10):** si después del cierre cambia el nombre de quien cerró, de quien
  abrió o de un alumno, el PDF de ese cierre sale con el nombre nuevo. Los montos, la observación y la reapertura no
  cambian, y la auditoría guarda los ids. Guardar los nombres en el cierre exigiría una migración, y la 006b no tiene.
- **Límites del PDF por proceso (006b, criterio 49):**
  - Con varias instancias de la API, cada una tiene su cola.
  - Si muchas personas descargan a la vez (por ejemplo, al cierre del día de muchas academias), alguna recibe 429 y
    tiene que volver a intentar.
  - El PDF de una caja con miles de movimientos tarda segundos, pero no detiene a las demás peticiones.
- **Lecturas de una caja muy grande (006b):** `GET /api/cajas/actual` y el detalle arman su JSON con todos los
  movimientos en el hilo principal. Con 20 000 movimientos son decenas de milisegundos por petición. Se acepta porque
  no hay tope de movimientos (DT-7) y el criterio 49 solo trata del PDF, que costaba segundos.
- **`pago_id` sin llave foránea hasta la 007:** en la 006 nadie escribe ingresos por la API; las pruebas usan UUID
  inventados.

## Decisiones

**Cómo se citan.** Las decisiones del responsable de esta spec se citan como "DR-n" dentro de ella y como "DR-n de 006"
fuera; las del orquestador, "DT-n" y "DT-n de 006"; las de diseño del especificador, "Dn". Las de otras specs llevan
siempre su número ("DT-5 de 002", "DR-11 de 005"). La pregunta Pn del borrador es DR-n y la Tn es DT-n (P1 es DR-1, T1
es DT-1, y así hasta P11 y T6; P13, contestada después, es DR-13, y DR-12 queda para P12). DT-7 la tomó el
orquestador en la ronda adversarial 1 de la 006b, sin pregunta previa; T8 y T9, de esa ronda, son DT-8 y DT-9. Las precisiones de las
pruebas protegidas de la 006a se citan como "PPn"; las del repaso de la 006b, como "PQn" (están al final de la sección I
de los criterios).

### Decisiones del responsable (22/11/2026)

Bryan aprobó la especificación y aceptó la propuesta de cada pregunta de negocio, incluida la división en 006a y 006b.
Como los criterios ya usaban la propuesta como valor provisional, ninguno cambia de intención: esos valores quedan como
definitivos. Se conserva el texto de cada pregunta; lo decidido es la propuesta.

- **DR-1 (pregunta P1). ¿Una caja por academia y por día, o turnos?** Los documentos hablan de "la caja del día" (HU-25),
  "la caja que esté abierta" (D-04) y "la caja abierta del día" (RN-35), siempre en singular. **Decidido (la propuesta):**
  una sola caja abierta a la vez por academia, que comparten la secretaria y el administrador (cada movimiento guarda quién
  lo registró), y **una caja por día**; si se cierra por error, el administrador la reabre. Alternativa descartada: varias
  cajas seguidas en el mismo día (turnos de mañana y tarde). (Criterios 5, 13 y 15.)
- **DR-2 (pregunta P2). ¿Qué pasa si nadie cerró la caja del día anterior?** **Decidido (la propuesta):** esa caja ya no
  admite egresos ni cobros (tampoco verificar Yapes) y hay que cerrarla, contando el efectivo, antes de abrir la de hoy; el
  cierre queda marcado como "tardío". La puede cerrar la secretaria o el administrador. Alternativas descartadas: (a) que
  la cierre solo el administrador; (b) que el sistema la cierre solo a medianoche, sin conteo. (Criterios 14, 20 y 32.)
- **DR-3 (pregunta P3). ¿Cómo es un egreso?** HU-26 pide concepto, monto y comprobante opcional. **Decidido (la
  propuesta):** siempre en efectivo, sale del cajón (el diagrama 4.3 resta todos los egresos del efectivo); el concepto es
  un texto libre de 3 a 200 caracteres; el comprobante es un texto opcional (por ejemplo "Boleta B001-123", hasta 60
  caracteres). Alternativa descartada: el comprobante como foto. (Criterios 17 y 18.)
- **DR-4 (pregunta P4). ¿Un egreso puede ser mayor que el efectivo de la caja?** **Decidido (la propuesta):** no; se
  rechaza con 409 `EFECTIVO_INSUFICIENTE` si deja el efectivo esperado por debajo de cero. Sin otro tope para los egresos
  menores. Alternativas descartadas: permitirlo y que aparezca como faltante; fijar un monto máximo que solo el
  administrador puede superar. (Criterio 21.)
- **DR-5 (pregunta P5). ¿Se puede anular un movimiento equivocado?** **Decidido (la propuesta):** no; los movimientos no
  se editan ni se borran, y un error se explica en la observación del cierre. Alternativa descartada: anulación por el
  administrador con un movimiento de reversa. (Criterio 23.)
- **DR-6 (pregunta P6). ¿El monto inicial puede ser cero?** **Decidido (la propuesta):** sí (una caja sin sencillo al
  empezar). Alternativa descartada: exigir más de cero. (Criterio 11.)
- **DR-7 (pregunta P7). ¿La secretaria ve el efectivo esperado antes de contar?** **Decidido (la propuesta):** sí, como
  dice HU-27 ("el sistema muestra el esperado por método"). Alternativa descartada por ahora: el arqueo ciego (declarar
  primero y ver el esperado después); la API no cambiaría si se adopta más adelante (D3). (Criterios 28 y 38.)
- **DR-8 (pregunta P8). ¿Se puede reabrir la caja de un día anterior?** **Decidido (la propuesta):** sí, solo para
  corregir el cierre (volver a contar y cerrar), sin agregar movimientos a ese día, y solo si no hay otra caja abierta.
  Alternativa descartada: solo se puede reabrir la caja de hoy. (Criterio 36 b y c.)
- **DR-9 (pregunta P9). ¿Qué es "su caja" para la secretaria en el historial?** La matriz dice "Ver reportes
  financieros: parcial (su caja)". **Decidido (la propuesta):** las cajas que ella abrió, las que cerró y la caja abierta
  en este momento; el administrador ve todas. Alternativa descartada: todas las cajas de la academia. (Criterios 40 a 42,
  006b.)
- **DR-10 (pregunta P10). ¿Dividimos la historia?** **Decidido (la propuesta):** sí, en dos entregas de ruta crítica,
  cada una con sus pruebas protegidas, su ataque y su PR, desde esta misma carpeta:
  - **006a · Caja del día** (primero): apertura, egresos, cierre, reapertura, la interfaz para la 007 y la pantalla de la
    caja; criterios 1 a 39, más 45 y 46 sin el historial ni el PDF.
  - **006b · Historial y PDF del cierre** (siguiente PR, con la 006a unida): criterios 40 a 44, más la parte de 45 y 46
    que les toca.

  La 007 puede empezar con la 006a unida. Alternativa descartada: un solo PR. Reparto y dependencias: "División en 006a y
  006b".
- **DR-11 (pregunta P11). ¿Hay ingresos que no vienen de un cobro?** HU-26 solo nombra inscripción, mensualidad y clase
  particular. **Decidido (la propuesta):** no; todo ingreso nace de un cobro (007 y 016) y entra con
  `registrarIngresoEnCaja`. Alternativa descartada: un "otro ingreso" manual con concepto. ("Fuera de alcance".)
- **DR-13 (pregunta P13, del repaso de la 006b; contestada el 22/11/2026). ¿La secretaria ve en el historial la caja de
  hoy aunque la hayan abierto y cerrado otras personas?** DR-9 dice que "su caja" son las que abrió, las que cerró y la
  caja abierta, pero la pantalla de la caja del día (criterio 28, 006a) ya le muestra a cualquier secretaria la caja de
  hoy cerrada, con sus movimientos y su cierre. **Decidido (la propuesta):** sí; "la caja de hoy" se suma al alcance de
  la secretaria (PQ2 d): ve esa caja en el historial y descarga el PDF de sus cierres, aunque no la haya abierto ni
  cerrado ella. No le muestra nada que no vea ya, y el historial queda coherente con la pantalla del día. Alternativa
  descartada: dejar DR-9 tal cual (la vería en `/panel/caja` y no en el historial ni en el PDF, hasta que cambia el día).
  (Criterios 40 a 42; escenario C5 de PQ2.)

### Decisiones técnicas del orquestador (22/11/2026)

El orquestador aprobó las seis propuestas técnicas tal como estaban. Se conserva el texto de cada pregunta; lo decidido
es la propuesta.

- **DT-1 (pregunta T1). Permiso nuevo `REABRIR_CAJA`** (`ADMIN: 'TODO'`). **Decidido (la propuesta):** como
  `CONFIGURAR_ACADEMIA` en la 003: el guard decide y la web usa `puede`. La prueba protegida de la matriz (criterio 26 de
  002) crece una fila, de 24 a 25, en el commit de pruebas protegidas de la 006a, sin quitar ni cambiar nada. Alternativa
  descartada: comprobar el rol `ADMIN` dentro del servicio con `ABRIR_CERRAR_CAJA` (la regla quedaría escondida).
  _(006a; criterio 7.)_
- **DT-2 (pregunta T2). PDF bajo pedido.** **Decidido (la propuesta):** se arma en cada descarga con lo ya confirmado, sin
  guardar archivos. Alternativa descartada: generarlo al cerrar y guardarlo con `AlmacenArchivos` (confirmación incierta
  y borrado, como en la 005b). _(006b; criterio 43.)_
- **DT-3 (pregunta T3). `pdfkit` como dependencia del backend** (D-10, D-25), con `@types/pdfkit` en las de desarrollo,
  en la 006b, sumadas a `DEPENDENCIAS_BACKEND_PERMITIDAS` (criterio 127 de 001). **Decidido (la propuesta):** es
  JavaScript puro, sin binarios por sistema operativo. _(006b; criterio 42.)_
- **DT-4 (pregunta T4). Trigger en la base** contra movimientos en una caja cerrada. **Decidido (la propuesta):** como
  defensa en profundidad. Alternativa descartada: solo el bloqueo de la fila en la API. _(006a; criterio 6.)_
- **DT-5 (pregunta T5). Clasificación.** **Decidido (la propuesta):** críticos 1 a 36 y 40 a 43 (del 42, el alcance y el
  404); prueba obligatoria 37 a 39, el contenido del 42 y el 44; revisor 45 y 46. Repartidos como dice "División en 006a
  y 006b". La ronda adversarial 1 de la 006a suma 47 y 48, críticos, por decisión del orquestador. La ronda adversarial
  1 de la 006b suma 49 y 50, también críticos.
- **DT-6 (pregunta T6). `ultimoMovimientoVisto` en el cierre** (D3). **Decidido (la propuesta).** Alternativa
  descartada: cerrar con lo que haya en ese momento, aunque la persona no lo haya visto. _(006a; criterio 31.)_
- **DT-7 (sin pregunta previa; ronda adversarial 1 de la 006b, 22/11/2026). Una caja con muchos movimientos y su PDF.**
  **Decidido por el orquestador:** es un problema técnico, no de negocio. No se pone tope de movimientos por caja, porque
  sería una regla de negocio que los documentos no tienen. Se acota cuánto bloquea cada PDF y cuántos se generan a la vez
  (criterio 49). Alternativa descartada: un tope de movimientos por caja o por PDF. _(006b; criterio 49.)_
- **DT-8 (pregunta T8, ronda adversarial 1 de la 006b, contestada el 22/11/2026). ¿Limitamos las descargas de PDF por
  persona?** **Decidido (la propuesta):** sí. Cada persona tiene como mucho 2 descargas en curso o esperando turno,
  contadas en la misma cola del criterio 49 b. Sin ese límite, una persona con diez descargas simultáneas llenaría la
  cola de todas las academias; con él, un doble clic sigue funcionando. Alternativa descartada: un límite por ventana
  con `ThrottlerStorage` (por ejemplo, 10 por minuto), porque no impide lanzar diez a la vez y las pruebas protegidas
  de PQ6, que hacen más de diez descargas seguidas de la misma persona en una app, fallarían con 429. _(006b; criterio
  49 c.)_
- **DT-9 (pregunta T9, ronda adversarial 1 de la 006b, contestada el 22/11/2026). ¿`HEAD` responde 404 en toda la API
  de academia, o solo en la caja?** **Decidido (la propuesta):** solo en las rutas de la caja. En las demás rutas `GET`
  (002 a 005), `HEAD` sigue llamando al manejador del `GET`; en las rutas públicas, la 005 lo cuenta como `GET` en el
  límite por IP (criterio 49 de 005). El adversarial de la 007 lo revisa en las rutas que arman archivos (comprobantes y
  tickets). Alternativa descartada: generalizarlo en esta historia, porque cambiaría el comportamiento de specs ya
  unidas. _(006b; criterio 50.)_

### Decisiones de diseño (técnicas)

Propuestas del especificador, aprobadas con la spec (22/11/2026).

- **D1. Los cierres en su propia tabla.** Cada cierre es una fila de `cierres_caja` que no cambia salvo para registrar su
  reapertura. Alternativa descartada: los campos de cierre en `cajas` (`monto_declarado`, `diferencia`…), como la sección
  9.1, que la reapertura tendría que borrar o pisar: se perdería el primer cierre y su PDF.
- **D2. Movimientos numerados por caja.** El `numero` (1, 2, 3…) se asigna con la caja bloqueada y sirve para el orden,
  para saber qué vio quien cierra (D3) y para que el PDF de cada cierre liste solo sus movimientos. Alternativa
  descartada: ordenar por `registrado_en`, que puede repetirse al milisegundo.
- **D3. El cierre manda `ultimoMovimientoVisto`.** Si entró un movimiento después de cargar la pantalla, 409
  `CAJA_CAMBIO` (DT-6). Alternativa descartada: mandar el esperado mostrado; no serviría si algún día se adopta el arqueo
  ciego (DR-7).
- **D4. El egreso y el cierre llevan la caja en la dirección** (`/api/cajas/{id}/…`); el cobro de la 007 no, porque entra
  a "la caja que esté abierta en ese momento" (D-04). Así un egreso nunca cae en una caja distinta de la que la persona
  tiene en pantalla.
- **D5. Idempotencia con clave del cliente** en la apertura, el egreso y el cierre (respuesta 200 con lo ya hecho), y con
  el `pago_id` en los ingresos. La reapertura es idempotente por estado (ya abierta → 200 sin escribir).
- **D6. Defensa en la base:** `CHECK` de las cuentas del cierre, índices únicos (una abierta, una por día, un cierre
  vigente) y el trigger que no deja insertar movimientos en una caja cerrada (criterio 6), como los `CHECK` de la 004.
- **D7. Semilla con fecha fija** (`2026-11-02`) en lugar de "ayer": repetible y sin depender del día en que se ejecuta.

### Precisiones de las pruebas protegidas (006a)

Ambigüedades y un conflicto que encontró el test-writer de la 006a al escribir las pruebas protegidas, resueltos por el
orquestador (22/11/2026); donde el orquestador dejó la forma a elección del especificador (PP3 y PP5), se indica. No
cambian ninguna regla de negocio; se citan como "PPn" en los criterios, el contrato y el plan.

- **PP1 (criterios 3 y 6; conflicto con el plan 2.9).** El trigger `movimientos_caja_solo_caja_abierta` rechaza con
  `23514` solo si ve la caja y no está `ABIERTA` (`v_estado IS NOT NULL AND v_estado <> 'ABIERTA'`). Si no la ve (no
  existe, es de otra academia o la RLS la oculta), deja pasar la fila y deciden la llave compuesta (`23503`) o la
  política de `INSERT` (`42501`), como exige el criterio 3. Motivo: un trigger `BEFORE INSERT` corre antes que la llave
  foránea y que el `WITH CHECK` de la RLS; con la condición `IS DISTINCT FROM 'ABIERTA'` del plan, el movimiento de A con
  la `caja_id` de B y el `INSERT` con la academia de B en el contexto de A darían `23514` en lugar de `23503` y `42501`.
  Se eligió el criterio 3. La defensa no se debilita: un movimiento en una caja inexistente o de otra academia lo sigue
  impidiendo la llave compuesta, y el criterio 6 (caja `CERRADA`, también en la carrera de 6 b) no cambia. El plan 2.9
  queda corregido.
- **PP2 (criterio 27).** Firmas del dominio puro (`dominio/esperado.ts`), todo con `Decimal`:
  - `calcularResumen({ montoInicial: Decimal; movimientos: readonly { tipo: 'INGRESO' | 'EGRESO'; metodo: MetodoPago;
    monto: Decimal }[] })` devuelve `{ ingresos: { efectivo, yape, transferencia }, egresos: { efectivo }, esperado: {
    efectivo, yape, transferencia } }`;
  - `calcularDiferencia(declarado: Decimal, esperadoEfectivo: Decimal)` devuelve `{ diferencia: Decimal; resultado:
    'CUADRA' | 'SOBRANTE' | 'FALTANTE' }`.

  Las pruebas comparan los resultados con `Decimal.equals` (valor exacto, sin redondear a dos decimales), así que la
  escala del `Decimal` devuelto no importa (`0.3` y `0.30` son iguales) y un error de coma flotante se nota.
- **PP3 (criterio 39 y `dinero.ts`; el tope lo fija el especificador).**
  - `restarMontos(a, b)` recibe textos válidos de `montoNoNegativoSchema` (así se escribe el efectivo contado: `"80"`,
    `"80.5"`) y devuelve siempre un texto con exactamente dos decimales, con `-` delante si es negativo y nunca `"-0.00"`
    (dos montos iguales dan `"0.00"`). Como la web le pasa también `esperado.efectivo` de la respuesta, acepta además
    los montos sin signo con dos decimales del formato de lectura de abajo. Con un texto que no es un monto, lanza
    `RangeError`; nunca devuelve un resultado inventado.
  - `montoConSignoSchema`: `-?`, una parte entera sin ceros a la izquierda (`0` o de 1 a 10 dígitos) y exactamente dos
    decimales; rechaza `"-0.00"`. **Tope: `9999999999.99` en valor absoluto**, la capacidad de `numeric(12,2)` de
    `cierres_caja.diferencia`. Las pruebas protegidas lo prueban entre `"-99999.99"` y `"99999.99"`, que quedan dentro.
    Motivo (el mismo de `montoCotizadoSchema` en 005, AT1-2: el tope de un esquema de lectura es el máximo que el sistema
    puede producir): la diferencia no está acotada por un monto de entrada. El declarado llega a `99999.99`, pero el
    esperado en efectivo es el monto inicial más todos los cobros en efectivo del día (cada uno de hasta `100000.00`),
    así que un faltante puede pasar de `100000.00`. Un tope de `100000.00` haría fallar la lectura de un cierre legítimo.
    Alternativa descartada: `100000.00`, por eso.
  - Por la misma razón, los montos sin signo de las respuestas (`resumen`, y `montoInicial`, ingresos, egresos, esperado
    y declarado de `cierreCajaSchema`) se leen con ese formato sin el signo y no con `montoNoNegativoSchema`, que es de
    entrada y llega a `99999.99`.
- **PP4 (criterio 4).** La app casi no tiene `UPDATE` (criterio 2). Los `INSERT` que violan un `CHECK` se prueban como
  app y como dueño; los `UPDATE`, como dueño.
- **PP5 (criterio 29 y "Auditoría"; la forma la fija el especificador).** En `CAJA_CERRADA`, `datosDespues.esperado` es un
  objeto `{ efectivo, yape, transferencia }`, con los tres montos como texto con dos decimales, igual que `esperado` en
  `cierreCajaSchema`. Es la forma más clara: la auditoría muestra el cierre completo y con la misma forma que la API.
  Alternativa descartada: solo el texto del efectivo (se perdería lo de Yape y transferencia). La prueba protegida
  acepta las dos formas (lee `esperado.efectivo` o el texto), así que esta precisión no la cambia.
- **PP6 (campos que la spec no fijaba; los asumió el test-writer y se confirman):**
  - a) **IP nula:** si no hay IP (`ip: null` en `registrarIngresoEnCaja` o `registrarEgresoEnCaja`), la auditoría
    queda con `ip` nulo y la operación se registra igual.
  - b) **`CAJA_DE_OTRO_DIA`** lleva `detalles: { cajaId, fecha }` (la fecha de la caja) en la ruta y en la interfaz.
  - c) **Observación vacía:** en el cierre, una `observacion` vacía o de solo espacios responde 400 en `observacion`
    (`textoVisibleSchema` de 3 a 500), con cualquier diferencia; no cuenta como ausente (a diferencia del
    `comprobante` del egreso, DR-3). La web omite el campo si no se escribió nada.
  - d) **Montos equivalentes:** `"120"` y `"120.00"` cuentan como el mismo cuerpo al comparar una clave repetida, en la
    apertura (`montoInicial`), el egreso (`monto`) y el cierre (`montoDeclarado`). Se comparan como `Decimal`.
  - e) **Reintento tardío del cierre:** un envío con la clave de un cierre que llega después de que el administrador
    reabrió la caja responde 200 con la caja como está (abierta) y no la vuelve a cerrar ni audita: la clave se mira
    antes que el estado (criterio 34).
  - f) **Doble clic simultáneo en el cierre:** dos envíos a la vez con la misma clave responden 200 los dos (el éxito
    del cierre ya es 200); queda un cierre y un `CAJA_CERRADA`.
  - g) **Orden:** el 400 del esquema va antes que el 404 por el id y antes que el 200 de una clave repetida o de una
    caja ya abierta (reapertura, criterio 36 a). El 400 de `observacion` por una diferencia sin explicar no es del
    esquema: sigue al final, después de `CAJA_CAMBIO` ("Orden de los errores de negocio").
- **PP7 (criterio 24 y plan 2.4).** Manda el orden de la spec: a) caja abierta (`SIN_CAJA_ABIERTA`,
  `CAJA_DE_OTRO_DIA`), b) `pagoId` repetido (`repetido: true`), c) monto válido (si no, `RangeError`) e inserción. El
  `RangeError` se lanza dentro de c, antes de insertar, sin escribir. Así, sin caja abierta un monto inválido da
  `SIN_CAJA_ABIERTA`, y un `pagoId` ya registrado devuelve su movimiento sin mirar el monto nuevo. Alternativa
  descartada: el `RangeError` primero, antes de tocar la base, como decía el plan (las pruebas aceptan los dos órdenes;
  se elige la spec, que es la que se aprobó). El plan 2.4 queda alineado.
- **PP8 (criterios 21 y 22, parte simultánea).** No tienen archivo de pruebas propio. Según el orquestador, los cubre
  `backend/test/integracion/caja/cierre-carreras.test.ts` en el cruce egreso, cierre y cobro. **Revisado por el
  especificador (22/11/2026), la cobertura es parcial:** el criterio 33 d de ese archivo envía egresos simultáneos de
  S/ 10.00 con claves distintas sobre una caja de S/ 100.00 y solo admite 409 `CAJA_CERRADA`. No cubre:
  - del criterio 21, dos egresos simultáneos que juntos pasan el efectivo (dos de `"30.00"` con S/ 50.00: un 201 y un
    409 `EFECTIVO_INSUFICIENTE`, nunca los dos);
  - del criterio 22, dos envíos simultáneos con la misma clave (un 201 y un 200, una fila y una auditoría).

  Además, el encabezado de `backend/test/integracion/caja/egresos.test.ts` remite a `egresos-carreras.test.ts`, que no
  existe. **Pendiente:** que el test-writer escriba esas dos pruebas protegidas (deterministas, con la caja retenida y la
  espera comprobada en `pg_locks`, como el 33) antes de la implementación, o que el orquestador acepte la cobertura
  parcial y corrija el encabezado. Mientras tanto, el adversarial debe atacar esas dos carreras.

## Preguntas abiertas

Las preguntas del borrador quedaron resueltas el 22/11/2026; el texto completo de cada una, con lo decidido y la
alternativa descartada, está en "Decisiones". P13, encontrada en el repaso de la 006b, se contestó el mismo día con la
propuesta (DR-13). T8 y T9, de la ronda adversarial 1 de la 006b, se contestaron con la propuesta (DT-8 y DT-9). Queda
una: P12, encontrada al escribir PP3, que no bloquea:

- **P12 (para el responsable, no bloquea). ¿Una caja puede terminar el día con más de S/ 99,999.99 en efectivo?** El
  monto declarado del cierre usa `montoNoNegativoSchema` (criterio 30), que llega a `99999.99`, pero el esperado en
  efectivo puede pasar de esa cifra si entran muchos cobros en efectivo. En ese caso no se podría declarar lo contado y
  quedaría un faltante falso. **Propuesta:** dejarlo así y anotarlo como riesgo aceptado, porque una recepción de
  academia no junta esa cantidad en un día; si alguna vez hiciera falta, se sube el tope del declarado sin migración
  (las columnas son `numeric(12,2)`). **Valor provisional:** el tope actual de `99999.99`.

### Resueltas (22/11/2026)

Para el responsable (negocio), respondidas por Bryan, todas con la propuesta:

| Pregunta | Respuesta | Decisión | Criterios |
| --- | --- | --- | --- |
| P1. ¿Una caja por día o turnos? | Una caja abierta a la vez por academia y una por día; si se cierra por error, el administrador la reabre | DR-1 | 5, 13, 15 |
| P2. ¿Caja del día anterior sin cerrar? | No admite movimientos; la secretaria o el administrador la cierra contando el efectivo, con la marca «tardío», antes de abrir la de hoy | DR-2 | 14, 20, 32 |
| P3. ¿Cómo es un egreso? | Siempre en efectivo, concepto de texto libre y comprobante opcional como texto | DR-3 | 17, 18 |
| P4. ¿Egreso mayor que el efectivo? | No: 409 `EFECTIVO_INSUFICIENTE`, sin otro tope | DR-4 | 21 |
| P5. ¿Se anulan los movimientos? | No; el error se explica en la observación del cierre | DR-5 | 23 |
| P6. ¿Monto inicial en cero? | Sí | DR-6 | 11 |
| P7. ¿Se ve el esperado antes de contar? | Sí (HU-27) | DR-7 | 28, 38 |
| P8. ¿Reabrir la caja de un día anterior? | Sí, solo para volver a cerrarla, sin movimientos y solo si no hay otra caja abierta | DR-8 | 36 |
| P9. ¿«Su caja» de la secretaria? | Las que abrió o cerró y la caja abierta; el administrador ve todas | DR-9 | 40 a 42 |
| P10. ¿Dividir la historia? | Sí: 006a (criterios 1 a 39) y 006b (40 a 44) | DR-10 | todos |
| P11. ¿Ingresos manuales? | No; todo ingreso nace de un cobro | DR-11 | 24, "Fuera de alcance" |
| P13. ¿La secretaria ve en el historial la caja de hoy aunque la hayan abierto y cerrado otras personas? | Sí: la ve y descarga el PDF de sus cierres (contestada aparte, el mismo día) | DR-13 | 40 a 42 (PQ2 d, C5) |

Para el orquestador (técnicas), aprobadas tal como se propusieron:

| Pregunta | Respuesta | Decisión | Criterios |
| --- | --- | --- | --- |
| T1. Permiso `REABRIR_CAJA` | Sí, solo `ADMIN`; la matriz de 002 crece una fila en un commit de pruebas protegidas | DT-1 | 7, 35, 36 |
| T2. PDF | Bajo pedido, sin guardar archivos | DT-2 | 43 |
| T3. `pdfkit` | Con `@types/pdfkit`, en la 006b | DT-3 | 42 |
| T4. Trigger contra movimientos en caja cerrada | Sí | DT-4 | 6 |
| T5. Clasificación | Como se propuso | DT-5 | todos |
| T6. `ultimoMovimientoVisto` en el cierre | Sí | DT-6 | 31 |
