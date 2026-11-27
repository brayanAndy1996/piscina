# 010d · Plan técnico

Entrega de la historia 010 (DR-10 de la [spec 010](../010-mensualidades/spec.md)), especificada en su propia carpeta
(DT-1). Trabaja sobre la 010c (cambio de horario) ya implementada. Sin migraciones.

**Estado:** aprobado el 27/11/2026. Bryan aceptó la propuesta de P1 a P5 (DR-1 a DR-5 de `spec.md`) y el orquestador
aceptó DT-1 a DT-13 tal como están aquí. En pruebas protegidas.

## Módulos afectados

- `packages/contratos/src/inscripcion.ts` (e índice): `mesesInscripcionSchema`, `consultaFormularioSchema` y `mes`
  opcional en `cotizarInscripcionSchema` (criterio 16).
- `backend/src/modulos/inscripciones/`:
  - `inscripcion-publica.controller.ts`: `@Get('meses')` y la consulta `?mes=` del `@Get()` (con `ValidarCon` sobre
    `req.query`, solo la clave `mes`; las demás se ignoran, criterio 7 de 005);
  - `inscripciones.service.ts`: `leerMeses`, `leerFormulario(academia, mes?)`, `cotizar` y `enviarEnTransaccion` con el
    mes de inscripción;
  - `estado-visible.ts`: `estadoVisible` y `estadoVisibleSql` (criterio 10, DT-9).
- `backend/src/modulos/matriculas/`:
  - `dominio/reserva.ts`: `vencimientoDeReservaDelMes(ahora, mes)` (DT-7), sin tocar `vencimientoDeReserva`;
  - `cupo-para-nuevos.ts` (nuevo): `cuposParaInscripcionNueva(tx, clases, mes, ahora)` (DT-8); se exporta en `index.ts`.
- `backend/src/modulos/pagos/cupo.ts`: `exigirCupoDeLaMatricula` usa `cuposParaInscripcionNueva` (criterio 10).
- `backend/src/modulos/mensualidades/cierre-de-mes.service.ts`: la condición de `ALUMNO_ACTIVO → ALUMNO_VENCIDO`
  (criterio 11, DT-10, DR-2).
- `backend/src/modulos/academias/limite-inicio-sesion.ts`: regla `lectura` para `/inscripcion/meses` (DT-11).
- OpenAPI generado: la ruta nueva y los parámetros nuevos, si el generador no los toma solo.
- `frontend/src/modulos/inscripcion/`: `PaginaInscripcion.tsx` (paso «¿Desde cuándo?»), `pasos/PasoPlan.tsx`,
  `pasos/PasoResumen.tsx`, `ConfirmacionInscripcion.tsx`, los ganchos de consulta y `Inscripcion.test.tsx` (criterio 17).
- `frontend/src/modulos/` del seguimiento, del panel de solicitudes y de la bandeja de pagos: el mes cuando no es el en
  curso (criterio 18).
- `docs/arquitectura.md`, la guía de Windows y `specs/backlog.md` (criterio 19, documentador).

## Diseño

### Meses de inscripción (criterio 1)

`InscripcionesService.leerMeses(academia)`: `ahora` de `RELOJ`, una transacción `conAcademia` de solo lectura,
`leerConfiguracion(tx)` y `ventanaDeRenovacion(ahora, diasPrioridadRenovacion)` de `mensualidades/dominio/ventana.ts`
(DT-13). Arma `meses` con `mesesPermitidos` y `aperturaMesSiguiente` con `ventana.abierta ? null : ventana.desde`.

### Formulario con `?mes=` (criterio 2)

`leerFormulario(academia, mes?)`: sin `mes` o con M, el código actual sin cambios (misma consulta, mismos campos). Con
otro mes: si no está en `mesesPermitidos(ahora, N)`, la respuesta con `planes: []` y `clases: []` (DT-5). Con M+1: los
planes con `estadoDelPlan(plan, primerDiaDelMes(M+1)) === 'VIGENTE'` y las clases activas con
`cuposParaInscripcionNueva(tx, clases, M+1, ahora)` mayor que 0. Lectura sin bloqueos, como hoy.

