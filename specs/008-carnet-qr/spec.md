# 008 · Carnet digital con QR

- **Historias y requerimientos:** HU-13 (el carnet muestra foto, nombre, DNI, nivel, plan, horario, vigencia y QR; se
  ve en el celular y se descarga o imprime como PDF para el carnet físico; el QR del carnet físico y el del celular es el
  mismo), RN-05 (el carnet y el QR solo con el pago confirmado), RN-06 (el QR lo genera el sistema, es único por alumno,
  es el mismo que se lee en la asistencia y lleva un identificador seguro, no datos personales), sección 8.6 (token
  aleatorio, no el DNI; la secretaria regenera el QR y el anterior queda inválido), 4.1 (el carnet se genera al pasar a
  alumno), 2.1 («Ver carnet digital y QR»: administrador, secretaria y alumno; el entrenador y el cliente, no), 8.7
  (pantallas: «Carnet digital y QR» del alumno, buscador de alumnos de la secretaria) y 9.1 (`ALUMNO.foto`,
  `ALUMNO.qr_token`). D-14 (el panel del alumno es de solo lectura), D-20 y D-24 (foto opcional; «Foto pendiente»; la
  secretaria la agrega después, también con la cámara de la PC), D-21 (`AlmacenArchivos`), D-22 (identidad genérica),
  D-23 (todo por academia), D-29 (el Superadmin no ve alumnos), D-31 (método). De las specs anteriores: criterios 35 a
  37, 61 y 64 de 005 (proceso de la foto), DR-7 a de 005 (la foto del carnet la cubre el consentimiento de datos), DR-18
  de 005 (no se borran fotos de solicitudes no pagadas), DR-21 de 005 (la foto desde el panel y la cámara pasan a la 008),
  criterio 20 de 007 (`confirmarPagoEnTransaccion`) y DR-3 de 007 (el DNI físico se revisa al entregar el carnet), y la
  regla DT-5 de 002 (`bloquearActorVigente`).
- **Ruta crítica:** en parte. Toca cinco puntos de la lista de `CLAUDE.md`: asistencia (el QR lleva un token aleatorio y
  no el DNI; un QR regenerado deja de valer), pagos (el carnet solo con el pago confirmado, RN-05), permisos y datos
  sensibles (DNI y foto, a menudo de menores; el alumno ve solo su carnet; el entrenador y el Superadmin, ninguno),
  aislamiento entre academias (carnet, búsqueda, PDF, foto y token) y archivos (la foto desde el panel sigue el proceso
  crítico de la 005b). La maqueta del carnet y del PDF, la cámara y las pantallas no son críticas.
