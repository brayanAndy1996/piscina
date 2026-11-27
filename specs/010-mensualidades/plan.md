# 010 · Plan técnico

**Estado:** aprobado con la spec el 26/11/2026; 010a lista para unir (26/11/2026), 010b lista para unir (27/11/2026, con
DT-31 a DT-37 al final de «Decisiones») y 010c implementada y pendiente de unir (27/11/2026, con DT-38 a DT-48). Bryan aceptó las propuestas de P1 a P11 (DR-1 a DR-11
de la spec) y los cambios A1 y A2; el orquestador, DT-1 a DT-21 y la partición en 010a, 010b, 010c y 010d. El diseño
no cambia. La 010d (inscripción pública al mes siguiente, DR-10) se diseña cuando se especifique.

## Módulos afectados

- `backend/src/modulos/mensualidades/` (nuevo):
  - `mensualidades.module.ts`;
  - `renovacion.controller.ts`, `renovacion.service.ts` (oferta, cotización y efectivo) y
    `renovacion-comprobante.service.ts` (010a);
  - `listado.controller.ts` y `listado.service.ts` (010b);
  - `cierre-de-mes.service.ts`, `cierre-de-mes.tarea.ts` y `tareas-mensualidades.module.ts` (010b, DT-32);
  - `horario.controller.ts` y `horario.service.ts` (010c);
  - `bloqueos.ts`: las filas de la renovación y del cambio, en el orden de la regla;
  - `errores.ts` e `index.ts`.
- `backend/src/modulos/mensualidades/dominio/` (puras, con pruebas unitarias): `ventana.ts` (`ventanaDeRenovacion`,
  `estaPorVencer`, `mesesPermitidos`), `cotizacion.ts` (`cotizarRenovacion`), `estado.ts` (`estadoDeMensualidad`) y
  `cupo.ts` (`cupoLibre`, la regla de DT-4 con los números ya contados).
- `backend/src/modulos/matriculas/ocupacion.ts`: `contarReservasDePrioridad(tx, claseIds, mesEnCurso, ahora)`, sin
  bloquear, junto a `contarOcupacion`.
- `backend/src/modulos/pagos/`: `verificacion.service.ts` (`LEFT JOIN` en `listarPendientes`; aviso de renovación al
  aprobar y al rechazar), `confirmacion.ts` (paso a `ALUMNO_ACTIVO` de un `ALUMNO_VENCIDO` con la matrícula de M),
  `avisos.ts` (plantillas `RENOVACION_CONFIRMADA` y `RENOVACION_RECHAZADA`) e `index.ts` (exportar lo que reutiliza la
  renovación: `recodificarImagen`, la relectura del comprobante, `leerDatosDelPago`).
- `backend/src/modulos/asistencia/` (010c): `marcado.service.ts`, `faltas.service.ts` y el registro posterior suman
  `agregada_en` a la regla de «ocurrencia incluida».
- `backend/src/modulos/caja/head-sin-ruta.ts`: `PREFIJOS_SIN_HEAD` suma `/mensualidades` y `/matriculas`.
- `backend/prisma/`: `schema.prisma` y las migraciones `<marca>_renovaciones` (010a) y `<marca>_cambio_horario` (010c).
- `backend/src/infraestructura/prisma/privilegios-app.ts` y `scripts/lib/rol-app.mjs` (010c: `DELETE` en
  `matricula_clases`).
- `packages/contratos/src/mensualidades.ts` (nuevo) y `pagos.ts` (`solicitud` nula en `pagoPendienteSchema`).
- `frontend/src/modulos/mensualidades/` (nuevo): sección «Mensualidad», diálogo «Renovar», «Cambiar horario» y la
  página `/panel/mensualidades`; `frontend/src/modulos/pagos/` (textos de la bandeja).

## Diseño

### 010a · Renovación

**Oferta y cotización.** Lecturas en una transacción de la academia, sin bloqueos: el alumno (no `CLIENTE`), sus
matrículas de M y M+1, la configuración (`leerConfiguracion`), los planes y las clases de su nivel. Los cupos se
calculan con `contarOcupacion` y `contarReservasDePrioridad` sin bloquear (son informativos). `cotizarRenovacion`
reutiliza `clasesRestantes` y `montoProporcional` de `matriculas/dominio/cobro.ts`; para M+1 pasa como «ahora» las
00:00 de Lima del día 1 de M+1 (DT-6).

**Registro en efectivo (una transacción).**