### Cotización (criterio 3)

`cotizar(academia, datos)`: `mes = datos.mes ?? M`. Si `mes` no es de inscripción, `mesCambio(M)` (DT-4). Plan
disponible en la `fechaInicio` del mes. `validarSeleccion` como hoy. La cotización: `cotizarInscripcion(plan, clases,
ahora)` para M (sin cambios) y `cotizarRenovacion(plan, clases, mes, ahora)` para M+1 (DT-13), que cotiza desde las
00:00 de Lima del día 1, con el tope del plan (DR-1: la misma regla de la renovación, no el precio completo siempre).

### Envío (criterios 4 a 8)

Dentro de `enviarEnTransaccion`, con el orden de bloqueos de la 005 sin cambios (actor de recepción → consultivo de la
conexión → consultivo del DNI → filas del cliente con `FOR UPDATE` → `bloquearClasesParaCupo` → conteos → escrituras):

1. Después de los consultivos y de la clave de idempotencia, `leerConfiguracion(tx)` y los meses de inscripción con el
   `ahora` de la petición (DT-6). En el paso 3 actual, `datos.inscripcion.mes !== mesActual` pasa a «`mes` no está en
   los meses de inscripción» → `mesCambio(mesActual)`. Así el orden de los 409 de la 005 no se mueve.
2. `planDisponible(plan, nivel, fechaInicio)` con la `fechaInicio` del mes (hoy o el día 1).
3. La cotización del paso 7 con la función del mes (como en la cotización).
4. El cupo del paso 8: para M, la cuenta actual; para M+1, `cuposParaInscripcionNueva` con las clases ya bloqueadas
   (mismo `sinCupo(...)`, con las clases sin lugar en el orden pedido).
5. `reservaVenceEn = vencimientoDeReservaDelMes(ahora, mes)` (DT-7). `crearMatricula` ya toma `anio`, `mes`,
   `fechaInicio` y `fechaFin` de la cotización, así que no cambia.

La auditoría, el correo y la respuesta no cambian de forma: ya llevan `cotizacion.mes` y `reservaVenceEn`.

### Cupo para inscripciones nuevas (DT-8)

`cuposParaInscripcionNueva(tx, clases: { id, aforo }[], mes, ahora): Map<claseId, number>` en
`matriculas/cupo-para-nuevos.ts`: `M = anioYMesEnLima(ahora)`; `esMesSiguiente = mes es mesSiguiente(M)`;
`contarOcupacion(tx, ids, mes, ahora)`; si `esMesSiguiente`, `contarReservasDePrioridad(tx, ids, M, ahora)`; el resultado
con `cupoLibre({ aforo, ocupacion, reservas, esTitular: false, esMesSiguiente })` de `mensualidades/dominio/cupo.ts`
(archivo puro sin importaciones). No bloquea: quien escribe ya llamó a `bloquearClasesParaCupo`. Lo usan el formulario
(sin bloqueo, informativo), el envío y `exigirCupoDeLaMatricula`. Con un mes que no es M ni M+1, devuelve la cuenta de
`aforo − ocupación` (no ocurre: el estado visible ya lo filtró).

### Pago, rechazo y nuevo comprobante (criterios 9 y 10)

- `estadoVisible`: la rama `CANCELADA` con último pago `RECHAZADO` pasa de `datos.anio === hoy.anio && datos.mes ===
  hoy.mes` a `datos.anio * 12 + datos.mes >= hoy.anio * 12 + hoy.mes`; `estadoVisibleSql`, igual (`(m.anio::int * 12 +
  m.mes::int) >= …`). Con matrículas de M o pasadas, el resultado es el mismo de hoy (DT-9).
- `exigirCupoDeLaMatricula(tx, filas, ahora)`: en lugar de `aforo − ocupación` del mes de la matrícula, usa
  `cuposParaInscripcionNueva(tx, clases, { anio, mes } de la matrícula, ahora)` y exige 1 o más. La matrícula está
  `CANCELADA`, así que no cuenta en su propia ocupación (como hoy). Las clases ya están bloqueadas por el cobro y por la
  subida (pasos 3 y 2 de sus transacciones).