- **Estado:** aprobada por Bryan el 25/11/2026, con la propuesta de cada pregunta de negocio (P1 a P5, que son DR-1 a
  DR-5 de esta spec, en «Resueltas») y con las técnicas aceptadas por el orquestador tal como se propusieron (DT-1 a
  DT-13, en «Decisiones»; DT-14 a DT-17 son de la 008b, tomadas por el orquestador el 25/11/2026). 008a unida a `main` (PR #16); 008b lista para unir (25/11/2026).
- **División (D-31, aceptada por el orquestador el 25/11/2026):** dos entregas desde esta carpeta, cada una con sus pruebas protegidas, su ataque y su
  PR (ver «División en 008a y 008b»):
  - **008a · Carnet y QR** (primero): criterios 1 a 21.
  - **008b · Foto desde el panel y cámara** (siguiente PR, con la 008a unida): criterios 22 a 29.

## Objetivo

Que cada alumno tenga su carnet digital desde que se confirma su primer pago: en el celular, en su panel, y en PDF para
imprimir el carnet físico, con el mismo QR. El QR lleva solo un token aleatorio que la asistencia (009) leerá; si el
alumno pierde el carnet, la secretaria regenera el QR y el anterior deja de valer. La secretaria y el administrador
buscan a un alumno, ven su carnet, lo imprimen y, desde el panel, le agregan o cambian la foto (con un archivo o con la
cámara de la PC de recepción), también a un cliente con su solicitud en curso. Sin foto, el carnet dice «Foto pendiente».

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Token y modelo (1 a 3, 17):** el QR identifica al alumno en la asistencia; un token adivinable, derivado del DNI,
  repetido, reutilizado o que aparece en registros permite marcar asistencia por otro (P3 de la sección 3.3).
- **Carnet solo con el pago confirmado (1 y 2):** RN-05; un cliente sin pago nunca tiene QR, ni en la base.
- **Permisos, datos y aislamiento (4 a 7, 9, 11 y 16):** el carnet lleva DNI y foto, a menudo de menores (Ley 29733);
  el alumno solo ve el suyo (D-14), el entrenador ninguno (sección 2.1), el Superadmin ninguno (D-29), y nada cruza
  academias (D-23).
- **Mismo QR en pantalla y en PDF (12):** HU-13; si difieren, el carnet impreso no serviría en la asistencia.
- **Regeneración (13 a 15):** el QR anterior deja de valer en la misma transacción; un doble clic no invalida el carnet
  que se acaba de imprimir.
- **Foto desde el panel (22 a 26):** imágenes de personas (a menudo de menores) sin metadatos, en el almacén de su
  academia, sin archivos referenciados que no existan, con los permisos de recepción.

No son críticos, pero llevan _(prueba obligatoria)_: 8, 10, 18 y 27 (integración o unitarias) y 19, 20 y 28 (pruebas de
componentes de la web). El 21 y el 29 (documentación) los verifica el revisor.

## División en 008a y 008b

Las dos entregas comparten esta spec, `plan.md` y `tasks.md`; los criterios y las tareas de la 008b llevan la marca
**[008b]**. Los commits de pruebas protegidas llevan la historia sin letra y la entrega después: «Pruebas protegidas
(008): 008a, … (en rojo)».

| Entrega | Críticos (pruebas protegidas y ataque) | Prueba obligatoria | Revisor |
| --- | --- | --- | --- |
| **008a** · carnet y QR | 1 a 7, 9, 11 a 17 | 8, 10, 18, 19 y 20 | 21 |
| **008b** · foto desde el panel y cámara | 22 a 26 | 27 y 28 | 29 |

La 008a no depende de la 008b: muestra «Foto pendiente» o la foto que ya se subió desde el formulario o el seguimiento
(005b). La 008b no tiene migración.

## Definiciones

- **Alumno (para esta historia):** una fila de `alumnos` cuyo `estado` no es `CLIENTE` (RN-01). Las rutas
  `/api/alumnos/…` y `/api/mi-carnet…` tratan a un `CLIENTE` como inexistente.
- **Token del QR:** 32 bytes de `node:crypto` (`randomBytes`) en base64url sin relleno: 43 caracteres de
  `[A-Za-z0-9_-]`. No se deriva del DNI, del id ni de ningún dato de la persona.
- **Contenido del QR:** el texto `AQ1:` seguido del token (47 caracteres). `PREFIJO_QR = 'AQ1:'`,
  `contenidoQr(token)` y `tokenDelContenidoQr(texto)` (devuelve el token o `null` si el texto no tiene exactamente esa
  forma) viven en `packages/contratos/src/carnet.ts`; la 009 lee el QR con ellas (DT-2).
- **Matrícula del carnet:** de las matrículas del alumno, la `VIGENTE` cuyo período (`fecha_inicio` a `fecha_fin`)
  contiene el día de hoy en Lima (`hoyEnLima(RELOJ.ahora())`); si no hay, la `VIGENTE` o `FINALIZADA` con el mes
  (`anio`, `mes`) más reciente; si tampoco hay, ninguna. Con varias del mismo mes, la de `creado_en` más reciente (DT-12).
- **Vigente hoy:** la matrícula del carnet está `VIGENTE` y hoy en Lima está entre su `fecha_inicio` y su `fecha_fin`,
  ambos incluidos. Los estados de la mensualidad (al día, por vencer, vencido) son de la 010 (HU-11).

## Criterios de aceptación

### 008a · Carnet y QR

1. **Columnas e invariantes del QR en la base.** La migración `<marca>_carnet_qr` agrega a `alumnos`: `qr_token`
   (`text`, nulo), `qr_generado_en` (`timestamptz(3)`, nulo) y `qr_clave_idempotencia` (`uuid`, nulo); el índice único
   `alumnos_academia_id_qr_token_key` sobre (`academia_id`, `qr_token`); y tres `CHECK` que valen también para el dueño
   de las tablas: `alumnos_qr_formato` (`qr_token` nulo o `~ '^[A-Za-z0-9_-]{43}$'`), `alumnos_qr_con_fecha`
   (`qr_token` y `qr_generado_en` son nulos a la vez o no nulos a la vez) y `alumnos_cliente_sin_qr` (un alumno en
   `CLIENTE` no tiene `qr_token`). `aquagestion_app` gana `UPDATE` de esas tres columnas y nada más
   (`PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs`). La migración da un token a cada alumno que ya no está en `CLIENTE`
   (cada uno distinto, con la forma de la definición y al menos 240 bits al azar; DT-3). Prueba: un `UPDATE` o un
   `INSERT` que deja un `CLIENTE` con token, un token de 42 o 44 caracteres, uno con `+`, `/` o `=`, un token sin fecha o
   dos alumnos de la misma academia con el mismo token responden `23514` o `23505`, como app y como dueño; el mismo
   token en dos academias distintas se acepta. _(crítico)_ (RN-05, RN-06, D-23)
2. **El QR nace con el pago confirmado.** En la transacción de `confirmarPagoEnTransaccion` en la que el alumno pasa de
   `CLIENTE` a `ALUMNO_ACTIVO` (paso 5, criterio 20 de 007), la misma sentencia que cambia el estado guarda un token
   nuevo en `qr_token` y «ahora» en `qr_generado_en`. Vale para el cobro en efectivo y para la aprobación de un Yape o
   una transferencia. Si la transacción se revierte (caja cerrada, `DNI_DEL_PERSONAL`, error de la base), el alumno
   sigue en `CLIENTE` sin token. Un reintento del cobro (200, criterio 17 de 007) o la aprobación repetida (criterio 48
   de 007) no cambian el token. Una confirmación de un alumno que ya tiene cuenta (renovación, 010) no toca el token.
   Un cliente `PENDIENTE_PAGO`, `EN_VERIFICACION`, `PAGO_RECHAZADO`, `VENCIDA` o `CANCELADA` no tiene token. _(crítico)_
   (RN-05, HU-04, 4.1)
3. **El token es aleatorio y no lleva datos.** Los tokens de 200 alumnos confirmados en la misma prueba son todos
   distintos, cumplen `^[A-Za-z0-9_-]{43}$`, ninguno contiene el DNI, el id del alumno, el de su usuario ni el código
   de la solicitud, y ninguno es igual al token de seguimiento de su solicitud. `contenidoQr` y `tokenDelContenidoQr`
   son inversas: `tokenDelContenidoQr(contenidoQr(t)) === t`; y `tokenDelContenidoQr` devuelve `null` con un texto
   vacío, sin el prefijo, con `aq1:` en minúsculas, con espacios antes o después, con un token de 42 o 44 caracteres o
   con un carácter fuera de base64url. _(crítico)_ (RN-06, 8.6)
4. **Carnet de un alumno, para el personal.** `GET /api/alumnos/{id}/carnet`, con `@Permiso('VER_CARNET')` y alcance
   `TODO` (`ADMIN` y `SECRETARIA`), responde 200 con `carnetSchema` (estricto, «Contrato»). `ALUMNO` recibe 403
   `SIN_PERMISO`, también con su propio id (su carnet está en `/api/mi-carnet`); `ENTRENADOR`, 403 `SIN_PERMISO`; sin
   sesión, o con solo la sesión del Superadmin, 401 `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403
   `CAMBIO_DE_CLAVE_OBLIGATORIO`. La lectura no escribe, no bloquea y no audita. _(crítico)_ (sección 2.1, D-29)
5. **Lo que no es un alumno de la academia responde 404.** En todas las rutas `/api/alumnos/{id}/…` de esta historia
   (carnet, PDF, regeneración y, en la 008b, foto), un `{id}` que no es UUID, que no existe, que es de otra academia o
   que es de un `CLIENTE` responde el mismo 404 `NO_ENCONTRADO`, con el mismo cuerpo. `?academiaId=` o un
   `academiaId` en el cuerpo no cambian la academia, que sale siempre de la sesión. _(crítico)_ (D-23, RN-05, AT-2 de
   004)
6. **Mi carnet.** `GET /api/mi-carnet`, con `@Permiso('VER_CARNET')` y alcance `PROPIO` (`ALUMNO`), responde 200 con
   `carnetSchema` del alumno cuyo `usuario_id` es el de la sesión, en la academia de la sesión. No recibe ningún id: un
   `?id=`, `?alumnoId=` o un cuerpo se ignoran. `ADMIN` y `SECRETARIA` reciben 403 `SIN_PERMISO`; `ENTRENADOR`, 403;
   sin sesión, 401. Si no hay alumno con ese usuario (o está en `CLIENTE`), 404 `NO_ENCONTRADO`. Un alumno con la
   matrícula vencida también ve su carnet. _(crítico)_ (sección 2.1, D-14)
7. **Lo que lleva y lo que no lleva el carnet.** `carnetSchema` trae: la academia (`nombre`); el alumno (`id`,
   `nombres`, `apellidos`, `dni`, `nivel` y `estado`); `foto` (criterio 9); `matricula` (criterio 8); y `qr`
   (`{ contenido, generadoEn }` o `null`, criterio 10). No lleva fecha de nacimiento, teléfono, correo, dirección,
   colegio, datos médicos, apoderado, consentimientos, `foto_clave`, `usuario_id`, `qr_clave_idempotencia`, el token o
   el código de seguimiento, ni datos de pagos. Prueba: las claves exactas del JSON, para un adulto y para un menor con
   apoderado y ficha médica. _(crítico)_ (HU-13, RN-06, Ley 29733)
8. **Plan, horario y vigencia del carnet.** `matricula` es `null` si no hay matrícula del carnet (definición); si la
   hay: `plan` (nombre actual del plan), `clases` (día de la semana, hora de inicio y de fin de cada clase de la
   matrícula, también si la clase está inactiva, ordenadas por día y hora), `desde` y `hasta` (`fecha_inicio` y
   `fecha_fin`, `AAAA-MM-DD`) y `vigenteHoy` (definición). El día de hoy es el de Lima, con `RELOJ`, aunque el proceso
   corra en otra zona. Pruebas con `RELOJ` (y con `TZ=Asia/Tokyo` en el proceso): una matrícula de noviembre está
   vigente el 30/11 a las 18:59 y a las 19:00 de Lima (ya es 1/12 en UTC) y no el 1/12 a las 00:00 de Lima; ese 1/12,
   sin matrícula de diciembre, el carnet muestra la de noviembre con `vigenteHoy: false`; una matrícula `CANCELADA` o
   `RESERVADA` nunca es la del carnet. _(prueba obligatoria)_ (HU-13, RNF-12)
9. **Foto en el carnet o «Foto pendiente».** Si `alumnos.foto_clave` es nula, `foto` es `null` y la web y el PDF
   muestran «Foto pendiente» (D-24). Si no, `foto` es `data:image/jpeg;base64,…` con los bytes del archivo guardado,
   leído con `AlmacenArchivos.leer` y la academia de la sesión, fuera de toda transacción (DT-6). Si el archivo no se
   puede leer, `foto` es `null` y queda un `warn` `'No se pudo leer la foto del alumno'` con la academia y
   `error: { tipo }`, sin la clave ni la ruta; la respuesta sigue siendo 200. Prueba: una `foto_clave` que apunta a la
   carpeta de otra academia (escrita como dueño) da `foto: null` y no devuelve los bytes de ese archivo. _(crítico)_
   (D-24, D-21, D-23)
10. **Alumno sin QR.** Un alumno que no está en `CLIENTE` y no tiene token (filas escritas fuera de la API, por ejemplo
    en pruebas o datos antiguos) recibe `qr: null`; la web muestra «QR sin generar: pide en recepción que lo generen» y
    el PDF, el mismo texto en lugar del QR. La regeneración (criterio 13) le crea uno. _(prueba obligatoria)_
11. **PDF del carnet.** `GET /api/alumnos/{id}/carnet/pdf` (permisos y errores de los criterios 4 y 5) y
    `GET /api/mi-carnet/pdf` (los del criterio 6) responden 200 con `Content-Type: application/pdf`,
    `Content-Disposition: attachment; filename="carnet.pdf"` y `Cache-Control: no-store`. El nombre del archivo y los
    metadatos del PDF (`Title`, `Author`, `Subject`, `Keywords`) no llevan nombres, DNI ni token. El contenido es el
    mismo de `carnetSchema`, en una hoja A4 con la tarjeta de 85,6 × 54 mm y línea de corte (DR-1), con todos los datos
    de HU-13 al día de la descarga (DR-2): nombre de la academia, foto o «Foto pendiente», nombres y apellidos, DNI
    completo (DR-3), nivel, plan, horario, vigencia, QR y «Datos al dd/mm/aaaa» (fecha de Lima). Todo texto que sale de los datos pasa por `textoParaPdf` (006b). Los datos se leen en
    una transacción corta que termina antes de dibujar; si el generador falla, 500 `ERROR_INTERNO` y nada cambia. Las
    rutas de PDF de una academia nunca devuelven el carnet de otra (criterio 5). _(crítico en permisos, errores y
    aislamiento; el dibujo es prueba obligatoria)_ (HU-13)
12. **El mismo QR en pantalla y en PDF.** El generador del PDF es inyectable (`GENERADOR_PDF_CARNET`, como el de 006b)
    y recibe `contenidoQr` del token guardado: el mismo `qr.contenido` que devuelve el carnet en ese momento. La web
    dibuja el QR desde `qr.contenido` y el PDF desde el mismo texto, los dos con `qrcode` y las mismas opciones
    (`OPCIONES_QR`, DT-5). Prueba de integración: con el generador reemplazado, el contenido que recibe es
    `AQ1:` + `alumnos.qr_token`, igual a `qr.contenido` de `GET …/carnet`; después de regenerar, los dos cambian juntos.
    Prueba unitaria del generador real: el PDF contiene una imagen y no contiene el texto del token (el token solo va
    dentro del QR). _(crítico)_ (HU-13, RN-06)
13. **Regenerar el QR.** `POST /api/alumnos/{id}/carnet/qr`, con `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y
    `SECRETARIA`, DT-4) y cuerpo `regenerarQrSchema` (`{ claveIdempotencia, motivo }`, estricto; motivo de 3 a 200
    caracteres visibles), en una sola transacción y en este orden: `bloquearActorVigente`, la fila del alumno con
    `FOR UPDATE`, un token nuevo distinto del anterior, `qr_token`, `qr_generado_en` («ahora»),
    `qr_clave_idempotencia` y `actualizado_en`, y la auditoría `CARNET_QR_REGENERADO` (entidad `alumno`, `entidadId`
    el id del alumno, actor `USUARIO`, `motivo`, IP, `datosAntes: { qrGeneradoEn }` y `datosDespues: { qrGeneradoEn }`,
    con `null` si no tenía QR). Responde 200 con `carnetSchema`. Después de confirmar, ninguna fila de ninguna academia
    tiene el token anterior; `GET …/carnet`, `GET /api/mi-carnet` y los PDF dan el nuevo. Sin correo (DR-5).
    _(crítico)_ (8.6, RNF-06)