1. `bloquearActorVigente`.
2. Lectura sin bloqueo del DNI del alumno (para el consultivo) y bloqueo consultivo `inscripcion-dni:`.
3. `alumnos` con `FOR UPDATE` (404 si no existe, es de otra academia o es `CLIENTE`).
4. La clave: si ya hay un pago con esa clave, decide 200 o 409 `CLAVE_YA_USADA` (criterio 12).
5. `matriculas` del alumno de M y M+1 con `FOR UPDATE`, ordenadas por id.
6. `bloquearClasesParaCupo(tx, claseIds)` en una sola llamada.
7. «Ahora» (`RELOJ`), `leerConfiguracion`, el plan; la decisión en el orden del criterio 8 con funciones puras
   (`mesesPermitidos`, `validarSeleccion` de la 005, `cotizarRenovacion`) y el cupo (`contarOcupacion`,
   `contarReservasDePrioridad`, `cupoLibre`).
8. `INSERT` de la matrícula (`RESERVADA`, `reserva_vence_en` nula, `solicitud_id` nula) y de `matricula_clases`.
9. `confirmarPagoEnTransaccion` con `nuevo: { claveIdempotencia }`, concepto `MENSUALIDAD` y método `EFECTIVO`: la caja
   va al final, dentro de ella. La matrícula pasa a `VIGENTE`.
10. Si la matrícula es de M y el alumno está `ALUMNO_VENCIDO`, `UPDATE alumnos` a `ALUMNO_ACTIVO` (fila ya bloqueada).
    Este paso vive en `confirmarPagoEnTransaccion` para que también lo haga la aprobación.
11. `RENOVACION_REGISTRADA` en la auditoría.

Un choque de `matriculas_alumno_mes_ocupa_cupo_key` o de `pagos_academia_id_clave_idempotencia_key` se reconoce por el
nombre de la restricción después del `ROLLBACK` y se vuelve a decidir una vez con lo confirmado (como la 007a).

**Registro con comprobante.** El lector binario de la 008b (`comun/http/cuerpo-imagen.ts`) con
`REGISTRAR_INSCRIPCION_Y_COBRO`; la cabecera `X-Renovacion-Datos` se valida en el controlador. Después:

1. Lectura corta en su propia transacción: actor vigente, alumno, clave (para responder 200 o 409 sin procesar la
   imagen).
2. Fuera de transacción: `recodificarImagen` (2000 px, sin metadatos) y `AlmacenArchivos.guardar` con la clave del
   servidor.
3. Transacción de escritura con los pasos 1 a 8 del efectivo, más el número de operación, la fecha y el `INSERT` del
   pago `PENDIENTE_VERIFICACION`; sin caja. La auditoría `RENOVACION_REGISTRADA`.
4. Si la transacción rechaza: se borra el archivo nuevo. Si la confirmación es incierta: relectura de
   `pagos.comprobante_clave` con `FOR SHARE` y `esperaMaximaDeBloqueoMs: 5000`; se borra solo si la referencia no quedó.

**Bandeja, aprobación y rechazo.** `listarPendientes` pasa a `LEFT JOIN solicitudes_inscripcion` y devuelve
`solicitud: null` sin solicitud. `aprobar` y `rechazar` ya admiten la matrícula sin solicitud (`FilasDelPago`); se suma
el aviso de renovación cuando `filas.solicitud === null`, con los destinatarios del alumno (y del apoderado si es
menor), después de confirmar.

**Reservas de prioridad (SQL, sin bloquear).** Para cada clase c de la lista y el mes M de «ahora»: cuántos alumnos
distintos tienen una matrícula de M que incluye c y está `VIGENTE`, y no tienen una matrícula de M+1 `VIGENTE` o
`RESERVADA` sin vencer. `cupoLibre` no resta las reservas si el alumno que pide es uno de ellos en c (`aforo −
ocupación`); a los demás, sí (`aforo − ocupación − reservas`). Ajuste de la ronda adversarial 1 (R1-1, criterio 44):
la fórmula original, que restaba las reservas a todos y sumaba 1 al titular, dejaba sin lugar a todos los titulares
cuando había más titulares que lugares. Ajuste de la ronda adversarial 2 (R2-1, DR-12, criterio 45): la matrícula de M
`RESERVADA` en verificación ya no cuenta, ni en `contarReservasDePrioridad` (`matriculas/ocupacion.ts`) ni en
`clasesDeLaTitularidad` (`mensualidades/lectura.ts`); las dos consultas usan la misma condición, solo `VIGENTE`, para
que el alumno que pide y la cuenta de reservas no se contradigan.

