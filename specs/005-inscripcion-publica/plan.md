# 005 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md) (sobre todo "Reglas para las
historias siguientes" y "Planes, clases y cupo (004)") y las specs [`001`](../001-academias-aislamiento/spec.md),
[`002`](../002-autenticacion-roles/spec.md), [`003`](../003-configuracion-academia/spec.md) y
[`004`](../004-planes-clases-aforo/spec.md). Lo que no es orientativo es el contrato de `spec.md`.

**Estado:** aprobado con la spec (20/11/2026). Los valores provisionales quedaron decididos tal cual (DR-1 a DR-10 y
DT-1 a DT-9 de 005), así que el plan no cambia. Por DR-11 la historia se entrega en dos PR desde esta carpeta:

- **005a · inscripción, reserva y seguimiento** (primero): secciones 1 a 8, 10, 12 (salvo lo marcado) y 13, y de la
  sección 11 solo DR-5 en `ClasesService` (criterios 41 y 42).
- **005b · foto y panel de solicitudes** (siguiente PR): la sección 9 completa, de la sección 11 la lista, la
  cancelación y `GET /api/clases/ocupacion` (criterios 38 a 40), y de la 12 la foto y el panel (criterio 46). Todo lo
  que es de la 005b lleva la marca **[005b]**.

Lo que la 005a deja hecho para la 005b, para que la 005b no necesite migración ni cambie contratos de la 005a: la
migración completa (con `alumnos.foto_clave`, su privilegio de `UPDATE` y los estados `CANCELADA`), `fotoCargada` en
`vistaSolicitudSchema` (en la 005a siempre `false`) y `contarInscritos`. La regla del límite de la foto (sección 8) y su
prueba entran con la ruta, en la 005b. Detalle en "División en 005a y 005b" de `spec.md`.

## Módulos afectados

```
piscina/
├── packages/contratos/src/
│   ├── inscripcion.ts (+ .test.ts)       nuevo: formulario, cotización, listas, celular, esMenorDeEdad
│   ├── consentimientos.ts (+ .test.ts)   nuevo: versión, tipos y textos provisionales con el nombre de la academia
│   ├── solicitudes.ts (+ .test.ts)       nuevo: código, token, consulta, vista mínima; [005b] panel, cancelación
│   ├── academias.ts                      AcademiaPublica + telefono
│   ├── clases.ts                         actualizarClaseSchema + confirmarAforoMenor; [005b] respuestaOcupacionSchema
│   └── index.ts                          + exportaciones
├── backend/
│   ├── package.json                      [005b] + sharp (D-25; DT-6)
│   ├── prisma/schema.prisma              + tipos y las siete tablas
│   ├── prisma/migrations/<marca>_inscripcion_publica/   tipos, tablas, CHECK, índices, RLS, políticas, privilegios
│   ├── prisma/seed.ts                    + solicitudes de ejemplo en delfines (criterio 47)
│   ├── src/infraestructura/prisma/privilegios-app.ts   + privilegios de las siete tablas
│   ├── src/infraestructura/almacen-archivos/          [005b] nuevo: interfaz, disco local, módulo, claves
│   ├── src/infraestructura/correo/                    nuevo: interfaz, envío simulado, módulo
│   ├── src/infraestructura/entorno/entorno.ts         [005b] + ALMACEN_DIRECTORIO
│   ├── src/comun/http/cuerpos.ts                      [005b] la ruta de la foto queda fuera del lector JSON
│   ├── src/comun/http/cuerpo-imagen.ts                [005b] nuevo: lector binario de la foto (5 MB, sin inflar)
│   ├── src/modulos/academias/proteccion-de-prefijos.ts   + límites por IP de las rutas públicas (criterio 33; [005b] foto)
│   ├── src/modulos/academias/academia-publica.controller.ts   + telefono
│   ├── src/modulos/auditoria/insercion.ts             actorTipo + 'PUBLICO'
│   ├── src/modulos/matriculas/                        nuevo (sin controlador)
│   │   ├── dominio/cobro.ts (+ .test.ts)              clasesRestantes, montoProporcional, calcularTotal (racional)
│   │   ├── ocupacion.ts                               contarOcupacion, contarInscritos (sin Nest)
│   │   └── index.ts
│   ├── src/modulos/inscripciones/                     nuevo
│   │   ├── dominio/edad.ts · seleccion.ts · codigos.ts (+ .test.ts)
│   │   ├── inscripcion-publica.controller.ts          GET formulario, POST cotización, POST envío
│   │   ├── seguimiento.controller.ts                  POST consulta; [005b] PUT foto
│   │   ├── solicitudes.controller.ts                  [005b] GET lista, POST cancelar (panel)
│   │   ├── inscripciones.service.ts · seguimiento.service.ts · [005b] solicitudes.service.ts · foto.service.ts
│   │   └── inscripciones.module.ts · index.ts
│   ├── src/modulos/clases/clases.service.ts           DR-5 (criterios 41 y 42); [005b] GET /api/clases/ocupacion
│   └── test/
│       ├── utilidades/inscripciones.ts                crear clientes, solicitudes y matrículas; llenar clases (test-writer)
│       └── integracion/inscripciones/                 pruebas protegidas y no protegidas
├── scripts/
│   ├── lib/rol-app.mjs                    + privilegios de las siete tablas
│   ├── lib/dependencias-backend.mjs       [005b] + sharp
│   └── test/integracion/migraciones.test.mjs   + las siete tablas en TABLAS_DESPUES_DE_MIGRAR
├── frontend/src/
│   ├── modulos/inscripcion/               nuevo: api.ts · hooks.ts · PaginaInscripcion.tsx · pasos/*.tsx · Inscripcion.test.tsx
│   ├── modulos/seguimiento/               nuevo: PaginaSeguimiento.tsx · PaginaConsultaCodigo.tsx · Seguimiento.test.tsx
│   ├── modulos/solicitudes/               [005b] nuevo: PaginaSolicitudes.tsx · DialogoCancelar.tsx · Solicitudes.test.tsx
│   ├── modulos/clases/                    [005b] ocupación en la grilla y diálogo de aforo menor (criterio 46)
│   ├── modulos/sesion/PaginaIngresarAcademia.tsx   + teléfono (criterio 45)
│   ├── modulos/panel/PaginaPanel.tsx      [005b] + "Solicitudes de inscripción" y "Nueva inscripción"
│   └── rutas/Rutas.tsx                    + /a/:nombreCorto/inscripcion, /a/:nombreCorto/solicitud(/:token); [005b] /panel/solicitudes
├── .env.example                           [005b] + ALMACEN_DIRECTORIO
└── docs/arquitectura.md · README.md · guía de uso   documentador (criterio 48)
```