14. **Regenerar es idempotente.** Con la misma `claveIdempotencia` que la última regeneración de ese alumno, responde
    200 con el carnet actual sin cambiar el token ni auditar (un doble clic no deja inservible el carnet recién
    impreso). Dos peticiones a la vez con la misma clave dejan un solo cambio de token y una sola auditoría. Con claves
    distintas, cada una regenera y audita, una después de la otra. La misma clave usada antes con otro alumno no cuenta.
    _(crítico)_
15. **Quién no regenera.** `ALUMNO` (también sobre sí mismo, D-14) y `ENTRENADOR` reciben 403 `SIN_PERMISO`; sin
    sesión, 401. El 404 del criterio 5 sale después de `bloquearActorVigente`, y el 401 de un actor que ya no está
    vigente gana a ese 404. Un cuerpo con campos de más, sin motivo o con una clave que no es UUID responde 400
    `SOLICITUD_INVALIDA` sin escribir. Ningún rechazo cambia el token ni audita. _(crítico)_ (D-14, DT-5 de 002)
16. **Buscar alumnos.** `POST /api/alumnos/buscar`, con `@Permiso('VER_CARNET')` y alcance `TODO` (`ALUMNO`, 403), y
    cuerpo `buscarAlumnosSchema` (`{ texto }`, estricto, recortado, de 3 a 60 caracteres visibles). Si `texto` son
    exactamente 8 dígitos, busca ese DNI exacto; si no, busca `texto` dentro de «nombres apellidos» y de «apellidos
    nombres», sin distinguir mayúsculas (sí las tildes, DT-8), con `%`, `_` y `\` como caracteres literales. Solo
    alumnos (no `CLIENTE`) de la academia de la sesión. Responde 200 con `{ alumnos, hayMas }`: como mucho 20, ordenados
    por apellidos, nombres e id, cada uno con `id`, `nombres`, `apellidos`, `dni`, `estado`, `nivel` y `tieneFoto`
    (estricto, nada más); `hayMas` es `true` si había más de 20. No escribe ni audita, y el texto buscado no va al
    registro técnico. Prueba: el mismo nombre y el mismo DNI en la academia B no aparecen desde A; un `CLIENTE` con ese
    DNI no aparece; `%` no devuelve a todos. _(crítico)_ (sección 2.1 y 8.7, D-23, regla «Un DNI se busca con `POST`» de
    002)
17. **El token no sale de su sitio.** El token y el contenido del QR solo viajan en el cuerpo de las respuestas de
    `carnetSchema` (criterios 4, 6 y 13) y dentro del PDF. Nunca aparecen en una dirección de la API o de la web, en la
    auditoría (ninguna acción, tampoco `PAGO_REGISTRADO`, `PAGO_APROBADO`, `USUARIO_CREADO` ni `CARNET_QR_REGENERADO`),
    en el registro técnico (ningún nivel), en un correo ni en la vista de seguimiento de la 005. Con la transacción de la
    academia A, buscar en `alumnos` por un `qr_token` de B no devuelve filas (RLS). _(crítico)_ (RN-06, D-23)
18. **`HEAD` no existe en las rutas nuevas.** `HEAD` sobre `/api/alumnos/…` y `/api/mi-carnet…` responde 404 como una
    ruta inexistente, sin leer la base ni generar el PDF (se suman a `PREFIJOS_SIN_HEAD`, como DT-9 de 006).
    _(prueba obligatoria)_
19. **Web del personal.** `/panel/alumnos` (solo con `VER_CARNET` de alcance `TODO`): un campo «Buscar por DNI o
    nombre», la lista de resultados (nombre, DNI, nivel, estado y si tiene foto) y el aviso «Hay más resultados; escribe
    más letras» si `hayMas`. `/panel/alumnos/{id}` muestra el carnet (criterio 7, con «Foto pendiente» y «QR sin
    generar» cuando corresponde), «Descargar PDF» y «Regenerar QR», que abre un diálogo con el motivo y el aviso «El
    carnet impreso y el QR del celular dejarán de servir; habrá que imprimir uno nuevo», manda una `claveIdempotencia`
    nueva por diálogo abierto y refresca el carnet al terminar. El inicio del panel suma «Alumnos y carnets». Las claves
    de las consultas incluyen la identidad de la sesión. El texto buscado no va en la dirección. _(prueba obligatoria,
    componentes)_
20. **Web del alumno.** `/panel/mi-carnet` (solo `ALUMNO`) muestra su carnet con el QR grande, legible en el celular, y
    «Descargar PDF»; no tiene acciones de edición, foto ni regeneración (D-14). El inicio del panel del alumno muestra
    «Mi carnet» y ya no el aviso «Por ahora no hay más opciones». El personal no ve «Mi carnet», y el alumno no ve
    «Alumnos y carnets» (se filtra por el alcance de `VER_CARNET`, DT-4). _(prueba obligatoria, componentes)_
21. **Documentación de la 008a.** `docs/arquitectura.md` («Lo que construye la historia 008a»: columnas e invariantes,
    generación al confirmar, rutas, permisos, `PREFIJO_QR` y cómo buscará la 009 por token), la nota de la 008 en
    `specs/backlog.md` y la guía de Windows (cómo ver un carnet: cobrar `AQ-SM0001` en recepción y buscar al alumno).
    _(revisor)_

### 008b · Foto desde el panel y cámara

22. **[008b] Foto de un alumno desde el panel.** `PUT /api/alumnos/{id}/foto`, con
    `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y `SECRETARIA`) y la imagen como cuerpo binario
    (`Content-Type` `image/jpeg` o `image/png`), responde 204 sin cuerpo y con `Cache-Control: no-store` para cualquier
    alumno de la academia (no `CLIENTE`), en cualquier estado. Los 404 son los del criterio 5. La foto nueva reemplaza a
    la anterior, y el carnet la muestra desde ese momento. _(crítico)_ (D-20, D-24, DR-21 de 005)
