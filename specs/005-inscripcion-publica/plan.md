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
│   ├── prisma/migrations/<marca>_reserva_dentro_del_mes/   CHECK matriculas_reserva_dentro_del_mes (criterio 56)
│   ├── src/comun/http/conexion.ts (+ .test.ts)         claveDeConexion (criterio 59)
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
│   │   ├── dominio/reserva.ts (+ .test.ts)            finDelMesEnLima, vencimientoDeReserva (criterio 54)
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
  para toda la web; no afecta a la API, que está en el mismo dominio). **Respuesta R3 (criterio 58):** con la vista
  reducida, `VistaSeguimiento` no muestra el saludo con el nombre (hoy "Hola, {nombres}") y su prueba de componentes
  cubre los dos casos.
- **[005b] Panel:** `PaginaSolicitudes` con filtro y diálogo de cancelación; `GrillaSemanal` muestra "inscritos / aforo" con
  `GET /api/clases/ocupacion`; `FormularioClase` maneja `AFORO_MENOR_QUE_INSCRITOS` con un diálogo que reenvía con
  `confirmarAforoMenor: true`, y `CLASE_CON_INSCRITOS` con un mensaje. Claves con la identidad de la sesión. En la
  005a, `FormularioClase` no cambia: muestra esos dos 409 como cualquier error de la 004.
- Montos: `lib/dinero.ts` de la 004 (texto, sin `number`).

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
  28, parte de la 005b).
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