## Diseño

### 1. Contratos

- `inscripcion.ts`:
  - `telefonoCelularSchema`: recorta, quita espacios y guiones internos y exige `^9\d{8}$` (N5); el valor guardado son
    los 9 dígitos.
  - Textos: nombres y apellidos con `textoVisibleSchema({ min: 2, max: 60 })`; dirección hasta 200; textos médicos y
    seguro hasta 500 y 100; contacto de emergencia con nombre de 2 a 80 y celular. Correo con `z.email()` y como mucho
    254, en minúsculas y recortado. Ningún texto admite controles ni bidireccionales (`sinControles`).
  - `fechaNacimiento`: `fechaSchema` más un `refine` que no puede hacerse sin "hoy": el esquema solo comprueba el
    formato y la fecha real; el servicio comprueba "no futura" y "como mucho 100 años" con la fecha de Lima, y responde
    el 400 en `alumno.fechaNacimiento` (así la web y la API usan la misma función `validarFechaNacimiento(fecha, hoy)`).
  - `esMenorDeEdad(fechaNacimiento, hoy)`: compara años, meses y días en texto `AAAA-MM-DD` (sin `Date` ni zona), con
    el 29 de febrero tratado como 1 de marzo en años no bisiestos.
  - `enviarInscripcionSchema` con un `superRefine` que exige `apoderado` si es menor y lo prohíbe si es mayor no puede
    saber "hoy"; por eso esa regla también la aplica el servicio (400 en `apoderado`), y el esquema solo comprueba la
    forma de `apoderado` cuando viene.
  - `claseIds`: arreglo de 1 a 7 UUID sin repetidos; `mes`: `^\d{4}-(0[1-9]|1[0-2])$`; `montoMostrado`: `montoSchema`;
    `claveIdempotencia`: `z.uuid()`.
- `consentimientos.ts`: `VERSION_CONSENTIMIENTOS = '2026-11-v1-provisional'`; `textosConsentimiento(nombreAcademia,
  { menor })` devuelve los tres textos (el de datos personales nombra los datos de salud y, si es menor, los de menores y
  al apoderado como quien acepta). Textos inventados y genéricos (repositorio público).
- `solicitudes.ts`: `ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'`; `codigoSolicitudSchema` recorta y pasa a
  mayúsculas antes del `regex`; `consultarSolicitudSchema = z.union([z.strictObject({ token }), z.strictObject({
  codigo, dni })])`; `vistaSolicitudSchema` estricto con los campos del criterio 32.