### 010b · Estados y cierre de mes

**Listado.** Una lectura sin bloqueos: las matrículas de X, X−1 y X+1 de la academia con sus pagos pendientes, sus
planes y sus clases; `estadoDeMensualidad` decide el estado de cada alumno en memoria; los filtros y los totales se
aplican después; corta en 500 filas (DT-37). Con `alumnoId`, la sentencia lee solo las de ese alumno (DT-31). La consulta
se valida de forma estricta (DT-36).

**Cierre de mes.** `CierreDeMesTarea` (`@Cron('0 */15 * * * *', { name: 'cierre-de-mes' })` y al arrancar) llama a
`CierreDeMesService.cerrar()`, que lee el reloj por academia (DT-35), desde su propio módulo `TareasMensualidadesModule`,
cargado como el de las faltas solo con `TAREAS_PROGRAMADAS=activas` (DT-32). Por academia:

1. `pg_try_advisory_xact_lock(hashtextextended('cierre-de-mes:' || academia, 0))`; si no lo obtiene, sigue con la
   siguiente.
2. Los ids de los alumnos afectados (los de las matrículas `VIGENTE` de meses anteriores a M y los que cambiarían de
   `ALUMNO_ACTIVO` a `ALUMNO_VENCIDO` o al revés), sin bloquear.
3. `SELECT … FROM alumnos WHERE id = ANY(…) ORDER BY id FOR UPDATE`; después sus matrículas `VIGENTE` con `FOR UPDATE`,
   ordenadas por id (DT-33).
4. Las dos sentencias de escritura (`UPDATE matriculas … WHERE estado = 'VIGENTE' AND (anio, mes) < M` y `UPDATE
   alumnos SET estado = CASE …`), limitadas a los alumnos bloqueados, que vuelven a evaluar la condición con el «ahora»
   leído después de los bloqueos (DT-33, DT-35).
5. El `info` con las cantidades, después de confirmar (DT-34).

El orden alumno → matrícula es el mismo del marcado (009), de la tarea de faltas (009b), del cobro (007a) y de la
renovación, así que no hay ciclos.

### 010c · Cambio de horario

Una transacción: `bloquearActorVigente` → `alumnos` con `FOR UPDATE` → la matrícula con `FOR UPDATE` →
`bloquearClasesParaCupo(salen ∪ entran)` → «ahora» → validaciones → `DELETE` de las filas que salen e `INSERT` de las
que entran con `agregada_en` → auditoría. La regla de «ocurrencia incluida» de la 009 pasa a ser: inicio posterior a
`matriculas.creado_en` y, si `agregada_en` no es nula, también a `agregada_en`. Se cambia en un solo lugar del dominio de
la asistencia (la función que ya decide `CLASE_NO_INCLUIDA`) y en la consulta de la tarea de faltas.

**Lectura del horario (criterio 46, DT-38).** `GET /api/alumnos/{id}/horario` en `horario.controller.ts` (o un
controlador hermano con el prefijo `alumnos`) y un método de lectura en `horario.service.ts`: en una transacción de la
academia, sin bloqueos, el alumno (no `CLIENTE`), «ahora» y M, sus matrículas que `sePuedeCambiarElHorario` acepta, el
plan de cada una (`leerPlan`), las clases activas que `validarSeleccion` admitiría por nivel, día y franja, y el cupo con
las mismas piezas del cambio: `contarOcupacion` (restando 1 en las clases que la matrícula ya tiene),
`contarReservasDePrioridad` y `clasesDeLaTitularidad` si es de M+1, y `cupoLibre` recortado a 0.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Renovación en una sola operación (DT-2) | Reserva de 24 h y pago aparte | Menos estados, sin vencimiento ni cancelación |
| Prioridad dentro del aforo (DT-4) | Admitir siempre al titular | El aforo es la regla crítica; la prioridad cubre el caso normal |
| El titular compite solo con la ocupación del mes siguiente (DT-4, R1-1) | Restarle las reservas y sumarle su lugar | Con más titulares que lugares, la fórmula original no dejaba entrar a ninguno |
| Solo la matrícula de M `VIGENTE` da prioridad (DT-3, DR-12, R2-1) | También la de M en verificación | Quien no pagó M apartaba un lugar de M+1 y, si se rechazaba su pago, dejaba sin lugar a un titular legítimo |
| Reservas calculadas al leer | Guardar las reservas en una tabla | No hay que liberarlas el día 1 ni mantenerlas en cada cambio |
| Bloquear solo las clases elegidas (DT-7) | Bloquear también las clases del mes en curso del alumno | Una cuenta vieja de reservas solo puede sobrar |
| Paso a `ALUMNO_ACTIVO` dentro de `confirmarPagoEnTransaccion` | Hacerlo en cada servicio | El efectivo y la aprobación lo comparten |
| Tarea del cierre separada de la de faltas (DT-12) | Correr el cierre dentro de la tarea de faltas | Cada tarea tiene su bloqueo y su error; A1, aprobada el 26/11/2026 |
| `DELETE` e `INSERT` con `agregada_en` (DT-15) | Historial con `quitada_en` | No cambia las consultas de 005 a 009 que leen las clases actuales |
| Módulo nuevo `mensualidades/` | Repartir en `matriculas/` y `pagos/` | `matriculas/` no tiene Nest; la renovación tiene controlador y tarea propios |