23. **[008b] Foto de una solicitud desde el panel.** `PUT /api/solicitudes/{id}/foto`, con el mismo permiso, cuerpo y
    respuesta, guarda la foto del alumno de esa solicitud si su estado visible es `PENDIENTE_PAGO`, `EN_VERIFICACION` o
    `PAGO_RECHAZADO` (con la regla de editable de la foto pública: fila `PENDIENTE_PAGO`, alumno en `CLIENTE`, solicitud
    vigente; criterio 34 f de 005) o `CONFIRMADA` (el alumno ya no es `CLIENTE`). Responde 409 `SOLICITUD_NO_EDITABLE`
    (cuerpo `{ codigo, mensaje }`) si está `VENCIDA` (también en el instante del vencimiento, con el tope del fin de mes)
    o `CANCELADA`, o si es la fila anterior de un cliente que volvió (criterio 21 b de 005); y 404 `NO_ENCONTRADO` con un
    id que no es UUID, que no existe o de otra academia. _(crítico)_ (DR-21 de 005)
24. **[008b] Orden de las comprobaciones de la foto del panel.** La primera que falla decide: (a) sesión, 401
    `NO_AUTENTICADO`; (b) academia suspendida, 403 `ACADEMIA_SUSPENDIDA`; (c) cambio de contraseña pendiente, 403;
    (d) permiso, 403 `SIN_PERMISO` (`ALUMNO`, `ENTRENADOR`); (e) tipo y codificación, 400 `IMAGEN_NO_VALIDA` (las reglas
    del criterio 34 b de 005); (f) tamaño, 413 `CARGA_EXCESIVA` (más de `FOTO_TAMANO_MAXIMO`; exactamente 5 242 880
    bytes sigue); (g) actor vigente, 401; (h) el 404 de los criterios 5 o 23; (i) el 409 del criterio 23; (j) la
    imagen, 400 `IMAGEN_NO_VALIDA` (criterio 34 g de 005: firma, decodificación, lados de 100 a 8000 y 40 megapíxeles).
    Con (a) a (d) la API responde sin leer el cuerpo: una petición que declara 5 MB y no los envía recibe su 401 o 403
    sin esperar. Estas rutas no cuentan en los límites por conexión de las rutas públicas (`LIMITES_PUBLICOS`). Ningún
    rechazo cambia `foto_clave`, deja un archivo nuevo en el almacén ni audita. _(crítico)_ (sección 2.1, criterio 34
    de 005, criterios 74 y 75 de 001)