- `clases.ts`: `confirmarAforoMenor: z.boolean().optional()` en `actualizarClaseSchema`; el `refine` "al menos un campo"
  cuenta solo `entrenadorId`, `aforo` y `activo`.

### 2. Migración `<marca>_inscripcion_publica`

Como la de la 004: comprobación de `aquagestion_app`; tipos; tablas con sus `CHECK` y llaves compuestas; índices únicos
(también los parciales de solicitudes y matrículas); `ENABLE` y `FORCE ROW LEVEL SECURITY`; políticas con la forma
exacta de `usuarios` y de 004 (más `apoderados_borrar`); `GRANT` del criterio 2. `ALTER TYPE tipo_actor ADD VALUE
'PUBLICO'` va en la misma migración y no se usa en ella (PostgreSQL no deja usar un valor nuevo de un enum en la
transacción que lo crea).

`CHECK` que conviene escribir con cuidado (lecciones del criterio 33 de 004):

- `matriculas_montos_validos`: `precio_plan > 0 AND precio_plan <> 'NaN'::numeric AND monto_calculado > 0 AND
  monto_calculado <> 'NaN'::numeric` (y `monto_ajustado` nulo o mayor o igual que 0 y distinto de `NaN`).
- `matriculas_clases_validas`: `clases_por_mes_plan >= 1 AND clases_totales BETWEEN 1 AND clases_por_mes_plan AND
  clases_usadas BETWEEN 0 AND clases_totales`.
- `matriculas_fechas_del_mes`: `fecha_inicio <= fecha_fin AND date_trunc('month', fecha_inicio) = make_date(anio, mes,
  1) AND fecha_fin = (make_date(anio, mes, 1) + interval '1 month' - interval '1 day')::date` (con `anio` entre 2000 y
  9999 para que `make_date` no falle con `22008` en vez de `23514`; mismo cuidado de orden con `CASE` que en 004).
- `matriculas_reserva_coherente`: `estado = 'RESERVADA' OR reserva_vence_en IS NULL`.
- `alumnos_dni_formato`: `dni ~ '^[0-9]{8}$'`; `alumnos_fecha_nacimiento_finita`: `isfinite(fecha_nacimiento)`.
- `solicitudes_codigo_formato`: `codigo ~ '^AQ-[0-9A-HJKMNP-TV-Z]{6}$'`; `solicitudes_token_hash_largo`:
  `octet_length(token_hash) = 32`.
- `consentimientos_version_no_vacia`: `length(btrim(version)) > 0`.

Ampliar en el mismo cambio `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR`.

### 3. Dominio (funciones puras)

- `matriculas/dominio/cobro.ts`:
  - `clasesRestantes(clases, ahora)`: `hoy = hoyEnLima(ahora)`; recorre las fechas de `hoy` al último día del mes (como
    texto `AAAA-MM-DD`, con el día de la semana ISO calculado en Lima con `TZDate`); por cada clase cuyo `diaSemana`
    coincide suma 1, salvo hoy si `inicioEnLima(hoy, horaInicio) <= ahora` (`TZDate` de `@date-fns/tz`, nunca la zona
    del proceso).
  - Aritmética racional: un tipo `Racional { numerador: bigint; denominador: bigint }` con el precio en céntimos
    (`"120.50"` → `12050n / 100n`, a partir del texto o de `Decimal.toFixed(2)`, nunca `Number`). `montoProporcional =
    techo(precioCentimos × clasesTotales / (clasesPorMes × 100))` en soles enteros, con división entera de `bigint`.
  - `calcularTotal({ base, montoAjustado?, descuento? })`: base racional; el ajuste la reemplaza; descuento porcentaje
    `p` → `base × (100 − p) / 100`; fijo `f` → `max(0, base − f)`; techo al final. Devuelve `Decimal` con `.00`.
  - Pruebas: tabla de D-03; los casos del criterio 9; propiedades con `fast-check` si ya está en el repositorio, o una
    lista amplia generada en la prueba (precios de `0.01` a `99999.99`, clases de 1 a 31).
- `inscripciones/dominio/edad.ts`: reexporta `esMenorDeEdad` y `validarFechaNacimiento` de los contratos y las prueba en
  los bordes del criterio 13.
- `inscripciones/dominio/seleccion.ts`: `validarSeleccion(plan, nivel, clasesBloqueadas, claseIds)` → lista de errores
  del criterio 15 b (cantidad igual a `vecesPorSemana`, días distintos, activas, nivel, día y franja permitidos, ids que
  no volvieron del bloqueo).