### Decisiones técnicas de la implementación de la 010b

DT-1 a DT-30 están en «Decisiones» de `spec.md`. Estas nacieron al implementar la 010b; el orquestador las anota al
cerrar la entrega, el 27/11/2026, verificadas en el código.

- **DT-31. Filtro `alumnoId` del listado** (commit `2fa6d15`). `GET /api/mensualidades` acepta `alumnoId` opcional
  (`z.uuid`, en `consultaListadoMensualidadesSchema`). El filtro va en la sentencia de `listado.service.ts`
  (`m.alumno_id = alumnoId` junto a `m.academia_id` de la sesión, además de RLS), en minúsculas: un alumno de otra
  academia o inexistente da 200 con `alumnos` vacío, `totales` en cero y `hayMas` false, no un error. Los totales son
  los de ese alumno. Lo usa la sección «Mensualidad» de la ficha (criterio 31). Se apoya en el aislamiento del listado
  (criterio 26), sin criterio crítico nuevo; lo cubre la prueba no protegida
  `backend/test/integracion/mensualidades/listado-consulta.test.ts`. Descartado: filtrar en memoria (leería todas las
  filas de la academia para mostrar una) o una ruta propia por alumno (otro endpoint con su permiso y su aislamiento).
- **DT-32. Módulo aparte `TareasMensualidadesModule`** (`tareas-mensualidades.module.ts`), solo con `CierreDeMesTarea`.
  `AppModule` lo carga con `ScheduleModule.forRoot()` y `TareasAsistenciaModule` solo con `TAREAS_PROGRAMADAS=activas`
  (criterio 30). `CierreDeMesService` está en `MensualidadesModule`, que siempre se carga: las pruebas lo llaman
  directamente con las tareas apagadas. La tarea lleva una bandera en memoria que salta una vuelta si la anterior sigue
  en el mismo proceso; entre instancias manda el bloqueo consultivo. Descartado: la tarea dentro de
  `MensualidadesModule` (se cargaría con las tareas apagadas) o en el módulo de tareas de la asistencia (mezclaría
  módulos).
- **DT-33. El cierre bloquea solo lo que escribe.** Después de los alumnos afectados (`FOR UPDATE`, por id), bloquea solo
  sus matrículas `VIGENTE` (las únicas que finaliza y las que deciden el estado del alumno), no todas sus matrículas.
  Los dos `UPDATE` se limitan a los alumnos bloqueados (`id = ANY(…)` y `alumno_id = ANY(…)`): nunca escriben una fila
  que no se bloqueó en el orden alumno → matrícula. Si el mes cambia entre la elección de los afectados y las escrituras,
  solo se escriben los ya bloqueados y el resto queda para la vuelta siguiente. Descartado: bloquear todas las
  matrículas de los afectados (más filas a las 00:00 sin cambiar el resultado) o un `UPDATE` sobre toda la academia.
- **DT-34. Un `info` «Cierre de mes» por academia en cada vuelta,** con `academiaId` y las tres cantidades, también
  cuando son cero, después de confirmar su transacción. La academia saltada porque otra instancia tiene su bloqueo o
  porque se suspendió entre la lista y su turno deja un `debug` y la vuelta sigue (ronda 1 de la 010b, F2); un error,
  un `error` con `errorParaRegistro`. Descartado: registrar solo cuando hay cambios (no se vería que la tarea corre).