25. **[008b] El mismo proceso de la 005b.** Primero, una transacción corta comprueba (g) a (i) del criterio 24
    (`bloquearActorVigente` y la lectura del alumno o la solicitud), sin tocar archivos. Después, fuera de toda
    transacción, la imagen aceptada se recodifica con `recodificarImagen` (JPEG de como mucho
    `FOTO_LADO_GUARDADO` píxeles, orientación aplicada, sin EXIF, GPS, XMP, ICC ni comentarios; criterio 35 de 005) y se
    guarda **antes** de la transacción con una clave nueva `academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`
    (criterio 36 de 005). Luego, la transacción de escritura, en este orden: `bloquearActorVigente`; `alumnos` `FOR UPDATE`; en la ruta de la
    solicitud, `solicitudes_inscripcion` `FOR UPDATE` y se repite la comprobación del criterio 23 (409 y se borra el
    archivo nuevo si ya no se admite); se lee la clave anterior y se guardan `foto_clave` y `actualizado_en`; la
    auditoría del criterio 27. **Después de confirmar** se borra el archivo anterior. Un fallo de `guardar` responde 500
    sin cambiar la base; un rechazo propio de la transacción (401, 404 o 409) borra el archivo nuevo; cualquier otro
    error sigue la confirmación incierta de los criterios 61 y 64 de 005 (relectura de `foto_clave` con `FOR SHARE` y
    espera máxima de 5 s antes de borrar nada). Un borrado que falla deja el `warn` `'No se pudo borrar un archivo'`
    con `error: { tipo }`, y la respuesta sigue siendo 204. Invariante: después de cualquier subida, `foto_clave` es
    nula o apunta a un archivo que existe en la carpeta de su academia. _(crítico)_ (D-21, D-23, RNF-05)
26. **[008b] Subidas a la vez.** Pruebas deterministas (espera comprobada en `pg_locks`): (a) una subida del panel y
    una del enlace de seguimiento (005b) del mismo cliente a la vez responden 204 las dos, y en la carpeta del alumno
    queda exactamente un archivo, el de `foto_clave`; (b) dos subidas del panel a la vez, ídem; (c) una subida a una
    solicitud que se cancela mientras espera la fila del alumno responde 409 y no deja archivo nuevo; (d) una subida
    a un cliente cuyo pago se confirma mientras espera (pasa a `CONFIRMADA`) responde 204 y el alumno queda con su foto
    y su QR. _(crítico)_
27. **[008b] Auditoría de la foto del panel.** Cada subida correcta del panel audita una sola entrada
    `ALUMNO_FOTO_ACTUALIZADA` (entidad `alumno`, `entidadId` el id del alumno, actor `USUARIO`, IP,
    `datosAntes: { tieneFoto }`, `datosDespues: { tieneFoto: true }` y `origen`: `'PANEL_ALUMNO'` o
    `'PANEL_SOLICITUD'`), sin la imagen, la clave, el DNI ni datos médicos (DT-10). Además, un `info` `'Foto del alumno
    guardada'` con la academia. La subida pública de la 005b no cambia: sigue sin auditar (criterio 37 de 005).
    _(prueba obligatoria)_
28. **[008b] Web: foto con archivo o con la cámara.** En `/panel/alumnos/{id}` («Cambiar foto» o «Agregar foto») y en
    las tarjetas de `/panel/solicitudes` activas y confirmadas («Agregar foto»), un diálogo con dos opciones: «Elegir un
    archivo» (`CampoFoto`, con sus avisos de tipo y peso) y «Usar la cámara»: pide la cámara con
    `navigator.mediaDevices.getUserMedia`, muestra la vista en vivo, «Tomar foto» la congela en un `canvas` y la
    convierte en JPEG, con «Volver a tomar» y «Usar esta foto». Al cerrar el diálogo, al cambiar de página o al
    desmontar, la cámara se apaga (se detienen todas sus pistas). Sin permiso, sin cámara o fuera de un contexto seguro
    (`localhost` o HTTPS), avisa «No se pudo usar la cámara. Revisa el permiso del navegador o elige un archivo» y deja
    la opción del archivo. Tras el 204, refresca el carnet o la lista. _(prueba obligatoria, componentes con la cámara
    simulada)_ (D-20)
29. **[008b] Documentación de la 008b.** `docs/arquitectura.md` («Lo que construye la historia 008b»: las dos rutas, el
    orden, la auditoría, la función común de la foto y la regla «Para la 008» cumplida; la nota «Foto desde recepción»
    de la 005b, actualizada), la guía de Windows (la cámara exige `localhost` o HTTPS) y la nota de la 008 en
    `specs/backlog.md`. _(revisor)_

## Casos límite

- **Cobro a las 19:00 de Lima del último día del mes:** el QR nace igual (criterio 2); la vigencia usa el día de Lima
  (criterio 8).
- **Yape aprobado de un mes ya terminado (DR-2 de 007):** el alumno recibe su QR; su carnet muestra la matrícula de ese
  mes con `vigenteHoy: false`.
- **Alumno con una solicitud vieja `VENCIDA` y otra `CONFIRMADA`:** el carnet es del alumno, no de la solicitud; la foto
  por la solicitud vencida responde 409, por la confirmada o por `/api/alumnos/{id}/foto`, 204.