- `inscripciones/dominio/codigos.ts`: `nuevoCodigo()` (6 índices de `crypto.randomInt(32)`), `nuevoToken()`
  (`randomBytes(32).toString('base64url')`), `hashToken(token)` (`createHash('sha256')`).

### 4. Ocupación (`matriculas/ocupacion.ts`)

```sql
SELECT mc.clase_id::text AS clase_id, count(*)::int AS ocupacion
  FROM matricula_clases mc
  JOIN matriculas m ON m.academia_id = mc.academia_id AND m.id = mc.matricula_id
 WHERE mc.academia_id = ${tx.academiaId}::uuid AND mc.clase_id = ANY(${ids}::uuid[])
   AND m.anio = ${anio} AND m.mes = ${mes}
   AND (m.estado = 'VIGENTE' OR (m.estado = 'RESERVADA' AND (m.reserva_vence_en IS NULL OR m.reserva_vence_en > ${ahora}::timestamptz)))
 GROUP BY mc.clase_id
```

`contarInscritos` igual, con `(m.anio, m.mes) >= (${anio}, ${mes})` agrupado por clase y mes, y el máximo por clase. Sin
`FOR UPDATE`: quien llama ya bloqueó las clases, y toda escritura que cambia la ocupación de una clase pasa por ese
mismo bloqueo. `ahora` llega de `RELOJ`, nunca de `now()`.

### 5. Lectura pública

- **`GET /api/a/{nombreCorto}`:** el pipe resuelve la academia; después `conAcademia(id, tx => leerConfiguracion(tx))`
  para el teléfono. Son dos transacciones cortas; el límite del criterio 33 protege el pool (nota O2 de 001).
- **`GET /api/a/{nombreCorto}/inscripcion`:** un solo `conAcademia`: configuración (teléfono), planes activos (y
  `estadoDelPlan` con `hoy`), clases activas, `contarOcupacion` de todas sin bloqueo (lectura informativa: el cupo se
  decide al enviar) y textos de `consentimientos.ts`. Se filtran las clases con cupos restantes mayores que 0.
- **Cotización:** el mismo `conAcademia` de lectura; plan, clases sin bloqueo, `validarSeleccion`, `clasesRestantes` y
  `montoProporcional`. No llama a `bloquearClasesParaCupo` (no escribe ni decide cupo).

### 6. Envío (`InscripcionesService.enviar`)

Middleware: límite "envío" por IP (sección 8). Controlador: pipe de la academia, `validarCon(enviarInscripcionSchema)`,
`ahora = RELOJ.ahora()`, `hoy` y `mes en curso`. Comprobaciones sin base: fecha de nacimiento (400), apoderado según la
edad (400). Después, un `conAcademia(academia.id, …)`:

1. Bloqueos consultivos, en este orden: IP de origen y DNI (`pg_advisory_xact_lock(hashtextextended(…, 0))` con
   `$executeRaw`, criterio 155 de 001).
2. Idempotencia: `SELECT s.codigo, a.dni FROM solicitudes_inscripcion s JOIN alumnos a … WHERE s.clave_idempotencia =
   …`. Si existe: con el mismo DNI, 409 `SOLICITUD_YA_REGISTRADA` con el código; con otro, sin `detalles`.
3. `version` de los consentimientos frente a `VERSION_CONSENTIMIENTOS` → 409 `TEXTOS_ACTUALIZADOS`.
4. `inscripcion.mes` frente al mes en curso → 409 `MES_CAMBIO`.
5. Plan (`SELECT … FROM planes WHERE academia_id = … AND id = …`, sin bloqueo; la llave foránea toma `FOR KEY SHARE`
   al insertar): activo, `estadoDelPlan(hoy) === 'VIGENTE'` y el nivel en `niveles_aplicables` → si no, 409
   `PLAN_NO_DISPONIBLE`.
6. Persona: `SELECT … FROM alumnos WHERE academia_id = … AND dni = … FOR UPDATE`; `SELECT 1 FROM usuarios WHERE
   academia_id = … AND dni = …` (sin bloqueo); si hay alumno `CLIENTE`, sus solicitudes `PENDIENTE_PAGO` y matrículas
   `RESERVADA` con `FOR UPDATE`. Alumno que no es `CLIENTE`, usuario del personal o solicitud activa → 409
   `DNI_YA_REGISTRADO`.
7. Límite por conexión: `count(*)` de solicitudes activas con `ip_origen` igual (con la matrícula que ocupa cupo) → 409
   `LIMITE_DE_RESERVAS_PENDIENTES` si llega a 5.
