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

**Ronda 1 del ataque de la 005a (20/11/2026):** criterios 49 a 53 y ajuste del 47. Cambian las secciones 1 (monto
cotizado), 6 (pasos 12 y 13), 8 (`HEAD`), 10 (correo sin esperar y su registro), 13 (semilla) y la nueva 14 (registro
técnico); y P10 (llaves primarias con `academia_id`, ya aplicada) en la sección 2.

**Respuestas del responsable a la ronda 1 (20/11/2026, DR-12 a DR-15):** criterios 54 a 60 y ajuste del 47 d. Cambian
las secciones 1 (vista reducida), 2 (migración nueva con el `CHECK`), 3 (`vencimientoDeReserva`), 6 (pasos 1, 7, 12 y
13), 7 (vista reducida), 8 (`claveDeConexion`), 10 (destinatarios), 12 (seguimiento sin nombre) y 13 (semilla), y la
nueva 15 (pruebas con IP fijada).

**Ronda 2 del ataque de la 005a (20/11/2026, commit `cf93533`):** sin fallas; el diseño no cambia. Suma tres riesgos
aceptados en la spec (y su eco en "Riesgos"), la pregunta R7 y, en "Migraciones", la nota operativa para la guía de
Windows y el PR (tarea T45 del documentador).

**Repaso de la 005b (21/11/2026, con la 005a unida a `main`, PR #8):** precisiones técnicas PB1 a PB14 de la spec, sin
cambios de negocio. Cambian, solo en lo marcado **[005b]**: "Módulos afectados" (nombres reales de la 005a y archivos
que toca la 005b), las secciones 8 (regla `foto`), 9 (orden de comprobaciones, bloqueos y fallos), 11 (lista,
cancelación y ocupación), 12 (foto y panel en la web) y 14 (cabecera del token), y "Decisiones" y "Riesgos". Las
preguntas B1 a B5 quedaron respondidas el 21/11/2026 con la propuesta de cada una (DR-17 a DR-21 de la spec), que es lo
que el plan ya seguía: el diseño no cambia. La cancelación no envía correo ni toca la foto (criterio 39, prueba h).

**Ronda 1 del ataque de la 005b (21/11/2026):** criterios 61 a 63 y ajustes de 36 y 37 (sección N de la spec,
AB1-1 a AB1-4). Cambian "Módulos afectados", la sección 9 (confirmación incierta de la foto y entorno), la 12
(`frontend/vite.config.ts`), la nueva 16 (proxy de PostgreSQL y servidor de Vite en las pruebas, almacén temporal),
"Decisiones" y "Riesgos".

**Ronda 2 del ataque de la 005b (21/11/2026):** criterios 64 a 66 y ajustes de 37, 61 y 62 (sección O de la spec,
AB2-1 a AB2-3). Cambian "Módulos afectados", la sección 9 (relectura con bloqueo y `resolverAlmacenDirectorio`), la 12
(`server.fs.deny`), la 16 (modo `retenerCommit` del proxy, pruebas de los enlaces de Vite y del entorno con
`path.win32`), "Decisiones" y "Riesgos".

## Módulos afectados

```
piscina/
├── packages/contratos/src/
│   ├── inscripcion.ts (+ .test.ts)       nuevo: formulario, cotización, listas, celular, esMenorDeEdad
│   ├── consentimientos.ts (+ .test.ts)   nuevo: versión, tipos y textos provisionales con el nombre de la academia
│   ├── solicitudes.ts (+ .test.ts)       nuevo: código, token, consulta, vista mínima; [005b] panel, cancelación
│   ├── fotos.ts (+ .test.ts)             [005b] nuevo: FOTO_TIPOS, FOTO_TAMANO_MAXIMO y demás límites, CABECERA_TOKEN_SOLICITUD (PB4)
│   ├── academias.ts                      AcademiaPublica + telefono
│   ├── clases.ts                         actualizarClaseSchema + confirmarAforoMenor; [005b] respuestaOcupacionSchema
│   └── index.ts                          + exportaciones
├── backend/
│   ├── package.json                      [005b] + sharp (D-25; DT-6)
│   ├── prisma/schema.prisma              + tipos y las siete tablas
│   ├── prisma/migrations/<marca>_inscripcion_publica/   tipos, tablas, CHECK, índices, RLS, políticas, privilegios
│   ├── prisma/migrations/<marca>_reserva_dentro_del_mes/   CHECK matriculas_reserva_dentro_del_mes (criterio 56)
│   ├── src/comun/http/conexion.ts (+ .test.ts)         claveDeConexion (criterio 59)
│   ├── prisma/seed.ts                    + solicitudes de ejemplo en delfines (criterio 47)
│   ├── src/infraestructura/prisma/privilegios-app.ts   + privilegios de las siete tablas
│   ├── src/infraestructura/prisma/tipos.ts, base-datos.ts   [005b, ronda 2] OpcionesTransaccion + esperaMaximaDeBloqueoMs (lock_timeout local; criterio 64)
│   ├── src/infraestructura/almacen-archivos/          [005b] nuevo: interfaz, disco local, módulo, claves
│   ├── src/infraestructura/correo/                    nuevo: interfaz, envío simulado, módulo
│   ├── src/infraestructura/entorno/entorno.ts         [005b] + ALMACEN_DIRECTORIO; ronda 1: rechazo dentro de lo que sirve la web (criterio 62 b);
│   │                                                  ronda 2: función pura resolverAlmacenDirectorio con las formas de Windows (criterio 66)
│   ├── src/crear-app.ts                               [005b] noLeerCuerpoEn suma PUT …/solicitudes/foto (además de DELETE /api/sesion)
│   ├── src/comun/http/cuerpos.ts                      sin cambios: ya recibe noLeerCuerpoEn
│   ├── src/comun/http/cuerpo-imagen.ts                [005b] nuevo: lector binario de la foto (5 242 880 bytes, sin inflar)
│   ├── src/infraestructura/registro/opciones-registro.ts   [005b] RUTAS_REDACTADAS + x-token-solicitud (y su prueba, largo 5)
│   ├── src/modulos/academias/limite-inicio-sesion.ts  LIMITES_PUBLICOS (005a); [005b] metodo + 'PUT' y regla foto
│   ├── src/modulos/academias/proteccion-de-prefijos.ts   límites por conexión de las rutas públicas (005a; la foto no necesita cambios)
│   ├── src/modulos/academias/academia-publica.controller.ts   + telefono
│   ├── src/modulos/auditoria/insercion.ts             actorTipo + 'PUBLICO'
│   ├── src/modulos/matriculas/                        nuevo (sin controlador)
│   │   ├── dominio/cobro.ts (+ .test.ts)              clasesRestantes, montoProporcional, calcularTotal (racional)
│   │   ├── dominio/reserva.ts (+ .test.ts)            finDelMesEnLima, vencimientoDeReserva (criterio 54)
│   │   ├── ocupacion.ts                               contarOcupacion, contarInscritos (sin Nest)
│   │   └── index.ts
│   ├── src/modulos/inscripciones/                     005a: dominio/ (seleccion, codigos con hashDeToken, cotizacion, destinatarios),
│   │                                                  lectura.ts, errores.ts, inscripcion-publica.controller.ts, inscripciones.service.ts,
│   │                                                  seguimiento.controller.ts y seguimiento.service.ts (con estadoVisible)
│   │   ├── seguimiento.controller.ts                  POST consulta; [005b] PUT foto
│   │   ├── solicitudes.controller.ts                  [005b] GET lista, POST cancelar (panel)
│   │   ├── [005b] solicitudes.service.ts · foto.service.ts · errores.ts (+ solicitudNoEditable, solicitudNoCancelable, imagenNoValida)
│   │   ├── [005b] estado visible compartido por seguimiento, foto, lista y cancelación (PB2), sacado de seguimiento.service.ts
│   │   └── inscripciones.module.ts · index.ts
│   ├── src/modulos/clases/clases.service.ts           DR-5 (criterios 41 y 42); [005b] GET /api/clases/ocupacion
│   └── test/
│       ├── utilidades/inscripciones.ts                crear clientes, solicitudes y matrículas; llenar clases (test-writer)
│       ├── utilidades/proxy-postgres.ts               [005b, ronda 1] proxy TCP que corta en el COMMIT (criterio 61; test-writer);
│       │                                              ronda 2: modo retenerCommit, pidRetenido, liberar() y descartar() (criterio 64)
│       └── integracion/inscripciones/                 pruebas protegidas y no protegidas
├── scripts/
│   ├── lib/rol-app.mjs                    + privilegios de las siete tablas
│   ├── lib/dependencias-backend.mjs       [005b] + sharp
│   └── test/integracion/migraciones.test.mjs   + las siete tablas en TABLAS_DESPUES_DE_MIGRAR
├── frontend/vite.config.ts                [005b, ronda 1] server.fs.allow con lista cerrada (criterio 62 a); ronda 2: server.fs.deny con
│                                          los valores por defecto y los enlaces de node_modules/@aquagestion (criterio 65)
├── vitest.config.mts (o el globalSetup compartido)   [005b, ronda 1] ALMACEN_DIRECTORIO temporal en las pruebas del backend (criterio 63)
├── e2e/playwright.config.ts               [005b, ronda 1] ALMACEN_DIRECTORIO temporal para la API de las E2E (criterio 63)
├── frontend/src/
│   ├── modulos/inscripcion/               nuevo: api.ts · hooks.ts · PaginaInscripcion.tsx · pasos/*.tsx · Inscripcion.test.tsx;
│   │                                      [005b] paso de la foto (por ejemplo pasos/PasoFoto.tsx) y subida tras el 201 (ConfirmacionInscripcion.tsx)
│   ├── modulos/seguimiento/               PaginaSeguimiento.tsx · PaginaConsultaSolicitud.tsx · VistaSeguimiento.tsx · Seguimiento.test.tsx; [005b] subir foto
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
  - `claseIds`: arreglo de 1 a 7 UUID sin repetidos; `mes`: `^\d{4}-(0[1-9]|1[0-2])$`; `montoMostrado`:
    `montoCotizadoSchema` (ronda 1, criterio 50); `claveIdempotencia`: `z.uuid()`.
- `dinero.ts` (ronda 1, criterio 50): `MONTO_COTIZADO_MAXIMO = '100000.00'` y `montoCotizadoSchema`: el mismo patrón de
  forma que `montoSchema` pero con hasta seis dígitos enteros (`^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?$`), mayor que 0
  (algún dígito distinto de cero, sobre el texto) y, si la parte entera tiene seis dígitos, que sea `100000` con
  decimales en cero (comparación sobre el texto, sin `Number`). `montoSchema` y `MONTO_MAXIMO` no se tocan (pruebas
  protegidas de 004). El máximo sale de `techo(99999.99 × n ÷ n) = 100000`; ninguna otra combinación lo supera porque
  `clasesTotales <= clasesPorMes`.
- `consentimientos.ts`: `VERSION_CONSENTIMIENTOS = '2026-11-v1-provisional'`; `textosConsentimiento(nombreAcademia,
  { menor })` devuelve los tres textos (el de datos personales nombra los datos de salud y, si es menor, los de menores y
  al apoderado como quien acepta). Textos inventados y genéricos (repositorio público).
- `solicitudes.ts`: `ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'`; `codigoSolicitudSchema` recorta y pasa a
  mayúsculas antes del `regex`; `consultarSolicitudSchema = z.union([z.strictObject({ token }), z.strictObject({
  codigo, dni })])`; `vistaSolicitudSchema` estricto con los campos del criterio 32. **Respuesta R3 (criterio 58):**
  `vistaSolicitudSchema = z.discriminatedUnion('estado', [vistaCompleta, vistaReducida])`, con `vistaCompleta`
  (`estado: z.literal('PENDIENTE_PAGO')`, con `reservaVenceEn`, `nombres` y `fotoCargada`) y `vistaReducida`
  (`estado: z.enum(['VENCIDA', 'CANCELADA'])`, sin esas tres claves), las dos con `z.strictObject` y una base común
  (`codigo`, `creadaEn`, `plan`, `clases`, `mes`, `clasesTotales`, `monto`, `esProporcional`). La 007 suma sus estados
  a una de las dos ramas según la regla "Vista de seguimiento" de la spec.
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

Precisiones de la spec (P4 y P5): `consentimientos` lleva `UNIQUE (academia_id, id)`, y el `GRANT UPDATE` de
`apoderados` y `fichas_medicas` no incluye `creado_en`.

P10 (decisión del orquestador, ya aplicada): PK `(academia_id, alumno_id)` en `apoderados` y `fichas_medicas`, y
`(academia_id, matricula_id, clase_id)` en `matricula_clases` (criterios 126, 131 y 142 de 001).

**Respuesta R1 (criterio 56, AT1-6): migración nueva `<marca>_reserva_dentro_del_mes`** (no se edita la de la 005a, ya
aplicada en las bases de desarrollo de la rama):

```sql
ALTER TABLE matriculas ADD CONSTRAINT matriculas_reserva_dentro_del_mes CHECK (
  reserva_vence_en IS NULL OR (
    CASE WHEN anio BETWEEN 2000 AND 9999 AND mes BETWEEN 1 AND 12
         THEN reserva_vence_en < ((make_date(anio, mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Lima')
         ELSE false END));
```

`timestamp AT TIME ZONE 'America/Lima'` da un `timestamptz` que no depende del `TimeZone` de la sesión (la prueba lo
comprueba con `SET TIME ZONE`). El `CASE` evita que `make_date` falle con `22008` antes de los `CHECK` de `anio` y `mes`
(mismo cuidado que `matriculas_fechas_del_mes`). Sin `GRANT` nuevos.

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
- `matriculas/dominio/reserva.ts` (respuesta R1, criterio 54): `finDelMesEnLima(ahora)` toma el mes de
  `hoyEnLima(ahora)`, arma el primer instante del mes siguiente con `new TZDate(anio, mes, 1, 'America/Lima')` (el
  `mes` de 1 a 12, usado como índice de 0 a 11, ya es el mes siguiente; el 12 pasa a enero del año siguiente) y le resta
  1 ms; `vencimientoDeReserva(ahora) = min(ahora + 24 h, finDelMesEnLima(ahora))`, comparando
  `getTime()`. Sin `getMonth`, `getDate` ni la zona del proceso. `RESERVA_SIN_PAGO_MS = 24 * 60 * 60 * 1000` queda en
  ese archivo, junto a la función.
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

1. Bloqueos consultivos, en este orden: conexión de origen (`claveDeConexion(ip)`, respuesta R4, criterio 60) y DNI
   (`pg_advisory_xact_lock(hashtextextended(…, 0))` con `$executeRaw`, criterio 155 de 001).
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
7. Límite por conexión: `count(*)` de solicitudes activas de la misma clave de conexión (con la matrícula que ocupa
   cupo) → 409 `LIMITE_DE_RESERVAS_PENDIENTES` si llega a 5. **Respuesta R4 (criterio 60):** la condición sobre
   `ip_origen` sale de la clave: si es una IPv4 `a.b.c.d`, `s.ip_origen IN ('a.b.c.d'::inet, '::ffff:a.b.c.d'::inet)`
   (la fila puede guardar cualquiera de las dos formas, porque `ipParaAuditoria` no convierte la mapeada); si es un
   bloque `p::/64`, `s.ip_origen <<= 'p::/64'::cidr AND NOT s.ip_origen <<= '::ffff:0:0/96'::cidr` (las mapeadas son
   IPv4, aunque caigan en `::/64`). Una `inet` IPv4 nunca está contenida en un `cidr` IPv6. Los valores van como
   parámetros, nunca concatenados.
8. `bloquearClasesParaCupo(tx, claseIds)`, una sola llamada.
9. `validarSeleccion` → 409 `SELECCION_NO_VALIDA`; `clasesRestantes` → 409 `SIN_CLASES_EN_EL_MES`.
10. `contarOcupacion` del mes en curso → 409 `SIN_CUPO` con todas las clases llenas.
11. `montoProporcional` y comparación con `montoMostrado` (`montosIguales`) → 409 `MONTO_CAMBIO` con la cotización.
12. Escrituras (una sentencia por tabla, sin bucles de escrituras de modelos):
    - solicitudes vencidas del cliente → `VENCIDA`; sus matrículas `RESERVADA` vencidas → `CANCELADA`;
    - alumno: `INSERT` (nuevo) o `UPDATE` de sus datos (cliente que vuelve); ficha: `INSERT … ON CONFLICT (academia_id,
      alumno_id) DO UPDATE` (P10); apoderado: lo mismo, o `DELETE` si ya es mayor;
    - solicitud: `INSERT … ON CONFLICT ON CONSTRAINT solicitudes_inscripcion_academia_id_codigo_key DO NOTHING
      RETURNING id`, con hasta 5 códigos nuevos si no vuelve fila (el choque de código solo da un resultado posible, así
      que vale el patrón de "Transacciones"); los demás índices únicos fallan con `23505`, y el 409 sale después del
      `ROLLBACK` por el nombre de la restricción (`restriccionDeUnicidadViolada`): `…_clave_idempotencia_key` →
      `SOLICITUD_YA_REGISTRADA` sin `detalles`; `alumnos_academia_id_dni_key` → `DNI_YA_REGISTRADO`;
    - matrícula `RESERVADA` (`reserva_vence_en = vencimientoDeReserva(ahora)`, respuesta R1, criterio 54) y
      `matricula_clases` en un solo `INSERT … SELECT unnest(…)`;
    - consentimientos en un solo `INSERT` de varias filas;
    - auditoría `SOLICITUD_INSCRIPCION_CREADA` (actor `PUBLICO`) con `insertarEnAuditoriaDeAcademia`.
13. Confirmar. Después, si hay correo, se inicia el envío **sin esperarlo** y se responde el 201 (ronda 1, criterios 51
    y 52; sección 10): la respuesta no depende del correo. Desde la respuesta R2 (criterio 57), un envío sin esperar por
    cada destinatario distinto (alumno y apoderado), con los correos del formulario.

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
- Estado visible: `PENDIENTE_PAGO` con la matrícula vencida (`reserva_vence_en <= ahora`) → `VENCIDA`. En `VENCIDA` y
  `CANCELADA` la vista no lleva la clave `reservaVenceEn` (P3). `nombres` es la primera palabra de `alumnos.nombres`
  (P2); `mes` va como `AAAA-MM` y `monto` como texto con dos decimales (P8).
- `fotoCargada` = `alumnos.foto_clave IS NOT NULL`. En la 005a siempre es `false` (no hay ruta para subirla), pero el
  campo ya está en el esquema estricto para que la 005b no lo cambie.
- **Respuesta R3 (criterio 58): vista reducida.** Con el estado visible `VENCIDA` o `CANCELADA`, la vista se arma sin
  `nombres`, `fotoCargada` ni `reservaVenceEn` (las claves no se crean; no se borran después de armarlas con datos). En
  la 005a eso coincide con "no es la vigente del cliente" (spec, criterio 58), así que no hace falta otra consulta. El
  plan, las clases, el mes y el monto salen de la matrícula de esa solicitud (`m.solicitud_id = s.id`), nunca de otra
  del mismo alumno.
- Sin auditoría (es una lectura). El registro técnico no lleva el código junto con el DNI ni el token.

### 8. Límites por IP (`instalarProteccionDePrefijos`)

Se amplía el middleware de `/${prefijoApi}/a` con una tabla de reglas `{ metodo, patron, nombre, ttl, limite }`
(`LIMITES_PUBLICOS`, junto a `LIMITE_INICIO_SESION`): `GET /^\/[^/]+\/?$/` y `GET /^\/[^/]+\/inscripcion\/?$/` comparten
la regla "lectura"; `POST …/inscripcion/cotizacion`, `POST …/inscripcion` y `POST …/solicitudes/consulta` tienen la
suya (005a); la regla de `PUT …/solicitudes/foto` se suma a la tabla en la 005b, con su ruta. Cuenta con `almacenLimite.increment(`publico-${nombre}:${ip}`, …)` antes de
`comprobarDireccion` y antes de leer el cuerpo, como el ingreso. Sin coincidencia, sigue como hoy. Las pruebas usan un
almacén limpio por prueba (como las de 002).

**Ronda 1 (criterio 49):** la comparación del método trata `HEAD` como `GET` (por ejemplo, una función
`metodoParaLimite(solicitud.method)` que devuelve `'GET'` para `HEAD`), así que `HEAD` cae en la misma regla y en la
misma clave del almacén (`publico-lectura:${ip}`). No se suma una regla por `HEAD` en `LIMITES_PUBLICOS` (contaría
aparte). La 005b, al sumar la foto (`PUT`), no necesita nada más.

**Respuesta R4 (criterio 59): clave de conexión.** La clave del almacén pasa a ser
`publico-${nombre}:${claveDeConexion(solicitud.ip ?? '')}`. `claveDeConexion` (`comun/http/conexion.ts`, pura):

- quita la zona (`%…`) si la hay; con `net.isIPv4`, devuelve la IPv4;
- con `net.isIPv6`, expande la dirección a sus 16 bytes con un analizador propio (o `net.SocketAddress`/`BlockList` si
  alcanza; sin dependencias nuevas): si los primeros 10 bytes son 0 y los dos siguientes `ff ff`, devuelve la IPv4 de
  los últimos 4; si no, toma los primeros 8 bytes y los escribe en forma canónica de RFC 5952 (minúsculas, sin ceros a
  la izquierda, la racha más larga de grupos en cero como `::`) seguida de `/64`;
- con cualquier otro texto, lo devuelve tal cual (como hoy, sin lanzar).

El límite del ingreso (`LIMITE_INICIO_SESION`) no cambia (pregunta R6). La regla de la foto de la 005b usa la misma
clave sin cambios.

**[005b] Regla de la foto (PB10).** En `limite-inicio-sesion.ts`, `LimitePublico.metodo` pasa a `'GET' | 'POST' | 'PUT'`
y `LIMITES_PUBLICOS` suma `{ nombre: 'foto', metodo: 'PUT', patron: /^\/[^/]+\/solicitudes\/foto\/?$/i, ttl: HORA,
limite: 10 }`. `proteccion-de-prefijos.ts` no cambia: la clave queda `publico-foto:${claveDeConexion(ip)}` y el 429 sale
antes del lector binario.

### 9. [005b] Foto (`FotoService`, `AlmacenArchivos`)

Toda esta sección es de la 005b. _(Ajustada en el repaso del 21/11/2026: PB3 a PB8.)_

- **Orden (PB3, criterio 34 a a g):** límite (sección 8) → tipo y codificación → tamaño → academia → token → estado →
  imagen. Las tres primeras son middlewares de Express, antes de Nest; las demás, el controlador y `FotoService`.
- **Lector:** `crear-app.ts` pasa a `instalarLectorDeCuerpos` un `noLeerCuerpoEn` que deja fuera `DELETE /api/sesion` y
  `PUT /a/{nombreCorto}/solicitudes/foto` (sin distinguir mayúsculas, con o sin barra final), así los tres middlewares
  de JSON no la tocan. Un middleware propio en esa ruta (`cuerpo-imagen.ts`), instalado después de los de los prefijos,
  rechaza con 400 `IMAGEN_NO_VALIDA` un tipo de medio que no esté en `FOTO_TIPOS` o un `Content-Encoding` que no falte
  ni sea `identity`, y lee el cuerpo con `express.raw({ type: () => true, limit: FOTO_TAMANO_MAXIMO, inflate: false })`
  (el tipo ya se comprobó); más de `FOTO_TAMANO_MAXIMO` → 413 `CARGA_EXCESIVA` sin seguir leyendo (con un
  `Content-Length` mayor, sin leer nada).
- **Controlador:** `@Put('foto')` en `SeguimientoController` (`a/:nombreCorto/solicitudes`), con `@HttpCode(204)`; la
  academia con `ResolverAcademiaPipe`; el token de `req.headers['x-token-solicitud']` (si no es un texto, o no cumple
  `PATRON_TOKEN`, el 404 de `solicitudNoEncontrada()`); el cuerpo como `Buffer` (vacío si no llegó nada).
- **Comprobación previa (PB5),** en un `conAcademia` corto de lectura, sin bloqueos y sin tocar archivos: la misma
  búsqueda por `token_hash` (`hashDeToken`) que la consulta, con la fila de la solicitud, su matrícula y el alumno; 404 si
  no está; 409 `SOLICITUD_NO_EDITABLE` si el estado visible (PB2, la misma función que el seguimiento, sacada a un
  archivo común) no es `PENDIENTE_PAGO`, la fila no es `PENDIENTE_PAGO` o el alumno no está en `CLIENTE`.
- **Imagen, fuera de transacción:** firma de los primeros bytes (`FF D8 FF` o `89 50 4E 47 0D 0A 1A 0A`) coherente con el
  tipo declarado; `sharp(buffer, { limitInputPixels: FOTO_PIXELES_MAXIMOS, failOn: 'error' })`; `metadata()` para las
  dimensiones (de `FOTO_LADO_MINIMO` a `FOTO_LADO_MAXIMO` por lado, incluidos); `.rotate().resize({ width:
  FOTO_LADO_GUARDADO, height: FOTO_LADO_GUARDADO, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85,
  mozjpeg: true })` sin `withMetadata()` ni `keepIccProfile()` (`sharp` no copia metadatos si no se pide). Cualquier
  error de `sharp` → 400 `IMAGEN_NO_VALIDA`, con un solo mensaje.
- **Guardar y confirmar (PB8):** `clave = academias/{academiaId}/alumnos/{alumnoId}/foto-${randomUUID()}.jpg`;
  `almacen.guardar` (si falla, 500 sin tocar la base). Después, `conAcademia`: `SELECT … FROM alumnos … FOR UPDATE` →
  `SELECT … FROM solicitudes_inscripcion … FOR UPDATE` (alumno antes que solicitud: es el orden del envío; al revés, una
  subida y un envío del mismo DNI se interbloquean) → leer la matrícula → repetir la comprobación (409 si cambió) →
  leer la clave anterior → `UPDATE alumnos SET foto_clave = …, actualizado_en = ahora`. Confirmar. Después, si había una
  anterior distinta, `almacen.borrar(anterior)`; si la transacción falló, `almacen.borrar(nueva)`. Un borrado que falla
  se registra con `registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, 'No se pudo borrar un archivo')`
  (sin el mensaje, que lleva la ruta) y no cambia la respuesta. Una subida correcta registra
  `registro.info({ academiaId }, 'Foto de la solicitud guardada')`. Sin auditoría.
- **Confirmación incierta (ronda 1 de la 005b, criterio 61, AB1-1).** El `catch` de la transacción de confirmación ya no
  borra el archivo nuevo sin más:
  - la clave anterior se guarda en una variable de fuera de `trabajo` en cuanto se lee (dentro de la transacción), para
    tenerla aunque `conAcademia` rechace después;
  - si el error es una de las respuestas que decide la transacción (`solicitudNoEditable()`, `solicitudNoEncontrada()`,
    `ErrorAcademiaNoEncontrada`, `ErrorAcademiaSuspendida`), se borra el nuevo y se relanza, como hoy;
  - con cualquier otro error: `registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, 'Confirmación de la
    foto incierta')` y una relectura en otro `conAcademia` _(ronda 2, criterio 64, AB2-1; antes decía "sin `FOR
    UPDATE`", y eso es justo lo que dejaba pasar un `COMMIT` tardío)_:
    `conAcademia(academiaId, trabajo, { esperaMaximaDeBloqueoMs: FOTO_ESPERA_RELECTURA_MS })` (constante del servicio,
    5000) y `SELECT foto_clave FROM alumnos WHERE academia_id = … AND id = … FOR SHARE`. _(Precisado en la ronda 3:)_ el
    servicio no ejecuta `SET LOCAL lock_timeout`, porque las reglas de lint `aquagestion-sql/sesion-en-modulos` y
    `set-config-app` lo prohíben en los módulos; la opción `esperaMaximaDeBloqueoMs` de `BaseDatos` (de la 001, ampliada
    aquí: `OpcionesTransaccion` en `infraestructura/prisma/tipos.ts`) ejecuta `set_config('lock_timeout', '<n>ms',
    true)` después de fijar el contexto y antes del trabajo, con el mismo efecto que `SET LOCAL` (local a la
    transacción). Acepta un entero de 1 a 60000; con otro valor lanza `RangeError` sin ejecutar el trabajo. La
    transacción no se abre como `READ ONLY` (PostgreSQL rechaza `FOR SHARE` en una de solo lectura) y no escribe nada.
    Si la transacción de
    confirmación sigue abierta en el servidor (su `COMMIT` está en camino o aplicándose), tiene la fila con `FOR
    UPDATE` y el `UPDATE`, así que la relectura espera a que confirme o revierta; la API solo envía el `COMMIT` después
    de que el `UPDATE` respondió, así que no hay un `COMMIT` posible sin la fila ya bloqueada. Un `55P03`
    (`lock_not_available`) o cualquier otro error de la relectura cae en "si la relectura rechaza";
  - si la relectura devuelve la clave nueva: `info` de subida correcta, borrar la anterior (si había y es distinta) con
    `borrarSinFallar` y terminar sin error (204);
  - si devuelve otra cosa: `borrarSinFallar(nueva)` y relanzar el error original (500 `ERROR_INTERNO` por el filtro
    global);
  - si la relectura rechaza: no borrar nada y relanzar el error original (500).

  La relectura no repite la comprobación de la solicitud: solo responde "¿quedó guardada esta clave?". La clave tiene un
  UUID nuevo y, con el bloqueo obtenido, la transacción que podía guardarla ya terminó: si no está ahora no lo estará
  nunca y borrarla es seguro. La relectura confirma su propia transacción en seguida (sin otra consulta), así que no
  deja el bloqueo `FOR SHARE` puesto más allá de la lectura.
- **Entorno (ronda 1 de la 005b, criterio 62 b, AB1-3).** `validarEntorno`, después de resolver `ALMACEN_DIRECTORIO`
  como hoy, rechaza la ruta si `path.relative(carpeta, almacen)` no empieza con `..` ni es absoluta para alguna de
  `{raíz}/frontend`, `{raíz}/packages` y `{raíz}/node_modules` (es decir, si es esa carpeta o queda debajo). En Windows
  se compara con las dos rutas pasadas a minúsculas. El problema nombra la variable y no muestra la ruta, como el del
  byte nulo. La lista de carpetas es la misma de `server.fs.allow` (sección 12; `packages/` entera, que incluye
  `packages/contratos/`).
- **Entorno (ronda 2 de la 005b, criterio 66, AB2-3).** `estaDentroDe` y el bloque de `ALMACEN_DIRECTORIO` de
  `validarEntorno` pasan a la función pura exportada `resolverAlmacenDirectorio(valor, { raiz, ruta })`, que recibe
  `path.win32` o `path.posix` y no usa `path` ni `process.platform` por su cuenta. `validarEntorno` la llama con
  `{ raiz: RAIZ_DEL_REPOSITORIO, ruta: path }` y suma el `problema`. Pasos:
  1. `valor?.trim()`; vacío → `backend/almacenamiento`. Con `/[\u0000-\u001f]/` → "no es una ruta válida".
  2. Si `ruta.sep === '\\'`: "no es una ruta válida" con `/^[\\/]{2}/`, con `/[<>"|?*]/`, con un `:` fuera de
     `/^[A-Za-z]:[\\/]/` (por ejemplo, quitar ese prefijo si está y buscar `:` en el resto), o si algún segmento de
     `valor.split(/[\\/]/)`, distinto de `''`, `.` y `..`, cumple `/[. ]$/`.
  3. `resuelta = ruta.resolve(raiz, valor)`. Para cada carpeta de `CARPETAS_DE_LA_WEB`, `carpeta = ruta.join(raiz,
     nombre)`; las dos se parten por `ruta.sep` sin segmentos vacíos. Está dentro si `resuelta` tiene al menos tantos
     segmentos como `carpeta` y cada segmento de `carpeta` es igual al de `resuelta` en esa posición, comparados con
     `toLowerCase()`, o (solo si `ruta.sep === '\\'`) el de `resuelta` cumple
     `/^[^~.]{1,6}~\d+(?:\.[^~.]{0,3})?$/`.
  4. Sin problema → `{ directorio: resuelta }`.

  Un solo problema por valor (el primero que aparece). El mensaje del byte nulo sigue siendo el mismo, ahora también
  para las formas de Windows.
- **`AlmacenArchivosDisco` (PB7):** `constructor(raiz)`; la API lo crea con `ALMACEN_DIRECTORIO` (entorno, por defecto
  `backend/almacenamiento`, ya en `.gitignore`). Valida la clave con el formato del criterio 36 (hasta 255 caracteres,
  `academias/{uuid}/` y segmentos `^[a-z0-9][a-z0-9_-]*(\.[a-z0-9]+)?$`) y que el UUID sea el `academiaId` recibido;
  `path.resolve(raiz, ...clave.split('/'))` debe quedar dentro de `path.resolve(raiz, 'academias', academiaId)`. Antes
  de leer, escribir o borrar, comprueba con `fs.lstat` que ni la carpeta de la academia ni las carpetas de debajo ni el
  archivo son enlaces simbólicos (en Windows, las uniones también dan `isSymbolicLink()`). `guardar` crea las carpetas
  con `fs.mkdir({ recursive: true })`, escribe `{archivo}.{uuid}.tmp` y hace `rename`; `borrar` ignora `ENOENT`. Todo
  rechazo es una promesa rechazada con un `Error` propio, sin la ruta en el mensaje.
- Se registra como proveedor de Nest con el token `ALMACEN_ARCHIVOS` (exportado en `almacen-archivos/index.ts`, junto con
  la interfaz y la clase), para cambiar la implementación sin tocar los servicios (D-21). Las pruebas lo reemplazan con
  `overrideProvider(ALMACEN_ARCHIVOS)` por un `AlmacenArchivosDisco` sobre un directorio temporal (o por uno que falla, para
  el criterio 37); la utilidad `crearAppInscripciones` puede sumar esa opción, como `correo`.

### 10. Correo (`EnviadorCorreo`)

- Interfaz y token `ENVIADOR_CORREO`; `EnviadorCorreoSimulado` registra `info({ academiaId, plantilla }, 'Correo
  simulado')` y nada más (T8). La plantilla `SEGUIMIENTO_SOLICITUD` arma asunto y cuerpo con el nombre de la academia, el
  código y el enlace absoluto (`URL_PUBLICA_WEB` si existe; si no, solo la ruta: la decisión de la variable se toma con
  el hosting).
- Se llama después de `conAcademia` (efecto después de confirmar) y nunca dentro de `trabajo`.
- **Ronda 1 (criterio 51): sin esperar.** Una función `enviarSinEsperar(correo, mensaje, registro)` que hace
  `void Promise.resolve().then(() => correo.enviar(mensaje)).catch((error) => registrarFallo(error))`: el `then`
  convierte un error síncrono en rechazo, el `catch` impide un `unhandledRejection`, y el servicio no hace `await` de
  esa promesa. Límite fijo: **la respuesta no espera nada** (0 ms) al correo; la prueba usa 2 s solo como margen. Sin
  temporizadores que mantengan vivo el proceso. El correo se arma (asunto, cuerpo y enlace) antes de iniciar el envío,
  con datos ya leídos, sin volver a la base.
- **Ronda 1 (criterio 52): registro del fallo.** `registrarFallo` escribe
  `registro.warn({ academiaId, plantilla, error: { tipo: tipoDeError(error) } }, 'No se pudo enviar el correo')`, con
  `tipoDeError(valor)`: si es un `Error`, `Object.getPrototypeOf(valor)?.constructor?.name` si cumple
  `^[A-Za-z_$][A-Za-z0-9_$]{0,63}$` y si no `'Error'` (nunca `valor.name`, que puede ser una propiedad propia con datos);
  si no es un `Error`, `typeof valor`. Nunca `errorParaRegistro`, el mensaje, la pila, la `cause` ni las propiedades.
  La lectura del constructor va en un `try` (un `Proxy` o un getter que lanza devuelven `'Error'`).
- **Respuesta R2 (criterio 57): destinatarios.** `destinatariosDelEnlace(cuerpo)` devuelve, sin repetir, el
  `alumno.correo` y el `apoderado.correo` que vengan (ya recortados y en minúsculas por el esquema), comparando el texto
  exacto. Por cada uno, una llamada a `enviarSinEsperar` con el mismo mensaje salvo `para`; cada una atrapa y registra
  su propio fallo, así que una no detiene a la otra. Sin `Promise.all` ni `await`.

### 11. Panel

De esta sección, solo "`ClasesService` (DR-5)" es de la 005a; la lista, la cancelación y la ocupación son de la 005b.

- **[005b] `SolicitudesService.listar` (PB11):** `conAcademia(sesion.academiaId)`; una consulta con `JOIN` a alumnos,
  matrículas (`m.solicitud_id = s.id`), planes y una subconsulta `jsonb_agg` de `matricula_clases`/`clases` ordenada por
  día y hora (como `SeguimientoService`), con `to_char(hora, 'HH24:MI')`. El filtro va en SQL con la misma regla del
  estado visible (PB2) y `ahora` de `RELOJ` como parámetro: `ACTIVAS` = fila `PENDIENTE_PAGO` y matrícula `RESERVADA`
  con `reserva_vence_en IS NULL OR reserva_vence_en > ahora`; `VENCIDAS` = fila `VENCIDA` o fila `PENDIENTE_PAGO` con la
  matrícula `RESERVADA` vencida; `CANCELADAS` = fila `CANCELADA` o fila `PENDIENTE_PAGO` con la matrícula `CANCELADA`.
  `ORDER BY s.creado_en DESC, s.id DESC LIMIT 200`. El `estado` y `reservaVenceEn` de cada elemento se arman con la
  función común; `menorDeEdad` con `esMenorDeEdad(fecha_nacimiento, hoyEnLima(ahora))`; `monto` con
  `coalesce(monto_ajustado, monto_calculado)::text`. El controlador valida solo `req.query.estado` con
  `filtroEstadoSolicitudesSchema` (un arreglo o un valor desconocido → 400 en `estado`). Sin `bloquearActorVigente` (es
  lectura, como en 002 a 004) y sin auditoría.
- **[005b] `SolicitudesService.cancelar` (PB12):** el controlador valida el cuerpo con `cancelarSolicitudSchema` y pasa el
  `id` crudo. En un `conAcademia`: `bloquearActorVigente(tx, actorDeSesion(sesion), { registro, ip })` → id que no es
  UUID: 404 `NO_ENCONTRADO` (como AT-2 de 004) → `SELECT … FROM solicitudes_inscripcion WHERE academia_id = … AND id = …
  FOR UPDATE` (404 si no hay fila) → `SELECT … FROM matriculas WHERE … solicitud_id = … FOR UPDATE` →
  `bloquearClasesParaCupo(tx, clasesDeLaMatricula)` → estado visible `CANCELADA`: 200 con la solicitud, sin escribir;
  fila que no es `PENDIENTE_PAGO`: 409 `SOLICITUD_NO_CANCELABLE`; si no, `UPDATE solicitudes_inscripcion SET estado = 'CANCELADA',
  actualizado_en = ahora` y, si la matrícula está `RESERVADA`, `UPDATE matriculas SET estado = 'CANCELADA',
  reserva_vence_en = NULL, actualizado_en = ahora` (el `CHECK matriculas_reserva_coherente` lo exige), y la auditoría
  `SOLICITUD_INSCRIPCION_CANCELADA` con `registrarEnAcademia` (actor `USUARIO`, `motivo`, `datosAntes: { estado }` con el
  estado visible anterior, `datosDespues: { estado: 'CANCELADA' }`, `ip: ipParaAuditoria(ip)`). La respuesta se arma con
  la misma consulta de la lista, por id, dentro de la transacción. No toma `alumnos` ni los bloqueos consultivos del
  envío, así que no entra en ciclo con el envío (que toma alumno → solicitudes → matrículas → clases) ni con la foto
  (alumno → solicitud).
- **`ClasesService` (DR-5, 005a):** en el `PATCH`, después de `bloquearClasesParaCupo` (que ya está, criterio 22 de 004) y de
  `cambiosPedidosClase`: si cambia `aforo` a un valor menor que `contarInscritos` y no viene `confirmarAforoMenor`,
  409 `AFORO_MENOR_QUE_INSCRITOS`; si viene, se guarda y la auditoría suma `inscritos` y `confirmacion`. Si pide
  `activo: false` y hay inscritos, 409 `CLASE_CON_INSCRITOS`. El orden de los 409 de 004 no cambia; estos dos van
  después de `ENTRENADOR_NO_VALIDO` y antes de escribir.
- **[005b] `GET /api/clases/ocupacion` (PB13):** en `ClasesController` (`@Get('ocupacion')`, que no choca con
  `PATCH :id`), con `@Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')`. Un `conAcademia` de lectura: los ids y el aforo de
  todas las clases de la academia (activas o no), `contarInscritos(tx, ids, ahora)` para `inscritos` y
  `contarOcupacion(tx, ids, mesEnCurso, ahora)` para `cuposRestantes = max(0, aforo − ocupación)`. Sin bloqueo (es
  informativo: el cupo se decide al enviar) y sin auditoría.

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
  seguimiento ofrece reintentarla. _(Precisado el 21/11/2026, PB14:)_ el paso valida tipo y tamaño con `FOTO_TIPOS` y
  `FOTO_TAMANO_MAXIMO` de `fotos.ts` antes de subir; la vista previa usa `URL.createObjectURL` y `revokeObjectURL` al
  cambiar o desmontar; la subida usa el `token` del 201 en `CABECERA_TOKEN_SOLICITUD` y `file.type` en `Content-Type`, sin
  pasar por el cliente JSON de la web; un fallo de la foto no oculta el código ni el enlace. En el seguimiento, el mismo
  componente de subida aparece solo con la vista completa y, tras el 204, invalida la consulta del seguimiento.
- **Seguimiento:** el token se lee del parámetro de la ruta, se manda en el cuerpo y se mantiene solo en memoria; la
  consulta no usa persistencia de TanStack Query. `<meta name="referrer" content="no-referrer">` en `index.html` (vale
  para toda la web; no afecta a la API, que está en el mismo dominio). **Respuesta R3 (criterio 58):** con la vista
  reducida, `VistaSeguimiento` no muestra el saludo con el nombre (hoy "Hola, {nombres}") y su prueba de componentes
  cubre los dos casos.
- **[005b] Panel:** `PaginaSolicitudes` con filtro y diálogo de cancelación; `GrillaSemanal` muestra "inscritos / aforo" con
  `GET /api/clases/ocupacion`; `FormularioClase` maneja `AFORO_MENOR_QUE_INSCRITOS` con un diálogo que reenvía con
  `confirmarAforoMenor: true`, y `CLASE_CON_INSCRITOS` con un mensaje. Claves con la identidad de la sesión. En la
  005a, `FormularioClase` no cambia: muestra esos dos 409 como cualquier error de la 004. _(Precisado el 21/11/2026,
  PB14:)_ `PaginaPanel` suma dos opciones con `REGISTRAR_INSCRIPCION_Y_COBRO`: "Solicitudes de inscripción"
  (`/panel/solicitudes`) y "Nueva inscripción", con la dirección pública armada con `usuario.academia.nombreCorto`. La
  ruta `/panel/solicitudes` va en `Rutas.tsx` dentro de `RutaConSesion`, como las demás del panel. "Cancelar" se ofrece
  en `PENDIENTE_PAGO` y `VENCIDA`; un 409 `SOLICITUD_NO_CANCELABLE` (la fila `VENCIDA` del criterio 21 b, que la web no
  distingue) se muestra con un mensaje y se vuelve a pedir la lista. Claves: `['solicitudes', nombreCorto, usuarioId,
  estado]` y `['ocupacion', nombreCorto, usuarioId]`; un cambio de clase invalida las dos de clases y ocupación.
- Montos: `lib/dinero.ts` de la 004 (texto, sin `number`).
- **[005b, ronda 1] Servidor de desarrollo (criterio 62 a, AB1-3).** En `frontend/vite.config.ts`, dentro de `server`,
  `fs: { allow: [path.join(raiz, 'frontend'), path.join(raiz, 'packages', 'contratos'), path.join(raiz,
  'node_modules')] }` (con `raiz` ya calculada en el archivo). Vite deja de usar la raíz del workspace como permitida y
  agrega solo su propio cliente; el `cacheDir` por defecto (`frontend/node_modules/.vite`) queda dentro de `frontend/`.
  `strict` y `deny` no se tocan (se quedan los valores por defecto de Vite). `preview` no cambia. Si una dependencia
  futura se resuelve fuera de esas carpetas (por ejemplo, otro paquete del workspace), se suma a la lista de las dos
  partes (Vite y `validarEntorno`) en la historia que lo traiga; las E2E, que usan este servidor, lo detectan.
- **[005b, ronda 2] Enlaces de los workspaces (criterio 65, AB2-2).** En el mismo `fs`, `deny: [...DENY_POR_DEFECTO_DE_VITE,
  '**/node_modules/@aquagestion', '**/node_modules/@aquagestion/**']`, con `DENY_POR_DEFECTO_DE_VITE` copiado de la
  versión de Vite del repositorio (hoy `.env`, `.env.*`, `*.{crt,pem,key,p12,pfx,cer,der}`, `.npmrc`, `.yarnrc.yml` y
  `**/.git/**`): Vite reemplaza la lista entera si la configuración trae una (no la fusiona), y la prueba del 62 a
  avisa si una actualización de Vite suma valores que la copia no tiene. Vite convierte los patrones sin `/` en
  `**/{patrón}` y los compara con `nocase` y `dot`. `allow`, `strict`, `resolve.preserveSymlinks` y `preview` no
  cambian. Comprobar a mano con `npm run dev` que la web carga y que los contratos se piden por
  `/@fs/{raíz}/packages/contratos/…`.

### 13. Semilla

En `delfines`, con `enAcademia`: tres clientes inventados (DNI `20000001` a `20000003`), uno menor con apoderado, con
solicitudes y matrículas sobre los planes y clases de la 004; el código y el hash del token se generan de forma fija a
partir de un texto de ejemplo (`hashToken('semilla-…')`), y el token no se imprime. Repetible con `ON CONFLICT DO
NOTHING` sobre `(academia_id, dni)` y `(academia_id, codigo)`. **Respuesta R1 (criterio 47 d, AT1-10; reemplaza la
reserva vigente "con `reserva_vence_en` lejana" de la versión anterior):** las matrículas de ejemplo son del mes en curso según
`hoyEnLima(new Date())` (la semilla no usa `RELOJ`); la reserva vigente vence en `finDelMesEnLima(new Date())` y la
vencida en un instante anterior al de sembrar (por ejemplo, una hora antes). El `CHECK` del criterio 56 rechaza
cualquier otra cosa.

**Ronda 1 (criterio 47, ajustado).** Propuesta concreta, que cumple 47 a) a c):

- `CLASES_DE_EJEMPLO` suma tres clases de Básico con el entrenador `10000005` y aforo 30: miércoles 18:00, martes 18:00
  y jueves 18:00. Así el plan de 3 veces (lunes, miércoles y viernes) tiene Básico lunes, miércoles y viernes a las
  18:00, y el de 2 veces (martes y jueves), Básico martes y jueves a las 18:00.
- La prueba de la semilla de 004 sigue pasando: el bloque del miércoles a las 18:00 queda con dos clases (Avanzado con
  `10000003` y Básico con `10000005`: niveles y entrenadores distintos, también para `clases_entrenador_bloque_activo_key`);
  el lunes sigue teniendo una sola clase de Básico (la que la prueba desactiva); no se suman usuarios (002).
- `CLASES_DE_LOS_CLIENTES` pasa a lunes, miércoles y viernes a las 18:00 (tres clases para el plan de 3 veces), y
  `monto_calculado` se calcula con `montoProporcional` del dominio (no un literal), con `clases_totales` 8 de 12.
- Una base de desarrollo sembrada antes de este cambio conserva sus clientes de ejemplo con dos clases (la semilla no
  pisa lo existente); las clases nuevas sí se agregan, porque faltan.
- Prueba no protegida en `backend/test/integracion/semilla/` (como la de 004): después de `db:semilla`, para cada plan de
  ejemplo, con `RELOJ` fijo en el día 1 del mes en curso a las 00:00 de Lima, cotizar y enviar un formulario con una
  selección de las clases sembradas (DNI nuevo, inventado) responde 201.

### 14. Registro técnico (ronda 1, criterio 53)

- `RUTAS_REDACTADAS` (`infraestructura/registro/opciones-registro.ts`) suma `'req.headers.referer'`, con el mismo
  `TEXTO_REDACTADO`. Vale para toda la API y todos los niveles, porque la redacción de `pino` se aplica al serializar.
- La prueba no protegida `opciones-registro.test.ts` cambia el largo esperado de 3 a 4 y comprueba la nueva ruta.
- **[005b]** Al sumar `PUT …/solicitudes/foto`, se suma `'req.headers["x-token-solicitud"]'` a la misma lista (criterio
  28, parte de la 005b). _(Precisado el 21/11/2026, PB9:)_ vale para toda la API; la prueba no protegida
  `opciones-registro.test.ts` cambia el largo esperado de 4 a 5 y comprueba la nueva ruta, en el mismo cambio. Express
  entrega las cabeceras en minúsculas, así que basta esa forma.
- No se usa un serializador propio de `req` (alternativa descartada): cambiaría la forma de la línea de petición que ya
  revisan las pruebas de 002 y dejaría fuera los registros que no pasan por ese serializador.

### 15. Pruebas con la IP fijada (respuesta R4, criterios 59 y 60)

- Hoy todas las pruebas llegan desde `127.0.0.1` o `::ffff:127.0.0.1`. Para probar bloques /64 y formas mapeadas, la
  utilidad de pruebas crea la app con una opción (por ejemplo `crearAppInscripciones({ conLimites: true, ipPorCabecera:
  true })`) que hace `app.getHttpAdapter().getInstance().set('trust proxy', 'loopback')`; así `req.ip` sale de
  `X-Forwarded-For` (Express no la normaliza, así que llegan tal cual las formas con mayúsculas o ceros). La app real no
  cambia: `trust proxy` se decide con el hosting (DT-9).
- El código de producción debe tomar la IP solo de `req.ip` (nunca de `req.socket.remoteAddress` ni de cabeceras), para
  que esa opción la controle. Hoy ya es así en `proteccion-de-prefijos.ts` y en los controladores.
- Las pruebas unitarias de `claveDeConexion` y `vencimientoDeReserva` no necesitan la app.

### 16. [005b] Pruebas de la ronda 1 del ataque (criterios 61 a 63)

- **Proxy de PostgreSQL (criterio 61, AB1-2).** Utilidad protegida nueva del test-writer, partiendo de la del
  adversarial (`ProxyPg`): un `net.Server` en `127.0.0.1:0` que, por cada conexión, abre otra al host y puerto de
  `DATABASE_URL_APP` y reenvía en los dos sentidos. Lee los mensajes del cliente con su largo: primero los mensajes sin
  tipo (si el primero es `SSLRequest` o `GSSENCRequest`, el servidor contesta un byte y llega otro mensaje sin tipo, el
  `StartupMessage`); después, mensajes con tipo. En los `Q` y `P` busca, ya armado, un `UPDATE` de `alumnos` que
  mencione `foto_clave` (por ejemplo `/\bUPDATE\s+(?:"?public"?\.)?"?alumnos"?\b[\s\S]*\bfoto_clave\b/i`) y marca esa
  conexión; el siguiente `COMMIT` de esa conexión aplica el modo (`cortarTrasCommit` espera el `CommandComplete`
  `COMMIT` del servidor, `cortarAntesDelCommit` no lo reenvía, `caer` corta y además cierra todo y rechaza conexiones
  hasta `restablecer()`). Un `ROLLBACK` quita la marca. Cuenta los cortes. La aplicación se crea con la URL del proxy
  (como lo hizo el adversarial con `crearAppConAlmacen`) y la variable se restaura en seguida; las utilidades que
  escriben como dueño siguen yendo directo. `cerrar()` destruye las conexiones abiertas antes de cerrar el servidor.
- **Servidor de Vite (criterio 62).** Como el `vite-fs.mjs` del adversarial, pero con `createServer` importado desde el
  `vite` del repositorio, `configFile` el `frontend/vite.config.ts` real, `server: { port: 0, strictPort: false, hmr:
  false, watch: null }`, `cacheDir` temporal y `optimizeDeps: { noDiscovery: true, include: [] }`, `logLevel:
  'silent'`. Las rutas `/@fs/` se arman con la ruta absoluta pasada a `/` (en Windows, `/@fs/C:/…`). El archivo del
  almacén se crea con carpetas de UUID nuevos dentro de `backend/almacenamiento/academias/` y se borra en un `finally`.
  El proyecto `scripts` de Vitest corre en Node y en la integración continua de Windows.
- **Almacén temporal en las pruebas (criterio 63, AB1-4).** En `vitest.config.mts`, el `env` de los proyectos de
  `backend/` suma `ALMACEN_DIRECTORIO` con un directorio de `fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-almacen-'))`
  creado al cargar la configuración, y el `globalSetup` compartido lo borra al terminar (o se crea y se borra en ese
  `globalSetup`, si se prefiere; lo que importa es que la variable llegue a los procesos de prueba). En
  `e2e/playwright.config.ts`, el `env` del servidor `API` suma `ALMACEN_DIRECTORIO` con un directorio temporal, que el
  `globalTeardown` (nuevo o el existente) borra. Las utilidades que ya usan un directorio temporal propio
  (`crearAppConAlmacen`) no cambian.

### 17. [005b] Pruebas de la ronda 2 del ataque (criterios 64 a 66)

- **Proxy con `retenerCommit` (criterio 64, AB2-1).** En `proxy-postgres.ts`, en el mismo commit de pruebas protegidas:
  - `Puente` lee, en `alRecibirDelServidor`, el mensaje `K` (`BackendKeyData`: `Int32` pid e `Int32` clave) y guarda
    el `pid`.
  - En `alMensajeDelCliente`, si `tomarModo()` da `'retenerCommit'`, el puente pasa a "reteniendo": guarda el mensaje
    del `COMMIT` (y, si es un `P`, también los que siguen en `bufferCliente` y en los `data` siguientes hasta un `S`
    incluido), cuenta un corte, destruye solo el socket del cliente y avisa al proxy (`proxy.retener(this)`). Mientras
    retiene, `cliente.on('close')` no llama a `cerrar()` y lo que llega del servidor no se reenvía.
  - `ProxyPostgres` guarda el puente retenido y expone `pidRetenido`, `liberar()` (escribe lo guardado en el socket del
    servidor, espera el `C` con `COMMIT`, cierra y resuelve) y `descartar()` (destruye el socket del servidor y resuelve
    en su `close`). `cerrar()` incluye el retenido.
  - Los modos del criterio 61 no cambian; la prueba de la ronda 1 sigue igual.
- **Espera comprobada:** como `conFilaRetenida` de `carreras.ts`, un cliente propio de `pg` (dueño) consulta cada pocos
  milisegundos `SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))` con `pidRetenido`, con un
  límite de seguridad, mientras la promesa de la subida sigue sin terminar (`observar`).
- **Caso 3 (espera agotada):** la prueba no fija tiempos; solo espera la respuesta con un plazo de Vitest amplio
  (60 s), porque la API responde a los 5 s de `lock_timeout`.
- **Cómo se fija `lock_timeout` (precisado en la ronda 3):** no con `SET LOCAL` en `foto.service.ts` (lo prohíben las
  reglas de lint `aquagestion-sql/sesion-en-modulos` y `set-config-app` en los módulos), sino con la opción
  `esperaMaximaDeBloqueoMs` de `BaseDatos.conAcademia` (sección 9). Las pruebas protegidas del criterio 64 no dependen
  de cómo se fija: comprueban la espera en `pg_blocking_pids` y la respuesta del caso 3. El adversarial de la ronda 3
  comprobó además que el valor no sobrevive a la transacción: la siguiente en la misma conexión vuelve a 0.
- **Enlaces de Vite (criterio 65).** Archivo nuevo junto a `scripts/test/vite-no-sirve-almacen-ronda1-005b.test.mjs`,
  con el mismo arranque del servidor y del archivo del almacén (puede copiar sus funciones de apoyo; no lo modifica).
  La precondición usa `fs.lstatSync` y `fs.realpathSync` sobre `{raíz}/node_modules/@aquagestion/{backend,e2e,scripts}`.
  Para la base64, se compara con `Buffer.from(imagen).toString('base64')` (también un trozo del medio, por si la
  respuesta la parte). El módulo que importa los contratos se pide transformado y se busca en su código la primera
  dirección que contenga `contratos`.
- **Entorno (criterio 66).** Archivo nuevo junto a `entorno-almacen-web-ronda1-005b.test.ts`, que importa
  `resolverAlmacenDirectorio` de `./entorno` y usa `path.win32` y `path.posix` de `node:path`; la parte de
  `validarEntorno` en Windows va con `it.runIf(process.platform === 'win32')`.

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
| `HEAD` comparte la regla y el contador de `GET` (ronda 1, AT1-1) | Regla aparte para `HEAD`; 405 a `HEAD` | Un solo límite real de lectura; no cambia Express en toda la API |
| `montoCotizadoSchema` con tope 100000.00 (ronda 1, AT1-2) | Subir `MONTO_MAXIMO` de 004 | No permite precios de 100000 ni toca pruebas protegidas de 004 |
| El 201 no espera al correo (ronda 1, AT1-3) | Esperar con un tiempo máximo | Un proveedor lento retendría cada 201; el resultado del correo no cambia la respuesta |
| Fallo del correo con solo el tipo del error (ronda 1, AT1-4) | `errorParaRegistro` | Devuelve el `Error` completo, con mensaje y propiedades del proveedor |
| `Referer` redactado en toda la API (ronda 1, AT1-5) | Solo en las rutas públicas; serializador propio | El navegador lo manda a cualquier ruta; la redacción de `pino` cubre todos los registros |
| Vencimiento con tope de fin de mes en una función pura y `CHECK` en una migración nueva (DR-12, AT1-6) | Solo la función; tarea programada; editar la migración de la 005a | La base garantiza "nunca una reserva vigente de un mes cerrado"; sin tareas; no cambia una migración ya aplicada |
| Un `enviar` por destinatario distinto (DR-13, AT1-7) | Una llamada con varios destinatarios | La interfaz no cambia y un fallo no arrastra al otro envío |
| Vista reducida sin `nombres` ni `fotoCargada`, unión por estado (DR-14, AT1-8) | `nombres: null`; dejar `fotoCargada` | P3 quita claves; `fotoCargada` describe al alumno actual, no a esa solicitud |
| `claveDeConexion` en el almacén, el bloqueo y el conteo; `ip_origen` exacta (DR-15, AT1-9) | Columna nueva con la clave; guardar solo el /64 | Sin migración de columnas ni cambios en pruebas de catálogo; se conserva la dirección exacta |
| Reserva de la semilla hasta el fin del mes (AT1-10) | 24 horas, como el formulario | El ejemplo dura lo más posible sin cruzar el mes |
| [005b] Foto: token y estado antes de decodificar; tipo, codificación y tamaño antes de la academia (PB3) | Decodificar primero; buscar la academia antes del lector | No se gasta CPU en tokens que no sirven; el lector de cuerpos corre antes de Nest, como el JSON |
| [005b] Transacción de la foto: alumno y después solicitud (PB8) | Solicitud y después alumno (lo que decía el plan) | Mismo orden que el envío: sin `40P01` entre una subida y un envío del mismo DNI |
| [005b] Cancelar: la fila `VENCIDA` da 409 (PB12) | Cancelar también la fila `VENCIDA` | Es lo que dice el contrato ("ya no está `PENDIENTE_PAGO` ni `CANCELADA`"); esa solicitud ya no ocupa nada |
| [005b] Ocupación: `inscritos` con `contarInscritos` y cupos con `contarOcupacion` (PB13) | Solo `contarOcupacion` | La grilla y el diálogo de DR-5 muestran la misma cifra que los 409; desde la 010 hay meses siguientes |
| [005b] Constantes de la foto en `packages/contratos` (PB4) | Repetirlas en la web y en la API | La web avisa antes de subir con los mismos límites que aplica la API |
| [005b, ronda 1] Confirmación incierta: releer `foto_clave` antes de borrar (AB1-1, criterio 61) | Borrar siempre el nuevo; no borrar nada sin releer; referencia "pendiente" en dos pasos | Nunca una referencia a un archivo borrado, 204 si la foto quedó, sin migración |
| [005b, ronda 1] Proxy TCP de prueba que corta en el `COMMIT` (AB1-2) | Envolver `BaseDatos` con `overrideProvider` | Caja negra (solo `DATABASE_URL_APP` y el protocolo), reproduce la falla real, determinista |
| [005b, ronda 1] `server.fs.allow` con lista cerrada y rechazo en `validarEntorno` (AB1-3, criterio 62) | `server.fs.deny` con el directorio del almacén; almacén por defecto fuera del repositorio | Sin globs con rutas de Windows; protege todo `backend/`; Bryan conserva su carpeta de desarrollo |
| [005b, ronda 1] `ALMACEN_DIRECTORIO` temporal en la configuración de las pruebas (AB1-4, criterio 63) | Que cada prueba reemplace el almacén | Una prueba que lo olvide no escribe en el almacén de quien desarrolla |
| [005b, ronda 2] Relectura con `FOR SHARE` y `lock_timeout` de 5 s (AB2-1, criterio 64) | Lectura sin bloqueo (ronda 1); `FOR UPDATE`; `NOWAIT`; esperar sin límite; mirar `pg_locks` desde la API | Espera justo lo necesario para que la transacción original termine; si no termina, b3 conserva el invariante |
| [005b, ronda 3] `lock_timeout` con la opción `esperaMaximaDeBloqueoMs` de `BaseDatos.conAcademia` (precisa AB2-1) | `SET LOCAL lock_timeout` en `foto.service.ts`; excepción de lint para ese archivo | Las reglas de lint de la 001 prohíben cambiar parámetros de la transacción en los módulos; mismo efecto, local a la transacción |
| [005b, ronda 2] Modo `retenerCommit` en el proxy protegido, con el `pid` del `BackendKeyData` (AB2-1) | Un segundo proxy como el del adversarial; un retraso por tiempo | Una sola utilidad que entiende el protocolo; la espera se comprueba en `pg_blocking_pids` |
| [005b, ronda 2] `server.fs.deny` con `**/node_modules/@aquagestion(/**)` (AB2-2, criterio 65) | Lista de carpetas de `node_modules/` en `allow`; plugin con `realpath`; `preserveSymlinks` | Sin la ruta del usuario en el patrón; Vite lo aplica sin mayúsculas y en todos los caminos de lectura |
| [005b, ronda 2] `resolverAlmacenDirectorio` pura con `path.win32` o `path.posix`, rechazo de las formas de Windows y nombres cortos como comodín (AB2-3, criterio 66) | Normalizar `\\?\` y `\\.\`; `realpathSync.native`; riesgo aceptado; rechazar todo nombre corto | Determinista y probada en la nube; no rompe el directorio temporal de la integración continua en Windows |

## Migraciones

- `<marca>_inscripcion_publica`: tipos nuevos, `tipo_actor` + `PUBLICO`, las siete tablas con `CHECK`, llaves
  compuestas, índices (únicos, parciales y de búsqueda), RLS forzada, políticas y privilegios (spec, "Cambios al modelo
  de datos"). Sin datos.
- `<marca>_reserva_dentro_del_mes` (respuesta R1, criterio 56): solo el `CHECK matriculas_reserva_dentro_del_mes`
  (sección 2), validado (sin `NOT VALID`). Una base de desarrollo de esta rama sembrada con la semilla anterior (reserva
  vigente con vencimiento lejano) hará fallar la migración al validar el `CHECK`; un `UPDATE` previo en la migración no
  sirve, porque el dueño de las tablas también está sujeto a RLS forzada y no ve las filas sin contexto de academia. Como
  la 005a no está en `main`, se acepta: esas bases se borran y se crean de nuevo (ver la nota operativa siguiente) y se
  vuelve a sembrar; la base de pruebas y las bases nuevas no se ven afectadas. El documentador lo avisa en el PR.
- **Nota operativa (ronda 2), tarea T45 del documentador.** La migración se llama
  `20261120190000_reserva_dentro_del_mes` y valida las filas existentes al crear el `CHECK`. Una base de desarrollo
  sembrada con una versión anterior de la rama (reservas de ejemplo con vencimiento a 365 días) hace fallar
  `npm run db:preparar` (o `db:migrar`) con el código `23514` (`check_violation`) sobre
  `matriculas_reserva_dentro_del_mes`. `db:preparar` solo no basta, porque migra sobre la base existente: hay que
  borrarla y crearla. En Windows, con la sección ya existente "Borrar la base de desarrollo y empezar de cero" de
  `docs/guia-local-windows.md` (`docker compose down -v`, `docker compose up -d`, `npm run db:preparar`, que vuelve a
  crear el rol y la semilla); se pierden los datos de desarrollo. Va como problema conocido en
  `docs/guia-local-windows.md` (el responsable prueba en Windows con PostgreSQL en Docker, D-26), con el mensaje que se
  ve y el enlace a esa sección, y en la descripción del PR de la 005a. No aplica a la base de pruebas ni a quien cree la
  base desde cero (o desde `main` después de unir la 005a).

## Riesgos

- **Interbloqueos:** el envío toma bloqueos consultivos (IP, DNI), filas del cliente y clases; la cancelación toma
  actor, solicitud, matrícula y clases; la foto toma alumno y solicitud (PB8); el `PATCH` de clases toma actor (y
  entrenador) y clases. Ninguna toma una clase y después otra cosa, y ninguna toma la solicitud antes que el alumno. El
  adversarial debe probar a la vez: envío y cancelación del mismo cliente, envío y foto del mismo cliente, foto y
  cancelación, envío y `PATCH` de aforo o de `activo` sobre la misma clase, dos envíos cruzados de clases y de DNI.
- **Llaves foráneas y `FOR KEY SHARE`:** el `INSERT` de la matrícula toma `FOR KEY SHARE` sobre el plan y sobre las
  clases (estas ya están bloqueadas con `FOR UPDATE` por la misma transacción); el `PATCH` de un plan toma `FOR UPDATE`
  sobre el plan y no toca clases ni matrículas, así que no hay ciclo. Revisarlo si una historia hace que el `PATCH` de un
  plan toque matrículas.
- **`ALTER TYPE … ADD VALUE`** no se puede usar en la misma transacción: el valor `PUBLICO` solo se usa en la API.
- **[005b] `sharp` en Windows y en la integración continua:** binario por sistema operativo (D-26); la integración continua en
  Windows lo detecta. Si `npm ci` falla en alguna plataforma, se fija la versión.
- **[005b] Imágenes maliciosas:** `limitInputPixels`, el límite de 5 MB antes de decodificar y `failOn: 'error'`; `sharp` corre
  en el hilo de libuv, así que una imagen grande ocupa CPU: el límite de 10 por hora y por IP lo acota.
- **[005b] Recepción y límites por conexión:** desde "Nueva inscripción", recepción comparte conexión para los límites
  de los criterios 25 y 33 (respuesta B4, DR-20). No cambia el diseño de la 005b; la exclusión de la sesión de
  recepción va en la 007, antes de publicar el formulario.
- **[005b] Enlaces simbólicos en Windows:** crear un enlace pide permisos; la prueba del criterio 36 se omite si da
  `EPERM`, y la comprobación con `lstat` vale igual para las uniones de Windows.
- **[005b, ronda 1] Clasificar el error de la confirmación (criterio 61):** si un error de negocio de la transacción no
  se reconoce como tal, se relee de más (inofensivo); si un error de la base o de la conexión se tomara por uno de
  negocio, se volvería a borrar sin saber. Por eso la lista de "decididos por la transacción" es cerrada (los cuatro de
  la sección 9) y todo lo demás relee.
- **[005b, ronda 1] El proxy de prueba y Prisma (criterio 61):** el proxy depende de que Prisma hable el protocolo de
  PostgreSQL sin cifrar en la conexión local (hoy es así; si la URL pidiera `sslmode=require`, el proxy no vería los
  mensajes). Si Prisma reintenta una conexión cortada, la relectura del caso `caer` tarda hasta `ESPERA_CONEXION_MS`
  (10 s); la prueba usa un plazo amplio.
- **[005b, ronda 1] Lista cerrada de Vite (criterio 62):** una dependencia de la web que se resuelva fuera de
  `frontend/`, `packages/contratos/` o `node_modules/` de la raíz dejaría de servirse en desarrollo (403 en la consola
  del navegador). Las E2E usan el servidor de desarrollo, así que lo detectan; la prueba del criterio 62 comprueba lo
  mínimo (`/`, `/src/main.tsx`, contratos y una dependencia).
- **[005b, ronda 2] Bloqueo de la relectura (criterio 64):** con una conexión medio abierta, la fila del alumno queda
  bloqueada hasta que PostgreSQL la detecte; la relectura responde 500 a los 5 s sin borrar nada, y otras operaciones
  sobre ese alumno esperan (riesgo aceptado de la spec, "Conexión medio abierta"). Si un cambio futuro hiciera que la
  transacción de confirmación enviara el `COMMIT` sin haber bloqueado la fila (por ejemplo, un `UPDATE` sin `FOR
  UPDATE` previo que no encuentre la fila), el razonamiento de AB2-1 deja de valer: el revisor comprueba que el orden de
  PB8 se mantiene.
- **[005b, ronda 2] El modo `retenerCommit` y el protocolo extendido (criterio 64):** si Prisma envía el `COMMIT` como
  `Parse`, `Bind`, `Execute` y `Sync` en varios paquetes, el proxy debe esperar al `Sync` antes de cerrar el lado de la
  API; si lo cerrara antes, `liberar()` mandaría un `COMMIT` incompleto y el servidor no lo ejecutaría (el caso 1
  fallaría por la prueba, no por la API).
- **[005b, ronda 2] Valores por defecto de `deny` copiados (criterio 65):** una actualización de Vite que sume un valor
  por defecto no llega sola a la configuración; la prueba del 62 a, que compara con los valores de una configuración
  sin archivo, falla y avisa.
- **[005b, ronda 2] Comparación sin mayúsculas en Linux (criterio 66):** rechaza también `FRONTEND/` o `Packages/` en
  Linux, aunque sean carpetas distintas de las de la web. Es rechazar de más una configuración rara.
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
- **Correo sin esperar (ronda 1):** una promesa de `enviar` colgada queda pendiente en memoria; con muchas, crece el
  uso de memoria. El límite de 10 envíos por hora y por IP lo acota; un proveedor real (D-19) debe tener su propio
  tiempo máximo de conexión. Si el proceso se detiene después del 201, el correo se pierde (riesgo aceptado en la spec).
- **IPv6 por /64 (DR-15):** un analizador propio de IPv6 es un lugar fácil para errores (formas con `::` al inicio o
  al final, IPv4 embebida, zonas). Las pruebas unitarias del criterio 59 cubren esas formas; el adversarial de la ronda
  siguiente debe atacar `claveDeConexion` con textos raros. _(Ronda 2: atacada sin fallas.)_ Lo que queda abierto es
  el bloque mayor: con un /56 se multiplican por 256 los límites (riesgo aceptado de la spec y pregunta R7, propuesta
  de un segundo contador por /56 o /48 en el mismo almacén, con su propia clave).
- **Reintento con la reserva vencida (ronda 2):** el 409 `SOLICITUD_YA_REGISTRADA` de un reintento con la misma
  `claveIdempotencia` puede traer el código de una solicitud `VENCIDA`; la web no genera otra clave hasta recargar
  (riesgo aceptado de la spec; cumple el criterio 23). Si se quiere evitar, la web podría generar una clave nueva al
  recibir ese 409, pero eso es un cambio de comportamiento que no pide ningún criterio.
- **`tipoDeError` (ronda 2):** registra cualquier `constructor.name` con forma de identificador de hasta 64 caracteres
  (criterio 52). Al elegir el proveedor real de correo (D-19), comprobar que sus clases de error tienen nombres fijos.
- **Fin de mes (DR-12):** el `CHECK` y la función deben dar el mismo límite; la prueba del criterio 56 usa los mismos
  instantes que las del 54.
- **Entre los dos PR:** la 005a se puede unir a `main` sin la 005b. Mientras tanto no hay foto, la secretaria no lista
  ni cancela solicitudes desde el panel (las reservas sin pagar se liberan solas al vencer) y el administrador no puede
  bajar el aforo por debajo de los inscritos desde la web (la API lo permite con `confirmarAforoMenor`).