- **DT-35. `cerrar(ahora?)` usa el reloj por defecto.** Sin argumento (la tarea), lee `RELOJ.ahora()` por academia,
  después del bloqueo consultivo y otra vez después de los `FOR UPDATE`, y ese segundo instante decide el mes y el
  `actualizado_en` (ronda 1 de la 010b, F1). Con un instante explícito (las pruebas), ese vale para todas las academias.
  Ajusta el diseño, que decía `cerrar(RELOJ.ahora())`. Descartado: leer la hora una vez para toda la vuelta (una vuelta
  que cruza la medianoche del día 1 cerraría las últimas academias con el mes anterior).
- **DT-36. Consulta estricta del listado** (ronda 1 de la 010b, F3). `listado.controller.ts` arma la consulta desde la
  dirección con `URLSearchParams` en un `Map`: un nombre repetido pasa a ser un arreglo, que el esquema rechaza, y uno
  que la API no define (`academiaId`, `__proto__`) lo rechaza `z.strictObject`. Todo responde 400 `SOLICITUD_INVALIDA`
  con el campo (criterio 25). El tope inferior del `mes` (2000-01) está en el esquema; el superior (no posterior a M),
  en el servicio con el reloj, también 400 con el campo `mes`. Descartado: la consulta ya interpretada por Express, que
  dejaba pasar parámetros mal formados o repetidos.
- **DT-37. Tope de 500 filas con `hayMas`** (complementa DT-14). `MAXIMO_DE_FILAS_DEL_LISTADO = 500`: el corte se hace
  en memoria después de filtrar y ordenar; `totales` cuentan todas las filas con los demás filtros, no solo las 500, y
  `hayMas` es true si había más. No hay prueba con más de 500 filas (sembrar 501 alumnos con sus matrículas encarece la
  suite); las pruebas comprueban `hayMas: false`. Riesgo aceptado en `spec.md`. Descartado: paginación (no hace falta
  con los filtros, DT-14).

### Decisiones técnicas de la 010c

- **DT-38. Lectura propia para el cambio de horario** (decisión del orquestador, 27/11/2026; criterio 46). Motivo: la
  web del criterio 42 no tenía de dónde sacar el id de la matrícula ni los cupos de un mes ya inscrito. Ninguna lectura
  expone el id de la matrícula (`ofertaRenovacionSchema.mensualidadActual`, `filaDelListadoMensualidadesSchema`,
  `carnetSchema.matricula` y `asistenciaDelMesSchema.matricula` no lo traen), y la oferta de renovación excluye los
  meses ya inscritos y devuelve `clases: []`. Se agrega `GET /api/alumnos/{id}/horario` con
  `MODIFICAR_HORARIO_ALUMNO`, que devuelve las matrículas que el criterio 35 deja cambiar, con su plan, sus clases y las
  clases que el plan permite con `cuposRestantes` y `conPrioridad` calculados como el criterio 36 (sin contar la
  matrícula que se cambia). El `estado` de cada matrícula es el de la matrícula (`VIGENTE` o `EN_VERIFICACION`, el
  mismo enum de `renovacionRegistradaSchema`) y no el de la mensualidad de HU-11: es la condición que decide si se puede
  cambiar, no depende de hoy ni de `diasPorVencer`, y no obliga a correr `estadoDeMensualidad` por matrícula. Es crítico
  por permisos y aislamiento (D-23, sección 2.1). Descartado: ampliar la oferta de renovación con `matriculaId`, que no
  resuelve los cupos de un mes ya inscrito y cambia una forma protegida (`ofertaRenovacionSchema`, criterio 2).

Las siguientes nacieron al implementar el backend de la 010c; el orquestador las anota al cerrar la entrega, el
27/11/2026.

- **DT-39. `SELECCION_NO_VALIDA` uniforme, sin posiciones.** Los errores de `validarSeleccion` salen todos en el campo
  `claseIds`, cada mensaje una sola vez y sin la posición de la clase: el rechazo no distingue una clase inexistente de
  una de otra academia ni dice cuál de las pedidas falló (criterio 41). Descartado: un error por clase, con su posición.
- **DT-40. Se valida la selección completa** con `validarSeleccion` (005), incluidas las clases que se mantienen, no
  solo las que entran: el horario resultante cumple el criterio 4 con el plan y el nivel de hoy (DT-20). Descartado:
  validar solo las nuevas (dejaría una selección final que no cumple el plan).