- **Doble clic en «Regenerar QR»:** misma clave, un solo cambio (criterio 14). Dos personas que regeneran a la vez con
  claves distintas: dos cambios en orden, dos auditorías; vale el último.
- **Regenerar mientras la 010 confirma una renovación:** las dos toman la fila del alumno en orden; la renovación no
  toca el token.
- **Plan renombrado después de inscribirse:** el carnet muestra el nombre de hoy (como PQ10 de 006). Clase desactivada
  de la matrícula: se sigue mostrando.
- **Nombres con emojis, comillas curvas o texto bidireccional:** la pantalla los muestra; el PDF los escribe como `?`
  (`textoParaPdf`). Nombres largos: el PDF los corta en dos líneas con «…» sin salirse de la tarjeta.
- **Foto que falta en el almacén** (borrada a mano): carnet con `foto: null` y `warn` (criterio 9).
- **Alumno `INACTIVO`:** ninguna historia lo produce todavía; el carnet se muestra igual (ver «Fuera de alcance»).
- **El alumno cambió su contraseña inicial o no:** con el cambio pendiente, `/api/mi-carnet` responde 403
  `CAMBIO_DE_CLAVE_OBLIGATORIO` hasta cambiarla (002).
- **Cámara de la PC ocupada por otra aplicación o con permiso denegado:** aviso y opción del archivo (criterio 28).
- **Una foto tomada con la cámara de 1920 × 1080:** pasa los límites (lados de 100 a 8000) y se guarda a 800 × 450.
- **Un QR de otra academia o regenerado:** no corresponde a ningún alumno de la academia de la sesión; lo decide la
  009 con `tokenDelContenidoQr` y una búsqueda por `(academia_id, qr_token)`.

## Reglas de negocio aplicables

- **RN-05:** sin pago confirmado no hay QR ni carnet; la base lo garantiza (`alumnos_cliente_sin_qr`).
- **RN-06 y 8.6:** el QR lleva solo un token aleatorio, único por alumno dentro de la academia; regenerarlo invalida el
  anterior; es el mismo que leerá la asistencia (009).
- **HU-13:** el carnet muestra foto, nombre, DNI, nivel, plan, horario, vigencia y QR; en pantalla y en PDF, con el
  mismo QR.
- **D-24 y D-20:** sin foto, «Foto pendiente»; la secretaria la agrega después, con archivo o con la cámara.
- **D-14:** el alumno solo consulta su carnet; no cambia su foto ni regenera su QR.
- **Sección 2.1:** «Ver carnet digital y QR» es del administrador, la secretaria y el alumno (el suyo).
- **D-29:** el Superadmin no ve alumnos ni carnets.
- **DR-7 a de 005:** la foto del carnet la cubre el consentimiento de tratamiento de datos.
- **DR-18 de 005:** ninguna historia borra la foto de una solicitud no pagada; la 008b solo reemplaza fotos.

## Contrato

**Esquemas compartidos** (`packages/contratos/src/carnet.ts`, reexportados en el índice):

- `PREFIJO_QR = 'AQ1:'`, `PATRON_TOKEN_QR = /^[A-Za-z0-9_-]{43}$/`, `contenidoQr(token)`, `tokenDelContenidoQr(texto)`
  y `OPCIONES_QR` (`{ errorCorrectionLevel: 'M', margin: 4 }`).
- `carnetSchema` (estricto):
  ```
  {
    academia: { nombre: string },
    alumno: { id: uuid, nombres, apellidos, dni, nivel: 'BASICO'|'INTERMEDIO'|'AVANZADO',
              estado: 'ALUMNO_ACTIVO'|'ALUMNO_VENCIDO'|'INACTIVO' },
    foto: string /* data:image/jpeg;base64,… */ | null,
    matricula: { plan: string, clases: [{ diaSemana: 1..7, horaInicio: 'HH:MM', horaFin: 'HH:MM' }],
                 desde: 'AAAA-MM-DD', hasta: 'AAAA-MM-DD', vigenteHoy: boolean } | null,
    qr: { contenido: string /* AQ1:… */, generadoEn: string /* ISO */ } | null
  }
  ```
- `regenerarQrSchema = { claveIdempotencia: uuid, motivo: textoVisibleSchema(3 a 200) }` (estricto).
- `buscarAlumnosSchema = { texto: textoVisibleSchema(3 a 60) }` (estricto) y `resultadoBusquedaAlumnosSchema =
  { alumnos: [{ id, nombres, apellidos, dni, estado, nivel, tieneFoto }], hayMas: boolean }` (estrictos).
- `resumenDeHorario(clases)`: texto corto del horario («Mar, Mié y Jue · 18:00 a 19:00»), que usan la web y el PDF.

**Endpoints** (todos con la academia de la sesión; ninguno la recibe en la dirección, la consulta o el cuerpo):

| Método y ruta | Permiso (alcance) | Respuesta |
| --- | --- | --- |
| `POST /api/alumnos/buscar` | `VER_CARNET` (`TODO`) | 200 `resultadoBusquedaAlumnosSchema` |
| `GET /api/alumnos/{id}/carnet` | `VER_CARNET` (`TODO`) | 200 `carnetSchema` |
| `GET /api/alumnos/{id}/carnet/pdf` | `VER_CARNET` (`TODO`) | 200 `application/pdf` |
| `POST /api/alumnos/{id}/carnet/qr` | `REGISTRAR_INSCRIPCION_Y_COBRO` | 200 `carnetSchema` |
| `GET /api/mi-carnet` | `VER_CARNET` (`PROPIO`) | 200 `carnetSchema` |
| `GET /api/mi-carnet/pdf` | `VER_CARNET` (`PROPIO`) | 200 `application/pdf` |
| `PUT /api/alumnos/{id}/foto` **[008b]** | `REGISTRAR_INSCRIPCION_Y_COBRO` | 204 |
| `PUT /api/solicitudes/{id}/foto` **[008b]** | `REGISTRAR_INSCRIPCION_Y_COBRO` | 204 |

