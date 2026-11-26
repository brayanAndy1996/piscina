# 009 · Plan técnico

Las partes de la 009b llevan **[009b]**. Los números de criterio son los de `spec.md`.

## Módulos afectados

- `backend/prisma/schema.prisma` y dos migraciones: `<marca>_asistencias` (009a) y `<marca>_inasistencias` (009b).
- `backend/src/modulos/asistencia/` (nuevo):
  - `asistencia.module.ts`, `asistencia.controller.ts` (`/api/asistencias/qr`, `/manual` y, en la 009b, `/posterior`);
  - `marcado.service.ts`: el caso de uso común del QR, el manual y el posterior;
  - `dominio/ventana.ts` (`diaIsoEnLima`, `ocurrencia(fecha, horaInicio, horaFin)` → `{ inicio, fin }`,
    `dentroDeLaVentana`), `dominio/llegada.ts` (`estadoDeLlegada`) y `dominio/validaciones.ts` (`decidirMarcado`, que
    recibe lo leído y devuelve el código del criterio 7 o «registrar»; puro);
  - `lectura.ts`: consultas sin Nest (matrícula del día, clase del día, asistencia del día, pago en verificación);
  - **[009b]** `faltas.service.ts` (`registrarFaltas(ahora)`), `faltas.tarea.ts` (el `@Cron`), `consulta.service.ts`
    (asistencia del mes) y su ruta en el controlador de `alumnos` o en uno propio bajo `/api/alumnos/{id}/asistencias`;
  - `errores.ts` y `index.ts`.
- `backend/src/modulos/alumnos/`: extraer `leerFoto` de `carnet.service.ts` a `foto-como-data.ts` (exportada en
  `index.ts`) sin cambiar el carnet.
- `backend/src/modulos/caja/head-sin-ruta.ts`: sumar `/asistencias`.
- `backend/src/infraestructura/prisma/privilegios-app.ts` y `scripts/lib/rol-app.mjs`: las tablas y columnas nuevas.
- **[009b]** `backend/src/infraestructura/entorno/entorno.ts`: `TAREAS_PROGRAMADAS`; `app.module.ts`:
  `ScheduleModule.forRoot()` solo con `activas`; `scripts/lib/dependencias-backend.mjs`: `@nestjs/schedule`.
- `packages/contratos/src/asistencia.ts` (nuevo) y su reexportación.
- `frontend/src/modulos/asistencia/` (pantalla de recepción, 009a) y, en la 009b, la sección «Asistencia» de
  `frontend/src/modulos/alumnos/`.
- Pruebas: `backend/test/integracion/asistencia/` y `backend/test/utilidades/asistencia.ts` (alumno con matrícula
  `VIGENTE`, clase en un bloque y `RELOJ` fijo).

## Diseño

### Marcado (009a, criterios 2 a 16)

Un solo método `marcar(actor, entrada, ip)` con tres orígenes: `{ tipo: 'QR', contenido }`, `{ tipo: 'MANUAL',
alumnoId }` y, en la 009b, `{ tipo: 'POSTERIOR', alumnoId, fecha, horaLlegada, motivo }`.

1. **Antes de la transacción:** el esquema zod (400) y, para el QR, `tokenDelContenidoQr(contenido)`. Si da `null`, la
   transacción se abre igual y responde 404 `QR_NO_RECONOCIDO` después de `bloquearActorVigente`, para que el 401 de un
   actor que ya no está vigente gane también aquí (criterio 6).
2. **Transacción `conAcademia`** (lectura comprometida, la de siempre):
   1. `bloquearActorVigente(tx, actor, { registro, ip })` (`FOR SHARE`).
   2. Alumno: `SELECT … FROM alumnos WHERE academia_id = $a AND qr_token = $t AND estado <> 'CLIENTE' FOR SHARE` (o por
      `id`; con un token `null` no se consulta). Sin fila → 404. Con `FOR SHARE`, si la regeneración tiene la fila, la sentencia espera y vuelve a evaluar
      `qr_token` con la versión confirmada (criterio 4).
   3. Clave: `SELECT … FROM asistencias WHERE academia_id = $a AND clave_idempotencia = $c`. Si existe y es del mismo
      alumno y del mismo tipo de registro → se arma la respuesta 200 desde esa fila (sin más bloqueos). Si es de otro →
      409 `CLAVE_YA_USADA`.
   4. Matrícula: con un «ahora» provisional se elige el día (hoy, o la fecha del posterior) y se toma con `FOR UPDATE`
      la matrícula `VIGENTE` del alumno de ese mes. Después se lee el «ahora» definitivo (DT-16) y todo se decide con él:
      si en la espera cambió el día (solo cerca de la medianoche, cuando no hay clases), la matrícula bloqueada deja de
      ser la del día y el resultado es un rechazo, nunca un registro. Si no hay matrícula, no se bloquea nada más.
   5. «Ahora» definitivo con `RELOJ`, `leerConfiguracion(tx)`, la asistencia del día (sin bloqueo; la matrícula ya
      ordena), el pago en verificación (solo si no hay matrícula del día), la clase del día (`matricula_clases` ⨝
      `clases` con `dia_semana` y `activo`).
   6. `decidirMarcado(…)` (puro) devuelve el código del criterio 7 o «registrar» con el estado de llegada.
   7. Si registra: `INSERT INTO asistencias … RETURNING`, `UPDATE matriculas SET clases_usadas = clases_usadas + 1,
      actualizado_en = $ahora WHERE … RETURNING clases_usadas, clases_totales`; en el posterior, `UPDATE inasistencias SET
      asistencia_id, cubierta_en WHERE … AND asistencia_id IS NULL` (la falta se bloqueó con `FOR UPDATE` antes del
      `INSERT`) y la auditoría.
   8. La transacción devuelve un valor (registro o rechazo) y **no lanza** el rechazo: así la lectura de la foto va
      después de cerrar.