- **DT-41. Orden de decisión del cambio:** 404 `NO_ENCONTRADO` → 409 `MATRICULA_NO_MODIFICABLE` → sin diferencias (200
  sin escribir, criterio 37) → `SELECCION_NO_VALIDA` → `SIN_CUPO`.
- **DT-42. «Modificable»** es una matrícula del mes M o M+1 de «ahora», `VIGENTE` o `RESERVADA` sin vencimiento (en
  verificación); la reserva de 24 horas no (criterio 35). La comparten el `POST` y el `GET` (`sePuedeCambiarElHorario`).
- **DT-43. No se actualiza la fila de `matriculas`.** El cambio solo borra e inserta en `matricula_clases`; ninguna
  columna de la matrícula cambia (criterio 37); la fecha del cambio queda en `agregada_en` y en la auditoría.
- **DT-44. El cupo sale de `cuposDelHorario`,** una sola función que usan el `GET` (criterio 46) y el `POST` (criterio
  36), para que «`cuposRestantes` 0 si y solo si `SIN_CUPO`» se cumpla por construcción. Descartado: dos cálculos
  paralelos.
- **DT-45. `ocurrenciasRestantes`** cuenta desde «ahora» si la matrícula es de M y desde las 00:00 de Lima del día 1 si
  es de M+1 (como `cotizarRenovacion`, DT-6).
- **DT-46. Trigger `BEFORE INSERT OR DELETE`,** por fila, que lee la matrícula con `FOR SHARE` (ronda 1 de la 010c, F1),
  responde 23514 y cierra por defecto si no la ve. No cubre `UPDATE` (la app no lo tiene) ni reabrir y cerrar en una
  misma transacción (deuda, `rondas.md`).
- **DT-47. Una sola `ocurrenciaIncluida`,** estricta (inicio posterior a `creado_en` y a `agregada_en`), en el dominio
  de la asistencia, usada por el marcado, el registro posterior y la tarea de faltas; `agregadaEn` es opcional en sus
  tipos para no cambiar a quienes no la tienen (criterio 38).
- **DT-48. Detalles del `GET` del horario.** `clasesDelPlan` se filtra por nivel, día y franja sin pasar por
  `validarSeleccion` (que valida una selección, no lista opciones); `estado` es `VIGENTE` o `EN_VERIFICACION`;
  `conPrioridad` es true solo en una matrícula de M+1 y si la clase está en la matrícula `VIGENTE` del mes M (criterio
  46).

## Migraciones

- **010a · `<marca>_renovaciones`:** `ALTER TABLE matriculas ADD CONSTRAINT matriculas_renovacion_sin_vencimiento CHECK
  (solicitud_id IS NOT NULL OR reserva_vence_en IS NULL)`. Se valida al crearla: hoy no hay matrículas sin solicitud.
- **010c · `<marca>_cambio_horario`:** `ALTER TABLE matricula_clases ADD COLUMN agregada_en timestamptz(3)`; la
  política `matricula_clases_borrar` (`FOR DELETE USING academia_id = app_academia_actual()`); `GRANT DELETE ON
  matricula_clases TO aquagestion_app`; la función y el trigger `matricula_clases_solo_matricula_abierta` (`SECURITY
  INVOKER`, `SET search_path`, `REVOKE ALL … FROM PUBLIC`). Reversible a mano: quitar el trigger, la política, el
  privilegio y la columna.

## Riesgos

- **Superficie nueva de subida de imágenes con sesión:** reutilizar sin copiar el lector binario, la recodificación y la
  relectura de la 007b y la 008b; el adversarial ataca la cabecera nueva y el orden de las comprobaciones.
- **La regla de reservas es SQL con varias condiciones:** se prueba con tablas pequeñas y con los bordes del criterio 9;
  la función pura `cupoLibre` concentra la decisión.
- **La aprobación cambia `alumnos.estado`:** la fila del alumno ya está bloqueada por `bloquearFilasDelPago`; no cambia
  el orden.
- **El cierre bloquea muchos alumnos a la vez a las 00:00:** se limita a los afectados y escribe con dos sentencias; a
  esa hora no hay clases.
- **La 010c toca código de la 009:** las pruebas protegidas de la 009 deben seguir en verde; las filas existentes tienen
  `agregada_en` nula.
- **Cambios a pruebas protegidas (A1 y A2, aprobados el 26/11/2026):** los hace el test-writer en el commit de pruebas
  protegidas de su entrega (T18 y T26), con la nota en la cabecera; ningún commit de implementación los toca.