- El cobro, la subida, la verificación y `confirmarPagoEnTransaccion` no cambian: no dependen del mes.

### Cierre de mes (criterio 11, DT-10)

En las dos condiciones de `ALUMNO_ACTIVO` de `cerrarLaAcademia` (la selección de afectados y el `UPDATE`), el
`NOT EXISTS` de la matrícula `VIGENTE` pasa de `= mes en curso` a `IN (mes en curso, mes en curso + 1)` con el mismo
índice entero (`anio × 12 + mes − 1`). Las condiciones de `ALUMNO_VENCIDO → ALUMNO_ACTIVO` y las de `FINALIZADA` no
cambian (DR-2).

### Asistencia (criterio 12)

Sin cambios de código: la 009 ya decide con la matrícula del día (`MENSUALIDAD_NO_VIGENTE`), la tarea de faltas con las
ocurrencias incluidas y el registro posterior con el mes. El criterio fija ese comportamiento para el alumno nuevo.

### Web (criterios 17 y 18)

- `PaginaInscripcion`: una consulta a `GET …/inscripcion/meses` (clave `['inscripcion', nombreCorto, 'meses']`). Con dos
  meses, un paso inicial con las dos opciones; el mes elegido entra en la clave de la oferta (`['inscripcion',
  nombreCorto, 'oferta', mes]`), en la cotización y en el envío. Cambiar de mes descarta plan, clases y cotización.
  `MES_CAMBIO` invalida las dos consultas y vuelve al paso del mes. Con un solo mes, el paso no aparece y el formulario
  es el de la 005. `SIN_CLASES_EN_EL_MES` con `aperturaMesSiguiente` muestra la fecha (DR-4).
- Seguimiento, panel de solicitudes y bandeja: un formateador común «{Mes} de {año}, desde el {día}/{mes}» cuando `mes`
  no es el mes en curso de `hoy` (de la respuesta o de la fecha local de Lima, como ya lo hacen).

## Decisiones