3. **Después de confirmar:** `leerFotoComoData(academiaId, fotoClave)`; se arma el 201/200 o se lanza el `ErrorNegocio`
   409 con `detalles`.
4. **Choques:** un `23505` sale con `restriccionDeUnicidadViolada`: `asistencias_un_dia_key` → se relee la asistencia
   del día en una transacción corta para armar `detalles.asistenciaDeHoy` (si la relectura falla, el 409 va con
   `asistenciaDeHoy: null`); `asistencias_academia_id_clave_idempotencia_key` → se repite el paso 3 una vez (dos
   peticiones con la misma clave: la segunda responde 200).

**Hora y día.** `ocurrencia(fecha, '18:00', '19:00')` arma `new TZDate(anio, mes − 1, dia, 18, 0, 0, 'America/Lima')`.
`estadoDeLlegada(llegada, inicio, T)`: `PUNTUAL` si `floor(llegada al minuto) <= inicio + T minutos`, es decir,
`llegada < inicio + (T + 1) minutos`. `diaIsoEnLima` usa la misma idea que `cobro.ts` (mediodía de Lima).

**Por qué no se bloquea `clases`:** la asistencia no ocupa ni libera cupo (regla «Cupo de una clase» de 004). El
`INSERT` toma `FOR KEY SHARE` implícito sobre la clase, que espera a un `bloquearClasesParaCupo` en curso sin formar
ciclo (quien bloquea clases ya tomó antes su alumno y su matrícula).

### Faltas (009b, criterios 22 a 27)

- `FaltasTarea` (`@Cron('0 */5 * * * *')` y `onApplicationBootstrap`) llama a `FaltasService.registrarFaltas(
  reloj.ahora())`. Una bandera en memoria evita que dos vueltas del mismo proceso se pisen (si una sigue, la siguiente
  se salta).
- `registrarFaltas`:
  1. `comoPlataforma`: `SELECT id FROM academias WHERE estado = 'ACTIVA' ORDER BY id`. Se cierra.
  2. Por cada academia, `conAcademia` aparte (en serie), dentro de un `try` que registra el error con
     `errorParaRegistro` y sigue:
     1. `SELECT pg_catalog.pg_try_advisory_xact_lock(hashtextextended('faltas:' || $a, 0))`; si es `false`, termina.
     2. Fechas: ayer y hoy de Lima. Para cada una, las ocurrencias con fin ≤ «ahora».
     3. Candidatos (una consulta): alumnos, matrículas y clases que cumplen el criterio 24, con `NOT EXISTS` de
        asistencia y de falta.
     4. `SELECT 1 FROM alumnos WHERE id = ANY($ids) ORDER BY id FOR KEY SHARE`, y
        `SELECT 1 FROM matriculas WHERE id = ANY($ids) ORDER BY id FOR UPDATE`.
     5. `INSERT INTO inasistencias (…) SELECT … WHERE <las mismas condiciones> ON CONFLICT ON CONSTRAINT
        inasistencias_una_por_clase_key DO NOTHING`. En lectura comprometida, esta sentencia ve lo que confirmó el
        registro posterior mientras la tarea esperaba la matrícula (criterio 27).
     6. `info` `'Faltas registradas'` con `academiaId` y `cantidad`.
- **Orden de bloqueos y ciclos:** el marcado y el posterior toman alumno (`FOR SHARE`) → matrícula (`FOR UPDATE`) →
  falta; la tarea, alumnos (`FOR KEY SHARE`) → matrículas (`FOR UPDATE`) → insertar. El cobro de la 007 y el cambio de
  horario de la 010 toman alumno (`FOR UPDATE`) → … → matrícula. Todos van alumno antes que matrícula, así que no hay
  ciclo. `FOR KEY SHARE` explícito en la tarea evita el ciclo que formaría el `FOR KEY SHARE` implícito de la llave
  foránea si se tomara después de la matrícula.
- **Registro técnico:** nunca alumnos, DNI ni nombres; solo academia, cantidades y el tipo del error.