8. `bloquearClasesParaCupo(tx, claseIds)`, una sola llamada.
9. `validarSeleccion` → 409 `SELECCION_NO_VALIDA`; `clasesRestantes` → 409 `SIN_CLASES_EN_EL_MES`.
10. `contarOcupacion` del mes en curso → 409 `SIN_CUPO` con todas las clases llenas.
11. `montoProporcional` y comparación con `montoMostrado` (`montosIguales`) → 409 `MONTO_CAMBIO` con la cotización.
12. Escrituras (una sentencia por tabla, sin bucles de escrituras de modelos):
    - solicitudes vencidas del cliente → `VENCIDA`; sus matrículas `RESERVADA` vencidas → `CANCELADA`;
    - alumno: `INSERT` (nuevo) o `UPDATE` de sus datos (cliente que vuelve); ficha: `INSERT … ON CONFLICT (alumno_id) DO
      UPDATE`; apoderado: lo mismo, o `DELETE` si ya es mayor;
    - solicitud: `INSERT … ON CONFLICT ON CONSTRAINT solicitudes_inscripcion_academia_id_codigo_key DO NOTHING
      RETURNING id`, con hasta 5 códigos nuevos si no vuelve fila (el choque de código solo da un resultado posible, así
      que vale el patrón de "Transacciones"); los demás índices únicos fallan con `23505`, y el 409 sale después del
      `ROLLBACK` por el nombre de la restricción (`restriccionDeUnicidadViolada`): `…_clave_idempotencia_key` →
      `SOLICITUD_YA_REGISTRADA` sin `detalles`; `alumnos_academia_id_dni_key` → `DNI_YA_REGISTRADO`;
    - matrícula `RESERVADA` (`reserva_vence_en = ahora + 24 h`) y `matricula_clases` en un solo `INSERT … SELECT
      unnest(…)`;
    - consentimientos en un solo `INSERT` de varias filas;
    - auditoría `SOLICITUD_INSCRIPCION_CREADA` (actor `PUBLICO`) con `insertarEnAuditoriaDeAcademia`.
13. Confirmar. Después: `EnviadorCorreo.enviar` si hay correo, dentro de un `try/catch` que registra el fallo con
    `errorParaRegistro` y sin datos personales; la respuesta 201 no espera más que eso.

Las respuestas 409 con `detalles` (código, clases sin cupo, cotización) se arman con datos leídos dentro de la
transacción antes de lanzar el error; nada se relee después del `ROLLBACK`, salvo la consulta de la idempotencia del
paso 2 cuando el choque llega por el índice (otra transacción confirmó entre medio): una segunda transacción de solo
lectura busca el código con la misma clave y el mismo DNI, y si falla responde 409 sin `detalles`, nunca 500.

### 7. Seguimiento (`SeguimientoService`)

- Controlador: pipe de la academia, `validarCon(consultarSolicitudSchema)`. Un token o un código con formato inválido no
  responde 400 sino el mismo 404 del criterio 31 (se valida la forma de la unión, no el contenido de cada campo).
- Con token: `hashToken(token)` y `SELECT … WHERE academia_id = … AND token_hash = …`. Con código y DNI: `SELECT … FROM
  solicitudes_inscripcion s JOIN alumnos a … WHERE s.academia_id = … AND s.codigo = … AND a.dni = …`. Una sola consulta
  en los dos casos, con la vista ya armada (plan, clases y matrícula con `JOIN`), sin bloqueo.
- Estado visible: `PENDIENTE_PAGO` con la matrícula vencida (`reserva_vence_en <= ahora`) → `VENCIDA`.
- `fotoCargada` = `alumnos.foto_clave IS NOT NULL`. En la 005a siempre es `false` (no hay ruta para subirla), pero el
  campo ya está en el esquema estricto para que la 005b no lo cambie.
- Sin auditoría (es una lectura). El registro técnico no lleva el código junto con el DNI ni el token.

### 8. Límites por IP (`instalarProteccionDePrefijos`)

Se amplía el middleware de `/${prefijoApi}/a` con una tabla de reglas `{ metodo, patron, nombre, ttl, limite }`
(`LIMITES_PUBLICOS`, junto a `LIMITE_INICIO_SESION`): `GET /^\/[^/]+\/?$/` y `GET /^\/[^/]+\/inscripcion\/?$/` comparten
la regla "lectura"; `POST …/inscripcion/cotizacion`, `POST …/inscripcion` y `POST …/solicitudes/consulta` tienen la
suya (005a); la regla de `PUT …/solicitudes/foto` se suma a la tabla en la 005b, con su ruta. Cuenta con `almacenLimite.increment(`publico-${nombre}:${ip}`, …)` antes de
`comprobarDireccion` y antes de leer el cuerpo, como el ingreso. Sin coincidencia, sigue como hoy. Las pruebas usan un
almacén limpio por prueba (como las de 002).