| # | Decisión | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| DT-1 | Carpeta propia `specs/010d-inscripcion-mes-siguiente/` (decisión del orquestador, D-31) | Agregar la 010d a la spec 010 | La spec 010 tiene 790 líneas; pasaría de 800 |
| DT-2 | `GET …/inscripcion/meses` nuevo y `?mes=` en el `GET` del formulario, con la misma forma | Una clave nueva en el `GET` (`mesesDisponibles`) | La prueba protegida del criterio 6 de 005 (`lectura-publica.test.ts`) fija las claves exactas del `GET` sin `mes`; cambiarla pediría aprobación |
| DT-3 | `mes` opcional en la cotización; sin `mes`, M | `mes` obligatorio | Rompería la web y las pruebas de la 005 |
| DT-4 | Un mes que no es de inscripción responde `MES_CAMBIO` con `detalles.mes` M, en su lugar de siempre | `MES_NO_PERMITIDO` de la 010 | Las pruebas protegidas de la 005 esperan `MES_CAMBIO` con `2026-12` (fuera de la ventana) y el `detalles` actual |
| DT-5 | `?mes=` bien escrito pero no permitido: 200 con `planes` y `clases` vacíos | 409 | Una lectura no falla por el mes; es lo que hace la oferta de la renovación (criterio 2 de 010) |
| DT-6 | El envío y las lecturas públicas conservan el «ahora» único de la 005, tomado al empezar | Releer «ahora» después de los bloqueos (como la 010) | Cambiaría la definición de «Ahora» de la 005. Con el instante de llegada, una espera en el cambio de día solo cuenta de más (reservas y ocupación que acaban de vencer), así que nunca pasa del aforo (riesgo aceptado) |
| DT-7 | `vencimientoDeReservaDelMes(ahora, mes)` = mínimo entre `ahora + 24 h` y el fin del mes de la matrícula; `vencimientoDeReserva(ahora)` queda igual | Cambiar `vencimientoDeReserva` | `reserva-protegido.test.ts` (criterio 54 de 005) fija que cae en el mes de «ahora»; para M las dos coinciden |
| DT-8 | Una sola función `cuposParaInscripcionNueva` en `matriculas/` para el formulario, el envío y el nuevo intento tras un rechazo | Repetir la cuenta en cada lugar | «Reglas para las historias siguientes» de 010: toda operación que ocupe una clase en M+1 usa la función común; lo que se muestra y lo que se decide no pueden divergir |
| DT-9 | `PAGO_RECHAZADO` mientras el mes de hoy no sea posterior al de la matrícula | Dejar la igualdad de la 007b | Con la igualdad, un rechazo de M+1 en M se vería `VENCIDA` y el cliente no podría subir otro comprobante (D-05) |
| DT-10 | El cierre no vence a un `ALUMNO_ACTIVO` con matrícula `VIGENTE` de M+1 (DR-2) | Dejar la regla de la 010b | Con la regla actual, el alumno nuevo que pagó M+1 pasaría a `ALUMNO_VENCIDO` en la vuelta siguiente (15 minutos) hasta el día 1 |
| DT-11 | `/inscripcion/meses` en la regla `lectura` (60 por minuto, mismo contador que las otras dos lecturas) | Sin límite o regla propia | Toda ruta pública lleva su límite (criterio 33 de 005); es una lectura más del formulario |
| DT-12 | Sin E2E nueva: el flujo es el de la E2E de la 005 con otro mes, y la ventana depende de `RELOJ`, que las E2E no fijan | Una E2E con la configuración en 28 días | Frágil según la fecha real; la integración cubre los bordes con `RELOJ` |
| DT-13 | Se reutilizan `ventanaDeRenovacion`, `mesesPermitidos`, `mesSiguiente`, `primerDiaDelMes`, `cotizarRenovacion` y `cupoLibre` importando los archivos de `mensualidades/dominio/` (puros), no el módulo Nest | Copiarlos en `inscripciones/` | Una sola definición de la ventana y de la cotización; `mensualidades/dominio/` no importa servicios, así que no hay ciclos |
| DT-14 | `vencimientoDeReservaDelMes(ahora, mes)` recibe el mes como `{ anio, mes }` (`MesDeCalendario`) | El texto `AAAA-MM` | El resto del dominio usa `MesDeCalendario`; el texto se convierte en el controlador. Decidida por el orquestador el 27/11/2026, a partir de las pruebas protegidas |
| DT-15 | Las pruebas protegidas de la 010d llevan la marca `// spec: 010-mensualidades (pruebas protegidas)` y sus commits el título «Pruebas protegidas (010): 010d, …» | La marca `010d-inscripcion-mes-siguiente` y el título «(010d)», con cambios en `scripts/verificar-pruebas-protegidas.mjs` | El verificador solo reconoce marcas y títulos con tres dígitos (`\d{3}`), y con la marca `010d-…` no protegía ningún archivo. La 010d es una entrega de la historia 010, como 010a a 010c, así que basta con usar su marca; no se toca el verificador, que es ruta crítica de la 000. Decidida por el orquestador el 27/11/2026 |

## Migraciones

Ninguna.

## Riesgos

- **Ciclos de importación:** `pagos/cupo.ts` y `inscripciones.service.ts` importan de `matriculas/` y de archivos puros
  de `mensualidades/dominio/`, nunca de `mensualidades/index.ts` ni de sus servicios. El revisor lo comprueba.
- **La forma del `GET` del formulario:** sin `mes` debe ser idéntica a la de hoy; cualquier clave nueva rompe la prueba
  protegida del criterio 6 de 005.
- **`estadoVisibleSql`:** filtra la lista del panel; el cambio tiene que ser el mismo en TypeScript y en SQL (criterio 10
  lo prueba con la lista filtrada).
- **Cierre de mes:** el cambio toca una tarea programada crítica; las pruebas protegidas de la 010b deben seguir en
  verde sin tocarlas.
