# 008 · Plan técnico

Entregas: **008a** (carnet y QR, criterios 1 a 21) y **[008b]** (foto desde el panel y cámara, criterios 22 a 29).
Spec aprobada por Bryan el 25/11/2026 (DR-1 a DR-5, en `spec.md`, «Resueltas»). Las decisiones técnicas DT-1 a DT-13,
aceptadas por el orquestador, están en `spec.md`, «Decisiones»; aquí va cómo se construyen.

## Módulos afectados

**008a**

- `backend/prisma/schema.prisma` y `backend/prisma/migrations/<marca>_carnet_qr/migration.sql` (criterio 1).
- `backend/src/infraestructura/prisma/privilegios-app.ts` y `scripts/lib/rol-app.mjs`: `UPDATE` de las tres columnas.
- `backend/src/modulos/pagos/confirmacion.ts`: paso 5 con el token (criterio 2).
- `backend/src/modulos/alumnos/` (módulo nuevo):
  - `alumnos.module.ts`, `alumnos.controller.ts` (`/api/alumnos/buscar`, `…/{id}/carnet`, `…/{id}/carnet/pdf`,
    `…/{id}/carnet/qr`), `mi-carnet.controller.ts` (`/api/mi-carnet`, `/api/mi-carnet/pdf`);
  - `carnet.service.ts` (lectura del carnet y regeneración), `busqueda.service.ts`;
  - `dominio/token-qr.ts` (`nuevoTokenQr`), `dominio/matricula-del-carnet.ts` (elección y `vigenteHoy`, puras, con la
    fecha de Lima ya calculada);
  - `pdf/carnet-pdf.ts` (`generarPdfCarnet`) y el token `GENERADOR_PDF_CARNET`;
  - `alcance.ts` (comprobación del alcance de `VER_CARNET` según la ruta), `errores.ts`, `index.ts`.
- `backend/src/modulos/caja/head-sin-ruta.ts`: `PREFIJOS_SIN_HEAD` suma `/alumnos` y `/mi-carnet` (criterio 18).
- `backend/src/modulos/caja/index.ts`: reexporta `textoParaPdf`.
- `backend/src/app.module.ts`: registra `AlumnosModule`.
- `backend/package.json` (`qrcode`, `@types/qrcode`) y `scripts/lib/dependencias-backend.mjs`.
- `packages/contratos/src/carnet.ts` y `index.ts` (esquemas, `PREFIJO_QR`, `OPCIONES_QR`, `resumenDeHorario`).
- `frontend/package.json` (`qrcode`, `@types/qrcode`).
- `frontend/src/modulos/carnet/`: `VistaCarnet.tsx` (la tarjeta, compartida), `QrDelCarnet.tsx`, `PaginaMiCarnet.tsx`,
  `hooks.ts` (consultas con la identidad de la sesión en la clave, descarga del PDF).
- `frontend/src/modulos/alumnos/`: `PaginaAlumnos.tsx` (búsqueda), `PaginaCarnetAlumno.tsx`, `DialogoRegenerarQr.tsx`.
- `frontend/src/modulos/panel/PaginaPanel.tsx` (opciones por alcance) y `frontend/src/rutas/Rutas.tsx`.
- `docs/arquitectura.md`, `docs/guia-local-windows.md`, `specs/backlog.md` (documentador).

**[008b]**

- `backend/src/modulos/inscripciones/foto-del-alumno.ts` (nuevo, sin Nest): `reemplazarFotoDelAlumno`, extraída de
  `foto.service.ts` (recodificación, `guardar`, transacción con la comprobación que recibe, borrado después de confirmar
  y confirmación incierta). `FotoService` pasa a usarla sin cambiar lo observable.
- `backend/src/modulos/inscripciones/solicitudes.controller.ts` y `foto-panel.service.ts`: `PUT /api/solicitudes/{id}/foto`.
- `backend/src/modulos/alumnos/alumnos.controller.ts` y `foto-alumno.service.ts`: `PUT /api/alumnos/{id}/foto`.
- `backend/src/comun/http/cuerpo-imagen.ts`: el lector binario también en las dos rutas del panel, después de la sesión y
  del permiso (criterio 24).