### 9. [005b] Foto (`FotoService`, `AlmacenArchivos`)

Toda esta sección es de la 005b.


- **Lector:** `instalarLectorDeCuerpos` recibe en `noLeerCuerpoEn` también `PUT /a/{nombreCorto}/solicitudes/foto`; un
  middleware propio en esa ruta, después del límite por IP, rechaza (400 `IMAGEN_NO_VALIDA`) un `Content-Type` que no
  sea `image/jpeg` o `image/png` o un `Content-Encoding` distinto de `identity`, y lee el cuerpo con
  `express.raw({ type: ['image/jpeg', 'image/png'], limit: '5mb', inflate: false })`; más de 5 MB → 413
  `CARGA_EXCESIVA` sin seguir leyendo.
- **Validación y proceso, antes de la transacción:** firma de los primeros bytes (`FF D8 FF` o `89 50 4E 47 0D 0A 1A
  0A`) coherente con el `Content-Type`; `sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' })`;
  `metadata()` para las dimensiones (100 a 8000 por lado); `.rotate().resize({ width: 800, height: 800, fit: 'inside',
  withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true })` sin `withMetadata()` (sharp no copia los metadatos
  si no se pide). Cualquier error de `sharp` → 400 `IMAGEN_NO_VALIDA`.
- **Flujo:** buscar la solicitud por el hash del token en una transacción corta de lectura (404 o 409 sin tocar
  archivos); `clave = academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`; `almacen.guardar`; después
  `conAcademia`: `SELECT … FOR UPDATE` de la solicitud y del alumno, volver a comprobar estado y vencimiento (si cambió,
  409), leer la clave anterior y `UPDATE alumnos SET foto_clave = …`; confirmar; borrar la anterior. Si la transacción
  falla, `almacen.borrar(clave nueva)`.
- **`AlmacenArchivosDisco`:** `ALMACEN_DIRECTORIO` (por defecto `backend/almacenamiento`, ya en `.gitignore`); la clave
  debe cumplir `^academias/[0-9a-f-]{36}/[a-z0-9/._-]+$`, su segundo segmento debe ser la academia recibida, y
  `path.resolve(raiz, clave)` debe quedar dentro de `path.resolve(raiz, 'academias', academiaId)` (con
  `fs.realpath` del directorio para no seguir enlaces simbólicos). Escribe con un nombre temporal y `rename` (sin
  archivos a medias). Crea carpetas con `fs.mkdir({ recursive: true })` (funciona en Windows).
- Se registra como proveedor de Nest con un token (`ALMACEN_ARCHIVOS`) para cambiar la implementación sin tocar los
  servicios (D-21). Las pruebas usan un directorio temporal por prueba.

### 10. Correo (`EnviadorCorreo`)

- Interfaz y token `ENVIADOR_CORREO`; `EnviadorCorreoSimulado` registra `info({ academiaId, plantilla }, 'Correo
  simulado')` y nada más (T8). La plantilla `SEGUIMIENTO_SOLICITUD` arma asunto y cuerpo con el nombre de la academia, el
  código y el enlace absoluto (`URL_PUBLICA_WEB` si existe; si no, solo la ruta: la decisión de la variable se toma con
  el hosting).
- Se llama después de `conAcademia` (efecto después de confirmar) y nunca dentro de `trabajo`.

### 11. Panel

De esta sección, solo "`ClasesService` (DR-5)" es de la 005a; la lista, la cancelación y la ocupación son de la 005b.

- **[005b] `SolicitudesService.listar`:** `conAcademia(sesion.academiaId)`; una consulta con `JOIN` a alumnos, matrículas,
  planes y `matricula_clases`/`clases` (con `array_agg` ordenado), filtro por estado calculado con `ahora`, `ORDER BY
  creado_en DESC, id DESC LIMIT 200`. Sin `bloquearActorVigente` (es lectura, como en 002 a 004).
- **[005b] `SolicitudesService.cancelar`:** `bloquearActorVigente` → validar el id (404 como AT-2 de 004) → `SELECT … FOR
  UPDATE` de la solicitud y de su matrícula → `bloquearClasesParaCupo(tx, clasesDeLaMatricula)` → si `CANCELADA`, 200
  sin escribir; si no es `PENDIENTE_PAGO`, 409 `SOLICITUD_NO_CANCELABLE`; si no, dos `UPDATE` y la auditoría.
