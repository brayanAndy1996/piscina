# 009 · Asistencia y faltas

- **Historias y requerimientos:** HU-14 (la secretaria escanea el QR con la cámara de la PC, una tablet o una lectora;
  check verde con foto, nombre, nivel, clase y «Le quedan 7 de 12»; alerta roja si está vencido o sin clases; amarilla si
  está fuera de su horario o ya marcó; queda la fecha, la hora, el método y el usuario), HU-15 (asistencia manual
  buscando por DNI o nombre, con las mismas validaciones y la marca «Manual»), RN-14 (cada asistencia descuenta una
  clase del plan del mes), RN-15 (sin asistencia con la mensualidad vencida o sin clases), RN-16 (una asistencia por
  alumno y por día, salvo clases particulares), sección 4.2 (proceso de asistencia por QR), 4.5 (sin renovar, al iniciar
  el mes el QR da alerta roja), 2.1 («Registrar asistencia (QR o manual)»: administrador y secretaria; «Ver reportes de
  asistencia»), 9.1 (`ASISTENCIA`, `INASISTENCIA`). D-07 (`tipo` y `estado_llegada` de la asistencia), D-08 (sin
  WhatsApp; se mantiene el registro de faltas al terminar la clase, con sus excepciones), D-11 (puntual hasta la
  tolerancia, 10 minutos configurables), D-16 (solo mientras dura la clase; después, solo la secretaria o el
  administrador, de forma manual y con motivo en auditoría), D-10 y D-25 (`@nestjs/schedule`, `html5-qrcode`), D-23
  (todo por academia), D-29 (el Superadmin no ve alumnos), D-31 (método). De las specs anteriores: DR-6 y DR-7 de 003
  (la espera de la falta la decide la 009; un cambio de tolerancia no cambia lo registrado), DR-4 de 005 (una clase por
  día en cada matrícula), criterio 8 de 005 (`clasesRestantes`: una clase de hoy cuenta si empieza después de «ahora»),
  DR-5 de 004 (no se desactiva una clase con inscritos), criterios 3, 5, 9 y 16 de 008 (`tokenDelContenidoQr`, 404
  iguales, foto en el JSON y búsqueda de alumnos), y la regla DT-5 de 002 (`bloquearActorVigente`).
- **Ruta crítica:** sí. Asistencia (token y no DNI, rechazo vencido o sin clases, una por día, solo durante la clase,
  puntual o tarde, descuento de una clase y registro de faltas), aislamiento entre academias (QR, ids, tarea
  programada) y permisos (solo recepción marca; la consulta del mes lleva datos de menores). La maqueta de las
  pantallas no es crítica.
- **Estado:** aprobada por Bryan el 25/11/2026; 009a en curso. Bryan aceptó la propuesta de las seis preguntas de
  negocio (P1 a P6, que son DR-1 a DR-6 de esta spec, en «Resueltas») y el cambio de privilegio `UPDATE (clases_usadas)`
  en `matriculas`, con su ajuste a la prueba protegida de la 005. El orquestador aceptó DT-1 a DT-16 y la división.
- **División (D-31, aceptada por el orquestador el 25/11/2026):** dos entregas desde esta carpeta, cada una con sus pruebas protegidas, su ataque y su
  PR (ver «División en 009a y 009b»):
  - **009a · Marcado por QR y manual** (primero): criterios 1 a 21 y la parte de `html5-qrcode` del 34.
  - **009b · Faltas, registro posterior y consulta del mes** (siguiente PR, con la 009a unida): criterios 22 a 35.

## Objetivo

Que recepción registre la asistencia en segundos: escanea el QR del carnet (en papel o en el celular) o busca al alumno
por DNI o nombre, y ve en verde, rojo o amarillo si puede entrar, con su foto y las clases que le quedan. Cada asistencia
se marca solo mientras dura la clase del alumno, una por día, como puntual o tarde según la tolerancia de la academia, y
descuenta una clase de su mensualidad. Al terminar cada clase, el sistema registra la falta de quien no vino, para que el
apoderado la vea en el panel (011); si el alumno sí vino y no se marcó, la secretaria o el administrador lo registran
después, con un motivo que queda en auditoría.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Modelo e invariantes (1 y 22):** la base impide dos asistencias el mismo día, una fecha que no es la de Lima, una
  asistencia de otra academia o de otro alumno que el de la matrícula, y una falta cubierta por la asistencia de otro.
- **Lectura del QR y aislamiento (2 a 5, 16, 17 y 26):** un QR de otra academia, regenerado o inventado no marca a
  nadie; el token no sale de su sitio (RN-06, D-23).
- **Validaciones y alertas (6 a 10, 12 y 13):** vencido o sin clases, una por día, solo durante la clase y puntual o
  tarde, con los bordes de America/Lima (RN-15, RN-16, D-11, D-16).
- **Descuento e idempotencia (11, 13 y 14):** un doble clic, un reintento o dos lecturas a la vez nunca descuentan dos
  clases (RN-14).
- **Permisos (6, 30 y 31):** solo el administrador y la secretaria marcan; la consulta del mes es del personal de
  recepción (sección 2.1, D-29).
- **Faltas y registro posterior (23 a 30):** la tarea programada no mezcla academias, no duplica faltas y no deja una
  falta sin cubrir junto a una asistencia; el registro posterior exige motivo y queda en auditoría (D-08, D-16).

No son críticos, pero llevan _(prueba obligatoria)_: 18, 19, 20, 32 y 33. El 21 y el 35 (documentación) y el 34
(dependencias, con la prueba que ya existe) los verifica el revisor.

## División en 009a y 009b

Las dos entregas comparten esta spec, `plan.md` y `tasks.md`; los criterios y las tareas de la 009b llevan la marca
**[009b]**. Los commits de pruebas protegidas llevan la historia sin letra y la entrega después: «Pruebas protegidas
(009): 009a, … (en rojo)».

| Entrega | Críticos (pruebas protegidas y ataque) | Prueba obligatoria | Revisor |
| --- | --- | --- | --- |
| **009a** · marcado por QR y manual | 1 a 17 | 18, 19 y 20 | 21 y 34 (`html5-qrcode`) |
| **009b** · faltas, registro posterior y consulta | 22 a 31 | 32 y 33 | 34 (`@nestjs/schedule`) y 35 |

La 009a deja `asistencias`, el descuento y las pantallas de recepción. La 009b suma la tabla `inasistencias`, la tarea
programada con `@nestjs/schedule`, el registro posterior de D-16 y la consulta del mes. Motivo de la división: la tarea
programada (recorrer academias, bloqueos con otras instancias, recuperación tras una caída) es un frente de ataque propio,
y la spec completa en una sola entrega se acercaría a las 3 rondas con dos superficies distintas.

## Definiciones

- **Alumno:** fila de `alumnos` que no está en `CLIENTE` (definición de la 008). Un `CLIENTE` no tiene QR (RN-05) y por
  id responde 404.
- **Hoy y «ahora»:** «ahora» es `RELOJ.ahora()`, leído **después de tomar los bloqueos** de la transacción (DT-16); hoy
  es `hoyEnLima(ahora)`. Nada depende de la zona del proceso ni de `CURRENT_DATE`.
- **Matrícula del día D:** la matrícula del alumno con `anio` y `mes` del día D, en estado `VIGENTE`, con `fecha_inicio`
  ≤ D ≤ `fecha_fin`. Hay como mucho una (índice `matriculas_alumno_mes_ocupa_cupo_key`).
