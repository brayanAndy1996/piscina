# 010 · Plan técnico

**Estado:** aprobado con la spec el 26/11/2026; 010a en curso. Bryan aceptó las propuestas de P1 a P11 (DR-1 a DR-11
de la spec) y los cambios A1 y A2; el orquestador, DT-1 a DT-21 y la partición en 010a, 010b, 010c y 010d. El diseño
no cambia. La 010d (inscripción pública al mes siguiente, DR-10) se diseña cuando se especifique.

## Módulos afectados

- `backend/src/modulos/mensualidades/` (nuevo):
  - `mensualidades.module.ts`;
  - `renovacion.controller.ts`, `renovacion.service.ts` (oferta, cotización y efectivo) y
    `renovacion-comprobante.service.ts` (010a);
  - `listado.controller.ts` y `listado.service.ts` (010b);
  - `cierre-de-mes.service.ts` y `cierre-de-mes.tarea.ts` (010b);
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
aplican después; corta en 500 filas.

**Cierre de mes.** `CierreDeMesTarea` (`@Cron('0 */15 * * * *', { name: 'cierre-de-mes' })` y al arrancar) llama a
`CierreDeMesService.cerrar(RELOJ.ahora())`, con el mismo módulo condicionado por `TAREAS_PROGRAMADAS` que la tarea de
faltas. Por academia:

1. `pg_try_advisory_xact_lock(hashtextextended('cierre-de-mes:' || academia, 0))`; si no lo obtiene, sigue con la
   siguiente.
2. Los ids de los alumnos afectados (los de las matrículas `VIGENTE` de meses anteriores a M y los que cambiarían de
   `ALUMNO_ACTIVO` a `ALUMNO_VENCIDO` o al revés), sin bloquear.
3. `SELECT … FROM alumnos WHERE id = ANY(…) ORDER BY id FOR UPDATE`; después sus matrículas con `FOR UPDATE`, ordenadas
   por id.
4. Las dos sentencias de escritura (`UPDATE matriculas … WHERE estado = 'VIGENTE' AND (anio, mes) < M` y `UPDATE
   alumnos SET estado = CASE …`), que vuelven a evaluar la condición sobre las filas ya bloqueadas.
5. El `info` con las cantidades.

El orden alumno → matrícula es el mismo del marcado (009), de la tarea de faltas (009b), del cobro (007a) y de la
renovación, así que no hay ciclos.

### 010c · Cambio de horario

Una transacción: `bloquearActorVigente` → `alumnos` con `FOR UPDATE` → la matrícula con `FOR UPDATE` →
`bloquearClasesParaCupo(salen ∪ entran)` → «ahora» → validaciones → `DELETE` de las filas que salen e `INSERT` de las
que entran con `agregada_en` → auditoría. La regla de «ocurrencia incluida» de la 009 pasa a ser: inicio posterior a
`matriculas.creado_en` y, si `agregada_en` no es nula, también a `agregada_en`. Se cambia en un solo lugar del dominio de
la asistencia (la función que ya decide `CLASE_NO_INCLUIDA`) y en la consulta de la tarea de faltas.

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