- **`ClasesService` (DR-5, 005a):** en el `PATCH`, después de `bloquearClasesParaCupo` (que ya está, criterio 22 de 004) y de
  `cambiosPedidosClase`: si cambia `aforo` a un valor menor que `contarInscritos` y no viene `confirmarAforoMenor`,
  409 `AFORO_MENOR_QUE_INSCRITOS`; si viene, se guarda y la auditoría suma `inscritos` y `confirmacion`. Si pide
  `activo: false` y hay inscritos, 409 `CLASE_CON_INSCRITOS`. El orden de los 409 de 004 no cambia; estos dos van
  después de `ENTRENADOR_NO_VALIDO` y antes de escribir.
- **[005b] `GET /api/clases/ocupacion`:** `contarOcupacion` del mes en curso para todas las clases de la academia (sin
  bloqueo), con 0 para las que no tienen.

### 12. Web

- **Rutas públicas:** `/a/:nombreCorto/inscripcion`, `/a/:nombreCorto/solicitud` y `/a/:nombreCorto/solicitud/:token`,
  fuera de `RutaConSesion`. Un componente común de cabecera pública lee `GET /api/a/{nombreCorto}` con `staleTime: 0` y
  muestra nombre y teléfono (también en `PaginaIngresarAcademia`).
- **Formulario:** React Hook Form con `enviarInscripcionSchema` por pasos (cada paso valida su parte con `pick` del
  esquema). La edad se calcula con `esMenorDeEdad(fecha, hoy)`, con `hoy` de la respuesta de la API (no del reloj del
  navegador). La selección de clases filtra la oferta por nivel, días y franjas del plan, y limita a una por día.
  La cotización se pide al cambiar la selección (`useMutation`), y su `mes` y `monto` viajan en el envío. La
  `claveIdempotencia` se crea con `crypto.randomUUID()` al montar el formulario y se conserva en el estado.
  **[005b]** El paso de la foto: se sube con `fetch` (`PUT` con el cuerpo binario y la cabecera) después del 201, y el
  seguimiento ofrece reintentarla.
- **Seguimiento:** el token se lee del parámetro de la ruta, se manda en el cuerpo y se mantiene solo en memoria; la
  consulta no usa persistencia de TanStack Query. `<meta name="referrer" content="no-referrer">` en `index.html` (vale
  para toda la web; no afecta a la API, que está en el mismo dominio).
- **[005b] Panel:** `PaginaSolicitudes` con filtro y diálogo de cancelación; `GrillaSemanal` muestra "inscritos / aforo" con
  `GET /api/clases/ocupacion`; `FormularioClase` maneja `AFORO_MENOR_QUE_INSCRITOS` con un diálogo que reenvía con
  `confirmarAforoMenor: true`, y `CLASE_CON_INSCRITOS` con un mensaje. Claves con la identidad de la sesión. En la
  005a, `FormularioClase` no cambia: muestra esos dos 409 como cualquier error de la 004.
- Montos: `lib/dinero.ts` de la 004 (texto, sin `number`).

### 13. Semilla

En `delfines`, con `enAcademia`: tres clientes inventados (DNI `20000001` a `20000003`), uno menor con apoderado, con
solicitudes y matrículas sobre los planes y clases de la 004; el código y el hash del token se generan de forma fija a
partir de un texto de ejemplo (`hashToken('semilla-…')`), y el token no se imprime. Repetible con `ON CONFLICT DO
NOTHING` sobre `(academia_id, dni)` y `(academia_id, codigo)`. La reserva vigente se crea con `reserva_vence_en` lejana
(la semilla no usa `RELOJ`) y la vencida con una fecha pasada.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Reserva = matrícula `RESERVADA` con `reserva_vence_en` calculado al leer (D1) | Tarea programada que libera; contador en la clase | Nunca queda vieja; sin tarea; un solo lugar que cuenta |
| Alumno en estado `CLIENTE` desde la solicitud (D2) | Datos solo en la solicitud | Una sola copia de datos sensibles; DNI único por academia en una tabla |
| Cupo decidido al enviar, con las clases bloqueadas (D3) | Reservar al cotizar | La cotización es anónima y gratuita |
| `montoProporcional` con `bigint` en céntimos (D7) | `Decimal` con división intermedia | `200/3×3` daría 201 |
| Token con hash SHA-256 en la base; código de 6 caracteres (D5) | Token en claro; código de 5 | Un respaldo filtrado no abre los enlaces; mil millones de códigos por academia |
| Consulta por `POST` con el dato en el cuerpo (D6) | `GET /…/{token}` | El token no queda en los registros de la API ni del proxy |
| Bloqueos consultivos de IP y DNI antes de las filas y las clases | Solo el índice único del DNI | Ordena el reuso de un cliente y el límite por conexión sin `23505` en el camino normal |
| [005b] Foto en `PUT` binario con el token en una cabecera (DT-1) | Base64 en el JSON; `multipart` | No sube el límite de 100 KB de todo el JSON; un solo lector, solo en esa ruta |
| [005b] Foto guardada antes de la transacción, anterior borrada después (criterio 37) | Escribir el archivo después de confirmar | Un archivo sin referencia no lo ve nadie; una referencia a un archivo que no existe sí |
| [005b] Recodificar con `sharp` sin metadatos (criterio 35) | Guardar el original | Quita GPS de fotos de menores y contenido escondido |
| Actor `PUBLICO` (DT-2) | `SISTEMA` | No mezclar visitantes con tareas programadas |
| [005b] Ocupación en ruta aparte (D8, DT-5) | Campo en `claseSchema` | No tocar el contrato ni las pruebas protegidas de 004 |
| Límites por IP en el middleware de `/api/a` (criterio 33) | Guard de Nest | Cuentan antes de leer el cuerpo y de abrir transacciones, como el ingreso de 002 |
| Correo simulado sin destinatario ni enlace (DT-8) | Registrar el mensaje completo | El enlace es una credencial |