- **Clase del alumno el día D:** la clase de `matricula_clases` de la matrícula del día D, activa, cuyo `dia_semana` es
  el día ISO de D en Lima (1 lunes … 7 domingo). Hay como mucho una (DR-4 de 005).
- **Ocurrencia:** la clase en la fecha D. Su inicio y su fin son D con `hora_inicio` y `hora_fin` en America/Lima
  (`TZDate` de `@date-fns/tz`), nunca con la zona del servidor.
- **Ventana de la clase:** desde el inicio, incluido, hasta el fin, excluido: `[inicio, fin)` (D-16, DT-3). La clase de
  18:00 a 19:00 admite 18:59:59.999 y no 19:00:00.000.
- **Ocurrencia incluida en la mensualidad:** su inicio es posterior a `matriculas.creado_en`. Es la regla con la que
  `clasesRestantes` contó las clases que se cobraron (criterio 8 de 005): quien se inscribe a las 18:30 no pagó la clase
  de las 18:00 de ese día (DT-14).
- **Clases restantes:** `clases_totales − clases_usadas` de la matrícula.
- **Tolerancia:** `toleranciaTardanzaMinutos` de `leerConfiguracion(tx)` (003), leída dentro de la transacción de la
  operación, sin caché.
- **Estado de llegada:** `PUNTUAL` si la llegada, truncada al minuto, no pasa de inicio + tolerancia; si no, `TARDE`.
  Con 10 minutos y la clase de las 18:00: 18:10:59.999 es puntual y 18:11:00.000 es tarde (DT-3).
- **Pago en verificación del mes:** el alumno no tiene matrícula del día de hoy, pero tiene una matrícula `RESERVADA` del
  mes de hoy con un pago `PENDIENTE_VERIFICACION` (una renovación por Yape de la 010).
- **[009b] Confirmada en:** el `verificado_en` del pago `CONFIRMADO` de la matrícula (hay como mucho uno, índice
  `pagos_un_abierto_por_matricula`). Una matrícula sin pago confirmado no tiene fecha de confirmación.

## Criterios de aceptación

### 009a · Marcado por QR y manual

1. **Tabla `asistencias` e invariantes en la base.** La migración `<marca>_asistencias` crea los tipos
   `metodo_asistencia` (`QR`, `MANUAL`), `tipo_asistencia` (`NORMAL`, `RECUPERACION`, `FUERA_HORARIO`, `PARTICULAR`;
   D-07, DT-6) y `estado_llegada` (`PUNTUAL`, `TARDE`), y la tabla `asistencias` con: `id`, `academia_id`, `alumno_id`,
   `matricula_id`, `clase_id`, `fecha` (`date`), `llegada_en` y `registrado_en` (`timestamptz(3)`), `metodo`, `tipo`
   (por defecto `NORMAL`), `estado_llegada`, `registrado_por`, `registro_posterior` (`boolean`, por defecto `false`),
   `motivo` (`text`, nulo) y `clave_idempotencia` (`uuid`). Llaves compuestas: `(academia_id, matricula_id, alumno_id)`
   → `matriculas (academia_id, id, alumno_id)`; `(academia_id, alumno_id)` → `alumnos`; `(academia_id, clase_id)` →
   `clases`; `(academia_id, registrado_por)` → `usuarios`. Únicos: `(academia_id, id)`, `(academia_id, id, alumno_id,
   fecha)` (para la 009b), `asistencias_un_dia_key` sobre `(academia_id, alumno_id, fecha) WHERE tipo <> 'PARTICULAR'`
   (RN-16) y `asistencias_academia_id_clave_idempotencia_key`. `CHECK` que valen también para el dueño de las tablas:
   `asistencias_fecha_de_lima` (`fecha = (llegada_en AT TIME ZONE 'America/Lima')::date`), `asistencias_registro_despues`
   (`registrado_en >= llegada_en`) y `asistencias_posterior_coherente` (con `registro_posterior`, el método es `MANUAL` y
   hay motivo de 3 a 200 caracteres; sin él, `motivo` es nulo). RLS activada y forzada, con políticas de `SELECT` e
   `INSERT` de la forma de 001; `aquagestion_app` tiene `SELECT` e `INSERT` y nada más. En `matriculas` gana
   `UPDATE (clases_usadas)` (`PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs`). Prueba, como app y como dueño: dos filas
   `NORMAL` del mismo alumno y fecha (23505), la misma clave en la misma academia (23505), una `fecha` que no es la de
   Lima de `llegada_en` (`llegada_en` 2026-12-01 00:30 UTC con `fecha` 2026-12-01: 23514), un posterior sin motivo o un
   motivo sin posterior (23514), una matrícula de otro alumno o un id de otra academia (23503); como app, `UPDATE` y
   `DELETE` de `asistencias` (42501) y `clases_usadas` mayor que `clases_totales` (23514). _(crítico)_ (RN-16, D-07, D-23)
2. **Marcar por QR.** `POST /api/asistencias/qr`, con `@Permiso('REGISTRAR_ASISTENCIA')` y cuerpo
   `registrarAsistenciaQrSchema` (`{ contenido, claveIdempotencia }`, estricto; `contenido` es un texto de como mucho 200
   caracteres), registra la asistencia del alumno del QR si pasa todas las validaciones del criterio 7: una fila con
   `metodo` `QR`, `tipo` `NORMAL`, la matrícula y la clase del día, `fecha` hoy, `llegada_en` y `registrado_en` «ahora»,
   el estado de llegada y `registrado_por` el actor. Responde 201 con `resultadoAsistenciaSchema` (criterio 15).
   _(crítico)_ (HU-14)
3. **Lo que no es un QR de un alumno de la academia responde 404.** El token sale solo de `tokenDelContenidoQr(contenido)`
   (008) y se busca solo por `(academia_id de la sesión, qr_token)`. Un texto vacío, sin el prefijo `AQ1:`, con
   espacios, saltos o minúsculas en el prefijo, con un token de 42 o 44 caracteres, una dirección web, el DNI, el id del
   alumno, el token de seguimiento de su solicitud, el token de un alumno de otra academia y un token ya regenerado
   responden todos el mismo 404 `QR_NO_RECONOCIDO` («El QR no corresponde a ningún alumno de esta academia»), con el
   mismo cuerpo y sin `detalles`. Nada se escribe ni se audita. _(crítico)_ (RN-06, 8.6, D-23)
4. **Un QR regenerado deja de valer al instante.** La búsqueda por token toma la fila del alumno con `FOR SHARE`. Prueba
   determinista (espera comprobada en `pg_locks`): una lectura con el token viejo que espera mientras la regeneración de
   la 008 tiene la fila responde 404 `QR_NO_RECONOCIDO` cuando la regeneración confirma; después, el token viejo da 404
   y el nuevo registra. _(crítico)_ (8.6, criterio 13 de 008)
5. **Marcar de forma manual.** `POST /api/asistencias/manual`, con el mismo permiso y cuerpo
   `registrarAsistenciaManualSchema` (`{ alumnoId, claveIdempotencia }`, estricto), aplica las mismas validaciones, el
   mismo orden y la misma respuesta que el QR, con `metodo` `MANUAL` (HU-15). La secretaria encuentra al alumno con
   `POST /api/alumnos/buscar` (criterio 16 de 008). Un `alumnoId` que no es UUID, que no existe, que es de otra academia o
   que es de un `CLIENTE` responde el mismo 404 `NO_ENCONTRADO` de la 008. _(crítico)_ (HU-15, D-23)