### Consulta del mes (009b, criterio 31)

Una lectura en una transacción sin bloqueos: el alumno (404 si no es de la academia o es `CLIENTE`), la matrícula del mes
(`VIGENTE` o `FINALIZADA`), las asistencias del mes y las faltas sin cubrir, con las horas de cada clase
(`to_char(hora, 'HH24:MI')`). `mes` se valida con zod sobre el parámetro crudo (`parametroCrudo`, para rechazar el
repetido).

### Web

- **009a, `/panel/asistencia`:** `CampoLectora` (un `<input>` enfocado que, con Enter, manda su texto y se vacía),
  `LectorCamara` (`Html5Qrcode` con `start` y `stop` en el efecto; se detiene al desmontar), `BuscarAlumno` (reutiliza
  el buscador de `frontend/src/modulos/alumnos/`) y `ResultadoAsistencia` (verde, rojo o amarillo según `estadoLlegada`
  o `CODIGOS_RECHAZO_ASISTENCIA`). Un `useRef` guarda el último contenido y su hora para el anti-rebote de 5 s. Cada
  envío genera `crypto.randomUUID()`.
- **009b, `/panel/alumnos/{id}`:** `AsistenciaDelMes` (consulta con la clave `['asistencia-mes', nombreCorto,
  usuarioId, alumnoId, mes]`) y `DialogoAsistenciaPosterior`.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Dos entregas, 009a y 009b (DT-1) | Una sola | Dos frentes de ataque distintos; spec cerca de 800 líneas |
| 409 con `detalles` estrictos (DT-2) | 200 con `resultado` | Convención de la API |
| Ventana `[inicio, fin)` y puntualidad por minuto (DT-3) | Milisegundos | La hora mostrada no contradice el estado |
| `FOR SHARE` del alumno al buscar el token (DT-4) | Lectura sin bloqueo | Un token regenerado no marca |
| La matrícula ordena el descuento y las faltas (DT-5) | Bloqueo consultivo por alumno | Ordena también con la tarea y la 010 |
| `tipo_asistencia` con los cuatro valores (DT-6) | Solo `NORMAL` | Sin migración de tipo en 016, 018 y 020 |
| Llave de la clase a `clases` (DT-7) | A `matricula_clases` | 018 y 020 marcan clases fuera de la matrícula |
| `inasistencias` cubiertas, no borradas (DT-8) | Borrar la falta | Evidencia de la corrección |
| Tarea cada 5 min, ayer y hoy, `pg_try_advisory_xact_lock` por academia (DT-9) | Cada minuto; cola de trabajos | Menos carga; varias instancias sin trabajo doble |
| Rechazo devuelto por la transacción, foto después (DT-11) | Leer la foto dentro | Sin E/S de archivos dentro de una transacción |
| Lectora USB como teclado y `html5-qrcode` (DT-12) | Solo cámara | HU-14 nombra la lectora |

## Migraciones

- **`<marca>_asistencias` (009a):** tipos, tabla, llaves compuestas, únicos (`asistencias_un_dia_key` parcial,
  `asistencias_academia_id_clave_idempotencia_key`, `(academia_id, id, alumno_id, fecha)`), índices
  `(academia_id, matricula_id)` y `(academia_id, fecha)`, los tres `CHECK`, `ENABLE` y `FORCE ROW LEVEL SECURITY`,
  políticas `asistencias_leer` y `asistencias_crear`, `GRANT SELECT, INSERT ON asistencias` y
  `GRANT UPDATE (clases_usadas) ON matriculas` a `aquagestion_app`. `asistencias_fecha_de_lima` usa
  `AT TIME ZONE 'America/Lima'`: la base debe tener los datos de zonas horarias (los traen PostgreSQL 16 en Linux, en
  Windows y en la imagen de Docker).
- **`<marca>_inasistencias` (009b):** tabla, llaves, único, `CHECK`, la función y el trigger
  `inasistencias_se_cubre_una_vez` (`SECURITY INVOKER`, `search_path` fijo, `REVOKE ALL … FROM PUBLIC`, como los triggers
  de la 007), RLS con `SELECT`, `INSERT` y `UPDATE`, y `GRANT SELECT, INSERT, UPDATE (asistencia_id, cubierta_en)`.
- Ninguna migración de datos.

## Riesgos

- **Prueba protegida de la 005 que cambia** (`privilegios.test.ts`, `clases_usadas`): el orquestador aprueba el cambio
  antes del commit de pruebas protegidas de la 009a.
- **`html5-qrcode`** pesa unos 300 kB; se carga con `import()` dinámico solo al pulsar «Usar la cámara», para no
  sumar al chunk inicial (deuda TES-2 de la 008).
- **La tarea en el proceso de la API:** con varias instancias corren varias tareas; lo ordena el bloqueo consultivo.
- **Pruebas de concurrencia:** usan la base compartida de la integración; siguen el patrón de espera en `pg_locks` de
  la 007 y la 008b.