## Migraciones

- `<marca>_inscripcion_publica`: tipos nuevos, `tipo_actor` + `PUBLICO`, las siete tablas con `CHECK`, llaves
  compuestas, índices (únicos, parciales y de búsqueda), RLS forzada, políticas y privilegios (spec, "Cambios al modelo
  de datos"). Sin datos.

## Riesgos

- **Interbloqueos:** el envío toma bloqueos consultivos (IP, DNI), filas del cliente y clases; la cancelación toma
  actor, solicitud y clases; el `PATCH` de clases toma actor (y entrenador) y clases. Ninguna toma una clase y después
  otra cosa. El adversarial debe probar a la vez: envío y cancelación del mismo cliente, envío y `PATCH` de aforo o de
  `activo` sobre la misma clase, dos envíos cruzados de clases y de DNI.
- **Llaves foráneas y `FOR KEY SHARE`:** el `INSERT` de la matrícula toma `FOR KEY SHARE` sobre el plan y sobre las
  clases (estas ya están bloqueadas con `FOR UPDATE` por la misma transacción); el `PATCH` de un plan toma `FOR UPDATE`
  sobre el plan y no toca clases ni matrículas, así que no hay ciclo. Revisarlo si una historia hace que el `PATCH` de un
  plan toque matrículas.
- **`ALTER TYPE … ADD VALUE`** no se puede usar en la misma transacción: el valor `PUBLICO` solo se usa en la API.
- **[005b] `sharp` en Windows y en la integración continua:** binario por sistema operativo (D-26); la integración continua en
  Windows lo detecta. Si `npm ci` falla en alguna plataforma, se fija la versión.
- **[005b] Imágenes maliciosas:** `limitInputPixels`, el límite de 5 MB antes de decodificar y `failOn: 'error'`; `sharp` corre
  en el hilo de libuv, así que una imagen grande ocupa CPU: el límite de 10 por hora y por IP lo acota.
- **Coma flotante:** cualquier `Number(`, `parseFloat` o `+monto` en `matriculas/dominio` o en la web rompe el criterio 9;
  el revisor los busca.
- **Fechas:** `clasesRestantes` y `esMenorDeEdad` no pueden usar `new Date().getDay()`, `getFullYear()` ni la zona del
  proceso; el revisor busca `getDay`, `getDate` y `getMonth` en esos archivos.
- **Pruebas protegidas de 001 y 004 que cambian (solo para sumar):** en la 005a, criterio 58 de 001 (`telefono`),
  listas exactas de privilegios y tablas, `tipo_actor` y, si existe, la prueba de campos desconocidos de
  `actualizarClaseSchema`; en la 005b, la lista de dependencias permitidas del backend (`sharp`, criterio 127 de 001) y,
  si alguna lo fija, el lector de cuerpos (criterio 74 de 001). Si el tester encuentra otra, decide el orquestador.
- **IP detrás de un proxy** (DT-9): los límites de los criterios 25 y 33 dependen de `req.ip`. `trust proxy` se
  configura con el hosting antes de publicar el formulario (aviso en las notas de hosting de `specs/backlog.md`).
- **Entre los dos PR:** la 005a se puede unir a `main` sin la 005b. Mientras tanto no hay foto, la secretaria no lista
  ni cancela solicitudes desde el panel (las reservas sin pagar se liberan solas al vencer) y el administrador no puede
  bajar el aforo por debajo de los inscritos desde la web (la API lo permite con `confirmarAforoMenor`).