Errores: 401 `NO_AUTENTICADO`, 403 `SIN_PERMISO`, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`, 403 `ACADEMIA_SUSPENDIDA`, 404
`NO_ENCONTRADO`, 400 `SOLICITUD_INVALIDA`, y en la 008b 400 `IMAGEN_NO_VALIDA`, 413 `CARGA_EXCESIVA` y 409
`SOLICITUD_NO_EDITABLE`. `HEAD` sobre `/api/alumnos…` y `/api/mi-carnet…`: 404.

**Auditoría:** `CARNET_QR_REGENERADO` (criterio 13) y **[008b]** `ALUMNO_FOTO_ACTUALIZADA` (criterio 27). Ninguna lleva
el token, el contenido del QR, la imagen ni la clave del archivo.

**Eventos y correos:** ninguno (DR-5).

**Interfaces del backend** (`backend/src/modulos/alumnos/index.ts`):

- `nuevoTokenQr(): string` (dominio, puro salvo el azar de `node:crypto`), que usa `confirmarPagoEnTransaccion`.
- `GENERADOR_PDF_CARNET` (token de Nest; `{ generar(datos): Promise<Buffer> }`).
- **[008b]** La función común de la foto (`reemplazarFotoDelAlumno`, en `inscripciones/`), que usan la foto pública
  (005b) y las dos rutas del panel (DT-10).

## Cambios al modelo de datos

- `alumnos`: `qr_token text NULL`, `qr_generado_en timestamptz(3) NULL`, `qr_clave_idempotencia uuid NULL`; índice único
  `alumnos_academia_id_qr_token_key (academia_id, qr_token)`; `CHECK` `alumnos_qr_formato`, `alumnos_qr_con_fecha` y
  `alumnos_cliente_sin_qr` (criterio 1). La RLS de `alumnos` no cambia.
- Privilegios de `aquagestion_app`: `UPDATE (qr_token, qr_generado_en, qr_clave_idempotencia)` en `alumnos`.
- Migración de datos: un token para cada alumno que no está en `CLIENTE` (DT-3).
- La 008b no tiene migración.

## Fuera de alcance

- **Leer el QR y marcar asistencia:** 009 (HU-14). La 008 deja el token, el prefijo y la búsqueda por
  `(academia_id, qr_token)`.
- **QR dinámico en el celular:** Fase 4 (8.6, mejora opcional).
- **QR del entrenador** (9.1 `ENTRENADOR.qr_token`, HU-16): Fase 3 (D-02).
- **Estados de la mensualidad** (al día, por vencer, vencido) y el cierre de mes: 010. El carnet solo muestra fechas.
- **El resto del panel del alumno** (asistencia, nivel, clases restantes): 011.
- **Quitar una foto sin poner otra**, y la política de retención y borrado de fotos (pendiente antes de producción,
  DR-18 de 005).
- **La cámara en el formulario público** (paso de la foto de «Nueva inscripción»): sigue con el selector de archivo; la
  secretaria puede agregar la foto desde el panel justo después (criterio 23).
- **Mostrar en el panel de solicitudes si el cliente ya tiene foto:** `solicitudPanelSchema` es estricto y protegido
  (criterio 38 de 005); no se amplía.
- **Qué pasa con el carnet de un alumno `INACTIVO`:** lo decide la historia que produzca ese estado.
- **Límite general de peticiones de la API con sesión** (DT-14 de 006): sigue pendiente antes de producción.

## Impacto en especificaciones anteriores

- **007 (criterio 20, `confirmarPagoEnTransaccion`):** el paso 5 también guarda el token y su fecha (criterio 2). Las
  pruebas protegidas de la 007 no cambian: comparan con `toMatchObject` y no leen las columnas nuevas.
- **005 (criterio 37 y «Foto desde recepción» de la 005b):** **[008b]** la lógica de guardar y reemplazar la foto se
  extrae a una función común sin cambiar lo observable de la ruta pública (sus pruebas protegidas siguen igual); el
  panel ya tiene «Agregar foto».
- **002 (criterio 26, matriz):** no cambia; no se suma ninguna fila (DT-4).
- **006b (`PREFIJOS_SIN_HEAD`, `textoParaPdf`):** se suman `/alumnos` y `/mi-carnet` a la lista, y `textoParaPdf` se
  reexporta para el PDF del carnet, sin moverlo.
- **001 (criterios 127 a 129, dependencias):** `qrcode` y `@types/qrcode` entran en `DEPENDENCIAS_BACKEND_PERMITIDAS`;
  la web suma `qrcode`.
- **`docs/arquitectura.md`:** «Lo que construye la historia 008a» y «008b», y la regla «Para la 008» pasa a cumplida.

## Riesgos aceptados

- **El token se guarda en claro** (DT-1): quien lea la base de una academia puede ver los tokens. Se acepta porque el
  carnet necesita volver a mostrar el mismo QR, la RLS y los privilegios limitan quién lo lee, y un token solo sirve en
  la asistencia de recepción, donde la secretaria ve la foto del alumno (11.4). Mitiga: regenerar.
- **Un carnet impreso con plan, horario o vigencia viejos** (DR-2): el QR sigue sirviendo y
  la asistencia decide con los datos de hoy; el PDF dice «Datos al …».
- **Captura del QR del celular compartida:** el mismo QR fijo (RN-06); el QR dinámico es de la Fase 4. Mitiga: la foto
  en la asistencia (11.4) y regenerar.
- **PDF sin cola ni límite propio:** un carnet es una página; se genera en memoria en pocos milisegundos. El límite
  general de la API es el pendiente DT-14 de 006.
- **La lista de la búsqueda muestra DNI** al personal: igual que el panel de solicitudes; no pasa por la dirección.
- **[008b] La foto del panel no tiene límite de subidas:** la usan personas con sesión de recepción; queda en auditoría.
- **[008b] Un archivo sin referencia** si falla un borrado o la relectura (el mismo riesgo de la 005b).
- **El DNI físico se revisa al entregar el carnet sin una marca en el sistema** (DR-3 de 007; DR-4 de esta
  spec).

## Decisiones

Técnicas: DT-1 a DT-13, aceptadas por el orquestador el 25/11/2026 tal como se propusieron; DT-14 a DT-17 (008b) las tomó el orquestador el 25/11/2026. Las decisiones del
responsable (DR-1 a DR-5) están en «Resueltas».

- **DT-1. Token en claro en `alumnos.qr_token`.** Descartado: guardar solo su SHA-256 (como el token de seguimiento),
  porque el carnet tiene que volver a mostrar el mismo QR; y un token derivado con HMAC de un secreto del servidor,
  porque agrega un secreto por instalación y cambiarlo invalidaría todos los carnets. El token no da acceso a nada sin
  la sesión de recepción.
- **DT-2. Contenido `AQ1:{token}`.** El prefijo separa los QR de AquaGestión de cualquier otro, deja versionar el
  formato (un QR dinámico sería otro prefijo) y no lleva la academia: la 009 busca en la academia de la sesión.
  Descartado: una dirección web (un celular la abriría) o el token solo.
- **DT-3. El token nace en `confirmarPagoEnTransaccion`, en la misma sentencia que pasa al alumno a `ALUMNO_ACTIVO`;
  la migración rellena a los alumnos que ya existen** con 32 bytes de dos `gen_random_uuid()` (244 bits al azar; sin
  depender de `pgcrypto`). Descartado: generarlo la primera vez que se pide el carnet (un `GET` que escribe, con
  carreras). Un `CHECK` en la otra dirección (todo alumno tiene token) se descarta: rompería pruebas protegidas de la 005
  y la 007 que escriben alumnos activos sin token; por eso existe el criterio 10.
- **DT-4. Permisos sin filas nuevas en la matriz.** Ver el carnet y buscar: `VER_CARNET`, con alcance `TODO` en
  `/api/alumnos/…` y `PROPIO` en `/api/mi-carnet…`, comprobado por el servicio. Regenerar el QR y la foto del panel:
  `REGISTRAR_INSCRIPCION_Y_COBRO` (administrador y secretaria, las tareas de recepción; 8.6 nombra a la secretaria).
  Descartado: un permiso nuevo `GESTIONAR_CARNET` con los mismos roles, que obligaría a cambiar el conteo de la matriz en
  cuatro pruebas protegidas de historias ya unidas.
- **DT-5. La web dibuja el QR desde `qr.contenido` con `qrcode`; el PDF, con `qrcode` en el backend; las dos con
  `OPCIONES_QR`.** Descartado: un SVG generado en la API dentro del JSON (más peso en cada lectura y HTML que la web
  tendría que insertar).
- **DT-6. La foto va dentro del JSON del carnet** como `data:` JPEG (como mucho unos 150 KB). Descartado: una ruta de
  imagen aparte por cada rol (más rutas que proteger con las mismas reglas).
- **DT-7. Regeneración idempotente con la última clave en `alumnos.qr_clave_idempotencia`** y motivo obligatorio de 3
  a 200 caracteres en la auditoría. Descartado: sin clave (un doble clic inutiliza el carnet recién impreso).
- **DT-8. Búsqueda con `ILIKE` sin quitar tildes** («Mendoza» encuentra «mendoza», pero «Nunez» no encuentra «Núñez»).
  Descartado: la extensión `unaccent` (otra extensión en la base y en Windows). Como mucho 20 resultados.
- **DT-9. PDF en memoria, sin cola**, con `pdfkit`, Helvetica y `textoParaPdf`, nombre `carnet.pdf` y metadatos sin
  datos personales. Descartado: la cola de la 006b (un carnet es una sola página).
- **DT-10 [008b]. Una función común para guardar la foto** (`reemplazarFotoDelAlumno`, en `inscripciones/`), que reciben
  la comprobación de la transacción como parámetro: la usan la ruta pública y las dos del panel. Descartado: copiar
  `FotoService` (tercera copia de la confirmación incierta; ya hay deuda por la duplicación con el comprobante). La foto
  del panel sí se audita (`ALUMNO_FOTO_ACTUALIZADA`), porque la cambia una persona del personal sobre la identidad del
  alumno; la pública sigue sin auditar.
- **DT-11 [008b]. Cámara con `getUserMedia` y `canvas`, sin librerías**, JPEG con calidad 0,9 a la resolución del
  video.
- **DT-12. Matrícula del carnet** (definición): la vigente de hoy en Lima o, si no hay, la última `VIGENTE` o
  `FINALIZADA`. La 010 podrá cambiarla cuando existan las renovaciones.
- **DT-13. Una foto que no se puede leer se muestra como «Foto pendiente»** con un `warn`, en lugar de un 500 que
  dejaría sin carnet al alumno.
- **DT-14 [008b]. La cancelación de la 005b bloquea `alumnos` antes que la solicitud**, para cumplir el criterio 26 c.
  Es coherente con el orden de bloqueos de la 007 (orquestador, 25/11/2026).
- **DT-15 [008b]. `origen` de `ALUMNO_FOTO_ACTUALIZADA` va dentro de `datosDespues`**, porque la tabla `auditoria` no
  tiene esa columna (orquestador, 25/11/2026).
- **DT-16 [008b]. `reemplazarFotoDelAlumno` recibe `confirmar(tx)`**, que bloquea, lee «ahora» después de los bloqueos y
  devuelve `{ anterior, ahora }`. Viene de la revisión (orquestador, 25/11/2026).
- **DT-17 [008b]. La lectura previa de la ruta del panel usa `LEFT JOIN LATERAL` a la matrícula**, para que una solicitud
  vieja sin matrícula responda 409 y no 404 (orquestador, 25/11/2026).

## Preguntas abiertas

Ninguna. Las cinco preguntas de negocio (P1 a P5) quedaron resueltas: ver «Resueltas».

## Resueltas

Decisiones del responsable. Bryan aprobó la propuesta de cada pregunta el 25/11/2026.

- **DR-1 (pregunta P1). Formato del carnet físico (PDF).** **Decidido (la propuesta):** una hoja A4 con la tarjeta del
  tamaño de una tarjeta bancaria (85,6 × 54 mm) y una línea punteada para recortarla y enmicarla, en cualquier
  impresora. Alternativas descartadas: (b) una página del tamaño exacto de la tarjeta, para una impresora de tarjetas de
  PVC; (c) las dos opciones. _(008a; criterio 11.)_
- **DR-2 (pregunta P2). Datos que cambian en el carnet impreso.** **Decidido (la propuesta):** el PDF lleva todo lo que
  pide HU-13 tal como está el día de la descarga, con «Datos al dd/mm/aaaa»; el QR sigue sirviendo aunque el plan, el
  horario, la vigencia o el nivel cambien, así que no hace falta reimprimir cada mes. Alternativa descartada: (b) el
  carnet impreso solo con lo estable (academia, foto, nombre, DNI y QR). _(008a; criterio 11 y «Riesgos aceptados».)_
- **DR-3 (pregunta P3). DNI en el carnet.** **Decidido (la propuesta):** DNI completo en la pantalla y en el PDF, como
  dice HU-13. Alternativa descartada: (b) completo en la pantalla y solo los últimos 4 dígitos en el PDF. _(008a;
  criterios 7 y 11.)_
- **DR-4 (pregunta P4). Marca «DNI comprobado» (DR-3 de 007).** **Decidido (la propuesta):** no se agrega una marca en
  esta historia; la secretaria revisa el DNI físico al entregar el carnet, sin registrarlo. Alternativa descartada: (b)
  un botón «DNI comprobado» con quién y cuándo en la auditoría, y un aviso mientras no se marque. _(«Riesgos
  aceptados».)_
- **DR-5 (pregunta P5). Aviso al regenerar el QR.** **Decidido (la propuesta):** sin correo; el alumno ve el QR nuevo en
  su panel y el carnet impreso anterior deja de servir. Alternativa descartada: (b) un correo al alumno (y a su
  apoderado, si es menor), sin el QR. _(008a; criterio 13.)_