- `frontend/src/modulos/foto/`: `CapturaCamara.tsx`, `DialogoFoto.tsx` (archivo o cámara), `hooks.ts` (subida).
- `frontend/src/modulos/alumnos/PaginaCarnetAlumno.tsx` y `frontend/src/modulos/solicitudes/PaginaSolicitudes.tsx`
  («Agregar foto»).

## Diseño

### Token y generación (criterios 1 a 3)

- `nuevoTokenQr()` = `randomBytes(32).toString('base64url')` (43 caracteres). `contenidoQr` y `tokenDelContenidoQr` en
  contratos, con `PATRON_TOKEN_QR`.
- En `confirmarPagoEnTransaccion`, paso 5: el `UPDATE alumnos SET estado = 'ALUMNO_ACTIVO', usuario_id = …` suma
  `qr_token = ${nuevoTokenQr()}, qr_generado_en = ${ahora}`. Solo cuando `creaCuenta` (el mismo `if`). No se toca el
  orden de bloqueos ni los pasos anteriores. Si chocara el índice único (no debería: 256 bits), la transacción falla con
  500 y se revierte entera; no se reintenta.
- Migración, en este orden: `ALTER TABLE alumnos ADD COLUMN …` (tres columnas); relleno de los no `CLIENTE`:
  ```sql
  UPDATE alumnos
     SET qr_token = translate(rtrim(encode(decode(replace(gen_random_uuid()::text, '-', '') ||
                                                  replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='),
                              '+/', '-_'),
         qr_generado_en = now()
   WHERE estado <> 'CLIENTE' AND qr_token IS NULL;
  ```
  (32 bytes de dos UUID v4 dan 43 caracteres de base64url; `encode(…, 'base64')` no corta líneas con 32 bytes);
  después el índice único y los tres `CHECK`; al final `GRANT UPDATE (qr_token, qr_generado_en, qr_clave_idempotencia)
  ON alumnos TO aquagestion_app`. La migración corre como dueño y `alumnos` tiene la RLS forzada: sin contexto, el
  `UPDATE` no ve ninguna fila y no da error. Por eso el relleno va en un bloque `DO` que lee los ids de `academias` con
  `set_config('app.plataforma', 'si', true)` y, por cada academia, fija `set_config('app.academia_id', id, true)` y
  `app.plataforma` vacío antes del `UPDATE` (es el primer relleno de datos de una migración; ninguna anterior lo hizo).
  Descartado: `NO FORCE ROW LEVEL SECURITY` temporal, que deja la tabla sin forzar si la migración se corta a mitad.

### Lectura del carnet (criterios 4 a 10)

- Controladores: `@Permiso('VER_CARNET')` y después `exigirAlcance(sesion, 'TODO' | 'PROPIO')` (en `alcance.ts`, con
  `MATRIZ_PERMISOS`): 403 `SIN_PERMISO` si el alcance del rol no es el de la ruta. El `{id}` no pasa por pipes: el
  servicio lo valida y responde 404 (AT-2 de 004).
- `CarnetService.leer(academiaId, criterio)` donde `criterio` es `{ alumnoId }` o `{ usuarioId }`:
  1. Una transacción `conAcademia` de solo lectura, sin bloqueos: el alumno (no `CLIENTE`), el nombre de la academia, las
     matrículas `VIGENTE` y `FINALIZADA` con su plan y sus clases (una sola consulta con `json_agg`, o dos con `in`), y
     «ahora» de `RELOJ` para `hoyEnLima`.
  2. Fuera de la transacción: `AlmacenArchivos.leer(academiaId, foto_clave)` si hay clave; un fallo da `foto: null` y el
     `warn` del criterio 9.
  3. Arma `carnetSchema` con `elegirMatriculaDelCarnet(matriculas, hoy)` (dominio puro) y lo valida con el esquema antes de
     responder (falla cerrada si sobra un campo).
- PDF: el mismo `leer` y después `GENERADOR_PDF_CARNET.generar({ carnet, contenidoQr, fechaDatos })`.
  `generarPdfCarnet` usa `pdfkit` (A4, Helvetica), `qrcode.toBuffer(contenido, { ...OPCIONES_QR, type: 'png' })` y la
  foto JPEG tal cual (ya recodificada). Tarjeta de 85,6 × 54 mm (DR-1) con borde punteado. Metadatos: `Title:
  'Carnet'`, sin `Author`. `info.CreationDate` = «ahora». Todo texto de datos con `textoParaPdf`; los nombres largos se
  cortan con `heightOfString` y «…».