6. **Quién marca.** Las rutas de `/api/asistencias` son del `ADMIN` y la `SECRETARIA` (`REGISTRAR_ASISTENCIA`, sección
   2.1). `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO`; sin sesión o con solo la del Superadmin, 401
   `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con la academia
   suspendida, 403 `ACADEMIA_SUSPENDIDA`. Un cuerpo que no cumple su esquema (campos de más, como `academiaId`; una clave
   que no es UUID; `contenido` que no es texto o pasa de 200) responde 400 `SOLICITUD_INVALIDA` sin escribir. Cada
   transacción llama a `bloquearActorVigente` como primera sentencia, y su 401 gana a cualquier 404 o 409. La academia
   sale siempre de la sesión. _(crítico)_ (sección 2.1, D-29, DT-5 de 002)
7. **Orden de las validaciones y color de cada alerta.** La primera que falla decide; cada rechazo es un 409 con
   `{ codigo, mensaje, detalles }` y `detalles` cumple `rechazoAsistenciaSchema` (criterio 15). Un rechazo no escribe ni
   audita.

   | # | Condición | Respuesta | Alerta |
   | --- | --- | --- | --- |
   | a | Actor que ya no está vigente | 401 `NO_AUTENTICADO` | — |
   | b | QR o alumno (criterios 3 y 5) | 404 | — |
   | c | Clave ya usada (criterio 13) | 200 o 409 `CLAVE_YA_USADA` | — |
   | d | Alumno `INACTIVO` | 409 `ALUMNO_INACTIVO` | `ROJA` |
   | e | Ya tiene una asistencia (no `PARTICULAR`) con fecha de hoy | 409 `ASISTENCIA_YA_REGISTRADA` | `AMARILLA` |
   | f | Sin matrícula del día y con un pago en verificación del mes | 409 `PAGO_EN_VERIFICACION` (DR-3) | `ROJA` |
   | g | Sin matrícula del día | 409 `MENSUALIDAD_NO_VIGENTE` | `ROJA` |
   | h | Clases restantes 0 | 409 `SIN_CLASES_RESTANTES` | `ROJA` |
   | i | Sin clase hoy, o «ahora» fuera de la ventana | 409 `FUERA_DE_HORARIO` | `AMARILLA` |
   | j | Ocurrencia no incluida en la mensualidad | 409 `CLASE_NO_INCLUIDA` | `AMARILLA` |

   Prueba: para cada fila, un alumno que cumple esa condición y todas las de abajo responde ese código (por ejemplo,
   vencido y fuera de horario da `MENSUALIDAD_NO_VIGENTE`; ya marcado hoy y con la última clase usada da
   `ASISTENCIA_YA_REGISTRADA`). _(crítico)_ (HU-14, RN-15, 4.2)
8. **Mensualidad del día con los bordes de Lima.** Con `RELOJ` fijo y el proceso en `TZ=Asia/Tokyo`: un alumno con
   matrícula `VIGENTE` de noviembre y la clase de los lunes de 19:00 a 20:00 marca el lunes 30/11/2026 a las 19:30 de
   Lima (ya es 1/12 en UTC): 201, `fecha` 2026-11-30 y descuento en la matrícula de noviembre. El 1/12 a las 08:00 de
   Lima, sin matrícula de diciembre, responde `MENSUALIDAD_NO_VIGENTE` (4.5). Una matrícula `RESERVADA` (sin pago en
   verificación), `CANCELADA` o `FINALIZADA`, o `VIGENTE` de otro mes, no es la del día. El alumno con estado
   `ALUMNO_VENCIDO` y matrícula del día marca: decide la matrícula, no la columna `estado` (que es de la 010).
   _(crítico)_ (RN-15, RNF-12)
9. **Solo mientras dura la clase.** Con `RELOJ` fijo, para la clase de 18:00 a 19:00 del alumno: 17:59:59.999 responde
   `FUERA_DE_HORARIO` con `detalles.claseDeHoy` `{ horaInicio: '18:00', horaFin: '19:00' }`; 18:00:00.000 y 18:59:59.999
   registran; 19:00:00.000 responde `FUERA_DE_HORARIO`. Para la de 19:00 a 20:00: 19:00:00.000 registra y 20:00:00.000
   no. Un día sin clase suya responde `FUERA_DE_HORARIO` con `claseDeHoy: null`. La clase de otro nivel o de otro
   alumno a la misma hora no cuenta: solo la de su matrícula (la asistencia en otro horario es de la 020, HU-38).
   _(crítico)_ (D-16, HU-14)
10. **Puntual o tarde con la tolerancia de la academia.** La tolerancia se lee con `leerConfiguracion(tx)` en la misma
    transacción. Con 10 minutos: 18:10:59.999 es `PUNTUAL` y 18:11:00.000 es `TARDE`; con 0: 18:00:59.999 `PUNTUAL` y
    18:01:00.000 `TARDE`; con 30: 18:30:59.999 `PUNTUAL`. Un `PATCH /api/configuracion` confirmado vale para la
    siguiente lectura, sin reiniciar; las asistencias ya registradas no cambian (DR-7 de 003). Dos academias con
    tolerancias distintas a la misma hora dan resultados distintos. _(crítico)_ (D-11, D-08)
11. **Cada asistencia descuenta una clase.** En la misma transacción del `INSERT`, `clases_usadas` de la matrícula del
    día sube en 1 (y `actualizado_en`). La respuesta trae `clases: { usadas, totales, restantes }` después del
    descuento. Invariante comprobado en las pruebas: `clases_usadas` es igual al número de asistencias de esa matrícula.
    Si la transacción falla, no queda ni la fila ni el descuento. Un rechazo no descuenta. _(crítico)_ (RN-14)
12. **Una por día.** Una segunda asistencia del mismo alumno con la misma fecha de Lima, por QR o manual, responde 409
    `ASISTENCIA_YA_REGISTRADA` con `detalles.asistenciaDeHoy` (`horaLlegada`, `estadoLlegada` y `metodo` de la primera).
    Dos lecturas a la vez del mismo alumno con claves distintas (prueba determinista): una 201, la otra 409
    `ASISTENCIA_YA_REGISTRADA`, una sola fila y `clases_usadas` sube 1. Si el choque llega por el índice, el 409 sale del
    nombre de la restricción (`asistencias_un_dia_key`, `restriccionDeUnicidadViolada`) después del `ROLLBACK`.
    _(crítico)_ (RN-16)
13. **Idempotencia con la clave.** Si la `claveIdempotencia` ya registró una asistencia de ese mismo alumno en la academia,
    responde 200 con el mismo cuerpo del 201 y `repetida: true`, aunque la clase ya haya terminado, sin otra fila, otro
    descuento ni otra auditoría. Dos peticiones a la vez con la misma clave dejan una fila (una 201 y una 200). La misma
    clave usada con otro alumno, o por el registro posterior de la 009b, responde 409 `CLAVE_YA_USADA`; la misma clave en
    otra academia no choca. La clave de un intento rechazado no queda guardada y se puede volver a usar. _(crítico)_
    (`CLAUDE.md`, escrituras idempotentes)
14. **Orden de bloqueos.** En una sola transacción, en este orden: `bloquearActorVigente`; la fila del alumno con
    `FOR SHARE` (por token o por id); la matrícula del día con `FOR UPDATE`; después se leen «ahora», la configuración,
    las asistencias de hoy y las clases restantes, y al final se insertan la fila y el descuento. No bloquea `clases`
    (la asistencia no mueve cupo). Pruebas deterministas sin `40P01`: una lectura a la vez que la confirmación de un pago
    del mismo alumno (007), que la foto del panel (008b) y que la regeneración del QR (criterio 4). _(crítico)_
    («Orden de bloqueos» de 005a y 006a)
15. **Lo que lleva la respuesta.** `resultadoAsistenciaSchema` (estricto): `asistencia` (`id`, `fecha`, `horaLlegada`
    `HH:MM` de Lima, `llegadaEn` ISO, `estadoLlegada`, `metodo`, `registroPosterior`), `alumno` (`id`, `nombres`,
    `apellidos`, `nivel`, `foto`), `clase` (`id`, `nivel`, `diaSemana`, `horaInicio`, `horaFin`), `clases` (`usadas`,
    `totales`, `restantes`) y `repetida`. `rechazoAsistenciaSchema` (estricto): `alerta` (`ROJA` o `AMARILLA`), `alumno`
    (lo mismo), `claseDeHoy` (`{ horaInicio, horaFin }` o `null`), `asistenciaDeHoy` (`{ horaLlegada, estadoLlegada,
    metodo }` o `null`) y `clases` (o `null` sin matrícula del día). Ninguno lleva DNI, token, contenido del QR, fecha de
    nacimiento, datos médicos, apoderado ni `foto_clave`. `foto` sigue el criterio 9 de 008: `data:image/jpeg;base64,…`
    leído del almacén con la academia de la sesión, **después** de cerrar la transacción; si no se puede leer, `null` y un
    `warn` sin la clave. Prueba: las claves exactas del JSON, para el 201, el 200 repetido y cada código del criterio 7.
    _(crítico)_ (HU-14, Ley 29733)
16. **Aislamiento entre academias.** Con dos academias A y B con el mismo DNI, el mismo nombre y clases a la misma hora:
    el QR de un alumno de B leído con la sesión de A responde 404 y no escribe en ninguna; el `alumnoId` de B, 404; un
    `?academiaId=` no cambia nada. Con la transacción de A, `SELECT` de `asistencias` no devuelve filas de B (RLS). La
    tolerancia y la matrícula salen siempre de la academia de la sesión. El Superadmin no tiene estas rutas. _(crítico)_
    (D-23, D-29)
17. **El token no sale de su sitio.** El contenido del QR y el token nunca aparecen en una dirección, en la respuesta (ni
    en el 404), en la auditoría ni en el registro técnico de ningún nivel; tampoco el DNI. Prueba: el registro técnico
    capturado durante una lectura correcta, una rechazada y una 404 no contiene el token ni el contenido. _(crítico)_
    (RN-06, criterio 17 de 008)
18. **Sin auditoría en el marcado normal; `HEAD` no existe.** El marcado por QR o manual dentro de la clase no escribe en
    `auditoria`: la fila guarda quién, cuándo y cómo (HU-14). `HEAD` sobre `/api/asistencias…` responde 404 como una ruta
    inexistente (se suma `/asistencias` a `PREFIJOS_SIN_HEAD`). _(prueba obligatoria)_
19. **Web de recepción: `/panel/asistencia`.** Solo con `REGISTRAR_ASISTENCIA`; el inicio del panel suma «Asistencia».
    Dos modos:
    - **Escanear:** un campo enfocado que recibe el texto de una lectora QR USB (que escribe como un teclado y termina
      con Enter) y, con «Usar la cámara», la lectura con `html5-qrcode`, que se apaga al salir de la página, al cambiar de
      modo y al desmontar. Sin permiso, sin cámara o fuera de `localhost` o HTTPS, avisa y deja el campo de la lectora.
    - **Buscar alumno:** el buscador de la 008 («DNI o nombre») y, en cada resultado, «Registrar asistencia».

    El resultado ocupa la pantalla: verde con foto (o «Foto pendiente»), nombre, nivel, la clase, «Puntual» o «Tarde» y
    «Le quedan X de Y»; rojo con «No puede ingresar» y el motivo; amarillo con el motivo y el detalle (la clase de hoy,
    o la hora de la asistencia ya registrada). Cada lectura manda una `claveIdempotencia` nueva; el mismo contenido
    leído otra vez en los 5 segundos siguientes se ignora (la cámara lee el mismo QR varias veces, DT-12). Las claves de
    las consultas incluyen la identidad de la sesión. _(prueba obligatoria, componentes con la cámara simulada)_
    (HU-14, HU-15)
20. **Funciones puras del dominio.** `ventanaDeLaClase(fecha, horaInicio, horaFin)`, `estadoDeLlegada(llegada, inicio,
    tolerancia)` y `diaIsoEnLima(fecha)` (en `backend/src/modulos/asistencia/dominio/`) tienen pruebas unitarias con los
    bordes de los criterios 9 y 10, también con el proceso en `TZ=Asia/Tokyo`. _(prueba obligatoria)_
21. **Documentación de la 009a.** `docs/arquitectura.md` («Lo que construye la historia 009a»: tabla, invariantes,
    rutas, orden de validaciones y de bloqueos), la nota de la 009 en `specs/backlog.md` y la guía de Windows (cómo
    probar: crear una clase en el bloque de la hora actual, inscribir, cobrar y escanear; la lectora USB debe estar
    configurada con la distribución de teclado de la PC). _(revisor)_

### 009b · Faltas, registro posterior y consulta del mes

22. **[009b] Tabla `inasistencias` e invariantes.** La migración `<marca>_inasistencias` crea `inasistencias` con `id`,
    `academia_id`, `alumno_id`, `matricula_id`, `clase_id`, `fecha` (`date`), `registrada_en` (`timestamptz(3)`),
    `asistencia_id` (`uuid`, nulo) y `cubierta_en` (`timestamptz(3)`, nulo). Llaves compuestas: `(academia_id,
    matricula_id, alumno_id)` → `matriculas`; `(academia_id, clase_id)` → `clases`; `(academia_id, asistencia_id,
    alumno_id, fecha)` → `asistencias (academia_id, id, alumno_id, fecha)`: una falta solo la cubre una asistencia del
    mismo alumno y del mismo día. Único `inasistencias_una_por_clase_key` sobre `(academia_id, alumno_id, clase_id,
    fecha)`. `CHECK inasistencias_cubierta_coherente`: `asistencia_id` y `cubierta_en` son nulos a la vez o no nulos a la
    vez. El trigger `inasistencias_se_cubre_una_vez` (`BEFORE UPDATE`, por fila) solo deja pasar `asistencia_id` y
    `cubierta_en` de nulos a no nulos; cualquier otro cambio, también un `UPDATE` que no cambia nada sobre una falta ya
    cubierta, responde 23514, como app y como dueño. RLS activada y forzada con políticas de `SELECT`, `INSERT` y
    `UPDATE`; `aquagestion_app` tiene `SELECT`, `INSERT` y `UPDATE (asistencia_id, cubierta_en)`, sin `DELETE`. Prueba:
    cubrir con la asistencia de otro alumno o de otro día (23503), dos faltas de la misma clase y fecha (23505), volver a
    cubrir o descubrir (23514). _(crítico)_ (D-08, 9.1, D-23)
23. **[009b] La tarea programada.** `FaltasService.registrarFaltas(ahora)` se puede llamar directamente (las pruebas lo
    hacen con `RELOJ` fijo); un `@Cron` de `@nestjs/schedule` la llama cada 5 minutos y al arrancar. La lista de
    academias `ACTIVA` se lee con `comoPlataforma`, esa transacción se cierra, y después se abre un `conAcademia` por
    academia, una tras otra (nota O1 de 001). Una academia suspendida no se procesa. En cada academia, la primera
    sentencia es `pg_try_advisory_xact_lock(hashtextextended('faltas:' || academia, 0))`: si otra instancia la tiene, se
    salta esa academia en esta vuelta. Un error en una academia se registra con `errorParaRegistro` y la tarea sigue con
    las demás. Cada academia deja un `info` `'Faltas registradas'` con la academia y la cantidad, sin alumnos ni DNI. La
    variable de entorno `TAREAS_PROGRAMADAS` (`activas` por defecto, `inactivas` en las pruebas; `validarEntorno` rechaza
    otro valor) decide si se programan. Dos llamadas a la vez dejan las mismas faltas una sola vez. _(crítico)_ (D-08,
    D-10, D-25)
24. **[009b] A quién se le registra una falta.** Para cada fecha D entre ayer y hoy (en Lima) y cada ocurrencia cuyo fin
    ya pasó (DR-1: al terminar la clase, sin espera), se registra una falta (`alumno_id`, `matricula_id`,
    `clase_id`, `fecha` D, `registrada_en` «ahora») por cada alumno que cumple todo esto:
    - su matrícula del mes de D está `VIGENTE` o `FINALIZADA` (por si la 010 cerró el mes antes de que la tarea
      procesara su último día), con D entre `fecha_inicio` y `fecha_fin`, y la clase es suya ese día (activa, en
      `matricula_clases`, con el día ISO de D);
    - la ocurrencia está incluida en la mensualidad y su inicio no es anterior a la fecha de confirmación (sin pago
      confirmado no hay falta);
    - no tiene ninguna asistencia (no `PARTICULAR`) con fecha D;
    - le quedan clases (`clases_usadas < clases_totales`) y no está `INACTIVO` (DR-4).

    La falta no descuenta clases (RN-14 descuenta solo asistencias; las no usadas se pierden al cerrar el mes, RN-23).
    Volver a correr la tarea no crea nada nuevo (`ON CONFLICT DO NOTHING` sobre `inasistencias_una_por_clase_key`).
    Las excepciones de D-08 que aún no existen (día de cierre, 017; asistencia autorizada en otro horario, 020;
    recuperación agendada, 018) las suman esas historias. _(crítico)_ (D-08, D-16, RN-14)
25. **[009b] Bordes de la tarea en Lima.** Con `RELOJ` fijo y `TZ=Asia/Tokyo`: la clase del lunes 30/11/2026 de 19:00 a
    20:00 no tiene falta a las 19:59:59.999 y sí a las 20:00:00.000, con `fecha` 2026-11-30 y la matrícula de noviembre;
    una vuelta del 1/12 a las 08:00 que no corrió la noche anterior (servidor apagado) registra las faltas del 30/11; una
    del 2/12 no registra las del 30/11 (fuera de la ventana de ayer y hoy). Quien se inscribió y pagó a las 18:30 no
    tiene falta por la clase de las 18:00 de ese día; quien pagó por Yape hoy no tiene falta por la clase de ayer.
    _(crítico)_ (D-16, RNF-12)
26. **[009b] La tarea no mezcla academias.** Con A y B a la misma hora: las faltas de A solo llevan alumnos, matrículas y
    clases de A, escritas con el contexto de A; con B suspendida, se registran las de A y ninguna de B; un error forzado
    en A no impide las de B. _(crítico)_ (D-23, nota O1 de 001)
27. **[009b] Falta y asistencia nunca quedan juntas sin cubrir.** La tarea toma, en este orden, las filas de los alumnos
    con `FOR KEY SHARE` (ordenadas por id), sus matrículas con `FOR UPDATE` (ordenadas por id) y después inserta con las
    condiciones del criterio 24 evaluadas otra vez. Prueba determinista: un registro posterior (criterio 28) y la tarea
    sobre el mismo alumno y día, en los dos órdenes posibles, terminan sin falta o con la falta cubierta por esa
    asistencia; nunca con una falta sin cubrir y una asistencia del mismo día. Sin `40P01` con un cobro o la confirmación
    de un pago (007) del mismo alumno. _(crítico)_
28. **[009b] Registro posterior (D-16).** `POST /api/asistencias/posterior`, con `REGISTRAR_ASISTENCIA` y cuerpo
    `registrarAsistenciaPosteriorSchema` (`{ alumnoId, fecha, horaLlegada, motivo, claveIdempotencia }`, estricto;
    `fecha` `AAAA-MM-DD`, `horaLlegada` `HH:MM`, motivo de 3 a 200 caracteres visibles), registra la asistencia de una
    clase que ya terminó, con estas reglas (DR-2):
    - `fecha` es del mes en curso de Lima y no es posterior a hoy; si no, 409 `FECHA_NO_PERMITIDA`;
    - el alumno tiene clase ese día y su fin ya pasó; si no tiene clase, 409 `FUERA_DE_HORARIO`; si la clase no terminó,
      409 `CLASE_NO_TERMINADA` (durante la clase se usa el marcado normal);
    - `horaLlegada` está dentro de la ventana de esa clase; si no, 409 `HORA_FUERA_DE_LA_CLASE`;
    - valen d, e, g, h y j del criterio 7 con la fecha D en lugar de hoy (la matrícula del día D, la asistencia de D y la
      ocurrencia de D).

    Inserta la fila con `metodo` `MANUAL`, `registro_posterior` `true`, el motivo, `llegada_en` = D + `horaLlegada` en
    Lima, `registrado_en` «ahora» y el estado de llegada con la tolerancia de hoy; descuenta una clase (criterio 11); si
    hay una falta de esa clase y fecha, la cubre (`asistencia_id`, `cubierta_en`). Orden de bloqueos: actor, alumno
    `FOR SHARE`, matrícula `FOR UPDATE`, la falta `FOR UPDATE` si existe. Responde 201 con `resultadoAsistenciaSchema`
    (`registroPosterior: true`). Idempotente con la clave (criterio 13). _(crítico)_ (D-16)
29. **[009b] Auditoría del registro posterior.** Cada registro posterior escribe una sola entrada
    `ASISTENCIA_POSTERIOR_REGISTRADA` (entidad `asistencia`, `entidadId` el id de la asistencia, actor `USUARIO`, `motivo`,
    IP, `datosDespues: { alumnoId, claseId, fecha, horaLlegada, estadoLlegada, faltaCubierta }`), sin DNI, nombres ni
    datos médicos. Un reintento con la misma clave (200) no audita otra vez; un rechazo no audita. _(crítico)_ (D-16,
    RNF-06)
30. **[009b] Permisos y errores del registro posterior.** Los del criterio 6 (también `ENTRENADOR` y `ALUMNO`, 403) y el
    404 `NO_ENCONTRADO` del criterio 5. Una fecha o una hora con otra forma, o un motivo corto, largo o sin caracteres
    visibles, responde 400 `SOLICITUD_INVALIDA` sin escribir. La prueba de aislamiento del criterio 16 vale también aquí.
    _(crítico)_ (D-16, D-23)
31. **[009b] Consulta del mes de un alumno.** `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM` (por defecto, el mes en
    curso de Lima), con `@Permiso('VER_REPORTES_ASISTENCIA')` y alcance `TODO` (`ADMIN` y `SECRETARIA`); en esta historia
    `ENTRENADOR` (`SUS_CLASES`) y `ALUMNO` (`PROPIO`) reciben 403 `SIN_PERMISO` (sus vistas son de la 012 y la 011). Los
    404 del criterio 5 de 008; un `mes` con otra forma, repetido o fuera de 2000-01 a 9999-12, 400 `SOLICITUD_INVALIDA`.
    Responde 200 con `asistenciaDelMesSchema` (estricto): `mes`, `matricula` (`{ clasesTotales, clasesUsadas,
    clasesRestantes }` de la matrícula `VIGENTE` o `FINALIZADA` de ese mes, o `null`) y `registros`, ordenados por fecha:
    cada asistencia (`tipo: 'ASISTENCIA'`, `fecha`, `clase` con sus horas, `horaLlegada`, `estadoLlegada`, `metodo`,
    `registroPosterior`, `faltaCubierta`) y cada falta sin cubrir (`tipo: 'FALTA'`, `fecha`, `clase`). Una falta cubierta
    aparece solo como su asistencia. Sin DNI ni motivo. No escribe, no bloquea y no audita. Prueba de aislamiento entre
    academias y entre alumnos. _(crítico)_ (sección 2.1, D-08, D-23)
32. **[009b] Web: asistencia del mes y registro posterior.** En `/panel/alumnos/{id}`, la sección «Asistencia» con el mes
    en curso y el anterior: cada día con «Puntual», «Tarde» o «Falta», la hora y «Manual» o «Posterior» cuando
    corresponde, y los totales del mes (puntual, tarde, faltas, clases restantes). «Registrar asistencia posterior» (solo
    en el mes en curso) abre un diálogo con los días de clase ya terminados sin asistencia, la hora de llegada (entre el
    inicio y el fin de esa clase) y el motivo; manda una `claveIdempotencia` nueva por diálogo abierto y refresca al
    terminar. _(prueba obligatoria, componentes)_ (D-16)
33. **[009b] La tarea no corre en las pruebas.** Con `TAREAS_PROGRAMADAS=inactivas`, crear la aplicación no programa
    ninguna tarea (no hay `CronJob` registrados en `SchedulerRegistry`); con `activas`, hay exactamente una, la de las
    faltas. _(prueba obligatoria)_
34. **Dependencias.** `@nestjs/schedule` entra en `backend/package.json` y en `DEPENDENCIAS_BACKEND_PERMITIDAS` (criterio
    127 de 001) en la 009b; `html5-qrcode`, en `frontend/package.json` en la 009a. _(revisor)_
35. **[009b] Documentación de la 009b.** `docs/arquitectura.md` («Lo que construye la historia 009b»: la tabla, la tarea,
    sus bloqueos y la ventana de ayer y hoy, el registro posterior y la consulta; la línea «tareas programadas» de la
    vista general), la guía de Windows (`TAREAS_PROGRAMADAS` en `.env.example`) y la nota de la 009 en
    `specs/backlog.md`. _(revisor)_

## Casos límite

- **Alumno que llega antes de su clase** (17:55 para la de 18:00): amarillo `FUERA_DE_HORARIO` con «Su clase empieza a
  las 18:00»; se vuelve a escanear desde las 18:00 (D-16; DR-5).
- **Clase de 19:00 a 20:00 el último día del mes:** la fecha es la de Lima, aunque en UTC ya sea el día 1 (criterios 8 y
  25).
- **Doble lectura de la cámara:** la web ignora el mismo contenido por 5 segundos; si igual llegan dos lecturas, la
  segunda es `ASISTENCIA_YA_REGISTRADA` en amarillo, sin descontar.
- **Reintento por la red:** misma clave, 200 con `repetida: true` y el mismo resultado verde.
- **QR de otra academia en la que el alumno también estudia (D-28):** 404 en la academia equivocada; cada academia tiene
  su propio token.
- **Regenerar el QR mientras se escanea:** el escaneo con el token viejo responde 404 (criterio 4).
- **Captura del QR compartida con otra persona:** marca al dueño del QR; la secretaria ve la foto en verde (riesgo
  aceptado, como en la 008).
- **Inscrito a mitad de mes:** desde su `fecha_inicio` y solo las clases que se le cobraron (criterio 7 j).
- **Último día con una clase restante:** marca, queda en «Le quedan 0 de 12»; la siguiente clase es rojo
  `SIN_CLASES_RESTANTES` y no tiene falta (DR-4).
- **Mes con más ocurrencias que clases del plan** (13 lunes, miércoles y viernes para 12 clases): la última es rojo sin
  clases y no genera falta.
- **Tolerancia cambiada a media clase:** vale para las siguientes lecturas; lo registrado no cambia (DR-7 de 003).
- **Renovación por Yape aún sin verificar el día 1:** rojo `PAGO_EN_VERIFICACION`; la secretaria verifica en la bandeja
  y vuelve a escanear (DR-3; la renovación es de la 010).
- **Servidor apagado de noche:** al arrancar, la tarea registra las faltas de ayer y de hoy; las más antiguas quedan sin
  registrar (riesgo aceptado).
- **Registro posterior de un día sin falta todavía** (la tarea no corrió): se registra igual; la tarea ya no creará la
  falta.
- **Registro posterior el día 1 de una clase del día anterior:** `FECHA_NO_PERMITIDA` (solo el mes en curso, DR-2).
- **Clase desactivada:** no puede tener inscritos del mes (DR-5 de 004); si una matrícula antigua la tiene, no cuenta
  como clase del día.
- **Alumno `INACTIVO`:** ninguna historia lo produce todavía; rojo y sin faltas.
- **Lectora USB con otra distribución de teclado:** `_` o `-` llegan cambiados y el QR da 404 (riesgo aceptado; la guía
  lo explica).

## Reglas de negocio aplicables

- **RN-14:** cada asistencia descuenta una clase de la matrícula del mes; la falta no descuenta.
- **RN-15:** sin matrícula vigente del día o sin clases restantes, no hay asistencia (alerta roja).
- **RN-16:** una asistencia por alumno y día de Lima, salvo particulares (016).
- **D-16:** solo mientras dura la clase; después, solo la secretaria o el administrador, manual y con motivo en
  auditoría.
- **D-11 y D-08:** puntual hasta la tolerancia configurable y tarde después; se guarda el estado de llegada.
- **D-08:** falta de quien no marcó al terminar la clase, con las excepciones de cierre (017), otro horario autorizado
  (020) y recuperación (018), que suman esas historias. Sin avisos por WhatsApp ni correo.
- **RN-06 y 8.6:** el QR lleva un token aleatorio; uno regenerado deja de valer.
- **Sección 2.1:** marcan el administrador y la secretaria; el entrenador y el alumno, no.
- **D-23 y D-29:** todo por academia; el Superadmin no ve asistencias.

## Contrato

**Esquemas compartidos** (`packages/contratos/src/asistencia.ts`, reexportados en el índice):

- `registrarAsistenciaQrSchema = { contenido: string (≤ 200), claveIdempotencia: uuid }` y
  `registrarAsistenciaManualSchema = { alumnoId: uuid, claveIdempotencia: uuid }` (estrictos).
- **[009b]** `registrarAsistenciaPosteriorSchema = { alumnoId: uuid, fecha: 'AAAA-MM-DD', horaLlegada: 'HH:MM',
  motivo: textoVisibleSchema(3 a 200), claveIdempotencia: uuid }` (estricto).
- `ESTADOS_LLEGADA = ['PUNTUAL', 'TARDE']`, `METODOS_ASISTENCIA = ['QR', 'MANUAL']`, `ALERTAS = ['ROJA', 'AMARILLA']`
  y `CODIGOS_RECHAZO_ASISTENCIA` con su alerta (criterio 7), que la web usa para el color.
- `resultadoAsistenciaSchema` y `rechazoAsistenciaSchema` (criterio 15):
  ```
  resultado: {
    asistencia: { id, fecha: 'AAAA-MM-DD', horaLlegada: 'HH:MM', llegadaEn: ISO, estadoLlegada, metodo, registroPosterior },
    alumno: { id, nombres, apellidos, nivel, foto: 'data:image/jpeg;base64,…' | null },
    clase: { id, nivel, diaSemana: 1..7, horaInicio: 'HH:MM', horaFin: 'HH:MM' },
    clases: { usadas, totales, restantes },
    repetida: boolean
  }
  rechazo (detalles del 409): {
    alerta: 'ROJA' | 'AMARILLA', alumno: { … igual },
    claseDeHoy: { horaInicio, horaFin } | null,
    asistenciaDeHoy: { horaLlegada, estadoLlegada, metodo } | null,
    clases: { usadas, totales, restantes } | null
  }
  ```
- **[009b]** `asistenciaDelMesSchema = { mes: 'AAAA-MM', matricula: { clasesTotales, clasesUsadas, clasesRestantes } |
  null, registros: [ { tipo: 'ASISTENCIA', fecha, clase: { horaInicio, horaFin }, horaLlegada, estadoLlegada, metodo,
  registroPosterior, faltaCubierta } | { tipo: 'FALTA', fecha, clase: { horaInicio, horaFin } } ] }` (estricto).

**Endpoints** (academia siempre de la sesión):

| Método y ruta | Permiso (alcance) | Respuesta |
| --- | --- | --- |
| `POST /api/asistencias/qr` | `REGISTRAR_ASISTENCIA` | 201 / 200 `resultadoAsistenciaSchema` |
| `POST /api/asistencias/manual` | `REGISTRAR_ASISTENCIA` | 201 / 200 `resultadoAsistenciaSchema` |
| `POST /api/asistencias/posterior` **[009b]** | `REGISTRAR_ASISTENCIA` | 201 / 200 `resultadoAsistenciaSchema` |
| `GET /api/alumnos/{id}/asistencias?mes=` **[009b]** | `VER_REPORTES_ASISTENCIA` (`TODO`) | 200 `asistenciaDelMesSchema` |

Errores: 400 `SOLICITUD_INVALIDA`; 401 `NO_AUTENTICADO`; 403 `SIN_PERMISO`, `CAMBIO_DE_CLAVE_OBLIGATORIO`,
`ACADEMIA_SUSPENDIDA`; 404 `QR_NO_RECONOCIDO` y `NO_ENCONTRADO`; 409 `CLAVE_YA_USADA`, `ALUMNO_INACTIVO`,
`ASISTENCIA_YA_REGISTRADA`, `PAGO_EN_VERIFICACION`, `MENSUALIDAD_NO_VIGENTE`, `SIN_CLASES_RESTANTES`,
`FUERA_DE_HORARIO`, `CLASE_NO_INCLUIDA` y, en la 009b, `FECHA_NO_PERMITIDA`, `CLASE_NO_TERMINADA` y
`HORA_FUERA_DE_LA_CLASE`. `HEAD` sobre `/api/asistencias…`: 404.

**Permisos:** sin filas nuevas en la matriz: `REGISTRAR_ASISTENCIA` y `VER_REPORTES_ASISTENCIA` ya existen (002).

**Auditoría:** **[009b]** `ASISTENCIA_POSTERIOR_REGISTRADA` (criterio 29). El marcado normal y las faltas no auditan.

**Tarea programada [009b]:** «Faltas», cada 5 minutos y al arrancar, con `TAREAS_PROGRAMADAS=activas`.

**Eventos y correos:** ninguno (D-08).

## Cambios al modelo de datos

- **009a:** tipos `metodo_asistencia`, `tipo_asistencia` y `estado_llegada`; tabla `asistencias` con sus llaves, únicos,
  `CHECK`, RLS y privilegios (criterio 1); `UPDATE (clases_usadas)` de `matriculas` para `aquagestion_app`.
- **009b:** tabla `inasistencias` con sus llaves, único, `CHECK`, trigger, RLS y privilegios (criterio 22). Sin cambios
  en las demás tablas.
- Sin migración de datos: no hay asistencias previas.

## Fuera de alcance

- **Asistencia de entrenadores** (HU-16, `ASISTENCIA_ENTRENADOR`): Fase 3 (D-02 y backlog; DR-6).
- **Asistencia autorizada en otro horario** (HU-38, RN-30, botón «Autorizar» de la alerta amarilla): 020.
- **Recuperaciones** (HU-35, HU-36) y **días de cierre** (HU-41): 018 y 017, con sus excepciones a la falta.
- **Clases particulares** (tipo `PARTICULAR`): 016.
- **Panel del alumno y del apoderado** con su asistencia (D-08): 011. **Ficha y asistencia para el entrenador:** 012.
- **Reportes de asistencia** R4 a R6 y exportaciones (HU-30): Fase 3.
- **Estados de la mensualidad** (al día, por vencer, vencido), cierre de mes y renovación: 010. La 009 solo lee la
  matrícula del día.
- **Avisos de falta** por WhatsApp (eliminado, D-08) o por correo.
- **Anular o corregir una asistencia ya registrada:** no hay `UPDATE` ni `DELETE`; si hace falta, es otra historia.
- **QR dinámico:** Fase 4.

## Impacto en especificaciones anteriores

- **005 (criterio 2, `privilegios.test.ts`, protegida) y 001 (las pruebas que comparan `PRIVILEGIOS_APP`):**
  `aquagestion_app` gana `UPDATE (clases_usadas)` en `matriculas`. Hay que sumar la columna a `UPDATE_EXACTO` y quitar
  el intento que espera 42501 en `clases_usadas`, con la nota en la cabecera, como hizo la 007 (DT-18 de 007). **Cambio
  a una prueba protegida, aprobado por Bryan el 25/11/2026** (ver «Resueltas»).
- **001 (criterio 127):** `@nestjs/schedule` entra en `DEPENDENCIAS_BACKEND_PERMITIDAS` (009b).
- **008:** `/asistencias` se suma a `PREFIJOS_SIN_HEAD`; la lectura de la foto del carnet (`leerFoto` de
  `carnet.service.ts`) se extrae a una función del módulo `alumnos` para reutilizarla, sin cambiar lo observable del
  carnet.
- **003:** la tolerancia deja de estar «sin usar» en `docs/arquitectura.md`.
- **Vista general de `docs/arquitectura.md`:** la tarea de faltas existe desde la 009b.

## Riesgos aceptados

- **Captura del QR compartida:** marca al dueño del QR; mitiga la foto en la pantalla verde y regenerar (8.6).
- **Lectora USB mal configurada** (distribución de teclado): el QR da 404; la guía lo explica y el modo manual sirve de
  respaldo.
- **Faltas de días anteriores a ayer** no se registran si el servidor estuvo apagado más de un día; la secretaria puede
  registrar la asistencia posterior si el alumno vino.
- **La foto viaja en cada respuesta** (hasta unos 150 KB, como el carnet): una lectura por alumno y por día.
- **La tarea corre cada 5 minutos:** la falta aparece hasta 5 minutos después del fin de la clase.
- **Varias instancias:** el bloqueo consultivo por academia evita el trabajo doble; si una instancia se salta una
  academia, la siguiente vuelta la procesa.
- **El estado de llegada del registro posterior usa la tolerancia de hoy,** no la que había ese día.

## Decisiones

Técnicas: DT-1 a DT-16, aceptadas por el orquestador el 25/11/2026 tal como se propusieron. Las decisiones del
responsable (DR-1 a DR-6) están en «Resueltas».

- **DT-1. Dos entregas (009a y 009b).** Descartado: una sola, con dos frentes de ataque distintos y cerca de las 800
  líneas.
- **DT-2. Los rechazos son 409 con `detalles` validados por `rechazoAsistenciaSchema`.** Descartado: un 200 con
  `resultado: 'RECHAZADA'`, que rompe la convención de la API (409 para un rechazo de negocio).
- **DT-3. Ventana `[inicio, fin)` y puntualidad comparada por minuto** (18:10:59 es puntual con 10 minutos). Así la hora
  que se muestra (`HH:MM`) nunca contradice el estado. Descartado: comparar al milisegundo (18:10:30 se vería «18:10 ·
  Tarde»).
- **DT-4. La búsqueda por token toma `alumnos` con `FOR SHARE`,** para que un token regenerado no marque aunque la
  lectura haya empezado antes (criterio 4). Descartado: leer sin bloqueo.
- **DT-5. La matrícula del día con `FOR UPDATE` es el punto de orden** del descuento, de «una por día» y de las faltas;
  el índice `asistencias_un_dia_key` es el respaldo. Descartado: un bloqueo consultivo por alumno (no ordena con la
  tarea ni con la 010).
- **DT-6. `tipo_asistencia` nace con los cuatro valores de D-07;** la 009 solo escribe `NORMAL`. Evita una migración de
  tipo en 016, 018 y 020.
- **DT-7. La clase apunta a `clases` y no a `matricula_clases`;** que sea de la matrícula lo comprueba la API. Una
  llave a `matricula_clases` impediría las asistencias de recuperación y en otro horario (018 y 020).
- **DT-8. Faltas en su propia tabla (`inasistencias`, 9.1), cubiertas con `asistencia_id`** en lugar de borrarlas: queda
  la evidencia de que la tarea la registró y de que se corrigió. Descartado: un solo registro con estado `FALTA` en
  `asistencias` (rompe «una por día» y el descuento).
- **DT-9. Tarea cada 5 minutos, ventana de ayer y hoy, una transacción por academia con `pg_try_advisory_xact_lock`,**
  y `TAREAS_PROGRAMADAS` para apagarla en las pruebas. Descartado: cada minuto (más transacciones por academia sin
  beneficio) y una cola o tabla de trabajos.
- **DT-10. Sin auditoría del marcado normal ni de las faltas;** sí del registro posterior (D-16). La fila de la
  asistencia ya dice quién, cuándo y cómo.
- **DT-11. La foto va en la respuesta como `data:` JPEG,** leída después de la transacción con la función del carnet.
  Descartado: una segunda petición al carnet (trae también el QR).
- **DT-12. Web con la lectora USB como teclado y la cámara con `html5-qrcode`;** el mismo contenido se ignora por 5
  segundos.
- **DT-13. La consulta del mes es solo del personal (`TODO`) en la 009b;** la 011 y la 012 suman los alcances `PROPIO` y
  `SUS_CLASES`.
- **DT-14. Ocurrencia incluida en la mensualidad = inicio posterior a `matriculas.creado_en`,** la misma regla con la que
  se contaron las clases cobradas (criterio 8 de 005). Descartado: aceptar cualquier ocurrencia desde `fecha_inicio`
  (descontaría una clase que no se cobró).
- **DT-15. Sin cambios en la semilla:** la guía explica cómo probar con una clase en la hora actual.
- **DT-16. «Ahora» se lee después de los bloqueos** (como DT-10 de 007): una lectura que espera un bloqueo y cruza el fin
  de la clase responde `FUERA_DE_HORARIO`.

## Preguntas abiertas

Ninguna. Las seis preguntas de negocio (P1 a P6) quedaron resueltas: ver «Resueltas».

## Resueltas

Decisiones del responsable. Bryan aprobó la propuesta de cada pregunta el 25/11/2026.

- **DR-1 (pregunta P1). Cuándo se registra la falta.** D-08 dice «al terminar la clase, más la tolerancia», pero la
  única tolerancia que existe es la de tardanza, y desde D-16 la asistencia ya no se puede marcar al terminar la clase;
  DR-6 de 003 lo dejó para esta historia. **Decidido (la propuesta):** al terminar la clase, sin espera ni clave nueva;
  la secretaria la corrige con el registro posterior. Alternativa descartada: el fin de la clase más la tolerancia de
  tardanza. _(009b; criterio 24.)_
- **DR-2 (pregunta P2). Registro posterior de D-16.** **Decidido (la propuesta):** solo para días del mes en curso y
  clases ya terminadas; la secretaria escribe la hora a la que llegó el alumno (dentro de su clase) y el sistema calcula
  puntual o tarde; descuenta una clase; si ya había falta, queda «cubierta» y el panel muestra la asistencia.
  Alternativas descartadas: sin límite de fechas, o sin hora (siempre «puntual»). _(009b; criterio 28.)_
- **DR-3 (pregunta P3). Renovación por Yape sin verificar.** **Decidido (la propuesta):** el alumno no entra; alerta roja
  «Pago en verificación», y la secretaria verifica el pago en la bandeja antes de volver a escanear. Alternativa
  descartada: dejarlo entrar y descontar de la matrícula reservada. Solo pasará con la 010. _(009a; criterio 7 f.)_
- **DR-4 (pregunta P4). A quién no se le registra falta.** **Decidido (la propuesta):** a quien ya no tiene clases
  restantes, a un alumno inactivo y por la clase que empezó antes de inscribirse o de confirmarse su pago. Alternativa
  descartada: falta en todos los casos en que tenía la clase. _(009b; criterio 24.)_
- **DR-5 (pregunta P5). Marcar antes de la clase.** **Decidido (la propuesta):** se mantiene D-16; antes de la hora,
  alerta amarilla «Su clase empieza a las 18:00», y se escanea desde esa hora. Alternativa descartada: un margen
  configurable antes del inicio que cuente como puntual. _(009a; criterio 9.)_
- **DR-6 (pregunta P6). Asistencia de los entrenadores (HU-16).** **Decidido (la propuesta):** queda fuera de esta
  historia, en la Fase 3, como dice el backlog (D-02: solo controla la puntualidad, reporte R6), con su propio QR.
  _(«Fuera de alcance».)_
- **Cambio de privilegio aprobado (25/11/2026).** `aquagestion_app` gana `UPDATE (clases_usadas)` en `matriculas`, con
  el ajuste a la prueba protegida de la 005 (`privilegios.test.ts`) descrito en «Impacto en especificaciones
  anteriores». _(009a; criterio 1.)_