- Cabeceras del PDF: las de la 006b, con `filename="carnet.pdf"` y `Content-Length`.

### Regeneración (criterios 13 a 15)

`CarnetService.regenerar(sesion, alumnoId, { claveIdempotencia, motivo }, ip)`, en un `conAcademia`:

1. `bloquearActorVigente(tx, actorDeSesion(sesion), …)` (401 gana a todo lo demás).
2. `SELECT id, estado, qr_token, qr_generado_en, qr_clave_idempotencia FROM alumnos WHERE academia_id = … AND id = …
   FOR UPDATE`; un id que no es UUID se descarta antes de consultar con el mismo 404. `CLIENTE` o sin fila: 404.
3. Si `qr_clave_idempotencia = claveIdempotencia`: no escribe; termina y responde el carnet actual.
4. Si no: token nuevo (distinto del anterior; si por azar coincide, se genera otro), `UPDATE` de las cuatro columnas e
   `insertarEnAuditoriaDeAcademia` con `CARNET_QR_REGENERADO`.
5. Después de confirmar: `leer` y 200.

Dos peticiones a la vez con la misma clave: la segunda espera el `FOR UPDATE`, lee la clave ya guardada y no regenera.

### Búsqueda (criterio 16)

Una transacción de lectura: `WHERE academia_id = $1 AND estado <> 'CLIENTE' AND (dni = $texto` si son 8 dígitos; si no,
`(nombres || ' ' || apellidos) ILIKE $patron ESCAPE '\' OR (apellidos || ' ' || nombres) ILIKE $patron ESCAPE '\')`, con
`$patron = '%' || escapar(texto) || '%'`), `ORDER BY apellidos, nombres, id LIMIT 21`; `hayMas` = vinieron 21. Sin índice
nuevo: una academia tiene cientos de alumnos, no millones.

### Foto desde el panel [008b] (criterios 22 a 27)

- **Lector binario.** `cuerpo-imagen.ts` suma `RUTA_FOTO_ALUMNO_PANEL` (`^/alumnos/[^/]+/foto/?$`) y
  `RUTA_FOTO_SOLICITUD_PANEL` (`^/solicitudes/[^/]+/foto/?$`), solo `PUT`. Como esas rutas son de academia, el middleware
  de la sesión ya corrió y dejó `sesionAcademia`: el lector comprueba `puede(rol, 'REGISTRAR_INSCRIPCION_Y_COBRO')` y, si
  no puede, pasa sin leer el cuerpo (el guard responde 403, con `Connection: close`). Si puede, aplica las mismas
  comprobaciones de tipo, codificación y tamaño que la foto pública. El lector JSON no toca estas rutas
  (`esSubidaDeImagen` las incluye). Las rutas públicas no cambian.
- **Función común** `reemplazarFotoDelAlumno(deps, { academiaId, alumnoId, cuerpo, tipo, confirmar })`, extraída de
  `FotoService.subir` desde la recodificación en adelante. `confirmar(tx)` es la comprobación de cada ruta dentro de la
  transacción de escritura (bloqueos, repetición de la comprobación, auditoría si corresponde) y devuelve la clave
  anterior. La ruta pública pasa la suya (sin actor, sin auditoría); las del panel, la suya (con `bloquearActorVigente`
  primero). La confirmación incierta, los borrados y los registros técnicos son los de hoy.
- **Comprobaciones previas** (g a i del criterio 24): transacción corta con `bloquearActorVigente` y la lectura del
  alumno o de la solicitud (con `estadoVisible` y `unirUltimoPago`, como `FotoService.leerPorToken`, pero por id).
- **Regla de la solicitud:** editable como la pública (`esEditable` de `FotoService`, que pasa a exportarse desde
  `inscripciones/`) **o** con la fila `CONFIRMADA` y el alumno fuera de `CLIENTE`.

### Web

- **Opciones del inicio por alcance:** `Opcion` suma `alcances?: Alcance[]`; «Mi carnet» exige `VER_CARNET` con
  `PROPIO`, y «Alumnos y carnets», `VER_CARNET` con `TODO`.
- **QR:** `QrDelCarnet` llama a `QRCode.toString(contenido, { ...OPCIONES_QR, type: 'svg' })` y lo muestra como
  `<img src="data:image/svg+xml;base64,…">` (sin `dangerouslySetInnerHTML`), de al menos 220 px en el celular.
- **Descarga del PDF:** `fetch` con la cookie, `blob` y un enlace temporal; sin el id en la dirección de la web del alumno
  (`/panel/mi-carnet`).
- **Búsqueda:** formulario con React Hook Form y `buscarAlumnosSchema`; el texto va en el cuerpo del `POST` y no en la
  dirección de la página.
- **[008b] Cámara:** `CapturaCamara` usa `getUserMedia({ video: true, audio: false })`, un `<video>` en vivo y un
  `canvas` del tamaño del video; `canvas.toBlob(…, 'image/jpeg', 0.9)` da el `Blob` que sube `DialogoFoto` con
  `Content-Type: image/jpeg`. Un `useEffect` con limpieza detiene las pistas al cerrar o desmontar. Las pruebas de
  componentes simulan `navigator.mediaDevices` y `HTMLCanvasElement.prototype.toBlob`.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Token en claro (DT-1) | Hash o HMAC | El carnet vuelve a mostrar el mismo QR; un secreto nuevo complica la instalación |
| Prefijo `AQ1:` (DT-2) | Dirección web o token solo | Distingue los QR propios y deja versionar el formato |
| Token al confirmar y relleno en la migración (DT-3) | Generarlo al leer el carnet | Un `GET` que escribe tiene carreras |
| Sin filas nuevas en la matriz (DT-4) | `GESTIONAR_CARNET` | Mismos roles; evita cambiar cuatro pruebas protegidas ya unidas |
| QR dibujado en la web y en el PDF con `qrcode` (DT-5) | SVG desde la API | Menos peso por lectura; las mismas opciones dan el mismo QR |
| Foto dentro del JSON (DT-6) | Ruta de imagen por rol | Una sola ruta que proteger |
| Clave de idempotencia en `alumnos` (DT-7) | Tabla de regeneraciones | Basta la última clave; la historia queda en auditoría |
| `ILIKE` sin `unaccent` (DT-8) | Extensión `unaccent` | Sin extensiones nuevas en la base ni en Windows |
| PDF en memoria (DT-9) | Cola de 006b | Una página; pocos milisegundos |
| Función común de la foto (DT-10) | Copiar `FotoService` | Una sola implementación de la confirmación incierta |
| Cámara sin librería (DT-11) | `react-webcam` u otra | Unas decenas de líneas; nada que mantener ni revisar en Windows |

## Migraciones

- **008a:** `<marca>_carnet_qr` (criterio 1): columnas, relleno, índice único, `CHECK` y privilegios. Reversible a mano
  (quitar `CHECK`, índice y columnas). Una base de desarrollo con alumnos activos de pruebas anteriores recibe sus tokens
  en el relleno.
- **[008b]:** ninguna.

## Riesgos

- **Tocar `confirmarPagoEnTransaccion`** (código crítico de la 007): el cambio es una columna más en un `UPDATE` que ya
  existe. Las pruebas protegidas de la 007 corren en la 008a para confirmar que no cambia nada observable.
- **Extraer la foto de la 005b [008b]:** las pruebas protegidas de la 005b (criterios 34 a 37, 61, 64) son la red; se
  ejecutan todas antes del commit de la extracción.
- **El lector binario con sesión [008b]:** es el primero que lee un cuerpo binario en una ruta con sesión; el orden de
  los middlewares (sesión → lector) ya está en `configurarApp`, pero hay que comprobar con pruebas que 401 y 403 no leen
  el cuerpo (criterio 24) y que el lector JSON no toca esas rutas.
- **`getUserMedia` exige contexto seguro:** en la PC del responsable funciona con `localhost`; en producción, con HTTPS
  (anotar en la guía).
- **Tamaño de la respuesta del carnet:** con foto, unos 100 a 150 KB; aceptable en el celular.
- **Relleno de tokens en la migración con RLS forzada:** comprobar el contexto con el que corre (riesgo de que no
  actualice filas sin dar error); la prueba del criterio 1 lo verifica con un alumno activo creado antes de migrar.
